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

function hoursBetweenDateTimes(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  return Math.max(0, (checkOut.getTime() - checkIn.getTime()) / 3600000);
}

function toDateTimeFromParts(punchDate, punchTimeOnly) {
  return new Date(`${punchDate}T${punchTimeOnly}`);
}

function addDaysToDateString(dateStr, days) {
  const date = new Date(`${dateStr}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function sortPunchesByTime(punches) {
  return [...punches].sort((left, right) => {
    const leftSeconds = timeOnlyToSeconds(left.punch_time_only) ?? 0;
    const rightSeconds = timeOnlyToSeconds(right.punch_time_only) ?? 0;
    return leftSeconds - rightSeconds;
  });
}

const AUTO_ADD_CHECKOUT_FROM_HOUR = 15;
const C_SHIFT_CHECKIN_FROM_SECONDS = 19 * 3600 + 60;
/** Cross-midnight checkout on next calendar day: Out Gate through 09:00 inclusive. */
const MORNING_CHECKOUT_UNTIL_SECONDS = 9 * 3600;

function isAutoAddTerminal(alias) {
  return String(alias || "").trim().toLowerCase() === "auto add";
}

function inferSingleAutoAddSide(punch) {
  const seconds = timeOnlyToSeconds(punch?.punch_time_only);
  if (seconds == null) return null;
  return seconds < AUTO_ADD_CHECKOUT_FROM_HOUR * 3600 ? "in" : "out";
}

/**
 * BioTime punch_state: 0 = check-in, 1 = check-out.
 * Falls back to terminal_alias patterns such as "CT In Gate" / "CT Out Gate".
 */
function classifyPunchDirection(transaction) {
  const punchState = String(transaction?.punch_state ?? "").trim();
  if (punchState === "0") return "in";
  if (punchState === "1") return "out";

  const alias = String(transaction?.terminal_alias || "").trim().toLowerCase();
  if (!alias) return null;

  if (/\bout[\s_-]*gate\b/.test(alias) || /\bcheck[\s_-]*out\b/.test(alias)) return "out";
  if (/\bin[\s_-]*gate\b/.test(alias) || /\bcheck[\s_-]*in\b/.test(alias)) return "in";

  return null;
}

function getPunchKind(punch) {
  if (isAutoAddTerminal(punch?.terminal_alias)) return "auto_add";
  if (punch?.direction === "in") return "in_gate";
  if (punch?.direction === "out") return "out_gate";
  return "other";
}

function punchKey(punch) {
  return punch?.raw || `${punch?.punch_time_only}|${punch?.terminal_alias}`;
}

function isCheckInLike(punch) {
  const kind = getPunchKind(punch);
  if (kind === "in_gate") return true;
  if (kind === "auto_add") return inferSingleAutoAddSide(punch) === "in";
  return punch?.direction === "in";
}

function isCheckOutLike(punch) {
  const kind = getPunchKind(punch);
  if (kind === "out_gate") return true;
  if (kind === "auto_add") return inferSingleAutoAddSide(punch) === "out";
  return punch?.direction === "out";
}

function isEveningShiftCheckIn(punch) {
  if (!isCheckInLike(punch)) return false;
  const seconds = timeOnlyToSeconds(punch?.punch_time_only);
  if (seconds == null) return false;
  return seconds >= C_SHIFT_CHECKIN_FROM_SECONDS || seconds <= 4 * 3600;
}

function isMorningCheckoutPunch(punch) {
  if (!isCheckOutLike(punch)) return false;
  const seconds = timeOnlyToSeconds(punch?.punch_time_only);
  if (seconds == null) return false;
  return seconds <= MORNING_CHECKOUT_UNTIL_SECONDS;
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
      terminal_sn: String(transaction?.terminal_sn || "").trim(),
      terminal_alias: String(transaction?.terminal_alias || "").trim(),
      area_alias: String(transaction?.area_alias || "").trim(),
      punch_state: transaction?.punch_state,
      direction: classifyPunchDirection(transaction),
    });
  }

  return grouped;
}

function collectUsedPunches(result) {
  const used = new Set();
  if (result?.checkInPunch) used.add(punchKey(result.checkInPunch));
  if (result?.checkOutPunch) used.add(punchKey(result.checkOutPunch));
  return used;
}

function findMorningCheckoutOnNextDay(nextDayGroup, consumedNextDayKeys) {
  if (!nextDayGroup?.punches?.length) return null;

  const sorted = sortPunchesByTime(nextDayGroup.punches);
  for (const punch of sorted) {
    if (consumedNextDayKeys?.has(punchKey(punch))) continue;
    if (isMorningCheckoutPunch(punch)) return punch;
  }
  return null;
}

function attachCrossMidnightCheckout(session, nextDayGroup, consumedNextDayKeys) {
  if (
    !session?.checkInPunch ||
    session.checkOutPunch ||
    !isEveningShiftCheckIn(session.checkInPunch) ||
    !nextDayGroup
  ) {
    return session;
  }

  const morningCheckout = findMorningCheckoutOnNextDay(nextDayGroup, consumedNextDayKeys);
  if (!morningCheckout) return session;

  consumedNextDayKeys?.add(punchKey(morningCheckout));
  return {
    checkInPunch: session.checkInPunch,
    checkOutPunch: morningCheckout,
    checkOutDate: nextDayGroup.punch_date,
    resolution: "cross_midnight_c",
  };
}

function resolveCheckInOutPunches(punches) {
  const sorted = sortPunchesByTime(punches);
  const autoAdds = sorted.filter((punch) => getPunchKind(punch) === "auto_add");
  const inGates = sorted.filter((punch) => getPunchKind(punch) === "in_gate");
  const outGates = sorted.filter((punch) => getPunchKind(punch) === "out_gate");
  const others = sorted.filter((punch) => getPunchKind(punch) === "other");

  if (sorted.length === 1 && autoAdds.length === 1) {
    const side = inferSingleAutoAddSide(autoAdds[0]);
    if (side === "in") {
      return {
        checkInPunch: autoAdds[0],
        checkOutPunch: null,
        resolution: "single_auto_add_in",
      };
    }
    if (side === "out") {
      return {
        checkInPunch: null,
        checkOutPunch: autoAdds[0],
        resolution: "single_auto_add_out",
      };
    }
    return {
      checkInPunch: null,
      checkOutPunch: null,
      resolution: "single_auto_add",
    };
  }

  if (inGates.length > 0 && outGates.length > 0) {
    const checkInPunch = inGates[0];
    const inSeconds = timeOnlyToSeconds(checkInPunch.punch_time_only) ?? 0;
    const validOutGates = outGates.filter(
      (punch) => (timeOnlyToSeconds(punch.punch_time_only) ?? 0) > inSeconds
    );
    if (validOutGates.length > 0) {
      return {
        checkInPunch,
        checkOutPunch: validOutGates[validOutGates.length - 1],
        resolution: "in_gate+out_gate",
      };
    }
  }

  if (autoAdds.length > 0 && outGates.length > 0) {
    return {
      checkInPunch: autoAdds[0],
      checkOutPunch: outGates[outGates.length - 1],
      resolution: "auto_add+out_gate",
    };
  }

  if (inGates.length > 0 && autoAdds.length > 0) {
    return {
      checkInPunch: inGates[0],
      checkOutPunch: autoAdds[autoAdds.length - 1],
      resolution: "in_gate+auto_add",
    };
  }

  if (autoAdds.length >= 2 && inGates.length === 0 && outGates.length === 0) {
    return {
      checkInPunch: autoAdds[0],
      checkOutPunch: autoAdds[autoAdds.length - 1],
      resolution: "auto_add+auto_add",
    };
  }

  if (inGates.length >= 2 && outGates.length === 0 && autoAdds.length === 0) {
    return {
      checkInPunch: inGates[0],
      checkOutPunch: null,
      resolution: "in_gate+in_gate",
    };
  }

  if (outGates.length >= 2 && inGates.length === 0 && autoAdds.length === 0) {
    return {
      checkInPunch: null,
      checkOutPunch: outGates[outGates.length - 1],
      resolution: "out_gate+out_gate",
    };
  }

  if (inGates.length === 1 && sorted.length === 1) {
    return {
      checkInPunch: inGates[0],
      checkOutPunch: null,
      resolution: "single_in_gate",
    };
  }

  if (outGates.length === 1 && sorted.length === 1) {
    return {
      checkInPunch: null,
      checkOutPunch: outGates[0],
      resolution: "single_out_gate",
    };
  }

  if (others.length >= 2 && autoAdds.length === 0 && inGates.length === 0 && outGates.length === 0) {
    return {
      checkInPunch: others[0],
      checkOutPunch: others[others.length - 1],
      resolution: "time",
    };
  }

  return {
    checkInPunch: null,
    checkOutPunch: null,
    resolution: "unmatched",
  };
}

function resolveSessionsForDay(punches, nextDayGroup, consumedNextDayKeys) {
  const sessions = [];
  let remaining = sortPunchesByTime(punches);
  let used = new Set();

  const first = resolveCheckInOutPunches(remaining);
  if (first.checkInPunch || first.checkOutPunch) {
    sessions.push({
      ...first,
      checkOutDate: null,
    });
    used = collectUsedPunches(first);
    remaining = remaining.filter((punch) => !used.has(punchKey(punch)));
  }

  // Single evening check-in with no same-day checkout (e.g. Jun 8 → Jun 9 morning out).
  if (sessions.length === 1) {
    sessions[0] = attachCrossMidnightCheckout(sessions[0], nextDayGroup, consumedNextDayKeys);
  }

  // Extra evening check-in after an earlier same-day session (e.g. Jun 6 B + C OT).
  if (remaining.length > 0) {
    const eveningCheckIn = remaining.find((punch) => isEveningShiftCheckIn(punch));
    if (eveningCheckIn) {
      const crossMidnight = attachCrossMidnightCheckout(
        { checkInPunch: eveningCheckIn, checkOutPunch: null, checkOutDate: null, resolution: "evening_checkin" },
        nextDayGroup,
        consumedNextDayKeys
      );
      if (crossMidnight.checkOutPunch) {
        sessions.push(crossMidnight);
        remaining = remaining.filter((punch) => punchKey(punch) !== punchKey(eveningCheckIn));
      }
    }
  }

  if (remaining.length > 0) {
    const onlyDuplicateIns =
      remaining.every(isCheckInLike) && sessions.some((session) => session.checkInPunch && !session.checkOutPunch);
    const onlyDuplicateOuts =
      remaining.every(isCheckOutLike) && sessions.some((session) => session.checkOutPunch && !session.checkInPunch);

    if (!onlyDuplicateIns && !onlyDuplicateOuts) {
      const extra = resolveCheckInOutPunches(remaining);
      if (extra.checkInPunch || extra.checkOutPunch) {
        sessions.push({
          ...extra,
          checkOutDate: null,
        });
      }
    }
  }

  return sessions;
}

function mergeSessionsToCheckInOut(sessions, punchDate) {
  if (!sessions.length) {
    return {
      checkInPunch: null,
      checkOutPunch: null,
      checkOutDate: null,
      resolution: "unmatched",
    };
  }

  if (sessions.length === 1) {
    return {
      checkInPunch: sessions[0].checkInPunch,
      checkOutPunch: sessions[0].checkOutPunch,
      checkOutDate: sessions[0].checkOutDate || punchDate,
      resolution: sessions[0].resolution,
    };
  }

  const first = sessions[0];
  const last = sessions[sessions.length - 1];
  const stitched =
    first.checkInPunch &&
    last.checkOutPunch &&
    sessions.some((session) => session.resolution === "cross_midnight_c");

  if (stitched) {
    return {
      checkInPunch: first.checkInPunch,
      checkOutPunch: last.checkOutPunch,
      checkOutDate: last.checkOutDate || punchDate,
      resolution: "multi_session_stitched",
    };
  }

  const withBoth = sessions.find((session) => session.checkInPunch && session.checkOutPunch);
  if (withBoth) {
    return {
      checkInPunch: withBoth.checkInPunch,
      checkOutPunch: withBoth.checkOutPunch,
      checkOutDate: withBoth.checkOutDate || punchDate,
      resolution: withBoth.resolution,
    };
  }

  return {
    checkInPunch: first.checkInPunch || last.checkInPunch,
    checkOutPunch: first.checkOutPunch || last.checkOutPunch,
    checkOutDate: (first.checkOutPunch ? first.checkOutDate : last.checkOutDate) || punchDate,
    resolution: sessions.map((session) => session.resolution).join("+"),
  };
}

function deriveCheckInOut(group, options = {}) {
  const punches = group?.punches || [];
  const punch_count = punches.length;
  if (punch_count === 0) return null;

  const { nextDayGroup = null, consumedNextDayKeys = null } = options;
  const sessions = resolveSessionsForDay(punches, nextDayGroup, consumedNextDayKeys);
  const { checkInPunch, checkOutPunch, checkOutDate, resolution } = mergeSessionsToCheckInOut(
    sessions,
    group.punch_date
  );

  const check_in = checkInPunch?.punch_time_only || "";
  const check_out = checkOutPunch?.punch_time_only || "";
  const checkIn = check_in ? toDateTimeFromParts(group.punch_date, check_in) : null;
  const checkoutDate = checkOutPunch ? checkOutDate || group.punch_date : null;
  const checkOut = check_out && checkoutDate ? toDateTimeFromParts(checkoutDate, check_out) : null;
  const working_hours =
    checkIn && checkOut
      ? hoursBetweenDateTimes(checkIn, checkOut)
      : check_in && check_out
        ? hoursBetweenTimeOnly(check_in, check_out)
        : 0;
  const punchAttendanceStatus =
    check_in && check_out ? "Present" : check_in || check_out ? "Missing Punch" : "Missing Punch";

  return {
    punch_date: group.punch_date,
    employeeKey: group.employeeKey,
    check_in,
    check_out,
    check_in_raw: checkInPunch?.raw || "",
    check_out_raw: checkOutPunch?.raw || "",
    check_in_terminal_alias: checkInPunch?.terminal_alias || "",
    check_out_terminal_alias: checkOutPunch?.terminal_alias || "",
    check_in_area_alias: checkInPunch?.area_alias || "",
    check_out_area_alias: checkOutPunch?.area_alias || "",
    checkIn,
    checkOut,
    working_hours,
    punch_count,
    punchAttendanceStatus,
    resolution,
    check_out_date: checkoutDate || "",
  };
}

function buildDerivedCheckInOutByDate(punchGroups) {
  const byEmployee = new Map();

  for (const group of punchGroups.values()) {
    if (!byEmployee.has(group.employeeKey)) {
      byEmployee.set(group.employeeKey, new Map());
    }
    byEmployee.get(group.employeeKey).set(group.punch_date, group);
  }

  const derivedMap = new Map();
  const consumedByEmployeeDate = new Map();

  for (const [employeeKey, dateMap] of byEmployee) {
    const dates = [...dateMap.keys()].sort();

    for (const date of dates) {
      const group = dateMap.get(date);
      const consumedKey = `${employeeKey}|${date}`;
      const consumedOnDay = consumedByEmployeeDate.get(consumedKey) || new Set();
      const filteredGroup = {
        ...group,
        punches: group.punches.filter((punch) => !consumedOnDay.has(punchKey(punch))),
      };

      const nextDate = addDaysToDateString(date, 1);
      const nextDayGroup = dateMap.get(nextDate) || null;
      const nextConsumedKey = `${employeeKey}|${nextDate}`;
      if (!consumedByEmployeeDate.has(nextConsumedKey)) {
        consumedByEmployeeDate.set(nextConsumedKey, new Set());
      }
      const consumedNextDayKeys = consumedByEmployeeDate.get(nextConsumedKey);

      const derived = deriveCheckInOut(filteredGroup, {
        nextDayGroup,
        consumedNextDayKeys,
      });

      derivedMap.set(`${employeeKey}|${date}`, derived);
    }
  }

  return derivedMap;
}

module.exports = {
  addDaysToDateString,
  buildDerivedCheckInOutByDate,
  classifyPunchDirection,
  deriveCheckInOut,
  getPunchKind,
  getRawPunchTime,
  groupPunchesByEmployeeDate,
  hoursBetweenDateTimes,
  hoursBetweenTimeOnly,
  isAutoAddTerminal,
  punchKey,
  resolveCheckInOutPunches,
  resolveSessionsForDay,
  splitPunchTime,
  timeOnlyToSeconds,
  toDateTimeFromParts,
};
