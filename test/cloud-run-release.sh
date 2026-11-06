#!/usr/bin/env bash
set -euo pipefail

sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT
export RELEASE_STATE="$sandbox/active" STAGE_STATE="$sandbox/staged"
export GITHUB_OUTPUT="$sandbox/output" GITHUB_STEP_SUMMARY="$sandbox/summary"
export GITHUB_REPOSITORY=test/repo GITHUB_SHA=main-sha GITHUB_RUN_ID=42 GITHUB_RUN_ATTEMPT=1
export GCP_PROJECT_ID=mock-project GCP_REGION=asia-northeast1 CLOUD_RUN_SERVICE=t062-api
export CLOUD_RUN_ID_TOKEN=fake-token
export IMAGE_BY_DIGEST="repo/api@sha256:$(printf '%064d' 0)"
export PREVIOUS_REVISION=t062-api-previous CANDIDATE_REVISION=t062-api-candidate
export SERVICE_URL=https://t062-api.run.app CANDIDATE_URL=https://ci-42-1---t062-api.run.app

gcloud() {
  case "$2 $3" in
    'services describe')
      jq -cn --arg url "$SERVICE_URL" --arg active "$(cat "$RELEASE_STATE")" \
        --arg candidate "$CANDIDATE_REVISION" --arg candidate_url "$CANDIDATE_URL" \
        --arg staged "$(cat "$STAGE_STATE")" '
          {status:{url:$url, traffic:([{revisionName:$active, percent:100}] +
            (if $staged == "yes" then [{revisionName:$candidate, tag:"ci-42-1", url:$candidate_url}] else [] end))}}'
      ;;
    'services update-traffic')
      case "${*: -2:1}" in
        --to-revisions) printf '%s\n' "${!#%=100}" > "$RELEASE_STATE" ;;
        --remove-tags) printf 'no\n' > "$STAGE_STATE" ;;
        *) return 1 ;;
      esac
      ;;
    'deploy t062-api') printf 'yes\n' > "$STAGE_STATE" ;;
    *) return 1 ;;
  esac
}

gh() { printf '%s\n' "$GITHUB_SHA"; }
sleep() { :; }
curl() {
  case "${!#}" in
    "$CANDIDATE_URL/api/health.json") [[ "$SCENARIO" != candidate_fails ]] || return 22 ;;
    "$SERVICE_URL/api/health.json") [[ "$SCENARIO" != live_fails ]] || return 22 ;;
    *) return 1 ;;
  esac
  printf '%s\n' '{"status":"ok","source":"api"}'
}
export -f gcloud gh sleep curl

printf '%s\n' "$PREVIOUS_REVISION" > "$RELEASE_STATE"
printf 'no\n' > "$STAGE_STATE"
bash scripts/release-cloud-run.sh stage
grep -Fx "candidate_url=$CANDIDATE_URL" "$GITHUB_OUTPUT"
[[ "$(cat "$RELEASE_STATE")" == "$PREVIOUS_REVISION" ]]

export SCENARIO=candidate_fails
if bash scripts/release-cloud-run.sh promote; then exit 1; fi
[[ "$(cat "$RELEASE_STATE")" == "$PREVIOUS_REVISION" ]]

export SCENARIO=live_fails
if bash scripts/release-cloud-run.sh promote; then exit 1; fi
[[ "$(cat "$RELEASE_STATE")" == "$PREVIOUS_REVISION" ]]

export SCENARIO=success
bash scripts/release-cloud-run.sh promote
[[ "$(cat "$RELEASE_STATE")" == "$CANDIDATE_REVISION" ]]
CANDIDATE_TAG=ci-42-1 bash scripts/release-cloud-run.sh cleanup
[[ "$(cat "$STAGE_STATE")" == no ]]
echo "Verified staging, candidate rejection, rollback and successful promotion."
