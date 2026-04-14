#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COORDINATOR_DIR="$ROOT_DIR/StreamPathCoordinator"
CLIENT_DIR="$ROOT_DIR/StreamPathCoordinatorClient"
STARTUP_TIMEOUT_SECONDS="${STARTUP_TIMEOUT_SECONDS:-30}"
COORDINATOR_PORT="${COORDINATOR_PORT:-}"
CLIENT_PORT="${CLIENT_PORT:-5173}"
ENABLE_NGROK="${ENABLE_NGROK:-false}"
NGROK_PORT="${NGROK_PORT:-4040}"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found on PATH." >&2
  exit 1
fi

if [[ ! -d "$COORDINATOR_DIR" ]]; then
  echo "Coordinator directory not found: $COORDINATOR_DIR" >&2
  exit 1
fi

if [[ ! -d "$CLIENT_DIR" ]]; then
  echo "Client directory not found: $CLIENT_DIR" >&2
  exit 1
fi

if [[ ! -f "$COORDINATOR_DIR/.env" ]]; then
  echo "Coordinator .env file not found: $COORDINATOR_DIR/.env" >&2
  exit 1
fi

if [[ ! -d "$COORDINATOR_DIR/node_modules" ]]; then
  echo "Coordinator dependencies are missing. Run: (cd \"$COORDINATOR_DIR\" && npm install)" >&2
  exit 1
fi

if [[ ! -d "$CLIENT_DIR/node_modules" ]]; then
  echo "Client dependencies are missing. Run: (cd \"$CLIENT_DIR\" && npm install)" >&2
  exit 1
fi

if [[ -z "$COORDINATOR_PORT" ]]; then
  env_port="$(sed -n 's/^PORT=//p' "$COORDINATOR_DIR/.env" | tail -n 1)"
  COORDINATOR_PORT="${env_port:-8080}"
fi

COORDINATOR_URL="${COORDINATOR_URL:-http://localhost:${COORDINATOR_PORT}/health}"

coordinator_pid=""
started_coordinator="false"
ngrok_pid=""

for arg in "$@"; do
  case "$arg" in
    --ngrok)
      ENABLE_NGROK="true"
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--ngrok]" >&2
      exit 1
      ;;
  esac
done

is_coordinator_healthy() {
  if command -v curl >/dev/null 2>&1; then
    curl --silent --fail "$COORDINATOR_URL" >/dev/null
    return $?
  fi

  return 1
}

start_ngrok() {
  if [[ "$ENABLE_NGROK" != "true" ]]; then
    return
  fi

  if ! command -v ngrok >/dev/null 2>&1; then
    echo "ngrok support requested, but ngrok is not installed." >&2
    echo "Install ngrok or rerun without --ngrok." >&2
    exit 1
  fi

  echo "Starting ngrok for coordinator on port $COORDINATOR_PORT..."
  ngrok http "$COORDINATOR_PORT" >/dev/null 2>&1 &
  ngrok_pid=$!

  if command -v curl >/dev/null 2>&1; then
    for ((attempt = 1; attempt <= 15; attempt++)); do
      local tunnel_json=""
      tunnel_json="$(curl --silent --fail "http://127.0.0.1:${NGROK_PORT}/api/tunnels" || true)"

      if [[ -n "$tunnel_json" ]]; then
        local public_url=""
        public_url="$(node -e "const payload = JSON.parse(process.argv[1]); const tunnel = (payload.tunnels || []).find((item) => item.proto === 'https') || (payload.tunnels || [])[0]; if (tunnel?.public_url) process.stdout.write(tunnel.public_url);" "$tunnel_json" 2>/dev/null || true)"

        if [[ -n "$public_url" ]]; then
          echo "ngrok URL: $public_url"
          return
        fi
      fi

      sleep 1
    done
  fi

  echo "ngrok started, but public URL could not be read automatically. Check http://127.0.0.1:${NGROK_PORT}"
}

find_listeners() {
  local port="$1"
  lsof -tiTCP:"$port" -sTCP:LISTEN -n -P 2>/dev/null || true
}

kill_listeners() {
  local port="$1"
  local pids

  pids="$(find_listeners "$port")"

  if [[ -z "$pids" ]]; then
    return
  fi

  echo "Stopping processes listening on port $port: $pids"
  kill $pids >/dev/null 2>&1 || true
  sleep 1

  local remaining
  remaining="$(find_listeners "$port")"

  if [[ -n "$remaining" ]]; then
    echo "Force killing processes still listening on port $port: $remaining"
    kill -9 $remaining >/dev/null 2>&1 || true
  fi
}

cleanup() {
  local exit_code=$?

  if [[ "$started_coordinator" == "true" ]] && [[ -n "$coordinator_pid" ]] && kill -0 "$coordinator_pid" >/dev/null 2>&1; then
    kill "$coordinator_pid" >/dev/null 2>&1 || true
    wait "$coordinator_pid" >/dev/null 2>&1 || true
  fi

  if [[ -n "$ngrok_pid" ]] && kill -0 "$ngrok_pid" >/dev/null 2>&1; then
    kill "$ngrok_pid" >/dev/null 2>&1 || true
    wait "$ngrok_pid" >/dev/null 2>&1 || true
  fi

  exit "$exit_code"
}

trap cleanup EXIT INT TERM

kill_listeners "$COORDINATOR_PORT"
kill_listeners "$CLIENT_PORT"

echo "Waiting for coordinator health endpoint: $COORDINATOR_URL"
if command -v curl >/dev/null 2>&1; then
  echo "Starting StreamPath coordinator..."
  (cd "$COORDINATOR_DIR" && npm run dev) &
  coordinator_pid=$!
  started_coordinator="true"
  coordinator_ready="false"

  for ((attempt = 1; attempt <= STARTUP_TIMEOUT_SECONDS; attempt++)); do
    if is_coordinator_healthy; then
      coordinator_ready="true"
      break
    fi

    sleep 1
  done

  if [[ "$coordinator_ready" != "true" ]]; then
    echo "Coordinator did not become ready within ${STARTUP_TIMEOUT_SECONDS}s." >&2
    exit 1
  fi
else
  echo "Starting StreamPath coordinator..."
  (cd "$COORDINATOR_DIR" && npm run dev) &
  coordinator_pid=$!
  started_coordinator="true"
  echo "curl not found; waiting 3 seconds before starting client."
  sleep 3
fi

start_ngrok

echo "Coordinator API: http://localhost:${COORDINATOR_PORT}"
echo "Coordinator health: $COORDINATOR_URL"
echo "Starting StreamPath client..."
cd "$CLIENT_DIR"
npm run dev
