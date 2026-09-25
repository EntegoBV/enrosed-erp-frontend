import type { SalesOrderView } from '../../core/api/models';

/** Immutable cash entries, including receipts on archived or subsequently cancelled documents. */
export interface IncomingMoneyRow {
  id: number;
  salesOrderId: number;
  amountEur: number;
  receivedAt: string;
  timeZone: string;
  reference: string | null;
  orderNumber: string;
  customerId: number | null;
  purchaseOrderId: number | null;
  purpose: 'STANDARD' | 'PARTNER_ADVANCE' | 'PARTNER_SETTLEMENT';
  legacy?: boolean;
  /** Both rows of a verrekening carry the mirrored row: no bank money moved. */
  offsetPaymentId?: number | null;
  offsetOrderId?: number | null;
  offsetOrderNumber?: string | null;
  docType?: string;
}

/** A verrekening row: a credit note offset against an invoice, booked on both. Never cash. */
export function isOffsetRow(row: Pick<IncomingMoneyRow, 'offsetPaymentId'>): boolean {
  return row.offsetPaymentId != null;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
const finite = (value: number | undefined | null): number => Number.isFinite(value) ? value as number : 0;
const INACTIVE = new Set(['CONCEPT', 'GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN']);

export function paymentLocalDay(payment: Pick<IncomingMoneyRow, 'receivedAt' | 'timeZone'>): string {
  if (!Number.isFinite(Date.parse(payment.receivedAt))) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: payment.timeZone || 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(payment.receivedAt));
    const part = (type: string) => parts.find((row) => row.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch { return payment.receivedAt.slice(0, 10); }
}

export function paymentMomentLabel(payment: Pick<IncomingMoneyRow, 'receivedAt' | 'timeZone'>): string {
  if (!Number.isFinite(Date.parse(payment.receivedAt))) return 'Tijdstip onbekend';
  try {
    return new Intl.DateTimeFormat('nl-BE', { timeZone: payment.timeZone || 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(payment.receivedAt));
  } catch { return payment.receivedAt; }
}

export function incomingPurposeLabel(purpose: IncomingMoneyRow['purpose']): string {
  return purpose === 'PARTNER_ADVANCE' ? 'Partnervoorschot' : purpose === 'PARTNER_SETTLEMENT' ? 'Partnerafrekening' : 'Klantbetaling';
}

export function uniqueIncomingPayments(rows: readonly IncomingMoneyRow[]): IncomingMoneyRow[] {
  const seen = new Set<number>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return Number.isFinite(row.amountEur) && row.amountEur !== 0;
  }).sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt) || right.id - left.id);
}

/** Cash figures leave the offset pairs out; offsetEur counts each verrekening once (its invoice-side row). */
export function incomingMoneyTotals(rows: readonly IncomingMoneyRow[], from?: string | null, to?: string | null) {
  const inRange = uniqueIncomingPayments(rows).filter((row) => {
    const day = paymentLocalDay(row);
    return !!day && (!from || day >= from) && (!to || day <= to);
  });
  const selected = inRange.filter((row) => !isOffsetRow(row));
  const sum = (purpose?: IncomingMoneyRow['purpose']) => round2(selected.filter((row) => !purpose || row.purpose === purpose).reduce((total, row) => total + row.amountEur, 0));
  return { count: selected.length, receivedEur: sum(),
    grossReceivedEur: round2(selected.filter(row => row.amountEur > 0).reduce((total, row) => total + row.amountEur, 0)),
    refundedEur: round2(selected.filter(row => row.amountEur < 0).reduce((total, row) => total + Math.abs(row.amountEur), 0)),
    standardEur: sum('STANDARD'), partnerAdvanceEur: sum('PARTNER_ADVANCE'), partnerSettlementEur: sum('PARTNER_SETTLEMENT'),
    offsetEur: round2(inRange.filter((row) => isOffsetRow(row) && row.amountEur > 0).reduce((total, row) => total + row.amountEur, 0)) };
}

/** Summary wins over the old paid marker; partial cash never implies a completely paid invoice. */
export function invoiceReceivable(view: SalesOrderView): { receivedEur: number; remainingEur: number; overpaidEur: number; creditEur: number } {
  if (view.paymentSummary) return {
    receivedEur: finite(view.paymentSummary.receivedEur), remainingEur: Math.max(0, finite(view.paymentSummary.remainingEur)),
    overpaidEur: Math.max(0, finite(view.paymentSummary.overpaidEur)), creditEur: Math.max(0, finite(view.paymentSummary.creditEur)),
  };
  const total = finite(view.priced?.totals?.totalInclVat);
  const paid = !!view.order.paidAt || view.order.status === 'BETAALD';
  /* A credit note without a summary: its whole total is the open tegoed until it is settled. */
  if (view.order.docType === 'CREDITNOTA') return { receivedEur: 0, remainingEur: 0, overpaidEur: 0, creditEur: paid ? 0 : Math.abs(total) };
  return { receivedEur: paid ? Math.max(0, total) : 0, remainingEur: paid ? 0 : Math.max(0, total), overpaidEur: 0, creditEur: Math.max(0, -total) };
}

/**
 * Open invoices, plus money the other way: creditEur is every credit the
 * customers hold (overpaid or negative invoices included, as it always was),
 * creditNoteEur only the open tegoeden of issued credit notes, which the cash
 * outlook and the 'tegoed af te handelen' sublines read.
 */
export function receivableTotals(views: readonly SalesOrderView[]) {
  const issued = views.filter((view) => (view.order.docType === 'FACTUUR' || view.order.docType === 'CREDITNOTA') && !INACTIVE.has(view.order.status));
  const rows = issued.map((view) => ({ view, ...invoiceReceivable(view) }));
  const open = rows.filter((row) => row.view.order.docType === 'FACTUUR' && row.remainingEur > 0);
  const notes = rows.filter((row) => row.view.order.docType === 'CREDITNOTA' && row.creditEur > 0);
  const partner = (view: SalesOrderView): boolean => view.order.purpose
    ? view.order.purpose !== 'STANDARD' : !!view.order.partnerPurchaseOrderId;
  return {
    count: open.length, totalEur: round2(open.reduce((sum, row) => sum + row.remainingEur, 0)),
    partnerEur: round2(open.filter((row) => partner(row.view)).reduce((sum, row) => sum + row.remainingEur, 0)),
    standardEur: round2(open.filter((row) => !partner(row.view)).reduce((sum, row) => sum + row.remainingEur, 0)),
    overpaidEur: round2(rows.reduce((sum, row) => sum + row.overpaidEur, 0)),
    creditEur: round2(rows.reduce((sum, row) => sum + row.creditEur, 0)),
    partialCount: open.filter((row) => row.receivedEur > 0).length,
    creditNoteCount: notes.length,
    creditNoteEur: round2(notes.reduce((sum, row) => sum + row.creditEur, 0)),
  };
}
