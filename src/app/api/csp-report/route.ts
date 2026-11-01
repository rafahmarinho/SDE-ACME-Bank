import { errorResponse, noStore, readJson } from "@/services/http";
import { clientKey, throttle, throttleRules, throttleStore } from "@/services/throttle";

export const dynamic = "force-dynamic";
// Upper bound on server time per request (hosting platforms enforce it from the build output).
export const maxDuration = 5;

const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 300) : undefined);

/** Receives CSP violation reports (report-uri and Reporting API formats) and logs a short summary. */
export async function POST(request: Request) {
  try {
    // Unauthenticated endpoint: limited per client address so it cannot flood the logs.
    await throttle(await throttleStore(), `report:${clientKey(request)}`, throttleRules.report);
    const body = await readJson(request, {
      limit: 16384,
      types: ["application/csp-report", "application/reports+json", "application/json"],
    });
    for (const report of (Array.isArray(body) ? body : [body]).slice(0, 20)) {
      const legacy = (report as { "csp-report"?: Record<string, unknown> })?.["csp-report"];
      const modern = (report as { body?: Record<string, unknown> })?.body;
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "csp-violation",
          document: text(legacy?.["document-uri"] ?? modern?.documentURL),
          directive: text(legacy?.["violated-directive"] ?? modern?.effectiveDirective),
          blocked: text(legacy?.["blocked-uri"] ?? modern?.blockedURL),
        }),
      );
    }
    return new Response(null, { status: 204, headers: noStore });
  } catch (error) {
    return errorResponse(error, { route: "POST /api/csp-report" });
  }
}
