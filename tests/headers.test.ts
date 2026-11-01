import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  apiAccess,
  apiRoutes,
  contentSecurityPolicy,
  requestLimits,
  requestShape,
} from "../src/services/edge-policy";
import { proxy } from "../src/proxy";

const directives = (policy: string) =>
  Object.fromEntries(
    policy.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values];
    }),
  );

test("the production CSP requires a nonce for scripts and pins every source", () => {
  const policy = directives(
    contentSecurityPolicy({ nonce: "abc123", supabaseUrl: "https://project.supabase.co" }),
  );
  assert.deepEqual(policy["script-src"], ["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
  assert.deepEqual(policy["default-src"], ["'self'"]);
  assert.deepEqual(policy["connect-src"], ["'self'", "https://project.supabase.co", "wss://project.supabase.co"]);
  assert.deepEqual(policy["form-action"], ["'self'"]);
  assert.deepEqual(policy["frame-src"], ["'none'"]);
  assert.deepEqual(policy["frame-ancestors"], ["'none'"]);
  assert.deepEqual(policy["object-src"], ["'none'"]);
  assert.deepEqual(policy["base-uri"], ["'self'"]);
  assert.deepEqual(policy["report-uri"], ["/api/csp-report"]);
  assert.ok("upgrade-insecure-requests" in policy);
  assert.equal(Object.values(policy).flat().some((value) => value.includes("*")), false);
  const dev = directives(contentSecurityPolicy({ nonce: "n", dev: true }));
  assert.deepEqual(dev["script-src"], ["'self'", "'nonce-n'", "'strict-dynamic'", "'unsafe-eval'"]);
  assert.deepEqual(dev["connect-src"], ["'self'"]);
  assert.deepEqual(directives(contentSecurityPolicy({ nonce: "n", api: true }))["default-src"], ["'none'"]);
});

test("the proxy sends a fresh nonce CSP to the browser and to the renderer", () => {
  const first = proxy(new NextRequest("http://localhost:3000/?view=overview"));
  const second = proxy(new NextRequest("http://localhost:3000/"));
  const policy = first.headers.get("content-security-policy") ?? "";
  const nonce = policy.match(/'nonce-([A-Za-z0-9+/=]{20,})'/)?.[1];
  assert.ok(nonce, policy);
  assert.notEqual(second.headers.get("content-security-policy"), policy);
  assert.equal(first.headers.get("x-middleware-request-x-nonce"), nonce);
  assert.equal(first.headers.get("x-middleware-request-content-security-policy"), policy);
  assert.equal(directives(policy)["script-src"].includes("'unsafe-inline'"), false);
});

test("only the listed API endpoints are served, with token and size checks up front", () => {
  const request = (path: string, headers: Record<string, string> = {}) =>
    new Request(`http://localhost:3000${path}`, { method: "POST", headers });
  assert.deepEqual(Object.keys(apiRoutes).sort(), ["/api/bank", "/api/csp-report", "/api/logout", "/api/storage-key"]);
  assert.equal(apiAccess(request("/")), null);
  assert.equal(apiAccess(request("/?view=staff")), null);
  for (const path of ["/api", "/api/admin", "/api/bank/export", "/api/debug"])
    assert.equal(apiAccess(request(path))?.status, 404, path);
  assert.equal(apiAccess(request("/api/bank"))?.status, 401);
  assert.equal(apiAccess(request("/api/bank", { authorization: "Basic abc" }))?.status, 401);
  assert.equal(apiAccess(request("/api/bank", { authorization: "Bearer token" })), null);
  assert.equal(apiAccess(request("/api/bank", { authorization: "Bearer token", "content-length": "8193" }))?.status, 413);
  assert.equal(apiAccess(request("/api/csp-report", { "content-length": "1200" })), null);
  assert.equal(apiAccess(request("/api/logout", { "content-length": "0" })), null);
  assert.equal(apiAccess(request("/api/logout", { "content-length": "10" }))?.status, 413);
  assert.equal(apiAccess(request("/api/storage-key", { "content-length": "60" })), null);
  assert.equal(apiAccess(request("/api/storage-key", { "content-length": "513" }))?.status, 413);
  assert.equal(proxy(new NextRequest("http://localhost:3000/api/unknown")).status, 404);
  assert.match(proxy(new NextRequest("http://localhost:3000/api/bank", { headers: { authorization: "Bearer t" } })).headers.get("content-security-policy") ?? "", /default-src 'none'/);
});

test("overlong request lines and too many or too large header fields are refused for every request", () => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (line: string) => warnings.push(line);
  try {
    const base = "http://localhost:3000/?view=overview";
    assert.equal(requestShape(new Request(base, { headers: { "user-agent": "test" } })), null);
    const long = `${base}&q=${"a".repeat(requestLimits.urlLength)}`;
    assert.equal(requestShape(new Request(long))?.status, 414);
    assert.equal(proxy(new NextRequest(long)).status, 414, "pages too, not only the API");
    const many = Object.fromEntries(Array.from({ length: requestLimits.headerFields + 1 }, (_, i) => [`x-h${i}`, "1"]));
    assert.equal(requestShape(new Request(base, { headers: many }))?.status, 431);
    const big = { "x-big": "b".repeat(requestLimits.headerFieldBytes) };
    assert.equal(requestShape(new Request(base, { headers: big }))?.status, 431);
    assert.equal(proxy(new NextRequest("http://localhost:3000/api/bank", { headers: { ...big, authorization: "Bearer t" } })).status, 431);
    const total = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`x-part${i}`, "c".repeat(7000)]));
    assert.equal(requestShape(new Request(base, { headers: total }))?.status, 431, "32 KB in total");
    const logged = warnings.map((line) => JSON.parse(line));
    assert.ok(logged.length >= 5 && logged.every((entry) => entry.channel === "security" && entry.event === "request-refused"));
    assert.equal(JSON.stringify(logged).includes("bbbb"), false, "header values are never logged");
  } finally {
    console.warn = original;
  }
});
