import assert from 'node:assert/strict';
import test from 'node:test';
import type { LedgerTerm, PayeeLedger, PayeeStatusKind } from '../src/app/features/purchasing/purchase-payment-ledger.ts';
import type { NacalcBridgeRow, NacalcPayeeRow, NacalcProductRow, NacalcTermRow } from '../src/app/features/purchasing/purchase-nacalc-metrics.ts';
import { differenceWord } from '../src/app/features/purchasing/purchase-payment-ledger.ts';
import {
  afspraakBridge, differenceByPayee, fileWords, landedChain, nacalcChain, nacalcGrossLine, payeeFigures, payeeWord, paymentLine, pctText, planTrail,
  productRows, productSheetRows, proofMark, settledMeter, sheetLead, storySub, termWord, verschilText,
} from '../src/app/features/purchasing/purchase-phone-money.ts';

/*
 * The phone's money words (2026-10-25, PO-2026-005 "Jerry - 1e Mixed Container"): Emre read
 * "− Minder betaald · afgerekend 6.220,56 + Meer betaald 2.949,22" and asked what was paid less
 * and more. The phone now says one Verschil, "€ 3.271,34 minder", and where it comes from.
 */
const plain = (value: string | null | undefined): string => (value ?? '').replace(/[\u00a0\u202f]/g, ' ');

/* ---- PO-2026-005 -------------------------------------------------------- */

const SUPPLIER = { payee: 'SUPPLIER', label: 'Leverancier', agreedEur: 52021.07, paidEur: 50723.9, openEur: 0, differenceEur: -1297.17, reviewEur: 0, fxEur: 0 } as const;
const LOGISTICS = { payee: 'LOGISTICS', label: 'Douane & transport', agreedEur: 13233.5, paidEur: 11259.33, openEur: 0, differenceEur: -1974.17, reviewEur: 0, fxEur: 0 } as const;
const settledTerm = (due: LedgerTerm['due'], label: string, fullEur: number, paidEur: number): LedgerTerm => ({
  due, label, moment: '', fullEur, paidEur, openEur: 0, lowerEur: Math.max(0, fullEur - paidEur), higherEur: Math.max(0, paidEur - fullEur),
  differenceEur: Math.round((paidEur - fullEur) * 100) / 100, offsetEur: 0, fxEur: 0, offsetWith: [], settled: true, finalized: true, state: 'paid',
  hasScopedPayment: true, paymentIds: [], canSettle: false, canConfirm: false, canUndo: true, status: { label: 'x', tone: 'ok' }, statusNote: null, statusSplit: null,
});
const TERMS: LedgerTerm[] = [
  settledTerm('ORDERED', '1/3 bij bestelling', 17340.34, 15217.17),
  settledTerm('SHIPPED', '1/3 bij vertrek', 17340.34, 20289.56),
  settledTerm('ARRIVED', '1/3 bij aankomst', 17340.39, 15217.17),
];

test('the card says one Verschil and the two payees it comes from (PO-2026-005)', () => {
  const summary = { differenceEur: 2949.22 - 6220.56, fxEur: 0, reviewEur: 0 };
  assert.deepEqual({ ...verschilText(summary), text: plain(verschilText(summary).text) }, { text: '€ 3.271,34 minder', tone: 'in' });
  assert.deepEqual(differenceByPayee([LOGISTICS, SUPPLIER, { payee: 'OTHER', label: 'Bijkomende kosten', differenceEur: 12, reviewEur: 0, fxEur: 0 }])
    .map(line => [line.payee, line.label, plain(line.text), line.tone]), [
    ['SUPPLIER', 'Leverancier', '€ 1.297,17 minder', 'in'],
    ['LOGISTICS', 'Douane & transport', '€ 1.974,17 minder', 'in'],
  ], 'in the ledger order, agreement payees only');
  assert.deepEqual(differenceByPayee([{ ...SUPPLIER, differenceEur: 0 }]), [], 'no line without a difference');
  // A payee still to review says so, in the warn tone.
  assert.deepEqual(differenceByPayee([{ ...SUPPLIER, differenceEur: 250, reviewEur: 250 }]).map(line => [plain(line.text), line.tone]), [['€ 250,00 meer · nakijken', 'warn']]);
});

