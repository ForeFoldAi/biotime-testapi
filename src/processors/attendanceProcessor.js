const { applyRuleForDepartment } = require("../engines/ruleDispatcher");
const {
  addDays,
  endOfMonth,
  formatDate,
  hoursBetween,
  isFutureDate,
  listMonthDates,
  startOfMonth,
} = require("../utils/dateUtils");

const FUTURE_DAY_MARK = "-";
const {
  classifyDepartment,
  inferTransactionShiftCodes,
} = require("../utils/shiftUtils");
const {
  buildDerivedCheckInOutByDate,
  groupPunchesByEmployeeDate,
  parseDerivedMapKey,
  toDateTimeFromParts,
} = require("../utils/punchGrouping");
const {
  buildEmployeeAliasLookup,
  getCanonicalEmployeeId,
  resolveTransactionEmployeeKey,
} = require("../utils/transactionEmployeeUtils");

const WEEKDAY_NAMES = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

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

function getReportDepartmentName(rawDepartmentName) {
  const raw = String(rawDepartmentName || "").trim();
  const compact = raw.toUpperCase().replace(/[^A-Z]/g, "");
  if (compact.includes("PEST")) return "PEST CONTROL";
  if (compact.includes("LANDSCAPE") || compact.includes("GARDEN") || compact.includes("GARD")) return "LANDSCAPE";
  return classifyDepartment(raw);
}

function getDesignation(employee) {
  const value =
    employee?.position_name ||
    employee?.designation?.position_name ||
    employee?.designation?.name ||
    employee?.designation?.title ||
    employee?.position?.position_name ||
    employee?.position?.name ||
    employee?.position ||
    employee?.designation ||
    employee?.title ||
    employee?.job_title ||
    "";

  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    return String(
      value.position_name || value.name || value.title || value.job_title || ""
    ).trim();
  }
  return String(value || "").trim();
}

function getPunchDate(transaction) {
  return (
    transaction?.punch_time ||
    transaction?.timestamp ||
    transaction?.transaction_time ||
    transaction?.punch_datetime
  );
}

function normalizeWeekoffRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const employeeId = String(row.employee_id || row.emp_code || row.id || "");
    if (!employeeId) continue;
    const day = String(row.week_off || row.weekly_off || row.day || "").toUpperCase();
    if (!day) continue;
    map.set(employeeId, day);
  }
  return map;
}

function normalizeScheduleRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const employeeId = String(row.employee_id || row.emp_code || row.id || "");
    const date = row.date || row.duty_date;
    const shift = String(row.shift || row.shift_code || "").toUpperCase();
    if (!employeeId || !date || !shift) continue;
    map.set(`${employeeId}|${date}`, shift);
  }
  return map;
}

function createEmployeeIndex(employees = []) {
  const index = new Map();
  for (const employee of employees) {
    const employeeId = getCanonicalEmployeeId(employee);
    if (!employeeId) continue;
    const rawDepartmentName = getDepartmentName(employee);
    index.set(employeeId, {
      employeeId,
      name: getEmployeeName(employee),
      department: classifyDepartment(rawDepartmentName),
      reportDepartment: getReportDepartmentName(rawDepartmentName),
      designation: getDesignation(employee),
    });
  }
  return index;
}

function getShiftDefinitionsForDepartment(shiftMaster, department) {
  if (department === "DRIVER" && Array.isArray(shiftMaster.SECURITY) && shiftMaster.SECURITY.length > 0) {
    return shiftMaster.SECURITY;
  }
  return shiftMaster[department] || shiftMaster.MEP || [];
}

function collectDerivedSessionsForDate(derivedByDate, employeeKey, punchDate) {
  const baseKey = `${employeeKey}|${punchDate}`;
  const sessions = [];
  const primary = derivedByDate.get(baseKey);
  if (primary) sessions.push(primary);

  let sessionIndex = 2;
  while (derivedByDate.has(`${baseKey}#${sessionIndex}`)) {
    sessions.push(derivedByDate.get(`${baseKey}#${sessionIndex}`));
    sessionIndex += 1;
  }

  return sessions.sort((left, right) => (left.session_index || 1) - (right.session_index || 1));
}

