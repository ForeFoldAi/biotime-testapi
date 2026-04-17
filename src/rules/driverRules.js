const { applySecurityRules } = require("./securityRules");

function applyDriverRules(dailyRecord) {
  return applySecurityRules(dailyRecord);
}

module.exports = { applyDriverRules };
