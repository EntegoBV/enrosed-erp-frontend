import assert from 'node:assert/strict';
import test from 'node:test';
import type { SalesOrderView, SalesPaymentSummary } from '../src/app/core/api/models.ts';
import { foreignZoneName, incomingMoneyTotals, invoiceReceivable, openInvoiceRows, paymentLocalDay, paymentMomentLabel, receivableTotals, uniqueIncomingPayments } from '../src/app/features/finance/incoming-money.ts';
import type { IncomingMoneyRow } from '../src/app/features/finance/incoming-money.ts';

const payment = (input: Partial<IncomingMoneyRow> = {}): IncomingMoneyRow => ({ id: 1, salesOrderId: 12, customerId: 7, purchaseOrderId: 4, orderNumber: 'PARTNER-12',
  receivedAt: '2026-09-08T08:30:00Z', timeZone: 'Europe/Brussels', amountEur: 1000, purpose: 'PARTNER_ADVANCE', reference: 'Eerste derde', ...input });
function invoice(id: number, total: number, paid: number, extra: Partial<SalesOrderView['order']> = {}): SalesOrderView {
  return { order: { id, docType: 'FACTUUR', status: 'VERZONDEN', orderDate: '2026-09-01', number: `F-${id}`, ...extra }, priced: { totals: { totalInclVat: total } },
    paymentSummary: { invoiceTotalEur: total, receivedEur: paid, remainingEur: Math.max(total - paid, 0), overpaidEur: total >= 0 ? Math.max(paid - total, 0) : 0, creditEur: Math.max(-total, 0),
      status: paid < total ? 'PARTIAL' : 'PAID', payments: [], instalments: [], legacyPaidMarker: false } as SalesPaymentSummary } as unknown as SalesOrderView;
}

test('two scheduled thirds are exact independent receipts, not two invoice values', () => {
  const first = payment();
  const second = payment({ id: 2, amountEur: 2000, receivedAt: '2026-10-02T12:17:00Z', reference: 'Na productie' });
  const final = payment({ id: 3, salesOrderId: 13, amountEur: 300, purpose: 'PARTNER_SETTLEMENT', receivedAt: '2026-11-03T11:42:00Z' });
  assert.deepEqual(incomingMoneyTotals([first, first, second, final]), { count: 3, receivedEur: 3300, grossReceivedEur: 3300, refundedEur: 0, standardEur: 0, partnerAdvanceEur: 3000, partnerSettlementEur: 300, offsetEur: 0 });
  assert.equal(incomingMoneyTotals([first, second, final], '2026-09-01', '2026-09-30').receivedEur, 1000);
  assert.equal(uniqueIncomingPayments([first, second, final])[0].id, 3);
});

test('received moment is the entered timezone calendar date and includes exact hours/minutes', () => {
  const late = payment({ receivedAt: '2026-09-08T22:17:00Z' });
  assert.equal(paymentLocalDay(late), '2026-09-09');
  assert.match(paymentMomentLabel(late), /00:17/);
  assert.equal(paymentMomentLabel(late, '2026-10-16'), '9 sep · 00:17', 'the day and month of this year, then the clock');
  assert.equal(paymentMomentLabel(late, '2027-01-02'), '9 sep 2026 · 00:17', 'another year names it');
  assert.equal(paymentMomentLabel(late), '9 sep 2026 · 00:17', 'without today the year stays');
  assert.equal(paymentMomentLabel(payment({ receivedAt: '2026-10-08T21:21:00Z' }), '2026-10-16'), '8 okt · 23:21');
  assert.equal(incomingMoneyTotals([late], '2026-09-09', '2026-09-09').count, 1);
  assert.equal(incomingMoneyTotals([late], '2026-09-08', '2026-09-08').count, 0);
});

