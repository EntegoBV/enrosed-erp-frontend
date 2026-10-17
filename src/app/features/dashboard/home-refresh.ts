/*
 * Which of the home's calls a return to the home fetches again (redesign home
 * design §4 #5): only the ones older than their own maximum age - 20 s for
 * what changes during the day (sales, purchases, costs, incoming payments,
 * partner financing, the planner, the bell), 5 min for what hardly does
 * (products, website products, suppliers, website visits, customers). A
 * call that never answered, or whose last attempt failed, is always stale
 * (noteAnswer drops its stamp: a failed round is never fresh). "Opnieuw" and "Vernieuwen"
 * fetch everything; a new CashData round fetches partner financing again
 * (its advance schedules need that round's financings).
 *
 * Pure and node-tested: no imports.
 */

/** The home's calls by the words its status uses, plus the planner and the bell. */
export type HomeFetchKey = 'verkoop' | 'inkoop' | 'voorraad' | 'websiteproducten' | 'leveranciers' | 'websitebezoek' | 'kosten'
  | 'inkomende betalingen' | 'partnerfinanciering' | 'klanten' | 'planner' | 'bell';

export const FAST_MAX_AGE_MS = 20_000;
export const SLOW_MAX_AGE_MS = 300_000;

export const HOME_FETCH_KEYS: readonly HomeFetchKey[] = ['verkoop', 'inkoop', 'voorraad', 'websiteproducten', 'leveranciers', 'websitebezoek',
  'kosten', 'inkomende betalingen', 'partnerfinanciering', 'klanten', 'planner', 'bell'];
const SLOW: ReadonlySet<HomeFetchKey> = new Set(['voorraad', 'websiteproducten', 'leveranciers', 'websitebezoek', 'klanten']);

/** The maximum age of one call's answer. */
export function maxAgeOf(key: HomeFetchKey): number {
  return SLOW.has(key) ? SLOW_MAX_AGE_MS : FAST_MAX_AGE_MS;
}

/** The calls to fetch again now: never answered, or older than their maximum age. */
export function staleSources(fetchedAt: Readonly<Partial<Record<HomeFetchKey, number>>>, nowMs: number): HomeFetchKey[] {
  return HOME_FETCH_KEYS.filter((key) => {
    const at = fetchedAt[key];
    return at === undefined || nowMs - at > maxAgeOf(key);
  });
}

/** Records one call's answer: a good one is stamped now, a failed one loses its stamp, so the next return fetches it again. */
export function noteAnswer(fetchedAt: Partial<Record<HomeFetchKey, number>>, key: HomeFetchKey, ok: boolean, nowMs: number): void {
  if (ok) fetchedAt[key] = nowMs;
  else delete fetchedAt[key];
}
