const path = require("path");
const XLSX = require("xlsx-js-style");
const { OUTPUT_DIR } = require("../config/env");
const { ensureDir } = require("../utils/fileUtils");
const { listMonthDates } = require("../utils/dateUtils");

const C = {
  dark_blue: "FF1F4E79",
  med_blue: "FF2E75B6",
  light_blue: "FFBDD7EE",
  present: "FFC6EFCE",
  weekoff: "FFFFEB9C",
  leave: "FFFFC7CE",
  partial: "FFDDEBF7",
  pubhol: "FFE2EFDA",
  ot_day: "FFFFF2CC",
  ot_row_bg: "FFFFFDE7",
  summ_bg: "FFD6DCE4",
  total_bg: "FFEBF3FB",
  dept_hdr: "FF2F5496",
  sun_hdr: "FFC00000",
  white: "FFFFFFFF",
  black: "FF000000",
  /** Duty / status code Y (distinct from leave; was uncolored before) */
  y_mark: "FFE8DAEF",
};

const COLUMNS = {
  FIXED: 4,
  SUMMARY: 6,
};

const FIXED_COLUMNS = [
  { width: 4, header: "S.No" },
  { width: 22, header: "Employee Name" },
  { width: 15, header: "Designation" },
  { width: 5, header: "W/D" },
];

const SUMMARY_COLUMNS = [
  { header: "Present", width: 7 },
  { header: "W/O", width: 4 },
  { header: "OT", width: 5 },
  { header: "PH", width: 4 },
  { header: "Total\nPresent", width: 8 },
  { header: "Total Man\ndays", width: 10 },
];

const DAY_ABBR = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTH_NAMES = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
];

const STATUS = {
  PRESENT: "P",
  PARTIAL: "PP",
  LEAVE: "L",
  WEEK_OFF: "W/O",
  PUB_HOL: "PH",
};

/** Green "present" fill and Present/Total Present counts: strict P only (incl. G[P]-style display). */
function isExcelStrictPresent(code, displayCode) {
  const c = String(code || "").trim().toUpperCase();
  if (c === STATUS.PRESENT) return true;
  const d = String(displayCode || "");
  return /\[P\]/.test(d);
}

function isExcelManDay(code) {
  const normalized = String(code || "").trim().toUpperCase();
  return (
    normalized === STATUS.PRESENT ||
    normalized === STATUS.PARTIAL ||
    ["G", "G8", "G9", "A", "B", "C", "A4", "C4", "A4C4", "C4A4"].includes(normalized)
  );
}

/** Late / early / combo markers live in display text (e.g. B[LC+EL], C4[EL]), not in base duty code. */
function displayHasPartialAttendance(displayCode) {
  return /\[(LC\+EL|LC|EL)\]/i.test(String(displayCode || ""));
}

function getFont(bold = false, size = 8, color = C.black) {
  return { name: "Arial", bold, sz: size, color: { rgb: color } };
}

function getAlignment(horizontal = "center", wrapText = false) {
  return { horizontal, vertical: "center", wrapText };
}

function getBorder() {
  const edge = { style: "thin", color: { rgb: "FFA0A0A0" } };
  return { top: edge, bottom: edge, left: edge, right: edge };
}

function getFill(color) {
  return { patternType: "solid", fgColor: { rgb: color } };
}

function styleOf({
  bold = false,
  size = 8,
  fgColor = C.black,
  bgColor = null,
  ha = "center",
  wrap = false,
} = {}) {
  const style = {
    font: getFont(bold, size, fgColor),
    alignment: getAlignment(ha, wrap),
    border: getBorder(),
  };
  if (bgColor) style.fill = getFill(bgColor);
  return style;
}

