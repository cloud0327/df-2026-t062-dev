# --- Cloud SQL（PostgreSQL 17）---
# 接続は Cloud SQL Connector（IAM 認証）。VPC もパスワードも使わない。
# 公開 IP は付くが、承認済みネットワークは空で、IAM 認証と TLS のない接続は受けない。

resource "google_sql_database_instance" "main" {
  name             = var.sql_instance_name
  region           = var.region
  database_version = "POSTGRES_17"

  # Terraform からも、Google Cloud 側でも消せないようにする
  deletion_protection = true

  settings {
    edition           = "ENTERPRISE"
    tier              = var.sql_tier
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = 10
    disk_autoresize   = true

    deletion_protection_enabled = true

    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "18:00" # 日本時間 03:00（UTC で指定する）
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 7
      }
    }

    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }

    maintenance_window {
      day          = 7  # 日曜
      hour         = 19 # 日本時間 月曜 04:00
      update_track = "stable"
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_sql_database" "app" {
  name     = var.database_name
  instance = google_sql_database_instance.main.name
}

# IAM 認証の DB ユーザー（パスワードなし）。ユーザー名は ".gserviceaccount.com" を除いたメール。
resource "google_sql_user" "api" {
  instance = google_sql_database_instance.main.name
  name     = local.api_db_user
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"
}

resource "google_sql_user" "worker" {
  instance = google_sql_database_instance.main.name
  name     = local.worker_db_user
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"
}
