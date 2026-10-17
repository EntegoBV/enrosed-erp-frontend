/*
 * One GET shared by everyone who asks while it is in flight, and, for a
 * caller that opts in, its answer reused while it is young enough. clear()
 * forgets both: a write must never be followed by an answer from before it,
 * so a request that was in flight while clear() ran is not kept either.
 * Pure and import-free: node-tested.
 */

export interface RequestCache<T> {
  /**
   * The answer: the request in flight when there is one; with maxAgeMs > 0
   * also a finished answer at most that old (capped at the cache's ttl).
   */
  get(maxAgeMs?: number): Promise<T>;
  /** Forget the answer and the request in flight. */
  clear(): void;
}

export function cachedOnce<T>(load: () => Promise<T>, ttlMs: number, now: () => number = Date.now): RequestCache<T> {
  let generation = 0;
  let inFlight: Promise<T> | null = null;
  let stored: { value: T; at: number } | null = null;

  return {
    get(maxAgeMs = 0): Promise<T> {
      const age = Math.min(Math.max(0, maxAgeMs), ttlMs);
      if (age > 0 && stored && now() - stored.at <= age) return Promise.resolve(stored.value);
      if (inFlight) return inFlight;
      const mine = generation;
      const request = load().then(
        (value) => {
          if (mine === generation) {
            stored = { value, at: now() };
            inFlight = null;
          }
          return value;
        },
        (failure: unknown) => {
          if (mine === generation) inFlight = null;
          throw failure;
        },
      );
      inFlight = request;
      return request;
    },
    clear(): void {
      generation += 1;
      inFlight = null;
      stored = null;
    },
  };
}
