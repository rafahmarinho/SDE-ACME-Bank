import { createHmac } from "node:crypto";

/** Database role the API server works as (supabase/migrations/006_api_role.sql). */
export const apiRole = "bank_api";

export type DatabaseCredentials = { apiKey: string; roleToken?: string };

const roleOf = (token: string) => {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.role === "string" ? payload.role : "";
  } catch {
    return "";
  }
};

/**
 * Credentials for the server's Data API calls: the public (publishable) key plus a JWT for the
 * least-privilege bank_api role. A token for any other role (for example the service_role key
 * pasted by mistake) is refused. Only a development server may use the service key of a local
 * stack instead; production never does.
 */
export function databaseCredentials(env: Record<string, string | undefined>): DatabaseCredentials {
  const publishable = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const roleToken = env.SUPABASE_API_ROLE_TOKEN;
  if (roleToken) {
    if (roleOf(roleToken) !== apiRole)
      throw new Error(`SUPABASE_API_ROLE_TOKEN must be a token for the ${apiRole} role.`);
    if (publishable) return { apiKey: publishable, roleToken };
  }
  if (env.NODE_ENV === "development" && !roleToken && env.SUPABASE_SERVICE_ROLE_KEY)
    return { apiKey: env.SUPABASE_SERVICE_ROLE_KEY };
  throw new Error("Server database is not configured.");
}

/**
 * Signs a JWT for the bank_api role with the project's JWT secret (HS256), like Supabase's own
 * role keys. Short-lived by default: rotate it before it expires (scripts/api-role-token.ts).
 */
export function signApiRoleToken(secret: string, { days = 30, now = Date.now() } = {}) {
  if (secret.length < 32) throw new Error("The JWT secret must have at least 32 characters.");
  if (!Number.isInteger(days) || days < 1 || days > 90)
    throw new Error("The token must expire within 1 to 90 days.");
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const issued = Math.floor(now / 1000);
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    iss: "supabase",
    role: apiRole,
    iat: issued,
    exp: issued + days * 86_400,
  })}`;
  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}
