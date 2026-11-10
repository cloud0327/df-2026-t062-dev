# Google Cloudの初期構築

## Google Cloudに接続せず検証する

Terraform 1.17.1を使います。`terraform init` は公開プロバイダーを取得し、`terraform test` はGoogleプロバイダーをモックします。GitHub Actionsの `Terraform` ワークフローも同じコマンドを実行します。

```sh
cd infra/gcp
terraform fmt -check -recursive
terraform init -backend=false -input=false -lockfile=readonly
terraform validate
terraform test
```

## 請求先の決定後に初期化する

1. 対象プロジェクトと請求先を確定し、課金が有効であることを確認します。Firebase HostingのrewriteでAPIにつなぐので、HostingとCloud Runを同じFirebaseプロジェクトに置きます。既存の同名リソースがある場合は、管理者がTerraformへのインポートか別名での作成を判断します。
2. プロジェクトのAPIとIAMを管理できる担当者が、Google Cloud CLIとApplication Default Credentialsで認証します。下の例は、専用のGCS stateバケットを初めて作る場合です。バケット名を一意な名前に置き換えてください。stateのアクセスはTerraform運用者に限定します。

   ```sh
   PROJECT_ID="your-billing-enabled-project"
   REGION="asia-northeast1"
   STATE_BUCKET="your-private-terraform-state-bucket"

   gcloud auth login
   gcloud auth application-default login
   gcloud services enable serviceusage.googleapis.com storage.googleapis.com --project "$PROJECT_ID"
   gcloud storage buckets create "gs://$STATE_BUCKET" --project "$PROJECT_ID" --location "$REGION" \
     --uniform-bucket-level-access --public-access-prevention
   gcloud storage buckets update "gs://$STATE_BUCKET" --versioning
   ```

3. `terraform.tfvars.example` と `backend.hcl.example` をコピーして、実際のプロジェクトIDとバケット名を記入します。GitHubの数値IDは例に記入済みです。所有者の移転や別リポジトリでの再利用時は、`gh api repos/OWNER/REPO --jq '{repository_id: .id, owner_id: .owner.id}'` で確認します。
4. `infra/gcp` で以下を実行し、作成対象とIAMを確認してから、保存したプランを適用します。stateとプランは運用者の管理下に置きます。

   ```sh
   cp terraform.tfvars.example terraform.tfvars
   cp backend.hcl.example backend.hcl
   # 両ファイルの値を確認・編集してから実行
   terraform init -reconfigure -backend-config=backend.hcl -lockfile=readonly
   terraform plan -out=bootstrap.tfplan
   terraform apply bootstrap.tfplan
   terraform output
   ```

Cloud Runは初回作成時にイメージが必要なので、Google Cloudのサンプルイメージで作成します。リクエスト課金、最小0・最大2インスタンスで開始します。インスタンス数の上限と請求額の上限は別です。

GitHubのデプロイ用サービスアカウントには、対象のArtifact RegistryにWriter、対象のCloud RunサービスにDeveloper、実行用サービスアカウントにService Account Userを付与します。Cloud Run Developerはサービスの設定も更新できる権限です。WIFで認証できるワークフローを限定し、Terraformとリリースで管理範囲を分けます。

## アプリ本体のリソース（api・worker・DB・ストレージ・認証）

最初の骨組み（Artifact Registry、WIF、api）に加えて、アプリが動くために必要なリソースもTerraformで作ります。

| ファイル | 作るもの | 要点 |
|---|---|---|
| `sql.tf` | Cloud SQL（PostgreSQL 17、Enterprise、`db-f1-micro`）、DB `careman`、IAM DBユーザー2つ | 自動バックアップ7世代、PITR、`deletion_protection`（Terraformとの両方）、`cloudsql.iam_authentication=on`、パスワードなし。接続はCloud SQL Connector（VPCなし） |
| `storage.tf` | バケット4つ `<project_id>-t062-source / output / work / forms` | 均一アクセス、公開アクセス防止を強制、バージョニングなし。`work` は30日で削除。`source` は `app_origins` からの録音の直接送信用CORS（PUT/POST/GET/OPTIONS、maxAge 3600）。`forms` は様式の元の PDF とページの画像（`pdf/<元の PDF の sha256>/…`）。api は読むだけで、画面には期限つきの URL で渡す |
| `queue.tf` | Cloud Tasksキュー `t062-jobs`、Schedulerジョブ `t062-reconcile` | 同時配信3、最大5回まで間隔を広げて再試行。Schedulerは5分ごとにworkerの `/tasks/reconcile` をOIDCつきでPOST |
| `worker.tf` | workerのCloud Runサービス、DB移行のCloud Runジョブ | workerは非公開（`invoker_iam_disabled=false`）、タイムアウト1800秒、最小0・最大2、1 CPU・1Gi。移行ジョブはapiの実行用サービスアカウントで動き、DB の移行と様式の登録（`node db/migrate.ts --forms`）を流す |
| `identity.tf` | Identity Platform設定 | メールとパスワードだけを有効、画面からのアカウント作成は禁止（`disabled_user_signup`）。アカウントは管理者が作る |
| `budget.tf` | 予算アラート（任意） | `billing_account_id` を指定したときだけ作る |
| `main.tf` | apiを更新、サービスアカウント追加 | apiは公開（`invoker_iam_disabled=true`。アプリがFirebaseのIDトークンを検証する）、1Gi、タイムアウト900秒、環境変数つき |

