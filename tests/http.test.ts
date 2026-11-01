import { test } from "node:test";
import assert from "node:assert/strict";
import { ZodError } from "zod";
import { BankError, actionSchema } from "../src/services/bank";
import { ApiError, errorResponse, readJson } from "../src/services/http";
import { POST as logout } from "../src/app/api/logout/route";
import { POST as cspReport } from "../src/app/api/csp-report/route";
import { memoryThrottleStore, setThrottleStore } from "../src/services/throttle";

// The report endpoint is throttled; counters live in memory here instead of the database.
setThrottleStore(memoryThrottleStore());

const url = "http://localhost:3000/api/bank";
const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request(url, {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...headers },
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  } as RequestInit);
const status = async (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error) => (error instanceof ApiError ? error.status : 0),
  );

/** A body that would stream `total` bytes in 1 KB chunks, recording how much was actually pulled. */
function stream(total: number) {
  const seen = { pulled: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (seen.pulled >= total) return controller.close();
      seen.pulled += 1024;
      controller.enqueue(new Uint8Array(1024).fill(0x20));
    },
    cancel() {
      seen.cancelled = true;
    },
  });
  return { body, seen };
}

test("request bodies over 8 KB are refused before they are fully read", async () => {
  assert.deepEqual(await readJson(post('{"type":"reset"}')), { type: "reset" });
  assert.equal(await status(readJson(post("{}", { "content-length": "8193" }))), 413);
  assert.equal(await status(readJson(post("{}", { "content-length": "-1" }))), 413);
  const declared = stream(10_000_000);
  assert.equal(await status(readJson(post(declared.body, { "content-length": "10000000" }))), 413);
  assert.equal(declared.seen.pulled <= 2048, true);
  const chunked = stream(10_000_000);
  assert.equal(await status(readJson(post(chunked.body))), 413);
  assert.equal(chunked.seen.cancelled, true);
  assert.ok(chunked.seen.pulled <= 16 * 1024, `pulled ${chunked.seen.pulled} bytes`);
  assert.equal(await status(readJson(post(" ".repeat(8192)))), 400);
  assert.equal(await status(readJson(post(" ".repeat(8193)))), 413);
});

test("only well-formed UTF-8 JSON with a JSON content type is accepted", async () => {
  assert.equal(await status(readJson(post("{}", { "content-type": "text/plain" }))), 415);
  assert.equal(await status(readJson(post("{}", { "content-type": "application/json; charset=latin1" }))), 415);
  assert.equal(await status(readJson(post("{}", { "content-type": "application/json; charset=utf-8" }))), 200);
  for (const bytes of [[0x22, 0xc0, 0xaf, 0x22], [0x22, 0x80, 0x22], [0x22, 0xed, 0xa0, 0x80, 0x22], [0x22, 0xf8, 0x88, 0x80, 0x80, 0x80, 0x22]])
    await assert.rejects(readJson(post(new Uint8Array(bytes))), { status: 400, message: "Request body must be valid UTF-8." });
  await assert.rejects(readJson(post('{"name": "secret-value"')), (error: unknown) =>
    error instanceof ApiError && error.status === 400 && !error.message.includes("secret-value"));
});

test("errors reach the client as generic messages; details stay in the server logs", async () => {
  const logged: Record<string, unknown>[] = [];
  const security: Record<string, unknown>[] = [];
  const log = { error: (entry: Record<string, unknown>) => logged.push(entry), security: (entry: Record<string, unknown>) => security.push(entry) };
  const context = { route: "POST /api/bank", actor: "customer-1" };
  const read = async (response: Response) => ({ status: response.status, body: await response.json() });
  assert.deepEqual(await read(errorResponse(new ApiError(401, "Please sign in again.", "unauthorized"), context, log)), {
    status: 401,
    body: { error: "Please sign in again.", code: "unauthorized" },
  });
  assert.deepEqual(await read(errorResponse(new BankError("Card not found.", 404), context, log)), {
    status: 404,
    body: { error: "Card not found." },
  });
  const invalid = actionSchema.safeParse({ type: "advance", days: 99, note: "<script>secret</script>" });
  assert.ok(!invalid.success && invalid.error instanceof ZodError);
  assert.deepEqual(await read(errorResponse(invalid.error, context, log)), {
    status: 400,
    body: { error: "Invalid request. Check the supplied values." },
  });
  // Denials and validation failures are security events; they never copy the submitted values.
  assert.deepEqual(security.map((entry) => [entry.event, entry.status, entry.route, entry.actor]), [
    ["request-denied", 401, "POST /api/bank", "customer-1"],
    ["request-denied", 404, "POST /api/bank", "customer-1"],
    ["request-denied", 400, "POST /api/bank", "customer-1"],
  ]);
  assert.equal(security[2].reason, "invalid days");
  assert.equal(JSON.stringify(security).includes("secret"), false);
  assert.equal(logged.length, 0);
  for (const internal of [
    new Error("Database not initialized. Run the seed script."),
    new Error("Server database is not configured."),
    new SyntaxError('Unexpected token s in JSON at position 9: {"name": s'),
    new TypeError("Cannot read properties of undefined (reading 'balance')"),
    "thrown string",
  ]) {
    const response = await read(errorResponse(internal, context, log));
    assert.equal(response.status, 500);
    assert.deepEqual(Object.keys(response.body).sort(), ["error", "reference"]);
    assert.equal(response.body.error, "The bank could not complete the request. Please retry.");
    assert.match(response.body.reference, /^[0-9a-f-]{36}$/);
    assert.equal(logged.at(-1)?.reference, response.body.reference);
  }
  assert.match(String(logged[0].error), /Database not initialized/);
});

test("logout tells the browser to clear this site's data, for same-origin calls only", async () => {
  const response = logout(new Request("http://localhost:3000/api/logout", {
    method: "POST",
    headers: { origin: "http://localhost:3000", "sec-fetch-site": "same-origin" },
  }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("clear-site-data"), '"cache", "cookies", "storage"');
  assert.equal(response.headers.get("cache-control"), "no-store, private");
  const forged = logout(new Request("http://localhost:3000/api/logout", {
    method: "POST",
    headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
  }));
  assert.equal(forged.status, 403);
  assert.equal(forged.headers.get("clear-site-data"), null);
});

test("CSP violation reports are accepted, bounded and logged", async () => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (message: string) => warnings.push(message);
  try {
    const report = (body: string, type = "application/csp-report") =>
      cspReport(new Request("http://localhost:3000/api/csp-report", { method: "POST", body, headers: { "content-type": type } }));
    const legacy = await report(JSON.stringify({ "csp-report": { "document-uri": "http://localhost:3000/", "violated-directive": "script-src-elem", "blocked-uri": "https://evil.example/x.js" } }));
    assert.equal(legacy.status, 204);
    const modern = await report(JSON.stringify([{ type: "csp-violation", body: { documentURL: "http://localhost:3000/", effectiveDirective: "img-src", blockedURL: "https://tracker.example/p.gif" } }]), "application/reports+json");
    assert.equal(modern.status, 204);
    assert.deepEqual(warnings.map((line) => JSON.parse(line).directive), ["script-src-elem", "img-src"]);
    assert.equal((await report("x".repeat(20_000))).status, 413);
    assert.equal((await report("{}", "text/html")).status, 415);
  } finally {
    console.warn = original;
  }
});
