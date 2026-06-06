# Cofind 2 Production Deploy

Minimal Docker path for staging/public release. Use `deploy/SERVER_CHECKLIST.md` as the move-to-server runbook. For `cofind2.com`, prefer `deploy/docker-compose.cofind2.yml` with `deploy/Caddyfile.cofind2`; it serves web, API and WebSocket on the same HTTPS domain.

1. Copy `deploy/docker-compose.prod.example.yml` to your server.
2. For the `cofind2.com` server, copy `deploy/.env.production.cofind2.example` to `deploy/.env.production` and replace every placeholder with production values:

Generate strong local secret values when preparing the file:

```bash
pnpm secrets:generate
```

```bash
POSTGRES_PASSWORD=change-me
JWT_ACCESS_SECRET=long-random-access-secret
JWT_REFRESH_SECRET=another-long-random-refresh-secret
MEILISEARCH_MASTER_KEY=long-random-meili-key
PUBLIC_WEB_URL=https://cofind2.com
PUBLIC_API_BASE=https://cofind2.com/api/v1
PUBLIC_API_URL=https://cofind2.com/api/v1
PAYMENT_WEBHOOK_SECRET=long-random-payment-webhook-secret
MAIL_WEBHOOK_URL=https://mail.example.com/send
MAIL_WEBHOOK_SECRET=long-random-mail-webhook-secret
MAIL_FROM=noreply@example.com
API_DOCS_ENABLED=false
TRUST_PROXY=true
```

3. Build web with production URLs and run release gate locally or in CI:

```bash
pnpm release:prepare deploy/.env.production
```

4. Start:

```bash
docker compose -f deploy/docker-compose.cofind2.yml --env-file deploy/.env.production up -d --build
```

On the `89.169.28.78` server, after unpacking the project to `/opt/cofind2`, the helper can create a generated `.env.production` and run the same commands:

```bash
bash deploy/install-cofind2.sh /opt/cofind2
```

5. Run migrations and seed/owner setup before opening traffic:

```bash
docker compose -f deploy/docker-compose.cofind2.yml --env-file deploy/.env.production exec api pnpm prisma:deploy
docker compose -f deploy/docker-compose.cofind2.yml --env-file deploy/.env.production exec api pnpm seed
```

6. Put HTTPS reverse proxy/CDN in front of `web` and `api`; start from `deploy/nginx.reverse-proxy.example.conf` if using Nginx. Keep `/uploads/images` backed up or move media to managed object storage before public traffic. The compose example includes healthchecks for Postgres, Meilisearch, API liveness and the web entrypoint.