const STYLES = {
  titleLeft: styleOf({ bold: true, size: 14, fgColor: C.white, bgColor: C.dark_blue, ha: "left" }),
  titleRight: styleOf({ bold: true, size: 11, fgColor: C.white, bgColor: C.dark_blue, ha: "right" }),
  subtitle: styleOf({ bold: true, size: 10, fgColor: C.white, bgColor: C.med_blue }),
  hdrDark: styleOf({ bold: true, size: 8, fgColor: C.white, bgColor: C.dark_blue, wrap: true }),
  hdrSun: styleOf({ bold: true, size: 8, fgColor: C.white, bgColor: C.dark_blue, wrap: true }),
  hdrDayDark: styleOf({ bold: true, size: 7, fgColor: C.white, bgColor: C.dark_blue }),
  hdrDaySun: styleOf({ bold: true, size: 7, fgColor: C.white, bgColor: C.dark_blue }),
  deptBand: styleOf({ bold: true, size: 8, fgColor: C.white, bgColor: C.dept_hdr, ha: "left" }),
  cellCenter: styleOf({ size: 8 }),
  cellLeft: styleOf({ size: 8, ha: "left" }),
  cellLeftSmall: styleOf({ size: 7, ha: "left" }),
  otSubBase: styleOf({ size: 7, bgColor: C.ot_row_bg }),
  summRow: styleOf({ bold: true, size: 7, bgColor: C.summ_bg }),
  totalCell: styleOf({ bold: true, size: 8, bgColor: C.light_blue }),
};

