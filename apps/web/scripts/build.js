import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

// Assets that get content-hashed into their ?v= for long-immutable caching.
const HASHED_ASSETS = ["app.js", "styles.css", "auth-boot.js", "auth-state.js", "route-guard.js", "sentry-init.js", "vendor/sentry.min.js"];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of ["index.html", "styles.css", "app.js", "auth-boot.js", "auth-state.js", "route-guard.js", "sentry-init.js", "favicon.svg", "og-image.png", "robots.txt", "_redirects"]) {
  const source = resolve(root, file);
  try {
    await stat(source);
    await cp(source, resolve(dist, file));
  } catch {
    // Optional static SEO files may be generated later.
  }
}

// Self-hosted vendor bundles (Sentry browser SDK) — served under 'self' so the
// strict script-src CSP allows them.
try {
  await cp(resolve(root, "vendor"), resolve(dist, "vendor"), { recursive: true });
} catch {
  // vendor/ is optional
}

const publicWebUrl = originFrom(process.env.PUBLIC_WEB_URL || process.env.WEB_BASE || "http://localhost:3000");
const publicApiBase = apiBaseFrom(process.env.PUBLIC_API_BASE || process.env.API_BASE || "http://localhost:4000/api/v1");

// Unique, per-page SEO copy (description + og/twitter). Public, indexable pages
// get distinct text; dynamic and noindex routes get sensible defaults.
const SITE_NAME = "Cofind 2";
const ROUTE_SEO = {
  "/": {
    ogTitle: "Cofind 2 — поиск творческих партнёров",
    description: "Cofind 2 — творческая платформа для поиска соавторов, соигроков, бета-ридеров, фандомных партнёров и творческих команд."
  },
  "/feed": {
    ogTitle: "Заявки — Cofind 2",
    description: "Лента творческих заявок Cofind 2 с фильтрами по типу, рейтингу, жанру, фандому и персонажам — найдите соавтора, соигрока или команду."
  },
  "/chat": {
    ogTitle: "Общий чат — Cofind 2",
    description: "Общий чат Cofind 2: обсуждайте идеи и ищите партнёров по фандому, жанру и темпу в реальном времени."
  },
  "/suggestions": {
    ogTitle: "Предложения каталога — Cofind 2",
    description: "Предложите новые теги, жанры, фандомы и персонажей в каталог Cofind 2."
  },
  "/help": {
    ogTitle: "Помощь — Cofind 2",
    description: "Быстрый старт Cofind 2: как заполнить профиль, найти партнёра, написать заявку и обратиться к модерации."
  },
  "/rules": {
    ogTitle: "Правила сообщества — Cofind 2",
    description: "Правила Cofind 2: уважение границ, маркировка рейтинга, запрет спама, травли и мошенничества."
  },
  "/privacy": {
    ogTitle: "Приватность — Cofind 2",
    description: "Как Cofind 2 хранит и защищает профиль, заявки, переписку, уведомления и настройки пользователя."
  },
  "/contacts": {
    ogTitle: "Контакты — Cofind 2",
    description: "Связь с поддержкой и модерацией Cofind 2, предложения по каталогу."
  },
  "/listing": {
    ogTitle: "Творческая заявка — Cofind 2",
    description: "Творческая заявка на Cofind 2: тип, рейтинг, жанры, фандомы, персонажи и ожидания автора."
  },
  "/profile": {
    ogTitle: "Профиль автора — Cofind 2",
    description: "Публичный профиль автора Cofind 2 с заявками, стилем, темпом и творческими предпочтениями."
  }
};
const DEFAULT_SEO = {
  ogTitle: SITE_NAME,
  description: "Cofind 2 — творческая платформа для поиска соавторов, соигроков и творческих команд."
};

function seoForRoute(route) {
  return ROUTE_SEO[route.path] || ROUTE_SEO[`/${route.active}`] || DEFAULT_SEO;
}

await rewriteIndex(publicWebUrl, publicApiBase);
await rewriteApp(publicApiBase);
await minifyAssets();
await writeRoutePages(publicWebUrl);
await writeRobots(publicWebUrl);
await writeNotFound();
await hashAssets();

console.log("Built apps/web/dist");

