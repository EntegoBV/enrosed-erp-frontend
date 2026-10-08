import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancelledByCustomer, countsAsNewWebsiteItem, customerCanStillChange, customerRevised, isWebOrder, isWebOrderConflict,
  replaceInternalNotesForDisplay, statusOf, webOrderDeletable, webOrderInProcessing, webOrderInvoiceable, webOrderMailDue,
  webOrderMailRepeatable, webOrderRevision, webOrderTermsState,
} from '../src/app/features/sales/quote-status.ts';
import type { SalesOrder, SalesOrderView, SalesWebOrder, SalesWebOrderTermsState } from '../src/app/core/api/models.ts';

const credit = (status: string, summary: { status: string; creditEur: number } | null) =>
  ({ order: { status, docType: 'CREDITNOTA' }, paymentSummary: summary } as Parameters<typeof statusOf>[0]);
const invoice = (status: string, summaryStatus: string, total: number, creditedEur?: number) =>
  ({ order: { status, docType: 'FACTUUR' }, paymentSummary: { status: summaryStatus, invoiceTotalEur: total }, creditedEur } as Parameters<typeof statusOf>[0]);

test('a credit note reads Concept, Tegoed open, Afgehandeld or Geannuleerd; the mail state only without money', () => {
  assert.deepEqual(statusOf(credit('CONCEPT', { status: 'CREDIT', creditEur: 100 })), { label: 'Concept', cls: 'neutral' });
  assert.deepEqual(statusOf(credit('UITGEREIKT', { status: 'CREDIT', creditEur: 220.2 })), { label: 'Tegoed open', cls: 'gold' });
  assert.deepEqual(statusOf(credit('VERZONDEN', { status: 'CREDIT', creditEur: 50 })), { label: 'Tegoed open', cls: 'gold' });
  assert.deepEqual(statusOf(credit('UITGEREIKT', { status: 'PAID', creditEur: 0 })), { label: 'Afgehandeld', cls: 'ok' });
  assert.deepEqual(statusOf(credit('BETAALD', null)), { label: 'Afgehandeld', cls: 'ok' });
  assert.deepEqual(statusOf(credit('UITGEREIKT', null)), { label: 'Uitgereikt · niet gemaild', cls: 'rose' });
  assert.deepEqual(statusOf(credit('VERZONDEN', null)), { label: 'Uitgereikt', cls: 'rose' });
  assert.deepEqual(statusOf(credit('GEANNULEERD', { status: 'CREDIT', creditEur: 0 })), { label: 'Geannuleerd', cls: 'neutral' });
});

test('an invoice reads Gecrediteerd once its credit notes took the whole claim back, else as before', () => {
  assert.deepEqual(statusOf(invoice('UITGEREIKT', 'PAID', 5120, 5120)), { label: 'Gecrediteerd', cls: 'neutral' });
  assert.deepEqual(statusOf(invoice('UITGEREIKT', 'UNPAID', 5120, 5120.004)), { label: 'Gecrediteerd', cls: 'neutral' });
  assert.deepEqual(statusOf(invoice('BETAALD', 'PAID', 5120, 220.2)), { label: 'Betaald', cls: 'ok' });
  assert.deepEqual(statusOf(invoice('UITGEREIKT', 'PARTIAL', 6350.4, 0)), { label: 'Deels betaald', cls: 'gold' });
  assert.deepEqual(statusOf(invoice('UITGEREIKT', 'UNPAID', 2178)), { label: 'Uitgereikt · niet gemaild', cls: 'rose' });
  assert.deepEqual(statusOf(invoice('CONCEPT', 'UNPAID', 100, 100)), { label: 'Concept', cls: 'neutral' }, 'a concept is never credited');
});

/* ---------------------------------------------------------------- website orders */