function consolidateDerivedSessions(sessions) {
  if (!sessions.length) return null;
  if (sessions.length === 1) return sessions[0];

  const first = sessions[0];
  const last = sessions[sessions.length - 1];
  const working_hours = sessions.reduce((sum, session) => sum + Number(session.working_hours || 0), 0);
  const punch_count = sessions.reduce((sum, session) => sum + Number(session.punch_count || 0), 0);
  const effective_punch_count = sessions.reduce(
    (sum, session) => sum + Number(session.effective_punch_count || session.punch_count || 0),
    0
  );

  return {
    ...first,
    check_out: last.check_out,
    check_out_raw: last.check_out_raw,
    check_out_terminal_alias: last.check_out_terminal_alias,
    check_out_area_alias: last.check_out_area_alias,
    check_out_date: last.check_out_date,
    checkOut: last.checkOut,
    working_hours,
    punch_count,
    effective_punch_count,
    session_count: sessions.length,
    session_index: 1,
    resolution: "multi_session_consolidated",
  };
}

function mergeAttendanceStatuses(statuses) {
  const normalized = statuses.map((status) => String(status || "P").toUpperCase()).filter(Boolean);
  if (!normalized.length) return "P";
  if (normalized.every((status) => status === "P")) return "P";
  if (normalized.includes("LC+EL")) return "LC+EL";
  if (normalized.includes("LC") && normalized.includes("EL")) return "LC+EL";
  if (normalized.includes("LC")) return "LC";
  if (normalized.includes("EL")) return "EL";
  return normalized[normalized.length - 1];
}

function mergeSecurityDayRules(sessionResults) {
  if (!sessionResults.length) {
    return { code: "L", dutyShift: "L", attendanceStatus: "L", otHours: 0, otStatus: "NO" };
  }
  if (sessionResults.length === 1) return sessionResults[0];

  const last = sessionResults[sessionResults.length - 1];
  const dutyCodes = sessionResults.map((result) => String(result.dutyShift || result.code || "").toUpperCase());
  let dutyShift = String(last.dutyShift || last.code || "L");

  if (dutyCodes.includes("A4C4") || dutyCodes.includes("C4A4")) {
    dutyShift = dutyCodes.find((code) => code === "A4C4" || code === "C4A4") || dutyShift;
  } else if (dutyCodes.includes("A4") && dutyCodes.includes("C4")) {
    dutyShift = "A4C4";
  } else if (dutyCodes.includes("C4") && dutyCodes.includes("A4")) {
    dutyShift = "C4A4";
  }

  const otHours = sessionResults.reduce((sum, result) => sum + Number(result.otHours || result.ot_hours || 0), 0);
  const compositeDuty = new Set(["A4C4", "C4A4"]);
  const attendanceStatus = compositeDuty.has(dutyShift)
    ? String(last.attendanceStatus || last.attendance_status || "P").toUpperCase()
    : mergeAttendanceStatuses(
        sessionResults.map((result) => result.attendanceStatus || result.attendance_status)
      );

  return {
    ...last,
    dutyShift,
    code: dutyShift,
    shift_code: dutyShift,
    normalShiftCode: dutyShift.startsWith("A4") ? "A4" : dutyShift.startsWith("C4") ? "C4" : last.normalShiftCode || "",
    otShiftCode: dutyShift === "A4C4" ? "C4" : dutyShift === "C4A4" ? "A4" : last.otShiftCode || "",
    otHours,
    ot_hours: otHours,
    otStatus: otHours > 0 ? "YES" : last.otStatus || "NO",
    ot_status: otHours > 0 ? "YES" : last.ot_status || "NO",
    attendanceStatus,
    attendance_status: attendanceStatus,
  };
}

