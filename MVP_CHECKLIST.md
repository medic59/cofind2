# Cofind 2 MVP Checklist

## Local Run

1. Start infrastructure:

```bash
docker compose up -d postgres redis meilisearch
```

2. Prepare database:

```bash
copy .env.example .env
pnpm --filter @cofind/api prisma:migrate --name init
pnpm --filter @cofind/api seed
```

3. Start API:

```bash
pnpm --filter @cofind/api dev
```

For the prepared local dev database/search ports, this helper sets the required env vars:

```powershell
pnpm api:dev:local
```

4. Start web:

```bash
pnpm --filter @cofind/web dev
```

5. Open:

- Web: `http://localhost:3000`
- API: `http://localhost:4000/api/v1`
- Swagger: `http://localhost:4000/api/docs`
- Liveness: `http://localhost:4000/api/v1/health/live`
- Readiness: `http://localhost:4000/api/v1/health/ready`

## Smoke

Run after API and web are started:

```bash
pnpm doctor
pnpm ux:audit
pnpm smoke
pnpm --filter @cofind/api smoke
pnpm --filter @cofind/api smoke:ws
pnpm --filter @cofind/web smoke
pnpm run build
```

## Release Gate

- Set production env: `NODE_ENV=production`, `DATABASE_URL`, strong unique `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`, `MEILISEARCH_HOST`, `MEILISEARCH_MASTER_KEY`, `PUBLIC_WEB_URL`, `PUBLIC_API_BASE`, optional matching `PUBLIC_API_URL`, `PAYMENT_WEBHOOK_SECRET`, `API_DOCS_ENABLED=false`.
- Configure transactional mail: `MAIL_WEBHOOK_URL`, optional `MAIL_WEBHOOK_SECRET`, and `MAIL_FROM`.
- Build web with `PUBLIC_WEB_URL` and `PUBLIC_API_BASE`; verify `apps/web/dist/index.html`, `robots.txt` and `sitemap.xml` use HTTPS production URLs, not localhost.
- Or run `pnpm release:prepare deploy/.env.production` to build web from production env and execute the release gate.
- Run `pnpm release:check` and fix every failure before deploy.
- Confirm API refuses production startup with missing/default secrets and Swagger is unavailable unless intentionally enabled.
- Confirm payment provider sends `x-cofind-webhook-secret` matching `PAYMENT_WEBHOOK_SECRET`.
- Confirm password reset sends an email in production and `/auth?resetToken=...&email=...` opens the reset form with token prefilled.
- Confirm CORS allows the public web domain and rejects unrelated browser origins.
- If API is behind Nginx/Cloudflare/load balancer, set `TRUST_PROXY=true` and verify rate limits use the client IP.
- Confirm backups exist for Postgres and local uploads or move `/uploads/images` to managed object storage before public traffic.
- Run `pnpm --filter @cofind/api uploads:audit` against the production database/filesystem before first public traffic; use `uploads:cleanup` only after backup.

## Manual Acceptance

