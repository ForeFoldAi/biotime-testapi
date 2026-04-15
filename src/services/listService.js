const httpClient = require("./httpClient");
const { authenticate } = require("./authService");

const RESOURCE_ENDPOINTS = {
  areas: "/personnel/api/areas/",
  departments: "/personnel/api/departments/",
  employees: "/personnel/api/employees/",
  locations: "/personnel/api/locations/",
  positions: "/personnel/api/positions/",
  transactions: "/iclock/api/transactions/",
};

function normalizeListPayload(payload) {
  if (Array.isArray(payload)) {
    return {
      count: payload.length,
      next: null,
      previous: null,
      results: payload,
    };
  }

  return {
    count: Number(payload?.count || 0),
    next: payload?.next || null,
    previous: payload?.previous || null,
    results: Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.data)
      ? payload.data
      : [],
  };
}

function parseBoolean(value) {
  return String(value || "")
    .trim()
    .toLowerCase() === "true";
}

function sanitizeQuery(query = {}) {
  const result = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (value === "") continue;
    result[key] = value;
  }
  return result;
}

function dedupeRows(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const key = String(
      row?.id ||
        row?.employee_id ||
        row?.emp_code ||
        row?.dept_code ||
        row?.area_code ||
        row?.position_code ||
        JSON.stringify(row)
    );
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}

async function fetchList(resource, query = {}) {
  const endpoint = RESOURCE_ENDPOINTS[resource];
  if (!endpoint) {
    throw new Error(
      `Unsupported resource '${resource}'. Use one of: ${Object.keys(RESOURCE_ENDPOINTS).join(
        ", "
      )}`
    );
  }

  const auth = await authenticate();
  const queryParams = sanitizeQuery(query);
  const allPages =
    queryParams.all_pages === undefined
      ? resource === "employees"
      : parseBoolean(queryParams.all_pages);
  const maxPages = Number(queryParams.max_pages || (resource === "employees" ? 50 : 5));
  delete queryParams.all_pages;
  delete queryParams.max_pages;

  if (!allPages) {
    try {
      const response = await httpClient.get(endpoint, {
        params: queryParams,
        headers: { Authorization: auth.authorization },
      });
      return normalizeListPayload(response.data || {});
    } catch (error) {
      const status = error?.response?.status || "NA";
      const details = JSON.stringify(error?.response?.data || {});
      throw new Error(
        `Failed to fetch '${resource}' list (${status}). details=${details}`
      );
    }
  }

  const results = [];
  let nextUrl = endpoint;
  let page = Number(queryParams.page || 1);
  let pagesFetched = 0;

  while (nextUrl && pagesFetched < maxPages) {
    try {
      const isFirstPage = nextUrl === endpoint;
      const requestConfig = {
        headers: { Authorization: auth.authorization },
      };
      if (isFirstPage) {
        requestConfig.params = { ...queryParams, page };
      }

      const response = await httpClient.get(nextUrl, requestConfig);
      const normalized = normalizeListPayload(response.data || {});
      results.push(...normalized.results);
      pagesFetched += 1;

      if (normalized.next) {
        nextUrl = normalized.next;
        page += 1;
      } else {
        nextUrl = null;
      }
    } catch (error) {
      const status = error?.response?.status || "NA";
      const details = JSON.stringify(error?.response?.data || {});
      throw new Error(
        `Failed to fetch '${resource}' list (${status}) while paginating. page=${page}, details=${details}`
      );
    }
  }

  return {
    count: dedupeRows(results).length,
    next: null,
    previous: null,
    results: dedupeRows(results),
  };
}

module.exports = {
  RESOURCE_ENDPOINTS,
  fetchList,
};
