/**
 * The writes WebsiteStore made to one part (a saved reeks, a saved or
 * deleted text group) while a full answer of that part may still be under
 * way. The store patches its lists after every save without fetching again;
 * an answer that started before such a patch is older than the patch, so
 * the store replays the patches on that answer instead of letting it undo
 * them (a switch that flips back, a text group at an old revision).
 * Pure and import-free (node-tested).
 */
export interface StoreWrite<T> {
  /** Date.now() when the write was applied to the store. */
  at: number;
  apply: (value: T) => T;
}

/** How long a write is kept for answers still under way; no request runs this long. */
export const STORE_WRITE_MEMORY_MS = 5 * 60_000;

/** The writes an answer that started at `started` may not contain yet (made at or after that moment). */
export function writesSince<T>(writes: readonly StoreWrite<T>[], started: number): StoreWrite<T>[] {
  return writes.filter((write) => write.at >= started);
}

/** The answer with the writes it may not contain replayed on it, oldest first. */
export function replayWrites<T>(answer: T, writes: readonly StoreWrite<T>[], started: number): T {
  return writesSince(writes, started).reduce((value, write) => write.apply(value), answer);
}

/** The list after a new write, without the writes too old to matter to any answer under way. */
export function rememberWrite<T>(writes: readonly StoreWrite<T>[], write: StoreWrite<T>): StoreWrite<T>[] {
  return [...writes.filter((item) => write.at - item.at < STORE_WRITE_MEMORY_MS), write];
}
