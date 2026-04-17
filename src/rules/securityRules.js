const DAY_MINUTES = 24 * 60;
const MIN_DUTY_HOURS = 8;
const FULL_SHIFT_HOURS = 12;
const DOUBLE_SHIFT_HOURS = 16;

const SHIFT_WINDOWS = {
  C4_1: { start: 18 * 60, end: 23 * 60 + 59 },
  C4_2: { start: 0, end: 5 * 60 },
  A4_1: { start: 5 * 60 + 1, end: 8 * 60 + 30 },
  G: { start: 8 * 60 + 31, end: 13 * 60 },
  A4_2: { start: 13 * 60 + 1, end: 19 * 60 },
};

function toBusinessRelativeMinutes(dateTime, businessDate) {
  if (!dateTime || !businessDate) return null;
  const base = new Date(`${businessDate}T00:00:00`);
  const ts = new Date(dateTime);
  if (Number.isNaN(base.getTime()) || Number.isNaN(ts.getTime())) return null;
  return (ts.getTime() - base.getTime()) / (1000 * 60);
}

function normalizeDayMinute(minutes) {
  return ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}

function inRange(value, start, end) {
  return value >= start && value <= end;
}

function hasNoPunch(dailyRecord) {
  return !dailyRecord?.checkIn && !dailyRecord?.checkOut;
}

function hasAnyPunch(dailyRecord) {
  return Boolean(dailyRecord?.checkIn || dailyRecord?.checkOut);
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

  return {
    checkInMinutes,
    checkOutMinutes,
    checkInMinuteOfDay: Number.isFinite(checkInMinutes) ? normalizeDayMinute(checkInMinutes) : null,
    computedWorkingHours,
  };
}

function resolveWorkingHours(dailyRecord, interval) {
  const provided = Number(dailyRecord?.workingHours);
  if (Number.isFinite(provided)) return provided;
  if (Number.isFinite(interval.computedWorkingHours)) return interval.computedWorkingHours;
  return 0;
}

function isSamePunch(dailyRecord) {
  if (!dailyRecord?.checkIn || !dailyRecord?.checkOut) return false;
  const inMs = new Date(dailyRecord.checkIn).getTime();
  const outMs = new Date(dailyRecord.checkOut).getTime();
  return Number.isFinite(inMs) && Number.isFinite(outMs) && inMs === outMs;
}

function isSinglePunch(dailyRecord) {
  const punchCount = Number(dailyRecord?.punchCount);
  if (Number.isFinite(punchCount) && punchCount < 2) return true;
  if (!dailyRecord?.checkIn || !dailyRecord?.checkOut) return true;
  return isSamePunch(dailyRecord);
}

function parseShiftHints(dailyRecord) {
  const candidates = [
    dailyRecord?.employee_shift_name,
    dailyRecord?.employeeShiftName,
    dailyRecord?.scheduledShift,
    dailyRecord?.shiftName,
    dailyRecord?.employee_shift,
  ]
    .filter((value) => value != null)
    .map((value) => String(value).toUpperCase());
  return {
    general: candidates.some((value) => value.includes("GENERAL") || value === "G" || value.includes("SEC-G")),
    a4: candidates.some((value) => value.includes("SEC-A4") || value === "A4"),
    c4: candidates.some((value) => value.includes("SEC-C4") || value === "C4"),
  };
}

function detectShiftFromPunchTime(minuteOfDay) {
  if (!Number.isFinite(minuteOfDay)) return null;
  if (inRange(minuteOfDay, SHIFT_WINDOWS.C4_1.start, SHIFT_WINDOWS.C4_1.end)) return "C4";
  if (inRange(minuteOfDay, SHIFT_WINDOWS.C4_2.start, SHIFT_WINDOWS.C4_2.end)) return "C4";
  if (inRange(minuteOfDay, SHIFT_WINDOWS.A4_1.start, SHIFT_WINDOWS.A4_1.end)) return "A4";
  if (inRange(minuteOfDay, SHIFT_WINDOWS.G.start, SHIFT_WINDOWS.G.end)) return "G";
  if (inRange(minuteOfDay, SHIFT_WINDOWS.A4_2.start, SHIFT_WINDOWS.A4_2.end)) return "A4";
  return null;
}

function detectBaseShift(interval, hint) {
  const fromTime = detectShiftFromPunchTime(interval.checkInMinuteOfDay);
  if (fromTime) return fromTime;
  if (hint.c4) return "C4";
  if (hint.a4) return "A4";
  if (hint.general) return "G";
  return "A4";
}

function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function coveredEightHours(workStart, workEnd, dutyStart, dutyEnd) {
  return overlapMinutes(workStart, workEnd, dutyStart, dutyEnd) >= MIN_DUTY_HOURS * 60;
}

