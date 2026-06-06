# Cofind 2 Server Move Checklist

## 1. Server baseline

- Install Docker Engine and Docker Compose plugin.
- Point DNS records:
  - `cofind2.com` -> `89.169.28.78`
  - optional `www.cofind2.com` -> `89.169.28.78`
- Open ports `80` and `443`; keep Postgres, Meilisearch and internal app ports closed to the public network when possible.
- Create a project directory, for example `/opt/cofind2`.

## 2. Files to place on the server

- Project source.
- `deploy/docker-compose.cofind2.yml`.
- `deploy/Caddyfile.cofind2`.
- `deploy/.env.production` created from `deploy/.env.production.cofind2.example`.
- Optional Nginx alternative based on `deploy/nginx.reverse-proxy.example.conf`.

## 3. Before first deploy

```bash
pnpm install --frozen-lockfile
pnpm secrets:generate
cp deploy/.env.production.cofind2.example deploy/.env.production
```

Fill real values in `deploy/.env.production`, then run locally or in CI:

```bash
pnpm release:prepare deploy/.env.production
pnpm ux:audit
```

If local API/web are running, also run `pnpm smoke`.

## 4. Start on the server

```bash
docker compose -f deploy/docker-compose.cofind2.yml --env-file deploy/.env.production up -d --build
docker compose -f deploy/docker-compose.cofind2.yml --env-file deploy/.env.production exec api pnpm prisma:deploy
docker compose -f deploy/docker-compose.cofind2.yml --env-file deploy/.env.production exec api pnpm seed
```

Shortcut after unpacking the project to `/opt/cofind2`:

```bash
bash deploy/install-cofind2.sh /opt/cofind2
```

## 5. Verify after start

```bash
docker compose -f deploy/docker-compose.cofind2.yml --env-file deploy/.env.production ps
curl -f https://cofind2.com/api/v1/health/live
curl -f https://cofind2.com/api/v1/health/ready
curl -I https://cofind2.com/
```

Manual browser checks:

- Register and log in.
- Open `/feed`, `/chat`, `/me`, `/admin`.
- Upload avatar and send a mini-canvas drawing.
- Check browser Back/Forward on `/feed?page=2`, `/admin?tab=users`, `/chat?room=partners`.
- Confirm Premium is hidden while `monetizationEnabled=false`.

## 6. Backups before public traffic

- Back up Postgres volume.
- Back up `uploads-data` volume.
- Run `pnpm --filter @cofind/api uploads:audit` before using `uploads:cleanup`.
