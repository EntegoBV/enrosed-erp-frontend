import assert from 'node:assert/strict';
import test from 'node:test';
import type { CompanyCost } from '../src/app/core/api/models.ts';
import { duplicateCandidates, knownParties, partyDefaults, partyMemory } from '../src/app/features/finance/cost-suggestions.ts';

function cost(id: number, date: string, party: string, amountExclEur: number, extra: Partial<CompanyCost> = {}): CompanyCost {
  return { id, date, category: 'ANDERE', description: `Kost ${id}`, party, amountExclEur, vatPct: 21, reference: null,
    paidOn: null, salesChannel: null, notes: null, recurringCostId: null, ...extra };
}

test('the newest booking of a supplier sets its defaults, whatever the spelling', () => {
  const memory = partyMemory([
    cost(1, '2026-05-01', 'DPD Belgium', 100, { category: 'ANDERE' }),
    cost(2, '2026-09-12', 'DPD  belgium ', 312.4, { category: 'TRANSPORT', vatPct: 21, salesChannel: 'WEBSITE' }),
    cost(3, '2026-09-01', 'Meta', 450, { category: 'MARKETING', vatPct: 0 }),
  ]);
  const dpd = partyDefaults(memory, 'dpd belgium');
  assert.equal(dpd?.category, 'TRANSPORT');
  assert.equal(dpd?.salesChannel, 'WEBSITE');
  assert.equal(dpd?.count, 2);
  assert.equal(partyDefaults(memory, 'Unknown'), null);
  assert.equal(partyDefaults(memory, ''), null);
  assert.deepEqual(knownParties(memory), ['DPD belgium', 'Meta']);
});

test('a repeat is the same supplier and amount, by invoice number or within six weeks', () => {
  const costs = [
    cost(1, '2026-09-12', 'DPD Belgium', 312.4),
    cost(2, '2026-06-01', 'DPD Belgium', 312.4, { reference: 'F-77' }),
    cost(3, '2026-09-20', 'DPD Belgium', 312.41),
    cost(4, '2026-09-20', 'Raja', 312.4),
  ];
  const draft = { id: null, party: 'dpd belgium', amountExclEur: 312.4, reference: '', date: '2026-09-25' };
  assert.deepEqual(duplicateCandidates(draft, costs).map((row) => row.id), [1]);
  assert.deepEqual(duplicateCandidates({ ...draft, reference: 'f-77' }, costs).map((row) => row.id), [1, 2]);
  assert.deepEqual(duplicateCandidates({ ...draft, id: 1, date: '2026-09-12' }, costs).map((row) => row.id), []);
  assert.deepEqual(duplicateCandidates({ ...draft, amountExclEur: 0 }, costs), []);
  assert.deepEqual(duplicateCandidates({ ...draft, party: '' }, costs), []);
});
