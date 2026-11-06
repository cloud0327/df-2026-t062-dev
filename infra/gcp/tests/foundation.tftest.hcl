mock_provider "google" {
  mock_resource "google_iam_workload_identity_pool" {
    override_during = plan

    defaults = {
      name = "projects/123456789012/locations/global/workloadIdentityPools/github-actions"
    }
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
      !google_cloud_run_v2_service.api.invoker_iam_disabled &&
      google_cloud_run_v2_service.api.scaling[0].min_instance_count == 0 &&
      google_cloud_run_v2_service.api.template[0].containers[0].resources[0].cpu_idle
    )
    error_message = "The initial Cloud Run service must require IAM and use request-based billing with zero minimum instances."
  }
}
