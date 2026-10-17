import type { CompanyProfile, DiscountTier, HsCode, WebsiteRebuildStatus } from '../../core/api/models';

/**
 * Pure rules for the company profile and the settings overview: defaults
 * said, never faked; the value strings of the overview rows. Node-tested
 * (type imports only).
 */

/** What documents use when a field is left empty (the backend's own defaults). */
export const COMPANY_DEFAULTS = {
  quoteNumberPrefix: 'ENR',
  invoiceNumberPrefix: 'F',
  creditNoteNumberPrefix: 'CN',
  partnerInvoiceNumberPattern: 'container/{jaar}/{nr:3}',
  partnerQuoteNumberPattern: 'offerte/container/{jaar}/{nr:3}',
  fiscalRepresentativeName: '24/7 Customs BV',
  fiscalRepresentativeVat: 'NL858617262B02',
} as const;

const text = (value: string | null | undefined): string => (value ?? '').trim();

/** "BE94731074082814" → "BE94 7310 7408 2814"; the stored value stays as typed. */
export function ibanDisplay(value: string | null | undefined): string {
  const compact = text(value).replace(/\s+/g, '').toUpperCase();
  return compact.replace(/(.{4})(?=.)/g, '$1 ');
}

/** 2 → "2", 4.7 → "4,7" (nl-BE, no trailing zeros). */
export function pctText(value: number): string {
  return String(Math.round(value * 100) / 100).replace('.', ',');
}

function pctRange(values: number[]): string {
  if (!values.length) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? `${pctText(min)} %` : `${pctText(min)} tot ${pctText(max)} %`;
}

/** Orderkorting: "4 staffels · 2 tot 15 %". */
export function tierSummary(tiers: readonly DiscountTier[]): string {
  if (!tiers.length) return 'Geen staffels';
  return `${tiers.length} ${tiers.length === 1 ? 'staffel' : 'staffels'} · ${pctRange(tiers.map((tier) => tier.percent))}`;
}

/** Lijnkorting: the number of products with their own tiers ("0 producten"). */
export function lineDiscountSummary(tiers: readonly DiscountTier[]): string {
  const products = new Set(tiers.flatMap((tier) => tier.productId == null ? [] : [tier.productId])).size;
  return `${products} ${products === 1 ? 'product' : 'producten'}`;
}

/** Douane: "3 tarieven · 4,7 tot 10 %". */
export function dutySummary(codes: readonly HsCode[]): string {
  if (!codes.length) return 'Geen tarieven';
  return `${codes.length} ${codes.length === 1 ? 'tarief' : 'tarieven'} · ${pctRange(codes.map((code) => code.dutyRatePct))}`;
}

/** "ENR · F · CN · container/{jaar}/{nr:3}": the letters each series uses now. */
export function numberingSummary(profile: CompanyProfile): string {
  return [
    text(profile.quoteNumberPrefix) || COMPANY_DEFAULTS.quoteNumberPrefix,
    text(profile.invoiceNumberPrefix) || COMPANY_DEFAULTS.invoiceNumberPrefix,
    text(profile.creditNoteNumberPrefix) || COMPANY_DEFAULTS.creditNoteNumberPrefix,
    usablePattern(profile.partnerInvoiceNumberPattern) ?? COMPANY_DEFAULTS.partnerInvoiceNumberPattern,
  ].join(' · ');
}

/** "BE94 7310 7408 2814 · KREDBEBB", or what is missing. */
export function bankSummary(profile: CompanyProfile): string {
  const iban = ibanDisplay(profile.iban);
  const bic = text(profile.bic).toUpperCase();
  if (!iban) return 'Geen IBAN';
  return bic ? `${iban} · ${bic}` : iban;
}

/** Op elk document: which footers are filled in. */
export function footerSummary(profile: CompanyProfile): string {
  const nl = !!text(profile.documentFooter);
  const en = !!text(profile.documentFooterEn);
  if (nl && en) return 'Voettekst NL en EN';
  if (nl) return 'Voettekst NL';
  if (en) return 'Voettekst EN';
  return 'Geen voettekst';
}

/** "ET 14000 uit · NL: 24/7 Customs BV (standaard)". */
export function fiscalSummary(profile: CompanyProfile): string {
  const licence = profile.importVatDeferred ? 'ET 14000 aan' : 'ET 14000 uit';
  const own = text(profile.fiscalRepresentativeName);
  return `${licence} · NL: ${own || `${COMPANY_DEFAULTS.fiscalRepresentativeName} (standaard)`}`;
}

