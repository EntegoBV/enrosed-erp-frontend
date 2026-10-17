/*
 * How long a customer waits on us, in the words the home and the bell share
 * (redesign home design §4 #6, critique N14): "< 1 u" and "17 u" within the
 * first day, then "1 werkdag", "27 werkdagen" (Mon–Fri after the day the item
 * came in, Brussels time), Nu from CUSTOMER_WAIT_NU_WORKDAYS; and when a
 * customer's own news came in: "vandaag 14:02", "gisteren", "di 13 okt".
 *
 * A small pure module so the bell (on every page) never loads the home's
 * ranking. Node-tested: no imports. home-priority.ts keeps its own copy of
 * the wait rule (a node-tested module takes no runtime imports); a test keeps
 * the two equal.
 */

/** A customer waiting this many workdays or more is Nu (copy of home-priority.ts CUSTOMER_WAIT_NU_WORKDAYS). */
export const CUSTOMER_WAIT_NU_WORKDAYS = 2;

const DAY_MS = 86_400_000;
const WEEKDAYS_SHORT = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const MONTHS_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const utc = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const addDays = (iso: string, days: number): string => new Date(utc(iso) + days * DAY_MS).toISOString().slice(0, 10);
const weekday = (iso: string): number => new Date(utc(iso)).getUTCDay();
const brusselsParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
  minute: '2-digit', hourCycle: 'h23' });

/** The Brussels calendar day of an instant ('YYYY-MM-DD'). */
export function brusselsDay(instant: string | number): string {
  const parts = Object.fromEntries(brusselsParts.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return `${parts['year']}-${parts['month']}-${parts['day']}`;
}

/** The local calendar day of an epoch time ('YYYY-MM-DD'): the home's "today". */
export function localDay(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The working days (Mon–Fri) after `fromIso` up to and including `toIso`; 0 when `toIso` is not later. */
export function workdaysBetween(fromIso: string, toIso: string): number {
  let count = 0;
  for (let day = addDays(fromIso, 1); day <= toIso; day = addDays(day, 1)) {
    const dow = weekday(day);
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/** "< 1 u", "17 u", "1 werkdag", "27 werkdagen"; `nu` from CUSTOMER_WAIT_NU_WORKDAYS. Null without a usable instant. */
export function waitLabel(at: string | null | undefined, nowMs: number, today: string): { label: string; nu: boolean } | null {
  const ms = at ? Date.parse(at) : Number.NaN;
  if (Number.isNaN(ms)) return null;
  const hours = Math.max(0, Math.floor((nowMs - ms) / 3_600_000));
  const workdays = workdaysBetween(brusselsDay(ms), today);
  const label = hours < 24 || workdays === 0
    ? (hours < 1 ? '< 1 u' : `${hours} u`)
    : `${workdays} ${workdays === 1 ? 'werkdag' : 'werkdagen'}`;
  return { label, nu: workdays >= CUSTOMER_WAIT_NU_WORKDAYS };
}

/** When a customer's news came in, Brussels time: "vandaag 14:02", "gisteren", "di 13 okt". Null without a usable instant. */
export function whenLabel(at: string | null | undefined, nowMs: number): string | null {
  const ms = at ? Date.parse(at) : Number.NaN;
  if (Number.isNaN(ms)) return null;
  const day = brusselsDay(ms);
  const today = brusselsDay(nowMs);
  if (day === today) {
    const parts = Object.fromEntries(brusselsParts.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
    return `vandaag ${parts['hour']}:${parts['minute']}`;
  }
  if (day === addDays(today, -1)) return 'gisteren';
  return `${WEEKDAYS_SHORT[weekday(day)]} ${Number(day.slice(8, 10))} ${MONTHS_SHORT[Number(day.slice(5, 7)) - 1]}`;
}

/** The bell's order: oldest first, items without an instant last (then as they came). */
export function oldestFirst<T extends { at: string | null }>(items: readonly T[]): T[] {
  const time = (item: T): number => { const ms = item.at ? Date.parse(item.at) : Number.NaN; return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms; };
  return items.map((item, index) => ({ item, index })).sort((a, b) => time(a.item) - time(b.item) || a.index - b.index).map((row) => row.item);
}
