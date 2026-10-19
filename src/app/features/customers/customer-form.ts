/**
 * The new-customer rules Klanten and the quick-add in Verkoop share, so a
 * customer made at the fair starts from the same defaults and passes the
 * same client check as one made in Klanten. Pure and import-free at runtime:
 * node-tested.
 */
import type { Customer } from '../../core/api/models';

export const VAT_REQUIRED_MESSAGE = 'Vul het BTW-nummer in; het mag niet leeg zijn';

/** A blank customer: Vooruitbetaling, DAP, Dutch, no partner, no fiscal representative. */
export function blankCustomer(countryCode: string): Customer {
  return {
    id: null, company: '', contact: '', email: '', phone: '', vatNumber: '',
    countryCode, language: 'NL', address: '', postalCode: '', city: '',
    incoterm: 'DAP', paymentTerms: 'Vooruitbetaling', notes: '',
    partner: false, partnerSharePct: null, partnerCostPct: null,
    fiscalRepresentative: false, invoiceNote: '',
  };
}

/** Home first when it ships, otherwise the first configured country - never a hardcoded guess. */
export function defaultCustomerCountry(codes: readonly string[]): string {
  return codes.includes('BE') ? 'BE' : codes[0] ?? '';
}

/** The server refuses a customer without a VAT number. */
export function vatNumberMissing(vatNumber: string | null | undefined): boolean {
  return !(vatNumber ?? '').trim();
}

/** The two letters of the VAT number next to the customer's country, when they differ. */
export function vatCountryMismatch(
  vatNumber: string | null | undefined,
  countryCode: string | null | undefined,
): { prefix: string; country: string } | null {
  const vat = (vatNumber ?? '').replace(/[\s.\-]/g, '').toUpperCase();
  const country = (countryCode ?? '').trim().toUpperCase();
  const prefix = /^[A-Z]{2}/.exec(vat)?.[0];
  if (!prefix || !country) return null;
  const same = prefix === country || (prefix === 'EL' && country === 'GR') || (prefix === 'XI' && country === 'GB');
  return same ? null : { prefix, country };
}
