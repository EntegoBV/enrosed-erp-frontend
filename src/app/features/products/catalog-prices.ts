import type { CatalogPriceBasis, CatalogPriceOverride } from '../../core/api/catalog-api';
import type { CustomerPrice } from '../../core/api/customer-price-api';
import type { Product } from '../../core/api/models';

/*
 * The prices of a catalogue PDF as the studio previews them, free of Angular.
 * The server decides (CatalogExportService); this mirrors its order per
 * product: a one-off price for this PDF, else the customer's stored price
 * (active, on the product's sales unit of now), else the catalogue price
 * (computedSalesPriceEur), else "Prijs op aanvraag". Every amount is EUR excl.
 * VAT on the product's own sales unit: per display when sold per display.
 */

type PricedProduct = Pick<Product, 'packaging' | 'computedSalesPriceEur'>;

export interface PriceBasisNow {
  basis: CatalogPriceBasis;
  /** Pieces per display; null for PIECE. */
  piecesPerUnit: number | null;
}

/** Packaging.salesUnit(): per display only for a display priced per display. */
export function priceBasis(product: Pick<Product, 'packaging'>): PriceBasisNow {
  const packaging = product.packaging;
  const display = packaging?.kind === 'DISPLAY' && packaging.salesUnit === 'DISPLAY';
  return { basis: display ? 'DISPLAY' : 'PIECE', piecesPerUnit: display ? packaging.piecesPerUnit ?? null : null };
}

/**
 * The server's printable(): a display sold per display without its piece
 * count prints "Prijs op aanvraag" whatever price it is given (warning
 * DISPLAY_WITHOUT_PIECES), a one-off or customer price included.
 */
export function pricePrintable(product: Pick<Product, 'packaging'>): boolean {
  const { basis, piecesPerUnit } = priceBasis(product);
  return basis !== 'DISPLAY' || (piecesPerUnit !== null && piecesPerUnit > 1);
}

/** The product is sold on another unit than the price was typed for: the server refuses it (BASIS_CHANGED). */
export function basisChanged(product: Pick<Product, 'packaging'>, price: Pick<CatalogPriceOverride, 'basis' | 'piecesPerUnit'>): boolean {
  const now = priceBasis(product);
  return now.basis !== price.basis || now.piecesPerUnit !== (price.piecesPerUnit ?? null);
}

/** The catalogue price, or null where the PDF says "Prijs op aanvraag". */
export function cataloguePrice(product: PricedProduct): number | null {
  const price = Number(product.computedSalesPriceEur);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export interface StandardPrice {
  /** null: "Prijs op aanvraag". */
  eur: number | null;
  source: 'CUSTOMER' | 'CATALOGUE' | 'ON_REQUEST';
}

/** What the PDF prints without a one-off price. A stored price applies only while ACTIVE (the server's status). */
export function standardPrice(product: PricedProduct, stored: CustomerPrice | null | undefined): StandardPrice {
  if (!pricePrintable(product)) return { eur: null, source: 'ON_REQUEST' };
  if (stored?.status === 'ACTIVE' && stored.priceExclVat > 0) return { eur: stored.priceExclVat, source: 'CUSTOMER' };
  const catalogue = cataloguePrice(product);
  return catalogue === null ? { eur: null, source: 'ON_REQUEST' } : { eur: catalogue, source: 'CATALOGUE' };
}

/** Why a typed price cannot go into the PDF; null when it can. More than 2 decimals is refused, never rounded. */
export function priceProblem(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value <= 0) return 'Prijs boven € 0';
  if (value >= 1_000_000) return 'Prijs onder € 1.000.000';
  if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) return 'Hoogstens 2 decimalen';
  return null;
}

/** price × (1 + pct / 100) in whole cents, half up: 4,96 − 10 % = 4,46 (4,464); 1,05 + 50 % = 1,58 (1,575). */
export function percentPrice(eur: number, pct: number): number {
  const cents = Math.round(eur * 100);
  const hundredths = Math.round(pct * 100);
  return Math.floor((cents * (10_000 + hundredths) + 5_000) / 10_000) / 100;
}

/** A one-off price (or "Op aanvraag") for this PDF, on the unit the product is sold in now. */
export function oneOffPrice(product: Pick<Product, 'id' | 'packaging'>, priceEur: number | null, onRequest = false): CatalogPriceOverride {
  const basis = priceBasis(product);
  return {
    productId: product.id!,
    priceEur: onRequest ? null : priceEur,
    ...(onRequest ? { onRequest: true } : {}),
    basis: basis.basis,
    piecesPerUnit: basis.piecesPerUnit,
  };
}

/** Whether a one-off price changes what the PDF would print anyway (the server drops one that does not). */
export function changesPrint(product: PricedProduct, price: CatalogPriceOverride, standard: StandardPrice): boolean {
  if (basisChanged(product, price)) return true;
  if (!pricePrintable(product)) return false;
  if (price.onRequest) return standard.eur !== null;
  return price.priceEur !== null && price.priceEur !== standard.eur;
}

/** What the PDF prints for this product; null is "Prijs op aanvraag". */
export function printedPrice(product: PricedProduct, price: CatalogPriceOverride | null | undefined,
                             stored: CustomerPrice | null | undefined): number | null {
  if (price?.onRequest || !pricePrintable(product)) return null;
  if (price && price.priceEur !== null && !priceProblem(price.priceEur)) return price.priceEur;
  return standardPrice(product, stored).eur;
}

/**
 * The one-off prices a request carries: for selected products only, each a
 * real change, in the selection's order. A price whose unit changed since it
 * was typed goes along, so the server names it (BASIS_CHANGED).
 */
export function requestOverrides(products: readonly Product[], overrides: ReadonlyMap<number, CatalogPriceOverride>,
                                 stored: ReadonlyMap<number, CustomerPrice>): CatalogPriceOverride[] {
  return products.flatMap((product) => {
    const price = product.id === null ? undefined : overrides.get(product.id);
    if (!price || (!price.onRequest && (price.priceEur === null || priceProblem(price.priceEur)))) return [];
    return changesPrint(product, price, standardPrice(product, stored.get(product.id!))) ? [price] : [];
  });
}

/** A one-off price read back from the tab's storage, checked field by field; null for anything else. */
export function storedOverride(value: unknown): CatalogPriceOverride | null {
  const price = value as Partial<CatalogPriceOverride> | null;
  if (!price || typeof price !== 'object') return null;
  const { productId, priceEur, onRequest, basis, piecesPerUnit } = price;
  if (typeof productId !== 'number' || !Number.isSafeInteger(productId) || productId <= 0) return null;
  if (basis !== 'PIECE' && basis !== 'DISPLAY') return null;
  if (piecesPerUnit != null && (typeof piecesPerUnit !== 'number' || !Number.isSafeInteger(piecesPerUnit))) return null;
  if (onRequest === true) return { productId, priceEur: null, onRequest: true, basis, piecesPerUnit: piecesPerUnit ?? null };
  if (typeof priceEur !== 'number' || priceProblem(priceEur) || priceEur <= 0) return null;
  return { productId, priceEur, basis, piecesPerUnit: piecesPerUnit ?? null };
}

/** Today in this browser's calendar, as yyyy-mm-dd (a validity date is a local day). */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** "bloemenatelier-linde": the customer in enrosed-prijslijst-<slug>-<lang>.pdf, as the server names the file. */
export function recipientSlug(name: string): string {
  const slug = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return slug || 'klant';
}
