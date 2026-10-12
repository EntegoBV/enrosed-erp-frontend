import assert from 'node:assert/strict';
import test from 'node:test';
import type { CompanyCost, PurchasePaymentRow } from '../src/app/core/api/models.ts';
import {
  CONTAINER_PAYMENT_CATEGORIES, containerFilterId, costLedger, costLedgerCsv, costLedgerTotals, filterCostLedger, missingDocument, paymentPayeeLabel,
} from '../src/app/features/finance/cost-ledger.ts';
import { costSummary } from '../src/app/features/finance/cost-metrics.ts';
import { COST_MONEY, cashTotalOf, costRegimeCells, movementsSince, returnVatOf } from '../src/app/features/finance/finance-metrics.ts';

const cost: CompanyCost = { id: 1, date: '2026-09-01', category: 'HUUR', description: 'Huur magazijn', party: 'Verhuurder',
  amountExclEur: 100, vatPct: 21, reference: 'F-1', paidOn: '2026-09-03', salesChannel: null, notes: null, vatRegime: 'BE', vatRegimeConfirmed: true } as CompanyCost;
/** The state hands the money rule in; the ledger itself imports nothing at runtime. */
const ledger = (costs: CompanyCost[], payments: PurchasePaymentRow[]) => costLedger(costs, payments, cashTotalOf);
function payment(input: Partial<PurchasePaymentRow> = {}): PurchasePaymentRow {
  return { id: 1, orderId: 10, orderNumber: 'PO-2026-001', orderAlias: 'Zomerrozen', paidOn: '2026-09-02', amountEur: 554.77, label: 'Saldo', payee: 'SUPPLIER', ...input };
}

test('historical container payments appear alongside company costs with independent identities and paid amounts', () => {
  const rows = ledger([cost], [payment({ paidOn: '2025-12-31' })]);
  assert.deepEqual(rows.map((row) => [row.key, row.date, row.amountEur]), [['cost:1', '2026-09-01', 121], ['payment:1', '2025-12-31', 554.77]]);
  assert.equal(rows[1].cost, null, 'a payment never becomes a second expense or invents VAT');
  assert.equal(ledger([{ ...cost, amountExclEur: 82.64, amountInclEur: 100 }], [])[0].amountEur, 100, 'an entered inclusive total is the row total');
  assert.match(costLedgerCsv(ledger([{ ...cost, amountExclEur: 82.64, amountInclEur: 100 }], []), (code) => code).split('\r\n')[1],
    /;82,64;21,00;17,36;100,00;/, 'the CSV shows the VAT the invoice shows, not 82.64 × 21 % = 17.35');
  assert.equal(rows[1].reference, 'PO-2026-001 · Zomerrozen');
  assert.equal(rows[1].paidOn, rows[1].date);
  assert.deepEqual(costLedgerTotals(rows), { containerCount: 1, containerPaidEur: 554.77, paidEur: 675.77 });
});

test('every payment stream is linked, including old supplier rows without payee and extra payments', () => {
  const rows = ledger([], [payment({ id: 1, payee: null }), payment({ id: 2, payee: 'LOGISTICS' }),
    payment({ id: 3, payee: 'SEPARATE' }), payment({ id: 4, payee: 'OTHER', label: null })]);
  // The same four words as Inkoop's payments block (purchase-payment-ledger PAYEE_LABEL).
  assert.deepEqual(rows.map((row) => row.party), ['Leverancier', 'Douane & transport', 'Inspectie & andere kosten', 'Bijkomende kosten']);
  assert.equal(rows[3].description, 'Bijkomende kosten · containerbetaling');
  assert.deepEqual(CONTAINER_PAYMENT_CATEGORIES.map((category) => category.label),
    ['Container · leverancier', 'Container · douane & transport', 'Container · inspectie & andere kosten', 'Container · bijkomende kosten']);
  assert.deepEqual(rows.map((row) => row.payment?.orderId), [10, 10, 10, 10]);
});

test('the container filter rejects invalid identifiers and returns only the correct container', () => {
  for (const raw of [null, '', '0', '-1', '10x', '1.5', '9007199254740992']) assert.equal(containerFilterId(raw), null);
  assert.equal(containerFilterId('10'), 10);
  const rows = ledger([cost], [payment({ paidOn: '2025-12-31' }), payment({ id: 2, orderId: 11 })]);
  assert.deepEqual(filterCostLedger(rows, { containerId: 10 }).map((row) => row.key), ['payment:1']);
  assert.equal(filterCostLedger(rows, { containerId: 10, status: 'open' }).length, 0);
});

