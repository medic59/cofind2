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

// Extract and parse every JSON-LD block on a page, flattening @graph. An invalid
// block is surfaced as { __invalid: true } so the smoke can fail on bad JSON.
function jsonLdObjects(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  const objs = [];
  for (const m of blocks) {
    try {
      const parsed = JSON.parse(m[1].replace(/\\u003c/g, "<"));
      for (const o of parsed["@graph"] ? parsed["@graph"] : [parsed]) objs.push(o);
    } catch {
      objs.push({ __invalid: true });
    }
  }
  return objs;
}
function ldType(objs, type) {
  return objs.find((o) => o && o["@type"] === type) || null;
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

  // Dynamic OG cards (listing / profile / catalog) must resolve to real images.
  async function checkOgImage(label, path) {
    const res = await fetch(`${BASE}${path}`);
    const ct = res.headers.get("content-type") || "";
    check(`${label} og.png returns an image`, res.status === 200 && /^image\//.test(ct), `status=${res.status} ct=${ct}`);
  }
  if (slug) await checkOgImage("listing", `/listings/${slug}/og.png`);
  if (username) await checkOgImage("profile", `/profile/${username}/og.png`);

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

  // JSON-LD structured data (automated stand-in for Google's Rich Results Test):
  // parse each page type's JSON-LD and assert the expected type + key fields.
  const home = jsonLdObjects((await getText("/")).html);
  check("home JSON-LD has no parse errors", !home.some((o) => o.__invalid));
  const homeSite = ldType(home, "WebSite");
  check("home JSON-LD WebSite + SearchAction", Boolean(homeSite) && homeSite.potentialAction?.["@type"] === "SearchAction");

  if (slug) {
    const ld = jsonLdObjects((await getText(`/listings/${slug}`)).html);
    const work = ld.find((o) => o["@type"] === "CreativeWork");
    check("listing JSON-LD CreativeWork has name + url", Boolean(work && work.name && work.url));
  }
  if (username) {
    const ld = jsonLdObjects((await getText(`/profile/${username}`)).html);
    const person = ldType(ld, "Person");
    check("profile JSON-LD Person has name + url", Boolean(person && person.name && person.url));
  }
  const fandomLoc = locs.find((l) => /\/fandoms\/[^/]+$/.test(l));
  if (fandomLoc) {
    const fandomPath = fandomLoc.replace(/^https?:\/\/[^/]+/, "");
    const ld = jsonLdObjects((await getText(fandomPath)).html);
    const crumbs = ldType(ld, "BreadcrumbList");
    check("catalog detail JSON-LD BreadcrumbList has trail", Array.isArray(crumbs?.itemListElement) && crumbs.itemListElement.length >= 2);
    await checkOgImage("catalog", `${fandomPath}/og.png`);
  }
  const fandomsIndexLd = jsonLdObjects((await getText("/fandoms")).html);
  check("catalog index JSON-LD has CollectionPage", Boolean(ldType(fandomsIndexLd, "CollectionPage")));

  // /feed first page is server-rendered (cards visible to crawlers), and filter
  // variants canonicalize to the clean /feed (only the base page is indexed).
  const feedHtml = (await getText("/feed")).html;
  check("/feed has server-rendered listing cards", /feed-listing-card/.test(feedHtml) && /href="\/listings\//.test(feedHtml));
  const feedFandom = locs.find((l) => /\/fandoms\/[^/]+$/.test(l));
  if (feedFandom) {
    const fslug = feedFandom.split("/fandoms/")[1];
    const filtered = await getText(`/feed?fandom=${fslug}`);
    check("/feed?fandom=… canonical points to clean /feed", canonical(filtered.html) === `${BASE}/feed`, `canonical=${canonical(filtered.html)}`);
  }

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
