# --- Cloud Storage ---
# source: ブラウザから直接送る録音（api が再開できる送信を開始する）
# output: 保存した版から作った PDF
# work:   worker の作業用（30 日で消す）
# forms:  様式の元の PDF とページの画像（pdf/<元の PDF の sha256>/…）。api は読むだけで、画面には期限つきの URL で渡す。
#         入れるのは管理者（npm run forms:assets）。場所が中身のハッシュなので上書きは起きない

locals {
  buckets = {
    source = "${local.bucket_prefix}-source"
    output = "${local.bucket_prefix}-output"
    work   = "${local.bucket_prefix}-work"
    forms  = "${local.bucket_prefix}-forms"
  }
}

resource "google_storage_bucket" "source" {
  name                        = local.buckets.source
  location                    = local.bucket_location
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = false
  }

  # 録音の直接送信（resumable upload）のための CORS。画面の Origin だけを許す
  dynamic "cors" {
    for_each = length(var.app_origins) > 0 ? [1] : []

    content {
      origin          = var.app_origins
      method          = ["PUT", "POST", "GET", "OPTIONS"]
      response_header = ["Content-Type", "Content-Range", "x-goog-resumable", "Range"]
      max_age_seconds = 3600
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket" "output" {
  name                        = local.buckets.output
  location                    = local.bucket_location
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = false
  }

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket" "work" {
  name                        = local.buckets.work
  location                    = local.bucket_location
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = false
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }

    condition {
      age = 30
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket" "forms" {
  name                        = local.buckets.forms
  location                    = local.bucket_location
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = false
  }

  depends_on = [google_project_service.required]
}
