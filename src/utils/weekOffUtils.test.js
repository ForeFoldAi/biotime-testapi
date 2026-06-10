const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeWeekOff, getEmployeeWeekOff } = require("./weekOffUtils");

test("normalizeWeekOff parses BioTime API list format", () => {
  assert.equal(normalizeWeekOff("['4']"), "wednesday");
  assert.equal(normalizeWeekOff("['1']"), "sunday");
  assert.equal(normalizeWeekOff("['2']"), "monday");
});

test("normalizeWeekOff accepts day names", () => {
  assert.equal(normalizeWeekOff("wednesday"), "wednesday");
  assert.equal(normalizeWeekOff("WEDNESDAY"), "wednesday");
});

test("getEmployeeWeekOff reads week_off from employee payload", () => {
  assert.equal(getEmployeeWeekOff({ week_off: "['4']" }), "wednesday");
  assert.equal(getEmployeeWeekOff({ week_off: "" }), "");
});
