import { ApiError, errorResponse, noStore } from "@/services/http";

export const dynamic = "force-dynamic";
// Upper bound on server time per request (hosting platforms enforce it from the build output).
export const maxDuration = 5;

/** Called by the client after sign-out so the browser drops this origin's cache, cookies and storage. */
export function POST(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  if ((site && site !== "same-origin") || (origin && origin !== new URL(request.url).origin))
    return errorResponse(new ApiError(403, "Origin not allowed."), { route: "POST /api/logout" });
  return new Response(null, {
    status: 204,
    headers: { ...noStore, "Clear-Site-Data": '"cache", "cookies", "storage"' },
  });
}
