import type { PartnerChannel, PartnerReport, PartnerReportStatus } from '../../core/api/partner-portal-api';

/**
 * Words and number formats of the partner portal (Dutch, nl-BE numbers as the
 * rest of the ERP). Pure.
 */

/** What the partner reports: the three action tiles, the segmented control and the query `soort`. */
export type PartnerKind = 'veiling' | 'direct' | 'terugkoop';

export const PARTNER_KINDS: readonly PartnerKind[] = ['veiling', 'direct', 'terugkoop'];

export const KIND_LABEL: Record<PartnerKind, string> = {
  veiling: 'Verkocht op de veiling',
  direct: 'Direct verkocht',
  terugkoop: 'Teruggekocht op de klok',
};

export const KIND_SHORT: Record<PartnerKind, string> = { veiling: 'Veiling', direct: 'Direct', terugkoop: 'Terugkoop' };

export const KIND_ICON: Record<PartnerKind, string> = { veiling: 'tag', direct: 'sales', terugkoop: 'restore' };

export const KIND_TONE: Record<PartnerKind, string> = { veiling: 'tone-teal', direct: 'tone-blue', terugkoop: 'tone-amber' };

export const KIND_CHANNEL: Record<PartnerKind, PartnerChannel> = { veiling: 'AUCTION', direct: 'DIRECT', terugkoop: 'AUCTION' };

export function parseKind(value: string | null | undefined): PartnerKind {
  return value === 'direct' || value === 'terugkoop' ? value : 'veiling';
}

/** A melding's kind: a direct sale, a buyback-only auction melding, or an auction sale. */
export function reportKind(report: Pick<PartnerReport, 'channel' | 'entries'>): PartnerKind {
  if (report.channel === 'DIRECT') return 'direct';
  return report.entries.length > 0 && report.entries.every((entry) => !entry.sale) ? 'terugkoop' : 'veiling';
}

export const STATUS_LABEL: Record<PartnerReportStatus, string> = {
  OPEN: 'Nog te factureren',
  PARTLY_INVOICED: 'Deels gefactureerd',
  INVOICED: 'Gefactureerd',
  VOIDED: 'Ingetrokken',
};

export const STATUS_TONE: Record<PartnerReportStatus, string> = {
  OPEN: 'tone-amber',
  PARTLY_INVOICED: 'tone-blue',
  INVOICED: 'tone-green',
  VOIDED: 'tone-grey',
};

const NUMBER = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 0 });
const PRICE = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const EURO = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PERCENT = new Intl.NumberFormat('nl-BE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function count(value: number | null | undefined): string {
  return NUMBER.format(Number(value) || 0);
}

export function euro(value: number | null | undefined): string {
  return EURO.format(Number(value) || 0);
}

/** A price per piece: "€ 0,45", "€ 0,4567" (up to the 4 decimals it is stored with). */
export function priceEuro(value: number | null | undefined): string {
  return PRICE.format(Number(value) || 0);
}

/** A cost line's minus amount: "− € 14,40" (nothing to subtract: "€ 0,00"). */
export function minusEuro(value: number | null | undefined): string {
  const amount = Number(value) || 0;
  return amount === 0 ? euro(0) : '− ' + euro(amount);
}

export function percent(value: number | null | undefined): string {
  return PERCENT.format(Number(value) || 0) + ' %';
}

/** "1 stuk", "120 stuks", "3 displays". */
export function units(quantity: number | null | undefined, unit: { unitOne: string; unitOther: string }): string {
  const n = Number(quantity) || 0;
  return `${count(n)} ${n === 1 ? unit.unitOne : unit.unitOther}`;
}

/** "Rozenstolp M · Rood". */
export function productTitle(product: { name: string; variant: string | null }): string {
  return product.variant ? `${product.name} · ${product.variant}` : product.name;
}

/** The products of a melding in one short line: the first one, then "+ 2". */
export function productsLine(report: Pick<PartnerReport, 'entries'>): string {
  const [first, ...rest] = report.entries;
  if (!first) return '';
  return rest.length ? `${productTitle(first)} + ${rest.length}` : productTitle(first);
}

/* ---- dates (yyyy-mm-dd, read as calendar days, never shifted by a time zone) */

function parts(iso: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return match ? [+match[1], +match[2], +match[3]] : null;
}

function utc(iso: string): Date | null {
  const p = parts(iso);
  return p ? new Date(Date.UTC(p[0], p[1] - 1, p[2])) : null;
}

export function addDays(iso: string, days: number): string {
  const date = utc(iso);
  if (!date) return iso;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** "10/11". */
export function shortDate(iso: string | null | undefined): string {
  const p = parts(iso ?? '');
  return p ? `${String(p[2]).padStart(2, '0')}/${String(p[1]).padStart(2, '0')}` : '';
}

const DAY = new Intl.DateTimeFormat('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const LONG = new Intl.DateTimeFormat('nl-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "Vandaag", "Gisteren", else "ma 3 nov." against the server's today. */
export function dayLabel(iso: string | null | undefined, today: string | null | undefined): string {
  if (!iso) return '';
  if (today && iso === today) return 'Vandaag';
  if (today && iso === addDays(today, -1)) return 'Gisteren';
  const date = utc(iso);
  return date ? DAY.format(date) : iso;
}

/** "10 november 2026". */
export function longDate(iso: string | null | undefined): string {
  const date = utc(iso ?? '');
  return date ? LONG.format(date) : '';
}

/** Today on this device (yyyy-mm-dd), until the overview brings the server's. */
export function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Case- and accent-free text for the stock search. */
export function searchText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Text from the server inside a confirm message (Ui.confirm renders its message as HTML). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
