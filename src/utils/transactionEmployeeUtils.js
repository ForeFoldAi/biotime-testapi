function getCanonicalEmployeeId(employee) {
  return String(
    employee?.emp_code ||
      employee?.employee_id ||
      employee?.id ||
      employee?.code ||
      employee?.badgenumber ||
      employee?.emp ||
      ""
  ).trim();
}

function buildEmployeeAliasLookup(employees = []) {
  const aliasToCanonical = new Map();
  const employeesByCanonical = new Map();

  for (const employee of employees) {
    const canonical = getCanonicalEmployeeId(employee);
    if (!canonical) continue;

    employeesByCanonical.set(canonical, employee);
    const aliases = [
      employee?.emp_code,
      employee?.employee_id,
      employee?.id,
      employee?.emp,
      employee?.code,
      employee?.badgenumber,
    ];

    for (const alias of aliases) {
      const key = String(alias || "").trim();
      if (key) aliasToCanonical.set(key, canonical);
    }
  }

  return { aliasToCanonical, employeesByCanonical };
}

/**
 * Resolve the employee for a punch transaction.
 * Never uses transaction.id — that is the punch record id, not the employee.
 */
function resolveTransactionEmployeeKey(transaction, aliasToCanonical) {
  const candidates = [
    transaction?.emp_code,
    transaction?.employee_id,
    transaction?.employee_code,
    transaction?.emp,
    transaction?.badgenumber,
    transaction?.code,
  ];

  for (const candidate of candidates) {
    const key = String(candidate || "").trim();
    if (!key) continue;
    if (aliasToCanonical?.has(key)) return aliasToCanonical.get(key);
  }

  return "";
}

module.exports = {
  buildEmployeeAliasLookup,
  getCanonicalEmployeeId,
  resolveTransactionEmployeeKey,
};
