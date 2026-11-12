import type { PartnerSalesAnalytics, PartnerSalesAnalyticsProduct, PartnerSalesAnalyticsReport } from '../../core/api/partner-sales-api';

/*
 * Verkoop › Veilingverkopen (contract 7c Analyses): what the partner reported
 * as sold at auction or directly, by sold_on, from GET /api/partner-sales/
 * analytics (every non-voided melding, no cap). Its own layer: never in Omzet
 * or Resultaat (the invoice made from the meldingen counts there, on its own
 * date). Additive figures only (stuks, bruto, netto, nog niet gefactureerd),
 * each a plain sum of the period's melding rows so its drill adds up exactly;
 * the average is derived per product (bruto / stuks), never summed across
 * them. "Stuks" are pieces (roos, bowl …; contract v2-H): the server's
 * salePieces, else the sales units × the product's pieces per sales unit (a
 * display of 12 rozen counts 12). Pure: type imports only.
 */

/** Pieces in one sales unit of a product (12 for a display of 12 rozen sold per display, else 1). */
export type PiecesPerSalesUnit = (productId: number) => number;

/** A melding of the period with its pieces. */
export interface PartnerSalesReportRow extends PartnerSalesAnalyticsReport {
  /** Sold pieces; buybacks apart. */
  pieces: number;
  buybackPieces: number;
  /** The sale not invoiced yet, in pieces. */
  openPieces: number;
}

/** A melding x product row of the period with its pieces. */
export interface PartnerSalesProductLine extends PartnerSalesAnalyticsProduct {
  pieces: number;
  buybackPieces: number;
}

export interface PartnerSalesTotals {
  /** Meldingen. */
  reports: number;
  /** Sold pieces; buybacks apart. */
  pieces: number;
  buybackPieces: number;
  grossEur: number;
  /** Veilingcommissie + transport + extra kost. */
  costsEur: number;
  /** Terugkoopkost. */
  buybackEur: number;
  /** grossEur − costsEur − buybackEur. */
  netEur: number;
}

export interface PartnerSalesProductRow {
  productId: number;
  name: string;
  variant: string | null;
  pieces: number;
  buybackPieces: number;
  grossEur: number;
  netEur: number;
  /** Weighted average price per piece: gross / pieces; null without a sale. */
  averageEur: number | null;
  lastSoldOn: string;
}

export interface PartnerSalesFigures {
  all: PartnerSalesTotals;
  auction: PartnerSalesTotals;
  direct: PartnerSalesTotals;
  /**
   * Not invoiced yet: only the open parts of each melding (the server's openNetEur and open pieces), the same
   * figures as Veilingverkopen. Confirmed or not: Factureren takes only the confirmed ones (openUnconfirmed says how
   * many wait). Only reports, pieces and netEur are filled here.
   */
  open: PartnerSalesTotals;
  /** Of those, the meldingen staff have not confirmed yet; null when the server does not say (an older one). */
  openUnconfirmed: number | null;
  /** The period's meldingen, newest first. */
  reports: readonly PartnerSalesReportRow[];
  /** The period's melding x product rows (a product's drill). */
  productRows: readonly PartnerSalesProductLine[];
  /** Per product, highest bruto first. */
  products: PartnerSalesProductRow[];
}

const cents = (value: number | null | undefined): number => Math.round((Number.isFinite(value as number) ? value as number : 0) * 100);
const whole = (value: number | null | undefined): number => (Number.isFinite(value as number) ? Math.trunc(value as number) : 0);
const known = (value: number | null | undefined): value is number => Number.isFinite(value as number);
const inRange = (day: string, from: string | null, to: string | null): boolean =>
  /^\d{4}-\d{2}-\d{2}/.test(day) && (!from || day.slice(0, 10) >= from) && (!to || day.slice(0, 10) <= to);

function totals(rows: readonly PartnerSalesReportRow[]): PartnerSalesTotals {
  let pieces = 0, buybackPieces = 0, gross = 0, costs = 0, buyback = 0, net = 0;
  for (const row of rows) {
    pieces += row.pieces;
    buybackPieces += row.buybackPieces;
    gross += cents(row.grossEur);
    costs += cents(row.costsEur);
    buyback += cents(row.buybackEur);
    net += cents(row.netEur);
  }
  return { reports: rows.length, pieces, buybackPieces, grossEur: gross / 100, costsEur: costs / 100, buybackEur: buyback / 100, netEur: net / 100 };
}

/** The open (not yet invoiced) part of a melding row, in pieces; an older backend only sends the open flag. */
export function openPartOf(row: Pick<PartnerSalesReportRow, 'open' | 'pieces' | 'netEur' | 'openPieces' | 'openSaleQuantity' | 'openNetEur'>):
  { pieces: number; netEur: number } {
  if (!known(row.openNetEur) && !known(row.openSaleQuantity)) return row.open ? { pieces: row.pieces, netEur: cents(row.netEur) / 100 } : { pieces: 0, netEur: 0 };
  return { pieces: row.openPieces, netEur: cents(row.openNetEur) / 100 };
}

