const DAY_MINUTES = 24 * 60;
const ATTEND_GRACE = 15;
const A_END = 15 * 60;
const B_END = 21 * 60;
const C_END = 6 * 60 + DAY_MINUTES; // Always next-day end (30:00)

const FALLBACK_WINDOWS = {
  G1: { code: "G1", start: 9 * 60, end: 18 * 60, overnight: false },
  G2: { code: "G2", start: 8 * 60, end: 17 * 60, overnight: false },
  A: { code: "A", start: 6 * 60, end: 15 * 60, overnight: false },
  B: { code: "B", start: 12 * 60, end: 21 * 60, overnight: false },
  C: { code: "C", start: 21 * 60, end: 6 * 60, overnight: true },
};

function debug(event, payload) {
  if (String(process.env.HK_DEBUG || "").toLowerCase() !== "true") return;
  console.log(`[HK_DEBUG] ${event}: ${JSON.stringify(payload)}`);
}

function toBusinessRelativeMinutes(dateTime, businessDate) {
  const base = new Date(`${businessDate}T00:00:00`);
  return (new Date(dateTime).getTime() - base.getTime()) / (1000 * 60);
}

function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function normalizeCode(code) {
  const c = String(code || "").toUpperCase();
  if (c === "G") return "G1";
  return c;
}

function resolveHkWindows(shiftDefinitions = []) {
  const map = {};
  for (const shift of shiftDefinitions) {
    const raw = String(shift.code || "").toUpperCase();
    const code = normalizeCode(raw);
    if (!["G1", "G2", "A", "B", "C"].includes(code)) continue;
    let start = 0;
    let end = 0;
    const [sh, sm] = String(shift.start || "00:00").split(":").map(Number);
    const [eh, em] = String(shift.end || "00:00").split(":").map(Number);
    if (Number.isFinite(sh) && Number.isFinite(sm)) start = sh * 60 + sm;
    if (Number.isFinite(eh) && Number.isFinite(em)) end = eh * 60 + em;
    map[code] = {
      code,
      start,
      end,
      overnight: Boolean(shift.overnight || end <= start),
    };
  }
  return {
    G1: map.G1 || { ...FALLBACK_WINDOWS.G1 },
    G2: map.G2 || { ...FALLBACK_WINDOWS.G2 },
    A: map.A || { ...FALLBACK_WINDOWS.A },
    B: map.B || { ...FALLBACK_WINDOWS.B },
    C: map.C || { ...FALLBACK_WINDOWS.C },
  };
}

function coreIntervalAbsolute(windows, code, dayOffset) {
  const w = windows[code];
  if (!w) return { code, start: 0, end: 0, overnight: false };
  const base = dayOffset * DAY_MINUTES;
  let start = w.start + base;
  let end = w.end + base;
  if (w.overnight) end += DAY_MINUTES;
  return { code, start, end, overnight: w.overnight };
}

function listCoreInstances(windows, codes, dayOffsets = [-1, 0, 1, 2]) {
  const out = [];
  for (const code of codes) {
    if (!windows[code]) continue;
    for (const d of dayOffsets) {
      out.push(coreIntervalAbsolute(windows, code, d));
    }
  }
  return out;
}

function findCoreInstanceContaining(windows, code, minute) {
  const candidates = [-1, 0, 1, 2].map((d) => coreIntervalAbsolute(windows, code, d));
  return candidates.find((inst) => minute >= inst.start && minute <= inst.end) || null;
}

function findPrimaryShiftInstance(windows, primary, ci) {
  const hit = findCoreInstanceContaining(windows, primary, ci);
  if (hit) return hit;
  const dayOffset = Math.floor(ci / DAY_MINUTES);
  return coreIntervalAbsolute(windows, primary, dayOffset);
}

function normalizeWorkingInterval({ checkIn, checkOut, date }) {
  if (!checkIn && !checkOut) return null;
  const inTs = checkIn || checkOut;
  const outTs = checkOut || checkIn;
  const inMinutes = toBusinessRelativeMinutes(inTs, date);
  let outMinutes = toBusinessRelativeMinutes(outTs, date);
  if (outMinutes <= inMinutes) outMinutes += DAY_MINUTES;
  return { start: inMinutes, end: outMinutes };
}

