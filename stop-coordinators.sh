#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COORD_DIR="$ROOT_DIR/StreamPathCoordinator"
ENV_FILE="$COORD_DIR/.env"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

declare -a PID_CANDIDATES=()

add_pid() {
  local pid="$1"
  if [[ -z "$pid" ]]; then
    return
  fi
  if [[ "$pid" == "$$" ]]; then
    return
  fi
  if [[ "$pid" == "$PPID" ]]; then
    return
  fi
  PID_CANDIDATES+=("$pid")
}

collect_from_pattern() {
  local pattern="$1"
  local pids
  pids="$(pgrep -f "$pattern" || true)"
  if [[ -z "$pids" ]]; then
    return
  fi
  while IFS= read -r pid; do
    add_pid "$pid"
  done <<<"$pids"
}

PORT="8080"
if [[ -f "$ENV_FILE" ]]; then
  env_port="$(grep -E '^PORT=' "$ENV_FILE" | tail -n1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)"
  if [[ -n "${env_port:-}" ]]; then
    PORT="$env_port"
  fi
fi

collect_from_pattern "$COORD_DIR/node_modules/.bin/tsx src/index.ts"
collect_from_pattern "StreamPathCoordinator.*src/index.ts"
collect_from_pattern "StreamPathCoordinator.*dist/index.js"
collect_from_pattern "StreamPathCoordinator.*npm run dev"
collect_from_pattern "StreamPathCoordinator.*npm run start"
collect_from_pattern "streampathcoordinator"

# Process table fallback: any process running from StreamPathCoordinator with coordinator entrypoints.
while IFS= read -r line; do
  pid="$(awk '{print $1}' <<<"$line")"
  cmd="$(cut -d' ' -f2- <<<"$line")"

  if [[ "$cmd" != *"StreamPathCoordinator"* ]]; then
    continue
  fi

  if [[ "$cmd" == *"src/index.ts"* || "$cmd" == *"dist/index.js"* || "$cmd" == *"streampathcoordinator"* ]]; then
    add_pid "$pid"
  fi
done < <(ps -axo pid=,command=)

# Include listeners on coordinator port only if command line indicates StreamPathCoordinator.
while IFS= read -r port_pid; do
  if [[ -z "$port_pid" ]]; then
    continue
  fi
  cmd="$(ps -p "$port_pid" -o command= || true)"
  if [[ "$cmd" == *"StreamPathCoordinator"* ]]; then
    add_pid "$port_pid"
  fi
done < <(lsof -t -iTCP:"$PORT" -sTCP:LISTEN -n -P 2>/dev/null || true)

if [[ ${#PID_CANDIDATES[@]} -eq 0 ]]; then
  echo "No coordinator processes detected."
  exit 0
fi

TARGET_PIDS=()
while IFS= read -r pid; do
  if [[ -n "$pid" ]]; then
    TARGET_PIDS+=("$pid")
  fi
done < <(printf '%s\n' "${PID_CANDIDATES[@]}" | awk 'NF' | sort -u)

echo "Detected coordinator PID(s): ${TARGET_PIDS[*]}"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "Dry run enabled. No processes were stopped."
  exit 0
fi

echo "Sending SIGTERM..."
kill "${TARGET_PIDS[@]}" 2>/dev/null || true

for _ in {1..10}; do
  remaining=()
  for pid in "${TARGET_PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      remaining+=("$pid")
    fi
  done

  if [[ ${#remaining[@]} -eq 0 ]]; then
    echo "All coordinator processes stopped."
    exit 0
  fi

  sleep 0.5
done

echo "Forcing remaining PID(s): ${remaining[*]}"
kill -9 "${remaining[@]}" 2>/dev/null || true

sleep 0.5

still_running=()
for pid in "${remaining[@]}"; do
  if kill -0 "$pid" 2>/dev/null; then
    still_running+=("$pid")
  fi
done

if [[ ${#still_running[@]} -gt 0 ]]; then
  echo "Failed to stop PID(s): ${still_running[*]}"
  exit 1
fi

echo "All coordinator processes stopped."
