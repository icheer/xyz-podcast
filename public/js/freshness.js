// Shared by the page (the notice on a board that has not been updated) and the
// Worker (/api/health).

// The boards are synced once a day, at 08:00 Beijing time, and the run is
// normally finished within a quarter of an hour. An hour after that the
// morning window is over, so data from the day before is then not "yesterday's
// list" any more but a sync that has not come through.
export const STALE_AFTER_MS = 25 * 60 * 60 * 1000;

/**
 * Whether board data last updated at `updatedAt` (an ISO string) is older than
 * that. Unknown or unreadable timestamps are not reported as stale.
 */
export function isBoardDataStale(updatedAt, nowMs = Date.now()) {
  const updatedMs = Date.parse(updatedAt);
  if (!updatedAt || !Number.isFinite(updatedMs) || updatedMs <= 0) return false;
  return nowMs - updatedMs > STALE_AFTER_MS;
}
