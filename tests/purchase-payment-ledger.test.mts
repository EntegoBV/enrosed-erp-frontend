import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  PurchaseDocument, PurchaseInstalmentReconciliation, PurchaseOrderView, PurchasePayment, PurchaseReconciliationStream,
} from '../src/app/core/api/models.ts';
import { PAYMENT_TERMS } from '../src/app/core/api/models.ts';
import { instalmentsOf } from '../src/app/features/purchasing/payment-plan.ts';
import { purchaseGroupSettled, purchaseInstalmentState } from '../src/app/features/purchasing/purchase-instalment-state.ts';
import {
  PAYEE_LABEL, PAYEE_ORDER, PAYEE_SHORT, paymentOptionParts, payeeComposition, payeeRowAction, purchaseLandedBridge, purchasePaymentLedger,
  settleCarriers, sortLedgerRows, type PaymentLedger,
} from '../src/app/features/purchasing/purchase-payment-ledger.ts';
import { reconciliationStatusLabel } from '../src/app/features/purchasing/purchase-reconciliation-metrics.ts';

type Status = PurchaseOrderView['order']['status'];

function stream(payee: PurchaseReconciliationStream['payee'], values: Partial<PurchaseReconciliationStream> = {}): PurchaseReconciliationStream {
  return { payee, label: 'server label', status: 'UNPAID', plannedEur: 0, paidEur: 0, remainingEur: 0, forecastEur: 0,
    varianceEur: 0, overpaidEur: 0, settledSavingEur: 0, explicitlySettled: false, finalized: false, paymentCount: 0, ...values };
}

function instalment(due: PurchaseInstalmentReconciliation['due'], values: Partial<PurchaseInstalmentReconciliation> = {}): PurchaseInstalmentReconciliation {
  return { due, label: { ORDERED: '30% bij bestelling', SHIPPED: '70% bij vertrek', ARRIVED: '100% bij aankomst' }[due],
    plannedEur: 0, paidEur: 0, remainingEur: 0, settledSavingEur: 0, overpaidEur: 0, explicitlySettled: false, finalized: false, ...values };
}

interface Fixture {
  status?: Status;
  streams?: PurchaseReconciliationStream[] | null;
  instalments?: PurchaseInstalmentReconciliation[];
  ddp?: boolean;
  totals?: Partial<PurchaseOrderView['costing']['totals']>;
  payable?: PurchaseOrderView['payable'] | null;
  paidEur?: number;
}

function purchase(fixture: Fixture = {}): PurchaseOrderView {
  const streams = fixture.streams === undefined ? [
    stream('SUPPLIER', { plannedEur: 1000, remainingEur: 1000 }), stream('LOGISTICS', { plannedEur: 400, remainingEur: 400 }),
    stream('SEPARATE'), stream('OTHER'),
  ] : fixture.streams;
  const view = {
    order: { id: 50, number: 'INK-2026-014', status: fixture.status ?? 'BESTELD', paymentTerms: 'DEPOSIT_30_70', lines: [{ productId: 1 }] },
    costing: { totals: { goodsEur: 1000, goodsUsd: 1100, originEur: 100, freightEur: 200, dutyEur: 50, destinationEur: 50,
      extraRevenueEur: 150, totalEur: 1550, separateCostsEur: 0, totalWithSeparateCostsEur: 1550, inspectionEur: 0, otherCosts: [],
      separateCostsInPiecePrice: false, ...fixture.totals } },
    costLabels: { originCostsLabel: 'Lokale kosten China', seaFreightLabel: 'Zeevracht', seaFreightRoute: 'Ningbo → Rotterdam',
      destinationCostsLabel: 'Rotterdam → magazijn' },
    payable: fixture.payable === null ? undefined : fixture.payable
      ?? { supplierEur: 1000, logisticsEur: fixture.ddp ? 0 : 400, enrosedEur: 150, freightInSupplierPrice: false, ddp: !!fixture.ddp },
    reconciliation: streams === null ? null : {
      streams, lines: [], notes: [], supplierInstalments: fixture.instalments,
      totals: { paidEur: fixture.paidEur ?? streams.reduce((sum, item) => sum + item.paidEur, 0) },
    },
  };
  return view as unknown as PurchaseOrderView;
}

function payment(id: number, values: Partial<PurchasePayment> = {}): PurchasePayment {
  return { id, orderId: 50, paidOn: '2026-09-0' + (id % 9 + 1), amount: 100, currency: 'EUR', amountEur: 100, label: null,
    actor: 'emre', recordedAt: '2026-09-10T10:00:00Z', payee: 'SUPPLIER', settles: false, instalmentDue: null, ...values };
}

function proof(id: number, paymentId: number | null): PurchaseDocument {
  return { id, kind: 'PAYMENT_PROOF', kindLabel: 'Betalingsbewijs', label: null, originalFilename: `bank-${id}.pdf`,
    contentType: 'application/pdf', sizeBytes: 10, paymentId, actor: null, addedAt: '2026-09-10', orderId: 50 };
}

function ledger(view: PurchaseOrderView, payments: PurchasePayment[] = [], documents: PurchaseDocument[] | null = []): PaymentLedger {
  return purchasePaymentLedger({
    view, payments, documents,
    terms: purchaseInstalmentState(view, instalmentsOf(view.order, PAYMENT_TERMS), payments),
    settled: payee => purchaseGroupSettled(view, payments, payee),
    toleranceEur: 10, totalLabel: 'Totaal geland', planLabel: '30% bij bestelling, 70% bij vertrek',
  });
}

const of = (result: PaymentLedger, payee: string) => result.payees.find(item => item.payee === payee)!;
const identity = (item: ReturnType<typeof of>) =>
  Math.round(((item.agreedEur ?? 0) - item.paidEur - item.lowerEur + item.higherEur) * 100) === Math.round(item.openEur * 100);

