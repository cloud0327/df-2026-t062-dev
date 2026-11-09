# --- Firebase Authentication（Identity Platform）---
# メールとパスワードのログインだけを有効にする。画面からのアカウント作成は禁止（管理者が作る）。
# 初めて使うプロジェクトでは、Firebase コンソールで Authentication を一度「開始」しておくと確実。
resource "google_identity_platform_config" "auth" {
  authorized_domains = length(var.authorized_domains) > 0 ? var.authorized_domains : null

  sign_in {
    allow_duplicate_emails = false

    email {
      enabled           = true
      password_required = true
    }
  }

  client {
    permissions {
      disabled_user_signup = true
    }
  }

  depends_on = [google_project_service.required]
}
