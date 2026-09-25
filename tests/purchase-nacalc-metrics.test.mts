import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import type {
  PartnerFinancing, PurchaseInstalmentReconciliation, PurchaseOrderView, PurchasePayment, PurchaseReconciliationLine, PurchaseReconciliationStream,
} from '../src/app/core/api/models.ts';
import { PAYMENT_TERMS } from '../src/app/core/api/models.ts';
import { instalmentsOf } from '../src/app/features/purchasing/payment-plan.ts';
import { purchaseGroupSettled, purchaseInstalmentState } from '../src/app/features/purchasing/purchase-instalment-state.ts';
import {
  DUE_MOMENT, PAYEE_LABEL, PAYEE_ORDER, purchasePaymentLedger, type LedgerTodo, type PaymentLedger,
} from '../src/app/features/purchasing/purchase-payment-ledger.ts';
import { NACALC_LABEL, NACALC_PILL, purchaseNacalcSummary } from '../src/app/features/purchasing/purchase-payment-result-metrics.ts';
import {
  NACALC_REASON_LABEL, nacalcActionLabel, nacalcBridge, nacalcReason, paymentFxEur, purchaseNacalc, type PurchaseNacalc,
} from '../src/app/features/purchasing/purchase-nacalc-metrics.ts';

type Stream = PurchaseReconciliationStream;
type Term = PurchaseInstalmentReconciliation;
type Line = PurchaseReconciliationLine;

function stream(payee: Stream['payee'], values: Partial<Stream> = {}): Stream {
  const labels = { SUPPLIER: 'Leverancier', LOGISTICS: 'Douane & transport', SEPARATE: 'Inspectie & andere kosten', OTHER: 'Extra uitgaven' };
  return { payee, label: labels[payee], status: 'UNPAID', plannedEur: 0, paidEur: 0, remainingEur: 0, forecastEur: 0, varianceEur: 0,
    overpaidEur: 0, settledSavingEur: 0, explicitlySettled: false, finalized: false, paymentCount: 0, ...values };
}

function term(due: Term['due'], label: string, values: Partial<Term> = {}): Term {
  return { due, label, plannedEur: 0, paidEur: 0, remainingEur: 0, settledSavingEur: 0, overpaidEur: 0, explicitlySettled: false, finalized: false, ...values };
}

function line(productId: number, name: string, ordered: number, plan: number, forecast: number, unit: number, pricingUnit: number,
  received = 0, damaged = 0, basis: Line['unitCostBasis'] = 'ORDERED'): Line {
  const usable = basis === 'ORDERED' ? 0 : received - damaged;
  return { productId, productName: name, orderedQuantity: ordered, receivedQuantity: received, damagedQuantity: damaged, usableQuantity: usable,
    unitCostQuantity: basis === 'ORDERED' ? ordered : usable, unitCostBasis: basis, plannedExternalEur: plan, paidEur: 0, remainingEur: 0,
    forecastExternalEur: forecast, varianceEur: Math.round((forecast - plan) * 100) / 100, internalMarkupEur: 0, forecastPricingEur: 0,
    forecastExternalUnitEur: unit, forecastPricingUnitEur: pricingUnit, allocationBasis: 'goods' };
}

function payment(id: number, values: Partial<PurchasePayment> = {}): PurchasePayment {
  return { id, orderId: 12, paidOn: '2026-07-0' + (id % 9 + 1), amount: 100, currency: 'EUR', amountEur: 100, label: null, actor: 'emre',
    recordedAt: '2026-07-10T10:00:00Z', payee: 'SUPPLIER', settles: false, instalmentDue: null, ...values };
}

/** Mock 12: in transit, supplier paid and settled, transport partly paid, inspection open, partner 20 % / 50 %. */
function transit(): { view: PurchaseOrderView; payments: PurchasePayment[] } {
  const view = {
    order: { id: 12, number: 'PO-2026-012', status: 'ONDERWEG', paymentTerms: 'DEPOSIT_30_70', partnerCustomerId: 5, partnerCostPct: 20, partnerSharePct: 50,
      cnyToUsd: 0.1405, usdToEurGoods: 0.86, lines: [
        { id: 1201, productId: 200, quantity: 480, orderedQuantity: 480 }, { id: 1202, productId: 201, quantity: 400, orderedQuantity: 400 },
        { id: 1205, productId: 204, quantity: 1440, orderedQuantity: 1440 }] },
    costing: { totals: { goodsEur: 61500, totalEur: 74524.31, totalWithSeparateCostsEur: 75054.31, separateCostsEur: 530, separateCostsInPiecePrice: false,
      extraRevenueEur: 4850, inspectionEur: 530, otherCosts: [] } },
    payable: { supplierEur: 61500, logisticsEur: 8174.31, enrosedEur: 4850, freightInSupplierPrice: false, ddp: false },
    receiptReports: [],
    reconciliation: {
      totals: { plannedExternalEur: 70204.31, paidEur: 64780.5, remainingEur: 5423.81, forecastExternalEur: 70204.31, varianceEur: 0, internalMarkupEur: 4850,
        plannedPricingEur: 75054.31, forecastPricingEur: 75054.31, finalized: false, orderedQuantity: 5560, receivedQuantity: 0, damagedQuantity: 0,
        usableQuantity: 0, unitCostQuantity: 5560, unitCostBasis: 'ORDERED', forecastExternalUnitEur: 12.6267, forecastPricingUnitEur: 13.499,
        receiptRecorded: false, legacyPaidTotalEur: null },
      streams: [
        stream('SUPPLIER', { status: 'PAID', plannedEur: 61500, paidEur: 61500, forecastEur: 61500, finalized: true, paymentCount: 2 }),
        stream('LOGISTICS', { status: 'PARTIAL', plannedEur: 8174.31, paidEur: 3280.5, remainingEur: 4893.81, forecastEur: 8174.31, paymentCount: 1 }),
        stream('SEPARATE', { status: 'UNPAID', plannedEur: 530, remainingEur: 530, forecastEur: 530 }),
        stream('OTHER', { status: 'NOT_APPLICABLE', finalized: true }),
      ],
      supplierInstalments: [
        term('ORDERED', '30% bij bestelling', { plannedEur: 18450, paidEur: 18450, finalized: true }),
        term('SHIPPED', '70% bij vertrek', { plannedEur: 43050, paidEur: 43050, explicitlySettled: true, finalized: true }),
      ],
      lines: [
        line(200, 'Half hart foam 40 cm roze', 480, 10571.84, 10571.84, 22.0247, 22.897),
        line(201, 'Half hart foam 40 cm rood', 400, 8809.86, 8809.86, 22.0247, 22.897),
        line(204, 'Rozenbeer 25 cm rood', 4680, 50822.61, 50822.61, 10.8595, 11.7318),
      ],
      notes: ['Leverancier volgens betaalafspraak 30% bij bestelling, 70% bij vertrek: € 61.500,00.',
        'Betalingen in USD of CNY tellen tegen hun opgeslagen eurowaarde: de orderkoers, of het afgeschreven bankbedrag als dat is ingevuld.'],
    },
  } as unknown as PurchaseOrderView;
  const payments = [
    payment(101, { amount: 21453.49, currency: 'USD', amountEur: 18450, instalmentDue: 'ORDERED', label: 'Aanbetaling 30%' }),
    payment(102, { amount: 50058.14, currency: 'USD', amountEur: 43050, instalmentDue: 'SHIPPED', settles: true, label: 'Saldo 70%' }),
    payment(103, { payee: 'LOGISTICS', amount: 3280.5, amountEur: 3280.5, label: 'Zeevracht + THC' }),
  ];
  return { view, payments };
}

