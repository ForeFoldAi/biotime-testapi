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
    index.set(employeeId, {
      employeeId,
      name: getEmployeeName(employee),
      department: classifyDepartment(getDepartmentName(employee)),
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

/** MEP/O&M: weekly off only if an adjacent calendar day has strict Present (P) attendance. */
function evaluateMepWeeklyOffFromAdjacentPresent(dateObj, weeklyOffDay, getAttendanceStatusForDateStr) {
  const weekday = WEEKDAY_NAMES[dateObj.getDay()];
  if (!weeklyOffDay || weekday !== weeklyOffDay) return null;

  const prevStr = formatDate(addDays(dateObj, -1));
  const nextStr = formatDate(addDays(dateObj, 1));
  const prevP = getAttendanceStatusForDateStr(prevStr) === "P";
  const nextP = getAttendanceStatusForDateStr(nextStr) === "P";
  return prevP || nextP ? "W/O" : "L";
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
      department: employee.department,
      weekOff: weeklyOffDay || "",
      daily: {},
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
        if (employee.department === "MEP" || employee.department === "HOUSEKEEPING") {
          weekoffCode = evaluateMepWeeklyOffFromAdjacentPresent(dateObj, weeklyOffDay, (ds) => {
            const cached = ruleCache.get(`${employee.employeeId}|${ds}`);
            return cached?.attendanceStatus;
          });
        } else if (
          employee.department !== "SECURITY" &&
          employee.department !== "DRIVER" &&
          employee.department !== "LANDSCAPE"
        ) {
          weekoffCode = evaluateWeekOffCode(
            employee.employeeId,
            dateObj,
            groupedTransactions,
            weeklyOffDay
          );
        }

        row.daily[day] = weekoffCode || "L";
        continue;
      }

      const ruleResult = ruleCache.get(transactionKey);
      row.daily[day] = ruleResult.code || ruleResult.dutyShift || "L";
      if ((ruleResult.attendanceStatus || "P") === "P") {
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
