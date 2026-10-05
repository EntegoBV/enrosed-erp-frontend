import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import type {
  PurchaseInstalmentReconciliation, PurchaseOrderView, PurchasePayment, PurchaseReconciliationStream,
} from '../src/app/core/api/models.ts';
import { PAYMENT_TERMS } from '../src/app/core/api/models.ts';
import { instalmentsOf } from '../src/app/features/purchasing/payment-plan.ts';
import { purchaseGroupSettled, purchaseInstalmentState } from '../src/app/features/purchasing/purchase-instalment-state.ts';
import {
  PAYEE_ICON, PAYEE_LABEL, PAYEE_ORDER, purchasePaymentLedger, settleCarriers, type LedgerRow, type LedgerTerm, type PaymentLedger,
} from '../src/app/features/purchasing/purchase-payment-ledger.ts';

// purchase-payment-menus.ts imports the payee words at runtime: compile it with the imports stripped and hand them in.
const menusSource = await readFile(new URL('../src/app/features/purchasing/purchase-payment-menus.ts', import.meta.url), 'utf8');
const menusParsed = ts.createSourceFile('purchase-payment-menus.ts', menusSource, ts.ScriptTarget.Latest, true);
const menusJs = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(menusParsed,
  menusParsed.statements.filter(node => !ts.isImportDeclaration(node)))), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const menus: Record<string, any> = {};
vm.runInNewContext(menusJs, { exports: menus, PAYEE_LABEL, PAYEE_ORDER, PAYEE_ICON, Intl });
const termMenuItems = menus['termMenuItems'] as (term: LedgerTerm, busy: boolean) => { id: string; label: string; disabled?: boolean }[];
const termHasMenu = menus['termHasMenu'] as (term: LedgerTerm) => boolean;
const termPayment = menus['termPayment'] as (term: LedgerTerm, rows: readonly LedgerRow[]) => LedgerRow | null;
const relinkPayment = menus['relinkPayment'] as (payee: { rows: readonly LedgerRow[] }) => LedgerRow | null;

// A supplier term paid to the cent is never a dead end: it can be confirmed
// ('Termijn afrekenen'), undone per term and its payment corrected, on the
// desk and in the phone payee sheet alike.

function stream(values: Partial<PurchaseReconciliationStream> = {}): PurchaseReconciliationStream {
  return { payee: 'SUPPLIER', label: 'Leverancier', status: 'PAID', plannedEur: 1000, paidEur: 1000, remainingEur: 0, forecastEur: 1000,
    varianceEur: 0, overpaidEur: 0, settledSavingEur: 0, explicitlySettled: false, finalized: true, paymentCount: 2, ...values };
}

function instalment(due: 'ORDERED' | 'SHIPPED', values: Partial<PurchaseInstalmentReconciliation> = {}): PurchaseInstalmentReconciliation {
  const planned = due === 'ORDERED' ? 300 : 700;
  return { due, label: due === 'ORDERED' ? '30% bij bestelling' : '70% bij vertrek', plannedEur: planned, paidEur: planned, remainingEur: 0,
    settledSavingEur: 0, overpaidEur: 0, explicitlySettled: false, finalized: true, ...values };
}

function purchase(instalments: PurchaseInstalmentReconciliation[] | undefined, supplier = stream()): PurchaseOrderView {
  return {
    order: { id: 50, number: 'INK-2026-014', status: 'ONDERWEG', paymentTerms: 'DEPOSIT_30_70', lines: [{ productId: 1 }] },
    costing: { totals: { goodsEur: 1000, originEur: 0, freightEur: 0, dutyEur: 0, destinationEur: 0, extraRevenueEur: 0, totalEur: 1000,
      separateCostsEur: 0, totalWithSeparateCostsEur: 1000, inspectionEur: 0, otherCosts: [] } },
    payable: { supplierEur: 1000, logisticsEur: 0, enrosedEur: 0, freightInSupplierPrice: false, ddp: false },
    reconciliation: { streams: [supplier], lines: [], notes: [], supplierInstalments: instalments, totals: { paidEur: supplier.paidEur } },
  } as unknown as PurchaseOrderView;
}

