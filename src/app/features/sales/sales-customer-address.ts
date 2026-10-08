import type { SalesInvoiceCustomer, SalesOrderView } from '../../core/api/models';

/** The address staff confirm in "Leveradres overnemen", exactly as the server offered it. */
export interface CustomerAddressTakeover {
  /** One line per part, as it will read in the customer record. */
  lines: string[];
  /** What travels in the call: the server refuses when the delivery reads otherwise by now. */
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
  /** The `q` of the link to the customer list, which filters it to this customer. */
  customerQuery: string;
}

const FIELD: Record<string, string> = { ADDRESS: 'straat en nummer', POSTAL_CODE: 'postcode', CITY: 'stad' };

const REASON: Record<string, string> = {
  PICKUP: 'Deze bestelling wordt afgehaald: er is geen leveradres om over te nemen. Vul het adres in bij de klant.',
  OTHER_COUNTRY: 'Het leveradres ligt in een ander land dan de klant. Vul het adres in bij de klant.',
  INCOMPLETE: 'Het leveradres past niet bij wat al in de klantgegevens staat. Vul het adres in bij de klant.',
};

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
    customerQuery: block.company?.trim() ?? '',
  };
}

/** Offered only when the server sent all three parts: a half address is never confirmed. */
function takeoverOf(block: SalesInvoiceCustomer, countryName: (code: string) => string): CustomerAddressTakeover | null {
  const offer = block.takeover;
  const address = offer?.address?.trim(), postalCode = offer?.postalCode?.trim(), city = offer?.city?.trim();
  if (!offer || !address || !postalCode || !city) return null;
  const country = offer.countryCode?.trim().toUpperCase();
  return {
    lines: [address, `${postalCode} ${city}`, ...(country ? [countryName(country) || country] : [])],
    request: { address, postalCode, city },
  };
}
