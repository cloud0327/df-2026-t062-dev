mock_provider "google" {
  mock_resource "google_iam_workload_identity_pool" {
    override_during = plan

    defaults = {
      name = "projects/123456789012/locations/global/workloadIdentityPools/github-actions"
    }
  }

  mock_data "google_project" {
    defaults = {
      number = "123456789012"
    }
  }
}

# モックのメールは全部同じ値になるので、サービスアカウントごとに決めておく
override_resource {
  target          = google_service_account.runtime
  override_during = plan
  values = {
    email = "cloud-run-api-runtime@mock-project.iam.gserviceaccount.com"
    name  = "projects/mock-project/serviceAccounts/cloud-run-api-runtime@mock-project.iam.gserviceaccount.com"
  }
}

override_resource {
  target          = google_service_account.worker
  override_during = plan
  values = {
    email = "cloud-run-worker-runtime@mock-project.iam.gserviceaccount.com"
    name  = "projects/mock-project/serviceAccounts/cloud-run-worker-runtime@mock-project.iam.gserviceaccount.com"
  }
}

override_resource {
  target          = google_service_account.tasks_invoker
  override_during = plan
  values = {
    email = "tasks-invoker@mock-project.iam.gserviceaccount.com"
    name  = "projects/mock-project/serviceAccounts/tasks-invoker@mock-project.iam.gserviceaccount.com"
  }
}

override_resource {
  target          = google_service_account.github_deploy
  override_during = plan
  values = {
    email = "github-api-deploy@mock-project.iam.gserviceaccount.com"
    name  = "projects/mock-project/serviceAccounts/github-api-deploy@mock-project.iam.gserviceaccount.com"
  }
}

