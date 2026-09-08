import assert from 'node:assert/strict';
import test from 'node:test';
import type { SalesOrder, SalesOrderView } from '../src/app/core/api/models.ts';
import { receiptInstant, receiptLocalParts, receiptRequest } from '../src/app/shared/received-at.ts';
import { displayedPaymentTerms, displayedSalesProfit, isPartnerDocument, salesPurpose, withPaymentState } from '../src/app/features/sales/sales-payment-state.ts';

test('receipt timestamps retain local date and time in summer and winter', () => {
  assert.equal(receiptInstant('2026-09-08', '16:45:21', 'Europe/Brussels'), '2026-09-08T14:45:21.000Z');
  assert.equal(receiptInstant('2026-01-08', '16:45', 'Europe/Brussels'), '2026-01-08T15:45:00.000Z');
  assert.deepEqual(receiptLocalParts('2026-09-08T14:45:21Z', 'Europe/Brussels'), { day: '2026-09-08', time: '16:45:21' });
  assert.equal(receiptInstant('2026-09-08', '00:15', 'Asia/Shanghai'), '2026-09-07T16:15:00.000Z');
});

test('nonexistent dates, clock-change gaps and ambiguous winter times cannot silently become another receipt time', () => {
  assert.throws(() => receiptInstant('2026-02-30', '14:00', 'Europe/Brussels'), /bestaat niet/);
  assert.throws(() => receiptInstant('2026-03-29', '02:30', 'Europe/Brussels'), /zomertijd/);
  assert.throws(() => receiptInstant('2026-10-25', '02:30', 'Europe/Brussels'), /tweemaal/);
  assert.throws(() => receiptInstant('2026-09-08', '24:30', 'Europe/Brussels'), /bestaat niet/);
  assert.throws(() => receiptInstant('2026-09-08', '14:00', 'Wrong/Zone'), /tijdzone/);
  assert.equal(receiptInstant('2026-10-25', '01:30', 'UTC'), '2026-10-25T01:30:00.000Z');
});

test('receipt amounts use exact cents and actual timestamps, while references are normalized', () => {
  const draft = { amount: 333.33, day: '2026-09-08', time: '10:30', timeZone: 'Europe/Brussels', reference: '  Voorschot productie  ' };
  assert.deepEqual(receiptRequest(draft, Date.parse('2026-09-08T12:00:00Z')), {
    amountEur: 333.33, receivedAt: '2026-09-08T08:30:00.000Z', timeZone: 'Europe/Brussels', reference: 'Voorschot productie',
  });
  for (const amount of [0, -5, NaN, Infinity, 0.001]) assert.throws(() => receiptRequest({ ...draft, amount }));
  assert.throws(() => receiptRequest(draft, Date.parse('2026-09-01T12:00:00Z')), /toekomst/);
});

test('explicit ordinary sale remains ordinary for the same customer and historical container link', () => {
  const ordinary = { purpose: 'STANDARD', partnerPurchaseOrderId: 22, partnerSettlement: true } as SalesOrder;
  assert.equal(salesPurpose(ordinary), 'STANDARD');
  assert.equal(isPartnerDocument(ordinary), false);
  assert.equal(salesPurpose({ partnerPurchaseOrderId: 22, partnerSettlement: false } as SalesOrder), 'PARTNER_ADVANCE');
  assert.equal(salesPurpose({ purpose: 'PARTNER_SETTLEMENT' } as SalesOrder), 'PARTNER_SETTLEMENT');
});

test('incoming payment refresh preserves draft line prices and customer notes', () => {
  const current = { order: { id: 1, status: 'VERZONDEN', notes: 'Unsaved note', lines: [{ unitPriceEur: 99 }] }, priced: { totals: { total: 99 } } } as SalesOrderView;
  const fresh = { order: { id: 1, status: 'BETAALD', notes: 'Old note', lines: [{ unitPriceEur: 50 }], paidAt: '2026-09-08T08:30:00Z' }, paymentSummary: { receivedEur: 100 }, accounting: { recognizedRevenueEur: 100 } } as SalesOrderView;
  const merged = withPaymentState(current, fresh);
  assert.equal(merged.order.notes, 'Unsaved note');
  assert.equal(merged.order.lines[0].unitPriceEur, 99);
  assert.equal(merged.order.status, 'BETAALD');
  assert.equal(merged.paymentSummary?.receivedEur, 100);
});

test('partner advance and draft settlement never display commercial margin as realized result', () => {
  const view = { order: { purpose: 'PARTNER_ADVANCE', docType: 'FACTUUR', status: 'BETAALD', partnerPurchaseOrderId: 1 },
    priced: { totals: { marginEur: -1500 } }, accounting: { recognizedProfitEur: 300 } } as SalesOrderView;
  assert.equal(displayedSalesProfit(view), 0);
  assert.equal(displayedSalesProfit({ ...view, order: { ...view.order, purpose: 'PARTNER_SETTLEMENT' } }), 300);
  assert.equal(displayedSalesProfit({ ...view, order: { ...view.order, purpose: 'PARTNER_SETTLEMENT', status: 'CONCEPT' } }), 0);
  assert.equal(displayedSalesProfit({ ...view, order: { ...view.order, purpose: 'STANDARD' } }), -1500);
});

test('production payment plan overrides legacy terms while ordinary sale terms stay intact', () => {
  const partner = { partnerPurchaseOrderId: 31, paymentPlan: 'THIRD_TWO_THIRDS_PRODUCTION', paymentTerms: null } as SalesOrder;
  assert.equal(displayedPaymentTerms(partner, 'betaalvoorwaarden van de klant'), '1/3 bij start productie, 2/3 na productie');
  assert.equal(displayedPaymentTerms({ ...partner, paymentTerms: '50% voorschot / 50% bij levering' }), '1/3 bij start productie, 2/3 na productie');
  assert.equal(displayedPaymentTerms({ ...partner, paymentPlan: 'FULL' }), 'Volledige betaling');
  assert.equal(displayedPaymentTerms({ ...partner, purpose: 'STANDARD', paymentPlan: 'FULL', paymentTerms: '30 dagen' }), '30 dagen');
  assert.equal(displayedPaymentTerms({ ...partner, purpose: 'STANDARD', paymentPlan: 'FULL' }, '14 dagen'), '14 dagen');
});