/** Mock 13: DDP in USD, supplier paid € 350 too much (unsettled), transport paid without budget, one bank amount below the order rate. */
function overpaid(): { view: PurchaseOrderView; payments: PurchasePayment[] } {
  const view = {
    order: { id: 13, number: 'PO-2026-013', status: 'ONDERWEG', paymentTerms: 'DEPOSIT_30_70', partnerCustomerId: null, cnyToUsd: 0.1405, usdToEurGoods: 0.86,
      lines: [{ id: 1301, productId: 200, quantity: 480, orderedQuantity: 480, priceBasis: 'DDP' }, { id: 1303, productId: 216, quantity: 720, orderedQuantity: 720, priceBasis: 'DDP' }] },
    costing: { totals: { goodsEur: 31537.92, totalEur: 33937.92, totalWithSeparateCostsEur: 33937.92, separateCostsEur: 0, separateCostsInPiecePrice: false, extraRevenueEur: 2400 } },
    payable: { supplierEur: 31537.92, logisticsEur: 0, enrosedEur: 2400, freightInSupplierPrice: false, ddp: true },
    reconciliation: {
      totals: { plannedExternalEur: 31537.92, paidEur: 32007.92, remainingEur: 0, forecastExternalEur: 32007.92, varianceEur: 470, internalMarkupEur: 2400,
        plannedPricingEur: 33937.92, forecastPricingEur: 34407.92, finalized: false, orderedQuantity: 1680, receivedQuantity: 0, damagedQuantity: 0, usableQuantity: 0,
        unitCostQuantity: 1680, unitCostBasis: 'ORDERED', forecastExternalUnitEur: 19.0523, forecastPricingUnitEur: 20.4809, receiptRecorded: false, legacyPaidTotalEur: null },
      streams: [
        stream('SUPPLIER', { status: 'OVERPAID', plannedEur: 31537.92, paidEur: 31887.92, forecastEur: 31887.92, varianceEur: 350, overpaidEur: 350, paymentCount: 3 }),
        stream('LOGISTICS', { status: 'ADDITIONAL', paidEur: 120, forecastEur: 120, varianceEur: 120, overpaidEur: 120, paymentCount: 1 }),
        stream('SEPARATE', { status: 'NOT_APPLICABLE', finalized: true }),
        stream('OTHER', { status: 'NOT_APPLICABLE', finalized: true }),
      ],
      supplierInstalments: [
        term('ORDERED', '30% bij bestelling', { plannedEur: 9461.38, paidEur: 9461.38, finalized: true }),
        term('SHIPPED', '70% bij vertrek', { plannedEur: 22076.54, paidEur: 22426.54, overpaidEur: 350 }),
      ],
      lines: [line(200, 'Half hart foam 40 cm roze', 960, 21878.4, 22204.45, 23.1296, 24.5582), line(216, 'Half hart foam 25 cm rood', 720, 9659.52, 9803.47, 13.6159, 15.0445)],
      notes: ['Te veel betaalde bedragen blijven in de verwachte kost staan; er kan nog terugbetaling volgen.'],
    },
  } as unknown as PurchaseOrderView;
  const payments = [
    payment(110, { orderId: 13, amount: 11001.6, currency: 'USD', amountEur: 9461.38, instalmentDue: 'ORDERED' }),
    payment(111, { orderId: 13, amount: 25670.4, currency: 'USD', amountEur: 21926.54, instalmentDue: 'SHIPPED' }),
    payment(112, { orderId: 13, amount: 500, amountEur: 500, label: 'Extra factuur monsters' }),
    payment(113, { orderId: 13, payee: 'LOGISTICS', amount: 120, amountEur: 120, label: 'Douane extra controle' }),
  ];
  return { view, payments };
}

/** Mock 11: received, DDP, 70 % settled € 900 lower, inspection settled € 20 lower, € 45 bank costs, one line 24 over, one later report. */
function settled(): { view: PurchaseOrderView; payments: PurchasePayment[] } {
  const view = {
    order: { id: 11, number: 'PO-2026-011', status: 'ONTVANGEN', paymentTerms: 'DEPOSIT_30_70', partnerCustomerId: null, cnyToUsd: 0.1405, usdToEurGoods: 0.86,
      lines: [
        { id: 1101, productId: 204, quantity: 1104, orderedQuantity: 1080, receiptUnitValueEur: 8.084, priceBasis: 'DDP' },
        { id: 1102, productId: 205, quantity: 960, orderedQuantity: 960, receiptUnitValueEur: 8.084, priceBasis: 'DDP' },
        { id: 1104, productId: 208, quantity: 240, orderedQuantity: 240, receiptUnitValueEur: 18.232, priceBasis: 'DDP' }] },
    costing: { totals: { goodsEur: 29110.66, totalEur: 32010.66, totalWithSeparateCostsEur: 32310.66, separateCostsEur: 300, separateCostsInPiecePrice: false, extraRevenueEur: 2900 } },
    payable: { supplierEur: 29110.66, logisticsEur: 0, enrosedEur: 2900, freightInSupplierPrice: false, ddp: true },
    receiptVariance: { affectedOrders: 1, affectedLines: 1, orderedPieces: 2880, receivedPieces: 2904, missingPieces: 0, overReceivedPieces: 24, damagedPieces: 0,
      usablePieces: 2904, missingValueEur: 0, damagedValueEur: 0, totalLossValueEur: 0, unvaluedLossPieces: 0, valuationComplete: true },
    receiptReports: [{ productId: 208, sku: 'ER-208', productName: 'Rozenbeer 40 cm rood', source: 'LATER', on: '2026-06-09', damaged: 2, missing: 0, note: null, actor: 'berat' }],
    reconciliation: {
      totals: { plannedExternalEur: 29216.64, paidEur: 28341.64, remainingEur: 0, forecastExternalEur: 28341.64, varianceEur: -875, internalMarkupEur: 2900,
        plannedPricingEur: 32116.64, forecastPricingEur: 31241.64, finalized: true, orderedQuantity: 2880, receivedQuantity: 2904, damagedQuantity: 0, usableQuantity: 2904,
        unitCostQuantity: 2904, unitCostBasis: 'USABLE_RECEIVED', forecastExternalUnitEur: 9.7595, forecastPricingUnitEur: 10.7581, receiptRecorded: true, legacyPaidTotalEur: null },
      streams: [
        stream('SUPPLIER', { status: 'SETTLED_LOWER', plannedEur: 28916.64, paidEur: 28016.64, forecastEur: 28016.64, varianceEur: -900, settledSavingEur: 900, finalized: true, paymentCount: 2 }),
        stream('LOGISTICS', { status: 'NOT_APPLICABLE', finalized: true }),
        stream('SEPARATE', { status: 'SETTLED_LOWER', plannedEur: 300, paidEur: 280, forecastEur: 280, varianceEur: -20, settledSavingEur: 20, explicitlySettled: true, finalized: true, paymentCount: 1 }),
        stream('OTHER', { status: 'ADDITIONAL', paidEur: 45, forecastEur: 45, varianceEur: 45, finalized: true, paymentCount: 1 }),
      ],
      supplierInstalments: [
        term('ORDERED', '30% bij bestelling', { plannedEur: 8674.99, paidEur: 8674.99, finalized: true }),
        term('SHIPPED', '70% bij vertrek', { plannedEur: 20241.65, paidEur: 19341.65, settledSavingEur: 900, explicitlySettled: true, finalized: true }),
      ],
      lines: [
        line(204, 'Rozenbeer 25 cm rood', 1080, 8843.22, 8578.38, 7.7703, 8.7689, 1104, 0, 'USABLE_RECEIVED'),
        line(205, 'Rozenbeer 25 cm roze', 960, 7860.64, 7625.22, 7.9429, 8.9416, 960, 0, 'USABLE_RECEIVED'),
        line(208, 'Rozenbeer 40 cm rood', 840, 12512.78, 12138.04, 14.45, 15.4488, 840, 0, 'USABLE_RECEIVED'),
      ],
      notes: [],
    },
  } as unknown as PurchaseOrderView;
  const payments = [
    payment(106, { orderId: 11, amount: 10087.2, currency: 'USD', amountEur: 8674.99, instalmentDue: 'ORDERED' }),
    payment(107, { orderId: 11, amount: 22490.29, currency: 'USD', amountEur: 19341.65, instalmentDue: 'SHIPPED', settles: true }),
    payment(108, { orderId: 11, payee: 'SEPARATE', amount: 280, amountEur: 280, settles: true, label: 'Inspectie QIMA' }),
    payment(109, { orderId: 11, payee: 'OTHER', amount: 45, amountEur: 45, label: 'Bankkosten' }),
  ];
  return { view, payments };
}

