import type { SalesOrderView, WebOrderAgreement } from '../../core/api/models';

export type { WebOrderAgreement };

/**
 * Converting a quotation creates a draft invoice; sending is a separate action.
 *
 * Also afterwards: a quotation sent and not answered yet (Verzonden, Bekeken)
 * is invoiced once staff confirm the customer agreed outside the link. A
 * website order is invoiced only once staff took it, while its figures are the
 * ordered or the approved ones, or with that same confirmation; never an
 * approved version whose figures moved since. The server guard stays the
 * authority.
 */
export function canCreateInvoiceFromQuote(view: SalesOrderView | null | undefined): boolean {
  if (!view) return false;
  const order = view.order;
  const webOrder = view.webOrder;
  if ((order.docType ?? 'OFFERTE') !== 'OFFERTE' || order.archivedAt || view.invoicedAsId || view.invoicedAs
    || view.advanceAgreement) return false;
  if (!['CONCEPT', 'VERZONDEN', 'BEKEKEN', 'GEACCEPTEERD'].includes(order.status)) return false;
  if (!webOrder) return true;
  if (webOrder.customerEditable) return false;
  return webOrder.termsState === 'ORDER_EQUAL' || webOrder.termsState === 'APPROVED'
    || (!!webOrder.termsState && order.status !== 'GEACCEPTEERD');
}

/**
 * The invoice notes that the customer agreed outside the link: the quotation
 * waits for the customer's answer, or it is a website order whose figures the
 * customer never approved. The confirm says so and the server records it.
 */
export function invoiceNotesAgreement(view: SalesOrderView | null | undefined): boolean {
  if (!view || !canCreateInvoiceFromQuote(view)) return false;
  const status = view.order.status;
  if (status === 'VERZONDEN' || status === 'BEKEKEN') return true;
  const terms = view.webOrder?.termsState;
  return status === 'CONCEPT' && !!terms && terms !== 'ORDER_EQUAL' && terms !== 'APPROVED';
}

export interface WebOrderNoticeLine { text: string; gold: boolean }
/** The banner of a website order: `Websitebestelling · {lead}` and the lines under it. */
export interface WebOrderNotice { lead: string; lines: WebOrderNoticeLine[] }

/**
 * What desk, editor and read view say above a website order: while the
 * customer can still change it, and after staff took it with the line that
 * compares the saved document with what the customer ordered. An order the
 * customer cancelled says so here too: it is the first thing staff must read.
 * Null for any other document.
 */
export function webOrderNotice(
  view: SalesOrderView | null | undefined,
  dateTime: (value: string | null | undefined) => string,
  unsaved = false,
): WebOrderNotice | null {
  const webOrder = view?.webOrder;
  if (!view || !webOrder) return null;
  if (webOrder.customerCancelledAt) return { lead: `door de klant geannuleerd op ${dateTime(webOrder.customerCancelledAt)}`, lines: [] };
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
      return { text: `Gelijk aan de bestelling van de klant${ordered}.`, gold: false };
    }
    case 'ORDER_DIFFERENT':
      return { text: `Wijkt af van de bestelling van de klant: ${(webOrder.differences ?? []).join(' · ')}.`, gold: true };
    case 'ORDER_UNKNOWN':
      return { text: 'De vracht of een prijs stond nog open toen de klant bestelde.', gold: true };
    case 'RESEND_REQUIRED':
      if (view.order.status === 'CONCEPT') return { text: 'Deze bestelling is al ter goedkeuring verstuurd en daarna gewijzigd.', gold: true };
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

/**
 * A taken website order that is still a concept leaves as `Versturen ter
 * goedkeuring`, whatever its figures: the mail the customer gets asks for
 * approval of this version.
 */
export function webOrderSendsForApproval(view: SalesOrderView | null | undefined): boolean {
  const webOrder = view?.webOrder;
  return !!view && !!webOrder?.processingStartedAt && !webOrder.customerCancelledAt
    && view.order.status === 'CONCEPT' && !view.order.archivedAt && !view.invoicedAsId && !view.invoicedAs;
}

/**
 * The order equals what the customer ordered (or approved) and is still a
 * concept: the invoice is the way on. Sending would ask the customer for a
 * second signature, so it is the secondary action there. Where the send
 * sheet offers the invoice itself (every taken order), the send button is
 * that invoice and comes first; the draft without mail stays beside it.
 */
export function webOrderInvoiceFirst(view: SalesOrderView | null | undefined): boolean {
  return !!view?.webOrder && view.order.status === 'CONCEPT' && canCreateInvoiceFromQuote(view) && !invoiceNotesAgreement(view)
    && webOrderSendChoice(view)?.defaultMode !== 'invoice';
}

