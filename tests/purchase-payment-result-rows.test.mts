import assert from 'node:assert/strict';
import test from 'node:test';
import type { PayeeLedger } from '../src/app/features/purchasing/purchase-payment-ledger.ts';
import { PAYEE_ORDER } from '../src/app/features/purchasing/purchase-payment-ledger.ts';
import type { PurchasePaymentResultStream } from '../src/app/features/purchasing/purchase-payment-result-metrics.ts';
import { paymentResultRows } from '../src/app/features/purchasing/purchase-payment-result-rows.ts';

function payee(id: PayeeLedger['payee'], values: Partial<PayeeLedger> = {}): PayeeLedger {
  const other = id === 'OTHER';
  return {
    payee: id, label: 'label ' + id, short: id, icon: 'icon ' + id, tone: 'tone-' + id, basis: 'basis', known: true,
    agreedEur: other ? null : 400, paidEur: 100, openEur: other ? 0 : 300, lowerEur: 0, higherEur: 0, differenceEur: 0,
    dueNowEur: 0, laterEur: 0, laterDue: null, finalized: false, explicitlySettled: false, missingAmount: false, balanced: true,
    paymentCount: 1, rows: [], proof: null, status: { kind: 'PARTIAL', label: 'Deels betaald', tone: 'neutral' }, terms: [],
    composition: [], compositionConsistent: true, canSettle: true, canUndoSettle: false, smallDifference: false,
    settleDefault: { payee: id, scope: 'GROUP', due: null }, next: null, visible: true, ...values,
  };
}

function stream(id: PurchasePaymentResultStream['payee'], netResultEur: number): PurchasePaymentResultStream {
  return { payee: id, label: id, savingEur: Math.max(0, netResultEur), settledOverrunEur: Math.max(0, -netResultEur), additionalCostEur: 0,
    unsettledOverrunEur: 0, netResultEur, finalized: true, plannedEur: 400, paidEur: 100, paymentCount: 1 };
}

test('the rows keep the payee order and drop the payees Betalingen does not show either', () => {
  const ledger = { payees: [payee('OTHER', { paidEur: 12 }), payee('SEPARATE', { visible: false }), payee('LOGISTICS'), payee('SUPPLIER')] };
  const shown = paymentResultRows(ledger, []);
  assert.deepEqual(shown.map(row => row.payee), ['OTHER', 'LOGISTICS', 'SUPPLIER'], 'the ledger already orders its payees; nothing is re-sorted here');
  const ordered = paymentResultRows({ payees: PAYEE_ORDER.map(id => payee(id, { paidEur: 5 })) }, []);
  assert.deepEqual(ordered.map(row => row.payee), PAYEE_ORDER);
  assert.deepEqual(paymentResultRows(null, [stream('SUPPLIER', 60)]), []);
});

test('bijkomende kosten only appear once paid and count entirely as more paid', () => {
  const none = paymentResultRows({ payees: [payee('SUPPLIER'), payee('OTHER', { paidEur: 0, paymentCount: 0 })] }, []);
  assert.deepEqual(none.map(row => row.payee), ['SUPPLIER']);
  const some = paymentResultRows({ payees: [payee('OTHER', { paidEur: 25, differenceEur: 0 })] }, []);
  assert.equal(some.length, 1);
  assert.equal(some[0].agreedEur, null);
  assert.equal(some[0].differenceEur, 25);
  assert.equal(some[0].openEur, 0);
});

test('the net result joins by payee and is zero when the stream is missing', () => {
  const rows = paymentResultRows({ payees: [payee('SUPPLIER', { differenceEur: -60, lowerEur: 60 }), payee('LOGISTICS', { differenceEur: 10, higherEur: 10 })] },
    [stream('LOGISTICS', -10), stream('SUPPLIER', 60)]);
  assert.deepEqual(rows.map(row => [row.payee, row.differenceEur, row.netResultEur]), [['SUPPLIER', -60, 60], ['LOGISTICS', 10, -10]]);
  const alone = paymentResultRows({ payees: [payee('SEPARATE')] }, [stream('SUPPLIER', 60)]);
  assert.equal(alone[0].netResultEur, 0);
});

test('status, settle flags, the default settle request and the figures pass through unchanged', () => {
  const source = payee('LOGISTICS', {
    agreedEur: 400.4, paidEur: 395.2, openEur: 5.2, differenceEur: 0, finalized: false, paymentCount: 3,
    status: { kind: 'SMALL_DIFFERENCE', label: 'Klein verschil', tone: 'warn' }, canSettle: true, canUndoSettle: true,
    settleDefault: { payee: 'LOGISTICS', scope: 'GROUP', due: null },
  });
  const [row] = paymentResultRows({ payees: [source] }, []);
  assert.deepEqual(row, {
    payee: 'LOGISTICS', label: 'label LOGISTICS', icon: 'icon LOGISTICS', tone: 'tone-LOGISTICS',
    agreedEur: 400.4, paidEur: 395.2, openEur: 5.2, differenceEur: 0, netResultEur: 0, finalized: false,
    status: { label: 'Klein verschil', tone: 'warn' }, canSettle: true, canUndoSettle: true,
    settleDefault: { payee: 'LOGISTICS', scope: 'GROUP', due: null }, paymentCount: 3,
  });
  assert.notEqual(row.status, source.status, 'the row owns its status object; the kind stays with the ledger');
});
