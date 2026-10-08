import type { SalesInvoiceCustomer, SalesOrderView } from '../../core/api/models';

/** One part of the address in the confirmation, with whether the takeover writes it. */
export interface CustomerAddressTakeoverField {
  /** "Straat en nummer", "Postcode", "Stad" or "Land". */
  label: string;
  /** As the record will read: the delivery's value when written, else the record's own spelling. */
  value: string;
  /** True for a field the record lacks and the takeover fills; false for one the record already has. */
  written: boolean;
}

/** The address staff confirm in "Leveradres overnemen", exactly as the server offered it. */
export interface CustomerAddressTakeover {
  /**
   * Street, postal code and city, then the country when the record has one,
   * as the record will read afterwards. Only the fields the server lists as
   * missing are written; the country never is.
   */
  fields: CustomerAddressTakeoverField[];
  /**
   * What travels in the call: all three parts as shown, also the ones that
   * are not written. The server compares them with what it would offer now
   * and refuses when the delivery or the record reads otherwise.
   */
  request: { address: string; postalCode: string; city: string };
}

/**
 * What a document says when its customer record lacks the address an invoice
 * needs: which fields are missing, and either the delivery address that may
 * be taken over or why staff must fill in the record themselves.
 */
export interface CustomerAddressNotice {
  customerId: number;
  company: string;
  /** "straat en nummer, postcode en stad": the same words as the server's refusal on issuing. */
  missingText: string;
  /** The sentence after `Klantgegevens onvolledig ·`. */
  lead: string;
  /** Why no takeover is offered; null when one is, or when the document simply has no delivery address. */
  reason: string | null;
  takeover: CustomerAddressTakeover | null;
  /** "de factuur" or "de creditnota": the lead and the confirmation name the same document. */
  document: string;
  /** The `q` of the link to the customer list, which filters it to this customer. */
  customerQuery: string;
}

const FIELD: Record<string, string> = { ADDRESS: 'straat en nummer', POSTAL_CODE: 'postcode', CITY: 'stad' };

const REASON: Record<string, string> = {
  PICKUP: 'Deze bestelling wordt afgehaald: er is geen leveradres om over te nemen. Vul het adres in bij de klant.',
  OTHER_COUNTRY: 'Het leveradres ligt in een ander land dan de klant. Vul het adres in bij de klant.',
  /* The server sends this code for two cases: the delivery itself lacks a street, postal code or city,
     or a field the record already has says something else. One sentence has to be true for both. */
  INCOMPLETE: 'Het leveradres is onvolledig of past niet bij wat al in de klantgegevens staat. Vul het adres in bij de klant.',
};

/** Beside the disabled button: a touch screen never shows a title attribute. */
export const TAKEOVER_BLOCKED_HINT = 'Sla openstaande wijzigingen eerst op om het leveradres over te nemen.';

/** "straat en nummer, postcode en stad", in the order the server sends the codes. */
export function missingAddressText(missing: readonly string[] | null | undefined): string {
  const words = (missing ?? []).map((code) => FIELD[code] ?? '').filter(Boolean);
  if (words.length < 2) return words.join('');
  return `${words.slice(0, -1).join(', ')} en ${words[words.length - 1]}`;
}

/**
 * The notice of one document, from the `invoiceCustomer` block of its view.
 * The server decides whether it applies and whether the takeover is offered;
 * this only words it. Null when the block is absent (nothing missing, the
 * list, an older backend) or belongs to another customer than the one the
 * document now shows.
 */
