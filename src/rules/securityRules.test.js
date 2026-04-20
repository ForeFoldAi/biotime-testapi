const test = require("node:test");
const assert = require("node:assert/strict");

const { applySecurityRules, _internal } = require("./securityRules");
const { applyDriverRules } = require("./driverRules");

function buildRecord({
  date = "2026-04-01",
  checkIn,
  checkOut,
  punchCount = 2,
  workingHours,
  ...extra
}) {
  const inTime = checkIn ? new Date(checkIn) : null;
  const outTime = checkOut ? new Date(checkOut) : null;
  const computed =
    inTime && outTime ? Math.abs(outTime.getTime() - inTime.getTime()) / (1000 * 60 * 60) : 0;
  return {
    date,
    checkIn,
    checkOut,
    punchCount,
    workingHours: workingHours != null ? workingHours : computed,
    ...extra,
  };
}

test("no punch returns L", () => {
  const result = applySecurityRules(buildRecord({ checkIn: null, checkOut: null, punchCount: 0, workingHours: 0 }));
  assert.equal(result.dutyShift, "L");
  assert.equal(result.attendanceStatus, "L");
});

test("single punch returns EL and assigned shift", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T08:10:00",
      checkOut: null,
      punchCount: 1,
      workingHours: 0,
    })
  );
  assert.equal(result.dutyShift, "A4");
  assert.equal(result.attendanceStatus, "EL");
  assert.equal(result.otStatus, "NO");
});

test("same in/out punch returns EL", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T20:00:00",
      checkOut: "2026-04-01T20:00:00",
      punchCount: 2,
      workingHours: 0,
    })
  );
  assert.equal(result.dutyShift, "C4");
  assert.equal(result.attendanceStatus, "EL");
});

test("07:50 check-in allocates A4 not C4", () => {
  assert.equal(_internal.detectShiftFromPunchTime(7 * 60 + 50), "A4");
});

test("20:13 check-in allocates C4", () => {
  assert.equal(_internal.detectShiftFromPunchTime(20 * 60 + 13), "C4");
});

test("working hours <= 0 with two punches returns EL not L or LC", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T14:00:00",
      checkOut: "2026-04-01T22:00:00",
      punchCount: 2,
      workingHours: 0,
    })
  );
  assert.equal(result.dutyShift, "C4");
  assert.equal(result.attendanceStatus, "EL");
  assert.notEqual(result.attendanceStatus, "LC");
});

test("14:00 check-in allocates C4 (after 13:00 allocation band)", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T14:00:00",
      checkOut: "2026-04-01T22:00:00",
      punchCount: 2,
      workingHours: 8,
    })
  );
  assert.equal(result.dutyShift, "C4");
  assert.equal(result.otStatus, "NO");
  assert.equal(result.attendanceStatus, "EL");
});

test("10:30 without roster flag allocates A4 (09:00–13:00 overlap → A4)", () => {
  assert.equal(_internal.detectShiftFromPunchTime(10 * 60 + 30), "A4");
});

test("10:30 with explicit general roster allocates G", () => {
  assert.equal(
    _internal.allocateSecurityShift(10 * 60 + 30, { employee_shift_name: "Sec-General" }),
    "G"
  );
});

test("20:00 check-in allocates C4", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T20:00:00",
      checkOut: "2026-04-02T07:30:00",
      workingHours: 11.5,
    })
  );
  assert.equal(result.dutyShift, "C4");
  assert.equal(result.otHours, 0);
  assert.equal(result.otStatus, "NO");
});

test("full single C4 night (12h span) has no OT without full next A4", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T20:00:00",
      checkOut: "2026-04-02T08:00:00",
      workingHours: 12,
    })
  );
  assert.equal(result.dutyShift, "C4");
  assert.equal(result.otHours, 0);
  assert.equal(result.otStatus, "NO");
});

test("A4 long day without full C4 overlap gets no OT", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T08:00:00",
      checkOut: "2026-04-01T23:00:00",
      workingHours: 15,
    })
  );
  assert.equal(result.dutyShift, "A4");
  assert.equal(result.otHours, 0);
  assert.equal(result.otStatus, "NO");
});

test("A4 through full next C4 gets A4C4 and 12h OT", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T08:00:00",
      checkOut: "2026-04-02T08:00:00",
      workingHours: 24,
    })
  );
  assert.equal(result.dutyShift, "A4C4");
  assert.equal(result.otHours, 12);
  assert.equal(result.otStatus, "YES");
});

test("C4 through full next A4 gets C4A4 and 12h OT", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T20:00:00",
      checkOut: "2026-04-02T20:00:00",
      workingHours: 28,
    })
  );
  assert.equal(result.dutyShift, "C4A4");
  assert.equal(result.otHours, 12);
  assert.equal(result.otStatus, "YES");
});

test("partial C4 without full A4 overlap is not double duty and no OT", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T20:00:00",
      checkOut: "2026-04-02T11:00:00",
      workingHours: 15,
    })
  );
  assert.equal(result.dutyShift, "C4");
  assert.notEqual(result.dutyShift, "C4A4");
  assert.equal(result.otHours, 0);
});

