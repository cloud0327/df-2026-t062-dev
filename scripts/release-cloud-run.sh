#!/usr/bin/env bash
set -euo pipefail

target=(--quiet --project "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}" --region "${GCP_REGION:?Set GCP_REGION}")
service="${CLOUD_RUN_SERVICE:?Set CLOUD_RUN_SERVICE}"

# 引数でサービス名を渡すと、そのサービス（worker など）を調べる。なければ api
describe_service() {
  gcloud run services describe "${1:-$service}" "${target[@]}" --format=json
}

active_revision() {
  jq -er '[.status.traffic[] | select((.percent // 0) > 0)] |
    if length == 1 and .[0].percent == 100 then .[0].revisionName
    else error("Release requires one revision serving 100% of traffic") end'
}

assert_main() {
  local main_sha
  main_sha="$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha)"
  if [[ "$main_sha" != "$GITHUB_SHA" ]]; then
    echo "main advanced during the release. Run the workflow on the latest commit." >&2
    return 1
  fi
}

# verify_json URL パス 期待する JSON トークン
verify_json() {
  local url="$1" path="$2" expected="$3" token="$4"
  for attempt in {1..6}; do
    if curl --fail --silent --max-time 8 --header "Authorization: Bearer $token" "$url$path" |
      jq -e --argjson expected "$expected" '. == $expected' >/dev/null; then
      return 0
    fi
    sleep 2
  done
  echo "Verification failed for $url$path" >&2
  return 1
}

verify_api() {
  verify_json "$1" /api/health.json '{"status":"ok","source":"api"}' "$CLOUD_RUN_ID_TOKEN"
}

# route_to リビジョン [サービス名]
route_to() {
  gcloud run services update-traffic "${2:-$service}" "${target[@]}" --to-revisions "$1=100"
}

require_digest() {
  local image="${IMAGE_BY_DIGEST:?Missing published image digest}"
  [[ "$image" =~ @sha256:[0-9a-f]{64}$ ]]
}

