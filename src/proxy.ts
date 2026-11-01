import { NextResponse, type NextRequest } from "next/server";
import { apiAccess, contentSecurityPolicy, requestShape } from "@/services/edge-policy";

export function proxy(request: NextRequest) {
  const refused = requestShape(request) ?? apiAccess(request);
  if (refused) return refused;
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const policy = contentSecurityPolicy({
    nonce,
    api: request.nextUrl.pathname.startsWith("/api/"),
    dev: process.env.NODE_ENV === "development",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  // Next.js reads the nonce from the request's CSP header and applies it to its own scripts.
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    "/api/:path*",
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