test("inflated workingHours does not grant OT without full next shift overlap", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T08:00:00",
      checkOut: "2026-04-01T18:00:00",
      punchCount: 2,
      workingHours: 20,
    })
  );
  assert.equal(result.dutyShift, "A4");
  assert.equal(result.otHours, 0);
  assert.notEqual(result.dutyShift, "A4C4");
});

test("general shift has no OT", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T09:00:00",
      checkOut: "2026-04-01T17:50:00",
      employee_shift_name: "Sec-General",
    })
  );
  assert.equal(result.dutyShift, "G");
  assert.equal(result.otHours, 0);
  assert.equal(result.otStatus, "NO");
  assert.equal(result.attendanceStatus, "EL");
});

test("09:00 check-in with Sec-A4 roster stays A4 (overlap band prefers A4 over G)", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T09:00:00",
      checkOut: "2026-04-01T18:00:00",
      workingHours: 9,
      employee_shift_name: "Sec-A4",
    })
  );
  assert.equal(result.dutyShift, "A4");
});

test("13:00 check-in allocates A4 (end of A4 allocation window)", () => {
  assert.equal(_internal.detectShiftFromPunchTime(13 * 60), "A4");
});

test("13:01 check-in allocates C4", () => {
  assert.equal(_internal.detectShiftFromPunchTime(13 * 60 + 1), "C4");
});

test("18:00 check-in allocates C4", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T18:00:00",
      checkOut: "2026-04-02T02:00:00",
      workingHours: 8,
    })
  );
  assert.equal(result.dutyShift, "C4");
});

test("C4 overnight early logout is EL", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T20:00:00",
      checkOut: "2026-04-02T07:00:00",
      workingHours: 11,
    })
  );
  assert.equal(result.dutyShift, "C4");
  assert.equal(result.attendanceStatus, "EL");
});

test("C4 under 12h span: P becomes EL; LC becomes LC+EL (minimum duty merge)", () => {
  const onGrace = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T20:10:00",
      checkOut: "2026-04-02T08:00:00",
      workingHours: 11.83,
    })
  );
  assert.equal(onGrace.dutyShift, "C4");
  assert.equal(onGrace.attendanceStatus, "EL");

  const beyondGrace = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T20:20:00",
      checkOut: "2026-04-02T08:00:00",
      workingHours: 11.66,
    })
  );
  assert.equal(beyondGrace.attendanceStatus, "LC+EL");
});

test("A4 attendance uses SHIFT_TIMINGS start + 15 for LC", () => {
  assert.equal(_internal.resolveAttendance(8 * 60 + 31, 20 * 60, "A4"), "LC");
  assert.equal(_internal.resolveAttendance(8 * 60 + 15, 20 * 60, "A4"), "P");
});

test("isFullShiftCovered reflects 720-minute overlap with SHIFT_TIMINGS bands", () => {
  const full = _internal.normalizeInterval({
    date: "2026-04-01",
    checkIn: "2026-04-01T08:00:00",
    checkOut: "2026-04-02T08:00:00",
  });
  const { checkInMinutes: ci, checkOutMinutes: co } = full;
  assert.equal(_internal.isFullShiftCovered(ci, co, "C4"), true);
  assert.equal(_internal.isFullShiftCovered(ci, co, "A4"), true);

  const partial = _internal.normalizeInterval({
    date: "2026-04-01",
    checkIn: "2026-04-01T08:00:00",
    checkOut: "2026-04-01T18:00:00",
  });
  assert.equal(_internal.isFullShiftCovered(partial.checkInMinutes, partial.checkOutMinutes, "C4"), false);
});

test("OT requires full base and full next shift overlap (full C4 alone is not enough)", () => {
  const { checkInMinutes: ci, checkOutMinutes: co } = _internal.normalizeInterval({
    date: "2026-04-01",
    checkIn: "2026-04-01T20:00:00",
    checkOut: "2026-04-02T08:00:00",
  });
  assert.equal(_internal.isFullShiftCovered(ci, co, "C4"), true);
  assert.equal(_internal.isFullShiftCovered(ci, co, "A4"), false);
  const ot = _internal.resolveOt("C4", ci, co);
  assert.equal(ot.dutyShift, "C4");
  assert.equal(ot.otHours, 0);
});

test("mergeMinimumDutyWithPunctuality preserves LC as LC+EL when duty short", () => {
  assert.equal(_internal.mergeMinimumDutyWithPunctuality("LC", 100, 720), "LC+EL");
  assert.equal(_internal.mergeMinimumDutyWithPunctuality("P", 100, 720), "EL");
  assert.equal(_internal.mergeMinimumDutyWithPunctuality("P", 800, 720), "P");
});

test("driver uses security rules", () => {
  const result = applyDriverRules(
    buildRecord({
      checkIn: "2026-04-01T20:00:00",
      checkOut: "2026-04-02T20:00:00",
      workingHours: 28,
    })
  );
  assert.equal(result.dutyShift, "C4A4");
  assert.equal(result.otHours, 12);
});

test("assignShift alias matches allocation windows (no G without roster)", () => {
  assert.equal(_internal.assignShift(2 * 60 + 1), "A4");
  assert.equal(_internal.assignShift(8 * 60 + 31), "A4");
  assert.equal(_internal.assignShift(13 * 60), "A4");
  assert.equal(_internal.assignShift(13 * 60 + 1), "C4");
  assert.equal(_internal.assignShift(2 * 60), "C4");
});