### サービスアカウントと権限

| サービスアカウント | 付与する権限 |
|---|---|
| `cloud-run-api-runtime`（api、移行ジョブ） | `cloudsql.client` と `cloudsql.instanceUser`（プロジェクト単位）、`source` と `output` に `storage.objectAdmin`、`forms` に `storage.objectViewer`（読むだけ）、自分自身に `iam.serviceAccountTokenCreator`（録音の送信 URL と、様式の画像の期限つきの URL の署名）、キューに `cloudtasks.enqueuer`、`tasks-invoker` に `iam.serviceAccountUser`、`aiplatform.user`（書き方の相談で Gemini を呼ぶ） |
| `cloud-run-worker-runtime`（worker） | `cloudsql.client` と `cloudsql.instanceUser`、`source` に `storage.objectViewer`、`work` に `storage.objectAdmin`、`aiplatform.user`、Speech-to-Text（既定は `roles/speech.client`。workerが認識器を作る場合は変数 `worker_speech_role` を `roles/speech.editor` にする）、キューに `cloudtasks.enqueuer`、`tasks-invoker` に `iam.serviceAccountUser` |
| Speech-to-Text service agent | `source` に `storage.bucketViewer` と `storage.objectViewer`。BatchRecognize が `gs://` の録音を直接読むため、API有効化で作られる `service-<project-number>@gcp-sa-speech.iam.gserviceaccount.com` に録音バケットだけの読み取り権限を付ける |
| `tasks-invoker`（Cloud TasksとSchedulerのOIDCの身元） | workerのCloud Runサービスにだけ `run.invoker` |
| `github-api-deploy`（デプロイ用） | 上の表のapiと同じ範囲を、workerサービスと移行ジョブにも付ける（`run.developer`）。workerのヘルスチェック呼び出し用にworkerだけ `run.invoker`。workerと移行ジョブの実行用サービスアカウントには `serviceAccountUser` |

`cloudsql.client` と `cloudsql.instanceUser` はプロジェクト単位でしか付けられません。このプロジェクトのCloud SQLは1つだけです。DBの中の権限は、次の「DBの初期設定」でさらに絞ります。

### workerのURL

workerのURLは「`https://<サービス名>-<プロジェクト番号>.<リージョン>.run.app`」の形で決まっています。workerの環境変数 `WORKER_URL` に自分自身の `uri` は入れられない（Terraformで循環する）ので、この形で組み立てて、api・worker・Schedulerに同じ値を渡します。初回のapply後に `terraform output worker_url` と `terraform output worker_uri` が一致することを確認してください。

### 起動コマンドとイメージ

最初はサンプルイメージで作るため、workerの起動コマンド（`node worker/index.ts`）はTerraformでは持ちません。イメージ・コマンド・引数・トラフィックはリリースのワークフローが毎回指定し、Terraformは `ignore_changes` で触りません。移行ジョブも同じです。

## DBの初期設定（初回に一度だけ）

IAM認証のDBユーザー（apiとworkerのサービスアカウント）はTerraformが作りますが、テーブルを作る権限（`CREATE`）は持っていません。管理者が次の手順で、共通のロール `app` を作って両方を所属させ、スキーマの持ち主にします。`ALTER ROLE ... SET role` により、どちらのユーザーで接続しても `app` として動くので、どちらが作ったテーブルも両方が使えます。

