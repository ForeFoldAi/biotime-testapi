/**
 * Format decimal hours for display (API / reports). Internal logic stays numeric.
 */
function formatHoursToHM(value) {
  const totalMinutes = Math.round(Number(value || 0) * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} hr ${minutes} mins`;
}

module.exports = {
  formatHoursToHM,
};