const ORDER_NOTES = '[WEBSITE_AANVRAAG] OFF-2026-0412\nWebsitebestelling van een ingelogde klant; bindend na bevestiging door Enrosed.\nBesteld via klantlogin inkoop@bloemenhuis.example';
const webOrder = (patch: Partial<SalesWebOrder> = {}): SalesWebOrder => ({
  revision: 1, accountEmail: 'inkoop@bloemenhuis.example', placedAt: '2026-10-08T09:12:00Z', customerEditable: true,
  customerChangedAt: null, customerChangeSummary: null, customerCancelledAt: null,
  processingStartedAt: null, processingStartedBy: null, processingTrigger: null,
  termsState: 'ORDER_EQUAL', orderedTotalExclVat: 210.72, orderedTotalInclVat: 254.97, differences: [],
  receivedMailSentAt: '2026-10-08T09:12:04Z', processingMailSentAt: null, mailError: null, mailDue: false, ...patch,
});
const taken = (patch: Partial<SalesWebOrder> = {}): SalesWebOrder => webOrder({
  customerEditable: false, processingStartedAt: '2026-10-08T10:00:00Z', processingStartedBy: 'Emre', processingTrigger: 'KNOP',
  processingMailSentAt: '2026-10-08T10:00:03Z', ...patch,
});
const doc = (block: SalesWebOrder | null | undefined, order: Partial<SalesOrder> = {}, rest: Partial<SalesOrderView> = {}): SalesOrderView => ({
  order: { id: 7, status: 'CONCEPT', docType: 'OFFERTE', sentAt: null, archivedAt: null, internalNotes: ORDER_NOTES, ...order },
  ...(block === undefined ? {} : { webOrder: block }), ...rest,
} as SalesOrderView);
const DELIVERY = { fulfillment: 'DELIVERY', address: 'Kerkstraat 1', postalCode: '9000', city: 'Gent', countryCode: 'BE',
  pickupLabel: null, pickupAddress: null, contactName: 'An', phone: '+32 9 000 00 00', differsFromCustomerRecord: true } as const;

test('without a webOrder block every helper answers as for a plain document', () => {
  for (const view of [doc(undefined), doc(null), doc(undefined, {}, { delivery: null })]) {
    assert.equal(isWebOrder(view), false);
    assert.equal(customerCanStillChange(view), false);
    assert.equal(customerRevised(view), false);
    assert.equal(cancelledByCustomer(view), false);
    assert.equal(webOrderInProcessing(view), false);
    assert.equal(webOrderRevision(view), null);
    assert.equal(webOrderDeletable(view), true);
    assert.equal(webOrderTermsState(view), null);
    assert.equal(webOrderInvoiceable(view), true);
    assert.equal(webOrderMailDue(view), false);
    assert.equal(webOrderMailRepeatable(view), null);
    assert.equal(countsAsNewWebsiteItem(view), true, 'a legacy website request is still new work');
  }
  for (const view of [null, undefined]) {
    assert.equal(isWebOrder(view), false);
    assert.equal(customerCanStillChange(view), false);
    assert.equal(webOrderInProcessing(view), false);
    assert.equal(webOrderRevision(view), null);
    assert.equal(webOrderDeletable(view), true);
    assert.equal(webOrderTermsState(view), null);
    assert.equal(webOrderInvoiceable(view), true);
    assert.equal(webOrderMailRepeatable(view), null);
  }
  assert.equal(countsAsNewWebsiteItem(doc(undefined, { internalNotes: 'Eigen notitie' })), false, 'a staff concept was never website work');
});

test('an order the customer can still change is new, not deletable and shows no terms state', () => {
  const view = doc(webOrder());
  assert.equal(isWebOrder(view), true);
  assert.equal(customerCanStillChange(view), true);
  assert.equal(customerRevised(view), false, 'revision 1 is the order as placed');
  assert.equal(cancelledByCustomer(view), false);
  assert.equal(webOrderInProcessing(view), false);
  assert.equal(webOrderRevision(view), 1);
  assert.equal(webOrderDeletable(view), false);
  assert.equal(webOrderTermsState(view), null, 'no compare line before the order is taken');
  assert.equal(countsAsNewWebsiteItem(view), true);
});

test('a revised order reports its revision and counts as changed only while the customer may still change it', () => {
  const view = doc(webOrder({ revision: 3, customerChangedAt: '2026-10-08T09:40:00Z', customerChangeSummary: '2 producten gewijzigd' }));
  assert.equal(customerRevised(view), true);
  assert.equal(webOrderRevision(view), 3);
  assert.equal(customerRevised(doc(taken({ revision: 3 }))), false, 'after the take it is no longer the customer\'s to change');
});

