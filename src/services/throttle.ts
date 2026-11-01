import { ApiError } from "./http";
import { pseudonym } from "./secrets";

/**
 * At most `max` requests per `windowSeconds`. Going over locks the key for `lockSeconds`, doubling
 * on every repeat and capped at 24 hours (public.throttle_hit, supabase/migrations/005).
 */
export type ThrottleRule = { max: number; windowSeconds: number; lockSeconds: number };
export const throttleRules = {
  /** GET /api/bank per user. */
  read: { max: 120, windowSeconds: 60, lockSeconds: 60 },
  /** POST /api/bank per user. */
  write: { max: 30, windowSeconds: 60, lockSeconds: 60 },
  /** Invalid bearer tokens per client address (token guessing). */
  authFailure: { max: 10, windowSeconds: 300, lockSeconds: 900 },
  /** CSP violation reports per client address (unauthenticated). */
  report: { max: 60, windowSeconds: 60, lockSeconds: 300 },
  /** Browser storage key requests per client address (one per page load or sign-in). */
  storageKey: { max: 60, windowSeconds: 300, lockSeconds: 300 },
} as const satisfies Record<string, ThrottleRule>;

/** Counters shared by every server instance (the api_throttle table in production). */
export type ThrottleStore = {
  /** Counts one request; returns the seconds the caller must wait (0 = allowed). */
  hit(key: string, rule: ThrottleRule): Promise<number>;
  /** Seconds left on an active lock, without counting a request. */
  wait(key: string): Promise<number>;
};

/** In-memory twin of public.throttle_hit / throttle_wait, for one process (local demo, tests). */
export function memoryThrottleStore(now: () => number = Date.now): ThrottleStore {
  const rows = new Map<string, { windowStart: number; hits: number; strikes: number; lockedUntil: number }>();
  const left = (until: number) => Math.ceil((until - now()) / 1000);
  return {
    async hit(key, rule) {
      const at = now();
      let row = rows.get(key);
      if (row && row.lockedUntil > at) return left(row.lockedUntil);
      if (!row) rows.set(key, (row = { windowStart: at, hits: 0, strikes: 0, lockedUntil: 0 }));
      if (row.windowStart < at - rule.windowSeconds * 1000) {
        row.windowStart = at;
        row.hits = 0;
      }
      if (row.lockedUntil && row.lockedUntil < at - 86_400_000) row.strikes = 0;
      row.hits++;
      if (row.hits <= rule.max) return 0;
      row.lockedUntil = at + Math.min(rule.lockSeconds * 2 ** Math.min(row.strikes, 16), 86_400) * 1000;
      row.strikes = Math.min(row.strikes + 1, 20);
      row.hits = 0;
      row.windowStart = at;
      return left(row.lockedUntil);
    },
    async wait(key) {
      const row = rows.get(key);
      return row && row.lockedUntil > now() ? left(row.lockedUntil) : 0;
    },
  };
}

let override: ThrottleStore | undefined;
let local: ThrottleStore | undefined;
/** Replaces the store (tests). */
export function setThrottleStore(store: ThrottleStore | undefined) {
  override = store;
}
/**
 * The shared database store. Only a development server without a database (the local demo) keeps
 * counters in memory; production without a database fails closed.
 */
export async function throttleStore(): Promise<ThrottleStore> {
  if (override) return override;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NODE_ENV === "development")
    return (local ??= memoryThrottleStore());
  const { databaseThrottleStore } = await import("@/database/server");
  return databaseThrottleStore();
}

const tooMany = (seconds: number) =>
  new ApiError(429, `Too many requests. Try again in ${seconds} seconds.`, "rate_limited", seconds);

export async function throttle(store: ThrottleStore, key: string, rule: ThrottleRule) {
  const wait = await store.hit(key, rule);
  if (wait > 0) throw tooMany(wait);
}

/**
 * The caller's address as seen by the hosting edge (first X-Forwarded-For hop, which Vercel sets
 * itself), stored only as a keyed pseudonym.
 */
export function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = (forwarded || request.headers.get("x-real-ip")?.trim() || "unknown").slice(0, 64);
  return `ip:${pseudonym(address)}`;
}

/**
 * Brute-force protection around token checks: a locked client is refused before its token is even
 * looked at, and every invalid token counts towards the lock.
 */
export async function guardedAuthentication<T>(
  store: ThrottleStore,
  client: string,
  authenticate: () => Promise<T>,
): Promise<T> {
  const key = `auth-failure:${client}`;
  const wait = await store.wait(key);
  if (wait > 0) throw tooMany(wait);
  try {
    return await authenticate();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && error.code === "unauthorized")
      await store.hit(key, throttleRules.authFailure);
    throw error;
  }
}
