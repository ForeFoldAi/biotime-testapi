const path = require("path");
const { STORAGE_DIR } = require("../config/env");
const { defaultShiftMaster } = require("../config/biotime");
const StorageModel = require("../models/storageModel");
const { ensureDir, ensureJsonFile } = require("../utils/fileUtils");

const files = {
  shifts: path.join(STORAGE_DIR, "shifts.json"),
  weekoffs: path.join(STORAGE_DIR, "weekoffs.json"),
  schedules: path.join(STORAGE_DIR, "schedules.json"),
  shiftExportRows: path.join(STORAGE_DIR, "shiftExportRows.json"),
  timetableExportRows: path.join(STORAGE_DIR, "timetableExportRows.json"),
  employeeManagement: path.join(STORAGE_DIR, "employeeManagement.json"),
  lastReport: path.join(STORAGE_DIR, "lastReport.json"),
};

const stores = {
  shifts: new StorageModel(files.shifts, defaultShiftMaster),
  weekoffs: new StorageModel(files.weekoffs, []),
  schedules: new StorageModel(files.schedules, []),
  shiftExportRows: new StorageModel(files.shiftExportRows, []),
  timetableExportRows: new StorageModel(files.timetableExportRows, []),
  employeeManagement: new StorageModel(files.employeeManagement, { rows: [], updatedAt: null }),
  lastReport: new StorageModel(files.lastReport, { rows: [], generatedAt: null }),
};

async function initializeStorage() {
  await ensureDir(STORAGE_DIR);
  await ensureJsonFile(files.shifts, defaultShiftMaster);
  await ensureJsonFile(files.weekoffs, []);
  await ensureJsonFile(files.schedules, []);
  await ensureJsonFile(files.shiftExportRows, []);
  await ensureJsonFile(files.timetableExportRows, []);
  await ensureJsonFile(files.employeeManagement, { rows: [], updatedAt: null });
  await ensureJsonFile(files.lastReport, { rows: [], generatedAt: null });
}

module.exports = {
  files,
  initializeStorage,
  stores,
};
