import assert from 'node:assert/strict';
import test from 'node:test';
import { bankTextOf } from '../src/app/features/finance/bank-text.ts';

/* The production shapes of 16 Oct 2026, with synthetic card holders and account numbers. */
const IKEA = 'IKEA HASSELT-STORE BE3500 HASSELT Betaling met Apple Pay via Debit Mastercard 06-10-2026 om 15.43 uur 5559 20XX XXXX 3069 JANSSENS JAN';

test('a card payment: the merchant as the title; wallet, day, time and town as the sub; card digits and holder dropped', () => {
  assert.deepEqual(bankTextOf({ counterparty: null, reference: IKEA }), { title: 'IKEA HASSELT-STORE', sub: 'Apple Pay · 6 okt 15.43 · Hasselt' });
  assert.deepEqual(bankTextOf({ reference: `Correctie ${IKEA.replace('15.43', '19.10')}` }),
    { title: 'IKEA HASSELT-STORE', sub: 'Correctie · Apple Pay · 6 okt 19.10 · Hasselt' });
  assert.deepEqual(bankTextOf({ reference: 'CCV*Koka House NL6711AW EDE GLD Betaling met Google Pay via Debit Mastercard 04-10-2026 om 18.43 uur 5559 20XX XXXX 3069 JANSSENS JAN' }),
    { title: 'Koka House', sub: 'Google Pay · 4 okt 18.43 · Ede' });
  assert.deepEqual(bankTextOf({ reference: 'AIRBNB * HMBZMHHF54 LUL2540 LUXEMBOURG Betaling met Google Pay via Debit Mastercard 01-10-2026 om 00.00 uur 5559 20XX XXXX 3069 JANSSENS JAN' }),
    { title: 'AIRBNB', sub: 'Google Pay · 1 okt · Luxembourg' });
  const sub = bankTextOf({ reference: IKEA }).sub;
  assert.ok(!/JANSSENS|3069|XXXX/.test(sub), 'never the card or its holder');
});

test('a transfer: the counterparty as the title; the reference without its copy, IBAN, BIC, clock and channel as the sub', () => {
  assert.deepEqual(bankTextOf({ counterparty: 'Bloemenhandel Frans Verhoeven B.V.',
    reference: 'BLOEMENHANDEL FRANS VERHOEVEN B.V. Overschrijving NL16 RABO 0326 5687 94 BIC: RABONL2U CONTAINER/2026/009' }),
  { title: 'Bloemenhandel Frans Verhoeven B.V.', sub: 'CONTAINER/2026/009' });
  assert.deepEqual(bankTextOf({ counterparty: 'Yunnan Pubei Agricultural Science A',
    reference: 'YUNNAN PUBEI AGRICULTURAL SCIENCE A Instantoverschrijving LU16 0670 0000 1234 5678 BIC: CHASLULXXXX PI 20260907 glass New 0.7 BALANCE PAYMENT FOR PRESERVED FLOWERS 32162.4 dollar 09.59 uur KBC Mobile' }),
  { title: 'Yunnan Pubei Agricultural Science A', sub: 'PI 20260907 glass New 0.7 BALANCE PAYMENT FOR PRESERVED FLOWERS 32162.4 dollar' });
  assert.deepEqual(bankTextOf({ counterparty: 'Ggm Moebel International Gmb H',
    reference: 'GGM MOEBEL INTERNATIONAL GMBH Europese overschrijving DE03 4016 0050 0012 3456 78 BIC: GENODEM1GRN D287636 15.11 uur' }),
  { title: 'Ggm Moebel International GmbH', sub: 'D287636' });
});

test('nothing known reads "Banktransactie"; the sub never repeats the title', () => {
  assert.deepEqual(bankTextOf({}), { title: 'Banktransactie', sub: '' });
  assert.deepEqual(bankTextOf({ counterparty: '  ', reference: null }), { title: 'Banktransactie', sub: '' });
  assert.deepEqual(bankTextOf({ counterparty: 'Railway', reference: 'RAILWAY' }), { title: 'Railway', sub: '' });
  assert.deepEqual(bankTextOf({ counterparty: 'Linc & Partners', reference: 'Domiciliëring Linc & Partners factuur 2026-118' }),
    { title: 'Linc & Partners', sub: 'Linc & Partners factuur 2026-118' });
});

test('without a counterparty the reference up to the first IBAN or "Betaling" names the line', () => {
  assert.deepEqual(bankTextOf({ reference: 'Kosten beheer rekening BE68 5390 0754 7034 periode 3' }), { title: 'Kosten beheer rekening', sub: 'periode 3' });
  assert.deepEqual(bankTextOf({ reference: 'Rente' }), { title: 'Rente', sub: '' });
});
