data "google_project" "this" {
  project_id = var.project_id
}

locals {
  bucket_prefix   = coalesce(var.bucket_prefix, "${var.project_id}-t062")
  bucket_location = coalesce(var.bucket_location, var.region)

  firebase_project_id = coalesce(var.firebase_project_id, var.project_id)

  # worker の URL は「サービス名-プロジェクト番号.リージョン.run.app」と決まっている。
  # worker 自身の環境変数（WORKER_URL）に自分の uri は入れられない（循環する）ので、この形で組み立てる。
  # 実際の URL との一致は apply 後に `terraform output worker_url` と `worker_uri` で確かめる。
  worker_url = "https://${var.worker_service_name}-${data.google_project.this.number}.${var.region}.run.app"

  # IAM 認証の DB ユーザー名は、サービスアカウントのメールから ".gserviceaccount.com" を除いたもの。
  api_db_user    = trimsuffix(google_service_account.runtime.email, ".gserviceaccount.com")
  worker_db_user = trimsuffix(google_service_account.worker.email, ".gserviceaccount.com")

  api_env = {
    AUTH_MODE           = "firebase"
    FIREBASE_PROJECT_ID = local.firebase_project_id
    STORAGE_MODE        = "gcs"
    GCS_SOURCE_BUCKET   = google_storage_bucket.source.name
    GCS_OUTPUT_BUCKET   = google_storage_bucket.output.name
    GCS_WORK_BUCKET     = google_storage_bucket.work.name
    GCS_FORMS_BUCKET    = google_storage_bucket.forms.name
    QUEUE_MODE          = "tasks"
    TASKS_QUEUE         = google_cloud_tasks_queue.jobs.id
    WORKER_URL          = local.worker_url
    TASKS_INVOKER_SA    = google_service_account.tasks_invoker.email
    CLOUD_SQL_INSTANCE  = google_sql_database_instance.main.connection_name
    DB_USER             = local.api_db_user
    DB_NAME             = google_sql_database.app.name
  }

  worker_env = {
    AI_PROVIDER          = var.ai_provider
    GOOGLE_CLOUD_PROJECT = var.project_id
    GEMINI_MODEL         = var.gemini_model
    GEMINI_LOCATION      = var.gemini_location
    STT_LOCATION         = var.stt_location
    STORAGE_MODE         = "gcs"
    GCS_SOURCE_BUCKET    = google_storage_bucket.source.name
    GCS_OUTPUT_BUCKET    = google_storage_bucket.output.name
    GCS_WORK_BUCKET      = google_storage_bucket.work.name
    QUEUE_MODE           = "tasks"
    TASKS_QUEUE          = google_cloud_tasks_queue.jobs.id
    WORKER_URL           = local.worker_url
    TASKS_INVOKER_SA     = google_service_account.tasks_invoker.email
    CLOUD_SQL_INSTANCE   = google_sql_database_instance.main.connection_name
    DB_USER              = local.worker_db_user
    DB_NAME              = google_sql_database.app.name
  }

  # DB 移行のジョブは api の実行用サービスアカウント（= DB ユーザー）で動く
  migrate_env = {
    CLOUD_SQL_INSTANCE = google_sql_database_instance.main.connection_name
    DB_USER            = local.api_db_user
    DB_NAME            = google_sql_database.app.name
  }
}
