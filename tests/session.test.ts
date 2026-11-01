import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Auth } from "../src/screens/auth";
import type { BankContext } from "../src/services/use-bank";
import { actionSchema, executeAction, seedBank } from "../src/services/bank";
import { secureSupabaseUrl } from "../src/database/url";
import { supabaseSources } from "../src/services/edge-policy";
import { ApiError } from "../src/services/http";
import {
  enforcePreferredLength,
  enforceSession,
  sessionLimits,
  type SessionStore,
} from "../src/services/session-policy";

const minute = 60_000;
const hour = 60 * minute;
const start = Date.UTC(2026, 9, 19, 8, 0, 0);
const claims = (sessionId: string, signedIn = start) => ({
  session_id: sessionId,
  amr: [
    { method: "password", timestamp: signedIn / 1000 },
    { method: "totp", timestamp: signedIn / 1000 + 30 },
  ],
});
function memoryStore() {
  const rows = new Map<string, number>();
  const store: SessionStore = {
    lastSeen: async (id) => rows.get(id) ?? null,
    touch: async (id, _actor, at) => void rows.set(id, at),
  };
  return { rows, store };
}
const session = "7b0f6c3e-9a51-4e2b-8d2f-1c6a9e4b5d70";
const code = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error) => (error instanceof ApiError ? (error.code ?? "") : String(error)),
  );

test("an idle session is locked after 15 minutes and stays locked until a new sign-in", async () => {
  const { rows, store } = memoryStore();
  const call = (at: number, active = true, id = session) =>
    code(enforceSession({ claims: claims(id), actorId: "user-1", store, active, now: start + at }));
  assert.equal(await call(0), "ok");
  assert.equal(await call(14 * minute), "ok");
  // Background refreshes (realtime notifications) are checked but do not extend the session.
  for (const at of [18, 23, 28]) assert.equal(await call(at * minute, false), "ok");
  assert.equal(await call(29 * minute + 1, false), "session_idle");
  assert.equal(await call(30 * minute), "session_idle");
  assert.equal(await call(31 * minute), "session_idle");
  assert.equal(rows.get(session), start + 14 * minute);
  // Signing in again with the account credentials creates a new session ID, which works.
  const fresh = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
  assert.equal(await call(32 * minute, true, fresh), "ok");
  assert.equal(sessionLimits.idleMinutes, 15);
});

test("a session expires 12 hours after sign-in however active it is, with a clear message", async () => {
  const { store } = memoryStore();
  let at = 0;
  let result = "ok";
  while (result === "ok" && at <= 13 * hour) {
    result = await code(enforceSession({ claims: claims(session), actorId: "user-1", store, active: true, now: start + at }));
    at += 10 * minute;
  }
  assert.equal(result, "session_expired");
  assert.ok(at - 10 * minute > 12 * hour && at - 10 * minute <= 12 * hour + 10 * minute);
  await assert.rejects(
    enforceSession({ claims: claims(session, start - 12 * hour - 1), actorId: "user-1", store, active: true, now: start }),
    { message: "Your session reached its 12-hour limit. Please sign in again." },
  );
  for (const bad of [{ session_id: session }, { amr: claims(session).amr }, { session_id: "x", amr: claims(session).amr }])
    assert.equal(await code(enforceSession({ claims: bad, actorId: "user-1", store, active: true, now: start })), "unauthorized");
});

test("customers can choose a shorter session, and the server enforces it", () => {
  assert.throws(() => enforcePreferredLength(start, 1, start + hour + 1), { message: /1-hour limit/ });
  enforcePreferredLength(start, 1, start + hour - 1);
  enforcePreferredLength(start, undefined, start + 11 * hour);
  assert.throws(() => enforcePreferredLength(start, 24, start + 12 * hour + 1), { message: /12-hour limit/ });
  const alex = { id: "customer-1", role: "customer" as const };
  const state = executeAction(seedBank(), alex, { type: "profile", name: "Alex Morgan", notifications: true, sessionHours: 4 });
  assert.equal(state.customers[0].sessionHours, 4);
  for (const sessionHours of [0, 3, 13, 24, "4"])
    assert.equal(actionSchema.safeParse({ type: "profile", name: "Alex", notifications: true, sessionHours }).success, false);
});

test("Supabase is only reachable over HTTPS outside a local loopback stack", () => {
  assert.equal(secureSupabaseUrl("https://project.supabase.co"), "https://project.supabase.co");
  assert.equal(secureSupabaseUrl("http://127.0.0.1:54321"), "http://127.0.0.1:54321");
  for (const url of ["http://project.supabase.co", "http://10.0.0.5:8000", "ftp://project.supabase.co", "not a url", ""])
    assert.equal(secureSupabaseUrl(url), "", url);
  assert.equal(supabaseSources("http://project.supabase.co"), "");
  assert.equal(supabaseSources("https://project.supabase.co"), " https://project.supabase.co wss://project.supabase.co");
});

test("the sign-in form offers no 'remember me' option", () => {
  const bank = { error: "", setError() {}, refresh: async () => {}, switchDemo() {} };
  const html = renderToStaticMarkup(createElement(Auth, { bank: bank as unknown as BankContext }));
  assert.match(html, /type="password"/);
  assert.match(html, /Welcome back/);
  assert.doesNotMatch(html, /remember|keep me signed in|stay signed in/i);
  assert.doesNotMatch(html, /type="checkbox"/);
});
