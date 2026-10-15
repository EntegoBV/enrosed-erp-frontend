import assert from 'node:assert/strict';
import test from 'node:test';
import type { CompanyCost, PurchaseOrderView, PurchaseReconciliationStream, RecurringCost } from '../src/app/core/api/models.ts';
import { containerPayables, payableTotals, payablesFor } from '../src/app/features/finance/payables.ts';
import type { ContainerPayable, OpenCost } from '../src/app/features/finance/payables.ts';

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

/** The state hands in what is open and the cash total (openOf / cashTotalOf of finance-metrics). */
const cost = (id: number, date: string, openEur: number, cashTotalEur = openEur): OpenCost => ({ id, date, category: 'HUUR', description: `Kost ${id}`,
  party: 'Partij', amountExclEur: cashTotalEur, vatPct: 0, reference: null, paidOn: null, salesChannel: null, notes: null, openEur, cashTotalEur } as OpenCost);

test('costs are bucketed by date with what is still open and their age', () => {
  const rows = payablesFor({ today: '2026-09-24', upcoming30: [], containerRows: [],
    openCosts: [cost(1, '2026-08-01', 121), cost(2, '2026-09-24', 10.6), cost(3, '2026-10-24', 50), cost(4, '2026-10-25', 1.21)] });
  assert.deepEqual(rows.map((row) => [row.costId, row.bucket, row.amountEur, row.ageDays]),
    [[1, 'now', 121, 54], [2, 'now', 10.6, 0], [3, 'soon', 50, null], [4, 'later', 1.21, null]]);
});

test('a partly paid cost shows its remainder and what it is a remainder of; a settled one is no payable', () => {
  const rows = payablesFor({ today: '2026-09-24', upcoming30: [], containerRows: [],
    openCosts: [cost(1, '2026-09-01', 50, 121), cost(2, '2026-09-02', 0, 121), cost(3, '2026-09-03', 200)] });
  assert.deepEqual(rows.map((row) => [row.costId, row.amountEur, row.ofEur]), [[1, 50, 121], [3, 200, 200]]);
  assert.equal(payableTotals(rows).nowEur, 250, 'remainders by construction');
});

test('recurring costs are coming up, with the direct debit flag; containers follow the costs in "now"', () => {
  const definition = { id: 7, name: 'Huur', party: 'Immo', autoPaid: true } as RecurringCost;
  const [container] = containerPayables([order(1, 'BESTELD', [stream('SEPARATE', 80)])]);
  const rows = payablesFor({ today: '2026-09-24', openCosts: [cost(1, '2026-09-01', 10)],
    upcoming30: [{ definition, date: '2026-10-01', amountExclEur: 100, amountInclEur: 121 }], containerRows: [container] });
  assert.deepEqual(rows.map((row) => [row.kind, row.bucket, row.autoPaid, row.estimated]),
    [['cost', 'now', false, false], ['container', 'now', false, true], ['recurring', 'soon', true, false]]);
  assert.equal(rows[1].title, 'INK-2026-01 · voor Frans');
  assert.deepEqual(rows.map((row) => [row.amountEur, row.ofEur]), [[10, 10], [80, 80], [121, 121]]);
});

test('totals add up in cents', () => {
  const rows = payablesFor({ today: '2026-09-24', upcoming30: [], containerRows: [],
    openCosts: [cost(1, '2026-09-01', 0.1), cost(2, '2026-09-02', 0.2)] });
  const totals = payableTotals(rows);
  assert.equal(totals.nowEur, 0.3);
  assert.equal(totals.totalEur, 0.3);
  assert.equal(totals.counts.now, 2);
  assert.equal(totals.oldestCostAgeDays, 23);
  const [later] = containerPayables([order(1, 'BESTELD', [stream('LOGISTICS', 99.99)])]);
  const mixed = payableTotals(payablesFor({ today: '2026-09-24', openCosts: [], upcoming30: [], containerRows: [later] }));
  assert.deepEqual([mixed.containerLaterEur, mixed.containerNowEur, mixed.laterEur], [99.99, 0, 99.99]);
});

