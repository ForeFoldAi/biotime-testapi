const DAY_MINUTES = 24 * 60;
const MIN_DUTY_HOURS = 8;
const FULL_SHIFT_HOURS = 12;
const DOUBLE_SHIFT_HOURS = 16;
/** OT eligibility grace (Security / same rules as Driver via applySecurityRules). */
const OT_GRACE_MINUTES = 15;
const OT_GRACE_HOURS = OT_GRACE_MINUTES / 60;

/** Check-in / check-out grace vs SHIFT_TIMINGS (late after start+this; early leave before end−this). */
const ATTEND_GRACE_MINUTES = 15;

/**
 * Real shift clock times for attendance (extended minutes). Not the SEC allocation windows.
 * G 09:00–18:00, A4 08:00–20:00, C4 20:00–08:00 next calendar day.
 */
const SHIFT_TIMINGS = {
  G: { start: 9 * 60, end: 18 * 60 },
  A4: { start: 8 * 60, end: 20 * 60 },
  C4: { start: 20 * 60, end: 32 * 60 },
};

/** Seconds from midnight (local). Unified: G 08:31–13:00:59, A4 02:01–08:30:59, C4 13:01–23:59:59 + 00:00–02:00:59 */
const SEC = {
  C4_EVENING_START: 13 * 3600 + 60,
  C4_MORNING_END: 2 * 3600 + 59,
  A4_START: 2 * 3600 + 60,
  A4_END: 8 * 3600 + 30 * 60 + 59,
  G_START: 8 * 3600 + 31 * 60,
  G_END: 13 * 3600 + 59,
  LATE_G: 13 * 3600 + 59,
  LATE_A4: 8 * 3600 + 30 * 60 + 59,
};

function toBusinessRelativeMinutes(dateTime, businessDate) {
  if (!dateTime || !businessDate) return null;
  const base = new Date(`${businessDate}T00:00:00`);
  const ts = new Date(dateTime);
  if (Number.isNaN(base.getTime()) || Number.isNaN(ts.getTime())) return null;
  return (ts.getTime() - base.getTime()) / (1000 * 60);
}

function secondsFromMidnight(dateTime) {
  const d = new Date(dateTime);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

function normalizeDayMinute(minutes) {
  return ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
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

  const checkInSecondsOfDay = dailyRecord?.checkIn ? secondsFromMidnight(dailyRecord.checkIn) : null;
  return {
    checkInMinutes,
    checkOutMinutes,
    checkInMinuteOfDay: Number.isFinite(checkInMinutes) ? normalizeDayMinute(checkInMinutes) : null,
    checkInSecondsOfDay,
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

/** Assignment order: G 08:31–13:00:59, A4 02:01–08:30:59, C4 13:01–23:59:59 + 00:00–02:00:59 */
function detectShiftFromPunchTime(checkInSeconds) {
  if (!Number.isFinite(checkInSeconds)) return null;
  const s = checkInSeconds;
  if (s >= SEC.G_START && s <= SEC.G_END) return "G";
  if (s >= SEC.A4_START && s <= SEC.A4_END) return "A4";
  if ((s >= SEC.C4_EVENING_START && s <= 86399) || (s >= 0 && s <= SEC.C4_MORNING_END)) return "C4";
  return null;
}

/**
 * Duty shift from early/late check-in allocation (SEC). Roster hints apply only when punch time
 * does not fall in a SEC band (e.g. Sec-A4 on record does not override 12:58 → General).
 */
function detectBaseShift(interval, hint) {
  const fromTime = detectShiftFromPunchTime(interval.checkInSecondsOfDay);
  if (fromTime) return fromTime;
  if (hint.c4) return "C4";
  if (hint.a4) return "A4";
  if (hint.general) return "G";
  return "A4";
}

function shiftInstanceOnDay(shiftCode, dayIndex) {
  const base = dayIndex * DAY_MINUTES;
  if (shiftCode === "G") {
    return { start: base + SHIFT_TIMINGS.G.start, end: base + SHIFT_TIMINGS.G.end };
  }
  if (shiftCode === "A4") {
    return { start: base + SHIFT_TIMINGS.A4.start, end: base + SHIFT_TIMINGS.A4.end };
  }
  return { start: base + SHIFT_TIMINGS.C4.start, end: base + SHIFT_TIMINGS.C4.end };
}

function getShiftBoundsForAttendance(shiftCode, ci) {
  const d = Math.floor(ci / DAY_MINUTES);
  for (const delta of [-1, 0, 1, 2]) {
    const inst = shiftInstanceOnDay(shiftCode, d + delta);
    if (Number.isFinite(ci) && ci >= inst.start && ci <= inst.end) return inst;
  }
  return shiftInstanceOnDay(shiftCode, d);
}

function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function coveredEightHours(workStart, workEnd, dutyStart, dutyEnd) {
  return overlapMinutes(workStart, workEnd, dutyStart, dutyEnd) >= MIN_DUTY_HOURS * 60 - OT_GRACE_MINUTES;
}

function detectDoubleShift(baseShift, interval, workingHours) {
  if (!Number.isFinite(interval.checkInMinutes) || !Number.isFinite(interval.checkOutMinutes)) return null;
  if (workingHours < DOUBLE_SHIFT_HOURS - OT_GRACE_HOURS) return null;
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

/**
 * Late / early vs SHIFT_TIMINGS for the shift instance that contains check-in (extended timeline).
 * Late after shift start + grace; early leave if checkout before shift end − grace.
 */
function resolveAttendance(baseShift, interval, options, _checkInDate) {
  if (!options.anyPunch) return "L";
  if (options.singlePunch) return "EL";
  if (!Number.isFinite(options.workingHours) || options.workingHours < MIN_DUTY_HOURS) return "EL";

  const ci = interval.checkInMinutes;
  const co = interval.checkOutMinutes;
  if (!Number.isFinite(ci) || !Number.isFinite(co)) return "L";

  const { start, end } = getShiftBoundsForAttendance(baseShift, ci);
  const late = ci > start + ATTEND_GRACE_MINUTES;
  const early = co < end - ATTEND_GRACE_MINUTES;

  if (late && early) return "LC+EL";
  if (late) return "LC";
  if (early) return "EL";
  return "P";
}

function resolveSingleShiftOt(baseShift, workingHours) {
  if (baseShift === "G") return { otHours: 0, otStatus: "NO" };
  if (workingHours >= FULL_SHIFT_HOURS - OT_GRACE_HOURS) return { otHours: 4, otStatus: "YES" };
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

  const attendanceStatus = resolveAttendance(
    baseShift,
    interval,
    {
      anyPunch: hasAnyPunch(dailyRecord),
      singlePunch: false,
      workingHours,
    },
    dailyRecord.checkIn
  );

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
    getShiftBoundsForAttendance,
    shiftInstanceOnDay,
    SHIFT_TIMINGS,
    ATTEND_GRACE_MINUTES,
  },
};