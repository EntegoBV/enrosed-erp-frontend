import assert from 'node:assert/strict';
import test from 'node:test';
import type { CompanyCost, PurchasePaymentRow } from '../src/app/core/api/models.ts';
import {
  CONTAINER_PAYMENT_CATEGORIES, containerFilterId, costLedger, costLedgerCsv, costLedgerTotals, filterCostLedger, missingDocument, paymentPayeeLabel,
} from '../src/app/features/finance/cost-ledger.ts';
import { costSummary } from '../src/app/features/finance/cost-metrics.ts';
import { movementsSince } from '../src/app/features/finance/finance-metrics.ts';

const cost: CompanyCost = { id: 1, date: '2026-09-01', category: 'HUUR', description: 'Huur magazijn', party: 'Verhuurder',
  amountExclEur: 100, vatPct: 21, reference: 'F-1', paidOn: '2026-09-03', salesChannel: null, notes: null };
function payment(input: Partial<PurchasePaymentRow> = {}): PurchasePaymentRow {
  return { id: 1, orderId: 10, orderNumber: 'PO-2026-001', orderAlias: 'Zomerrozen', paidOn: '2026-09-02', amountEur: 554.77, label: 'Saldo', payee: 'SUPPLIER', ...input };
}

test('historical container payments appear alongside company costs with independent identities and paid amounts', () => {
  const rows = costLedger([cost], [payment({ paidOn: '2025-12-31' })]);
  assert.deepEqual(rows.map((row) => [row.key, row.date, row.amountEur]), [['cost:1', '2026-09-01', 121], ['payment:1', '2025-12-31', 554.77]]);
  assert.equal(rows[1].cost, null, 'a payment never becomes a second expense or invents VAT');
  assert.equal(rows[1].reference, 'PO-2026-001 · Zomerrozen');
  assert.equal(rows[1].paidOn, rows[1].date);
  assert.deepEqual(costLedgerTotals(rows), { containerCount: 1, containerPaidEur: 554.77, paidEur: 675.77 });
});

