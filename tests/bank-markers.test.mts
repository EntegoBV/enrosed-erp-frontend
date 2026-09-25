import assert from 'node:assert/strict';
import test from 'node:test';
import { bankMarker, lineMarkers, matchOutgoings, unbankedOutgoings, unbankedSinceDay } from '../src/app/features/finance/bank-markers.ts';
import type { BankLineLike, OutgoingRow } from '../src/app/features/finance/bank-markers.ts';

const line = (id: number, amountEur: number, bookedAt: string, reference: string | null = null): BankLineLike =>
  ({ id, amountEur, bookedAt, timeZone: 'Europe/Brussels', reference });
const row = (id: number, paidOn: string | null, amountEur: number, kind: OutgoingRow['kind'] = 'kost'): OutgoingRow => ({ kind, id, paidOn, amountEur });

test('markers read "kost #id" and "containerbetaling #id", in any case and among other text', () => {
  assert.equal(bankMarker('kost', 123), 'kost #123');
  assert.equal(bankMarker('containerbetaling', 456), 'containerbetaling #456');
  const found = lineMarkers([
    { id: 1, reference: 'F-2026-12 · kost #12' }, { id: 2, reference: 'Kost #3 en CONTAINERBETALING #44 samen' },
    { id: 3, reference: 'geen marker' }, { id: 4, reference: null }, { id: 5, reference: 'onkost #9x' },
  ]);
  assert.deepEqual(found.get(1), [{ kind: 'kost', id: 12 }]);
  assert.deepEqual(found.get(2), [{ kind: 'kost', id: 3 }, { kind: 'containerbetaling', id: 44 }]);
  assert.equal(found.has(3), false);
  assert.equal(found.has(4), false);
  assert.equal(found.has(5), false, 'the marker must stand on its own');
});

test('a marked outgoing line puts its row on the bank, whatever the amount or date', () => {
  const rows = [row(1, '2026-09-10', 121), row(2, '2026-09-10', 50, 'containerbetaling')];
  const lines = [line(1, -99, '2026-01-01T10:00:00Z', 'Huur · kost #1'), line(2, 50, '2026-09-10T10:00:00Z', 'containerbetaling #2')];
  assert.deepEqual(unbankedOutgoings(rows, lines, '2026-09-01').map((item) => item.id), [2], 'an incoming line never counts');
});

test('without a marker the same cents within seven days match, each line once, the closest date first', () => {
  const rows = [row(1, '2026-09-10', 100), row(2, '2026-09-12', 100), row(3, '2026-09-20', 100)];
  const lines = [line(1, -100, '2026-09-12T09:00:00Z'), line(2, -100, '2026-09-30T09:00:00Z')];
  assert.deepEqual(unbankedOutgoings(rows, lines, '2026-09-01').map((item) => item.id), [1, 3],
    'line 1 is exactly on row 2, row 1 finds no free line, line 2 is ten days after row 3');
  const matched = matchOutgoings(rows, lines);
  assert.equal(matched.get(rows[1])?.id, 1);
  assert.equal(matched.has(rows[0]), false);
  assert.deepEqual(unbankedOutgoings([row(1, '2026-09-10', 100)], [line(1, -100, '2026-09-17T09:00:00Z')], '2026-09-01'), []);
  assert.equal(unbankedOutgoings([row(1, '2026-09-10', 100)], [line(1, -100.01, '2026-09-10T09:00:00Z')], '2026-09-01').length, 1);
});

test('a marked line is never reused by the amount match', () => {
  const rows = [row(1, '2026-09-10', 100), row(2, '2026-09-10', 100)];
  const lines = [line(1, -100, '2026-09-10T09:00:00Z', 'kost #1')];
  assert.deepEqual(unbankedOutgoings(rows, lines, '2026-09-01').map((item) => item.id), [2]);
});

test('unpaid rows are skipped and the since day counts inclusively; no reading lists nothing', () => {
  const rows = [row(1, null, 100), row(2, '2026-09-01', 100), row(3, '2026-08-31', 100)];
  assert.deepEqual(unbankedOutgoings(rows, [], '2026-09-01').map((item) => item.id), [2]);
  assert.deepEqual(unbankedOutgoings(rows, [], null), []);
});

test('the local bank day decides the heuristic: a line just after midnight in Brussels', () => {
  /* 22:30 UTC on 16 September is 00:30 on 17 September in Brussels: seven days after the 10th. */
  assert.deepEqual(unbankedOutgoings([row(1, '2026-09-10', 100)], [line(1, -100, '2026-09-16T22:30:00Z')], '2026-09-01'), []);
  assert.equal(unbankedOutgoings([row(1, '2026-09-09', 100)], [line(1, -100, '2026-09-16T22:30:00Z')], '2026-09-01').length, 1);
});

test('the since day starts after the earliest latest check, one day later for an end-of-day reading, at most 90 days back', () => {
  assert.equal(unbankedSinceDay([], '2026-09-24'), null);
  assert.equal(unbankedSinceDay([{ day: '2026-09-10', endOfDay: false }, { day: '2026-09-15', endOfDay: false }], '2026-09-24'), '2026-09-10');
  assert.equal(unbankedSinceDay([{ day: '2026-09-10', endOfDay: true }], '2026-09-24'), '2026-09-11');
  assert.equal(unbankedSinceDay([{ day: '2025-01-01', endOfDay: false }], '2026-09-24'), '2026-06-26');
});
