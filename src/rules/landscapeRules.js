const DAY_MINUTES = 24 * 60;
const SHIFT_CODE = "G";
const ATTEND_GRACE_MINUTES = 15;
/** General shift 09:00–17:00 (same calendar day); symmetric grace on in/out vs shift bounds. */
const SHIFT_START_MIN = 9 * 60;
const SHIFT_END_MIN = 17 * 60;
const LATE_CHECKIN_MIN_EXCLUSIVE = SHIFT_START_MIN + ATTEND_GRACE_MINUTES;
const EARLY_CHECKOUT_MIN_EXCLUSIVE = SHIFT_END_MIN - ATTEND_GRACE_MINUTES;

function toBusinessRelativeMinutes(dateTime, businessDate) {
  if (!dateTime || !businessDate) return null;
  const base = new Date(`${businessDate}T00:00:00`);
  const ts = new Date(dateTime);
  if (Number.isNaN(base.getTime()) || Number.isNaN(ts.getTime())) return null;
  return (ts.getTime() - base.getTime()) / (1000 * 60);
}

function minutesFromMidnight(dateTime) {
  const d = new Date(dateTime);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours() * 60 + d.getMinutes();
}

function normalizeInterval(dailyRecord) {
  const checkInMinutes = toBusinessRelativeMinutes(dailyRecord?.checkIn, dailyRecord?.date);
  let checkOutMinutes = toBusinessRelativeMinutes(dailyRecord?.checkOut, dailyRecord?.date);
  if (Number.isFinite(checkInMinutes) && Number.isFinite(checkOutMinutes) && checkOutMinutes < checkInMinutes) {
    checkOutMinutes += DAY_MINUTES;
  }
  const computedWorkingHours =
    Number.isFinite(checkInMinutes) && Number.isFinite(checkOutMinutes)
      ? (checkOutMinutes - checkInMinutes) / 60
      : null;
  return { checkInMinutes, checkOutMinutes, computedWorkingHours };
}

function isSinglePunch(dailyRecord) {
  const punchCount = Number(dailyRecord?.punchCount);
  if (Number.isFinite(punchCount) && punchCount < 2) return true;
  if (!dailyRecord?.checkIn || !dailyRecord?.checkOut) return true;
  const inMs = new Date(dailyRecord.checkIn).getTime();
  const outMs = new Date(dailyRecord.checkOut).getTime();
  return Number.isFinite(inMs) && Number.isFinite(outMs) && inMs === outMs;
}

function buildResult(attendanceStatus) {
  return {
    code: SHIFT_CODE,
    shift_code: SHIFT_CODE,
    dutyShift: SHIFT_CODE,
    normalShiftCode: SHIFT_CODE,
    attendanceStatus,
    attendance_status: attendanceStatus,
    otHours: 0,
    ot_hours: 0,
    otStatus: "NO",
    is_ot: "NO",
    otShiftCode: "",
    ot_shift: "",
    otLabel: "",
    ot_label: "",
  };
}

function buildLoss() {
  return {
    code: "L",
    shift_code: "G",
    dutyShift: "L",
    normalShiftCode: "",
    attendanceStatus: "L",
    attendance_status: "L",
    otHours: 0,
    ot_hours: 0,
    otStatus: "NO",
    is_ot: "NO",
    otShiftCode: "",
    ot_shift: "",
    otLabel: "",
    ot_label: "",
  };
}

function applyLandscapeRules(dailyRecord) {
  if (!dailyRecord?.checkIn && !dailyRecord?.checkOut) return buildLoss();
  if (isSinglePunch(dailyRecord)) return buildLoss();

  const interval = normalizeInterval(dailyRecord);
  if (!Number.isFinite(interval.checkInMinutes) || !Number.isFinite(interval.checkOutMinutes)) {
    return buildLoss();
  }

  const spanHours = interval.computedWorkingHours;
  if (spanHours != null && spanHours <= 0) return buildLoss();

  const checkInMin = minutesFromMidnight(dailyRecord.checkIn);
  const checkOutMin = minutesFromMidnight(dailyRecord.checkOut);
  if (!Number.isFinite(checkInMin) || !Number.isFinite(checkOutMin)) {
    return buildLoss();
  }

  const late = checkInMin > LATE_CHECKIN_MIN_EXCLUSIVE;
  const early = checkOutMin < EARLY_CHECKOUT_MIN_EXCLUSIVE;

  let attendanceStatus = "P";
  if (late && early) attendanceStatus = "LC+EL";
  else if (late) attendanceStatus = "LC";
  else if (early) attendanceStatus = "EL";

  return buildResult(attendanceStatus);
}

module.exports = {
  applyLandscapeRules,
  _internal: {
    isSinglePunch,
    normalizeInterval,
  },
};
