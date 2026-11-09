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
export CLOUD_RUN_WORKER_SERVICE=t062-worker CLOUD_RUN_MIGRATE_JOB=t062-migrate
export WORKER_URL=https://t062-worker.run.app WORKER_ID_TOKEN=fake-worker-token
export WORKER_PREVIOUS_REVISION=t062-worker-previous WORKER_NEW_REVISION=t062-worker-new
export WORKER_STATE="$sandbox/worker" CALL_LOG="$sandbox/calls"

gcloud() {
  # worker のサービスは別の状態ファイルで持つ
  if [[ "$2 $3 $4" == 'services describe t062-worker' ]]; then
    jq -cn --arg url "$WORKER_URL" --arg active "$(cat "$WORKER_STATE")" \
      '{status:{url:$url, traffic:[{revisionName:$active, percent:100}]}}'
    return
  fi
  if [[ "$2 $3 $4" == 'services update-traffic t062-worker' ]]; then
    case "$*" in
      *--to-latest*) printf '%s\n' "$WORKER_NEW_REVISION" > "$WORKER_STATE" ;;
      *--to-revisions*) printf '%s\n' "${!#%=100}" > "$WORKER_STATE" ;;
      *) return 1 ;;
    esac
    return
  fi
  case "$2 $3" in
    'jobs update') printf 'jobs update %s\n' "$*" >> "$CALL_LOG" ;;
    'jobs execute')
      printf 'jobs execute %s\n' "$*" >> "$CALL_LOG"
      [[ "$SCENARIO" != migrate_fails ]]
      ;;
    'deploy t062-worker')
      printf 'deploy worker %s\n' "$*" >> "$CALL_LOG"
      printf '%s\n' "$WORKER_NEW_REVISION" > "$WORKER_STATE"
      ;;
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
    "$WORKER_URL/healthz")
      [[ "$SCENARIO" != worker_fails ]] || return 22
      printf '%s\n' '{"status":"ok","source":"worker"}'
      return
      ;;
    "$CANDIDATE_URL/api/health.json") [[ "$SCENARIO" != candidate_fails ]] || return 22 ;;
    "$SERVICE_URL/api/health.json") [[ "$SCENARIO" != live_fails ]] || return 22 ;;
    *) return 1 ;;
  esac
  printf '%s\n' '{"status":"ok","source":"api"}'
}
export -f gcloud gh sleep curl

printf '%s\n' "$PREVIOUS_REVISION" > "$RELEASE_STATE"
printf 'no\n' > "$STAGE_STATE"
printf '%s\n' "$WORKER_PREVIOUS_REVISION" > "$WORKER_STATE"
: > "$CALL_LOG"

# DB 移行: 同じイメージで db/migrate.ts を流す。失敗したら止まる
export SCENARIO=migrate_fails
if bash scripts/release-cloud-run.sh migrate; then exit 1; fi
export SCENARIO=success
: > "$CALL_LOG"
bash scripts/release-cloud-run.sh migrate
grep -F "jobs update run jobs update t062-migrate" "$CALL_LOG" | grep -F -- "--image $IMAGE_BY_DIGEST --command node --args db/migrate.ts" >/dev/null
grep -F "jobs execute run jobs execute t062-migrate" "$CALL_LOG" | grep -F -- "--wait" >/dev/null
# 移行のあいだ、worker と api は動かさない
[[ "$(cat "$WORKER_STATE")" == "$WORKER_PREVIOUS_REVISION" ]]
[[ "$(cat "$RELEASE_STATE")" == "$PREVIOUS_REVISION" ]]

# worker: 同じイメージを node worker/index.ts で動かし、/healthz が通らなければ前のリビジョンに戻す
: > "$CALL_LOG"
bash scripts/release-cloud-run.sh worker-deploy
grep -Fx "worker_url=$WORKER_URL" "$GITHUB_OUTPUT"
grep -Fx "worker_previous=$WORKER_PREVIOUS_REVISION" "$GITHUB_OUTPUT"
grep -F "deploy worker" "$CALL_LOG" | grep -F -- "--image $IMAGE_BY_DIGEST --command node --args worker/index.ts" >/dev/null
[[ "$(cat "$WORKER_STATE")" == "$WORKER_NEW_REVISION" ]]

export SCENARIO=worker_fails
if bash scripts/release-cloud-run.sh worker-verify; then exit 1; fi
[[ "$(cat "$WORKER_STATE")" == "$WORKER_PREVIOUS_REVISION" ]]

export SCENARIO=success
bash scripts/release-cloud-run.sh worker-deploy
bash scripts/release-cloud-run.sh worker-verify
[[ "$(cat "$WORKER_STATE")" == "$WORKER_NEW_REVISION" ]]

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
echo "Verified migration, worker rollout and rollback, staging, candidate rejection, rollback and successful promotion."