test('period filters use the payment date, and text/category/source/payment status match the combined list', () => {
  const rows = ledger([cost, { ...cost, id: 2, paidOn: null }], [payment(), payment({ id: 2, payee: 'LOGISTICS', paidOn: '2026-10-01' })]);
  assert.deepEqual(filterCostLedger(rows, { from: '2026-09-02', to: '2026-09-02' }).map((row) => row.key), ['payment:1']);
  assert.equal(filterCostLedger(rows, { query: 'douane' })[0].payment?.id, 2);
  assert.equal(filterCostLedger(rows, { query: 'ZOMERROZEN' }).length, 2);
  assert.equal(filterCostLedger(rows, { category: 'CONTAINER_LOGISTICS' }).length, 1);
  assert.equal(filterCostLedger(rows, { source: 'company' }).length, 2);
  assert.equal(filterCostLedger(rows, { source: 'container', status: 'paid' }).length, 2);
  assert.deepEqual(filterCostLedger(rows, { status: 'open' }).map((row) => row.key), ['cost:2']);
  assert.equal(filterCostLedger(ledger([{ ...cost, salesChannel: 'WHOLESALE' }], []), { query: 'Groothandel' }, (code) => code,
    (code) => code === 'WHOLESALE' ? 'Groothandel' : code).length, 1);
});

test('edits and deletes follow the payment source and duplicate response rows cannot double the cash', () => {
  assert.equal(ledger([], [payment(), payment()]).length, 1);
  const corrected = payment({ amountEur: 600, paidOn: '2026-09-04', payee: 'LOGISTICS' });
  const afterEdit = ledger([], [corrected]);
  assert.equal(afterEdit[0].amountEur, 600);
  assert.equal(afterEdit[0].date, '2026-09-04');
  assert.equal(afterEdit[0].category, 'CONTAINER_LOGISTICS');
  assert.deepEqual(ledger([], []), [], 'deleting the source removes the derived cost');
  assert.equal(movementsSince('2026-09-01', 1000, [], [corrected, corrected], []).currentEur, 400);
});

test('operating result, VAT and bank cash retain separate bases with one movement per payment', () => {
  const payments = [payment(), payment({ id: 2, amountEur: 100, payee: 'OTHER' })];
  const rows = ledger([cost], payments);
  const operating = costSummary(rows.flatMap((row) => row.cost ? [row.cost] : []), COST_MONEY);
  assert.equal(operating.exclEur, 100);
  assert.equal(operating.vatEur, 21);
  assert.equal(costLedgerTotals(rows).paidEur, 775.77);
  const bank = movementsSince('2026-09-01', 1000, [cost], payments, []);
  assert.equal(bank.outEur, 775.77);
  assert.equal(bank.rows.length, 3);
  const purchase = bank.rows.find((row) => row.key === 'payment:1')!;
  assert.equal(purchase.purchaseOrderId, 10);
  assert.match(purchase.detail, /Leverancier/);
});

test('combined CSV exports linkage and exact cash while leaving container VAT and invoice totals empty', () => {
  const rows = ledger([cost], [payment({ label: 'Saldo; "laatste"' })]);
  const lines = costLedgerCsv(rows, (code) => code).split('\r\n');
  assert.match(lines[0], /Bron;Categorie/);
  assert.match(lines[1], /;100,00;21,00;21,00;121,00;121,00;2026-09-03;/);
  assert.match(lines[2], /;"Saldo; ""laatste""";/);
  assert.match(lines[2], /;;;;;554,77;2026-09-02;10;1;/);
  assert.match(lines[2], /Btw niet uit betaling afgeleid/);
  assert.doesNotMatch(lines[0], /Documenten/, 'the documents column only comes on request');
});

test('a reverse-charge row pays the excl. amount and still shows its VAT in the CSV; the regime columns follow', () => {
  const google: CompanyCost = { ...cost, id: 5, amountExclEur: 82.64, vatPct: 21, vatRegime: 'EU_SERVICES', supplierCountry: 'IE', costKind: 'SERVICES', paidOn: null, description: 'Google' };
  const rows = ledger([google], []);
  assert.deepEqual([rows[0].amountEur, rows[0].openEur, rows[0].status], [82.64, 82.64, 'open']);
  const line = costLedgerCsv(rows, (code) => code, undefined, (code) => code, returnVatOf, costRegimeCells).split('\r\n')[1];
  assert.match(line, /;82,64;21,00;17,35;82,64;;;/, 'Btw 17,35 · Factuur incl. 82,64 · nothing paid');
  assert.match(line, /;nee;EU · dienst;IE;Diensten;100,00;100,00;;$/);
  assert.match(costLedgerCsv(rows, (code) => code).split('\r\n')[0], /;Vaste kost;Btw-regeling;Land;Soort;Btw aftrekbaar %;Fiscaal aftrekbaar %;Investering \(jaren\);Notities$/);
  assert.match(costLedgerCsv(rows, (code) => code).split('\r\n')[1], /;nee;EU_SERVICES;IE;SERVICES;100,00;100,00;;$/, 'without the label callback the codes stand');
});

