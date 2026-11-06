#!/usr/bin/env bash
set -euo pipefail

image="${1:?Pass the container image to check}"
container="$(docker run --detach --rm --publish 127.0.0.1::8080 --env PORT=8080 "$image")"
trap 'docker stop "$container" >/dev/null 2>&1 || true' EXIT
address="$(docker port "$container" 8080/tcp)"

for attempt in {1..12}; do
  if curl --fail --silent --max-time 2 "http://$address/api/health.json" |
    jq -e '. == {status:"ok", source:"api"}' >/dev/null; then
    echo 'Container API smoke test passed.'
    exit 0
  fi
  sleep 1
done

echo "Container API never returned the expected health response." >&2
docker logs "$container" >&2 || true
exit 1
