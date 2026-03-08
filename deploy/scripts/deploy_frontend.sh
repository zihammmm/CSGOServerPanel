#!/usr/bin/env bash
set -euo pipefail

# One-command frontend deployment for a dedicated frontend server.
# Usage:
#   ./deploy/scripts/deploy_frontend.sh deploy
#   ./deploy/scripts/deploy_frontend.sh logs
#   ./deploy/scripts/deploy_frontend.sh ps

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

CMD="${1:-deploy}"

IMAGE_FRONTEND="${IMAGE_FRONTEND:-csgopanel-frontend}"
CONTAINER_FRONTEND="${CONTAINER_FRONTEND:-csgopanel-frontend}"
FRONTEND_ENV_FILE="${FRONTEND_ENV_FILE:-frontend/.env}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing command: $1"
    exit 1
  fi
}

deploy_frontend() {
  if [[ ! -f "$FRONTEND_ENV_FILE" ]]; then
    echo "missing $FRONTEND_ENV_FILE"
    echo "create it from frontend/.env.example first"
    exit 1
  fi

  docker build -t "$IMAGE_FRONTEND" ./frontend

  if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_FRONTEND"; then
    docker rm -f "$CONTAINER_FRONTEND" >/dev/null
  fi

  docker run -d \
    --name "$CONTAINER_FRONTEND" \
    --env-file "$FRONTEND_ENV_FILE" \
    -p "$FRONTEND_PORT":3000 \
    "$IMAGE_FRONTEND" >/dev/null

  echo "frontend deployed: $CONTAINER_FRONTEND"
  echo "open: http://127.0.0.1:$FRONTEND_PORT"
}

show_ps() {
  docker ps --filter "name=$CONTAINER_FRONTEND"
}

show_logs() {
  docker logs -f "$CONTAINER_FRONTEND"
}

need_cmd docker

case "$CMD" in
  deploy)
    deploy_frontend
    ;;
  logs)
    show_logs
    ;;
  ps)
    show_ps
    ;;
  *)
    echo "unknown command: $CMD"
    exit 1
    ;;
esac
