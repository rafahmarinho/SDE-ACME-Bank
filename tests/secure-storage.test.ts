import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, errorResponse } from "../src/services/http";
import {
  deriveStorageKey,
  issueCookie,
  readCookie,
  storageCookie,
  storageCookieSeconds,
  storageKeyResponse,
} from "../src/services/storage-key";

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
const user = "7b0f6c3e-9a51-4e2b-8d2f-1c6a9e4b5d70";
const other = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const jwt = (sub: string) =>
  `eyJhbGciOiJFUzI1NiJ9.${Buffer.from(JSON.stringify({ sub, aal: "aal1" })).toString("base64url")}.signature`;
const sessionFor = (sub: string) =>
  JSON.stringify({ access_token: jwt(sub), refresh_token: `refresh-${sub}`, expires_at: 9999999999 });

// A browser (two storage areas, a cookie jar) talking to the real key service.
const localStorage = new MemoryStorage();
const sessionStorage = new MemoryStorage();
const jar = new Map<string, string>();
const requests: { authorization: boolean; cookie: boolean }[] = [];
const verify = async (token: string) => {
  const sub = [user, other].find((id) => token === jwt(id));
  if (!sub) throw new ApiError(401, "Please sign in again.", "unauthorized");
  return { userId: sub };
};
const quiet = { security() {}, error() {} };
Object.assign(globalThis, {
  window: { localStorage, sessionStorage },
  fetch: async (input: RequestInfo | URL, init: RequestInit = {}) => {
    assert.equal(String(input), "/api/storage-key");
    const headers = new Headers(init.headers);
    const cookie = jar.get(storageCookie);
    if (cookie) headers.set("cookie", `${storageCookie}=${cookie}`);
    headers.set("origin", "http://localhost:3000");
    headers.set("sec-fetch-site", "same-origin");
    requests.push({ authorization: headers.has("authorization"), cookie: !!cookie });
    const request = new Request("http://localhost:3000/api/storage-key", { method: "POST", body: init.body, headers });
    const response = await storageKeyResponse(request, verify).catch((error) => errorResponse(error, {}, quiet));
    const set = response.headers.get("set-cookie");
    if (set) jar.set(storageCookie, set.split(";")[0].slice(storageCookie.length + 1));
    return response;
  },
});

test("the storage cookie is signed, bound to one user and expires with the session limit", () => {
  const now = Date.UTC(2026, 9, 19, 8);
  const cookie = issueCookie(user, now);
  assert.equal(readCookie(cookie, now), user);
  assert.equal(readCookie(cookie, now + (storageCookieSeconds - 1) * 1000), user);
  assert.equal(readCookie(cookie, now + storageCookieSeconds * 1000), null, "expired");
  const [payload, signature] = cookie.split(".");
  const forged = Buffer.from(JSON.stringify({ sub: other, exp: 9999999999 })).toString("base64url");
  for (const bad of [`${forged}.${signature}`, `${payload}.${signature.slice(0, -2)}AA`, payload, `${cookie}.x`, "", undefined])
    assert.equal(readCookie(bad, now), null, String(bad));
  const salt = "AAAAAAAAAAAAAAAAAAAAAA";
  assert.equal(Buffer.from(deriveStorageKey(user, salt), "base64url").length, 32);
  assert.equal(deriveStorageKey(user, salt), deriveStorageKey(user, salt));
  assert.notEqual(deriveStorageKey(user, salt), deriveStorageKey(other, salt), "per user");
  assert.notEqual(deriveStorageKey(user, salt), deriveStorageKey(user, "BBBBBBBBBBBBBBBBBBBBBB"), "per browser");
});

