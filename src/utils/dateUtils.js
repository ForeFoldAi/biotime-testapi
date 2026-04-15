function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDate(dateInput) {
  const date = toDate(dateInput);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatTime(dateInput) {
  const date = toDate(dateInput);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatDateTimeForApi(dateInput) {
  const date = toDate(dateInput);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours()
  )}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function startOfMonth(year, month) {
  return new Date(year, month - 1, 1, 0, 0, 0, 0);
}

function endOfMonth(year, month) {
  return new Date(year, month, 0, 23, 59, 59, 999);
}

function listMonthDates(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, index) => index + 1);
}

function hoursBetween(start, end) {
  if (!start || !end) return 0;
  const millis = toDate(end).getTime() - toDate(start).getTime();
  return Math.max(0, millis / (1000 * 60 * 60));
}

function addDays(dateInput, offset) {
  const date = toDate(dateInput);
  const clone = new Date(date.getTime());
  clone.setDate(clone.getDate() + offset);
  return clone;
}

module.exports = {
  addDays,
  endOfMonth,
  formatDate,
  formatDateTimeForApi,
  formatTime,
  hoursBetween,
  listMonthDates,
  startOfMonth,
};