function detectDoubleShift(baseShift, interval, workingHours) {
  if (!Number.isFinite(interval.checkInMinutes) || !Number.isFinite(interval.checkOutMinutes)) return null;
  if (workingHours < DOUBLE_SHIFT_HOURS) return null;
  if (baseShift !== "A4" && baseShift !== "C4") return null;

  const ci = interval.checkInMinutes;
  const co = interval.checkOutMinutes;
  const dayOffsets = [-1, 0, 1];

  if (baseShift === "A4") {
    for (const d of dayOffsets) {
      const firstStart = d * DAY_MINUTES + 8 * 60;
      const firstEnd = d * DAY_MINUTES + 16 * 60;
      const secondStart = d * DAY_MINUTES + 20 * 60;
      const secondEnd = d * DAY_MINUTES + DAY_MINUTES + 4 * 60;
      if (coveredEightHours(ci, co, firstStart, firstEnd) && coveredEightHours(ci, co, secondStart, secondEnd)) {
        return "A4C4";
      }
    }
  }

  if (baseShift === "C4") {
    for (const d of dayOffsets) {
      const firstStart = d * DAY_MINUTES + 20 * 60;
      const firstEnd = d * DAY_MINUTES + DAY_MINUTES + 4 * 60;
      const secondStart = (d + 1) * DAY_MINUTES + 8 * 60;
      const secondEnd = (d + 1) * DAY_MINUTES + 16 * 60;
      if (coveredEightHours(ci, co, firstStart, firstEnd) && coveredEightHours(ci, co, secondStart, secondEnd)) {
        return "C4A4";
      }
    }
  }

  return null;
}

function getShiftStartMinute(baseShift) {
  if (baseShift === "G") return 9 * 60;
  if (baseShift === "C4") return 20 * 60;
  return 8 * 60;
}

function resolveAttendance(baseShift, interval, options) {
  if (!options.anyPunch) return "L";
  if (options.singlePunch) return "EL";
  if (!Number.isFinite(options.workingHours) || options.workingHours < MIN_DUTY_HOURS) return "EL";

  const checkInAbsolute = interval.checkInMinutes;
  const checkOutMinute = interval.checkOutMinutes;
  let late = false;
  let early = false;
  const graceLateMinute = getShiftStartMinute(baseShift) + 15;

  if (baseShift === "G") {
    late = Number.isFinite(checkInAbsolute) && checkInAbsolute > graceLateMinute;
    early = Number.isFinite(checkOutMinute) ? checkOutMinute < 18 * 60 : true;
  } else if (baseShift === "A4") {
    late = Number.isFinite(checkInAbsolute) && checkInAbsolute > graceLateMinute;
    early = Number.isFinite(checkOutMinute) ? checkOutMinute < 20 * 60 : true;
  } else {
    late = Number.isFinite(checkInAbsolute) && checkInAbsolute > graceLateMinute;
    early = Number.isFinite(checkOutMinute) ? checkOutMinute < DAY_MINUTES + 8 * 60 : true;
  }

  if (late && early) return "LC+EL";
  if (late) return "LC";
  if (early) return "EL";
  return "P";
}

function resolveSingleShiftOt(baseShift, workingHours) {
  if (baseShift === "G") return { otHours: 0, otStatus: "NO" };
  if (workingHours >= FULL_SHIFT_HOURS) return { otHours: 4, otStatus: "YES" };
  return { otHours: 0, otStatus: "NO" };
}

function buildResult({ dutyShift, attendanceStatus, otHours, otStatus, normalShiftCode = "", otShiftCode = "" }) {
  return {
    dutyShift,
    code: dutyShift,
    attendanceStatus,
    otHours,
    otStatus,
    normalShiftCode,
    otShiftCode,
    otLabel: otStatus === "YES" ? `${dutyShift}-OT` : "",
  };
}

function applySecurityRules(dailyRecord) {
  if (hasNoPunch(dailyRecord)) {
    return buildResult({
      dutyShift: "L",
      attendanceStatus: "L",
      otHours: 0,
      otStatus: "NO",
      normalShiftCode: "",
      otShiftCode: "",
    });
  }

  const interval = normalizeInterval(dailyRecord);
  const hints = parseShiftHints(dailyRecord);
  const baseShift = detectBaseShift(interval, hints);
  const singlePunch = isSinglePunch(dailyRecord);

  if (singlePunch) {
    return buildResult({
      dutyShift: baseShift,
      attendanceStatus: "EL",
      otHours: 0,
      otStatus: "NO",
      normalShiftCode: baseShift,
      otShiftCode: "",
    });
  }

  const workingHours = resolveWorkingHours(dailyRecord, interval);
  if (workingHours <= 0) {
    return buildResult({
      dutyShift: "L",
      attendanceStatus: "L",
      otHours: 0,
      otStatus: "NO",
      normalShiftCode: "",
      otShiftCode: "",
    });
  }

  const attendanceStatus = resolveAttendance(baseShift, interval, {
    anyPunch: hasAnyPunch(dailyRecord),
    singlePunch: false,
    workingHours,
  });

  const doubleShift = detectDoubleShift(baseShift, interval, workingHours);
  if (doubleShift) {
    return buildResult({
      dutyShift: doubleShift,
      attendanceStatus,
      otHours: 8,
      otStatus: "YES",
      normalShiftCode: doubleShift,
      otShiftCode: doubleShift === "A4C4" ? "C4" : "A4",
    });
  }

  const ot = resolveSingleShiftOt(baseShift, workingHours);
  return buildResult({
    dutyShift: baseShift,
    attendanceStatus,
    otHours: ot.otHours,
    otStatus: ot.otStatus,
    normalShiftCode: baseShift,
    otShiftCode: "",
  });
}

module.exports = {
  applySecurityRules,
  _internal: {
    detectBaseShift,
    detectDoubleShift,
    normalizeInterval,
    parseShiftHints,
    resolveAttendance,
  },
};