test('the four payee labels are the one shared vocabulary', () => {
  assert.deepEqual(PAYEE_ORDER, ['SUPPLIER', 'LOGISTICS', 'SEPARATE', 'OTHER']);
  assert.deepEqual(PAYEE_ORDER.map(payee => PAYEE_LABEL[payee]), ['Leverancier', 'Douane & transport', 'Inspectie & andere kosten', 'Bijkomende kosten']);
  assert.deepEqual(PAYEE_ORDER.map(payee => PAYEE_SHORT[payee]), ['Leverancier', 'Transport', 'Inspectie', 'Bijkomend']);
});

test('every supplier and logistics stream closes: agreed minus paid minus lower plus higher is open', () => {
  const cases: [string, Partial<PurchaseReconciliationStream>, string][] = [
    ['unpaid', { plannedEur: 400, remainingEur: 400 }, 'DUE'],
    ['partial', { plannedEur: 400, paidEur: 150.55, remainingEur: 249.45 }, 'PARTIAL'],
    ['paid exactly', { plannedEur: 400, paidEur: 400, remainingEur: 0, finalized: true }, 'PAID'],
    ['settled lower', { plannedEur: 400, paidEur: 380, settledSavingEur: 20, remainingEur: 0, finalized: true, explicitlySettled: true }, 'SETTLED_LOWER'],
    ['overpaid unsettled', { plannedEur: 400, paidEur: 430, overpaidEur: 30, remainingEur: 0 }, 'OVERPAID'],
    ['overpaid settled', { plannedEur: 400, paidEur: 430, overpaidEur: 30, remainingEur: 0, finalized: true, explicitlySettled: true }, 'SETTLED_HIGHER'],
  ];
  for (const [name, values, kind] of cases) {
    for (const payee of ['SUPPLIER', 'LOGISTICS'] as const) {
      const view = purchase({ status: 'ONDERWEG', streams: [stream(payee, values)] });
      const item = of(ledger(view, values.paidEur ? [payment(1, { payee, amountEur: values.paidEur, amount: values.paidEur })] : []), payee);
      assert.equal(item.balanced, true, `${payee} ${name}`);
      assert.equal(identity(item), true, `${payee} ${name}`);
      assert.equal(item.status.kind, kind, `${payee} ${name}`);
    }
  }
  // A supplier whose first term was settled lower and whose second term was overpaid keeps both lines.
  const view = purchase({ status: 'ONTVANGEN', streams: [
    stream('SUPPLIER', { plannedEur: 1000, paidEur: 1000, settledSavingEur: 20, overpaidEur: 20, remainingEur: 0, finalized: true }),
  ], instalments: [
    instalment('ORDERED', { plannedEur: 300, paidEur: 280, settledSavingEur: 20, explicitlySettled: true, finalized: true }),
    instalment('SHIPPED', { plannedEur: 700, paidEur: 720, overpaidEur: 20, finalized: true }),
  ] });
  const supplier = of(ledger(view, [payment(1, { amountEur: 280, instalmentDue: 'ORDERED', settles: true }), payment(2, { amountEur: 720, instalmentDue: 'SHIPPED' })]), 'SUPPLIER');
  assert.equal(supplier.lowerEur, 20);
  assert.equal(supplier.higherEur, 20);
  assert.equal(supplier.differenceEur, 0);
  assert.equal(supplier.balanced, true);
  assert.equal(supplier.status.kind, 'PAID');
  assert.deepEqual(supplier.terms.map(term => [term.due, term.lowerEur, term.higherEur, term.status.label]),
    [['ORDERED', 20, 0, 'Afgerekend · minder betaald'], ['SHIPPED', 0, 20, 'Afgerekend · meer betaald']]);
});

test('a payment without its euro value is incomplete, and figures that do not close are never shown as balanced', () => {
  const view = purchase({ streams: [stream('SUPPLIER', { plannedEur: 1000, paidEur: 300, remainingEur: 700 }), stream('OTHER', { paidEur: 5 })] });
  const result = ledger(view, [payment(1, { amountEur: Number.NaN }), payment(2, { payee: 'OTHER', amountEur: Number.NaN })]);
  assert.equal(of(result, 'SUPPLIER').status.label, 'Onvolledig');
  assert.equal(of(result, 'OTHER').status.label, 'Onvolledig');
  const broken = ledger(purchase({ streams: [stream('SUPPLIER', { plannedEur: 1000, paidEur: 300, remainingEur: 650 })] }), [payment(1, { amountEur: 300 })]);
  assert.equal(of(broken, 'SUPPLIER').balanced, false);
  assert.equal(of(broken, 'SUPPLIER').status.kind, 'INCOMPLETE');
  assert.equal(broken.summary.balanced, false);
  assert.ok(broken.todos.some(todo => todo.kind === 'incomplete' && todo.payee === 'SUPPLIER'));
});

test('bijkomende kosten never count in the agreement or the open amount, only in what was paid in total', () => {
  const view = purchase({ status: 'ONDERWEG', streams: [
    stream('SUPPLIER', { plannedEur: 1000, paidEur: 300, remainingEur: 700 }),
    stream('LOGISTICS', { plannedEur: 400, paidEur: 400, remainingEur: 0, finalized: true }),
    stream('SEPARATE'),
    stream('OTHER', { plannedEur: 0, paidEur: 12.5, remainingEur: 0, status: 'ADDITIONAL' }),
  ] });
  const result = ledger(view, [payment(1, { amountEur: 300 }), payment(2, { payee: 'LOGISTICS', amountEur: 400 }), payment(3, { payee: 'OTHER', amountEur: 12.5 })]);
  const other = of(result, 'OTHER');
  assert.equal(other.agreedEur, null);
  assert.equal(other.openEur, 0);
  assert.equal(other.status.label, 'Bijkomend');
  assert.equal(result.summary.agreedEur, 1400);
  assert.equal(result.summary.paidOnAgreementEur, 700);
  assert.equal(result.summary.additionalEur, 12.5);
  assert.equal(result.summary.paidTotalEur, 712.5);
  assert.equal(result.summary.paidTotalEur, result.summary.paidOnAgreementEur + result.summary.additionalEur);
  assert.equal(result.summary.openEur, 700);
  assert.equal(result.summary.forecastEur, 1412.5);
});

