/*
 * Stock batches (2026-10-25) on the purchase order: what became of the
 * batches this container booked, row by row, and the batch part of the
 * container's costs step. A batch is born when the container's stock is
 * booked; "Kostprijzen toepassen" puts this container's cost on it. Pure and
 * node-tested (tests/purchase-batches.test.mts): type-only imports, the unit
 * words and euro text come in as a BatchFormat from the component.
 */
import type { PurchaseStockBatchRow, PurchaseStockBatches, StockBatchCostState } from '../../core/api/stock-batch-models';
import type { BatchFormat } from '../../core/api/stock-batch-units';
import type { CostsStale } from './purchase-apply-costs';

export interface PurchaseBatchRow {
  productId: number;
  name: string;
  /** The cell's second line: the SKU (the row carries no colour or size of its own). */
  variant: string | null;
  /** "500 displays", "380 stuks": what the container booked into stock. */
  received: string;
  /** Sold, lost, gone before the start and other takes, together. */
  out: string;
  /** "380 verkocht · 15 verlies · 5 vóór de start"; null when nothing left the batch. */
  outDetail: string | null;
  left: string;
  /** "€ 8,3180" per unit of the batch; null without a cost. */
  cost: string | null;
  /** "toegepast", "berekend", "van productkaart", "kost onbekend"; stale: "nu € 10,3858". */
  costNote: string | null;
  stale: boolean;
  /** The figure the container calculates now while stale, without its euro sign ("10,3858"): the phone shows "€ 8,3180 → 10,3858". */
  costNow: string | null;
  valueEur: number | null;
  productLink: (string | number)[];
}

const STATE_WORD: Readonly<Record<StockBatchCostState, string>> = {
  APPLIED: 'toegepast',
  CALCULATED: 'berekend',
  CARD: 'van productkaart',
  NONE: 'kost onbekend',
};

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

/** "10,3858" out of "€ 10,3858": the second figure of a change needs no second euro sign. */
function bare(text: string): string {
  return text.replace(/^€[\s  ]*/, '');
}

function outDetail(row: PurchaseStockBatchRow, fmt: BatchFormat): string | null {
  const parts = [
    row.soldPieces > 0 ? `${fmt.count(row.soldPieces, row.unitPieces)} verkocht` : null,
    row.lostPieces > 0 ? `${fmt.count(row.lostPieces, row.unitPieces)} verlies` : null,
    row.earlierPieces > 0 ? `${fmt.count(row.earlierPieces, row.unitPieces)} vóór de start` : null,
  ].filter((part): part is string => part !== null);
  return parts.length ? parts.join(' · ') : null;
}

function batchRow(row: PurchaseStockBatchRow, fmt: BatchFormat): PurchaseBatchRow {
  const out = row.soldPieces + row.lostPieces + row.earlierPieces + row.otherPieces;
  const cost = row.unitCostEur == null ? null : fmt.eur(row.unitCostEur, 4);
  const stale = row.stale && row.calcUnitEur != null;
  return {
    productId: row.productId,
    name: row.productName,
    variant: row.sku?.trim() || null,
    received: fmt.units(row.piecesIn, row.unitPieces),
    out: fmt.units(out, row.unitPieces),
    outDetail: outDetail(row, fmt),
    left: fmt.units(row.piecesLeft, row.unitPieces),
    cost,
    costNote: stale ? `nu ${fmt.eur(row.calcUnitEur, 4)}` : STATE_WORD[row.costState] ?? null,
    stale,
    costNow: stale ? bare(fmt.eur(row.calcUnitEur, 4)) : null,
    valueEur: row.valueLeftEur,
    productLink: ['/products', row.productId],
  };
}

/** One row per batch of this container, in the order of its lines. */
export function purchaseBatchRows(data: PurchaseStockBatches, fmtFor: (productId: number) => BatchFormat): PurchaseBatchRow[] {
  return data.rows.map((row) => batchRow(row, fmtFor(row.productId)));
}

/** "Oudste batch gaat eerst · nog € 12.341 op voorraad". */
export function purchaseBatchSummary(data: PurchaseStockBatches, eur: BatchFormat['eur']): string {
  return `Oudste batch gaat eerst · nog ${eur(data.totals.valueLeftEur, 0)} op voorraad`;
}

/** Live batches of this container still carry its calculation: the costs step is offered until it is applied. */
export function batchPending(data: PurchaseStockBatches | null | undefined): boolean {
  return !!data?.started && data.costs.calculated > 0;
}

/**
 * Live batches whose cost this container no longer calculates; zeros while batches have not started.
 * The largest change is signed like the card's: above 0 when the container now calculates more.
 */
export function batchStale(data: PurchaseStockBatches | null): { count: number; productIds: number[]; largestEur: number } {
  if (!data?.started) return { count: 0, productIds: [], largestEur: 0 };
  const productIds: number[] = [];
  let largestEur = 0;
  for (const row of data.rows) {
    if (!row.stale || row.piecesLeft <= 0) continue;
    if (!productIds.includes(row.productId)) productIds.push(row.productId);
    if (row.calcUnitEur == null || row.unitCostEur == null) continue;
    const change = round4(row.calcUnitEur - row.unitCostEur);
    if (Math.abs(change) > Math.abs(largestEur)) largestEur = change;
  }
  if (productIds.length && largestEur === 0) largestEur = data.costs.staleLargestEur ?? 0;
  return { count: productIds.length, productIds, largestEur };
}

/** The card part and the batch part in one: each product once, the largest change of either. */
export function mergeStale(card: CostsStale, batch: ReturnType<typeof batchStale>): CostsStale {
  const productIds = [...card.productIds];
  for (const id of batch.productIds) if (!productIds.includes(id)) productIds.push(id);
  const largestEur = Math.abs(batch.largestEur) > Math.abs(card.largestEur) ? batch.largestEur : card.largestEur;
  return { count: productIds.length, productIds, largestEur };
}

/** What each product still has on the shelf from this container, in pieces and the batch's unit; empty before the start. */
export function batchPiecesByProduct(data: PurchaseStockBatches | null): Map<number, { pieces: number; unitPieces: number }> {
  const left = new Map<number, { pieces: number; unitPieces: number }>();
  if (!data?.started) return left;
  for (const row of data.rows) {
    const known = left.get(row.productId);
    left.set(row.productId, { pieces: (known?.pieces ?? 0) + row.piecesLeft, unitPieces: known?.unitPieces ?? row.unitPieces });
  }
  return left;
}

/** The phone figures: products, the value left, and how many batches sold out. */
export function purchaseBatchFigures(data: PurchaseStockBatches): { products: number; valueLeftEur: number; soldOut: number } {
  return {
    products: new Set(data.rows.map((row) => row.productId)).size,
    valueLeftEur: data.totals.valueLeftEur,
    soldOut: data.rows.filter((row) => row.piecesLeft <= 0).length,
  };
}