test('verschilText writes what differenceWord says, beside the amount, never a sign', () => {
  const cases = [
    { differenceEur: -3271.34, fxEur: 0 }, { differenceEur: 2949.22, fxEur: 0 }, { differenceEur: 44.8, fxEur: 44.8 }, { differenceEur: 120, fxEur: 44.8 },
    { differenceEur: 250, fxEur: 0, reviewEur: 250 }, { differenceEur: -0.01, fxEur: 0 }, { differenceEur: 0.01, fxEur: 0.01 }, { differenceEur: -500, fxEur: 20 },
    { differenceEur: 1_234_567.891, fxEur: 0 }, { differenceEur: 60.78, fxEur: 0, reviewEur: 10 },
  ];
  const euro = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
  for (const item of cases) {
    const result = verschilText(item);
    assert.equal(result.text, `${euro.format(Math.abs(Math.round(item.differenceEur * 100) / 100))} ${differenceWord(item)}`, JSON.stringify(item));
    assert.doesNotMatch(result.text, /^[−+-]/);
  }
  assert.deepEqual(verschilText({ differenceEur: 0, fxEur: 0 }), { text: 'geen verschil', tone: 'none' });
  assert.deepEqual(verschilText({ differenceEur: 0.004, fxEur: 0 }), { text: 'geen verschil', tone: 'none' }, 'cents decide');
  // Tones: minder green, a settled meer neutral, meer still to review warn, the bank's koersverschil neutral.
  assert.equal(verschilText({ differenceEur: 2949.22, fxEur: 0 }).tone, 'none');
  assert.equal(verschilText({ differenceEur: 250, fxEur: 0, reviewEur: 250 }).tone, 'warn');
  assert.equal(plain(verschilText({ differenceEur: 44.8, fxEur: 44.8 }).text), '€ 44,80 koersverschil (bank)');
  assert.equal(verschilText({ differenceEur: 44.8, fxEur: 44.8 }).tone, 'none');
  assert.equal(pctText(-5.01, -3271.34), '5,0 %');
  assert.equal(pctText(null, -3271.34), '');
  assert.equal(pctText(0, 0), '');
});

test('one status word per payee kind; the amount moves into the Verschil', () => {
  const words: Record<PayeeStatusKind, string> = {
    NONE: 'Geen afspraak', ADDITIONAL: 'Bijkomend', INCOMPLETE: 'Onvolledig', UNBUDGETED: 'Nakijken', OVERPAID: 'Nakijken', FX: 'Koersverschil',
    SETTLED_HIGHER: 'Afgerekend', SETTLED_LOWER: 'Afgerekend', PAID: 'Betaald', PLANNED: 'Gepland', DUE: 'Nu te betalen', LATER: 'Later',
    SMALL_DIFFERENCE: 'Klein verschil', PARTIAL: 'Deels betaald',
  };
  for (const [kind, word] of Object.entries(words)) {
    assert.deepEqual(payeeWord({ kind: kind as PayeeStatusKind, tone: 'warn' }), { word, tone: 'warn' }, kind);
    assert.ok(!word.includes('·') && word.split(' ').length <= 3, word);
  }
});