function resolveNextShiftEndMinute(primaryCode, primaryInstance) {
  const dayBase = Math.floor(primaryInstance.start / DAY_MINUTES) * DAY_MINUTES;
  if (primaryCode === "A") return dayBase + B_END;
  if (primaryCode === "B") return dayBase + C_END;
  if (primaryCode === "C") return dayBase + DAY_MINUTES + A_END;
  return primaryInstance.end;
}

/**
 * Check-in only. Priority: A → G2 → G1 → B → C.
 * A: 04:01–07:00, G2: 07:01–08:30, G1: 08:31–11:00, B: 11:01–19:00, C: 19:01–04:00 (+1)
 */
function assignShiftFromCheckInMinutes(inM) {
  const x = ((inM % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const checks = [
    { code: "A", ok: x >= 4 * 60 + 1 && x <= 7 * 60 },
    { code: "G2", ok: x >= 7 * 60 + 1 && x <= 8 * 60 + 30 },
    { code: "G1", ok: x >= 8 * 60 + 31 && x <= 11 * 60 },
    { code: "B", ok: x >= 11 * 60 + 1 && x <= 19 * 60 },
    { code: "C", ok: x >= 19 * 60 + 1 || x <= 4 * 60 },
  ];
  const hit = checks.find((c) => c.ok);
  if (hit) return hit.code;
  throw new Error("Unable to assign housekeeping shift from check-in window.");
}

function assignGeneralShiftFromCheckInMinutes(inM) {
  const x = ((inM % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  if (x >= 7 * 60 + 1 && x <= 8 * 60 + 30) return "G2";
  if (x >= 8 * 60 + 31 && x <= 11 * 60) return "G1";
  // Keep General employees in General family for out-of-window punches.
  return x <= 8 * 60 + 30 ? "G2" : "G1";
}

function isGeneralShiftHint(dailyRecord) {
  const candidates = [
    dailyRecord?.employee_shift_name,
    dailyRecord?.employeeShiftName,
    dailyRecord?.scheduledShift,
    dailyRecord?.shiftName,
    dailyRecord?.employee_shift,
  ]
    .filter((v) => v != null)
    .map((v) => String(v).toUpperCase());

  return candidates.some(
    (v) => v.includes("GENERAL") || v === "G" || v === "G1" || v === "G2" || v.includes("MEP-GENERAL")
  );
}

function buildWorksTimeline(workStart, workEnd, windows, codes = ["G1", "G2", "A", "B", "C"]) {
  const instances = listCoreInstances(windows, codes, [-1, 0, 1, 2]);
  const raw = [];
  for (const inst of instances) {
    const ov = overlapMinutes(workStart, workEnd, inst.start, inst.end);
    if (ov <= 0) continue;
    raw.push({
      code: inst.code,
      oStart: Math.max(workStart, inst.start),
      oEnd: Math.min(workEnd, inst.end),
      minutes: ov,
    });
  }
  raw.sort((a, b) => a.oStart - b.oStart || a.code.localeCompare(b.code));
  const merged = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.code === seg.code && seg.oStart <= last.oEnd + 1e-6) {
      last.oEnd = Math.max(last.oEnd, seg.oEnd);
      last.minutes = last.oEnd - last.oStart;
      continue;
    }
    merged.push({ ...seg });
  }
  debug("works_timeline", { merged: merged.map((m) => `${m.code}[${m.oStart}-${m.oEnd}]`) });
  return merged;
}

/**
 * IN on-time: checkIn ≤ shiftStart + 15. OUT on-time: checkOut ≥ shiftEnd.
 * (e.g. C check-in 21:00:15 counts as on-time vs 21:00 + 15.)
 */
function attendanceForShift({ ci, co, shiftStart, shiftEnd }) {
  if (ci <= shiftStart + ATTEND_GRACE && co >= shiftEnd) {
    return { status: "P" };
  }
  const lc = ci > shiftStart + ATTEND_GRACE;
  const el = co < shiftEnd;
  if (lc && el) return { status: "LC+EL" };
  if (lc) return { status: "LC" };
  if (el) return { status: "EL" };
  return { status: "P" };
}

function buildLoss(reason) {
  debug("loss_reason", { reason });
  return {
    dutyShift: "L",
    shift_code: "L",
    code: "L",
    attendanceStatus: "L",
    attendance_status: "L",
    otShift: "NONE",
    ot_shift: "NONE",
    otHours: 0,
    ot_hours: 0,
    otStatus: "NO",
    ot_status: "NO",
    otLabel: "",
    ot_label: "",
    normalShiftCode: "",
    otShiftCode: "",
    worksTimeline: "",
    works_timeline: "",
  };
}

function parsePunchMeta(dailyRecord) {
  const inMs = new Date(dailyRecord?.checkIn || 0).getTime();
  const outMs = new Date(dailyRecord?.checkOut || 0).getTime();
  const hasPunchCount = Number.isFinite(Number(dailyRecord?.punchCount));
  const punchCount = hasPunchCount ? Number(dailyRecord.punchCount) : null;
  const samePunch = Number.isFinite(inMs) && Number.isFinite(outMs) && inMs === outMs;
  return { inMs, outMs, hasPunchCount, punchCount, samePunch };
}

function singlePunchResult(primaryCode, worksStr) {
  return {
    dutyShift: primaryCode,
    shift_code: primaryCode,
    code: primaryCode,
    attendanceStatus: "EL",
    attendance_status: "EL",
    otShift: "NONE",
    ot_shift: "NONE",
    otHours: 0,
    ot_hours: 0,
    otStatus: "NO",
    ot_status: "NO",
    otLabel: "",
    ot_label: "",
    normalShiftCode: primaryCode,
    otShiftCode: "",
    worksTimeline: worksStr,
    works_timeline: worksStr,
  };
}

function shouldShortCircuitInvalidPunch(dailyRecord) {
  const inMs = new Date(dailyRecord?.checkIn || dailyRecord?.checkOut || 0).getTime();
  const outMs = new Date(dailyRecord?.checkOut || dailyRecord?.checkIn || 0).getTime();
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs)) return true;
  if (inMs === outMs) return true;

  const hasWorkingHours = Number.isFinite(Number(dailyRecord?.workingHours));
  if (hasWorkingHours && Number(dailyRecord.workingHours) <= 0) return true;

  const hasPunchCount = Number.isFinite(Number(dailyRecord?.punchCount));
  if (hasPunchCount && Number(dailyRecord.punchCount) < 2) return true;

  return false;
}