test('only payees with an agreement or a payment show, and a zero inspection no longer says it still has to be paid', () => {
  const plain = ledger(purchase());
  assert.deepEqual(plain.visible.map(item => item.payee), ['SUPPLIER', 'LOGISTICS']);
  const paidInspection = ledger(purchase({ streams: [stream('SUPPLIER', { plannedEur: 1000, remainingEur: 1000 }), stream('SEPARATE', { paidEur: 60, overpaidEur: 60 })] }),
    [payment(1, { payee: 'SEPARATE', amountEur: 60 })]);
  assert.equal(of(paidInspection, 'SEPARATE').visible, true);
  assert.equal(of(paidInspection, 'SEPARATE').status.label, 'Niet begroot');
  const ddp = ledger(purchase({ ddp: true, streams: [stream('SUPPLIER', { plannedEur: 1000, remainingEur: 1000 }), stream('LOGISTICS')] }));
  assert.equal(of(ddp, 'LOGISTICS').visible, false);
  assert.equal(of(ddp, 'LOGISTICS').basis, 'Inbegrepen in de prijs (DDP)');
  const ddpPaid = ledger(purchase({ ddp: true, streams: [stream('SUPPLIER', { plannedEur: 1000, remainingEur: 1000 }), stream('LOGISTICS', { paidEur: 40, overpaidEur: 40 })] }),
    [payment(1, { payee: 'LOGISTICS', amountEur: 40 })]);
  assert.equal(of(ddpPaid, 'LOGISTICS').visible, true);
  assert.equal(of(ddp, 'SUPPLIER').visible, true);
  assert.equal(of(ddp, 'OTHER').visible, false);
});

test('what is due now follows the order status, and due plus later is always what is open', () => {
  const streams = () => [
    stream('SUPPLIER', { plannedEur: 1000, remainingEur: 1000 }), stream('LOGISTICS', { plannedEur: 400, remainingEur: 400 }),
    stream('SEPARATE', { plannedEur: 60, remainingEur: 60 }), stream('OTHER'),
  ];
  const instalments = () => [instalment('ORDERED', { plannedEur: 300, remainingEur: 300 }), instalment('SHIPPED', { plannedEur: 700, remainingEur: 700 })];
  const expected: Record<Status, [number, number, number]> = {
    CONCEPT: [0, 0, 0], BESTELD: [300, 0, 60], ONDERWEG: [1000, 400, 60], ONTVANGEN: [1000, 400, 60],
  };
  for (const status of ['CONCEPT', 'BESTELD', 'ONDERWEG', 'ONTVANGEN'] as const) {
    const result = ledger(purchase({ status, streams: streams(), instalments: instalments() }));
    assert.deepEqual(['SUPPLIER', 'LOGISTICS', 'SEPARATE'].map(payee => of(result, payee).dueNowEur), expected[status], status);
    for (const item of result.payees) assert.equal(Math.round((item.dueNowEur + item.laterEur) * 100), Math.round(item.openEur * 100), `${status} ${item.payee}`);
    assert.equal(of(result, 'OTHER').dueNowEur, 0);
  }
  const besteld = ledger(purchase({ status: 'BESTELD', streams: streams(), instalments: instalments() }));
  assert.equal(of(besteld, 'SUPPLIER').laterDue, 'SHIPPED');
  assert.equal(of(besteld, 'LOGISTICS').laterDue, 'SHIPPED');
  assert.equal(of(besteld, 'LOGISTICS').status.label, 'Later · bij vertrek');
  const concept = ledger(purchase({ status: 'CONCEPT', streams: streams(), instalments: instalments() }));
  assert.equal(concept.summary.dueNowEur, 0);
  assert.equal(of(concept, 'SUPPLIER').status.label, 'Gepland');
  assert.equal(of(concept, 'SUPPLIER').terms[0].status.label, 'Gepland');
});

test('each payee status comes from exactly one rule, in priority order', () => {
  const kind = (values: Partial<PurchaseReconciliationStream>, status: Status = 'BESTELD', payee: 'SUPPLIER' | 'SEPARATE' | 'OTHER' = 'SEPARATE',
    payments: PurchasePayment[] = values.paidEur ? [payment(1, { payee, amountEur: values.paidEur })] : []) =>
    of(ledger(purchase({ status, streams: [stream('SUPPLIER', { plannedEur: 1000, remainingEur: 1000 }), stream(payee, values)] }), payments), payee).status;
  assert.equal(kind({}).kind, 'NONE');
  assert.equal(kind({ paidEur: 5 }, 'BESTELD', 'OTHER').kind, 'ADDITIONAL');
  assert.equal(kind({ plannedEur: 60, paidEur: 60 }, 'BESTELD', 'SEPARATE', [payment(1, { payee: 'SEPARATE', amountEur: Number.NaN })]).kind, 'INCOMPLETE');
  assert.equal(kind({ paidEur: 60, overpaidEur: 60 }).kind, 'UNBUDGETED');
  assert.equal(kind({ paidEur: 60, overpaidEur: 60, finalized: true, explicitlySettled: true }).kind, 'SETTLED_HIGHER');
  assert.equal(kind({ plannedEur: 60, paidEur: 70, overpaidEur: 10 }).kind, 'OVERPAID');
  assert.equal(kind({ plannedEur: 60, paidEur: 70, overpaidEur: 10, finalized: true }).kind, 'SETTLED_HIGHER');
  assert.equal(kind({ plannedEur: 60, paidEur: 50, settledSavingEur: 10, finalized: true, explicitlySettled: true }).kind, 'SETTLED_LOWER');
  assert.equal(kind({ plannedEur: 60, paidEur: 60, finalized: true }).kind, 'PAID');
  const closed = kind({ plannedEur: 60, paidEur: 60, finalized: true, explicitlySettled: true });
  assert.deepEqual([closed.kind, closed.label, closed.tone], ['PAID', 'Betaald · afgerekend', 'ok'], 'an explicit settlement without a difference says so');
  assert.equal(kind({ plannedEur: 60, remainingEur: 60 }, 'CONCEPT').kind, 'PLANNED');
  const due = kind({ plannedEur: 60, remainingEur: 60 });
  assert.deepEqual([due.kind, due.label, due.tone], ['DUE', 'Nu te betalen', 'warn']);
  const later = kind({ plannedEur: 60, remainingEur: 60 }, 'BESTELD', 'SUPPLIER');
  assert.equal(later.kind, 'DUE', 'a supplier without per-term figures is due once ordered');
  assert.equal(kind({ plannedEur: 60, paidEur: 55, remainingEur: 5 }).kind, 'SMALL_DIFFERENCE');
  const partial = kind({ plannedEur: 60, paidEur: 20, remainingEur: 40 });
  assert.deepEqual([partial.kind, partial.tone], ['PARTIAL', 'warn']);
  const waiting = of(ledger(purchase({ status: 'BESTELD', streams: [stream('LOGISTICS', { plannedEur: 400, paidEur: 100, remainingEur: 300 })] }),
    [payment(1, { payee: 'LOGISTICS', amountEur: 100 })]), 'LOGISTICS').status;
  assert.deepEqual([waiting.kind, waiting.tone], ['PARTIAL', 'neutral']);
  const logistics = of(ledger(purchase({ status: 'BESTELD', streams: [stream('LOGISTICS', { plannedEur: 400, remainingEur: 400 })] })), 'LOGISTICS').status;
  assert.deepEqual([logistics.kind, logistics.label], ['LATER', 'Later · bij vertrek']);
});

