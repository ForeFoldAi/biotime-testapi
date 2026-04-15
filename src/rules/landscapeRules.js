function applyLandscapeRules(dailyRecord) {
  const code = dailyRecord.detectedCode || "L";
  if (code === "G") return { code: "G", otHours: 0, otIndicator: "" };
  return { code: code || "L", otHours: 0, otIndicator: "" };
}

module.exports = { applyLandscapeRules };