function generalResult(primary, ci, co, windows, worksStr) {
  const inst = findPrimaryShiftInstance(windows, primary, ci);
  const { status: att } = attendanceForShift({ ci, co, shiftStart: inst.start, shiftEnd: inst.end });
  return {
    dutyShift: primary,
    shift_code: primary,
    code: primary,
    attendanceStatus: att,
    attendance_status: att,
    otShift: "NONE",
    ot_shift: "NONE",
    otHours: 0,
    ot_hours: 0,
    otStatus: "NO",
    ot_status: "NO",
    otLabel: "",
    ot_label: "",
    normalShiftCode: primary,
    otShiftCode: "",
    worksTimeline: worksStr,
    works_timeline: worksStr,
  };
}

function buildAbcChain(primary, ci, co, worksMerged, windows) {
  const primaryInst = findPrimaryShiftInstance(windows, primary, ci);
  const att = attendanceForShift({
    ci,
    co,
    shiftStart: primaryInst.start,
    shiftEnd: primaryInst.end,
  });
  // Final strict OT patch:
  // - OT only considered for B base shift
  // - Base worked in B must be >= 4h before any OT evaluation
  // - Valid OT only when B->C is fully completed (checkout >= 06:00 next day)
  // - No grace for OT; only 0 or 9 hours

  if (primary !== "B") {
    return {
      chain: [primary],
      dutyShift: primary,
      otStatus: "NO",
      otHours: 0,
      attendance: att.status,
      primaryInst,
    };
  }

  const baseWorkedMinutes = overlapMinutes(ci, co, primaryInst.start, primaryInst.end);
  if (baseWorkedMinutes < 4 * 60) {
    return {
      chain: [primary],
      dutyShift: primary,
      otStatus: "NOT_QUALIFIED",
      otHours: 0,
      attendance: att.status,
      primaryInst,
    };
  }

  // Never OT for single shift B.
  if (co <= B_END) {
    return {
      chain: [primary],
      dutyShift: primary,
      otStatus: "NO",
      otHours: 0,
      attendance: att.status,
      primaryInst,
    };
  }

  const nextShiftEnd = resolveNextShiftEndMinute(primary, primaryInst);
  if (co >= nextShiftEnd) {
    return {
      chain: [primary, "C"],
      dutyShift: "BC",
      otStatus: "YES",
      otHours: 9,
      attendance: att.status,
      primaryInst,
    };
  }

  return {
    chain: [primary],
    dutyShift: primary,
    otStatus: "NOT_QUALIFIED",
    otHours: 0,
    attendance: att.status,
    primaryInst,
  };
}

