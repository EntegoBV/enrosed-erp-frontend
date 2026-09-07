/**
 * The sums behind a partner container's auction settlement: per product,
 * what the partner made at auction above what the goods cost us landed,
 * the part of that cost we financed and now recover, and our share of the
 * profit. Mirrors the backend calculation so the sheet can preview it.
 */
export interface AuctionLineSplit {
  cost: number;
  proceeds: number;
  profit: number;
  /** The financed cost we recover. */
  costPart: number;
  /** Our share of the profit; negative when the auction fell short. */
  profitPart: number;
  /** What goes on the invoice for this product: never below zero. */
  ours: number;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
const pct = (value: number): number => (Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0);

export function auctionLineSplit(
  quantity: number,
  proceedsEur: number,
  landedUnitCostEur: number,
  costSharePct: number,
  profitSharePct: number,
): AuctionLineSplit {
  const pieces = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
  const proceeds = Number.isFinite(proceedsEur) && proceedsEur > 0 ? proceedsEur : 0;
  const cost = round2(pieces * (Number.isFinite(landedUnitCostEur) && landedUnitCostEur > 0 ? landedUnitCostEur : 0));
  const profit = round2(proceeds - cost);
  const costPart = round2(cost * pct(costSharePct) / 100);
  const profitPart = round2(profit * pct(profitSharePct) / 100);
  return { cost, proceeds: round2(proceeds), profit, costPart, profitPart, ours: Math.max(0, round2(costPart + profitPart)) };
}

export function auctionTotals(splits: readonly AuctionLineSplit[]): AuctionLineSplit {
  const sum = (pick: (split: AuctionLineSplit) => number): number => round2(splits.reduce((total, split) => total + pick(split), 0));
  return {
    cost: sum((split) => split.cost),
    proceeds: sum((split) => split.proceeds),
    profit: sum((split) => split.profit),
    costPart: sum((split) => split.costPart),
    profitPart: sum((split) => split.profitPart),
    ours: sum((split) => split.ours),
  };
}

/** The description the old one-line settlements started with; kept so they are still recognised. */
export const SETTLEMENT_LINE_PREFIX = 'Winstdeling';

/** A document that is a partner-deal settlement: flagged by the server, or an older one-line settlement. */
export function isSettlementInvoice(order: {
  docType?: string | null;
  partnerPurchaseOrderId?: number | null;
  partnerSettlement?: boolean | null;
  lines?: readonly unknown[] | null;
  extraLines?: readonly { description: string }[] | null;
}): boolean {
  if (order.docType !== 'FACTUUR' || !order.partnerPurchaseOrderId) return false;
  if (order.partnerSettlement) return true;
  if ((order.lines ?? []).length > 0) return false;
  return (order.extraLines ?? []).some((line) => (line.description ?? '').startsWith(SETTLEMENT_LINE_PREFIX));
}

/** What a linked sales document is in the partner's story: the quote, the invoice or the settlement. */
export function partnerDocumentKind(order: Parameters<typeof isSettlementInvoice>[0]): string {
  if (order.docType !== 'FACTUUR') return 'Offerte aan kostprijs';
  return isSettlementInvoice(order) ? 'Veilingafrekening' : 'Factuur aan kostprijs';
}
