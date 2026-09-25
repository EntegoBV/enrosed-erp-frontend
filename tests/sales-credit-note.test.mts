import assert from 'node:assert/strict';
import test from 'node:test';
import type { SalesOrderView, SalesPayment, SalesPaymentSummary } from '../src/app/core/api/models.ts';
import {
  CREDIT_REASON_CHOICES, canCreateCreditNote, creditDraftTotals, creditNoteJourney, creditNoteKind, creditNoteNextStep,
  creditNoteSettlement, creditNoteStatusLabel, creditReasonLabel, creditRequestFrom, euro, isClaimDocument, isCreditNote,
  isDeadCreditNote, isOffsetPayment, signedClaim,
} from '../src/app/features/sales/sales-credit-note.ts';

const row = (input: Partial<SalesPayment>): SalesPayment => ({ id: 1, salesOrderId: 55, amountEur: -100, receivedAt: '2026-09-25T10:00:00Z', timeZone: 'Europe/Brussels',
  reference: null, recordedAt: '2026-09-25T10:00:00Z', actor: 'emre', offsetOrderId: null, offsetPaymentId: null, ...input });
const summary = (total: number, credit: number, payments: SalesPayment[] = [], status: SalesPaymentSummary['status'] = credit > 0 ? 'CREDIT' : 'PAID'): SalesPaymentSummary =>
  ({ invoiceTotalEur: -total, receivedEur: 0, remainingEur: 0, overpaidEur: 0, creditEur: credit, refundableEur: credit, status, payments, instalments: [], legacyPaidMarker: false });
const credit = (status: string, paymentSummary: SalesPaymentSummary | null, extra: Record<string, unknown> = {}): SalesOrderView => ({
  order: { id: 55, number: 'CN-2026-0002', docType: 'CREDITNOTA', status, sentAt: null, purpose: 'STANDARD', creditedInvoiceId: 38 },
  priced: { totals: { totalInclVat: 220.2 } }, paymentSummary, creditedInvoiceNumber: 'INV-2026-038', awaitingResend: false, ...extra,
} as unknown as SalesOrderView);
const invoice = (status: string, credited = 0, total = 6350.4): SalesOrderView => ({
  order: { id: 44, number: 'INV-2026-044', docType: 'FACTUUR', status }, priced: { totals: { totalInclVat: total } },
  paymentSummary: { invoiceTotalEur: total, creditEur: 0 }, creditedEur: credited, awaitingResend: false,
} as unknown as SalesOrderView);

test('document flags: a credit note is a claim document but never an invoice', () => {
  assert.equal(isCreditNote({ docType: 'CREDITNOTA' }), true);
  assert.equal(isCreditNote({ docType: 'FACTUUR' }), false);
  assert.equal(isCreditNote(null), false);
  assert.equal(isClaimDocument({ docType: 'FACTUUR' }), true);
  assert.equal(isClaimDocument({ docType: 'CREDITNOTA' }), true);
  assert.equal(isClaimDocument({ docType: 'OFFERTE' }), false);
  assert.equal(isClaimDocument({ docType: null }), false);
});

test('canCreateCreditNote needs an issued live invoice that is not fully credited', () => {
  assert.equal(canCreateCreditNote(invoice('UITGEREIKT')), true);
  assert.equal(canCreateCreditNote(invoice('BETAALD', 220.2)), true);
  assert.equal(canCreateCreditNote(invoice('VERZONDEN', 6350.4)), false, 'fully credited');
  assert.equal(canCreateCreditNote(invoice('CONCEPT')), false);
  assert.equal(canCreateCreditNote(invoice('GEANNULEERD')), false);
  assert.equal(canCreateCreditNote(credit('UITGEREIKT', summary(220.2, 220.2))), false, 'never on a credit note');
  assert.equal(canCreateCreditNote(null), false);
});

test('reasons and kinds read in Dutch and follow the document purpose', () => {
  assert.equal(creditReasonLabel('SHORT_DELIVERY'), 'Te weinig geleverd');
  assert.equal(creditReasonLabel('PARTNER_SHORTFALL'), 'Minder ontvangen dan gefinancierd');
  assert.equal(creditReasonLabel(null), 'Andere');
  assert.deepEqual(CREDIT_REASON_CHOICES, ['SHORT_DELIVERY', 'DAMAGED', 'RETURN', 'PRICE_CORRECTION', 'CANCELLATION', 'OTHER']);
  assert.equal(creditNoteKind({ purpose: 'STANDARD' }), 'Creditnota');
  assert.equal(creditNoteKind({ purpose: 'PARTNER_ADVANCE' }), 'Creditnota · voorschot');
  assert.equal(creditNoteKind({ purpose: 'PARTNER_SETTLEMENT' }), 'Creditnota · afrekening');
  assert.equal(creditNoteKind({ purpose: null, partnerPurchaseOrderId: 17, partnerSettlement: true }), 'Creditnota · afrekening');
  assert.equal(creditNoteKind({ purpose: null, partnerPurchaseOrderId: 17 }), 'Creditnota · voorschot');
});

