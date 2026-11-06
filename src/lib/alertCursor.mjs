// Alert polls remember the newest alert they have already handled.
// A 403 must not move that cursor: the next successful read still needs the
// older alerts. A success with no new alert slides forward to one minute ago
// so a cursor from last week is not sent on every later poll.

export const ALERT_CURSOR_OVERLAP_MS = 60_000;

export function nextAlertCursor(since, alerts, now) {
  let cursor = typeof since === 'number' && Number.isFinite(since) && since > 0 ? since : 0;
  const list = Array.isArray(alerts) ? alerts : [];
  for (const alert of list) {
    const at = alert && typeof alert.at === 'number' && Number.isFinite(alert.at) ? alert.at : 0;
    if (at > cursor) cursor = at;
  }
  const wall = typeof now === 'number' && Number.isFinite(now) ? now : 0;
  const floor = wall - ALERT_CURSOR_OVERLAP_MS;
  if (floor > cursor) cursor = floor;
  return cursor;
}
