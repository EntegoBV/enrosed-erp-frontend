/**
 * The new-customer rules Klanten and the quick-add in Verkoop share, so a
 * customer made at the fair starts from the same defaults and passes the
 * same client check as one made in Klanten, plus the follow-up words
 * (status, touchpoints, sort and filter) the Klanten list and sheet use.
 * Pure and import-free at runtime: node-tested.
 */
import type { CrmStatus, Customer } from '../../core/api/models';

export const VAT_REQUIRED_MESSAGE = 'Vul het BTW-nummer in; het mag niet leeg zijn';

/** A blank customer: Vooruitbetaling, DAP, Dutch, no partner, no fiscal representative, a new lead. */
export function blankCustomer(countryCode: string): Customer {
  return {
    id: null, company: '', contact: '', email: '', phone: '', vatNumber: '',
    countryCode, language: 'NL', address: '', postalCode: '', city: '',
    incoterm: 'DAP', paymentTerms: 'Vooruitbetaling', notes: '',
    partner: false, partnerSharePct: null, partnerCostPct: null,
    fiscalRepresentative: false, invoiceNote: '',
    crmStatus: 'NIEUW', touchpoints: [],
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

/* ------------------------------------------------------------ follow-up */

export type CrmTone = 'blue' | 'gold' | 'ok' | 'neutral' | 'danger';

/**
 * The five follow-up statuses in the order they appear everywhere: as a filter, as a choice and when sorting.
 * `short` is the one word a narrow control gets (five cells on a 375 px phone, the desk toolbar at 800 px);
 * the badge on a row and a wide desk control say the full label.
 */
export const CRM_STATUSES: { value: CrmStatus; label: string; short: string; tone: CrmTone }[] = [
  { value: 'NIEUW', label: 'Nieuw', short: 'Nieuw', tone: 'blue' },
  { value: 'IN_GESPREK', label: 'In gesprek', short: 'Gesprek', tone: 'gold' },
  { value: 'ACTIEF', label: 'Actieve klant', short: 'Actief', tone: 'ok' },
  { value: 'SLAPEND', label: 'Slapend', short: 'Slapend', tone: 'neutral' },
  { value: 'VERLOREN', label: 'Verloren', short: 'Verloren', tone: 'danger' },
];

export function crmStatusLabel(value: string | null | undefined): string {
  return CRM_STATUSES.find((status) => status.value === value)?.label ?? 'Geen status';
}

/** The checklist of the sheet; `short` is the pill on the list row, `hint` the one line under a label that needs it. */
export const TOUCHPOINT_KINDS: { kind: string; label: string; short: string; hint?: string }[] = [
  { kind: 'GEMAILD', label: 'Gemaild', short: 'Mail' },
  { kind: 'GEBELD', label: 'Gebeld', short: 'Tel' },
  { kind: 'GESPROKEN', label: 'Gesproken', short: 'Gesprek', hint: 'persoonlijk, op de beurs of bezoek' },
  { kind: 'CATALOGUS_GESTUURD', label: 'Catalogus gestuurd', short: 'Cat' },
  { kind: 'STAAL_GESTUURD', label: 'Staal gestuurd', short: 'Staal' },
];

/** The label of a known kind; an unknown one (stored by a newer server) shows as its code. */
export function touchpointLabel(kind: string): string {
  return TOUCHPOINT_KINDS.find((touchpoint) => touchpoint.kind === kind)?.label ?? kind;
}

export function hasTouchpoint(customer: Customer, kind: string): boolean {
  return (customer.touchpoints ?? []).some((touchpoint) => touchpoint.kind === kind);
}

/** The customer with the kind ticked (stamped now, the server fills in who) or unticked. */
export function toggleTouchpoint(customer: Customer, kind: string, nowIso: string): Customer {
  const touchpoints = customer.touchpoints ?? [];
  return {
    ...customer,
    touchpoints: hasTouchpoint(customer, kind)
      ? touchpoints.filter((touchpoint) => touchpoint.kind !== kind)
      : [...touchpoints, { kind, at: nowIso, by: null }],
  };
}

/** The newest touchpoint stamp, or null when nothing was ticked yet. */
export function lastContactAt(customer: Customer): string | null {
  let latest: string | null = null;
  for (const touchpoint of customer.touchpoints ?? []) {
    if (touchpoint.at && (latest === null || touchpoint.at > latest)) latest = touchpoint.at;
  }
  return latest;
}

export type CustomerSort = 'NAAM' | 'NIEUWSTE' | 'OUDSTE' | 'LAATSTE_CONTACT' | 'LAND' | 'STATUS';

export const CUSTOMER_SORTS: { value: CustomerSort; label: string }[] = [
  { value: 'NAAM', label: 'Naam' },
  { value: 'NIEUWSTE', label: 'Nieuwste eerst' },
  { value: 'OUDSTE', label: 'Oudste eerst' },
  { value: 'LAATSTE_CONTACT', label: 'Laatste contact' },
  { value: 'LAND', label: 'Land' },
  { value: 'STATUS', label: 'Status' },
];

const byName = (a: Customer, b: Customer): number =>
  (a.company ?? '').localeCompare(b.company ?? '', 'nl', { sensitivity: 'base' });

/** createdAt then id: two customers made the same day keep the later one first. */
const byAge = (a: Customer, b: Customer): number =>
  (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || ((a.id ?? 0) - (b.id ?? 0));

/**
 * A new sorted copy; ties fall back to the name so the order never jumps between loads. `countryNameOf` turns a
 * code into the name the row shows, so "Land" sorts Duitsland before Oostenrijk and not DE after AT; without it
 * the codes themselves sort (this file stays import-free at runtime).
 */
export function sortCustomers(list: readonly Customer[], sort: CustomerSort, countryNameOf: (code: string) => string = (code) => code): Customer[] {
  const sorted = [...list];
  switch (sort) {
    case 'NIEUWSTE':
      return sorted.sort((a, b) => byAge(b, a) || byName(a, b));
    case 'OUDSTE':
      return sorted.sort((a, b) => byAge(a, b) || byName(a, b));
    case 'LAATSTE_CONTACT':
      /* Customers nobody touched yet go last: the list is for seeing who was followed up. */
      return sorted.sort((a, b) => {
        const contactA = lastContactAt(a);
        const contactB = lastContactAt(b);
        if (contactA && contactB) return contactB.localeCompare(contactA) || byName(a, b);
        if (contactA || contactB) return contactA ? -1 : 1;
        return byName(a, b);
      });
    case 'LAND':
      return sorted.sort((a, b) =>
        countryNameOf(a.countryCode ?? '').localeCompare(countryNameOf(b.countryCode ?? ''), 'nl', { sensitivity: 'base' }) || byName(a, b));
    case 'STATUS': {
      const rank = (customer: Customer): number => {
        const index = CRM_STATUSES.findIndex((status) => status.value === customer.crmStatus);
        return index < 0 ? CRM_STATUSES.length : index;
      };
      return sorted.sort((a, b) => rank(a) - rank(b) || byName(a, b));
    }
    default:
      return sorted.sort(byName);
  }
}

/** The search over company, contact, city and country code, narrowed to one status unless ALLE. */
export function filterCustomers(list: readonly Customer[], query: string, status: CrmStatus | 'ALLE'): Customer[] {
  const needle = query.toLowerCase().trim();
  return list.filter((customer) =>
    (status === 'ALLE' || (customer.crmStatus ?? null) === status) &&
    (!needle || [customer.company, customer.contact, customer.city, customer.countryCode]
      .join(' ').toLowerCase().includes(needle)));
}

const MONTHS_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** "7 nov 2026" from a date or instant; "" when there is none. The year always, a customer can be years old. */
export function shortDateNl(value: string | null | undefined): string {
  if (!value) return '';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (dateOnly && value.length === 10) return `${+dateOnly[3]} ${MONTHS_SHORT[+dateOnly[2] - 1] ?? ''} ${dateOnly[1]}`.trim();
  const date = new Date(value);
  if (isNaN(date.getTime())) return '';
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * The parts of a list row's meta line that are filled in, joined with " · ": a customer without a contact or
 * an incoterm gets "Boekarest" and "België", never "· Boekarest" or "België · · …" (seen live).
 */
export function metaLine(parts: readonly (string | null | undefined)[]): string {
  return parts.map((part) => (part ?? '').trim()).filter(Boolean).join(' · ');
}

/** "klant sinds 7 nov 2026" for the list row; "" for a customer without a known date. */
export function customerSince(createdAt: string | null | undefined): string {
  const date = shortDateNl(createdAt);
  return date ? `klant sinds ${date}` : '';
}
