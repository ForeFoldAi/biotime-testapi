const httpClient = require("./httpClient");
const { authenticate } = require("./authService");
const { departmentEndpoint } = require("../config/biotime");

async function fetchDepartments() {
  const auth = await authenticate();
  const departments = [];
  let nextUrl = departmentEndpoint;
  let page = 1;

  while (nextUrl) {
    try {
      const isFirstPage = nextUrl === departmentEndpoint;
      const requestConfig = {
        headers: { Authorization: auth.authorization },
      };
      if (isFirstPage) {
        requestConfig.params = { page };
      }

      const response = await httpClient.get(nextUrl, requestConfig);
      const payload = response.data || {};
      const rows = Array.isArray(payload)
        ? payload
        : Array.isArray(payload.results)
        ? payload.results
        : Array.isArray(payload.data)
        ? payload.data
        : [];
      departments.push(...rows);

      if (Array.isArray(payload) || !payload.next) {
        nextUrl = null;
      } else {
        nextUrl = payload.next;
        page += 1;
      }
    } catch (error) {
      const status = error?.response?.status || "NA";
      if (status === 404) return [];
      const details = JSON.stringify(error?.response?.data || {});
      throw new Error(
        `Failed to fetch departments (${status}). page=${page}, details=${details}`
      );
    }
  }

  return departments;
}

module.exports = {
  fetchDepartments,
};