function payment(id: number, values: Partial<PurchasePayment> = {}): PurchasePayment {
  return { id, orderId: 50, paidOn: '2026-09-0' + id, amount: 100, currency: 'EUR', amountEur: 100, label: null,
    actor: 'emre', recordedAt: '2026-09-10T10:00:00Z', payee: 'SUPPLIER', settles: false, instalmentDue: null, ...values };
}

function ledger(view: PurchaseOrderView, payments: PurchasePayment[]): PaymentLedger {
  return purchasePaymentLedger({
    view, payments, documents: [],
    terms: purchaseInstalmentState(view, instalmentsOf(view.order, PAYMENT_TERMS), payments),
    settled: payee => purchaseGroupSettled(view, payments, payee),
    toleranceEur: 10, totalLabel: 'Totaal geland', planLabel: '30% bij bestelling, 70% bij vertrek',
  });
}

const supplierOf = (book: PaymentLedger) => book.payees.find(item => item.payee === 'SUPPLIER')!;
const term = (book: PaymentLedger, due: string): LedgerTerm => supplierOf(book).terms.find(item => item.due === due)!;
// The menus run in their own realm: copy their arrays before a deep comparison.
const ids = (items: { id: string }[]) => Array.from(items, item => item.id);

test('a term paid to the cent with a tied payment and no flag can be confirmed, never settled', () => {
  const payments = [payment(1, { amountEur: 300, amount: 300, instalmentDue: 'ORDERED' }), payment(2, { amountEur: 700, amount: 700, instalmentDue: 'SHIPPED' }),
    payment(3, { paidOn: '2026-09-09', amountEur: 0.01, amount: 0.01, instalmentDue: 'SHIPPED', payee: 'SUPPLIER' })];
  const book = ledger(purchase([instalment('ORDERED'), instalment('SHIPPED')]), payments.slice(0, 2));
  const shipped = term(book, 'SHIPPED');
  assert.deepEqual([shipped.state, shipped.openEur, shipped.canSettle, shipped.canConfirm, shipped.canUndo], ['paid', 0, false, true, false]);
  assert.deepEqual(shipped.status, { label: 'Betaald', tone: 'ok' });
  assert.deepEqual(shipped.paymentIds, [2]);
  const newestFirst = ledger(purchase([instalment('ORDERED'), instalment('SHIPPED')]), payments);
  assert.deepEqual(term(newestFirst, 'SHIPPED').paymentIds, [3, 2], 'the newest tied payment comes first');
});

test('canConfirm stays off for an unscoped, open, flagged, settled or differing term and without per-term server figures', () => {
  const plain = [instalment('ORDERED'), instalment('SHIPPED')];
  const unscoped = term(ledger(purchase(plain), [payment(1, { amountEur: 1000, amount: 1000 })]), 'SHIPPED');
  assert.deepEqual([unscoped.canConfirm, unscoped.paymentIds], [false, []]);
  const open = term(ledger(purchase([instalment('ORDERED'), instalment('SHIPPED', { paidEur: 0, remainingEur: 700, finalized: false })],
    stream({ paidEur: 300, remainingEur: 700, finalized: false })), [payment(1, { amountEur: 300, instalmentDue: 'ORDERED' }),
    payment(2, { amountEur: 0.5, instalmentDue: 'SHIPPED' })]), 'SHIPPED');
  assert.deepEqual([open.canSettle, open.canConfirm], [true, false]);
  const flagged = [payment(1, { amountEur: 300, instalmentDue: 'ORDERED' }), payment(2, { amountEur: 700, instalmentDue: 'SHIPPED', settles: true })];
  const settled = term(ledger(purchase([instalment('ORDERED'), instalment('SHIPPED', { explicitlySettled: true })]), flagged), 'SHIPPED');
  assert.deepEqual([settled.settled, settled.canConfirm, settled.canUndo], [true, false, true]);
  const lower = term(ledger(purchase([instalment('ORDERED'), instalment('SHIPPED', { paidEur: 690, settledSavingEur: 10 })]),
    [payment(1, { amountEur: 300, instalmentDue: 'ORDERED' }), payment(2, { amountEur: 690, instalmentDue: 'SHIPPED' })]), 'SHIPPED');
  assert.equal(lower.canConfirm, false, 'a term with a difference is settled, not confirmed');
  const legacy = ledger(purchase(undefined), [payment(1, { amountEur: 1000 })]);
  assert.equal(supplierOf(legacy).terms.every(item => !item.canConfirm), true);
});

