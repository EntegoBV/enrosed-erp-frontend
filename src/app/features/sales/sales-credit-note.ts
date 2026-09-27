import type {
  CreditNoteRequest, CreditReason, QuoteStatus, SalesOrder, SalesOrderView, SalesPayment, SalesPaymentSummary,
} from '../../core/api/models';

/*
 * Credit notes ("creditnota's"): a third document type that reduces an
 * invoice's claim. Lines and amounts stay positive; the sign lives in the
 * type. This module is pure and node-tested (`import type` only): the
 * journey, the settlement maths, the next step, the sheet preview and the
 * request builder all live here so the desk, the phone and the list read the
 * same facts.
 */

export const CREDIT_REASON_LABEL: Readonly<Record<CreditReason, string>> = {
  SHORT_DELIVERY: 'Te weinig geleverd',
  DAMAGED: 'Beschadigd',
  RETURN: 'Retour',
  PRICE_CORRECTION: 'Prijscorrectie',
  CANCELLATION: 'Annulering',
  PARTNER_SHORTFALL: 'Minder ontvangen dan gefinancierd',
  OTHER: 'Andere',
};

/** The chips a standard credit note offers, in order; the partner reason is fixed by its flow. */
export const CREDIT_REASON_CHOICES: readonly CreditReason[] = ['SHORT_DELIVERY', 'DAMAGED', 'RETURN', 'PRICE_CORRECTION', 'CANCELLATION', 'OTHER'];

const ISSUED = new Set<QuoteStatus>(['UITGEREIKT', 'VERZONDEN', 'BEKEKEN', 'BETAALD']);
const DEAD = new Set<QuoteStatus>(['GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN']);
const round2 = (value: number): number => Math.round(value * 100) / 100;
const finite = (value: number | null | undefined): number => (Number.isFinite(value) ? (value as number) : 0);

export function isCreditNote(order: Pick<SalesOrder, 'docType'> | null | undefined): boolean {
  return order?.docType === 'CREDITNOTA';
}

/** An invoice or a credit note: a document that carries money, unlike a quote. */
export function isClaimDocument(order: Pick<SalesOrder, 'docType'> | null | undefined): boolean {
  return order?.docType === 'FACTUUR' || order?.docType === 'CREDITNOTA';
}

/** Only an issued, live invoice that is not yet fully credited can get a credit note. */
export function canCreateCreditNote(view: Pick<SalesOrderView, 'order' | 'priced' | 'creditedEur' | 'paymentSummary'> | null | undefined): boolean {
  if (!view || view.order.docType !== 'FACTUUR' || !ISSUED.has(view.order.status)) return false;
  const total = Math.abs(finite(view.paymentSummary?.invoiceTotalEur ?? view.priced?.totals?.totalInclVat));
  return finite(view.creditedEur) < total - 0.005;
}

export function creditReasonLabel(reason: CreditReason | null | undefined): string {
  return reason ? CREDIT_REASON_LABEL[reason] ?? 'Andere' : 'Andere';
}

/** 'Creditnota', or the partner flavour: an advance or a settlement is credited. */
export function creditNoteKind(order: Pick<SalesOrder, 'purpose' | 'partnerPurchaseOrderId' | 'partnerSettlement'>): 'Creditnota' | 'Creditnota · voorschot' | 'Creditnota · afrekening' {
  const purpose = order.purpose ?? (order.partnerPurchaseOrderId ? (order.partnerSettlement ? 'PARTNER_SETTLEMENT' : 'PARTNER_ADVANCE') : 'STANDARD');
  return purpose === 'PARTNER_ADVANCE' ? 'Creditnota · voorschot' : purpose === 'PARTNER_SETTLEMENT' ? 'Creditnota · afrekening' : 'Creditnota';
}

export interface CreditNoteSettlement {
  /** |invoiceTotalEur|: the whole credit note, incl. btw. */
  tegoedEur: number;
  /** Σ of the verrekening rows (offset pairs), positive. */
  offsetEur: number;
  /** Σ of the refunds paid out by bank, positive. */
  refundedEur: number;
  /** What is still to be settled: the server's creditEur. */
  openEur: number;
}

export function isOffsetPayment(payment: Pick<SalesPayment, 'offsetPaymentId'> | null | undefined): boolean {
  return payment?.offsetPaymentId != null;
}

/** A cancelled, rejected or expired credit note: dead everywhere, its tegoed lapsed. */
export function isDeadCreditNote(order: Pick<SalesOrder, 'status'> | null | undefined): boolean {
  return !!order && DEAD.has(order.status);
}

/**
 * The four figures of 'Tegoed & afhandeling', from the server summary of a
 * credit note. The summary is status-agnostic (a cancelled note keeps
 * creditEur = T), so the status decides: a dead credit note has nothing open.
 */
