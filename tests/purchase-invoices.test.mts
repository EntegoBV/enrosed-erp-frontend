import assert from 'node:assert/strict';
import test from 'node:test';
import type { PurchaseInvoice, PurchasePayment } from '../src/app/core/api/models.ts';
import {
  invoiceCandidates, invoiceComparison, invoiceDocumentKind, invoiceLine, invoiceOption, invoiceSub, invoiceTermsLine, isInvoiceFile,
  payeeInvoiceComparison, paymentRoundOnServer, primaryInvoice, resolveInvoice, viaSupplier,
} from '../src/app/features/purchasing/purchase-invoices.ts';
import { inspectionSplitBlocked, inspectionSplitEur, pendingLinkPlan, pendingPartEur } from '../src/app/features/purchasing/purchase-payment-links.ts';

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
  assert.equal(pendingLinkPlan(21733.63, [{ id: 520, amountEur: -30000 }], true).kind, 'invalid', 'a larger transaction belongs to Bestaande betaling');
  assert.deepEqual(pendingLinkPlan(21733.63, [{ id: 520, amountEur: -10000 }, { id: 534, amountEur: -11733.65 }], true), { kind: 'lines', lineIds: [520, 534] });
  assert.equal(pendingLinkPlan(21733.63, [{ id: 520, amountEur: -10000 }, { id: 534, amountEur: -11700 }], true).kind, 'invalid');
  assert.equal(pendingLinkPlan(100, [{ id: 1, amountEur: 100 }], true).kind, 'invalid', 'never an incoming line');
  // An older server: one matching transaction only, through /links.
  assert.deepEqual(pendingLinkPlan(21733.63, [{ id: 520, amountEur: -21733.63 }], false), { kind: 'links', lineId: 520 });
  assert.equal(pendingLinkPlan(21733.63, [{ id: 520, amountEur: -10000 }], false).kind, 'invalid');
  assert.equal(inspectionSplitBlocked(pendingLinkPlan(10300, [{ id: 610, amountEur: -10300 }], true)), false);
  assert.equal(inspectionSplitBlocked(pendingLinkPlan(10300, [{ id: 610, amountEur: -5000 }], true)), true);
  assert.equal(inspectionSplitBlocked(pendingLinkPlan(10300, [{ id: 610, amountEur: -5000 }, { id: 611, amountEur: -5300 }], true)), true);
  assert.equal(inspectionSplitEur({ amount: 10300, currency: 'EUR', amountEur: 10300 }, 300), 300);
  assert.equal(inspectionSplitEur({ amount: 12000, currency: 'USD', amountEur: 10300 }, 350), 300.42, 'the payment\'s own booked rate');
});

test('the sheet and the save check picked transactions against the same amount', () => {
  const stored = { amount: 10000, currency: 'EUR' as const, amountEur: 10000 };
  // A payment never split: the draft's euro (a corrected amount is written before the link), not the stored one.
  assert.equal(pendingPartEur(stored, undefined, 10300), 10300);
  assert.deepEqual(pendingLinkPlan(pendingPartEur(stored, undefined, 10300), [{ id: 610, amountEur: -10300 }], true), { kind: 'part', lineId: 610, whole: true });
  assert.equal(pendingLinkPlan(pendingPartEur(stored, undefined, 9000), [{ id: 610, amountEur: -10000 }], true).kind, 'invalid',
    'a lowered amount no longer matches the transaction picked for the old one');
  // A transfer of a payment in parts: its correction, else its booked euro.
  assert.equal(pendingPartEur(stored, undefined, null), 10000);
  assert.equal(pendingPartEur(stored, { amount: 9500 }, null), 9500);
  assert.equal(pendingPartEur({ amount: 5000, currency: 'USD', amountEur: 4600 }, { amount: 2500 }, null), 2300, 'pro rata at its own rate');
  assert.equal(pendingPartEur({ amount: 5000, currency: 'USD', amountEur: 4600 }, { amount: 2500, amountEur: 2310 }, null), 2310);
});