/** How the customer agreed outside the link; the server records it as the approval of the figures on screen. */
export const WEB_ORDER_AGREEMENTS: ReadonlyArray<{ code: WebOrderAgreement; label: string }> = [
  { code: 'TELEFOON', label: 'Telefoon' },
  { code: 'EMAIL', label: 'E-mail' },
  { code: 'WHATSAPP', label: 'WhatsApp' },
  { code: 'TER_PLAATSE', label: 'Ter plaatse' },
];

/** What leaves from the send sheet of a taken website order: the invoice, or this version for approval. */
export type WebOrderSendMode = 'invoice' | 'approval';
export interface WebOrderSendChoice {
  /** The figures are not the ones the customer ordered: the invoice needs the way the customer agreed. */
  needsAgreement: boolean;
  /** One line on where the figures stand, under the choice; null when they equal the order. */
  status: string | null;
  /** Every difference with the order, for a hover; empty when unknown or equal. */
  differences: string[];
  /** Why the invoice cannot leave yet; null when it can. */
  invoiceBlock: string | null;
  /** The invoice when it can leave; else the approval. */
  defaultMode: WebOrderSendMode;
}

/**
 * The send sheet of a website order staff took offers the invoice beside the
 * approval: the customer may have agreed already, by ordering exactly this
 * or by phone or mail. Null for any other document and for an order the
 * customer can still change, cancelled, archived or already invoiced.
 */
export function webOrderSendChoice(view: SalesOrderView | null | undefined): WebOrderSendChoice | null {
  const webOrder = view?.webOrder;
  if (!view || !webOrder?.processingStartedAt || webOrder.customerCancelledAt || webOrder.customerEditable) return null;
  const order = view.order;
  if ((order.docType ?? 'OFFERTE') !== 'OFFERTE' || order.archivedAt || view.invoicedAsId || view.invoicedAs) return null;
  if (order.status !== 'CONCEPT' && order.status !== 'VERZONDEN' && order.status !== 'BEKEKEN') return null;
  const state = webOrder.termsState;
  if (!state || state === 'APPROVED') return null;
  const differences = state === 'ORDER_DIFFERENT' ? webOrder.differences ?? [] : [];
  /* The euro sign stays with its amount when the line wraps. */
  const total = differences.find((line) => line.startsWith('Totaal excl. btw:'))?.replace(/€ /g, '€ ');
  const status = state === 'ORDER_EQUAL' ? null
    : state === 'ORDER_DIFFERENT' ? `Gewijzigd t.o.v. de bestelling${total ? ` · ${total}` : ''}`
    : state === 'ORDER_UNKNOWN' ? 'Vracht of een prijs stond nog open toen de klant bestelde'
    : state === 'AWAITING_APPROVAL' ? 'Ter goedkeuring verstuurd, nog geen akkoord via de link'
    : order.status === 'CONCEPT' ? 'Al eens ter goedkeuring verstuurd en daarna gewijzigd'
    : 'Gewijzigd na het versturen ter goedkeuring';
  const invoiceBlock = order.freight === 'TE_BEPALEN' ? 'Factuur kan nog niet: de vracht staat op later bepalen.'
    : view.invoiceCustomer?.missing?.length ? 'Factuur kan nog niet: bij de klant ontbreekt het adres.'
    : null;
  return { needsAgreement: state !== 'ORDER_EQUAL', status, differences, invoiceBlock, defaultMode: invoiceBlock ? 'approval' : 'invoice' };
}

/** The invoice leaves once nothing blocks it and, for other figures than the ordered ones, the agreement is picked. */
export function webOrderInvoiceReady(choice: WebOrderSendChoice | null, agreedVia: WebOrderAgreement | null): boolean {
  return !!choice && !choice.invoiceBlock && (!choice.needsAgreement || !!agreedVia);
}

export interface WebOrderSendCopy { title: string; body: string; confirm: string; toast: string }
/** What the send sheet and its toast say on a website order; null for any other document. */
export function webOrderSendCopy(view: SalesOrderView | null | undefined): WebOrderSendCopy | null {
  if (!view?.webOrder) return null;
  return {
    title: webOrderSendChoice(view) ? 'Bestelling versturen' : 'Bestelling ter goedkeuring versturen',
    body: 'De klant krijgt de PDF in bijlage en een link om deze versie van de bestelling goed te keuren of een wijziging voor te stellen.',
    confirm: 'Versturen ter goedkeuring',
    toast: 'Bestelling ter goedkeuring verstuurd',
  };
}

/**
 * Shown when an action was refused because the customer changed or cancelled
 * the order and this screen had nothing unsaved: the latest version loads by
 * itself, so the server's "your changes are not saved, load the latest
 * version" would ask for something that already happened.
 */
export const WEB_ORDER_RELOADED = 'De klant heeft deze bestelling intussen gewijzigd of geannuleerd; de laatste versie is geladen.';
