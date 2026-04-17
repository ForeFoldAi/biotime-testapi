const { applyMepRules } = require("../rules/mepRules");
const { applySecurityRules } = require("../rules/securityRules");
const { applyDriverRules } = require("../rules/driverRules");
const { applyHousekeepingRules } = require("../rules/housekeepingRules");
const { applyLandscapeRules } = require("../rules/landscapeRules");

function normalizeDepartmentForRules(department) {
  const value = String(department || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (
    value.includes("LANDSCAPE") ||
    value.includes("PEST") ||
    value.includes("GARDNER") ||
    value.includes("GARDNERS") ||
    value.includes("GARDEN")
  ) {
    return "LANDSCAPE";
  }
  return String(department || "").toUpperCase();
}

function applyRuleForDepartment(department, dailyRecord) {
  const normalizedDepartment = normalizeDepartmentForRules(department);
  switch (normalizedDepartment) {
    case "SECURITY":
      return applySecurityRules(dailyRecord);
    case "DRIVER":
      return applyDriverRules(dailyRecord);
    case "HOUSEKEEPING":
      return applyHousekeepingRules(dailyRecord);
    case "LANDSCAPE":
      return applyLandscapeRules(dailyRecord);
    case "MEP":
    default:
      return applyMepRules(dailyRecord);
  }
}

module.exports = {
  applyRuleForDepartment,
  normalizeDepartmentForRules,
};
