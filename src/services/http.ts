import { ZodError } from "zod";
import { BankError, errorMessage } from "./bank";

export const noStore = { "Cache-Control": "no-store, private" };
export const maxBodyBytes = 8192;

/** Failure whose HTTP status and message are safe to return to the caller. */
export class ApiError extends Error {
  status: number;
  code?: string;
  /** Seconds the client must wait before retrying (sent as Retry-After). */
  retryAfter?: number;
  constructor(status: number, message: string, code?: string, retryAfter?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...noStore, ...headers } });

/**
 * Reads a JSON body without ever holding more than `limit` bytes: a declared Content-Length
 * above the limit is refused before reading, and the stream is cancelled once it passes the
 * limit. Bytes must be well-formed UTF-8 (overlong and invalid sequences are refused).
 */
export async function readJson(
  request: Request,
  {
    limit = maxBodyBytes,
    types = ["application/json"],
  }: { limit?: number; types?: string[] } = {},
): Promise<unknown> {
  const [type, ...parameters] = (request.headers.get("content-type") ?? "")
    .toLowerCase()
    .split(";")
    .map((part) => part.trim());
  if (
    !types.includes(type) ||
    parameters.some((part) => part.startsWith("charset=") && part !== "charset=utf-8")
  )
    throw new ApiError(415, "JSON required.");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit))
    throw new ApiError(413, "Request too large.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new ApiError(413, "Request too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ApiError(400, "Request body must be valid UTF-8.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "Request body must be valid JSON.");
  }
}

type Log = (entry: Record<string, unknown>) => void;
/** Structured security events on their own channel, so they can be filtered from other logs. */
export const securityLog: Log = (entry) =>
  console.warn(JSON.stringify({ level: "warn", channel: "security", ...entry }));
const errorLog: Log = (entry) => console.error(JSON.stringify(entry));
/**
 * Server and database activity (start and stop, reads and commits of the bank record) on its own
 * channel, with IDs, versions and action names; never personal data.
 */
export const activityLog: Log = (entry) =>
  console.info(
    JSON.stringify({ level: "info", channel: "activity", at: new Date().toISOString(), ...entry }),
  );

/**
 * Central error handler for API routes. Safe, expected failures keep their message and are
 * recorded as security events (denials, validation failures, throttling); anything else becomes
 * a generic 500 with a reference ID, and only the server log gets the details.
 */
export function errorResponse(
  error: unknown,
  context: { route?: string; actor?: string } = {},
  log: { security: Log; error: Log } = { security: securityLog, error: errorLog },
) {
  if (error instanceof ApiError || error instanceof BankError || error instanceof ZodError) {
    const status = error instanceof ZodError ? 400 : error.status;
    log.security({
      event: "request-denied",
      ...context,
      status,
      code: error instanceof ApiError ? error.code : undefined,
      reason:
        error instanceof ZodError
          ? `invalid ${error.issues.map((issue) => issue.path.join(".") || "body").slice(0, 10).join(", ")}`.slice(0, 200)
          : error.message.slice(0, 200),
    });
    if (error instanceof ApiError)
      return json(
        { error: error.message, ...(error.code ? { code: error.code } : {}) },
        error.status,
        error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {},
      );
    if (error instanceof BankError) return json({ error: error.message }, error.status);
    return json({ error: errorMessage(error) }, 400);
  }
  const reference = crypto.randomUUID();
  log.error({
    level: "error",
    reference,
    ...context,
    error: error instanceof Error ? `${error.name}: ${error.message}` : "Non-error thrown",
  });
  return json(
    { error: "The bank could not complete the request. Please retry.", reference },
    500,
  );
}
