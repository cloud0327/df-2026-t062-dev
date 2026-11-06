output "workload_identity_provider" {
  description = "Full provider name for google-github-actions/auth."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deploy_service_account" {
  description = "Service account email for google-github-actions/auth."
  value       = google_service_account.github_deploy.email
}

output "artifact_registry_repository" {
  description = "Docker repository path. Append /IMAGE:TAG when pushing."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.api.repository_id}"
}

output "cloud_run_url" {
  description = "IAM-protected Cloud Run service URL."
  value       = google_cloud_run_v2_service.api.uri
}
