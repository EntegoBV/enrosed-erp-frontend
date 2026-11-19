import type { LanguageCode } from './models';

/** Optional content switches accepted by the authenticated sales PDF endpoint. */
export interface SalesPdfOptions {
  language?: LanguageCode | null;
  includePhotos?: boolean;
  includeProductDetails?: boolean;
  includeLogistics?: boolean;
  includeTerms?: boolean;
  /** Shows payment terms, instalments and the payment/settlement breakdown. */
  includePaymentDetails?: boolean;
  /** Shows outer-carton dimensions, quantity and EAN as a separate product fact. */
  showOuterCarton?: boolean;
  /** Shows product and packaging barcodes as separate product facts. */
  showBarcode?: boolean;
}

export interface NormalizedSalesPdfOptions {
  language?: LanguageCode;
  includePhotos: boolean;
  includeProductDetails: boolean;
  includeLogistics: boolean;
  includeTerms: boolean;
  includePaymentDetails: boolean;
  showOuterCarton: boolean;
  showBarcode: boolean;
}

/** The pakbon's two designs: v1 as it always was, v2 in the new purchase order's family. */
export type PackingSlipDesign = 'v1' | 'v2';

/** The packing slip has no commercial switches: it can only add packing identifiers. */
export interface PackingSlipPdfOptions {
  showOuterCarton?: boolean;
  showBarcode?: boolean;
  design?: PackingSlipDesign;
}

export interface NormalizedPackingSlipPdfOptions {
  showOuterCarton: boolean;
  showBarcode: boolean;
  design: PackingSlipDesign;
}

const PACKING_SLIP_DESIGN_KEY = 'enrosed.packingSlip.design';

/** The pakbon design last chosen in this browser; v1 when nothing is stored or storage is blocked. */
export function rememberedPackingSlipDesign(): PackingSlipDesign {
  try {
    return localStorage.getItem(PACKING_SLIP_DESIGN_KEY) === 'v2' ? 'v2' : 'v1';
  } catch {
    return 'v1';
  }
}

export function rememberPackingSlipDesign(design: PackingSlipDesign): void {
  try {
    localStorage.setItem(PACKING_SLIP_DESIGN_KEY, design);
  } catch {
    /* a convenience only: without storage the next sheet starts at v1 again */
  }
}

export function normalizeSalesPdfOptions(options: SalesPdfOptions = {}): NormalizedSalesPdfOptions {
  return {
    ...(options.language ? { language: options.language } : {}),
    includePhotos: options.includePhotos ?? true,
    includeProductDetails: options.includeProductDetails ?? true,
    includeLogistics: options.includeLogistics ?? true,
    includeTerms: options.includeTerms ?? true,
    includePaymentDetails: options.includePaymentDetails ?? true,
    showOuterCarton: options.showOuterCarton ?? false,
    showBarcode: options.showBarcode ?? false,
  };
}

export function normalizePackingSlipPdfOptions(
  options: PackingSlipPdfOptions = {},
): NormalizedPackingSlipPdfOptions {
  return {
    showOuterCarton: options.showOuterCarton ?? false,
    showBarcode: options.showBarcode ?? false,
    design: options.design === 'v2' ? 'v2' : 'v1',
  };
}

/** Stable query serialization shared by the API and the focused unit test. */
export function salesPdfQuery(options: SalesPdfOptions = {}): string {
  const resolved = normalizeSalesPdfOptions(options);
  const query = new URLSearchParams();
  if (resolved.language) query.set('language', resolved.language);
  query.set('includePhotos', String(resolved.includePhotos));
  query.set('includeProductDetails', String(resolved.includeProductDetails));
  query.set('includeLogistics', String(resolved.includeLogistics));
  query.set('includeTerms', String(resolved.includeTerms));
  query.set('includePaymentDetails', String(resolved.includePaymentDetails));
  query.set('showOuterCarton', String(resolved.showOuterCarton));
  query.set('showBarcode', String(resolved.showBarcode));
  return query.toString();
}

/** Packing-slip serialization is deliberately separate so price switches can never leak in. */
export function packingSlipPdfQuery(options: PackingSlipPdfOptions = {}): string {
  const resolved = normalizePackingSlipPdfOptions(options);
  const query = new URLSearchParams();
  query.set('showOuterCarton', String(resolved.showOuterCarton));
  query.set('showBarcode', String(resolved.showBarcode));
  /* Only v2 names itself, so every link to the first design stays exactly as it was. */
  if (resolved.design === 'v2') query.set('design', 'v2');
  return query.toString();
}
