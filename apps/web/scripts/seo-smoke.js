// SEO regression smoke: crawls public URLs and checks unique title/description,
// canonical == page URL (incl. /profile/<username>), og:image, and the sitemap.
// Usage: BASE_URL=https://cofind2.com node scripts/seo-smoke.js
const BASE = (process.env.BASE_URL || "https://cofind2.com").replace(/\/+$/, "");

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` -> ${detail}` : ""}`);
  }
}

function meta(html, re) {
  const m = html.match(re);
  return m ? m[1] : null;
}
function title(html) {
  return meta(html, /<title>([^<]*)<\/title>/i);
}
function description(html) {
  return meta(html, /<meta\s+name="description"\s+content="([^"]*)"/i);
}
function canonical(html) {
  return meta(html, /<link\s+rel="canonical"\s+href="([^"]*)"/i);
}
function ogImage(html) {
  return meta(html, /<meta\s+property="og:image"\s+content="([^"]*)"/i);
}

function expectedCanonical(path) {
  if (path === "/") return `${BASE}/`;
  return `${BASE}${path}`;
}

async function getText(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: "text/html" } });
  return { status: res.status, html: await res.text() };
}

async function discover() {
  const res = await fetch(`${BASE}/api/v1/listings?pageSize=1`);
  const data = await res.json();
  const hit = (Array.isArray(data) ? data : data.items || data.hits || [])[0] || {};
  return { slug: hit.slug, username: hit.author?.username };
}

async function main() {
  console.log(`SEO smoke against ${BASE}\n`);
  const { slug, username } = await discover();

  const paths = ["/", "/feed", "/help", "/rules", "/privacy", "/contacts", "/suggestions", "/chat", "/fandoms"];
  if (slug) paths.push(`/listings/${slug}`);
  if (username) paths.push(`/profile/${username}`);

  const titles = new Map();
  const descriptions = new Map();

  for (const path of paths) {
    const { status, html } = await getText(path);
    const t = title(html);
    const d = description(html);
    const c = canonical(html);
    const img = ogImage(html);
    check(`${path} -> 200`, status === 200, `status=${status}`);
    check(`${path} has non-empty <title>`, Boolean(t && t.trim()));
    check(`${path} has non-empty description`, Boolean(d && d.trim()));
    check(`${path} canonical == page URL`, c === expectedCanonical(path), `canonical=${c} expected=${expectedCanonical(path)}`);
    check(`${path} has og:image`, Boolean(img && /^https?:\/\//.test(img)));
    if (t) titles.set(path, t.trim());
    if (d) descriptions.set(path, d.trim());
  }

  // Uniqueness across the indexable static pages (dynamic listing/profile excluded).
  const staticPaths = ["/", "/feed", "/help", "/rules", "/privacy", "/contacts", "/suggestions", "/chat"];
  const staticTitles = staticPaths.map((p) => titles.get(p)).filter(Boolean);
  const staticDescs = staticPaths.map((p) => descriptions.get(p)).filter(Boolean);
  check("static page titles are unique", new Set(staticTitles).size === staticTitles.length);
  check("static page descriptions are unique", new Set(staticDescs).size === staticDescs.length);

  // Profile canonical must carry the username (no collapse to /profile).
  if (username) {
    check("/profile/<username> canonical carries username", canonical((await getText(`/profile/${username}`)).html)?.endsWith(`/profile/${username}`));
  }

  // The listing's dynamic OG card must resolve to a real image.
  if (slug) {
    const ogRes = await fetch(`${BASE}/listings/${slug}/og.png`);
    const ct = ogRes.headers.get("content-type") || "";
    check("listing og.png returns an image", ogRes.status === 200 && /^image\//.test(ct), `status=${ogRes.status} ct=${ct}`);
  }

  // Sitemap: <loc> URLs must have no query params; listings + fandoms present;
  // every <lastmod> a valid ISO timestamp. If the root is a sitemap index, pull
  // the per-type sub-sitemaps and assert over their combined entries.
  const root = await getText("/sitemap.xml");
  check("sitemap 200", root.status === 200);
  let sitemapXml = root.html;
  if (/<sitemapindex/i.test(root.html)) {
    const childPaths = [...root.html.matchAll(/<loc>([^<]*)<\/loc>/g)]
      .map((m) => m[1].replace(/^https?:\/\/[^/]+/, ""));
    const children = await Promise.all(childPaths.map((p) => getText(p)));
    sitemapXml = children.map((c) => c.html).join("\n");
  }
  const locs = [...sitemapXml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  const lastmods = [...sitemapXml.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)].map((m) => m[1]);
  check("sitemap <loc> URLs have no query parameters", locs.length > 0 && locs.every((loc) => !loc.includes("?")), locs.find((loc) => loc.includes("?")) || "");
  check("sitemap includes at least one listing URL", locs.some((loc) => loc.includes("/listings/")));
  check("sitemap includes at least one fandom URL", locs.some((loc) => loc.includes("/fandoms/")));
  check("sitemap has lastmod entries", lastmods.length > 0);
  check(
    "sitemap lastmod values are valid ISO timestamps",
    lastmods.length > 0 && lastmods.every((v) => new Date(v).toISOString() === v),
    lastmods.find((v) => new Date(v).toISOString() !== v) || ""
  );

  if (failures > 0) {
    console.error(`\nseo smoke FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log("\nseo smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
