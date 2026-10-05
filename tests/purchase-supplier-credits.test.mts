import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import type {
  PurchaseCreditOffset, PurchaseOrderView, PurchasePayment, PurchaseReconciliationStream, PurchaseSupplierCredit,
} from '../src/app/core/api/models.ts';
import { PAYMENT_TERMS } from '../src/app/core/api/models.ts';
import { instalmentsOf } from '../src/app/features/purchasing/payment-plan.ts';
import { purchaseGroupSettled, purchaseInstalmentState } from '../src/app/features/purchasing/purchase-instalment-state.ts';
import {
  PAYEE_ICON, PAYEE_LABEL, PAYEE_ORDER, creditOffsetTargets, ledgerCredits, purchasePaymentLedger, supplierCreditEditBody,
  supplierCreditKeptEur, supplierCreditPrefill, supplierCreditRefundBody, type LedgerCredit, type LedgerRow, type LedgerTodo, type PaymentLedger,
} from '../src/app/features/purchasing/purchase-payment-ledger.ts';
import { purchaseNacalcSummary } from '../src/app/features/purchasing/purchase-payment-result-metrics.ts';
import { nacalcBridge, purchaseNacalc } from '../src/app/features/purchasing/purchase-nacalc-metrics.ts';

// Tegoed leverancier: a credit the supplier owes back after a short delivery.
// It lowers the eindkost (server forecast = paid + open − credit) but never
// Betaald or Open; it is listed under Leverancier, asked for in Te doen while
// open, and named in the Nacalculatie's rows, bridge, receipt and sentence.

const menusSource = await readFile(new URL('../src/app/features/purchasing/purchase-payment-menus.ts', import.meta.url), 'utf8');
const menusParsed = ts.createSourceFile('purchase-payment-menus.ts', menusSource, ts.ScriptTarget.Latest, true);
const menusJs = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(menusParsed,
  menusParsed.statements.filter(node => !ts.isImportDeclaration(node)))), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const menus: Record<string, any> = {};
