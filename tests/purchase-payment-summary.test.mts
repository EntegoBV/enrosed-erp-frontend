import assert from 'node:assert/strict';
import test from 'node:test';
import { purchaseSheetSummary } from '../src/app/features/purchasing/purchase-payment-summary.ts';

// The payment sheet's read-only line above the buttons (Inkoop redesign §2.5, 2026-10-17).
const plain = (text: string | null): string | null => text === null ? null : text.replace(/[  ]/g, ' ');
const base = { payeeLabel: 'Leverancier', termLabel: '1/3 bij bestelling', amountEur: null, share: null, bank: null } as const;

test('a euro payment: amount, payee, term and the transaction day', () => {
  assert.equal(plain(purchaseSheetSummary({ amount: 11421.38, currency: 'EUR' }, { ...base, bank: { day: '2026-10-16T09:12:00Z' } })),
    '€ 11.421,38 aan Leverancier · 1/3 bij bestelling · banktransactie 16/10/2026');
  assert.equal(plain(purchaseSheetSummary({ amount: 509, currency: 'EUR' }, { ...base, payeeLabel: 'Inspectie & andere kosten', termLabel: null })),
    '€ 509,00 aan Inspectie & andere kosten · nog geen banktransactie');
  assert.equal(plain(purchaseSheetSummary({ amount: 509, currency: 'EUR' }, { ...base, termLabel: null, bank: 'linked' })), '€ 509,00 aan Leverancier · op de bank');
});

test('a USD or CNY payment names its own currency and the euro when known (N20)', () => {
  assert.equal(plain(purchaseSheetSummary({ amount: 12500, currency: 'USD' }, { ...base, termLabel: null, amountEur: 11421.38 })),
    'US$ 12.500,00 aan Leverancier (≈ € 11.421,38) · nog geen banktransactie');
  assert.equal(plain(purchaseSheetSummary({ amount: 12500, currency: 'USD' }, { ...base, termLabel: null })),
    'US$ 12.500,00 aan Leverancier · nog geen banktransactie', 'without a known euro no estimate');
  assert.equal(plain(purchaseSheetSummary({ amount: 100, currency: 'EUR' }, { ...base, termLabel: null, amountEur: 120 })),
    '€ 100,00 aan Leverancier · nog geen banktransactie', 'a euro payment never adds an estimate');
});

test('a transaction shared over containers says how many', () => {
  assert.equal(plain(purchaseSheetSummary({ amount: 11421.38, currency: 'EUR' }, { ...base, share: { totalEur: 34264.14, containers: 3 }, bank: { day: '2026-10-16' } })),
    '€ 34.264,14 verdeeld over 3 containers · banktransactie 16/10/2026');
  assert.match(plain(purchaseSheetSummary({ amount: 10, currency: 'EUR' }, { ...base, share: { totalEur: 10, containers: 1 } }))!, /^€ 10,00 aan Leverancier/, 'one container is no share');
});

test('no amount, no line', () => {
  assert.equal(purchaseSheetSummary({ amount: null, currency: 'EUR' }, base), null);
  assert.equal(purchaseSheetSummary({ amount: 0, currency: 'EUR' }, base), null);
});
