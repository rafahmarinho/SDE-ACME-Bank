import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BankError,
  executeAction,
  seedBank,
  type Actor,
} from "../src/services/bank";
import { apiView } from "../src/services/api-view";
import { privacyNotice } from "../src/services/privacy";

const alex: Actor = { id: "customer-1", role: "customer" };
const jordan: Actor = { id: "customer-2", role: "customer" };
const support: Actor = { id: "support-1", role: "support" };
const admin: Actor = { id: "admin-1", role: "administrator" };
const denied = (run: () => unknown) =>
  assert.throws(
    run,
    (error) => error instanceof BankError && [403, 404].includes(error.status),
  );

test("every client-supplied object key is resolved against the caller", () => {
  const state = seedBank();
  const key = () => crypto.randomUUID();
  // Jordan owns checking-2, ben-2, rent-2, pay-2 and card-2; ticket-1 belongs to Alex.
  denied(() => executeAction(state, alex, { type: "transfer", account: "checking-2", beneficiary: "ben-1", amount: 100, key: key() }));
  denied(() => executeAction(state, alex, { type: "transfer", account: "checking-1", beneficiary: "ben-2", amount: 100, key: key() }));
  denied(() => executeAction(state, alex, { type: "schedule", account: "checking-2", beneficiary: "ben-1", amount: 100, due: "2026-10-20" }));
  denied(() => executeAction(state, alex, { type: "schedule", account: "checking-1", beneficiary: "rent-2", amount: 100, due: "2026-10-20" }));
  denied(() => executeAction(state, alex, { type: "cancel-payment", id: "pay-2" }));
  denied(() => executeAction(state, alex, { type: "card", id: "card-2", frozen: true, limit: 250000 }));
  denied(() => executeAction(state, alex, { type: "remove-beneficiary", id: "ben-2" }));
  denied(() => executeAction(state, jordan, { type: "reply", id: "ticket-1", message: "Hello there", resolve: false }));
  assert.equal(state.payments.find((item) => item.id === "pay-2")?.status, "scheduled");
  assert.equal(state.cards.find((item) => item.id === "card-2")?.frozen, false);
});

test("removing another customer's beneficiary reveals nothing and changes nothing", () => {
  const state = seedBank();
  // rent-2 has a scheduled payment and ben-2 has none: both answer exactly like an unknown ID.
  for (const id of ["rent-2", "ben-2", "does-not-exist"])
    assert.throws(() => executeAction(state, alex, { type: "remove-beneficiary", id }), {
      message: "Beneficiary not found.",
    });
  assert.throws(
    () => executeAction(state, jordan, { type: "remove-beneficiary", id: "rent-2" }),
    /Cancel scheduled payments/,
  );
  const next = executeAction(state, jordan, { type: "remove-beneficiary", id: "ben-2" });
  assert.equal(next.beneficiaries.length, state.beneficiaries.length - 1);
  assert.equal(next.beneficiaries.some((item) => item.id === "ben-2"), false);
  assert.equal(next.events[0].message, "Beneficiary removed");
});

test("banking actions are refused until the account is opened with consent", () => {
  let state = seedBank();
  const newcomer: Actor = { id: "new-customer", role: "customer" };
  state.customers.push({
    id: newcomer.id,
    name: "New customer",
    email: "new@example.com",
    role: "customer",
    onboarded: false,
    notifications: true,
  });
  for (const action of [
    { type: "beneficiary", name: "Pat Doe", account: "12345678", bank: "ACME Bank" },
    { type: "ticket", subject: "Hello", message: "Can you help me?" },
    { type: "profile", name: "Pat Doe", notifications: false },
    { type: "transfer", account: "checking-1", beneficiary: "ben-1", amount: 100, key: crypto.randomUUID() },
    { type: "cancel-payment", id: "pay-1" },
  ])
    assert.throws(() => executeAction(state, newcomer, action), /Open your account/);
  const privacy = {
    notice: privacyNotice.version,
    language: privacyNotice.language,
    consents: { notifications: false, "statement-archive": false },
    restricted: [],
  };
  assert.throws(() => executeAction(state, newcomer, { type: "onboard", name: "Pat Doe", consent: false, privacy }));
  state = executeAction(state, newcomer, { type: "onboard", name: "Pat Doe", consent: true, privacy });
  assert.match(state.events[0].message, /terms accepted/);
  assert.throws(
    () => executeAction(state, newcomer, { type: "onboard", name: "Pat Doe", consent: true, privacy }),
    /already opened/,
  );
  state = executeAction(state, newcomer, { type: "ticket", subject: "Hello", message: "Can you help me?" });
  assert.equal(state.tickets.at(-1)?.owner, newcomer.id);
});

test("out-of-order requests are refused by the server", () => {
  let state = seedBank();
  assert.throws(
    () => executeAction(state, alex, { type: "schedule", account: "checking-1", beneficiary: "rent-1", amount: 1000, due: "2026-10-12" }),
    /future payment date/,
  );
  state = executeAction(state, admin, { type: "advance", days: 3 });
  assert.equal(state.payments.find((item) => item.id === "pay-1")?.status, "paid");
  assert.throws(() => executeAction(state, alex, { type: "cancel-payment", id: "pay-1" }), /not found/);
  assert.throws(
    () => executeAction(state, alex, { type: "reply", id: "ticket-1", message: "Done", resolve: true }),
    /Staff access/,
  );
});

test("API views return only the data each role needs", () => {
  const state = seedBank();
  const own = apiView(state, alex);
  assert.deepEqual(own.customers.map((item) => item.id), ["customer-1"]);
  assert.ok(own.transactions.length > 0);
  assert.ok(own.transactions.every((item) => ["checking-1", "savings-1"].includes(item.account)));
  assert.ok(
    [...own.accounts, ...own.beneficiaries, ...own.payments, ...own.cards, ...own.tickets].every(
      (item) => item.owner === "customer-1",
    ),
  );
  for (const actor of [support, admin]) {
    const view = apiView(state, actor);
    assert.deepEqual(
      [view.transactions, view.beneficiaries, view.payments, view.cards].map((list) => list.length),
      [0, 0, 0, 0],
    );
    assert.ok(view.accounts.every((item) => /^••\d{4}$/.test(item.number)));
    assert.ok("summary" in view);
    assert.deepEqual(view.summary, {
      pendingTransfers: 0,
      transactions: state.transactions.length,
    });
    assert.deepEqual(Object.keys(view.customers[0]).sort(), [
      "email",
      "id",
      "name",
      "notifications",
      "onboarded",
      "role",
    ]);
    assert.equal(view.tickets.length, 1);
  }
  const busy = executeAction(state, alex, { type: "ticket", subject: "Card", message: "Card question here" });
  assert.equal(apiView(busy, support).events.length, 0);
  assert.equal(apiView(busy, admin).events[0].actor, "customer-1");
  const tampered = structuredClone(state);
  Object.assign(tampered.accounts[0], { riskScore: 0.9 });
  Object.assign(tampered.customers[0], { passwordHint: "dog" });
  assert.equal("riskScore" in apiView(tampered, alex).accounts[0], false);
  assert.equal("passwordHint" in apiView(tampered, support).customers[0], false);
});
