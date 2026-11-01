import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BankError,
  actionSchema,
  executeAction,
  seedBank,
  syncEmail,
  visibleState,
  type Actor,
  type BankState,
} from "../src/services/bank";
import { apiView } from "../src/services/api-view";
import {
  activityAllowed,
  consentGiven,
  privacyNotice,
  type PrivacyRecord,
} from "../src/services/privacy";
import { PrivacyChoices, emptyPrivacyDraft } from "../src/components/privacy-choices";
import { Onboarding } from "../src/screens/auth";
import type { BankContext } from "../src/services/use-bank";

const alex: Actor = { id: "customer-1", role: "customer" };
const support: Actor = { id: "support-1", role: "support" };
const admin: Actor = { id: "admin-1", role: "administrator" };
const decision = (
  consents: PrivacyRecord["consents"] = { notifications: false, "statement-archive": false },
  restricted: PrivacyRecord["restricted"] = [],
) => ({ notice: privacyNotice.version, language: privacyNotice.language, consents, restricted });
const profileOf = (state: BankState, id: string) => state.customers.find((item) => item.id === id)!;
function withNewcomer() {
  const state = seedBank();
  state.customers.push({
    id: "new-customer",
    name: "New customer",
    email: "new@example.com",
    role: "customer",
    onboarded: false,
    notifications: true,
  });
  return { state, newcomer: { id: "new-customer", role: "customer" } as Actor };
}

