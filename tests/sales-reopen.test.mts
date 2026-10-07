import assert from 'node:assert/strict';
import test from 'node:test';
import type { SalesOrderView } from '../src/app/core/api/models.ts';
import { canCreateInvoiceFromQuote, webOrderNeedsApproval, webOrderNotice } from '../src/app/features/sales/sales-invoice-actions.ts';
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

const webOrder = (changes: Record<string, unknown> = {}) => ({
  revision: 1, accountEmail: 'inkoop@bloemist.example', placedAt: '2026-10-07T09:00:00Z', customerEditable: false,
  customerChangedAt: null, customerChangeSummary: null, customerCancelledAt: null,
  processingStartedAt: '2026-10-07T10:00:00Z', processingStartedBy: 'Emre', processingTrigger: 'KNOP', termsState: 'ORDER_EQUAL',
  orderedTotalExclVat: 210.72, orderedTotalInclVat: 254.97, differences: [], receivedMailSentAt: null, processingMailSentAt: null, mailError: null, mailDue: false,
  ...changes,
});
const quote = (order: Record<string, unknown>, block: Record<string, unknown> | null) =>
  view({ docType: 'OFFERTE', status: 'CONCEPT', sentAt: null, ...order }, block ? { webOrder: block } : {});

test('a website order the customer cancelled cannot be reopened; one staff cancelled can', () => {
  assert.equal(canReopenSalesDocument(quote({ status: 'GEANNULEERD' }, webOrder({ processingStartedAt: null, customerCancelledAt: '2026-10-07T11:00:00Z' }))), false);
  assert.equal(canReopenSalesDocument(quote({ status: 'GEANNULEERD' }, webOrder())), true, 'cancelled by staff');
  assert.equal(canReopenSalesDocument(quote({ status: 'GEANNULEERD' }, null)), true, 'an older backend sends no block');
});

test('a website order is invoiced only after it was taken, with the ordered or the approved figures', () => {
  assert.equal(canCreateInvoiceFromQuote(quote({}, null)), true);
  assert.equal(canCreateInvoiceFromQuote(quote({}, webOrder())), true);
  assert.equal(canCreateInvoiceFromQuote(quote({}, webOrder({ customerEditable: true, processingStartedAt: null }))), false, 'the customer can still change it');
  for (const termsState of ['ORDER_DIFFERENT', 'ORDER_UNKNOWN', 'RESEND_REQUIRED', 'AWAITING_APPROVAL', null]) {
    assert.equal(canCreateInvoiceFromQuote(quote({}, webOrder({ termsState }))), false, String(termsState));
  }
  assert.equal(canCreateInvoiceFromQuote(quote({ status: 'GEACCEPTEERD' }, webOrder({ termsState: 'APPROVED' }))), true);
  assert.equal(canCreateInvoiceFromQuote(quote({ status: 'GEACCEPTEERD' }, webOrder({ termsState: 'RESEND_REQUIRED' }))), false);
  assert.equal(webOrderNeedsApproval(quote({}, webOrder({ termsState: 'ORDER_DIFFERENT' }))), true);
  assert.equal(webOrderNeedsApproval(quote({}, webOrder({ termsState: 'RESEND_REQUIRED' }))), true);
  assert.equal(webOrderNeedsApproval(quote({ status: 'VERZONDEN' }, webOrder({ termsState: 'RESEND_REQUIRED' }))), false, 'a sent order is resent, not sent for approval');
  assert.equal(webOrderNeedsApproval(quote({}, webOrder())), false);
  assert.equal(webOrderNeedsApproval(quote({}, webOrder({ customerEditable: true, processingStartedAt: null, termsState: 'ORDER_UNKNOWN' }))), false, 'not before it is taken');
  assert.equal(webOrderNeedsApproval(quote({}, null)), false);
});