export function creditNoteSettlement(
  summary: Pick<SalesPaymentSummary, 'invoiceTotalEur' | 'creditEur' | 'payments'> | null | undefined,
  status?: QuoteStatus | null,
): CreditNoteSettlement {
  if (!summary) return { tegoedEur: 0, offsetEur: 0, refundedEur: 0, openEur: 0 };
  const rows = summary.payments ?? [];
  const offsetEur = round2(rows.filter(isOffsetPayment).reduce((sum, row) => sum + Math.abs(finite(row.amountEur)), 0));
  const refundedEur = round2(rows.filter((row) => !isOffsetPayment(row) && finite(row.amountEur) < 0).reduce((sum, row) => sum + Math.abs(row.amountEur), 0));
  const openEur = status && DEAD.has(status) ? 0 : round2(Math.max(0, finite(summary.creditEur)));
  return { tegoedEur: round2(Math.abs(finite(summary.invoiceTotalEur))), offsetEur, refundedEur, openEur };
}

export interface CreditJourneyStep {
  label: string;
  mark: string;
  state: 'done' | 'now' | 'todo' | 'stop' | 'wait';
  kind: 'danger' | 'gold' | 'muted' | undefined;
}

/**
 * Concept → Uitgereikt[· verstuurd] → Afgehandeld. The last stop names what
 * settled the tegoed ('Verrekend', 'Terugbetaald', or 'Afgehandeld' when both
 * played a part); a cancelled credit note stops where it stood.
 */
export function creditNoteJourney(
  order: Pick<SalesOrder, 'status' | 'sentAt'>,
  paymentStatus?: SalesPaymentSummary['status'] | null,
  settlement?: Pick<CreditNoteSettlement, 'offsetEur' | 'refundedEur'> | null,
): CreditJourneyStep[] {
  if (DEAD.has(order.status)) {
    const steps: CreditJourneyStep[] = [{ label: 'Concept', mark: '✓', state: 'done', kind: undefined }];
    if (order.sentAt || order.status === 'GEANNULEERD') steps.push({ label: 'Uitgereikt', mark: '✓', state: 'done', kind: undefined });
    steps.push({ label: order.status === 'GEANNULEERD' ? 'Geannuleerd' : order.status === 'VERLOPEN' ? 'Verlopen' : 'Afgewezen', mark: '×', state: 'stop', kind: 'muted' });
    return steps;
  }
  const issued = order.status !== 'CONCEPT';
  const settled = issued && (order.status === 'BETAALD' || paymentStatus === 'PAID' || paymentStatus === 'OVERPAID');
  const current = settled ? 2 : issued ? 1 : 0;
  const issuedLabel = order.status === 'VERZONDEN' || order.status === 'BEKEKEN' ? 'Uitgereikt · verstuurd' : 'Uitgereikt';
  const offsets = finite(settlement?.offsetEur) > 0, refunds = finite(settlement?.refundedEur) > 0;
  const endLabel = settled && offsets && !refunds ? 'Verrekend' : settled && refunds && !offsets ? 'Terugbetaald' : 'Afgehandeld';
  return ['Concept', issuedLabel, endLabel].map<CreditJourneyStep>((label, index) => ({
    label, mark: index < current ? '✓' : `${index + 1}`,
    state: index < current ? 'done' : index === current ? 'now' : 'todo', kind: undefined,
  }));
}

export interface CreditNoteNextStep {
  key: 'issue' | 'apply' | 'refund' | 'done' | 'cancelled';
  title: string;
  help: string;
  /** The primary button's text, or null when there is nothing to press. */
  label: string | null;
}

/**
 * One decision at a time. A concept is issued; an issued credit note with an
 * open tegoed is offset against the original when that still has an open
 * amount, else refunded; a settled one is done.
 */
export function creditNoteNextStep(
  view: Pick<SalesOrderView, 'order' | 'paymentSummary' | 'creditedInvoiceNumber'>,
  originalOpenEur: number | null | undefined,
): CreditNoteNextStep {
  const status = view.order.status;
  if (DEAD.has(status)) return { key: 'cancelled', title: 'Geannuleerd', help: 'Deze creditnota telt nergens meer mee. Heropenen kan zolang er geen geld bewoog.', label: null };
  if (status === 'CONCEPT') return { key: 'issue', title: 'Creditnota uitreiken', help: 'Controleer de regels. Uitreiken zet de creditnota vast; daarna kun je ze e-mailen of verrekenen.', label: 'Creditnota uitreiken' };
  const open = round2(Math.max(0, finite(view.paymentSummary?.creditEur)));
  if (open <= 0) return { key: 'done', title: 'Afgehandeld', help: 'Het tegoed is volledig verrekend of terugbetaald.', label: null };
  const help = 'Verreken het tegoed met de openstaande factuur of noteer de terugbetaling die je uitvoerde.';
  if (finite(originalOpenEur) > 0 && view.creditedInvoiceNumber) {
    return { key: 'apply', title: 'Tegoed afhandelen', help, label: `Verrekenen met ${view.creditedInvoiceNumber} · ${euro(Math.min(open, finite(originalOpenEur)))}` };
  }
  return { key: 'refund', title: 'Tegoed afhandelen', help, label: `Terugbetaling noteren · ${euro(open)}` };
}

