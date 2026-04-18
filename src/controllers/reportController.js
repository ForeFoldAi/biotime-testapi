const { fetchEmployees } = require("../services/employeeService");
const { fetchTransactions } = require("../services/transactionService");
const { processAttendance } = require("../processors/attendanceProcessor");
const { stores } = require("../storage");
const runtimeStore = require("../storage/runtimeStore");
const { buildTabularReport } = require("../reports/reportBuilder");
const { exportReportToExcel } = require("../reports/excelExporter");
const { startOfMonth, endOfMonth, formatDate, hoursBetween } = require("../utils/dateUtils");
const { formatHoursToHM } = require("../utils/formatHours");

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
    const shifts = runtimeStore.getShifts();
    const weekoffs = runtimeStore.getWeekoffs();
    const schedules = runtimeStore.getSchedules();

    const start = startOfMonth(year, month);
    const end = endOfMonth(year, month);

    const [employees, transactions] = await Promise.all([
      fetchEmployees(),
      fetchTransactions({ startTime: start, endTime: end }),
    ]);

    const processed = processAttendance({
      employees,
      transactions,
      month,
      year,
      shiftMaster: shifts,
      weekoffRows: weekoffs,
      scheduleRows: schedules,
    });

    const report = buildTabularReport(processed);
    const excel = await exportReportToExcel(report);
    await stores.lastReport.write(report);

    res.json({
      message: "Monthly report generated successfully",
      report,
      excel,
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

async function getEmployeeCheckinCheckout(req, res, next) {
  try {
    const { month, year } = parseMonthYear(req.query);
    const start = startOfMonth(year, month);
    const end = endOfMonth(year, month);

    const [employees, transactions] = await Promise.all([
      fetchEmployees(),
      fetchTransactions({ startTime: start, endTime: end }),
    ]);

    const employeeIndex = new Map();
    for (const employee of employees || []) {
      const employeeId = getEmployeeId(employee);
      if (!employeeId) continue;
      employeeIndex.set(employeeId, {
        employee_id: employeeId,
        employee_name: getEmployeeName(employee),
        department: getDepartmentName(employee),
        raw_details: employee,
        attendance: [],
      });
    }

    const grouped = new Map();
    for (const transaction of transactions || []) {
      const employeeId = getEmployeeId(transaction);
      const punchDateValue = getPunchDate(transaction);
      if (!employeeId || !punchDateValue || !employeeIndex.has(employeeId)) continue;

      const punchDate = new Date(punchDateValue);
      if (Number.isNaN(punchDate.getTime())) continue;

      const date = formatDate(punchDate);
      const key = `${employeeId}|${date}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          employee_id: employeeId,
          date,
          punches: [],
        });
      }
      grouped.get(key).punches.push({
        date: punchDate,
        raw: String(punchDateValue),
      });
    }

    grouped.forEach((item) => {
      const punches = item.punches.sort((a, b) => a.date - b.date);
      const checkIn = punches[0].date;
      const checkOut = punches[punches.length - 1].date;
      const wh = Number(hoursBetween(checkIn, checkOut).toFixed(2));
      const entry = {
        date: item.date,
        check_in: punches[0].raw,
        check_out: punches[punches.length - 1].raw,
        working_hours: formatHoursToHM(wh),
        working_hours_decimal: wh,
        punch_count: punches.length,
      };
      employeeIndex.get(item.employee_id).attendance.push(entry);
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

module.exports = {
  generateReport,
  getLastReport,
  getEmployeeCheckinCheckout,
};
