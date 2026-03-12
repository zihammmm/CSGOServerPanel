#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

psql "$DATABASE_URL" <<'SQL'
WITH old_matches AS (
  SELECT id
  FROM matches
  WHERE status IN ('created', 'cancelled', 'finished')
)
DELETE FROM matches
WHERE id IN (SELECT id FROM old_matches);
SQL
