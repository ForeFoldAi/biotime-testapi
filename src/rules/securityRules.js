function applySecurityRules(dailyRecord) {
  const code = dailyRecord.detectedCode || dailyRecord.shiftCodes?.[0] || "L";

  if (code === "A4C4") {
    return { code: "A4C4", otHours: 4, otIndicator: "EXT4" };
  }

  if (code === "G") {
    return { code: "G", otHours: 0, otIndicator: "" };
  }

  if (["A4", "C4"].includes(code) && (dailyRecord.workingHours || 0) >= 8) {
    return { code, otHours: 4, otIndicator: "EXT4" };
  }

  return { code, otHours: 0, otIndicator: "" };
}

module.exports = { applySecurityRules };
