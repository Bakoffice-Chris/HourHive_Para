function mondayOf(dateStr) {
  const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  const day = d.getDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

module.exports = { mondayOf };

// UTC-safe ISO date helpers
function addDaysISO(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
// date for a day_of_week (0=Sun..6=Sat) within the week starting Monday `weekStart`
function dateForDow(weekStart, dow) {
  return addDaysISO(weekStart, (dow + 6) % 7);
}
function dowOfISO(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
module.exports.addDaysISO = addDaysISO;
module.exports.dateForDow = dateForDow;
module.exports.dowOfISO = dowOfISO;