function mergeMepDayRules(sessionResults) {
  if (!sessionResults.length) {
    return { code: "L", dutyShift: "L", attendanceStatus: "L", otHours: 0, otStatus: "NO" };
  }
  if (sessionResults.length === 1) return sessionResults[0];

  const last = sessionResults[sessionResults.length - 1];
  const dutyCodes = sessionResults.map((result) => String(result.dutyShift || result.code || "").toUpperCase());
  let dutyShift = dutyCodes.find((code) => code.length > 1) || String(last.dutyShift || last.code || "L");

  if (dutyCodes.includes("BC") || (dutyCodes.includes("B") && dutyCodes.includes("C"))) {
    dutyShift = "BC";
  } else if (dutyCodes.includes("AB") || (dutyCodes.includes("A") && dutyCodes.includes("B"))) {
    dutyShift = "AB";
  } else if (dutyCodes.includes("CA") || (dutyCodes.includes("C") && dutyCodes.includes("A"))) {
    dutyShift = "CA";
  }

  const otHours = sessionResults.reduce((sum, result) => sum + Number(result.otHours || result.ot_hours || 0), 0);
  const compositeDuty = new Set(["AB", "BC", "CA"]);
  const first = sessionResults[0];
  const attendanceStatus = compositeDuty.has(dutyShift)
    ? String(first.attendanceStatus || first.attendance_status || "P").toUpperCase()
    : mergeAttendanceStatuses(
        sessionResults.map((result) => result.attendanceStatus || result.attendance_status)
      );

  return {
    ...last,
    dutyShift,
    code: dutyShift,
    shift_code: dutyShift,
    normalShiftCode: dutyShift[0] || last.normalShiftCode || "",
    otShiftCode: otHours > 0 ? dutyShift[1] || last.otShiftCode || "C" : "",
    otHours,
    ot_hours: otHours,
    otStatus: otHours > 0 ? "YES" : last.otStatus || "NO",
    ot_status: otHours > 0 ? "YES" : last.ot_status || "NO",
    attendanceStatus,
    attendance_status: attendanceStatus,
  };
}

function collectSessionRuleResults(department, grouped, shiftDefinitions, scheduleShift) {
  const priorShifts = [];
  const sessionResults = [];

  for (const sessionDerived of grouped.derivedSessions || []) {
    const result = applyRuleForDepartment(department, {
      employeeId: grouped.employeeId,
      date: grouped.businessDate,
      checkIn: sessionDerived.checkIn ?? null,
      checkOut: sessionDerived.checkOut ?? null,
      workingHours: sessionDerived.working_hours ?? 0,
      punchCount: sessionDerived.punch_count ?? 0,
      effectivePunchCount:
        sessionDerived.effective_punch_count ?? sessionDerived.punch_count ?? 0,
      shiftDefinitions,
      scheduledShift: scheduleShift,
      sameDayPriorShifts: [...priorShifts],
      sessionIndex: sessionDerived.session_index || 1,
    });
    sessionResults.push(result);
    priorShifts.push(result.normalShiftCode || result.dutyShift || result.code || "");
  }

  return sessionResults;
}