/** Mock 9: legacy receipt, 12 short and 8 damaged, supplier never recorded in the logbook, transport € 3,81 short. */
function legacy(): { view: PurchaseOrderView; payments: PurchasePayment[] } {
  const view = {
    order: { id: 9, number: 'PO-2026-009', status: 'ONTVANGEN', paymentTerms: 'THIRD_TWO_THIRDS_SHIPPED', partnerCustomerId: null, cnyToUsd: 0.1392, usdToEurGoods: 0.855,
      paidTotalEur: 34428.8, lines: [
        { id: 903, productId: 210, quantity: 948, orderedQuantity: 960, receiptUnitValueEur: 6.7545 },
        { id: 904, productId: 208, quantity: 480, orderedQuantity: 480, damagedQuantity: 8, receiptUnitValueEur: 15.219 },
        { id: 905, productId: 202, quantity: 48, orderedQuantity: null, receiptUnitValueEur: 8.379 }] },
    costing: { totals: { goodsEur: 34428.8, totalEur: 40468.8, totalWithSeparateCostsEur: 40468.8, separateCostsEur: 0, separateCostsInPiecePrice: false, extraRevenueEur: 3900 } },
    payable: { supplierEur: 34428.8, logisticsEur: 2140, enrosedEur: 3900, freightInSupplierPrice: true, ddp: false },
    receiptVariance: { affectedOrders: 1, affectedLines: 2, orderedPieces: 4128, receivedPieces: 4116, missingPieces: 12, overReceivedPieces: 0, damagedPieces: 8,
      usablePieces: 4108, missingValueEur: 81.05, damagedValueEur: 121.75, totalLossValueEur: 202.8, unvaluedLossPieces: 0, valuationComplete: true },
    receiptReports: [
      { productId: 210, sku: 'ER-210', productName: 'Rozenbeer 25 cm gemengd', source: 'ARRIVAL', on: '2026-03-09', damaged: 0, missing: 12, note: null, actor: 'berat' },
      { productId: 208, sku: 'ER-208', productName: 'Rozenbeer 40 cm rood', source: 'ARRIVAL', on: '2026-03-09', damaged: 6, missing: 0, note: null, actor: 'berat' },
      { productId: 208, sku: 'ER-208', productName: 'Rozenbeer 40 cm rood', source: 'LATER', on: '2026-03-14', damaged: 2, missing: 0, note: null, actor: 'emre' },
    ],
    reconciliation: {
      totals: { plannedExternalEur: 36653.66, paidEur: 2140, remainingEur: 34513.66, forecastExternalEur: 36653.66, varianceEur: 0, internalMarkupEur: 3900,
        plannedPricingEur: 40553.66, forecastPricingEur: 40553.66, finalized: false, orderedQuantity: 4128, receivedQuantity: 4116, damagedQuantity: 8, usableQuantity: 4108,
        unitCostQuantity: 4108, unitCostBasis: 'USABLE_RECEIVED', forecastExternalUnitEur: 8.9225, forecastPricingUnitEur: 9.8719, receiptRecorded: true, legacyPaidTotalEur: 34428.8 },
      streams: [
        stream('SUPPLIER', { status: 'UNPAID', plannedEur: 34509.85, remainingEur: 34509.85, forecastEur: 34509.85 }),
        stream('LOGISTICS', { status: 'PARTIAL', plannedEur: 2143.81, paidEur: 2140, remainingEur: 3.81, forecastEur: 2143.81, paymentCount: 1 }),
        stream('SEPARATE', { status: 'NOT_APPLICABLE', finalized: true }),
        stream('OTHER', { status: 'NOT_APPLICABLE', finalized: true }),
      ],
      supplierInstalments: [
        term('ORDERED', '1/3 bij bestelling', { plannedEur: 11503.28, remainingEur: 11503.28 }),
        term('SHIPPED', '2/3 bij vertrek', { plannedEur: 23006.57, remainingEur: 23006.57 }),
      ],
      lines: [
        line(210, 'Rozenbeer 25 cm gemengd', 960, 7375, 7375, 7.7795, 8.7271, 948, 0, 'USABLE_RECEIVED'),
        line(208, 'Rozenbeer 40 cm rood', 3120, 28803.84, 28803.84, 9.2542, 10.2036, 3120, 8, 'USABLE_RECEIVED'),
        line(202, 'Preserved rozen windowbox (demo)', 48, 474.82, 474.82, 9.8921, 10.8396, 48, 0, 'USABLE_RECEIVED'),
      ],
      notes: ['Historisch betaald leveranciersbedrag € 34.428,80 uit de ontvangst; geen afzonderlijke leveranciersbetalingen geregistreerd.'],
    },
  } as unknown as PurchaseOrderView;
  return { view, payments: [payment(105, { orderId: 9, payee: 'LOGISTICS', amount: 2140, amountEur: 2140, label: 'Douane & inklaring' })] };
}

function ledgerOf(view: PurchaseOrderView, payments: PurchasePayment[] | null): PaymentLedger {
  return purchasePaymentLedger({
    view, payments, documents: [], terms: purchaseInstalmentState(view, instalmentsOf(view.order, PAYMENT_TERMS), payments),
    settled: payee => purchaseGroupSettled(view, payments, payee), toleranceEur: 10, totalLabel: 'Totaal geland', planLabel: '30% bij bestelling, 70% bij vertrek',
  });
}

function story(view: PurchaseOrderView, payments: PurchasePayment[] | null, partner: PartnerFinancing | null = null): PurchaseNacalc {
  const ledger = payments === null ? null : ledgerOf(view, payments);
  const result = purchaseNacalc({ view, ledger, summary: purchaseNacalcSummary(view, ledger), partner });
  assert.ok(result);
  return result;
}