async function rewriteIndex(webUrl, apiBase) {
  const indexPath = resolve(dist, "index.html");
  let html = await readFile(indexPath, "utf8");
  const ogImage = `${webUrl}/og-image.png`;
  html = html
    .replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${escapeAttr(webUrl)}/" />`)
    .replace(/<meta property="og:image" content="[^"]*" \/>/, `<meta property="og:image" content="${escapeAttr(ogImage)}" />`)
    .replace(/<meta name="twitter:image" content="[^"]*" \/>/, `<meta name="twitter:image" content="${escapeAttr(ogImage)}" />`)
    .replace(/<meta name="cofind-api-base" content="[^"]*" \/>/, `<meta name="cofind-api-base" content="${escapeAttr(apiBase)}" />`)
    .replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${escapeAttr(webUrl)}/" />`)
    .replace(/http:\/\/localhost:4000\/api\/v1/g, escapeHtml(apiBase));
  html = injectSentry(html);
  await writeFile(indexPath, html);
}

// DSN-driven frontend Sentry: when SENTRY_DSN is set at build time, inject the
// self-hosted SDK + config meta into <head> (inherited by all route pages). The
// SDK and init are 'self' files so the strict script-src CSP allows them.
function injectSentry(html) {
  // Frontend uses its own browser-project DSN (separate from the API's SENTRY_DSN).
  const dsn = process.env.SENTRY_DSN_WEB;
  if (!dsn) return html;
  const tags = [
    `<meta name="cofind-sentry-dsn" content="${escapeAttr(dsn)}" />`,
    `<meta name="cofind-sentry-release" content="${escapeAttr(process.env.SENTRY_RELEASE || "")}" />`,
    `<meta name="cofind-sentry-environment" content="${escapeAttr(process.env.SENTRY_ENVIRONMENT || "production")}" />`,
    `<meta name="cofind-sentry-traces-rate" content="${escapeAttr(process.env.SENTRY_TRACES_SAMPLE_RATE || "0")}" />`,
    `<script defer src="/vendor/sentry.min.js"></script>`,
    `<script defer src="/sentry-init.js"></script>`
  ].join("\n    ");
  return html.replace("</head>", `    ${tags}\n  </head>`);
}

async function rewriteApp(apiBase) {
  const appPath = resolve(dist, "app.js");
  let js = await readFile(appPath, "utf8");
  js = js.replace(/"http:\/\/localhost:4000\/api\/v1"/g, `"${escapeJs(apiBase)}"`);
  await writeFile(appPath, js);
}

async function writeRoutePages(webUrl) {
  const fullIndexPath = resolve(dist, "index.html");
  const html = await readFile(fullIndexPath, "utf8");
  const shell = splitViewShell(html);
  const routes = [
    { file: "index.html", path: "/", title: "Cofind 2", views: ["home"], active: "home" },
    { file: "feed/index.html", path: "/feed", title: "Заявки - Cofind 2", views: ["feed"], active: "feed" },
    { file: "chat/index.html", path: "/chat", title: "Чат - Cofind 2", views: ["chat"], active: "chat" },
    { file: "auth/index.html", path: "/auth", title: "Вход - Cofind 2", views: ["auth"], active: "auth", noindex: true },
    { file: "me/index.html", path: "/me", title: "Личный кабинет - Cofind 2", views: ["me"], active: "me", noindex: true },
    { file: "me/appearance/index.html", path: "/me/appearance", title: "Внешний вид - Cofind 2", views: ["appearance"], active: "appearance", noindex: true },
    { file: "me/listings/new/index.html", path: "/me/listings/new", title: "Создать заявку - Cofind 2", views: ["new-listing"], active: "new-listing", noindex: true },
    { file: "me/inbox/index.html", path: "/me/inbox", title: "Сообщения - Cofind 2", views: ["inbox"], active: "inbox", noindex: true },
    { file: "me/subscription/index.html", path: "/me/subscription", title: "Подписка - Cofind 2", views: ["subscription"], active: "subscription", noindex: true },
    { file: "admin/index.html", path: "/admin", title: "Админка - Cofind 2", views: ["admin", "auth", "me"], active: "auth", noindex: true },
    { file: "listing/index.html", path: "/listing", title: "Заявка - Cofind 2", views: ["listing"], active: "listing" },
    { file: "profile/index.html", path: "/profile", title: "Профиль автора - Cofind 2", views: ["profile"], active: "profile" },
    { file: "profiles/index.html", path: "/profiles", title: "Профиль автора - Cofind 2", views: ["profile"], active: "profile" },
    { file: "u/index.html", path: "/u", title: "Профиль автора - Cofind 2", views: ["profile"], active: "profile" },
    { file: "suggestions/index.html", path: "/suggestions", title: "Предложения - Cofind 2", views: ["suggestions"], active: "suggestions" },
    { file: "help/index.html", path: "/help", title: "Помощь - Cofind 2", views: ["help"], active: "help" },
    { file: "rules/index.html", path: "/rules", title: "Правила - Cofind 2", views: ["rules"], active: "rules" },
    { file: "privacy/index.html", path: "/privacy", title: "Приватность - Cofind 2", views: ["privacy"], active: "privacy" },
    { file: "contacts/index.html", path: "/contacts", title: "Контакты - Cofind 2", views: ["contacts"], active: "contacts" },
    { file: "reports/new/index.html", path: "/reports/new", title: "Жалоба - Cofind 2", views: ["report"], active: "report", noindex: true }
  ];

  for (const route of routes) {
    let page = buildRouteHtml(shell, route);
    page = rewriteRouteMeta(page, webUrl, route);
    const target = resolve(dist, route.file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, page);
  }
}

