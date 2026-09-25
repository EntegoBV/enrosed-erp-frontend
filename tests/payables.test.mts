import assert from 'node:assert/strict';
import test from 'node:test';
import type { CompanyCost, PurchaseOrderView, PurchaseReconciliationStream, RecurringCost } from '../src/app/core/api/models.ts';
import { containerPayables, payableTotals, payablesFor } from '../src/app/features/finance/payables.ts';
import type { ContainerPayable } from '../src/app/features/finance/payables.ts';

type Status = 'CONCEPT' | 'BESTELD' | 'ONDERWEG' | 'ONTVANGEN';

function stream(payee: PurchaseReconciliationStream['payee'], remainingEur: number, input: Partial<PurchaseReconciliationStream> = {}): PurchaseReconciliationStream {
  return { payee, label: payee, status: remainingEur > 0 ? 'PARTIAL' : 'PAID', plannedEur: 1000, paidEur: 1000 - remainingEur, remainingEur,
    forecastEur: 1000, varianceEur: 0, overpaidEur: 0, settledSavingEur: 0, explicitlySettled: false, finalized: false, paymentCount: 1, ...input };
}

function term(due: 'ORDERED' | 'SHIPPED' | 'ARRIVED', remainingEur: number, finalized = false) {
  return { due, label: `1/3 ${due}`, plannedEur: 300, paidEur: 300 - remainingEur, remainingEur, settledSavingEur: 0, overpaidEur: 0, explicitlySettled: false, finalized };
}

function order(id: number, status: Status, streams: PurchaseReconciliationStream[], instalments?: ReturnType<typeof term>[], archivedAt: string | null = null): PurchaseOrderView {
  return {
    order: { id, number: `INK-2026-0${id}`, alias: id === 1 ? 'voor Frans' : null, status, archivedAt },
    reconciliation: { streams, totals: {}, lines: [], notes: [], ...(instalments ? { supplierInstalments: instalments } : {}) },
  } as unknown as PurchaseOrderView;
}

const keyed = (rows: ContainerPayable[]) => rows.map((row) => `${row.payee}:${row.due ?? '-'}:${row.bucket}:${row.whenLabel}`);

test('supplier terms fall due with the order: at the order, at departure, at arrival', () => {
  const terms = [term('ORDERED', 300), term('SHIPPED', 300), term('ARRIVED', 300)];
  const supplier = stream('SUPPLIER', 900);
  assert.deepEqual(keyed(containerPayables([order(1, 'BESTELD', [supplier], terms)])),
    ['SUPPLIER:ORDERED:now:nu', 'SUPPLIER:SHIPPED:later:bij vertrek', 'SUPPLIER:ARRIVED:later:bij aankomst']);
  assert.deepEqual(keyed(containerPayables([order(1, 'ONDERWEG', [supplier], terms)])),
    ['SUPPLIER:ORDERED:now:nu', 'SUPPLIER:SHIPPED:now:nu', 'SUPPLIER:ARRIVED:later:bij aankomst']);
  assert.deepEqual(keyed(containerPayables([order(1, 'ONTVANGEN', [supplier], terms)])).map((key) => key.split(':')[2]), ['now', 'now', 'now']);
});

test('the supplier stream counts only without terms, so nothing is counted twice', () => {
  const withTerms = containerPayables([order(1, 'BESTELD', [stream('SUPPLIER', 600)], [term('ORDERED', 300), term('SHIPPED', 300)])]);
  assert.equal(withTerms.reduce((sum, row) => sum + row.remainingEur, 0), 600);
  assert.equal(withTerms.length, 2);
  const withoutTerms = containerPayables([order(1, 'BESTELD', [stream('SUPPLIER', 600)])]);
  assert.deepEqual(keyed(withoutTerms), ['SUPPLIER:-:now:nu']);
  assert.deepEqual(keyed(containerPayables([order(1, 'BESTELD', [stream('SUPPLIER', 600)], [])])), ['SUPPLIER:-:now:nu'], 'an empty term list is no term list');
});

test('inspection is due from the order; transport and extra costs once the goods leave', () => {
  const streams = [stream('SEPARATE', 100), stream('LOGISTICS', 200), stream('OTHER', 50)];
  assert.deepEqual(keyed(containerPayables([order(2, 'BESTELD', streams)])),
    ['LOGISTICS:-:later:bij vertrek', 'SEPARATE:-:now:nu', 'OTHER:-:later:bij vertrek']);
  assert.deepEqual(keyed(containerPayables([order(2, 'ONDERWEG', streams)])).map((key) => key.split(':')[2]), ['now', 'now', 'now']);
});

