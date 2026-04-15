const { applyMepRules } = require("../rules/mepRules");
const { applySecurityRules } = require("../rules/securityRules");
const { applyHousekeepingRules } = require("../rules/housekeepingRules");
const { applyLandscapeRules } = require("../rules/landscapeRules");

function applyRuleForDepartment(department, dailyRecord) {
  switch (department) {
    case "SECURITY":
      return applySecurityRules(dailyRecord);
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
};
