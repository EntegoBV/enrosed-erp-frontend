import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentOriginLabel, expectsBankLink } from '../src/app/features/purchasing/purchase-payment-origin.ts';

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
