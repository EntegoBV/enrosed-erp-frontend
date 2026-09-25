import assert from 'node:assert/strict';
import test from 'node:test';
import type { SalesOrderView } from '../src/app/core/api/models.ts';
import { canReopenSalesDocument } from '../src/app/features/sales/sales-reopen.ts';

const view = (order: Record<string, unknown>, extra: Record<string, unknown> = {}): SalesOrderView => ({
  order: { status: 'UITGEREIKT', docType: 'FACTUUR', archivedAt: null, paidAt: null, goodsShippedAt: null, signedByName: null, goodsReturnedAt: null, ...order },
  paymentSummary: { payments: [] }, ...extra,
} as unknown as SalesOrderView);

test('an invoice with a live credit note, concept included, cannot go back to concept', () => {
  assert.equal(canReopenSalesDocument(view({})), true);
  assert.equal(canReopenSalesDocument(view({}, { creditNotes: [{ id: 54, number: 'CN-2026-0001', status: 'CONCEPT', totalInclVatEur: 101.52, creditReason: 'SHORT_DELIVERY' }] })), false);
  assert.equal(canReopenSalesDocument(view({}, { creditNotes: [] })), true);
});

test('a credit note reopens like an invoice: never after money moved or goods went back into stock', () => {
  assert.equal(canReopenSalesDocument(view({ docType: 'CREDITNOTA' })), true);
  assert.equal(canReopenSalesDocument(view({ docType: 'CREDITNOTA', status: 'GEANNULEERD' })), true, 'cancelled credit notes can be reopened');
  assert.equal(canReopenSalesDocument(view({ docType: 'CREDITNOTA' }, { paymentSummary: { payments: [{ id: 1, amountEur: -120.2, offsetPaymentId: 2 }] } })), false, 'an offset is money history');
  assert.equal(canReopenSalesDocument(view({ docType: 'CREDITNOTA', goodsReturnedAt: '2026-09-25T10:00:00Z' })), false);
  assert.equal(canReopenSalesDocument(view({ docType: 'CREDITNOTA', status: 'CONCEPT' })), false);
  assert.equal(canReopenSalesDocument(view({ docType: 'CREDITNOTA', status: 'BETAALD', paidAt: '2026-09-25T10:00:00Z' })), false, 'a settled credit note stays settled');
});

test('a quote that became an invoice still cannot reopen', () => {
  assert.equal(canReopenSalesDocument(view({ docType: 'OFFERTE', status: 'VERZONDEN' }, { invoicedAsId: 44 })), false);
  assert.equal(canReopenSalesDocument(view({ docType: null, status: 'VERZONDEN' }, { invoicedAsId: 44 })), false);
  assert.equal(canReopenSalesDocument(view({ docType: 'OFFERTE', status: 'VERZONDEN' })), true);
});
