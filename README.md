# DevFest Hackathon 2026 チーム062 — ケア書類アシスタント（仮）

介護支援専門員（ケアマネ）向けの AI 業務エージェントです。面談を録音すると、AI がアセスメント用紙に書き込みます。ケアマネは用紙の上で違うところだけを直し、保存します。一度集めた情報は、入院時情報提供書など別の書類にも使い回します。

[デモサイトを開く](https://df-2026-t062-demo-327.web.app)

## できること

| 端末 | 画面 | できること |
|---|---|---|
| PC | 利用者一覧 | 担当の利用者、要介護度、アセスメントの必須欄の入力数。利用者を追加する |
| PC | 作業画面 | 全社協のアセスメント用紙（11 ページ）と入院時情報提供書を、用紙の上で直接直す（文字・丸・✓・援助の表の ○△）。AI が書いたところは橙、直したところは黄、AI が書き換えた文は緑の下線（押すと前の文と比べ、1 か所ずつ保存・前の文に戻す）。保存は「1 か所」「このページ」「書類」の 3 段。保存した版から PDF を出す |
| iPad（縦） | 利用者・用紙 | 録音する／止める。止めると、録音を送り、文字起こし → AI が用紙に書く。その間も用紙は書ける（AI が書き込む数秒だけ止まる）。自分が先に書いたところは、AI が上書きしない |

画面の見た目は、デザインのキャンバス（PC ①〜④、iPad ①〜③、録音の流れ A〜E、差分のふきだし、作業のお手伝い）に合わせています。作業のお手伝い（右下の猫）のメニューの動きは、まだ決めていないのでモックです。

## 仕組み

```
PC・iPad（React）── Firebase Hosting
   │  ID トークン（Identity Platform）
   ▼
Cloud Run api（Hono）── Cloud SQL（PostgreSQL）
   │ 録音の送り先 URL            ▲ applyBatch（用紙を変える入口は 1 つ）
   ▼                             │
Cloud Storage ◀── iPad が直接送る（再開できる送信）
   │
Cloud Tasks ──▶ Cloud Run worker：文字起こし（Speech-to-Text Chirp 3）→ 話した人 → 2 層改（Gemini）→ 型の確かめ → applyBatch
Cloud Scheduler（5 分ごと）──▶ worker の見回り
```

| フォルダ | 中身 |
|---|---|
| `src/` | 画面（React）。`pages/` が画面、`form/` が用紙の部品（ページの描画・値の持ち方・録音） |
| `api/` | api（Hono）。ログインの確かめ、置き場（Cloud Storage／ローカル）、ジョブの積み方（Cloud Tasks／同じプロセス）、PDF |
| `worker/` | 録音 1 本の処理。`vertex/` が本物の AI（STT・Gemini・2 層改）、`fake.ts` が費用のかからない見せかけ |
| `core/` | 画面・api・worker で共通のもの。`fields.json`（欄の一覧の本体）、型の確かめ、印字欄と欄の値の変換、文ごとの差分、書き換えの決まり |
| `forms/` | pdfme の様式（アセスメント・入院時情報提供書）。`seed/<様式>/bindings.json` が「印字欄 → 欄の値」の対応（変換は `core/binding.ts` の共通の仕組み） |
| `db/` | PostgreSQL の移行、読み書き（`repo.ts`）、見本のデータ |
| `eval/` | 演習シナリオ（公開）と採点（bench）。`run-writer.ts` で 2 層改をシナリオに通す |
| `docs/` | 設計書（[DB 設計](docs/DB設計.md)、[API 設計](docs/API設計.md)、[AI 基盤の設計](docs/AI基盤の設計.md)、[データの定義](docs/データの定義.md)、[欄の一覧](docs/欄の一覧.md)） |
| `infra/` | Terraform（Google Cloud） |

## ローカルで動かす

Node.js は `.nvmrc` の版を使います。最初に `npm ci` を実行します。

```sh
docker compose up -d                       # PostgreSQL（localhost:54329）
export DATABASE_URL=postgres://postgres:postgres@localhost:54329/careman
npm run db:migrate                         # 表を作る
npm run db:seed                            # 見本のデータ（架空の人と、公開の演習シナリオ）
npm run forms:fetch                        # 様式の PDF を全社協の公式の URL から取り、画面の画像を作る（pdftoppm が要る）

AUTH_MODE=dev npm run dev:api              # ターミナル 1: api（http://127.0.0.1:8787）
npm run dev                                # ターミナル 2: 画面（Vite）
```

- 画面を開くとログイン画面になります。ローカルでは、メールアドレス `kato@example.com` だけで入れます（`AUTH_MODE=dev` のときだけ）。
- iPad の画面を PC で見るときは、URL に `?ui=pad` を付けます（`?ui=pc` で戻る）。
- ローカルでは、録音の置き場は `.data/storage`、ジョブは api と同じプロセスで動きます。AI は既定で `AI_PROVIDER=fake`（演習シナリオの正解を返す。費用なし）です。

### 見本のデータ

| 利用者 | 状態 |
|---|---|
| 甲斐さん | 演習シナリオの 1 回目の面談のあと。AI が書いた値（橙）が未保存のまま入っている |
| 佐藤 一郎さん | 何も入っていない新しい利用者 |
| 山田 花子さん・田中 和子さん | 架空の見本データ（保存済み） |

### 本物の AI で動かす（費用がかかる）

```sh
gcloud auth application-default login
GOOGLE_CLOUD_PROJECT=<プロジェクト> AI_PROVIDER=vertex npm run dev:api
```

演習シナリオだけで 2 層改を試すときは `node eval/run-writer.ts --out <フォルダ>` を使い、`python3 eval/bench/bench.py score --gold eval/scenario/gold --submission <フォルダ>` で採点します。**実在の方の録音は、Google Cloud の外のサービスに送らないでください。**

## 確かめる

```sh
npm run typecheck
npm run forms:check        # 様式（template.json）・対応（bindings.json）・fields.json の食い違い
npm test                   # DATABASE_URL があれば DB を使うテストも走る
python3 -m unittest discover -s eval/bench
npm run build
```

印字欄を足した・名前を変えたときは、`forms/seed/<様式>/bindings.json` に対応を書きます（書き方は [docs/データの定義.md](docs/データの定義.md) の「印字欄の対応」）。

## 環境変数

| 変数 | 使うところ | 値 |
|---|---|---|
| `DATABASE_URL` | api・worker（ローカル・CI） | PostgreSQL の接続文字列 |
| `CLOUD_SQL_INSTANCE`・`DB_USER`・`DB_NAME` | api・worker（Cloud Run） | Cloud SQL のインスタンス名と IAM のユーザー（パスワードは持たない） |
| `AUTH_MODE` | api | `firebase`（既定）／`dev`（ローカルだけ） |
| `FIREBASE_PROJECT_ID` | api | ID トークンを確かめるプロジェクト |
| `STORAGE_MODE`・`GCS_SOURCE_BUCKET`・`GCS_OUTPUT_BUCKET`・`GCS_WORK_BUCKET` | api・worker | `gcs` で Cloud Storage。既定はローカル |
| `QUEUE_MODE`・`TASKS_QUEUE`・`WORKER_URL`・`TASKS_INVOKER_SA` | api | `tasks` で Cloud Tasks。既定は同じプロセス |
| `AI_PROVIDER`・`GOOGLE_CLOUD_PROJECT`・`GEMINI_MODEL`・`GEMINI_LOCATION`・`STT_LOCATION` | worker | `vertex` で本物の AI。既定は `fake` |

## CI/CD

PR と `main` で、型チェック、様式の確かめ、テスト（PostgreSQL を使うものも）、ビルド、公開版の確かめ、Docker イメージの確かめを行います。公開ジョブは検証済みの `dist/` を Firebase Hosting に出します。api と worker は同じイメージで、Cloud Run への公開は手動の workflow（`cloud-run.yml`、承認つき）です。Google Cloud の構成と初回の準備（Terraform の適用、Cloud SQL の `app` ロール、移行）は [infra/gcp/README.md](infra/gcp/README.md) を見てください。

### 切り戻し

- Hosting: Firebase Console の **Hosting → リリース履歴** で、動作確認済みのリリースに戻します。`/version.json` の SHA で確かめます。
- Cloud Run: `cloud-run.yml` の手順（前のリビジョンにトラフィックを戻す）。DB の移行は足すだけにしているので、戻しても壊れません。

## 様式の PDF について

様式の元の PDF と、そこから作ったページの画像・座標データは、利用条件のため公開リポジトリに入れていません。アセスメント用紙は `npm run forms:fetch` で全社協の公式の URL から取ってきます（くわしくは [forms/README.md](forms/README.md)）。画像がないときは、白い紙の上に欄だけが出ます。公開のデモで用紙の画像を配る前に、全社協に利用の許可を確かめます。

## 個人情報の扱い

- このリポジトリは公開です。入っているのは、公開の演習シナリオ（山梨県介護支援専門員協会の演習用 PDF を写したもの）と、架空の見本データだけです。
- 録音・文字起こし・用紙の値は、Google Cloud の東京リージョン（Cloud SQL・Cloud Storage）に置きます。ログには中身を出しません（ジョブの id・段・時間・誤りの種類・使った量だけ）。
- 誰が、いつ、直した・保存した・PDF を出したかを `audit_events` に残します。

## 最終提出

作品が完成したら、公開確認済みのコミットからソース、資料、再現用の設定を取り出します。公開 URL と開発元の SHA を添えて、[運営の提出用リポジトリ](https://github.com/Devfest-Hackathon-2026/df-2026-t062)に提出用 PR を作ります。提出物に秘密情報や開発履歴が含まれていないことを確認します。
