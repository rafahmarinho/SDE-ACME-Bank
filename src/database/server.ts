import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Actor, BankState } from "@/services/bank";

export function serviceClient() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  )
    throw new Error("Server database is not configured.");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export async function authenticate(request: Request): Promise<Actor> {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (!token || token.length > 8192) throw new Error("Unauthorized");
  const db = serviceClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser(token);
  if (error || !user) throw new Error("Unauthorized");
  const { data: claims, error: claimsError } = await db.auth.getClaims(token);
  if (claimsError || claims?.claims.aal !== "aal2") throw new Error("Multi-factor authentication required.");
  const { data: profile } = await db
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();
  if (
    !profile ||
    !["customer", "support", "administrator"].includes(profile.role)
  )
    throw new Error("Unauthorized");
  return profile as Actor;
}
export async function loadWorld(): Promise<BankState> {
  const { data, error } = await serviceClient()
    .from("bank_world")
    .select("data")
    .eq("id", 1)
    .single();
  if (error || !data)
    throw new Error("Database not initialized. Run the seed script.");
  return data.data as BankState;
}
export async function saveWorld(state: BankState, expectedVersion: number) {
  const { data, error } = await serviceClient().rpc("commit_bank_world", {
    next_data: state,
    expected_version: expectedVersion,
  });
  if (error) throw new Error("Unable to save changes.");
  return data === true;
}
