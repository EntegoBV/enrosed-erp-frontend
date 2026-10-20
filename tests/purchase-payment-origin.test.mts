import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentOriginLabel, expectsBankLink, samePaymentOrigin } from '../src/app/features/purchasing/purchase-payment-origin.ts';

test('a company payment names the payer without claiming bank proof', () => {
  const origin = { source: 'OTHER_COMPANY' as const, payerName: 'Entego', note: 'oude bankrekening' };
  assert.equal(paymentOriginLabel(origin), 'Betaald door Entego · oude bankrekening');
  assert.equal(expectsBankLink({ origin }), false);
});
test('an old account is separate from an unspecified own-bank payment', () => {
  assert.equal(paymentOriginLabel({ source: 'OLD_BANK_ACCOUNT', payerName: null, note: null }), 'Betaald via oude bankrekening');
  assert.equal(expectsBankLink({ origin: { source: 'OLD_BANK_ACCOUNT', payerName: null, note: null } }), false);
  assert.equal(expectsBankLink({ origin: null }), true);
  assert.equal(expectsBankLink({}), true);
});

test('saved origins compare by their fields regardless of API property order', () => {
  const draft = { source: 'OTHER_COMPANY' as const, payerName: 'Entego', note: 'oude bankrekening' };
  const saved = { note: 'oude bankrekening', payerName: 'Entego', source: 'OTHER_COMPANY' as const };
  assert.equal(samePaymentOrigin(draft, saved), true);
  assert.equal(samePaymentOrigin(draft, { ...saved, payerName: 'Andere vennootschap' }), false);
  assert.equal(samePaymentOrigin(draft, { ...saved, note: null }), false);
  assert.equal(samePaymentOrigin(draft, { ...saved, source: 'OLD_BANK_ACCOUNT' }), false);
  assert.equal(samePaymentOrigin(null, undefined), true);
  assert.equal(samePaymentOrigin(draft, null), false);
});
