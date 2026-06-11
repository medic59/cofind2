// Verifies that PUBLIC endpoints never leak internal/sensitive fields, and that
// protected/unknown routes answer with the unified JSON error envelope.
// Usage: API_BASE=http://127.0.0.1:4000/api/v1 node scripts/smoke-public-fields.js

const API_BASE = (process.env.API_BASE || "http://localhost:4000/api/v1").replace(/\/+$/, "");

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` -> ${detail}` : ""}`);
  }
}

// Collect every object key appearing anywhere in a value (deep).
function collectKeys(value, acc = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, acc);
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      acc.add(key);
      collectKeys(value[key], acc);
    }
  }
  return acc;
}

function assertNoKeys(label, value, forbidden) {
  const keys = collectKeys(value);
  const leaked = forbidden.filter((key) => keys.has(key));
  check(`${label}: no forbidden fields`, leaked.length === 0, `leaked: ${leaked.join(", ")}`);
}

function assertHasKeys(label, obj, required) {
  const missing = required.filter((key) => !(obj && key in obj));
  check(`${label}: has ${required.join("/")}`, missing.length === 0, `missing: ${missing.join(", ")}`);
}

async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Accept: "application/json" } });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, contentType: res.headers.get("content-type") || "", body, text };
}

const LISTING_FORBIDDEN = [
  "authorId", "visibility", "moderationStatus", "status", "createdAt", "updatedAt",
  "reports", "_count", "role", "isPremium", "timezone", "privacySettings", "passwordHash",
  "email", "userId"
];

async function main() {
  console.log(`Public-fields smoke against ${API_BASE}\n`);

  // --- /listings ---
  const list = await getJson("/listings?pageSize=3");
  const hits = Array.isArray(list.body) ? list.body : (list.body?.items || list.body?.hits);
  check("/listings 200", list.status === 200, `status=${list.status}`);
  check("/listings has hits", Array.isArray(hits) && hits.length > 0);
  const sample = (hits || [])[0] || {};
  assertNoKeys("/listings", hits, LISTING_FORBIDDEN);
  assertHasKeys("/listings item", sample, ["id", "type", "title", "slug", "ageRating", "fandomMode", "tags", "author"]);
  assertHasKeys("/listings author", sample.author || {}, ["username", "displayName"]);

  const slug = sample.slug;
  const username = sample.author?.username;

  // --- /listings/:slug (detail, includes meta) ---
  if (slug) {
    const detail = await getJson(`/listings/${encodeURIComponent(slug)}`);
    check("/listings/:slug 200", detail.status === 200, `status=${detail.status}`);
    assertNoKeys("/listings/:slug", detail.body, LISTING_FORBIDDEN);
    assertHasKeys("/listings/:slug", detail.body || {}, ["id", "slug", "author", "meta"]);
  }

  // --- /search/listings ---
  const search = await getJson("/search/listings?pageSize=3");
  check("/search/listings 200", search.status === 200, `status=${search.status}`);
  assertNoKeys("/search/listings", search.body?.hits, LISTING_FORBIDDEN);

  // --- /chat/messages ---
  const chat = await getJson("/chat/messages");
  check("/chat/messages 200", chat.status === 200, `status=${chat.status}`);
  assertNoKeys("/chat/messages", chat.body, [
    "senderId", "sender", "isDeleted", "deletedAt", "updatedAt", "role", "email", "privacySettings", "passwordHash"
  ]);
  const msg = (chat.body || [])[0];
  if (msg) {
    assertHasKeys("/chat message", msg, ["id", "room", "text", "author", "reactions"]);
    check("/chat reactions is a counts map (not raw array)", !Array.isArray(msg.reactions) && typeof msg.reactions === "object");
  }

  // --- /profiles/:username ---
  if (username) {
    const profile = await getJson(`/profiles/${encodeURIComponent(username)}`);
    check("/profiles/:username 200", profile.status === 200, `status=${profile.status}`);
    assertNoKeys("/profiles/:username", profile.body, [
      "privacySettings", "timezone", "role", "status", "email", "passwordHash", "moderationStatus", "reports", "_count"
    ]);
    assertHasKeys("/profiles/:username", profile.body || {}, ["username", "displayName", "stats", "user"]);
  }

  // --- /tags (catalog) ---
  const tags = await getJson("/tags");
  check("/tags 200", tags.status === 200, `status=${tags.status}`);
  assertNoKeys("/tags", tags.body, ["status", "aliases", "seoTitle", "seoDescription", "createdAt", "updatedAt"]);

  // --- Unified error envelope ---
  const users = await getJson("/users");
  check("/users -> 404", users.status === 404, `status=${users.status}`);
  check("/users -> JSON error envelope", users.contentType.includes("application/json") && users.body && users.body.ok === false && typeof users.body.error === "string", users.text.slice(0, 120));

  const adminUsers = await getJson("/admin/users");
  check("/admin/users -> 401/403", adminUsers.status === 401 || adminUsers.status === 403, `status=${adminUsers.status}`);
  check("/admin/users -> JSON error envelope", adminUsers.body && adminUsers.body.ok === false && typeof adminUsers.body.error === "string", adminUsers.text.slice(0, 120));

  if (failures > 0) {
    console.error(`\npublic-fields smoke FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log("\npublic-fields smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
