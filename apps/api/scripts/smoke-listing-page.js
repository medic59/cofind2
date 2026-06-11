// Smoke test for the server-rendered listing detail endpoint.
// Verifies: an existing published slug -> 200 HTML with prerendered SEO,
// a non-existent slug -> honest 404 + noindex.
//
// Usage: API_BASE=http://127.0.0.1:4000/api/v1 node scripts/smoke-listing-page.js

const API_BASE = (process.env.API_BASE || "http://localhost:4000/api/v1").replace(/\/+$/, "");

let failures = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` -> ${detail}` : ""}`);
  }
}

async function fetchPage(path) {
  const response = await fetch(`${API_BASE}${path}`);
  const text = await response.text();
  return { status: response.status, contentType: response.headers.get("content-type") || "", text };
}

async function firstPublishedSlug() {
  const response = await fetch(`${API_BASE}/listings?pageSize=1`);
  if (!response.ok) throw new Error(`GET /listings failed: ${response.status}`);
  const data = await response.json();
  const hits = Array.isArray(data) ? data : (data.items || data.hits);
  const slug = hits && hits[0] && hits[0].slug;
  if (!slug) throw new Error("No published listing with a slug available to test against");
  return slug;
}

async function main() {
  console.log(`Listing SSR smoke against ${API_BASE}`);

  const slug = await firstPublishedSlug();
  console.log(`Using existing slug: ${slug}`);

  const existing = await fetchPage(`/listings/${encodeURIComponent(slug)}/page`);
  check("existing slug -> 200", existing.status === 200, `status=${existing.status}`);
  check("existing slug -> html content-type", existing.contentType.includes("text/html"), existing.contentType);
  check("existing slug -> canonical to /listings/<slug>", existing.text.includes(`/listings/${slug}`));
  check("existing slug -> indexable", /<meta name="robots" content="index,follow"/.test(existing.text));
  check("existing slug -> JSON-LD CreativeWork", existing.text.includes('"@type":"CreativeWork"'));
  check("existing slug -> has og:title", existing.text.includes('property="og:title"'));
  check("existing slug -> renders Откликнуться CTA", existing.text.includes("Откликнуться"));

  const missing = await fetchPage(`/listings/__cofind-no-such-listing__/page`);
  check("nonexistent slug -> 404", missing.status === 404, `status=${missing.status}`);
  check("nonexistent slug -> html content-type", missing.contentType.includes("text/html"), missing.contentType);
  check("nonexistent slug -> noindex", /<meta name="robots" content="noindex,nofollow"/.test(missing.text));

  if (failures > 0) {
    console.error(`\nlisting-page smoke FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log("\nlisting-page smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
