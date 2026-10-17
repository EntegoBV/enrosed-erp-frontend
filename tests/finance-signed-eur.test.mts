import assert from 'node:assert/strict';
import test from 'node:test';
import { signedEur } from '../src/app/features/finance/finance-format.ts';

const plain = (text: string): string => text.replace(/ /g, ' ');

test('signedEur signs bank amounts and leaves an exact zero unsigned, as the cockpit does', () => {
  assert.equal(plain(signedEur(18145.28)), '+ € 18.145,28');
  assert.equal(plain(signedEur(-0.01)), '− € 0,01');
  assert.equal(plain(signedEur(0)), '€ 0,00', 'an exact match reads "Verschil € 0,00 ✓", not "+ € 0,00"');
  assert.equal(plain(signedEur(-0)), '€ 0,00');
  assert.equal(plain(signedEur(0.004)), '€ 0,00', 'what rounds to no cent has no sign either');
  assert.equal(plain(signedEur(-0.004)), '€ 0,00', 'never "− € 0,00"');
  assert.equal(plain(signedEur(0.005)), '+ € 0,01');
});