vm.runInNewContext(menusJs, { exports: menus, PAYEE_LABEL, PAYEE_ORDER, PAYEE_ICON, Intl });
/** A copy out of the menus' realm, with the non-breaking spaces of Intl as plain ones. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value).replace(/[\u00a0\u202f]/g, ' '));

function stream(payee: PurchaseReconciliationStream['payee'], values: Partial<PurchaseReconciliationStream> = {}): PurchaseReconciliationStream {
  return { payee, label: PAYEE_LABEL[payee], status: 'PAID', plannedEur: 0, paidEur: 0, remainingEur: 0, forecastEur: 0, varianceEur: 0,
    overpaidEur: 0, settledSavingEur: 0, explicitlySettled: false, finalized: true, paymentCount: 0, ...values };
}

function credit(id: number, values: Partial<PurchaseSupplierCredit> = {}): PurchaseSupplierCredit {
  return { id, notedOn: '2026-09-1' + id, amount: 300, currency: 'EUR', amountEur: 300, reason: 'SHORTAGE', note: null, status: 'OPEN',
    settledOn: null, offsetOrderId: null, offsetOrderNumber: null, offsetPaymentId: null, recordedAt: '2026-09-20T10:00:00Z', actor: 'emre', ...values };
}

function payment(id: number, values: Partial<PurchasePayment> = {}): PurchasePayment {
  return { id, orderId: 50, paidOn: '2026-08-0' + id, amount: 1000, currency: 'EUR', amountEur: 1000, label: null, actor: 'emre',
    recordedAt: '2026-08-01T10:00:00Z', payee: 'SUPPLIER', settles: false, instalmentDue: null, ...values };
}

/** Received short: supplier 10.000 paid in full, 500 credited (300 open, 200 refunded); transport 1.000 paid. */
function received(credits: PurchaseSupplierCredit[] = [credit(1), credit(2, { amount: 200, amountEur: 200, status: 'REFUNDED', settledOn: '2026-09-25' })],
  offsets: PurchaseCreditOffset[] = []): PurchaseOrderView {
  const creditEur = credits.reduce((sum, item) => sum + item.amountEur, 0);
  const openEur = credits.filter(item => item.status === 'OPEN').reduce((sum, item) => sum + item.amountEur, 0);
  return {
    order: { id: 50, number: 'INK-2026-014', status: 'ONTVANGEN', supplierId: 8, orderDate: '2026-06-01', paymentTerms: 'FULL_UPFRONT',
      cnyToUsd: 0.14, usdToEurGoods: 0.9, lines: [{ productId: 1, quantity: 900, orderedQuantity: 1000, receiptUnitValueEur: 10 }] },
    costing: { totals: { goodsEur: 10000, originEur: 0, freightEur: 800, dutyEur: 200, destinationEur: 0, extraRevenueEur: 0, totalEur: 11000,
      separateCostsEur: 0, totalWithSeparateCostsEur: 11000, inspectionEur: 0, otherCosts: [] } },
    payable: { supplierEur: 10000, logisticsEur: 1000, enrosedEur: 0, freightInSupplierPrice: false, ddp: false },
    receiptVariance: { affectedOrders: 1, affectedLines: 1, orderedPieces: 1000, receivedPieces: 900, missingPieces: 100, overReceivedPieces: 0,
      damagedPieces: 10, usablePieces: 890, missingValueEur: 1000, damagedValueEur: 100, totalLossValueEur: 1100, unvaluedLossPieces: 0, valuationComplete: true },
    receiptReports: [],
    supplierCredits: credits,
    creditOffsets: offsets,
    reconciliation: {
      streams: [
        stream('SUPPLIER', { plannedEur: 10000, paidEur: 10000, forecastEur: 10000 - creditEur, varianceEur: -creditEur, paymentCount: 1, creditEur }),
        stream('LOGISTICS', { plannedEur: 1000, paidEur: 1000, forecastEur: 1000, paymentCount: 1 }),
        stream('SEPARATE', { status: 'NOT_APPLICABLE' }), stream('OTHER', { status: 'NOT_APPLICABLE' }),
      ],
      supplierInstalments: [{ due: 'ORDERED', label: '100% bij bestelling', plannedEur: 10000, paidEur: 10000, remainingEur: 0,
        settledSavingEur: 0, overpaidEur: 0, explicitlySettled: false, finalized: true }],
      lines: [],
      notes: [],
      totals: { plannedExternalEur: 11000, paidEur: 11000, remainingEur: 0, forecastExternalEur: 11000 - creditEur, varianceEur: -creditEur,
        internalMarkupEur: 0, plannedPricingEur: 11000, forecastPricingEur: 11000 - creditEur, finalized: true, orderedQuantity: 1000,
        receivedQuantity: 900, damagedQuantity: 10, usableQuantity: 890, unitCostQuantity: 890, unitCostBasis: 'USABLE_RECEIVED',
        forecastExternalUnitEur: 11.8, forecastPricingUnitEur: 11.8, receiptRecorded: true, legacyPaidTotalEur: null,
        supplierCreditEur: creditEur, supplierCreditOpenEur: openEur },
    },
  } as unknown as PurchaseOrderView;
}

const payments = [payment(1, { amount: 10000, amountEur: 10000, instalmentDue: 'ORDERED' }),
  payment(2, { payee: 'LOGISTICS', amount: 1000, amountEur: 1000 })];

function ledger(view: PurchaseOrderView, list = payments): PaymentLedger {
  return purchasePaymentLedger({
    view, payments: list, documents: [],
    terms: purchaseInstalmentState(view, instalmentsOf(view.order, PAYMENT_TERMS), list),
    settled: payee => purchaseGroupSettled(view, list, payee),
    toleranceEur: 10, totalLabel: 'Totaal geland', planLabel: '100% bij bestelling',
  });
}

const supplierOf = (book: PaymentLedger) => book.payees.find(item => item.payee === 'SUPPLIER')!;

