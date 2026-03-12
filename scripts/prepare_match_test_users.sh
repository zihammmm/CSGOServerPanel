#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"

cd "$repo_root/backend"

go run ./cmd/matchtest prepare-users \
  --out "${1:-/tmp/matchtest-users.json}" \
  --env-out "${2:-/tmp/matchtest-users.env}"
