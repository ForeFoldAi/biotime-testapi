function applyMepRules(dailyRecord) {
  const shiftCodes = dailyRecord.shiftCodes || [];
  const hasGeneral = shiftCodes.includes("G");
  const hasABC = ["A", "B", "C"].some((code) => shiftCodes.includes(code));

  if (hasGeneral && !hasABC) {
    const extraHours = Math.max(0, (dailyRecord.workingHours || 0) - 9);
    const otEligible = extraHours >= 3;
    return {
      code: "G",
      otHours: otEligible ? Math.round(extraHours * 100) / 100 : 0,
      otIndicator: otEligible ? "PPP" : "",
    };
  }

  const normalized = dailyRecord.detectedCode || "";
  if (normalized === "AC") {
    return { code: "AC", otHours: dailyRecord.workingHours || 0, otIndicator: "DS" };
  }
  if (normalized === "ABC") {
    return { code: "ABC", otHours: dailyRecord.workingHours || 0, otIndicator: "TS" };
  }
  if (normalized === "AB" || normalized === "BC") {
    return { code: normalized, otHours: dailyRecord.workingHours || 0, otIndicator: "DS" };
  }

  return {
    code: normalized || (shiftCodes[0] || "L"),
    otHours: 0,
    otIndicator: "",
  };
}

module.exports = { applyMepRules };
