# DB 設計（PostgreSQL）

本体は [`db/migrations/`](../db/migrations/)。読み書きは [`db/repo.ts`](../db/repo.ts) に集めた。api と worker は同じ関数を使う。

## 決まり

| 決まり | 中身 |
|---|---|
| 事業所で分ける | すべての表に `office_id` を持つ。`db/repo.ts` の関数は、どれも事業所で絞る。ほかの事業所の利用者は 404 になる（`test/api.test.ts` で確かめている） |
| 欄の値は fields.json の key で持つ | 用紙の印字欄（pdfme の欄）ではなく、意味の単位（`person.name`、`cert.careLevel` など）で持つ。印字欄への変換は `forms` の `toInputs`、画面で直した印字欄から key への戻しは `forms/templates/<様式>/slotmap.json` |
| 戻せない印字欄 | 対応表できれいに戻せない印字欄（約 19%）は、`slot:<印字欄の名前>` という key で、その印字欄の文字を持つ。PDF にも出る |
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
| `documents` | 書類 | `form`（`assessment`／`admission`）。1 利用者 1 様式 1 つ |
| `field_values` | 今の値（シート） | `key`、`value`、`ai_value`（最後に AI が書いた値）、`by`、`batch_id`、`cite`（根拠の発言の id）。一意: `(client_id, document_id, key)`（NULLS NOT DISTINCT） |
| `field_history` | 前の値 | 書き換えるたびに追記 |
| `document_saved` | 保存した値 | `(document_id, key)` ごとに `value`・`by` |
| `revisions` | 版 | `rev`、`scope`（`hunk`／`page`／`document`）、`values`（保存した値の全部） |
| `batches` | 書き込み | `kind`（`recording`／`copy`／`seed`）、`label`（「AI 書き込み 2・1/25 の録音」など）、`changes`（key・op・before・after）、`kept`（書き換えなかったケアマネの欄） |
| `recordings` | 録音（原本の音声） | `object_path`（Cloud Storage の場所）、`mime`、`bytes`、`duration_ms`、`status` |
| `transcripts` | 文字起こし（原本の文字） | `utterances`（id・時刻・話者の記号・人・文）、`speakers`、`model` |
| `jobs` | 録音 1 本の処理 | `status`（queued／processing／succeeded／partial／failed）、`step`（transcribe／speakers／write／apply）、`steps`（段ごとの結果・時間・トークン・円）、`lease_until`、`batch_id`。録音 1 つに 1 つ、同じ書類で処理中は 1 つだけ |
| `exports` | 出した PDF | `revision_rev`、`object_path` |
| `audit_events` | 操作の記録（追記だけ） | `action`（client.create／document.edit／document.save／document.pdf／recording.start など）、`detail`（数だけ。欄の値や話の中身は入れない） |

## 保存の 3 段

| 段 | 画面 | `document_saved` に入るもの |
|---|---|---|
| 1 か所 | 差分のふきだしの「保存」 | その欄の「前の文＋その 1 か所」。サーバーが前の文と今の文から組み立てる |
| ページ | 「このページを保存」 | そのページに印字欄がある key と、そのページの `slot:` の値 |
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
