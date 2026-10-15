import assert from 'node:assert/strict';
import test from 'node:test';
import type { PurchaseInvoice, PurchasePayment } from '../src/app/core/api/models.ts';
import {
  inspectionRestOffered, invoiceCandidates, invoiceComparison, invoiceCoverage, invoiceDocumentKind, invoiceLine, invoiceNumberKey, invoiceOption, invoiceSub,
  invoiceTermsLine, isInvoiceFile, payeeInvoiceComparison, paymentRoundOnServer, primaryInvoice, resolveInvoice, viaSupplier,
} from '../src/app/features/purchasing/purchase-invoices.ts';
import {
  carveForeignText, carveText, foreignLinkWarning, inspectionSplitBlocked, inspectionSplitEur, linkChange, linkNotice, pendingAlreadyLinked, pendingLinkPlan,
  pendingPartEur, surplusQuestion,
} from '../src/app/features/purchasing/purchase-payment-links.ts';

/** Intl writes a non-breaking space after the euro sign. */
const plain = (text: string | null | undefined) => text == null ? text : text.replace(/[  ]/g, ' ');

// Worked example (a): PO-2026-014, Afspraak Leverancier € 31.048,04, invoice CI-2026-118 of 20/08/2026.
function invoice(id: number, values: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
  return { id, orderId: 14, payee: 'SUPPLIER', payeeLabel: 'Leverancier', number: 'CI-2026-118', invoiceDate: '2026-08-20', amount: 31048.04,
    currency: 'EUR', amountEur: 31048.04, documentId: 88, documentName: 'CI-2026-118.pdf', notes: null, actor: 'Emre',
    recordedAt: '2026-08-21T08:10:00Z', primary: id === 7, coversInspection: false, paymentIds: [], paidEur: 0, ...values };
}
const pay = (id: number, payee: PurchasePayment['payee'], line: number | null): Pick<PurchasePayment, 'id' | 'payee' | 'bankStatementLineId'> =>
  ({ id, payee, bankStatementLineId: line });

test('the invoices of a payee against its Afspraak: equal, more, less, or equal plus the inspection paid via the supplier', () => {
  assert.deepEqual(invoiceComparison([invoice(7)], 'SUPPLIER', 31048.04, 0), { text: 'gelijk aan de afspraak', tone: 'ok', differenceEur: 0 });
  const more = invoiceComparison([invoice(7, { amount: 31100, amountEur: 31100 })], 'SUPPLIER', 31048.04, 0)!;
  assert.deepEqual([plain(more.text), more.tone, more.differenceEur], ['€ 51,96 meer dan de afspraak', 'warn', 51.96]);
  const less = invoiceComparison([invoice(7, { amountEur: 31000 })], 'SUPPLIER', 31048.04, 0)!;
  assert.deepEqual([plain(less.text), less.tone], ['€ 48,04 minder dan de afspraak', 'neutral']);
  // A second invoice of the same payee is extra on top (Emre, 2026-10-15).
  const extra = invoiceComparison([invoice(7), invoice(9, { number: 'CI-2026-131', amountEur: 500 })], 'SUPPLIER', 31048.04, 0)!;
  assert.equal(plain(extra.text), '€ 500,00 meer dan de afspraak');
  // Example (b): the supplier's invoice also covers the € 300,00 inspection; the SEPARATE stream also holds a € 120,00 lab test.
  const covers = invoice(7, { amountEur: 31348.04, coversInspection: true });
  assert.deepEqual(invoiceComparison([covers], 'SUPPLIER', 31048.04, 300), { text: 'gelijk aan de afspraak + inspectie', tone: 'ok', differenceEur: 300 });
  assert.equal(plain(invoiceComparison([covers], 'SUPPLIER', 31048.04, 420)!.text), '€ 300,00 meer dan de afspraak',
    'the inspection\'s own Afspraak counts, never the whole stream with the other costs');
  assert.equal(plain(invoiceComparison([invoice(7, { amountEur: 31348.04 })], 'SUPPLIER', 31048.04, 300)!.text), '€ 300,00 meer dan de afspraak',
    'without coversInspection a surplus stays a surplus');
  assert.equal(invoiceComparison([], 'SUPPLIER', 31048.04, 0), null);
  assert.equal(invoiceComparison([invoice(7)], 'SUPPLIER', null, 0), null);
  assert.equal(invoiceComparison([invoice(7)], 'LOGISTICS', 400, 0), null, 'only the payee\'s own invoices count');
  assert.deepEqual(payeeInvoiceComparison({ payee: 'SUPPLIER', invoices: [invoice(7)], agreedEur: 31048.04, inspectionAgreedEur: 0 })?.text, 'gelijk aan de afspraak');
});

