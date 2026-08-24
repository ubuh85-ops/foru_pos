#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/deploy"

cd "$DEPLOY_DIR"

COMPOSE_FILES=(-f docker-compose.prod.yml)
if [ -f /etc/letsencrypt/live/foru.web.id/fullchain.pem ] && [ -f /etc/letsencrypt/live/foru.web.id/privkey.pem ]; then
  COMPOSE_FILES+=(-f docker-compose.https.yml)
  echo "HTTPS mode enabled for foru.web.id."
else
  echo "HTTPS certificate not found; deploying HTTP configuration."
fi

if [ ! -f .env.production ]; then
  cp .env.production.example .env.production
  echo "Created deploy/.env.production. Edit secrets first, then rerun:"
  echo "  nano deploy/.env.production"
  exit 1
fi

mkdir -p "$DEPLOY_DIR/backups/postgres"

docker compose "${COMPOSE_FILES[@]}" --env-file .env.production build
docker compose "${COMPOSE_FILES[@]}" --env-file .env.production up -d postgres

echo "Running Prisma migrations..."
docker compose "${COMPOSE_FILES[@]}" --env-file .env.production run --rm api npx prisma migrate deploy
docker compose "${COMPOSE_FILES[@]}" --env-file .env.production run --rm api npx prisma generate

echo "Running production seed data..."
docker compose "${COMPOSE_FILES[@]}" --env-file .env.production run --rm api pnpm prisma db seed

docker compose "${COMPOSE_FILES[@]}" --env-file .env.production up -d api
docker compose "${COMPOSE_FILES[@]}" --env-file .env.production up -d web

echo "Deployment complete."
PUBLIC_HOST_VALUE="$(grep '^PUBLIC_HOST=' .env.production | cut -d= -f2)"
if [ -f /etc/letsencrypt/live/foru.web.id/fullchain.pem ]; then
  echo "Web: https://${PUBLIC_HOST_VALUE}"
  echo "API health: https://${PUBLIC_HOST_VALUE}/api/health"
else
  echo "Web: http://${PUBLIC_HOST_VALUE}"
  echo "API health: http://${PUBLIC_HOST_VALUE}/api/health"
fi
