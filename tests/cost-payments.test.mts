import assert from 'node:assert/strict';
import test from 'node:test';
import { newPaymentOf, paymentMarker, paymentTotals, paymentsBanked } from '../src/app/features/finance/cost-payments.ts';

test('a cost is paid once its payments reach the cash total, within a cent', () => {
  const two = paymentTotals(42, [{ amountEur: 7, paidOn: '2026-10-01' }, { amountEur: 7, paidOn: '2026-10-03' }]);
  assert.deepEqual(two, { paidEur: 14, openEur: 28, overpaidEur: 0, paid: false, paidOn: null });
  const three = paymentTotals(42, [{ amountEur: 7, paidOn: '2026-10-01' }, { amountEur: 28, paidOn: '2026-10-05' }, { amountEur: 7, paidOn: '2026-10-03' }]);
  assert.deepEqual(three, { paidEur: 42, openEur: 0, overpaidEur: 0, paid: true, paidOn: '2026-10-05' });
  const cent = paymentTotals(42, [{ amountEur: 7, paidOn: '2026-10-01' }, { amountEur: 7, paidOn: '2026-10-02' }, { amountEur: 27.99, paidOn: '2026-10-03' }]);
  assert.equal(cent.paid, true, 'one cent short still counts as paid');
  assert.equal(cent.paidOn, '2026-10-03');
  assert.equal(cent.openEur, 0, 'and nothing reads as open: paid and open never disagree');
  assert.equal(paymentTotals(42, [{ amountEur: 41.98, paidOn: '2026-10-01' }]).paid, false, 'two cents short does not');
  assert.deepEqual(paymentTotals(42, []), { paidEur: 0, openEur: 42, overpaidEur: 0, paid: false, paidOn: null });
  assert.deepEqual(paymentTotals(0.3, [{ amountEur: 0.1, paidOn: '2026-10-01' }, { amountEur: 0.2, paidOn: '2026-10-01' }]).openEur, 0, 'summed in cents');
});

test('too much is allowed and shown', () => {
  const over = paymentTotals(42, [{ amountEur: 50, paidOn: '2026-10-01' }]);
  assert.deepEqual([over.paid, over.openEur, over.overpaidEur, over.paidOn], [true, 0, 8, '2026-10-01']);
});

test('the payment an action wrote is the row that was not there before, wherever the date sorts it', () => {
  const first = { id: 1, paidOn: '2026-10-10', amountEur: 300 };
  const earlier = { id: 2, paidOn: '2026-09-30', amountEur: 150 };
  assert.deepEqual(newPaymentOf({ payments: [first] }, { payments: [earlier, first] }), earlier, 'dated before the first, listed first, still the new one');
  assert.deepEqual(newPaymentOf(null, { payments: [earlier, first] }), earlier, 'a new cost: the highest id');
  assert.equal(newPaymentOf({ payments: [first] }, { payments: [first] }), null);
  assert.equal(newPaymentOf({ payments: [] }, {}), null);
});

test('how much of the payments the bank holds, and the marker a line carries', () => {
  assert.equal(paymentsBanked([]), 'none');
  assert.equal(paymentsBanked([{ bankStatementLineId: null }, { bankStatementLineId: null }]), 'none');
  assert.equal(paymentsBanked([{ bankStatementLineId: 4 }, { bankStatementLineId: null }]), 'some');
  assert.equal(paymentsBanked([{ bankStatementLineId: 4 }, { bankStatementLineId: 9 }]), 'all');
  assert.equal(paymentMarker(7), 'kostbetaling #7');
});