function mergeHousekeepingDayRules(sessionResults) {
  if (!sessionResults.length) {
    return { code: "L", dutyShift: "L", attendanceStatus: "L", otHours: 0, otStatus: "NO" };
  }
  if (sessionResults.length === 1) return sessionResults[0];

  const last = sessionResults[sessionResults.length - 1];
  const dutyCodes = sessionResults.map((result) => String(result.dutyShift || result.code || "").toUpperCase());
  let dutyShift = String(last.dutyShift || last.code || "L");

  if (dutyCodes.includes("AC") || (dutyCodes.includes("A") && dutyCodes.some((code) => code === "C" || code.endsWith("C")))) {
    dutyShift = "AC";
  } else if (dutyCodes.includes("AB")) {
    dutyShift = "AB";
  } else if (dutyCodes.includes("BC")) {
    dutyShift = "BC";
  } else if (dutyCodes.includes("CA")) {
    dutyShift = "CA";
  }

  const otHours = sessionResults.reduce(
    (sum, result) => sum + (result.otStatus === "YES" ? Number(result.otHours || 0) : 0),
    0
  );
  const compositeDuty = new Set(["AC", "AB", "BC", "CA"]);
  const first = sessionResults[0];
  const attendanceStatus = compositeDuty.has(dutyShift)
    ? String(first.attendanceStatus || first.attendance_status || "P").toUpperCase()
    : mergeAttendanceStatuses(
        sessionResults.map((result) => result.attendanceStatus || result.attendance_status)
      );

  return {
    ...last,
    dutyShift,
    code: dutyShift,
    shift_code: dutyShift,
    normalShiftCode: last.normalShiftCode || dutyShift[0] || "",
    otShiftCode: otHours > 0 ? last.otShiftCode || dutyShift[1] || "" : "",
    otHours,
    ot_hours: otHours,
    otStatus: otHours > 0 ? "YES" : last.otStatus || "NO",
    ot_status: otHours > 0 ? "YES" : last.ot_status || "NO",
    attendanceStatus,
    attendance_status: attendanceStatus,
  };
}

function applyDayRulesForGrouped(department, grouped, shiftDefinitions, scheduleShift) {
  const sessions = grouped.derivedSessions || [];
  if (sessions.length > 1) {
    if (department === "HOUSEKEEPING") {
      return mergeHousekeepingDayRules(
        collectSessionRuleResults(department, grouped, shiftDefinitions, scheduleShift)
      );
    }
    if (department === "SECURITY") {
      return mergeSecurityDayRules(
        collectSessionRuleResults(department, grouped, shiftDefinitions, scheduleShift)
      );
    }
    if (department === "MEP") {
      return mergeMepDayRules(
        collectSessionRuleResults(department, grouped, shiftDefinitions, scheduleShift)
      );
    }
  }

  const derived = grouped.derived;
  const checkIn = derived?.checkIn ?? null;
  const checkOut = derived?.checkOut ?? null;
  const workingHours =
    derived?.working_hours ?? (checkIn && checkOut ? hoursBetween(checkIn, checkOut) : 0);

  return applyRuleForDepartment(department, {
    employeeId: grouped.employeeId,
    date: grouped.businessDate,
    checkIn,
    checkOut,
    workingHours,
    punchCount: derived?.punch_count ?? grouped.punches.length,
    effectivePunchCount:
      derived?.effective_punch_count ?? derived?.punch_count ?? grouped.punches.length,
    shiftDefinitions,
    scheduledShift: scheduleShift,
  });
}

