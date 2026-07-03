const test = require("node:test");
const assert = require("node:assert/strict");

const { applySecurityRules } = require("../rules/securityRules");
const { applyMepRules } = require("../rules/mepRules");
const {
  buildDerivedCheckInOutByDate,
  classifyPunchDirection,
  deriveCheckInOut,
  groupPunchesByEmployeeDate,
  hoursBetweenTimeOnly,
  splitPunchTime,
} = require("./punchGrouping");

test("DEEPAK overnight security rules return A4C4 P with OT", () => {
  const grouped = groupPunchesByEmployeeDate(
    [
      { emp_code: "AG027929", punch_time: "2026-06-08 03:47:00", terminal_alias: "In Gate", punch_state: "255" },
      { emp_code: "AG027929", punch_time: "2026-06-09 08:49:27", terminal_alias: "CT Out Gate", punch_state: "255" },
    ],
    (tx) => tx.emp_code
  );
  const derivedByDate = buildDerivedCheckInOutByDate(grouped);
  const jun8 = derivedByDate.get("AG027929|2026-06-08");
  const result = applySecurityRules({
    date: "2026-06-08",
    checkIn: jun8.checkIn,
    checkOut: jun8.checkOut,
    workingHours: jun8.working_hours,
    punchCount: jun8.punch_count,
    effectivePunchCount: jun8.effective_punch_count,
  });

  assert.equal(result.normalShiftCode, "A4C4");
  assert.equal(result.attendanceStatus, "P");
  assert.equal(result.otHours, 8);
});

const sampleInGateTransaction = {
  id: 160833955,
  emp_code: "CGP70184",
  punch_time: "2026-06-08 11:59:52",
  punch_state: "255",
  verify_type: 15,
  terminal_sn: "NCD8251900156",
  terminal_alias: "CT In Gate",
  area_alias: "Cyber Towers",
};

test("splitPunchTime splits literal API datetime", () => {
  assert.deepEqual(splitPunchTime("2026-06-08 11:59:52"), {
    punch_date: "2026-06-08",
    punch_time_only: "11:59:52",
    raw: "2026-06-08 11:59:52",
  });
});

test("classifyPunchDirection uses CT In Gate terminal alias", () => {
  assert.equal(classifyPunchDirection(sampleInGateTransaction), "in");
});

test("classifyPunchDirection uses CT Out Gate terminal alias", () => {
  assert.equal(
    classifyPunchDirection({
      ...sampleInGateTransaction,
      terminal_alias: "CT Out Gate",
    }),
    "out"
  );
});

test("classifyPunchDirection uses BioTime punch_state when present", () => {
  assert.equal(classifyPunchDirection({ punch_state: "0", terminal_alias: "" }), "in");
  assert.equal(classifyPunchDirection({ punch_state: "1", terminal_alias: "" }), "out");
});

test("AG025226 single morning Auto Add fills check-in only", () => {
  const grouped = groupPunchesByEmployeeDate(
    [
      {
        emp_code: "AG025226",
        punch_time: "2026-06-05 07:57:49",
        terminal_alias: "Auto add",
      },
    ],
    (tx) => tx.emp_code
  );
  const derived = deriveCheckInOut(grouped.get("AG025226|2026-06-05"));

  assert.equal(derived.check_in, "07:57:49");
  assert.equal(derived.check_out, "");
  assert.equal(derived.check_in_terminal_alias, "Auto add");
  assert.equal(derived.resolution, "single_auto_add_in");
  assert.equal(derived.punchAttendanceStatus, "Missing Punch");
});

test("single evening Auto Add fills check-out only", () => {
  const grouped = groupPunchesByEmployeeDate(
    [
      {
        emp_code: "AG025226",
        punch_time: "2026-06-05 21:13:15",
        terminal_alias: "Auto add",
      },
    ],
    (tx) => tx.emp_code
  );
  const derived = deriveCheckInOut(grouped.get("AG025226|2026-06-05"));

  assert.equal(derived.check_in, "");
  assert.equal(derived.check_out, "21:13:15");
  assert.equal(derived.check_out_terminal_alias, "Auto add");
  assert.equal(derived.resolution, "single_auto_add_out");
});

