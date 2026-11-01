import { verifyAccessToken } from "@/database/server";
import { errorResponse } from "@/services/http";
import { storageKeyResponse } from "@/services/storage-key";
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

/** Issues the key that encrypts this browser's stored session (see src/services/storage-key.ts). */
export async function POST(request: Request) {
  try {
    const store = await throttleStore();
    const client = clientKey(request);
    await throttle(store, `storage-key:${client}`, throttleRules.storageKey);
    return await storageKeyResponse(request, (token) =>
      guardedAuthentication(store, client, () => verifyAccessToken(token)),
    );
  } catch (error) {
    return errorResponse(error, { route: "POST /api/storage-key" });
  }
}
