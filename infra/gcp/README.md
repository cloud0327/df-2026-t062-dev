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

GitHubのデプロイ用サービスアカウントには、対象のArtifact RegistryにWriter、対象のCloud RunサービスにDeveloper、実行用サービスアカウントにService Account Userを付与します。イメージだけを更新する運用はデプロイコマンドで守ります。Cloud Run Developerはサービスのイメージ以外の設定も更新できる権限です。

## APIデプロイを接続する

- 将来のAPIデプロイジョブで `google-github-actions/auth` を使い、Terraformの `workload_identity_provider` と `deploy_service_account` を渡します。`id-token: write` はそのジョブに限定します。WIFが受け入れるのは、設定した所有者ID・リポジトリIDの `main` からの `push` と `workflow_dispatch` です。
- PR #2の `linux/amd64` ビルドと `/api/health.json` のスモークテストを再利用します。検証した同じイメージを出力先のArtifact Registryへpushし、push後のダイジェストを指定して既存のCloud Runサービスを更新します。

  ```sh
  gcloud run services update "$SERVICE_NAME" --project "$PROJECT_ID" --region "$REGION" \
    --image "$IMAGE_BY_DIGEST"
  ```

- Terraformがサービス設定、スケーリング、トラフィック方針、IAMを管理します。Actionsはイメージだけを更新します。Terraformの `ignore_changes` はイメージとデプロイクライアントのメタデータに限定しています。Terraform適用とアプリ公開は重ねず、初回公開後にTerraformのプランで初期イメージへの差し戻しがないことを確認します。
- Cloud Run側で実APIの動作を確認してから、Firebase Hostingを切り替えます。公開呼び出しを許可するか判断し、必要な権限をTerraform側で変更します。Hostingでは静的モックJSONの削除、Cloud Run rewriteの追加、公開後チェックを `source: api` に変更する作業をまとめて行います。既存の `Verify` → `Deploy Hosting` にCloud Runのデプロイ依存を追加するのは、この切り替え時に判断します。
