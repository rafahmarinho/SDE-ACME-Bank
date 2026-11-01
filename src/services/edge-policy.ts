import { secureSupabaseUrl } from "@/database/url";
import { json, securityLog } from "./http";

/** Limits on the request line and header fields, applied to every request the proxy sees. */
export const requestLimits = {
  urlLength: 2048,
  headerFields: 64,
  headerFieldBytes: 8192,
  headerBytes: 32768,
} as const;

/** Refuses an overlong URL (414) or too many / too large header fields (431), and logs it. */
export function requestShape(request: Request): Response | null {
  const refuse = (status: number, error: string) => {
    securityLog({ event: "request-refused", status, path: new URL(request.url).pathname.slice(0, 200) });
    return json({ error }, status);
  };
  if (request.url.length > requestLimits.urlLength) return refuse(414, "Request URL too long.");
  let fields = 0;
  let bytes = 0;
  for (const [name, value] of request.headers) {
    fields++;
    bytes += name.length + value.length;
    if (name.length + value.length > requestLimits.headerFieldBytes)
      return refuse(431, "Request header fields too large.");
  }
  if (fields > requestLimits.headerFields || bytes > requestLimits.headerBytes)
    return refuse(431, "Request header fields too large.");
  return null;
}

/**
 * The only API endpoints the application serves. Every other /api path is refused. The page
 * itself ("/") and its static assets are public; banking data needs a bearer token, which the
 * route verifies with Supabase Auth (plus MFA assurance) on every request.
 */
export const apiRoutes: Record<string, { auth: boolean; maxBytes: number }> = {
  "/api/bank": { auth: true, maxBytes: 8192 },
  "/api/csp-report": { auth: false, maxBytes: 16384 },
  "/api/logout": { auth: false, maxBytes: 0 },
  // Authenticated by bearer token or by the HttpOnly storage cookie (checked in the route).
  "/api/storage-key": { auth: false, maxBytes: 512 },
};

/** Early refusal for API requests that can never succeed: unknown path, no token, oversized body. */
export function apiAccess(request: Request): Response | null {
  const { pathname } = new URL(request.url);
  if (pathname !== "/api" && !pathname.startsWith("/api/")) return null;
  const route = apiRoutes[pathname];
  if (!route) return json({ error: "Not found." }, 404);
  if (route.auth && !/^Bearer \S+$/.test(request.headers.get("authorization") ?? ""))
    return json({ error: "Please sign in again.", code: "unauthorized" }, 401);
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > route.maxBytes))
    return json({ error: "Request too large." }, 413);
  return null;
}

/** Origins the browser may connect to: this site and the configured Supabase project only. */
export function supabaseSources(url = "") {
  const allowed = secureSupabaseUrl(url);
  if (!allowed) return "";
  const { protocol, host } = new URL(allowed);
  return protocol === "https:" ? ` https://${host} wss://${host}` : ` http://${host} ws://${host}`;
}

/** Per-request Content-Security-Policy: scripts need the nonce; no inline or eval in production. */
export function contentSecurityPolicy({
  nonce,
  api = false,
  dev = false,
  supabaseUrl,
}: {
  nonce: string;
  api?: boolean;
  dev?: boolean;
  supabaseUrl?: string;
}) {
  if (api)
    return "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://images.unsplash.com",
    "font-src 'self'",
    `connect-src 'self'${supabaseSources(supabaseUrl)}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
    "report-uri /api/csp-report",
  ].join("; ");
}
