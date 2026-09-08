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
  assert.deepEqual(incomingMoneyTotals([first, first, second, final]), { count: 3, receivedEur: 3300, standardEur: 0, partnerAdvanceEur: 3000, partnerSettlementEur: 300 });
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
  assert.deepEqual(totals, { count: 1, totalEur: 2000, partnerEur: 2000, standardEur: 0, overpaidEur: 200, creditEur: 100, partialCount: 1 });
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