/** Rows with an open part (a waiting buyback included), and their open totals. */
function openTotals(rows: readonly PartnerSalesReportRow[]): PartnerSalesTotals & { unconfirmed: number | null } {
  let reports = 0, pieces = 0, net = 0, unconfirmed = 0, told = true;
  for (const row of rows) {
    const part = openPartOf(row);
    if (!part.pieces && !part.netEur) continue;
    reports++;
    pieces += part.pieces;
    net += cents(part.netEur);
    if (row.confirmed == null) told = false; else if (!row.confirmed) unconfirmed++;
  }
  return { reports, pieces, buybackPieces: 0, grossEur: 0, costsEur: 0, buybackEur: 0, netEur: net / 100, unconfirmed: told ? unconfirmed : null };
}

/** The meldingen sold in [from, to] (either may be null: open-ended), by sold_on, counted in pieces. */
export function partnerSalesInPeriod(data: PartnerSalesAnalytics, from: string | null, to: string | null,
    piecesPer: PiecesPerSalesUnit = () => 1): PartnerSalesFigures {
  const raw = (data.reports ?? []).filter((row) => inRange(row.soldOn, from, to));
  const ids = new Set(raw.map((row) => row.id));
  const per = (productId: number) => Math.max(1, whole(piecesPer(productId)) || 1);
  const productRows: PartnerSalesProductLine[] = (data.products ?? []).filter((row) => ids.has(row.reportId)).map((row) => ({
    ...row,
    pieces: known(row.salePieces) ? whole(row.salePieces) : whole(row.saleQuantity) * per(row.productId),
    buybackPieces: known(row.buybackPieces) ? whole(row.buybackPieces) : whole(row.buybackQuantity) * per(row.productId),
  }));
  /* Per melding: the server's pieces, else the sum of its product rows (each in its own pieces per sales unit). */
  const byReport = new Map<number, { pieces: number; buybackPieces: number; openPieces: number | null }>();
  for (const row of productRows) {
    const sums = byReport.get(row.reportId) ?? { pieces: 0, buybackPieces: 0, openPieces: 0 };
    sums.pieces += row.pieces;
    sums.buybackPieces += row.buybackPieces;
    const open = known(row.openSalePieces) ? whole(row.openSalePieces) : known(row.openSaleQuantity) ? whole(row.openSaleQuantity) * per(row.productId) : null;
    sums.openPieces = sums.openPieces === null || open === null ? null : sums.openPieces + open;
    byReport.set(row.reportId, sums);
  }
  const reports: PartnerSalesReportRow[] = raw.map((row) => {
    const sums = byReport.get(row.id);
    const pieces = known(row.salePieces) ? whole(row.salePieces) : sums ? sums.pieces : whole(row.saleQuantity);
    const ratio = whole(row.saleQuantity) > 0 ? pieces / whole(row.saleQuantity) : 1;
    return {
      ...row,
      pieces,
      buybackPieces: known(row.buybackPieces) ? whole(row.buybackPieces) : sums ? sums.buybackPieces : whole(row.buybackQuantity),
      openPieces: known(row.openSalePieces) ? whole(row.openSalePieces)
        : sums && sums.openPieces !== null ? sums.openPieces : Math.round(whole(row.openSaleQuantity) * ratio),
    };
  }).sort((left, right) => right.soldOn.localeCompare(left.soldOn) || right.id - left.id);
  const byProduct = new Map<number, { row: PartnerSalesProductLine; pieces: number; buybackPieces: number; gross: number; net: number; last: string }>();
  for (const row of productRows) {
    const entry = byProduct.get(row.productId) ?? { row, pieces: 0, buybackPieces: 0, gross: 0, net: 0, last: '' };
    entry.pieces += row.pieces;
    entry.buybackPieces += row.buybackPieces;
    entry.gross += cents(row.grossEur);
    entry.net += cents(row.netEur);
    if (row.saleQuantity > 0 && row.soldOn > entry.last) entry.last = row.soldOn;
    byProduct.set(row.productId, entry);
  }
  const products = [...byProduct.values()].map(({ row, pieces, buybackPieces, gross, net, last }) => ({
    productId: row.productId, name: row.name, variant: row.variant, pieces, buybackPieces,
    grossEur: gross / 100, netEur: net / 100, averageEur: pieces > 0 ? Math.round(gross / pieces) / 100 : null, lastSoldOn: last || row.soldOn,
  })).sort((left, right) => right.grossEur - left.grossEur || right.pieces - left.pieces || left.name.localeCompare(right.name, 'nl'));
  const open = openTotals(reports);
  const { unconfirmed, ...openFigures } = open;
  return {
    all: totals(reports),
    auction: totals(reports.filter((row) => row.channel === 'AUCTION')),
    direct: totals(reports.filter((row) => row.channel === 'DIRECT')),
    open: openFigures,
    openUnconfirmed: unconfirmed,
    reports, productRows, products,
  };
}

/** "Veiling", "Direct", "Terugkoop" (a buyback-only melding): the partner's own words. */
export function partnerSaleKind(row: Pick<PartnerSalesAnalyticsReport, 'channel' | 'saleQuantity' | 'buybackQuantity'>): string {
  if (row.channel === 'DIRECT') return 'Direct';
  return row.saleQuantity <= 0 && row.buybackQuantity > 0 ? 'Terugkoop' : 'Veiling';
}
