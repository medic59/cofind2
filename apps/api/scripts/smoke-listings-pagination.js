// Pagination contract + limit-boundary tests for GET /api/v1/listings.
// Usage: API_BASE=http://127.0.0.1:4000/api/v1 node scripts/smoke-listings-pagination.js

const API_BASE = (process.env.API_BASE || "http://localhost:4000/api/v1").replace(/\/+$/, "");

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` -> ${detail}` : ""}`);
  }
}

async function get(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Accept: "application/json" } });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function main() {
  console.log(`Listings pagination smoke against ${API_BASE}\n`);

  // --- Default envelope ---
  const def = await get("/listings");
  check("/listings 200", def.status === 200, `status=${def.status}`);
  const b = def.body || {};
  check("envelope has items[]", Array.isArray(b.items));
  check("envelope has numeric total", typeof b.total === "number");
  check("default page = 1", b.page === 1, `page=${b.page}`);
  check("default pageSize = 20", b.pageSize === 20, `pageSize=${b.pageSize}`);
  check("has totalPages", typeof b.totalPages === "number");
  check("items.length <= pageSize", Array.isArray(b.items) && b.items.length <= b.pageSize);
  check("nextPage matches totalPages", b.nextPage === (b.totalPages > 1 ? 2 : null), `nextPage=${b.nextPage} totalPages=${b.totalPages}`);
  check("items are serialized (no authorId)", (b.items || []).every((it) => !("authorId" in it) && !("moderationStatus" in it)));

  // --- limit boundaries ---
  const five = await get("/listings?limit=5");
  check("limit=5 -> pageSize 5", five.body?.pageSize === 5, `pageSize=${five.body?.pageSize}`);
  check("limit=5 -> <=5 items", (five.body?.items || []).length <= 5);

  const fifty = await get("/listings?limit=50");
  check("limit=50 -> pageSize 50", fifty.body?.pageSize === 50, `pageSize=${fifty.body?.pageSize}`);

  const overLimit = await get("/listings?limit=100");
  check("limit=100 -> 200 (not rejected)", overLimit.status === 200, `status=${overLimit.status}`);
  check("limit=100 -> clamped to 50", overLimit.body?.pageSize === 50, `pageSize=${overLimit.body?.pageSize}`);

  const overPageSize = await get("/listings?pageSize=100");
  check("pageSize=100 -> clamped to 50", overPageSize.status === 200 && overPageSize.body?.pageSize === 50, `status=${overPageSize.status} pageSize=${overPageSize.body?.pageSize}`);

  const zero = await get("/listings?limit=0");
  check("limit=0 -> rejected (400)", zero.status === 400, `status=${zero.status}`);

  // --- page navigation (skip works) ---
  const p1 = await get("/listings?pageSize=1&page=1");
  const p2 = await get("/listings?pageSize=1&page=2");
  if ((p1.body?.total || 0) > 1) {
    check("page=2 returns a different item than page=1", p1.body?.items?.[0]?.id !== p2.body?.items?.[0]?.id, `p1=${p1.body?.items?.[0]?.id} p2=${p2.body?.items?.[0]?.id}`);
    check("total stable across pages", p1.body?.total === p2.body?.total);
    check("page=2 nextPage/page correct", p2.body?.page === 2);
  } else {
    console.log("  ..   page navigation skipped (need >1 listing)");
  }

  // --- filters intact ---
  const type = b.items?.[0]?.type;
  if (type) {
    const filtered = await get(`/listings?type=${encodeURIComponent(type)}&limit=50`);
    check(`filter type=${type} -> 200`, filtered.status === 200);
    check(`filter type=${type} -> every item matches`, (filtered.body?.items || []).every((it) => it.type === type));
    check(`filter total <= unfiltered total`, (filtered.body?.total ?? 0) <= b.total);
  }
  // invalid enum filter still rejected
  const badType = await get("/listings?type=NOPE");
  check("invalid type enum -> 400", badType.status === 400, `status=${badType.status}`);

  if (failures > 0) {
    console.error(`\nlistings-pagination smoke FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log("\nlistings-pagination smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