case "${1:-}" in
  migrate)
    # DB 移行。api を切り替える前に、同じイメージ（ダイジェスト）の node db/migrate.ts を Cloud Run ジョブで流す。
    # --forms で、そのイメージの forms/seed の様式も登録する（中身が変わったときだけ新しい版になる）。
    # 移行は足すだけにしてある（db/migrate.ts）ので、失敗してもここで止まるだけで、動いている api・worker は変わらない。
    require_digest
    image="$IMAGE_BY_DIGEST"
    job="${CLOUD_RUN_MIGRATE_JOB:?Set CLOUD_RUN_MIGRATE_JOB}"
    assert_main
    echo "Migrating the database with $image"
    gcloud run jobs update "$job" "${target[@]}" --image "$image" --command node --args db/migrate.ts,--forms
    gcloud run jobs execute "$job" "${target[@]}" --wait
    ;;
  worker-deploy)
    # worker にも api と同じイメージ（ダイジェスト）を入れる。起動のコマンドだけが違う。
    require_digest
    image="$IMAGE_BY_DIGEST"
    worker="${CLOUD_RUN_WORKER_SERVICE:?Set CLOUD_RUN_WORKER_SERVICE}"
    assert_main
    before="$(describe_service "$worker")"
    previous="$(active_revision <<< "$before")"
    worker_url="$(jq -er '.status.url | select(test("^https://[a-z0-9.-]+[.]run[.]app$"))' <<< "$before")"
    printf 'worker_previous=%s\nworker_url=%s\n' "$previous" "$worker_url" >> "$GITHUB_OUTPUT"
    echo "Active worker revision before rollout: $previous"
    gcloud run deploy "$worker" "${target[@]}" --image "$image" --command node --args worker/index.ts
    # 前回の切り戻しで特定のリビジョンに固定されていても、新しいリビジョンに向ける
    gcloud run services update-traffic "$worker" "${target[@]}" --to-latest
    ;;
  worker-verify)
    : "${WORKER_ID_TOKEN:?Missing worker identity token}"
    : "${WORKER_PREVIOUS_REVISION:?Missing worker rollback revision}"
    worker="${CLOUD_RUN_WORKER_SERVICE:?Set CLOUD_RUN_WORKER_SERVICE}"
    if ! verify_json "${WORKER_URL:?Missing worker URL}" /healthz '{"status":"ok","source":"worker"}' "$WORKER_ID_TOKEN"; then
      echo "Worker verification failed. Restoring $WORKER_PREVIOUS_REVISION." >&2
      if ! route_to "$WORKER_PREVIOUS_REVISION" "$worker" ||
        [[ "$(describe_service "$worker" | active_revision)" != "$WORKER_PREVIOUS_REVISION" ]]; then
        echo "::error::Worker rollback failed. Restore traffic to $WORKER_PREVIOUS_REVISION immediately."
      fi
      exit 1
    fi
    printf 'Cloud Run worker `%s` is serving the new image. Previous revision: `%s`.\n' \
      "$worker" "$WORKER_PREVIOUS_REVISION" >> "$GITHUB_STEP_SUMMARY"
    ;;
  stage)
    require_digest
    image="$IMAGE_BY_DIGEST"
    assert_main
    before="$(describe_service)"
    previous="$(active_revision <<< "$before")"
    service_url="$(jq -er '.status.url | select(test("^https://[a-z0-9.-]+[.]run[.]app$"))' <<< "$before")"
    tag="ci-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
    printf 'tag=%s\nprevious=%s\nservice_url=%s\n' "$tag" "$previous" "$service_url" >> "$GITHUB_OUTPUT"
    echo "Active revision before rollout: $previous"
    echo "Staging image: $image"

    gcloud run deploy "$service" "${target[@]}" --image "$image" --no-traffic --tag "$tag"
    staged="$(describe_service)"
    [[ "$(active_revision <<< "$staged")" == "$previous" ]]
    candidate="$(jq -cer --arg tag "$tag" '.status.traffic[] | select(.tag == $tag and (.percent // 0) == 0)' <<< "$staged")"
    revision="$(jq -er '.revisionName' <<< "$candidate")"
    url="$(jq -er '.url | select(test("^https://[a-z0-9.-]+[.]run[.]app$"))' <<< "$candidate")"
    printf 'revision=%s\ncandidate_url=%s\n' "$revision" "$url" >> "$GITHUB_OUTPUT"
    ;;
  promote)
    : "${CLOUD_RUN_ID_TOKEN:?Missing Cloud Run identity token}"
    : "${PREVIOUS_REVISION:?Missing rollback revision}"
    : "${CANDIDATE_REVISION:?Missing candidate revision}"
    verify_api "${CANDIDATE_URL:?Missing candidate URL}"
    assert_main
    [[ "$(describe_service | active_revision)" == "$PREVIOUS_REVISION" ]]
    if ! route_to "$CANDIDATE_REVISION" ||
      [[ "$(describe_service | active_revision)" != "$CANDIDATE_REVISION" ]] ||
      ! verify_api "${SERVICE_URL:?Missing service URL}"; then
      echo "Release failed after attempting promotion. Restoring $PREVIOUS_REVISION." >&2
      if ! route_to "$PREVIOUS_REVISION" || [[ "$(describe_service | active_revision)" != "$PREVIOUS_REVISION" ]]; then
        echo "::error::Rollback failed. Restore traffic to $PREVIOUS_REVISION immediately."
      fi
      exit 1
    fi
    printf 'Cloud Run revision `%s` is serving 100%% traffic. Previous revision: `%s`.\n' \
      "$CANDIDATE_REVISION" "$PREVIOUS_REVISION" >> "$GITHUB_STEP_SUMMARY"
    ;;
  cleanup)
    tag="${CANDIDATE_TAG:?Missing candidate tag}"
    current="$(describe_service)"
    if jq -e --arg tag "$tag" 'any(.status.traffic[]; .tag == $tag)' <<< "$current" >/dev/null; then
      gcloud run services update-traffic "$service" "${target[@]}" --remove-tags "$tag"
    fi
    ;;
  *)
    echo "Usage: $0 {migrate|worker-deploy|worker-verify|stage|promote|cleanup}" >&2
    exit 2
    ;;
esac
