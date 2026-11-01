import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  actionSchema,
  errorMessage,
  executeAction,
  seedBank,
  withScriptNotice,
} from "../src/services/bank";
import { ScriptName } from "../src/components/script-name";
import { privacyNotice } from "../src/services/privacy";

const privacy = {
  notice: privacyNotice.version,
  language: privacyNotice.language,
  consents: { notifications: false, "statement-archive": true },
  restricted: ["simulation"],
};

// One valid request per action, then every input field with values outside its acceptance criteria.
const valid: Record<string, Record<string, unknown>> = {
  transfer: { type: "transfer", account: "checking-1", beneficiary: "ben-1", amount: 100, key: "6f1c8d3e-2b7a-4c1d-9e0f-1a2b3c4d5e6f" },
  beneficiary: { type: "beneficiary", name: "Pat O’Neil-Smith", account: "12345678", bank: "ACME Bank" },
  "remove-beneficiary": { type: "remove-beneficiary", id: "ben-1" },
  schedule: { type: "schedule", account: "checking-1", beneficiary: "rent-1", amount: 100, due: "2026-10-20" },
  "cancel-payment": { type: "cancel-payment", id: "pay-1" },
  card: { type: "card", id: "card-1", frozen: false, limit: 250000 },
  profile: { type: "profile", name: "Alex Morgan", notifications: true },
  onboard: { type: "onboard", name: "Alex Morgan", consent: true, privacy },
  privacy: { type: "privacy", ...privacy },
  ticket: { type: "ticket", subject: "Statement", message: "Where is my statement?\nThanks." },
  reply: { type: "reply", id: "ticket-1", message: "Thanks", resolve: false },
  scenario: { type: "scenario", scenario: "deposit", customer: "customer-1" },
  advance: { type: "advance", days: 1 },
  reset: { type: "reset" },
};
const invalid: Record<string, Record<string, unknown[]>> = {
  transfer: {
    account: ["", "../checking-1", "checking 1", "a".repeat(65), 5, null],
    beneficiary: ["ben;1", "ben\u00001"],
    amount: [0, -1, 1.5, 100_000_001, "100", Number.NaN],
    key: ["not-a-uuid", ""],
  },
  beneficiary: {
    name: ["", "x".repeat(201), "Pat\u0000Doe", "Pat‮eoD", "Pat​Doe", "Pat\nDoe", "<script>", "1234", "\ud800Pat"],
    account: ["1234567", "1".repeat(21), "12345678a", "١٢٣٤٥٦٧٨"],
    bank: ["", "ACME​Bank", "Ba\tnk", "x".repeat(201)],
  },
  "remove-beneficiary": { id: ["", "ben 1", "x".repeat(65)] },
  schedule: {
    account: [""],
    beneficiary: ["rent/1"],
    amount: [0, 2.5],
    due: ["2026-13-01", "tomorrow", "2026-10-20T00:00:00Z"],
  },
  "cancel-payment": { id: ["pay/1", ""] },
  card: { id: ["card 1"], frozen: ["yes", 1], limit: [9_999, 1_000_001, 15_050, 250000.5] },
  profile: { name: ["", "Alex\u0007", "Alex⁦Morgan"], notifications: ["true", null] },
  onboard: {
    name: ["Alex﻿Morgan", " "],
    consent: [false, "true"],
    privacy: [{ ...privacy, extra: true }, { ...privacy, consents: {} }, "yes", true],
  },
  privacy: {
    notice: ["2020-01-01", ""],
    language: ["pt", ""],
    consents: [{ notifications: true }, { notifications: "yes", "statement-archive": false }, null],
    restricted: [["simulation", "simulation"], ["marketing"], "simulation"],
  },
  ticket: {
    subject: ["", "x".repeat(201), "Hi\u0000", "Line\nbreak"],
    message: ["hey", "x".repeat(2001), "Help‮me please", "Bell\u0007 rings", "Private  use"],
  },
  reply: { id: [""], message: ["", "ok\u0000", " "], resolve: ["no"] },
  scenario: { scenario: ["steal"], customer: ["customer 1"] },
  advance: { days: [0, 31, 1.5, "1"] },
};

test("every action field accepts valid input and refuses values outside its criteria", () => {
  for (const [type, request] of Object.entries(valid))
    assert.equal(actionSchema.safeParse(request).success, true, type);
  for (const [type, fields] of Object.entries(invalid))
    for (const [field, values] of Object.entries(fields)) {
      assert.equal(actionSchema.safeParse({ ...valid[type], [field]: undefined }).success, false, `${type}.${field} missing`);
      for (const value of values)
        assert.equal(
          actionSchema.safeParse({ ...valid[type], [field]: value }).success,
          false,
          `${type}.${field} accepted ${JSON.stringify(value)}`,
        );
    }
  assert.equal(actionSchema.safeParse({ type: "delete-account" }).success, false);
  assert.equal(actionSchema.safeParse("transfer").success, false);
});

test("text is normalized and control or invisible characters are refused with a safe message", () => {
  const parsed = actionSchema.parse({ ...valid.ticket, subject: "  Card  ", message: "Line one\r\nLine two" });
  assert.equal(parsed.type === "ticket" && parsed.subject, "Card");
  assert.equal(parsed.type === "ticket" && parsed.message, "Line one\nLine two");
  const failure = actionSchema.safeParse({ ...valid.beneficiary, name: "Pat‮eoD" });
  assert.equal(failure.success, false);
  assert.equal(errorMessage(failure.error), "Remove control, formatting or invisible characters.");
});

test("look-alike names from other alphabets are refused or visibly flagged", () => {
  const state = seedBank();
  const alex = { id: "customer-1", role: "customer" as const };
  const add = (name: string) =>
    executeAction(state, alex, { type: "beneficiary", name, account: "12345678", bank: "ACME Bank" }).beneficiaries.at(-1)!.name;
  // Latin names with a Cyrillic "о", a Cyrillic "е" or a Greek "Ο" mixed in are refused.
  for (const name of ["Jоrdan Lee", "Jordan Lеe", "Οakwood Apartments"])
    assert.throws(() => add(name), /single alphabet/);
  // Compatibility look-alikes (full-width letters) are folded to their plain form.
  assert.equal(add("Ｊｏｒｄａｎ Lee"), "Jordan Lee");
  // A name written entirely in Cyrillic is kept, but it is displayed differently from its Latin twin.
  const latin = "Cope";
  const cyrillic = add("Соре");
  assert.notEqual(cyrillic, latin);
  assert.equal(withScriptNotice(latin), "Cope");
  assert.equal(withScriptNotice(cyrillic), `${cyrillic} (Cyrillic characters)`);
  const html = (value: string) => renderToStaticMarkup(createElement(ScriptName, { value }));
  assert.equal(html(latin), "Cope");
  assert.match(html(cyrillic), /<span class="script-notice"[^>]*>Cyrillic characters<\/span>/);
  assert.equal(add("José Müller"), "José Müller");
  assert.equal(add("山田 太郎"), "山田 太郎");
});