const row = (result: PurchaseNacalc, payee: string) => result.payees!.find(item => item.payee === payee)!;
const round = (value: number) => Math.round(value * 100) / 100;
/** Intl writes a non-breaking space after the euro sign; the expectations here read with a plain one. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value).replace(/\u00a0/g, ' '));

test('a concept or an order without lines is the budget: no payees, no meter figures, the calculation as the headline', () => {
  for (const empty of [false, true]) {
    const { view, payments } = transit();
    if (empty) view.order.lines = []; else view.order.status = 'CONCEPT';
    const result = story(view, payments);
    assert.deepEqual([result.headline.kind, result.headline.label, result.headline.pill], ['concept', 'Begrote kost', { label: 'Nog niet besteld', tone: 'outline' }]);
    assert.equal(result.headline.sentence, 'Nog niet besteld — de calculatie is de begroting.');
    assert.deepEqual(result.payees, [], 'even with a ledger there is no per-payee story');
    assert.equal(result.headline.begrootEur, 70204.31);
    assert.equal(result.products.length, 3);
  }
});

test('mock 12: provisional, two payees still open, the headline from the server report and the meter from the ledger', () => {
  const { view, payments } = transit();
  const result = story(view, payments);
  const head = result.headline;
  assert.deepEqual(plain([head.kind, head.label, head.pill.label, head.sentence]), ['provisional', 'Verwachte eindkost', 'Voorlopig', 'Voorlopig · 2 ontvangers nog open']);
  assert.deepEqual([head.begrootEur, head.eindkostEur, head.paidEur, head.openEur, head.verschilEur, head.verschilPct], [70204.31, 70204.31, 64780.5, 5423.81, 0, 0]);
  assert.deepEqual([head.dueNowEur, head.laterEur, head.reviewEur, head.additionalEur, head.fxEur], [5423.81, 0, 0, 0, 0]);
  assert.deepEqual([head.unitEur, head.unitQuantity, head.unitBasis, head.unitOrderedEur, head.unitDeltaEur], [12.6267, 5560, 'ORDERED', null, null]);
  assert.deepEqual([head.markupEur, head.pricingEur, head.pricingUnitEur, head.landedEur, head.landedWithSeparateEur], [4850, 75054.31, 13.499, 74524.31, 75054.31]);
  assert.deepEqual([head.separateApart, head.includesInspection, head.ddp], [true, true, false]);
  assert.equal(result.receipt, null, 'nothing was received yet');
  assert.deepEqual(result.payees!.map(item => [item.payee, item.reason, item.actionLabel, item.status.label]), [
    ['SUPPLIER', 'none', null, 'Betaald · afgerekend'],
    ['LOGISTICS', 'open', 'Noteer ›', 'Deels betaald'],
    ['SEPARATE', 'open', 'Noteer ›', 'Nu te betalen'],
  ]);
  const supplier = row(result, 'SUPPLIER');
  assert.deepEqual([supplier.paidForeign, supplier.eindkostEur, supplier.verschilEur, supplier.canUndoSettle, supplier.termsMixed],
    [{ amount: 71511.63, currency: 'USD' }, 61500, 0, true, false]);
  assert.equal(plain(row(result, 'LOGISTICS').reasonLabel), 'nog € 4.893,81 open · nu te betalen');
  assert.deepEqual(row(result, 'LOGISTICS').payAction, { payee: 'LOGISTICS', amount: 4893.81, label: 'Douane & transport', due: null });
  assert.equal(row(result, 'SEPARATE').basis, 'Raming uit Kosten: inspectie en andere kosten · apart');
});

test('the headline explains the difference with server facts: signed, as a share of the budget, null without a budget', () => {
  const { view, payments } = settled();
  const head = story(view, payments).headline;
  assert.deepEqual([head.kind, head.label, head.sentence], ['final', 'Eindkost', 'Definitief · alle ontvangers afgerekend']);
  assert.deepEqual([head.verschilEur, head.verschilPct], [-875, -3]);
  const dearer = overpaid();
  assert.deepEqual([story(dearer.view, dearer.payments).headline.verschilEur, story(dearer.view, dearer.payments).headline.verschilPct], [470, 1.5]);
  const zero = transit();
  Object.assign(zero.view.reconciliation!.totals, { plannedExternalEur: 0, varianceEur: 70204.31 });
  assert.equal(story(zero.view, zero.payments).headline.verschilPct, null);
});

test('mock 13: an unsettled overpayment and an unbudgeted payment mean review, named after the first payee in order', () => {
  const { view, payments } = overpaid();
  const result = story(view, payments);
  const head = result.headline;
  assert.deepEqual(plain([head.kind, head.pill, head.sentence]), ['review', { label: 'Na te kijken', tone: 'warn' }, 'Na te kijken · € 350,00 te veel betaald aan Leverancier']);
  assert.deepEqual([head.reviewEur, head.ddp, head.verschilEur], [470, true, 470]);
  const supplier = row(result, 'SUPPLIER');
  assert.deepEqual(plain([supplier.reason, supplier.reasonLabel, supplier.actionLabel, supplier.action, supplier.status.kind, supplier.openEur, supplier.eindkostEur]),
    ['review', 'te veel betaald · nakijken', 'Nakijken…', 'settle', 'OVERPAID', 0, 31887.92]);
  assert.equal(supplier.basis, 'Goederen DDP · 30% bij bestelling, 70% bij vertrek · transport en invoerrechten in de DDP-prijs');
  assert.equal(supplier.ddpNote, true);
  assert.equal(supplier.paidForeign, null, 'a euro payment sits among the dollar ones');
  const logistics = row(result, 'LOGISTICS');
  assert.deepEqual([logistics.reason, logistics.actionLabel, logistics.agreedEur, logistics.paidEur, logistics.verschilEur, logistics.status.label],
    ['unbudgeted', 'Afrekenen…', 0, 120, 120, 'Niet begroot']);
  assert.equal(supplier.termsMixed, true, 'the 70 % term carries the overpayment, the 30 % does not');
  assert.deepEqual(supplier.terms.map(item => [item.due, item.reason, item.verschilEur]), [['ORDERED', 'none', 0], ['SHIPPED', 'review', 350]]);
  // Without the supplier's problem the transport alone is reviewed.
  view.reconciliation!.streams[0] = stream('SUPPLIER', { status: 'PAID', plannedEur: 31537.92, paidEur: 31537.92, forecastEur: 31537.92, finalized: true, paymentCount: 2 });
  view.reconciliation!.supplierInstalments![1] = term('SHIPPED', '70% bij vertrek', { plannedEur: 22076.54, paidEur: 22076.54, finalized: true });
  const budget = story(view, [payments[0], payment(111, { orderId: 13, amount: 25670.4, currency: 'USD', amountEur: 22076.54, instalmentDue: 'SHIPPED' }), payments[3]]);
  assert.equal(plain(budget.headline.sentence), 'Na te kijken · Douane & transport niet begroot');
});

test('reason precedence: bijkomend, onvolledig, niet begroot, te veel betaald, historisch, deels afgerekend, open, minder, meer, geen verschil', () => {
  const { view, payments } = transit();
  const ledger = ledgerOf(view, payments);
  const item = (payee: string) => ledger.payees.find(candidate => candidate.payee === payee)!;
  const totals = view.reconciliation!.totals;
  const reason = (values: Partial<typeof ledger.payees[number]>, legacyEur: number | null = null) =>
    nacalcReason({ ...item('LOGISTICS'), ...values }, undefined, { legacyPaidTotalEur: legacyEur });
  assert.equal(nacalcReason(item('OTHER'), undefined, totals).reason, 'additional');
  assert.equal(reason({ status: { kind: 'INCOMPLETE', label: 'Onvolledig', tone: 'warn' } }).reason, 'incomplete');
  assert.equal(reason({ status: { kind: 'UNBUDGETED', label: 'Niet begroot', tone: 'warn' } }).reason, 'unbudgeted');
  assert.equal(reason({ status: { kind: 'OVERPAID', label: 'Te veel betaald · nakijken', tone: 'warn' } }).reason, 'review');
  const historic = reason({ payee: 'SUPPLIER', paymentCount: 0 }, 34428.8);
  assert.deepEqual(plain([historic.reason, historic.label]), ['legacy', 'historisch € 34.428,80 betaald bij ontvangst · niet in het logboek']);
  assert.equal(reason({ payee: 'SUPPLIER', paymentCount: 1 }, 34428.8).reason, 'open', 'once a supplier payment exists the header is no longer the story');
  const partly = reason({ openEur: 29400, lowerEur: 886, dueNowEur: 0, laterEur: 29400 });
  assert.deepEqual(plain([partly.reason, partly.label]), ['partly-settled', 'deels afgerekend · nog € 29.400,00 open']);
  assert.equal(plain(reason({ openEur: 4893.81, dueNowEur: 4893.81 }).label), 'nog € 4.893,81 open · nu te betalen');
  const later = reason({ openEur: 400, dueNowEur: 0, laterEur: 400, laterDue: 'SHIPPED',
    next: { payee: 'LOGISTICS', due: null, label: 'Douane & transport', amountEur: 400, now: false, when: DUE_MOMENT.SHIPPED } });
  assert.deepEqual(plain([later.reason, later.label]), ['open', 'nog € 400,00 open · later bij vertrek']);
  assert.equal(plain(reason({ openEur: 400, dueNowEur: 0, laterEur: 400, next: null }).label), 'nog € 400,00 open');
  assert.equal(reason({ openEur: 0, lowerEur: 20, status: { kind: 'SETTLED_LOWER', label: 'x', tone: 'ok' } }).label, 'minder betaald · afgerekend');
  assert.equal(reason({ openEur: 0, higherEur: 20, status: { kind: 'SETTLED_HIGHER', label: 'x', tone: 'neutral' } }).label, 'meer betaald · afgerekend');
  assert.equal(reason({ openEur: 0, status: { kind: 'PAID', label: 'Betaald', tone: 'ok' } }).label, 'geen verschil');
  assert.equal(Object.keys(NACALC_REASON_LABEL).length, 10);
});

test('the row action mirrors the workbench: Noteer for anything due or open later, Afrekenen for a remainder, Nakijken only for an overpayment', () => {
  const label = (action: 'add' | 'settle' | null, kind = 'PARTIAL') => nacalcActionLabel({ action, status: { kind, label: '', tone: 'neutral' } } as never);
  assert.equal(label('add'), 'Noteer ›');
  assert.equal(label('settle', 'SMALL_DIFFERENCE'), 'Afrekenen…');
  assert.equal(label('settle', 'UNBUDGETED'), 'Afrekenen…');
  assert.equal(label('settle', 'OVERPAID'), 'Nakijken…');
  assert.equal(label(null, 'PAID'), null);
  assert.equal(label('add', 'INCOMPLETE'), null, 'figures that do not close are looked at before more money is recorded');
  // Mock 14: deposit paid, the 70 % waits for departure: never 'Afrekenen…'.
  const { view, payments } = transit();
  view.order.status = 'BESTELD';
  view.reconciliation!.streams[0] = stream('SUPPLIER', { status: 'PARTIAL', plannedEur: 61500, paidEur: 18450, remainingEur: 43050, forecastEur: 61500, paymentCount: 1 });
  view.reconciliation!.supplierInstalments = [
    term('ORDERED', '30% bij bestelling', { plannedEur: 18450, paidEur: 18450, finalized: true }), term('SHIPPED', '70% bij vertrek', { plannedEur: 43050, remainingEur: 43050 })];
  const supplier = row(story(view, [payments[0]]), 'SUPPLIER');
  assert.deepEqual(plain([supplier.actionLabel, supplier.reasonLabel, supplier.termsMixed, supplier.laterEur]), ['Noteer ›', 'nog € 43.050,00 open · later bij vertrek', false, 43050]);
});

test('mock 11: settled lower on one term, bijkomende kosten, over-received pieces and a later report on a DDP container', () => {
  const { view, payments } = settled();
  const result = story(view, payments);
  const supplier = row(result, 'SUPPLIER');
  assert.deepEqual([supplier.reason, supplier.verschilEur, supplier.status.label, supplier.actionLabel, supplier.canUndoSettle, supplier.termsMixed],
    ['settled-lower', -900, 'Afgerekend · minder betaald', null, true, true]);
  assert.deepEqual(supplier.terms.map(item => [item.label, item.paidEur, item.verschilEur, item.reason]),
    [['30% bij bestelling', 8674.99, 0, 'none'], ['70% bij vertrek', 19341.65, -900, 'settled-lower']]);
  const other = row(result, 'OTHER');
  assert.deepEqual([other.agreedEur, other.paidEur, other.eindkostEur, other.verschilEur, other.reason, other.actionLabel, other.status.label],
    [null, 45, 45, 45, 'additional', null, 'Bijkomend']);
  assert.equal(result.payees!.some(item => item.payee === 'LOGISTICS'), false, 'no transport row on a DDP container without transport payments');
  assert.equal(row(result, 'SEPARATE').reason, 'settled-lower');
  const receipt = result.receipt!;
  assert.deepEqual([receipt.ordered, receipt.received, receipt.missing, receipt.over, receipt.damaged, receipt.usable], [2880, 2904, 0, 24, 0, 2904]);
  assert.deepEqual([receipt.lossEur, receipt.supplierFact, receipt.overValueEur, receipt.clean], [0, null, round(24 * 8.084), false]);
  assert.deepEqual(receipt.later, { count: 1, damaged: 2, missing: 0, products: ['Rozenbeer 40 cm rood'] });
  assert.deepEqual([receipt.unitUsableEur, receipt.unitOrderedEur, receipt.unitDeltaEur], [9.7595, 9.8408, -0.0813], 'more usable pieces than ordered lower the piece cost');
  assert.deepEqual(result.products.map(item => [item.name, item.over, item.usable]), [['Rozenbeer 25 cm rood', 24, 1104], ['Rozenbeer 25 cm roze', 0, 960], ['Rozenbeer 40 cm rood', 0, 840]]);
  assert.deepEqual(result.explained, { savingsEur: 920, overrunsEur: 0, additionalEur: 45, reviewEur: 0, openEur: 0, fxEur: 0 });
});

test('mock 9: a legacy receipt shows the server truth with the historical payment named, the loss valued and the transport short by a small difference', () => {
  const { view, payments } = legacy();
  const result = story(view, payments);
  assert.deepEqual([result.headline.kind, result.headline.sentence], ['provisional', 'Voorlopig · 2 ontvangers nog open']);
  const supplier = row(result, 'SUPPLIER');
  assert.deepEqual([supplier.legacy, supplier.legacyEur, supplier.paidEur, supplier.openEur, supplier.reason, supplier.actionLabel, supplier.status.label],
    [true, 34428.8, 0, 34509.85, 'legacy', 'Noteer ›', 'Nu te betalen']);
  assert.equal(plain(supplier.reasonLabel), 'historisch € 34.428,80 betaald bij ontvangst · niet in het logboek');
  const logistics = row(result, 'LOGISTICS');
  assert.deepEqual(plain([logistics.status.label, logistics.reasonLabel, logistics.actionLabel]), ['Klein verschil', 'nog € 3,81 open · nu te betalen', 'Afrekenen…']);
  const receipt = result.receipt!;
  assert.deepEqual([receipt.missing, receipt.damaged, receipt.over, receipt.usable, receipt.missingValueEur, receipt.damagedValueEur, receipt.lossEur, receipt.unvaluedPieces, receipt.valuationComplete],
    [12, 8, 0, 4108, 81.05, 121.75, 202.8, 0, true]);
  assert.deepEqual(receipt.supplierFact, { kind: 'open', amountEur: 34509.85 });
  assert.deepEqual([receipt.unitUsableEur, receipt.unitOrderedEur, receipt.unitDeltaEur], [8.9225, 8.8793, 0.0432]);
  assert.deepEqual(receipt.later, { count: 1, damaged: 2, missing: 0, products: ['Rozenbeer 40 cm rood'] });
  assert.equal(receipt.overValueEur, 0);
  assert.deepEqual(result.products.map(item => [item.missing, item.damaged, item.usable]), [[12, 0, 948], [0, 8, 3112], [0, 0, 48]]);
  assert.equal(result.headline.unitOrderedEur, 8.8793);
});

test('the receipt block counts from the server where it can and never nets a short line against an over line', () => {
  const { view, payments } = legacy();
  delete (view as { receiptVariance?: unknown }).receiptVariance;
  view.reconciliation!.lines[0].receivedQuantity = 990;
  const receipt = story(view, payments).receipt!;
  assert.deepEqual([receipt.missing, receipt.over], [0, 30], 'without the server aggregate the lines are read one by one');
  assert.deepEqual([receipt.missingValueEur, receipt.damagedValueEur, receipt.lossEur, receipt.unvaluedPieces, receipt.valuationComplete], [null, null, null, 0, false]);
  assert.equal(receipt.supplierFact, null, 'no loss known, nothing to say about the supplier');
  const unvalued = legacy();
  Object.assign(unvalued.view.receiptVariance!, { unvaluedLossPieces: 8, valuationComplete: false, totalLossValueEur: 81.05, damagedValueEur: 0 });
  assert.deepEqual(story(unvalued.view, unvalued.payments).receipt!.supplierFact, { kind: 'open', amountEur: 34509.85 });
  const paidFull = legacy();
  paidFull.view.reconciliation!.streams[0] = stream('SUPPLIER', { status: 'PAID', plannedEur: 34509.85, paidEur: 34509.85, forecastEur: 34509.85, finalized: true, paymentCount: 1 });
  assert.deepEqual(story(paidFull.view, [...paidFull.payments, payment(200, { orderId: 9, amount: 34509.85, amountEur: 34509.85 })]).receipt!.supplierFact,
    { kind: 'paid-full', amountEur: 202.8 });
  const lower = legacy();
  lower.view.reconciliation!.streams[0] = stream('SUPPLIER', { status: 'SETTLED_LOWER', plannedEur: 34509.85, paidEur: 34307.05, forecastEur: 34307.05, settledSavingEur: 202.8, finalized: true, explicitlySettled: true, paymentCount: 1 });
  assert.deepEqual(story(lower.view, [...lower.payments, payment(200, { orderId: 9, amount: 34307.05, amountEur: 34307.05, settles: true })]).receipt!.supplierFact,
    { kind: 'settled-lower', amountEur: 202.8 });
});

test('over-received pieces are valued from the order lines, null when a value is missing, never from lines without an ordered quantity', () => {
  const { view, payments } = settled();
  assert.equal(story(view, payments).receipt!.overValueEur, 194.02);
  view.order.lines[0].receiptUnitValueEur = null;
  assert.equal(story(view, payments).receipt!.overValueEur, null);
  view.order.lines[0].orderedQuantity = null;
  view.receiptVariance!.overReceivedPieces = 0;
  view.reconciliation!.lines[0].orderedQuantity = 1104;
  const receipt = story(view, payments).receipt!;
  assert.deepEqual([receipt.over, receipt.overValueEur], [0, 0]);
});

test('later warehouse reports are shown apart from the counts: aggregated, with at most three product names', () => {
  const { view, payments } = legacy();
  view.receiptReports = [
    ...view.receiptReports!,
    { productId: 1, sku: null, productName: 'A', source: 'LATER', on: null, damaged: 1, missing: 2, note: null, actor: null },
    { productId: 2, sku: null, productName: 'B', source: 'LATER', on: null, damaged: 0, missing: 1, note: null, actor: null },
    { productId: 3, sku: null, productName: 'C', source: 'LATER', on: null, damaged: 3, missing: 0, note: null, actor: null },
    { productId: 3, sku: null, productName: 'C', source: 'LATER', on: null, damaged: 1, missing: 0, note: null, actor: null },
  ];
  const receipt = story(view, payments).receipt!;
  assert.deepEqual(receipt.later, { count: 5, damaged: 7, missing: 3, products: ['Rozenbeer 40 cm rood', 'A', 'B', '+1'] });
  assert.deepEqual([receipt.usable, receipt.damaged], [4108, 8], 'the counts stay the receipt counts');
  const clean = settled();
  clean.view.receiptReports = [];
  Object.assign(clean.view.receiptVariance!, { overReceivedPieces: 0 });
  clean.view.order.lines[0] = { ...clean.view.order.lines[0], quantity: 1080 };
  assert.equal(story(clean.view, clean.payments).receipt!.clean, true);
});

test('the bridge walks from the landed calculation to the budget and on to the eindkost, and closes on mock 12', () => {
  const { view, payments } = transit();
  const bridge = nacalcBridge(view, purchaseNacalcSummary(view, ledgerOf(view, payments)));
  assert.equal(bridge.consistent, true);
  assert.deepEqual(bridge.rows.map(item => [item.key, item.op, item.amountEur]), [
    ['LANDED', '', 74524.31], ['ENROSED', '−', 4850], ['SEPARATE', '+', 530], ['BUDGET', '=', 70204.31],
    ['PAID', '', 64780.5], ['OPEN', '+', 5423.81], ['FORECAST', '=', 70204.31], ['VARIANCE', '→', 0],
  ]);
  assert.equal(bridge.rows[1].note, 'intern, geen betaling');
  assert.equal(bridge.rows[2].note, 'apart');
  const inPrice = transit();
  Object.assign(inPrice.view.costing.totals, { separateCostsInPiecePrice: true, totalEur: 75054.31 });
  assert.equal(nacalcBridge(inPrice.view, purchaseNacalcSummary(inPrice.view)).rows.some(item => item.key === 'SEPARATE'), false, 'in the piece price the row is absent');
  const ddp = overpaid();
  const ddpRows = nacalcBridge(ddp.view, purchaseNacalcSummary(ddp.view)).rows;
  assert.deepEqual(ddpRows.find(item => item.key === 'DDP'), { key: 'DDP', label: 'Douane & transport', amountEur: 0, note: 'inbegrepen in de prijs (DDP)', op: '' });
  assert.deepEqual(ddpRows.find(item => item.key === 'REVIEW'), { key: 'REVIEW', label: 'waarvan te veel betaald · nakijken', amountEur: 470, note: null, op: '' });
  assert.equal(nacalcBridge(view, null).rows.length, 0);
});

test('before receipt a residue up to a euro is rounding and more is inconsistent; after a receipt it is the correction to ordered pieces', () => {
  const rounding = transit();
  rounding.view.costing.totals.totalEur = 74524.91;
  const rounded = nacalcBridge(rounding.view, purchaseNacalcSummary(rounding.view));
  assert.equal(rounded.consistent, true);
  assert.deepEqual(rounded.rows.find(item => item.key === 'ROUNDING'), { key: 'ROUNDING', label: 'Afronding', amountEur: 0.6, note: null, op: '−' });
  const off = transit();
  off.view.costing.totals.totalEur = 74600;
  const broken = nacalcBridge(off.view, purchaseNacalcSummary(off.view));
  assert.equal(broken.consistent, false);
  assert.equal(broken.rows.some(item => item.key === 'ROUNDING' || item.key === 'ORDERED'), false);
  const { view, payments } = legacy();
  const received = nacalcBridge(view, purchaseNacalcSummary(view, ledgerOf(view, payments)));
  assert.equal(received.consistent, true);
  assert.deepEqual(received.rows.find(item => item.key === 'ORDERED'),
    { key: 'ORDERED', label: 'Correctie naar bestelde stuks', amountEur: 84.86, note: 'het budget blijft op 4128 bestelde stuks', op: '+' });
  const over = settled();
  const overRows = nacalcBridge(over.view, purchaseNacalcSummary(over.view)).rows;
  assert.deepEqual(overRows.find(item => item.key === 'ORDERED')!.op, '−', 'over-received pieces make the live calculation exceed the budget');
  assert.deepEqual(overRows.find(item => item.key === 'ADDITIONAL'), { key: 'ADDITIONAL', label: 'waarvan bijkomende kosten', amountEur: 45, note: null, op: '' });
  assert.equal(overRows.find(item => item.key === 'FORECAST')!.label, 'Eindkost');
});

test('the explained figures equal purchasePaymentResult: a deposit is open, never a saving', () => {
  const { view, payments } = transit();
  view.order.status = 'BESTELD';
  const result = story(view, payments);
  assert.deepEqual(result.explained, { savingsEur: 0, overrunsEur: 0, additionalEur: 0, reviewEur: 0, openEur: 5423.81, fxEur: 0 });
  const higher = overpaid();
  Object.assign(higher.view.reconciliation!.streams[0], { status: 'OVERPAID', explicitlySettled: true, finalized: true });
  Object.assign(higher.view.reconciliation!.supplierInstalments![1], { explicitlySettled: true, finalized: true });
  const explained = story(higher.view, higher.payments).explained;
  assert.deepEqual([explained.overrunsEur, explained.reviewEur], [350, 120]);
});

test('the koersverschil is the bank euro amount against the order rate: zero for euro, for the order rate itself, for a missing rate or value', () => {
  const rates = { cnyToUsd: 0.1405, usdToEurGoods: 0.86 };
  assert.equal(paymentFxEur({ amount: 500, currency: 'EUR', amountEur: 500 }, rates), 0);
  assert.equal(paymentFxEur({ amount: 21453.49, currency: 'USD', amountEur: 18450 }, rates), 0);
  assert.equal(paymentFxEur({ amount: 25670.4, currency: 'USD', amountEur: 21926.54 }, rates), -150);
  assert.equal(paymentFxEur({ amount: 104278.72, currency: 'CNY', amountEur: 12600 }, rates), 0);
  assert.equal(paymentFxEur({ amount: 104278.72, currency: 'CNY', amountEur: 12500 }, rates), -100);
  assert.equal(paymentFxEur({ amount: 25670.4, currency: 'USD', amountEur: 21926.54 }, { cnyToUsd: 0.1405, usdToEurGoods: null }), 0);
  assert.equal(paymentFxEur({ amount: 104278.72, currency: 'CNY', amountEur: 12500 }, { cnyToUsd: null, usdToEurGoods: 0.86 }), 0);
  assert.equal(paymentFxEur({ amount: 25670.4, currency: 'USD', amountEur: Number.NaN }, rates), 0);
  const { view, payments } = overpaid();
  const result = story(view, payments);
  assert.equal(row(result, 'SUPPLIER').fxEur, -150, 'summed per payee over that payee only');
  assert.equal(row(result, 'LOGISTICS').fxEur, 0);
  assert.equal(result.headline.fxEur, -150);
  assert.equal(result.explained.fxEur, -150);
  const plain = transit();
  assert.equal(story(plain.view, plain.payments).headline.fxEur, 0, 'existing data at the order rate shows nothing');
});

test('the partner block: defaults, the advance on the pricing basis, financing when loaded, the short-delivery handoff after an invoiced advance', () => {
  const { view, payments } = transit();
  const partner = story(view, payments).partner!;
  assert.deepEqual([partner.costPct, partner.sharePct, partner.basisEur, partner.advanceEur, partner.unitEur, partner.shortPieces, partner.ordered, partner.financing, partner.shortageAfterAdvance],
    [20, 50, 75054.31, 15010.86, 12.6267, 0, 5560, null, false]);
  const financing = { committedAdvanceEur: 15000, invoicedAdvanceEur: 12396.69, receivedAdvanceEur: 15000, openAdvanceEur: 0, ownExposureEur: 49780.5,
    settlementInvoiceNumber: 'INV-2026-053', settlementComplete: false, creditEur: 0, unbilledAdvanceCount: 0 } as PartnerFinancing;
  const loaded = story(view, payments, financing);
  assert.deepEqual(loaded.partner!.financing, { committedAdvanceEur: 15000, invoicedAdvanceEur: 12396.69, receivedAdvanceEur: 15000, openAdvanceEur: 0,
    ownExposureEur: 49780.5, settlementNumber: 'INV-2026-053', settlementComplete: false, creditEur: 0, unbilledCount: 0 });
  assert.ok(loaded.notes.includes('Uitgereikte afrekeningen zijn bevroren; latere kostwijzigingen wijzigen ze niet.'));
  const defaults = transit();
  Object.assign(defaults.view.order, { partnerCostPct: null, partnerSharePct: null });
  assert.deepEqual([story(defaults.view, defaults.payments).partner!.costPct, story(defaults.view, defaults.payments).partner!.sharePct], [100, 50]);
  const none = overpaid();
  assert.equal(story(none.view, none.payments).partner, null);
  const short = legacy();
  Object.assign(short.view.order, { partnerCustomerId: 5, partnerCostPct: 20, partnerSharePct: 50 });
  const shortPartner = story(short.view, short.payments, { ...financing, invoicedAdvanceEur: 9000, settlementInvoiceNumber: null }).partner!;
  assert.deepEqual([shortPartner.shortPieces, shortPartner.shortageAfterAdvance], [20, true]);
  assert.equal(story(short.view, short.payments, { ...financing, invoicedAdvanceEur: 0 }).partner!.shortageAfterAdvance, false);
});

test('product rows and their totals add up to the headline in cents', () => {
  for (const build of [transit, settled, legacy, overpaid]) {
    const { view, payments } = build();
    const result = story(view, payments);
    assert.equal(result.productTotals.eindkostEur, result.headline.eindkostEur, view.order.number);
    assert.equal(result.productTotals.begrootEur, result.headline.begrootEur, view.order.number);
    assert.equal(result.productTotals.verschilEur, result.headline.verschilEur, view.order.number);
  }
});

test('without a reconciliation there is no story; without a ledger the payees are unknown while the rest renders', () => {
  const { view, payments } = transit();
  const missing = { ...view, reconciliation: null } as PurchaseOrderView;
  assert.equal(purchaseNacalc({ view: missing, ledger: null, summary: purchaseNacalcSummary(missing) }), null);
  assert.equal(purchaseNacalc({ view, ledger: ledgerOf(view, payments), summary: null }), null);
  const unknown = story(view, null);
  assert.equal(unknown.payees, null);
  assert.deepEqual([unknown.headline.eindkostEur, unknown.headline.dueNowEur, unknown.headline.laterEur, unknown.headline.fxEur], [70204.31, 0, 0, 0]);
  assert.equal(plain(unknown.headline.sentence), 'Voorlopig · 2 ontvangers nog open', 'the server report still counts the open streams');
  assert.equal(unknown.bridge.rows.length, 8);
  assert.ok(unknown.partner);
});

test('the state pill and headline label agree with the summary card for every kind', () => {
  const cases = [transit(), overpaid(), settled()];
  const concept = transit();
  concept.view.order.status = 'CONCEPT';
  cases.push(concept);
  for (const { view, payments } of cases) {
    const ledger = ledgerOf(view, payments);
    const summary = purchaseNacalcSummary(view, ledger)!;
    const result = purchaseNacalc({ view, ledger, summary })!;
    assert.deepEqual([result.headline.kind, result.headline.label, result.headline.pill], [summary.kind, NACALC_LABEL[summary.kind], NACALC_PILL[summary.kind]], view.order.number);
    assert.deepEqual([result.headline.eindkostEur, result.headline.verschilEur, result.headline.reviewEur], [summary.forecastEur, summary.varianceEur, summary.reviewEur]);
  }
});

test('the client notes join the server notes without repeating them', () => {
  const { view, payments } = transit();
  const notes = story(view, payments).notes;
  assert.equal(notes.filter(note => /USD of CNY/.test(note)).length, 1, 'the server already says how foreign payments count');
  assert.equal(notes.at(-1), 'De nacalculatie wijzigt geen productkostprijzen; Kostprijzen toepassen (Afronden) gebruikt de calculatie per stuk.');
  const received = legacy();
  const receivedNotes = story(received.view, received.payments).notes;
  assert.ok(receivedNotes.some(note => note.startsWith('Betalingen in USD of CNY tellen tegen hun geboekte eurobedrag')));
  assert.ok(receivedNotes.some(note => note.startsWith('De inkoopwaarde van verloren stuks')));
  assert.equal(receivedNotes[0], received.view.reconciliation!.notes[0], 'server notes come first, verbatim');
});

test('the payee vocabulary of the rows is the ledger\'s, in its order', () => {
  const { view, payments } = settled();
  const result = story(view, payments);
  assert.deepEqual(result.payees!.map(item => item.label), result.payees!.map(item => PAYEE_LABEL[item.payee]));
  const order = result.payees!.map(item => PAYEE_ORDER.indexOf(item.payee));
  assert.deepEqual(order, [...order].sort((left, right) => left - right));
});

// todoCopy lives in purchase-payment-menus.ts, which imports the payee words at runtime: compile it with the imports
// stripped and hand the words in, as the component harnesses do.
const menusSource = await readFile(new URL('../src/app/features/purchasing/purchase-payment-menus.ts', import.meta.url), 'utf8');
const menusParsed = ts.createSourceFile('purchase-payment-menus.ts', menusSource, ts.ScriptTarget.Latest, true);
const menusJs = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(menusParsed, menusParsed.statements.filter(node => !ts.isImportDeclaration(node)))), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

test('todoCopy keeps the Te doen words of the Betalingen overview for every todo kind', () => {
  const exports: Record<string, (todo: LedgerTodo, mode?: 'read' | 'edit') => { title: string; detail: string; action: string }> = {};
  vm.runInNewContext(menusJs, { exports, PAYEE_LABEL, PAYEE_ORDER, PAYEE_ICON: {}, Intl });
  const todoCopy = exports['todoCopy'];
  const request = { payee: 'LOGISTICS', scope: 'GROUP', due: null } as const;
  assert.deepEqual(plain(todoCopy({ kind: 'pay', key: 'pay:SUPPLIER:SHIPPED', payee: 'SUPPLIER', due: 'SHIPPED', label: '70% bij vertrek', amountEur: 43050 })),
    { title: '70% bij vertrek', detail: '€ 43.050,00 · nu te betalen · Leverancier', action: 'Noteer' });
  assert.deepEqual(plain(todoCopy({ kind: 'pay', key: 'pay:LOGISTICS', payee: 'LOGISTICS', due: null, label: 'Douane & transport', amountEur: 4893.81 })),
    { title: 'Douane & transport', detail: '€ 4.893,81 · nu te betalen', action: 'Noteer' });
  assert.deepEqual(plain(todoCopy({ kind: 'settle', key: 's', payee: 'LOGISTICS', amountEur: 3.81, request })),
    { title: 'Klein verschil bij Douane & transport', detail: '€ 3,81 open · bijv. bankkosten of afronding', action: 'Afrekenen' });
  assert.deepEqual(plain(todoCopy({ kind: 'review', key: 'r', payee: 'SUPPLIER', amountEur: 350, request: { ...request, payee: 'SUPPLIER' } })),
    { title: 'Te veel betaald aan Leverancier', detail: '€ 350,00 meer dan afgesproken', action: 'Nakijken' });
  assert.deepEqual(plain(todoCopy({ kind: 'budget', key: 'b', payee: 'LOGISTICS', amountEur: 120, request })),
    { title: 'Niet begroot: Douane & transport', detail: '€ 120,00 betaald zonder bedrag in Kosten', action: 'Afrekenen' });
  assert.deepEqual(plain(todoCopy({ kind: 'incomplete', key: 'i', payee: 'SUPPLIER' })),
    { title: 'Betaling zonder eurowaarde bij Leverancier', detail: 'Controleer het bedrag van deze betaling', action: 'Bekijken' });
  assert.deepEqual(plain(todoCopy({ kind: 'proof', key: 'p', count: 2 })), { title: '2 betalingen zonder bewijs', detail: 'Voeg het bankafschrift toe', action: 'Toon' });
  assert.deepEqual(plain(todoCopy({ kind: 'proof', key: 'p', count: 1 }, 'read')), { title: '1 betaling zonder bewijs', detail: 'Bankafschrift ontbreekt', action: 'Toon' });
});
