import { QuoteStatus, SalesOrder } from '../../core/api/models';

/**
 * Machine-readable source marker used by the public quote endpoint.
 *
 * Keep this out of customer-facing copy: the marker belongs to the internal
 * workflow only. A public request stays actionable until somebody sends it
 * as a real quote, so only a concept with this prefix counts as new work.
 */
export const WEBSITE_QUOTE_REQUEST_PREFIX = '[WEBSITE_AANVRAAG]';
const CARTON_CONFIRMATION_PREFIX = '[DOOSINHOUD_TE_BEPALEN]';

export interface WebsiteCartonRequest {
  productId: number | null;
  sku: string | null;
  cartons: number | null;
}

function splitWebsiteRequestNotes(notes: string): {
  machineLines: string[];
  visibleLines: string[];
} | null {
  const normalized = notes.trimStart();
  if (!normalized.startsWith(WEBSITE_QUOTE_REQUEST_PREFIX)) return null;

  const lines = normalized.split(/\r?\n/);
  return {
    machineLines: lines.filter((line, index) => (
      index === 0 || line.startsWith(CARTON_CONFIRMATION_PREFIX)
    )),
    visibleLines: lines.filter((line, index) => (
      index > 0 && !line.startsWith(CARTON_CONFIRMATION_PREFIX)
    )),
  };
}

export function isWebsiteQuoteRequest(order: SalesOrder | null | undefined): boolean {
  return order?.status === 'CONCEPT'
    && !!order.internalNotes?.trimStart().startsWith(WEBSITE_QUOTE_REQUEST_PREFIX);
}

/** Hide the machine header while leaving any real team note editable. */
export function internalNotesForDisplay(order: SalesOrder | null | undefined): string {
  const notes = order?.internalNotes ?? '';
  const split = splitWebsiteRequestNotes(notes);
  return split ? split.visibleLines.join('\n') : notes;
}

/** Preserve the source/reference header when an admin edits the visible note. */
export function replaceInternalNotesForDisplay(
  order: SalesOrder | null | undefined,
  visibleNotes: string,
): string | null {
  const notes = order?.internalNotes ?? '';
  const split = splitWebsiteRequestNotes(notes);
  if (!split) return visibleNotes || null;

  const visible = visibleNotes.trim();
  return [...split.machineLines, ...(visible ? [visible] : [])].join('\n');
}

/**
 * Carton quantities submitted by the public site when the product master does
 * not yet contain a reliable pieces-per-carton value. The original marker is
 * deliberately kept in internalNotes; this parser only makes it useful to the
 * reviewer and never becomes a second source of truth.
 */
export function websiteCartonRequests(
  order: SalesOrder | null | undefined,
): WebsiteCartonRequest[] {
  const notes = order?.internalNotes ?? '';
  const split = splitWebsiteRequestNotes(notes);
  if (!split) return [];

  return split.machineLines.flatMap((line) => {
    if (!line.startsWith(CARTON_CONFIRMATION_PREFIX)) return [];
    const payload = line.slice(CARTON_CONFIRMATION_PREFIX.length).trim();
    const value = (key: string): string | null => {
      const match = payload.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`));
      return match?.[1]?.trim() || null;
    };
    const productId = Number(value('productId'));
    const cartons = Number(value('cartons'));
    return [{
      productId: Number.isInteger(productId) && productId > 0 ? productId : null,
      sku: value('sku'),
      cartons: Number.isFinite(cartons) && cartons > 0 ? cartons : null,
    }];
  });
}

/** One place for how a quote status looks. */
export const STATUS_LABEL: Record<QuoteStatus, string> = {
  CONCEPT: 'Concept',
  VERZONDEN: 'Verzonden',
  BEKEKEN: 'Bekeken',
  WIJZIGING_GEVRAAGD: 'Wijziging gevraagd',
  GEACCEPTEERD: 'Geaccepteerd',
  AFGEWEZEN: 'Afgewezen',
  VERLOPEN: 'Verlopen',
  GEANNULEERD: 'Geannuleerd',
  BETAALD: 'Betaald',
};

export function statusClass(status: QuoteStatus): string {
  switch (status) {
    case 'GEACCEPTEERD': return 'ok';
    case 'BETAALD': return 'ok';
    case 'AFGEWEZEN': return 'danger';
    case 'WIJZIGING_GEVRAAGD': return 'gold';
    case 'VERZONDEN': return 'rose';
    case 'BEKEKEN': return 'blue';
    default: return 'neutral';
  }
}

/**
 * Does this quote lie with us or with the customer?
 *
 * On a list of dozens of orders the status alone is not enough: "Verzonden"
 * does not say whether to wait or to act. This is the question you ask on
 * every row, so the answer sits right next to it.
 */
export function actionNeeded(order: SalesOrder, awaitingResend = false): string | null {
  if (order.status === 'WIJZIGING_GEVRAAGD') return 'Voorstel beoordelen';
  if (order.status === 'AFGEWEZEN') return 'Heropenen of laten';
  /* An adopted proposal outranks a plain draft: the customer is waiting.
     A plain concept gets no nag - inkoop stays quiet about those too. */
  if (order.status === 'CONCEPT' && awaitingResend) return 'Klant wacht op nieuwe versie';

  /* A sent quote with an open item waits on us, not on the customer. */
  const open = order.status === 'VERZONDEN' || order.status === 'BEKEKEN';
  if (open && order.deliveryTerms === 'TE_BEPALEN') return 'Levertermijn invullen';
  if (open && order.freight === 'TE_BEPALEN') return 'Vracht invullen';

  return null;
}
