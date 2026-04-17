const test = require("node:test");
const assert = require("node:assert/strict");

const { applySecurityRules } = require("./securityRules");
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

test("same in/out punch returns EL (not L)", () => {
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

test("working hours <= 0 returns L", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T14:00:00",
      checkOut: "2026-04-01T22:00:00",
      punchCount: 2,
      workingHours: 0,
    })
  );
  assert.equal(result.dutyShift, "L");
  assert.equal(result.attendanceStatus, "L");
});

test("single A4 remains A4 when no valid double", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T14:00:00",
      checkOut: "2026-04-01T22:00:00",
      punchCount: 2,
      workingHours: 8,
    })
  );
  assert.equal(result.dutyShift, "A4");
  assert.equal(result.otStatus, "NO");
});

test("single C4 partial remains C4 and not double", () => {
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

test("single C4 full gets internal 4h OT", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T20:00:00",
      checkOut: "2026-04-02T08:00:00",
      workingHours: 12,
    })
  );
  assert.equal(result.dutyShift, "C4");
  assert.equal(result.otHours, 4);
  assert.equal(result.otStatus, "YES");
});

test("partial A4 to C4 is not double", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T08:00:00",
      checkOut: "2026-04-01T23:00:00",
      workingHours: 15,
    })
  );
  assert.equal(result.dutyShift, "A4");
  assert.notEqual(result.dutyShift, "A4C4");
  assert.equal(result.otHours, 4);
});

test("15 hours does not qualify for double shift", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T08:00:00",
      checkOut: "2026-04-01T23:00:00",
      workingHours: 15,
    })
  );
  assert.equal(result.dutyShift, "A4");
  assert.equal(result.otHours, 4);
  assert.equal(result.otStatus, "YES");
});

test("valid A4 to C4 double shift returns A4C4", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T08:00:00",
      checkOut: "2026-04-02T04:00:00",
      workingHours: 20,
    })
  );
  assert.equal(result.dutyShift, "A4C4");
  assert.equal(result.otHours, 8);
  assert.equal(result.otStatus, "YES");
});

test("valid C4 to A4 double shift returns C4A4", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T20:00:00",
      checkOut: "2026-04-02T16:00:00",
      workingHours: 20,
    })
  );
  assert.equal(result.dutyShift, "C4A4");
  assert.equal(result.otHours, 8);
  assert.equal(result.otStatus, "YES");
});

test("partial C4 to A4 is not double", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T20:00:00",
      checkOut: "2026-04-02T12:00:00",
      workingHours: 16,
    })
  );
  assert.equal(result.dutyShift, "C4");
  assert.notEqual(result.dutyShift, "C4A4");
});

test("general shift has no OT and no mix", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T09:00:00",
      checkOut: "2026-04-01T18:10:00",
      workingHours: 9.16,
    })
  );
  assert.equal(result.dutyShift, "G");
  assert.equal(result.otHours, 0);
  assert.equal(result.otStatus, "NO");
});

test("attendance grace for G uses 09:15", () => {
  const onGrace = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T09:10:00",
      checkOut: "2026-04-01T18:00:00",
      workingHours: 8.83,
    })
  );
  assert.equal(onGrace.dutyShift, "G");
  assert.equal(onGrace.attendanceStatus, "P");

  const beyondGrace = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T09:20:00",
      checkOut: "2026-04-01T18:00:00",
      workingHours: 8.66,
    })
  );
  assert.equal(beyondGrace.attendanceStatus, "LC");
});

test("attendance grace for A4 uses 08:15", () => {
  const onGrace = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T08:10:00",
      checkOut: "2026-04-01T20:00:00",
      workingHours: 11.83,
    })
  );
  assert.equal(onGrace.dutyShift, "A4");
  assert.equal(onGrace.attendanceStatus, "P");

  const beyondGrace = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T08:20:00",
      checkOut: "2026-04-01T20:00:00",
      workingHours: 11.66,
    })
  );
  assert.equal(beyondGrace.attendanceStatus, "LC");
});

test("sec-a4 hint never falls to general", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T09:00:00",
      checkOut: "2026-04-01T18:00:00",
      workingHours: 9,
      employee_shift_name: "Sec-A4",
    })
  );
  assert.equal(result.dutyShift, "G");
});

test("c4 boundary at 18:00 is classified as C4", () => {
  const result = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T18:00:00",
      checkOut: "2026-04-02T02:00:00",
      workingHours: 8,
    })
  );
  assert.equal(result.dutyShift, "C4");
});

test("c4 overnight attendance uses absolute timeline for early logout", () => {
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

test("attendance grace for C4 uses 20:15", () => {
  const onGrace = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T20:10:00",
      checkOut: "2026-04-02T08:00:00",
      workingHours: 11.83,
    })
  );
  assert.equal(onGrace.dutyShift, "C4");
  assert.equal(onGrace.attendanceStatus, "P");

  const beyondGrace = applySecurityRules(
    buildRecord({
      checkIn: "2026-04-01T20:20:00",
      checkOut: "2026-04-02T08:00:00",
      workingHours: 11.66,
    })
  );
  assert.equal(beyondGrace.attendanceStatus, "LC");
});

test("driver uses security rules", () => {
  const result = applyDriverRules(
    buildRecord({
      checkIn: "2026-04-01T20:00:00",
      checkOut: "2026-04-02T16:00:00",
      workingHours: 20,
    })
  );
  assert.equal(result.dutyShift, "C4A4");
  assert.equal(result.otHours, 8);
});
