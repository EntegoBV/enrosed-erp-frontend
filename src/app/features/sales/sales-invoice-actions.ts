import type { SalesOrderView } from '../../core/api/models';

/**
 * Converting a quotation creates a draft invoice; sending is a separate action.
 *
 * A website order is invoiced only once staff took it and while its figures
 * are the ordered or the approved ones; the server guard stays the authority.
 */
export function canCreateInvoiceFromQuote(view: SalesOrderView | null | undefined): boolean {
  if (!view) return false;
  const order = view.order;
  const webOrder = view.webOrder;
  return (order.docType ?? 'OFFERTE') === 'OFFERTE'
    && !order.archivedAt && !view.invoicedAsId && !view.invoicedAs
    && !view.advanceAgreement
    && (order.status === 'CONCEPT' || order.status === 'GEACCEPTEERD')
    && (!webOrder || (!webOrder.customerEditable && (webOrder.termsState === 'ORDER_EQUAL' || webOrder.termsState === 'APPROVED')));
}

export interface WebOrderNoticeLine { text: string; gold: boolean }
/** The banner of a website order: `Websitebestelling · {lead}` and the lines under it. */
export interface WebOrderNotice { lead: string; lines: WebOrderNoticeLine[] }

/**
 * What desk, editor and read view say above a website order: while the
 * customer can still change it, and after staff took it with the line that
 * compares the saved document with what the customer ordered. Null for any
 * other document and for an order the customer cancelled (the note says so).
 */
export function webOrderNotice(
  view: SalesOrderView | null | undefined,
  dateTime: (value: string | null | undefined) => string,
  unsaved = false,
): WebOrderNotice | null {
  const webOrder = view?.webOrder;
  if (!view || !webOrder || webOrder.customerCancelledAt) return null;
  if (webOrder.customerEditable) {
    const summary = webOrder.customerChangeSummary?.trim();
    return {
      lead: 'de klant kan nog wijzigen. Neem ze in verwerking om te bewerken, te versturen of te factureren.',
      lines: webOrder.revision > 1
        ? [{ text: `Door de klant gewijzigd op ${dateTime(webOrder.customerChangedAt)} · versie ${webOrder.revision}${summary ? `: ${summary}` : ''}`, gold: false }]
        : [],
    };
  }
  if (!webOrder.processingStartedAt) return null;
  const by = webOrder.processingStartedBy?.trim();
  const compare = view.order.archivedAt ? null : webOrderCompareLine(view, unsaved);
  return {
    lead: `in verwerking sinds ${dateTime(webOrder.processingStartedAt)}${by ? ` door ${by}` : ''}`
      + (webOrder.processingTrigger === 'AUTOMATISCH' ? ' (automatisch bij een wijziging)' : ''),
    lines: compare ? [compare] : [],
  };
}

/** The compare line reflects the saved document; unsaved edits say so instead of guessing. */
function webOrderCompareLine(view: SalesOrderView, unsaved: boolean): WebOrderNoticeLine | null {
  const webOrder = view.webOrder;
  if (!webOrder?.termsState) return null;
  if (unsaved) return { text: 'Sla eerst op om te vergelijken met de bestelling.', gold: false };
  switch (webOrder.termsState) {
    case 'ORDER_EQUAL': {
      const ordered = webOrder.orderedTotalExclVat == null ? ''
        : ` (€ ${webOrder.orderedTotalExclVat.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} excl. btw)`;
      return { text: `Gelijk aan de bestelling van de klant${ordered}: factuur maken zonder versturen kan.`, gold: false };
    }
    case 'ORDER_DIFFERENT':
      return { text: `Wijkt af van de bestelling van de klant: ${(webOrder.differences ?? []).join(' · ')}. Verstuur ter goedkeuring.`, gold: true };
    case 'ORDER_UNKNOWN':
      return { text: 'De vracht of een prijs stond nog open toen de klant bestelde. Verstuur ter goedkeuring.', gold: true };
    case 'RESEND_REQUIRED':
      if (view.order.status === 'CONCEPT') return { text: 'Deze bestelling is al ter goedkeuring verstuurd. Verstuur de nieuwe versie; factureren kan na akkoord.', gold: true };
      if (view.order.status === 'GEACCEPTEERD') return { text: 'De cijfers wijken af van de versie waarmee de klant akkoord ging. Maak een nieuwe kopie en verstuur die ter goedkeuring.', gold: true };
      return { text: 'Gewijzigd na het versturen: de klant kan de verstuurde versie niet meer goedkeuren. Verstuur opnieuw.', gold: true };
    case 'AWAITING_APPROVAL':
      return { text: 'Ter goedkeuring bij de klant. Factureren kan na akkoord.', gold: false };
    case 'APPROVED':
      return { text: 'Door de klant goedgekeurd: factuur maken kan.', gold: false };
    default:
      return null;
  }
}

/** A taken website order whose figures the customer still has to approve leaves as `Versturen ter goedkeuring`. */
export function webOrderNeedsApproval(view: SalesOrderView | null | undefined): boolean {
  const webOrder = view?.webOrder;
  if (!view || !webOrder?.processingStartedAt || view.order.status !== 'CONCEPT' || view.order.archivedAt) return false;
  return webOrder.termsState === 'ORDER_DIFFERENT' || webOrder.termsState === 'ORDER_UNKNOWN' || webOrder.termsState === 'RESEND_REQUIRED';
}
