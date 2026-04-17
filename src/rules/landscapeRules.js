const DAY_MINUTES = 24 * 60;
const GRACE_MINUTES = 15;
const SHIFT_CODE = "G";
const SHIFT_START = 9 * 60;
const SHIFT_END = 17 * 60;

function toBusinessRelativeMinutes(dateTime, businessDate) {
  if (!dateTime || !businessDate) return null;
  const base = new Date(`${businessDate}T00:00:00`);
  const ts = new Date(dateTime);
  if (Number.isNaN(base.getTime()) || Number.isNaN(ts.getTime())) return null;
  return (ts.getTime() - base.getTime()) / (1000 * 60);
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

function resolveWorkingHours(dailyRecord, interval) {
  const provided = Number(dailyRecord?.workingHours);
  if (Number.isFinite(provided)) return provided;
  if (Number.isFinite(interval.computedWorkingHours)) return interval.computedWorkingHours;
  return null;
}

function isSinglePunch(dailyRecord) {
  const punchCount = Number(dailyRecord?.punchCount);
  if (Number.isFinite(punchCount) && punchCount < 2) return true;
  if (!dailyRecord?.checkIn || !dailyRecord?.checkOut) return true;
  const inMs = new Date(dailyRecord.checkIn).getTime();
  const outMs = new Date(dailyRecord.checkOut).getTime();
  return Number.isFinite(inMs) && Number.isFinite(outMs) && inMs === outMs;
}

function buildResult(attendanceStatus, otHours, otStatus) {
  return {
    code: SHIFT_CODE,
    shift_code: SHIFT_CODE,
    dutyShift: SHIFT_CODE,
    normalShiftCode: SHIFT_CODE,
    attendanceStatus,
    attendance_status: attendanceStatus,
    otHours,
    ot_hours: otHours,
    otStatus,
    is_ot: otStatus,
    otShiftCode: "",
    ot_shift: "",
    otLabel: otStatus === "YES" ? "G-OT" : "",
    ot_label: otStatus === "YES" ? "G-OT" : "",
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
  const workingHours = resolveWorkingHours(dailyRecord, interval);
  if (!Number.isFinite(interval.checkInMinutes) || !Number.isFinite(interval.checkOutMinutes)) {
    return buildLoss();
  }

  const late = interval.checkInMinutes > SHIFT_START + GRACE_MINUTES;
  const early = interval.checkOutMinutes < SHIFT_END;
  if (workingHours != null && workingHours <= 0) return buildLoss();

  let attendanceStatus = "P";
  if (late && early) attendanceStatus = "LC+EL";
  else if (late) attendanceStatus = "LC";
  else if (early) attendanceStatus = "EL";

  const otMinutes = Math.max(0, interval.checkOutMinutes - SHIFT_END);
  const otHours = Math.round((otMinutes / 60) * 100) / 100;
  const otStatus = otHours > 0 ? "YES" : "NO";
  return buildResult(attendanceStatus, otHours, otStatus);
}

module.exports = {
  applyLandscapeRules,
  _internal: {
    isSinglePunch,
    normalizeInterval,
  },
};