test('settlement maths split offsets from bank refunds and keep the open tegoed from the server', () => {
  const offset = row({ id: 1, amountEur: -120.2, offsetOrderId: 38, offsetPaymentId: 2 });
  const refund = row({ id: 3, amountEur: -50 });
  assert.deepEqual(creditNoteSettlement(summary(220.2, 50, [offset, refund])), { tegoedEur: 220.2, offsetEur: 120.2, refundedEur: 50, openEur: 50 });
  assert.deepEqual(creditNoteSettlement(summary(220.2, 220.2)), { tegoedEur: 220.2, offsetEur: 0, refundedEur: 0, openEur: 220.2 });
  assert.deepEqual(creditNoteSettlement(null), { tegoedEur: 0, offsetEur: 0, refundedEur: 0, openEur: 0 });
  /* The server summary keeps creditEur after a cancel; the status closes the tegoed. */
  assert.deepEqual(creditNoteSettlement(summary(220.2, 220.2), 'GEANNULEERD'), { tegoedEur: 220.2, offsetEur: 0, refundedEur: 0, openEur: 0 });
  assert.deepEqual(creditNoteSettlement(summary(220.2, 220.2), 'VERLOPEN'), { tegoedEur: 220.2, offsetEur: 0, refundedEur: 0, openEur: 0 });
  assert.equal(creditNoteSettlement(summary(220.2, 220.2), 'UITGEREIKT').openEur, 220.2);
  assert.equal(isDeadCreditNote({ status: 'GEANNULEERD' }), true);
  assert.equal(isDeadCreditNote({ status: 'UITGEREIKT' }), false);
  assert.equal(isDeadCreditNote(null), false);
  assert.equal(isOffsetPayment(offset), true);
  assert.equal(isOffsetPayment(refund), false);
  assert.equal(isOffsetPayment(null), false);
});

test('journey: concept, issued, sent, settled by offset, by refund, by both, and cancelled', () => {
  const labels = (steps: ReturnType<typeof creditNoteJourney>) => steps.map((step) => `${step.label}:${step.state}:${step.mark}`);
  assert.deepEqual(labels(creditNoteJourney({ status: 'CONCEPT', sentAt: null })), ['Concept:now:1', 'Uitgereikt:todo:2', 'Afgehandeld:todo:3']);
  assert.deepEqual(labels(creditNoteJourney({ status: 'UITGEREIKT', sentAt: null }, 'CREDIT')), ['Concept:done:✓', 'Uitgereikt:now:2', 'Afgehandeld:todo:3']);
  assert.deepEqual(labels(creditNoteJourney({ status: 'VERZONDEN', sentAt: '2026-09-25' }, 'CREDIT')), ['Concept:done:✓', 'Uitgereikt · verstuurd:now:2', 'Afgehandeld:todo:3']);
  assert.deepEqual(labels(creditNoteJourney({ status: 'BETAALD', sentAt: null }, 'PAID', { offsetEur: 220.2, refundedEur: 0 })), ['Concept:done:✓', 'Uitgereikt:done:✓', 'Verrekend:now:3']);
  assert.deepEqual(labels(creditNoteJourney({ status: 'BETAALD', sentAt: null }, 'PAID', { offsetEur: 0, refundedEur: 220.2 })), ['Concept:done:✓', 'Uitgereikt:done:✓', 'Terugbetaald:now:3']);
  assert.deepEqual(labels(creditNoteJourney({ status: 'BETAALD', sentAt: null }, 'PAID', { offsetEur: 100, refundedEur: 120.2 })), ['Concept:done:✓', 'Uitgereikt:done:✓', 'Afgehandeld:now:3']);
  assert.deepEqual(labels(creditNoteJourney({ status: 'GEANNULEERD', sentAt: null })), ['Concept:done:✓', 'Uitgereikt:done:✓', 'Geannuleerd:stop:×']);
  assert.equal(creditNoteJourney({ status: 'GEANNULEERD', sentAt: null })[2].kind, 'muted');
});

test('next step: issue, offset with the original when open, otherwise refund, done when settled', () => {
  assert.equal(creditNoteNextStep(credit('CONCEPT', summary(220.2, 0)), 0).key, 'issue');
  assert.equal(creditNoteNextStep(credit('CONCEPT', summary(220.2, 0)), 0).label, 'Creditnota uitreiken');
  const apply = creditNoteNextStep(credit('UITGEREIKT', summary(220.2, 220.2)), 3350.4);
  assert.equal(apply.key, 'apply');
  assert.equal(apply.label, 'Verrekenen met INV-2026-038 · € 220,20');
  assert.equal(creditNoteNextStep(credit('UITGEREIKT', summary(220.2, 220.2)), 100).label, 'Verrekenen met INV-2026-038 · € 100,00', 'capped by the open amount');
  const refund = creditNoteNextStep(credit('UITGEREIKT', summary(220.2, 220.2)), 0);
  assert.equal(refund.key, 'refund');
  assert.equal(refund.label, 'Terugbetaling noteren · € 220,20');
  assert.equal(creditNoteNextStep(credit('UITGEREIKT', summary(220.2, 220.2), { creditedInvoiceNumber: null }), 500).key, 'refund', 'no original number: no offset button');
  const done = creditNoteNextStep(credit('BETAALD', summary(220.2, 0)), 3350.4);
  assert.equal(done.key, 'done');
  assert.equal(done.label, null);
  assert.equal(creditNoteNextStep(credit('GEANNULEERD', summary(220.2, 0)), 0).key, 'cancelled');
});

