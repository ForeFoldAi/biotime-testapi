const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildEmployeeAliasLookup,
  resolveTransactionEmployeeKey,
} = require("./transactionEmployeeUtils");
const { deriveCheckInOut, groupPunchesByEmployeeDate } = require("./punchGrouping");

const employee = {
  emp_code: "AG020034",
  emp: "uuid-employee-ag020034",
  id: "uuid-employee-ag020034",
  first_name: "KVN",
  last_name: "BHASKAR",
};

test("resolveTransactionEmployeeKey uses emp uuid and never transaction id", () => {
  const { aliasToCanonical } = buildEmployeeAliasLookup([employee]);

  const resolved = resolveTransactionEmployeeKey(
    {
      id: 160619839,
      emp: "uuid-employee-ag020034",
      punch_time: "2026-06-06 07:59:53",
      terminal_alias: "Auto add",
    },
    aliasToCanonical
  );

  assert.equal(resolved, "AG020034");
});

test("transactions without emp_code still group for auto_add+out_gate", () => {
  const { aliasToCanonical } = buildEmployeeAliasLookup([employee]);
  const transactions = [
    {
      id: 160619839,
      emp: "uuid-employee-ag020034",
      punch_time: "2026-06-06 07:59:53",
      terminal_alias: "Auto add",
    },
    {
      id: 160700161,
      emp: "uuid-employee-ag020034",
      punch_time: "2026-06-06 21:13:15",
      terminal_alias: "Out Gate",
    },
  ];

  const grouped = groupPunchesByEmployeeDate(transactions, (transaction) =>
    resolveTransactionEmployeeKey(transaction, aliasToCanonical)
  );
  const derived = deriveCheckInOut(grouped.get("AG020034|2026-06-06"));

  assert.equal(derived.check_in, "07:59:53");
  assert.equal(derived.check_out, "21:13:15");
  assert.equal(derived.punch_count, 2);
  assert.equal(derived.resolution, "auto_add+out_gate");
});
