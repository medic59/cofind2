// Smoke test for transactional emails: verification + gating, notification
// triggers, per-hour grouping, and unsubscribe. Requires NODE_ENV=test (the API
// exposes the in-memory mail outbox at /_mail/outbox only then).
// Usage: API_BASE=http://localhost:8092/api/v1 node scripts/smoke-email.js

const API = (process.env.API_BASE || "http://localhost:8092/api/v1").replace(/\/+$/, "");
const SEED_PASSWORD = process.env.E2E_SEED_PASSWORD || "password123";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` -> ${detail}` : ""}`);
  }
}

async function api(path, { method = "GET", body, token, redirect } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect });
}

const rid = () => Math.random().toString(36).slice(2, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function outbox() {
  const res = await api("/_mail/outbox");
  if (res.status === 404) return null; // not a test build
  return res.json();
}
async function clearOutbox() {
  await api("/_mail/outbox/clear", { method: "POST" });
}

async function register() {
  const id = rid();
  const email = `mailtest_${id}@example.com`;
  const res = await api("/auth/register", {
    method: "POST",
    body: { email, username: `mailtest_${id}`, displayName: `Mail ${id}`, password: "Str0ng-mail-1" }
  });
  const data = await res.json();
  return { token: data.accessToken, email, id, status: res.status };
}

async function verifyFromOutbox(email) {
  const box = (await outbox()) || [];
  const mail = [...box].reverse().find((m) => m.to === email && /Подтвердите/i.test(m.subject));
  const token = mail && (mail.text.match(/verify-email\?token=([a-f0-9]+)/) || [])[1];
  if (token) await api(`/auth/verify-email?token=${token}`, { redirect: "manual" });
  return { hadEmail: Boolean(mail), token };
}

async function registerVerified() {
  const u = await register();
  await verifyFromOutbox(u.email);
  return u;
}

async function main() {
  console.log(`Email smoke against ${API}\n`);
  if ((await outbox()) === null) {
    console.log("  /_mail/outbox is 404 — API is not in test mode; skipping email smoke.");
    return;
  }
  await clearOutbox();

  // 1. Registration sends a verification email.
  const userA = await register();
  check("register -> 201/200", userA.status === 201 || userA.status === 200, `status=${userA.status}`);
  const boxAfterRegister = await outbox();
  const verifMail = boxAfterRegister.find((m) => m.to === userA.email && /Подтвердите/i.test(m.subject));
  check("registration sends a verification email", Boolean(verifMail));

  // 2. Gating: unverified user cannot publish or respond.
  const listingRes = await api("/listings", {
    method: "POST",
    token: userA.token,
    body: { type: "COAUTHOR_SEARCH", title: `Mail gate ${userA.id} ищу соавтора`, body: "Описание заявки для проверки гейтинга по подтверждению почты." }
  });
  const listing = await listingRes.json();
  check("unverified can create a draft listing", listingRes.status === 201 || listingRes.status === 200, `status=${listingRes.status}`);
  const publishRes = await api(`/listings/${listing.id}/publish`, { method: "POST", token: userA.token });
  const publishBody = await publishRes.json().catch(() => ({}));
  check("unverified publish -> 403 EMAIL_NOT_VERIFIED", publishRes.status === 403 && publishBody.error === "EMAIL_NOT_VERIFIED", `status=${publishRes.status} error=${publishBody.error}`);

  // 3. Verify e-mail, then publishing is allowed.
  const v = await verifyFromOutbox(userA.email);
  check("verification token present in email", Boolean(v.token));
  const publishAfter = await api(`/listings/${listing.id}/publish`, { method: "POST", token: userA.token });
  check("verified publish -> not blocked", publishAfter.status !== 403, `status=${publishAfter.status}`);

  // 4. Notification trigger + grouping (<=1 email/hour/type).
  // Respond to a seeded approved listing from two fresh verified users; the
  // author should get exactly ONE response email (the second is grouped).
  const feed = await (await api("/listings?pageSize=10")).json();
  const items = Array.isArray(feed) ? feed : feed.items || feed.hits || [];
  const target = items.find((l) => l.author?.username);
  if (!target) {
    check("seeded approved listing available", false, "no listing in feed");
  } else {
    await clearOutbox();
    const responderB = await registerVerified();
    const responderC = await registerVerified();
    await api(`/listings/${target.id}/respond`, { method: "POST", token: responderB.token, body: { message: "Здравствуйте! Хочу откликнуться на вашу заявку, давайте обсудим детали." } });
    await sleep(700);
    await api(`/listings/${target.id}/respond`, { method: "POST", token: responderC.token, body: { message: "Добрый день! Тоже заинтересован в вашей заявке, готов начать в спокойном темпе." } });
    await sleep(900);
    const box = await outbox();
    const responseEmails = box.filter((m) => /отклик/i.test(m.subject));
    check("response trigger sends an email", responseEmails.length >= 1, `count=${responseEmails.length}`);
    check("grouping: second response within the hour does not send a 2nd email", responseEmails.length === 1, `count=${responseEmails.length}`);

    // 5. Unsubscribe link disables future response emails for the author.
    const unsubMatch = responseEmails[0] && responseEmails[0].text.match(/unsubscribe\?token=([a-f0-9]+)&type=response/);
    const unsubToken = unsubMatch && unsubMatch[1];
    check("response email has an unsubscribe link", Boolean(unsubToken));
    if (unsubToken) {
      const unsubRes = await api(`/unsubscribe?token=${unsubToken}&type=response`);
      check("unsubscribe -> 200", unsubRes.status === 200, `status=${unsubRes.status}`);
      // The author is a seed user; log in and confirm the preference flipped off.
      const authorEmail = responseEmails[0].to;
      const loginRes = await api("/auth/login", { method: "POST", body: { email: authorEmail, password: SEED_PASSWORD } });
      if (loginRes.ok) {
        const authorToken = (await loginRes.json()).accessToken;
        const prefs = await (await api("/me/preferences", { token: authorToken })).json();
        check("unsubscribe turned emailOnResponse off", prefs.emailOnResponse === false, `emailOnResponse=${prefs.emailOnResponse}`);
        check("unsubscribe token is not exposed in /me/preferences", prefs.unsubscribeToken === undefined);
      } else {
        console.log(`  note: could not log in as author ${authorEmail} (status ${loginRes.status}); skipping preference check.`);
      }
    }
  }

  if (failures > 0) {
    console.error(`\nemail smoke FAILED (${failures})`);
    process.exit(1);
  }
  console.log("\nemail smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