test("Auto Add + Out Gate uses Auto Add for check-in and Out Gate for check-out", () => {
  const transactions = [
    {
      emp_code: "AG025226",
      punch_time: "2026-06-06 07:59:00",
      terminal_alias: "Auto add",
    },
    {
      emp_code: "AG025226",
      punch_time: "2026-06-06 20:12:50",
      terminal_alias: "Out Gate",
    },
  ];

  const grouped = groupPunchesByEmployeeDate(transactions, (tx) => tx.emp_code);
  const derived = deriveCheckInOut(grouped.get("AG025226|2026-06-06"));

  assert.equal(derived.check_in, "07:59:00");
  assert.equal(derived.check_out, "20:12:50");
  assert.equal(derived.check_in_terminal_alias, "Auto add");
  assert.equal(derived.check_out_terminal_alias, "Out Gate");
  assert.equal(derived.resolution, "auto_add+out_gate");
  assert.equal(derived.punchAttendanceStatus, "Present");
});

test("In Gate + Auto Add uses In Gate for check-in and Auto Add for check-out", () => {
  const transactions = [
    {
      emp_code: "CGP70184",
      punch_time: "2026-06-08 08:02:19",
      terminal_alias: "CT In Gate",
    },
    {
      emp_code: "CGP70184",
      punch_time: "2026-06-08 20:31:00",
      terminal_alias: "Auto add",
    },
  ];

  const grouped = groupPunchesByEmployeeDate(transactions, (tx) => tx.emp_code);
  const derived = deriveCheckInOut(grouped.get("CGP70184|2026-06-08"));

  assert.equal(derived.check_in, "08:02:19");
  assert.equal(derived.check_out, "20:31:00");
  assert.equal(derived.check_in_terminal_alias, "CT In Gate");
  assert.equal(derived.check_out_terminal_alias, "Auto add");
  assert.equal(derived.resolution, "in_gate+auto_add");
  assert.equal(derived.punchAttendanceStatus, "Present");
});

test("Auto Add + Auto Add uses earliest and latest Auto Add times", () => {
  const transactions = [
    {
      emp_code: "AG025226",
      punch_time: "2026-06-01 07:56:06",
      terminal_alias: "Auto add",
    },
    {
      emp_code: "AG025226",
      punch_time: "2026-06-01 20:11:58",
      terminal_alias: "Auto add",
    },
  ];

  const grouped = groupPunchesByEmployeeDate(transactions, (tx) => tx.emp_code);
  const derived = deriveCheckInOut(grouped.get("AG025226|2026-06-01"));

  assert.equal(derived.check_in, "07:56:06");
  assert.equal(derived.check_out, "20:11:58");
  assert.equal(derived.check_in_terminal_alias, "Auto add");
  assert.equal(derived.check_out_terminal_alias, "Auto add");
  assert.equal(derived.resolution, "auto_add+auto_add");
  assert.equal(derived.punchAttendanceStatus, "Present");
});

test("two CT In Gate punches use earliest for check-in only", () => {
  const transactions = [
    {
      emp_code: "AG023846",
      punch_time: "2026-06-09 07:55:59",
      terminal_alias: "CT In Gate",
      terminal_sn: "NCD8251900156",
    },
    {
      emp_code: "AG023846",
      punch_time: "2026-06-09 08:02:02",
      terminal_alias: "CT In Gate",
      terminal_sn: "NCD8251900156",
    },
  ];

  const grouped = groupPunchesByEmployeeDate(transactions, (tx) => tx.emp_code);
  const derived = deriveCheckInOut(grouped.get("AG023846|2026-06-09"));

  assert.equal(derived.check_in, "07:55:59");
  assert.equal(derived.check_out, "");
  assert.equal(derived.check_in_terminal_alias, "CT In Gate");
  assert.equal(derived.check_out_terminal_alias, "");
  assert.equal(derived.punch_count, 2);
  assert.equal(derived.resolution, "in_gate+in_gate");
  assert.equal(derived.punchAttendanceStatus, "Missing Punch");
});

