import { test, expect, type Page } from "@playwright/test";
import { seedBank, type BankState } from "../src/services/bank";
import { privacyNotice } from "../src/services/privacy";

const open = async (page: Page, state: BankState, path: string) => {
  await page.addInitScript((world) => {
    if (!localStorage.getItem("acme-bank-demo-v1")) {
      localStorage.setItem("acme-bank-demo-v1", JSON.stringify(world));
      localStorage.setItem("acme-demo-actor", "customer-1");
    }
  }, state);
  await page.goto(path);
};

test("a changed privacy notice is reviewed before anything else, with nothing optional preselected", async ({ page }) => {
  const state = seedBank();
  state.customers[0].privacy = { ...state.customers[0].privacy!, notice: "2026-01-01" };
  await open(page, state, "/?view=overview");
  await expect(page.getByRole("heading", { name: "Review how we use your data" })).toBeVisible();
  const choices = page.locator(".privacy-box input[type=checkbox]");
  await expect(choices).toHaveCount(3);
  for (const choice of await choices.all()) await expect(choice).not.toBeChecked();
  await page.getByText(`Read the full privacy notice (version ${privacyNotice.version})`).click();
  await expect(page.getByText("How long it is kept")).toBeVisible();
  await expect(page.getByRole("button", { name: "Decline and sign out" })).toBeVisible();
  await page.getByRole("button", { name: "Accept and continue" }).click();
  await expect(page.getByRole("heading", { name: /Good morning/ })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("acme-bank-demo-v1")!).customers[0].privacy);
  expect(saved).toMatchObject({
    notice: privacyNotice.version,
    language: "en",
    consents: { notifications: false, "statement-archive": false },
    restricted: [],
  });
});

test("withdrawing consent and restricting simulations take effect at once", async ({ page }) => {
  await open(page, seedBank(), "/?view=settings");
  await expect(page.getByRole("heading", { name: "Privacy and consent" })).toBeVisible();
  const notifications = page.getByRole("checkbox", { name: /Account notifications/ });
  await expect(notifications).toBeChecked();
  await notifications.uncheck();
  await page.getByRole("checkbox", { name: /Restrict: use my account in simulation scenarios/ }).check();
  await page.getByRole("button", { name: "Save privacy choices" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Privacy choices saved." })).toBeVisible();
  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(page.getByText("Notifications are disabled in Settings.")).toBeVisible();
  await page.keyboard.press("Escape");
  // An administrator can no longer run simulation scenarios on this customer's account.
  await page.getByRole("button", { name: "Demo workspace DEMO" }).click();
  await page.getByRole("button", { name: /Riley Quinn/ }).click();
  await page.getByRole("button", { name: "Run scenario" }).click();
  await expect(page.getByRole("alert").first()).toContainText("restricted the use of their account in simulations");
});