test('a small difference is only offered for a known, unsettled, partly paid payee within the tolerance', () => {
  const small = (values: Partial<PurchaseReconciliationStream>, payee: 'LOGISTICS' | 'OTHER' = 'LOGISTICS') =>
    of(ledger(purchase({ status: 'ONDERWEG', streams: [stream(payee, values)] }),
      values.paidEur ? [payment(1, { payee, amountEur: values.paidEur })] : []), payee).smallDifference;
  assert.equal(small({ plannedEur: 400, paidEur: 395.2, remainingEur: 4.8 }), true);
  assert.equal(small({ plannedEur: 400, paidEur: 390, remainingEur: 10 }), true);
  assert.equal(small({ plannedEur: 400, paidEur: 389.99, remainingEur: 10.01 }), false);
  assert.equal(small({ plannedEur: 400, remainingEur: 4.8, paidEur: 0 }), false);
  assert.equal(small({ plannedEur: 400, paidEur: 395.2, remainingEur: 4.8, explicitlySettled: true }), false);
  assert.equal(small({ plannedEur: 400, paidEur: 400, remainingEur: 0 }), false);
  assert.equal(small({ paidEur: 4 }, 'OTHER'), false);
  const legacy = ledger(purchase({ status: 'ONDERWEG', streams: null }), [payment(1, { payee: 'LOGISTICS', amountEur: 395 })]);
  assert.equal(of(legacy, 'LOGISTICS').smallDifference, false, 'Without server figures there is no settle shortcut');
});

test('an old response without reconciliation gives provisional figures and never a settled difference', () => {
  const view = purchase({ status: 'ONDERWEG', streams: null });
  const result = ledger(view, [payment(1, { amountEur: 400 }), payment(2, { payee: 'LOGISTICS', amountEur: 395 }), payment(3, { payee: 'OTHER', amountEur: 7 })]);
  assert.equal(result.known, false);
  assert.equal(of(result, 'SUPPLIER').openEur, 600);
  assert.equal(of(result, 'LOGISTICS').openEur, 0, 'Short by the small change of paying counts as paid');
  assert.equal(of(result, 'LOGISTICS').status.kind, 'PAID');
  for (const item of result.payees) {
    assert.equal(item.lowerEur, 0);
    assert.equal(item.higherEur, 0);
    assert.equal(item.balanced, true);
    assert.equal(item.canSettle, false);
    assert.doesNotMatch(item.status.label, /Afgerekend|Verschil/);
  }
  assert.equal(result.summary.paidTotalEur, 802);
  const settled = ledger(view, [payment(1, { amountEur: 500, settles: true })]);
  assert.equal(of(settled, 'SUPPLIER').openEur, 0);
  assert.equal(of(settled, 'SUPPLIER').differenceEur, 0);
});