test('a partly paid cost is open with its remainder; the paid total follows the payments', () => {
  const partial: CompanyCost = { ...cost, id: 6, paidOn: null, openEur: 50, paidEur: 71, cashTotalEur: 121,
    payments: [{ id: 1, paidOn: '2026-09-02', amountEur: 71, account: 'KBC', bankStatementLineId: null, note: null }] };
  const rows = ledger([partial, cost, { ...cost, id: 7, paidOn: null }], []);
  assert.deepEqual(rows.map((row) => [row.key, row.openEur, row.status]), [['cost:1', 0, 'paid'], ['cost:6', 50, 'partial'], ['cost:7', 121, 'open']]);
  assert.deepEqual(filterCostLedger(rows, { status: 'open' }).map((row) => row.key), ['cost:6', 'cost:7'], 'open includes partly paid');
  assert.deepEqual(filterCostLedger(rows, { status: 'paid' }).map((row) => row.key), ['cost:1']);
  assert.equal(costLedgerTotals(rows).paidEur, 71 + 121);
  assert.match(costLedgerCsv(rows.filter((row) => row.key === 'cost:6'), (code) => code).split('\r\n')[1], /;121,00;71,00;;/, 'Betaald EUR is what was paid, Betaald op stays empty');
});

test('the regime filter: one code, or everything derived or unknown', () => {
  const rows = ledger([
    cost, { ...cost, id: 2, vatRegime: 'EU_SERVICES' }, { ...cost, id: 3, vatRegimeConfirmed: false }, { ...cost, id: 4, vatRegime: null, vatRegimeConfirmed: false },
  ], [payment()]);
  assert.deepEqual(filterCostLedger(rows, { regime: 'EU_SERVICES' }).map((row) => row.key), ['cost:2']);
  assert.deepEqual(filterCostLedger(rows, { regime: 'unconfirmed' }).map((row) => row.key), ['cost:3', 'cost:4']);
  assert.equal(filterCostLedger(rows, { regime: '' }).length, 5);
});

test('the payee labels read as in Inkoop', () => {
  assert.deepEqual((['SUPPLIER', 'LOGISTICS', 'SEPARATE', 'OTHER', null] as const).map((payee) => paymentPayeeLabel(payee)),
    ['Leverancier', 'Douane & transport', 'Inspectie & andere kosten', 'Bijkomende kosten', 'Leverancier']);
});

test('"Zonder document" keeps only company costs without a file, never container payments', () => {
  const rows = ledger([cost, { ...cost, id: 2 }, { ...cost, id: 3 }], [payment()]);
  const missing = filterCostLedger(rows, { docs: 'missing', documentedIds: new Set([2]) });
  assert.deepEqual(missing.map((row) => row.key), ['cost:1', 'cost:3']);
  assert.equal(filterCostLedger(rows, { docs: 'missing' }).length, 3, 'without known documents every company cost qualifies');
  assert.equal(filterCostLedger(rows, { docs: null }).length, 4);
});

test('a cost booked by a recurring definition never waits for a document', () => {
  const rows = ledger([cost, { ...cost, id: 2, recurringCostId: 7 }, { ...cost, id: 3 }], []);
  assert.deepEqual(filterCostLedger(rows, { docs: 'missing', documentedIds: new Set([3]) }).map((row) => row.key), ['cost:1']);
  assert.equal(missingDocument({ id: 2, recurringCostId: 7 }), false);
  assert.equal(missingDocument({ id: 3, recurringCostId: null }, new Set([3])), false);
  assert.equal(missingDocument({ id: null, recurringCostId: null }, new Set([3])), true, 'an unsaved cost has no file yet');
});

test('the accountant CSV can append the file names per row', () => {
  const rows = ledger([cost], [payment()]);
  const lines = costLedgerCsv(rows, (code) => code, (row) => row.cost ? 'factuur.pdf, bon; kopie.jpg' : '').split('\r\n');
  assert.match(lines[0], /;Notities;Documenten$/);
  assert.match(lines[1], /;"factuur\.pdf, bon; kopie\.jpg"$/);
  assert.match(lines[2], /;$/);
});
