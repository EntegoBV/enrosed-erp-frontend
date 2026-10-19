import assert from 'node:assert/strict';
import test from 'node:test';
import { KEEP_ONLY_EQUAL, changePreview, followNotice } from '../src/app/features/finance/bank-change-preview.ts';
import type { LinkTarget } from '../src/app/features/finance/bank-change-preview.ts';

// Intl writes a no-break space between € and the amount; the assertions read plain spaces.
const plain = (text: string | null): string | null => text === null ? null : text.replace(/[  ]/g, ' ');
const rows = (preview: ReturnType<typeof changePreview>) => preview.rows.map((row) => [row.label, plain(row.now), plain(row.after), row.changed]);

// Bank-B's example: the second term of PO-2026-031 booked at € 12.480,00 (US$ 14.560,00) on 13 okt; KBC took − € 12.512,40 on 14 okt.
const purchase: LinkTarget = { kind: 'purchase-existing', orderId: 31, paymentId: 77, title: 'Inkoop · PO-2026-031 · 2e termijn', amountEur: 12480, paidOn: '2026-10-13',
  currency: 'USD', amount: 14560, account: null, proofCount: 0, hasInspectionAfspraak: true, groupSize: 1 };
const line = { amountEur: -12512.40, day: '2026-10-14', accountLabel: 'KBC-zichtrekening' };

test('Bank-B example: a larger transaction on a USD purchase payment follows the bank by default', () => {
  const preview = changePreview(purchase, line, true, 'BANKKOSTEN');
  assert.equal(preview.mode, 'higher');
  assert.equal(preview.differenceEur, 32.4);
  assert.deepEqual(rows(preview), [
    ['Bedrag', '€ 12.480,00', '€ 12.512,40', true],
    ['Betaald op', '13 okt', '14 okt', true],
    ['Rekening', 'geen', 'KBC-zichtrekening', true],
    ['In USD', '$ 14.560,00', '$ 14.560,00', false],
    // foreign ÷ EUR with four decimals: 14.560 / 12.480 = 1,16667 and 14.560 / 12.512,40 = 1,163645.
    ['Koers', '1,1667', '1,1636', true],
    ['Bewijs', 'geen', 'deze transactie', true],
  ]);
  assert.equal(preview.keepAllowed, true);
  assert.equal(preview.restText, null);
  assert.equal(preview.blockedText, null);
  assert.equal(preview.primaryLabel, 'Koppelen en aanpassen');
  assert.equal(plain(preview.followText), 'Bedrag, dag en rekening komen van de transactie. De nacalculatie rekent met € 12.512,40.');
  assert.equal(plain(preview.notice),
    'Gekoppeld aan Inkoop · PO-2026-031 · 2e termijn. Bedrag en datum gevolgd van de transactie: € 12.512,40 op 14/10/2026 (was € 12.480,00 op 13/10/2026).');
});

test('follow off on a larger purchase payment keeps the payment and books the difference', () => {
  const preview = changePreview(purchase, line, false, 'KOERSVERSCHIL');
  assert.equal(preview.primaryLabel, 'Koppelen en verschil boeken');
  assert.deepEqual(rows(preview).slice(0, 2), [['Bedrag', '€ 12.480,00', '€ 12.480,00', false], ['Betaald op', '13 okt', '13 okt', false]]);
  assert.equal(plain(preview.notice), 'Gekoppeld aan Inkoop · PO-2026-031 · 2e termijn. Verschil € 32,40 geboekt als Koersverschil.');
  assert.equal(plain(changePreview(purchase, line, false, 'BANKKOSTEN').notice)?.endsWith('Verschil € 32,40 geboekt als Bankkosten.'), true);
});

test('the rest as inspection keeps the payment amount and takes the bank day', () => {
  const preview = changePreview({ ...purchase, currency: 'EUR', amount: 12480 }, line, true, 'BANKKOSTEN', 'INSPECTION');
  assert.deepEqual(rows(preview).slice(0, 2), [['Bedrag', '€ 12.480,00', '€ 12.480,00', false], ['Betaald op', '13 okt', '14 okt', true]]);
  assert.equal(plain(preview.notice), 'Gekoppeld aan Inkoop · PO-2026-031 · 2e termijn. Datum gevolgd van de transactie: 14/10/2026 (was 13/10/2026).');
});

