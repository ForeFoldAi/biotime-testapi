const { applyRuleForDepartment } = require("../engines/ruleDispatcher");
const {
  addDays,
  endOfMonth,
  formatDate,
  hoursBetween,
  listMonthDates,
  startOfMonth,
} = require("../utils/dateUtils");
const {
  classifyDepartment,
  getBusinessDateForTransaction,
  inferTransactionShiftCodes,
} = require("../utils/shiftUtils");

const WEEKDAY_NAMES = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

function getEmployeeId(entity) {
  return String(
    entity?.employee_id ||
      entity?.emp_code ||
      entity?.id ||
      entity?.code ||
      entity?.badgenumber ||
      entity?.emp ||
      ""
  );
}

function getEmployeeName(employee) {
  const fullName = [employee?.first_name, employee?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return (
    employee?.name ||
    employee?.full_name ||
    fullName ||
    employee?.emp_name ||
    `EMP-${getEmployeeId(employee)}`
  );
}

function getDepartmentName(employee) {
  return (
    employee?.department_name ||
    employee?.department?.dept_name ||
    employee?.department?.name ||
    employee?.department ||
    ""
  );
}

function getReportDepartmentName(rawDepartmentName) {
  const raw = String(rawDepartmentName || "").trim();
  const compact = raw.toUpperCase().replace(/[^A-Z]/g, "");
  if (compact.includes("PEST")) return "PEST CONTROL";
  if (compact.includes("LANDSCAPE") || compact.includes("GARDEN") || compact.includes("GARD")) return "LANDSCAPE";
  return classifyDepartment(raw);
}

function getDesignation(employee) {
  const value =
    employee?.position_name ||
    employee?.designation?.position_name ||
    employee?.designation?.name ||
    employee?.designation?.title ||
    employee?.position?.position_name ||
    employee?.position?.name ||
    employee?.position ||
    employee?.designation ||
    employee?.title ||
    employee?.job_title ||
    "";

  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    return String(
      value.position_name || value.name || value.title || value.job_title || ""
    ).trim();
  }
  return String(value || "").trim();
}

function getPunchDate(transaction) {
  return (
    transaction?.punch_time ||
    transaction?.timestamp ||
    transaction?.transaction_time ||
    transaction?.punch_datetime
  );
}

function normalizeWeekoffRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const employeeId = String(row.employee_id || row.emp_code || row.id || "");
    if (!employeeId) continue;
    const day = String(row.week_off || row.weekly_off || row.day || "").toUpperCase();
    if (!day) continue;
    map.set(employeeId, day);
  }
  return map;
}

function normalizeScheduleRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const employeeId = String(row.employee_id || row.emp_code || row.id || "");
    const date = row.date || row.duty_date;
    const shift = String(row.shift || row.shift_code || "").toUpperCase();
    if (!employeeId || !date || !shift) continue;
    map.set(`${employeeId}|${date}`, shift);
  }
  return map;
}

function createEmployeeIndex(employees = []) {
  const index = new Map();
  for (const employee of employees) {
    const employeeId = getEmployeeId(employee);
    if (!employeeId) continue;
    const rawDepartmentName = getDepartmentName(employee);
    index.set(employeeId, {
      employeeId,
      name: getEmployeeName(employee),
      department: classifyDepartment(rawDepartmentName),
      reportDepartment: getReportDepartmentName(rawDepartmentName),
      designation: getDesignation(employee),
    });
  }
  return index;
}

function getShiftDefinitionsForDepartment(shiftMaster, department) {
  if (department === "DRIVER" && Array.isArray(shiftMaster.SECURITY) && shiftMaster.SECURITY.length > 0) {
    return shiftMaster.SECURITY;
  }
  return shiftMaster[department] || shiftMaster.MEP || [];
}

