#!/usr/bin/env node
/**
 * Test live API attendance for a date range across all departments.
 *
 * Usage:
 *   node scripts/testDeptRulesDateRange.js 2026-06-07 2026-06-10
 *   BASE_URL=http://localhost:4000 node scripts/testDeptRulesDateRange.js 6 2026 --days 7,8,9,10
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const { classifyDepartment } = require("../src/utils/shiftUtils");
const { processAttendance } = require("../src/processors/attendanceProcessor");
const { defaultShiftMaster } = require("../src/config/biotime");
const runtimeStore = require("../src/storage/runtimeStore");

const BASE_URL = process.env.BASE_URL || "http://localhost:4000";

function parseArgs() {
  const args = process.argv.slice(2);
  let startDate = null;
  let endDate = null;
  let month = null;
  let year = null;
  let daysFilter = null;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--days" && args[i + 1]) {
      daysFilter = args[i + 1].split(",").map((d) => Number(d.trim()));
      i += 1;
      continue;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(args[i])) {
      if (!startDate) startDate = args[i];
      else endDate = args[i];
      continue;
    }
    if (!month && /^\d{1,2}$/.test(args[i])) {
      month = Number(args[i]);
      continue;
    }
    if (!year && /^\d{4}$/.test(args[i])) {
      year = Number(args[i]);
    }
  }

  if (startDate && endDate) {
    return { startDate, endDate, month: null, year: null, daysFilter };
  }
  if (month && year) {
    const monthPad = String(month).padStart(2, "0");
    const filterDays = daysFilter || [7, 8, 9, 10];
    const sorted = [...filterDays].sort((a, b) => a - b);
    return {
      startDate: `${year}-${monthPad}-${String(sorted[0]).padStart(2, "0")}`,
      endDate: `${year}-${monthPad}-${String(sorted[sorted.length - 1]).padStart(2, "0")}`,
      month,
      year,
      daysFilter: filterDays,
    };
  }

  console.error(
    "Usage:\n  node scripts/testDeptRulesDateRange.js 2026-06-07 2026-06-10\n  node scripts/testDeptRulesDateRange.js 6 2026 --days 7,8,9,10"
  );
  process.exit(1);
}

function fetchJson(urlPath) {
  const url = new URL(urlPath, BASE_URL);
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    client
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Invalid JSON from ${urlPath}: ${data.slice(0, 300)}`));
          }
        });
      })
      .on("error", reject);
  });
}

function dayFromDate(dateStr) {
  return Number(String(dateStr).slice(8, 10));
}

function flagRow(row) {
  const flags = [];
  const hours = Number(row.working_hours_decimal || 0);
  const punches = Number(row.punch_count || 0);
  const resolution = String(row.resolution || "");

  if (!row.check_in && !row.check_out) flags.push("no_punches");
  else if (!row.check_in) flags.push("missing_check_in");
  else if (!row.check_out) flags.push("missing_check_out");

  if (hours > 16) flags.push(`long_hours_${hours}h`);
  if (hours > 12 && hours <= 16) flags.push(`extended_hours_${hours}h`);
  if (punches === 1) flags.push("single_punch");
  if (punches >= 5) flags.push(`many_punches_${punches}`);

  if (resolution.includes("backward")) flags.push("backward_checkout");
  if (resolution.includes("multi_session")) flags.push("multi_session");
  if (resolution.includes("stitch")) flags.push("stitched_session");

  const status = String(row.attendance_status || "").toUpperCase();
  if (status === "L" && row.check_in && row.check_out) flags.push("marked_leave_with_punches");

  const ot = Number(row.ot_hours_decimal || 0);
  const deptKey = classifyDepartment(row.department);
  if (deptKey === "HOUSEKEEPING" && row.is_ot === "YES" && ot > 0 && !["C", "AC", "BC", "CA"].some((c) => String(row.normal_shift || "").includes(c))) {
    flags.push(`hk_ot_on_${row.normal_shift}`);
  }

  return flags;
}

function summarizeDept(deptName, deptKey, rows) {
  const byDate = {};
  const flagged = [];
  const shiftCounts = {};
  const otTotal = { hours: 0, rows: 0 };

  for (const row of rows) {
    const date = row.date;
    byDate[date] = (byDate[date] || 0) + 1;

    const shift = `${row.normal_shift || "?"}${row.ot_shift ? `+${row.ot_shift}` : ""}`;
    shiftCounts[shift] = (shiftCounts[shift] || 0) + 1;

    const ot = Number(row.ot_hours_decimal || 0);
    if (ot > 0) {
      otTotal.hours += ot;
      otTotal.rows += 1;
    }

    const flags = flagRow(row);
    if (flags.length) {
      flagged.push({
        date: row.date,
        emp: row.employee_code,
        name: row.employee_name,
        in: row.check_in || "-",
        out: row.check_out || "-",
        hours: row.working_hours,
        shift: row.normal_shift,
        ot: row.ot_hours_decimal,
        status: row.attendance_status,
        resolution: row.resolution || "-",
        flags,
      });
    }
  }

  return {
    deptName,
    deptKey,
    totalRows: rows.length,
    byDate,
    shiftCounts,
    otTotal,
    flagged,
    employees: new Set(rows.map((r) => r.employee_code)).size,
  };
}

function buildMonthlySlice(report, daysFilter) {
  const slice = [];
  for (const row of report.rows || []) {
    for (const day of daysFilter) {
      const code = row.daily?.[day];
      if (!code) continue;
      slice.push({
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        department: row.department,
        day,
        code,
        display: row.dailyDisplay?.[day] || code,
        ot: row.dailyOt?.[day] || 0,
        hours: row.dailyHours?.[day] || null,
      });
    }
  }
  return slice;
}

function summarizeMonthlyByDept(monthlySlice) {
  const byDept = new Map();
  for (const entry of monthlySlice) {
    const key = entry.department || "unknown";
    if (!byDept.has(key)) {
      byDept.set(key, { entries: [], composite: 0, otDays: 0 });
    }
    const bucket = byDept.get(key);
    bucket.entries.push(entry);
    if (["AC", "AB", "BC", "CA", "A4C4", "C4A4"].includes(entry.code)) bucket.composite += 1;
    if (entry.ot > 0) bucket.otDays += 1;
  }
  return byDept;
}

(async () => {
  const { startDate, endDate, month, year, daysFilter } = parseArgs();
  const filterDays = daysFilter || [];

  console.log(`\n=== Dept rules test: ${startDate} → ${endDate} ===`);
  console.log(`Base URL: ${BASE_URL}\n`);

  const [attendancePayload, employeesPayload, transactionsPayload] = await Promise.all([
    fetchJson(
      `/api/table/attendance?start_date=${startDate}&end_date=${endDate}`
    ),
    fetchJson("/api/data/employees?all_pages=true&max_pages=200"),
    fetchJson(
      month && year
        ? `/api/data/transactions?month=${month}&year=${year}`
        : `/api/data/transactions?start_date=${startDate}&end_date=${endDate}`
    ),
  ]);

  const rows = (attendancePayload.rows || []).filter((row) => {
    if (!filterDays.length) return true;
    return filterDays.includes(dayFromDate(row.date));
  });
  const employees = employeesPayload.rows || [];
  const transactions = transactionsPayload.rows || [];

  const byClassified = new Map();
  for (const row of rows) {
    const deptName = row.department || "unknown";
    const deptKey = classifyDepartment(deptName);
    const bucketKey = `${deptKey}::${deptName}`;
    if (!byClassified.has(bucketKey)) {
      byClassified.set(bucketKey, { deptName, deptKey, rows: [] });
    }
    byClassified.get(bucketKey).rows.push(row);
  }

  const summaries = [...byClassified.values()]
    .map(({ deptName, deptKey, rows: deptRows }) => summarizeDept(deptName, deptKey, deptRows))
    .sort((a, b) => a.deptKey.localeCompare(b.deptKey) || a.deptName.localeCompare(b.deptName));

  let totalFlagged = 0;
  for (const summary of summaries) {
    totalFlagged += summary.flagged.length;
    console.log(`--- ${summary.deptName} [${summary.deptKey}] ---`);
    console.log(`  employees: ${summary.employees}  detail rows: ${summary.totalRows}`);
    console.log(`  by date: ${JSON.stringify(summary.byDate)}`);
    console.log(`  shifts: ${JSON.stringify(summary.shiftCounts)}`);
    console.log(`  OT rows: ${summary.otTotal.rows}  OT hours: ${summary.otTotal.hours.toFixed(1)}`);
    console.log(`  flagged: ${summary.flagged.length}`);

    if (summary.flagged.length) {
      const top = summary.flagged.slice(0, 15);
      for (const item of top) {
        console.log(
          `    ${item.date} ${item.emp} ${item.name} | ${item.in}→${item.out} | ${item.hours} | ${item.shift} OT=${item.ot} | ${item.flags.join(", ")}`
        );
      }
      if (summary.flagged.length > 15) {
        console.log(`    ... +${summary.flagged.length - 15} more flagged rows`);
      }
    }
    console.log("");
  }

  if (month && year) {
    const report = processAttendance({
      employees,
      transactions,
      month,
      year,
      shiftMaster: runtimeStore.getShifts() || defaultShiftMaster,
      weekoffRows: runtimeStore.getWeekoffs() || [],
      scheduleRows: runtimeStore.getSchedules() || [],
    });

    const monthlySlice = buildMonthlySlice(report, filterDays.length ? filterDays : [7, 8, 9, 10]);
    const monthlyByDept = summarizeMonthlyByDept(monthlySlice);

    console.log("=== Monthly / Excel consolidated (days " + (filterDays.join(",") || "7-10") + ") ===");
    for (const [deptName, bucket] of [...monthlyByDept.entries()].sort()) {
      const deptKey = classifyDepartment(deptName);
      console.log(`--- ${deptName} [${deptKey}] ---`);
      console.log(`  present cells: ${bucket.entries.length}  composite shifts: ${bucket.composite}  OT days: ${bucket.otDays}`);

      const composites = bucket.entries.filter((e) =>
        ["AC", "AB", "BC", "CA", "A4C4"].includes(e.code)
      );
      for (const entry of composites.slice(0, 10)) {
        console.log(
          `    day ${entry.day} ${entry.employeeId} ${entry.employeeName} → ${entry.display} OT=${entry.ot} hrs=${entry.hours ?? "-"}`
        );
      }
      if (composites.length > 10) {
        console.log(`    ... +${composites.length - 10} more composite days`);
      }
      console.log("");
    }
  }

  const reportPath = path.join(
    __dirname,
    `../test-output/dept-rules-${startDate}_to_${endDate}.json`
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        range: { startDate, endDate },
        totals: {
          detail_rows: rows.length,
          employees: employees.length,
          transactions: transactions.length,
          flagged_rows: totalFlagged,
        },
        departments: summaries.map((s) => ({
          deptName: s.deptName,
          deptKey: s.deptKey,
          employees: s.employees,
          totalRows: s.totalRows,
          byDate: s.byDate,
          shiftCounts: s.shiftCounts,
          otTotal: s.otTotal,
          flagged: s.flagged,
        })),
      },
      null,
      2
    )
  );

  console.log(`Full report: ${reportPath}`);
  console.log(`\nSummary: ${rows.length} detail rows, ${totalFlagged} flagged, ${summaries.length} dept groups\n`);
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
