resource "google_project_service" "required" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "run.googleapis.com",
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

resource "google_artifact_registry_repository" "api" {
  location      = var.region
  repository_id = var.service_name
  description   = "API container images"
  format        = "DOCKER"

  depends_on = [google_project_service.required]
}

resource "google_cloud_run_v2_service" "api" {
  name                 = var.service_name
  location             = var.region
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = false
  deletion_protection  = true

  scaling {
    min_instance_count = 0
    max_instance_count = 2
  }

  template {
    service_account = google_service_account.runtime.email

    containers {
      image = var.bootstrap_image

      ports {
        container_port = 8080
      }

      resources {
        cpu_idle = true
        limits = {
          cpu    = "1"
          memory = "512Mi"
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