test("two Out Gate punches use latest for check-out only", () => {
  const transactions = [
    {
      emp_code: "AG023846",
      punch_time: "2026-06-09 20:01:00",
      terminal_alias: "CT Out Gate",
    },
    {
      emp_code: "AG023846",
      punch_time: "2026-06-09 20:04:32",
      terminal_alias: "CT Out Gate",
    },
  ];

  const grouped = groupPunchesByEmployeeDate(transactions, (tx) => tx.emp_code);
  const derived = deriveCheckInOut(grouped.get("AG023846|2026-06-09"));

  assert.equal(derived.check_in, "");
  assert.equal(derived.check_out, "20:04:32");
  assert.equal(derived.check_out_terminal_alias, "CT Out Gate");
  assert.equal(derived.resolution, "out_gate+out_gate");
  assert.equal(derived.punchAttendanceStatus, "Missing Punch");
});

test("single CT In Gate punch keeps checkout blank", () => {
  const grouped = groupPunchesByEmployeeDate([sampleInGateTransaction], (tx) => tx.emp_code);
  const derived = deriveCheckInOut(grouped.get("CGP70184|2026-06-08"));

  assert.equal(derived.check_in, "11:59:52");
  assert.equal(derived.check_out, "");
  assert.equal(derived.resolution, "single_in_gate");
  assert.equal(derived.punchAttendanceStatus, "Missing Punch");
});

test("single Out Gate punch keeps check-in blank", () => {
  const grouped = groupPunchesByEmployeeDate(
    [
      {
        emp_code: "AG025226",
        punch_time: "2026-06-06 20:12:50",
        terminal_alias: "Out Gate",
      },
    ],
    (tx) => tx.emp_code
  );
  const derived = deriveCheckInOut(grouped.get("AG025226|2026-06-06"));

  assert.equal(derived.check_in, "");
  assert.equal(derived.check_out, "20:12:50");
  assert.equal(derived.resolution, "single_out_gate");
  assert.equal(derived.punchAttendanceStatus, "Missing Punch");
});

test("In Gate + Out Gate ignores middle unclassified punches", () => {
  const transactions = [
    {
      emp_code: "CGP70184",
      punch_time: "2026-06-08 08:02:19",
      terminal_alias: "CT In Gate",
    },
    {
      emp_code: "CGP70184",
      punch_time: "2026-06-08 12:30:00",
      terminal_alias: "Cafeteria",
    },
    {
      emp_code: "CGP70184",
      punch_time: "2026-06-08 20:31:00",
      terminal_alias: "CT Out Gate",
    },
  ];

  const grouped = groupPunchesByEmployeeDate(transactions, (tx) => tx.emp_code);
  const derived = deriveCheckInOut(grouped.get("CGP70184|2026-06-08"));

  assert.equal(derived.check_in, "08:02:19");
  assert.equal(derived.check_out, "20:31:00");
  assert.equal(derived.resolution, "in_gate+out_gate");
  assert.ok(Math.abs(derived.working_hours - hoursBetweenTimeOnly("08:02:19", "20:31:00")) < 0.01);
});

test("invalid in_gate+out_gate falls back to auto_add+out_gate", () => {
  const transactions = [
    {
      emp_code: "DCT01",
      punch_time: "2026-06-06 13:46:12",
      terminal_alias: "Auto add",
    },
    {
      emp_code: "DCT01",
      punch_time: "2026-06-06 20:54:12",
      terminal_alias: "Out Gate",
      punch_state: "1",
    },
    {
      emp_code: "DCT01",
      punch_time: "2026-06-06 20:57:26",
      terminal_alias: "In Gate",
      punch_state: "0",
    },
  ];

  const grouped = groupPunchesByEmployeeDate(transactions, (tx) => tx.emp_code);
  const derived = deriveCheckInOut(grouped.get("DCT01|2026-06-06"));

  assert.equal(derived.check_in, "13:46:12");
  assert.equal(derived.check_out, "20:54:12");
  assert.equal(derived.resolution, "auto_add+out_gate");
});

