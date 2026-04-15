function applyHousekeepingRules(dailyRecord) {
  const code = dailyRecord.detectedCode || dailyRecord.shiftCodes?.[0] || "L";
  const workingHours = dailyRecord.workingHours || 0;
  const isContinuousMultiShift = ["AB", "BC", "AC", "ABC"].includes(code);

  if (code === "G") {
    return { code: "G", otHours: 0, otIndicator: "" };
  }

  if (isContinuousMultiShift && workingHours >= 6) {
    return {
      code,
      otHours: Math.round((workingHours - 8) * 100) / 100,
      otIndicator: "CONT",
    };
  }

  return { code, otHours: 0, otIndicator: "" };
}

module.exports = { applyHousekeepingRules };
