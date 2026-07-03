const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMepRules } = require("./mepRules");
const { defaultShiftMaster } = require("../config/biotime");
const { toDateTimeFromParts } = require("../utils/punchGrouping");

const shifts = defaultShiftMaster.MEP;

function session(date, inTime, outDate, outTime, hours, prior = []) {
  return applyMepRules({
    date,
    checkIn: toDateTimeFromParts(date, inTime),
    checkOut: toDateTimeFromParts(outDate, outTime),
    workingHours: hours,
    punchCount: 2,
    effectivePunchCount: 2,
    shiftDefinitions: shifts,
    sameDayPriorShifts: prior,
  });
}

test("split B afternoon then C night same day becomes BC with C OT 10", () => {
  const b = session("2026-06-07", "13:15:04", "2026-06-07", "20:59:54", 7.75);
  assert.equal(b.dutyShift, "B");
  assert.equal(b.otStatus, "NO");
  assert.equal(b.otHours, 0);

  const c = session("2026-06-07", "21:04:17", "2026-06-08", "06:57:45", 9.89, ["B"]);
  assert.equal(c.dutyShift, "BC");
  assert.equal(c.attendanceStatus, "P");
  assert.equal(c.otStatus, "YES");
  assert.equal(c.otHours, 10);
  assert.equal(c.otShiftCode, "C");
});

test("C night without prior B stays standalone C without OT", () => {
  const c = session("2026-06-07", "21:04:17", "2026-06-08", "06:57:45", 9.89);
  assert.equal(c.dutyShift, "C");
  assert.equal(c.otStatus, "NO");
  assert.equal(c.otHours, 0);
});

test("G shift extension OT uses PPP ot shift code", () => {
  const result = session("2026-06-02", "12:55:45", "2026-06-02", "20:58:15", 8.03);
  assert.equal(result.dutyShift, "G");
  assert.equal(result.otStatus, "YES");
  assert.equal(result.otShiftCode, "PPP");
  assert.ok(result.otHours >= 2.9);
});

test("DCT113 Jun 7 C after B qualifies BC OT despite NOT_QUALIFIED chain", () => {
  const c = session("2026-06-07", "21:00:06", "2026-06-08", "07:06:39", 10.11, ["B"]);
  assert.equal(c.dutyShift, "BC");
  assert.equal(c.otStatus, "YES");
  assert.equal(c.otHours, 10);
});