test('the website order banner says who can act and compares the saved document with the order', () => {
  const when = (value: string | null | undefined) => `<${value}>`;
  const lines = (order: Record<string, unknown>, block: Record<string, unknown> | null, unsaved = false) => webOrderNotice(quote(order, block), when, unsaved);
  assert.equal(lines({}, null), null);
  assert.equal(lines({ status: 'GEANNULEERD' }, webOrder({ processingStartedAt: null, customerCancelledAt: '2026-10-07T11:00:00Z' })), null);
  assert.deepEqual(lines({}, webOrder({ customerEditable: true, processingStartedAt: null })),
    { lead: 'de klant kan nog wijzigen. Neem ze in verwerking om te bewerken, te versturen of te factureren.', lines: [] });
  assert.deepEqual(lines({}, webOrder({ customerEditable: true, processingStartedAt: null, revision: 3, customerChangedAt: '2026-10-07T09:30:00Z', customerChangeSummary: '2 regels gewijzigd' }))?.lines,
    [{ text: 'Door de klant gewijzigd op <2026-10-07T09:30:00Z> · versie 3: 2 regels gewijzigd', gold: false }]);
  assert.deepEqual(lines({}, webOrder()), { lead: 'in verwerking sinds <2026-10-07T10:00:00Z> door Emre',
    lines: [{ text: 'Gelijk aan de bestelling van de klant (€ 210,72 excl. btw): factuur maken zonder versturen kan.', gold: false }] });
  assert.equal(lines({}, webOrder({ processingTrigger: 'AUTOMATISCH' }))?.lead, 'in verwerking sinds <2026-10-07T10:00:00Z> door Emre (automatisch bij een wijziging)');
  assert.deepEqual(lines({}, webOrder({ termsState: 'ORDER_DIFFERENT', differences: ['vracht € 45,00 in plaats van € 30,00', 'Roos rood: 96 in plaats van 48'] }))?.lines,
    [{ text: 'Wijkt af van de bestelling van de klant: vracht € 45,00 in plaats van € 30,00 · Roos rood: 96 in plaats van 48. Verstuur ter goedkeuring.', gold: true }]);
  assert.deepEqual(lines({}, webOrder({ termsState: 'ORDER_UNKNOWN' }))?.lines, [{ text: 'De vracht of een prijs stond nog open toen de klant bestelde. Verstuur ter goedkeuring.', gold: true }]);
  assert.match(lines({ sentAt: '2026-10-07T12:00:00Z' }, webOrder({ termsState: 'RESEND_REQUIRED' }))!.lines[0].text, /^Deze bestelling is al ter goedkeuring verstuurd\./);
  assert.match(lines({ status: 'BEKEKEN' }, webOrder({ termsState: 'RESEND_REQUIRED' }))!.lines[0].text, /^Gewijzigd na het versturen:/);
  assert.match(lines({ status: 'GEACCEPTEERD' }, webOrder({ termsState: 'RESEND_REQUIRED' }))!.lines[0].text, /^De cijfers wijken af van de versie waarmee de klant akkoord ging\./);
  assert.deepEqual(lines({ status: 'VERZONDEN' }, webOrder({ termsState: 'AWAITING_APPROVAL' }))?.lines, [{ text: 'Ter goedkeuring bij de klant. Factureren kan na akkoord.', gold: false }]);
  assert.deepEqual(lines({ status: 'GEACCEPTEERD' }, webOrder({ termsState: 'APPROVED' }))?.lines, [{ text: 'Door de klant goedgekeurd: factuur maken kan.', gold: false }]);
  assert.deepEqual(lines({ status: 'VERLOPEN' }, webOrder({ termsState: null }))?.lines, []);
  assert.deepEqual(lines({ archivedAt: '2026-10-08T08:00:00Z' }, webOrder())?.lines, [], 'an archived order compares nothing');
  assert.deepEqual(lines({}, webOrder({ termsState: 'ORDER_DIFFERENT', differences: ['x'] }), true)?.lines, [{ text: 'Sla eerst op om te vergelijken met de bestelling.', gold: false }]);
});