function applyHousekeepingRules(dailyRecord) {
  if (!dailyRecord?.checkIn || !dailyRecord?.checkOut) {
    throw new Error("Missing check-in/check-out for housekeeping rule evaluation.");
  }

  if (shouldShortCircuitInvalidPunch(dailyRecord)) {
    return buildLoss("invalid_punch");
  }

  const punchMeta = parsePunchMeta(dailyRecord);

  const interval = normalizeWorkingInterval({
    checkIn: dailyRecord.checkIn,
    checkOut: dailyRecord.checkOut,
    date: dailyRecord.date,
  });
  if (!interval) return buildLoss("no_punch_data");

  const windows = resolveHkWindows(dailyRecord.shiftDefinitions || []);
  const ci = interval.start;
  const co = interval.end;

  const generalHint = isGeneralShiftHint(dailyRecord);
  const primary = generalHint
    ? assignGeneralShiftFromCheckInMinutes(ci)
    : assignShiftFromCheckInMinutes(ci);
  const worksForPrimary = buildWorksTimeline(
    ci,
    co,
    windows,
    generalHint || primary === "G1" || primary === "G2" ? ["G1", "G2"] : ["A", "B", "C", "G1", "G2"]
  );
  const primaryWorksStr = worksForPrimary.map((w) => w.code).join("");

  const isSinglePunch =
    (punchMeta.hasPunchCount && punchMeta.punchCount < 2) ||
    (!punchMeta.hasPunchCount && punchMeta.samePunch);
  if (isSinglePunch) {
    return singlePunchResult(primary, primaryWorksStr);
  }

  if (generalHint || primary === "G1" || primary === "G2") {
    return generalResult(primary, ci, co, windows, primaryWorksStr);
  }

  const worksMerged = worksForPrimary;
  const worksStr = primaryWorksStr;

  const abc = buildAbcChain(primary, ci, co, worksMerged, windows);
  const otShift = abc.otStatus === "YES" ? `${abc.chain.slice(0, 2).join("")}-OT` : "NONE";

  return {
    dutyShift: abc.dutyShift,
    shift_code: abc.dutyShift,
    code: abc.dutyShift,
    attendanceStatus: abc.attendance,
    attendance_status: abc.attendance,
    otShift,
    ot_shift: otShift,
    otHours: abc.otHours,
    ot_hours: abc.otHours,
    otStatus: abc.otStatus,
    ot_status: abc.otStatus,
    otLabel: otShift === "NONE" ? "" : otShift,
    ot_label: otShift === "NONE" ? "" : otShift,
    normalShiftCode: abc.chain[0] || primary,
    otShiftCode: abc.otStatus === "YES" ? abc.chain[1] || "" : "",
    worksTimeline: worksStr,
    works_timeline: worksStr,
  };
}

module.exports = { applyHousekeepingRules };
