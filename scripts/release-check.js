const { readFile } = require("node:fs/promises");
const { resolve } = require("node:path");

const root = resolve(__dirname, "..");
const webDist = resolve(root, "apps/web/dist");
const webNginx = resolve(root, "apps/web/nginx.conf");

const required = [
  "DATABASE_URL",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "MEILISEARCH_HOST",
  "MEILISEARCH_MASTER_KEY",
  "PUBLIC_WEB_URL",
  "PUBLIC_API_BASE",
  "PAYMENT_WEBHOOK_SECRET",
  "MAIL_WEBHOOK_URL"
];

async function main() {
  const failures = [];
  const warnings = [];

  for (const key of required) {
    if (!value(key)) failures.push(`${key} is required`);
  }

  const webUrl = assertUrl("PUBLIC_WEB_URL", failures, { https: true });
  const apiBase = assertUrl("PUBLIC_API_BASE", failures, { https: true });
  if (value("PUBLIC_API_URL")) {
    const apiUrl = assertUrl("PUBLIC_API_URL", failures, { https: true });
    if (apiUrl && apiBase && apiUrl !== apiBase) {
      failures.push("PUBLIC_API_URL must match PUBLIC_API_BASE when both are set");
    }
  }
  assertSecret("JWT_ACCESS_SECRET", failures);
  assertSecret("JWT_REFRESH_SECRET", failures);
  assertSecret("PAYMENT_WEBHOOK_SECRET", failures);
  if (value("MAIL_WEBHOOK_SECRET")) assertSecret("MAIL_WEBHOOK_SECRET", failures);
  assertUrl("MAIL_WEBHOOK_URL", failures, { https: true });

  if (value("JWT_ACCESS_SECRET") && value("JWT_ACCESS_SECRET") === value("JWT_REFRESH_SECRET")) {
    failures.push("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ");
  }
  if (process.env.API_DOCS_ENABLED === "true" && process.env.ALLOW_PUBLIC_DOCS !== "true") {
    failures.push("API_DOCS_ENABLED=true exposes Swagger docs; set ALLOW_PUBLIC_DOCS=true only if this is intentional");
  }
  if (process.env.NODE_ENV !== "production") {
    warnings.push("NODE_ENV is not production; release runtime should set NODE_ENV=production");
  }

  await checkWebNginx(failures);
  await checkWebDist(webUrl, apiBase, failures);

  for (const warning of warnings) {
    console.warn(`WARN ${warning}`);
  }
  if (failures.length) {
    console.error("Release check failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log("Release check OK");
}

async function checkWebNginx(failures) {
  let config = "";
  try {
    config = await readFile(webNginx, "utf8");
  } catch (error) {
    failures.push(`apps/web/nginx.conf is missing (${error.message})`);
    return;
  }
  const requiredDirectives = [
    "add_header Content-Security-Policy",
    "add_header X-Content-Type-Options",
    "add_header Referrer-Policy",
    "add_header X-Frame-Options",
    "location = /index.html",
    "Cache-Control \"no-cache\"",
    "Cache-Control \"public\""
  ];
  for (const directive of requiredDirectives) {
    if (!config.includes(directive)) failures.push(`apps/web/nginx.conf missing ${directive}`);
  }
  const assetLocation = config.match(/location\s+~\*\s+\\\.\([^]*?\n\s*\}/)?.[0] || "";
  if (assetLocation && !assetLocation.includes("add_header X-Content-Type-Options")) {
    failures.push("apps/web/nginx.conf asset location must keep security headers when adding Cache-Control");
  }
}

async function checkWebDist(webUrl, apiBase, failures) {
  const files = {
    index: resolve(webDist, "index.html"),
    app: resolve(webDist, "app.js"),
    robots: resolve(webDist, "robots.txt"),
    sitemap: resolve(webDist, "sitemap.xml"),
    redirects: resolve(webDist, "_redirects")
  };
  let index = "";
  let app = "";
  let robots = "";
  let sitemap = "";
  let redirects = "";
  try {
    [index, app, robots, sitemap, redirects] = await Promise.all([
      readFile(files.index, "utf8"),
      readFile(files.app, "utf8"),
      readFile(files.robots, "utf8"),
      readFile(files.sitemap, "utf8"),
      readFile(files.redirects, "utf8")
    ]);
  } catch (error) {
    failures.push(`apps/web/dist is incomplete; run PUBLIC_WEB_URL=... PUBLIC_API_BASE=... pnpm --filter @cofind/web build (${error.message})`);
    return;
  }

  if (/(localhost|127\.0\.0\.1)/i.test(index + app + robots + sitemap)) {
    failures.push("web dist still contains localhost URLs; rebuild with PUBLIC_WEB_URL and PUBLIC_API_BASE");
  }
  if (webUrl && !index.includes(`content="${webUrl}/"`) && !index.includes(`href="${webUrl}/"`)) {
    failures.push("dist/index.html canonical or og:url does not match PUBLIC_WEB_URL");
  }
  if (apiBase && !index.includes(`content="${apiBase}"`)) {
    failures.push("dist/index.html cofind-api-base does not match PUBLIC_API_BASE");
  }
  if (apiBase && !app.includes(`"${apiBase}"`)) {
    failures.push("dist/app.js API fallback does not match PUBLIC_API_BASE");
  }
  if (webUrl && !robots.includes(`Sitemap: ${webUrl}/sitemap.xml`)) {
    failures.push("dist/robots.txt sitemap URL does not match PUBLIC_WEB_URL");
  }
  if (webUrl && !sitemap.includes(`<loc>${webUrl}/</loc>`)) {
    failures.push("dist/sitemap.xml homepage URL does not match PUBLIC_WEB_URL");
  }
  if (sitemap.includes("/me/") || sitemap.includes("/admin")) {
    failures.push("dist/sitemap.xml must not include private or admin pages");
  }
  if (!redirects.includes("/* /index.html 200")) {
    failures.push("dist/_redirects must keep the SPA fallback rule");
  }
}

function assertUrl(key, failures, options = {}) {
  const raw = value(key);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("expected http(s)");
    if (options.https && url.protocol !== "https:") failures.push(`${key} must use https for public release`);
    return key === "PUBLIC_API_BASE" || key === "PUBLIC_API_URL" ? url.toString().replace(/\/$/, "") : url.origin;
  } catch {
    failures.push(`${key} must be a valid http(s) URL`);
    return "";
  }
}

function assertSecret(key, failures) {
  const secret = value(key);
  if (!secret) return;
  if (secret.length < 32) failures.push(`${key} must be at least 32 characters`);
  if (/^(dev-|replace-with|change-me|secret|password)/i.test(secret)) {
    failures.push(`${key} still looks like a placeholder`);
  }
}

function value(key) {
  return typeof process.env[key] === "string" ? process.env[key].trim() : "";
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
