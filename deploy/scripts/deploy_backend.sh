#!/usr/bin/env bash
set -euo pipefail

# One-command backend deployment for a dedicated backend server.
# Usage:
#   ./deploy/scripts/deploy_backend.sh init-db   # optional first-time DB start
#   ./deploy/scripts/deploy_backend.sh deploy    # build + restart backend
#   ./deploy/scripts/deploy_backend.sh logs      # tail backend logs
#   ./deploy/scripts/deploy_backend.sh ps        # show backend/db status

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

CMD="${1:-deploy}"

IMAGE_BACKEND="${IMAGE_BACKEND:-csgopanel-backend}"
CONTAINER_BACKEND="${CONTAINER_BACKEND:-csgopanel-backend}"

NETWORK_NAME="${NETWORK_NAME:-csgopanel-net}"
DB_CONTAINER="${DB_CONTAINER:-csgopanel-db}"
DB_IMAGE="${DB_IMAGE:-postgres:17-alpine}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-csgopanel}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"
DB_VOLUME="${DB_VOLUME:-pg_data}"

BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-backend/.env}"
BACKEND_PORT="${BACKEND_PORT:-8080}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing command: $1"
    exit 1
  fi
}

ensure_network() {
  docker network inspect "$NETWORK_NAME" >/dev/null 2>&1 || docker network create "$NETWORK_NAME" >/dev/null
}

start_db() {
  ensure_network
  docker volume create "$DB_VOLUME" >/dev/null
  if docker ps -a --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
    docker start "$DB_CONTAINER" >/dev/null || true
    echo "db container started: $DB_CONTAINER"
    return
  fi

  docker run -d \
    --name "$DB_CONTAINER" \
    --network "$NETWORK_NAME" \
    -e POSTGRES_DB="$DB_NAME" \
    -e POSTGRES_USER="$DB_USER" \
    -e POSTGRES_PASSWORD="$DB_PASSWORD" \
    -v "$DB_VOLUME":/var/lib/postgresql/data \
    -p "$DB_PORT":5432 \
    "$DB_IMAGE" >/dev/null

  echo "db container created: $DB_CONTAINER"
}

deploy_backend() {
  if [[ ! -f "$BACKEND_ENV_FILE" ]]; then
    echo "missing $BACKEND_ENV_FILE"
    echo "create it from backend/.env.example first"
    exit 1
  fi

  ensure_network

  docker build \
    --build-arg GOPROXY="${GOPROXY:-https://goproxy.cn,direct}" \
    --build-arg GOSUMDB="${GOSUMDB:-sum.golang.google.cn}" \
    -t "$IMAGE_BACKEND" ./backend

  if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_BACKEND"; then
    docker rm -f "$CONTAINER_BACKEND" >/dev/null
  fi

  docker run -d \
    --name "$CONTAINER_BACKEND" \
    --network "$NETWORK_NAME" \
    --env-file "$BACKEND_ENV_FILE" \
    -p "$BACKEND_PORT":8080 \
    "$IMAGE_BACKEND" >/dev/null

  echo "backend deployed: $CONTAINER_BACKEND"
  echo "health check: curl http://127.0.0.1:$BACKEND_PORT/healthz"
}

show_ps() {
  docker ps --filter "name=$CONTAINER_BACKEND" --filter "name=$DB_CONTAINER"
}

show_logs() {
  docker logs -f "$CONTAINER_BACKEND"
}

need_cmd docker

case "$CMD" in
  init-db)
    start_db
    ;;
  deploy)
    deploy_backend
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