/** PO 35 (PO-2026-002) as the netting server sends it: the 30 % surplus covered the 70 % shortfall, € 0,50 too much in all. */
function po35(shipped: { remainingEur: number; finalized: boolean } = { remainingEur: 0, finalized: true }): PurchaseOrderView {
  return order(35, 'ONTVANGEN', [stream('SUPPLIER', shipped.remainingEur, { status: shipped.remainingEur > 0 ? 'PARTIAL' : 'OVERPAID', plannedEur: 31048.04,
    paidEur: 31048.54, overpaidEur: shipped.remainingEur > 0 ? 0 : 0.5 })], [
    { ...term('ORDERED', 0), label: '30% bij bestelling', plannedEur: 9314.41, paidEur: 9375.69, overpaidEur: shipped.remainingEur > 0 ? 0 : 0.5, offsetEur: -60.78 },
    { ...term('SHIPPED', shipped.remainingEur, shipped.finalized), label: '70% bij vertrek', plannedEur: 21733.63, paidEur: 21672.85, offsetEur: 60.78 },
  ] as ReturnType<typeof term>[]);
}

test('PO 35: terms netted by the server leave nothing to pay, so Kosten & bank lists no row for it', () => {
  assert.deepEqual(containerPayables([po35()]), []);
  const totals = payableTotals(payablesFor({ today: '2026-10-14', openCosts: [], upcoming30: [], containerRows: containerPayables([po35()]) }));
  assert.deepEqual([totals.containerNowEur, totals.counts.container], [0, 0]);
  // Whatever the server leaves open after netting is the amount, never the gross gap of the term.
  const [rest] = containerPayables([po35({ remainingEur: 12.34, finalized: false })]);
  assert.deepEqual([rest.due, rest.termLabel, rest.remainingEur, rest.bucket], ['SHIPPED', '70% bij vertrek', 12.34, 'now']);
});

test('a container row names its payee\'s primary invoice; the inspection via the supplier names the supplier\'s, and terms still replace the stream', () => {
  const invoices = [
    { id: 9, payee: 'SUPPLIER', number: 'CI-2026-131', coversInspection: false },
    { id: 7, payee: 'SUPPLIER', number: 'CI-2026-118', coversInspection: true },
    { id: 8, payee: 'LOGISTICS', number: 'FW-55', coversInspection: false },
  ];
  const view = (flag: boolean, list = invoices) => ({ ...order(4, 'BESTELD', [stream('SUPPLIER', 600), stream('LOGISTICS', 0), stream('SEPARATE', 300)],
    [term('ORDERED', 300), term('SHIPPED', 300)]), invoices: list, order: { id: 4, number: 'INK-2026-04', alias: null, status: 'BESTELD', inspectionViaSupplier: flag } }) as unknown as PurchaseOrderView;
  const rows = containerPayables([view(true)]);
  assert.deepEqual(rows.map((row) => [row.payee, row.due, row.invoiceNumber, row.viaSupplier]), [
    ['SUPPLIER', 'ORDERED', 'CI-2026-118', false], ['SUPPLIER', 'SHIPPED', 'CI-2026-118', false], ['SEPARATE', null, 'CI-2026-118', true],
  ], 'the first registered invoice is the primary; the terms replace the supplier stream');
  assert.equal(rows.reduce((sum, row) => sum + row.remainingEur, 0), 900);
  const own = containerPayables([view(true, [...invoices, { id: 12, payee: 'SEPARATE', number: 'INS-1', coversInspection: false }])]);
  assert.equal(own.find((row) => row.payee === 'SEPARATE')?.invoiceNumber, 'INS-1');
  const plain = containerPayables([view(false, invoices.map((invoice) => ({ ...invoice, coversInspection: false })))]);
  assert.deepEqual(plain.find((row) => row.payee === 'SEPARATE') && [plain.find((row) => row.payee === 'SEPARATE')!.invoiceNumber, plain.find((row) => row.payee === 'SEPARATE')!.viaSupplier], [null, false]);
  assert.equal(containerPayables([order(5, 'BESTELD', [stream('SUPPLIER', 100)])])[0].invoiceNumber, null, 'an older server sends no invoices');
});