test('words of an invoice: its line, its option, its sub line and the terms it covers', () => {
  assert.equal(plain(invoiceLine(invoice(7))), 'Factuur CI-2026-118 · 20/08/2026 · € 31.048,04');
  assert.equal(plain(invoiceLine(invoice(7, { currency: 'USD', amount: 36000 }))), 'Factuur CI-2026-118 · 20/08/2026 · US$ 36.000,00 (≈ € 31.048,04)');
  assert.equal(plain(invoiceOption(invoice(7))), 'CI-2026-118 · 20/08/2026 · € 31.048,04');
  assert.equal(plain(invoiceSub(invoice(7), 'gelijk aan de afspraak')), '20/08/2026 · € 31.048,04 · gelijk aan de afspraak');
  assert.equal(invoiceTermsLine([{ label: '30% bij bestelling' }, { label: '70% bij vertrek' }]), 'dekt 30% bij bestelling + 70% bij vertrek');
  assert.equal(invoiceTermsLine([]), '');
});

test('files: the invoice kinds, a file an invoice points to and the older labelled files are invoices, never payment proof', () => {
  const invoices = [invoice(7)];
  assert.equal(isInvoiceFile({ id: 77, kind: 'COMMERCIAL_INVOICE', label: null }, invoices), true);
  assert.equal(isInvoiceFile({ id: 78, kind: 'INVOICE', label: null }, invoices), true);
  assert.equal(isInvoiceFile({ id: 88, kind: 'OTHER', label: 'scan' }, invoices), true, 'the file of CI-2026-118');
  for (const label of ['Factuur', 'Factuur inspectie', 'Factuur transport']) assert.equal(isInvoiceFile({ id: 90, kind: 'OTHER', label }, invoices), true, label);
  assert.equal(isInvoiceFile({ id: 91, kind: 'OTHER', label: 'Foto container' }, invoices), false);
  assert.equal(isInvoiceFile({ id: 92, kind: 'PAYMENT_PROOF', label: null }, invoices), false);
  assert.equal(invoiceDocumentKind('SUPPLIER'), 'COMMERCIAL_INVOICE');
  assert.equal(invoiceDocumentKind('SEPARATE'), 'INVOICE');
});

test('the inspection counts as paid via the supplier only with the flag, on the goods\' bank line or not on the bank yet', () => {
  const payments = [pay(201, 'SUPPLIER', 610), pay(202, 'SEPARATE', 610), pay(203, 'SEPARATE', null), pay(204, 'SEPARATE', 700)];
  assert.equal(viaSupplier(payments[1], payments, true), true, 'same transfer as the goods');
  assert.equal(viaSupplier(payments[2], payments, true), true, 'not on the bank yet');
  assert.equal(viaSupplier(payments[3], payments, true), false, 'a lab fee in its own transfer keeps its own invoice');
  assert.equal(viaSupplier(payments[1], payments, false), false, 'never without the flag');
  assert.equal(viaSupplier(payments[0], payments, true), false, 'goods are not via the supplier');
});

