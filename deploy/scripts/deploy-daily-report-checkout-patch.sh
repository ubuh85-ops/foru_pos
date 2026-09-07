#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/foru-pos
PATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_FILE="${1:-$PATCH_DIR/daily-report-checkout.patch}"
EXPECTED_BASE=a7ec06e
cd "$APP_DIR"
test -f "$PATCH_FILE"
test -f deploy/.env.production
test "$(git rev-parse --short=7 HEAD)" = "$EXPECTED_BASE"
test -z "$(git status --porcelain --untracked-files=no)"
git apply --check "$PATCH_FILE"

cd deploy
# This patch targets the existing HTTPS production stack. The opc account may
# not be able to inspect certificate directories even though Docker can mount them.
COMPOSE=(docker compose -f docker-compose.prod.yml -f docker-compose.https.yml --env-file .env.production)
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$APP_DIR/deploy/backups/daily-report-checkout-$STAMP"
mkdir -p "$BACKUP"
chmod 700 "$BACKUP"
"${COMPOSE[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$BACKUP/database.sql.gz"
test -s "$BACKUP/database.sql.gz"
gzip -t "$BACKUP/database.sql.gz"
git -C "$APP_DIR" archive HEAD -o "$BACKUP/source.tar"
for SERVICE in api web; do
  CONTAINER="$("${COMPOSE[@]}" ps -q "$SERVICE")"
  IMAGE="$(docker inspect --format '{{.Image}}' "$CONTAINER")"
  docker tag "$IMAGE" "foru-$SERVICE:before-daily-report-checkout-$STAMP"
  printf '%s %s\n' "$SERVICE" "$IMAGE" >> "$BACKUP/images.txt"
done
printf 'BACKUP=%s\n' "$BACKUP"

cd "$APP_DIR"
git apply "$PATCH_FILE"
cd deploy
"${COMPOSE[@]}" build api web
"${COMPOSE[@]}" run --rm --no-deps \
  -v "$APP_DIR/apps/api/src:/app/apps/api/src:ro" \
  -v "$APP_DIR/apps/web/src:/app/apps/web/src:ro" \
  api pnpm test
"${COMPOSE[@]}" run --rm --no-deps api pnpm prisma validate
"${COMPOSE[@]}" run --rm --no-deps api pnpm prisma migrate deploy
"${COMPOSE[@]}" up -d --no-deps api web
for ATTEMPT in $(seq 1 30); do
  if curl --max-time 10 -fsS https://foru.web.id/api/health; then
    "${COMPOSE[@]}" ps
    printf '\nDEPLOY_OK BACKUP=%s\n' "$BACKUP"
    exit 0
  fi
  sleep 2
done
echo 'Health check failed. Previous images and source are preserved in the backup.' >&2
exit 1