test('a moment recorded in another zone names that zone; Brussels and a zone with the same clock do not', () => {
  // Review 2026-10-17: "8 okt · 23:21" printed the receipt's own clock without its zone, so it read as Brussels time.
  const shanghai = payment({ receivedAt: '2026-10-08T21:21:00Z', timeZone: 'Asia/Shanghai' });
  assert.equal(foreignZoneName(shanghai), 'GMT+8');
  assert.equal(paymentMomentLabel(shanghai, '2026-10-16'), '9 okt · 05:21 · GMT+8');
  assert.equal(paymentMomentLabel(payment({ receivedAt: '2026-10-08T21:21:00Z', timeZone: 'Europe/Amsterdam' }), '2026-10-16'), '8 okt · 23:21', 'the same clock as Brussels');
  assert.equal(foreignZoneName(payment({ receivedAt: '2026-10-08T21:21:00Z' })), '');
  assert.equal(paymentMomentLabel(payment({ receivedAt: '2026-10-08T21:21:00Z', timeZone: '' }), '2026-10-16'), '8 okt · 23:21', 'no zone is Brussels');
});

test('a receipt entered with a date only (00:00) reads its day without a clock where the caller asks for it', () => {
  const dateOnly = payment({ receivedAt: '2026-10-13T22:00:00Z' });
  assert.equal(paymentMomentLabel(dateOnly, '2026-10-16', true), '14 okt');
  assert.equal(paymentMomentLabel(dateOnly, '2026-10-16'), '14 okt · 00:00', 'balance readings and bank stamps keep their clock');
  assert.equal(paymentMomentLabel(payment({ receivedAt: '2026-09-08T22:17:00Z' }), '2026-10-16', true), '9 sep · 00:17');
});

test('partial, overpaid, cancelled and credit invoices have distinct receivable outcomes', () => {
  const partial = invoice(1, 3000, 1000, { partnerPurchaseOrderId: 4, paidAt: '2026-09-08T12:00:00Z' });
  assert.equal(invoiceReceivable(partial).remainingEur, 2000, 'explicit payment summary wins over the old marker');
  const totals = receivableTotals([partial, invoice(2, 300, 500), invoice(3, 900, 0, { status: 'GEANNULEERD' }), invoice(4, 700, 0, { status: 'CONCEPT' }), invoice(5, -100, 0)]);
  assert.deepEqual(totals, { count: 1, totalEur: 2000, partnerEur: 2000, standardEur: 0, overpaidEur: 200, creditEur: 100, partialCount: 1, creditNoteCount: 0, creditNoteEur: 0 });
});

test('credit notes are tegoeden, never open invoices; a verrekening is no cash', () => {
  const creditNote = (id: number, credit: number, status = 'UITGEREIKT'): SalesOrderView => ({ order: { id, docType: 'CREDITNOTA', status, orderDate: '2026-09-25', number: `CN-${id}`, creditedInvoiceId: 1 },
    priced: { totals: { totalInclVat: 220.2 } }, paymentSummary: { invoiceTotalEur: -220.2, receivedEur: 0, remainingEur: 0, overpaidEur: 0, creditEur: credit, refundableEur: credit, status: credit > 0 ? 'CREDIT' : 'PAID', payments: [], instalments: [], legacyPaidMarker: false } } as unknown as SalesOrderView);
  assert.deepEqual(invoiceReceivable(creditNote(55, 220.2)), { receivedEur: 0, remainingEur: 0, overpaidEur: 0, creditEur: 220.2 });
  const bare = { ...creditNote(56, 0), paymentSummary: null } as unknown as SalesOrderView;
  assert.equal(invoiceReceivable(bare).creditEur, 220.2, 'without a summary the whole credit note is the tegoed');
  assert.equal(invoiceReceivable({ ...bare, order: { ...bare.order, status: 'BETAALD' } } as unknown as SalesOrderView).creditEur, 0);
  const totals = receivableTotals([invoice(1, 3000, 1000), creditNote(55, 220.2), creditNote(57, 0), creditNote(58, 50, 'CONCEPT'), creditNote(59, 50, 'GEANNULEERD')]);
  assert.deepEqual(totals, { count: 1, totalEur: 2000, partnerEur: 0, standardEur: 2000, overpaidEur: 0, creditEur: 220.2, partialCount: 1, creditNoteCount: 1, creditNoteEur: 220.2 });
  /* An overpaid invoice is a credit too, but not a tegoed the outlook or the sublines chase. */
  const mixed = receivableTotals([invoice(1, 3000, 1000), invoice(2, -100, 0), creditNote(55, 220.2)]);
  assert.equal(mixed.creditEur, 320.2);
  assert.equal(mixed.creditNoteEur, 220.2);
  assert.equal(mixed.creditNoteCount, 1);
  const offsetCredit = payment({ id: 9, amountEur: -120.2, offsetOrderId: 1, offsetPaymentId: 10, purpose: 'STANDARD' });
  const offsetInvoice = payment({ id: 10, salesOrderId: 1, amountEur: 120.2, offsetOrderId: 55, offsetPaymentId: 9, purpose: 'STANDARD' });
  const money = incomingMoneyTotals([payment({ amountEur: 500, purpose: 'STANDARD' }), offsetCredit, offsetInvoice]);
  assert.deepEqual(money, { count: 1, receivedEur: 500, grossReceivedEur: 500, refundedEur: 0, standardEur: 500, partnerAdvanceEur: 0, partnerSettlementEur: 0, offsetEur: 120.2 });
});

