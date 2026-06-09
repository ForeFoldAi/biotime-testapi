const { fetchEmployees } = require("../services/employeeService");
const { fetchTransactions } = require("../services/transactionService");
const { processAttendance } = require("../processors/attendanceProcessor");
const { stores } = require("../storage");
const runtimeStore = require("../storage/runtimeStore");
const { buildTabularReport } = require("../reports/reportBuilder");
const { exportReportToExcel } = require("../reports/excelExporter");
const { startOfMonth, endOfMonth, formatDate } = require("../utils/dateUtils");
const { formatHoursToHM } = require("../utils/formatHours");
const {
  buildDerivedCheckInOutByDate,
  groupPunchesByEmployeeDate,
} = require("../utils/punchGrouping");
const {
  buildEmployeeAliasLookup,
  getCanonicalEmployeeId,
  resolveTransactionEmployeeKey,
} = require("../utils/transactionEmployeeUtils");
const fs = require("fs/promises");
const path = require("path");
const { OUTPUT_DIR } = require("../config/env");

function parseMonthYear(query) {
  const today = new Date();
  const month = Number(query.month || today.getMonth() + 1);
  const year = Number(query.year || today.getFullYear());
  if (!month || month < 1 || month > 12 || !year || year < 2000) {
    throw new Error("Invalid month/year. Example: /report?month=4&year=2026");
  }
  return { month, year };
}

async function generateReport(req, res, next) {
  try {
    const { month, year } = parseMonthYear(req.query);
    const selectedArea = String(req.query.area || "").trim();
    const shifts = runtimeStore.getShifts();
    const weekoffs = runtimeStore.getWeekoffs();
    const employeeManagementPayload = await stores.employeeManagement.read();
    const savedWeekoffs = Array.isArray(employeeManagementPayload?.rows)
      ? employeeManagementPayload.rows
      : [];
    // Saved Employee Management week-offs should override imported defaults.
    const mergedWeekoffRows = [...weekoffs, ...savedWeekoffs];
    const schedules = runtimeStore.getSchedules();

    const start = startOfMonth(year, month);
    const end = endOfMonth(year, month);

    const [employees, transactions] = await Promise.all([
      fetchEmployees(),
      fetchTransactions({ startTime: start, endTime: end }),
    ]);

    const filteredEmployees =
      !selectedArea || selectedArea.toLowerCase() === "all"
        ? employees
        : (employees || []).filter(
            (employee) => getAreaName(employee).toLowerCase() === selectedArea.toLowerCase()
          );

    const processed = processAttendance({
      employees: filteredEmployees,
      transactions,
      month,
      year,
      shiftMaster: shifts,
      weekoffRows: mergedWeekoffRows,
      scheduleRows: schedules,
    });

    const report = buildTabularReport(processed);
    const excel = await exportReportToExcel(processed);
    await stores.lastReport.write({ ...report, excel, area: selectedArea || "all" });

    res.json({
      message: "Monthly report generated successfully",
      report,
      excel,
      area: selectedArea || "all",
    });
  } catch (error) {
    next(error);
  }
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

function getPunchDate(transaction) {
  return (
    transaction?.punch_time ||
    transaction?.timestamp ||
    transaction?.transaction_time ||
    transaction?.punch_datetime
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

function getAreaName(employee) {
  if (Array.isArray(employee?.area)) {
    return employee.area
      .map((item) => String(item?.area_name || item?.name || item?.area_code || "").trim())
      .filter(Boolean)
      .join(", ");
  }
  if (Array.isArray(employee?.areas)) {
    return employee.areas
      .map((item) => String(item?.area_name || item?.name || item?.area_code || "").trim())
      .filter(Boolean)
      .join(", ");
  }
  return String(employee?.area_name || "").trim();
}

async function getEmployeeCheckinCheckout(req, res, next) {
  try {
    const { month, year } = parseMonthYear(req.query);
    const start = startOfMonth(year, month);
    const end = endOfMonth(year, month);

    const [employees, transactions] = await Promise.all([
      fetchEmployees(),
      fetchTransactions({ startTime: start, endTime: end }),
    ]);

    const { aliasToCanonical } = buildEmployeeAliasLookup(employees);
    const employeeIndex = new Map();
    for (const employee of employees || []) {
      const employeeId = getCanonicalEmployeeId(employee);
      if (!employeeId) continue;
      employeeIndex.set(employeeId, {
        employee_id: employeeId,
        employee_name: getEmployeeName(employee),
        department: getDepartmentName(employee),
        raw_details: employee,
        attendance: [],
      });
    }

    const punchGroups = groupPunchesByEmployeeDate(transactions, (transaction) => {
      const employeeId = resolveTransactionEmployeeKey(transaction, aliasToCanonical);
      if (!employeeId || !employeeIndex.has(employeeId)) return null;
      return employeeId;
    });
    const derivedByDate = buildDerivedCheckInOutByDate(punchGroups);

    const monthStart = formatDate(start);
    const monthEnd = formatDate(end);

    punchGroups.forEach((group) => {
      if (group.punch_date < monthStart || group.punch_date > monthEnd) return;

      const derived = derivedByDate.get(`${group.employeeKey}|${group.punch_date}`);
      if (!derived || !employeeIndex.has(group.employeeKey)) return;

      const wh = Number(derived.working_hours.toFixed(2));
      const entry = {
        date: group.punch_date,
        check_in: derived.check_in_raw,
        check_out: derived.check_out_raw,
        check_in_terminal: derived.check_in_terminal_alias || "",
        check_out_terminal: derived.check_out_terminal_alias || "",
        check_in_area: derived.check_in_area_alias || "",
        check_out_area: derived.check_out_area_alias || "",
        working_hours: formatHoursToHM(wh),
        working_hours_decimal: wh,
        punch_count: derived.punch_count,
        attendance_status: derived.punchAttendanceStatus,
      };
      employeeIndex.get(group.employeeKey).attendance.push(entry);
    });

    employeeIndex.forEach((row) => {
      row.attendance.sort((a, b) => (a.date < b.date ? -1 : 1));
    });

    res.json({
      month,
      year,
      total_employees: employeeIndex.size,
      total_transactions: transactions.length,
      rows: [...employeeIndex.values()],
    });
  } catch (error) {
    next(error);
  }
}

async function getLastReport(req, res, next) {
  try {
    const report = await stores.lastReport.read();
    res.json(report);
  } catch (error) {
    next(error);
  }
}

async function downloadReportExcel(req, res, next) {
  try {
    const rawName = String(req.params.filename || "").trim();
    const filename = path.basename(rawName);
    if (!filename || filename !== rawName) {
      const error = new Error("Invalid file name.");
      error.status = 400;
      throw error;
    }

    const outputPath = path.join(OUTPUT_DIR, filename);
    await fs.access(outputPath);
    return res.download(outputPath, filename);
  } catch (error) {
    if (error?.code === "ENOENT") {
      const notFound = new Error("Excel file not found.");
      notFound.status = 404;
      return next(notFound);
    }
    return next(error);
  }
}

module.exports = {
  generateReport,
  getLastReport,
  getEmployeeCheckinCheckout,
  downloadReportExcel,
};
