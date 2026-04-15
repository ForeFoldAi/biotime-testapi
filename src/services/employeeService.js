const httpClient = require("./httpClient");
const { authenticate } = require("./authService");
const { employeeEndpoint } = require("../config/biotime");

function buildPageRange(startPage, endPage) {
  const start = Number(startPage || 1);
  const end = Number(endPage || 5);
  const pages = [];
  for (let page = start; page <= end; page += 1) pages.push(page);
  return pages;
}

function parseBoolean(value) {
  return String(value || "")
    .trim()
    .toLowerCase() === "true";
}

function dedupeEmployees(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const key = String(
      row?.id || row?.employee_id || row?.emp_code || row?.code || JSON.stringify(row)
    );
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}

async function fetchEmployees(options = {}) {
  const auth = await authenticate();
  const allPages = options.allPages === undefined ? true : parseBoolean(options.allPages);
  const maxPages = Number(options.maxPages || 50);
  const startPage = Number(options.startPage || 1);
  const endPage = Number(options.endPage || 5);
  const pageSize = options.pageSize ? Number(options.pageSize) : undefined;
  const includeMeta = options.includeMeta === true;
  const employees = [];
  let expectedCount = null;
  let pagesFetched = 0;

  if (allPages) {
    let nextUrl = employeeEndpoint;
    let page = startPage;
    let pagesFetched = 0;

    while (nextUrl && pagesFetched < maxPages) {
      try {
        const isFirstPage = nextUrl === employeeEndpoint;
        const requestConfig = {
          headers: { Authorization: auth.authorization },
        };
        if (isFirstPage) {
          requestConfig.params = { page };
          if (pageSize) requestConfig.params.page_size = pageSize;
        }

        const response = await httpClient.get(nextUrl, requestConfig);
        const payload = response.data || {};
        if (expectedCount === null && Number.isFinite(Number(payload?.count))) {
          expectedCount = Number(payload.count);
        }
        const rows = Array.isArray(payload)
          ? payload
          : Array.isArray(payload.results)
          ? payload.results
          : Array.isArray(payload.data)
          ? payload.data
          : [];
        employees.push(...rows);
        pagesFetched += 1;

        if (payload?.next) {
          nextUrl = payload.next;
          page += 1;
        } else {
          nextUrl = null;
        }
      } catch (error) {
        const status = error?.response?.status || "NA";
        const details = JSON.stringify(error?.response?.data || {});
        throw new Error(
          `Failed to fetch employees (${status}). page=${page}, details=${details}`
        );
      }
    }
  } else {
    const pages = buildPageRange(startPage, endPage);

    for (const page of pages) {
      try {
        const params = { page };
        if (pageSize) params.page_size = pageSize;

        const requestConfig = {
          headers: { Authorization: auth.authorization },
          params,
        };

        const response = await httpClient.get(employeeEndpoint, requestConfig);
        const payload = response.data || {};
        if (expectedCount === null && Number.isFinite(Number(payload?.count))) {
          expectedCount = Number(payload.count);
        }
        const rows = Array.isArray(payload)
          ? payload
          : Array.isArray(payload.results)
          ? payload.results
          : Array.isArray(payload.data)
          ? payload.data
          : [];
        employees.push(...rows);
      } catch (error) {
        const status = error?.response?.status || "NA";
        const details = JSON.stringify(error?.response?.data || {});
        throw new Error(
          `Failed to fetch employees (${status}). page=${page}, details=${details}`
        );
      }
    }
  }

  const uniqueEmployees = dedupeEmployees(employees);
  if (includeMeta) {
    return {
      rows: uniqueEmployees,
      meta: {
        expected_count: expectedCount,
        fetched_rows: employees.length,
        unique_rows: uniqueEmployees.length,
        pages_fetched: pagesFetched || (allPages ? 0 : endPage - startPage + 1),
        completed_all_pages: allPages,
        verified_by_count:
          expectedCount === null ? null : uniqueEmployees.length >= expectedCount,
      },
    };
  }
  return uniqueEmployees;
}

module.exports = {
  fetchEmployees,
};
