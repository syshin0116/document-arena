#!/bin/sh
set -eu

runner_pid=""
orchestrator_pid=""
web_pid=""

cleanup() {
  trap - INT TERM EXIT
  for pid in "$web_pid" "$orchestrator_pid" "$runner_pid"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
}

trap cleanup INT TERM EXIT

if ! docker image inspect document-arena/opendataloader-pdf:2.5.0 >/dev/null 2>&1; then
  printf '%s\n' 'OpenDataLoader image is missing; building it once for the local runner.'
  bun run parser:build:opendataloader
fi

if curl --fail --silent "http://127.0.0.1:${DOCUMENT_ARENA_RUNNER_PORT:-8799}/v1/health" >/dev/null 2>&1; then
  printf '%s\n' 'Reusing the healthy local runner already listening on the configured port.'
else
  bun services/runner/serve.mjs &
  runner_pid=$!
fi

if curl --fail --silent "http://127.0.0.1:${DOCUMENT_ARENA_ORCHESTRATOR_PORT:-8788}/healthz" >/dev/null 2>&1; then
  printf '%s\n' 'Reusing the healthy orchestrator already listening on the configured port.'
else
  DOCUMENT_ARENA_ORCHESTRATOR_PORT="${DOCUMENT_ARENA_ORCHESTRATOR_PORT:-8788}" \
    bun services/orchestrator/serve.mjs &
  orchestrator_pid=$!
fi

web_health="http://${DEV_HOST:-127.0.0.1}:${DOCUMENT_ARENA_WEB_PORT:-3000}/healthz"
if curl --fail --silent "$web_health" 2>/dev/null | grep -q 'document-arena-web'; then
  printf '%s\n' 'Reusing the healthy Document Arena web dev server already listening on the configured port.'
else
  bun run dev -- --hostname "${DEV_HOST:-127.0.0.1}" \
    --port "${DOCUMENT_ARENA_WEB_PORT:-3000}" &
  web_pid=$!
fi

printf '%s\n' "Web:          http://${DEV_HOST:-127.0.0.1}:${DOCUMENT_ARENA_WEB_PORT:-3000}"
printf '%s\n' 'Local runner: http://127.0.0.1:8799/v1/health'
printf '%s\n' "Orchestrator: http://127.0.0.1:${DOCUMENT_ARENA_ORCHESTRATOR_PORT:-8788}/healthz"

is_running() {
  [ -z "$1" ] || kill -0 "$1" 2>/dev/null
}

while is_running "$web_pid" \
  && is_running "$runner_pid" \
  && is_running "$orchestrator_pid"; do
  sleep 1
done

for pid in "$web_pid" "$runner_pid" "$orchestrator_pid"; do
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
    wait "$pid" || exit $?
  fi
done