function createGroupedTransactions(transactions, employeeIndex, shiftMaster, year, month) {
  const grouped = new Map();
  const monthStart = startOfMonth(year, month);
  const monthEnd = endOfMonth(year, month);

  for (const transaction of transactions || []) {
    const employeeId = getEmployeeId(transaction);
    if (!employeeId) continue;

    const employee = employeeIndex.get(employeeId);
    const department = employee?.department || "MEP";
    const shifts = getShiftDefinitionsForDepartment(shiftMaster, department);

    const punchDateValue = getPunchDate(transaction);
    if (!punchDateValue) continue;
    const punchDate = new Date(punchDateValue);
    if (Number.isNaN(punchDate.getTime())) continue;

    const businessDate = getBusinessDateForTransaction(punchDate, shifts);
    const businessDateObj = new Date(businessDate);
    if (businessDateObj < monthStart || businessDateObj > monthEnd) continue;

    const key = `${employeeId}|${businessDate}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        employeeId,
        businessDate,
        punches: [],
        shiftCodes: new Set(),
      });
    }

    const bucket = grouped.get(key);
    bucket.punches.push(punchDate);

    const codes = inferTransactionShiftCodes(punchDate, shifts);
    codes.forEach((code) => bucket.shiftCodes.add(code));
  }

  return grouped;
}

function hasWorkedOnDate(employeeId, dateStr, groupedTransactions) {
  const key = `${employeeId}|${dateStr}`;
  return groupedTransactions.has(key);
}

function evaluateWeekOffCode(employeeId, dateObj, groupedTransactions, weeklyOffDay) {
  const weekday = WEEKDAY_NAMES[dateObj.getDay()];
  if (!weeklyOffDay || weekday !== weeklyOffDay) return null;

  const prevDate = new Date(dateObj.getTime());
  prevDate.setDate(prevDate.getDate() - 1);
  const nextDate = new Date(dateObj.getTime());
  nextDate.setDate(nextDate.getDate() + 1);

  const prevWorked = hasWorkedOnDate(employeeId, formatDate(prevDate), groupedTransactions);
  const nextWorked = hasWorkedOnDate(employeeId, formatDate(nextDate), groupedTransactions);

  return prevWorked || nextWorked ? "W/O" : "L";
}

function isStrictPresent(status) {
  return String(status || "").trim().toUpperCase() === "P";
}

/** MEP/O&M: weekly off only if an adjacent calendar day has strict Present (P) attendance. */
function evaluateMepWeeklyOffFromAdjacentPresent(dateObj, weeklyOffDay, getRuleResultForDateStr) {
  const weekday = WEEKDAY_NAMES[dateObj.getDay()];
  if (!weeklyOffDay || weekday !== weeklyOffDay) return null;

  const prevStr = formatDate(addDays(dateObj, -1));
  const nextStr = formatDate(addDays(dateObj, 1));
  const prevResult = getRuleResultForDateStr(prevStr);
  const nextResult = getRuleResultForDateStr(nextStr);
  const prevP = isStrictPresent(prevResult?.attendanceStatus || prevResult?.attendance_status);
  const nextP = isStrictPresent(nextResult?.attendanceStatus || nextResult?.attendance_status);
  return prevP || nextP ? "W/O" : "L";
}

function toWeekOffCode(value) {
  const day = String(value || "").trim().toUpperCase();
  if (day === "MONDAY") return "mon";
  if (day === "TUESDAY") return "tue";
  if (day === "WEDNESDAY") return "wed";
  if (day === "THURSDAY") return "thu";
  if (day === "FRIDAY") return "fri";
  if (day === "SATURDAY") return "sat";
  if (day === "SUNDAY") return "sun";
  return "";
}

function splitCompositeDutyCode(code) {
  const text = String(code || "").toUpperCase();
  if (text === "A4C4") return ["A4", "C4"];
  if (text === "C4A4") return ["C4", "A4"];
  if (/^[A-Z]{2}$/.test(text)) return [text[0], text[1]];
  return null;
}

function formatDisplayCodeWithAttendanceStatus(code, attendanceStatus) {
  const base = String(code || "L");
  const status = String(attendanceStatus || "P").toUpperCase();
  if (!base || base === "L" || base === "W/O" || base === "WO") return base || "L";

  const parts = splitCompositeDutyCode(base);
  if (parts) {
    return `${parts[0]}-[${status}]${parts[1]}`;
  }
  return `${base}[${status}]`;
}

/** Housekeeping general shifts should report as G8 / G9, not legacy G / G1 / G2. */
function normalizeHousekeepingDailyCode(baseCode, ruleResult) {
  const u = String(baseCode || "").trim().toUpperCase();
  if (u === "G8" || u === "G9") return baseCode;
  if (u === "G2") return "G8";
  if (u === "G1" || u === "G") {
    const ns = String(ruleResult?.normalShiftCode || ruleResult?.normal_shift_code || "").toUpperCase();
    if (ns === "G8" || ns === "G9") return ns;
    const wt = String(ruleResult?.worksTimeline || ruleResult?.works_timeline || "");
    if (wt.toUpperCase().startsWith("G8")) return "G8";
    if (wt.toUpperCase().startsWith("G9")) return "G9";
    return "G9";
  }
  return baseCode;
}

function processAttendance({
  employees,
  transactions,
  month,
  year,
  shiftMaster,
  weekoffRows,
  scheduleRows,
}) {
  const employeeIndex = createEmployeeIndex(employees || []);
  const groupedTransactions = createGroupedTransactions(
    transactions,
    employeeIndex,
    shiftMaster,
    year,
    month
  );
  const weekoffMap = normalizeWeekoffRows(weekoffRows);
  const scheduleMap = normalizeScheduleRows(scheduleRows);
  const days = listMonthDates(year, month);
  const processedRows = [];

  employeeIndex.forEach((employee) => {
    const weeklyOffDay = weekoffMap.get(employee.employeeId);
    const row = {
      employeeId: employee.employeeId,
      employeeName: employee.name,
      department: employee.reportDepartment || employee.department,
      designation: employee.designation || "",
      weekOff: toWeekOffCode(weeklyOffDay),
      daily: {},
      dailyDisplay: {},
      dailyOt: {},
      totals: { presentDays: 0, otHours: 0 },
    };

    const ruleCache = new Map();
    for (const day of days) {
      const dateStr = formatDate(new Date(year, month - 1, day));
      const transactionKey = `${employee.employeeId}|${dateStr}`;
      const grouped = groupedTransactions.get(transactionKey);
      if (!grouped || grouped.punches.length === 0) continue;

      const punches = [...grouped.punches].sort((a, b) => a - b);
      const checkIn = punches[0];
      const checkOut = punches[punches.length - 1];
      const workingHours = hoursBetween(checkIn, checkOut);
      const shiftDefinitions = getShiftDefinitionsForDepartment(shiftMaster, employee.department);
      const dailyRecord = {
        employeeId: employee.employeeId,
        date: dateStr,
        checkIn,
        checkOut,
        workingHours,
        shiftDefinitions,
        scheduledShift: scheduleMap.get(transactionKey) || "",
      };
      ruleCache.set(transactionKey, applyRuleForDepartment(employee.department, dailyRecord));
    }

    for (const day of days) {
      const dateObj = new Date(year, month - 1, day);
      const dateStr = formatDate(dateObj);
      const transactionKey = `${employee.employeeId}|${dateStr}`;
      const grouped = groupedTransactions.get(transactionKey);

      if (!grouped || grouped.punches.length === 0) {
        let weekoffCode = null;
        if (
          employee.department === "MEP" ||
          employee.department === "HOUSEKEEPING" ||
          employee.department === "LANDSCAPE"
        ) {
          weekoffCode = evaluateMepWeeklyOffFromAdjacentPresent(
            dateObj,
            weeklyOffDay,
            (ds) => ruleCache.get(`${employee.employeeId}|${ds}`)
          );
        } else if (employee.department !== "SECURITY" && employee.department !== "DRIVER") {
          weekoffCode = evaluateWeekOffCode(
            employee.employeeId,
            dateObj,
            groupedTransactions,
            weeklyOffDay
          );
        }

        const baseCode = weekoffCode || "L";
        row.daily[day] = baseCode;
        row.dailyDisplay[day] = baseCode;
        row.dailyOt[day] = 0;
        continue;
      }

      const ruleResult = ruleCache.get(transactionKey);
      let baseCode = ruleResult.code || ruleResult.dutyShift || "L";
      if (employee.department === "HOUSEKEEPING") {
        baseCode = normalizeHousekeepingDailyCode(baseCode, ruleResult);
      }
      const attendanceStatus = ruleResult.attendanceStatus || "P";
      row.daily[day] = baseCode;
      row.dailyDisplay[day] = formatDisplayCodeWithAttendanceStatus(baseCode, attendanceStatus);
      row.dailyOt[day] = ruleResult.otStatus === "YES" ? Number(ruleResult.otHours || 0) : 0;
      if (attendanceStatus === "P") {
        row.totals.presentDays += 1;
      }
      if (ruleResult.otStatus === "YES") {
        row.totals.otHours += Number(ruleResult.otHours || 0);
      }
    }

    row.totals.otHours = Math.round(row.totals.otHours * 100) / 100;
    processedRows.push(row);
  });

  return {
    month,
    year,
    generatedAt: new Date().toISOString(),
    rows: processedRows,
  };
}

module.exports = {
  processAttendance,
};