1. `terraform output -raw bootstrap_sql` でSQLを出します（ユーザー名が入っています）。
2. 組み込みの `postgres` ユーザーにパスワードを付けて接続します。作業後はパスワードを使い捨ての値に変えます。

   ```sh
   gcloud sql users set-password postgres --instance t062-db --prompt-for-password
   gcloud sql connect t062-db --user postgres --database careman
   # 開いた psql に bootstrap_sql の内容を貼る
   ```

   実行する内容は次のとおりです（`<api-sa-iam-user>` は `terraform output -raw api_db_user`、`<worker-sa-iam-user>` は `terraform output -raw worker_db_user`）。

   ```sql
   CREATE ROLE app NOLOGIN;
   GRANT app TO "<api-sa-iam-user>", "<worker-sa-iam-user>";
   ALTER SCHEMA public OWNER TO app;
   ALTER ROLE "<api-sa-iam-user>" SET role = 'app';
   ALTER ROLE "<worker-sa-iam-user>" SET role = 'app';
   ```

3. 移行はリリースのワークフローが流します。手元から流す場合は、`app` に所属するユーザー（api・workerのサービスアカウントを借りる、または `GRANT app TO` した自分のIAMユーザー）で `DB_USER=... CLOUD_SQL_INSTANCE=... npm run db:migrate` を実行します。`postgres` で流すとテーブルの持ち主が `postgres` になり、api・workerが使えなくなります。

## 様式（アセスメント用紙・入院時情報提供書）を入れる

様式は DB の版つきのデータです（`docs/DB設計.md`）。元の PDF とページの画像は、非公開の `forms` バケットに置きます。どちらもリポジトリには入れません。

| いつ | 何をする | どうやって |
|---|---|---|
| リリースのたび | 様式の版を登録する（`forms/seed` の中身が変わったときだけ新しい版になる） | リリースのワークフローの移行の段が `node db/migrate.ts --forms` を流す |
| 初回と、元の PDF が変わったとき | 元の PDF とページの画像を `forms` に入れる | 管理者が手元で `gcloud auth application-default login` のあと、`STORAGE_MODE=gcs GCS_FORMS_BUCKET=$(terraform output -json buckets \| jq -r .forms) npm run forms:assets`（pdftoppm が要る）。場所が元の PDF のハッシュで決まるので DB は要らず、上書きも起きない。入院時情報提供書は公開されていないので、手元の PDF を `forms/tools/templates/admission/base.pdf` に置いたときだけ入る |
| 新しい版を出したあと | 古い版を指す書類を新しい版に移す | 移行ジョブの引数だけを変えて流す: `gcloud run jobs execute <移行ジョブ> --region <リージョン> --args forms/admin/rebase.ts,--dry-run --wait` で確かめてから、`--dry-run` を外して流す。新しい版が古い版の読んでいた key を全部読むときだけ移す |

`forms` に入れる権限は、管理者の IAM ユーザー（プロジェクトのオーナーなど）を使います。api は読むだけです。

## 適用の順序

1. 上の「請求先の決定後に初期化する」の手順で、`terraform apply` します。`terraform.tfvars` に `app_origins` を入れます。バケット名は全世界で一意なので、衝突したら `bucket_prefix` を変えます。Identity Platformは、初めてのプロジェクトではFirebaseコンソールでAuthenticationを一度開始しておくと確実です。APIの有効化が反映されるまでの数分、初回のapplyが失敗することがあります。その場合は同じapplyをやり直します。
2. `terraform output` でworkerのURL（`worker_url` と `worker_uri` が一致すること）、`bootstrap_sql`、各名前を確認します。
3. 「DBの初期設定」を実行します。
4. 下の「Cloud Runリリースを有効にする」の変数を登録し、**Release Cloud Run** を実行します。最初のリリースで、イメージが入るまでサンプルイメージのまま起動していたapi・workerが本物に置き換わり、移行が流れます。
5. Firebaseコンソールまたは Admin SDK で、ケアマネのアカウントを作ります（画面からの登録は禁止）。
6. Firebase Hostingを公開します（`firebase.json` が `/api/**` をCloud Runの `t062-api` に中継します）。

初回のapplyは、請求先が有効なプロジェクトでTerraformを動かす人が、Cloud SQL・Cloud Run・Cloud Tasks・Scheduler・Identity Platformなどを作れる権限（プロジェクトのオーナー相当）を持つ前提です。Schedulerジョブを作るために、その人に `tasks-invoker` への `iam.serviceAccountUser` も必要です。

### 実行したことのない部分

`terraform validate` と `terraform test`（モック）は通りますが、実際のapplyは未確認です。次の点は、初回のapply・リリースで確認してください。

- Speech-to-Textの `roles/speech.client` で足りるか（認識器をworkerが作るなら `roles/speech.editor`）。
- Speech-to-Textがバケットを読むときの権限（`source` のオブジェクトを読めない場合は、Speech-to-Textのサービスエージェントにも `storage.objectViewer` が要ることがあります）。
- Identity Platform設定がADCの認証だけで作れるか。作れないときは `GOOGLE_BILLING_PROJECT` と `USER_PROJECT_OVERRIDE=true` を設定します。