test('the term menu offers pay, settle or confirm, per-term undo and the tied payment; a bare term has no menu', () => {
  const base: LedgerTerm = {
    due: 'SHIPPED', label: '70% bij vertrek', moment: 'bij vertrek', fullEur: 700, paidEur: 700, openEur: 0, lowerEur: 0, higherEur: 0,
    settled: false, finalized: true, state: 'paid', hasScopedPayment: true, paymentIds: [2], canSettle: false, canConfirm: true, canUndo: false,
    status: { label: 'Betaald', tone: 'ok' },
  };
  assert.deepEqual(ids(termMenuItems(base, false)), ['settle', 'edit']);
  assert.equal(termMenuItems(base, false).find(item => item.id === 'settle')!.label, 'Termijn afrekenen');
  assert.equal(termMenuItems(base, false).find(item => item.id === 'edit')!.label, 'Betaling aanpassen…');
  assert.deepEqual(ids(termMenuItems({ ...base, canConfirm: false, settled: true, canUndo: true }, false)), ['undo', 'edit']);
  assert.deepEqual(ids(termMenuItems({ ...base, openEur: 200, paidEur: 500, state: 'due', canConfirm: false, canSettle: true }, false)),
    ['add', 'settle', 'edit']);
  assert.equal(termMenuItems(base, true).every(item => item.disabled), true, 'busy disables every item');
  const bare = { ...base, paymentIds: [], hasScopedPayment: false, canConfirm: false };
  assert.deepEqual([termHasMenu(bare), termHasMenu(base), termHasMenu({ ...bare, openEur: 10, state: 'due' as const })], [false, true, true]);
});

test('Betaling aanpassen… opens the newest tied payment; the settle sheet relinks the newest payment without a term', () => {
  const payments = [payment(1, { amountEur: 300, instalmentDue: 'ORDERED' }), payment(2, { paidOn: '2026-09-05', amountEur: 700 }),
    payment(4, { paidOn: '2026-09-07', amountEur: 0.01, instalmentDue: 'ORDERED' })];
  const book = ledger(purchase([instalment('ORDERED', { paidEur: 300.01 }), instalment('SHIPPED')]), payments);
  assert.equal(termPayment(term(book, 'ORDERED'), book.rows)!.id, 4);
  assert.equal(termPayment(term(book, 'SHIPPED'), book.rows), null);
  assert.equal(relinkPayment(supplierOf(book))!.id, 2, 'the payment that lost its term, not the newest one');
  assert.equal(relinkPayment({ rows: supplierOf(book).rows.filter(row => row.due !== null) })!.id, 4, 'every payment has a term: the newest one');
  assert.equal(relinkPayment({ rows: [] }), null);
});

test('a whole-supplier settlement flags a payment without a term before any term payment', () => {
  const payments = [payment(1, { paidOn: '2026-08-01', instalmentDue: 'ORDERED' }), payment(2, { paidOn: '2026-08-10' }),
    payment(3, { paidOn: '2026-08-20', instalmentDue: 'SHIPPED' })];
  const group = settleCarriers(payments, 'SUPPLIER', 'GROUP', null);
  assert.equal(group.defaultId, 2);
  assert.equal(group.options.find(option => option.id === group.defaultId)!.reallocates, false);
  const allScoped = settleCarriers([payments[0], payments[2]], 'SUPPLIER', 'GROUP', null);
  assert.equal(allScoped.options.find(option => option.id === allScoped.defaultId)!.reallocates, true, 'only then the warning');
});
