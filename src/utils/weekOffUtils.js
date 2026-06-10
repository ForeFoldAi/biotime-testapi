const WEEK_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

// BioTime API: 1 = Sunday, 2 = Monday, ... 7 = Saturday
const API_DAY_NUMBER_TO_NAME = {
  1: "sunday",
  2: "monday",
  3: "tuesday",
  4: "wednesday",
  5: "thursday",
  6: "friday",
  7: "saturday",
};

function extractWeekOffNumbers(value) {
  const text = String(value || "").trim();
  if (!text) return [];

  try {
    const normalized = text.replace(/'/g, '"');
    const parsed = JSON.parse(normalized);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => Number(item))
        .filter((num) => Number.isFinite(num) && num >= 1 && num <= 7);
    }
  } catch {
    // Fall through to single-number parsing.
  }

  const num = Number(text);
  if (Number.isFinite(num) && num >= 1 && num <= 7) return [num];
  return [];
}

function normalizeWeekOff(value) {
  const text = String(value || "").trim().toLowerCase();
  if (WEEK_DAYS.includes(text)) return text;

  const numbers = extractWeekOffNumbers(value);
  if (numbers.length > 0) {
    return API_DAY_NUMBER_TO_NAME[numbers[0]] || "";
  }

  return "";
}

function getEmployeeWeekOff(employee) {
  return normalizeWeekOff(employee?.week_off || employee?.weekoff || employee?.weekly_off || "");
}

function buildWeekoffRowsFromEmployees(employees = []) {
  const rows = [];
  for (const employee of employees) {
    const employeeId = String(
      employee?.emp_code || employee?.employee_id || employee?.id || ""
    ).trim();
    const weekOff = getEmployeeWeekOff(employee);
    if (!employeeId || !weekOff) continue;
    rows.push({ employee_id: employeeId, week_off: weekOff });
  }
  return rows;
}

module.exports = {
  WEEK_DAYS,
  normalizeWeekOff,
  getEmployeeWeekOff,
  buildWeekoffRowsFromEmployees,
};