function upsertGroupedDay(grouped, entry) {
  const existing = grouped.get(entry.baseKey);
  if (!existing) {
    grouped.set(entry.baseKey, entry.value);
    return;
  }

  const mergedSessions = [
    ...(existing.derivedSessions || (existing.derived ? [existing.derived] : [])),
    ...(entry.value.derivedSessions || (entry.value.derived ? [entry.value.derived] : [])),
  ].sort((left, right) => (left.session_index || 1) - (right.session_index || 1));

  const uniqueSessions = [];
  const seen = new Set();
  for (const session of mergedSessions) {
    const signature = `${session.check_in_raw}|${session.check_out_raw}|${session.session_index || 1}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    uniqueSessions.push(session);
  }

  grouped.set(entry.baseKey, {
    ...existing,
    ...entry.value,
    punches: entry.value.punches?.length ? entry.value.punches : existing.punches,
    shiftCodes: entry.value.shiftCodes?.size ? entry.value.shiftCodes : existing.shiftCodes,
    derivedSessions: uniqueSessions,
    derived: consolidateDerivedSessions(uniqueSessions),
  });
}

function createGroupedTransactions(transactions, employees, employeeIndex, shiftMaster, year, month) {
  const grouped = new Map();
  const monthStart = formatDate(startOfMonth(year, month));
  const monthEnd = formatDate(endOfMonth(year, month));

  const { aliasToCanonical } = buildEmployeeAliasLookup(employees);
  const punchGroups = groupPunchesByEmployeeDate(transactions, (transaction) => {
    const employeeId = resolveTransactionEmployeeKey(transaction, aliasToCanonical);
    if (!employeeId || !employeeIndex.has(employeeId)) return null;
    return employeeId;
  });
  const derivedByDate = buildDerivedCheckInOutByDate(punchGroups);

  punchGroups.forEach((group) => {
    if (group.punch_date < monthStart || group.punch_date > monthEnd) return;

    const employeeId = group.employeeKey;
    const sessions = collectDerivedSessionsForDate(derivedByDate, employeeId, group.punch_date);
    if (!sessions.length) return;

    const baseKey = `${employeeId}|${group.punch_date}`;
    const employee = employeeIndex.get(employeeId);
    const department = employee?.department || "MEP";
    const shifts = getShiftDefinitionsForDepartment(shiftMaster, department);
    const punches = group.punches.map((punch) =>
      toDateTimeFromParts(group.punch_date, punch.punch_time_only)
    );
    const shiftCodes = new Set();
    for (const punch of punches) {
      const codes = inferTransactionShiftCodes(punch, shifts);
      codes.forEach((code) => shiftCodes.add(code));
    }

    upsertGroupedDay(grouped, {
      baseKey,
      value: {
        employeeId,
        businessDate: group.punch_date,
        punches,
        shiftCodes,
        derivedSessions: sessions,
        derived: consolidateDerivedSessions(sessions),
      },
    });
  });

  derivedByDate.forEach((derived, mapKey) => {
    const { employeeKey, punchDate, sessionIndex } = parseDerivedMapKey(mapKey);
    if (sessionIndex > 1) return;
    if (derived.punch_date < monthStart || derived.punch_date > monthEnd) return;
    if (!derived.check_in && !derived.check_out) return;

    const baseKey = `${employeeKey}|${punchDate}`;
    if (grouped.has(baseKey)) return;

    const sessions = collectDerivedSessionsForDate(derivedByDate, employeeKey, punchDate);
    if (!sessions.length) return;

    upsertGroupedDay(grouped, {
      baseKey,
      value: {
        employeeId: employeeKey,
        businessDate: punchDate,
        punches: [],
        shiftCodes: new Set(),
        derivedSessions: sessions,
        derived: consolidateDerivedSessions(sessions),
      },
    });
  });

  return grouped;
}

function hasWorkedOnDate(employeeId, dateStr, groupedTransactions) {
  const key = `${employeeId}|${dateStr}`;
  return groupedTransactions.has(key);
}

function evaluateWeekOffCode(employeeId, dateObj, groupedTransactions, weeklyOffDay) {
  const weekday = WEEKDAY_NAMES[dateObj.getDay()];
  if (!weeklyOffDay || weekday !== weeklyOffDay) return null;

  const prevDate = new Date(dateObj.getTime());
  prevDate.setDate(prevDate.getDate() - 1);
  const nextDate = new Date(dateObj.getTime());
  nextDate.setDate(nextDate.getDate() + 1);

  const prevWorked = hasWorkedOnDate(employeeId, formatDate(prevDate), groupedTransactions);
  const nextWorked = hasWorkedOnDate(employeeId, formatDate(nextDate), groupedTransactions);

  return prevWorked || nextWorked ? "W/O" : "L";
}

function isStrictPresent(status) {
  return String(status || "").trim().toUpperCase() === "P";
}

/** MEP: weekly off only if an adjacent calendar day has strict Present (P) attendance. */
function evaluateMepWeeklyOffFromAdjacentPresent(dateObj, weeklyOffDay, getRuleResultForDateStr) {
  const weekday = WEEKDAY_NAMES[dateObj.getDay()];
  if (!weeklyOffDay || weekday !== weeklyOffDay) return null;

  const prevStr = formatDate(addDays(dateObj, -1));
  const nextStr = formatDate(addDays(dateObj, 1));
  const prevResult = getRuleResultForDateStr(prevStr);
  const nextResult = getRuleResultForDateStr(nextStr);
  const prevP = isStrictPresent(prevResult?.attendanceStatus || prevResult?.attendance_status);
  const nextP = isStrictPresent(nextResult?.attendanceStatus || nextResult?.attendance_status);
  return prevP || nextP ? "W/O" : "L";
}

function toWeekOffCode(value) {
  const day = String(value || "").trim().toUpperCase();
  if (day === "MONDAY") return "mon";
  if (day === "TUESDAY") return "tue";
  if (day === "WEDNESDAY") return "wed";
  if (day === "THURSDAY") return "thu";
  if (day === "FRIDAY") return "fri";
  if (day === "SATURDAY") return "sat";
  if (day === "SUNDAY") return "sun";
  return "";
}

function splitCompositeDutyCode(code) {
  const text = String(code || "").toUpperCase();
  if (text === "A4C4") return ["A4", "C4"];
  if (text === "C4A4") return ["C4", "A4"];
  if (/^[A-Z]{2}$/.test(text)) return [text[0], text[1]];
  return null;
}

function formatDisplayCodeWithAttendanceStatus(code, attendanceStatus, options = {}) {
  const base = String(code || "L").toUpperCase();
  const status = String(attendanceStatus || "P").toUpperCase();
  const otShiftCode = String(options.otShiftCode || "").trim().toUpperCase();
  const otStatus = String(options.otStatus || "NO").toUpperCase();
  if (!base || base === "L" || base === "W/O" || base === "WO") return base || "L";

  const hkComposite = new Set(["AC", "AB", "BC", "CA"]);
  const parts = splitCompositeDutyCode(base);
  let display;
  if (parts) {
    if (hkComposite.has(base)) {
      display = `${parts[0]}[${status}]${parts[1]}`;
    } else {
      display = `${parts[0]}-[${status}]${parts[1]}`;
    }
  } else {
    display = `${base}[${status}]`;
  }

  if (otStatus === "YES" && otShiftCode && !display.endsWith(otShiftCode)) {
    const otAlreadyInDuty = parts ? parts.slice(1).join("").includes(otShiftCode) : false;
    if (!otAlreadyInDuty) {
      display = `${display}${otShiftCode}`;
    }
  }

  return display;
}

/** Housekeeping general shifts should report as G8 / G9, not legacy G / G1 / G2. */
function normalizeHousekeepingDailyCode(baseCode, ruleResult) {
  const u = String(baseCode || "").trim().toUpperCase();
  if (u === "G8" || u === "G9") return baseCode;
  if (u === "G2") return "G8";
  if (u === "G1" || u === "G") {
    const ns = String(ruleResult?.normalShiftCode || ruleResult?.normal_shift_code || "").toUpperCase();
    if (ns === "G8" || ns === "G9") return ns;
    const wt = String(ruleResult?.worksTimeline || ruleResult?.works_timeline || "");
    if (wt.toUpperCase().startsWith("G8")) return "G8";
    if (wt.toUpperCase().startsWith("G9")) return "G9";
    return "G9";
  }
  return baseCode;
}

function processAttendance({
  employees,
  transactions,
  month,
  year,
  shiftMaster,
  weekoffRows,
  scheduleRows,
}) {
  const employeeIndex = createEmployeeIndex(employees || []);
  const groupedTransactions = createGroupedTransactions(
    transactions,
    employees,
    employeeIndex,
    shiftMaster,
    year,
    month
  );
  const weekoffMap = normalizeWeekoffRows(weekoffRows);
  const scheduleMap = normalizeScheduleRows(scheduleRows);
  const days = listMonthDates(year, month);
  const processedRows = [];

  employeeIndex.forEach((employee) => {
    const weeklyOffDay = weekoffMap.get(employee.employeeId);
    const row = {
      employeeId: employee.employeeId,
      employeeName: employee.name,
      department: employee.reportDepartment || employee.department,
      designation: employee.designation || "",
      weekOff: toWeekOffCode(weeklyOffDay),
      daily: {},
      dailyDisplay: {},
      dailyOt: {},
      dailyHours: {},
      totals: { presentDays: 0, otHours: 0 },
    };

    const ruleCache = new Map();
    for (const day of days) {
      const dateStr = formatDate(new Date(year, month - 1, day));
      const transactionKey = `${employee.employeeId}|${dateStr}`;
      const grouped = groupedTransactions.get(transactionKey);
      if (!grouped) continue;
      if (!grouped.derived?.check_in && !grouped.derived?.check_out && grouped.punches.length === 0) continue;

      const shiftDefinitions = getShiftDefinitionsForDepartment(shiftMaster, employee.department);
      ruleCache.set(
        transactionKey,
        applyDayRulesForGrouped(
          employee.department,
          grouped,
          shiftDefinitions,
          scheduleMap.get(transactionKey) || ""
        )
      );
    }

    for (const day of days) {
      const dateObj = new Date(year, month - 1, day);
      const dateStr = formatDate(dateObj);
      const transactionKey = `${employee.employeeId}|${dateStr}`;
      const grouped = groupedTransactions.get(transactionKey);

      if (isFutureDate(dateObj)) {
        row.daily[day] = FUTURE_DAY_MARK;
        row.dailyDisplay[day] = FUTURE_DAY_MARK;
        row.dailyOt[day] = 0;
        row.dailyHours[day] = 0;
        continue;
      }

      if (!grouped || (!grouped.derived?.check_in && !grouped.derived?.check_out && grouped.punches.length === 0)) {
        let weekoffCode = null;
        if (
          employee.department === "MEP" ||
          employee.department === "HOUSEKEEPING" ||
          employee.department === "LANDSCAPE"
        ) {
          weekoffCode = evaluateMepWeeklyOffFromAdjacentPresent(
            dateObj,
            weeklyOffDay,
            (ds) => ruleCache.get(`${employee.employeeId}|${ds}`)
          );
        } else if (employee.department !== "SECURITY" && employee.department !== "DRIVER") {
          weekoffCode = evaluateWeekOffCode(
            employee.employeeId,
            dateObj,
            groupedTransactions,
            weeklyOffDay
          );
        }

        const baseCode = weekoffCode || "L";
        row.daily[day] = baseCode;
        row.dailyDisplay[day] = baseCode;
        row.dailyOt[day] = 0;
        row.dailyHours[day] = 0;
        continue;
      }

      const ruleResult = ruleCache.get(transactionKey);
      let baseCode = ruleResult.code || ruleResult.dutyShift || "L";
      if (employee.department === "HOUSEKEEPING") {
        baseCode = normalizeHousekeepingDailyCode(baseCode, ruleResult);
      }
      const attendanceStatus = ruleResult.attendanceStatus || "P";
      const consolidatedHours = Number(grouped.derived?.working_hours || 0);
      row.daily[day] = baseCode;
      row.dailyDisplay[day] = formatDisplayCodeWithAttendanceStatus(baseCode, attendanceStatus, {
        otShiftCode: ruleResult.otShiftCode || "",
        otStatus: ruleResult.otStatus || ruleResult.ot_status || "NO",
      });
      row.dailyOt[day] = ruleResult.otStatus === "YES" ? Number(ruleResult.otHours || 0) : 0;
      row.dailyHours[day] = Math.round(consolidatedHours * 100) / 100;
      if (attendanceStatus === "P") {
        row.totals.presentDays += 1;
      }
      if (ruleResult.otStatus === "YES") {
        row.totals.otHours += Number(ruleResult.otHours || 0);
      }
    }

    row.totals.otHours = Math.round(row.totals.otHours * 100) / 100;
    processedRows.push(row);
  });

  return {
    month,
    year,
    generatedAt: new Date().toISOString(),
    rows: processedRows,
  };
}

module.exports = {
  processAttendance,
  _internal: {
    collectDerivedSessionsForDate,
    consolidateDerivedSessions,
    mergeHousekeepingDayRules,
    applyDayRulesForGrouped,
  },
};