function splitViewShell(html) {
  const starts = [...html.matchAll(/\n      <section class="[^"]*\bview\b[^"]*" id="view-([^"]+)"/g)];
  if (!starts.length) throw new Error("No view sections found in index.html");
  const firstStart = starts[0].index;
  const mainEnd = html.indexOf("\n    </main>", firstStart);
  if (mainEnd === -1) throw new Error("No </main> after view sections");
  const sections = new Map();
  starts.forEach((match, index) => {
    const id = match[1].replace(/^view-/, "");
    const start = match.index;
    const end = index + 1 < starts.length ? starts[index + 1].index : mainEnd;
    sections.set(id, html.slice(start, end));
  });
  return {
    beforeViews: html.slice(0, firstStart),
    afterViews: html.slice(mainEnd),
    sections
  };
}

function buildRouteHtml(shell, route) {
  const viewHtml = route.views.map((view) => {
    const section = shell.sections.get(view);
    if (!section) throw new Error(`View section not found: ${view}`);
    return setActiveView(section, view === route.active);
  }).join("\n");
  return `${shell.beforeViews}${viewHtml}${shell.afterViews}`;
}

function setActiveView(section, active) {
  return section.replace(/<section class="([^"]*\bview\b)(?: is-active)?([^"]*)"/, (_match, before, after) => `<section class="${before}${active ? " is-active" : ""}${after}"`);
}

