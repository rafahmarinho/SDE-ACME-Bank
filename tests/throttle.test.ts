import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, errorResponse } from "../src/services/http";
import {
  clientKey,
  guardedAuthentication,
  memoryThrottleStore,
  throttle,
  throttleRules,
  throttleStore,
  setThrottleStore,
} from "../src/services/throttle";
import { pseudonym, serverKey } from "../src/services/secrets";
import { POST as cspReport } from "../src/app/api/csp-report/route";

let clock = Date.UTC(2026, 9, 19, 12);
const now = () => clock;
const code = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error) => (error instanceof ApiError ? `${error.status}:${error.code ?? ""}:${error.retryAfter ?? ""}` : String(error)),
  );

test("each user gets a fixed number of requests per minute, then a lock that doubles on repeat", async () => {
  const store = memoryThrottleStore(now);
  const rule = throttleRules.write;
  for (let i = 0; i < rule.max; i++) assert.equal(await code(throttle(store, "write:alex", rule)), "ok");
  assert.equal(await code(throttle(store, "write:alex", rule)), "429:rate_limited:60");
  assert.equal(await code(throttle(store, "write:jordan", rule)), "ok", "other users are not affected");
  clock += 30_000;
  assert.equal(await code(throttle(store, "write:alex", rule)), "429:rate_limited:30", "still locked");
  clock += 31_000;
  for (let i = 0; i < rule.max; i++) assert.equal(await code(throttle(store, "write:alex", rule)), "ok");
  assert.equal(await code(throttle(store, "write:alex", rule)), "429:rate_limited:120", "second lock doubles");
  const response = errorResponse(new ApiError(429, "Too many requests. Try again in 120 seconds.", "rate_limited", 120), {}, { security() {}, error() {} });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "120");
  assert.deepEqual(Object.keys(throttleRules).sort(), ["authFailure", "read", "report", "storageKey", "write"]);
  assert.ok(throttleRules.read.max >= throttleRules.write.max);
});

test("invalid tokens are counted per client address and lock it out before any token check", async () => {
  const store = memoryThrottleStore(now);
  let checks = 0;
  const invalid = () => {
    checks++;
    return Promise.reject(new ApiError(401, "Please sign in again.", "unauthorized"));
  };
  for (let i = 0; i < throttleRules.authFailure.max; i++)
    assert.equal(await code(guardedAuthentication(store, "ip:a", invalid)), "401:unauthorized:");
  assert.equal(await code(guardedAuthentication(store, "ip:a", invalid)), "401:unauthorized:", "the 11th failure locks the address");
  const before = checks;
  assert.equal(await code(guardedAuthentication(store, "ip:a", invalid)), "429:rate_limited:900");
  assert.equal(await code(guardedAuthentication(store, "ip:a", async () => "valid token")), "429:rate_limited:900", "even a valid token waits");
  assert.equal(checks, before, "no token check while locked");
  assert.equal(await guardedAuthentication(store, "ip:b", async () => "valid token"), "valid token", "other addresses unaffected");
  // Expired, idle or MFA-pending sessions are not guessing attempts and are not counted.
  for (const reason of ["session_idle", "session_expired", "mfa_required"])
    for (let i = 0; i < 20; i++)
      await guardedAuthentication(store, "ip:c", () => Promise.reject(new ApiError(401, "x", reason))).catch(() => undefined);
  assert.equal(await guardedAuthentication(store, "ip:c", async () => "ok"), "ok");
});

test("client addresses come from the first forwarded hop and are stored only as keyed pseudonyms", () => {
  const request = (headers: Record<string, string>) => new Request("http://localhost:3000/api/bank", { headers });
  const first = clientKey(request({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }));
  assert.match(first, /^ip:[0-9a-f]{32}$/);
  assert.equal(first.includes("203.0.113.7"), false);
  assert.equal(clientKey(request({ "x-forwarded-for": "203.0.113.7" })), first);
  assert.equal(clientKey(request({ "x-real-ip": "203.0.113.7" })), first);
  assert.notEqual(clientKey(request({ "x-forwarded-for": "203.0.113.8" })), first);
  assert.match(clientKey(request({})), /^ip:[0-9a-f]{32}$/);
  assert.notEqual(pseudonym("203.0.113.7"), pseudonym("203.0.113.7", "storage-key"));
});

test("server keys are derived per purpose and production refuses to run without SERVER_SECRET", () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { secret: env.SERVER_SECRET, mode: env.NODE_ENV };
  try {
    env.SERVER_SECRET = "s".repeat(40);
    assert.equal(serverKey("storage-key").length, 32);
    assert.deepEqual(serverKey("storage-key"), serverKey("storage-key"));
    assert.notDeepEqual(serverKey("storage-key"), serverKey("storage-cookie"));
    env.SERVER_SECRET = "too-short";
    env.NODE_ENV = "production";
    assert.throws(() => serverKey("client-address"), /SERVER_SECRET must be set/);
  } finally {
    env.SERVER_SECRET = saved.secret;
    env.NODE_ENV = saved.mode;
  }
});

test("the unauthenticated CSP report endpoint is limited per client address", async () => {
  const store = memoryThrottleStore(now);
  setThrottleStore(store);
  const original = console.warn;
  console.warn = () => {};
  try {
    const report = (address: string) =>
      cspReport(new Request("http://localhost:3000/api/csp-report", {
        method: "POST",
        body: JSON.stringify({ "csp-report": { "violated-directive": "img-src" } }),
        headers: { "content-type": "application/csp-report", "x-forwarded-for": address },
      }));
    for (let i = 0; i < throttleRules.report.max; i++) assert.equal((await report("198.51.100.1")).status, 204);
    const limited = await report("198.51.100.1");
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), String(throttleRules.report.lockSeconds));
    assert.equal((await report("198.51.100.2")).status, 204);
  } finally {
    console.warn = original;
    setThrottleStore(undefined);
  }
});

test("only a development server without a database keeps counters in memory; production fails closed", async () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { mode: env.NODE_ENV, url: env.NEXT_PUBLIC_SUPABASE_URL };
  try {
    env.NEXT_PUBLIC_SUPABASE_URL = "";
    env.NODE_ENV = "development";
    const store = await throttleStore();
    assert.equal(await store.hit("read:local", throttleRules.read), 0);
    assert.equal(await throttleStore(), store, "one store per process");
    env.NODE_ENV = "production";
    await assert.rejects(throttleStore(), "no silent in-memory fallback in production");
  } finally {
    env.NODE_ENV = saved.mode;
    env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
  }
});
