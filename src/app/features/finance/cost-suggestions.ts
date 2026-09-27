import type { CompanyCost } from '../../core/api/models';

/*
 * What the cost form can guess from earlier bookings: how the last cost to
 * the same supplier was booked, and which booking a new one probably
 * repeats. No runtime imports: the node tests run this file on its own.
 */

export interface PartyDefaults {
  party: string;
  category: string;
  vatPct: number | null;
  salesChannel: string | null;
  lastDate: string;
  count: number;
}

const partyKey = (party: string | null | undefined): string => (party ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('nl-BE');
const cents = (value: number | null | undefined): number => Math.round((Number.isFinite(value as number) ? (value as number) : 0) * 100);

/** Whole days between two ISO days, in either direction. */
function dayDistance(left: string, right: string): number {
  const day = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.abs(Math.round((day(left) - day(right)) / 86_400_000));
}

/** Per supplier the newest booking, and how often the supplier comes back. */
export function partyMemory(costs: readonly CompanyCost[]): Map<string, PartyDefaults> {
  const memory = new Map<string, PartyDefaults>();
  const newestFirst = [...costs].sort((left, right) => right.date.localeCompare(left.date) || (right.id ?? 0) - (left.id ?? 0));
  for (const cost of newestFirst) {
    const key = partyKey(cost.party);
    if (!key) continue;
    const known = memory.get(key);
    if (known) { known.count += 1; continue; }
    memory.set(key, { party: (cost.party ?? '').trim().replace(/\s+/g, ' '), category: cost.category, vatPct: cost.vatPct,
      salesChannel: cost.salesChannel, lastDate: cost.date, count: 1 });
  }
  return memory;
}

export function partyDefaults(memory: ReadonlyMap<string, PartyDefaults>, party: string | null | undefined): PartyDefaults | null {
  return memory.get(partyKey(party)) ?? null;
}

/** The suppliers in use, the most frequent first: the suggestions of the "Aan wie" field. */
export function knownParties(memory: ReadonlyMap<string, PartyDefaults>): string[] {
  return [...memory.values()].sort((left, right) => right.count - left.count || left.party.localeCompare(right.party, 'nl')).map((row) => row.party);
}

/**
 * Bookings the draft probably repeats: the same supplier and the same
 * amount, with the same invoice number or within six weeks of each other.
 */
export function duplicateCandidates(draft: Pick<CompanyCost, 'id' | 'party' | 'amountExclEur' | 'reference' | 'date'>,
                                    costs: readonly CompanyCost[]): CompanyCost[] {
  const key = partyKey(draft.party);
  const amount = cents(draft.amountExclEur);
  if (!key || amount <= 0 || !draft.date) return [];
  const reference = (draft.reference ?? '').trim().toLocaleLowerCase('nl-BE');
  return costs.filter((cost) => cost.id !== draft.id && partyKey(cost.party) === key && cents(cost.amountExclEur) === amount
    && ((!!reference && (cost.reference ?? '').trim().toLocaleLowerCase('nl-BE') === reference) || dayDistance(cost.date, draft.date) <= 45))
    .sort((left, right) => dayDistance(left.date, draft.date) - dayDistance(right.date, draft.date));
}
