resource "google_project_service" "required" {
  for_each = toset([
    "aiplatform.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "cloudtasks.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "identitytoolkit.googleapis.com",
    "run.googleapis.com",
    "speech.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
    "sts.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "github_deploy" {
  account_id   = "github-api-deploy"
  display_name = "GitHub Actions API deployer"

  depends_on = [google_project_service.required]
}

resource "google_service_account" "runtime" {
  account_id   = "cloud-run-api-runtime"
  display_name = "Cloud Run API runtime"

  depends_on = [google_project_service.required]
}

# worker（Cloud Run）の実行用。Cloud SQL・バケット・Vertex AI・Speech-to-Text だけを使う。
resource "google_service_account" "worker" {
  account_id   = "cloud-run-worker-runtime"
  display_name = "Cloud Run worker runtime"

  depends_on = [google_project_service.required]
}

# Cloud Tasks と Cloud Scheduler が worker を呼ぶときの OIDC の身元。worker の run.invoker だけを持つ。
resource "google_service_account" "tasks_invoker" {
  account_id   = "tasks-invoker"
  display_name = "Cloud Tasks and Scheduler invoker"

  depends_on = [google_project_service.required]
}

resource "google_artifact_registry_repository" "api" {
  location      = var.region
  repository_id = var.service_name
  description   = "API and worker container images"
  format        = "DOCKER"

  depends_on = [google_project_service.required]
}

# api は誰でも呼べる（invoker_iam_disabled）。ログインの確認はアプリが Firebase の ID トークンで行う。
resource "google_cloud_run_v2_service" "api" {
  name                 = var.service_name
  location             = var.region
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = true
  deletion_protection  = true

  scaling {
    min_instance_count = 0
    max_instance_count = 2
  }

  template {
    service_account = google_service_account.runtime.email
    timeout         = "900s"

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
        for_each = local.api_env

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
    # After bootstrap, the release workflow owns the image and revision traffic.
    ignore_changes = [template[0].containers[0].image, traffic, client, client_version]
  }

  depends_on = [google_project_service.required]
}