test('a taken order is in processing and passes on the terms state of the server, null included', () => {
  const states: (SalesWebOrderTermsState | null)[] = ['ORDER_EQUAL', 'ORDER_DIFFERENT', 'ORDER_UNKNOWN', 'AWAITING_APPROVAL', 'RESEND_REQUIRED', 'APPROVED', null];
  for (const termsState of states) {
    const view = doc(taken({ termsState }));
    assert.equal(customerCanStillChange(view), false);
    assert.equal(webOrderInProcessing(view), true);
    assert.equal(webOrderTermsState(view), termsState);
    assert.equal(webOrderInvoiceable(view), termsState === 'ORDER_EQUAL' || termsState === 'APPROVED', String(termsState));
    assert.equal(webOrderDeletable(view), false);
    assert.equal(countsAsNewWebsiteItem(view), false, 'in processing is no longer new');
  }
});

test('a sent and an accepted order keep their terms state but are past processing', () => {
  const sent = doc(taken({ termsState: 'AWAITING_APPROVAL' }), { status: 'VERZONDEN', sentAt: '2026-10-08T11:00:00Z' });
  assert.equal(webOrderInProcessing(sent), false);
  assert.equal(webOrderTermsState(sent), 'AWAITING_APPROVAL');
  assert.equal(webOrderInvoiceable(sent), false);
  assert.equal(webOrderDeletable(sent), false);
  assert.equal(countsAsNewWebsiteItem(sent), false);
  const changedAfterSending = doc(taken({ termsState: 'RESEND_REQUIRED' }), { status: 'BEKEKEN', sentAt: '2026-10-08T11:00:00Z' });
  assert.equal(webOrderTermsState(changedAfterSending), 'RESEND_REQUIRED');
  assert.equal(webOrderInvoiceable(changedAfterSending), false);
  const accepted = doc(taken({ termsState: 'APPROVED' }), { status: 'GEACCEPTEERD', sentAt: '2026-10-08T11:00:00Z' });
  assert.equal(webOrderInProcessing(accepted), false);
  assert.equal(webOrderTermsState(accepted), 'APPROVED');
  assert.equal(webOrderInvoiceable(accepted), true);
  assert.equal(webOrderDeletable(doc(taken({ termsState: null }), { status: 'AFGEWEZEN' })), true, 'a declined order may be deleted');
});

test('an archived order shows no terms state and is not in processing', () => {
  const view = doc(taken(), { archivedAt: '2026-10-08T12:00:00Z' });
  assert.equal(webOrderTermsState(view), null);
  assert.equal(webOrderInProcessing(view), false);
  assert.equal(isWebOrder(view), true);
});

test('a customer-cancelled order is cancelled by the customer, deletable and offers nothing else', () => {
  const view = doc(webOrder({ revision: 2, customerEditable: false, customerCancelledAt: '2026-10-08T09:50:00Z', termsState: null }), { status: 'GEANNULEERD' });
  assert.equal(cancelledByCustomer(view), true);
  assert.equal(customerCanStillChange(view), false);
  assert.equal(customerRevised(view), false);
  assert.equal(webOrderInProcessing(view), false);
  assert.equal(webOrderDeletable(view), true);
  assert.equal(webOrderTermsState(view), null);
  assert.equal(webOrderInvoiceable(view), false);
  assert.equal(webOrderRevision(view), 2);
  assert.equal(countsAsNewWebsiteItem(view), false);
  assert.equal(webOrderDeletable(doc(taken({ termsState: null }), { status: 'GEANNULEERD' })), true, 'cancelled by staff is deletable too');
});

test('a derived invoice with only a delivery block is no website order', () => {
  const view = doc(undefined, { docType: 'FACTUUR', internalNotes: null }, { delivery: DELIVERY });
  assert.equal(isWebOrder(view), false);
  assert.equal(webOrderRevision(view), null);
  assert.equal(webOrderDeletable(view), true);
  assert.equal(webOrderInvoiceable(view), true);
  assert.equal(webOrderTermsState(view), null);
  assert.equal(webOrderMailDue(view), false);
  assert.equal(webOrderMailRepeatable(view), null);
  assert.equal(countsAsNewWebsiteItem(view), false);
});

