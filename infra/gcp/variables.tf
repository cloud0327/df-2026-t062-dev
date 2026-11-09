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

# --- ここから: アプリ本体（DB・ストレージ・キュー・worker・認証） ---

variable "worker_service_name" {
  description = "Cloud Run worker サービス名。api と同じイメージを別のコマンドで動かす。"
  type        = string
  default     = "t062-worker"

  validation {
    condition     = can(regex("^[a-z]([a-z0-9-]{0,47}[a-z0-9])?$", var.worker_service_name))
    error_message = "Use a Cloud Run service name of up to 49 characters."
  }
}

variable "migrate_job_name" {
  description = "DB 移行（node db/migrate.ts）を流す Cloud Run ジョブ名。"
  type        = string
  default     = "t062-migrate"
}

variable "sql_instance_name" {
  description = "Cloud SQL インスタンス名。削除後 1 週間ほど同じ名前を再利用できない。"
  type        = string
  default     = "t062-db"
}

variable "sql_tier" {
  description = "Cloud SQL のマシンタイプ。共有コアの最小は db-f1-micro。"
  type        = string
  default     = "db-f1-micro"
}

variable "database_name" {
  description = "アプリが使うデータベース名（DB_NAME の既定値と同じ careman）。"
  type        = string
  default     = "careman"
}

variable "bucket_prefix" {
  description = "バケット名の前半。null のときは「<project_id>-t062」。バケット名は全世界で一意。"
  type        = string
  default     = null
}

variable "bucket_location" {
  description = "バケットのロケーション。null のときは region と同じ。"
  type        = string
  default     = null
}

variable "app_origins" {
  description = "ブラウザから録音を直接送る画面の Origin（例: https://<site>.web.app）。source バケットの CORS に入る。空だと CORS を付けない。"
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for o in var.app_origins : can(regex("^https?://[^/]+$", o))])
    error_message = "Use origins such as https://example.web.app (scheme and host, no trailing slash)."
  }
}

variable "firebase_project_id" {
  description = "Firebase Authentication のプロジェクト ID。null のときは project_id と同じ。"
  type        = string
  default     = null
}

variable "authorized_domains" {
  description = "Identity Platform の承認済みドメイン。空のときは Google の既定のまま触らない。指定するときは localhost と <project>.web.app などの既定分も含める。"
  type        = list(string)
  default     = []
}

variable "ai_provider" {
  description = "worker の AI_PROVIDER（vertex か fake）。"
  type        = string
  default     = "vertex"

  validation {
    condition     = contains(["vertex", "fake"], var.ai_provider)
    error_message = "Use vertex or fake."
  }
}

variable "gemini_model" {
  description = "worker の GEMINI_MODEL。東京で使える Gemini は 3.5 Flash だけなので、新しく安い 3.8 Flash を global で使う（2026-11-09）。"
  type        = string
  default     = "gemini-3.8-flash"
}

variable "gemini_location" {
  description = "worker の GEMINI_LOCATION（Vertex AI のロケーション）。3.8 Flash は global・us・eu だけ。"
  type        = string
  default     = "global"
}

variable "stt_location" {
  description = "worker の STT_LOCATION（Speech-to-Text のロケーション）。"
  type        = string
  default     = "asia-northeast1"
}

variable "worker_speech_role" {
  description = "worker に付ける Speech-to-Text のロール。認識器を worker が作る場合は roles/speech.editor にする。"
  type        = string
  default     = "roles/speech.client"
}

variable "reconcile_schedule" {
  description = "worker の /tasks/reconcile を呼ぶ cron（Asia/Tokyo）。"
  type        = string
  default     = "*/5 * * * *"
}

variable "billing_account_id" {
  description = "予算アラートを作る請求先アカウント ID（例: 012345-6789AB-CDEF01）。null のときは予算を作らない。"
  type        = string
  default     = null
}

variable "budget_amount_jpy" {
  description = "予算アラートの月額（円）。billing_account_id を指定したときだけ使う。"
  type        = number
  default     = 10000
}