test('credits read newest first with their reason and where they stand', () => {
  const list = ledgerCredits([credit(1, { reason: 'DAMAGE' }), credit(3, { status: 'OFFSET', offsetOrderId: 51, offsetOrderNumber: 'INK-2026-015', settledOn: '2026-09-26' }),
    credit(2, { status: 'REFUNDED', settledOn: '2026-09-25', reason: 'PRICE', note: '  per mail  ' })]);
  assert.deepEqual(list.map(item => [item.id, item.reasonLabel, item.statusLabel, item.tone, item.open, item.note]), [
    [3, 'Tekort', 'Verrekend met INK-2026-015', 'ok', false, null],
    [2, 'Prijsverschil', 'Terugbetaald 25/09', 'ok', false, 'per mail'],
    [1, 'Schade', 'Tegoed open', 'warn', true, null],
  ]);
});

test('a credit lowers the forecast, never Betaald or Open, and an open one is asked for in Te doen', () => {
  const book = ledger(received());
  const supplier = supplierOf(book);
  assert.deepEqual([supplier.paidEur, supplier.openEur, supplier.creditEur, supplier.creditOpenEur, supplier.balanced], [10000, 0, 500, 300, true]);
  assert.deepEqual(supplier.credits.map(item => item.id), [2, 1]);
  assert.equal(book.payees.find(item => item.payee === 'LOGISTICS')!.credits.length, 0, 'credits only belong to the supplier');
  assert.deepEqual([book.summary.paidTotalEur, book.summary.openEur, book.summary.creditEur, book.summary.creditOpenEur, book.summary.forecastEur],
    [11000, 0, 500, 300, 10500]);
  assert.deepEqual(book.todos.filter(todo => todo.kind === 'credit'), [{ kind: 'credit', key: 'credit:SUPPLIER', payee: 'SUPPLIER', amountEur: 300, count: 1 }]);
  const settled = ledger(received([credit(1, { status: 'REFUNDED', settledOn: '2026-09-25' })]));
  assert.equal(settled.todos.some(todo => todo.kind === 'credit'), false, 'a refunded credit asks for nothing');
  assert.equal(settled.summary.forecastEur, 10700);
});

test('without server credit totals the credits themselves count; an old response without credits is untouched', () => {
  const view = received();
  delete (view.reconciliation!.streams[0] as Partial<PurchaseReconciliationStream>).creditEur;
  assert.deepEqual([supplierOf(ledger(view)).creditEur, supplierOf(ledger(view)).creditOpenEur], [500, 300]);
  const old = received([]);
  delete (old as Partial<PurchaseOrderView>).supplierCredits;
  const book = ledger(old);
  assert.deepEqual([supplierOf(book).creditEur, book.summary.forecastEur, book.todos.some(todo => todo.kind === 'credit')], [0, 11000, false]);
});

test('a payment that offsets a credit of another container says so and cannot be moved to another payee', () => {
  const offset: PurchaseCreditOffset = { creditId: 9, sourceOrderId: 49, sourceOrderNumber: 'INK-2026-013', paymentId: 3, amountEur: 250 };
  const view = received([], [offset]);
  const book = ledger(view, [...payments, payment(3, { amount: 250, amountEur: 250, label: null })]);
  const row = book.rows.find(item => item.id === 3)!;
  assert.deepEqual(plain(row.creditOffset), offset);
  assert.equal(row.title, 'Verrekend tegoed INK-2026-013');
  const items = (row: LedgerRow) => Array.from(menus['paymentMenuItems'](row, { move: true, busy: false }) as { id: string }[], item => item.id);
  assert.equal(items(row).some(id => id.startsWith('move:')), false);
  assert.equal(items(book.rows.find(item => item.id === 1)!).some(id => id.startsWith('move:')), true);
});