test("the account is opened only with a privacy decision, stored with version, language, identity and time", () => {
  const { state, newcomer } = withNewcomer();
  const onboard = { type: "onboard", name: "Pat Doe", consent: true };
  assert.throws(() => executeAction(state, newcomer, onboard));
  assert.throws(() => executeAction(state, newcomer, { ...onboard, privacy: { ...decision(), notice: "2020-01-01" } }));
  assert.throws(() => executeAction(state, newcomer, { ...onboard, privacy: { ...decision(), language: "fr" } }));
  const before = Date.now();
  const opened = executeAction(state, newcomer, {
    ...onboard,
    privacy: decision({ notifications: true, "statement-archive": false }),
  });
  const record = profileOf(opened, newcomer.id).privacy!;
  assert.equal(record.notice, privacyNotice.version);
  assert.equal(record.language, "en");
  assert.deepEqual(record.consents, { notifications: true, "statement-archive": false });
  assert.deepEqual(record.restricted, []);
  assert.match(record.decidedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(Date.parse(record.decidedAt) >= before - 1000);
  assert.equal(profileOf(opened, newcomer.id).notifications, true);
  // The decision is an event of the verified actor, so it reaches the append-only audit table.
  const recorded = opened.events.find((item) => item.message.startsWith(`Privacy notice ${privacyNotice.version}`));
  assert.equal(recorded?.actor, newcomer.id);
  assert.match(recorded!.message, /Consent granted: notifications/);
});

test("customers without a decision on the current notice are refused until they decide again", () => {
  let state = seedBank();
  profileOf(state, alex.id).privacy = { ...profileOf(state, alex.id).privacy!, notice: "2026-01-01" };
  for (const action of [
    { type: "ticket", subject: "Hello", message: "Can you help me?" },
    { type: "profile", name: "Alex Morgan", notifications: true },
    { type: "card", id: "card-1", frozen: true, limit: 250000 },
    { type: "transfer", account: "checking-1", beneficiary: "ben-1", amount: 100, key: crypto.randomUUID() },
  ])
    assert.throws(() => executeAction(state, alex, action), /Review the privacy notice/);
  // New purpose, new consent: nothing optional is carried over from the old notice.
  assert.equal(consentGiven(profileOf(state, alex.id).privacy, "notifications"), false);
  state = executeAction(state, alex, { type: "privacy", ...decision() });
  assert.equal(profileOf(state, alex.id).privacy!.notice, privacyNotice.version);
  state = executeAction(state, alex, { type: "ticket", subject: "Hello", message: "Can you help me?" });
  assert.equal(state.tickets.at(-1)?.owner, alex.id);
  // Staff are not data subjects of this notice and are never gated.
  executeAction(state, support, { type: "reply", id: "ticket-1", message: "On it", resolve: false });
});

test("withdrawing consent stops the related processing on the server", () => {
  let state = executeAction(seedBank(), alex, { type: "ticket", subject: "Card", message: "Card question here" });
  assert.ok(visibleState(state, alex).events.length > 0);
  assert.equal(consentGiven(profileOf(state, alex.id).privacy, "statement-archive"), true);
  state = executeAction(state, alex, { type: "privacy", ...decision() });
  assert.deepEqual(visibleState(state, alex).events, [], "no notification feed after withdrawal");
  assert.deepEqual(apiView(state, alex).events, []);
  assert.equal(profileOf(state, alex.id).notifications, false);
  assert.equal(consentGiven(profileOf(state, alex.id).privacy, "statement-archive"), false);
  assert.match(state.events[0].message, /Consent withdrawn: notifications · Consent withdrawn: statement-archive/);
  // The notifications switch in the profile is the same consent, recorded the same way.
  state = executeAction(state, alex, { type: "profile", name: "Alex Morgan", notifications: true });
  assert.equal(consentGiven(profileOf(state, alex.id).privacy, "notifications"), true);
  assert.ok(state.events.some((item) => item.message === "Consent granted: notifications"));
  assert.ok(visibleState(state, alex).events.length > 0);
});

test("a customer can restrict simulations on their account and the server checks it first", () => {
  let state = seedBank();
  state = executeAction(state, alex, {
    type: "privacy",
    ...decision({ notifications: true, "statement-archive": true }, ["simulation"]),
  });
  assert.equal(activityAllowed(profileOf(state, alex.id).privacy, "simulation"), false);
  assert.match(state.events[0].message, /Processing restricted: simulation/);
  const balance = state.accounts.find((item) => item.id === "checking-1")!.balance;
  assert.throws(
    () => executeAction(state, admin, { type: "scenario", scenario: "deposit", customer: alex.id }),
    (error) => error instanceof BankError && error.status === 403 && /restricted/.test(error.message),
  );
  assert.equal(state.accounts.find((item) => item.id === "checking-1")!.balance, balance);
  // Other customers are unaffected, and lifting the restriction allows it again.
  executeAction(state, admin, { type: "scenario", scenario: "deposit", customer: "customer-2" });
  state = executeAction(state, alex, { type: "privacy", ...decision({ notifications: true, "statement-archive": true }) });
  assert.match(state.events[0].message, /Restriction lifted: simulation/);
  executeAction(state, admin, { type: "scenario", scenario: "deposit", customer: alex.id });
});

test("privacy decisions are validated strictly and survive a simulation reset", () => {
  for (const bad of [
    { ...decision(), consents: { notifications: true, "statement-archive": false, marketing: true } },
    { ...decision(), consents: { notifications: true } },
    { ...decision(), restricted: ["simulation", "simulation"] },
    { ...decision(), restricted: ["profiling"] },
    { ...decision(), notice: privacyNotice.version + "x" },
  ])
    assert.equal(actionSchema.safeParse({ type: "privacy", ...bad }).success, false, JSON.stringify(bad));
  let state = executeAction(seedBank(), alex, { type: "privacy", ...decision({ notifications: false, "statement-archive": false }, ["simulation"]) });
  state = executeAction(state, admin, { type: "reset" });
  const kept = profileOf(state, alex.id);
  assert.deepEqual(kept.privacy!.restricted, ["simulation"]);
  assert.equal(kept.privacy!.consents["statement-archive"], false);
  assert.equal(kept.notifications, false);
});

test("staff never receive customers' privacy records; the owner does", () => {
  const state = seedBank();
  const own = apiView(state, alex).customers[0];
  assert.ok("privacy" in own && own.privacy?.notice === privacyNotice.version);
  for (const actor of [support, admin])
    assert.ok(apiView(state, actor).customers.every((item) => !("privacy" in item)));
});

test("the verified sign-in email is propagated to the bank record without creating duplicates", () => {
  const state = seedBank();
  const synced = syncEmail(state, alex.id, "alex.new@example.com")!;
  assert.equal(profileOf(synced, alex.id).email, "alex.new@example.com");
  assert.equal(synced.version, state.version + 1);
  assert.equal(synced.events[0].message, "Email address updated from the verified sign-in record");
  assert.equal(syncEmail(synced, alex.id, "alex.new@example.com"), null, "already in step");
  assert.equal(syncEmail(state, alex.id, "Jordan.Lee@example.com"), null, "belongs to another record");
  for (const invalid of [undefined, "", "not-an-email", `${"a".repeat(250)}@x.io`])
    assert.equal(syncEmail(state, alex.id, invalid), null);
});

test("duplicate records are removed and duplicate beneficiaries refused", () => {
  const state = seedBank();
  state.customers.push(structuredClone(profileOf(state, alex.id)));
  const next = executeAction(state, alex, { type: "ticket", subject: "Hi", message: "Duplicate check" });
  assert.equal(next.customers.filter((item) => item.id === alex.id).length, 1);
  assert.ok(next.events.some((item) => item.message === "Duplicate customer records removed: 1"));
  assert.throws(
    () => executeAction(next, alex, { type: "beneficiary", name: "Someone Else", account: "8834001009", bank: "northline bank" }),
    /already saved/,
  );
  executeAction(next, alex, { type: "beneficiary", name: "Oakwood Apartments", account: "8834001009", bank: "Other Bank" });
});

test("optional consent items start unselected and each says why it is asked", () => {
  const html = renderToStaticMarkup(
    createElement(PrivacyChoices, { value: emptyPrivacyDraft(), onChange: () => {} }),
  );
  const boxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
  assert.equal(boxes.length, 3);
  assert.ok(boxes.every((box) => !/checked/.test(box)));
  assert.equal((html.match(/Optional/g) ?? []).length, 3);
  assert.match(html, /Required:/);
  for (const item of privacyNotice.purposes) assert.ok(html.includes(item.why.replace(/'/g, "&#x27;")), item.id);
});

test("account opening shows the privacy consent apart from the terms, with a way to decline", () => {
  const bank = { error: "", busy: false, act: async () => true, signOut: async () => {} };
  const html = renderToStaticMarkup(createElement(Onboarding, { bank: bank as unknown as BankContext }));
  const privacy = html.slice(html.indexOf('<fieldset class="privacy-box">'), html.indexOf("</fieldset>"));
  assert.match(privacy, /<legend>Your privacy choices<\/legend>/);
  assert.match(privacy, /Read the full privacy notice/);
  assert.equal((privacy.match(/type="checkbox"/g) ?? []).length, 3);
  assert.doesNotMatch(privacy, /checked=""/);
  assert.doesNotMatch(privacy, /simulated banking terms/, "the terms are accepted outside the consent section");
  assert.equal((html.match(/class="check-label"/g) ?? []).length, 1, "one terms checkbox");
  assert.match(html, /Open simulated account/);
  assert.match(html, /Decline and sign out/);
  assert.ok(html.indexOf("privacy-box") < html.indexOf('name="name"'), "consent comes before the name is collected");
});