test('one word per supplier term, from its fields', () => {
  for (const term of TERMS) assert.equal(termWord(term, false).word, 'Afgerekend', term.label);
  assert.deepEqual(termWord(TERMS[0], false), { word: 'Afgerekend', tone: 'ok' });
  assert.deepEqual(termWord(TERMS[1], false), { word: 'Afgerekend', tone: 'neutral' }, 'a settled meer is neutral');
  const base = { state: 'paid', settled: false, finalized: false, lowerEur: 0, higherEur: 0, fxEur: 0, offsetEur: 0, openEur: 0, paidEur: 100 } as const;
  assert.deepEqual(termWord({ ...base, higherEur: 30 }, false), { word: 'Nakijken', tone: 'warn' }, 'overpaid, not finalized');
  assert.deepEqual(termWord({ ...base, higherEur: 30, fxEur: 30 }, false), { word: 'Koersverschil', tone: 'neutral' });
  assert.deepEqual(termWord({ ...base, offsetEur: 60.78 }, false), { word: 'Verrekend', tone: 'ok' }, 'netted');
  assert.deepEqual(termWord({ ...base, offsetEur: -60.78 }, false), { word: 'Verrekend', tone: 'ok' });
  assert.deepEqual(termWord({ ...base, offsetEur: -60.78, higherEur: 20 }, false), { word: 'Nakijken', tone: 'warn' });
  assert.deepEqual(termWord({ ...base, state: 'due', paidEur: 0, openEur: 500 }, false), { word: 'Nu te betalen', tone: 'warn' }, 'due');
  assert.deepEqual(termWord({ ...base, state: 'due', paidEur: 200, openEur: 300 }, false), { word: 'Deels betaald', tone: 'warn' });
  assert.deepEqual(termWord({ ...base, state: 'later', paidEur: 0, openEur: 500 }, false), { word: 'Later', tone: 'neutral' });
  assert.deepEqual(termWord({ ...base, settled: true }, false), { word: 'Betaald', tone: 'ok' });
  assert.deepEqual(termWord(TERMS[0], true), { word: 'Gepland', tone: 'neutral' });
});

test('a payee\'s second line on Betalingen: figures, no repeat of the status', () => {
  assert.equal(plain(payeeFigures(SUPPLIER)), '€ 50.723,90 van € 52.021,07 betaald', 'paid differs from the Afspraak, nothing open');
  assert.equal(plain(payeeFigures({ payee: 'LOGISTICS', agreedEur: 13233.5, paidEur: 13233.5, openEur: 0 })), '€ 13.233,50 betaald');
  assert.equal(plain(payeeFigures({ payee: 'SUPPLIER', agreedEur: 52021.07, paidEur: 15217.17, openEur: 36803.9 })), '€ 36.803,90 open van € 52.021,07');
  assert.equal(plain(payeeFigures({ payee: 'SUPPLIER', agreedEur: 52021.07, paidEur: 0, openEur: 52021.07 })), '€ 52.021,07 open');
  assert.equal(plain(payeeFigures({ payee: 'OTHER', agreedEur: null, paidEur: 42.5, openEur: 0 })), '€ 42,50 betaald · zonder afspraak');
  assert.equal(plain(payeeFigures({ payee: 'SEPARATE', agreedEur: 0, paidEur: 300, openEur: 0 })), '€ 300,00 betaald · zonder afspraak');
  assert.equal(payeeFigures({ payee: 'SEPARATE', agreedEur: 0, paidEur: 0, openEur: 0 }), 'Nog niets betaald');
});

test('the meter counts a settled difference as done', () => {
  assert.deepEqual(settledMeter({ paidOnAgreementEur: 61983.23, openEur: 0, dueNowEur: 0, laterEur: 0 }), { paidPct: 100, duePct: 0, laterPct: 0 });
  assert.deepEqual(settledMeter({ paidOnAgreementEur: 400, openEur: 600, dueNowEur: 600, laterEur: 0 }), { paidPct: 40, duePct: 60, laterPct: 0 });
  assert.deepEqual(settledMeter({ paidOnAgreementEur: 250, openEur: 750, dueNowEur: 250, laterEur: 500 }), { paidPct: 25, duePct: 25, laterPct: 50 });
  assert.deepEqual(settledMeter({ paidOnAgreementEur: 0, openEur: 0, dueNowEur: 0, laterEur: 0 }), { paidPct: 0, duePct: 0, laterPct: 0 });
});

