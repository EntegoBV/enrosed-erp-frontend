import assert from 'node:assert/strict';
import test from 'node:test';
import { normaliseParty, partyKey, rankParties } from '../src/app/features/finance/party-suggestions.ts';
import type { PartyCandidate } from '../src/app/features/finance/party-suggestions.ts';

const candidates: PartyCandidate[] = [
  { name: 'TICA Trends & Trade', stored: true, count: 12, detail: 'Beurs & stand · 21 % · TICA' },
  { name: 'DPD Belgium', stored: true, count: 4 },
  { name: 'Immo Ham', stored: false, count: 9, detail: '9 kosten' },
  { name: 'Trade Fair Ede', stored: false, count: 2 },
  { name: 'Meta Platforms', stored: false, count: 7 },
  { name: 'Café Ede', stored: false, count: 1 },
  { name: 'Raja', stored: true, count: 1 },
  { name: 'Tradex', stored: false, count: 3 },
];

test('prefix matches come before word starts, and those before substrings', () => {
  assert.deepEqual(rankParties('tra', candidates).map((row) => row.name), ['Tradex', 'Trade Fair Ede', 'TICA Trends & Trade']);
  assert.deepEqual(rankParties('ede', candidates).map((row) => row.name), ['Trade Fair Ede', 'Café Ede']);
  assert.deepEqual(rankParties('ham', candidates).map((row) => row.name), ['Immo Ham']);
  assert.deepEqual(rankParties('xyz', candidates), []);
});

test('within a tier the stored names lead, then the frequent ones, then the alphabet', () => {
  const tie: PartyCandidate[] = [
    { name: 'Bakker Jan', stored: false, count: 5 }, { name: 'Bakker An', stored: false, count: 5 },
    { name: 'Bakker Zoë', stored: true, count: 1 }, { name: 'Bakker Piet', stored: false, count: 8 },
  ];
  assert.deepEqual(rankParties('bak', tie).map((row) => row.name), ['Bakker Zoë', 'Bakker Piet', 'Bakker An', 'Bakker Jan']);
});

test('an empty query offers the stored names first, by use, and the limit holds', () => {
  assert.deepEqual(rankParties('', candidates).map((row) => row.name),
    ['TICA Trends & Trade', 'DPD Belgium', 'Raja', 'Immo Ham', 'Meta Platforms', 'Tradex']);
  assert.equal(rankParties('  ', candidates, 2).length, 2);
  assert.deepEqual(rankParties('', candidates, 0), []);
  assert.equal(rankParties('', candidates, 100).length, candidates.length);
});

test('diacritics, case and extra spaces never get in the way', () => {
  assert.deepEqual(rankParties('cafe', candidates).map((row) => row.name), ['Café Ede']);
  assert.deepEqual(rankParties('  CAFÉ   ede ', candidates).map((row) => row.name), ['Café Ede']);
  assert.equal(normaliseParty('  Café   Ede '), 'cafe ede');
  assert.equal(partyKey('  DPD   Belgium '), 'dpd belgium', 'the key keeps diacritics, like the server');
  assert.equal(partyKey('Café'), 'café');
  assert.equal(partyKey(null), '');
});
