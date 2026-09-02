/** Shared thresholds for the committed swipe used by sales document rows. */
export const SALES_SWIPE_REVEAL_PX = 38;
export const SALES_SWIPE_COMMIT_PX = 130;
export const SALES_SWIPE_MAX_PX = 150;
export const SALES_SWIPE_ACTION_PX = 76;

export type SalesSwipeDecision = 'close' | 'reveal' | 'commit';

/** Keep the row on its rail; dragging right never moves it beyond rest. */
export function clampSalesSwipeOffset(offset: number): number {
  return Math.max(-SALES_SWIPE_MAX_PX, Math.min(0, offset));
}

/** Turns a leftward row offset into the one action the list should take. */
export function salesSwipeDecision(offset: number): SalesSwipeDecision {
  if (offset <= -SALES_SWIPE_COMMIT_PX) return 'commit';
  if (offset <= -SALES_SWIPE_REVEAL_PX) return 'reveal';
  return 'close';
}

/**
 * Only a never-used concept is locally offered for deletion. Creating a
 * customer-link token alone does not mean the quote left Enrosed, so that is
 * deliberately not a blocker. The backend remains authoritative for facts
 * the list cannot know, such as revisions or an invoice derived from a quote.
 */
export function isLocallyDeletableSalesDocument(order: {
  status: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  viewCount: number;
  decidedAt: string | null;
}): boolean {
  return order.status === 'CONCEPT'
    && order.sentAt === null
    && order.viewedAt === null
    && order.viewCount === 0
    && order.decidedAt === null;
}

/**
 * The overview deliberately also offers deletion for sent and handled quotes.
 * Invoices retain the stricter unused-concept guard above.
 */
export function isSwipeDeletableSalesDocument(order: {
  docType?: string | null;
  status: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  viewCount: number;
  decidedAt: string | null;
}): boolean {
  return (order.docType ?? 'OFFERTE') !== 'FACTUUR'
    || isLocallyDeletableSalesDocument(order);
}

export function salesDocumentLabel(docType: string | null | undefined): 'Offerte' | 'Verkoopfactuur' {
  return docType === 'FACTUUR' ? 'Verkoopfactuur' : 'Offerte';
}