test('Hoe is dit opgebouwd? closes the chain with the Afspraak before the Enrosed kost', () => {
  const rows = [
    { key: 'SUPPLIER', label: 'Leverancier · goederen', amountEur: 52021.07, note: null },
    { key: 'LOGISTICS', label: 'Douane & transport', amountEur: 13233.5, note: null },
    { key: 'ENROSED', label: 'Enrosed kost', amountEur: 2000, note: 'intern, geen betaling' },
  ];
  const chain = landedChain({ rows }, 65254.57);
  assert.deepEqual(chain.map(row => [row.key, row.amountEur, row.sum ?? false]),
    [['SUPPLIER', 52021.07, false], ['LOGISTICS', 13233.5, false], ['AFSPRAAK', 65254.57, true], ['ENROSED', 2000, false]]);
  assert.equal(chain[2].label, 'Afspraak');
  assert.equal(rows.length, 3, 'the bridge itself is not changed');
  assert.deepEqual(landedChain({ rows }, 65254.58).map(row => row.key), ['SUPPLIER', 'LOGISTICS', 'ENROSED'], 'only to the cent');
  assert.deepEqual(landedChain({ rows: rows.slice(0, 2) }, 65254.57).map(row => row.key), ['SUPPLIER', 'LOGISTICS'], 'nothing follows: the total is the Afspraak');
  const apart = [rows[0], rows[1], rows[2], { key: 'LANDED', label: 'Totaal geland', amountEur: 67254.57, note: 'zoals in de kop', subtotal: true },
    { key: 'SEPARATE', label: 'Inspectie & andere kosten', amountEur: 300, note: 'apart, buiten de stukprijs' }];
  assert.deepEqual(landedChain({ rows: apart }, 65554.57), apart, 'costs outside the piece price keep their own subtotal');
});

const status = (kind: PayeeStatusKind, tone: 'ok' | 'warn' | 'neutral' = 'ok') => ({ kind, label: 'x', tone });
const termRow = (term: LedgerTerm): NacalcTermRow => ({ due: term.due, label: term.label, agreedEur: term.fullEur, paidEur: term.paidEur, openEur: term.openEur,
  verschilEur: term.differenceEur, reason: 'none', reasonLabel: '', status: term.status });
const payeeRow = (extra: Partial<NacalcPayeeRow>): NacalcPayeeRow => ({
  payee: 'SUPPLIER', label: 'Leverancier', icon: '', tone: '', basis: '', ddpNote: false, cifNote: false, legacy: false, legacyEur: 0, agreedEur: 52021.07,
  paidEur: 50723.9, paidForeign: null, openEur: 0, dueNowEur: 0, laterEur: 0, eindkostEur: 50723.9, verschilEur: -1297.17, reason: 'settled-lower',
  reasonLabel: '', fxEur: 0, creditEur: 0, creditOpenEur: 0, status: status('SETTLED_LOWER'), action: null, actionLabel: null, payAction: null,
  settleDefault: { payee: 'SUPPLIER', scope: 'GROUP', due: null }, canUndoSettle: true, terms: TERMS.map(termRow), termsMixed: true, ...extra,
});