## Cloud Runリリースを有効にする

1. GitHubに `cloud-run` Environmentを作ります。デプロイできるブランチは `main` に限定し、リリース責任者の承認を必須にします。複数人で運用する場合は自己承認も禁止します。
2. 同じEnvironmentに以下の変数を登録します。

   | GitHub Environment変数 | 値 |
   |---|---|
   | `GCP_PROJECT_ID` | `terraform.tfvars` の `project_id` |
   | `GCP_REGION` | `region` |
   | `CLOUD_RUN_SERVICE` | `service_name` |
   | `GCP_WIF_PROVIDER` | `terraform output -raw workload_identity_provider` |
   | `GCP_DEPLOY_SERVICE_ACCOUNT` | `terraform output -raw deploy_service_account` |
   | `CLOUD_RUN_WORKER_SERVICE` | `terraform output -raw worker_cloud_run_service`（`worker_service_name`） |
   | `CLOUD_RUN_MIGRATE_JOB` | `terraform output -raw migrate_job`（`migrate_job_name`） |

3. リポジトリ変数 `CLOUD_RUN_ENABLED=true` を設定します。最新の `main` で `Verify` が成功したら、GitHub Actionsの **Release Cloud Run** を `main` で手動実行します。WIFは、登録済みのリポジトリIDと所有者ID、`main`、このワークフロー、`cloud-run` Environmentの組み合わせに限定します。

公開ワークフローはPR #2と同じ `linux/amd64` ビルドとAPIスモークテストを使います。検証したイメージをArtifact Registryにpushし、次の順で、**同じイメージのダイジェスト**をapiとworkerに入れます。

| 順 | 内容 | 失敗したとき |
|---|---|---|
| 1 | DB移行。Cloud Runジョブ（`CLOUD_RUN_MIGRATE_JOB`）のイメージを更新し、`node db/migrate.ts` を `--wait` で流す | そこで止まる。api・workerは変わらない。移行は足すだけで、同時実行は advisory lock で防ぐ |
| 2 | workerを `node worker/index.ts` で更新し、認証つきで `/health` を確認する | 直前のリビジョンに戻して止まる。apiは変わらない |
| 3 | apiの候補リビジョンをトラフィックなしで作り、認証付きで検証する | 切り替えない |
| 4 | apiを100%に切り替え、切り替え後も実APIを検証する | 直前のリビジョンへ戻す |

移行をCloud Runジョブにしたのは、ビルド済みのイメージそのもの（同じコードと依存）で流せて、GitHub Actionsのランナーに `npm ci` もCloud SQLへの接続も要らないためです。移行を先に流すので、新しいスキーマに古いapi・workerが一時的に動く前提になります。移行は「足すだけ」にしてください（列の削除・改名は、使わなくしたリリースの次のリリースで行います）。

Terraformはサービス設定、スケーリング、IAMを管理します。初回作成後のイメージとトラフィックはリリースワークフローが管理します。Terraformの適用とアプリのリリースは重ねず、初回公開後にTerraformのプランでイメージやトラフィックの巻き戻しがないことを確認します。

## 障害対応と一般公開

- 障害時はActionsのジョブログで直前のリビジョン名を確認し、必要に応じて下のコマンドで戻します。途中でジョブをキャンセルした場合はCloud Runのリビジョンと配分を確認します。初回の戻し先は認証必須のサンプルリビジョンです。

  ```sh
  gcloud run services update-traffic "$SERVICE_NAME" --project "$PROJECT_ID" --region "$REGION" \
    --to-revisions "$PREVIOUS_REVISION=100"
  ```

- 一般公開前に、責任者と通知先を決め、Cloud Monitoringでエラー率と応答時間、Cloud Billingで予算通知を設定します。初回は認証付きの実環境で公開・切り戻しを一往復し、運用者が通知と復旧手順を確認します。
- 利用者が実際に行う操作を少なくとも1つ受け入れテストに追加し、認証・データの扱い・障害時の案内を実機で確認します。`/api/health.json` はAPI到達性の確認に使います。
- Firebase Hostingを実APIに切り替える際は、実サービスへのアクセス方式を決めます。`firebase.json` に `/api/**` からCloud Run `t062-api` へのrewriteを入れてあります。静的モックJSON（`public/api/health.json`）は静的ファイルが先に返るので、これを削除するまでは `/api/health.json` だけモックのままです。モックJSONの削除と、公開後チェックの `source: api` への変更をまとめます。`pinTag` を使う場合は、公開対象のCloud Runリビジョンを検証してからHostingをリリースし、画面とAPIを揃えて切り戻せることも確認します。