test('the credit menu follows its status: open acts, refunded reopens, offset points to the other container', () => {
  const items = (item: LedgerCredit) => Array.from(menus['creditMenuItems'](item, false) as { id: string; label: string }[], entry => [entry.id, entry.label]);
  const [open] = ledgerCredits([credit(1)]);
  assert.deepEqual(items(open), [['refund', 'Terugbetaald noteren…'], ['offset', 'Verrekenen met…'], ['edit', 'Aanpassen…'], ['remove', 'Verwijderen']]);
  const [refunded] = ledgerCredits([credit(1, { status: 'REFUNDED', settledOn: '2026-09-25' })]);
  assert.deepEqual(items(refunded), [['undo-refund', 'Terugbetaling ongedaan maken']]);
  const [offset] = ledgerCredits([credit(1, { status: 'OFFSET', offsetOrderId: 51, offsetOrderNumber: 'INK-2026-015' })]);
  assert.deepEqual(items(offset), [['open-offset', 'Naar INK-2026-015 ›']]);
  const busy = menus['creditMenuItems'](open, true) as { disabled?: boolean }[];
  assert.equal(busy.every(item => item.disabled), true);
  const todo: LedgerTodo = { kind: 'credit', key: 'credit:SUPPLIER', payee: 'SUPPLIER', amountEur: 300, count: 1 };
  assert.deepEqual(plain(menus['todoCopy'](todo)), { title: 'Tegoed open bij Leverancier', action: 'Bekijken',
    detail: '€ 300,00 te ontvangen · terugbetaling of verrekening' });
});

test('the proposed amount is the value of the missing or damaged pieces, less what earlier credits for that reason claim', () => {
  const view = received([]);
  assert.deepEqual([supplierCreditPrefill(view, 'SHORTAGE'), supplierCreditPrefill(view, 'DAMAGE'), supplierCreditPrefill(view, 'PRICE')], [1000, 100, null]);
  const claimed = received([credit(1, { amountEur: 300 }), credit(2, { reason: 'DAMAGE', amountEur: 100 })]);
  assert.deepEqual([supplierCreditPrefill(claimed, 'SHORTAGE'), supplierCreditPrefill(claimed, 'DAMAGE')], [700, null]);
  assert.equal(supplierCreditPrefill({ receiptVariance: undefined, supplierCredits: [] }, 'SHORTAGE'), null, 'nothing to propose before receipt');
});

test('correcting a USD credit sends no stored euro, so a new amount gets a new euro value; an emptied note clears it', () => {
  const usd = credit(1, { amount: 1000, currency: 'USD', amountEur: 920, note: 'bevestigd per mail' });
  // Only the amount changes and the euro field stays empty: the server recalculates at the order rate.
  const edit = supplierCreditEditBody({ amount: 800, currency: 'USD', amountEur: null, reason: 'SHORTAGE', note: '' });
  assert.deepEqual(edit, { amount: 800, currency: 'USD', reason: 'SHORTAGE', note: '' });
  assert.equal('amountEur' in edit, false);
  assert.equal(supplierCreditKeptEur(usd, 800, 'USD'), null, 'a new amount does not keep the old euro');
  assert.equal(supplierCreditKeptEur(usd, 1000, 'CNY'), null, 'nor does a new currency');
  assert.equal(supplierCreditKeptEur(usd, 1000, 'USD'), 920, 'the same amount and currency keep the stored euro');
  assert.equal(supplierCreditKeptEur(usd, null, 'USD'), null);
  // A typed bank euro goes along for USD/CNY only; the note is sent trimmed, never as null.
  assert.deepEqual(supplierCreditEditBody({ amount: 800, currency: 'USD', amountEur: 730.5, reason: 'DAMAGE', note: '  40 dozen ' }),
    { amount: 800, currency: 'USD', reason: 'DAMAGE', note: '40 dozen', amountEur: 730.5 });
  assert.deepEqual(supplierCreditEditBody({ amount: 450, currency: 'EUR', amountEur: 450, reason: 'OTHER', note: 'x' }),
    { amount: 450, currency: 'EUR', reason: 'OTHER', note: 'x' });
});

test('a refund of another sum changes the amount of a euro credit; a USD credit keeps its amount and takes the bank euro', () => {
  const eur = credit(1, { amount: 500, amountEur: 500 });
  assert.deepEqual(supplierCreditRefundBody(eur, '2026-09-28', 480),
    { status: 'REFUNDED', settledOn: '2026-09-28', amount: 480, amountEur: 480 }, 'a partial euro refund keeps amount and euro equal');
  assert.deepEqual(supplierCreditRefundBody(eur, '2026-09-28', 500), { status: 'REFUNDED', settledOn: '2026-09-28' }, 'to the cent: nothing else changes');
  const usd = credit(2, { amount: 1000, currency: 'USD', amountEur: 920 });
  assert.deepEqual(supplierCreditRefundBody(usd, '2026-09-28', 905.4), { status: 'REFUNDED', settledOn: '2026-09-28', amountEur: 905.4 });
  assert.deepEqual(supplierCreditRefundBody(usd, '2026-09-28', 920), { status: 'REFUNDED', settledOn: '2026-09-28', amountEur: 920 });
});

test('a credit is offset only on another ordered container of the same supplier, newest first', () => {
  const make = (id: number, supplierId: number, status: string, orderDate: string) => ({ order: { id, supplierId, status, orderDate } }) as unknown as PurchaseOrderView;
  const views = [make(50, 8, 'ONTVANGEN', '2026-06-01'), make(51, 8, 'BESTELD', '2026-08-01'), make(52, 8, 'CONCEPT', '2026-09-01'),
    make(53, 9, 'BESTELD', '2026-09-02'), make(54, 8, 'ONTVANGEN', '2026-07-01')];
  assert.deepEqual(creditOffsetTargets(views, { id: 50, supplierId: 8 }).map(view => view.order.id), [51, 54]);
});

test('the Nacalculatie names the credit: payee row, receipt, bridge and the state sentence while it is open', () => {
  const view = received();
  const book = ledger(view);
  const summary = purchaseNacalcSummary(view, book)!;
  const n = purchaseNacalc({ view, ledger: book, summary })!;
  assert.deepEqual([n.headline.eindkostEur, n.headline.verschilEur, n.headline.creditEur, n.headline.creditOpenEur], [10500, -500, 500, 300]);
  assert.match(plain(n.headline.sentence), / · tegoed € 300,00 open$/);
  const supplier = n.payees!.find(row => row.payee === 'SUPPLIER')!;
  assert.deepEqual([supplier.eindkostEur, supplier.verschilEur, supplier.creditEur, supplier.reason], [9500, -500, 500, 'credit']);
  assert.equal(plain(supplier.reasonLabel), 'tegoed leverancier − € 500,00 · € 300,00 te ontvangen');
  assert.deepEqual(n.receipt!.credit, { totalEur: 500, openEur: 300, count: 2 });
  const rows = nacalcBridge(view, summary).rows;
  const keys = rows.map(row => row.key);
  assert.deepEqual(keys.slice(keys.indexOf('PAID')), ['PAID', 'OPEN', 'CREDIT', 'FORECAST', 'VARIANCE']);
  const creditRow = rows.find(row => row.key === 'CREDIT')!;
  assert.deepEqual([creditRow.label, creditRow.amountEur, creditRow.op, plain(creditRow.note)], ['Tegoed leverancier', 500, '−', 'waarvan € 300,00 nog te ontvangen']);
  const paid = rows.find(row => row.key === 'PAID')!.amountEur;
  const open = rows.find(row => row.key === 'OPEN')!.amountEur;
  assert.equal(Math.round((paid + open - creditRow.amountEur) * 100), Math.round(rows.find(row => row.key === 'FORECAST')!.amountEur * 100), 'the bridge closes');
  const none = received([]);
  const plainStory = purchaseNacalc({ view: none, ledger: ledger(none), summary: purchaseNacalcSummary(none, ledger(none)) })!;
  assert.deepEqual([plainStory.receipt!.credit, plainStory.headline.creditEur, plainStory.bridge.rows.some(row => row.key === 'CREDIT')], [null, 0, false]);
  assert.equal(plainStory.payees!.find(row => row.payee === 'SUPPLIER')!.reason, 'none');
});