test('draft totals round per line, add VAT only when taxed, and count what carries a value', () => {
  const taxed = creditDraftTotals([{ quantity: 24, unitPriceEur: 8.45 }, { quantity: 0, unitPriceEur: 9 }], [{ amountEur: 42.2 }, { amountEur: 0 }], 120, 21, false);
  assert.deepEqual(taxed, { goodsEur: 202.8, amountsEur: 42.2, freightEur: 120, exclEur: 365, vatEur: 76.65, inclEur: 441.65, count: 3 });
  const exempt = creditDraftTotals([{ quantity: 12, unitPriceEur: 18.35 }], [], 0, 21, true);
  assert.deepEqual(exempt, { goodsEur: 220.2, amountsEur: 0, freightEur: 0, exclEur: 220.2, vatEur: 0, inclEur: 220.2, count: 1 });
  assert.equal(creditDraftTotals([{ quantity: 3, unitPriceEur: 0.3333 }], [], 0, 0, false).goodsEur, 1, 'cent rounding per line');
  assert.equal(creditDraftTotals([], [], 0, 21, false).count, 0);
});

test('request builder drops zero lines, sends the invoiced price as null and trims the note', () => {
  const request = creditRequestFrom({
    reason: 'SHORT_DELIVERY', creditFreight: true, note: '  Een karton ontbrak  ',
    lines: [{ productId: 210, quantity: 24, unitPriceEur: 8.45, netUnitPriceEur: 8.45 }, { productId: 205, quantity: 0, unitPriceEur: 9, netUnitPriceEur: 9 }, { productId: 206, quantity: 240, unitPriceEur: 0.5, netUnitPriceEur: 8.46 }],
    amounts: [{ description: ' Goodwill ', amountEur: 10 }, { description: 'leeg', amountEur: 0 }],
  });
  assert.deepEqual(request, { reason: 'SHORT_DELIVERY', creditFreight: true, note: 'Een karton ontbrak',
    lines: [{ productId: 210, quantity: 24, unitPriceEur: null }, { productId: 206, quantity: 240, unitPriceEur: 0.5 }],
    amounts: [{ description: 'Goodwill', amountEur: 10 }] });
  assert.equal(creditRequestFrom({ reason: 'OTHER', lines: [], amounts: [], creditFreight: false, note: '' }).note, null);
});

test('status pill: money outranks the mail state on an issued credit note', () => {
  assert.deepEqual(creditNoteStatusLabel(credit('CONCEPT', summary(220.2, 0))), { label: 'Concept', cls: 'neutral' });
  assert.deepEqual(creditNoteStatusLabel(credit('UITGEREIKT', summary(220.2, 220.2))), { label: 'Tegoed open', cls: 'gold' });
  assert.deepEqual(creditNoteStatusLabel(credit('BETAALD', summary(220.2, 0))), { label: 'Afgehandeld', cls: 'ok' });
  assert.deepEqual(creditNoteStatusLabel(credit('UITGEREIKT', summary(220.2, 0, [], 'PAID'))), { label: 'Afgehandeld', cls: 'ok' });
  assert.deepEqual(creditNoteStatusLabel(credit('UITGEREIKT', null)), { label: 'Uitgereikt · niet gemaild', cls: 'rose' });
  assert.deepEqual(creditNoteStatusLabel(credit('VERZONDEN', null)), { label: 'Uitgereikt', cls: 'rose' });
  assert.deepEqual(creditNoteStatusLabel(credit('GEANNULEERD', summary(220.2, 0))), { label: 'Geannuleerd', cls: 'neutral' });
});

test('signed claims: invoices add, credit notes subtract, quotes claim nothing', () => {
  assert.equal(signedClaim(invoice('UITGEREIKT')), 6350.4);
  assert.equal(signedClaim(credit('UITGEREIKT', summary(220.2, 220.2))), -220.2);
  assert.equal(signedClaim(credit('CONCEPT', null)), -220.2, 'without a summary the priced total carries the sign');
  assert.equal(signedClaim({ order: { docType: 'OFFERTE' }, priced: { totals: { totalInclVat: 100 } } } as unknown as SalesOrderView), 0);
  assert.equal(euro(1240), '€ 1.240,00');
  assert.equal(euro(-296.45), '− € 296,45');
});