test('which invoice a payment belongs to mirrors the server: explicit, the only one, the supplier\'s primary via the supplier, else none', () => {
  const supplier = [invoice(7), invoice(9, { number: 'CI-2026-131', invoiceDate: '2026-08-01' })];
  const payments = [pay(201, 'SUPPLIER', 610)];
  assert.equal(resolveInvoice({ payee: 'SUPPLIER', invoiceId: 9, bankStatementLineId: null }, supplier, payments, false), 9);
  assert.equal(resolveInvoice({ payee: 'SUPPLIER', invoiceId: null, bankStatementLineId: null }, [invoice(7)], payments, false), 7);
  assert.equal(resolveInvoice({ payee: 'SUPPLIER', invoiceId: null, bankStatementLineId: null }, supplier, payments, false), null, 'two invoices: kies de factuur');
  assert.equal(resolveInvoice({ payee: 'SUPPLIER', invoiceId: 55, bankStatementLineId: null }, [invoice(7)], payments, false), 7, 'an unknown id falls back');
  assert.equal(resolveInvoice({ payee: 'SEPARATE', invoiceId: null, bankStatementLineId: 610 }, supplier, payments, true), 7,
    'the primary is the first registered (lowest id), even when a later one carries an earlier date');
  assert.equal(resolveInvoice({ payee: 'SEPARATE', invoiceId: null, bankStatementLineId: 610 }, supplier, payments, false), null);
  assert.equal(resolveInvoice({ payee: 'SEPARATE', invoiceId: null, bankStatementLineId: 610 },
    [...supplier, invoice(12, { payee: 'SEPARATE', number: 'INS-1' })], payments, true), 12, 'an inspection invoice of its own wins');
  assert.equal(primaryInvoice(supplier, 'SUPPLIER')?.id, 7);
  assert.deepEqual(invoiceCandidates([...supplier, invoice(12, { payee: 'SEPARATE' })], 'SEPARATE', true).map(item => item.id), [12, 7, 9]);
  assert.deepEqual(invoiceCandidates([...supplier, invoice(12, { payee: 'SEPARATE' })], 'SEPARATE', false).map(item => item.id), [12]);
});

test('a server without this round has no invoices field: every new action stays hidden', () => {
  assert.equal(paymentRoundOnServer({ invoices: [] }), true);
  assert.equal(paymentRoundOnServer({}), false);
  assert.equal(paymentRoundOnServer(null), false);
});

test('picked bank transactions: one whole or smaller goes through bank-part, several that make the amount through bank-lines', () => {
  assert.deepEqual(pendingLinkPlan(21733.63, [], true), { kind: 'none' });
  assert.deepEqual(pendingLinkPlan(21733.63, [{ id: 520, amountEur: -21733.65 }], true), { kind: 'part', lineId: 520, whole: true }, 'two cents off is whole');
  assert.deepEqual(pendingLinkPlan(21733.63, [{ id: 520, amountEur: -10000 }], true), { kind: 'part', lineId: 520, whole: false });
  assert.deepEqual(pendingLinkPlan(21733.63, [{ id: 520, amountEur: -30000 }], true), { kind: 'higher', lineId: 520, extraEur: 8266.37 },
    'a larger transaction asks what the surplus is');
  assert.deepEqual(pendingLinkPlan(21733.63, [{ id: 520, amountEur: -30000 }], true, 'ADJUST'), { kind: 'part', lineId: 520, whole: true, surplus: 'ADJUST' });
  assert.deepEqual(pendingLinkPlan(21733.63, [{ id: 520, amountEur: -30000 }], true, 'INSPECTION'), { kind: 'part', lineId: 520, whole: true, surplus: 'INSPECTION' });
  assert.deepEqual(pendingLinkPlan(21733.63, [{ id: 520, amountEur: -21733.65 }], true, 'ADJUST'), { kind: 'part', lineId: 520, whole: true },
    'a choice left over from another transaction is not sent with a matching one');
  assert.equal(pendingLinkPlan(21733.63, [{ id: 520, amountEur: -30000 }], false).kind, 'invalid', 'an older server takes no larger transaction');
  assert.deepEqual(pendingLinkPlan(21733.63, [{ id: 520, amountEur: -10000 }, { id: 534, amountEur: -11733.65 }], true), { kind: 'lines', lineIds: [520, 534] });
  assert.equal(pendingLinkPlan(21733.63, [{ id: 520, amountEur: -10000 }, { id: 534, amountEur: -11700 }], true).kind, 'invalid');
  assert.equal(pendingLinkPlan(100, [{ id: 1, amountEur: 100 }], true).kind, 'invalid', 'never an incoming line');
  // An older server: one matching transaction only, through /links.
  assert.deepEqual(pendingLinkPlan(21733.63, [{ id: 520, amountEur: -21733.63 }], false), { kind: 'links', lineId: 520 });
  assert.equal(pendingLinkPlan(21733.63, [{ id: 520, amountEur: -10000 }], false).kind, 'invalid');
  assert.equal(inspectionSplitBlocked(pendingLinkPlan(10300, [{ id: 610, amountEur: -10300 }], true)), false);
  assert.equal(inspectionSplitBlocked(pendingLinkPlan(10300, [{ id: 610, amountEur: -5000 }], true)), true);
  assert.equal(inspectionSplitBlocked(pendingLinkPlan(10300, [{ id: 610, amountEur: -5000 }, { id: 611, amountEur: -5300 }], true)), true);
  assert.equal(inspectionSplitBlocked(pendingLinkPlan(10000, [{ id: 610, amountEur: -10300 }], true)), true, 'a larger one changes the goods payment first');
  assert.equal(inspectionSplitBlocked(pendingLinkPlan(10000, [{ id: 610, amountEur: -10300 }], true, 'ADJUST')), true);
  assert.equal(inspectionSplitEur({ amount: 10300, currency: 'EUR', amountEur: 10300 }, 300), 300);
  assert.equal(inspectionSplitEur({ amount: 12000, currency: 'USD', amountEur: 10300 }, 350), 300.42, 'the payment\'s own booked rate');
});