test("the key service authenticates the user, then re-issues the key only with its HttpOnly cookie", async () => {
  const call = (headers: Record<string, string>, body: unknown = { salt: "AAAAAAAAAAAAAAAAAAAAAA" }) =>
    storageKeyResponse(
      new Request("http://localhost:3000/api/storage-key", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", ...headers },
      }),
      verify,
    ).catch((error) => errorResponse(error, {}, quiet));
  const signedIn = await call({ authorization: `Bearer ${jwt(user)}` });
  assert.equal(signedIn.status, 200);
  const setCookie = signedIn.headers.get("set-cookie") ?? "";
  assert.match(setCookie, new RegExp(`^${storageCookie}=[\\w-]+\\.[\\w-]+; Path=/; Max-Age=${storageCookieSeconds}; HttpOnly; Secure; SameSite=Strict$`));
  assert.equal(signedIn.headers.get("cache-control"), "no-store, private");
  const { key, sub } = await signedIn.json();
  assert.equal(sub, user);
  const cookie = setCookie.split(";")[0];
  const reloaded = await call({ cookie });
  assert.equal(reloaded.status, 200);
  assert.equal(reloaded.headers.get("set-cookie"), null);
  assert.equal((await reloaded.json()).key, key);
  assert.equal((await call({})).status, 401, "no token, no cookie");
  assert.equal((await call({ authorization: "Bearer forged.token.value" })).status, 401);
  assert.equal((await call({ cookie: `${storageCookie}=forged.value` })).status, 401);
  assert.equal((await call({ cookie, origin: "https://evil.example" })).status, 403);
  assert.equal((await call({ cookie, "sec-fetch-site": "cross-site" })).status, 403);
  for (const salt of ["", "short", "A".repeat(23), "AAAAAAAAAAAAAAAAAAAA!!", 42])
    assert.equal((await call({ cookie }, { salt })).status, 400, String(salt));
});

test("session data is encrypted at rest with a fresh IV, bound to its entry and readable after a reload", async () => {
  const { encryptedStorage, forgetStorageKey } = await import("../src/database/secure-storage");
  const storage = encryptedStorage(() => sessionStorage as unknown as Storage);
  const name = "sb-127-auth-token";
  assert.equal(await storage.getItem(name), null);
  assert.equal(requests.length, 0, "nothing stored, nothing fetched");
  await assert.rejects(async () => storage.setItem(name, "{}"), /Secure storage is unavailable/, "no key, no write");
  assert.equal(sessionStorage.items.size, 0);

  const value = sessionFor(user);
  await storage.setItem(name, value);
  const stored = sessionStorage.getItem(name)!;
  assert.match(stored, /^enc:v1:[\w-]{16}\.[\w-]+$/);
  for (const secret of [jwt(user), `refresh-${user}`, "access_token"]) assert.equal(stored.includes(secret), false);
  assert.equal(localStorage.getItem(name), null);
  assert.match(localStorage.getItem("acme-storage-salt") ?? "", /^[\w-]{22}$/);
  assert.deepEqual(requests.at(-1), { authorization: true, cookie: false }, "the user authenticated for the key");
  await storage.setItem(name, value);
  assert.notEqual(sessionStorage.getItem(name), stored, "a new IV for every write");
  assert.equal(await storage.getItem(name), value);

  // Reload: the key is gone from memory and comes back only with the HttpOnly cookie.
  forgetStorageKey();
  assert.equal(await storage.getItem(name), value);
  assert.deepEqual(requests.at(-1), { authorization: false, cookie: true });

  // A value moved to another entry, a tampered value or a plaintext value is discarded.
  sessionStorage.setItem("other-entry", sessionStorage.getItem(name)!);
  assert.equal(await storage.getItem("other-entry"), null);
  assert.equal(sessionStorage.getItem("other-entry"), null);
  const sealed = sessionStorage.getItem(name)!;
  sessionStorage.setItem(name, sealed.slice(0, -3) + (sealed.endsWith("AAA") ? "BBB" : "AAA"));
  assert.equal(await storage.getItem(name), null);
  assert.equal(sessionStorage.getItem(name), null);
  sessionStorage.setItem(name, value);
  assert.equal(await storage.getItem(name), null, "plaintext from an older version is not trusted");
  assert.equal(sessionStorage.getItem(name), null);

  // Another user signing in on this browser gets a key of their own.
  await storage.setItem(name, sessionFor(other));
  assert.deepEqual(requests.at(-1), { authorization: true, cookie: true });
  assert.equal(await storage.getItem(name), sessionFor(other));

  // Sign-out clears the cookie (Clear-Site-Data) and the key: what is left cannot be decrypted.
  jar.clear();
  forgetStorageKey();
  assert.equal(await storage.getItem(name), null);
  assert.equal(sessionStorage.getItem(name), null);
});
