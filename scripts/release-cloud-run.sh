#!/usr/bin/env bash
set -euo pipefail

target=(--quiet --project "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}" --region "${GCP_REGION:?Set GCP_REGION}")
service="${CLOUD_RUN_SERVICE:?Set CLOUD_RUN_SERVICE}"

describe_service() {
  gcloud run services describe "$service" "${target[@]}" --format=json
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

verify_api() {
  local url="$1"
  for attempt in {1..6}; do
    if curl --fail --silent --max-time 8 --header "Authorization: Bearer $CLOUD_RUN_ID_TOKEN" "$url/api/health.json" |
      jq -e '. == {status:"ok", source:"api"}' >/dev/null; then
      return 0
    fi
    sleep 2
  done
  echo "API verification failed for $url" >&2
  return 1
}

route_to() {
  gcloud run services update-traffic "$service" "${target[@]}" --to-revisions "$1=100"
}

case "${1:-}" in
  stage)
    image="${IMAGE_BY_DIGEST:?Missing published image digest}"
    [[ "$image" =~ @sha256:[0-9a-f]{64}$ ]]
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
    echo "Usage: $0 {stage|promote|cleanup}" >&2
    exit 2
    ;;
esac