test('supplier terms join the server figures on their moment and can only be settled with a payment tied to them', () => {
  const view = purchase({ status: 'ONDERWEG', streams: [stream('SUPPLIER', { plannedEur: 1000, paidEur: 290, remainingEur: 710 })],
    instalments: [instalment('ORDERED', { plannedEur: 300, paidEur: 290, remainingEur: 10 }), instalment('SHIPPED', { plannedEur: 700, remainingEur: 700 })] });
  const unscoped = of(ledger(view, [payment(1, { amountEur: 290 })]), 'SUPPLIER');
  assert.deepEqual(unscoped.terms.map(term => [term.due, term.fullEur, term.paidEur, term.openEur, term.canSettle]),
    [['ORDERED', 300, 290, 10, false], ['SHIPPED', 700, 0, 700, false]]);
  assert.deepEqual(unscoped.settleDefault, { payee: 'SUPPLIER', scope: 'GROUP', due: null });
  const scoped = of(ledger(view, [payment(1, { amountEur: 290, instalmentDue: 'ORDERED' })]), 'SUPPLIER');
  assert.equal(scoped.terms[0].canSettle, true);
  assert.equal(scoped.terms[0].status.label, 'Deels betaald');
  assert.equal(scoped.terms[1].status.label, 'Nu te betalen');
  assert.equal(scoped.terms[1].canSettle, false);
  const noCanonical = purchase({ status: 'ONDERWEG', streams: [stream('SUPPLIER', { plannedEur: 1000, paidEur: 290, remainingEur: 710 })] });
  assert.equal(of(ledger(noCanonical, [payment(1, { amountEur: 290 })]), 'SUPPLIER').terms.every(term => !term.canSettle), true);
  const oneOpen = purchase({ status: 'ONDERWEG', streams: [stream('SUPPLIER', { plannedEur: 1000, paidEur: 990, remainingEur: 10 })],
    instalments: [instalment('ORDERED', { plannedEur: 300, paidEur: 300, remainingEur: 0, finalized: true }), instalment('SHIPPED', { plannedEur: 700, paidEur: 690, remainingEur: 10 })] });
  const single = of(ledger(oneOpen, [payment(1, { amountEur: 300, instalmentDue: 'ORDERED' }), payment(2, { amountEur: 690, instalmentDue: 'SHIPPED' })]), 'SUPPLIER');
  assert.deepEqual(single.settleDefault, { payee: 'SUPPLIER', scope: 'TERM', due: 'SHIPPED' });
  assert.equal(single.smallDifference, true);
  assert.deepEqual(single.terms[0].status, { label: 'Betaald', tone: 'ok' });
  const closedTerm = purchase({ status: 'ONDERWEG', streams: [stream('SUPPLIER', { plannedEur: 1000, paidEur: 1000, remainingEur: 0, finalized: true, explicitlySettled: true })],
    instalments: [instalment('ORDERED', { plannedEur: 300, paidEur: 300, remainingEur: 0, finalized: true, explicitlySettled: true }), instalment('SHIPPED', { plannedEur: 700, paidEur: 700, remainingEur: 0, finalized: true })] });
  const terms = of(ledger(closedTerm, [payment(1, { amountEur: 300, instalmentDue: 'ORDERED', settles: true }), payment(2, { amountEur: 700, instalmentDue: 'SHIPPED' })]), 'SUPPLIER').terms;
  assert.deepEqual(terms.map(term => term.status), [{ label: 'Betaald · afgerekend', tone: 'ok' }, { label: 'Betaald', tone: 'ok' }], 'a settled, fully paid term says so; a merely paid one does not');
  // A term settled on its own: the paid supplier reads 'afgerekend' exactly when its row offers to undo that settlement, in both vocabularies.
  const termOnly = purchase({ status: 'ONDERWEG', streams: [stream('SUPPLIER', { plannedEur: 1000, paidEur: 1000, remainingEur: 0, finalized: true, status: 'PAID' })],
    instalments: [instalment('ORDERED', { plannedEur: 300, paidEur: 300, remainingEur: 0, finalized: true }), instalment('SHIPPED', { plannedEur: 700, paidEur: 700, remainingEur: 0, finalized: true, explicitlySettled: true })] });
  const termSettled = of(ledger(termOnly, [payment(1, { amountEur: 300, instalmentDue: 'ORDERED' }), payment(2, { amountEur: 700, instalmentDue: 'SHIPPED', settles: true })]), 'SUPPLIER');
  assert.deepEqual([termSettled.status.label, termSettled.canUndoSettle], ['Betaald · afgerekend', true]);
  assert.equal(reconciliationStatusLabel(termOnly.reconciliation!.streams[0], termOnly.reconciliation!.supplierInstalments), 'Betaald · afgerekend');
  const merelyPaid = of(ledger(termOnly, [payment(1, { amountEur: 300, instalmentDue: 'ORDERED' }), payment(2, { amountEur: 700, instalmentDue: 'SHIPPED' })]), 'SUPPLIER');
  assert.deepEqual([merelyPaid.status.label, merelyPaid.canUndoSettle], ['Betaald', false]);
});

test('an agreement lists its parts, adds a rounding row up to a euro, and says so when the estimate no longer matches', () => {
  const view = purchase({ totals: { inspectionEur: 60, otherCosts: [{ label: 'Labo', amountEur: 25 }, { label: 'Leeg', amountEur: 0 }] } });
  const logistics = payeeComposition('LOGISTICS', view, 400.4);
  assert.deepEqual(logistics.lines.map(line => [line.label, line.amountEur]),
    [['Lokale kosten China', 100], ['Zeevracht', 200], ['Invoerrechten', 50], ['Rotterdam → magazijn', 50], ['Afronding', 0.4]]);
  assert.equal(logistics.lines[1].hint, 'Ningbo → Rotterdam');
  assert.equal(logistics.consistent, true);
  assert.equal(payeeComposition('LOGISTICS', view, 400).lines.some(line => line.rounding), false);
  const off = payeeComposition('LOGISTICS', view, 420);
  assert.equal(off.consistent, false);
  assert.equal(off.lines.some(line => line.rounding), false);
  assert.deepEqual(payeeComposition('SEPARATE', view, 85).lines.map(line => line.label), ['Inspectie', 'Labo']);
  assert.deepEqual(payeeComposition('LOGISTICS', purchase({ ddp: true }), 0).lines, []);
  assert.deepEqual(payeeComposition('SUPPLIER', view, 1000).lines.map(line => [line.label, line.amountEur]), [['Goederen', 1000]]);
});