test('every payment stream is linked, including old supplier rows without payee and extra payments', () => {
  const rows = costLedger([], [payment({ id: 1, payee: null }), payment({ id: 2, payee: 'LOGISTICS' }),
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
  const rows = costLedger([cost], [payment({ paidOn: '2025-12-31' }), payment({ id: 2, orderId: 11 })]);
  assert.deepEqual(filterCostLedger(rows, { containerId: 10 }).map((row) => row.key), ['payment:1']);
  assert.equal(filterCostLedger(rows, { containerId: 10, status: 'open' }).length, 0);
});

test('period filters use the payment date, and text/category/source/payment status match the combined list', () => {
  const rows = costLedger([cost, { ...cost, id: 2, paidOn: null }], [payment(), payment({ id: 2, payee: 'LOGISTICS', paidOn: '2026-10-01' })]);
  assert.deepEqual(filterCostLedger(rows, { from: '2026-09-02', to: '2026-09-02' }).map((row) => row.key), ['payment:1']);
  assert.equal(filterCostLedger(rows, { query: 'douane' })[0].payment?.id, 2);
  assert.equal(filterCostLedger(rows, { query: 'ZOMERROZEN' }).length, 2);
  assert.equal(filterCostLedger(rows, { category: 'CONTAINER_LOGISTICS' }).length, 1);
  assert.equal(filterCostLedger(rows, { source: 'company' }).length, 2);
  assert.equal(filterCostLedger(rows, { source: 'container', status: 'paid' }).length, 2);
  assert.deepEqual(filterCostLedger(rows, { status: 'open' }).map((row) => row.key), ['cost:2']);
  assert.equal(filterCostLedger(costLedger([{ ...cost, salesChannel: 'WHOLESALE' }], []), { query: 'Groothandel' }, (code) => code,
    (code) => code === 'WHOLESALE' ? 'Groothandel' : code).length, 1);
});

test('edits and deletes follow the payment source and duplicate response rows cannot double the cash', () => {
  assert.equal(costLedger([], [payment(), payment()]).length, 1);
  const corrected = payment({ amountEur: 600, paidOn: '2026-09-04', payee: 'LOGISTICS' });
  const afterEdit = costLedger([], [corrected]);
  assert.equal(afterEdit[0].amountEur, 600);
  assert.equal(afterEdit[0].date, '2026-09-04');
  assert.equal(afterEdit[0].category, 'CONTAINER_LOGISTICS');
  assert.deepEqual(costLedger([], []), [], 'deleting the source removes the derived cost');
  assert.equal(movementsSince('2026-09-01', 1000, [], [corrected, corrected], []).currentEur, 400);
});

test('operating result, VAT and bank cash retain separate bases with one movement per payment', () => {
  const payments = [payment(), payment({ id: 2, amountEur: 100, payee: 'OTHER' })];
  const rows = costLedger([cost], payments);
  const operating = costSummary(rows.flatMap((row) => row.cost ? [row.cost] : []));
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
  const rows = costLedger([cost], [payment({ label: 'Saldo; "laatste"' })]);
  const lines = costLedgerCsv(rows, (code) => code).split('\r\n');
  assert.match(lines[0], /Bron;Categorie/);
  assert.match(lines[1], /;100,00;21,00;21,00;121,00;121,00;2026-09-03;/);
  assert.match(lines[2], /;"Saldo; ""laatste""";/);
  assert.match(lines[2], /;;;;;554,77;2026-09-02;10;1;/);
  assert.match(lines[2], /Btw niet uit betaling afgeleid/);
  assert.doesNotMatch(lines[0], /Documenten/, 'the documents column only comes on request');
});

test('the payee labels read as in Inkoop', () => {
  assert.deepEqual((['SUPPLIER', 'LOGISTICS', 'SEPARATE', 'OTHER', null] as const).map((payee) => paymentPayeeLabel(payee)),
    ['Leverancier', 'Douane & transport', 'Inspectie & andere kosten', 'Bijkomende kosten', 'Leverancier']);
});

test('"Zonder document" keeps only company costs without a file, never container payments', () => {
  const rows = costLedger([cost, { ...cost, id: 2 }, { ...cost, id: 3 }], [payment()]);
  const missing = filterCostLedger(rows, { docs: 'missing', documentedIds: new Set([2]) });
  assert.deepEqual(missing.map((row) => row.key), ['cost:1', 'cost:3']);
  assert.equal(filterCostLedger(rows, { docs: 'missing' }).length, 3, 'without known documents every company cost qualifies');
  assert.equal(filterCostLedger(rows, { docs: null }).length, 4);
});

test('a cost booked by a recurring definition never waits for a document', () => {
  const rows = costLedger([cost, { ...cost, id: 2, recurringCostId: 7 }, { ...cost, id: 3 }], []);
  assert.deepEqual(filterCostLedger(rows, { docs: 'missing', documentedIds: new Set([3]) }).map((row) => row.key), ['cost:1']);
  assert.equal(missingDocument({ id: 2, recurringCostId: 7 }), false);
  assert.equal(missingDocument({ id: 3, recurringCostId: null }, new Set([3])), false);
  assert.equal(missingDocument({ id: null, recurringCostId: null }, new Set([3])), true, 'an unsaved cost has no file yet');
});

test('the accountant CSV can append the file names per row', () => {
  const rows = costLedger([cost], [payment()]);
  const lines = costLedgerCsv(rows, (code) => code, (row) => row.cost ? 'factuur.pdf, bon; kopie.jpg' : '').split('\r\n');
  assert.match(lines[0], /;Notities;Documenten$/);
  assert.match(lines[1], /;"factuur\.pdf, bon; kopie\.jpg"$/);
  assert.match(lines[2], /;$/);
});
