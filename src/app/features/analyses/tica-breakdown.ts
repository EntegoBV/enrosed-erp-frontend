import type { TicaAnalyticsDay, TicaSale, TicaSalesPage } from '../../core/api/tica-api';

/*
 * Analyses › Verkoop › TICA (2026-10-20, Emre: "analytics niet vergeten"):
 * what the TICA channel row cannot say - the average price per piece and
 * per sale, the discount, the best products and, with more than one, the
 * vestigingen. Omzet and transacties stay in "Omzet per kanaal" (withTicaSales):
 * nothing here adds to a total, so nothing counts twice.
 *
 * Pure and node-tested: type imports only.
 */

const DAY_MS = 86_400_000;
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const cents = (value: number): number => Math.round((value + Number.EPSILON) * 100);
const utc = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

export interface TicaProductRow {
  key: string; productId: number | null; name: string; code: string | null;
  pieces: number; netEur: number; perPieceEur: number | null; transactions: number;
}
export interface TicaPlaceRow { location: string; transactions: number; pieces: number; netEur: number }
export interface TicaBreakdown {
  transactions: number; pieces: number; netEur: number; discountEur: number; unmatchedLines: number;
  perPieceEur: number | null; perSaleEur: number | null;
  products: TicaProductRow[]; locations: TicaPlaceRow[];
  /** False when the lines stopped at the loader's cap: the figures are the server's sums, the products the newest lines. */
  complete: boolean;
}

/**
 * The lines to load for an Analyses period, or null when TICA sold nothing in it. An open start ('Alle') begins at
 * the first TICA day; the server takes at most 366 days, so a longer period keeps its last 366.
 */
export function ticaLineRange(from: string, to: string, days: readonly TicaAnalyticsDay[], today: string): { from: string; to: string } | null {
  const end = to || today;
  const sold = days.filter((day) => (!from || day.date >= from) && day.date <= end && (day.transactionCount > 0 || day.revenueExcl !== 0))
    .map((day) => day.date).sort();
  if (!sold.length) return null;
  const start = from || sold[0];
  const earliest = new Date(utc(end) - 365 * DAY_MS).toISOString().slice(0, 10);
  return { from: start < earliest ? earliest : start, to: end };
}

/**
 * The pieces a line sold: an article the stock link maps as a full display of N (e1c0ea6) is N pieces, anything
 * else TICA's quantity. The same rule as ticaPieces in tica/tica-list-model.ts (kept apart: type imports only here).
 */
export function linePieces(line: Pick<TicaSale, 'quantity' | 'stockSourceUnit' | 'stockUnitPieces'>): number {
  const per = line.stockSourceUnit === 'DISPLAY' && (line.stockUnitPieces ?? 0) > 1 ? line.stockUnitPieces! : 0;
  return per ? line.quantity * per : line.quantity;
}

const keyOf = (line: TicaSale): string => (line.productId !== null && line.mappingStatus === 'MATCHED' ? `p${line.productId}`
  : `a${(line.sku || line.beeyondArticleNumber || line.description).trim().toLocaleLowerCase('nl')}`);
const receiptOf = (line: TicaSale): string => `${line.exhibitor}|${line.location}|${line.transactionNumber}`;

/**
 * The breakdown of a period: the server's sums from the first page, products and vestigingen from the lines. The
 * pieces are the server's TICA quantity raised by the extra pieces of the full-display lines (all of them when the
 * lines are complete), so 'Gem. per stuk' is per piece, not per display.
 */
export function ticaBreakdown(page: Pick<TicaSalesPage, 'transactionCount' | 'quantity' | 'grossTotal' | 'netTotal' | 'unmatchedLineCount'>,
  lines: readonly TicaSale[], complete: boolean): TicaBreakdown {
  const products = new Map<string, { row: TicaProductRow; receipts: Set<string>; latest: string }>();
  const places = new Map<string, { row: TicaPlaceRow; receipts: Set<string> }>();
  let extraPieces = 0;
  for (const line of lines) {
    const key = keyOf(line);
    const pieces = linePieces(line);
    extraPieces += pieces - line.quantity;
    const product = products.get(key) ?? { row: { key, productId: key.startsWith('p') ? line.productId : null, name: line.description || 'Artikel zonder omschrijving',
      code: line.sku || line.beeyondArticleNumber || null, pieces: 0, netEur: 0, perPieceEur: null, transactions: 0 }, receipts: new Set<string>(), latest: '' };
    product.row.pieces += pieces;
    product.row.netEur = (cents(product.row.netEur) + cents(line.netTotal)) / 100;
    product.receipts.add(receiptOf(line));
    if (line.soldAt > product.latest && line.description) { product.latest = line.soldAt; product.row.name = line.description; }
    products.set(key, product);
    const place = places.get(line.location) ?? { row: { location: line.location || 'Onbekende vestiging', transactions: 0, pieces: 0, netEur: 0 }, receipts: new Set<string>() };
    place.row.pieces += pieces;
    place.row.netEur = (cents(place.row.netEur) + cents(line.netTotal)) / 100;
    place.receipts.add(receiptOf(line));
    places.set(line.location, place);
  }
  const productRows = [...products.values()].map(({ row, receipts }) => ({ ...row, transactions: receipts.size,
    perPieceEur: row.pieces > 0 ? money(row.netEur / row.pieces) : null }))
    .sort((a, b) => b.netEur - a.netEur || b.pieces - a.pieces || a.name.localeCompare(b.name, 'nl'));
  const placeRows = [...places.values()].map(({ row, receipts }) => ({ ...row, transactions: receipts.size }))
    .sort((a, b) => b.netEur - a.netEur || a.location.localeCompare(b.location, 'nl'));
  const pieces = page.quantity + extraPieces;
  return {
    transactions: page.transactionCount, pieces, netEur: money(page.netTotal),
    discountEur: Math.max(0, cents(page.grossTotal) - cents(page.netTotal)) / 100, unmatchedLines: page.unmatchedLineCount,
    perPieceEur: pieces > 0 ? money(page.netTotal / pieces) : null,
    perSaleEur: page.transactionCount > 0 ? money(page.netTotal / page.transactionCount) : null,
    products: productRows, locations: placeRows, complete,
  };
}
