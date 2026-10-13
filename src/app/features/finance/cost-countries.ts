import type { VatRegime } from '../../core/api/models';

/*
 * Countries and VAT numbers of suppliers, and the regime a country suggests.
 * The EU list decides reverse charge (the same 27 codes as the Java side; XI
 * is Northern Ireland, in the EU for goods only). Pure: node-tested.
 */

export const EU_MEMBERS: readonly string[] = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
];
const EU = new Set(EU_MEMBERS);

export function isEuMember(code: string | null | undefined): boolean {
  return EU.has((code ?? '').trim().toUpperCase());
}

export interface CountryChoice { code: string; name: string }

/** The short list the chips and the 'Andere…' select start from; the loaded /api/countries names come on top. */
export const SUPPLIER_COUNTRIES: readonly CountryChoice[] = [
  { code: 'BE', name: 'België' }, { code: 'NL', name: 'Nederland' }, { code: 'DE', name: 'Duitsland' }, { code: 'FR', name: 'Frankrijk' },
  { code: 'LU', name: 'Luxemburg' }, { code: 'IE', name: 'Ierland' }, { code: 'ES', name: 'Spanje' }, { code: 'IT', name: 'Italië' },
  { code: 'PL', name: 'Polen' }, { code: 'AT', name: 'Oostenrijk' }, { code: 'PT', name: 'Portugal' }, { code: 'DK', name: 'Denemarken' },
  { code: 'SE', name: 'Zweden' }, { code: 'CZ', name: 'Tsjechië' }, { code: 'GB', name: 'Verenigd Koninkrijk' }, { code: 'CH', name: 'Zwitserland' },
  { code: 'NO', name: 'Noorwegen' }, { code: 'US', name: 'Verenigde Staten' }, { code: 'CN', name: 'China' }, { code: 'TR', name: 'Turkije' },
  { code: 'IN', name: 'India' },
];

/** The name of a country code: the built-in list first, then the loaded names, else the code itself. */
export function countryName(code: string | null | undefined, extra: readonly CountryChoice[] = []): string {
  const key = (code ?? '').trim().toUpperCase();
  if (!key) return '';
  return SUPPLIER_COUNTRIES.find((row) => row.code === key)?.name ?? extra.find((row) => row.code.toUpperCase() === key)?.name ?? key;
}

/** Upper case, nothing but letters and digits ('be 0123.456.749' → BE0123456749), at most 20 characters. */
export function cleanVatNumber(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
}

/** Belgian numbers are BE + 0/1 + nine digits; the others two letters and 2–16 characters (the Java rule). */
export function isValidVatNumber(clean: string): boolean {
  return clean.startsWith('BE') ? /^BE[01]\d{9}$/.test(clean) : /^[A-Z]{2}[A-Z0-9]{2,16}$/.test(clean);
}

export interface RegimeSuggestion { regime: VatRegime; reason: string }

const REASON = 'Afgeleid van het land · controleer';
/** The categories that stand for a fair: BEURS, and the retired TICA code that older costs and names still carry. */
const FAIR_CATEGORIES: ReadonlySet<string> = new Set(['BEURS', 'TICA']);

export function isFairCategory(category: string | null | undefined): boolean {
  return FAIR_CATEGORIES.has((category ?? '').trim().toUpperCase());
}

/** A fair invoice from the EU: reverse charge is the rule, that country's VAT on the invoice the exception to look for. */
function fairReason(country: string): string {
  return `Beursfactuur: btw verlegd · staat er ${country === 'NL' ? 'Nederlandse' : 'buitenlandse'} btw op? Kies dan Buitenlandse btw`;
}

/** The line under the regime when a fair invoice goes to a name nothing is known about. */
export const FAIR_REGIME_QUESTION = 'Beursfactuur: Belgische btw of btw verlegd? Bij verlegde btw kies je EU · dienst';

/**
 * A fair invoice to a name that carries no regime, no foreign country and no
 * VAT number: the Dutch organisers (TICA, Ede) reverse charge the stand, a
 * Belgian one charges Belgian VAT, and the name alone cannot tell. The form
 * then keeps the Belgian default but leaves it unconfirmed under this
 * question. A bare 'BE' answers nothing: the server writes that country on
 * every new name, also while the regime is still unconfirmed, so only a
 * confirmed regime, a foreign country or a VAT number settles it.
 */
export function fairRegimeQuestion(input: { category: string | null; regime: VatRegime | null; country: string | null; vatNumber: string | null }): string | null {
  if (!isFairCategory(input.category) || input.regime) return null;
  const country = (input.country ?? '').trim().toUpperCase();
  return (country && country !== 'BE') || cleanVatNumber(input.vatNumber) ? null : FAIR_REGIME_QUESTION;
}

/**
 * The regime a supplier's country suggests, for the form to prefill
 * unconfirmed: a Belgian number or country is Belgian VAT; an EU supplier is
 * reverse charge (goods for Materiaal, services otherwise, a fair organiser's
 * stand included, with a reason of its own), except travel, which carries
 * foreign VAT; a non-EU service is reverse charge too, non-EU goods go
 * through customs and get no suggestion.
 */
export function suggestRegime(input: { country: string | null; vatNumber: string | null; category: string | null }): RegimeSuggestion | null {
  const number = cleanVatNumber(input.vatNumber);
  const country = (input.country ?? '').trim().toUpperCase() || (number.length >= 2 && /^[A-Z]{2}/.test(number) ? number.slice(0, 2) : '');
  const category = (input.category ?? '').trim().toUpperCase();
  const goods = category === 'MATERIAAL';
  if (number.startsWith('BE') || country === 'BE') return { regime: 'BE', reason: REASON };
  if (!country) return null;
  const inEu = EU.has(country) || (country === 'XI' && goods);
  if (inEu) {
    /* A hotel or a train abroad carries that country's VAT. A fair organiser (TICA, Ede) invoices the stand with the VAT reverse charged. */
    if (category === 'REIS') return { regime: 'FOREIGN_VAT', reason: REASON };
    if (FAIR_CATEGORIES.has(category)) return { regime: 'EU_SERVICES', reason: fairReason(country) };
    return { regime: goods ? 'EU_GOODS' : 'EU_SERVICES', reason: REASON };
  }
  return goods ? null : { regime: 'NON_EU_SERVICES', reason: REASON };
}
