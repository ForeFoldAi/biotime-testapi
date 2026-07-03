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
/** Max hours between check-in and check-out for a valid paired session. */
const MAX_SESSION_GAP_HOURS = 30;
/** Max minutes between a completed session checkout and the next session check-in to allow stitch. */
const MAX_SESSION_MERGE_GAP_MINUTES = 60;

function isAutoAddTerminal(alias) {
  return String(alias || "").trim().toLowerCase() === "auto add";
}

function inferSingleAutoAddSide(punch) {
  const seconds = timeOnlyToSeconds(punch?.punch_time_only);
  if (seconds == null) return null;
  return seconds < AUTO_ADD_CHECKOUT_FROM_HOUR * 3600 ? "in" : "out";
}

/**
 * Prefer explicit gate terminal names over BioTime punch_state (255 is often unreliable).
 * BioTime punch_state: 0 = check-in, 1 = check-out when terminal is unknown.
 */
function classifyPunchDirection(transaction) {
  const alias = String(transaction?.terminal_alias || "").trim().toLowerCase();
  if (alias) {
    if (/\bout[\s_-]*gate\b/.test(alias) || /\bcheck[\s_-]*out\b/.test(alias)) return "out";
    if (/\bin[\s_-]*gate\b/.test(alias) || /\bcheck[\s_-]*in\b/.test(alias)) return "in";
  }

  const punchState = String(transaction?.punch_state ?? "").trim();
  if (punchState === "0") return "in";
  if (punchState === "1") return "out";

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

function findLeadingOutsBeforeFirstIn(punches) {
  const sorted = sortPunchesByTime(punches);
  const firstInIdx = sorted.findIndex(isCheckInLike);
  if (firstInIdx <= 0) {
    return { leadingOuts: [], remaining: sorted };
  }

  const leading = sorted.slice(0, firstInIdx);
  if (!leading.length || !leading.every(isCheckOutLike)) {
    return { leadingOuts: [], remaining: sorted };
  }

  return {
    leadingOuts: leading,
    remaining: sorted.slice(firstInIdx),
  };
}

function isSessionWithinGap(checkIn, checkOut) {
  if (!checkIn || !checkOut) return false;
  return hoursBetweenDateTimes(checkIn, checkOut) <= MAX_SESSION_GAP_HOURS;
}

function finalizeDerivedRecord({
  punch_date,
  employeeKey,
  checkInPunch,
  checkOutPunch,
  checkOutDate,
  resolution,
  punch_count,
  session_type = "",
  session_index = 1,
  session_count = 1,
}) {
  let check_in = checkInPunch?.punch_time_only || "";
  let check_out = checkOutPunch?.punch_time_only || "";
  let checkIn = check_in ? toDateTimeFromParts(punch_date, check_in) : null;
  let checkoutDate = checkOutPunch ? checkOutDate || punch_date : null;
  let checkOut = check_out && checkoutDate ? toDateTimeFromParts(checkoutDate, check_out) : null;
  let working_hours =
    checkIn && checkOut
      ? hoursBetweenDateTimes(checkIn, checkOut)
      : check_in && check_out
        ? hoursBetweenTimeOnly(check_in, check_out)
        : 0;
  let finalResolution = resolution || "unmatched";

  if (checkIn && checkOut && working_hours > MAX_SESSION_GAP_HOURS) {
    check_out = "";
    checkOutPunch = null;
    checkoutDate = "";
    checkOut = null;
    working_hours = 0;
    finalResolution = `${finalResolution}+gap_exceeded`;
  }

  const sessionComplete = Boolean(check_in && check_out && working_hours > 0);
  const crossMidnight = sessionComplete && checkoutDate && checkoutDate !== punch_date;
  const effective_punch_count = sessionComplete ? Math.max(2, punch_count) : punch_count;
  const punchAttendanceStatus =
    check_in && check_out ? "Present" : check_in || check_out ? "Missing Punch" : "Missing Punch";

  return {
    punch_date,
    employeeKey,
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
    effective_punch_count,
    punchAttendanceStatus,
    resolution: finalResolution,
    check_out_date: checkoutDate || "",
    session_type: session_type || (crossMidnight ? "cross_midnight_forward" : sessionComplete ? "same_day" : ""),
    session_complete: sessionComplete,
    cross_midnight: crossMidnight,
    session_index,
    session_count,
  };
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

function attachCrossMidnightCheckout(session, nextDayGroup, consumedNextDayKeys, punchDate) {
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

  const checkIn = toDateTimeFromParts(punchDate, session.checkInPunch.punch_time_only);
  const checkOut = toDateTimeFromParts(nextDayGroup.punch_date, morningCheckout.punch_time_only);
  if (!isSessionWithinGap(checkIn, checkOut)) {
    return session;
  }

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

  if (inGates.length > 0 && outGates.length > 0) {
    const checkInPunch = inGates[0];
    const inSeconds = timeOnlyToSeconds(checkInPunch.punch_time_only) ?? 0;
    const outsBeforeIn = outGates.filter(
      (punch) => (timeOnlyToSeconds(punch.punch_time_only) ?? 0) < inSeconds
    );
    if (outsBeforeIn.length > 0) {
      return {
        checkInPunch,
        checkOutPunch: null,
        resolution: "out_before_in_reentry",
      };
    }
  }

  return {
    checkInPunch: null,
    checkOutPunch: null,
    resolution: "unmatched",
  };
}

function sessionSignature(session) {
  const inKey = session?.checkInPunch ? punchKey(session.checkInPunch) : "";
  const outKey = session?.checkOutPunch ? punchKey(session.checkOutPunch) : "";
  return `${inKey}|${outKey}|${session?.checkOutDate || ""}`;
}

function isDuplicateSession(session, sessions) {
  const signature = sessionSignature(session);
  if (!signature || signature === "|") return false;
  return sessions.some((existing) => sessionSignature(existing) === signature);
}

function prevDayHasCheckout(employeeKey, prevDate, derivedMap) {
  const baseKey = `${employeeKey}|${prevDate}`;
  if (derivedMap.get(baseKey)?.check_out) return true;
  return [...derivedMap.keys()].some((key) => {
    if (!key.startsWith(`${baseKey}#`)) return false;
    return Boolean(derivedMap.get(key)?.check_out);
  });
}

function parseDerivedMapKey(mapKey) {
  const match = String(mapKey || "").match(/^(.+)\|(\d{4}-\d{2}-\d{2})(?:#(\d+))?$/);
  if (!match) {
    const parts = String(mapKey || "").split("|");
    return {
      employeeKey: parts[0] || "",
      punchDate: parts[1] || "",
      sessionIndex: Number(parts[2]) || 1,
    };
  }
  return {
    employeeKey: match[1],
    punchDate: match[2],
    sessionIndex: Number(match[3]) || 1,
  };
}

function dedupeDerivedMerges(merges) {
  const seen = new Set();
  return merges.filter((merge) => {
    const signature = sessionSignature(merge);
    if (!signature || signature === "|") return true;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function resolveSessionsForDay(punches, nextDayGroup, consumedNextDayKeys, punchDate) {
  const sessions = [];
  let remaining = sortPunchesByTime(punches);
  const { leadingOuts, remaining: afterLeading } = findLeadingOutsBeforeFirstIn(remaining);
  if (leadingOuts.length > 0 && afterLeading.length > 0) {
    remaining = afterLeading;
  }
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

  if (sessions.length === 1) {
    sessions[0] = attachCrossMidnightCheckout(
      sessions[0],
      nextDayGroup,
      consumedNextDayKeys,
      punchDate
    );
  }

  if (remaining.length > 0) {
    const eveningCheckIn = remaining.find((punch) => isEveningShiftCheckIn(punch));
    if (eveningCheckIn) {
      const crossMidnight = attachCrossMidnightCheckout(
        { checkInPunch: eveningCheckIn, checkOutPunch: null, checkOutDate: null, resolution: "evening_checkin" },
        nextDayGroup,
        consumedNextDayKeys,
        punchDate
      );
      if (crossMidnight.checkOutPunch && !isDuplicateSession(crossMidnight, sessions)) {
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
      const extraSession = {
        ...extra,
        checkOutDate: null,
      };
      if (
        (extra.checkInPunch || extra.checkOutPunch) &&
        !isDuplicateSession(extraSession, sessions)
      ) {
        sessions.push(extraSession);
      }
    }
  }

  return sessions;
}

function sessionMergeResult(session, punchDate) {
  return {
    checkInPunch: session.checkInPunch || null,
    checkOutPunch: session.checkOutPunch || null,
    checkOutDate: session.checkOutDate || punchDate,
    resolution: session.resolution || "unmatched",
  };
}

function gapMinutesBetweenSessions(earlierSession, laterSession, punchDate) {
  if (!earlierSession?.checkOutPunch || !laterSession?.checkInPunch) return 0;
  const outDate = earlierSession.checkOutDate || punchDate;
  const outDt = toDateTimeFromParts(outDate, earlierSession.checkOutPunch.punch_time_only);
  const inDt = toDateTimeFromParts(punchDate, laterSession.checkInPunch.punch_time_only);
  return Math.max(0, (inDt.getTime() - outDt.getTime()) / 60000);
}

function shouldStitchSessions(sessions, punchDate) {
  if (sessions.length < 2) return false;

  const first = sessions[0];
  const last = sessions[sessions.length - 1];
  const crossSession = sessions.find((session) => session.resolution === "cross_midnight_c");

  if (!first.checkInPunch || !last.checkOutPunch || !crossSession) return false;

  // Day shift already completed (e.g. A4 07:46–20:00) — keep separate from night C4.
  if (first.checkOutPunch) return false;

  return true;
}

function mergeSessionsToCheckInOut(sessions, punchDate) {
  if (!sessions.length) {
    return [sessionMergeResult({ resolution: "unmatched" }, punchDate)];
  }

  if (sessions.length === 1) {
    return [sessionMergeResult(sessions[0], punchDate)];
  }

  const first = sessions[0];
  const last = sessions[sessions.length - 1];

  if (shouldStitchSessions(sessions, punchDate)) {
    return [
      {
        checkInPunch: first.checkInPunch,
        checkOutPunch: last.checkOutPunch,
        checkOutDate: last.checkOutDate || punchDate,
        resolution: "multi_session_stitched",
      },
    ];
  }

  const completeSessions = sessions.filter(
    (session) => session.checkInPunch && session.checkOutPunch
  );
  if (completeSessions.length > 1) {
    return completeSessions.map((session) => sessionMergeResult(session, punchDate));
  }

  const withBoth = sessions.find((session) => session.checkInPunch && session.checkOutPunch);
  if (withBoth) {
    return [sessionMergeResult(withBoth, punchDate)];
  }

  return [
    {
      checkInPunch: first.checkInPunch || last.checkInPunch,
      checkOutPunch: first.checkOutPunch || last.checkOutPunch,
      checkOutDate: (first.checkOutPunch ? first.checkOutDate : last.checkOutDate) || punchDate,
      resolution: sessions.map((session) => session.resolution).join("+"),
    },
  ];
}

function countPunchesForMerge(merge, allPunches, options = {}) {
  const used = collectUsedPunches(merge);
  const count = allPunches.filter((punch) => used.has(punchKey(punch))).length;

  if (options.singleMergeForDay) {
    return allPunches.length;
  }

  return count > 0 ? count : allPunches.length;
}

function deriveCheckInOut(group, options = {}) {
  const records = deriveCheckInOutRecords(group, options);
  return records.length ? records[0] : null;
}

function deriveCheckInOutRecords(group, options = {}) {
  const punches = group?.punches || [];
  if (punches.length === 0) return [];

  const { nextDayGroup = null, consumedNextDayKeys = null } = options;
  const sessions = resolveSessionsForDay(punches, nextDayGroup, consumedNextDayKeys, group.punch_date);
  const merges = dedupeDerivedMerges(mergeSessionsToCheckInOut(sessions, group.punch_date));

  return merges.map((merge, index) =>
    finalizeDerivedRecord({
      punch_date: group.punch_date,
      employeeKey: group.employeeKey,
      checkInPunch: merge.checkInPunch,
      checkOutPunch: merge.checkOutPunch,
      checkOutDate: merge.checkOutDate,
      resolution: merge.resolution,
      punch_count: countPunchesForMerge(merge, punches, {
        singleMergeForDay: merges.length === 1,
      }),
      session_index: index + 1,
      session_count: merges.length,
    })
  );
}

function ensureConsumedSet(consumedByEmployeeDate, key) {
  if (!consumedByEmployeeDate.has(key)) {
    consumedByEmployeeDate.set(key, new Set());
  }
  return consumedByEmployeeDate.get(key);
}

function deriveCheckInOutForDate(employeeKey, date, dateMap, consumedByEmployeeDate) {
  const group = dateMap.get(date);
  if (!group) return [];

  const consumedKey = `${employeeKey}|${date}`;
  const consumedOnDay = ensureConsumedSet(consumedByEmployeeDate, consumedKey);
  const filteredGroup = {
    ...group,
    punches: group.punches.filter((punch) => !consumedOnDay.has(punchKey(punch))),
  };
  if (filteredGroup.punches.length === 0) return [];

  const nextDate = addDaysToDateString(date, 1);
  const nextDayGroup = dateMap.get(nextDate) || null;
  const nextConsumedKey = `${employeeKey}|${nextDate}`;
  const consumedNextDayKeys = ensureConsumedSet(consumedByEmployeeDate, nextConsumedKey);

  return deriveCheckInOutRecords(filteredGroup, {
    nextDayGroup,
    consumedNextDayKeys,
  });
}

function applyBackwardCheckouts(employeeKey, dateMap, derivedMap, consumedByEmployeeDate) {
  const dates = [...dateMap.keys()].sort();

  for (const date of dates) {
    const group = dateMap.get(date);
    if (!group) continue;

    const consumedKey = `${employeeKey}|${date}`;
    const consumedOnDay = ensureConsumedSet(consumedByEmployeeDate, consumedKey);
    const available = group.punches.filter((punch) => !consumedOnDay.has(punchKey(punch)));
    const { leadingOuts, remaining } = findLeadingOutsBeforeFirstIn(available);
    if (!leadingOuts.length) continue;

    const prevDate = addDaysToDateString(date, -1);
    const prevKey = `${employeeKey}|${prevDate}`;
    const prevDerived = derivedMap.get(prevKey);
    if (prevDayHasCheckout(employeeKey, prevDate, derivedMap)) continue;
    // Only attribute a backward checkout when the previous day has an open check-in.
    if (!prevDerived?.check_in) continue;

    const lastOut = leadingOuts[leadingOuts.length - 1];
    derivedMap.set(
      prevKey,
      finalizeDerivedRecord({
        punch_date: prevDate,
        employeeKey,
        checkInPunch: prevDerived?.check_in
          ? {
              punch_time_only: prevDerived.check_in,
              raw: prevDerived.check_in_raw || `${prevDate} ${prevDerived.check_in}`,
              terminal_alias: prevDerived.check_in_terminal_alias || "",
              area_alias: prevDerived.check_in_area_alias || "",
            }
          : null,
        checkOutPunch: lastOut,
        checkOutDate: date,
        resolution: prevDerived?.check_in ? "cross_midnight_backward" : "backward_checkout_only",
        punch_count: prevDerived?.punch_count ?? 0,
        session_type: "cross_midnight_backward",
      })
    );

    for (const punch of leadingOuts) {
      consumedOnDay.add(punchKey(punch));
    }

    const filteredGroup = {
      ...group,
      punches: remaining.filter((punch) => !consumedOnDay.has(punchKey(punch))),
    };

    if (filteredGroup.punches.length === 0) {
      derivedMap.delete(`${employeeKey}|${date}`);
      continue;
    }

    const nextDate = addDaysToDateString(date, 1);
    const nextDayGroup = dateMap.get(nextDate) || null;
    const nextConsumedKey = `${employeeKey}|${nextDate}`;
    const consumedNextDayKeys = ensureConsumedSet(consumedByEmployeeDate, nextConsumedKey);
    const redervied = deriveCheckInOutRecords(filteredGroup, {
      nextDayGroup,
      consumedNextDayKeys,
    });

    const baseKey = `${employeeKey}|${date}`;
    [...derivedMap.keys()].filter((key) => key === baseKey || key.startsWith(`${baseKey}#`)).forEach((key) => {
      derivedMap.delete(key);
    });

    if (redervied.length) {
      redervied.forEach((record, index) => {
        const key = index === 0 ? baseKey : `${baseKey}#${index + 1}`;
        derivedMap.set(key, record);
      });
    }
  }
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
      const derivedRecords = deriveCheckInOutForDate(employeeKey, date, dateMap, consumedByEmployeeDate);
      derivedRecords.forEach((derived, index) => {
        const key =
          index === 0 ? `${employeeKey}|${date}` : `${employeeKey}|${date}#${index + 1}`;
        derivedMap.set(key, derived);
      });
    }
  }

  for (const [employeeKey, dateMap] of byEmployee) {
    applyBackwardCheckouts(employeeKey, dateMap, derivedMap, consumedByEmployeeDate);
  }

  return derivedMap;
}

module.exports = {
  MAX_SESSION_GAP_HOURS,
  MAX_SESSION_MERGE_GAP_MINUTES,
  addDaysToDateString,
  buildDerivedCheckInOutByDate,
  classifyPunchDirection,
  deriveCheckInOut,
  deriveCheckInOutRecords,
  finalizeDerivedRecord,
  findLeadingOutsBeforeFirstIn,
  getPunchKind,
  getRawPunchTime,
  groupPunchesByEmployeeDate,
  hoursBetweenDateTimes,
  hoursBetweenTimeOnly,
  isAutoAddTerminal,
  isSessionWithinGap,
  mergeSessionsToCheckInOut,
  parseDerivedMapKey,
  punchKey,
  resolveCheckInOutPunches,
  resolveSessionsForDay,
  splitPunchTime,
  timeOnlyToSeconds,
  toDateTimeFromParts,
};
