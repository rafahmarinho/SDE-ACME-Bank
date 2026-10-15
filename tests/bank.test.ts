import { test } from "node:test";
import assert from "node:assert/strict";
import { executeAction, feeFor, parseMoney, seedBank, visibleState } from "../src/services/bank";

const customer = { id: "customer-1", role: "customer" as const };
const admin = { id: "admin-1", role: "administrator" as const };
test("transfers reserve once and settle without double debiting", () => {
  const initial = seedBank();
  const balance = initial.accounts[0].balance;
  const action = { type: "transfer", account: "checking-1", beneficiary: "ben-1", amount: 10000, key: crypto.randomUUID() };
  const sent = executeAction(initial, customer, action);
  assert.equal(sent.accounts[0].balance, balance - 10000 - feeFor(10000));
  const retry = executeAction(sent, customer, action);
  assert.equal(retry.accounts[0].balance, sent.accounts[0].balance);
  const settled = executeAction(retry, admin, { type: "advance", days: 1 });
  assert.equal(settled.accounts[0].balance, sent.accounts[0].balance);
  assert.equal(settled.transactions.find(item => item.key === action.key)?.status, "settled");
  assert.equal(settled.accounts[2].balance, initial.accounts[2].balance + 10000);
});
test("overdraft, foreign ownership, fractional cents and role escalation are rejected", () => {
  const initial = seedBank();
  const action = { type: "transfer", account: "checking-1", beneficiary: "ben-1", amount: initial.accounts[0].balance, key: crypto.randomUUID() };
  assert.throws(() => executeAction(initial, customer, action), /Insufficient funds/);
  assert.throws(() => executeAction(initial, customer, { ...action, account: "checking-2", amount: 100 }), /access denied/);
  assert.throws(() => executeAction(initial, customer, { ...action, amount: 1.5 }));
  assert.throws(() => executeAction(initial, customer, { type: "reset" }), /Administrator/);
  assert.throws(() => executeAction(initial, { id: "support-1", role: "support" }, { ...action, amount: 100 }), /Customer/);
  assert.equal(visibleState(initial, customer).customers.length, 1);
  assert.equal(visibleState(initial, customer).accounts.length, 2);
});
test("scheduled payments run once, card controls affect purchases, reset restores fixture", () => {
  let state = seedBank();
  state = executeAction(state, customer, { type: "card", id: "card-1", frozen: true, limit: 250000 });
  const balance = state.accounts[0].balance;
  state = executeAction(state, admin, { type: "scenario", scenario: "purchase", customer: customer.id });
  assert.equal(state.accounts[0].balance, balance);
  assert.equal(state.transactions[0].status, "failed");
  state = executeAction(state, admin, { type: "advance", days: 3 });
  assert.equal(state.payments[0].status, "paid");
  const afterPayment = state.accounts[0].balance;
  state = executeAction(state, admin, { type: "advance", days: 1 });
  assert.equal(state.accounts[0].balance, afterPayment);
  assert.equal(executeAction(state, admin, { type: "reset" }).transactions.length, 360);
});
test("money parsing uses decimal cents rather than floating point rounding", () => {
  assert.equal(parseMoney("10.29"), 1029);
  assert.equal(parseMoney("0.01"), 1);
  for (const value of ["-1", "NaN", "1.001", "0", "1e3"]) assert.throws(() => parseMoney(value));
});