/** The identity block: "BE 1034.273.386 · Vekeblok 17, 2400 Mol". */
export function identityLine(profile: CompanyProfile): string {
  const place = [text(profile.postalCode), text(profile.city)].filter(Boolean).join(' ');
  const address = [text(profile.addressLine), place].filter(Boolean).join(', ');
  return [text(profile.vatNumber), address].filter(Boolean).join(' · ');
}

/** "hello@enrosed.com · +32 470 02 42 07". */
export function contactLine(profile: CompanyProfile): string {
  return [text(profile.email), text(profile.phone)].filter(Boolean).join(' · ');
}

export type LegalStatus = 'builtin' | 'custom';

/** An empty text means the built-in proposal. */
export function legalStatus(value: string | null | undefined): LegalStatus {
  return text(value) ? 'custom' : 'builtin';
}

/** The pill of a legal document over its NL and EN text. */
export function legalPill(nl: string | null | undefined, en: string | null | undefined): { label: string; custom: boolean } {
  const ownNl = legalStatus(nl) === 'custom';
  const ownEn = legalStatus(en) === 'custom';
  if (ownNl && ownEn) return { label: 'Eigen tekst', custom: true };
  if (ownNl) return { label: 'Eigen tekst (NL)', custom: true };
  if (ownEn) return { label: 'Eigen tekst (EN)', custom: true };
  return { label: 'Ingebouwd voorstel', custom: false };
}

/** A pattern the backend uses; the old example and patterns without a number fall back. */
export function usablePattern(pattern: string | null | undefined): string | null {
  const value = text(pattern);
  if (!value || !value.includes('{nr') || value === 'partner/{jaar}/{nr:3}') return null;
  return value;
}

