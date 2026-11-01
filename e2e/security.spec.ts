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

test("pages carry a per-request nonce CSP and render without violations", async ({ page, request }) => {
  const first = await request.get("/");
  const policy = first.headers()["content-security-policy"];
  const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  const scriptSrc = policy.split(";").find((part) => part.trim().startsWith("script-src"))!;
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  expect(policy).toContain("report-uri /api/csp-report");
  const html = await first.text();
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];
  expect(scripts.length).toBeGreaterThan(0);
  for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`);
  const second = await request.get("/");
  expect(second.headers()["content-security-policy"]).not.toBe(policy);

  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) violations.push(message.text());
  });
  await page.goto("/?view=overview");
  await expect(page.getByRole("heading", { name: /Good morning/ })).toBeVisible();
  await page.goto("/?view=cards");
  await expect(page.getByRole("heading", { name: "Your cards" })).toBeVisible();
  expect(violations).toEqual([]);
  // A typical injected XSS payload (markup with an inline event handler) is blocked...
  const violation = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        document.addEventListener(
          "securitypolicyviolation",
          (event) => resolve(`${event.effectiveDirective} ${event.disposition}`),
          { once: true },
        );
        const box = document.createElement("div");
        box.innerHTML = '<img src="/missing.png" onerror="window.__injected = true">';
        document.body.append(box);
      }),
  );
  expect(violation).toBe("script-src-attr enforce");
  expect(await page.evaluate(() => "__injected" in window)).toBe(false);
  // ...and the report-uri target exists and accepts the browser's report format.
  const report = await request.post("/api/csp-report", {
    headers: { "content-type": "application/csp-report" },
    data: JSON.stringify({ "csp-report": { "document-uri": "http://localhost:3000/", "violated-directive": "script-src-elem", "blocked-uri": "inline" } }),
  });
  expect(report.status()).toBe(204);
});

test("the API serves only listed endpoints and refuses large bodies quickly under concurrent load", async ({ request }) => {
  expect((await request.get("/api/admin")).status()).toBe(404);
  expect((await request.get("/api/bank")).status()).toBe(401);
  const headers = { authorization: "Bearer not-a-real-token", "content-type": "application/json" };
  const started = Date.now();
  const large = await Promise.all(
    Array.from({ length: 20 }, () => request.post("/api/bank", { headers, data: "x".repeat(2 * 1024 * 1024) })),
  );
  expect(large.map((response) => response.status())).toEqual(Array(20).fill(413));
  expect(Date.now() - started).toBeLessThan(30_000);
  const justOver = await request.post("/api/bank", { headers, data: " ".repeat(8193) });
  expect(justOver.status()).toBe(413);
  // A normal-size request still reaches the route; with no database configured in this local
  // run it fails, and the client only gets a generic message with a reference.
  const normal = await request.post("/api/bank", { headers, data: { type: "reset" } });
  expect(normal.status()).toBe(500);
  const body = await normal.json();
  expect(body.error).toBe("The bank could not complete the request. Please retry.");
  expect(body.reference).toMatch(/^[0-9a-f-]{36}$/);
  expect(JSON.stringify(body)).not.toMatch(/configured|supabase|stack/i);
  expect((await request.get("/")).status()).toBe(200);
});

test("signing out clears the browser's stored data", async ({ page }) => {
  await page.goto("/?view=transfers");
  await page.getByLabel("Amount").fill("25");
  await page.getByRole("button", { name: "Review transfer" }).click();
  await page.getByRole("button", { name: "Confirm payment" }).click();
  await expect(page.getByRole("heading", { name: "Transfer on its way" })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem("probe", "1"));
  expect(await page.evaluate(() => localStorage.length)).toBeGreaterThan(0);
  const logout = page.waitForResponse((response) => response.url().endsWith("/api/logout"));
  await page.getByRole("button", { name: "Sign out" }).click();
  const cleared = await logout;
  expect(cleared.status()).toBe(204);
  expect(await cleared.headerValue("clear-site-data")).toBe('"cache", "cookies", "storage"');
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => [localStorage.length, sessionStorage.length]))
    .toEqual([0, 0]);
});

test("an idle session is locked after 15 minutes, and activity keeps it open", async ({ page }) => {
  await page.clock.install();
  await page.goto("/?view=overview");
  await expect(page.getByRole("heading", { name: /Good morning/ })).toBeVisible();
  await page.clock.fastForward("10:00");
  await page.keyboard.press("Shift");
  await page.clock.fastForward("10:00");
  await expect(page.getByRole("heading", { name: /Good morning/ })).toBeVisible();
  await page.clock.fastForward("16:00");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.locator(".alert.error")).toContainText("locked after 15 minutes of inactivity");
  await expect.poll(() => page.evaluate(() => localStorage.length)).toBe(0);
});

test("customers are told their transaction limits and what is left today", async ({ page }) => {
  await page.goto("/?view=transfers");
  await expect(page.getByText("up to $25,000.00 per transfer to ACME accounts, $10,000.00 to other banks")).toBeVisible();
  await expect(page.getByText("Daily transfer limit $25,000.00 per account · $25,000.00 left today")).toBeVisible();
  await page.getByLabel("Amount").fill("100");
  await page.getByRole("button", { name: "Review transfer" }).click();
  await page.getByRole("button", { name: "Confirm payment" }).click();
  await page.getByRole("button", { name: "Make another transfer" }).click();
  await expect(page.getByText("$24,900.00 left today")).toBeVisible();
  await page.goto("/?view=cards");
  await expect(page.getByText("Choose between $100.00 and $10,000.00.")).toBeVisible();
});
