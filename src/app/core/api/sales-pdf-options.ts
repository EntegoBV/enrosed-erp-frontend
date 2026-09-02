import type { LanguageCode } from './models';

/** Optional content switches accepted by the authenticated sales PDF endpoint. */
export interface SalesPdfOptions {
  language?: LanguageCode | null;
  includePhotos?: boolean;
  includeProductDetails?: boolean;
  includeLogistics?: boolean;
  includeTerms?: boolean;
}

export interface NormalizedSalesPdfOptions {
  language?: LanguageCode;
  includePhotos: boolean;
  includeProductDetails: boolean;
  includeLogistics: boolean;
  includeTerms: boolean;
}

export function normalizeSalesPdfOptions(
  options: SalesPdfOptions = {},
): NormalizedSalesPdfOptions {
  return {
    ...(options.language ? { language: options.language } : {}),
    includePhotos: options.includePhotos ?? true,
    includeProductDetails: options.includeProductDetails ?? true,
    includeLogistics: options.includeLogistics ?? true,
    includeTerms: options.includeTerms ?? true,
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
  return query.toString();
}
