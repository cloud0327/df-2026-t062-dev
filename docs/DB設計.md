# DB 設計（PostgreSQL）

本体は [`db/migrations/`](../db/migrations/)。読み書きは [`db/repo.ts`](../db/repo.ts) に集めた。api と worker は同じ関数を使う。

## 決まり

| 決まり | 中身 |
|---|---|
| 事業所で分ける | すべての表に `office_id` を持つ。`db/repo.ts` の関数は、どれも事業所で絞る。ほかの事業所の利用者は 404 になる（`test/api.test.ts` で確かめている） |
| 欄の値は fields.json の key で持つ | 用紙の印字欄（pdfme の欄）ではなく、意味の単位（`person.name`、`cert.careLevel` など）で持つ。印字欄との行き来（表示と直し）は、書類が指す様式の版の対応（`bindings`）を共通の仕組み（`core/binding.ts`）で動かす |
| 様式はデータ | 様式（`form_templates`）と様式の版（`form_template_versions`）を DB に持つ。版の中身（欄の位置・対応・ページ）は書き換えない・消さない（トリガーで止める）。直すときは新しい版を出し、書類の向き先を `npm run forms:rebase` で移す。書類は作ったときの版を指し、保存した版（`revisions`）と出した PDF（`exports`）にも、そのときの版を残す |
| 様式のファイルは非公開の置き場 | 元の PDF とページの画像は、Cloud Storage の `forms` の置き場の `pdf/<元の PDF の sha256>/`（`base.pdf`・`pages/p<PDF のページ>.png`）。場所が中身で決まるので上書きは起きず、同じ PDF の版どうしは同じファイルを使う。版は `base_pdf_sha256` で PDF を指す。画面には期限つきの URL で渡す |
| 印字欄ごとの値は持たない | どの印字欄も対応があり、直しは key の値になるか、理由を出して断る（例: 受付方法が「電話」なのに「その他」の中身を書いた）。年だけ・年月だけの日付は、日付の値のまま持つ |
| 誰が書いたか | 欄ごとに `by`（`ai`／`cm`）を持つ。AI はケアマネの欄を書き換えない |
| 保存は書類ごと | 今の値（`field_values`）と、その書類で保存した値（`document_saved`）を分けて持つ。画面の印（橙・黄・緑の下線）は、この 2 つの違いで出す |
| 版は書き換えない | 保存のたびに、保存した値の全部を `revisions` に残す。PDF は最新の版から作る（保存していない AI の値は出ない） |
| 基本情報は 1 つ | fields.json で `shared` の欄（氏名・性別・生年月日・年齢・郵便番号・住所・電話）は、`document_id` を NULL にして利用者に 1 つだけ持つ。どの書類で直しても、全部の書類に入る |
| 用紙を変える AI の入口は 1 つ | `applyBatch`。書類の行を `FOR UPDATE` で止め、今の用紙を読み直し、書き換えの決まりで書く（1 回のトランザクション）。ケアマネの直し（`patchFields`）も同じ行を止めるので、同時に来ても順に入る |

## 表

