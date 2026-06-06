const WEB_BASE = process.env.WEB_BASE || "http://localhost:3000";
const API_BASE = process.env.API_BASE || "http://localhost:4000/api/v1";

async function check(label, fn) {
  try {
    const detail = await fn();
    console.log(`OK   ${label}${detail ? ` - ${detail}` : ""}`);
    return true;
  } catch (error) {
    console.log(`FAIL ${label} - ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function fetchText(url) {
  const response = await fetch(url);
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 120)}`);
  return body;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 120)}`);
  return JSON.parse(body);
}

async function fetchRaw(url, options = {}) {
  const response = await fetch(url, options);
  const body = options.method === "HEAD" ? "" : await response.text();
  return { response, body };
}

async function main() {
  console.log(`Cofind 2 doctor`);
  console.log(`Web: ${WEB_BASE}`);
  console.log(`API: ${API_BASE}\n`);

  const results = await Promise.all([
    check("web index", async () => {
      const html = await fetchText(`${WEB_BASE}/`);
      if (!html.includes("Cofind 2")) throw new Error("index does not look like Cofind 2");
      return "index.html loaded";
    }),
    check("web assets", async () => {
      const [css, js] = await Promise.all([fetchText(`${WEB_BASE}/styles.css`), fetchText(`${WEB_BASE}/app.js`)]);
      if (!css.includes(".topbar")) throw new Error("styles.css missing topbar styles");
      if (!js.includes("apiFetch")) throw new Error("app.js missing apiFetch");
      return "styles.css and app.js loaded";
    }),
    check("web routing contract", async () => {
      const [head, fallback, missingAsset, robots, sitemap] = await Promise.all([
        fetchRaw(`${WEB_BASE}/`, { method: "HEAD" }),
        fetchRaw(`${WEB_BASE}/listing/doctor-route`),
        fetchRaw(`${WEB_BASE}/missing-doctor-asset.css`),
        fetchText(`${WEB_BASE}/robots.txt`),
        fetchText(`${WEB_BASE}/sitemap.xml`)
      ]);
      if (!head.response.ok) throw new Error(`HEAD / returned ${head.response.status}`);
      if (!head.response.headers.get("x-content-type-options")) throw new Error("missing security header");
      if (!head.response.headers.get("content-security-policy")) throw new Error("missing content security policy");
      if (!fallback.response.ok || !fallback.body.includes('id="view-listing"')) throw new Error("SPA fallback failed");
      if (missingAsset.response.status !== 404) throw new Error(`missing asset returned ${missingAsset.response.status}`);
      if (!robots.includes("Sitemap:")) throw new Error("robots.txt is missing sitemap link");
      if (!sitemap.includes(`${WEB_BASE}/`)) throw new Error("sitemap.xml does not include web base");
      return "HEAD, SPA fallback, SEO files and asset 404 OK";
    }),
    check("api health", async () => {
      const health = await fetchJson(`${API_BASE}/health`);
      if (!health.ok) throw new Error("health ok=false");
      return health.service;
    }),
    check("api readiness", async () => {
      const ready = await fetchJson(`${API_BASE}/health/ready`);
      if (!ready.dependencies?.database?.ok) throw new Error("database is not ready");
      if (!ready.dependencies?.meilisearch?.ok) throw new Error("meilisearch is not ready");
      return "database and meilisearch ready";
    }),
    check("public feed", async () => {
      const result = await fetchJson(`${API_BASE}/search/listings`);
      const hits = result.hits || result;
      if (!Array.isArray(hits)) throw new Error("search/listings did not return hits");
      return `${hits.length} listings`;
    })
  ]);

  if (results.some((ok) => !ok)) {
    process.exitCode = 1;
    return;
  }
  console.log("\nDoctor OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