export interface CreditDraftTotals {
  goodsEur: number;
  amountsEur: number;
  freightEur: number;
  exclEur: number;
  vatEur: number;
  inclEur: number;
  /** Product lines, free amounts and the freight line that carry a value. */
  count: number;
}

/**
 * The sheet's preview, cent by cent. The server recomputes the document at
 * CONTAINER_COST markup, so a line is quantity × unit price without tiers or
 * carton rounding; VAT is the invoice's rate, nothing when it was exempt.
 */
export function creditDraftTotals(
  lines: readonly { quantity: number; unitPriceEur: number }[],
  amounts: readonly { amountEur: number }[],
  freightEur: number,
  vatRatePct: number,
  exempt: boolean,
): CreditDraftTotals {
  const goodsEur = round2(lines.reduce((sum, line) => sum + (finite(line.quantity) > 0 && finite(line.unitPriceEur) > 0 ? round2(line.quantity * line.unitPriceEur) : 0), 0));
  const amountsEur = round2(amounts.reduce((sum, amount) => sum + (finite(amount.amountEur) > 0 ? round2(amount.amountEur) : 0), 0));
  const freight = finite(freightEur) > 0 ? round2(freightEur) : 0;
  const exclEur = round2(goodsEur + amountsEur + freight);
  const vatEur = exempt || !(finite(vatRatePct) > 0) ? 0 : round2(exclEur * vatRatePct / 100);
  const count = lines.filter((line) => finite(line.quantity) > 0).length + amounts.filter((amount) => finite(amount.amountEur) > 0).length + (freight > 0 ? 1 : 0);
  return { goodsEur, amountsEur, freightEur: freight, exclEur, vatEur, inclEur: round2(exclEur + vatEur), count };
}

export interface CreditDraft {
  reason: CreditReason;
  lines: readonly { productId: number; quantity: number; unitPriceEur: number; netUnitPriceEur: number }[];
  amounts: readonly { description: string; amountEur: number }[];
  creditFreight: boolean;
  note?: string | null;
}

/** The request the server accepts: zero lines dropped, the invoiced price sent as null, amounts positive. */
export function creditRequestFrom(draft: CreditDraft): CreditNoteRequest {
  const lines = draft.lines
    .filter((line) => Number.isFinite(line.quantity) && line.quantity > 0)
    .map((line) => ({
      productId: line.productId, quantity: Math.round(line.quantity),
      unitPriceEur: Math.abs(finite(line.unitPriceEur) - finite(line.netUnitPriceEur)) < 0.00005 ? null : round4(line.unitPriceEur),
    }));
  const amounts = draft.amounts
    .filter((amount) => Number.isFinite(amount.amountEur) && amount.amountEur > 0)
    .map((amount) => ({ description: (amount.description ?? '').trim().slice(0, 120), amountEur: round2(amount.amountEur) }));
  const note = (draft.note ?? '').trim();
  return { reason: draft.reason, lines, amounts, creditFreight: !!draft.creditFreight, note: note || null };
}

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

/**
 * The pill of a credit note. Money outranks the mail state: an issued credit
 * note with a tegoed reads 'Tegoed open' until it is 'Afgehandeld'.
 */
export function creditNoteStatusLabel(view: Pick<SalesOrderView, 'order' | 'paymentSummary'>): { label: string; cls: string } {
  const status = view.order.status;
  if (status === 'CONCEPT') return { label: 'Concept', cls: 'neutral' };
  if (status === 'GEANNULEERD') return { label: 'Geannuleerd', cls: 'neutral' };
  if (status === 'AFGEWEZEN') return { label: 'Afgewezen', cls: 'danger' };
  if (status === 'VERLOPEN') return { label: 'Verlopen', cls: 'neutral' };
  const summary = view.paymentSummary;
  if (status === 'BETAALD' || summary?.status === 'PAID' || summary?.status === 'OVERPAID') return { label: 'Afgehandeld', cls: 'ok' };
  if (summary && finite(summary.creditEur) > 0) return { label: 'Tegoed open', cls: 'gold' };
  if (status === 'UITGEREIKT') return { label: 'Uitgereikt · niet gemaild', cls: 'rose' };
  return { label: 'Uitgereikt', cls: 'rose' };
}

/** The claim with its sign, incl. btw: an invoice adds, a credit note subtracts, a quote claims nothing. */
export function signedClaim(view: Pick<SalesOrderView, 'order' | 'priced' | 'paymentSummary'>): number {
  if (!isClaimDocument(view.order)) return 0;
  const value = Math.abs(finite(view.paymentSummary?.invoiceTotalEur ?? view.priced?.totals?.totalInclVat));
  return round2(isCreditNote(view.order) ? -value : value);
}

/** € 1.234,56 in Belgian Dutch, for sentences and button labels. */
export function euro(value: number): string {
  const abs = Math.abs(finite(value));
  const text = abs.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${finite(value) < 0 ? '− ' : ''}€ ${text}`;
}
