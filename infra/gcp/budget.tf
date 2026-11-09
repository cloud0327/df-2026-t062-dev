# 予算アラート（任意）。billing_account_id を指定したときだけ作る。
# 請求先アカウントの Billing Account Costs Manager など、予算を作れる権限が要る。
# ユーザーの Application Default Credentials で作る場合は、`gcloud auth application-default set-quota-project` か
# 環境変数 GOOGLE_BILLING_PROJECT と USER_PROJECT_OVERRIDE=true が要ることがある。
resource "google_billing_budget" "monthly" {
  count = var.billing_account_id == null ? 0 : 1

  billing_account = var.billing_account_id
  display_name    = "t062 月額予算"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }

  amount {
    specified_amount {
      currency_code = "JPY"
      units         = tostring(var.budget_amount_jpy)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }

  threshold_rules {
    threshold_percent = 0.9
  }

  threshold_rules {
    threshold_percent = 1.0
  }
}
