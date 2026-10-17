/**
 * When the work queue (bell, Verkoop tab, Meer counts) refreshes on its own:
 * when the app comes back into view or gets the focus, and every five
 * minutes while it is visible - but never twice within a minute, and never
 * while the app is hidden. Pure and import-free: node-tested.
 */

/** A refresh younger than this is fresh enough for a focus or visibility change. */
export const QUEUE_STALE_MS = 60_000;
/** The interval of the background refresh while the app is visible. */
export const QUEUE_INTERVAL_MS = 5 * 60_000;

export function shouldRefreshQueue(lastRefreshAt: number | null, now: number, visible: boolean): boolean {
  if (!visible) return false;
  return lastRefreshAt === null || now - lastRefreshAt > QUEUE_STALE_MS;
}

/**
 * How long a refresh that answered serves a screen asking on arrival. The
 * shell refreshes on start and the home (or a bell, Meer, a list) asks again
 * a moment later when its route opens: one page load, one pair of calls.
 */
export const QUEUE_REUSE_MS = 5_000;

/**
 * Whether a non-forced refresh may reuse the last one: it started less than
 * QUEUE_REUSE_MS ago and answered without an error (the caller checks both
 * that it is no longer running and that it did not fail).
 */
export function reusesQueueRefresh(lastRefreshAt: number | null, now: number): boolean {
  return lastRefreshAt !== null && now >= lastRefreshAt && now - lastRefreshAt < QUEUE_REUSE_MS;
}
