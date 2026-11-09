resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"

  depends_on = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub Actions OIDC"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }

  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.ref"                 = "assertion.ref"
    "attribute.event_name"          = "assertion.event_name"
    "attribute.repository"          = "assertion.repository"
    "attribute.workflow_ref"        = "assertion.workflow_ref"
    "attribute.environment"         = "assertion.environment"
  }

  attribute_condition = join(" && ", [
    "assertion.repository_id == '${var.github_repository_id}'",
    "assertion.repository_owner_id == '${var.github_repository_owner_id}'",
    "assertion.ref == 'refs/heads/main'",
    "assertion.event_name == 'workflow_dispatch'",
    "assertion.workflow_ref == assertion.repository + '/.github/workflows/cloud-run.yml@refs/heads/main'",
    "assertion.environment == 'cloud-run'",
  ])
}

resource "google_service_account_iam_member" "github_impersonates_deployer" {
  service_account_id = google_service_account.github_deploy.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository_id/${var.github_repository_id}"
}

resource "google_artifact_registry_repository_iam_member" "deployer_pushes_images" {
  location   = google_artifact_registry_repository.api.location
  repository = google_artifact_registry_repository.api.repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.github_deploy.email}"
}

resource "google_cloud_run_v2_service_iam_member" "deployer_updates_service" {
  location = google_cloud_run_v2_service.api.location
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.github_deploy.email}"
}

resource "google_service_account_iam_member" "deployer_uses_runtime" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.github_deploy.email}"
}

# --- デプロイ用サービスアカウント: worker と DB 移行ジョブにも同じ範囲で付ける ---

resource "google_cloud_run_v2_service_iam_member" "deployer_updates_worker" {
  location = google_cloud_run_v2_service.worker.location
  name     = google_cloud_run_v2_service.worker.name
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.github_deploy.email}"
}

# Release verification calls /healthz on the new private worker revision.
resource "google_cloud_run_v2_service_iam_member" "deployer_invokes_worker" {
  location = google_cloud_run_v2_service.worker.location
  name     = google_cloud_run_v2_service.worker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.github_deploy.email}"
}

resource "google_cloud_run_v2_job_iam_member" "deployer_runs_migrate" {
  location = google_cloud_run_v2_job.migrate.location
  name     = google_cloud_run_v2_job.migrate.name
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.github_deploy.email}"
}

resource "google_service_account_iam_member" "deployer_uses_worker_runtime" {
  service_account_id = google_service_account.worker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.github_deploy.email}"
}

# --- api の実行用サービスアカウント ---

# Cloud SQL に接続する（Connector）。両方ともプロジェクト単位のロールで、インスタンス単位には絞れない
resource "google_project_iam_member" "api_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "api_sql_instance_user" {
  project = var.project_id
  role    = "roles/cloudsql.instanceUser"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_storage_bucket_iam_member" "api_source" {
  bucket = google_storage_bucket.source.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_storage_bucket_iam_member" "api_output" {
  bucket = google_storage_bucket.output.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.runtime.email}"
}

# 様式の元の PDF とページの画像は読むだけ（PDF を作る・画像の期限つきの URL を渡す）
resource "google_storage_bucket_iam_member" "api_forms" {
  bucket = google_storage_bucket.forms.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.runtime.email}"
}

# 録音の送信 URL・様式の画像の期限つきの URL の署名（自分自身の鍵で署名する）
resource "google_service_account_iam_member" "api_signs_as_itself" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_cloud_tasks_queue_iam_member" "api_enqueues" {
  name     = google_cloud_tasks_queue.jobs.name
  location = google_cloud_tasks_queue.jobs.location
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${google_service_account.runtime.email}"
}

# タスクに tasks-invoker の OIDC を付けるには、積む側がその身元として振る舞える権限が要る
resource "google_service_account_iam_member" "api_acts_as_tasks_invoker" {
  service_account_id = google_service_account.tasks_invoker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.runtime.email}"
}

# --- worker の実行用サービスアカウント ---

resource "google_project_iam_member" "worker_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "worker_sql_instance_user" {
  project = var.project_id
  role    = "roles/cloudsql.instanceUser"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_storage_bucket_iam_member" "worker_source" {
  bucket = google_storage_bucket.source.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_storage_bucket_iam_member" "worker_work" {
  bucket = google_storage_bucket.work.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "worker_vertex" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "worker_speech" {
  project = var.project_id
  role    = var.worker_speech_role
  member  = "serviceAccount:${google_service_account.worker.email}"
}

# reconcile が取りこぼしたジョブを積み直す
resource "google_cloud_tasks_queue_iam_member" "worker_enqueues" {
  name     = google_cloud_tasks_queue.jobs.name
  location = google_cloud_tasks_queue.jobs.location
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${google_service_account.worker.email}"
}

# worker が積み直すときも tasks-invoker の OIDC を付ける
resource "google_service_account_iam_member" "worker_acts_as_tasks_invoker" {
  service_account_id = google_service_account.tasks_invoker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.worker.email}"
}

# --- tasks-invoker: worker を呼ぶことだけができる ---

resource "google_cloud_run_v2_service_iam_member" "tasks_invoker_calls_worker" {
  location = google_cloud_run_v2_service.worker.location
  name     = google_cloud_run_v2_service.worker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.tasks_invoker.email}"
}
