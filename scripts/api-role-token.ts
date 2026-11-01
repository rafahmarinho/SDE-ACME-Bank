import { signApiRoleToken } from "../src/database/credentials";

// Prints a JWT for the bank_api database role (supabase/migrations/006_api_role.sql), signed with
// the project's JWT secret (SUPABASE_JWT_SECRET: the legacy JWT secret, kept active, or an imported
// signing key). Put the output straight into the host's secret store as SUPABASE_API_ROLE_TOKEN
// and rotate it before it expires. Usage: pnpm api-role-token [days, default 30, at most 90]
const secret = process.env.SUPABASE_JWT_SECRET ?? "";
const days = Number(process.argv[2] ?? 30);
try {
  process.stdout.write(`${signApiRoleToken(secret, { days })}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unable to sign the token.");
  process.exitCode = 1;
}
