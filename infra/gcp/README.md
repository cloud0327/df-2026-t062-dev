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

1. 対象プロジェクトと請求先を確定し、課金が有効であることを確認します。将来Firebase Hostingのrewriteでつなぐ場合は、HostingとCloud Runを同じFirebaseプロジェクトに置きます。既存の同名リソースがある場合は、管理者がTerraformへのインポートか別名での作成を判断します。
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

Cloud Runは初回作成時にイメージが必要なので、Google Cloudのサンプルイメージを使って認証必須のサービスを作成します。リクエスト課金、最小0・最大2インスタンスで開始し、実行サービスアカウントにはプロジェクトロールを付与しません。インスタンス数の上限と請求額の上限は別です。

GitHubのデプロイ用サービスアカウントには、対象のArtifact RegistryにWriter、対象のCloud RunサービスにDeveloper、実行用サービスアカウントにService Account Userを付与します。Cloud Run Developerはサービスの設定も更新できる権限です。WIFで認証できるワークフローを限定し、Terraformとリリースで管理範囲を分けます。

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

3. リポジトリ変数 `CLOUD_RUN_ENABLED=true` を設定します。最新の `main` で `Verify` が成功したら、GitHub Actionsの **Release Cloud Run** を `main` で手動実行します。WIFは、登録済みのリポジトリIDと所有者ID、`main`、このワークフロー、`cloud-run` Environmentの組み合わせに限定します。

公開ワークフローはPR #2と同じ `linux/amd64` ビルドとAPIスモークテストを使います。検証したイメージをArtifact Registryにpushし、ダイジェストを指定して候補リビジョンを作ります。認証付きで候補を検証してから100%のトラフィックを切り替え、切り替え後も実APIを検証します。切り替え後に失敗した場合は直前のリビジョンへ戻します。

Terraformはサービス設定、スケーリング、IAMを管理します。初回作成後のイメージとトラフィックはリリースワークフローが管理します。Terraformの適用とアプリのリリースは重ねず、初回公開後にTerraformのプランでイメージやトラフィックの巻き戻しがないことを確認します。

## 障害対応と一般公開

- 障害時はActionsのジョブログで直前のリビジョン名を確認し、必要に応じて下のコマンドで戻します。途中でジョブをキャンセルした場合はCloud Runのリビジョンと配分を確認します。初回の戻し先は認証必須のサンプルリビジョンです。

  ```sh
  gcloud run services update-traffic "$SERVICE_NAME" --project "$PROJECT_ID" --region "$REGION" \
    --to-revisions "$PREVIOUS_REVISION=100"
  ```

- 一般公開前に、責任者と通知先を決め、Cloud Monitoringでエラー率と応答時間、Cloud Billingで予算通知を設定します。初回は認証付きの実環境で公開・切り戻しを一往復し、運用者が通知と復旧手順を確認します。
- 利用者が実際に行う操作を少なくとも1つ受け入れテストに追加し、認証・データの扱い・障害時の案内を実機で確認します。`/api/health.json` はAPI到達性の確認に使います。
- Firebase Hostingを実APIに切り替える際は、実サービスへのアクセス方式を決めます。静的モックJSONの削除、Cloud Run rewriteの追加、公開後チェックの `source: api` への変更をまとめます。`pinTag` を使う場合は、公開対象のCloud Runリビジョンを検証してからHostingをリリースし、画面とAPIを揃えて切り戻せることも確認します。