test('a smaller transaction carves the line out of a purchase payment; follow cannot be switched off', () => {
  const smaller = { ...line, amountEur: -5000 };
  for (const follow of [true, false]) {
    const preview = changePreview({ ...purchase, currency: 'EUR', amount: 12480 }, smaller, follow, 'BANKKOSTEN');
    assert.equal(preview.mode, 'lower');
    assert.equal(plain(preview.restText), 'Rest € 7.480,00 blijft open als tweede transactie.');
    assert.equal(plain(preview.rows[0].after), '€ 5.000,00');
    assert.equal(preview.blockedText, null);
    assert.equal(preview.keepAllowed, false);
    assert.equal(preview.primaryLabel, 'Koppelen en aanpassen');
  }
});

test('a smaller transaction on a USD purchase payment is the whole payment: its euro follows, nothing stays open', () => {
  const preview = changePreview(purchase, { ...line, amountEur: -12400 }, true, 'BANKKOSTEN');
  assert.equal(preview.mode, 'lower');
  assert.equal(preview.restText, null);
  assert.deepEqual(rows(preview).slice(0, 1), [['Bedrag', '€ 12.480,00', '€ 12.400,00', true]]);
  assert.deepEqual(rows(preview).slice(3, 5), [['In USD', '$ 14.560,00', '$ 14.560,00', false], ['Koers', '1,1667', '1,1742', true]]);
  assert.equal(preview.primaryLabel, 'Koppelen en aanpassen');
});

test('an equal cost payment whose day differs: only the date changes, still "Koppelen en aanpassen"', () => {
  const cost: LinkTarget = { kind: 'cost-existing', costId: 11, costPaymentId: 5, title: 'Kost · Boekhouder Q3', amountEur: 665.5, paidOn: '2026-10-08', account: 'KBC-zichtrekening', proofCount: 2 };
  const preview = changePreview(cost, { amountEur: -665.51, day: '2026-10-09', accountLabel: 'KBC-zichtrekening' }, true, 'BANKKOSTEN');
  assert.equal(preview.mode, 'equal');
  assert.deepEqual(rows(preview), [
    ['Bedrag', '€ 665,50', '€ 665,51', true], ['Betaald op', '8 okt', '9 okt', true], ['Rekening', 'KBC-zichtrekening', 'KBC-zichtrekening', false],
    ['Bewijs', '2 bestanden', 'deze transactie', true],
  ]);
  assert.equal(preview.primaryLabel, 'Koppelen en aanpassen');
  assert.equal(plain(preview.followText), 'Bedrag, dag en rekening komen van de transactie. De kost rekent met € 665,51.');
  const same = changePreview({ ...cost, paidOn: '2026-10-09', amountEur: 665.51 }, { amountEur: -665.51, day: '2026-10-09', accountLabel: 'KBC-zichtrekening' }, true, 'BANKKOSTEN');
  assert.equal(same.primaryLabel, 'Koppelen');
  assert.equal(same.notice, 'Gekoppeld aan Kost · Boekhouder Q3.');
  const off = changePreview(cost, { amountEur: -700, day: '2026-10-09', accountLabel: 'KBC-zichtrekening' }, false, 'BANKKOSTEN');
  assert.equal(off.blockedText, KEEP_ONLY_EQUAL);
  assert.equal(off.keepAllowed, false);
});

test('a sales receipt uses "Ontvangen op" and has no proof row', () => {
  const receipt: LinkTarget = { kind: 'sales-existing', salesOrderId: 420, paymentId: 9, title: 'Factuur F2026-0420', amountEur: 4235, receivedOn: '2026-10-20', account: null };
  const preview = changePreview(receipt, { amountEur: 4235, day: '2026-10-21', accountLabel: 'KBC-zichtrekening' }, true, 'BANKKOSTEN');
  assert.deepEqual(rows(preview), [['Bedrag', '€ 4.235,00', '€ 4.235,00', false], ['Ontvangen op', '20 okt', '21 okt', true], ['Rekening', 'geen', 'KBC-zichtrekening', true]]);
  assert.equal(plain(preview.followText), 'Bedrag, dag en rekening komen van de transactie. De factuur rekent met € 4.235,00.');
});

