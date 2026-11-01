import type { SupportedStorage } from "@supabase/supabase-js";

// Encryption of session data at rest in the browser. All encryption and decryption happens here,
// and only here the key is held:
// - a random per-browser salt lives in localStorage (it is not secret);
// - the AES-256-GCM key comes from /api/storage-key after the user authenticates (or, after a
//   reload, with the HttpOnly cookie issued then) and is kept in memory as a non-extractable
//   CryptoKey, never stored; closing the tab or signing out drops it;
// - every write uses a fresh random 96-bit IV, and the storage entry name is authenticated data,
//   so a value cannot be moved to another entry. Plaintext or tampered entries are discarded.

const saltEntry = "acme-storage-salt";
const prefix = "enc:v1:";
type HeldKey = { key: CryptoKey; sub: string };
let held: Promise<HeldKey | null> | null = null;

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
const utf8 = new TextEncoder();

function clientSalt() {
  let salt = window.localStorage.getItem(saltEntry);
  if (!salt || !/^[A-Za-z0-9_-]{22}$/.test(salt)) {
    salt = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
    window.localStorage.setItem(saltEntry, salt);
  }
  return salt;
}

async function requestKey(accessToken?: string): Promise<HeldKey | null> {
  try {
    const response = await fetch("/api/storage-key", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ salt: clientSalt() }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { key?: unknown; sub?: unknown };
    if (typeof body.key !== "string" || typeof body.sub !== "string") return null;
    const key = await crypto.subtle.importKey(
      "raw",
      fromBase64Url(body.key),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    return { key, sub: body.sub };
  } catch {
    return null;
  }
}

/** The in-memory key; with a token, a new key is requested (and the cookie re-issued). */
function storageKey(accessToken?: string) {
  if (accessToken || !held) held = requestKey(accessToken);
  return held;
}

/** Drops the in-memory key (sign-out). */
export function forgetStorageKey() {
  held = null;
}

export async function encryptValue(key: CryptoKey, name: string, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: utf8.encode(name) },
    key,
    utf8.encode(value),
  );
  return `${prefix}${toBase64Url(iv)}.${toBase64Url(new Uint8Array(sealed))}`;
}

export async function decryptValue(key: CryptoKey, name: string, stored: string) {
  if (!stored.startsWith(prefix)) return null;
  const [iv, sealed] = stored.slice(prefix.length).split(".");
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(iv), additionalData: utf8.encode(name) },
      key,
      fromBase64Url(sealed),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** The session's access token and its user (the JWT payload is only read, never trusted here). */
function sessionToken(value: string) {
  try {
    const token = (JSON.parse(value) as { access_token?: unknown }).access_token;
    if (typeof token !== "string") return null;
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return { token, sub: String(payload.sub ?? "") };
  } catch {
    return null;
  }
}

/** Storage adapter for the Supabase client that encrypts everything it writes to `area`. */
export function encryptedStorage(area: () => Storage | undefined): SupportedStorage {
  return {
    async getItem(name) {
      const storage = area();
      const stored = storage?.getItem(name);
      if (!storage || !stored) return null;
      const current = await storageKey();
      const plain = current ? await decryptValue(current.key, name, stored) : null;
      if (plain === null) storage.removeItem(name);
      return plain;
    },
    async setItem(name, value) {
      const storage = area();
      if (!storage) return;
      let current = await storageKey();
      const session = sessionToken(value);
      if (session && current?.sub !== session.sub) current = await storageKey(session.token);
      // Fail closed: session data is never written in the clear.
      if (!current) throw new Error("Secure storage is unavailable. Please sign in again.");
      storage.setItem(name, await encryptValue(current.key, name, value));
    },
    async removeItem(name) {
      area()?.removeItem(name);
    },
  };
}