test('the bridge adds up to the landed total, with a rounding row up to a euro', () => {
  const plain = purchaseLandedBridge(purchase(), 'Totaal geland');
  assert.deepEqual(plain.rows.map(row => [row.label, row.amountEur, row.note]),
    [['Leverancier · goederen', 1000, null], ['Douane & transport', 400, null], ['Enrosed kost', 150, 'intern, geen betaling']]);
  assert.equal(plain.totalEur, 1550);
  assert.equal(plain.consistent, true);
  const rounded = purchaseLandedBridge(purchase({ totals: { totalWithSeparateCostsEur: 1550.6 } }), 'Totaal geland');
  assert.deepEqual(rounded.rows.at(-1), { key: 'ROUNDING', label: 'Afronding', amountEur: 0.6, note: null });
  assert.equal(purchaseLandedBridge(purchase({ totals: { totalWithSeparateCostsEur: 1600 } }), 'Totaal geland').consistent, false);
  const separate = purchaseLandedBridge(purchase({ totals: { separateCostsEur: 85, totalWithSeparateCostsEur: 1635 } }), 'Totaal incl. aparte kosten');
  assert.deepEqual(separate.rows.map(row => row.key), ['SUPPLIER', 'LOGISTICS', 'ENROSED', 'LANDED', 'SEPARATE'],
    'costs outside the piece price come after the landed total the hero shows');
  assert.deepEqual(separate.rows[3], { key: 'LANDED', label: 'Totaal geland', amountEur: 1550, note: 'zoals in de kop', subtotal: true });
  assert.deepEqual(separate.rows[4], { key: 'SEPARATE', label: 'Inspectie & andere kosten', amountEur: 85, note: 'apart, buiten de stukprijs' });
  assert.equal(separate.totalLabel, 'Totaal incl. aparte kosten');
  assert.equal(separate.consistent, true, 'the subtotal is shown, never added again');
  assert.equal(separate.rows.filter(row => !row.subtotal).reduce((sum, row) => sum + row.amountEur, 0), separate.totalEur);
  const roundedSeparate = purchaseLandedBridge(purchase({ totals: { separateCostsEur: 85, totalWithSeparateCostsEur: 1635.5 } }), 'x');
  assert.deepEqual(roundedSeparate.rows.at(-1), { key: 'ROUNDING', label: 'Afronding', amountEur: 0.5, note: null });
  assert.equal(roundedSeparate.rows.some(row => row.key === 'ROUNDING_LANDED'), false, 'a residue in the separate part stays below the subtotal');
  const roundedLanded = purchaseLandedBridge(purchase({ totals: { totalEur: 1550.3, separateCostsEur: 85, totalWithSeparateCostsEur: 1635.3 } }), 'x');
  assert.deepEqual(roundedLanded.rows.map(row => [row.key, row.amountEur]),
    [['SUPPLIER', 1000], ['LOGISTICS', 400], ['ENROSED', 150], ['ROUNDING_LANDED', 0.3], ['LANDED', 1550.3], ['SEPARATE', 85]],
    'a residue in the landed part is corrected before the subtotal, so the rows above it add up by eye');
  assert.equal(roundedLanded.consistent, true);
  assert.equal(roundedLanded.rows.filter(row => !row.subtotal).reduce((sum, row) => sum + row.amountEur, 0), 1635.3);
  const inPrice = purchaseLandedBridge(purchase({ totals: { separateCostsEur: 85, separateCostsInPiecePrice: true, totalWithSeparateCostsEur: 1635 } }), 'x');
  assert.deepEqual(inPrice.rows.map(row => row.key), ['SUPPLIER', 'LOGISTICS', 'SEPARATE', 'ENROSED'], 'in the piece price there is no subtotal');
  assert.equal(inPrice.rows[2].note, null);
  assert.equal(inPrice.rows.some(row => row.subtotal), false);
  assert.equal(plain.rows.some(row => row.subtotal), false);
  const ddp = purchaseLandedBridge(purchase({ ddp: true, totals: { totalWithSeparateCostsEur: 1150 } }), 'Totaal geland');
  assert.deepEqual(ddp.rows[1], { key: 'LOGISTICS', label: 'Douane & transport', amountEur: 0, note: 'inbegrepen in de prijs (DDP)' });
  assert.equal(ddp.consistent, true);
  const legacy = purchaseLandedBridge(purchase({ payable: null }), 'Totaal geland');
  assert.deepEqual(legacy.rows.map(row => row.amountEur), [1000, 400, 150]);
});

test('a settlement flag goes on the existing settler, then the newest unscoped payment, then the newest one', () => {
  const payments = [
    payment(1, { paidOn: '2026-08-01', instalmentDue: 'ORDERED' }), payment(2, { paidOn: '2026-08-10' }),
    payment(3, { paidOn: '2026-08-20', instalmentDue: 'SHIPPED' }), payment(4, { paidOn: '2026-08-05', payee: 'LOGISTICS' }),
  ];
  const group = settleCarriers(payments, 'SUPPLIER', 'GROUP', null);
  assert.deepEqual(group.options.map(option => option.id), [3, 2, 1]);
  assert.equal(group.defaultId, 2);
  assert.deepEqual(group.options.map(option => option.reallocates), [true, false, true]);
  assert.equal(settleCarriers([...payments, payment(5, { paidOn: '2026-07-01', settles: true })], 'SUPPLIER', 'GROUP', null).defaultId, 5);
  const scopedOnly = settleCarriers([payments[0], payments[2]], 'SUPPLIER', 'GROUP', null);
  assert.equal(scopedOnly.defaultId, 3);
  assert.equal(scopedOnly.options.find(option => option.id === 3)!.reallocates, true);
  const term = settleCarriers(payments, 'SUPPLIER', 'TERM', 'ORDERED');
  assert.deepEqual(term.options.map(option => option.id), [1]);
  assert.equal(term.defaultId, 1);
  assert.deepEqual(settleCarriers(payments, 'SUPPLIER', 'TERM', 'ARRIVED'), { options: [], defaultId: null });
  assert.deepEqual(settleCarriers(payments, 'LOGISTICS', 'GROUP', null).options.map(option => [option.id, option.reallocates]), [[4, false]]);
  assert.equal(settleCarriers([], 'SEPARATE', 'GROUP', null).defaultId, null);
});

