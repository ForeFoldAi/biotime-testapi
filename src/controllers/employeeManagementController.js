const fs = require("fs/promises");
const { fetchEmployees } = require("../services/employeeService");
const runtimeStore = require("../storage/runtimeStore");
const { stores } = require("../storage");
const { getEmployeeWeekOff } = require("../utils/weekOffUtils");

function toText(value) {
  return String(value || "").trim();
}

function normalizeEmployeeId(value) {
  return toText(value).toUpperCase();
}

function getEmployeeId(entity) {
  return toText(
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
  const fullName = [employee?.first_name, employee?.last_name].filter(Boolean).join(" ").trim();
  return toText(employee?.name || employee?.full_name || fullName || employee?.emp_name || "");
}

function getDepartmentName(employee) {
  return toText(
    employee?.department_name ||
      employee?.department?.dept_name ||
      employee?.department?.name ||
      employee?.department ||
      "UNASSIGNED"
  );
}

function getAreaName(employee) {
  if (Array.isArray(employee?.area)) {
    return employee.area
      .map((item) => toText(item?.area_name || item?.name || item?.area_code || ""))
      .filter(Boolean)
      .join(", ");
  }
  if (Array.isArray(employee?.areas)) {
    return employee.areas
      .map((item) => toText(item?.area_name || item?.name || item?.area_code || ""))
      .filter(Boolean)
      .join(", ");
  }
  return toText(employee?.area_name || "");
}

function toDateMillis(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function buildShiftDetailsMap() {
  const scheduleRows =
    runtimeStore.getEmployeeScheduleExportRows().length > 0
      ? runtimeStore.getEmployeeScheduleExportRows()
      : runtimeStore.getSchedules();

  const byEmployee = new Map();
  for (const row of scheduleRows) {
    const employeeId = normalizeEmployeeId(
      row?.employee_id || row?.emp_code || row?.employee_code || row?.id || ""
    );
    const shiftDetails = toText(row?.shift_name || row?.shift || row?.shift_code || "");
    if (!employeeId || !shiftDetails) continue;

    const rankDate =
      toDateMillis(row?.start_date) ||
      toDateMillis(row?.date) ||
      toDateMillis(row?.duty_date) ||
      0;
    const existing = byEmployee.get(employeeId);
    if (!existing || rankDate >= existing.rankDate) {
      byEmployee.set(employeeId, { shiftDetails, rankDate });
    }
  }

  const result = new Map();
  byEmployee.forEach((value, key) => result.set(key, value.shiftDetails));
  return result;
}

function buildTimetableMapByShiftDetails() {
  const shiftRows = runtimeStore.getShiftExportRows();
  const timetableRows = runtimeStore.getTimetableExportRows();

  const shiftToTimetableName = new Map();
  for (const row of shiftRows) {
    const shiftName = toText(row?.shift_name || "");
    const timetableName = toText(row?.timetable || "");
    if (!shiftName) continue;
    shiftToTimetableName.set(shiftName, timetableName || shiftName);
  }

  const timetableNameToRange = new Map();
  for (const row of timetableRows) {
    const name = toText(row?.name || "");
    const checkIn = toText(row?.["check-in"] || row?.check_in || "");
    const checkOut = toText(row?.["check-out"] || row?.check_out || "");
    if (!name) continue;
    timetableNameToRange.set(name, checkIn || checkOut ? `${checkIn} - ${checkOut}` : "");
  }

  const result = new Map();
  shiftToTimetableName.forEach((timetableName, shiftName) => {
    result.set(shiftName, timetableNameToRange.get(timetableName) || "");
  });
  return result;
}

function getUniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

async function lockFileAfterWrite(filePath) {
  try {
    await fs.chmod(filePath, 0o400);
  } catch (error) {
    // Best effort. Some file systems may not support chmod.
  }
}

async function unlockFileBeforeWrite(filePath) {
  try {
    await fs.chmod(filePath, 0o600);
  } catch (error) {
    // Best effort.
  }
}

async function getEmployeeManagementData(req, res, next) {
  try {
    const employees = await fetchEmployees({ allPages: true, maxPages: 200 });
    const shiftDetailsByEmployee = buildShiftDetailsMap();
    const timetableByShiftDetails = buildTimetableMapByShiftDetails();

    const rows = employees
      .map((employee) => {
        const employeeId = getEmployeeId(employee);
        if (!employeeId) return null;

        const normalizedEmployeeId = normalizeEmployeeId(employeeId);
        const shiftDetails = shiftDetailsByEmployee.get(normalizedEmployeeId) || "";
        const shiftTimetable = timetableByShiftDetails.get(shiftDetails) || "";
        const weekOff = getEmployeeWeekOff(employee);
        const department = getDepartmentName(employee) || "UNASSIGNED";

        return {
          employee_id: employeeId,
          employee_name: getEmployeeName(employee) || `EMP-${employeeId}`,
          area: getAreaName(employee) || "UNASSIGNED",
          department,
          shift_details: shiftDetails,
          shift_timetable: shiftTimetable,
          week_off: weekOff,
        };
      })
      .filter(Boolean)
      .sort((a, b) => String(a.employee_id).localeCompare(String(b.employee_id)));

    return res.json({
      total: rows.length,
      filters: {
        areas: getUniqueSorted(rows.map((row) => row.area)),
        departments: getUniqueSorted(rows.map((row) => row.department)),
        shift_details: getUniqueSorted(rows.map((row) => row.shift_details)),
      },
      rows,
    });
  } catch (error) {
    return next(error);
  }
}

async function saveEmployeeManagementData(req, res, next) {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const normalizedRows = rows
      .map((row) => {
        const employeeId = normalizeEmployeeId(row?.employee_id || "");
        const weekOff = getEmployeeWeekOff(row);
        if (!employeeId || !weekOff) return null;
        return { employee_id: employeeId, week_off: weekOff };
      })
      .filter(Boolean);

    const payload = {
      rows: normalizedRows,
      updatedAt: new Date().toISOString(),
    };

    await unlockFileBeforeWrite(stores.employeeManagement.filePath);
    await stores.employeeManagement.write(payload);
    await lockFileAfterWrite(stores.employeeManagement.filePath);

    return res.json({
      message: "Employee management changes saved locally.",
      totalRows: normalizedRows.length,
      filePath: stores.employeeManagement.filePath,
      readOnly: true,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getEmployeeManagementData,
  saveEmployeeManagementData,
};
