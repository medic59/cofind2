import { expect, test } from "@playwright/test";

const SEED_EMAIL = process.env.E2E_SEED_EMAIL || "mira@cofind.local";
const SEED_PASSWORD = process.env.E2E_SEED_PASSWORD || "password123";

// Header auth visibility is driven by the `is-hidden` class; these tests guard
// against a regression where the wrong set of controls is shown.
test.describe("header auth visibility", () => {
  test("guest sees Войти, not Выйти", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/");
    await expect(page.locator("#auth-button")).toBeVisible();
    await expect(page.locator("#auth-button")).toHaveText(/Войти/);
    await expect(page.locator("#logout-button")).toBeHidden();
    await expect(page.locator("#header-inbox-button")).toBeHidden();
  });

  test("authenticated user sees Выйти, not Войти", async ({ page }) => {
    await page.goto("/auth");
    await page.fill("#login-email", SEED_EMAIL);
    await page.fill("#login-password", SEED_PASSWORD);
    await page.click("#login-form button[type=submit]");
    await expect(page).toHaveURL(/\/me$/, { timeout: 15_000 });
    await expect(page.locator("#logout-button")).toBeVisible();
    await expect(page.locator("#header-inbox-button")).toBeVisible();
    // The auth button is repurposed as the profile link and no longer reads "Войти".
    await expect(page.locator("#auth-button")).not.toHaveText(/^Войти$/);
  });
});
