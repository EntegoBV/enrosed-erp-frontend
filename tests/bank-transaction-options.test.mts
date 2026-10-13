import assert from 'node:assert/strict';
import test from 'node:test';
import { bankAmountsMatch, bankAmountDifference, bankTransactionAllocated, bankTransactionDay, bankTransactionOptions } from '../src/app/shared/bank-transaction-options.ts';
import type { BankStatementLine } from '../src/app/core/api/banking-api.ts';
const row = (id: number, amountEur: number, extra = {}): BankStatementLine => ({ id, amountEur, account: 'BE12 1234 5678', bookedAt: '2026-10-01T22:15:00Z', timeZone: 'Europe/Brussels', reference: 'Factuur 42', counterparty: 'Enrosed klant', ...extra } as BankStatementLine);

test('picker separates incoming and outgoing, sorts available exact amounts first and retains allocated context', () => {
  const rows = [row(1, 20), row(2, -20), row(3, 30), row(4, 20, { allocated: true }), row(5, 20, { salesPaymentId: 90 })];
  assert.deepEqual(bankTransactionOptions(rows, 'INCOMING', '', 20).map(r => r.id), [1, 3, 5, 4]);
  assert.deepEqual(bankTransactionOptions(rows, 'OUTGOING').map(r => r.id), [2]);
  assert.deepEqual(bankTransactionOptions(rows, 'INCOMING', '', 20, true).map(r => r.id), [1, 5, 4]);
  assert.equal(bankTransactionAllocated(rows[4]), true); assert.equal(bankTransactionAllocated(rows[0]), false);
});

test('search combines reference, localized amount, account, counterparty, source and booked local day', () => {
  const rows = [row(1, -1234.56, { source: 'ODOO' }), row(2, -100)];
  assert.equal(bankTransactionDay(rows[0]), '2026-10-02');
  for (const query of ['factuur 42', '1.234,56', 'BE12 klant', 'odoo 02/10/2026', '2026-10-02']) {
    assert.ok(bankTransactionOptions(rows, 'OUTGOING', query).some(r => r.id === 1), query);
  }
  assert.deepEqual(bankTransactionOptions(rows, 'OUTGOING', 'onbekend'), []);
  assert.deepEqual(bankTransactionOptions(rows, 'OUTGOING', 'handmatig').map(r => r.id), [2]);
});


test('matching permits two cents in either direction, rejects three cents, zero, opposite signs and non-finite values', () => {
  for (const sign of [-1, 1]) for (const cents of [-3, -2, -1, 0, 1, 2, 3]) {
    const bank = sign * (10000 + cents) / 100;
    assert.equal(bankAmountsMatch(bank, sign * 100), Math.abs(cents) <= 2, `${bank}`);
    assert.equal(bankAmountDifference(bank, sign * 100), (sign * cents / 100) || 0);
  }
  for (const [bank, recorded] of [[0, 0], [0.01, -0.01], [NaN, 10], [Infinity, Infinity]]) assert.equal(bankAmountsMatch(bank, recorded), false);
  const rows = [-100.03, -100.02, -100, -99.98, -99.97].map((amount, i) => row(i, amount));
  assert.deepEqual(bankTransactionOptions(rows, 'OUTGOING', '', 100, true).map(r => r.amountEur), [-100, -99.98, -100.02]);
});
