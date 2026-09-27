import assert from 'node:assert/strict';
import test from 'node:test';
import type { BankBalance, SalesOrderView, SalesPaymentSummary } from '../src/app/core/api/models.ts';
import { incomingMoneyTotals, invoiceReceivable, paymentLocalDay, paymentMomentLabel, receivableTotals, uniqueIncomingPayments } from '../src/app/features/finance/incoming-money.ts';
import type { IncomingMoneyRow } from '../src/app/features/finance/incoming-money.ts';
import { bankOverview, movementsSince } from '../src/app/features/finance/finance-metrics.ts';

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
  assert.equal(incomingMoneyTotals([late], '2026-09-09', '2026-09-09').count, 1);
  assert.equal(incomingMoneyTotals([late], '2026-09-08', '2026-09-08').count, 0);
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

test('bank counts actual receipt even without its archived invoice, once, and after the exact same-day checkpoint', () => {
  const base = { id: 1, salesOrderId: 12, date: '2026-09-08', number: 'ARCHIVED-12', customer: 'Partner', amountEur: 1000, receivedAt: '2026-09-08T08:30:00Z', timeZone: 'Europe/Brussels' };
  const later = { ...base, id: 2, amountEur: 2000, receivedAt: '2026-09-08T09:00:00Z' };
  const result = movementsSince('2026-09-08', 400, [], [], [base, later, later], '2026-09-08T08:30:00Z');
  assert.equal(result.inEur, 2000);
  assert.equal(result.currentEur, 2400);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].salesOrderId, 12);
  assert.equal(result.rows[0].receivedAt, later.receivedAt);
});

test('legacy date-only bank reading means end of bank local day, not the receipt entry timezone day', () => {
  const receipt = { id: 1, date: '2026-09-08', number: 'NY-1', customer: null, amountEur: 500, receivedAt: '2026-09-08T22:05:00Z', timeZone: 'America/New_York' };
  assert.equal(movementsSince('2026-09-08', 100, [], [], [receipt], null, 'Europe/Brussels').currentEur, 600);
  assert.equal(movementsSince('2026-09-08', 100, [], [], [{ ...receipt, receivedAt: '2026-09-08T20:00:00Z' }]).currentEur, 100);
});

test('same-day bank snapshots follow their actual checkpoint, not record ID order', () => {
  const balances: BankBalance[] = [
    { id: 30, account: 'KBC', date: '2026-09-08', balanceEur: 900, asOfAt: '2026-09-08T08:00:00Z', notes: null },
    { id: 10, account: 'KBC', date: '2026-09-08', balanceEur: 1100, asOfAt: '2026-09-08T10:00:00Z', notes: null },
  ];
  assert.equal(bankOverview(balances).totalEur, 1100);
  assert.equal(bankOverview(balances).asOfAt, '2026-09-08T10:00:00Z');
});


test('refunds reduce net cash while gross receipts and refunded cash stay visible', () => {
  const totals = incomingMoneyTotals([payment({ amountEur: 150 }), payment({ id: 2, amountEur: -29 })]);
  assert.equal(totals.receivedEur, 121);
  assert.equal(totals.grossReceivedEur, 150);
  assert.equal(totals.refundedEur, 29);
  assert.equal(totals.partnerAdvanceEur, 121);
  assert.equal(uniqueIncomingPayments([payment({ amountEur: -29 })]).length, 1);
});
