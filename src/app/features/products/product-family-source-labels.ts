/*
 * Display-only labels for the read-only rows in "Bronnen & technische gegevens"
 * (product-family-source-details.ts). The stored codes stay exactly as they are:
 * the import history keeps source 'SHOPIFY' and its CDN URLs as audit data, and
 * price contexts such as SHOPIFY_RETAIL remain lookup keys. Only what the admin
 * reads changes. Import-free on purpose so node tests can load it.
 */

const SOURCE_LABELS: ReadonlyMap<string, string> = new Map([
  ['SHOPIFY', 'Oude webshop'],
  ['ODOO', 'Odoo'],
  ['WEBSITE_GENERATED', 'Website'],
  ['DASHBOARD', 'ERP'],
]);

/** What an archived media URL of the former webshop reads as. */
export const ARCHIVED_WEBSHOP_RECORD_LABEL = 'Oude webshop (archiefbron)';

const ARCHIVED_WEBSHOP_URL = /\bcdn\.shopify\.com\b/i;

/** Dutch label for a stored source code (case and surrounding spaces ignored); unknown codes show as stored. */
export function sourceLabel(value: string | null | undefined): string {
  const raw = value ?? '';
  return SOURCE_LABELS.get(raw.trim().toUpperCase()) ?? raw;
}

/** Masks an archived CDN URL of the former webshop; every other record key or location shows as stored. */
export function sourceRecordLabel(value: string | null | undefined): string {
  const raw = value ?? '';
  return ARCHIVED_WEBSHOP_URL.test(raw) ? ARCHIVED_WEBSHOP_RECORD_LABEL : raw;
}