test('issued unpaid advance plus a final net claim remains two non-duplicated receivables', () => {
  // Final economic value 3300 minus already issued advance 3000 gives a final claim of 300.
  const docs = [invoice(1, 3000, 1000, { partnerPurchaseOrderId: 4 }), invoice(2, 300, 0, { partnerPurchaseOrderId: 4 })];
  assert.equal(receivableTotals(docs).totalEur, 2300);
});

test('archiving an invoice changes its list location, not its unpaid debt', () => {
  assert.equal(receivableTotals([invoice(1, 600, 200, { archivedAt: '2026-09-08T10:00:00Z' })]).totalEur, 400);
});

test('explicit sale purpose determines the receivable category even with a historical container link', () => {
  const totals = receivableTotals([
    invoice(1, 600, 200, { purpose: 'STANDARD', partnerPurchaseOrderId: 4 }),
    invoice(2, 900, 300, { purpose: 'PARTNER_ADVANCE' }),
  ]);
  assert.equal(totals.standardEur, 400);
  assert.equal(totals.partnerEur, 600);
});

test('refunds reduce net cash while gross receipts and refunded cash stay visible', () => {
  const totals = incomingMoneyTotals([payment({ amountEur: 150 }), payment({ id: 2, amountEur: -29 })]);
  assert.equal(totals.receivedEur, 121);
  assert.equal(totals.grossReceivedEur, 150);
  assert.equal(totals.refundedEur, 29);
  assert.equal(totals.partnerAdvanceEur, 121);
  assert.equal(uniqueIncomingPayments([payment({ amountEur: -29 })]).length, 1);
});

test('openInvoiceRows are exactly the open invoices receivableTotals counts', () => {
  const creditNote = { order: { id: 55, docType: 'CREDITNOTA', status: 'UITGEREIKT', orderDate: '2026-09-25', number: 'CN-55' }, priced: { totals: { totalInclVat: 220.2 } },
    paymentSummary: { invoiceTotalEur: -220.2, receivedEur: 0, remainingEur: 0, overpaidEur: 0, creditEur: 220.2, status: 'CREDIT', payments: [], instalments: [], legacyPaidMarker: false } } as unknown as SalesOrderView;
  const views = [invoice(1, 3000, 1000, { partnerPurchaseOrderId: 4 }), invoice(2, 300, 500), invoice(3, 900, 0, { status: 'GEANNULEERD' }), invoice(4, 700, 0, { status: 'CONCEPT' }),
    invoice(5, -100, 0), invoice(6, 400, 0, { archivedAt: '2026-09-08T10:00:00Z' }), creditNote];
  const rows = openInvoiceRows(views);
  const totals = receivableTotals(views);
  assert.deepEqual(rows.map((row) => row.view.order.id), [1, 6]);
  assert.deepEqual(rows.map((row) => [row.receivedEur, row.remainingEur]), [[1000, 2000], [0, 400]]);
  assert.equal(rows.length, totals.count);
  assert.equal(Math.round(rows.reduce((sum, row) => sum + row.remainingEur, 0) * 100) / 100, totals.totalEur);
});
