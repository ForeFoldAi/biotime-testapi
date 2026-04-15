const path = require("path");
const XLSX = require("xlsx");
const { OUTPUT_DIR } = require("../config/env");
const { ensureDir } = require("../utils/fileUtils");

async function exportReportToExcel(report) {
  await ensureDir(OUTPUT_DIR);

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(report.rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Attendance");

  const filename = `attendance-report-${report.year}-${String(report.month).padStart(2, "0")}.xlsx`;
  const outputPath = path.join(OUTPUT_DIR, filename);
  XLSX.writeFile(workbook, outputPath);

  return { filename, outputPath };
}

module.exports = {
  exportReportToExcel,
};
