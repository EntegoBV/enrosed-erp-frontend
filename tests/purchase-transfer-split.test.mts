import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceDocument, splitTransfer } from '../src/app/features/purchasing/purchase-transfer-split.ts';

const rate = (amount: number, currency: string) => currency === 'USD' ? amount * 0.9 : currency === 'CNY' ? amount * 0.125 : amount;
const goods = { amount: 1000, currency: 'EUR' as const, paidOn: '2026-10-12', label: 'Saldo', payee: 'SUPPLIER' as const, settles: true, instalmentDue: 'ARRIVED' as const };

test('a euro transfer for the goods alone is one write, as before', () => {
  const { writes, bankEur } = splitTransfer(goods, rate);
  assert.deepEqual(writes, [{ paidOn: '2026-10-12', amount: 1000, currency: 'EUR', label: 'Saldo', payee: 'SUPPLIER', settles: true, instalmentDue: 'ARRIVED' }]);
  assert.equal(bankEur, 1000);
  assert.equal('amountEur' in writes[0], false, 'a euro payment never carries a bank euro');
  assert.equal(splitTransfer({ ...goods, freightAmount: null, separateAmount: 0 }, rate).writes.length, 1, 'empty parts add nothing');
});

test('freight and inspection become their own payments on their own streams, tied to one bank total', () => {
  const { writes, bankEur } = splitTransfer({ ...goods, freightAmount: 1850.5, separateAmount: 300 }, rate);
  assert.deepEqual(writes.map((write) => [write.payee, write.instalmentDue, write.amount, write.label, write.settles]), [
    ['SUPPLIER', 'ARRIVED', 1000, 'Saldo', true],
    ['SUPPLIER', 'FREIGHT', 1850.5, 'Saldo · zeevracht (CIF)', false],
    ['SEPARATE', null, 300, 'Saldo · inspectie', false],
  ]);
  assert.equal(bankEur, 3150.5);
  assert.equal(splitTransfer({ ...goods, label: '', freightAmount: 10 }, rate).writes[1].label, 'Betaling · zeevracht (CIF)');
});

test('a typed bank euro of a USD transfer is split by share in cents, the remainder on the goods', () => {
  const { writes, bankEur } = splitTransfer({ ...goods, currency: 'USD', amount: 1000, freightAmount: 333.33, separateAmount: 100, amountEur: 1234.56 }, rate);
  assert.equal(bankEur, 1234.56);
  assert.deepEqual(writes.map((write) => write.amountEur), [861.33, 287.1, 86.13], '28710.48 and 8613.23 cents round down; the goods take the rest');
  assert.equal(Math.round((861.33 + 287.1 + 86.13) * 100), 123456, 'the parts close on the typed debit');
  const atRate = splitTransfer({ ...goods, currency: 'USD', amount: 1000, freightAmount: 100 }, rate);
  assert.deepEqual(atRate.writes.map((write) => 'amountEur' in write), [false, false], 'without a typed euro the server applies the order rate');
  assert.equal(atRate.bankEur, 990);
});

test('parts only count for a supplier transfer', () => {
  const { writes, bankEur } = splitTransfer({ ...goods, payee: 'LOGISTICS', instalmentDue: null, freightAmount: 500, separateAmount: 20 }, rate);
  assert.equal(writes.length, 1);
  assert.equal(bankEur, 1000);
});

test('the invoice is filed by payee', () => {
  assert.deepEqual(invoiceDocument('SUPPLIER'), { kind: 'COMMERCIAL_INVOICE', label: null });
  assert.deepEqual(invoiceDocument('LOGISTICS'), { kind: 'OTHER', label: 'Factuur transport' });
  assert.deepEqual(invoiceDocument('SEPARATE'), { kind: 'OTHER', label: 'Factuur inspectie' });
  assert.deepEqual(invoiceDocument('OTHER'), { kind: 'OTHER', label: 'Factuur' });
});