test('the sheet and the save check picked transactions against the same amount', () => {
  const stored = { amount: 10000, currency: 'EUR' as const, amountEur: 10000 };
  // A payment never split: the draft's euro (a corrected amount is written before the link), not the stored one.
  assert.equal(pendingPartEur(stored, undefined, 10300), 10300);
  assert.deepEqual(pendingLinkPlan(pendingPartEur(stored, undefined, 10300), [{ id: 610, amountEur: -10300 }], true), { kind: 'part', lineId: 610, whole: true });
  assert.equal(pendingLinkPlan(pendingPartEur(stored, undefined, 9000), [{ id: 610, amountEur: -10000 }], true).kind, 'higher',
    'against a lowered amount the transaction is larger: the sheet asks what the surplus is');
  // A transfer of a payment in parts: its correction, else its booked euro.
  assert.equal(pendingPartEur(stored, undefined, null), 10000);
  assert.equal(pendingPartEur(stored, { amount: 9500 }, null), 9500);
  assert.equal(pendingPartEur({ amount: 5000, currency: 'USD', amountEur: 4600 }, { amount: 2500 }, null), 2300, 'pro rata at its own rate');
  assert.equal(pendingPartEur({ amount: 5000, currency: 'USD', amountEur: 4600 }, { amount: 2500, amountEur: 2310 }, null), 2310);
});

/* ---- round 2 (Emre, 2026-10-15): a linked transaction carries the payment's amount and day; one invoice for every part-payment */

