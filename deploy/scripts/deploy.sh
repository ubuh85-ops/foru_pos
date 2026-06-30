#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/deploy"

cd "$DEPLOY_DIR"

if [ ! -f .env.production ]; then
  cp .env.production.example .env.production
  echo "Created deploy/.env.production. Edit secrets first, then rerun:"
  echo "  nano deploy/.env.production"
  exit 1
fi

mkdir -p "$DEPLOY_DIR/backups/postgres"

docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d postgres

echo "Running Prisma migrations..."
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api npx prisma migrate deploy
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api npx prisma generate

echo "Running production seed data..."
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api pnpm prisma db seed

docker compose -f docker-compose.prod.yml --env-file .env.production up -d api
docker compose -f docker-compose.prod.yml --env-file .env.production up -d web

echo "Deployment complete."
echo "Web: http://$(grep '^PUBLIC_HOST=' .env.production | cut -d= -f2)"
echo "API health: http://$(grep '^PUBLIC_HOST=' .env.production | cut -d= -f2)/api/health"
