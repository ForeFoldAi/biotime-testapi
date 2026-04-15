const { addDays, formatDate } = require("./dateUtils");

function toMinutes(timeHHMM) {
  const [hours, minutes] = String(timeHHMM).split(":").map(Number);
  return (hours * 60) + minutes;
}

function isTimeWithinShift(timeMins, shift) {
  const start = toMinutes(shift.start);
  const end = toMinutes(shift.end);
  if (!shift.overnight) {
    return timeMins >= start && timeMins <= end;
  }
  return timeMins >= start || timeMins <= end;
}

function inferTransactionShiftCodes(transactionDate, shiftDefinitions) {
  const date = new Date(transactionDate);
  const timeMins = (date.getHours() * 60) + date.getMinutes();
  return shiftDefinitions
    .filter((shift) => isTimeWithinShift(timeMins, shift))
    .map((shift) => shift.code);
}

function getBusinessDateForTransaction(transactionDate, shiftDefinitions) {
  const date = new Date(transactionDate);
  const timeMins = (date.getHours() * 60) + date.getMinutes();

  const shouldAttachToPreviousDay = shiftDefinitions.some((shift) => {
    if (!shift.overnight) return false;
    const end = toMinutes(shift.end);
    return timeMins <= end;
  });

  if (!shouldAttachToPreviousDay) {
    return formatDate(date);
  }

  return formatDate(addDays(date, -1));
}

function normalizeShiftCombination(shiftCodes) {
  const unique = [...new Set(shiftCodes)];
  if (unique.length === 0) return "";
  if (unique.includes("G")) return "G";

  const order = ["A", "B", "C", "A4", "C4"];
  unique.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return unique.join("");
}

function classifyDepartment(name) {
  const rawValue = (name || "").toUpperCase();
  const compactValue = rawValue.replace(/[^A-Z]/g, "");

  if (compactValue.includes("SECURITY")) return "SECURITY";
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
  getBusinessDateForTransaction,
  inferTransactionShiftCodes,
  normalizeShiftCombination,
  toMinutes,
};
