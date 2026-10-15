/*
 * "Niet deze" on a "Lijkt al betaald" match: a per-viewer convenience in this
 * browser (spec D9), the string `${lineId}:${itemKey}`. Kosten & bank and
 * Analyses both read and write the key only through these two functions.
 * Storage can be missing or refuse (private window, blocked site data): every
 * access is guarded and reads as an empty list.
 */

export const CASH_DISMISSED_KEY = 'enrosed.cash.dismissed';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The dismissed matches, oldest first; empty when nothing is stored or storage fails. */
export function readDismissed(): string[] {
  try {
    const raw = storage()?.getItem(CASH_DISMISSED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? [...new Set(parsed.filter((value): value is string => typeof value === 'string' && value.length > 0))] : [];
  } catch {
    return [];
  }
}

/** Adds one match and returns the new list (the stored one, or at least the list in memory when storage fails). */
export function addDismissed(key: string): string[] {
  const list = readDismissed();
  const next = key && !list.includes(key) ? [...list, key] : list;
  try {
    storage()?.setItem(CASH_DISMISSED_KEY, JSON.stringify(next));
  } catch {
    /* Storage full or blocked: the page keeps the list in memory for this visit. */
  }
  return next;
}