test('Waar het verschil zit: the payees, the supplier\'s terms under it, a term word only when it differs (PO-2026-005)', () => {
  const rows = [payeeRow({}), payeeRow({ payee: 'LOGISTICS', label: 'Douane & transport', agreedEur: 13233.5, paidEur: 11259.33, eindkostEur: 11259.33,
    verschilEur: -1974.17, terms: [], termsMixed: false })];
  const chain = nacalcChain(rows, payee => payee === 'SUPPLIER' ? TERMS : [], false);
  assert.deepEqual(chain.map(row => [row.kind, row.name, plain(row.amount.text), row.amount.tone, plain(row.line), row.word?.word ?? null]), [
    ['payee', 'Leverancier', '€ 1.297,17 minder', 'in', '€ 52.021,07 → € 50.723,90', 'Afgerekend'],
    ['term', '1/3 bij bestelling', '€ 2.123,17 minder', 'in', '€ 17.340,34 → € 15.217,17', null],
    ['term', '1/3 bij vertrek', '€ 2.949,22 meer', 'none', '€ 17.340,34 → € 20.289,56', null],
    ['term', '1/3 bij aankomst', '€ 2.123,22 minder', 'in', '€ 17.340,39 → € 15.217,17', null],
    ['payee', 'Douane & transport', '€ 1.974,17 minder', 'in', '€ 13.233,50 → € 11.259,33', 'Afgerekend'],
  ]);
  assert.ok(chain.every(row => !row.warn));
  assert.deepEqual(chain.map(row => row.key), ['SUPPLIER', 'SUPPLIER:ORDERED', 'SUPPLIER:SHIPPED', 'SUPPLIER:ARRIVED', 'LOGISTICS'], 'unique track keys');
  // A term still to review shows its word; terms that do not mix stay out.
  const review = { ...TERMS[1], finalized: false, settled: false };
  const reviewed = nacalcChain([payeeRow({ status: status('OVERPAID', 'warn'), reason: 'review', verschilEur: 1651.88 })], () => [TERMS[0], review, TERMS[2]], false);
  assert.deepEqual(reviewed.map(row => [row.name, row.word?.word ?? null, row.amount.tone, row.warn]), [
    ['Leverancier', 'Nakijken', 'warn', true], ['1/3 bij bestelling', 'Afgerekend', 'in', false], ['1/3 bij vertrek', null, 'warn', false], ['1/3 bij aankomst', 'Afgerekend', 'in', false]]);
  assert.equal(nacalcChain([payeeRow({ termsMixed: false })], () => TERMS, false).length, 1);
  // Open, incomplete, without an agreement.
  const open = nacalcChain([payeeRow({ verschilEur: 0, openEur: 1200, dueNowEur: 1200, status: status('DUE', 'warn'), reason: 'open', termsMixed: false })], () => [], false)[0];
  assert.deepEqual([plain(open.amount.text), open.amount.tone, open.word?.word], ['€ 1.200,00 open', 'warn', 'Nu te betalen']);
  const incomplete = nacalcChain([payeeRow({ reason: 'incomplete', status: status('INCOMPLETE', 'warn'), termsMixed: false })], () => [], false)[0];
  assert.deepEqual([incomplete.amount.text, incomplete.warn, incomplete.word?.word], ['—', true, 'Onvolledig']);
  const other = nacalcChain([payeeRow({ payee: 'OTHER', label: 'Bijkomende kosten', agreedEur: null, paidEur: 42.5, verschilEur: 42.5, reason: 'additional',
    status: status('ADDITIONAL', 'neutral'), termsMixed: false })], () => [], false)[0];
  assert.deepEqual([plain(other.amount.text), other.amount.tone, plain(other.line), other.word?.word], ['€ 42,50 meer', 'none', '€ 42,50 · zonder afspraak', 'Bijkomend']);
  const none = nacalcChain([payeeRow({ verschilEur: 0, status: status('PAID'), reason: 'none', termsMixed: false, ddpNote: true })], () => [], false)[0];
  assert.deepEqual([none.amount.text, plain(none.line)], ['geen verschil', '€ 52.021,07 → € 50.723,90 · DDP']);
});

test('the gross pair Emre asked about reads as the sum of the rows above it', () => {
  const ex = { savingsEur: 6220.56, overrunsEur: 2949.22, additionalEur: 0 };
  assert.equal(plain(nacalcGrossLine(ex, -3271.34, 0)), 'Opgeteld: € 6.220,56 minder, € 2.949,22 meer, € 0,00 bijkomend; samen € 3.271,34 minder.');
  assert.equal(nacalcGrossLine({ savingsEur: 3271.34, overrunsEur: 0, additionalEur: 0 }, -3271.34, 0), null, 'savings only: the rows say it');
  assert.equal(nacalcGrossLine({ savingsEur: 0, overrunsEur: 120, additionalEur: 0 }, 120, 0), null);
  assert.equal(plain(nacalcGrossLine(ex, -3771.34, 500)), 'Opgeteld: € 6.220,56 minder, € 2.949,22 meer, € 0,00 bijkomend, − € 500,00 tegoed; samen € 3.771,34 minder.');
  assert.equal(plain(nacalcGrossLine({ savingsEur: 100, overrunsEur: 0, additionalEur: 42.5 }, -57.5, 0)), 'Opgeteld: € 100,00 minder, € 0,00 meer, € 42,50 bijkomend; samen € 57,50 minder.');
  assert.equal(plain(nacalcGrossLine(ex, -3000, 0)), 'Opgeteld: € 6.220,56 minder, € 2.949,22 meer, € 0,00 bijkomend.', "no 'samen' when the parts miss the Verschil");
  assert.equal(plain(storySub({ kind: 'final', paidEur: 61983.23, openEur: 0, creditEur: 0 })), 'betaald € 61.983,23 · open € 0,00');
  assert.equal(plain(storySub({ kind: 'provisional', paidEur: 100, openEur: 50, creditEur: 500 })), 'betaald € 100,00 · open € 50,00 · tegoed − € 500,00');
  assert.equal(storySub({ kind: 'concept', paidEur: 0, openEur: 0, creditEur: 0 }), 'volgens de calculatie · nog niets betaald');
});

