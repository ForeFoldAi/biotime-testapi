const DAY_MINUTES = 24 * 60;
const ATTEND_GRACE = 15;
/** OT eligibility: completing next shift / G post-core OT threshold may be up to this many minutes short. */
const OT_GRACE_MINUTES = 15;
const ALLOWED_TRANSITIONS = { A: "B", B: "C", C: "A" };
const ABC_CODES = new Set(["A", "B", "C"]);
/** Full-shift OT hours (additional shifts only; no partial minutes). */
const SHIFT_OT_HOURS = { A: 7, B: 7, C: 10 };

const FALLBACK_WINDOWS = {
  A: { start: 7 * 60, end: 14 * 60, overnight: false },
  B: { start: 14 * 60, end: 21 * 60, overnight: false },
  C: { start: 21 * 60, end: 7 * 60, overnight: true },
  G: { start: 9 * 60, end: 18 * 60, overnight: false },
};

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function debug(event, payload) {
  if (String(process.env.MEP_DEBUG || "").toLowerCase() !== "true") return;
  console.log(`[MEP_DEBUG] ${event}: ${JSON.stringify(payload)}`);
}

function toBusinessRelativeMinutes(dateTime, businessDate) {
  const base = new Date(`${businessDate}T00:00:00`);
  return (new Date(dateTime).getTime() - base.getTime()) / (1000 * 60);
}

function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function resolveMepWindows(shiftDefinitions = []) {
  const map = {};
  for (const shift of shiftDefinitions) {
    const code = String(shift.code || "").toUpperCase();
    if (!["A", "B", "C", "G"].includes(code)) continue;
    let start = 0;
    let end = 0;
    const [sh, sm] = String(shift.start || "00:00").split(":").map(Number);
    const [eh, em] = String(shift.end || "00:00").split(":").map(Number);
    if (Number.isFinite(sh) && Number.isFinite(sm)) start = sh * 60 + sm;
    if (Number.isFinite(eh) && Number.isFinite(em)) end = eh * 60 + em;
    map[code] = {
      start,
      end,
      overnight: Boolean(shift.overnight || end <= start),
    };
  }
  return {
    A: map.A || FALLBACK_WINDOWS.A,
    B: map.B || FALLBACK_WINDOWS.B,
    C: map.C || FALLBACK_WINDOWS.C,
    G: map.G || FALLBACK_WINDOWS.G,
  };
}

/** Absolute core interval [start, end) from business-date midnight; overnight end > DAY_MINUTES */
function coreIntervalAbsolute(windows, code, dayOffset) {
  const w = windows[code];
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
  const hit = candidates.find((inst) => minute >= inst.start && minute <= inst.end);
  return hit || null;
}

/** Instance for attendance + ABC chain: prefer core containing ci; else canonical day bucket for assigned code. */
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
  if (outMinutes < inMinutes) outMinutes += DAY_MINUTES;
  if (outMinutes === inMinutes) outMinutes += 1;
  const normalized = { start: inMinutes, end: outMinutes };
  debug("normalized_timeline", normalized);
  return normalized;
}

/**
 * Check-in only shift bucket (time-of-day on extended minute line).
 * A: 04:01–08:00, G: 08:01–13:00, B: 13:01–19:00, C: 19:01–04:00 (+1)
 */