/** dd/mm/jjjj in Belgian notation; '' for no date. */
export function dateNl(value: string | null | undefined): string {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** "16/10, 10:48" (this year) or "16/10/2025, 10:48". */
export function shortDateTimeNl(value: string | null | undefined, now: Date = new Date()): string {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = date.getFullYear() === now.getFullYear()
    ? `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`
    : dateNl(value);
  return `${day}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "16/10/2026, 23:40". */
export function dateTimeNl(value: string | null | undefined): string {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dateNl(value)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The website row: "Live sinds 16/10/2026, 23:40", or what the rebuild is doing. */
export function websiteSyncValue(status: WebsiteRebuildStatus | null): string {
  if (!status) return '';
  switch (status.status) {
    case 'LIVE': return status.liveAt ? `Live sinds ${dateTimeNl(status.liveAt)}` : 'Live';
    case 'QUEUED': return 'In wachtrij';
    case 'TRIGGERED': return 'Wordt bijgewerkt';
    case 'NOT_CONFIGURED': return 'Niet ingesteld';
    case 'FAILED_OR_STALE': return 'Actie nodig';
    default: return '';
  }
}

/** Verwijderde items: "9 documenten · 90 dagen". */
export function trashSummary(count: number, retentionDays: number | null): string {
  const documents = count === 0 ? 'Leeg' : `${count} ${count === 1 ? 'document' : 'documenten'}`;
  return retentionDays ? `${documents} · ${retentionDays} dagen` : documents;
}

/** Logboek: the events of today among the newest loaded ("21 vandaag", "50+ vandaag" when the page was all today). */
export function todayCount(
  events: readonly { at: string }[],
  hasMore: boolean,
  now: Date = new Date(),
): string {
  const key = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const today = key(now);
  const count = events.filter((event) => {
    const at = new Date(event.at);
    return !Number.isNaN(at.getTime()) && key(at) === today;
  }).length;
  return count === events.length && hasMore && count > 0 ? `${count}+ vandaag` : `${count} vandaag`;
}

/** A device row: "Android · aangemeld sinds 03/10/2026" over "laatste melding 16/10, 10:48". */
export function deviceLines(
  device: { device: string; since?: string | null; lastStatus: number | null; lastAt: string | null },
  now: Date = new Date(),
): { title: string; sub: string } {
  const since = dateNl(device.since ?? null);
  const title = since ? `${device.device} · aangemeld sinds ${since}` : device.device;
  let sub: string;
  if (device.lastStatus === null) sub = 'nog geen melding gestuurd';
  else if (device.lastStatus >= 200 && device.lastStatus < 300) {
    sub = device.lastAt ? `laatste melding ${shortDateTimeNl(device.lastAt, now)}` : 'laatste melding geaccepteerd';
  } else sub = `laatste melding geweigerd (${device.lastStatus})`;
  return { title, sub };
}

/* ------------------------------------------------------------- the form */

/** Every field the Bedrijfsgegevens form (and the legal view) edits. */
export const COMPANY_FIELDS = [
  'name', 'legalName', 'vatNumber', 'registrationNumber', 'addressLine', 'postalCode', 'city', 'countryCode',
  'email', 'phone', 'website', 'iban', 'bic', 'importVatDeferred', 'fiscalRepresentativeName', 'fiscalRepresentativeVat',
  'quoteNumberPrefix', 'invoiceNumberPrefix', 'creditNoteNumberPrefix', 'partnerInvoiceNumberPattern', 'partnerInvoiceNextNumber',
  'partnerQuoteNumberPattern', 'partnerQuoteNextNumber', 'documentFooter', 'documentFooterEn',
  'termsAndConditions', 'termsAndConditionsEn', 'privacyPolicy', 'privacyPolicyEn',
] as const satisfies readonly (keyof CompanyProfile)[];

export type CompanyField = (typeof COMPANY_FIELDS)[number];

/** The fields the backend types as plain strings; the rest may be null. */
const PLAIN_TEXT = new Set<CompanyField>([
  'name', 'legalName', 'vatNumber', 'registrationNumber', 'addressLine', 'postalCode', 'city', 'countryCode',
  'email', 'phone', 'website', 'iban', 'bic', 'documentFooter',
]);

/** One comparable form of a field value: trimmed text, '' for empty, numbers and switches as they are. */
function comparable(field: CompanyField, value: unknown): string {
  if (field === 'importVatDeferred') return value ? 'true' : 'false';
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return String(value).trim();
}

/** The fields whose value differs from the saved profile (whitespace and null-versus-empty do not count). */
export function companyDirtyFields(saved: CompanyProfile, draft: CompanyProfile): CompanyField[] {
  return COMPANY_FIELDS.filter((field) => comparable(field, saved[field]) !== comparable(field, draft[field]));
}

/** What a save sends for these fields: trimmed text, null for an empty optional field. Never any other field. */
export function companyPatch(draft: CompanyProfile, fields: readonly CompanyField[]): Partial<CompanyProfile> {
  const patch: Record<string, unknown> = {};
  for (const field of fields) {
    const value = draft[field];
    if (field === 'importVatDeferred') patch[field] = !!value;
    else if (field === 'partnerInvoiceNextNumber' || field === 'partnerQuoteNextNumber') {
      patch[field] = typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
    } else {
      const text = typeof value === 'string' ? value.trim() : '';
      patch[field] = text || (PLAIN_TEXT.has(field) ? '' : null);
    }
  }
  return patch as Partial<CompanyProfile>;
}

/**
 * A draft after the saved profile changed under it (another view saved, the
 * overview re-read it): its own unsaved edits survive, every other field
 * shows the fresh server value.
 */
export function rebaseCompanyDraft(base: CompanyProfile, draft: CompanyProfile, fresh: CompanyProfile): CompanyProfile {
  const next: Record<string, unknown> = { ...fresh };
  for (const field of companyDirtyFields(base, draft)) next[field] = draft[field];
  return next as unknown as CompanyProfile;
}

export type CompanyErrors = Partial<Record<CompanyField, string>>;

/** The fields documents cannot do without; the country is two letters. */
export function companyRequiredErrors(draft: CompanyProfile): CompanyErrors {
  const errors: CompanyErrors = {};
  for (const field of ['name', 'vatNumber', 'addressLine', 'postalCode', 'city'] as const) {
    if (!text(draft[field])) errors[field] = 'Verplicht op documenten';
  }
  const country = text(draft.countryCode);
  if (!country) errors.countryCode = 'Verplicht op documenten';
  else if (!/^[A-Za-z]{2}$/.test(country)) errors.countryCode = 'Twee letters, bv. BE';
  return errors;
}

/**
 * Belgian mobile numbers: 9 digits after +32, starting with 4. A complete one
 * is shown as "+32 470 02 42 07"; one with 10 digits after +32 gets a hint
 * (the production value "+324 4 70 02 42 07" has one 4 too many). Anything
 * else is left as typed. Never blocks saving.
 */
export function belgianPhoneHint(value: string | null | undefined): { display: string | null; hint: string | null } {
  const raw = text(value);
  const digits = raw.replace(/\D/g, '');
  let national: string | null = null;
  if (/^\+\s*3\s*2/.test(raw)) national = digits.slice(2);
  else if (raw.startsWith('0032')) national = digits.slice(4);
  else if (/^0[1-9]/.test(raw)) national = digits.slice(1);
  if (national === null || !national.startsWith('4')) return { display: null, hint: null };
  if (national.length === 9) {
    const display = `+32 ${national.slice(0, 3)} ${national.slice(3, 5)} ${national.slice(5, 7)} ${national.slice(7, 9)}`;
    return { display: display === raw ? null : display, hint: null };
  }
  if (national.length === 10 && /^\+\s*3\s*2/.test(raw)) {
    return { display: null, hint: 'Een Belgisch gsm-nummer heeft 9 cijfers na +32; dit nummer heeft er 10.' };
  }
  return { display: null, hint: null };
}

/** "https://ENROSED.COM/" → "enrosed.com": no scheme, lower-case host, no trailing slash. */
export function websiteDisplay(value: string | null | undefined): string {
  const raw = text(value).replace(/^https?:\/\//i, '');
  if (!raw) return '';
  const slash = raw.indexOf('/');
  const host = (slash < 0 ? raw : raw.slice(0, slash)).toLowerCase();
  const path = slash < 0 ? '' : raw.slice(slash);
  return (host + path).replace(/\/+$/, '');
}

/** {jaar} → the year, {nr:3} → 001, {nr} → 1. */
export function patternPreview(pattern: string, year: number, n: number): string {
  return pattern
    .replaceAll('{jaar}', String(year))
    .replace(/\{nr:(\d+)\}/g, (_, width: string) => String(n).padStart(Number(width), '0'))
    .replaceAll('{nr}', String(n));
}

export type NumberSeries = 'quote' | 'invoice' | 'creditNote' | 'partnerInvoice' | 'partnerQuote';

/**
 * How a number of this series looks: "ENR-2026-0001" (the counter itself
 * counts on), or for partner series the pattern, from the next number when
 * one is set ("eerstvolgende: container/2026/003"). isDefault when the field
 * is empty (or ignored) and the backend's default applies.
 */
export function numberPreview(series: NumberSeries, profile: CompanyProfile, year: number): { text: string; isDefault: boolean } {
  if (series === 'quote' || series === 'invoice' || series === 'creditNote') {
    const key = series === 'quote' ? 'quoteNumberPrefix' : series === 'invoice' ? 'invoiceNumberPrefix' : 'creditNoteNumberPrefix';
    const own = text(profile[key]);
    return { text: `${own || COMPANY_DEFAULTS[key]}-${year}-0001`, isDefault: !own };
  }
  const patternKey = series === 'partnerInvoice' ? 'partnerInvoiceNumberPattern' : 'partnerQuoteNumberPattern';
  const nextKey = series === 'partnerInvoice' ? 'partnerInvoiceNextNumber' : 'partnerQuoteNextNumber';
  const own = usablePattern(profile[patternKey]);
  const pattern = own ?? COMPANY_DEFAULTS[patternKey];
  const next = profile[nextKey];
  const hasNext = typeof next === 'number' && Number.isFinite(next) && next > 0;
  const preview = patternPreview(pattern, year, hasNext ? Math.round(next) : 1);
  return { text: hasNext ? `eerstvolgende: ${preview}` : preview, isDefault: !own };
}

/** A typed partner pattern the backend will not use, and what it falls back to. */
export function partnerPatternWarning(pattern: string | null | undefined, series: 'partnerInvoice' | 'partnerQuote'): string | null {
  if (!text(pattern) || usablePattern(pattern)) return null;
  const fallback = series === 'partnerInvoice' ? COMPANY_DEFAULTS.partnerInvoiceNumberPattern : COMPANY_DEFAULTS.partnerQuoteNumberPattern;
  return `Dit patroon gebruikt het systeem niet. Bij opslaan valt het terug op ${fallback}.`;
}

/** The opt-in footer proposal, NL and EN (once the placeholders of the old form). */
export const FOOTER_PROPOSAL = {
  nl: 'Op al onze offertes zijn onze algemene voorwaarden van toepassing.',
  en: 'All our quotations are subject to our general terms and conditions.',
} as const;

/* ------------------------------------------------------- legal texts */

/** The version line a legal text carries ("Versie 30 augustus 2026"), if any. */
export function legalVersionLine(value: string | null | undefined): string | null {
  const match = (value ?? '').match(/^\s*((?:Versie|Version)\b[^\n]{0,60})$/im);
  return match ? match[1].trim() : null;
}

/** "1.842 woorden" (nl-BE thousands). */
export function wordCountText(value: string | null | undefined): string {
  const count = (value ?? '').trim().split(/\s+/).filter(Boolean).length;
  const shown = String(count).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${shown} ${count === 1 ? 'woord' : 'woorden'}`;
}

/**
 * What saving a legal text stores: null (the built-in proposal) when it is
 * empty or still exactly the built-in text it was started from.
 */
export function legalSaveValue(textValue: string, builtIn: string | null): string | null {
  const trimmed = textValue.trim();
  if (!trimmed) return null;
  if (builtIn !== null && trimmed === builtIn.trim()) return null;
  return textValue;
}