const product = (name: string, eindkostEur: number, verschilEur: number, unitEur: number, pricingUnitEur: number, extra: Partial<NacalcProductRow> = {}): NacalcProductRow => ({
  productId: 1, name, ordered: 270, received: 270, missing: 0, over: 0, damaged: 0, usable: 270, unitQuantity: 270, unitBasis: 'USABLE_RECEIVED',
  begrootEur: Math.round((eindkostEur - verschilEur) * 100) / 100, eindkostEur, verschilEur, unitEur, pricingUnitEur, set: null, unitPieceEur: unitEur,
  pricingPieceEur: pricingUnitEur, pieceQuantity: 270, ...extra,
});

test('Per product: biggest eindkost first, five unless all, € per stuk · incl. · Verschil', () => {
  const products = [
    product('Rose in dome 15×30 single · Red', 2241.63, -94.13, 8.3023, 8.5938),
    product('Soap rose box 9 · Roze', 3894.3, -304.77, 1.7308, 1.7839),
    product('Soap rose box 16 · Roze', 5489.83, -288.55, 2.4399, 2.5188),
    product('Small', 100, 0, 1, 1.1),
    product('Smaller', 90, 2.5, 1, 1.1),
    product('Smallest', 80, -1, 1, 1.1),
  ];
  const rows = productRows(products, 'PIECE', false);
  assert.deepEqual(rows.map(row => row.row.name), ['Soap rose box 16 · Roze', 'Soap rose box 9 · Roze', 'Rose in dome 15×30 single · Red', 'Small', 'Smaller']);
  assert.equal(productRows(products, 'PIECE', true).length, 6);
  assert.deepEqual([plain(rows[0].unitText), plain(rows[0].inclText), plain(rows[0].verschil.text), rows[0].verschil.tone],
    ['€ 2,4399 /st', '€ 2,5188 incl.', '€ 288,55 minder', 'in']);
  assert.deepEqual([rows[3].verschil.text, plain(rows[4].verschil.text), rows[4].verschil.tone], ['geen verschil', '€ 2,50 meer', 'warn']);
  const total = productRows(products, 'PIECE', true).reduce((sum, row) => sum + Math.round(row.row.verschilEur * 100), 0);
  assert.equal(total, -68595, 'every product listed once');
  const display = productRows([product('Box 12 roses', 3120, 0, 31.2, 32, { set: { pieces: 12, one: 'roos', other: 'rozen' }, unitPieceEur: 2.6 })], 'MIXED', false)[0];
  assert.equal(plain(display.unitText), '€ 31,2000 /display');
  assert.equal(plain(productRows([product('Loose', 10, 0, 1, 1)], 'MIXED', false)[0].unitText), '€ 1,0000 /stuk');
  const none = productRows([product('Lost', 10, 0, 1, 1, { unitQuantity: 0 })], 'PIECE', false)[0];
  assert.deepEqual([none.unitText, none.inclText, none.verschil.text], ['—', null, 'geen bruikbare stuks']);
});

