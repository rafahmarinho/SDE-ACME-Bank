import { test, expect } from "@playwright/test";
import { seedBank } from "../src/services/bank";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((state) => {
    if (!localStorage.getItem("acme-bank-demo-v1")) {
      localStorage.setItem("acme-bank-demo-v1", JSON.stringify(state));
      localStorage.setItem("acme-demo-actor", "customer-1");
    }
  }, seedBank());
});

test("transfer reserves funds, survives reload and settles through the clock", async ({ page }) => {
  await page.goto("/?view=transfers");
  await page.getByLabel("Amount").fill("100");
  await page.getByRole("button", { name: "Review transfer" }).click();
  await page.getByRole("button", { name: "Confirm payment" }).click();
  await expect(page.getByRole("heading", { name: "Transfer on its way" })).toBeVisible();
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("acme-bank-demo-v1")!).transactions.filter((entry: { status: string }) => entry.status === "pending").length)).toBe(1);
  await page.getByRole("button", { name: "Demo workspace DEMO" }).click();
  await page.getByRole("button", { name: /Riley Quinn/ }).click();
  await page.getByRole("button", { name: "Advance clock", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Simulation advanced" })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("acme-bank-demo-v1")!).transactions.filter((entry: { status: string }) => entry.status === "pending").length)).toBe(0);
});

test("card controls persist and both statement formats download", async ({ page }) => {
  await page.goto("/?view=cards");
  await page.getByRole("button", { name: "Freeze", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unfreeze", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Unfreeze", exact: true })).toBeVisible();
  await page.goto("/?view=statements");
  for (const format of ["CSV", "PDF"]) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: format, exact: true }).first().click();
    expect((await download).suggestedFilename()).toMatch(new RegExp(`\\.${format.toLowerCase()}$`));
    await expect(page.getByRole("status").filter({ hasText: "Statement downloaded" })).toBeVisible();
  }
});

test("customer navigation blocks staff access and mobile content fits", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=staff");
  await expect(page.getByRole("heading", { name: /Good morning/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Simulation studio" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});