test('ledger rows read newest first, keep the booked currency and euro value, and count proofs once documents are loaded', () => {
  const view = purchase({ instalments: [instalment('ORDERED', { plannedEur: 300 })] });
  const payments = [
    payment(1, { paidOn: '2026-08-01', amount: 330, currency: 'USD', amountEur: 297.1, instalmentDue: 'ORDERED', settles: true, payee: null }),
    payment(2, { paidOn: '2026-08-01', payee: 'LOGISTICS', label: ' Forwarder ' }),
    payment(3, { paidOn: '2026-07-15', instalmentDue: 'SHIPPED' }),
  ];
  const loading = ledger(view, payments, null);
  assert.deepEqual(loading.rows.map(row => row.id), [2, 1, 3]);
  assert.equal(loading.rows[0].hasProof, null);
  assert.equal(loading.rows[0].proofs, null);
  assert.equal(loading.summary.missingProofCount, null);
  assert.equal(of(loading, 'SUPPLIER').proof, null);
  const row = loading.rows[1];
  assert.deepEqual([row.payee, row.currency, row.foreign, row.amount, row.amountEur, row.termLabel, row.settlesLabel, row.title],
    ['SUPPLIER', 'USD', true, 330, 297.1, '30% bij bestelling', 'Rekent de termijn af', 'Leverancier']);
  assert.equal(ledger(view, [payment(4, { payee: 'LOGISTICS', settles: true })]).rows[0].settlesLabel, 'Rekent alles af');
  assert.equal(loading.rows[0].title, 'Forwarder');
  assert.equal(loading.rows[2].termLabel, 'Termijn bij vertrek');
  const loaded = ledger(view, payments, [proof(10, 1), proof(11, 1), proof(12, null)]);
  assert.deepEqual(loaded.rows.map(item => [item.id, item.proofCount, item.hasProof]), [[2, 0, false], [1, 2, true], [3, 0, false]]);
  assert.equal(loaded.summary.missingProofCount, 2);
  assert.deepEqual(of(loaded, 'SUPPLIER').proof, { withProof: 1, total: 2 });
  assert.deepEqual(sortLedgerRows(loaded.rows, 'amount', 'desc').map(item => item.id), [1, 3, 2]);
  assert.deepEqual(sortLedgerRows(loaded.rows, 'date', 'asc').map(item => item.id), [3, 1, 2]);
  const parts = paymentOptionParts(payments[1], view.reconciliation!.supplierInstalments);
  assert.deepEqual(parts, { paidOn: '2026-08-01', payeeLabel: 'Douane & transport', termLabel: null, amountEur: 100, label: 'Forwarder' });
});

test('te doen lists what to pay first, then settle, review, budget, incomplete and proof items', () => {
  const view = purchase({ status: 'ONDERWEG', streams: [
    stream('SUPPLIER', { plannedEur: 1000, paidEur: 300, remainingEur: 700 }),
    stream('LOGISTICS', { plannedEur: 400, paidEur: 395, remainingEur: 5 }),
    stream('SEPARATE', { paidEur: 30, overpaidEur: 30 }),
    stream('OTHER', { paidEur: 4 }),
  ], instalments: [instalment('ORDERED', { plannedEur: 300, paidEur: 300, remainingEur: 0 }), instalment('SHIPPED', { plannedEur: 700, remainingEur: 700 })] });
  const result = ledger(view, [payment(1, { amountEur: 300 }), payment(2, { payee: 'LOGISTICS', amountEur: 395 }),
    payment(3, { payee: 'SEPARATE', amountEur: 30 }), payment(4, { payee: 'OTHER', amountEur: 4 })], [proof(9, 1)]);
  assert.deepEqual(result.todos.map(todo => todo.key),
    ['pay:SUPPLIER:SHIPPED', 'pay:LOGISTICS', 'settle:LOGISTICS', 'budget:SEPARATE', 'proof']);
  const pay = result.todos[0];
  assert.equal(pay.kind === 'pay' && pay.label, '70% bij vertrek');
  assert.equal(pay.kind === 'pay' && pay.amountEur, 700);
  const settle = result.todos[2];
  assert.deepEqual(settle.kind === 'settle' && settle.request, { payee: 'LOGISTICS', scope: 'GROUP', due: null });
  assert.equal(result.todos.at(-1)!.kind === 'proof' && (result.todos.at(-1) as { count: number }).count, 3);
  const overpaid = ledger(purchase({ status: 'ONTVANGEN', streams: [stream('SUPPLIER', { plannedEur: 1000, paidEur: 1020, overpaidEur: 20 }), stream('LOGISTICS')] }),
    [payment(1, { amountEur: 1020 })], [proof(1, 1)]);
  assert.deepEqual(overpaid.todos.map(todo => [todo.kind, 'amountEur' in todo ? todo.amountEur : null]), [['review', 20]]);
});

test('the headline and next step answer what has to be paid now', () => {
  const streams = (paid = 0) => [stream('SUPPLIER', { plannedEur: 1000, paidEur: paid, remainingEur: 1000 - paid }), stream('LOGISTICS', { plannedEur: 400, remainingEur: 400 })];
  const instalments = (paid = 0) => [instalment('ORDERED', { plannedEur: 300, paidEur: Math.min(paid, 300), remainingEur: 300 - Math.min(paid, 300) }),
    instalment('SHIPPED', { plannedEur: 700, remainingEur: 700 })];
  assert.equal(ledger(purchase({ status: 'CONCEPT', streams: streams(), instalments: instalments() })).summary.headline.kind, 'concept');
  assert.equal(ledger(purchase({ status: 'BESTELD', streams: [stream('SUPPLIER'), stream('LOGISTICS')], payable: null,
    totals: { goodsEur: 0 } })).summary.headline.kind, 'empty');
  const due = ledger(purchase({ status: 'BESTELD', streams: streams(), instalments: instalments() }));
  assert.equal(due.summary.headline.kind, 'due');
  assert.deepEqual(due.summary.next, { payee: 'SUPPLIER', due: 'ORDERED', label: '30% bij bestelling', amountEur: 300, now: true, when: 'nu' });
  const later = ledger(purchase({ status: 'BESTELD', streams: streams(300), instalments: instalments(300) }), [payment(1, { amountEur: 300 })]);
  assert.equal(later.summary.headline.kind, 'later');
  assert.deepEqual(later.summary.next, { payee: 'SUPPLIER', due: 'SHIPPED', label: '70% bij vertrek', amountEur: 700, now: false, when: 'bij vertrek' });
  const review = ledger(purchase({ status: 'ONTVANGEN', streams: [stream('SUPPLIER', { plannedEur: 1000, paidEur: 1020, overpaidEur: 20 }), stream('LOGISTICS')] }), [payment(1, { amountEur: 1020 })]);
  assert.equal(review.summary.headline.kind, 'review');
  assert.equal(review.summary.headline.payee?.payee, 'SUPPLIER');
  assert.equal(review.summary.next, null);
  const done = ledger(purchase({ status: 'ONTVANGEN', streams: [stream('SUPPLIER', { plannedEur: 1000, paidEur: 1000, finalized: true }), stream('LOGISTICS')] }), [payment(1, { amountEur: 1000 })]);
  assert.equal(done.summary.headline.kind, 'done');
  assert.equal(done.summary.progress, 1);
});

