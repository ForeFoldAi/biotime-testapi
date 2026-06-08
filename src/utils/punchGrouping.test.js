const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deriveCheckInOut,
  groupPunchesByEmployeeDate,
  hoursBetweenTimeOnly,
  splitPunchTime,
} = require("./punchGrouping");

test("splitPunchTime splits literal API datetime", () => {
  assert.deepEqual(splitPunchTime("2026-06-01 07:55:13"), {
    punch_date: "2026-06-01",
    punch_time_only: "07:55:13",
    raw: "2026-06-01 07:55:13",
  });
});

test("groupPunchesByEmployeeDate keeps punches on literal calendar date", () => {
  const transactions = [
    { emp_code: "AG020034", punch_time: "2026-06-01 07:55:13" },
    { emp_code: "AG020034", punch_time: "2026-06-01 21:38:36" },
    { emp_code: "AG020034", punch_time: "2026-06-02 07:51:45" },
  ];

  const grouped = groupPunchesByEmployeeDate(transactions, (tx) => tx.emp_code);
  assert.equal(grouped.size, 2);
  assert.equal(grouped.get("AG020034|2026-06-01").punches.length, 2);
  assert.equal(grouped.get("AG020034|2026-06-02").punches.length, 1);
});

test("deriveCheckInOut uses min/max within same date only", () => {
  const group = {
    employeeKey: "AG020034",
    punch_date: "2026-06-01",
    punches: [
      { punch_time_only: "21:38:36", raw: "2026-06-01 21:38:36" },
      { punch_time_only: "07:55:13", raw: "2026-06-01 07:55:13" },
      { punch_time_only: "12:00:00", raw: "2026-06-01 12:00:00" },
    ],
  };

  const derived = deriveCheckInOut(group);
  assert.equal(derived.check_in, "07:55:13");
  assert.equal(derived.check_out, "21:38:36");
  assert.equal(derived.punch_count, 3);
  assert.equal(derived.punchAttendanceStatus, "Present");
  assert.ok(Math.abs(derived.working_hours - hoursBetweenTimeOnly("07:55:13", "21:38:36")) < 0.01);
});

test("deriveCheckInOut marks single punch as missing", () => {
  const group = {
    employeeKey: "AG020034",
    punch_date: "2026-06-06",
    punches: [{ punch_time_only: "21:13:15", raw: "2026-06-06 21:13:15" }],
  };

  const derived = deriveCheckInOut(group);
  assert.equal(derived.check_in, "21:13:15");
  assert.equal(derived.check_out, "21:13:15");
  assert.equal(derived.working_hours, 0);
  assert.equal(derived.punch_count, 1);
  assert.equal(derived.punchAttendanceStatus, "Missing Punch");
});

test("AG020034 June 2026 sample does not create May 31 bucket", () => {
  const transactions = [
    { emp_code: "AG020034", punch_time: "2026-06-06 21:13:15" },
    { emp_code: "AG020034", punch_time: "2026-06-05 21:24:01" },
    { emp_code: "AG020034", punch_time: "2026-06-05 08:02:53" },
    { emp_code: "AG020034", punch_time: "2026-06-04 20:14:58" },
    { emp_code: "AG020034", punch_time: "2026-06-04 07:53:30" },
    { emp_code: "AG020034", punch_time: "2026-06-03 20:31:00" },
    { emp_code: "AG020034", punch_time: "2026-06-03 08:02:19" },
    { emp_code: "AG020034", punch_time: "2026-06-02 20:08:47" },
    { emp_code: "AG020034", punch_time: "2026-06-02 07:51:45" },
    { emp_code: "AG020034", punch_time: "2026-06-01 21:38:36" },
    { emp_code: "AG020034", punch_time: "2026-06-01 07:55:13" },
  ];

  const grouped = groupPunchesByEmployeeDate(transactions, (tx) => tx.emp_code);
  assert.equal(grouped.has("AG020034|2026-05-31"), false);
  assert.equal(grouped.size, 6);

  const june1 = deriveCheckInOut(grouped.get("AG020034|2026-06-01"));
  assert.equal(june1.check_in, "07:55:13");
  assert.equal(june1.check_out, "21:38:36");
  assert.equal(june1.punch_count, 2);

  const june2 = deriveCheckInOut(grouped.get("AG020034|2026-06-02"));
  assert.equal(june2.check_in, "07:51:45");
  assert.equal(june2.check_out, "20:08:47");
  assert.equal(june2.punch_count, 2);
});
