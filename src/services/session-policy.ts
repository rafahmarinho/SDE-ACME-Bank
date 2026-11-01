import { ApiError } from "./http";

export const sessionLimits = {
  idleMinutes: 15,
  absoluteHours: 12,
  choices: [1, 4, 8, 12],
} as const;

/** Where the API keeps the last activity of each Supabase session (the session_activity table). */
export type SessionStore = {
  lastSeen(sessionId: string): Promise<number | null>;
  touch(sessionId: string, actorId: string, at: number): Promise<void>;
};

/** When the user signed in for this session: the earliest authentication method in the token (ms). */
export function signedInAt(claims: { amr?: unknown }) {
  const times = (Array.isArray(claims.amr) ? claims.amr : [])
    .map((entry) => (entry as { timestamp?: unknown })?.timestamp)
    .filter((time): time is number => typeof time === "number" && Number.isFinite(time));
  return times.length ? Math.min(...times) * 1000 : null;
}

const expired = (hours: number) =>
  new ApiError(
    401,
    `Your session reached its ${hours}-hour limit. Please sign in again.`,
    "session_expired",
  );

/**
 * Applies the absolute timeout (from sign-in, whatever the activity) and the idle timeout. An idle
 * session stays locked: its activity is never refreshed again, so only a new sign-in with the
 * account credentials (which creates a new session ID) restores access.
 */
export async function enforceSession({
  claims,
  actorId,
  store,
  active,
  now = Date.now(),
}: {
  claims: { session_id?: unknown; amr?: unknown };
  actorId: string;
  store: SessionStore;
  active: boolean;
  now?: number;
}) {
  const sessionId = typeof claims.session_id === "string" ? claims.session_id : "";
  const since = signedInAt(claims);
  if (!/^[0-9a-f-]{36}$/i.test(sessionId) || since === null)
    throw new ApiError(401, "Please sign in again.", "unauthorized");
  if (now - since > sessionLimits.absoluteHours * 3_600_000)
    throw expired(sessionLimits.absoluteHours);
  const last = await store.lastSeen(sessionId);
  if (last !== null && now - last > sessionLimits.idleMinutes * 60_000)
    throw new ApiError(
      401,
      `Your session was locked after ${sessionLimits.idleMinutes} minutes of inactivity. Please sign in again.`,
      "session_idle",
    );
  if (active || last === null) await store.touch(sessionId, actorId, now);
  return since;
}

/** Applies the shorter session length a customer chose in Settings (default: the 12-hour maximum). */
export function enforcePreferredLength(since: number, hours = 12, now = Date.now()) {
  const limit = Math.min(hours, sessionLimits.absoluteHours);
  if (now - since > limit * 3_600_000) throw expired(limit);
}
