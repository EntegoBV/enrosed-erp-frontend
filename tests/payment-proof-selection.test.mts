import test from 'node:test';
import assert from 'node:assert/strict';
import { appendPaymentProofs, MAX_PROOF_BYTES, proofFileKey } from '../src/app/shared/payment-proof-selection.ts';

const file = (name: string, size = 1024, lastModified = 10) => ({ name, size, lastModified, type: 'application/pdf' });

test('separate picker selections and a multi-file drop append without replacing earlier proofs', () => {
  const first = file('betaling.pdf');
  const initial = appendPaymentProofs([], [first]);
  const result = appendPaymentProofs(initial.files, [file('afschrift.JPG'), file('bewijs.png')]);
  assert.deepEqual(result.files.map(f => f.name), ['betaling.pdf', 'afschrift.JPG', 'bewijs.png']);
  assert.equal(result.files[0], first);
  assert.deepEqual(result.errors, []);
});

test('duplicate reselections do not consume slots while different versions remain selectable', () => {
  const first = file('bewijs.pdf');
  const result = appendPaymentProofs([first], [file('bewijs.pdf'), file('bewijs.pdf', 2048), file('bewijs.pdf', 1024, 11)]);
  assert.equal(result.files.length, 3);
  assert.equal(new Set(result.files.map(proofFileKey)).size, 3);
});

test('a full queue preserves its files and reports overflow instead of silently replacing files', () => {
  const current = Array.from({ length: 4 }, (_, index) => file(`${index}.pdf`));
  const result = appendPaymentProofs(current, [file('4.pdf'), file('5.pdf'), file('6.pdf')]);
  assert.equal(result.files.length, 5);
  assert.deepEqual(result.files.slice(0, 4), current);
  assert.match(result.errors[0], /2 bestanden zijn niet toegevoegd/);
  assert.equal(current.length, 4);
});

test('invalid and oversized files do not displace valid proofs or consume the selection limit', () => {
  const result = appendPaymentProofs([], [file('script.exe'), file('empty.pdf', 0), file('big.pdf', MAX_PROOF_BYTES + 1), file('valid.pdf', MAX_PROOF_BYTES)]);
  assert.deepEqual(result.files.map(f => f.name), ['valid.pdf']);
  assert.equal(result.errors.length, 3);
});

test('removing one proof frees a slot for a replacement while keeping the other selections', () => {
  const current = Array.from({ length: 5 }, (_, index) => file(`${index}.pdf`));
  const result = appendPaymentProofs(current.filter((_, i) => i !== 2), [file('nieuw.pdf')]);
  assert.deepEqual(result.files.map(f => f.name), ['0.pdf', '1.pdf', '3.pdf', '4.pdf', 'nieuw.pdf']);
  assert.deepEqual(result.errors, []);
});

test('saved proofs consume capacity and a payment with five proofs accepts no further files', () => {
  const none = appendPaymentProofs([], [file('zesde.pdf')], 0);
  assert.deepEqual(none.files, []);
  assert.match(none.errors[0], /maximale aantal betaalbewijzen/);
  const remaining = appendPaymentProofs([], [file('vierde.pdf'), file('vijfde.pdf'), file('zesde.pdf')], 2);
  assert.deepEqual(remaining.files.map(f => f.name), ['vierde.pdf', 'vijfde.pdf']);
  assert.match(remaining.errors[0], /1 bestand is niet toegevoegd/);
});
