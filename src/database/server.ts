import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Actor, BankState } from "@/services/bank";
import { ApiError } from "@/services/http";
import { enforceSession, type SessionStore } from "@/services/session-policy";
import type { ThrottleStore } from "@/services/throttle";
import { databaseCredentials } from "./credentials";
import { secureSupabaseUrl } from "./url";

const unauthorized = () => new ApiError(401, "Please sign in again.", "unauthorized");
const stateless = { auth: { persistSession: false, autoRefreshToken: false } };
function projectUrl() {
  const url = secureSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!url) throw new Error("Server database is not configured.");
  return url;
}
/** Supabase Auth with the public key only: verifies the bearer tokens users send. */
function authClient() {
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw new Error("Server database is not configured.");
  return createClient(projectUrl(), key, stateless);
}
/**
 * Data API as the least-privilege bank_api role (supabase/migrations/006_api_role.sql): the role
 * token is sent as the bearer of every database call; no service key is needed at runtime.
 */
function dataClient() {
  const { apiKey, roleToken } = databaseCredentials(process.env);
  return createClient(
    projectUrl(),
    apiKey,
    roleToken ? { ...stateless, accessToken: async () => roleToken } : stateless,
  );
}
// Last activity per Supabase session (supabase/migrations/003_session_hardening.sql).
const sessionStore = (db: SupabaseClient): SessionStore => ({
  async lastSeen(sessionId) {
    const { data, error } = await db
      .from("session_activity")
      .select("last_seen")
      .eq("session_id", sessionId)
      .maybeSingle();
    if (error) throw new Error("Unable to check session activity.");
    return data ? Date.parse(data.last_seen) : null;
  },
  async touch(sessionId, actorId, at) {
    const { error } = await db.from("session_activity").upsert({
      session_id: sessionId,
      actor: actorId,
      last_seen: new Date(at).toISOString(),
    });
    if (error) throw new Error("Unable to record session activity.");
  },
});
/**
 * Verifies a Supabase access token at any assurance level (used before MFA completes, for the
 * browser storage key) and returns its user.
 */
export async function verifyAccessToken(token: string): Promise<{ userId: string }> {
  if (!token || token.length > 8192) throw unauthorized();
  const {
    data: { user },
    error,
  } = await authClient().auth.getUser(token);
  if (error || !user) throw unauthorized();
  return { userId: user.id };
}
export async function authenticate(
  request: Request,
): Promise<{ actor: Actor; since: number; email?: string }> {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (!token || token.length > 8192) throw unauthorized();
  const auth = authClient();
  const db = dataClient();
  const {
    data: { user },
    error,
  } = await auth.auth.getUser(token);
  if (error || !user) throw unauthorized();
  const { data: claims, error: claimsError } = await auth.auth.getClaims(token);
  if (claimsError || claims?.claims.aal !== "aal2")
    throw new ApiError(401, "Multi-factor authentication required.", "mfa_required");
  // Background refreshes (realtime notifications) are checked but do not count as activity.
  const since = await enforceSession({
    claims: claims.claims,
    actorId: user.id,
    store: sessionStore(db),
    active: request.headers.get("x-session-activity") !== "passive",
  });
  const { data: profile } = await db
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();
  if (
    !profile ||
    !["customer", "support", "administrator"].includes(profile.role)
  )
    throw unauthorized();
  return { actor: profile as Actor, since, email: user.email };
}
// Request counters shared by every instance (supabase/migrations/005_throttling.sql). Errors fail
// closed: the request is refused rather than served without limits.
export function databaseThrottleStore(): ThrottleStore {
  const db = dataClient();
  return {
    async hit(key, rule) {
      const { data, error } = await db.rpc("throttle_hit", {
        key,
        max_hits: rule.max,
        window_seconds: rule.windowSeconds,
        lock_seconds: rule.lockSeconds,
      });
      if (error) throw new Error("Unable to apply request limits.");
      return Number(data) || 0;
    },
    async wait(key) {
      const { data, error } = await db.rpc("throttle_wait", { key });
      if (error) throw new Error("Unable to apply request limits.");
      return Number(data) || 0;
    },
  };
}
export async function loadWorld(): Promise<BankState> {
  const { data, error } = await dataClient()
    .from("bank_world")
    .select("data")
    .eq("id", 1)
    .single();
  if (error || !data)
    throw new Error("Database not initialized. Run the seed script.");
  return data.data as BankState;
}
export async function saveWorld(state: BankState, expectedVersion: number) {
  const { data, error } = await dataClient().rpc("commit_bank_world", {
    next_data: state,
    expected_version: expectedVersion,
  });
  if (error) throw new Error("Unable to save changes.");
  return data === true;
}