function assignShiftFromCheckInMinutes(inM) {
  const x = ((inM % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  if (x >= 4 * 60 + 1 && x <= 8 * 60) return "A";
  if (x >= 8 * 60 + 1 && x <= 13 * 60) return "G";
  if (x >= 13 * 60 + 1 && x <= 19 * 60) return "B";
  if (x >= 19 * 60 + 1 || x <= 4 * 60) return "C";
  return "G";
}

/** RAW works: shifts with overlap > 0 vs [workStart, workEnd], ordered by overlap start */
function buildWorksTimeline(workStart, workEnd, windows) {
  const instances = listCoreInstances(windows, ["A", "B", "C", "G"], [-1, 0, 1, 2]);
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

function attendanceForShift({ ci, co, shiftStart, shiftEnd }) {
  const inLate = ci > shiftStart + ATTEND_GRACE;
  const outEarly = co < shiftEnd - ATTEND_GRACE;
  const inOk = ci <= shiftStart + ATTEND_GRACE;
  const outOk = co >= shiftEnd - ATTEND_GRACE;
  let status = "P";
  if (inOk && outOk) status = "P";
  else if (inLate && outEarly) status = "LC+EL";
  else if (inLate) status = "LC";
  else if (outEarly) status = "EL";
  else status = "P";
  return { status, inLate, outEarly, inOk, outOk };
}

function gOtStatusAndHours(ci, co, windows) {
  const gInst = findPrimaryShiftInstance(windows, "G", ci);
  const shiftStart = gInst.start;
  const shiftEnd = gInst.end;
  const { status: att } = attendanceForShift({ ci, co, shiftStart, shiftEnd });

  const coreEnd = gInst.end;
  const otMinutes = Math.max(0, co - coreEnd);
  const otHours = round2(otMinutes / 60);

  if (otMinutes <= 0) {
    return { otStatus: "NO", otHours: 0, attendance: att, shiftStart, shiftEnd, coreEnd };
  }
  if (otMinutes >= 3 * 60 - OT_GRACE_MINUTES) {
    return { otStatus: "YES", otHours, attendance: att, shiftStart, shiftEnd, coreEnd };
  }
  return { otStatus: "NOT_QUALIFIED", otHours, attendance: att, shiftStart, shiftEnd, coreEnd };
}

/** Next shift instance in A→B→C→A cycle after prevInst (timeline-aligned). */
function getNextShiftInstanceInCycle(windows, prevCode, prevInst) {
  const nextCode = ALLOWED_TRANSITIONS[prevCode];
  if (!nextCode) return null;
  const dayOffset = Math.floor(prevInst.start / DAY_MINUTES);
  if (prevCode === "C") {
    return coreIntervalAbsolute(windows, nextCode, dayOffset + 1);
  }
  return coreIntervalAbsolute(windows, nextCode, dayOffset);
}

/**
 * ABC OT: only full completed additional shifts; fixed hours per shift; max triple duty (chain length 3).
 * worksMerged kept for API compatibility (timeline unchanged elsewhere).
 */
function buildAbcChainAndOt(primary, ci, co, worksMerged, windows) {
  const primaryInst = findPrimaryShiftInstance(windows, primary, ci);
  const shiftStart = primaryInst.start;
  const shiftEnd = primaryInst.end;
  const att = attendanceForShift({ ci, co, shiftStart, shiftEnd });

  if (co < primaryInst.end) {
    return {
      chain: [primary],
      dutyShift: primary,
      otStatus: "NO",
      otHours: 0,
      attendance: att.status,
      shiftStart,
      shiftEnd,
      primaryInst,
    };
  }

  const chain = [primary];
  let curInst = primaryInst;
  let curCode = primary;
  let otHours = 0;

  while (chain.length < 3) {
    const nextInst = getNextShiftInstanceInCycle(windows, curCode, curInst);
    if (!nextInst) break;
    if (co < nextInst.end - OT_GRACE_MINUTES) {
      if (co > curInst.end) {
        return {
          chain,
          dutyShift: chain.join(""),
          otStatus: "NOT_QUALIFIED",
          otHours: 0,
          attendance: att.status,
          shiftStart,
          shiftEnd,
          primaryInst,
        };
      }
      break;
    }
    const nextCode = ALLOWED_TRANSITIONS[curCode];
    chain.push(nextCode);
    otHours += SHIFT_OT_HOURS[nextCode] || 0;
    curInst = nextInst;
    curCode = nextCode;
  }

  const dutyShift = chain.join("");
  return {
    chain,
    dutyShift,
    otStatus: otHours > 0 ? "YES" : "NO",
    otHours: round2(otHours),
    attendance: att.status,
    shiftStart,
    shiftEnd,
    primaryInst,
  };
}

function buildLoss(reason) {
  debug("loss_reason", { reason });
  return {
    dutyShift: "L",
    shift_code: "L",
    attendanceStatus: "L",
    attendance_status: "L",
    otShift: "NONE",
    ot_shift: "NONE",
    otHours: 0,
    ot_hours: 0,
    otStatus: "NO",
    ot_status: "NO",
    code: "L",
    otLabel: "",
    ot_label: "",
    normalShiftCode: "",
    otShiftCode: "",
    worksTimeline: "",
    works_timeline: "",
  };
}

function applyMepRules(dailyRecord) {
  const interval = normalizeWorkingInterval({
    checkIn: dailyRecord.checkIn,
    checkOut: dailyRecord.checkOut,
    date: dailyRecord.date,
  });
  if (!interval) return buildLoss("no_punch_data");

  const windows = resolveMepWindows(dailyRecord.shiftDefinitions || []);
  const ci = interval.start;
  const co = interval.end;

  const primary = assignShiftFromCheckInMinutes(ci);
  const worksMerged = buildWorksTimeline(ci, co, windows);
  const worksStr = worksMerged.map((w) => w.code).join("");

  if (primary === "G") {
    const g = gOtStatusAndHours(ci, co, windows);
    const dutyShift = "G";
    const otShift = g.otStatus === "YES" ? "G-OT" : "NONE";
    return {
      dutyShift,
      shift_code: dutyShift,
      attendanceStatus: g.attendance,
      attendance_status: g.attendance,
      otShift,
      ot_shift: otShift,
      otHours: g.otHours,
      ot_hours: g.otHours,
      otStatus: g.otStatus,
      ot_status: g.otStatus,
      code: dutyShift,
      otLabel: otShift === "NONE" ? "" : otShift,
      ot_label: otShift === "NONE" ? "" : otShift,
      normalShiftCode: "G",
      otShiftCode: g.otStatus === "YES" ? "EXT" : "",
      worksTimeline: worksStr,
      works_timeline: worksStr,
    };
  }

  const abc = buildAbcChainAndOt(primary, ci, co, worksMerged, windows);
  const otShift = abc.otStatus === "YES" ? `${abc.dutyShift}-OT` : "NONE";

  return {
    dutyShift: abc.dutyShift,
    shift_code: abc.dutyShift,
    attendanceStatus: abc.attendance,
    attendance_status: abc.attendance,
    otShift,
    ot_shift: otShift,
    otHours: abc.otHours,
    ot_hours: abc.otHours,
    otStatus: abc.otStatus,
    ot_status: abc.otStatus,
    code: abc.dutyShift,
    otLabel: otShift === "NONE" ? "" : otShift,
    ot_label: otShift === "NONE" ? "" : otShift,
    normalShiftCode: abc.chain[0] || primary,
    otShiftCode: abc.otStatus === "YES" ? abc.chain.slice(1).join("") || "" : "",
    worksTimeline: worksStr,
    works_timeline: worksStr,
  };
}

module.exports = { applyMepRules };
