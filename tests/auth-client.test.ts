import { test } from "node:test";
import assert from "node:assert/strict";

// A minimal browser for the Supabase client: two storage areas, a URL carrying implicit-grant
// tokens in the fragment (as a crafted link would) and a fetch that records every request.
class MemoryStorage {
  items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  clear() {
    this.items.clear();
  }
}
const localStorage = new MemoryStorage();
const sessionStorage = new MemoryStorage();
const injected = "access_token=attacker.jwt.token&refresh_token=attacker-refresh&expires_in=3600&token_type=bearer";
const requests: { url: string; body: string }[] = [];
Object.assign(globalThis, {
  window: {
    location: { href: `http://localhost:3000/?view=overview#${injected}`, hash: `#${injected}` },
    localStorage,
    sessionStorage,
    history: { state: null, replaceState() {} },
    addEventListener() {},
    removeEventListener() {},
  },
  document: { visibilityState: "hidden", addEventListener() {}, removeEventListener() {} },
  BroadcastChannel: undefined,
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), body: String(init?.body ?? "") });
    return Response.json({});
  },
});
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_only";

test("the auth client uses PKCE, refuses sessions injected through the URL and keeps no persistent session", async () => {
  const { authOptions, authStorage, recoveryVerified, supabase } = await import("../src/database/supabase");
  assert.ok(supabase);
  assert.equal(authOptions.flowType, "pkce");
  try {
    const { error } = await supabase.auth.initialize();
    assert.match(String(error?.message), /Not a valid PKCE flow url/);
    assert.equal((await supabase.auth.getSession()).data.session, null);
    assert.equal(requests.length, 0, "tokens from the URL were never sent to the auth server");

    await supabase.auth.resetPasswordForEmail("pat@example.com", { redirectTo: "http://localhost:3000/?recovery=1" });
    await supabase.auth.signUp({ email: "pat@example.com", password: "a-long-unique-password" });
    const bodies = requests.map((request) => JSON.parse(request.body));
    assert.deepEqual(requests.map((request) => new URL(request.url).pathname), ["/auth/v1/recover", "/auth/v1/signup"]);
    for (const body of bodies) {
      assert.match(body.code_challenge, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(body.code_challenge_method, "s256");
    }
    assert.ok(requests.every((request) => !new URL(request.url).search.includes("token")));
    // The verifier stays in this browser (localStorage) so the emailed code is useless elsewhere;
    // session tokens go to sessionStorage, which ends with the browser session, and only
    // encrypted: without a key from the server nothing is written (tests/secure-storage.test.ts).
    assert.ok([...localStorage.items.keys()].length >= 2);
    assert.ok([...localStorage.items.keys()].every((key) => key.endsWith("-code-verifier")));
    assert.equal(sessionStorage.items.size, 0);
    await assert.rejects(async () => authStorage.setItem("sb-127-auth-token", "{}"), /Secure storage is unavailable/);
    assert.equal(sessionStorage.items.size, 0);
    assert.equal(localStorage.getItem("sb-127-auth-token"), null);
    assert.equal(recoveryVerified(), false);
  } finally {
    await supabase.auth.stopAutoRefresh();
  }
});