test('Wat verandert: a whole link follows the transaction, a USD payment keeps its amount and shows the rate, a larger one asks first', () => {
  const now = { amount: 10250, currency: 'EUR' as const, amountEur: 10250, paidOn: '2026-01-03', proof: 'geen' };
  const line = { amountEur: -10300, day: '2026-01-05', text: 'KBC · 05/01/2026 · € 10.300,00' };
  assert.deepEqual(linkChange(now, line, { kind: 'higher', lineId: 610, extraEur: 50 }), [], 'no comparison before the choice');
  const adjust = linkChange(now, line, { kind: 'part', lineId: 610, whole: true, surplus: 'ADJUST' });
  assert.deepEqual(adjust.map(row => [row.label, plain(row.now), plain(row.after), row.changed]), [
    ['Bedrag', '€ 10.250,00', '€ 10.300,00', true], ['Betaald op', '03/01/2026', '05/01/2026', true], ['Bewijs', 'geen', 'KBC · 05/01/2026 · € 10.300,00', true]]);
  const rest = linkChange(now, line, { kind: 'part', lineId: 610, whole: true, surplus: 'INSPECTION' });
  assert.deepEqual(rest.map(row => [row.label, plain(row.after)]), [['Bedrag', '€ 10.250,00'], ['Betaald op', '05/01/2026'],
    ['Inspectie via leverancier', '€ 50,00 op dezelfde transactie'], ['Bewijs', 'KBC · 05/01/2026 · € 10.300,00']]);
  assert.equal(rest[0].changed, false, 'the goods keep their amount');
  const usd = linkChange({ amount: 11000, currency: 'USD', amountEur: 10000, paidOn: '2026-01-03', proof: '1 bestand' },
    { amountEur: -10150, day: '2026-01-05', text: 'KBC · 05/01/2026 · € 10.150,00' }, { kind: 'part', lineId: 610, whole: true });
  assert.deepEqual(usd.map(row => [row.label, plain(row.now), plain(row.after)]), [
    ['Bedrag', 'US$ 11.000,00 · € 10.000,00', 'US$ 11.000,00 · € 10.150,00'], ['Betaald op', '03/01/2026', '05/01/2026'],
    ['Koers', '1 USD = 0,9091 EUR', '1 USD = 0,9227 EUR'], ['Bewijs', '1 bestand', 'KBC · 05/01/2026 · € 10.150,00']]);
  const carve = linkChange({ ...now, amount: 12000, amountEur: 12000 }, { amountEur: -5000, day: '2026-01-05', text: 'KBC' }, { kind: 'part', lineId: 640, whole: false });
  assert.deepEqual(carve.slice(0, 2).map(row => plain(row.after)), ['€ 5.000,00 op de bank + € 7.000,00 open', '05/01/2026 (deel) · rest 03/01/2026']);
  assert.equal(plain(carveText(12000, -5000)), 'Deel van deze betaling: € 5.000,00 van € 12.000,00; de rest (€ 7.000,00) blijft open als tweede transactie.');
  assert.equal(plain(surplusQuestion(300)), 'Transactie is € 300,00 hoger dan deze betaling');
});

test('the notice after a link names what followed the transaction and what it was', () => {
  assert.equal(plain(linkNotice({ amountEur: 10250, paidOn: '2026-01-03' }, { amountEur: 10300, paidOn: '2026-01-05' })),
    'Bedrag en datum gevolgd van de transactie: € 10.300,00 op 05/01/2026 (was € 10.250,00 op 03/01/2026).');
  assert.equal(plain(linkNotice({ amountEur: 10300, paidOn: '2026-01-03' }, { amountEur: 10300, paidOn: '2026-01-05' })),
    'Datum gevolgd van de transactie: 05/01/2026 (was 03/01/2026).');
  assert.equal(plain(linkNotice({ amountEur: 10299.99, paidOn: '2026-01-05' }, { amountEur: 10300, paidOn: '2026-01-05' })),
    'Bedrag gevolgd van de transactie: € 10.300,00 (was € 10.299,99).');
  assert.equal(linkNotice({ amountEur: 10300, paidOn: '2026-01-05' }, { amountEur: 10300, paidOn: '2026-01-05' }), null);
  assert.equal(plain(linkNotice({ amountEur: 10000, paidOn: '2026-01-05' }, { amountEur: 10000, paidOn: '2026-01-05' }, 300)),
    'Rest als inspectie via leverancier: € 300,00.');
});

test('a retry after a lost answer: the picked transactions already on the payment are recognised', () => {
  const parts = [{ bankStatementLineId: 520 }, { bankStatementLineId: 534 }, { bankStatementLineId: null }];
  assert.equal(pendingAlreadyLinked([{ id: 520 }, { id: 534 }], parts), true);
  assert.equal(pendingAlreadyLinked([{ id: 520 }, { id: 540 }], parts), false);
  assert.equal(pendingAlreadyLinked([], parts), false);
});

