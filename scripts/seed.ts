import { createClient } from "@supabase/supabase-js";
import { seedBank } from "../src/services/bank";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const password = process.env.DEMO_SEED_PASSWORD;
  if (!url || !key || !password || password.length < 12) throw new Error("Set Supabase URL, server service key and DEMO_SEED_PASSWORD (12+ characters).");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const world = seedBank();
  const { data: existing, error: existingError } = await db.from("bank_world").select("id").eq("id", 1).maybeSingle();
  if (existingError) throw existingError;
  if (existing) throw new Error("Bank already seeded. Use the administrator simulation reset, not this script.");
  for (const customer of world.customers) {
    const oldId = customer.id;
    const { data, error } = await db.auth.admin.createUser({ email: customer.email, password, email_confirm: true });
    if (error || !data.user) throw error || new Error("Failed to create user");
    customer.id = data.user.id;
    world.accounts.forEach(item => { if (item.owner === oldId) item.owner = customer.id; });
    world.beneficiaries.forEach(item => { if (item.owner === oldId) item.owner = customer.id; });
    world.cards.forEach(item => { if (item.owner === oldId) item.owner = customer.id; });
    world.payments.forEach(item => { if (item.owner === oldId) item.owner = customer.id; });
    world.tickets.forEach(item => { if (item.owner === oldId) item.owner = customer.id; });
    const { error: roleError } = await db.from("profiles").update({ role: customer.role }).eq("id", customer.id);
    if (roleError) throw roleError;
  }
  const { error } = await db.from("bank_world").insert({ id: 1, data: world });
  if (error) throw error;
  console.log("Seeded six customers, two staff users and 360 transactions. Password was supplied via environment.");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });