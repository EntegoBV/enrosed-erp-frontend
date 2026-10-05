import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  PurchaseInstalmentReconciliation, PurchaseOrderView, PurchasePayment, PurchaseReconciliationStream,
} from '../src/app/core/api/models.ts';
import { PAYMENT_TERMS } from '../src/app/core/api/models.ts';
import { containerPayables } from '../src/app/features/finance/payables.ts';
import { instalmentsOf } from '../src/app/features/purchasing/payment-plan.ts';
import { purchaseGroupSettled, purchaseInstalmentState } from '../src/app/features/purchasing/purchase-instalment-state.ts';
import {
  DUE_MOMENT, DUE_ORDER, dueFallbackLabel, payeeComposition, purchaseCif, purchaseLandedBridge, purchasePaymentLedger, type PaymentLedger,
} from '../src/app/features/purchasing/purchase-payment-ledger.ts';
import { purchaseNacalcSummary } from '../src/app/features/purchasing/purchase-payment-result-metrics.ts';
import { purchaseNacalc } from '../src/app/features/purchasing/purchase-nacalc-metrics.ts';

// CIF: the supplier arranges and invoices the sea freight. The server moves
// origin costs + freight into the Leverancier Afspraak as its own term
// 'Zeevracht (CIF)' (FREIGHT, due at departure); duty and arrival costs stay
// with Douane & transport. The frontend only names and orders it.

function stream(payee: PurchaseReconciliationStream['payee'], values: Partial<PurchaseReconciliationStream> = {}): PurchaseReconciliationStream {
  return { payee, label: payee, status: 'UNPAID', plannedEur: 0, paidEur: 0, remainingEur: 0, forecastEur: 0, varianceEur: 0,
    overpaidEur: 0, settledSavingEur: 0, explicitlySettled: false, finalized: false, paymentCount: 0, ...values };
}

function term(due: PurchaseInstalmentReconciliation['due'], label: string, planned: number, paid = 0): PurchaseInstalmentReconciliation {
  return { due, label, plannedEur: planned, paidEur: paid, remainingEur: planned - paid, settledSavingEur: 0, overpaidEur: 0,
    explicitlySettled: false, finalized: paid === planned };
}

/** Goods 10.000 on 30/70 at departure; origin 200 + freight 1.800 via the supplier; duty 600 + arrival 400 via transport. */
function cif(status: PurchaseOrderView['order']['status'] = 'ONDERWEG', flag: boolean | null = true, ddp = false): PurchaseOrderView {
  return {
    order: { id: 60, number: 'INK-2026-020', status, supplierId: 8, paymentTerms: 'DEPOSIT_30_70', freightViaSupplier: flag,
      lines: [{ productId: 1, quantity: 1000, priceBasis: ddp ? 'DDP' : 'EXW' }] },
    costing: { totals: { goodsEur: 10000, originEur: 200, freightEur: 1800, dutyEur: 600, destinationEur: 400, extraRevenueEur: 0,
      totalEur: 13000, separateCostsEur: 0, totalWithSeparateCostsEur: 13000, inspectionEur: 0, otherCosts: [] } },
    costLabels: { originCostsLabel: 'Lokale kosten China', seaFreightLabel: 'Zeevracht', seaFreightRoute: 'Ningbo → Rotterdam',
      destinationCostsLabel: 'Lokale kosten aankomst' },
    payable: { supplierEur: 12000, logisticsEur: 1000, enrosedEur: 0, freightInSupplierPrice: true, ddp, supplierFreightEur: 2000 },
    reconciliation: {
      streams: [stream('SUPPLIER', { plannedEur: 12000, paidEur: 3000, remainingEur: 9000, forecastEur: 12000, paymentCount: 1 }),
        stream('LOGISTICS', { plannedEur: 1000, remainingEur: 1000, forecastEur: 1000 }), stream('SEPARATE'), stream('OTHER')],
      supplierInstalments: [term('ORDERED', '30% bij bestelling', 3000, 3000), term('SHIPPED', '70% bij vertrek', 7000),
        term('FREIGHT', 'Zeevracht (CIF)', 2000)],
      lines: [], notes: [],
      totals: { plannedExternalEur: 13000, paidEur: 3000, remainingEur: 10000, forecastExternalEur: 13000, varianceEur: 0, internalMarkupEur: 0,
        plannedPricingEur: 13000, forecastPricingEur: 13000, finalized: false, orderedQuantity: 1000, receivedQuantity: 0, damagedQuantity: 0,
        usableQuantity: 0, unitCostQuantity: 1000, unitCostBasis: 'ORDERED', forecastExternalUnitEur: 13, forecastPricingUnitEur: 13,
        receiptRecorded: false, legacyPaidTotalEur: null },
    },
  } as unknown as PurchaseOrderView;
}

const payments: PurchasePayment[] = [{ id: 1, orderId: 60, paidOn: '2026-08-01', amount: 3000, currency: 'EUR', amountEur: 3000, label: null,
  actor: 'emre', recordedAt: '2026-08-01T10:00:00Z', payee: 'SUPPLIER', settles: false, instalmentDue: 'ORDERED' }];

function ledger(view: PurchaseOrderView, list = payments): PaymentLedger {
  return purchasePaymentLedger({
    view, payments: list, documents: [],
    terms: purchaseInstalmentState(view, instalmentsOf(view.order, PAYMENT_TERMS), list),
    settled: payee => purchaseGroupSettled(view, list, payee),
    toleranceEur: 10, totalLabel: 'Totaal geland', planLabel: '30% bij bestelling, 70% bij vertrek',
  });
}

test('CIF needs the flag on a container that is not DDP', () => {
  assert.deepEqual([purchaseCif(cif()), purchaseCif(cif('ONDERWEG', null)), purchaseCif(cif('ONDERWEG', false)), purchaseCif(cif('ONDERWEG', true, true))],
    [true, false, false, false]);
});

test('the freight term falls due at departure, after the balance and before any arrival term', () => {
  assert.deepEqual(DUE_ORDER, ['ORDERED', 'SHIPPED', 'FREIGHT', 'ARRIVED']);
  assert.equal(DUE_MOMENT.FREIGHT, 'bij vertrek');
  assert.equal(dueFallbackLabel('FREIGHT'), 'Zeevracht (CIF)');
  const ordered = purchaseInstalmentState(cif('BESTELD'), [], payments);
  assert.deepEqual(ordered.map(state => [state.due, state.state]), [['ORDERED', 'paid'], ['SHIPPED', 'later'], ['FREIGHT', 'later']]);
  const sailing = ledger(cif('ONDERWEG'));
  const supplier = sailing.payees.find(item => item.payee === 'SUPPLIER')!;
  assert.deepEqual(supplier.terms.map(item => [item.label, item.moment, item.state, item.openEur]),
    [['30% bij bestelling', 'bij bestelling', 'paid', 0], ['70% bij vertrek', 'bij vertrek', 'due', 7000], ['Zeevracht (CIF)', 'bij vertrek', 'due', 2000]]);
  assert.deepEqual([supplier.dueNowEur, supplier.laterEur], [9000, 0]);
  assert.deepEqual(sailing.todos.filter(todo => todo.kind === 'pay' && todo.payee === 'SUPPLIER')
    .map(todo => todo.kind === 'pay' ? [todo.due, todo.label, todo.amountEur] : null),
    [['SHIPPED', '70% bij vertrek', 7000], ['FREIGHT', 'Zeevracht (CIF)', 2000]]);
});

test('the supplier is paid for goods + zeevracht under CIF, and Douane & transport only for duty and arrival costs', () => {
  const view = cif();
  const book = ledger(view);
  const supplier = book.payees.find(item => item.payee === 'SUPPLIER')!;
  const logistics = book.payees.find(item => item.payee === 'LOGISTICS')!;
  assert.equal(supplier.basis, 'Goederen + zeevracht (CIF) · 30% bij bestelling, 70% bij vertrek');
  assert.equal(logistics.basis, 'Raming uit Kosten: invoerrechten en lokale kosten aankomst · zeevracht via de leverancier (CIF)');
  assert.deepEqual(payeeComposition('SUPPLIER', view, 12000).lines.map(line => [line.label, line.amountEur]),
    [['Goederen', 10000], ['Lokale kosten China', 200], ['Zeevracht', 1800]]);
  assert.deepEqual(payeeComposition('LOGISTICS', view, 1000).lines.map(line => [line.label, line.amountEur]),
    [['Invoerrechten', 600], ['Lokale kosten aankomst', 400]]);
  assert.deepEqual([supplier.compositionConsistent, logistics.compositionConsistent], [true, true]);
  const bridge = purchaseLandedBridge(view, 'Totaal geland');
  assert.deepEqual(bridge.rows.slice(0, 2).map(row => [row.label, row.amountEur, row.note]),
    [['Leverancier · goederen + zeevracht', 12000, null], ['Douane & transport', 1000, 'zeevracht via de leverancier (CIF)']]);
  assert.equal(bridge.consistent, true);
  const exw = cif('ONDERWEG', null);
  assert.deepEqual(payeeComposition('LOGISTICS', exw, 3000).lines.map(line => line.label),
    ['Lokale kosten China', 'Zeevracht', 'Invoerrechten', 'Lokale kosten aankomst'], 'without CIF nothing moves');
});

test('Kosten & bank lists the freight term like the balance: due from departure, bij vertrek before', () => {
  const key = (view: PurchaseOrderView) => containerPayables([view]).filter(row => row.payee === 'SUPPLIER')
    .map(row => `${row.due}:${row.bucket}:${row.whenLabel}:${row.termLabel}`);
  assert.deepEqual(key(cif('BESTELD')), ['SHIPPED:later:bij vertrek:70% bij vertrek', 'FREIGHT:later:bij vertrek:Zeevracht (CIF)']);
  assert.deepEqual(key(cif('ONDERWEG')), ['SHIPPED:now:nu:70% bij vertrek', 'FREIGHT:now:nu:Zeevracht (CIF)']);
});

test('the Nacalculatie shows the freight term and the CIF note on Douane & transport', () => {
  const view = cif();
  const book = ledger(view);
  const n = purchaseNacalc({ view, ledger: book, summary: purchaseNacalcSummary(view, book) })!;
  const supplier = n.payees!.find(row => row.payee === 'SUPPLIER')!;
  const logistics = n.payees!.find(row => row.payee === 'LOGISTICS')!;
  assert.deepEqual(supplier.terms.map(row => [row.label, row.agreedEur]), [['30% bij bestelling', 3000], ['70% bij vertrek', 7000], ['Zeevracht (CIF)', 2000]]);
  assert.deepEqual([supplier.cifNote, logistics.cifNote], [false, true]);
  assert.match(logistics.basis, /zeevracht via de leverancier \(CIF\)/);
});