test('an invoice covers all payments of its payee, or says how many and offers to assign it to all', () => {
  const rows = [{ parts: [{ id: 101 }] }, { parts: [{ id: 102 }, { id: 103 }] }, { parts: [{ id: 104 }] }];
  assert.deepEqual(invoiceCoverage(invoice(7, { paymentIds: [101, 102, 103, 104] }), rows, 'Leverancier'),
    { covered: 3, total: 3, all: true, text: 'Geldt voor alle betalingen van Leverancier (3)' }, 'a payment in parts counts once');
  assert.deepEqual(invoiceCoverage(invoice(7, { paymentIds: [103] }), rows, 'Leverancier'),
    { covered: 1, total: 3, all: false, text: 'Geldt voor 1 van 3 betalingen van Leverancier' });
  assert.deepEqual(invoiceCoverage(invoice(7), [], 'Leverancier'), { covered: 0, total: 0, all: true, text: 'Geldt voor alle betalingen van Leverancier' });
});

/* ---- round-2 review: USD/CNY links as the server makes them, and where 'Rest als inspectie' fits */

test('a USD payment and one transaction: whole by default (the euro and the rate follow), a part only when named in dollars', () => {
  // The backend's case: USD 12.000 booked at € 10.250.
  const usd = { amount: 12000, currency: 'USD' as const };
  const now = { ...usd, amountEur: 10250, paidOn: '2026-01-03', proof: 'geen' };
  // A pure rate difference: linked whole, with a Koers row, never a carve.
  const rate = pendingLinkPlan(10250, [{ id: 1, amountEur: -10180 }], true, null, [], usd);
  assert.deepEqual(rate, { kind: 'part', lineId: 1, whole: true });
  assert.deepEqual(linkChange(now, { amountEur: -10180, day: '2026-01-05', text: 'KBC' }, rate).map(row => [row.label, plain(row.now), plain(row.after)]), [
    ['Bedrag', 'US$ 12.000,00 · € 10.250,00', 'US$ 12.000,00 · € 10.180,00'], ['Betaald op', '03/01/2026', '05/01/2026'],
    ['Koers', '1 USD = 0,8542 EUR', '1 USD = 0,8483 EUR'], ['Bewijs', 'geen', 'KBC']]);
  // € 5.090 and no typed part: still whole (the server links it whole), with a warning that it may be a part.
  assert.deepEqual(pendingLinkPlan(10250, [{ id: 1, amountEur: -5090 }], true, null, [], usd), { kind: 'part', lineId: 1, whole: true });
  assert.equal(plain(foreignLinkWarning({ amountEur: 10250, currency: 'USD' }, -5090)),
    '€ 5.090,00 wijkt sterk af van de geboekte € 10.250,00. Betaalt deze transactie maar een deel, vul dan het deel in USD in.');
  assert.equal(foreignLinkWarning({ amountEur: 10250, currency: 'USD' }, -10180), null, 'a rate difference is no warning');
  assert.equal(foreignLinkWarning({ amountEur: 10250, currency: 'EUR' }, -5090), null);
  // A larger line: whole too, never 'hoger' (no 'Rest als inspectie' for USD).
  assert.deepEqual(pendingLinkPlan(10250, [{ id: 1, amountEur: -10600 }], true, null, [], usd), { kind: 'part', lineId: 1, whole: true });
  assert.deepEqual(pendingLinkPlan(10250, [{ id: 1, amountEur: -10600 }], true, 'INSPECTION', [], usd), { kind: 'part', lineId: 1, whole: true },
    'a stale surplus choice is never sent for USD');
  // The part named in dollars is carved out (bank-part's amount); its euro is the bank's, the rest stays open at the booked rate.
  const half = pendingLinkPlan(10250, [{ id: 1, amountEur: -5090 }], true, null, [], { ...usd, part: 6000 });
  assert.deepEqual(half, { kind: 'part', lineId: 1, whole: false, amount: 6000 });
  assert.equal(inspectionSplitBlocked(half), true, 'a carve changes the goods payment first');
  assert.deepEqual(linkChange(now, { amountEur: -5090, day: '2026-01-05', text: 'KBC' }, half).map(row => [row.label, plain(row.after)]), [
    ['Bedrag', 'US$ 6.000,00 · € 5.090,00 op de bank + US$ 6.000,00 · € 5.125,00 open'], ['Betaald op', '05/01/2026 (deel) · rest 03/01/2026'],
    ['Koers', '1 USD = 0,8483 EUR (deel)'], ['Bewijs', 'KBC']]);
  assert.equal(plain(carveForeignText(6000, -5090, 12000, 'USD')),
    'Deel van deze betaling: US$ 6.000,00 (€ 5.090,00) van US$ 12.000,00; de rest (US$ 6.000,00) blijft open als tweede transactie.');
  // The whole amount named is the whole payment; more than the payment is refused before the server is asked.
  assert.deepEqual(pendingLinkPlan(10250, [{ id: 1, amountEur: -10180 }], true, null, [], { ...usd, part: 12000 }), { kind: 'part', lineId: 1, whole: true });
  const more = pendingLinkPlan(10250, [{ id: 1, amountEur: -10180 }], true, null, [], { ...usd, part: 12500 });
  assert.equal(more.kind, 'invalid');
  assert.equal(more.kind === 'invalid' && plain(more.message), 'Het deel moet kleiner zijn dan de betaling (US$ 12.000,00); laat het leeg voor de hele betaling.');
  // A euro payment keeps comparing in euro; two USD transactions that make the booked euro still split over both.
  assert.equal(pendingLinkPlan(10250, [{ id: 1, amountEur: -10600 }], true, null, [], null).kind, 'higher');
  assert.deepEqual(pendingLinkPlan(10250, [{ id: 1, amountEur: -5000 }, { id: 2, amountEur: -5250 }], true, null, [], usd), { kind: 'lines', lineIds: [1, 2] });
  assert.equal(plain(carveText(12000, -5000)), 'Deel van deze betaling: € 5.000,00 van € 12.000,00; de rest (€ 7.000,00) blijft open als tweede transactie.');
});

