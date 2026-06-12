import { expect, test } from "@playwright/test";

// Mutates data (creates a user + a listing): CI ephemeral stack only.
test("register a new user then create a listing", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const username = `e2e_${stamp}`.slice(0, 30);
  const email = `e2e_${stamp}@example.com`;
  const password = "Str0ng-e2e-pass";

  await page.goto("/auth");
  // Switch to the registration panel.
  await page.locator('[data-auth-mode="register"]').first().click();
  await page.fill("#register-email", email);
  await page.fill("#register-username", username);
  await page.fill("#register-display", `E2E ${stamp}`);
  await page.fill("#register-password", password);
  await page.click("#register-form button[type=submit]");
  await expect(page).toHaveURL(/\/me$/, { timeout: 20_000 });
  await expect(page.locator("#logout-button")).toBeVisible();

  // Create a listing.
  await page.goto("/me/listings/new");
  await page.selectOption("#listing-type", { index: 1 });
  await page.fill("#listing-title-input", `E2E заявка ${stamp} — ищу соавтора для теста`);
  const body = page.locator("#listing-body-input");
  await body.click();
  await body.fill("Тестовое описание заявки для e2e: ищу партнёра, спокойный темп, согласованные границы.");
  await page.click("#listing-submit");
  // The submit shows a success toast (or a non-error form note).
  await expect(page.locator("#toast.is-visible")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#toast")).not.toHaveText(/ошиб|не удалось|fail/i);
});
