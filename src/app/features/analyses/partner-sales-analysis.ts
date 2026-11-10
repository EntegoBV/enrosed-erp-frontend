import type { PartnerSalesAnalytics, PartnerSalesAnalyticsProduct, PartnerSalesAnalyticsReport } from '../../core/api/partner-sales-api';

/*
 * Verkoop › Veilingverkopen (contract 7c Analyses): what the partner reported
 * as sold at auction or directly, by sold_on, from GET /api/partner-sales/
 * analytics (every non-voided melding, no cap). Its own layer: never in Omzet
 * or Resultaat (the invoice made from the meldingen counts there, on its own
 * date). Additive figures only (stuks, bruto, netto, nog te factureren), each
 * a plain sum of the period's melding rows so its drill adds up exactly; the
 * average is derived per product (bruto / stuks), never summed across them.
 * Pure: type imports only.
 */

export interface PartnerSalesTotals {
  /** Meldingen. */
  reports: number;
  /** Sold pieces (sales units); buybacks apart. */
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
  /** Weighted average price per sales unit: gross / pieces; null without a sale. */
  averageEur: number | null;
  lastSoldOn: string;
}

export interface PartnerSalesFigures {
  all: PartnerSalesTotals;
  auction: PartnerSalesTotals;
  direct: PartnerSalesTotals;
  /** Not (fully) invoiced yet: the server's open flag (OPEN and PARTLY_INVOICED). */
  open: PartnerSalesTotals;
  /** The period's meldingen, newest first. */
  reports: readonly PartnerSalesAnalyticsReport[];
  /** The period's melding x product rows (a product's drill). */
  productRows: readonly PartnerSalesAnalyticsProduct[];
  /** Per product, highest bruto first. */
  products: PartnerSalesProductRow[];
}

const cents = (value: number | null | undefined): number => Math.round((Number.isFinite(value as number) ? value as number : 0) * 100);
const whole = (value: number | null | undefined): number => (Number.isFinite(value as number) ? Math.trunc(value as number) : 0);
const inRange = (day: string, from: string | null, to: string | null): boolean =>
  /^\d{4}-\d{2}-\d{2}/.test(day) && (!from || day.slice(0, 10) >= from) && (!to || day.slice(0, 10) <= to);

function totals(rows: readonly PartnerSalesAnalyticsReport[]): PartnerSalesTotals {
  let pieces = 0, buybackPieces = 0, gross = 0, costs = 0, buyback = 0, net = 0;
  for (const row of rows) {
    pieces += whole(row.saleQuantity);
    buybackPieces += whole(row.buybackQuantity);
    gross += cents(row.grossEur);
    costs += cents(row.costsEur);
    buyback += cents(row.buybackEur);
    net += cents(row.netEur);
  }
  return { reports: rows.length, pieces, buybackPieces, grossEur: gross / 100, costsEur: costs / 100, buybackEur: buyback / 100, netEur: net / 100 };
}

/** The meldingen sold in [from, to] (either may be null: open-ended), by sold_on. */
export function partnerSalesInPeriod(data: PartnerSalesAnalytics, from: string | null, to: string | null): PartnerSalesFigures {
  const reports = (data.reports ?? []).filter((row) => inRange(row.soldOn, from, to))
    .sort((left, right) => right.soldOn.localeCompare(left.soldOn) || right.id - left.id);
  const ids = new Set(reports.map((row) => row.id));
  const productRows = (data.products ?? []).filter((row) => ids.has(row.reportId));
  const byProduct = new Map<number, { row: PartnerSalesAnalyticsProduct; pieces: number; buybackPieces: number; gross: number; net: number; last: string }>();
  for (const row of productRows) {
    const entry = byProduct.get(row.productId) ?? { row, pieces: 0, buybackPieces: 0, gross: 0, net: 0, last: '' };
    entry.pieces += whole(row.saleQuantity);
    entry.buybackPieces += whole(row.buybackQuantity);
    entry.gross += cents(row.grossEur);
    entry.net += cents(row.netEur);
    if (row.saleQuantity > 0 && row.soldOn > entry.last) entry.last = row.soldOn;
    byProduct.set(row.productId, entry);
  }
  const products = [...byProduct.values()].map(({ row, pieces, buybackPieces, gross, net, last }) => ({
    productId: row.productId, name: row.name, variant: row.variant, pieces, buybackPieces,
    grossEur: gross / 100, netEur: net / 100, averageEur: pieces > 0 ? Math.round(gross / pieces) / 100 : null, lastSoldOn: last || row.soldOn,
  })).sort((left, right) => right.grossEur - left.grossEur || right.pieces - left.pieces || left.name.localeCompare(right.name, 'nl'));
  return {
    all: totals(reports),
    auction: totals(reports.filter((row) => row.channel === 'AUCTION')),
    direct: totals(reports.filter((row) => row.channel === 'DIRECT')),
    open: totals(reports.filter((row) => row.open)),
    reports, productRows, products,
  };
}

/** "Veiling", "Direct", "Terugkoop" (a buyback-only melding): the partner's own words. */
export function partnerSaleKind(row: Pick<PartnerSalesAnalyticsReport, 'channel' | 'saleQuantity' | 'buybackQuantity'>): string {
  if (row.channel === 'DIRECT') return 'Direct';
  return row.saleQuantity <= 0 && row.buybackQuantity > 0 ? 'Terugkoop' : 'Veiling';
}
