import type { CostParty } from '../../core/api/models';

/*
 * The "Aan wie" suggestions: who to offer while a name is being typed, in
 * which order. Shared by the cost, recurring and bank movement forms. No
 * runtime imports: the node tests run this file on its own.
 */

/** One name the field can offer. */
export interface PartyCandidate {
  name: string;
  /** In the "Aan wie" list (with defaults), or only seen in bookings so far. */
  stored: boolean;
  /** How often the name appears in costs, recurring costs and bank lines. */
  count: number;
  /** The small line under the name: the defaults ("Beurs & stand · 21 % · TICA") or "3 kosten". */
  detail?: string;
}

/** The server's name key: lower-cased, trimmed, inner whitespace collapsed; diacritics stay. */
export function partyKey(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Only explicit server merges combine names; similar suppliers remain separate. */
export function costPartyLookup(parties: readonly CostParty[]): Map<string, CostParty> {
  const lookup = new Map<string, CostParty>();
  for (const party of parties) {
    lookup.set(partyKey(party.name), party);
    for (const alias of party.aliases ?? []) lookup.set(partyKey(alias), party);
  }
  return lookup;
}

/** The matching form of a name: lower-cased, diacritics stripped, spaces collapsed. "Café Ede" matches "cafe ede". */
export function normaliseParty(text: string | null | undefined): string {
  return (text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** 0 the name starts with the query, 1 a word in it does, 2 it contains it, 3 no match. */
function tier(name: string, query: string): number {
  if (name.startsWith(query)) return 0;
  if (name.split(' ').some((word) => word.startsWith(query))) return 1;
  if (name.includes(query)) return 2;
  return 3;
}

/**
 * The candidates worth showing for what was typed: prefix matches first,
 * then word starts, then anything containing it; within a tier the stored
 * names before the merely seen ones, the frequent before the rare, then
 * alphabetical. An empty query offers the stored names first, by use.
 */
export function rankParties(query: string, candidates: readonly PartyCandidate[], limit = 6): PartyCandidate[] {
  const needle = normaliseParty(query);
  const ranked = candidates
    .map((candidate) => ({ candidate, tier: needle ? tier(normaliseParty(candidate.name), needle) : 0 }))
    .filter((row) => row.tier < 3)
    .sort((left, right) => left.tier - right.tier
      || Number(right.candidate.stored) - Number(left.candidate.stored)
      || right.candidate.count - left.candidate.count
      || left.candidate.name.localeCompare(right.candidate.name, 'nl'));
  return ranked.slice(0, Math.max(0, limit)).map((row) => row.candidate);
}
