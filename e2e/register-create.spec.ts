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
  // The description is a TipTap editor (lazy-loaded) shadowing the hidden
  // #listing-body-input textarea; it renders a .ProseMirror surface and syncs
  // its HTML back to the textarea the submit handler reads. ProseMirror needs
  // real keystrokes (pressSequentially), not fill().
  const body = page.locator('[data-rich-editor-for="listing-body-input"] .ProseMirror');
  await expect(body).toBeVisible({ timeout: 15_000 });
  await body.click();
  await body.pressSequentially("Тестовое описание заявки для e2e: ищу партнёра, спокойный темп, согласованные границы.");
  await page.click("#listing-submit");
  // On success the handler navigates back to /me; the error path only shows a
  // toast and stays on the form. So landing on /me is the reliable success
  // signal (the transient success toast is too racy to assert directly).
  await expect(page).toHaveURL(/\/me$/, { timeout: 15_000 });
  await expect(page.locator("#logout-button")).toBeVisible();
});
