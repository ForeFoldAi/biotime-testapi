const multer = require("multer");
const { parseExcelBuffer } = require("../parsers/excelParser");
const { stores } = require("../storage");
const runtimeStore = require("../storage/runtimeStore");
const { normalizeHHMM, toMinutes } = require("../utils/shiftUtils");

const upload = multer({
  storage: multer.memoryStorage(),
});

function normalizeShiftRows(rows) {
  return rows.reduce((acc, row) => {
    const department = String(row.department || row.dept || "MEP").toUpperCase();
    const start = normalizeHHMM(row.start || row.start_time || "09:00");
    const end = normalizeHHMM(row.end || row.end_time || "18:00");
    const entry = {
      code: String(row.code || row.shift || "").toUpperCase(),
      start,
      end,
    };
    if (!entry.code) return acc;
    entry.overnight = toMinutes(entry.end) <= toMinutes(entry.start);
    if (!acc[department]) acc[department] = [];
    acc[department].push(entry);
    return acc;
  }, {});
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function remapRowsUsingFirstRowAsHeader(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const first = rows[0];
  const firstKeys = Object.keys(first);
  const hasGenericColumns = firstKeys.some((key) => key.startsWith("__empty"));
  if (!hasGenericColumns) return rows;

  const headerMap = {};
  firstKeys.forEach((key) => {
    headerMap[key] = normalizeHeader(first[key]);
  });

  const remapped = rows
    .slice(1)
    .map((row) => {
      const out = {};
      firstKeys.forEach((key) => {
        const target = headerMap[key];
        if (!target) return;
        out[target] = row[key];
      });
      return out;
    })
    .filter((row) => Object.values(row).some((value) => String(value || "").trim() !== ""));

  return remapped.length > 0 ? remapped : rows;
}

function normalizeUploadedRows(rawRows = []) {
  return remapRowsUsingFirstRowAsHeader(rawRows);
}

function isShiftExportRows(rows) {
  return rows.some((row) => row.shift_name && row.timetable);
}

function isTimetableExportRows(rows) {
  return rows.some((row) => row.name && (row.check_in || row["check-in"] || row.check_out || row["check-out"]));
}

function isEmployeeScheduleExportRows(rows) {
  return rows.some((row) => row.employee_id && row.shift_name && row.start_date);
}

async function uploadShifts(req, res, next) {
  try {
    const rows = normalizeUploadedRows(parseExcelBuffer(req.file.buffer));
    const responseMeta = { totalRows: rows.length };

    if (isShiftExportRows(rows)) {
      runtimeStore.setShiftExportRows(rows);
      responseMeta.shiftExportRows = rows.length;
    }

    const parsed = normalizeShiftRows(rows);
    if (Object.keys(parsed).length > 0) {
      runtimeStore.setShifts(parsed);
      await stores.shifts.write(parsed);
      responseMeta.departments = Object.keys(parsed);
    }

    res.json({
      message: "Shift data uploaded to in-memory store successfully",
      ...responseMeta,
    });
  } catch (error) {
    next(error);
  }
}

async function uploadWeekoffs(req, res, next) {
  try {
    const rows = normalizeUploadedRows(parseExcelBuffer(req.file.buffer));
    runtimeStore.setWeekoffs(rows);
    await stores.weekoffs.write(rows);
    res.json({
      message: "Weekly off master uploaded to in-memory store successfully",
      totalRows: rows.length,
    });
  } catch (error) {
    next(error);
  }
}

async function uploadSchedules(req, res, next) {
  try {
    const rows = normalizeUploadedRows(parseExcelBuffer(req.file.buffer));
    runtimeStore.setSchedules(rows);
    let taggedRows = 0;
    if (isEmployeeScheduleExportRows(rows)) {
      runtimeStore.setEmployeeScheduleExportRows(rows);
      taggedRows = rows.length;
    } else {
      runtimeStore.setEmployeeScheduleExportRows([]);
    }
    await stores.schedules.write(rows);
    res.json({
      message: "Employee shift schedule uploaded to in-memory store successfully",
      totalRows: rows.length,
      taggedRows,
    });
  } catch (error) {
    next(error);
  }
}

async function uploadTimetables(req, res, next) {
  try {
    const rows = normalizeUploadedRows(parseExcelBuffer(req.file.buffer));
    if (!isTimetableExportRows(rows)) {
      return res.status(400).json({
        message:
          "Invalid timetable file format. Expected columns like Name, Check-In, Check-Out.",
      });
    }

    runtimeStore.setTimetableExportRows(rows);
    res.json({
      message: "Timetable export uploaded to in-memory store successfully",
      totalRows: rows.length,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  upload,
  uploadSchedules,
  uploadShifts,
  uploadTimetables,
  uploadWeekoffs,
};
