import type { CatalogLayout } from '../../core/api/catalog-api';
import type {
  CatalogExportPriceSource, CatalogExportSummary, CustomerPrice, CustomerPriceBasis, CustomerPriceHistoryEntry, CustomerPriceStatus,
} from '../../core/api/customer-price-api';
import { LANGUAGES, type LanguageCode, type Product } from '../../core/api/models';
import { stripColour, variantOf } from '../purchasing/purchase-desk-format';
import { unitName } from '../products/product-sales-unit';

/**
 * The wording of the Klantprijzen block on the customer sheet, without
 * Angular: a row's name, unit, pill and second line, the history's change
 * and the journal's facts, and the check of a typed price. Every price is
 * EUR excl. VAT on the product's own sales unit, as the catalogue price.
 */

const LOCALE = 'nl-BE';

/** The server refuses a price of a million or more. */
export const PRICE_LIMIT = 1_000_000;

/** "€ 2,10", as the eur pipe writes it. */
export function euro(value: number): string {
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

/** 31/12/2026, for a date-only value. */
export function dayText(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

/** "05/11/2026, 14:32", for a moment (as the dateTimeNl pipe writes it). */
export function momentText(value: string | null | undefined): string {
  const date = value ? new Date(value) : null;
  if (!date || isNaN(date.getTime())) return value ?? '';
  return new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

/** Today in the device's own calendar, as the date field writes it. */
export function todayIso(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "Rozenstolp M · Rood": the series and what tells this variant apart; without the product, its stored name or SKU. */
export function productLabel(
  product: Pick<Product, 'name' | 'colour' | 'variantSize'> | null | undefined,
  row: { productId: number; name: string | null; sku: string | null },
): string {
  if (!product) {
    const name = row.name?.trim();
    const sku = row.sku?.trim();
    return name && sku ? `${name} · ${sku}` : name || sku || `Product #${row.productId}`;
  }
  const name = stripColour(product.name?.trim() ?? '', product.colour);
  /* "Rozenstolp S" already names its size. */
  const size = product.variantSize?.trim() || null;
  const variant = variantOf({ colour: product.colour, variantSize: size && name.endsWith(size) ? null : size });
  return variant ? `${name} · ${variant}` : name;
}

/** "per bowl", "per display van 6": the unit a stored basis names (no unit key reads as stuk). */
export function basisPer(
  salesUnit: CustomerPriceBasis | null | undefined,
  piecesPerUnit: number | null | undefined,
  unitKey: string | null | undefined,
): string {
  if (salesUnit !== 'DISPLAY') return unitName(unitKey).per;
  return piecesPerUnit != null && piecesPerUnit > 1 ? `per display van ${piecesPerUnit.toLocaleString(LOCALE)}` : 'per display';
}

/** The one-word pill of a price that prints nothing; an active price wears none. */
export function statusPill(status: CustomerPriceStatus): { label: string; css: string } | null {
  if (status === 'EXPIRED') return { label: 'Verlopen', css: 'badge--neutral' };
  if (status === 'BASIS_CHANGED') return { label: 'Nakijken', css: 'badge--warn' };
  if (status === 'PRODUCT_GONE') return { label: 'Verwijderd', css: 'badge--neutral' };
  return null;
}

/** "−14 %" against a catalogue price; nothing when equal or without one. */
export function deltaText(price: number, catalogue: number | null | undefined): string | null {
  if (catalogue == null || !(catalogue > 0) || !(price > 0)) return null;
  const pct = Math.round((price / catalogue - 1) * 100);
  return pct === 0 ? null : `${pct > 0 ? '+' : '−'}${Math.abs(pct)} %`;
}

/**
 * A row's second line: today's catalogue price and the difference, the end
 * date, or why the price prints nothing ("Prijsbasis nu per bowl").
 */
export function rowMeta(row: CustomerPrice, currentPer: string | null): string {
  if (row.status === 'PRODUCT_GONE') return row.sku ? `${row.sku} · niet meer in de catalogus` : 'Niet meer in de catalogus';
  if (row.status === 'BASIS_CHANGED') return currentPer ? `Prijsbasis nu ${currentPer}` : 'Prijsbasis gewijzigd';
  const catalogue = row.cataloguePriceNow != null ? `catalogus ${euro(row.cataloguePriceNow)}` : 'geen catalogusprijs';
  const text = [catalogue, deltaText(row.priceExclVat, row.cataloguePriceNow), row.validUntil ? `tot ${dayText(row.validUntil)}` : null]
    .filter(Boolean).join(' · ');
  return text.charAt(0).toLocaleUpperCase(LOCALE) + text.slice(1);
}

/** "n klantprijzen", and how many print when that is not all of them. */
export function summaryText(rows: readonly Pick<CustomerPrice, 'status'>[]): string {
  const active = rows.filter((row) => row.status === 'ACTIVE').length;
  const count = `${rows.length} ${rows.length === 1 ? 'klantprijs' : 'klantprijzen'}`;
  return active === rows.length ? count : `${count} · ${active} actief`;
}

/** What a typed price lacks; null when the server will take it (more than 2 decimals is refused, never rounded). */
export function priceProblem(amount: number | null | undefined): string | null {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return 'Vul een prijs hoger dan € 0 in.';
  if (amount >= PRICE_LIMIT) return 'Een prijs blijft onder € 1.000.000.';
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) return 'Gebruik hoogstens 2 decimalen.';
  return null;
}

/** The history's change: "€ 2,30 → € 2,10", a first price alone, a removal with what it was. */
export function historyChange(entry: Pick<CustomerPriceHistoryEntry, 'priceExclVat' | 'previousPriceExclVat'>): string {
  const before = entry.previousPriceExclVat;
  if (entry.priceExclVat == null) return before != null ? `${euro(before)} → verwijderd` : 'Verwijderd';
  return before != null && before !== entry.priceExclVat ? `${euro(before)} → ${euro(entry.priceExclVat)}` : euro(entry.priceExclVat);
}

/** Who and when (the moment left out where it heads the row), and where it happened when that was not the customer sheet. */
export function historyMeta(entry: CustomerPriceHistoryEntry, withMoment = true): string {
  const source = entry.source === 'CATALOG_EXPORT' ? 'bij een catalogus'
    : entry.source === 'CUSTOMER_DELETED' ? 'klant verwijderd' : null;
  const parts = [withMoment ? momentText(entry.changedAt) : null, entry.changedBy, source, entry.validUntil ? `tot ${dayText(entry.validUntil)}` : null];
  const text = parts.filter(Boolean).join(' · ');
  return text.charAt(0).toLocaleUpperCase(LOCALE) + text.slice(1);
}

export function layoutLabel(layout: CatalogLayout | string): string {
  return layout === 'SIMPLE' ? 'Compact overzicht' : layout === 'BROCHURE' ? 'Handelscatalogus' : layout;
}

export function languageLabel(language: LanguageCode | string): string {
  return LANGUAGES.find((entry) => entry.code === language)?.label ?? language;
}

/** A journal entry's second line: the language, the prices it carried and who made it. */
export function exportMeta(entry: CatalogExportSummary): string {
  const prices = [
    entry.customerPriceCount > 0 ? `${entry.customerPriceCount} ${entry.customerPriceCount === 1 ? 'klantprijs' : 'klantprijzen'}` : null,
    entry.oneOffCount > 0 ? `${entry.oneOffCount} eenmalig` : null,
  ];
  return [languageLabel(entry.language), ...prices, entry.exportedBy].filter(Boolean).join(' · ');
}

/** "Handelscatalogus · 24 producten". */
export function exportTitle(entry: CatalogExportSummary): string {
  return `${layoutLabel(entry.layout)} · ${entry.productCount} ${entry.productCount === 1 ? 'product' : 'producten'}`;
}

/** The pill of a printed price that was not the catalogue's. */
export function sourcePill(source: CatalogExportPriceSource | null): { label: string; css: string } | null {
  if (source === 'CUSTOMER') return { label: 'Klantprijs', css: 'badge--rose' };
  if (source === 'ONE_OFF') return { label: 'Eenmalig', css: 'badge--gold' };
  return null;
}
