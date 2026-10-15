import { test } from "node:test";
import assert from "node:assert/strict";
import { executeAction, seedBank } from "../src/services/bank";

test("reset preserves Supabase identities and ownership", () => {
  const state = seedBank();
  const id = crypto.randomUUID();
  state.customers[0].id = id;
  state.accounts.filter(item => item.owner === "customer-1").forEach(item => { item.owner = id; });
  const admin = crypto.randomUUID();
  state.customers.find(item => item.role === "administrator")!.id = admin;
  const reset = executeAction(state, { id: admin, role: "administrator" }, { type: "reset" });
  assert.equal(reset.customers.find(item => item.email === "alex.morgan@example.com")?.id, id);
  assert.equal(reset.accounts.filter(item => item.owner === id).length, 2);
  assert.equal(reset.customers.find(item => item.role === "administrator")?.id, admin);
});
test("unknown input fields cannot alter role or balances", () => {
  const state = seedBank();
  const next = executeAction(state, { id: "customer-1", role: "customer" }, { type: "profile", name: "Alex", notifications: true, role: "administrator", balance: 9999999 });
  assert.equal(next.customers[0].role, "customer");
  assert.equal(next.accounts[0].balance, state.accounts[0].balance);
});