export function customerAddressNotice(
  view: SalesOrderView | null | undefined,
  countryName: (code: string) => string = (code) => code,
): CustomerAddressNotice | null {
  const block: SalesInvoiceCustomer | null | undefined = view?.invoiceCustomer;
  if (!view || !block || block.customerId == null) return null;
  /* An unsaved customer change in the editor: the block still describes the saved one. */
  if (view.order.customerId !== block.customerId) return null;
  const missing = Array.isArray(block.missing) ? block.missing.filter((code) => FIELD[code]) : [];
  if (!missing.length) return null;
  const company = block.company?.trim() || 'deze klant';
  const missingText = missingAddressText(missing);
  const document = view.order.docType === 'CREDITNOTA' ? 'de creditnota' : 'de factuur';
  return {
    customerId: block.customerId,
    company,
    missingText,
    lead: `bij ${company} ${missing.length === 1 ? 'ontbreekt' : 'ontbreken'} ${missingText}. `
      + `Zonder volledig adres kan ${document} niet uitgereikt worden.`,
    reason: takeoverOf(block, countryName) ? null : REASON[block.takeoverBlockedBy ?? ''] ?? null,
    takeover: takeoverOf(block, countryName),
    document,
    customerQuery: block.company?.trim() ?? '',
  };
}

/**
 * Offered only when the server sent all three parts: a half address is never
 * confirmed. The server sends the address as the record will read afterwards:
 * the delivery's value for a field in `missing`, the record's own spelling for
 * a field it already has, and the record's own country or null (the takeover
 * never writes a country). Each part says which of the two it is.
 */
function takeoverOf(block: SalesInvoiceCustomer, countryName: (code: string) => string): CustomerAddressTakeover | null {
  const offer = block.takeover;
  const address = offer?.address?.trim(), postalCode = offer?.postalCode?.trim(), city = offer?.city?.trim();
  if (!offer || !address || !postalCode || !city) return null;
  const missing: readonly string[] = Array.isArray(block.missing) ? block.missing : [];
  const country = offer.countryCode?.trim().toUpperCase();
  return {
    fields: [
      { label: 'Straat en nummer', value: address, written: missing.includes('ADDRESS') },
      { label: 'Postcode', value: postalCode, written: missing.includes('POSTAL_CODE') },
      { label: 'Stad', value: city, written: missing.includes('CITY') },
      ...(country ? [{ label: 'Land', value: countryName(country) || country, written: false }] : []),
    ],
    request: { address, postalCode, city },
  };
}

/** Beside each part of the address in the confirmation. */
export const TAKEOVER_WRITTEN = 'wordt ingevuld';
export const TAKEOVER_KEPT = 'staat er al';

/**
 * What the host should show when the server answers a takeover (or the reload
 * after a refusal). `started` is the view the host showed when the call left.
 * Still the same object: nothing happened meanwhile, the answer is the newest
 * view. Another object: the host saved or reloaded while the call was under
 * way, so the answer may be older than the screen; only the two blocks the
 * takeover decides are laid over what the host shows now. Null when the host
 * moved on to another document.
 */
export function takeoverAnswerFor(
  started: SalesOrderView,
  current: SalesOrderView | null | undefined,
  answer: SalesOrderView,
): SalesOrderView | null {
  if (!current || current.order.id !== answer.order.id) return null;
  if (current === started) return answer;
  return { ...current, invoiceCustomer: answer.invoiceCustomer ?? null, delivery: answer.delivery ?? current.delivery };
}

/** The little of an element the focus rule below reads; the browser's Element fits it. */
export interface FocusPlace {
  previousElementSibling: FocusPlace | null;
  contains(other: any): boolean;
}

/**
 * Where the keyboard focus goes once the notice is gone. The sheet hands the
 * focus back to "Leveradres overnemen", which disappears with the notice, and
 * the browser then drops it on the page body: a keyboard user would start at
 * the top again. The element straight above the notice (the website-order
 * banner, else the head of the document) is the nearest thing that stays.
 * Null when staff already moved the focus somewhere else themselves.
 */
export function focusPlaceAfterTakeover<T extends FocusPlace>(host: T, active: unknown, body: unknown): T | null {
  const lost = active == null || active === body || active === host || host.contains(active);
  return lost ? (host.previousElementSibling as T | null) : null;
}
