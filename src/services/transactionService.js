const httpClient = require("./httpClient");
const { authenticate } = require("./authService");
const { transactionEndpoint } = require("../config/biotime");
const { formatDateTimeForApi } = require("../utils/dateUtils");

function getTransactionKey(txn) {
  return String(
    txn?.id ||
      txn?.uuid ||
      txn?.transaction_id ||
      `${txn?.emp_code || txn?.employee_id || ""}|${txn?.punch_time || txn?.timestamp || ""}|${
        txn?.terminal_sn || txn?.terminal_alias || ""
      }`
  );
}

async function fetchTransactions({ startTime, endTime, includeMeta = false }) {
  const auth = await authenticate();
  const transactions = [];
  const transactionMap = new Map();
  let nextUrl = transactionEndpoint;
  let page = 1;
  let pagesFetched = 0;
  let expectedCount = null;

  const formattedStart = formatDateTimeForApi(startTime);
  const formattedEnd = formatDateTimeForApi(endTime);

  while (nextUrl) {
    try {
      const isFirstPage = nextUrl === transactionEndpoint;
      const requestConfig = {
        headers: { Authorization: auth.authorization },
      };

      if (isFirstPage) {
        requestConfig.params = {
          start_time: formattedStart,
          end_time: formattedEnd,
          page,
          page_size: 200,
          ordering: "id",
        };
      }

      const response = await httpClient.get(nextUrl, requestConfig);

      const data = response.data || {};
      if (expectedCount === null && Number.isFinite(Number(data?.count))) {
        expectedCount = Number(data.count);
      }
      const rows = data.results || data.data || [];
      transactions.push(...rows);
      for (const row of rows) {
        transactionMap.set(getTransactionKey(row), row);
      }
      pagesFetched += 1;

      if (data.next) {
        nextUrl = data.next;
        page += 1;
      } else {
        nextUrl = null;
      }
    } catch (error) {
      const status = error?.response?.status || "NA";
      const details = JSON.stringify(error?.response?.data || {});
      throw new Error(
        `Failed to fetch transactions (${status}). start_time='${formattedStart}', end_time='${formattedEnd}', page=${page}, details=${details}`
      );
    }
  }

  const uniqueTransactions = [...transactionMap.values()];
  const meta = {
    expected_count: expectedCount,
    fetched_rows: transactions.length,
    unique_rows: uniqueTransactions.length,
    pages_fetched: pagesFetched,
    completed_all_pages: true,
    verified_by_count:
      expectedCount === null ? null : uniqueTransactions.length >= expectedCount,
  };

  if (includeMeta) {
    return {
      rows: uniqueTransactions,
      meta,
    };
  }
  return uniqueTransactions;
}

module.exports = {
  fetchTransactions,
};
