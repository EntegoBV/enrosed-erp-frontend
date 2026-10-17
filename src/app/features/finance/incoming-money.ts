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

const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

const HOME_ZONE = 'Europe/Brussels';
const CLOCK_PARTS: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };

/**
 * The zone of a moment recorded elsewhere ("GMT+8"), when its clock differs from Brussels'; '' for Brussels and for a
 * zone that reads the same there (Amsterdam), so a time in another zone is never read as Brussels time.
 */
export function foreignZoneName(payment: Pick<IncomingMoneyRow, 'receivedAt' | 'timeZone'>): string {
  const zone = payment.timeZone || HOME_ZONE;
  if (zone === HOME_ZONE || !Number.isFinite(Date.parse(payment.receivedAt))) return '';
  try {
    const instant = new Date(payment.receivedAt);
    const there = new Intl.DateTimeFormat('en-GB', { ...CLOCK_PARTS, timeZone: zone }).format(instant);
    if (there === new Intl.DateTimeFormat('en-GB', { ...CLOCK_PARTS, timeZone: HOME_ZONE }).format(instant)) return '';
    return new Intl.DateTimeFormat('nl-BE', { timeZone: zone, timeZoneName: 'short' }).formatToParts(instant).find((part) => part.type === 'timeZoneName')?.value ?? zone;
  } catch { return ''; }
}

/**
 * "8 okt · 23:21" in the payment's own zone, with that zone when it is not Brussels' clock ("9 okt · 05:21 · GMT+8");
 * "8 okt 2025 · 23:21" in another year than `today` (and without a `today`, so a caller that knows no day never drops
 * the year). `dateOnly` leaves out a 00:00 clock: a receipt entered with a date only (the bank-text rule).
 */
export function paymentMomentLabel(payment: Pick<IncomingMoneyRow, 'receivedAt' | 'timeZone'>, today: string | null = null, dateOnly = false): string {
  if (!Number.isFinite(Date.parse(payment.receivedAt))) return 'Tijdstip onbekend';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { ...CLOCK_PARTS, timeZone: payment.timeZone || HOME_ZONE }).formatToParts(new Date(payment.receivedAt));
    const part = (type: string) => parts.find((row) => row.type === type)?.value ?? '';
    const year = part('year');
    const day = `${Number(part('day'))} ${MONTHS[Number(part('month')) - 1]}${!today || today.slice(0, 4) !== year ? ` ${year}` : ''}`;
    const clock = `${part('hour')}:${part('minute')}`;
    if (dateOnly && clock === '00:00') return day;
    const zone = foreignZoneName(payment);
    return `${day} · ${clock}${zone ? ` · ${zone}` : ''}`;
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

/** One issued invoice or credit note with what is received and still open on it. */
export interface IssuedReceivable { view: SalesOrderView; receivedEur: number; remainingEur: number; overpaidEur: number; creditEur: number }

function issuedReceivables(views: readonly SalesOrderView[]): IssuedReceivable[] {
  return views.filter((view) => (view.order.docType === 'FACTUUR' || view.order.docType === 'CREDITNOTA') && !INACTIVE.has(view.order.status))
    .map((view) => ({ view, ...invoiceReceivable(view) }));
}

const isOpenInvoiceRow = (row: IssuedReceivable): boolean => row.view.order.docType === 'FACTUUR' && row.remainingEur > 0;

/** The open invoices receivableTotals counts (count, totalEur): issued, not cancelled, something still to receive. */
export function openInvoiceRows(views: readonly SalesOrderView[]): IssuedReceivable[] {
  return issuedReceivables(views).filter(isOpenInvoiceRow);
}

/**
 * Open invoices, plus money the other way: creditEur is every credit the
 * customers hold (overpaid or negative invoices included, as it always was),
 * creditNoteEur only the open tegoeden of issued credit notes, which the cash
 * outlook and the 'tegoed af te handelen' sublines read.
 */
export function receivableTotals(views: readonly SalesOrderView[]) {
  const rows = issuedReceivables(views);
  const open = rows.filter(isOpenInvoiceRow);
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
