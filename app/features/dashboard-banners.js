// The dashboard shows at most one of these. Trial (days left, ending soon,
// or an expired-trial reminder) is first. Then Turn on notifications.
// Then Download for Windows. A dismissed or not-applicable banner is skipped
// and the next one shows. An expired trial that already replaces the whole
// screen with the paused page is not stacked here.

export function pickDashboardBanner({ trial = false, expired = false, notifications = false, windows = false } = {}) {
  if (trial || expired) return "trial";
  if (notifications) return "notifications";
  if (windows) return "windows";
  return "";
}
