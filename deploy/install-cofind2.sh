#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-/opt/cofind2}"
DOMAIN="${COFIND_DOMAIN:-cofind2.com}"
ENV_FILE="$ROOT_DIR/deploy/.env.production"
COMPOSE_FILE="$ROOT_DIR/deploy/docker-compose.cofind2.yml"

cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Install Docker Engine and Docker Compose plugin first." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is not available." >&2
  exit 1
fi

secret() {
  openssl rand -hex 32
}

if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
POSTGRES_DB=cofind
POSTGRES_USER=cofind
POSTGRES_PASSWORD=$(secret)

JWT_ACCESS_SECRET=$(secret)
JWT_REFRESH_SECRET=$(secret)

MEILISEARCH_MASTER_KEY=$(secret)
PUBLIC_WEB_URL=https://$DOMAIN
PUBLIC_API_BASE=https://$DOMAIN/api/v1
PUBLIC_API_URL=https://$DOMAIN/api/v1

PAYMENT_WEBHOOK_SECRET=$(secret)
MAIL_WEBHOOK_URL=https://$DOMAIN/api/v1/health/live
MAIL_WEBHOOK_SECRET=$(secret)
MAIL_FROM=Cofind <noreply@$DOMAIN>

API_DOCS_ENABLED=false
TRUST_PROXY=true
EOF
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE with generated secrets."
  echo "MAIL_WEBHOOK_URL is temporary; replace it with a real mail provider before public password reset."
fi

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T api pnpm prisma:deploy
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T api pnpm seed
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
