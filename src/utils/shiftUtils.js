const { addDays, formatDate } = require("./dateUtils");

const DAY_MINUTES = 24 * 60;
const DEFAULT_GRACE_MINUTES = 60;

function normalizeHHMM(value) {
  const input = String(value || "").trim().toUpperCase();
  if (!input) return "00:00";

  const ampmMatch = input.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (ampmMatch) {
    let hours = Number(ampmMatch[1]) % 12;
    const minutes = Number(ampmMatch[2]);
    if (ampmMatch[3] === "PM") hours += 12;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  const hhmmMatch = input.match(/^(\d{1,2}):(\d{2})/);
  if (!hhmmMatch) return "00:00";
  const hours = Math.min(23, Math.max(0, Number(hhmmMatch[1])));
  const minutes = Math.min(59, Math.max(0, Number(hhmmMatch[2])));
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function toMinutes(timeHHMM) {
  const [hours, minutes] = normalizeHHMM(timeHHMM).split(":").map(Number);
  return hours * 60 + minutes;
}

function getShiftInterval(shift) {
  const start = toMinutes(shift.start);
  let end = toMinutes(shift.end);
  const overnight = Boolean(shift.overnight || end <= start);
  if (overnight) end += DAY_MINUTES;
  return { start, end, overnight };
}

function getShiftDurationHours(shift) {
  const interval = getShiftInterval(shift);
  return Math.max(0, (interval.end - interval.start) / 60);
}

function getWorkingInterval(checkIn, checkOut, businessDate) {
  const base = new Date(`${businessDate}T00:00:00`);
  const start = (new Date(checkIn).getTime() - base.getTime()) / (1000 * 60);
  let end = (new Date(checkOut).getTime() - base.getTime()) / (1000 * 60);
  if (end < start) end += DAY_MINUTES;
  return { start, end };
}

function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function inferTransactionShiftCodes(transactionDate, shiftDefinitions) {
  const date = new Date(transactionDate);
  const timeMins = date.getHours() * 60 + date.getMinutes();
  return (shiftDefinitions || [])
    .filter((shift) => {
      const interval = getShiftInterval(shift);
      const within = interval.overnight
        ? timeMins >= interval.start || timeMins <= interval.end - DAY_MINUTES
        : timeMins >= interval.start && timeMins <= interval.end;
      return within;
    })
    .map((shift) => String(shift.code || "").toUpperCase())
    .filter(Boolean);
}

function getBusinessDateForTransaction(transactionDate, shiftDefinitions) {
  const date = new Date(transactionDate);
  const timeMins = date.getHours() * 60 + date.getMinutes();

  const shouldAttachToPreviousDay = (shiftDefinitions || []).some((shift) => {
    const interval = getShiftInterval(shift);
    if (!interval.overnight) return false;
    return timeMins <= interval.end - DAY_MINUTES;
  });

  if (!shouldAttachToPreviousDay) return formatDate(date);
  return formatDate(addDays(date, -1));
}

function normalizeShiftCombination(shiftCodes) {
  const unique = [...new Set((shiftCodes || []).map((code) => String(code).toUpperCase()))].filter(Boolean);
  if (unique.length === 0) return "";
  if (unique.includes("G")) return "G";
  const hasG9 = unique.some((x) => x === "G9" || x === "G1");
  const hasG8 = unique.some((x) => x === "G8" || x === "G2");
  if (hasG9 || hasG8) {
    return hasG9 ? "G9" : "G8";
  }

  const order = ["A", "B", "C", "A4", "C4"];
  unique.sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
  return unique.join("");
}

function detectShiftMatches({
  businessDate,
  checkIn,
  checkOut,
  shiftDefinitions = [],
  graceMinutes = DEFAULT_GRACE_MINUTES,
  overlapThresholdMinutes = 1,
}) {
  const working = getWorkingInterval(checkIn, checkOut, businessDate);
  const bestByCode = new Map();
  const offsets = [-DAY_MINUTES, 0, DAY_MINUTES];

  for (const shift of shiftDefinitions || []) {
    const code = String(shift.code || "").toUpperCase();
    if (!code) continue;
    const baseInterval = getShiftInterval(shift);

    for (const offset of offsets) {
      const start = baseInterval.start + offset;
      const end = baseInterval.end + offset;
      const eligibilityOverlap = overlapMinutes(
        working.start,
        working.end,
        start - graceMinutes,
        end + graceMinutes
      );

      if (eligibilityOverlap <= 0) continue;

      const coreOverlap = overlapMinutes(working.start, working.end, start, end);
      const candidate = {
        code,
        start,
        end,
        coreOverlap,
        eligibilityOverlap,
      };

      const existing = bestByCode.get(code);
      if (
        !existing ||
        candidate.coreOverlap > existing.coreOverlap ||
        (candidate.coreOverlap === existing.coreOverlap &&
          candidate.eligibilityOverlap > existing.eligibilityOverlap)
      ) {
        bestByCode.set(code, candidate);
      }
    }
  }

  const matched = [...bestByCode.values()]
    .filter((item) => item.coreOverlap >= overlapThresholdMinutes)
    .sort((a, b) => a.start - b.start || b.coreOverlap - a.coreOverlap);

  const primary = matched.length > 0 ? [...matched].sort((a, b) => b.coreOverlap - a.coreOverlap)[0] : null;
  return {
    working,
    matched,
    primary,
  };
}

function buildShiftChain(matchedShifts = [], { maxGapMinutes = 60 } = {}) {
  if (!Array.isArray(matchedShifts) || matchedShifts.length === 0) return [];
  if (matchedShifts.length === 1) return [matchedShifts[0].code];

  const sorted = [...matchedShifts].sort((a, b) => a.start - b.start);
  const chain = [sorted[0]];
  let lastEnd = sorted[0].end;

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    if (current.start <= lastEnd + maxGapMinutes) {
      chain.push(current);
      lastEnd = Math.max(lastEnd, current.end);
    }
  }

  return chain.map((item) => item.code);
}

function classifyDepartment(name) {
  const rawValue = String(name || "").toUpperCase();
  const compactValue = rawValue.replace(/[^A-Z]/g, "");

  if (compactValue.includes("SECURITY")) return "SECURITY";
  if (compactValue.includes("DRIVER") || compactValue.includes("TRANSPORT")) return "DRIVER";
  if (compactValue.includes("HOUSEKEEPING")) return "HOUSEKEEPING";
  if (
    compactValue.includes("LANDSCAPE") ||
    compactValue.includes("PEST") ||
    compactValue.includes("GARDEN") ||
    compactValue.includes("GARD")
  ) {
    return "LANDSCAPE";
  }
  return "MEP";
}

module.exports = {
  classifyDepartment,
  detectShiftMatches,
  buildShiftChain,
  getBusinessDateForTransaction,
  getShiftDurationHours,
  inferTransactionShiftCodes,
  normalizeHHMM,
  normalizeShiftCombination,
  overlapMinutes,
  toMinutes,
};
