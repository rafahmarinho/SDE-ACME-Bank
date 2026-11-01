import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, errorResponse } from "../src/services/http";
import { storageCookie, storageKeyResponse } from "../src/services/storage-key";

// A browser running the real Supabase client against a fake Auth server and the real key service.
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
}
const localStorage = new MemoryStorage();
const sessionStorage = new MemoryStorage();
const jar = new Map<string, string>();
const user = "7b0f6c3e-9a51-4e2b-8d2f-1c6a9e4b5d70";
const accessToken = `eyJhbGciOiJFUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: user, aal: "aal1", exp: 9999999999 })).toString("base64url")}.signature`;
const paths: string[] = [];
Object.assign(globalThis, {
  window: {
    location: { href: "http://localhost:3000/", hash: "", search: "" },
    localStorage,
    sessionStorage,
    history: { state: null, replaceState() {} },
    addEventListener() {},
    removeEventListener() {},
  },
  document: { visibilityState: "hidden", addEventListener() {}, removeEventListener() {} },
  BroadcastChannel: undefined,
  fetch: async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost:3000");
    paths.push(url.pathname);
    if (url.pathname === "/api/storage-key") {
      const headers = new Headers(init.headers);
      const cookie = jar.get(storageCookie);
      if (cookie) headers.set("cookie", `${storageCookie}=${cookie}`);
      const verify = async (token: string) => {
        if (token !== accessToken) throw new ApiError(401, "Please sign in again.", "unauthorized");
        return { userId: user };
      };
      const response = await storageKeyResponse(
        new Request(url, { method: "POST", body: init.body, headers }),
        verify,
      ).catch((error) => errorResponse(error, {}, { security() {}, error() {} }));
      const set = response.headers.get("set-cookie");
      if (set) jar.set(storageCookie, set.split(";")[0].slice(storageCookie.length + 1));
      return response;
    }
    if (url.pathname === "/auth/v1/token")
      return Response.json({
        access_token: accessToken,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "refresh-token-value",
        user: { id: user, aud: "authenticated", role: "authenticated", email: "alex@example.com", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
      });
    return Response.json({});
  },
});
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_only";

test("a signed-in session is stored encrypted and survives a reload through the key service", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const { authOptions, supabase } = await import("../src/database/supabase");
  const { forgetStorageKey } = await import("../src/database/secure-storage");
  assert.ok(supabase);
  const reloaded = () => createClient("http://127.0.0.1:54321", "sb_publishable_test_only", { auth: authOptions });
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email: "alex@example.com", password: "a-long-unique-password" });
    assert.equal(error, null);
    assert.equal(data.session?.access_token, accessToken);
    const entries = [...sessionStorage.items.entries()];
    assert.equal(entries.length, 1);
    const [, stored] = entries[0];
    assert.match(stored, /^enc:v1:/);
    assert.equal(stored.includes(accessToken), false);
    assert.equal(stored.includes("refresh-token-value"), false);
    assert.equal([...localStorage.items.values()].some((value) => value.includes(accessToken)), false);
    assert.ok(jar.has(storageCookie), "HttpOnly cookie issued after authentication");

    // Reload: a new client, no key in memory; the cookie brings the key back and the session decrypts.
    forgetStorageKey();
    const second = reloaded();
    assert.equal((await second.auth.getSession()).data.session?.access_token, accessToken);
    await second.auth.stopAutoRefresh();

    // After sign-out the cookie is gone (Clear-Site-Data): a leftover entry cannot be decrypted.
    jar.clear();
    forgetStorageKey();
    const third = reloaded();
    assert.equal((await third.auth.getSession()).data.session, null);
    assert.equal(sessionStorage.items.size, 0);
    await third.auth.stopAutoRefresh();
    assert.ok(paths.includes("/auth/v1/token"));
  } finally {
    await supabase.auth.stopAutoRefresh();
  }
});
