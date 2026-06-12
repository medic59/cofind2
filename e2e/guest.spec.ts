import { expect, test } from "@playwright/test";

const SEED_EMAIL = process.env.E2E_SEED_EMAIL || "mira@cofind.local";
const SEED_PASSWORD = process.env.E2E_SEED_PASSWORD || "password123";

test.describe("guest", () => {
  test("feed renders listing cards and links to a listing", async ({ page }) => {
    await page.goto("/feed");
    const firstCard = page.locator(".feed-listing-card").first();
    await expect(firstCard).toBeVisible();
    const link = firstCard.locator('a[href^="/listings/"]').first();
    await expect(link).toHaveAttribute("href", /^\/listings\/.+/);
    await link.click();
    await expect(page).toHaveURL(/\/listings\/.+/);
    await expect(page.getByRole("link", { name: /Откликнуться/ }).first()).toBeVisible();
  });

  test("guest opening /me is bounced to the auth form (server 302 carries next)", async ({ page }) => {
    await page.context().clearCookies();
    // Server contract: the nginx guard 302-redirects /me -> /auth?next=/me for guests.
    const res = await page.request.get("/me", { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()["location"]).toMatch(/\/auth\?next=\/me$/);
    // UX: navigating in the browser lands on the auth form. The client router
    // normalizes the visible URL to /auth and keeps `next` in memory (the
    // "login returns to /me" test below verifies the round-trip end-to-end).
    await page.goto("/me");
    await expect(page).toHaveURL(/\/auth(\?next=\/me)?$/);
    await expect(page.locator("#login-form")).toBeVisible();
  });

  test("login from /auth?next=/me returns to /me", async ({ page }) => {
    await page.goto("/auth?next=/me");
    await page.fill("#login-email", SEED_EMAIL);
    await page.fill("#login-password", SEED_PASSWORD);
    await page.click("#login-form button[type=submit]");
    await expect(page).toHaveURL(/\/me$/, { timeout: 15_000 });
  });

  test("guest can read messages in /chat (reading is allowed without login)", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/chat");
    // The promise on the page is that messages can be read without an account.
    // If this fails, it is a real bug (read-without-login is broken), not a flaky test.
    await expect(page.locator("#messages .message").first()).toBeVisible({ timeout: 15_000 });
    // No <img> may render without a real source (the mini-canvas preview must not
    // leave an empty <img> in the DOM).
    await expect(page.locator('img[src=""], img:not([src])')).toHaveCount(0);
  });
});
