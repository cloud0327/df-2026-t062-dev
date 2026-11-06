variable "project_id" {
  description = "ID of the existing, billing-enabled Google Cloud project."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "Use a Google Cloud project ID with 6 to 30 characters."
  }
}

variable "region" {
  description = "Region shared by Artifact Registry and Cloud Run."
  type        = string
  default     = "asia-northeast1"
}

variable "service_name" {
  description = "Cloud Run service name and Artifact Registry repository ID."
  type        = string
  default     = "t062-api"

  validation {
    condition     = can(regex("^[a-z]([a-z0-9-]{0,47}[a-z0-9])?$", var.service_name))
    error_message = "Use a Cloud Run service name of up to 49 characters."
  }
}

variable "github_repository_id" {
  description = "Numeric GitHub ID of the repository permitted to deploy."
  type        = string

  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.github_repository_id))
    error_message = "Supply the numeric GitHub repository ID as a string."
  }
}

variable "github_repository_owner_id" {
  description = "Numeric GitHub ID of the repository owner permitted to deploy."
  type        = string

  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.github_repository_owner_id))
    error_message = "Supply the numeric GitHub repository owner ID as a string."
  }
}

variable "bootstrap_image" {
  description = "Initial container used when creating the private Cloud Run service."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}
