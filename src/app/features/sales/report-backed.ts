import type { SalesOrderView } from '../../core/api/models';

/*
 * Invoices made from the partner's meldingen (Veilingverkopen › Factureren,
 * contract 7c "Sales documents"). Their stock already left with every
 * melding (PARTNER_SALE movements), so such a document is never shipped
 * again: the server stamps goodsShippedAt when it is issued, refuses
 * shipGoods, copy and restore, and freezes lines, extras and customer. The
 * screens only label it and leave the shipment out. Pure: types only.
 * An older backend sends neither field: nothing is report-backed then.
 */

type Backed = Pick<SalesOrderView, 'reportBacked' | 'reportBookedQuantities'>;

export const REPORT_BACKED_LABEL = 'Uit veilingverkopen';
export const REPORT_SHIPPED_LABEL = 'Voorraad afgeboekt via veilingverkopen';
/** Under the frozen lines of a concept (the server refuses edits; the way to change it is a new run). */
export const REPORT_LOCK_NOTE = 'De regels volgen de meldingen en staan vast. Iets anders nodig? Verwijder dit concept en factureer opnieuw via Veilingverkopen.';

export function isReportBacked(view: Backed | null | undefined): boolean {
  return view?.reportBacked === true;
}

/** What the meldingen already booked out of stock for this product, in its sales unit (0 when nothing). */
export function reportBookedOf(view: Backed | null | undefined, productId: number): number {
  const booked = view?.reportBookedQuantities?.[String(productId)];
  return typeof booked === 'number' && Number.isFinite(booked) && booked > 0 ? booked : 0;
}

/**
 * Every product line is covered by the meldingen: nothing is left to ship. A partly backed document (defensive:
 * the frozen lines make it impossible) still ships the rest through the normal sheet, which marks the booked part.
 */
export function shipsViaReports(view: (Backed & Pick<SalesOrderView, 'priced'>) | null | undefined): boolean {
  if (!view || !isReportBacked(view)) return false;
  const quantities = new Map<number, number>();
  for (const line of view.priced?.lines ?? []) {
    if (line.productId == null || !(line.quantity > 0)) continue;
    quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.quantity);
  }
  return [...quantities].every(([productId, quantity]) => reportBookedOf(view, productId) >= quantity);
}

/** One ship-sheet row: the part the meldingen booked ("al afgeboekt") and the rest the sheet books now. */
export interface ReportShipSplit { booked: number; rest: number; }

/**
 * Splits the lines' quantities per product over what the meldingen booked: the booked part is taken from the
 * first lines of a product, the rest is shipped. Returns one split per line, in line order.
 */
export function reportShipSplits(view: Backed, lines: readonly { productId: number; quantity: number }[]): ReportShipSplit[] {
  const left = new Map<number, number>();
  return lines.map((line) => {
    if (!left.has(line.productId)) left.set(line.productId, reportBookedOf(view, line.productId));
    const available = left.get(line.productId)!;
    const booked = Math.min(Math.max(0, line.quantity), available);
    left.set(line.productId, available - booked);
    return { booked, rest: Math.max(0, line.quantity - booked) };
  });
}
