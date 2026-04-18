const { fetchEmployees } = require("../services/employeeService");
const { fetchDepartments } = require("../services/departmentService");
const { fetchTransactions } = require("../services/transactionService");
const runtimeStore = require("../storage/runtimeStore");
const { applyRuleForDepartment } = require("../engines/ruleDispatcher");
const { startOfMonth, endOfMonth, formatDate, hoursBetween } = require("../utils/dateUtils");
const {
  classifyDepartment,
  getBusinessDateForTransaction,
  inferTransactionShiftCodes,
} = require("../utils/shiftUtils");
const { formatHoursToHM } = require("../utils/formatHours");

function parseDateRange(query) {
  if (query.start_date && query.end_date) {
    const start = new Date(`${query.start_date}T00:00:00`);
    const end = new Date(`${query.end_date}T23:59:59`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error(
        "Invalid start_date/end_date. Use format YYYY-MM-DD. Example: /api/data/transactions?start_date=2026-04-01&end_date=2026-04-30"
      );
    }
    return { start, end, month: start.getMonth() + 1, year: start.getFullYear() };
  }

  const today = new Date();
  const month = Number(query.month || today.getMonth() + 1);
  const year = Number(query.year || today.getFullYear());
  if (!month || month < 1 || month > 12 || !year || year < 2000) {
    throw new Error("Invalid month/year. Example: /api/data/transactions?month=4&year=2026");
  }
  return { start: startOfMonth(year, month), end: endOfMonth(year, month), month, year };
}