test("DCT01 Jun 6 stitches B shift with overnight C checkout on Jun 7", () => {
  const transactions = [
    {
      emp_code: "DCT01",
      punch_time: "2026-06-06 13:46:12",
      terminal_alias: "Auto add",
    },
    {
      emp_code: "DCT01",
      punch_time: "2026-06-06 20:54:12",
      terminal_alias: "Out Gate",
      punch_state: "1",
    },
    {
      emp_code: "DCT01",
      punch_time: "2026-06-06 20:57:26",
      terminal_alias: "In Gate",
      punch_state: "0",
    },
    {
      emp_code: "DCT01",
      punch_time: "2026-06-07 06:55:55",
      terminal_alias: "Out Gate",
      punch_state: "1",
    },
    {
      emp_code: "DCT01",
      punch_time: "2026-06-07 06:59:00",
      terminal_alias: "In Gate",
      punch_state: "0",
    },
    {
      emp_code: "DCT01",
      punch_time: "2026-06-07 14:07:57",
      terminal_alias: "Out Gate",
      punch_state: "1",
    },
  ];

  const grouped = groupPunchesByEmployeeDate(transactions, (tx) => tx.emp_code);
  const derivedByDate = buildDerivedCheckInOutByDate(grouped);
  const jun6 = derivedByDate.get("DCT01|2026-06-06");
  const jun6Night = derivedByDate.get("DCT01|2026-06-06#2");
  const jun7 = derivedByDate.get("DCT01|2026-06-07");

  assert.equal(jun6.check_in, "13:46:12");
  assert.equal(jun6.check_out, "20:54:12");
  assert.equal(jun6.resolution, "auto_add+out_gate");

  assert.equal(jun6Night.check_in, "20:57:26");
  assert.equal(jun6Night.check_out, "06:55:55");
  assert.equal(jun6Night.check_out_date, "2026-06-07");
  assert.equal(jun6Night.check_out_raw, "2026-06-07 06:55:55");
  assert.equal(jun6Night.resolution, "cross_midnight_c");

  assert.equal(jun7.check_in, "06:59:00");
  assert.equal(jun7.check_out, "14:07:57");
  assert.equal(jun7.resolution, "in_gate+out_gate");

  const shifts = require("../storage/data/shifts.json").MEP;
  const mep6Day = applyMepRules({
    date: "2026-06-06",
    checkIn: jun6.checkIn,
    checkOut: jun6.checkOut,
    shiftDefinitions: shifts,
  });
  const mep6Night = applyMepRules({
    date: "2026-06-06",
    checkIn: jun6Night.checkIn,
    checkOut: jun6Night.checkOut,
    shiftDefinitions: shifts,
  });
  const mep7 = applyMepRules({
    date: "2026-06-07",
    checkIn: jun7.checkIn,
    checkOut: jun7.checkOut,
    shiftDefinitions: shifts,
  });

  assert.equal(mep6Day.code, "B");
  assert.equal(mep6Night.code, "C");
  assert.equal(mep7.code, "A");
  assert.equal(mep7.attendanceStatus, "P");
  assert.equal(mep7.otHours, 0);
});

test("DCT01 Jun 8 evening check-in stitches to Jun 9 morning checkout", () => {
  const transactions = [
    {
      emp_code: "DCT01",
      punch_time: "2026-06-08 20:37:19",
      terminal_alias: "CT In Gate",
      punch_state: "0",
    },
    {
      emp_code: "DCT01",
      punch_time: "2026-06-09 06:48:35",
      terminal_alias: "CT Out Gate",
      punch_state: "1",
    },
  ];

  const grouped = groupPunchesByEmployeeDate(transactions, (tx) => tx.emp_code);
  const derivedByDate = buildDerivedCheckInOutByDate(grouped);
  const jun8 = derivedByDate.get("DCT01|2026-06-08");
  const jun9 = derivedByDate.get("DCT01|2026-06-09");

  assert.equal(jun8.check_in, "20:37:19");
  assert.equal(jun8.check_out, "06:48:35");
  assert.equal(jun8.check_out_date, "2026-06-09");
  assert.equal(jun8.check_out_raw, "2026-06-09 06:48:35");
  assert.equal(jun8.resolution, "cross_midnight_c");
  assert.equal(jun8.punchAttendanceStatus, "Present");

  assert.equal(jun9, undefined);

  const shifts = require("../storage/data/shifts.json").MEP;
  const mep8 = applyMepRules({
    date: "2026-06-08",
    checkIn: jun8.checkIn,
    checkOut: jun8.checkOut,
    shiftDefinitions: shifts,
  });
  assert.equal(mep8.code, "C");
  assert.equal(mep8.attendanceStatus, "P");
  assert.equal(mep8.otHours, 0);
});

