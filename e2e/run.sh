#!/usr/bin/env bash
# The plugin end to end: a real Sanity Studio (`sanity dev`) on a fake Content Lake,
# the real handler, a real VocalStack, driven in Chromium by Playwright.
#
#   VOCALSTACK_API_KEY=vs_key_… AUDIO=~/speech.mp3 e2e/run.sh
#
# Optional: VOCALSTACK_API_URL (default https://api.vocalstack.com), CHROME_PATH,
# SHOTS (screenshots; default e2e/shots). See e2e/README.md.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${VOCALSTACK_API_KEY:?Set VOCALSTACK_API_KEY to a vs_key_… key with Read and Write}"
: "${AUDIO:?Set AUDIO to a short speech recording}"
export VOCALSTACK_API_URL="${VOCALSTACK_API_URL:-https://api.vocalstack.com}"
AUDIO="$(cd "$(dirname "$AUDIO")" && pwd)/$(basename "$AUDIO")"
export AUDIO

LAKE_PORT=8711     # HTTPS + HTTP/2, for the Studio
HANDLER_PORT=8712
PLAIN_PORT=8713    # the same lake on plain HTTP, for the handler and the file CDN
INSPECT_PORT=8811  # the test reads documents here
STUDIO_PORT=3711
PORTS="$LAKE_PORT $HANDLER_PORT $PLAIN_PORT $INSPECT_PORT $STUDIO_PORT"

for p in $PORTS; do
  if lsof -ti "tcp:$p" -sTCP:LISTEN >/dev/null 2>&1; then echo "Port $p is in use; stop whatever runs there first." >&2; exit 1; fi
done

LOGS=e2e/.logs
mkdir -p "$LOGS"
stop() {
  for p in $PORTS; do lsof -ti "tcp:$p" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true; done
}
trap stop EXIT INT TERM

# The test runs the committed dist/: build it from src/ first.
pnpm -s build

PORT=$LAKE_PORT PLAIN_PORT=$PLAIN_PORT node e2e/fake-lake.mjs >"$LOGS/lake.log" 2>&1 &
HANDLER_PORT=$HANDLER_PORT LAKE_URL="http://127.0.0.1:$PLAIN_PORT" node e2e/handler-server.mjs >"$LOGS/handler.log" 2>&1 &
(
  cd e2e/studio
  SANITY_TELEMETRY_DISABLED=1 \
    SANITY_STUDIO_LAKE_URL="https://localhost:$LAKE_PORT" \
    SANITY_STUDIO_HANDLER_URL="http://127.0.0.1:$HANDLER_PORT/api/vocalstack" \
    ../../node_modules/.bin/sanity dev --host 127.0.0.1 --port "$STUDIO_PORT" >"../../$LOGS/studio.log" 2>&1
) &

wait_for() {
  # Up when it answers at all.
  for _ in $(seq 1 120); do [ "$(curl -s -o /dev/null -w '%{http_code}' "$1")" != 000 ] && return 0; sleep 0.5; done
  echo "$2 did not start; see $LOGS/" >&2; exit 1
}
wait_for "http://127.0.0.1:$INSPECT_PORT/" "The fake Content Lake"
wait_for "http://127.0.0.1:$HANDLER_PORT/api/vocalstack/connection" "The handler"
wait_for "http://127.0.0.1:$STUDIO_PORT/" "The Studio"

STUDIO_URL="http://127.0.0.1:$STUDIO_PORT" \
  LAKE_INSPECT_URL="http://127.0.0.1:$INSPECT_PORT" \
  LAKE_PLAIN_URL="http://127.0.0.1:$PLAIN_PORT" \
  node e2e/transcribe.spec.mjs
