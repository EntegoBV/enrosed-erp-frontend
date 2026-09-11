import assert from 'node:assert/strict';
import test from 'node:test';
import type { Instalment, PurchaseInstalmentReconciliation, PurchaseOrderView, PurchasePayment } from '../src/app/core/api/models.ts';
import { purchaseGroupSettled, purchaseInstalmentState } from '../src/app/features/purchasing/purchase-instalment-state.ts';

const plan: Instalment[] = [
  { due: 'ORDERED', label: '30% bij bestelling', share: 0.3 },
  { due: 'SHIPPED', label: '30% bij vertrek', share: 0.3 },
  { due: 'ARRIVED', label: '40% bij aankomst', share: 0.4 },
];

function terms(): PurchaseInstalmentReconciliation[] {
  return plan.map((step, index) => ({ ...step, plannedEur: index === 2 ? 23_848 : 17_886,
    paidEur: index === 0 ? 17_000 : 0, remainingEur: index === 0 ? 0 : index === 2 ? 23_848 : 17_886,
    settledSavingEur: index === 0 ? 886 : 0, overpaidEur: 0,
    explicitlySettled: index === 0, finalized: index === 0 }));
}

function purchase(rows: PurchaseInstalmentReconciliation[] | undefined = terms()): PurchaseOrderView {
  return {
    order: { id: 50, status: 'BESTELD' },
    costing: { totals: { goodsEur: 59_620 } }, payable: { supplierEur: 59_620 },
    reconciliation: { supplierInstalments: rows, streams: [] },
  } as unknown as PurchaseOrderView;
}

function payment(values: Partial<PurchasePayment> = {}): PurchasePayment {
  return { id: 10, orderId: 50, paidOn: '2026-09-11', amount: 17_000, currency: 'EUR', amountEur: 17_000,
    payee: 'SUPPLIER', label: null, actor: null, recordedAt: '2026-09-11T12:00:00Z',
    settles: true, instalmentDue: 'ORDERED', ...values };
}

test('the canonical lower ORDERED settlement closes only its 30 percent term', () => {
  const view = purchase();
  const before = structuredClone(view);
  const rows = purchaseInstalmentState(view, plan, [payment()]);
  assert.deepEqual(rows[0], { due: 'ORDERED', label: '30% bij bestelling', full: 17_886,
    covered: 17_000, amount: 0, settled: true, state: 'paid' });
  assert.equal(rows[0].full - rows[0].covered, 886, 'Show the lower settled amount without claiming the full plan was paid');
  assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), 41_734);
  assert.deepEqual(rows.slice(1).map(row => [row.settled, row.state]), [[false, 'later'], [false, 'later']]);
  assert.deepEqual(view, before, 'The display projection cannot rewrite the budget or reconciliation');
});

test('canonical server allocation wins over stale local payments and the former plan', () => {
  const rows = purchaseInstalmentState(purchase(), [{ due: 'ARRIVED', label: 'Old single term', share: 1 }],
    [payment({ amountEur: 59_620, instalmentDue: null })]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].covered, 17_000);
  assert.equal(rows[1].amount, 17_886);
  assert.equal(rows[2].amount, 23_848);
  assert.deepEqual(purchaseInstalmentState(purchase(), plan, null), rows, 'Canonical data is usable while the separate ledger loads');
});

test('global closure and its removal follow the new server snapshot without retaining closed terms', () => {
  const globalTerms = terms().map(term => ({ ...term, remainingEur: 0,
    settledSavingEur: term.plannedEur - term.paidEur, explicitlySettled: true, finalized: true }));
  const closed = purchaseInstalmentState(purchase(globalTerms), plan, [payment({ instalmentDue: null })]);
  assert.ok(closed.every(row => row.state === 'paid' && row.settled && row.amount === 0));

  const reopened = purchaseInstalmentState(purchase(), plan, [payment()]);
  assert.equal(reopened[0].settled, true, 'The separate ORDERED settlement remains valid');
  assert.ok(reopened.slice(1).every(row => !row.settled && row.amount > 0));
  assert.equal(reopened.reduce((sum, row) => sum + row.amount, 0), 41_734);
});

test('unsetting or deleting the term-closing payment restores only the actual outstanding amounts', () => {
  const open = terms();
  open[0] = { ...open[0], remainingEur: 886, settledSavingEur: 0, explicitlySettled: false, finalized: false };
  const unset = purchaseInstalmentState(purchase(open), plan, [payment({ settles: false })]);
  assert.equal(unset[0].amount, 886);
  assert.equal(unset[0].state, 'due');
  assert.equal(unset[0].settled, false);
  const removed = open.map(term => ({ ...term, paidEur: 0, remainingEur: term.plannedEur }));
  const deleted = purchaseInstalmentState(purchase(removed), plan, []);
  assert.equal(deleted[0].covered, 0);
  assert.equal(deleted.reduce((sum, row) => sum + row.amount, 0), 59_620);
});

