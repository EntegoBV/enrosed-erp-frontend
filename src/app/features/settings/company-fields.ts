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