function rewriteRouteMeta(html, webUrl, route) {
  const canonical = `${webUrl}${route.path === "/" ? "/" : route.path}`;
  const seo = seoForRoute(route);
  const description = seo.description;
  const ogTitle = seo.ogTitle;
  let page = html
    .replace(/<title>.*?<\/title>/, `<title>${escapeHtml(route.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeAttr(description)}" />`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${escapeAttr(ogTitle)}" />`)
    .replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${escapeAttr(description)}" />`)
    .replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${escapeAttr(ogTitle)}" />`)
    .replace(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${escapeAttr(description)}" />`)
    .replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${escapeAttr(canonical)}" />`)
    .replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${escapeAttr(canonical)}" />`);
  if (route.noindex) {
    page = page.replace(/<meta name="robots" content="[^"]*" \/>/, `<meta name="robots" content="noindex,nofollow" />`);
  }
  if (route.path === "/") {
    page = page.replace("</head>", `    ${homeJsonLd(webUrl)}\n  </head>`);
  }
  if (route.path === "/feed") {
    // Server-render the first page of cards via an nginx SSI include. The marker
    // keeps the client from clobbering them before API data arrives.
    page = page.replace(
      /<div class="listing-list" id="listing-list"([^>]*)><\/div>/,
      `<div class="listing-list" id="listing-list"$1 data-ssr-feed="pending"><!--# include virtual="/_feed_cards" --></div>`
    );
  }
  return page;
}

// Organization + WebSite structured data for the homepage (crawler-visible).
function homeJsonLd(webUrl) {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${webUrl}/#organization`,
        name: SITE_NAME,
        url: `${webUrl}/`,
        logo: `${webUrl}/og-image.png`
      },
      {
        "@type": "WebSite",
        "@id": `${webUrl}/#website`,
        name: SITE_NAME,
        url: `${webUrl}/`,
        publisher: { "@id": `${webUrl}/#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: `${webUrl}/feed?q={search_term_string}`,
          "query-input": "required name=search_term_string"
        }
      }
    ]
  };
  return `<script type="application/ld+json" id="cofind-jsonld">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

async function writeRobots(webUrl) {
  await writeFile(
    resolve(dist, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${webUrl}/sitemap.xml\n`
  );
}

// sitemap.xml is served dynamically by the API (GET /sitemap.xml via nginx) so it
// always reflects published listings with fresh lastmod and never contains query
// parameters. No static sitemap is emitted at build time.

// Honest 404 page (noindex) for unknown routes.
async function writeNotFound() {
  const page = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Страница не найдена — Cofind 2</title>
    <meta name="robots" content="noindex,nofollow" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body class="listing-ssr-page">
    <header class="listing-ssr-topbar">
      <a class="listing-ssr-brand" href="/">Cofind 2</a>
      <nav class="listing-ssr-nav" aria-label="Основная навигация">
        <a href="/feed">Заявки</a>
        <a href="/help">Как это работает</a>
        <a href="/rules">Правила</a>
        <a href="/chat">Чат</a>
        <a class="ghost-button" href="/auth">Войти</a>
        <a class="primary-button" href="/me/listings/new">Создать заявку</a>
      </nav>
    </header>
    <main class="listing-ssr-main">
      <article class="listing-ssr-card listing-ssr-notfound">
        <p class="listing-ssr-kicker">Ошибка 404</p>
        <h1 class="listing-ssr-title">Страница не найдена</h1>
        <p>Такой страницы нет или она была удалена.</p>
        <div class="listing-ssr-actions">
          <a class="primary-button" href="/feed">Открыть ленту заявок</a>
          <a class="ghost-button" href="/">На главную</a>
        </div>
      </article>
    </main>
    <footer class="site-footer">
      <nav class="footer-links" aria-label="Каталог">
        <a href="/feed">Лента заявок</a>
        <a href="/fandoms">Фандомы</a>
        <a href="/genres">Жанры</a>
        <a href="/tags">Теги</a>
      </nav>
      <nav class="footer-links" aria-label="Дополнительные ссылки">
        <a href="/help">Как это работает</a>
        <a href="/rules">Правила</a>
        <a href="/privacy">Приватность</a>
        <a href="/contacts">Контакты</a>
      </nav>
      <p class="footer-copy">© 2026 Cofind 2</p>
    </footer>
  </body>
</html>
`;
  await writeFile(resolve(dist, "404.html"), page);
}

// --- Performance: minify JS/CSS, then content-hash asset URLs for long caching ---

async function minifyAssets() {
  for (const file of ["app.js", "auth-boot.js", "auth-state.js", "route-guard.js", "sentry-init.js"]) {
    await minifyFile(file, "js");
  }
  await minifyFile("styles.css", "css");
}

async function minifyFile(file, loader) {
  const path = resolve(dist, file);
  let code;
  try {
    code = await readFile(path, "utf8");
  } catch {
    return; // optional file not present in this build
  }
  const result = await transform(code, { loader, minify: true, legalComments: "none" });
  await writeFile(path, result.code);
}

// Append a content hash to each asset's ?v= in every generated HTML, so files can
// be cached immutably for a year and a content change busts the URL automatically.
async function hashAssets() {
  const hashes = {};
  for (const asset of HASHED_ASSETS) {
    try {
      hashes[asset] = createHash("sha256").update(await readFile(resolve(dist, asset))).digest("hex").slice(0, 10);
    } catch {
      // asset absent (e.g. vendor only present when Sentry is enabled)
    }
  }
  for (const file of await collectHtml(dist)) {
    let html = await readFile(file, "utf8");
    for (const [asset, hash] of Object.entries(hashes)) {
      const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      html = html.replace(new RegExp(`"/${escaped}(\\?v=[^"]*)?"`, "g"), `"/${asset}?v=${hash}"`);
    }
    await writeFile(file, html);
  }
}

async function collectHtml(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectHtml(full)));
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

function originFrom(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Invalid protocol");
    return url.origin;
  } catch {
    throw new Error(`Invalid PUBLIC_WEB_URL/WEB_BASE: ${value}`);
  }
}

function apiBaseFrom(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Invalid protocol");
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error(`Invalid PUBLIC_API_BASE/API_BASE: ${value}`);
  }
}

function escapeAttr(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeXml(value) {
  return escapeAttr(value).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtml(value) {
  return escapeXml(value).replace(/'/g, "&#39;");
}

function escapeJs(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
