function getRawPunchTime(transaction) {
  return (
    transaction?.punch_time ||
    transaction?.timestamp ||
    transaction?.transaction_time ||
    transaction?.punch_datetime
  );
}

function splitPunchTime(rawValue) {
  const text = String(rawValue || "").trim();
  const spaceIndex = text.indexOf(" ");
  if (spaceIndex <= 0) return null;

  const punch_date = text.slice(0, spaceIndex).trim();
  const punch_time_only = text.slice(spaceIndex + 1).trim();
  if (!punch_date || !punch_time_only) return null;

  return { punch_date, punch_time_only, raw: text };
}

function timeOnlyToSeconds(timeOnly) {
  const parts = String(timeOnly || "")
    .trim()
    .split(":")
    .map(Number);
  if (parts.length < 2 || parts.some((value) => !Number.isFinite(value))) return null;

  const [hours, minutes, seconds = 0] = parts;
  return hours * 3600 + minutes * 60 + seconds;
}

function hoursBetweenTimeOnly(startTime, endTime) {
  const startSeconds = timeOnlyToSeconds(startTime);
  const endSeconds = timeOnlyToSeconds(endTime);
  if (startSeconds == null || endSeconds == null) return 0;
  return Math.max(0, (endSeconds - startSeconds) / 3600);
}

function toDateTimeFromParts(punchDate, punchTimeOnly) {
  return new Date(`${punchDate}T${punchTimeOnly}`);
}

function groupPunchesByEmployeeDate(transactions, getEmployeeKey) {
  const grouped = new Map();

  for (const transaction of transactions || []) {
    const rawValue = getRawPunchTime(transaction);
    const split = splitPunchTime(rawValue);
    if (!split) continue;

    const employeeKey = getEmployeeKey(transaction);
    if (!employeeKey) continue;

    const key = `${employeeKey}|${split.punch_date}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        employeeKey,
        punch_date: split.punch_date,
        punches: [],
      });
    }

    grouped.get(key).punches.push({
      punch_time_only: split.punch_time_only,
      raw: split.raw,
    });
  }

  return grouped;
}

function deriveCheckInOut(group) {
  const punches = group?.punches || [];
  const punch_count = punches.length;
  if (punch_count === 0) return null;

  const sorted = [...punches].sort((left, right) => {
    const leftSeconds = timeOnlyToSeconds(left.punch_time_only) ?? 0;
    const rightSeconds = timeOnlyToSeconds(right.punch_time_only) ?? 0;
    return leftSeconds - rightSeconds;
  });

  const checkInPunch = sorted[0];
  const checkOutPunch = sorted[punch_count - 1];
  const check_in = checkInPunch.punch_time_only;
  const check_out = checkOutPunch.punch_time_only;
  const checkIn = toDateTimeFromParts(group.punch_date, check_in);
  const checkOut = toDateTimeFromParts(group.punch_date, check_out);

  if (punch_count === 1) {
    return {
      punch_date: group.punch_date,
      employeeKey: group.employeeKey,
      check_in,
      check_out,
      check_in_raw: checkInPunch.raw,
      check_out_raw: checkOutPunch.raw,
      checkIn,
      checkOut,
      working_hours: 0,
      punch_count: 1,
      punchAttendanceStatus: "Missing Punch",
    };
  }

  return {
    punch_date: group.punch_date,
    employeeKey: group.employeeKey,
    check_in,
    check_out,
    check_in_raw: checkInPunch.raw,
    check_out_raw: checkOutPunch.raw,
    checkIn,
    checkOut,
    working_hours: hoursBetweenTimeOnly(check_in, check_out),
    punch_count,
    punchAttendanceStatus: "Present",
  };
}

module.exports = {
  deriveCheckInOut,
  getRawPunchTime,
  groupPunchesByEmployeeDate,
  hoursBetweenTimeOnly,
  splitPunchTime,
  timeOnlyToSeconds,
  toDateTimeFromParts,
};