test('the one text action of a payee row is the same rule on every screen: record what is due, settle only a remainder that is not scheduled later', () => {
  const action = (status: Status, values: Partial<PurchaseReconciliationStream>, payee: 'SUPPLIER' | 'LOGISTICS' | 'SEPARATE' | 'OTHER' = 'LOGISTICS',
    payments: PurchasePayment[] = values.paidEur ? [payment(1, { payee, amountEur: values.paidEur, amount: values.paidEur })] : []) => {
    const item = of(ledger(purchase({ status, streams: [stream('SUPPLIER', { plannedEur: 1000, remainingEur: 1000 }), stream(payee, values)] }), payments), payee);
    assert.equal(item.action, payeeRowAction(item), 'the ledger stamps the rule on the payee');
    return item.action;
  };
  assert.equal(action('ONDERWEG', { plannedEur: 400, remainingEur: 400 }), 'add', 'due now');
  assert.equal(action('BESTELD', { plannedEur: 400, remainingEur: 400 }), 'add', 'open later only: record ahead of time, never settle');
  assert.equal(action('BESTELD', { plannedEur: 400, paidEur: 120, remainingEur: 280 }), 'add', 'a remainder scheduled later is never settled');
  assert.equal(action('ONDERWEG', { plannedEur: 400, paidEur: 395.2, remainingEur: 4.8 }), 'settle', 'small difference');
  assert.equal(action('BESTELD', { plannedEur: 400, paidEur: 395.2, remainingEur: 4.8 }), 'add', 'a small difference whose remainder is scheduled later is recorded, never settled');
  assert.equal(action('ONDERWEG', { plannedEur: 400, paidEur: 430, overpaidEur: 30 }), 'settle', 'overpaid and unsettled');
  assert.equal(action('ONDERWEG', { paidEur: 60, overpaidEur: 60 }), 'settle', 'unbudgeted');
  assert.equal(action('ONDERWEG', { plannedEur: 400, paidEur: 400, finalized: true }), null, 'nothing left');
  assert.equal(action('ONDERWEG', { plannedEur: 400, paidEur: 380, settledSavingEur: 20, finalized: true, explicitlySettled: true }), null, 'settled lower');
  assert.equal(action('ONDERWEG', { paidEur: 12 }, 'OTHER'), null, 'bijkomende kosten have no agreement to settle');
  // Mock 14: the supplier's 30 % is paid and the 70 % waits for departure; the workbench records, it does not settle.
  const deposit = of(ledger(purchase({ status: 'BESTELD', streams: [stream('SUPPLIER', { plannedEur: 42000, paidEur: 12600, remainingEur: 29400 })],
    instalments: [instalment('ORDERED', { plannedEur: 12600, paidEur: 12600, finalized: true }), instalment('SHIPPED', { plannedEur: 29400, remainingEur: 29400 })] }),
    [payment(1, { amountEur: 12600, amount: 104278.72, currency: 'CNY', instalmentDue: 'ORDERED' })]), 'SUPPLIER');
  assert.deepEqual([deposit.laterEur, deposit.canSettle, deposit.action], [29400, true, 'add']);
});

test('payee statuses use the same words as the reconciliation labels in Analyses', () => {
  const pairs: [Partial<PurchaseReconciliationStream>, PurchaseReconciliationStream['status'], 'SEPARATE' | 'OTHER'][] = [
    [{ plannedEur: 60, paidEur: 20, remainingEur: 40 }, 'PARTIAL', 'SEPARATE'],
    [{ plannedEur: 60, paidEur: 60, finalized: true }, 'PAID', 'SEPARATE'],
    [{ plannedEur: 60, paidEur: 60, finalized: true, explicitlySettled: true }, 'PAID', 'SEPARATE'],
    [{ plannedEur: 60, paidEur: 70, overpaidEur: 10 }, 'OVERPAID', 'SEPARATE'],
    [{ plannedEur: 60, paidEur: 70, overpaidEur: 10, finalized: true, explicitlySettled: true }, 'OVERPAID', 'SEPARATE'],
    [{ plannedEur: 60, paidEur: 50, settledSavingEur: 10, finalized: true, explicitlySettled: true }, 'SETTLED_LOWER', 'SEPARATE'],
    [{ paidEur: 60, overpaidEur: 60 }, 'ADDITIONAL', 'SEPARATE'],
    [{ paidEur: 6 }, 'ADDITIONAL', 'OTHER'],
    [{ plannedEur: 60, remainingEur: 60 }, 'PLANNED', 'SEPARATE'],
  ];
  for (const [values, status, payee] of pairs) {
    const server = stream(payee, { ...values, status });
    const view = purchase({ status: status === 'PLANNED' ? 'CONCEPT' : 'ONTVANGEN', streams: [server] });
    const item = of(ledger(view, values.paidEur ? [payment(1, { payee, amountEur: values.paidEur })] : []), payee);
    assert.equal(item.status.label, reconciliationStatusLabel(server), `${status} ${payee}`);
  }
});