test('concept orders, finished streams and terms, and amounts under half a cent stay out', () => {
  assert.equal(containerPayables([order(1, 'CONCEPT', [stream('SUPPLIER', 500)])]).length, 0);
  assert.equal(containerPayables([{ order: { id: 9, number: 'X', status: 'BESTELD' } } as unknown as PurchaseOrderView]).length, 0, 'no reconciliation');
  const rows = containerPayables([order(3, 'ONTVANGEN', [
    stream('SUPPLIER', 500, { finalized: true }), stream('LOGISTICS', 200, { status: 'PAID' }),
    stream('SEPARATE', 50, { status: 'SETTLED_LOWER' }), stream('OTHER', 30, { status: 'NOT_APPLICABLE' }),
  ])]);
  assert.equal(rows.length, 0);
  assert.equal(containerPayables([order(3, 'BESTELD', [stream('SEPARATE', 0.004)])]).length, 0);
  assert.equal(containerPayables([order(3, 'BESTELD', [stream('SUPPLIER', 600)], [term('ORDERED', 300, true), term('SHIPPED', 0)])]).length, 0);
});

test('archived containers still owe their money and say so', () => {
  const [row] = containerPayables([order(4, 'ONTVANGEN', [stream('LOGISTICS', 120)], undefined, '2026-09-01T10:00:00Z')]);
  assert.equal(row.archived, true);
  assert.equal(row.remainingEur, 120);
});

const cost = (id: number, date: string, amountExclEur: number, vatPct = 21): CompanyCost => ({ id, date, category: 'HUUR', description: `Kost ${id}`,
  party: 'Partij', amountExclEur, vatPct, reference: null, paidOn: null, salesChannel: null, notes: null });

test('costs are bucketed by date with their amount incl. btw and their age', () => {
  const rows = payablesFor({ today: '2026-09-24', upcoming30: [], containerRows: [],
    openCosts: [cost(1, '2026-08-01', 100), cost(2, '2026-09-24', 10, 6), cost(3, '2026-10-24', 50, 0), cost(4, '2026-10-25', 1)] });
  assert.deepEqual(rows.map((row) => [row.costId, row.bucket, row.amountEur, row.ageDays]),
    [[1, 'now', 121, 54], [2, 'now', 10.6, 0], [3, 'soon', 50, null], [4, 'later', 1.21, null]]);
});

test('recurring costs are coming up, with the direct debit flag; containers follow the costs in "now"', () => {
  const definition = { id: 7, name: 'Huur', party: 'Immo', autoPaid: true } as RecurringCost;
  const [container] = containerPayables([order(1, 'BESTELD', [stream('SEPARATE', 80)])]);
  const rows = payablesFor({ today: '2026-09-24', openCosts: [cost(1, '2026-09-01', 10)],
    upcoming30: [{ definition, date: '2026-10-01', amountExclEur: 100, amountInclEur: 121 }], containerRows: [container] });
  assert.deepEqual(rows.map((row) => [row.kind, row.bucket, row.autoPaid, row.estimated]),
    [['cost', 'now', false, false], ['container', 'now', false, true], ['recurring', 'soon', true, false]]);
  assert.equal(rows[1].title, 'INK-2026-01 · voor Frans');
});

test('totals add up in cents', () => {
  const rows = payablesFor({ today: '2026-09-24', upcoming30: [], containerRows: [],
    openCosts: [cost(1, '2026-09-01', 0.1, 0), cost(2, '2026-09-02', 0.2, 0)] });
  const totals = payableTotals(rows);
  assert.equal(totals.nowEur, 0.3);
  assert.equal(totals.totalEur, 0.3);
  assert.equal(totals.counts.now, 2);
  assert.equal(totals.oldestCostAgeDays, 23);
  const [later] = containerPayables([order(1, 'BESTELD', [stream('LOGISTICS', 99.99)])]);
  const mixed = payableTotals(payablesFor({ today: '2026-09-24', openCosts: [], upcoming30: [], containerRows: [later] }));
  assert.deepEqual([mixed.containerLaterEur, mixed.containerNowEur, mixed.laterEur], [99.99, 0, 99.99]);
});