function sanitizeSheetName(name, usedNames) {
  const normalized = String(name || "UNASSIGNED")
    .replace(/[\\/*?:[\]]/g, " ")
    .trim()
    .slice(0, 31);
  let candidate = normalized || "UNASSIGNED";
  let i = 1;
  while (usedNames.has(candidate)) {
    const suffix = `-${i}`;
    candidate = `${(normalized || "UNASSIGNED").slice(0, 31 - suffix.length)}${suffix}`;
    i += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function setCell(ws, row, col, value, style) {
  const addr = XLSX.utils.encode_cell({ r: row, c: col });
  ws[addr] = {
    v: value ?? "",
    t: typeof value === "number" ? "n" : "s",
    s: style || undefined,
  };
  if (!ws["!ref"]) {
    ws["!ref"] = `${addr}:${addr}`;
    return;
  }
  const range = XLSX.utils.decode_range(ws["!ref"]);
  if (row < range.s.r) range.s.r = row;
  if (col < range.s.c) range.s.c = col;
  if (row > range.e.r) range.e.r = row;
  if (col > range.e.c) range.e.c = col;
  ws["!ref"] = XLSX.utils.encode_range(range);
}

function addMerge(merges, r1, c1, r2, c2) {
  merges.push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });
}

function formatDepartmentDisplayName(department) {
  const raw = String(department || "").trim();
  const upper = raw.toUpperCase();
  if (!upper) return "UNASSIGNED";
  if (upper === "HOUSEKEEPING") return "House Keeping";
  if (upper === "LANDSCAPE") return "Gardners";
  if (upper === "DEPARTMENTSPARE" || upper === "DEPARTMENT - SPARE") return "Department - Spare";
  return raw
    .toLowerCase()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function groupByDepartment(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const department = String(row.department || "UNASSIGNED").toUpperCase();
    if (!map.has(department)) map.set(department, []);
    map.get(department).push(row);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function sortDepartmentRows(rows) {
  return [...rows].sort((a, b) => {
    const da = String(a.designation || "").toUpperCase();
    const db = String(b.designation || "").toUpperCase();
    if (da !== db) return da.localeCompare(db);
    return String(a.employeeName || "").localeCompare(String(b.employeeName || ""));
  });
}

function getStatusBackgroundColor(statusCode, hasOt = false, isOTRow = false, displayCode = "") {
  if (isOTRow) return hasOt ? C.ot_day : C.ot_row_bg;
  const normalized = String(statusCode || "").toUpperCase();
  const display = String(displayCode || "");
  if (normalized === STATUS.PUB_HOL) return C.pubhol;
  if (normalized === STATUS.WEEK_OFF || normalized === "WO") return C.weekoff;
  if (normalized === STATUS.LEAVE || normalized === "EL") return C.leave;
  if (normalized === STATUS.PARTIAL || normalized === "LC" || normalized === "LC+EL") return C.partial;
  if (displayHasPartialAttendance(display)) return C.partial;
  if (normalized === "Y" || display.trim().toUpperCase() === "Y") return C.y_mark;
  if (hasOt && normalized && normalized !== STATUS.LEAVE && normalized !== STATUS.WEEK_OFF && normalized !== "WO") {
    return C.ot_day;
  }
  if (isExcelStrictPresent(statusCode, displayCode)) return C.present;
  return null;
}

function setColumnWidths(ws, numDays) {
  ws["!cols"] = [
    ...FIXED_COLUMNS.map((col) => ({ wch: col.width })),
    ...Array.from({ length: numDays }, () => ({ wch: 3.8 })),
    ...SUMMARY_COLUMNS.map((col) => ({ wch: col.width }),
    ),
  ];
}

function initRowsMeta() {
  const rows = [];
  rows[0] = { hpt: 24 };
  rows[1] = { hpt: 18 };
  rows[2] = { hpt: 16 };
  rows[3] = { hpt: 14 };
  return rows;
}

function buildHeaders(ws, merges, context) {
  const { month, year, numDays, totalColumns, departmentName } = context;
  const monthName = MONTH_NAMES[Math.max(0, Math.min(11, month - 1))];
  const lastCol = totalColumns - 1;
  const splitCol = Math.floor(totalColumns / 2);

  addMerge(merges, 0, 0, 0, splitCol);
  addMerge(merges, 0, splitCol + 1, 0, lastCol);
  addMerge(merges, 1, 0, 1, lastCol);

  setCell(ws, 0, 0, "AU INFOCITY", STYLES.titleLeft);
  setCell(ws, 0, splitCol + 1, "Powered by forefoldai.com", STYLES.titleRight);
  for (let c = 1; c <= splitCol; c += 1) setCell(ws, 0, c, "", STYLES.titleLeft);
  for (let c = splitCol + 2; c <= lastCol; c += 1) setCell(ws, 0, c, "", STYLES.titleRight);

  const title = `CYBER TOWERS  —  ${departmentName}  —  ATTENDANCE FOR THE MONTH OF ${monthName} ${year}`;
  setCell(ws, 1, 0, title, STYLES.subtitle);
  for (let c = 1; c <= lastCol; c += 1) setCell(ws, 1, c, "", STYLES.subtitle);

  // fixed headers
  for (let i = 0; i < FIXED_COLUMNS.length; i += 1) {
    addMerge(merges, 2, i, 3, i);
    setCell(ws, 2, i, FIXED_COLUMNS[i].header, STYLES.hdrDark);
    setCell(ws, 3, i, "", STYLES.hdrDark);
  }

  // day headers
  for (let i = 0; i < numDays; i += 1) {
    const col = COLUMNS.FIXED + i;
    const dt = new Date(year, month - 1, i + 1);
    const isSunday = dt.getDay() === 0;
    setCell(ws, 2, col, i + 1, isSunday ? STYLES.hdrSun : STYLES.hdrDark);
    setCell(ws, 3, col, DAY_ABBR[dt.getDay()], isSunday ? STYLES.hdrDaySun : STYLES.hdrDayDark);
  }

  // summary headers
  const summaryStart = COLUMNS.FIXED + numDays;
  for (let i = 0; i < SUMMARY_COLUMNS.length; i += 1) {
    const col = summaryStart + i;
    addMerge(merges, 2, col, 3, col);
    setCell(ws, 2, col, SUMMARY_COLUMNS[i].header, STYLES.hdrDark);
    setCell(ws, 3, col, "", STYLES.hdrDark);
  }
}

function summarizeRow(row, days, year, month) {
  const out = { present: 0, wo: 0, ot: 0, ph: 0, totalPresent: 0, totalManDays: 0 };
  for (const day of days) {
    const code = String(row.daily?.[day] || "").toUpperCase();
    const display = String(row.dailyDisplay?.[day] || row.daily?.[day] || "");
    const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayOt = Number(row.dailyOt?.[day] || row.otHours?.[dateKey] || 0);
    const isStrictP = isExcelStrictPresent(code, display);
    const isManDay = isExcelManDay(code);
    const isWeekoff = code === STATUS.WEEK_OFF || code === "WO";
    const isPh = code === STATUS.PUB_HOL;
    if (isStrictP) out.present += 1;
    if (isWeekoff) out.wo += 1;
    if (isPh) out.ph += 1;
    if (dayOt > 0) out.ot += 1;
    if (isStrictP) out.totalPresent += 1;
    if (isManDay) out.totalManDays += 1;
  }
  return out;
}

function buildDepartmentSheet(processedReport, department, rows) {
  const days = listMonthDates(processedReport.year, processedReport.month);
  const numDays = days.length;
  const totalColumns = COLUMNS.FIXED + numDays + COLUMNS.SUMMARY;
  const ws = XLSX.utils.aoa_to_sheet([]);
  const merges = [];
  const rowsMeta = initRowsMeta();

  setColumnWidths(ws, numDays);
  buildHeaders(ws, merges, {
    month: Number(processedReport.month),
    year: Number(processedReport.year),
    numDays,
    totalColumns,
    departmentName: formatDepartmentDisplayName(department),
  });

  const perDayTotals = Array.from({ length: numDays }, () => ({
    present: 0,
    wo: 0,
    ot: 0,
    ph: 0,
    totalPresent: 0,
    totalManDays: 0,
  }));

  const deptTotals = {
    present: 0,
    wo: 0,
    ot: 0,
    ph: 0,
    totalPresent: 0,
    totalManDays: 0,
  };

  let currentRow = 4; // excel row 5
  let serial = 1;
  let prevDesignation = null;
  const sortedRows = sortDepartmentRows(rows);

  for (const row of sortedRows) {
    const designation = String(row.designation || "—");
    if (designation !== prevDesignation) {
      addMerge(merges, currentRow, 0, currentRow, totalColumns - 1);
      setCell(ws, currentRow, 0, `  ${designation}`, STYLES.deptBand);
      for (let c = 1; c < totalColumns; c += 1) setCell(ws, currentRow, c, "", STYLES.deptBand);
      rowsMeta[currentRow] = { hpt: 13 };
      currentRow += 1;
      prevDesignation = designation;
    }

    const mainRow = currentRow;
    const otRow = currentRow + 1;
    rowsMeta[mainRow] = { hpt: 14 };
    rowsMeta[otRow] = { hpt: 11 };

    // fixed columns merged on 2 rows
    for (const colIdx of [0, 1, 2, 3]) addMerge(merges, mainRow, colIdx, otRow, colIdx);
    setCell(ws, mainRow, 0, serial, STYLES.cellCenter);
    setCell(ws, mainRow, 1, row.employeeName || "", STYLES.cellLeft);
    setCell(ws, mainRow, 2, row.designation || "", STYLES.cellLeftSmall);
    setCell(ws, mainRow, 3, row.weekOff || "—", STYLES.cellCenter);
    setCell(ws, otRow, 0, "", STYLES.otSubBase);
    setCell(ws, otRow, 1, "", STYLES.otSubBase);
    setCell(ws, otRow, 2, "", STYLES.otSubBase);
    setCell(ws, otRow, 3, "", STYLES.otSubBase);

    const summary = summarizeRow(row, days, processedReport.year, processedReport.month);

    // day cells
    days.forEach((day, dayIdx) => {
      const col = COLUMNS.FIXED + dayIdx;
      const code = String(row.daily?.[day] || "L");
      const displayCode = String(row.dailyDisplay?.[day] || code);
      const dayOt = Number(row.dailyOt?.[day] || 0);
      const fillMain = getStatusBackgroundColor(code, dayOt > 0, false, displayCode);
      const fillOt = getStatusBackgroundColor(code, dayOt > 0, true, displayCode);
      setCell(
        ws,
        mainRow,
        col,
        displayCode,
        fillMain ? styleOf({ size: 7, bgColor: fillMain }) : styleOf({ size: 7 })
      );
      setCell(
        ws,
        otRow,
        col,
        dayOt > 0 ? Math.round(dayOt) : "",
        styleOf({ size: 7, bgColor: fillOt })
      );

      const normalized = code.toUpperCase();
      const isStrictP = isExcelStrictPresent(code, displayCode);
      const isManDay = isExcelManDay(code);
      const isWeekoff = normalized === STATUS.WEEK_OFF || normalized === "WO";
      const isPh = normalized === STATUS.PUB_HOL;
      if (isStrictP) perDayTotals[dayIdx].present += 1;
      if (isWeekoff) perDayTotals[dayIdx].wo += 1;
      if (isPh) perDayTotals[dayIdx].ph += 1;
      if (dayOt > 0) perDayTotals[dayIdx].ot += 1;
      if (isStrictP) perDayTotals[dayIdx].totalPresent += 1;
      if (isManDay) perDayTotals[dayIdx].totalManDays += 1;
    });

    // summary columns
    const summaryValues = [
      summary.present,
      summary.wo,
      summary.ot,
      summary.ph,
      summary.totalPresent,
      summary.totalManDays,
    ];
    const summaryStart = COLUMNS.FIXED + numDays;
    const roundedTotalOtHours = Math.round(
      Object.values(row.dailyOt || {}).reduce((sum, v) => sum + Number(v || 0), 0)
    );
    summaryValues.forEach((value, idx) => {
      setCell(ws, mainRow, summaryStart + idx, value || 0, styleOf({ bold: true, size: 8, bgColor: C.total_bg }));
      if (idx === 2) {
        setCell(
          ws,
          otRow,
          summaryStart + idx,
          roundedTotalOtHours > 0 ? roundedTotalOtHours : "",
          styleOf({ bold: true, size: 7, bgColor: roundedTotalOtHours > 0 ? C.ot_day : C.ot_row_bg })
        );
      } else {
        setCell(ws, otRow, summaryStart + idx, "", STYLES.otSubBase);
      }
    });

    deptTotals.present += summary.present;
    deptTotals.wo += summary.wo;
    deptTotals.ot += summary.ot;
    deptTotals.ph += summary.ph;
    deptTotals.totalPresent += summary.totalPresent;
    deptTotals.totalManDays += summary.totalManDays;

    currentRow += 2;
    serial += 1;
  }

  // Department summary rows
  const summaryKeys = ["present", "wo", "ot", "ph", "totalPresent", "totalManDays"];
  const summaryLabels = ["Present", "W/O", "OT", "PH", "Total Present", "Total Man days"];
  const summaryStart = COLUMNS.FIXED + numDays;
  for (let i = 0; i < summaryKeys.length; i += 1) {
    const key = summaryKeys[i];
    const label = summaryLabels[i];
    rowsMeta[currentRow] = { hpt: 13 };
    addMerge(merges, currentRow, 0, currentRow, COLUMNS.FIXED - 1);
    setCell(ws, currentRow, 0, label, STYLES.summRow);
    for (let c = 1; c < COLUMNS.FIXED; c += 1) setCell(ws, currentRow, c, "", STYLES.summRow);

    for (let dayIdx = 0; dayIdx < numDays; dayIdx += 1) {
      const value = perDayTotals[dayIdx][key] || "";
      setCell(ws, currentRow, COLUMNS.FIXED + dayIdx, value, STYLES.summRow);
    }

    for (let j = 0; j < COLUMNS.SUMMARY; j += 1) {
      setCell(ws, currentRow, summaryStart + j, "", STYLES.summRow);
    }
    setCell(ws, currentRow, summaryStart + i, deptTotals[key] || 0, STYLES.totalCell);
    currentRow += 1;
  }

  ws["!rows"] = rowsMeta;
  ws["!merges"] = merges;
  ws["!freeze"] = { xSplit: 4, ySplit: 4, topLeftCell: "E5", activePane: "bottomRight", state: "frozen" };
  return ws;
}

async function exportReportToExcel(processedReport) {
  await ensureDir(OUTPUT_DIR);

  const workbook = XLSX.utils.book_new();
  const departmentGroups = groupByDepartment(processedReport.rows || []);
  const usedNames = new Set();

  if (departmentGroups.length === 0) {
    const emptySheet = XLSX.utils.aoa_to_sheet([["No report rows available"]]);
    XLSX.utils.book_append_sheet(workbook, emptySheet, "Attendance");
  } else {
    for (const [department, rows] of departmentGroups) {
      const ws = buildDepartmentSheet(processedReport, department, rows);
      const sheetName = sanitizeSheetName(formatDepartmentDisplayName(department), usedNames);
      XLSX.utils.book_append_sheet(workbook, ws, sheetName);
    }
  }

  const filename = `attendance-report-${processedReport.year}-${String(processedReport.month).padStart(2, "0")}.xlsx`;
  const outputPath = path.join(OUTPUT_DIR, filename);
  XLSX.writeFile(workbook, outputPath);
  return { filename, outputPath };
}

module.exports = {
  exportReportToExcel,
  C,
  COLUMNS,
  DAY_ABBR,
  FIXED_COLUMNS,
  SUMMARY_COLUMNS,
  STATUS,
};