test('new payments read "—" now and take the open amount when the line matches it, else the line', () => {
  const cost = changePreview({ kind: 'cost-new', costId: 12, title: 'Kost · Brochures beurs', openEur: 423.5 }, { amountEur: -423.51, day: '2026-10-13', accountLabel: 'KBC-zichtrekening' }, true, 'BANKKOSTEN');
  assert.deepEqual(rows(cost), [['Bedrag', '—', '€ 423,50', true], ['Betaald op', '—', '13 okt', true], ['Rekening', '—', 'KBC-zichtrekening', true], ['Bewijs', '—', 'deze transactie', true]]);
  assert.equal(cost.primaryLabel, 'Koppelen');
  assert.equal(cost.notice, 'Gekoppeld aan Kost · Brochures beurs.');
  const sales = changePreview({ kind: 'sales-new', salesOrderId: 405, title: 'Factuur F2026-0405', openEur: 1906 }, { amountEur: 1000, day: '2026-10-13', accountLabel: 'KBC' }, true, 'BANKKOSTEN');
  assert.deepEqual(rows(sales)[0], ['Bedrag', '—', '€ 1.000,00', true]);
  assert.equal(rows(sales)[1][0], 'Ontvangen op');
  assert.equal(sales.mode, 'lower');
});

test('round 2\'s notice wording, copied: amount and date, amount only, date only, nothing', () => {
  assert.equal(plain(followNotice({ amountEur: 10250, paidOn: '2026-01-03' }, { amountEur: 10300, paidOn: '2026-01-05' })),
    'Bedrag en datum gevolgd van de transactie: € 10.300,00 op 05/01/2026 (was € 10.250,00 op 03/01/2026).');
  assert.equal(plain(followNotice({ amountEur: 10250, paidOn: '2026-01-03' }, { amountEur: 10300, paidOn: '2026-01-03' })), 'Bedrag gevolgd van de transactie: € 10.300,00 (was € 10.250,00).');
  assert.equal(followNotice({ amountEur: 10250, paidOn: '2026-01-03' }, { amountEur: 10250, paidOn: '2026-01-05' }), 'Datum gevolgd van de transactie: 05/01/2026 (was 03/01/2026).');
  assert.equal(followNotice({ amountEur: 1, paidOn: '2026-01-03' }, { amountEur: 1, paidOn: '2026-01-03' }), null);
});

test('a new container term keeps the fee and the inspection booked beside it off its Bedrag', () => {
  // Review 2026-10-20: 'Wat verandert' said € 3.525,00 while the term got € 3.500,00 and Transactiekosten € 25,00.
  const term = { kind: 'term-new', orderId: 5, title: 'PO-2026-005 · 70% bij verzending',
    payable: { key: 'container:5:SUPPLIER:SHIPPED', payee: 'SUPPLIER', remainingEur: 7000, plannedEur: 7000, paidEur: 0 } } as unknown as LinkTarget;
  const debit = { amountEur: -3525, day: '2026-10-14', accountLabel: 'KBC' };
  assert.deepEqual(rows(changePreview(term, debit, true, 'TRANSACTIEKOSTEN', 'ADJUST', 25)).filter(([label]) => label === 'Bedrag' || label === 'Transactiekosten'),
    [['Bedrag', '—', '€ 3.500,00', true], ['Transactiekosten', '—', '€ 25,00 op dezelfde transactie', true]]);
  assert.deepEqual(rows(changePreview(term, debit, true, 'TRANSACTIEKOSTEN', 'ADJUST', 25, 300)).slice(0, 1), [['Bedrag', '—', '€ 3.200,00', true]]);
  assert.equal(rows(changePreview(term, debit, true, 'TRANSACTIEKOSTEN', 'ADJUST', 25, 300)).some(([label]) => label === 'Inspectie via leverancier'), true);
  assert.deepEqual(rows(changePreview(term, debit, true, 'TRANSACTIEKOSTEN', 'ADJUST', 3525)).slice(0, 1), [['Bedrag', '—', '€ 3.525,00', true]], 'never the whole line');
  assert.deepEqual(rows(changePreview(term, debit, true, 'TRANSACTIEKOSTEN')).map(([label]) => label), ['Bedrag', 'Betaald op', 'Rekening', 'Bewijs'], 'no fee: as before');
});