test('only reached open terms are due and natural full payment is not an explicit lower settlement', () => {
  const fullyPaid = terms();
  fullyPaid[0] = { ...fullyPaid[0], paidEur: 17_886, settledSavingEur: 0, explicitlySettled: false };
  for (const [status, expected] of [
    ['CONCEPT', ['paid', 'later', 'later']], ['BESTELD', ['paid', 'later', 'later']],
    ['ONDERWEG', ['paid', 'due', 'later']], ['ONTVANGEN', ['paid', 'due', 'due']],
  ] as const) {
    const view = purchase(fullyPaid); view.order.status = status;
    const rows = purchaseInstalmentState(view, plan, []);
    assert.deepEqual(rows.map(row => row.state), expected);
    assert.equal(rows[0].settled, false);
  }
});

test('an absent legacy ledger or scoped payment cannot invent allocation without canonical terms', () => {
  const view = purchase(); delete view.reconciliation!.supplierInstalments;
  assert.deepEqual(purchaseInstalmentState(view, plan, null), []);
  assert.deepEqual(purchaseInstalmentState(view, plan, [payment()]), []);
  assert.deepEqual(purchaseInstalmentState(view, plan, [payment({ instalmentDue: null, amountEur: Number.NaN })]), []);
  assert.deepEqual(purchaseInstalmentState(purchase([]), plan, []), [], 'An explicit empty server plan must not resurrect an old local preset');
});

test('legacy unscoped allocation keeps exact cents and closes globally only on its explicit flag', () => {
  const view = purchase(); delete view.reconciliation!.supplierInstalments;
  view.payable!.supplierEur = 100;
  const thirds: Instalment[] = plan.map((term, index) => ({ ...term, share: index === 2 ? 0.34 : 0.33 }));
  const open = purchaseInstalmentState(view, thirds, [payment({ amountEur: 32, settles: false, instalmentDue: null })]);
  assert.deepEqual(open.map(row => row.full), [33, 33, 34]);
  assert.deepEqual(open.map(row => row.amount), [1, 33, 34]);
  const closed = purchaseInstalmentState(view, thirds, [payment({ amountEur: 32, instalmentDue: null })]);
  assert.ok(closed.every(row => row.settled && row.amount === 0));
  assert.equal(closed[1].covered, 0, 'Closing a remaining term never fabricates a payment');
});

test('zero-budget canonical terms and nonpositive legacy budgets show no payable plan', () => {
  const zero = terms().map(term => ({ ...term, plannedEur: 0, paidEur: 0, remainingEur: 0,
    settledSavingEur: 0, explicitlySettled: false, finalized: false }));
  assert.deepEqual(purchaseInstalmentState(purchase(zero), plan, []), []);
  for (const amount of [0, -1]) {
    const view = purchase(); delete view.reconciliation!.supplierInstalments;
    view.payable!.supplierEur = amount;
    assert.deepEqual(purchaseInstalmentState(view, plan, []), []);
  }
});

test('an overpaid canonical term has no zero-value Noteren action before explicit settlement', () => {
  const overpaid = terms();
  overpaid[0] = { ...overpaid[0], paidEur: 18_000, remainingEur: 0, overpaidEur: 114,
    settledSavingEur: 0, explicitlySettled: false, finalized: false };
  const rows = purchaseInstalmentState(purchase(overpaid), plan, [payment({ amountEur: 18_000, settles: false })]);
  assert.equal(rows[0].state, 'paid');
  assert.equal(rows[0].amount, 0);
  assert.equal(rows[0].covered, 18_000, 'Keep the actual overpayment visible');
  assert.equal(rows[0].settled, false, 'Paid coverage does not pretend the overrun was explicitly settled');
  assert.ok(rows.slice(1).every(row => row.amount > 0 && !row.settled));
});

test('a settled first term leaves the whole supplier open while later terms remain unpaid', () => {
  const view = purchase();
  view.reconciliation!.streams = [{ payee: 'SUPPLIER', finalized: false, explicitlySettled: false,
    remainingEur: 41_734, settledSavingEur: 886 } as any];
  assert.equal(purchaseGroupSettled(view, [payment()], 'SUPPLIER'), false);
  assert.equal(purchaseGroupSettled(null, [payment()], 'SUPPLIER'), false, 'A term marker cannot become a legacy whole-group marker');
  assert.equal(purchaseGroupSettled(view, [payment({ instalmentDue: null })], 'SUPPLIER'), false,
    'The fresh server stream overrides a stale local whole-group marker');
});

test('all individually settled terms close the supplier even when the total saving is below ten euros', () => {
  const rows = terms().map(term => ({ ...term, paidEur: term.plannedEur - 1.25, remainingEur: 0,
    settledSavingEur: 1.25, explicitlySettled: true, finalized: true }));
  const view = purchase(rows);
  view.reconciliation!.streams = [{ payee: 'SUPPLIER', finalized: true, explicitlySettled: false,
    remainingEur: 0, settledSavingEur: 3.75 } as any];
  assert.equal(purchaseGroupSettled(view, [payment()], 'SUPPLIER'), true,
    'Explicit term completion cannot be hidden by the legacy ten-euro tolerance');
  assert.equal(purchaseGroupSettled(view, [], 'LOGISTICS'), false);
  view.reconciliation!.streams[0].finalized = false;
  assert.equal(purchaseGroupSettled(view, [payment()], 'SUPPLIER'), false, 'A reopened server stream wins immediately');
});