test("AG024427 Jun 7-9 links overnight C4 via morning out through 09:00", () => {
  const transactions = [
    {
      emp_code: "AG024427",
      punch_time: "2026-06-07 19:33:28",
      terminal_alias: "In Gate",
      punch_state: "0",
    },
    {
      emp_code: "AG024427",
      punch_time: "2026-06-08 08:35:26",
      terminal_alias: "CT Out Gate",
      punch_state: "1",
    },
    {
      emp_code: "AG024427",
      punch_time: "2026-06-08 19:57:40",
      terminal_alias: "CT In Gate",
      punch_state: "0",
    },
    {
      emp_code: "AG024427",
      punch_time: "2026-06-09 08:49:52",
      terminal_alias: "CT Out Gate",
      punch_state: "1",
    },
  ];

  const grouped = groupPunchesByEmployeeDate(transactions, (tx) => tx.emp_code);
  const derivedByDate = buildDerivedCheckInOutByDate(grouped);
  const jun7 = derivedByDate.get("AG024427|2026-06-07");
  const jun8 = derivedByDate.get("AG024427|2026-06-08");
  const jun9 = derivedByDate.get("AG024427|2026-06-09");

  assert.equal(jun7.check_in, "19:33:28");
  assert.equal(jun7.check_out, "08:35:26");
  assert.equal(jun7.check_out_date, "2026-06-08");
  assert.equal(jun7.resolution, "cross_midnight_c");

  assert.equal(jun8.check_in, "19:57:40");
  assert.equal(jun8.check_out, "08:49:52");
  assert.equal(jun8.check_out_date, "2026-06-09");
  assert.equal(jun8.resolution, "cross_midnight_c");

  assert.equal(jun9, undefined);
});

test("morning checkout after 09:00 is not used for cross-midnight", () => {
  const transactions = [
    {
      emp_code: "AG024427",
      punch_time: "2026-06-07 19:33:28",
      terminal_alias: "In Gate",
      punch_state: "0",
    },
    {
      emp_code: "AG024427",
      punch_time: "2026-06-08 09:01:00",
      terminal_alias: "CT Out Gate",
      punch_state: "1",
    },
  ];

  const grouped = groupPunchesByEmployeeDate(transactions, (tx) => tx.emp_code);
  const derivedByDate = buildDerivedCheckInOutByDate(grouped);
  const jun7 = derivedByDate.get("AG024427|2026-06-07");

  assert.equal(jun7.check_in, "19:33:28");
  assert.equal(jun7.check_out, "");
  assert.equal(jun7.resolution, "single_in_gate");
});

test("in_gate+out_gate uses latest out gate after check-in", () => {
  const transactions = [
    {
      emp_code: "DCT01",
      punch_time: "2026-06-07 06:55:55",
      terminal_alias: "Out Gate",
      punch_state: "1",
    },
    {
      emp_code: "DCT01",
      punch_time: "2026-06-07 06:59:00",
      terminal_alias: "In Gate",
      punch_state: "0",
    },
    {
      emp_code: "DCT01",
      punch_time: "2026-06-07 14:07:57",
      terminal_alias: "Out Gate",
      punch_state: "1",
    },
  ];

  const grouped = groupPunchesByEmployeeDate(transactions, (tx) => tx.emp_code);
  const derived = deriveCheckInOut(grouped.get("DCT01|2026-06-07"));

  assert.equal(derived.check_in, "06:59:00");
  assert.equal(derived.check_out, "14:07:57");
  assert.equal(derived.resolution, "in_gate+out_gate");
});

test("unknown terminals fall back to earliest and latest time", () => {
  const group = {
    employeeKey: "AG020034",
    punch_date: "2026-06-01",
    punches: [
      { punch_time_only: "21:38:36", raw: "2026-06-01 21:38:36", direction: null, terminal_alias: "Device" },
      { punch_time_only: "07:55:13", raw: "2026-06-01 07:55:13", direction: null, terminal_alias: "Device" },
      { punch_time_only: "12:00:00", raw: "2026-06-01 12:00:00", direction: null, terminal_alias: "Device" },
    ],
  };

  const derived = deriveCheckInOut(group);
  assert.equal(derived.check_in, "07:55:13");
  assert.equal(derived.check_out, "21:38:36");
  assert.equal(derived.resolution, "time");
});

