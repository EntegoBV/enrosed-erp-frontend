export type PurchaseInspectionLanguage = 'EN' | 'NL';

/** An inspector receives a separate document; commercial PDF options never apply. */
export interface PurchaseInspectionOptions {
  language?: PurchaseInspectionLanguage;
  includePhotos?: boolean;
  includeSupplierAgreements?: boolean;
}

export function purchaseInspectionQuery(options: PurchaseInspectionOptions = {}): string {
  return new URLSearchParams({
    language: options.language === 'NL' ? 'NL' : 'EN',
    includePhotos: String(options.includePhotos ?? true),
    includeSupplierAgreements: String(options.includeSupplierAgreements ?? true),
  }).toString();
}
