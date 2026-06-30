#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/deploy"
cd "$DEPLOY_DIR"

if [ ! -f .env.production ]; then
  echo "Missing deploy/.env.production"
  exit 1
fi

set -a
. ./.env.production
set +a

mkdir -p backups/postgres
STAMP="$(date +%Y%m%d-%H%M%S)"
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "backups/postgres/foru_pos_$STAMP.sql.gz"
find backups/postgres -type f -name 'foru_pos_*.sql.gz' -mtime +14 -delete
echo "Backup saved: backups/postgres/foru_pos_$STAMP.sql.gz"