- Register and log in.
- Leave the session open long enough for access-token renewal or verify `/auth/refresh` through smoke.
- Open feed, use search, type, rating, genre, fandom and character filters.
- On feed, verify the list exposes loading/fallback status while refreshing from API.
- Verify feed filters/sort are reflected in `/feed?...` and Back/Forward restores the same feed state.
- Open feed pagination, verify `/feed?page=N` URLs work and browser Back/Forward returns between pages/screens.
- Call `/listings?page=1&pageSize=2` and verify `hits + pagination`, then call `/listings` without `page` and verify legacy array compatibility.
- Inspect feed page head tags and verify canonical plus prev/next update across pagination and preserve active filters.
- On home, open a latest listing from the live block and open global chat from the latest messages block.
- On home, click a popular direction chip and verify feed opens with that query applied.
- Open auth from the header, verify e-mail login is shown first, then switch to registration and back.
- From auth, open password recovery, request a reset token in dev, set a new password and verify login works.
- In `/me`, change password with the current password, then verify login works with the new password.
- As a guest, open `/me/inbox` or create listing, verify login opens and successful auth returns to the requested screen.
- As a guest, open `/me/inbox?conversation=<id>` and verify login/registration returns to the same URL with query preserved.
- Open direct SPA URLs like `/listing/<id>`, `/profile/<username>`, `/me/inbox`, `/feed` and verify the expected screen loads after fallback.
- Open `/help`, `/rules`, `/privacy`, `/contacts`; verify Back/Forward, title/description/canonical and sitemap links.
- In `/me`, fill website, Telegram and Discord, save profile, then open `/profile/:username` and verify public social links render correctly.
- Open `/profile/:username` and verify author metrics show published listings, total likes, total responses, last activity and Premium state.
- Open `/profiles/:username?page=1&pageSize=2` through API and verify `listingsPagination` plus profile `stats` cover all published author listings, not only the current page.
- On `/profile/:username`, search inside author listings, verify the found/total counter, switch sort between new/popular/responses and move between local listing pages.
- On `/profile/:username?listingsPage=2`, verify Back/Forward restores the author listing page; then use author listing search/sort and verify URL, canonical and prev/next stay consistent.
- Inspect `/profile/:username` JSON-LD and verify `Person.sameAs`, `knowsAbout` and interaction counters are present when profile data exists.
- Copy a listing link and a profile link, then open them in a fresh tab.
- Open notification links for inbox/subscription/reports and verify the target screen opens and the notification becomes read.
- Verify notification action labels match their destination and empty notifications offer opening inbox.
- Call `/notifications?page=1&pageSize=5`, `/me/payments?page=1&pageSize=2`, `/me/liked-listings?page=1&pageSize=2`, `/suggestions/my?page=1&pageSize=2` and `/reports/my?page=1&pageSize=2`; verify `hits + pagination` while endpoints without `page` still return arrays.
- Open a listing, like it, report it, open the author profile.
- From the public profile, block the author and verify the block appears in `/me`, then unblock.
- In `/me`, search the block-list and verify the counter changes before unblocking.
- From the public profile, open a report and verify the report form is prefilled with `PROFILE` and the author id.
- Open `/reports/new?entityType=PROFILE&entityId=<id>` directly and verify the report form is prefilled.
- From the public profile, click “Написать” and verify `/me/inbox?conversation=...` opens the direct dialog without creating duplicates.
- Open a public profile after user activity and verify the “последняя активность” metric updates from `lastSeenAt`.
- In `/me`, turn off last activity and profile messages, then verify public profile hides activity and disables “Написать”.
- In `/me`, choose a preset avatar, upload a small image avatar, save profile and verify it appears in the header and chat.
- In `/me`, replace uploaded avatar/cover with another uploaded image and verify the old local `/uploads/images/...` URL returns 404.
- In `/me`, clear uploaded avatar/cover and verify the old local `/uploads/images/...` URL returns 404 and profile fields become `null`.
- In `/me`, try an unsupported or oversized avatar/cover image and verify the UI rejects it before upload with a clear message.
- Try unsafe avatar, cover, background, social and ad URLs through API smoke/manual request and verify non-`http(s)` unsafe schemes are rejected or not rendered.
- In `/me`, verify profile readiness reacts to avatar, cover, bio, creative tags, contacts, first listing and first contact.
- In `/me`, fill literacy, post length and communication preferences, save profile and verify they appear on the public profile.
- Verify public profile shows style, literacy, post length, activity pace and communication preferences in the format block.
- After image avatar upload with API online, verify profile saves an `/uploads/images/...` URL and the image is reachable after refresh.
- In `/me`, upload a small profile cover, save profile and verify the cover appears in `/me` and `/profile/:username` after refresh.
- In `/me`, click “Скачать мои данные” and verify JSON downloads and does not contain `passwordHash`.
- On a test account, enter password in `/me` deactivation block, confirm, and verify logout plus hidden public profile.
- Before deactivating a test account, send a chat drawing and verify deactivation removes the old local `/uploads/images/...` drawing URL.
- In admin users table, restore a `DELETED` test account and verify the user must still reset password before login.
- In `/me/appearance`, upload a small background image, save it and verify `/me/preferences` keeps the `/uploads/images/...` URL.
- In `/me/appearance`, replace uploaded background image and verify the old local `/uploads/images/...` URL returns 404.
- In `/me/appearance`, remove the background image and verify preferences clear it and the old local `/uploads/images/...` URL returns 404.
- In `/me/appearance`, try an unsupported or oversized background image and verify the UI rejects it before preview/upload.
- With API online, send a mini-canvas drawing and verify the chat message stores an `/uploads/images/...` URL.
- From listing detail, click related tag/world links and verify feed filters are applied.
- On listing detail, verify metrics are visible, response template fills the textarea, and closed listings disable the response form.
- Use rich editor buttons in listing body, listing response, global chat and private messages; verify preview and rendered formatting.
- Use the contenteditable WYSIWYG editor in listing body, listing response, global chat and private messages; verify visible formatting, emoji insertion, undo/redo and rendered safe HTML.
- Try unsafe rich HTML through API smoke/manual request and verify `script`, inline handlers and `javascript:` links are removed server-side.
- Type heavily formatted long text in the rich editor and verify counters show visible text length while the submit button blocks content that exceeds the stored 4000-character limit.
- Refresh after liking a listing or chat message and verify `likedByMe`/active UI state is restored for the logged-in user.
- In `/me`, search and sort liked listings, then unlike one item and verify it disappears from the filtered list.
- Create a draft listing, edit it, publish it and verify it appears after moderation.
- Call `/listings/mine?page=1&pageSize=2`, `/listings/mine/responses?page=1&pageSize=2`, `/listings/mine/incoming-responses?page=1&pageSize=2` and `/listings/:id/responses?page=1&pageSize=2`; verify `hits + pagination` while endpoints without `page` still return arrays.
- In `/me`, search and sort “Мои заявки” across statuses, then verify the visible counter and empty search state.
- Delete a test listing from `/me` and verify it disappears from “Мои заявки” and public detail returns 404.
- Restore the deleted listing from admin queue and verify it returns to owner drafts as `DRAFT/PENDING`.
- Send a response to a listing from another user.
- Accept or decline an incoming response from `/me/inbox`.
- In `/me/inbox`, search the inbox list and switch sorting by fresh/unread/status/title across tabs.
- Open a private conversation, send and delete your own message.
- In a private conversation with more than 50 messages, click “Загрузить старые сообщения” and verify older messages appear above without losing scroll position.
- Verify inbox summary counters and private composer counter/empty-submit disabled state.
- Send, quote, react to and delete your own global chat message.
- Verify chat composer counter, empty-submit disabled state and WS/REST status note.
- Switch global chat rooms, verify `/chat?room=...` updates/restores through Back/Forward, copy a room link and send a themed message.
- Verify listing likes and chat likes toggle on/off, and chat emoji reactions switch one active emoji per user instead of increasing on every click.
- Verify filtered search shows newly moderated published listings before manual reindex and does not show hidden/unavailable authors.
- Draw on the mini-canvas, verify preview appears in the composer, send it and confirm the drawing is visible in chat.
- Delete your own mini-canvas chat message and verify the old local `/uploads/images/...` drawing URL returns 404.
- Attach a mini-canvas drawing over the image limit and verify the composer keeps it unsent with a clear message.
- Send a mini-canvas drawing without extra text and verify API stores the default drawing message text plus the image URL.
- Open subscription page and activate dev Premium checkout.
- Before public launch, verify `/settings` returns `monetizationEnabled=false`, `/subscription/plans` returns `[]`, the header has no Premium button, and `/me/subscription` redirects away or shows the disabled state.
- Log in as OWNER/ADMIN, open admin, toggle paid functions on, verify Premium button/plans/checkout appear; toggle them off again and verify they disappear.
- On subscription page, cancel active Premium and verify status returns to Free/Canceled and ads are visible again.
- On subscription page, search/filter payment history by status and verify the counter.
- Log in as staff and moderate reports, suggestions and listings.
- In admin moderation queue, search and filter by type/status, then verify queue counters before acting.
- In admin users table, search by name/email, filter role/status and verify the visible counter.
- In admin users table, verify the last activity note appears next to user status.
- In admin catalog blocks, search tags/genres/fandoms/characters, filter status and verify visible counters before editing.
- Update catalog items, ad placements, Premium plans and SEO pages in admin.
- In admin plans, ads and SEO blocks, use search/filters and verify counters before editing an item.
- In admin finance block, search payments/subscriptions, filter type/status and verify the visible counter.
- In admin audit log, search by action/actor/object, filter entity type and verify the visible counter.
- On suggestions and reports pages, submit test items, then search/filter personal history and verify counters.
- Verify ad placements respect active dates, impression limits, Premium hiding and invalid schedule validation.
- Verify staff hierarchy: moderator cannot act on owner/admin, and admin cannot assign an equal/higher role.
- Verify banned/temp-banned authors disappear from public profile, listing detail and search.
- Check mobile width around 360-430px for topbar, feed, listing detail, inbox and admin.
- Confirm the header API badge shows online when ready and stays usable with a partial warning if only search is degraded.

Seed users all use password `password123`:

- `owner@cofind.local`
- `mod@cofind.local`
- `mira@cofind.local`
- `arlen@cofind.local`
- `lysa@cofind.local`