test('the product sheet holds the quantity, the Afspraak and the line eindkost one tap away', () => {
  const rows = productSheetRows(product('Rose in dome 15×30 single · Red', 2241.63, -94.13, 8.3023, 8.5938, { missing: 2, usable: 268 }), true, 'PIECE');
  assert.deepEqual(rows.map(row => [row.label, plain(row.value), row.sub]), [
    ['Bruikbaar', '268 stuks', '2 te weinig'], ['Afspraak', '€ 2.335,76', null], ['Eindkost', '€ 2.241,63', null], ['Verschil', '€ 94,13 minder', null],
    ['Per stuk', '€ 8,3023', null], ['Incl. Enrosed kost', '€ 8,5938', null],
  ]);
  const display = productSheetRows(product('Box', 3120, 0, 31.2, 32, { set: { pieces: 12, one: 'roos', other: 'rozen' }, unitPieceEur: 2.6, pricingPieceEur: 2.6667, ordered: 100 }), false, 'DISPLAY');
  assert.deepEqual(display.map(row => [row.label, plain(row.value), plain(row.sub)]), [
    ['Besteld', '100 displays', '× 12 rozen'], ['Afspraak', '€ 3.120,00', ''], ['Eindkost', '€ 3.120,00', ''], ['Verschil', 'geen verschil', ''],
    ['Per display', '€ 31,2000', '€ 2,6000 per stuk'], ['Incl. Enrosed kost', '€ 32,0000', '€ 2,6667 per stuk'],
  ]);
  assert.doesNotMatch(JSON.stringify(rows), /begroot/i);
});

test('Van calculatie naar afspraak stops at the Afspraak; the story card holds the rest', () => {
  const rows: NacalcBridgeRow[] = [
    { key: 'LANDED', label: 'Calculatie · totaal geland', amountEur: 67254.57, note: null, op: '' },
    { key: 'ENROSED', label: 'Enrosed kost', amountEur: 2000, note: 'intern, geen betaling', op: '−' },
    { key: 'BUDGET', label: 'Afspraak extern', amountEur: 65254.57, note: 'op bestelde aantallen en orderkoersen', op: '=' },
    { key: 'PAID', label: 'Betaald', amountEur: 61983.23, note: null, op: '' },
    { key: 'FORECAST', label: 'Eindkost', amountEur: 61983.23, note: null, op: '=' },
    { key: 'VARIANCE', label: 'Verschil', amountEur: -3271.34, note: 'eindkost min afspraak', op: '→' },
  ];
  assert.deepEqual(afspraakBridge(rows).map(row => [row.key, row.label, row.note, row.op]), [
    ['LANDED', 'Totaal geland', 'calculatie', ''], ['ENROSED', 'Enrosed kost', 'intern', '−'], ['BUDGET', 'Afspraak', 'bestelde aantallen, orderkoersen', '='],
  ]);
  assert.equal(rows[0].label, 'Calculatie · totaal geland', 'the desk keeps its rows');
});

