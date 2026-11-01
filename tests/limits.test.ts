import { test } from "node:test";
import assert from "node:assert/strict";
import {
  caps,
  executeAction,
  limits,
  outgoingToday,
  seedBank,
  type Actor,
} from "../src/services/bank";

const alex: Actor = { id: "customer-1", role: "customer" };
const support: Actor = { id: "support-1", role: "support" };
const admin: Actor = { id: "admin-1", role: "administrator" };
const transfer = (beneficiary: string, amount: number) => ({
  type: "transfer",
  account: "checking-1",
  beneficiary,
  amount,
  key: crypto.randomUUID(),
});

test("transfers above the per-transfer and daily limits are refused", () => {
  let state = seedBank();
  state.accounts[0].balance = 10_000_000;
  // rent-1 is at another bank; ben-1 is an ACME account (checking-2).
  assert.throws(() => executeAction(state, alex, transfer("rent-1", limits.externalTransfer + 1)), /limited to \$10,000\.00 each/);
  assert.throws(() => executeAction(state, alex, transfer("ben-1", limits.internalTransfer + 1)), /limited to \$25,000\.00 each/);
  executeAction(state, alex, transfer("rent-1", limits.externalTransfer));
  state = executeAction(state, alex, transfer("ben-1", 2_000_000));
  assert.equal(outgoingToday(state, "checking-1"), 2_000_000);
  assert.throws(() => executeAction(state, alex, transfer("rent-1", 500_001)), /daily transfer limit of \$25,000\.00/);
  state = executeAction(state, alex, transfer("rent-1", 500_000));
  assert.equal(outgoingToday(state, "checking-1"), limits.dailyOutgoing);
  assert.throws(() => executeAction(state, alex, transfer("ben-1", 1)), /daily transfer limit/);
  state = executeAction(state, admin, { type: "advance", days: 1 });
  assert.equal(outgoingToday(state, "checking-1"), 0);
  executeAction(state, alex, transfer("ben-1", 100));
});

test("scheduled payments follow the same limits when scheduled and when executed", () => {
  let state = seedBank();
  state.accounts[0].balance = 10_000_000;
  assert.throws(
    () => executeAction(state, alex, { type: "schedule", account: "checking-1", beneficiary: "rent-1", amount: limits.externalTransfer + 1, due: "2026-10-13" }),
    /limited to \$10,000\.00 each/,
  );
  for (let index = 0; index < 3; index++)
    state = executeAction(state, alex, { type: "schedule", account: "checking-1", beneficiary: "rent-1", amount: limits.externalTransfer, due: "2026-10-13" });
  state = executeAction(state, admin, { type: "advance", days: 1 });
  const statuses = state.payments.filter((item) => item.due === "2026-10-13").map((item) => item.status);
  assert.deepEqual(statuses, ["paid", "paid", "failed"]);
  assert.equal(outgoingToday(state, "checking-1"), 2 * limits.externalTransfer);
});

test("card spending limits outside the range offered in the app are refused", () => {
  const state = seedBank();
  for (const limit of [limits.cardMin - limits.cardStep, limits.cardMax + limits.cardStep, 100_000_000, 15_050, 250_000.5])
    assert.throws(() => executeAction(state, alex, { type: "card", id: "card-1", frozen: false, limit }));
  for (const limit of [limits.cardMin, limits.cardMax])
    assert.equal(executeAction(state, alex, { type: "card", id: "card-1", frozen: false, limit }).cards[0].limit, limit);
});

test("per-customer collections and the world document stop growing at their caps", () => {
  let state = seedBank();
  const owned = () => state.beneficiaries.filter((item) => item.owner === alex.id).length;
  while (owned() < caps.beneficiaries)
    state = executeAction(state, alex, { type: "beneficiary", name: `Payee ${owned()}`, account: `${10_000_000 + owned()}`, bank: "ACME Bank" });
  assert.throws(
    () => executeAction(state, alex, { type: "beneficiary", name: "One more", account: "99999999", bank: "ACME Bank" }),
    /up to 50 beneficiaries/,
  );
  const scheduled = () => state.payments.filter((item) => item.owner === alex.id && item.status === "scheduled").length;
  while (scheduled() < caps.scheduledPayments)
    state = executeAction(state, alex, { type: "schedule", account: "checking-1", beneficiary: "rent-1", amount: 1000, due: "2026-12-01" });
  assert.throws(
    () => executeAction(state, alex, { type: "schedule", account: "checking-1", beneficiary: "rent-1", amount: 1000, due: "2026-12-01" }),
    /Scheduled payment limit/,
  );
  const open = () => state.tickets.filter((item) => item.owner === alex.id && item.status === "open").length;
  while (open() < caps.openTickets)
    state = executeAction(state, alex, { type: "ticket", subject: `Question ${open()}`, message: "Please help me" });
  assert.throws(() => executeAction(state, alex, { type: "ticket", subject: "Again", message: "Please help me" }), /request limit/);
  for (let index = 0; index < caps.replies; index++)
    state = executeAction(state, support, { type: "reply", id: "ticket-1", message: `Reply ${index}`, resolve: false });
  assert.throws(() => executeAction(state, alex, { type: "reply", id: "ticket-1", message: "One more", resolve: false }), /reply limit/);

  const crowded = seedBank();
  crowded.transactions = Array.from({ length: caps.transactions }, (_, index) => ({
    ...crowded.transactions[0],
    id: `bulk-${index}`,
    date: "2026-09-01T12:00:00.000Z",
  }));
  assert.throws(() => executeAction(crowded, alex, transfer("ben-1", 100)), /activity limit/);
  assert.equal(executeAction(crowded, admin, { type: "reset" }).transactions.length, 360);
});
