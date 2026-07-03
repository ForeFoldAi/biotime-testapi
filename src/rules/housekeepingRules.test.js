const test = require("node:test");
const assert = require("node:assert/strict");
const { applyHousekeepingRules } = require("./housekeepingRules");
const { defaultShiftMaster } = require("../config/biotime");

const shifts = defaultShiftMaster.HOUSEKEEPING;

function buildRecord({ date, checkIn, checkOut, workingHours, sameDayPriorShifts = [] }) {
  return {
    date,
    checkIn: new Date(checkIn),
    checkOut: new Date(checkOut),
    workingHours,
    punchCount: 2,
    effectivePunchCount: 2,
    shiftDefinitions: shifts,
    sameDayPriorShifts,
  };
}

test("standalone C shift counts as OT", () => {
  const result = applyHousekeepingRules(
    buildRecord({
      date: "2026-06-07",
      checkIn: "2026-06-07T20:54:39",
      checkOut: "2026-06-08T06:03:58",
      workingHours: 9.16,
    })
  );

  assert.equal(result.dutyShift, "C");
  assert.equal(result.normalShiftCode, "C");
  assert.equal(result.otShiftCode, "C");
  assert.equal(result.otHours, 9);
  assert.equal(result.otStatus, "YES");
});

test("C shift after A same day becomes AC with C OT", () => {
  const result = applyHousekeepingRules(
    buildRecord({
      date: "2026-06-07",
      checkIn: "2026-06-07T20:54:39",
      checkOut: "2026-06-08T06:03:58",
      workingHours: 9.16,
      sameDayPriorShifts: ["A"],
    })
  );

  assert.equal(result.dutyShift, "AC");
  assert.equal(result.normalShiftCode, "A");
  assert.equal(result.otShiftCode, "C");
  assert.equal(result.otHours, 9);
  assert.equal(result.otStatus, "YES");
});

test("A through full C in one session becomes AC", () => {
  const result = applyHousekeepingRules(
    buildRecord({
      date: "2026-06-07",
      checkIn: "2026-06-07T06:13:30",
      checkOut: "2026-06-08T06:03:58",
      workingHours: 23.84,
    })
  );

  assert.equal(result.dutyShift, "AC");
  assert.equal(result.otShiftCode, "C");
  assert.equal(result.otHours, 9);
  assert.equal(result.otStatus, "YES");
});

test("A through B only remains AB", () => {
  const result = applyHousekeepingRules(
    buildRecord({
      date: "2026-06-07",
      checkIn: "2026-06-07T06:13:30",
      checkOut: "2026-06-07T21:00:00",
      workingHours: 14.78,
    })
  );

  assert.equal(result.dutyShift, "AB");
  assert.equal(result.otShiftCode, "B");
  assert.equal(result.otHours, 6);
  assert.equal(result.otStatus, "YES");
});

test("CGP59814 AC night checkout at 06:05 is present not early leave", () => {
  const { toDateTimeFromParts } = require("../utils/punchGrouping");
  const checkIn = toDateTimeFromParts("2026-06-08", "21:06:00");
  const checkOut = toDateTimeFromParts("2026-06-09", "06:05:32");

  const hkResult = applyHousekeepingRules({
    date: "2026-06-08",
    checkIn,
    checkOut,
    workingHours: 8.99,
    punchCount: 1,
    effectivePunchCount: 2,
    shiftDefinitions: shifts,
    sameDayPriorShifts: ["A"],
  });
  assert.equal(hkResult.dutyShift, "AC");
  assert.equal(hkResult.attendanceStatus, "P");
  assert.equal(hkResult.otHours, 9);

  const mepShiftFallback = [
    { code: "A", start: "07:00", end: "14:00", overnight: false },
    { code: "B", start: "14:00", end: "21:00", overnight: false },
    { code: "C", start: "21:00", end: "07:00", overnight: true },
  ];
  const fallbackResult = applyHousekeepingRules({
    date: "2026-06-08",
    checkIn,
    checkOut,
    workingHours: 8.99,
    punchCount: 1,
    effectivePunchCount: 2,
    shiftDefinitions: mepShiftFallback,
    sameDayPriorShifts: ["A"],
  });
  assert.equal(fallbackResult.dutyShift, "AC");
  assert.equal(fallbackResult.attendanceStatus, "P");
  assert.equal(fallbackResult.otHours, 9);
});
