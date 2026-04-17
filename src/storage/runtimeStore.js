const { defaultShiftMaster } = require("../config/biotime");

const state = {
  shifts: JSON.parse(JSON.stringify(defaultShiftMaster)),
  weekoffs: [],
  schedules: [],
  shiftExportRows: [],
  timetableExportRows: [],
  employeeScheduleExportRows: [],
};

function getShifts() {
  return state.shifts;
}

function setShifts(value) {
  state.shifts = {
    ...JSON.parse(JSON.stringify(defaultShiftMaster)),
    ...(value || {}),
  };
}

function getWeekoffs() {
  return state.weekoffs;
}

function setWeekoffs(value) {
  state.weekoffs = Array.isArray(value) ? value : [];
}

function getSchedules() {
  return state.schedules;
}

function setSchedules(value) {
  state.schedules = Array.isArray(value) ? value : [];
}

function getShiftExportRows() {
  return state.shiftExportRows;
}

function setShiftExportRows(value) {
  state.shiftExportRows = Array.isArray(value) ? value : [];
}

function getTimetableExportRows() {
  return state.timetableExportRows;
}

function setTimetableExportRows(value) {
  state.timetableExportRows = Array.isArray(value) ? value : [];
}

function getEmployeeScheduleExportRows() {
  return state.employeeScheduleExportRows;
}

function setEmployeeScheduleExportRows(value) {
  state.employeeScheduleExportRows = Array.isArray(value) ? value : [];
}

async function hydrateFromPersistentStores(stores) {
  try {
    const [shifts, weekoffs, schedules] = await Promise.all([
      stores.shifts.read(),
      stores.weekoffs.read(),
      stores.schedules.read(),
    ]);
    if (shifts && Object.keys(shifts).length > 0) setShifts(shifts);
    if (Array.isArray(weekoffs)) setWeekoffs(weekoffs);
    if (Array.isArray(schedules)) setSchedules(schedules);
  } catch (error) {
    // Runtime store keeps defaults if persistence read fails.
  }
}

module.exports = {
  getEmployeeScheduleExportRows,
  getSchedules,
  getShiftExportRows,
  getShifts,
  getTimetableExportRows,
  getWeekoffs,
  hydrateFromPersistentStores,
  setEmployeeScheduleExportRows,
  setSchedules,
  setShiftExportRows,
  setShifts,
  setTimetableExportRows,
  setWeekoffs,
};
