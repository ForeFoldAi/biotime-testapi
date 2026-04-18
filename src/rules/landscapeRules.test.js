const test = require("node:test");
const assert = require("node:assert/strict");

const { applyLandscapeRules } = require("./landscapeRules");
const { applyRuleForDepartment } = require("../engines/ruleDispatcher");

function buildRecord({
  date = "2026-04-01",
  checkIn = null,
  checkOut = null,
  punchCount = 2,
  workingHours,
}) {
  let computed = null;
  if (checkIn && checkOut) {
    const inMs = new Date(checkIn).getTime();
    const outMs = new Date(checkOut).getTime();
    computed = (outMs - inMs) / (1000 * 60 * 60);
  }
  return {
    date,
    checkIn,
    checkOut,
    punchCount,
    workingHours: workingHours != null ? workingHours : computed,
  };
}

test("no punch returns L", () => {
  const result = applyLandscapeRules(buildRecord({}));
  assert.equal(result.shift_code, "G");
  assert.equal(result.attendance_status, "L");
  assert.equal(result.ot_hours, 0);
  assert.equal(result.is_ot, "NO");
});

test("single check-in returns L", () => {
  const result = applyLandscapeRules(
    buildRecord({
      checkIn: "2026-04-01T09:05:00",
      checkOut: null,
      punchCount: 1,
      workingHours: 0,
    })
  );
  assert.equal(result.shift_code, "G");
  assert.equal(result.attendance_status, "L");
});

test("single check-out returns L", () => {
  const result = applyLandscapeRules(
    buildRecord({
      checkIn: null,
      checkOut: "2026-04-01T17:05:00",
      punchCount: 1,
      workingHours: 0,
    })
  );
  assert.equal(result.shift_code, "G");
  assert.equal(result.attendance_status, "L");
});

test("punch count less than 2 returns L", () => {
  const result = applyLandscapeRules(
    buildRecord({
      checkIn: "2026-04-01T09:00:00",
      checkOut: "2026-04-01T17:30:00",
      punchCount: 1,
      workingHours: 8.5,
    })
  );
  assert.equal(result.attendance_status, "L");
});

test("same check-in and check-out returns L", () => {
  const result = applyLandscapeRules(
    buildRecord({
      checkIn: "2026-04-01T09:00:00",
      checkOut: "2026-04-01T09:00:00",
      punchCount: 2,
      workingHours: 0,
    })
  );
  assert.equal(result.attendance_status, "L");
});

test("early check-in within grace returns P", () => {
  const result = applyLandscapeRules(
    buildRecord({
      checkIn: "2026-04-01T08:45:00",
      checkOut: "2026-04-01T17:00:00",
      workingHours: 8.25,
    })
  );
  assert.equal(result.attendance_status, "P");
});

test("09:15 check-in is on-time (not late)", () => {
  const result = applyLandscapeRules(
    buildRecord({
      checkIn: "2026-04-01T09:15:00",
      checkOut: "2026-04-01T17:00:00",
      workingHours: 7.75,
    })
  );
  assert.equal(result.attendance_status, "P");
});

test("09:16 check-in is late LC", () => {
  const result = applyLandscapeRules(
    buildRecord({
      checkIn: "2026-04-01T09:16:00",
      checkOut: "2026-04-01T17:00:00",
      workingHours: 7.73,
    })
  );
  assert.equal(result.attendance_status, "LC");
});

test("early checkout before 16:45 returns EL", () => {
  const result = applyLandscapeRules(
    buildRecord({
      checkIn: "2026-04-01T09:00:00",
      checkOut: "2026-04-01T16:44:00",
      workingHours: 7.73,
    })
  );
  assert.equal(result.attendance_status, "EL");
});

test("16:45 checkout is not early leave", () => {
  const result = applyLandscapeRules(
    buildRecord({
      checkIn: "2026-04-01T09:00:00",
      checkOut: "2026-04-01T16:45:00",
      workingHours: 7.75,
    })
  );
  assert.equal(result.attendance_status, "P");
});

test("late and early returns LC+EL", () => {
  const result = applyLandscapeRules(
    buildRecord({
      checkIn: "2026-04-01T12:30:00",
      checkOut: "2026-04-01T16:00:00",
      workingHours: 3.5,
    })
  );
  assert.equal(result.attendance_status, "LC+EL");
});

test("no OT reported for landscape (is_ot always NO, ot_hours 0)", () => {
  const result = applyLandscapeRules(
    buildRecord({
      checkIn: "2026-04-01T09:00:00",
      checkOut: "2026-04-01T18:30:00",
      workingHours: 9.5,
    })
  );
  assert.equal(result.attendance_status, "P");
  assert.equal(result.ot_hours, 0);
  assert.equal(result.is_ot, "NO");
  assert.equal(result.otStatus, "NO");
});

test("pest control department reuses landscape engine exactly", () => {
  const record = buildRecord({
    checkIn: "2026-04-01T09:20:00",
    checkOut: "2026-04-01T17:30:00",
    workingHours: 8.17,
  });
  const direct = applyLandscapeRules(record);
  const viaDispatcher = applyRuleForDepartment("Pest Control", record);
  assert.deepEqual(viaDispatcher, direct);
});

test("gardners department reuses landscape engine exactly", () => {
  const record = buildRecord({
    checkIn: "2026-04-01T08:45:00",
    checkOut: "2026-04-01T16:45:00",
    workingHours: 8,
  });
  const direct = applyLandscapeRules(record);
  const viaDispatcher = applyRuleForDepartment("Gardners", record);
  assert.deepEqual(viaDispatcher, direct);
});
