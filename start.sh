#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'USAGE'
Usage: ./start.sh [command]

Commands:
  up      Build and start full stack (default)
  down    Stop all services
  logs    Follow compose logs
  ps      Show service status
USAGE
}

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found. Please install Docker first."
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  echo "docker compose not found. Please install Docker Compose."
  exit 1
fi

cmd="${1:-up}"

case "$cmd" in
  up)
    echo "[start.sh] Building and starting frontend/backend/db..."
    (cd "$ROOT_DIR" && "${COMPOSE_CMD[@]}" up --build)
    ;;
  down)
    echo "[start.sh] Stopping services..."
    (cd "$ROOT_DIR" && "${COMPOSE_CMD[@]}" down)
    ;;
  logs)
    echo "[start.sh] Following logs..."
    (cd "$ROOT_DIR" && "${COMPOSE_CMD[@]}" logs -f)
    ;;
  ps)
    (cd "$ROOT_DIR" && "${COMPOSE_CMD[@]}" ps)
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown command: $cmd"
    usage
    exit 1
    ;;
esac