| 表 | 中身 | 主な列 |
|---|---|---|
| `offices` | 事業所 | `name`、`phone`、`fax`（入院時情報提供書の事業所欄に写す） |
| `staff` | ケアマネ | `auth_uid`（Identity Platform の uid）、`name`、`email`、`role` |
| `clients` | 利用者 | `name`、`status`（在宅／入院中／入所中）、`next_visit_at`（iPad の一覧の「次の訪問」） |
| `people` | 話した人 | `label`（春子など）、`role`（本人・家族・専門職・ケアマネ・不明）、`relation`。次の録音でも同じ人にする |
| `form_templates` | 様式 | `kind`（`assessment`／`admission`）、`name`、`title`、`publisher`、`source_url`、`office_id`（NULL なら全事業所）。種類と使う範囲ごとに 1 つ。事業所の様式があれば、その事業所ではそれを使う |
| `form_template_versions` | 様式の版 | `version`、`status`（draft → published → retired）、`schemas`（欄の位置）、`bindings`（対応）、`pages`、`content_sha`、`base_pdf_sha256`。使う版（published）は様式に 1 つ。中身は書き換えない・消さない |
| `documents` | 書類 | `kind`（`assessment`／`admission`）、`template_version_id`（使う様式の版）。1 利用者 1 種類 1 つ |
| `field_values` | 今の値（シート） | `key`、`value`、`ai_value`（最後に AI が書いた値）、`by`、`batch_id`、`cite`（根拠の発言の id）。一意: `(client_id, document_id, key)`（NULLS NOT DISTINCT） |
| `field_history` | 前の値 | 書き換えるたびに追記 |
| `document_saved` | 保存した値 | `(document_id, key)` ごとに `value`・`by` |
| `document_sync_reviews` | 書類間の差異を最後に確認した元書類の値 | 元書類・対象書類・`key` ごとに `source_value`、確認者・確認日時。欄の値そのものと別に保持し、次の元書類変更を判定する |
| `revisions` | 版 | `rev`、`scope`（`hunk`／`page`／`document`）、`values`（保存した値の全部）、`template_version_id`（PDF はこの様式の版から作る） |
| `batches` | 書き込み | `kind`（`recording`／`copy`／`seed`）、`label`（「AI 書き込み 2・1/25 の録音」など）、`changes`（key・op・before・after）、`kept`（書き換えなかったケアマネの欄） |
| `recordings` | 録音（原本の音声） | `object_path`（Cloud Storage の場所）、`mime`、`bytes`、`duration_ms`、`status` |
| `transcripts` | 文字起こし（原本の文字） | `utterances`（id・時刻・話者の記号・人・文）、`speakers`、`model` |
| `jobs` | 録音 1 本の処理 | `status`（queued／processing／succeeded／partial／failed）、`step`（transcribe／speakers／write／apply）、`steps`（段ごとの結果・時間・トークン・円）、`lease_until`、`run_token`、`attempts`、`error_kind`、`batch_id`。録音 1 つに 1 つ、同じ書類で処理中は 1 つだけ |
| `exports` | 出した PDF | `revision_rev`、`template_version_id`、`object_path` |
| `audit_events` | 操作の記録（追記だけ） | `action`（client.create／document.edit／document.save／document.pdf／recording.start／form.rebase など）、`detail`（数だけ。欄の値や話の中身は入れない。form.rebase は移した版の番号と中身の指紋） |

### 書類間の差異

入院時情報提供書を作るときにアセスメントの値を写す。`shared` 以外の欄はその後独立する。両方の様式の版が読む `key` の共通部分を比較し、`shared` は除く。最初の確認済み値は作成時の `copy` バッチの `after`（写していない空欄は NULL）を使う。判断後は `document_sync_reviews` の元書類の値を更新する。元書類の現在値が保存済み値と違う間は差異を表示するが反映・維持を受け付けない。反映は対象書類の今の値だけを変え、保存済み版と PDF は「書類を保存」するまで変わらない。監査記録には判断と欄の `key` だけを残し、値は入れない。

## 録音ジョブの失敗と再配信

- 一時的な例外では `queued` に戻して Cloud Tasks の再配信または 5 分ごとの見回りで再開する。3 回失敗したら `failed` とし、それ以上は自動実行しない。
- Worker が取得するたび `run_token` を発行する。段階の更新と完了時に照合し、リースを失った古い実行を拒む。処理中は定期的にリースを延長する。
- 録音の `applyBatch` とジョブの `succeeded`／`partial` への更新は同じトランザクションで行う。`batches.job_id` は録音処理で一意。反映直後に通信が切れても、次の配信で同じ変更を重ねない。
- `partial` は確定済みの結果であり、自動再配信しない。AI が処理できなかった欄と形式不一致で反映できなかった欄の key を `jobs.steps.write.incompleteFields` に保存し、ジョブ API に出す。PDF プレビューでは該当欄を赤枠で示す。失敗項目だけを補完する別ジョブは作らず、担当者が録音し直す。

## 保存の 3 段

| 段 | 画面 | `document_saved` に入るもの |
|---|---|---|
| 1 か所 | 差分のふきだしの「保存」 | その欄の「前の文＋その 1 か所」。サーバーが前の文と今の文から組み立てる |
| ページ | 「このページを保存」 | そのページの印字欄が読む key |
| 書類 | 「書類を保存」 | 全部の欄 |

どの段でも、保存のあとの `document_saved` の全部を版にする。

## 2 層改にしたので持たないもの

設計の途中では 3 層（原本・事実・シート）を考えていたが、2026-11-09 に「2 層改」（記録から直接欄の値を書き、作り話を抑える 4 つの工夫を足す）にした。そのため、次のものは持たない。

- 事実（2 層目）と「確かめること」の表
- ケアマネの直しを `judge` の事実として入れること（直しは `by: "cm"` の値として持つ）
- 見直しの候補（`proposals`）と、書き込みの「元に戻す」（画面に入口がないため）

## 移行の流し方

```sh
npm run db:migrate   # db/migrations/*.sql を名前の順に流す（流したものは schema_migrations に残る）
npm run db:seed      # 見本のデータ（ローカルと demo だけ）
```

移行は足すだけにする（デプロイを戻しても DB が壊れないように）。Cloud SQL での初回の準備（`app` ロール）は [`infra/gcp/README.md`](../infra/gcp/README.md)。
