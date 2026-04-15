const XLSX = require("xlsx");

function normalizeHeaders(row = {}) {
  return Object.entries(row).reduce((acc, [key, value]) => {
    const normalized = String(key).trim().toLowerCase().replace(/\s+/g, "_");
    acc[normalized] = value;
    return acc;
  }, {});
}

function parseExcel(filePath, sheetName) {
  const workbook = XLSX.readFile(filePath);
  const targetSheetName = sheetName || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[targetSheetName];
  if (!worksheet) return [];

  const raw = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
  return raw.map((row) => normalizeHeaders(row));
}

function parseExcelBuffer(buffer, sheetName) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const targetSheetName = sheetName || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[targetSheetName];
  if (!worksheet) return [];

  const raw = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
  return raw.map((row) => normalizeHeaders(row));
}

module.exports = {
  parseExcel,
  parseExcelBuffer,
};
