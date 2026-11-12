// Office job lists load a date window (2 weeks back to 4 weeks ahead), undated jobs and Done jobs.
// A job still open (Scheduled / In progress) but dated before the window used to fall out of every list and search.
// These helpers pick those stale open jobs and merge them into the office list. Pure; no Firebase imports.
export const OPEN_STATUSES = Object.freeze(["Scheduled", "In progress"]);
export const WINDOW_DAYS_BACK = 14;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** "YYYY-MM-DD" plus n days, calendar-safe (UTC arithmetic, no time-zone drift). */
export function addDaysIso(day, n) {
  const [y, m, d] = String(day).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** Open jobs dated before the office window. Undated, finished, cancelled or in-window jobs are left out. */
export function staleOpenJobs(list, today, daysBack = WINDOW_DAYS_BACK) {
  const cutoff = addDaysIso(today, -daysBack);
  return (list || []).filter(j => j && typeof j.date === "string" && ISO.test(j.date) && j.date < cutoff && OPEN_STATUSES.includes(j.status))
    .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
}
/** Window jobs first; extra jobs added once (by id). */
export function mergeJobLists(windowJobs, extra) {
  const ids = new Set((windowJobs || []).map(j => j.id));
  return [...(windowJobs || []), ...(extra || []).filter(j => j && !ids.has(j.id))];
}

// Job "Hours" field. Accepts decimals such as 7.6 (a 7 h 36 min day) or "7,6". Blank, negative or non-numbers save as null.
// Kept to 2 decimal places so 7.6 stays 7.6 and never becomes 7.6000000001.
export function parseHoursInput(value) {
  const text = String(value ?? "").trim().replace(",", ".");
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > 999) return null;
  return Math.round(n * 100) / 100;
}
