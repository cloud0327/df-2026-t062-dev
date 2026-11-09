# DevFest Hackathon 2026 チーム062 — ケア書類アシスタント（仮）

介護支援専門員（ケアマネ）向けの AI 業務エージェントです。面談を録音すると、AI がアセスメント用紙に書き込みます。ケアマネは用紙の上で違うところだけを直し、保存します。一度集めた情報は、入院時情報提供書など別の書類にも使い回します。

[デモサイトを開く](https://gen-lang-client-0990270423.web.app)

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
| `forms/` | 様式のデータと道具。`seed/<様式>/`（様式の情報・欄の位置・印字欄 → 欄の値の対応）を `admin/`（`forms:seed`・`forms:assets`・`forms:rebase`・`forms:check`）が DB と置き場に入れる。`tools/` は様式を作る道具 |
| `db/` | PostgreSQL の移行、読み書き（`repo.ts`）、見本のデータ |
| `eval/` | 演習シナリオ（公開）と採点（bench）。`run-writer.ts` で 2 層改をシナリオに通す |
| `docs/` | 設計書（[DB 設計](docs/DB設計.md)、[API 設計](docs/API設計.md)、[AI 基盤の設計](docs/AI基盤の設計.md)、[データの定義](docs/データの定義.md)、[欄の一覧](docs/欄の一覧.md)） |
| `infra/` | Terraform（Google Cloud） |

## ローカルで動かす

Node.js は `.nvmrc` の版を使います。最初に `npm ci` を実行します。設定は `.env` に書きます（見本は `.env.example`。`.env` は git に入れません）。`npm run dev:api`・`db:*`・`forms:*` は `.env` を自動で読むので、毎回環境変数を指定しなくて構いません（`npm test` は読みません）。

```sh
cp .env.example .env                       # 最初に 1 回。DB・ログインのやり方・AI の種類を書く
docker compose up -d                       # PostgreSQL（localhost:54329）
npm run db:migrate                         # 表を作り、様式（forms/seed）を登録する
npm run db:seed                            # 見本のデータ（架空の人と、公開の演習シナリオ）
npm run forms:assets                       # 様式の元の PDF（全社協の公式の URL から取る）とページの画像を、置き場（.data/storage/forms）に入れる（pdftoppm が要る）

npm run dev:api                            # ターミナル 1: api（http://127.0.0.1:8787）
npm run dev                                # ターミナル 2: 画面（http://localhost:5173）
```

- 画面を開くとログイン画面になります。ローカルでは、メールアドレス `kato@example.com` だけで入れます（`.env` の `AUTH_MODE=dev` のときだけ）。
- iPad の画面を PC で見るときは、URL に `?ui=pad` を付けます（`?ui=pc` で戻る）。録音のボタンは iPad の画面にあります。
- ローカルでは、録音の置き場は `.data/storage`、ジョブは api と同じプロセスで動きます。AI は `.env.example` のままなら `AI_PROVIDER=fake`（演習シナリオの正解を返す。費用なし）です。

### 見本のデータ

| 利用者 | 状態 |
|---|---|
| 甲斐さん | 演習シナリオの 1 回目の面談のあと。AI が書いた値（橙）が未保存のまま入っている |
| 佐藤 一郎さん | 何も入っていない新しい利用者 |
| 山田 花子さん・田中 和子さん | 架空の見本データ（保存済み） |

### 本物の AI で動かす（費用がかかる）

`gcloud auth application-default login` でログインし、`.env` を次のようにしてから `npm run dev:api` を起動し直します。録音するたびに、文字起こし（Chirp 3、東京）と Gemini（`gemini-3.8-flash`、global）の費用がかかります（30 分の面談で 100〜150 円ほどの見込み）。

```sh
AI_PROVIDER=vertex
GOOGLE_CLOUD_PROJECT=<プロジェクト>
```

演習シナリオだけで 2 層改を試すときは `node eval/run-writer.ts --out <フォルダ>` を使い、`python3 eval/bench/bench.py score --gold eval/scenario/gold --submission <フォルダ>` で採点します。**実在の方の録音は、Google Cloud の外のサービスに送らないでください。**

## 確かめる

```sh
npm run typecheck
npm run forms:check        # 様式の版を出す前の確かめ（欄の位置・対応・fields.json の食い違い）
npm test                   # DATABASE_URL があれば DB を使うテストも走る
python3 -m unittest discover -s eval/bench
npm run build
```

様式は DB の版つきのデータです（[DB 設計](docs/DB設計.md)）。`forms/seed/<様式>/` を直したら、`npm run forms:check` で確かめてから `npm run forms:seed` で新しい版を登録し、`npm run forms:assets` で PDF と画像を置き場に入れ、`npm run forms:rebase` で書類の向き先を移します（新しい版が古い版の読んでいた key を全部読むときだけ移します）。対応の書き方は [docs/データの定義.md](docs/データの定義.md) の「印字欄の対応」。

## 環境変数

| 変数 | 使うところ | 値 |
|---|---|---|
| `DATABASE_URL` | api・worker（ローカル・CI） | PostgreSQL の接続文字列 |
| `CLOUD_SQL_INSTANCE`・`DB_USER`・`DB_NAME` | api・worker（Cloud Run） | Cloud SQL のインスタンス名と IAM のユーザー（パスワードは持たない） |
| `AUTH_MODE` | api | `firebase`（既定）／`dev`（ローカルだけ） |
| `FIREBASE_PROJECT_ID` | api | ID トークンを確かめるプロジェクト |
| `STORAGE_MODE`・`GCS_SOURCE_BUCKET`・`GCS_OUTPUT_BUCKET`・`GCS_WORK_BUCKET` | api・worker | `gcs` で Cloud Storage。既定はローカル |
| `GCS_FORMS_BUCKET` | api・`forms:assets` | 様式の元の PDF とページの画像の置き場（非公開。画面には期限つきの URL） |
| `LOCAL_SIGNING_SECRET` | api（ローカル） | ローカルの期限つきの URL の署名の鍵。なければ起動のたびに作る |
| `QUEUE_MODE`・`TASKS_QUEUE`・`WORKER_URL`・`TASKS_INVOKER_SA` | api | `tasks` で Cloud Tasks。既定は同じプロセス |
| `AI_PROVIDER`・`GOOGLE_CLOUD_PROJECT`・`GEMINI_MODEL`・`GEMINI_LOCATION`・`STT_LOCATION` | worker | `vertex` で本物の AI。既定は `fake`。Gemini の既定は `gemini-3.8-flash`（`global`）、文字起こしは東京（`asia-northeast1`） |

## CI/CD

PR と `main` で、型チェック、様式の確かめ、テスト（PostgreSQL を使うものも）、ビルド、公開版の確かめ、Docker イメージの確かめを行います。`Verify` が成功し、`HOSTING_ENABLED=true` の場合は、検証済みの `dist/` を `hosting-live-wif` Environmentの設定を使って Firebase Hosting に自動公開します。api と worker の Cloud Run 公開は手動の workflow（`cloud-run.yml`、承認つき）です。Google Cloud の構成と初回の準備（Terraform の適用、Cloud SQL の `app` ロール、移行）は [infra/gcp/README.md](infra/gcp/README.md) を見てください。

### Firebase Hosting の初回接続

1. Firebase プロジェクト `gen-lang-client-0990270423` のデフォルト Hosting サイトを使います。
2. Hosting 専用サービスアカウントに `roles/firebasehosting.admin` と `roles/serviceusage.apiKeysViewer` を付与します。WIF の信頼条件は、開発用リポジトリと所有者の数値 ID、`main`、`ci-cd.yml`、`hosting-live-wif` に限定します。
3. GitHub の `hosting-live-wif` Environment で `main` からのデプロイを許可し、`FIREBASE_PROJECT_ID`、`FIREBASE_HOSTING_URL`、`FIREBASE_WIF_PROVIDER`、`FIREBASE_DEPLOY_SERVICE_ACCOUNT` を登録します。Firebase CLI は短期認証を Application Default Credentials 経由で利用します。
4. `Verify` が成功したら、リポジトリ変数 `HOSTING_ENABLED=true` を設定します。`main` への push で自動公開されます。

### 切り戻し

- Hosting: Firebase Console の **Hosting → リリース履歴** で、動作確認済みのリリースに戻します。`/version.json` の SHA で確かめます。
- Cloud Run: `cloud-run.yml` の手順（前のリビジョンにトラフィックを戻す）。DB の移行は足すだけにしているので、戻しても壊れません。

## 様式の PDF について

様式の元の PDF と、そこから作ったページの画像・座標データは、利用条件のため公開リポジトリに入れていません。サービスでは非公開の置き場（Cloud Storage の `forms`）に置き、画面には期限つきの URL で渡します。アセスメント用紙は `npm run forms:assets` が全社協の公式の URL から取ってきます（中身はハッシュで確かめます）。画像がないときは、白い紙の上に欄だけが出ます。公開のデモで用紙の画像を配る前に、全社協に利用の許可を確かめます。

## 個人情報の扱い

- このリポジトリは公開です。入っているのは、公開の演習シナリオ（山梨県介護支援専門員協会の演習用 PDF を写したもの）と、架空の見本データだけです。
- 録音・文字起こし・用紙の値は、Google Cloud の東京リージョン（Cloud SQL・Cloud Storage）に置きます。ログには中身を出しません（ジョブの id・段・時間・誤りの種類・使った量だけ）。
- 用紙を書く Gemini（Vertex AI）は `global` の呼び先で使います。東京で使える Gemini は 3.5 Flash だけで、新しく安い 3.8 Flash は global・us・eu だけのためです。Google は、東京などの地域の呼び先でも global でも、その地域の中で処理することを保証していません（保証するのは us・eu の呼び先だけ）。Vertex AI に送ったデータは、モデルの学習には使われません。
- 誰が、いつ、直した・保存した・PDF を出したかを `audit_events` に残します。

## 最終提出

作品が完成したら、公開確認済みのコミットからソース、資料、再現用の設定を取り出します。公開 URL と開発元の SHA を添えて、[運営の提出用リポジトリ](https://github.com/Devfest-Hackathon-2026/df-2026-t062)に提出用 PR を作ります。提出物に秘密情報や開発履歴が含まれていないことを確認します。
