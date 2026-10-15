import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell } from "../src/services/statements";

test("CSV neutralizes formulas in text without changing numeric cents", () => {
  assert.equal(csvCell("=HYPERLINK(\"https://example.com\")"), '"\'=HYPERLINK(""https://example.com"")"');
  assert.equal(csvCell("+123"), '"\'+123"');
  assert.equal(csvCell(-125), '"-125"');
  assert.equal(csvCell("Coffee, lunch"), '"Coffee, lunch"');
});