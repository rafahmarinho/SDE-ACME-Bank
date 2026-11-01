import { authenticate, loadWorld, saveWorld } from "@/database/server";
import { actionSchema, executeAction, syncEmail } from "@/services/bank";
import { apiView } from "@/services/api-view";
import {
  ApiError,
  activityLog,
  errorResponse,
  json,
  readJson,
  securityLog,
} from "@/services/http";
import { enforcePreferredLength } from "@/services/session-policy";
import {
  clientKey,
  guardedAuthentication,
  throttle,
  throttleRules,
  throttleStore,
} from "@/services/throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Upper bound on server time per request (hosting platforms enforce it from the build output).
export const maxDuration = 10;
export async function GET(request: Request) {
  let actorId: string | undefined;
  try {
    const store = await throttleStore();
    const { actor, since, email } = await guardedAuthentication(store, clientKey(request), () =>
      authenticate(request),
    );
    actorId = actor.id;
    await throttle(store, `read:${actor.id}`, throttleRules.read);
    let state = await loadWorld();
    const profile = state.customers.find((item) => item.id === actor.id);
    if (!profile)
      throw new ApiError(409, "Profile is being provisioned. Please retry.");
    enforcePreferredLength(since, profile.sessionHours);
    // Supabase Auth is the system of record for the email: keep the bank's copy in step.
    const synced = syncEmail(state, actor.id, email);
    if (synced && (await saveWorld(synced, state.version))) state = synced;
    if (actor.role !== "customer")
      securityLog({ event: "staff-access", route: "GET /api/bank", actor: actor.id, role: actor.role });
    activityLog({ event: "world-read", route: "GET /api/bank", actor: actor.id, role: actor.role, version: state.version });
    return json({ state: apiView(state, actor), actor });
  } catch (error) {
    return errorResponse(error, { route: "GET /api/bank", actor: actorId });
  }
}
export async function POST(request: Request) {
  let actorId: string | undefined;
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      throw new ApiError(403, "Origin not allowed.");
    const body = await readJson(request);
    const store = await throttleStore();
    const { actor, since } = await guardedAuthentication(store, clientKey(request), () =>
      authenticate(request),
    );
    actorId = actor.id;
    await throttle(store, `write:${actor.id}`, throttleRules.write);
    const action = actionSchema.parse(body);
    for (let attempt = 0; attempt < 5; attempt++) {
      const state = await loadWorld();
      enforcePreferredLength(
        since,
        state.customers.find((item) => item.id === actor.id)?.sessionHours,
      );
      const next = executeAction(state, actor, action);
      const committed = await saveWorld(next, state.version);
      // Commit, or compare-and-swap conflict (nothing written; the loop retries on fresh data).
      activityLog({
        event: committed ? "world-commit" : "world-conflict",
        route: "POST /api/bank",
        actor: actor.id,
        action: action.type,
        version: state.version,
        ...(committed ? { next: next.version } : { attempt: attempt + 1 }),
      });
      if (committed) return json({ state: apiView(next, actor), actor });
    }
    throw new ApiError(409, "Another operation is in progress. Please retry.");
  } catch (error) {
    return errorResponse(error, { route: "POST /api/bank", actor: actorId });
  }
}