run "private_service_with_scoped_deployer" {
  command = plan

  variables {
    project_id                 = "mock-project"
    github_repository_id       = "1447301909"
    github_repository_owner_id = "234936919"
  }

  assert {
    condition = google_iam_workload_identity_pool_provider.github.attribute_condition == join(" && ", [
      "assertion.repository_id == '1447301909'",
      "assertion.repository_owner_id == '234936919'",
      "assertion.ref == 'refs/heads/main'",
      "assertion.event_name == 'workflow_dispatch'",
      "assertion.workflow_ref == assertion.repository + '/.github/workflows/cloud-run.yml@refs/heads/main'",
      "assertion.environment == 'cloud-run'",
    ])
    error_message = "WIF must restrict GitHub access to the configured repository, owner and main events."
  }

  assert {
    condition     = google_service_account_iam_member.github_impersonates_deployer.member == "principalSet://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/github-actions/attribute.repository_id/1447301909"
    error_message = "Only the configured repository principal set may impersonate the deployer."
  }

  assert {
    condition = (
      google_cloud_run_v2_service.api.invoker_iam_disabled &&
      google_cloud_run_v2_service.api.scaling[0].min_instance_count == 0 &&
      google_cloud_run_v2_service.api.template[0].containers[0].resources[0].cpu_idle &&
      google_cloud_run_v2_service.api.template[0].containers[0].resources[0].limits["memory"] == "1Gi" &&
      google_cloud_run_v2_service.api.template[0].timeout == "900s" &&
      google_cloud_run_v2_service.api.deletion_protection
    )
    error_message = "The API is public (the app verifies Firebase ID tokens itself) with request-based billing, zero minimum instances, 1Gi and a 900s timeout."
  }

  assert {
    condition = (
      !google_cloud_run_v2_service.worker.invoker_iam_disabled &&
      google_cloud_run_v2_service.worker.template[0].timeout == "1800s" &&
      google_cloud_run_v2_service.worker.scaling[0].min_instance_count == 0 &&
      google_cloud_run_v2_service.worker.scaling[0].max_instance_count == 2 &&
      google_cloud_run_v2_service.worker.template[0].service_account == "cloud-run-worker-runtime@mock-project.iam.gserviceaccount.com" &&
      google_cloud_run_v2_service.worker.deletion_protection
    )
    error_message = "The worker must require IAM, run as its own service account, and allow 1800s requests with 0 to 2 instances."
  }

  assert {
    condition = (
      google_cloud_run_v2_service_iam_member.tasks_invoker_calls_worker.role == "roles/run.invoker" &&
      google_cloud_run_v2_service_iam_member.tasks_invoker_calls_worker.member == "serviceAccount:tasks-invoker@mock-project.iam.gserviceaccount.com"
    )
    error_message = "The Cloud Tasks and Scheduler identity may invoke the worker."
  }

  assert {
    condition = (
      google_cloud_run_v2_service_iam_member.deployer_invokes_worker.role == "roles/run.invoker" &&
      google_cloud_run_v2_service_iam_member.deployer_invokes_worker.member == "serviceAccount:github-api-deploy@mock-project.iam.gserviceaccount.com"
    )
    error_message = "The GitHub deployer must invoke the private worker to verify its health after deployment."
  }

  assert {
    condition = (
      toset([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.name]) == toset([
        "AUTH_MODE", "FIREBASE_PROJECT_ID", "STORAGE_MODE", "GCS_SOURCE_BUCKET", "GCS_OUTPUT_BUCKET", "GCS_WORK_BUCKET", "GCS_FORMS_BUCKET",
        "QUEUE_MODE", "TASKS_QUEUE", "WORKER_URL", "TASKS_INVOKER_SA", "CLOUD_SQL_INSTANCE", "DB_USER", "DB_NAME",
      ]) &&
      local.api_env["AUTH_MODE"] == "firebase" &&
      local.api_env["WORKER_URL"] == "https://t062-worker-123456789012.asia-northeast1.run.app" &&
      local.api_env["DB_USER"] == "cloud-run-api-runtime@mock-project.iam"
    )
    error_message = "The API environment must carry the variables the code reads."
  }

  assert {
    condition = (
      local.worker_env["WORKER_URL"] == local.api_env["WORKER_URL"] &&
      local.worker_env["DB_USER"] == "cloud-run-worker-runtime@mock-project.iam" &&
      local.worker_env["AI_PROVIDER"] == "vertex"
    )
    error_message = "The worker environment must use its own DB user and the same worker URL."
  }

  assert {
    condition = (
      google_sql_database_instance.main.database_version == "POSTGRES_17" &&
      google_sql_database_instance.main.deletion_protection &&
      google_sql_database_instance.main.settings[0].edition == "ENTERPRISE" &&
      google_sql_database_instance.main.settings[0].tier == "db-f1-micro" &&
      google_sql_database_instance.main.settings[0].backup_configuration[0].enabled &&
      google_sql_database_instance.main.settings[0].backup_configuration[0].point_in_time_recovery_enabled &&
      one([for f in google_sql_database_instance.main.settings[0].database_flags : f.value if f.name == "cloudsql.iam_authentication"]) == "on" &&
      google_sql_database.app.name == "careman"
    )
    error_message = "Cloud SQL must be PostgreSQL 17 Enterprise db-f1-micro with backups, PITR, deletion protection and IAM authentication."
  }

  assert {
    condition = (
      google_sql_user.api.type == "CLOUD_IAM_SERVICE_ACCOUNT" &&
      google_sql_user.api.name == "cloud-run-api-runtime@mock-project.iam" &&
      google_sql_user.worker.type == "CLOUD_IAM_SERVICE_ACCOUNT" &&
      google_sql_user.worker.name == "cloud-run-worker-runtime@mock-project.iam"
    )
    error_message = "The API and worker must be IAM database users without passwords."
  }

  assert {
    condition = alltrue([
      for b in [google_storage_bucket.source, google_storage_bucket.output, google_storage_bucket.work, google_storage_bucket.forms] :
      b.uniform_bucket_level_access && b.public_access_prevention == "enforced" && !b.versioning[0].enabled
    ])
    error_message = "Buckets must use uniform access, enforced public access prevention and no versioning."
  }

  assert {
    condition     = one([for c in google_storage_bucket.work.lifecycle_rule[0].condition : c.age]) == 30 && one([for a in google_storage_bucket.work.lifecycle_rule[0].action : a.type]) == "Delete"
    error_message = "The work bucket must delete objects after 30 days."
  }

  assert {
    condition     = length(google_storage_bucket.source.cors) == 0
    error_message = "Without app_origins the source bucket has no CORS rule."
  }

  assert {
    condition = (
      google_storage_bucket.forms.name == "mock-project-t062-forms" &&
      length(google_storage_bucket.forms.cors) == 0 &&
      length(google_storage_bucket.forms.lifecycle_rule) == 0 &&
      !contains([for e in google_cloud_run_v2_service.worker.template[0].containers[0].env : e.name], "GCS_FORMS_BUCKET")
    )
    error_message = "The forms bucket keeps form PDFs and page images with no CORS or expiry, and only the API reads it."
  }

  assert {
    condition = (
      google_cloud_tasks_queue.jobs.rate_limits[0].max_concurrent_dispatches == 3 &&
      google_cloud_tasks_queue.jobs.retry_config[0].max_attempts == 5
    )
    error_message = "The queue must allow 3 concurrent dispatches and 5 attempts."
  }

  assert {
    condition = (
      google_cloud_scheduler_job.reconcile.schedule == "*/5 * * * *" &&
      google_cloud_scheduler_job.reconcile.http_target[0].http_method == "POST" &&
      google_cloud_scheduler_job.reconcile.http_target[0].uri == "https://t062-worker-123456789012.asia-northeast1.run.app/tasks/reconcile" &&
      google_cloud_scheduler_job.reconcile.http_target[0].oidc_token[0].audience == "https://t062-worker-123456789012.asia-northeast1.run.app" &&
      google_cloud_scheduler_job.reconcile.http_target[0].oidc_token[0].service_account_email == "tasks-invoker@mock-project.iam.gserviceaccount.com"
    )
    error_message = "Scheduler must POST to the worker reconcile endpoint with the tasks-invoker OIDC token."
  }

  assert {
    condition = (
      google_identity_platform_config.auth.sign_in[0].email[0].enabled &&
      google_identity_platform_config.auth.client[0].permissions[0].disabled_user_signup
    )
    error_message = "Identity Platform must allow email sign-in and forbid self sign-up."
  }

  assert {
    condition = (
      google_service_account_iam_member.api_signs_as_itself.role == "roles/iam.serviceAccountTokenCreator" &&
      google_service_account_iam_member.api_acts_as_tasks_invoker.role == "roles/iam.serviceAccountUser" &&
      google_cloud_tasks_queue_iam_member.api_enqueues.role == "roles/cloudtasks.enqueuer" &&
      google_storage_bucket_iam_member.api_source.role == "roles/storage.objectAdmin" &&
      google_storage_bucket_iam_member.api_output.role == "roles/storage.objectAdmin" &&
      google_storage_bucket_iam_member.api_forms.role == "roles/storage.objectViewer" &&
      google_storage_bucket_iam_member.worker_source.role == "roles/storage.objectViewer" &&
      google_storage_bucket_iam_member.worker_work.role == "roles/storage.objectAdmin" &&
      google_project_iam_member.worker_vertex.role == "roles/aiplatform.user" &&
      google_project_iam_member.worker_speech.role == "roles/speech.client"
    )
    error_message = "Runtime roles must stay as scoped as designed."
  }

  assert {
    condition     = length(google_billing_budget.monthly) == 0
    error_message = "No budget is created without billing_account_id."
  }
}

run "source_bucket_cors_and_budget" {
  command = plan

  variables {
    project_id                 = "mock-project"
    github_repository_id       = "1447301909"
    github_repository_owner_id = "234936919"
    app_origins                = ["https://mock-project.web.app", "http://localhost:5173"]
    billing_account_id         = "012345-6789AB-CDEF01"
  }

  assert {
    condition = (
      length(google_storage_bucket.source.cors) == 1 &&
      toset(google_storage_bucket.source.cors[0].origin) == toset(["https://mock-project.web.app", "http://localhost:5173"]) &&
      toset(google_storage_bucket.source.cors[0].method) == toset(["PUT", "POST", "GET", "OPTIONS"]) &&
      toset(google_storage_bucket.source.cors[0].response_header) == toset(["Content-Type", "Content-Range", "x-goog-resumable", "Range"]) &&
      google_storage_bucket.source.cors[0].max_age_seconds == 3600
    )
    error_message = "The source bucket must allow resumable uploads from the app origins."
  }

  assert {
    condition     = length(google_billing_budget.monthly) == 1
    error_message = "A budget is created when billing_account_id is set."
  }
}
