/*
 * The figures the product screens add up: the margin on a price, what is on
 * the way for a product or a series, and stock value at landed cost. Sums
 * stay unit-safe: quantities are only added within one product or series,
 * across products the screens add euros. Pure and import-free: node-tested.
 */

export interface Margin {
  /** Euros per sales unit, rounded to the cent as the desk always did. */
  eur: number;
  /** Whole percent of the price. */
  pct: number;
}

/** Catalogue price minus landed cost; null without a price or a cost. */
export function productMargin(price: number | null | undefined, landed: number | null | undefined): Margin | null {
  if (price === null || price === undefined || !(price > 0)) return null;
  if (landed === null || landed === undefined || !(landed > 0)) return null;
  const eur = Math.round((price - landed) * 100) / 100;
  return { eur, pct: Math.round((eur / price) * 100) };
}

/** What sourcing says is on the way for one product (ExpectedStock). */
export interface ExpectedLike {
  productId: number;
  quantity: number;
  expectedArrival: string | null;
  orderNumbers: string[];
  orderIds: number[];
}

export interface Onderweg {
  quantity: number;
  /** The earliest known arrival (yyyy-mm-dd), else null. */
  earliest: string | null;
  orderNumbers: string[];
  orderIds: number[];
}

/** One product's or one series' pieces on the way, its earliest date and its orders (each once, in order). */
export function onderwegSummary(items: readonly (ExpectedLike | null | undefined)[]): Onderweg | null {
  let quantity = 0;
  let earliest: string | null = null;
  const numbers: string[] = [];
  const ids: number[] = [];
  for (const item of items) {
    if (!item || !(item.quantity > 0)) continue;
    quantity += item.quantity;
    if (item.expectedArrival && (earliest === null || item.expectedArrival < earliest)) earliest = item.expectedArrival;
    item.orderNumbers.forEach((number, index) => {
      if (numbers.includes(number)) return;
      numbers.push(number);
      const id = item.orderIds[index];
      if (id !== undefined) ids.push(id);
    });
  }
  return quantity > 0 ? { quantity, earliest, orderNumbers: numbers, orderIds: ids } : null;
}

/** "PO-2026-013", or "PO-2026-013 +1" when more orders carry it. */
export function onderwegOrdersLabel(orderNumbers: readonly string[]): string {
  if (!orderNumbers.length) return '';
  return orderNumbers.length > 1 ? `${orderNumbers[0]} +${orderNumbers.length - 1}` : orderNumbers[0];
}

/** How many distinct purchase orders carry anything on the way. */
export function distinctOrderCount(items: readonly ExpectedLike[]): number {
  return new Set(items.flatMap((item) => item.orderIds)).size;
}

export interface ValueRow {
  quantity: number;
  /** Landed cost per sales unit; null or 0 when unknown. */
  cost: number | null | undefined;
}

export interface StockValue {
  /** Euros at landed cost, rounded to the cent. */
  value: number;
  /** Rows that hold stock but have no cost: they are not in the value. */
  withoutCost: number;
}

/** Stock times landed cost; rows without a cost are counted apart, never valued at zero silently. */
export function stockValue(rows: readonly ValueRow[]): StockValue {
  let cents = 0;
  let withoutCost = 0;
  for (const row of rows) {
    if (!(row.quantity > 0)) continue;
    if (row.cost === null || row.cost === undefined || !(row.cost > 0)) { withoutCost += 1; continue; }
    cents += Math.round(row.quantity * row.cost * 100);
  }
  return { value: cents / 100, withoutCost };
}

/** One location's stock level of one product. */
export interface LevelLike {
  productId: number;
  locationId: number;
  quantity: number;
}

/** The value at landed cost per location, for every location that holds stock. */
export function locationValues(levels: readonly LevelLike[], costOf: ReadonlyMap<number, number | null | undefined>): Map<number, number> {
  const cents = new Map<number, number>();
  for (const level of levels) {
    const cost = costOf.get(level.productId);
    if (!(level.quantity > 0) || cost === null || cost === undefined || !(cost > 0)) continue;
    cents.set(level.locationId, (cents.get(level.locationId) ?? 0) + Math.round(level.quantity * cost * 100));
  }
  return new Map([...cents].map(([id, value]) => [id, value / 100]));
}

/** Pieces per product, summed over every location. */
export function totalsByProduct(levels: readonly LevelLike[]): Map<number, number> {
  const totals = new Map<number, number>();
  for (const level of levels) totals.set(level.productId, (totals.get(level.productId) ?? 0) + level.quantity);
  return totals;
}

/** "Zaltbommel 1.960 · Tica Brussel 8": the locations that hold stock, in the order given. */
export function locationSplit(entries: readonly { name: string; quantity: number }[]): string {
  return entries.filter((entry) => entry.quantity !== 0)
    .map((entry) => `${entry.name} ${entry.quantity.toLocaleString('nl-BE')}`).join(' · ');
}
