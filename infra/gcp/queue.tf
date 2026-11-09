# --- Cloud Tasks と Cloud Scheduler ---

# api が録音の処理を積むキュー。worker の /tasks/jobs/<id>/run を OIDC つきで呼ぶ
resource "google_cloud_tasks_queue" "jobs" {
  name     = "t062-jobs"
  location = var.region

  rate_limits {
    max_concurrent_dispatches = 3
    max_dispatches_per_second = 5
  }

  retry_config {
    max_attempts       = 5
    min_backoff        = "10s"
    max_backoff        = "300s"
    max_doublings      = 4
    max_retry_duration = "0s" # 時間では打ち切らず、回数（max_attempts）だけで止める
  }

  depends_on = [google_project_service.required]
}

# 取りこぼしたジョブを拾い直す定期呼び出し。worker の URL に tasks-invoker の OIDC で POST する
resource "google_cloud_scheduler_job" "reconcile" {
  name             = "t062-reconcile"
  region           = var.region
  description      = "worker の /tasks/reconcile を定期的に呼ぶ"
  schedule         = var.reconcile_schedule
  time_zone        = "Asia/Tokyo"
  attempt_deadline = "180s"

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = "${local.worker_url}/tasks/reconcile"

    oidc_token {
      service_account_email = google_service_account.tasks_invoker.email
      audience              = local.worker_url
    }
  }

  depends_on = [google_project_service.required]
}