test('the payee sheet: a lead without status or plan, the plan as the Termijnen trail, the file in two parts', () => {
  const terms = [{}, {}, {}];
  assert.equal(sheetLead({ payee: 'SUPPLIER', basis: 'Goederen · 1/3 · 1/3 · 1/3 (bestelling, vertrek, aankomst)', terms }, 'Yiwu Jerry Crafts Co., Ltd'), 'Yiwu Jerry Crafts Co., Ltd');
  assert.equal(sheetLead({ payee: 'SUPPLIER', basis: 'Goederen + zeevracht (CIF) · 1/3', terms }, 'Jerry'), 'Jerry · goederen + zeevracht (CIF)');
  assert.equal(sheetLead({ payee: 'SUPPLIER', basis: 'Goederen · geen betaalplan', terms: [] }, 'Jerry'), 'Jerry · geen betaalplan');
  assert.equal(sheetLead({ payee: 'LOGISTICS', basis: 'Afspraak: vracht, lokale kosten en invoerrechten', terms: [] }, 'Jerry'), '');
  assert.equal(sheetLead({ payee: 'LOGISTICS', basis: 'Afspraak: invoerrechten en lokale kosten aankomst · zeevracht via de leverancier (CIF)', terms: [] }, ''), 'zeevracht via de leverancier (CIF)');
  assert.equal(sheetLead({ payee: 'LOGISTICS', basis: 'Inbegrepen in de prijs (DDP)', terms: [] }, ''), 'inbegrepen in de prijs (DDP)');
  assert.equal(plain(sheetLead({ payee: 'SEPARATE', basis: 'Afspraak inspectie € 300,00 · via leverancier', terms: [] }, '')), 'Afspraak inspectie € 300,00 · via leverancier');
  assert.equal(sheetLead({ payee: 'OTHER', basis: '', terms: [] }, ''), 'Bankkosten, koerier, wisselkoers · zonder afspraak');
  assert.equal(planTrail('1/3 · 1/3 · 1/3 (bestelling, vertrek, aankomst)', ['1/3 bij bestelling', '1/3 bij vertrek', '1/3 bij aankomst']), '1/3 · 1/3 · 1/3');
  assert.equal(planTrail('1/3 bij bestelling, 2/3 bij vertrek', ['1/3 bij bestelling', '2/3 bij vertrek']), '1/3 · 2/3');
  assert.equal(planTrail('30% bij bestelling, 70% bij vertrek', ['30% bij bestelling', '70% bij vertrek']), '30% · 70%');
  assert.equal(planTrail('Alles bij bestelling', ['Alles bij bestelling']), 'Alles bij bestelling');
  assert.deepEqual(fileWords({ kind: 'COMMERCIAL_INVOICE' }), { title: 'Factuurbestand', note: 'zonder gegevens' });
  assert.deepEqual(fileWords({ kind: 'PROFORMA_INVOICE' }), { title: 'Proforma (PI)', note: null });
});

test('a payment row: the term or the payee on line 2, the bank as a mark', () => {
  assert.equal(paymentLine({ termLabel: '1/3 bij aankomst', payee: 'SUPPLIER', payeeLabel: 'Leverancier', payeeShort: 'Leverancier', parts: [{}] }), '1/3 bij aankomst');
  assert.equal(paymentLine({ termLabel: null, payee: 'LOGISTICS', payeeLabel: 'Douane & transport', payeeShort: 'Transport', parts: [{}] }), 'Douane & transport');
  assert.equal(paymentLine({ termLabel: null, payee: 'OTHER', payeeLabel: 'Bijkomende kosten', payeeShort: 'Bijkomend', parts: [{}, {}] }), 'Bijkomend · 2 transacties');
  assert.deepEqual(proofMark('op de bank', { linked: 1, creditOffset: false }), { icon: 'bank', label: 'op de bank', text: '' });
  assert.deepEqual(proofMark('2 transacties op de bank', { linked: 2, creditOffset: false }), { icon: 'bank', label: '2 transacties op de bank', text: '' });
  assert.deepEqual(proofMark('1 van 2 op de bank', { linked: 1, creditOffset: false }), { icon: 'bank', label: '1 van 2 op de bank', text: '1 van 2' });
  assert.deepEqual(proofMark('op de bank · zelfde transactie als de goederen', { linked: 1, creditOffset: false })?.text, 'zelfde transactie als de goederen');
  assert.deepEqual(proofMark('swift.pdf', { linked: 0, creditOffset: false }), { icon: 'clip', label: 'swift.pdf', text: 'swift.pdf' });
  assert.deepEqual(proofMark('verrekend tegoed', { linked: 0, creditOffset: true }), { icon: null, label: 'verrekend tegoed', text: 'verrekend tegoed' });
  assert.equal(proofMark(null, { linked: 0, creditOffset: false }), null);
});

/** Keeps the PayeeLedger import honest: the helpers take the ledger's own shapes. */
const _shape: Pick<PayeeLedger, 'payee' | 'agreedEur' | 'paidEur' | 'openEur'> = SUPPLIER;
void _shape;