test("classifyPunchDirection prefers CT gate terminal over punch_state", () => {
  assert.equal(
    classifyPunchDirection({
      punch_state: "0",
      terminal_alias: "CT Out Gate",
    }),
    "out"
  );
  assert.equal(
    classifyPunchDirection({
      punch_state: "1",
      terminal_alias: "CT In Gate",
    }),
    "in"
  );
});

test("DEEPAK overnight gets effective punch count 2 and cross midnight forward", () => {
  const grouped = groupPunchesByEmployeeDate(
    [
      { emp_code: "AG027929", punch_time: "2026-06-08 03:47:00", terminal_alias: "In Gate", punch_state: "255" },
      { emp_code: "AG027929", punch_time: "2026-06-09 08:49:27", terminal_alias: "CT Out Gate", punch_state: "255" },
    ],
    (tx) => tx.emp_code
  );
  const derivedByDate = buildDerivedCheckInOutByDate(grouped);
  const jun8 = derivedByDate.get("AG027929|2026-06-08");

  assert.equal(jun8.check_in, "03:47:00");
  assert.equal(jun8.check_out, "08:49:27");
  assert.equal(jun8.punch_count, 1);
  assert.equal(jun8.effective_punch_count, 2);
  assert.equal(jun8.resolution, "cross_midnight_c");
  assert.ok(jun8.working_hours > 29);
});

test("ag029220 orphan out before in stays on same day without fake prior row", () => {
  const grouped = groupPunchesByEmployeeDate(
    [
      { emp_code: "ag029220", punch_time: "2026-06-10 12:05:27", terminal_alias: "CT Out Gate" },
      { emp_code: "ag029220", punch_time: "2026-06-10 12:09:50", terminal_alias: "CT In Gate" },
    ],
    (tx) => tx.emp_code
  );
  const derivedByDate = buildDerivedCheckInOutByDate(grouped);
  const jun9 = derivedByDate.get("ag029220|2026-06-09");
  const jun10 = derivedByDate.get("ag029220|2026-06-10");

  assert.equal(jun9, undefined);
  assert.equal(jun10.check_in, "12:09:50");
  assert.equal(jun10.check_out, "");
  assert.equal(jun10.resolution, "single_in_gate");
});

test("AG024420 out before in on same day does not create prior-day row", () => {
  const grouped = groupPunchesByEmployeeDate(
    [
      { emp_code: "AG024420", punch_time: "2026-06-10 11:52:56", terminal_alias: "CT Out Gate" },
      { emp_code: "AG024420", punch_time: "2026-06-10 11:55:30", terminal_alias: "CT Out Gate" },
      { emp_code: "AG024420", punch_time: "2026-06-10 12:21:53", terminal_alias: "CT In Gate" },
    ],
    (tx) => tx.emp_code
  );
  const derivedByDate = buildDerivedCheckInOutByDate(grouped);
  const jun9 = derivedByDate.get("AG024420|2026-06-09");
  const jun10 = derivedByDate.get("AG024420|2026-06-10");

  assert.equal(jun9, undefined);
  assert.equal(jun10.check_in, "12:21:53");
  assert.equal(jun10.check_out, "");
});

test("sessions over 30 hours do not forward-stitch checkout", () => {
  const grouped = groupPunchesByEmployeeDate(
    [
      { emp_code: "AG099999", punch_time: "2026-06-08 02:00:00", terminal_alias: "CT In Gate" },
      { emp_code: "AG099999", punch_time: "2026-06-09 08:30:00", terminal_alias: "CT Out Gate" },
    ],
    (tx) => tx.emp_code
  );
  const derivedByDate = buildDerivedCheckInOutByDate(grouped);
  const jun8 = derivedByDate.get("AG099999|2026-06-08");

  assert.equal(jun8.check_in, "02:00:00");
  assert.equal(jun8.check_out, "");
  assert.equal(jun8.resolution, "single_in_gate");
  assert.equal(jun8.effective_punch_count, 1);
});