function toDateOnly(value) {
  if (typeof value === "number") {
    // Excel date serial fallback
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const millis = Number(value) * 24 * 60 * 60 * 1000;
    const date = new Date(excelEpoch.getTime() + millis);
    if (!Number.isNaN(date.getTime())) {
      return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function normalizeEmployeeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function buildTaggedShiftLookup() {
  try {
    const shiftRows = runtimeStore.getShiftExportRows();
    const timetableRows = runtimeStore.getTimetableExportRows();
    const employeeScheduleRows =
      runtimeStore.getEmployeeScheduleExportRows().length > 0
        ? runtimeStore.getEmployeeScheduleExportRows()
        : runtimeStore.getSchedules();

    const shiftToTimetable = new Map();
    for (const row of shiftRows) {
      const shiftName = String(row.shift_name || "").trim();
      const timetableName = String(row.timetable || "").trim();
      if (!shiftName) continue;
      shiftToTimetable.set(shiftName, timetableName || shiftName);
    }

    const timetableMap = new Map();
    for (const row of timetableRows) {
      const name = String(row.name || "").trim();
      if (!name) continue;
      const checkIn = String(row["check-in"] || row.check_in || "").trim();
      const checkOut = String(row["check-out"] || row.check_out || "").trim();
      const timings = checkIn || checkOut ? `${checkIn} - ${checkOut}` : "";
      timetableMap.set(name, timings);
    }

    const employeeSchedules = [];
    for (const row of employeeScheduleRows) {
      const employeeCode = normalizeEmployeeCode(
        row.employee_id || row.emp_code || row.employee_code || row.id || ""
      );
      const shiftName = String(row.shift_name || row.shift || row.shift_code || "").trim();
      const startDate = toDateOnly(row.start_date);
      const endDate = toDateOnly(row.end_date);
      if (!employeeCode || !shiftName || !startDate || !endDate) continue;

      const timetableName = shiftToTimetable.get(shiftName) || shiftName;
      const timings = timetableMap.get(timetableName) || "";

      employeeSchedules.push({
        employeeCode,
        shiftName,
        startDate,
        endDate,
        timings,
      });
    }

    return { employeeSchedules };
  } catch (error) {
    return { employeeSchedules: [] };
  }
}

function getTaggedShiftForDate(employeeCode, dateStr, employeeSchedules) {
  const date = toDateOnly(dateStr);
  if (!employeeCode || !date) return { employeeShiftName: "", originalShiftTimings: "" };
  const normalizedCode = normalizeEmployeeCode(employeeCode);

  const match = employeeSchedules.find((item) => {
    return (
      normalizeEmployeeCode(item.employeeCode) === normalizedCode &&
      date.getTime() >= item.startDate.getTime() &&
      date.getTime() <= item.endDate.getTime()
    );
  });

  if (!match) return { employeeShiftName: "", originalShiftTimings: "" };
  return {
    employeeShiftName: match.shiftName,
    originalShiftTimings: match.timings,
  };
}

function inferShiftCodeFromShiftName(shiftName) {
  const value = String(shiftName || "").toUpperCase().trim();
  if (!value) return "";
  if (value.includes("GENERAL")) return "G";
  if (value.includes("A4")) return "A4";
  if (value.includes("C4")) return "C4";
  if (/(^|[-_ ])A\d*/.test(value)) return "A";
  if (/(^|[-_ ])B\d*/.test(value)) return "B";
  if (/(^|[-_ ])C\d*/.test(value)) return "C";
  if (value.includes(" A ") || value.endsWith(" A") || value.startsWith("A ")) return "A";
  if (value.includes(" B ") || value.endsWith(" B") || value.startsWith("B ")) return "B";
  if (value.includes(" C ") || value.endsWith(" C") || value.startsWith("C ")) return "C";
  return "";
}

function getDepartmentName(employee) {
  return (
    employee?.department_name ||
    employee?.department?.dept_name ||
    employee?.department?.name ||
    employee?.department ||
    "UNASSIGNED"
  );
}

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

function getPositionName(employee) {
  return (
    employee?.position?.position_name ||
    employee?.position_name ||
    employee?.position ||
    ""
  );
}

function getAreaName(employee) {
  if (Array.isArray(employee?.area)) {
    return employee.area
      .map((item) => item?.area_name || item?.name || item?.area_code || "")
      .filter(Boolean)
      .join(", ");
  }

  if (Array.isArray(employee?.areas)) {
    return employee.areas
      .map((item) => item?.area_name || item?.name || item?.area_code || "")
      .filter(Boolean)
      .join(", ");
  }

  return employee?.area_name || "";
}

function getPunchDate(transaction) {
  return (
    transaction?.punch_time ||
    transaction?.timestamp ||
    transaction?.transaction_time ||
    transaction?.punch_datetime
  );
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

function getShiftOrderMap(shiftDefinitions = []) {
  const ordered = [...shiftDefinitions].sort((a, b) => {
    const [ah, am] = String(a.start || "00:00").split(":").map(Number);
    const [bh, bm] = String(b.start || "00:00").split(":").map(Number);
    return ah * 60 + am - (bh * 60 + bm);
  });

  const orderMap = new Map();
  ordered.forEach((shift, index) => {
    orderMap.set(String(shift.code || "").toUpperCase(), index + 1);
  });
  return orderMap;
}

function resolveNormalAndOtShifts({
  scheduledShift,
  detectedShiftCodes,
  shiftDefinitions,
  preferNonGeneralWhenAvailable = false,
}) {
  const uniqueCodes = [...new Set((detectedShiftCodes || []).filter(Boolean))];
  const orderMap = getShiftOrderMap(shiftDefinitions);

  const sortedDetected = [...uniqueCodes].sort((a, b) => {
    const ao = orderMap.get(a) || 999;
    const bo = orderMap.get(b) || 999;
    return ao - bo;
  });

  let normalShift = "";
  if (scheduledShift) {
    normalShift = scheduledShift;
  } else if (sortedDetected.length > 0) {
    if (preferNonGeneralWhenAvailable) {
      const nonGeneral = sortedDetected.find((code) => code !== "G");
      normalShift = nonGeneral || sortedDetected[0];
    } else {
      normalShift = sortedDetected[0];
    }
  }

  let otShifts = sortedDetected.filter((code) => code !== normalShift);

  // Don't relate General shift with A/B/C family in OT.
  if (normalShift === "G") {
    otShifts = [];
  } else if (normalShift) {
    otShifts = otShifts.filter((code) => code !== "G");
  }

  return {
    normalShift: normalShift || "",
    otShift: otShifts.join("+"),
  };
}

function parseHHMMToMinutes(value) {
  const text = String(value || "00:00").trim();
  const pure = text.split("+")[0];
  const [h, m] = pure.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function getShiftDefinitionByCode(shiftDefinitions = [], shiftCode) {
  const code = String(shiftCode || "").toUpperCase();
  return shiftDefinitions.find((shift) => String(shift.code || "").toUpperCase() === code);
}

function getShiftDurationHours(shiftDefinition) {
  if (!shiftDefinition) return 0;
  const start = parseHHMMToMinutes(shiftDefinition.start);
  let end = parseHHMMToMinutes(shiftDefinition.end);
  if (shiftDefinition.overnight || end <= start) end += 24 * 60;
  return Math.max(0, (end - start) / 60);
}

function isTaggedShiftWithinTolerance({ checkIn, checkOut, shiftDefinition, toleranceMinutes = 30 }) {
  if (!checkIn || !checkOut || !shiftDefinition) return false;
  const shiftStart = parseHHMMToMinutes(shiftDefinition.start);
  let shiftEnd = parseHHMMToMinutes(shiftDefinition.end);
  const overnight = Boolean(shiftDefinition.overnight || shiftEnd <= shiftStart);
  if (overnight) shiftEnd += 24 * 60;

  let checkInMins = checkIn.getHours() * 60 + checkIn.getMinutes();
  let checkOutMins = checkOut.getHours() * 60 + checkOut.getMinutes();
  if (overnight && checkOutMins < checkInMins) checkOutMins += 24 * 60;

  const checkInMatch = Math.abs(checkInMins - shiftStart) <= toleranceMinutes;
  const checkOutMatch = Math.abs(checkOutMins - shiftEnd) <= toleranceMinutes;
  return checkInMatch || checkOutMatch;
}

function isSingleShiftBoundaryMatch({
  checkIn,
  checkOut,
  shiftDefinition,
  toleranceMinutes = 30,
}) {
  if (!checkIn || !checkOut || !shiftDefinition) return false;
  const shiftStart = parseHHMMToMinutes(shiftDefinition.start);
  let shiftEnd = parseHHMMToMinutes(shiftDefinition.end);
  const overnight = Boolean(shiftDefinition.overnight || shiftEnd <= shiftStart);
  if (overnight) shiftEnd += 24 * 60;

  let checkInMins = checkIn.getHours() * 60 + checkIn.getMinutes();
  let checkOutMins = checkOut.getHours() * 60 + checkOut.getMinutes();
  if (overnight && checkOutMins < checkInMins) checkOutMins += 24 * 60;

  const checkInMatch = Math.abs(checkInMins - shiftStart) <= toleranceMinutes;
  const checkOutMatch = Math.abs(checkOutMins - shiftEnd) <= toleranceMinutes;
  return checkInMatch && checkOutMatch;
}

function buildShiftDefinitionFromOriginalTimings(timingsText, fallbackDefinition) {
  const text = String(timingsText || "").trim();
  const parts = text.split(" - ").map((part) => part.trim());
  if (parts.length !== 2) return fallbackDefinition;

  const start = parts[0];
  const end = parts[1];
  const startMins = parseHHMMToMinutes(start);
  const endMins = parseHHMMToMinutes(end);
  return {
    code: fallbackDefinition?.code || "",
    start,
    end,
    overnight: endMins <= startMins || String(end).includes("+1"),
  };
}

function normalizeHousekeepingOtShift({
  normalShift,
  otShift,
  checkIn,
  checkOut,
}) {
  if (!otShift || !normalShift) return otShift || "";
  const otCodes = String(otShift)
    .split("+")
    .map((code) => String(code).trim().toUpperCase())
    .filter(Boolean);
  if (otCodes.length === 0) return "";

  const nextShiftMap = {
    A: "B",
    B: "C",
    C: "A",
  };
  const expectedOtShift = nextShiftMap[String(normalShift).toUpperCase()];
  if (!expectedOtShift) return otCodes.join("+");

  // For overnight continuation (e.g. B to next-day checkout), keep only true adjacent OT shift.
  const overnightWorked = checkOut.getTime() < checkIn.getTime();
  if (overnightWorked && normalShift === "B") {
    return otCodes.includes("C") ? "C" : "";
  }

  if (otCodes.includes(expectedOtShift)) return expectedOtShift;
  return "";
}

function isNoOtDepartment(departmentName) {
  const value = String(departmentName || "").toUpperCase();
  return value.includes("GARD") || value.includes("PEST");
}

function buildDerivedDepartments(employees = []) {
  const deptMap = new Map();
  for (const employee of employees) {
    const deptName = String(getDepartmentName(employee));
    if (!deptMap.has(deptName)) {
      deptMap.set(deptName, {
        department_name: deptName,
        employee_count: 0,
      });
    }
    deptMap.get(deptName).employee_count += 1;
  }
  return [...deptMap.values()].sort((a, b) =>
    a.department_name.localeCompare(b.department_name)
  );
}

async function getEmployeesData(req, res, next) {
  try {
    const startPage = Number(req.query.start_page || 1);
    const endPage = Number(req.query.end_page || 5);
    const pageSize = req.query.page_size ? Number(req.query.page_size) : undefined;
    const allPages = req.query.all_pages === undefined ? true : req.query.all_pages;
    const maxPages = req.query.max_pages ? Number(req.query.max_pages) : 50;
    const employees = await fetchEmployees({
      startPage,
      endPage,
      pageSize,
      allPages,
      maxPages,
    });
    res.json({
      all_pages: String(allPages) === "true",
      pages_fetched: String(allPages) === "true" ? `1..up to ${maxPages}` : `${startPage}-${endPage}`,
      total: employees.length,
      rows: employees,
    });
  } catch (error) {
    next(error);
  }
}

async function getDepartmentsData(req, res, next) {
  try {
    const [departments, employees] = await Promise.all([
      fetchDepartments(),
      fetchEmployees(),
    ]);

    const derivedDepartments = buildDerivedDepartments(employees);
    res.json({
      total_from_department_api: departments.length,
      total_derived_from_employees: derivedDepartments.length,
      department_rows: departments,
      derived_department_rows: derivedDepartments,
    });
  } catch (error) {
    next(error);
  }
}

async function getTransactionsData(req, res, next) {
  try {
    const { start, end, month, year } = parseDateRange(req.query);
    const transactions = await fetchTransactions({
      startTime: start,
      endTime: end,
    });

    res.json({
      month,
      year,
      start_time: start,
      end_time: end,
      total: transactions.length,
      rows: transactions,
    });
  } catch (error) {
    next(error);
  }
}

async function getAllApiData(req, res, next) {
  try {
    const { start, end, month, year } = parseDateRange(req.query);
    const [employees, departments, transactions] = await Promise.all([
      fetchEmployees(),
      fetchDepartments(),
      fetchTransactions({
        startTime: start,
        endTime: end,
      }),
    ]);

    const derivedDepartments = buildDerivedDepartments(employees);
    res.json({
      month,
      year,
      counts: {
        employees: employees.length,
        departments: departments.length,
        derived_departments: derivedDepartments.length,
        transactions: transactions.length,
      },
      departments,
      derived_departments: derivedDepartments,
      employees,
      transactions,
    });
  } catch (error) {
    next(error);
  }
}

async function getAttendanceTableData(req, res, next) {
  try {
    const { start, end, month, year } = parseDateRange(req.query);
    const [employeePayload, transactionPayload] = await Promise.all([
      fetchEmployees({ includeMeta: true, allPages: true, maxPages: 200 }),
      fetchTransactions({
        startTime: start,
        endTime: end,
        includeMeta: true,
      }),
    ]);
    const shifts = runtimeStore.getShifts();
    const schedules = runtimeStore.getSchedules();
    const employees = employeePayload.rows || [];
    const transactions = transactionPayload.rows || [];

    const employeeMap = new Map();
    for (const employee of employees || []) {
      const employeeId = getEmployeeId(employee);
      if (!employeeId) continue;

      employeeMap.set(employeeId, {
        employee_id: employeeId,
        employee_code: employee?.emp_code || employeeId,
        employee_name: getEmployeeName(employee),
        department: getDepartmentName(employee),
        position: getPositionName(employee),
        area: getAreaName(employee),
      });
    }

    const scheduleMap = normalizeScheduleRows(schedules);
    const { employeeSchedules } = buildTaggedShiftLookup();
    const grouped = new Map();
    let skippedTransactionsNoEmployee = 0;
    let skippedTransactionsInvalidTime = 0;

    for (const transaction of transactions || []) {
      const employeeId = getEmployeeId(transaction);
      const employee = employeeMap.get(employeeId);
      const punchDateValue = getPunchDate(transaction);
      if (!employee || !punchDateValue) {
        skippedTransactionsNoEmployee += 1;
        continue;
      }

      const punchDate = new Date(punchDateValue);
      if (Number.isNaN(punchDate.getTime())) {
        skippedTransactionsInvalidTime += 1;
        continue;
      }

      const departmentKey = classifyDepartment(employee.department);
      const shiftDefinitions =
        (departmentKey === "DRIVER" && shifts.SECURITY) || shifts[departmentKey] || shifts.MEP || [];
      const businessDate = getBusinessDateForTransaction(punchDate, shiftDefinitions);

      const key = `${employeeId}|${businessDate}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          employeeId,
          date: businessDate,
          punches: [],
          shiftCodes: new Set(),
        });
      }

      const bucket = grouped.get(key);
      bucket.punches.push({
        date: punchDate,
        raw: String(punchDateValue),
      });
      const detectedCodes = inferTransactionShiftCodes(punchDate, shiftDefinitions);
      detectedCodes.forEach((code) => bucket.shiftCodes.add(code));
    }

    const rows = [];
    grouped.forEach((bucket) => {
      const employee = employeeMap.get(bucket.employeeId);
      const punches = bucket.punches.sort((a, b) => a.date - b.date);
      const checkIn = punches[0].date;
      const checkOut = punches[punches.length - 1].date;
      const checkInRaw = punches[0].raw;
      const checkOutRaw = punches[punches.length - 1].raw;
      const key = `${bucket.employeeId}|${bucket.date}`;
      const taggedShift = getTaggedShiftForDate(
        employee.employee_code,
        bucket.date,
        employeeSchedules
      );
      const departmentKey = classifyDepartment(employee.department);
      const shiftDefinitions =
        (departmentKey === "DRIVER" && shifts.SECURITY) || shifts[departmentKey] || shifts.MEP || [];
      const scheduleShiftCode = scheduleMap.get(key) || "";
      const taggedShiftCode = inferShiftCodeFromShiftName(taggedShift.employeeShiftName);
      const workingHours = Number(hoursBetween(checkIn, checkOut).toFixed(2));
      const ruleResult = applyRuleForDepartment(departmentKey, {
        employeeId: bucket.employeeId,
        date: bucket.date,
        checkIn,
        checkOut,
        workingHours,
        shiftDefinitions,
        scheduledShift: scheduleShiftCode || taggedShiftCode || "",
      });
      const finalNormalShift = ruleResult.normalShiftCode || ruleResult.code || ruleResult.dutyShift || "L";
      const finalOtShift = ruleResult.otShiftCode || "";
      const rawOtHours = Number(ruleResult.otHours || 0);

      rows.push({
        date: bucket.date,
        employee_code: employee.employee_code,
        employee_id: employee.employee_id,
        employee_name: employee.employee_name,
        department: employee.department,
        position: employee.position,
        area: employee.area,
        check_in: checkInRaw,
        check_out: checkOutRaw,
        working_hours: formatHoursToHM(workingHours),
        working_hours_decimal: workingHours,
        punch_count: punches.length,
        employee_shift_name: taggedShift.employeeShiftName,
        original_shift_timings: taggedShift.originalShiftTimings,
        scheduled_shift: scheduleShiftCode || "",
        normal_shift: finalNormalShift,
        ot_shift: finalOtShift || "",
        attendance_status: ruleResult.attendanceStatus || "P",
        ot_hours: formatHoursToHM(rawOtHours),
        ot_hours_decimal: rawOtHours,
        is_ot:
          ruleResult.otStatus ||
          (rawOtHours > 0 ? "YES" : "NO"),
      });
    });

    rows.sort((a, b) => {
      if (a.employee_code === b.employee_code) return a.date.localeCompare(b.date);
      return String(a.employee_code).localeCompare(String(b.employee_code));
    });

    res.json({
      month,
      year,
      start_date: formatDate(start),
      end_date: formatDate(end),
      total_rows: rows.length,
      verification: {
        employees: employeePayload.meta || {},
        transactions: transactionPayload.meta || {},
        skipped_transactions_no_employee: skippedTransactionsNoEmployee,
        skipped_transactions_invalid_time: skippedTransactionsInvalidTime,
      },
      rows,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllApiData,
  getAttendanceTableData,
  getDepartmentsData,
  getEmployeesData,
  getTransactionsData,
};
