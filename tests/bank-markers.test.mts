import assert from 'node:assert/strict';
import test from 'node:test';
import { bankMarker, lineMarkers, matchOutgoings, unbankedOutgoings, unbankedSinceDay } from '../src/app/features/finance/bank-markers.ts';
import type { BankLineLike, OutgoingRow } from '../src/app/features/finance/bank-markers.ts';

const line = (id: number, amountEur: number, bookedAt: string, reference: string | null = null): BankLineLike =>
  ({ id, amountEur, bookedAt, timeZone: 'Europe/Brussels', reference });
const row = (id: number, paidOn: string | null, amountEur: number, kind: OutgoingRow['kind'] = 'kost', linkedLineId: number | null = null): OutgoingRow =>
  ({ kind, id, paidOn, amountEur, linkedLineId });

test('markers read "kost #id", "kostbetaling #id" and "containerbetaling #id", in any case and among other text', () => {
  assert.equal(bankMarker('kost', 123), 'kost #123');
  assert.equal(bankMarker('kostbetaling', 7), 'kostbetaling #7');
  assert.equal(bankMarker('containerbetaling', 456), 'containerbetaling #456');
  const found = lineMarkers([
    { id: 1, reference: 'F-2026-12 · kost #12' }, { id: 2, reference: 'Kost #3 en CONTAINERBETALING #44 samen' },
    { id: 3, reference: 'geen marker' }, { id: 4, reference: null }, { id: 5, reference: 'onkost #9x' }, { id: 6, reference: 'KBC · kostbetaling #7' },
  ]);
  assert.deepEqual(found.get(1), [{ kind: 'kost', id: 12 }]);
  assert.deepEqual(found.get(2), [{ kind: 'kost', id: 3 }, { kind: 'containerbetaling', id: 44 }]);
  assert.deepEqual(found.get(6), [{ kind: 'kostbetaling', id: 7 }]);
  assert.equal(found.has(3), false);
  assert.equal(found.has(4), false);
  assert.equal(found.has(5), false, 'the marker must stand on its own');
});

test('a hard link wins, whatever the amount, date or marker; a single payment also answers to its cost marker', () => {
  const linked = row(7, '2026-09-10', 121, 'kostbetaling', 9);
  const lines = [line(9, -1, '2026-01-01T10:00:00Z', 'iets anders'), line(10, -121, '2026-09-10T10:00:00Z', 'kostbetaling #7')];
  assert.equal(matchOutgoings([linked], lines).get(linked)?.id, 9);
  assert.deepEqual(unbankedOutgoings([linked], lines, '2026-09-01'), []);
  const marked = row(7, '2026-09-10', 121, 'kostbetaling');
  assert.equal(matchOutgoings([marked], lines).get(marked)?.id, 10, 'without the link the marker decides');
  const legacy = { ...row(7, '2026-09-10', 121, 'kostbetaling'), legacyCostId: 12 };
  assert.equal(matchOutgoings([legacy], [line(1, -99, '2026-01-01T10:00:00Z', 'Huur · kost #12')]).get(legacy)?.id, 1, 'an older line written for the cost');
  assert.equal(matchOutgoings([{ ...legacy, legacyCostId: null }], [line(1, -99, '2026-01-01T10:00:00Z', 'Huur · kost #12')]).has(legacy), false);
  const taken = row(8, '2026-09-10', 121, 'kostbetaling', 9);
  const other = row(7, '2026-09-10', 121, 'kostbetaling');
  assert.equal(matchOutgoings([taken, other], [line(9, -121, '2026-09-10T10:00:00Z', 'kostbetaling #7')]).has(other), false, 'a line taken by a hard link is not reused by the marker');
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

test('an imported Odoo row is never considered reconciled by a matching amount or embedded marker', () => {
  const payment = row(22, '2026-09-10', 121, 'kostbetaling');
  const imported = { ...line(7, -121, '2026-09-10T10:00:00Z', 'kostbetaling #22'), source: 'ODOO' };
  assert.equal(matchOutgoings([payment], [imported]).size, 0);
  assert.equal(matchOutgoings([payment], [{ ...imported, reference: null }]).size, 0);
  const linked = { ...payment, linkedLineId: 7 };
  assert.equal(matchOutgoings([linked], [imported]).get(linked)?.id, 7);
});


test('supplier refunds remain a matching task until an incoming Odoo row carries their saved hard link', () => {
  const refund = row(8, '2026-10-01', -95.58, 'kostbetaling');
  const bank = { ...line(7, 95.6, '2026-10-01T12:00:00Z'), source: 'ODOO' };
  assert.equal(unbankedOutgoings([refund], [bank], '2026-01-01').length, 1);
  const linked = { ...refund, linkedLineId: 7 };
  assert.equal(matchOutgoings([linked], [bank]).get(linked)?.id, 7);
  assert.equal(unbankedOutgoings([linked], [bank], '2026-01-01').length, 0);
});

test('a credit offset on a container is never a payment without a bank link', async () => {
  // FinanceState.paidOutgoings feeds 'Betalingen zonder bankkoppeling', the attention count and the matching.
  const { readFile } = await import('node:fs/promises');
  const vm = await import('node:vm');
  const ts = (await import('typescript')).default;
  const { computed, signal } = await import('@angular/core');
  const source = await readFile(new URL('../src/app/features/finance/finance-state.ts', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('finance-state.ts', source, ts.ScriptTarget.Latest, true);
  const cls = parsed.statements.find((node): node is import('typescript').ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'FinanceState')!;
  const members = cls.members.filter(member => member.name && member.name.getText(parsed) === 'paidOutgoings');
  assert.equal(members.length, 1);
  const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter(modifier => !ts.isDecorator(modifier)), cls.name, undefined, undefined, members);
  const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  vm.runInNewContext(js, { exports, computed });
  const state = new exports['FinanceState']();
  state.ledger = signal([
    { cost: null, payment: { id: 1, orderId: 3, bankStatementLineId: null, creditOffset: false }, paidOn: '2026-09-08', amountEur: 100 },
    { cost: null, payment: { id: 2, orderId: 3, bankStatementLineId: null, creditOffset: true }, paidOn: '2026-09-08', amountEur: 50 },
  ]);
  assert.deepEqual(Array.from(state.paidOutgoings(), (row: { id: number }) => row.id), [1]);
});

test('a manual line booked as something else ("Boeken als…") is never guessed as a payment, by amount or by marker', () => {
  const paid = row(7, '2026-09-10', 121, 'kostbetaling');
  const booked = { ...line(10, -121, '2026-09-10T10:00:00Z', 'kostbetaling #7'), classification: 'PRIVATE' };
  assert.equal(matchOutgoings([paid], [booked]).has(paid), false, 'not by its marker');
  assert.equal(matchOutgoings([paid], [{ ...booked, reference: null }]).has(paid), false, 'not by its amount');
  assert.equal(matchOutgoings([paid], [{ ...booked, classification: null }]).get(paid)?.id, 10, 'the same line unbooked still matches');
  const linked = row(7, '2026-09-10', 121, 'kostbetaling', 10);
  assert.equal(matchOutgoings([linked], [booked]).get(linked)?.id, 10, 'a saved link is a link, booked or not');
});