test("CGP64496 double shift day splits morning A and night C instead of 23h stitch", () => {
  const transactions = [
    { emp_code: "CGP64496", punch_time: "2026-06-07 06:13:30", terminal_alias: "In Gate", punch_state: "255" },
    { emp_code: "CGP64496", punch_time: "2026-06-07 15:18:30", terminal_alias: "Out Gate", punch_state: "255" },
    { emp_code: "CGP64496", punch_time: "2026-06-07 20:54:39", terminal_alias: "In Gate", punch_state: "255" },
    { emp_code: "CGP64496", punch_time: "2026-06-08 06:03:58", terminal_alias: "CT Out Gate", punch_state: "255" },
    { emp_code: "CGP64496", punch_time: "2026-06-08 06:08:40", terminal_alias: "In Gate", punch_state: "255" },
    { emp_code: "CGP64496", punch_time: "2026-06-08 15:32:21", terminal_alias: "CT Out Gate", punch_state: "255" },
  ];

  const grouped = groupPunchesByEmployeeDate(transactions, (tx) => tx.emp_code);
  const derivedByDate = buildDerivedCheckInOutByDate(grouped);
  const jun7Morning = derivedByDate.get("CGP64496|2026-06-07");
  const jun7Night = derivedByDate.get("CGP64496|2026-06-07#2");
  const jun8 = derivedByDate.get("CGP64496|2026-06-08");

  assert.equal(jun7Morning.check_in, "06:13:30");
  assert.equal(jun7Morning.check_out, "15:18:30");
  assert.equal(jun7Morning.resolution, "in_gate+out_gate");
  assert.ok(jun7Morning.working_hours >= 9 && jun7Morning.working_hours <= 9.2);
  assert.equal(jun7Morning.punch_count, 2);

  assert.equal(jun7Night.check_in, "20:54:39");
  assert.equal(jun7Night.check_out, "06:03:58");
  assert.equal(jun7Night.check_out_date, "2026-06-08");
  assert.equal(jun7Night.resolution, "cross_midnight_c");
  assert.ok(jun7Night.working_hours >= 9 && jun7Night.working_hours <= 9.3);
  assert.equal(jun7Night.punch_count, 1);
  assert.equal(jun7Night.effective_punch_count, 2);

  assert.equal(jun8.check_in, "06:08:40");
  assert.equal(jun8.check_out, "15:32:21");
  assert.equal(jun8.resolution, "in_gate+out_gate");
  assert.ok(jun8.working_hours >= 9.3 && jun8.working_hours <= 9.5);
});

test("AG020043 day A4 and night C4 split instead of 25h stitch", () => {
  const transactions = [
    { emp_code: "AG020043", punch_time: "2026-06-08 07:46:23", terminal_alias: "In Gate", punch_state: "0" },
    { emp_code: "AG020043", punch_time: "2026-06-08 20:00:26", terminal_alias: "CT Out Gate", punch_state: "1" },
    { emp_code: "AG020043", punch_time: "2026-06-08 20:02:39", terminal_alias: "CT In Gate", punch_state: "0" },
    { emp_code: "AG020043", punch_time: "2026-06-09 08:50:23", terminal_alias: "CT Out Gate", punch_state: "1" },
  ];

  const grouped = groupPunchesByEmployeeDate(transactions, (tx) => tx.emp_code);
  const derivedByDate = buildDerivedCheckInOutByDate(grouped);
  const jun8Day = derivedByDate.get("AG020043|2026-06-08");
  const jun8Night = derivedByDate.get("AG020043|2026-06-08#2");

  assert.equal(jun8Day.check_in, "07:46:23");
  assert.equal(jun8Day.check_out, "20:00:26");
  assert.equal(jun8Day.resolution, "in_gate+out_gate");
  assert.ok(jun8Day.working_hours >= 12 && jun8Day.working_hours <= 12.5);

  assert.equal(jun8Night.check_in, "20:02:39");
  assert.equal(jun8Night.check_out, "08:50:23");
  assert.equal(jun8Night.check_out_date, "2026-06-09");
  assert.equal(jun8Night.resolution, "cross_midnight_c");
  assert.ok(jun8Night.working_hours >= 12 && jun8Night.working_hours <= 13);
});
