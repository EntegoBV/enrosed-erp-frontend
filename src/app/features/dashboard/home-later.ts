import { laterPruned } from './home-priority';
import type { LaterEntry, LaterState } from './home-priority';

/*
 * Where "Later" on a home row is kept (spec-home §4.4): per browser, like
 * the bell's dismissed notifications - a personal "not today", not a server
 * setting. Every access is wrapped: a private window or blocked storage
 * simply forgets it after the visit. At most 200 keys; entries that ended
 * more than 30 days ago are dropped on every read and write.
 */

export const HOME_LATER_KEY = 'enrosed.home.later.v1';
const MAX_KEYS = 200;

function valid(entry: unknown): entry is LaterEntry {
  const row = entry as Partial<LaterEntry> | null;
  return !!row && typeof row.until === 'string' && typeof row.detail === 'string' && typeof row.count === 'number';
}

export function readLater(today: string): Record<string, LaterEntry> {
  try {
    const raw = localStorage.getItem(HOME_LATER_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    const entries = Object.entries(parsed && typeof parsed === 'object' ? parsed : {}).filter(([, entry]) => valid(entry)) as [string, LaterEntry][];
    return laterPruned(Object.fromEntries(entries), today, MAX_KEYS);
  } catch {
    return {};
  }
}

/** Stores the state (pruned) and returns what was stored. */
export function writeLater(state: LaterState, today: string): Record<string, LaterEntry> {
  const pruned = laterPruned(state, today, MAX_KEYS);
  try {
    localStorage.setItem(HOME_LATER_KEY, JSON.stringify(pruned));
  } catch {
    /* private mode: Later then lasts this visit only */
  }
  return pruned;
}
