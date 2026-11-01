import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { ApiError, json, readJson } from "./http";
import { serverKey } from "./secrets";

// Key service for encrypting session data at rest in the browser (src/database/secure-storage.ts).
// The browser sends its random per-client salt; after the user authenticates (Supabase access
// token), the server derives a 256-bit AES key from that salt and returns it. The browser keeps the
// key in memory only. To get the key again after a reload, the browser presents an HttpOnly cookie
// the server issued at authentication: signed (HMAC-SHA256), bound to the user and expiring with
// the 12-hour session limit. Sign-out clears the cookie (Clear-Site-Data), so stored data can no
// longer be decrypted.

export const storageCookie = "__Host-acme-storage";
export const storageCookieSeconds = 12 * 60 * 60;
const saltPattern = /^[A-Za-z0-9_-]{22}$/; // 16 random bytes, base64url

const mac = (payload: string) =>
  createHmac("sha256", serverKey("storage-cookie")).update(payload, "utf8").digest();

export function issueCookie(userId: string, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, exp: Math.floor(now / 1000) + storageCookieSeconds }),
  ).toString("base64url");
  return `${payload}.${mac(payload).toString("base64url")}`;
}

/** The user the cookie was issued to, or null when it is missing, forged, malformed or expired. */
export function readCookie(value: string | undefined, now = Date.now()): string | null {
  if (!value || value.length > 512) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const given = Buffer.from(signature, "base64url");
  const expected = mac(payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { sub, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof sub !== "string" || !/^[0-9a-f-]{36}$/i.test(sub)) return null;
    if (typeof exp !== "number" || exp * 1000 <= now) return null;
    return sub;
  } catch {
    return null;
  }
}

/** HKDF-SHA256 of the server's storage key with the client's salt: one key per browser and user. */
export function deriveStorageKey(userId: string, salt: string) {
  return Buffer.from(
    hkdfSync(
      "sha256",
      serverKey("storage-key"),
      Buffer.from(salt, "base64url"),
      `acme-bank/browser-storage/v1/${userId}`,
      32,
    ),
  ).toString("base64url");
}

const cookieValue = (request: Request) =>
  request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${storageCookie}=`))
    ?.slice(storageCookie.length + 1);

/**
 * POST /api/storage-key { salt }. With a bearer token the user is authenticated (by `verify`) and
 * a fresh cookie is issued; without one, the cookie must be valid. Same-origin calls only.
 */
export async function storageKeyResponse(
  request: Request,
  verify: (token: string) => Promise<{ userId: string }>,
) {
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  if ((site && site !== "same-origin") || (origin && origin !== new URL(request.url).origin))
    throw new ApiError(403, "Origin not allowed.");
  const body = (await readJson(request, { limit: 512 })) as { salt?: unknown };
  if (typeof body?.salt !== "string" || !saltPattern.test(body.salt))
    throw new ApiError(400, "Invalid request. Check the supplied values.");
  const token = request.headers.get("authorization")?.match(/^Bearer (\S{1,8192})$/)?.[1];
  const userId = token ? (await verify(token)).userId : readCookie(cookieValue(request));
  if (!userId) throw new ApiError(401, "Please sign in again.", "unauthorized");
  const headers: Record<string, string> = token
    ? {
        "Set-Cookie": `${storageCookie}=${issueCookie(userId)}; Path=/; Max-Age=${storageCookieSeconds}; HttpOnly; Secure; SameSite=Strict`,
      }
    : {};
  return json({ key: deriveStorageKey(userId, body.salt), sub: userId }, 200, headers);
}
