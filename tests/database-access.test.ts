import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { apiRole, databaseCredentials, signApiRoleToken } from "../src/database/credentials";

const tokenFor = (role: string) => `e30.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.sig`;
const keys = { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", SUPABASE_SERVICE_ROLE_KEY: "service-key" };

test("the server works as bank_api with the public key; the service key is never used in production", () => {
  const roleToken = tokenFor("bank_api");
  assert.deepEqual(databaseCredentials({ ...keys, NODE_ENV: "production", SUPABASE_API_ROLE_TOKEN: roleToken }), {
    apiKey: "sb_publishable_x",
    roleToken,
  });
  assert.throws(() => databaseCredentials({ ...keys, NODE_ENV: "production" }), /not configured/);
  assert.throws(
    () => databaseCredentials({ ...keys, NODE_ENV: "production", SUPABASE_API_ROLE_TOKEN: tokenFor("service_role") }),
    /bank_api role/,
    "a service_role token pasted as the role token is refused",
  );
  assert.throws(() => databaseCredentials({ ...keys, NODE_ENV: "development", SUPABASE_API_ROLE_TOKEN: "garbage" }), /bank_api role/);
  assert.throws(() => databaseCredentials({ NODE_ENV: "production", SUPABASE_API_ROLE_TOKEN: roleToken }), /not configured/);
  // Only a development server talking to a local stack may fall back to that stack's service key.
  assert.deepEqual(databaseCredentials({ ...keys, NODE_ENV: "development" }), { apiKey: "service-key" });
  assert.throws(() => databaseCredentials({ NODE_ENV: "development" }), /not configured/);
});

test("role tokens are HS256 JWTs for bank_api that expire within 90 days", () => {
  const secret = "s".repeat(40);
  const now = Date.UTC(2026, 9, 19);
  const jwt = signApiRoleToken(secret, { now });
  const [header, payload, signature] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "HS256", typ: "JWT" });
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString()), {
    iss: "supabase",
    role: apiRole,
    iat: now / 1000,
    exp: now / 1000 + 30 * 86_400,
  });
  assert.equal(signature, createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url"));
  assert.equal(databaseCredentials({ ...keys, NODE_ENV: "production", SUPABASE_API_ROLE_TOKEN: jwt }).roleToken, jwt);
  for (const days of [0, 91, 1.5]) assert.throws(() => signApiRoleToken(secret, { days }), /1 to 90 days/);
  assert.throws(() => signApiRoleToken("too-short"), /32 characters/);
});

test("the migrations grant the API role exactly what docs/database-access.md lists", () => {
  const sql = readdirSync("supabase/migrations")
    .sort()
    .map((file) => readFileSync(`supabase/migrations/${file}`, "utf8"))
    .join("\n");
  const toApi = (to: string) => to.split(",").map((role) => role.trim()).includes(apiRole);
  const grants = [...sql.matchAll(/grant\s+([^;]+?)\s+to\s+([a-z_, ]+);/gi)]
    .filter(([, , to]) => toApi(to))
    .map(([, what]) => what.replace(/\s+/g, " ").trim());
  assert.deepEqual(grants.sort(), [
    "execute on function public.commit_bank_world(jsonb, bigint)",
    "execute on function public.throttle_hit(text, integer, integer, integer)",
    "execute on function public.throttle_wait(text)",
    "select (id, data) on public.bank_world",
    "select (id, role) on public.profiles",
    "select (session_id, actor, last_seen), insert (session_id, actor, last_seen), update (session_id, actor, last_seen) on public.session_activity",
    "usage on schema public",
  ]);
  const policies = [...sql.matchAll(/create policy (\w+) on ([\w.]+) for (\w+) to ([\w, ]+?)\s+(?:using|with)\b/gi)]
    .filter(([, , , , to]) => toApi(to))
    .map(([, name, table, command]) => `${name} ${table} ${command}`);
  assert.deepEqual(policies.sort(), [
    "api_reads_roles public.profiles select",
    "api_reads_sessions public.session_activity select",
    "api_reads_world public.bank_world select",
    "api_records_sessions public.session_activity insert",
    "api_refreshes_sessions public.session_activity update",
  ]);
  assert.match(sql, /create role bank_api nologin noinherit;/);
  assert.doesNotMatch(sql, /alter default privileges[^;]*bank_api/i);
  assert.doesNotMatch(sql, /alter role bank_api[^;]*(bypassrls|login|superuser)/i);
  const documented = readFileSync("docs/database-access.md", "utf8");
  for (const object of ["bank_world", "profiles", "session_activity", "commit_bank_world()", "throttle_hit()"])
    assert.ok(documented.includes(object), object);
});

test("audit_events stays append-only: no write grants, changes refused by triggers, rows hash-chained", () => {
  const sql = readdirSync("supabase/migrations")
    .sort()
    .map((file) => readFileSync(`supabase/migrations/${file}`, "utf8"))
    .join("\n");
  assert.doesNotMatch(sql, /grant[^;]*\b(insert|update|delete|truncate|all)\b[^;]*on (table )?public\.audit_events/i);
  assert.match(sql, /create trigger audit_events_no_change before update or delete on public\.audit_events/);
  assert.match(sql, /create trigger audit_events_no_truncate before truncate on public\.audit_events/);
  assert.match(sql, /create trigger audit_events_chain before insert on public\.audit_events/);
  assert.match(sql, /grant execute on function public\.audit_chain_broken_at\(\), public\.audit_report\(integer\)\s+to bank_auditor, service_role;/);
});

test("the service key keeps only what operator tooling and the development fallback use", () => {
  const sql = readFileSync("supabase/migrations/006_api_role.sql", "utf8").replace(/\s+/g, " ");
  assert.match(sql, /revoke all on public\.bank_world, public\.profiles, public\.session_activity, public\.request_limits from service_role;/);
  assert.match(sql, /grant select, insert, update on public\.bank_world, public\.profiles, public\.session_activity to service_role;/);
  assert.match(sql, /grant select, delete on public\.request_limits to service_role;/);
  const later = readdirSync("supabase/migrations")
    .filter((file) => file.slice(0, 3) > "006")
    .map((file) => readFileSync(`supabase/migrations/${file}`, "utf8"))
    .join("\n");
  assert.doesNotMatch(later, /grant[^;]*on public\.(bank_world|profiles|session_activity|request_limits)[^;]*to[^;]*service_role/i);
});
