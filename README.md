# DevFest Hackathon 2026 チーム062

CI/CDを確認するためのWebアプリです。ローカルではNode.js API、公開サイトでは模擬応答のJSONを使います。

[デモサイトを開く](https://df-2026-t062-demo-327.web.app)

## ローカル開発

Node.jsは `.nvmrc` のバージョンを使います。初回に `npm ci` を実行します。

```sh
npm run dev:api  # ターミナル1
npm run dev      # ターミナル2
```

Viteが表示するURLを開くと「実API」と表示されます。`npm run build` の後に `npm run preview` を実行すると、公開版と同じ「模擬応答」を確認できます。

```sh
npm run typecheck
npm test
npm run build
```

## Docker API（Google Cloud接続前の検証）

Google Cloudの請求先と認証設定が決まるまでは、Cloud Runへの公開を保留します。
その間もAPIのコンテナ化とCIの動作確認は進められます。今のFirebase Hostingでは引き続き模擬応答を配信します。

Dockerが利用できる環境では、次のコマンドでAPIコンテナを確認できます。

```sh
docker build -t t062-api:local .
docker run --rm -e PORT=8080 -p 127.0.0.1:8787:8080 t062-api:local
# 別ターミナルから
curl http://127.0.0.1:8787/api/health.json
# {"status":"ok","source":"api"}
```

PRでもGitHub Actionsの`Verify`がDockerイメージをビルドして同じAPI応答を検証します。
Google Cloudへの認証・Artifact Registryへのpush・Cloud Runデプロイは実行しません。

請求先が確定した後はWorkload Identity Federation（WIF）でGitHub Actionsを接続し、
検証済みイメージをArtifact Registryに送ってCloud Runに公開します。その後で
Firebase Hostingのrewriteと公開後の検証を実API向けに変更します。

Terraformの検証と請求先確定後の手順は [Google Cloudの初期構築](infra/gcp/README.md) を参照してください。

## CI/CD

PRと `main` で型チェック、APIテスト、ビルドを実行します。公開ジョブは検証済みの `dist/` を使い、公開先の画面・模擬応答・コミットSHAを確認します。接続後はGitHubの `hosting-live` Environmentに公開URLが表示されます。

### 初回接続

1. Firebase Sparkプロジェクトを作り、デフォルトのHostingサイトを作成します。
2. Firebaseプロジェクトにデプロイ専用サービスアカウントを作り、`roles/firebasehosting.admin` と `roles/serviceusage.apiKeysViewer` を付与します。
3. GitHubの `hosting-live` Environmentを作り、デプロイできるブランチを `main` に限定します。同じEnvironmentに変数 `FIREBASE_PROJECT_ID` と `FIREBASE_HOSTING_URL`（末尾スラッシュなしの `https://<site-id>.web.app`）、Secret `FIREBASE_SERVICE_ACCOUNT`（JSON鍵）を登録します。鍵はGitHub Secretに直接渡し、作業用の鍵ファイルを削除します。
4. `Verify` が初回に完了したら、`main` にPRと `Verify` の成功を要求する保護を設定します。リポジトリ変数 `HOSTING_ENABLED=true` を設定し、PRのマージまたは `main` の `CI/CD` の手動実行で初回公開を確認します。

### 切り戻し

Firebase Consoleの **Hosting → リリース履歴** で、動作確認済みのリリースを選んでロールバックします。公開URLの `/version.json` が意図したSHAに戻ったことを確認します。原因を修正するPRを `main` にマージすると自動公開が再開します。

## 実APIの実機検証と最終提出

スマホから実APIを呼ぶ段階で、Blazeに移行します。APIをDockerでビルドし、Artifact RegistryのイメージをCloud Run（`asia-northeast1`、リクエスト課金、最小インスタンス0）で起動します。Cloud Runでは `HOST=0.0.0.0` とサービスの `PORT` を使用します。静的な `public/api/health.json` を取り除き、Firebase Hostingのrewriteで同じパスを転送します。その切り替えに合わせ、公開後の確認も実APIの応答を期待するよう更新します。

作品が完成したら、公開確認済みのコミットからソース、資料、再現用の設定を取り出します。公開URLと開発元のSHAを添えて、[運営の提出用リポジトリ](https://github.com/Devfest-Hackathon-2026/df-2026-t062)に提出用PRを作ります。提出物に秘密情報や開発履歴が含まれていないことを確認します。
