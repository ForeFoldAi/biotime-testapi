const test = require("node:test");
const assert = require("node:assert/strict");
const { processAttendance } = require("./attendanceProcessor");
const { defaultShiftMaster } = require("../config/biotime");

const employees = [
  {
    emp_code: "CGP59814",
    first_name: "T.MANGAMMA",
    department: { dept_name: "House Keeping" },
    position: { position_name: "Janitor" },
  },
];

const transactions = [
  { emp_code: "CGP59814", punch_time: "2026-06-08 06:27:38", terminal_alias: "In Gate" },
  { emp_code: "CGP59814", punch_time: "2026-06-08 15:37:30", terminal_alias: "CT Out Gate" },
  { emp_code: "CGP59814", punch_time: "2026-06-08 21:06:00", terminal_alias: "CT In Gate" },
  { emp_code: "CGP59814", punch_time: "2026-06-09 06:05:32", terminal_alias: "CT Out Gate" },
  { emp_code: "CGP59814", punch_time: "2026-06-09 06:10:20", terminal_alias: "CT In Gate" },
  { emp_code: "CGP59814", punch_time: "2026-06-09 15:22:49", terminal_alias: "CT Out Gate" },
];

test("housekeeping double shift day consolidates monthly report to AC with combined OT", () => {
  const report = processAttendance({
    employees,
    transactions,
    month: 6,
    year: 2026,
    shiftMaster: defaultShiftMaster,
    weekoffRows: [],
    scheduleRows: [],
  });

  const row = report.rows.find((entry) => entry.employeeId === "CGP59814");
  assert.ok(row);

  assert.equal(row.daily[8], "AC");
  assert.equal(row.dailyDisplay[8], "A[LC]C");
  assert.equal(row.dailyOt[8], 9);
  assert.ok(row.dailyHours[8] >= 18 && row.dailyHours[8] <= 18.2);
});

test("security double shift day consolidates monthly report to A4C4 with summed OT", () => {
  const employees = [
    {
      emp_code: "AG020043",
      first_name: "PANKAJ KUMAR",
      department: { dept_name: "Security" },
      position: { position_name: "Guard" },
    },
  ];

  const transactions = [
    { emp_code: "AG020043", punch_time: "2026-06-08 07:46:23", terminal_alias: "In Gate" },
    { emp_code: "AG020043", punch_time: "2026-06-08 20:00:26", terminal_alias: "CT Out Gate" },
    { emp_code: "AG020043", punch_time: "2026-06-08 20:02:39", terminal_alias: "CT In Gate" },
    { emp_code: "AG020043", punch_time: "2026-06-09 08:50:23", terminal_alias: "CT Out Gate" },
  ];

  const report = processAttendance({
    employees,
    transactions,
    month: 6,
    year: 2026,
    shiftMaster: defaultShiftMaster,
    weekoffRows: [],
    scheduleRows: [],
  });

  const row = report.rows.find((entry) => entry.employeeId === "AG020043");
  assert.ok(row);
  assert.equal(row.daily[8], "A4C4");
  assert.equal(row.dailyDisplay[8], "A4-[P]C4");
  assert.equal(row.dailyOt[8], 8);
  assert.ok(row.dailyHours[8] >= 24 && row.dailyHours[8] <= 25.5);
});

test("MEP G shift OT shows PPP in monthly report display", () => {
  const employees = [
    {
      emp_code: "DCT81",
      first_name: "JALADHAR PANDA",
      department: { dept_name: "O&M" },
      position: { position_name: "Asst STP" },
    },
  ];

  const transactions = [
    { emp_code: "DCT81", punch_time: "2026-06-02 12:55:45", terminal_alias: "Auto add" },
    { emp_code: "DCT81", punch_time: "2026-06-02 20:58:15", terminal_alias: "Auto add" },
  ];

  const report = processAttendance({
    employees,
    transactions,
    month: 6,
    year: 2026,
    shiftMaster: defaultShiftMaster,
    weekoffRows: [],
    scheduleRows: [],
  });

  const row = report.rows.find((entry) => entry.employeeId === "DCT81");
  assert.ok(row);
  assert.equal(row.daily[2], "G");
  assert.equal(row.dailyDisplay[2], "G[LC]PPP");
  assert.ok(row.dailyOt[2] >= 2.9);
});

test("MEP B and C same day consolidates monthly report to BC with C OT 10", () => {
  const employees = [
    {
      emp_code: "DCT81",
      first_name: "JALADHAR PANDA",
      department: { dept_name: "O&M" },
      position: { position_name: "Asst STP" },
    },
  ];

  const transactions = [
    { emp_code: "DCT81", punch_time: "2026-06-07 13:15:04", terminal_alias: "In Gate" },
    { emp_code: "DCT81", punch_time: "2026-06-07 20:59:54", terminal_alias: "Out Gate" },
    { emp_code: "DCT81", punch_time: "2026-06-07 21:04:17", terminal_alias: "In Gate" },
    { emp_code: "DCT81", punch_time: "2026-06-08 06:57:45", terminal_alias: "CT Out Gate" },
  ];

  const report = processAttendance({
    employees,
    transactions,
    month: 6,
    year: 2026,
    shiftMaster: defaultShiftMaster,
    weekoffRows: [],
    scheduleRows: [],
  });

  const row = report.rows.find((entry) => entry.employeeId === "DCT81");
  assert.ok(row);
  assert.equal(row.daily[7], "BC");
  assert.equal(row.dailyDisplay[7], "B[P]C");
  assert.equal(row.dailyOt[7], 10);
  assert.ok(row.dailyHours[7] >= 17 && row.dailyHours[7] <= 18);
});
