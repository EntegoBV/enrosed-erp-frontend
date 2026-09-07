/**
 * The sums behind a partner deal's closing invoice: what the partner made
 * on the container above what they paid us, and how that is split.
 */
export interface SettlementSplit {
  costBasis: number;
  proceeds: number;
  profit: number;
  ours: number;
  theirs: number;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function settlementSplit(proceeds: number, costBasis: number, sharePct: number): SettlementSplit {
  const safeProceeds = Number.isFinite(proceeds) && proceeds > 0 ? proceeds : 0;
  const safeBasis = Number.isFinite(costBasis) && costBasis > 0 ? costBasis : 0;
  const share = Number.isFinite(sharePct) ? Math.min(100, Math.max(0, sharePct)) : 0;
  const profit = round2(safeProceeds - safeBasis);
  const ours = profit > 0 ? round2(profit * share / 100) : 0;
  return { costBasis: round2(safeBasis), proceeds: round2(safeProceeds), profit, ours, theirs: round2(Math.max(0, profit) - ours) };
}

/** The description every settlement line starts with; the invoice is recognised by it. */
export const SETTLEMENT_LINE_PREFIX = 'Winstdeling';

/** A document that looks like a partner-deal settlement: no goods, only our share as a free line. */
export function isSettlementInvoice(order: {
  docType?: string | null;
  partnerPurchaseOrderId?: number | null;
  lines?: readonly unknown[] | null;
  extraLines?: readonly { description: string }[] | null;
}): boolean {
  if (order.docType !== 'FACTUUR' || !order.partnerPurchaseOrderId) return false;
  if ((order.lines ?? []).length > 0) return false;
  return (order.extraLines ?? []).some((line) => (line.description ?? '').startsWith(SETTLEMENT_LINE_PREFIX));
}

/** What a linked sales document is in the partner's story: the quote, the invoice or the settlement. */
export function partnerDocumentKind(order: Parameters<typeof isSettlementInvoice>[0]): string {
  if (order.docType !== 'FACTUUR') return 'Offerte aan kostprijs';
  return isSettlementInvoice(order) ? 'Slotfactuur winstdeling' : 'Factuur aan kostprijs';
}
