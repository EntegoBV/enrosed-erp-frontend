import type { CompanyCost, RecurringInterval } from '../../core/api/models';

/*
 * "Lijkt te herhalen": hand-booked costs to the same party that come back
 * month after month, offered as a vaste kost. The suggestion starts at the
 * next expected booking (never today or earlier), so setting it up never
 * books a period a second time, and its rhythm comes from the bookings
 * themselves. Pure and node-tested: type imports only.
 */

export interface RecurringCandidate {
  party: string;
  count: number;
  /** The oldest booking of the window. */
  since: string;
  /** The newest booking: its amount excl., VAT rate, category and description prefill the sheet. */
  last: CompanyCost;
  interval: RecurringInterval;
  /** The next expected booking: the newest plus one interval, moved on until it lies after today. */
  nextDate: string;
}

const WINDOW_DAYS = 365;
const STEADY_CATEGORIES = new Set(['BOEKHOUDER', 'SOFTWARE', 'HUUR', 'VERZEKERING']);
const SUFFIXES = new Set(['nv', 'bv', 'bvba', 'srl', 'sa', 'ltd', 'co', 'gmbh', 'inc']);
const DAY_MS = 86_400_000;

const utc = (day: string): number => Date.parse(`${day.slice(0, 10)}T00:00:00Z`);
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** 'Linc & Partners BV', 'LINC PARTNERS' and 'Linc&Partners' are one party. */
export function recurringPartyKey(name: string | null | undefined): string {
  return (name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((word) => word && !SUFFIXES.has(word)).join(' ');
}

/** The interval a median gap between bookings reads as. */
export function intervalOfGap(days: number): RecurringInterval {
  if (days <= 10) return 'WEEKLY';
  if (days <= 45) return 'MONTHLY';
  if (days <= 120) return 'QUARTERLY';
  if (days <= 240) return 'HALF_YEARLY';
  return 'YEARLY';
}

/** One interval after a day; months counted from the day, the 31st clamped to the month's end. */
function step(day: string, interval: RecurringInterval, times = 1): string {
  if (interval === 'WEEKLY') return iso(utc(day) + 7 * times * DAY_MS);
  const months = (interval === 'MONTHLY' ? 1 : interval === 'QUARTERLY' ? 3 : interval === 'HALF_YEARLY' ? 6 : 12) * times;
  const [year, month, date] = day.slice(0, 10).split('-').map(Number);
  const total = month - 1 + months;
  const targetYear = year + Math.floor(total / 12);
  const targetMonth = ((total % 12) + 12) % 12 + 1;
  const last = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(Math.min(date, last)).padStart(2, '0')}`;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function recurringCandidates(costs: readonly CompanyCost[], recurringParties: readonly string[], today: string): RecurringCandidate[] {
  const since = iso(utc(today) - WINDOW_DAYS * DAY_MS);
  const known = new Set(recurringParties.map(recurringPartyKey).filter(Boolean));
  const groups = new Map<string, CompanyCost[]>();
  for (const cost of costs) {
    if (cost.recurringCostId != null || !cost.date || cost.date < since || cost.date > today) continue;
    const key = recurringPartyKey(cost.party);
    if (!key || known.has(key)) continue;
    groups.set(key, [...(groups.get(key) ?? []), cost]);
  }
  const candidates: RecurringCandidate[] = [];
  for (const rows of groups.values()) {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || (a.id ?? 0) - (b.id ?? 0));
    const last = sorted[sorted.length - 1];
    const months = new Set(sorted.map((row) => row.date.slice(0, 7))).size;
    const steady = STEADY_CATEGORIES.has(last.category);
    if (sorted.length < 3 || months < (steady ? 2 : 3)) continue;
    const days = [...new Set(sorted.map((row) => row.date))];
    const gaps = days.slice(1).map((day, index) => Math.round((utc(day) - utc(days[index])) / DAY_MS));
    const interval = intervalOfGap(gaps.length ? median(gaps) : 30);
    let next = step(last.date, interval);
    for (let times = 2; next <= today && times < 1000; times += 1) next = step(last.date, interval, times);
    candidates.push({ party: (last.party ?? '').trim(), count: sorted.length, since: sorted[0].date, last, interval, nextDate: next });
  }
  return candidates.sort((a, b) => b.count - a.count || a.party.localeCompare(b.party, 'nl'));
}
