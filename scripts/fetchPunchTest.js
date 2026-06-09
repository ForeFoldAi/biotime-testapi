#!/usr/bin/env node
/**
 * Compare BioTime transaction APIs vs derived attendance for one employee.
 *
 * Usage:
 *   node scripts/fetchPunchTest.js AG020034 6 2026
 *   BASE_URL=http://localhost:4000 node scripts/fetchPunchTest.js AG020034 6 2026
 */

const http = require("http");
const https = require("https");

const {
  buildDerivedCheckInOutByDate,
  groupPunchesByEmployeeDate,
} = require("../src/utils/punchGrouping");
const {
  buildEmployeeAliasLookup,
  resolveTransactionEmployeeKey,
} = require("../src/utils/transactionEmployeeUtils");

const BASE_URL = process.env.BASE_URL || "http://localhost:4000";
const [empCode, monthArg, yearArg] = process.argv.slice(2);

if (!empCode || !monthArg || !yearArg) {
  console.error("Usage: node scripts/fetchPunchTest.js <emp_code> <month> <year>");
  process.exit(1);
}

const month = Number(monthArg);
const year = Number(yearArg);
const monthPad = String(month).padStart(2, "0");
const lastDay = new Date(year, month, 0).getDate();

function fetchJson(path) {
  const url = new URL(path, BASE_URL);
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
            reject(new Error(`Invalid JSON from ${path}: ${data.slice(0, 300)}`));
          }
        });
      })
      .on("error", reject);
  });
}

function groupByDate(transactions, employees) {
  const { aliasToCanonical } = buildEmployeeAliasLookup(employees);
  const groups = groupPunchesByEmployeeDate(transactions, (transaction) =>
    resolveTransactionEmployeeKey(transaction, aliasToCanonical)
  );
  const derivedByDate = buildDerivedCheckInOutByDate(groups);

  const byDate = new Map();
  groups.forEach((group, key) => {
    if (!key.startsWith(`${empCode}|`)) return;
    byDate.set(group.punch_date, {
      raw: group,
      derived: derivedByDate.get(key),
    });
  });
  return byDate;
}

(async () => {
  const startTime = `${year}-${monthPad}-01 00:00:00`;
  const endTime = `${year}-${monthPad}-${String(lastDay).padStart(2, "0")} 23:59:59`;

  const [employeesPayload, transactionsPayload, listPayload, tablePayload, checkinsPayload] =
    await Promise.all([
      fetchJson("/api/data/employees?all_pages=true&max_pages=200"),
      fetchJson(`/api/data/transactions?month=${month}&year=${year}`),
      fetchJson(
        `/api/list/transactions?emp_code=${encodeURIComponent(empCode)}&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}&all_pages=true&max_pages=200`
      ),
      fetchJson(`/api/table/attendance?month=${month}&year=${year}`),
      fetchJson(`/attendance/checkins?month=${month}&year=${year}`),
    ]);

  const employees = employeesPayload.rows || [];
  const allTransactions = transactionsPayload.rows || [];
  const listTransactions = listPayload.results || [];
  const dataTransactions = allTransactions.filter((row) => row.emp_code === empCode);
  const tableRows = (tablePayload.rows || []).filter((row) => row.employee_code === empCode);
  const checkinRow = (checkinsPayload.rows || []).find(
    (row) => row.employee_id === empCode || row.employee_code === empCode
  );

  const groupedFromDataApi = groupByDate(allTransactions, employees);
  const groupedFromListApi = groupByDate(listTransactions, employees);

  console.log(`\nPunch test: ${empCode} — ${year}-${monthPad}`);
  console.log(`Base URL: ${BASE_URL}\n`);

  console.log("=== Raw transaction counts ===");
  console.log(`  /api/data/transactions (emp filter): ${dataTransactions.length}`);
  console.log(`  /api/list/transactions?emp_code=...: ${listTransactions.length}`);
  console.log(`  Match: ${dataTransactions.length === listTransactions.length ? "YES" : "NO"}`);

  console.log("\n=== Raw punches from /api/data/transactions ===");
  dataTransactions
    .sort((a, b) => String(a.punch_time).localeCompare(String(b.punch_time)))
    .forEach((row) => {
      console.log(
        `  ${row.punch_time}  ${String(row.terminal_alias || "-").padEnd(14)}  id=${row.id}  emp=${row.emp_code}`
      );
    });

  console.log("\n=== Derived vs /api/table/attendance ===");
  const dates = new Set([
    ...tableRows.map((row) => row.date),
    ...groupedFromDataApi.keys(),
  ]);

  [...dates].sort().forEach((date) => {
    const table = tableRows.find((row) => row.date === date);
    const local = groupedFromDataApi.get(date)?.derived;
    console.log(`\n  ${date}`);
    console.log(
      `    local grouping: in=${local?.check_in_raw || "-"} out=${local?.check_out_raw || "-"} punches=${local?.punch_count ?? 0} resolution=${local?.resolution || "-"}`
    );
    console.log(
      `    attendance table: in=${table?.check_in || "-"} out=${table?.check_out || "-"} punches=${table?.punch_count ?? "-"} status=${table?.attendance_status || "-"}`
    );
    const match =
      (local?.check_in_raw || "") === (table?.check_in || "") &&
      (local?.check_out_raw || "") === (table?.check_out || "") &&
      local?.punch_count === table?.punch_count;
    console.log(`    table matches local logic: ${match ? "YES" : "NO"}`);
  });

  console.log("\n=== /attendance/checkins ===");
  (checkinRow?.attendance || [])
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((row) => {
      console.log(
        `  ${row.date}  in=${row.check_in || "-"}  out=${row.check_out || "-"}  punches=${row.punch_count}`
      );
    });

  const mismatchedIds = [160619839];
  console.log("\n=== Known cross-employee punches ===");
  for (const id of mismatchedIds) {
    const row = allTransactions.find((item) => Number(item.id) === id);
    if (row) {
      console.log(
        `  id ${id}: ${row.punch_time} ${row.terminal_alias} belongs to ${row.emp_code} (not ${empCode})`
      );
    }
  }

  console.log("\nDone.\n");
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
