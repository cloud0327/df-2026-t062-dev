# --- worker（Cloud Run）---
# api と同じイメージを別のコマンドで動かす。非公開（invoker IAM が必要）。
# 最初の作成はサンプルイメージなので、起動コマンド（node worker/index.ts）は Terraform では持たない。
# イメージ・コマンド・引数はリリースのワークフロー（scripts/release-cloud-run.sh worker）が毎回指定する。
resource "google_cloud_run_v2_service" "worker" {
  name                 = var.worker_service_name
  location             = var.region
  ingress              = "INGRESS_TRAFFIC_ALL" # 守っているのは IAM（tasks-invoker だけが run.invoker）
  invoker_iam_disabled = false
  deletion_protection  = true

  scaling {
    min_instance_count = 0
    max_instance_count = 2
  }

  template {
    service_account                  = google_service_account.worker.email
    timeout                          = "1800s"
    max_instance_request_concurrency = 2

    containers {
      image = var.bootstrap_image

      ports {
        container_port = 8080
      }

      resources {
        cpu_idle = true
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }

      dynamic "env" {
        for_each = local.worker_env

        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    # イメージ・起動コマンド・トラフィックはリリースのワークフローが持つ
    ignore_changes = [
      template[0].containers[0].image,
      template[0].containers[0].command,
      template[0].containers[0].args,
      traffic,
      client,
      client_version,
    ]
  }

  depends_on = [google_project_service.required]
}

# DB 移行（node db/migrate.ts）のジョブ。リリースのワークフローが新しいイメージを指定して実行する。
# api の実行用サービスアカウント（= DB ユーザー）で動く。
resource "google_cloud_run_v2_job" "migrate" {
  name                = var.migrate_job_name
  location            = var.region
  deletion_protection = true

  template {
    template {
      service_account = google_service_account.runtime.email
      timeout         = "600s"
      max_retries     = 0

      containers {
        image = var.bootstrap_image

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        dynamic "env" {
          for_each = local.migrate_env

          content {
            name  = env.key
            value = env.value
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].template[0].containers[0].image,
      template[0].template[0].containers[0].command,
      template[0].template[0].containers[0].args,
      client,
      client_version,
    ]
  }

  depends_on = [google_project_service.required]
}
