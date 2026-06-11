import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of ["index.html", "styles.css", "app.js", "auth-boot.js", "auth-state.js", "route-guard.js", "favicon.svg", "robots.txt", "sitemap.xml", "_redirects"]) {
  const source = resolve(root, file);
  try {
    await stat(source);
    await cp(source, resolve(dist, file));
  } catch {
    // Optional static SEO files may be generated later.
  }
}

const publicWebUrl = originFrom(process.env.PUBLIC_WEB_URL || process.env.WEB_BASE || "http://localhost:3000");
const publicApiBase = apiBaseFrom(process.env.PUBLIC_API_BASE || process.env.API_BASE || "http://localhost:4000/api/v1");

await rewriteIndex(publicWebUrl, publicApiBase);
await rewriteApp(publicApiBase);
await writeRoutePages(publicWebUrl);
await writeRobots(publicWebUrl);
await writeSitemap(publicWebUrl);

console.log("Built apps/web/dist");

async function rewriteIndex(webUrl, apiBase) {
  const indexPath = resolve(dist, "index.html");
  let html = await readFile(indexPath, "utf8");
  html = html
    .replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${escapeAttr(webUrl)}/" />`)
    .replace(/<meta name="cofind-api-base" content="[^"]*" \/>/, `<meta name="cofind-api-base" content="${escapeAttr(apiBase)}" />`)
    .replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${escapeAttr(webUrl)}/" />`)
    .replace(/http:\/\/localhost:4000\/api\/v1/g, escapeHtml(apiBase));
  await writeFile(indexPath, html);
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
    { file: "me/index.html", path: "/me", title: "Личный кабинет - Cofind 2", views: ["me", "auth"], active: "auth", noindex: true },
    { file: "me/appearance/index.html", path: "/me/appearance", title: "Внешний вид - Cofind 2", views: ["appearance", "auth"], active: "auth", noindex: true },
    { file: "me/listings/new/index.html", path: "/me/listings/new", title: "Создать заявку - Cofind 2", views: ["new-listing", "auth"], active: "auth", noindex: true },
    { file: "me/inbox/index.html", path: "/me/inbox", title: "Сообщения - Cofind 2", views: ["inbox", "auth"], active: "auth", noindex: true },
    { file: "me/subscription/index.html", path: "/me/subscription", title: "Подписка - Cofind 2", views: ["subscription", "auth"], active: "auth", noindex: true },
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
    { file: "reports/new/index.html", path: "/reports/new", title: "Жалоба - Cofind 2", views: ["report", "auth"], active: "auth", noindex: true }
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
  let page = html
    .replace(/<title>.*?<\/title>/, `<title>${escapeHtml(route.title)}</title>`)
    .replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${escapeAttr(canonical)}" />`)
    .replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${escapeAttr(canonical)}" />`);
  if (route.noindex) {
    page = page.replace(/<meta name="robots" content="[^"]*" \/>/, `<meta name="robots" content="noindex,nofollow" />`);
  }
  return page;
}

async function writeRobots(webUrl) {
  await writeFile(
    resolve(dist, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${webUrl}/sitemap.xml\n`
  );
}

async function writeSitemap(webUrl) {
  const routes = [
    ["/", "1.0"],
    ["/feed", "0.9"],
    ["/feed?page=2", "0.75"],
    ["/feed?page=3", "0.65"],
    ["/chat", "0.7"],
    ["/suggestions", "0.4"],
    ["/help", "0.6"],
    ["/rules", "0.45"],
    ["/privacy", "0.45"],
    ["/contacts", "0.35"]
  ];
  const urls = routes
    .map(([path, priority]) => [
      "  <url>",
      `    <loc>${escapeXml(`${webUrl}${path}`)}</loc>`,
      `    <priority>${priority}</priority>`,
      "  </url>"
    ].join("\n"))
    .join("\n");
  await writeFile(
    resolve(dist, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  );
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