test('the mail line follows mailDue, never an old error alone', () => {
  assert.equal(webOrderMailDue(doc(webOrder({ mailDue: true, receivedMailSentAt: null, mailError: 'SMTP weigert het adres' }))), true);
  assert.equal(webOrderMailDue(doc(webOrder({ mailDue: true, receivedMailSentAt: null }))), true, 'a mail that never left without a recorded error');
  assert.equal(webOrderMailDue(doc(taken({ mailError: 'SMTP weigert het adres' }))), false, 'an error of a mail that is no longer due');
});

test('the order mail can be repeated only when nothing is due and the order is still an unsent concept', () => {
  assert.equal(webOrderMailRepeatable(doc(webOrder())), '2026-10-08T09:12:04Z', 'untaken: the received mail');
  assert.equal(webOrderMailRepeatable(doc(webOrder({ receivedMailSentAt: null }))), null, 'untaken without a received date');
  assert.equal(webOrderMailRepeatable(doc(taken())), '2026-10-08T10:00:03Z', 'taken: the processing mail, not the received one');
  assert.equal(webOrderMailRepeatable(doc(taken({ processingMailSentAt: null }))), null, 'taken without a processing date never falls back to the received mail');
  assert.equal(webOrderMailRepeatable(doc(taken({ mailDue: true, processingMailSentAt: null }))), null, 'a due mail is resent, not repeated');
  assert.equal(webOrderMailRepeatable(doc(webOrder({ mailDue: true }))), null);
  assert.equal(webOrderMailRepeatable(doc(taken(), { status: 'VERZONDEN', sentAt: '2026-10-08T11:00:00Z' })), null, 'sent');
  assert.equal(webOrderMailRepeatable(doc(taken(), { sentAt: '2026-10-08T11:00:00Z' })), null, 'sent, then reopened');
  assert.equal(webOrderMailRepeatable(doc(webOrder({ customerEditable: false, customerCancelledAt: '2026-10-08T09:50:00Z' }), { status: 'GEANNULEERD' })), null, 'cancelled');
  assert.equal(webOrderMailRepeatable(doc(webOrder({ customerCancelledAt: '2026-10-08T09:50:00Z' }))), null, 'customer-cancelled, whatever the status says');
});

test('only the 409 with code WEB_ORDER_CHANGED is a website-order conflict', () => {
  const message = 'De klant heeft deze bestelling intussen gewijzigd of geannuleerd. Je wijzigingen zijn niet opgeslagen; laad de laatste versie.';
  assert.equal(isWebOrderConflict({ status: 409, error: { status: 409, code: 'WEB_ORDER_CHANGED', message, webOrderRevision: 4, timestamp: '2026-10-08T10:00:00Z' } }), true);
  assert.equal(isWebOrderConflict({ status: 409, error: { status: 409, message: 'Een websitebestelling verwijder je niet zolang ze niet geannuleerd is.' } }), false);
  assert.equal(isWebOrderConflict({ status: 409, error: { code: 'REVISION_CONFLICT', message } }), false);
  assert.equal(isWebOrderConflict({ status: 409, error: message }), false);
  assert.equal(isWebOrderConflict({ status: 500, error: { code: 'WEB_ORDER_CHANGED' } }), false);
  assert.equal(isWebOrderConflict({ status: 500, error: null }), false);
  assert.equal(isWebOrderConflict(null), false);
  assert.equal(isWebOrderConflict(new Error('offline')), false);
});

test('editing the visible note of a website order keeps line 0 verbatim', () => {
  const order = { internalNotes: `${ORDER_NOTES}\n[DOOSINHOUD_TE_BEPALEN] productId=12; sku=RB-01; cartons=3; quantityPieces=TE_BEPALEN` } as SalesOrder;
  const saved = replaceInternalNotesForDisplay(order, '  Adres nagebeld  ');
  assert.equal(saved?.split('\n')[0], '[WEBSITE_AANVRAAG] OFF-2026-0412');
  assert.equal(saved, '[WEBSITE_AANVRAAG] OFF-2026-0412\n[DOOSINHOUD_TE_BEPALEN] productId=12; sku=RB-01; cartons=3; quantityPieces=TE_BEPALEN\nAdres nagebeld');
  assert.equal(replaceInternalNotesForDisplay(order, '')?.split('\n')[0], '[WEBSITE_AANVRAAG] OFF-2026-0412');
});