test("'Rest als inspectie via leverancier' only where the server takes it", () => {
  const order = { inspectionCostEur: 300, inspectionViaSupplier: true };
  const goods = { id: 201, payee: 'SUPPLIER' as const, bankStatementLineId: 610, amountEur: 10000 };
  const supplier = { payee: 'SUPPLIER' as const, instalmentDue: 'SHIPPED', currency: 'EUR' };
  assert.equal(inspectionRestOffered(supplier, order, [goods]), true);
  assert.equal(inspectionRestOffered({ ...supplier, currency: 'USD' }, order, [goods]), false, 'a USD payment takes the bank\'s euro');
  assert.equal(inspectionRestOffered({ ...supplier, instalmentDue: 'FREIGHT' }, order, [goods]), false);
  assert.equal(inspectionRestOffered({ ...supplier, payee: 'LOGISTICS' }, order, [goods]), false);
  assert.equal(inspectionRestOffered(supplier, { inspectionCostEur: 0, inspectionViaSupplier: true }, [goods]), false);
  assert.equal(inspectionRestOffered(supplier, order, [goods], 1), false, 'an inspection noted with this transfer already');
  // PO-2026-014: the € 300 inspection rides on the 30% transfer, so a larger 70% line only offers 'Bedrag aanpassen'.
  const booked = [goods, { id: 202, payee: 'SEPARATE' as const, bankStatementLineId: 610, amountEur: 300 }];
  assert.equal(inspectionRestOffered(supplier, order, booked), false);
  assert.equal(inspectionRestOffered(supplier, { ...order, inspectionCostEur: 450 }, booked), true, 'part of the inspection is still open');
  assert.equal(inspectionRestOffered(supplier, { ...order, inspectionViaSupplier: false }, booked), true, 'without the flag nothing counts as via the supplier');
  assert.equal(inspectionRestOffered(supplier, order, [goods, { id: 203, payee: 'SEPARATE' as const, bankStatementLineId: 700, amountEur: 300 }]), true,
    'a lab fee in its own transfer is not the inspection via the supplier');
  assert.equal(invoiceNumberKey('  CI-2026-118 '), invoiceNumberKey('ci-2026-118'));
});
