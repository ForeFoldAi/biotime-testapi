const { listMonthDates } = require("../utils/dateUtils");
const { formatHoursToHM } = require("../utils/formatHours");

function buildTabularReport(processedAttendance) {
  const { month, year, rows } = processedAttendance;
  const days = listMonthDates(year, month);

  const reportRows = rows.map((row) => {
    const dayColumns = {};
    for (const day of days) {
      dayColumns[String(day)] = row.daily[day] || "L";
    }

    const rawOt = row.totals.otHours;
    return {
      employee_id: row.employeeId,
      employee_name: row.employeeName,
      department: row.department,
      designation: row.designation || "",
      week_off: row.weekOff || "",
      present_days: row.totals.presentDays,
      ot_hours: formatHoursToHM(rawOt),
      ...dayColumns,
    };
  });

  return {
    month,
    year,
    generatedAt: processedAttendance.generatedAt,
    columns: [
      "employee_id",
      "employee_name",
      "department",
      "designation",
      "week_off",
      "present_days",
      "ot_hours",
      ...days.map(String),
    ],
    rows: reportRows,
  };
}

module.exports = {
  buildTabularReport,
};
