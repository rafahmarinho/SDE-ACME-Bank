import { createHmac, hkdfSync, randomBytes } from "node:crypto";

// Server-side keys. One master secret (SERVER_SECRET, at least 32 characters, kept in the host's
// secret store) is expanded with HKDF-SHA256 into a separate 256-bit key per purpose, so no key
// is ever used for two jobs. Rotating SERVER_SECRET rotates every derived key at once.
export type KeyPurpose = "client-address" | "storage-key" | "storage-cookie";

let ephemeral: Buffer | undefined;
function master() {
  const value = process.env.SERVER_SECRET ?? "";
  if (value.length >= 32) return Buffer.from(value, "utf8");
  // Production refuses to run with a missing or short secret; development uses a random one
  // that lives only as long as the process.
  if (process.env.NODE_ENV === "production")
    throw new Error("SERVER_SECRET must be set (32+ characters).");
  return (ephemeral ??= randomBytes(32));
}

export function serverKey(purpose: KeyPurpose) {
  return Buffer.from(hkdfSync("sha256", master(), Buffer.alloc(0), `acme-bank/${purpose}/v1`, 32));
}

/** Keyed, non-reversible pseudonym (HMAC-SHA256), so raw values such as IP addresses are never stored. */
export const pseudonym = (value: string, purpose: KeyPurpose = "client-address") =>
  createHmac("sha256", serverKey(purpose)).update(value, "utf8").digest("hex").slice(0, 32);
