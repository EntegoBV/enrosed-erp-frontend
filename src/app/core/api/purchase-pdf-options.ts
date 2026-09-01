export type PurchasePdfLayout = 'PORTRAIT' | 'LANDSCAPE';
export type PurchasePdfAudience = 'INTERNAL' | 'STANDARD' | 'SUPPLIER';

/** Optional switches accepted by the purchase PDF endpoint. */
export interface PurchasePdfOptions {
  layout?: PurchasePdfLayout;
  audience?: PurchasePdfAudience;
  showRevenue?: boolean;
  showSupplier?: boolean;
  showPrices?: boolean;
  showEur?: boolean;
  /** Shows one all-in EUR cost per product line; never exposes its components. */
  includeEnrosedCost?: boolean;
  /** @deprecated Kept only for compatibility with older API deployments. */
  showFreight?: boolean;
  /** @deprecated Kept only for compatibility with older API deployments. */
  includeFreight?: boolean;
}

export interface NormalizedPurchasePdfOptions {
  layout: PurchasePdfLayout;
  audience?: PurchasePdfAudience;
  showRevenue: boolean;
  showSupplier: boolean;
  showPrices: boolean;
  showEur: boolean;
  includeEnrosedCost: boolean;
  showFreight: boolean;
  includeFreight: boolean;
}

/**
 * Keeps impossible combinations out of both the UI and the request.
 * The all-in ENROSED cost is limited to the standard portrait export, but is
 * independent of visible supplier prices. Legacy freight switches stay off:
 * cost components must never appear as a separate block in the document.
 */
export function normalizePurchasePdfOptions(
  options: PurchasePdfOptions = {},
): NormalizedPurchasePdfOptions {
  const layout = options.layout ?? 'LANDSCAPE';
  const audience = options.audience;
  const showPrices = options.showPrices ?? true;
  const standardPortrait = layout === 'PORTRAIT' && audience === 'STANDARD';
  return {
    layout,
    audience,
    showRevenue: options.showRevenue ?? false,
    showSupplier: options.showSupplier ?? true,
    showPrices,
    showEur: showPrices && (options.showEur ?? false),
    includeEnrosedCost: standardPortrait && (options.includeEnrosedCost ?? false),
    showFreight: false,
    includeFreight: false,
  };
}

/** Stable query serialization shared by the API and lightweight unit tests. */
export function purchasePdfQuery(options: PurchasePdfOptions = {}): string {
  const resolved = normalizePurchasePdfOptions(options);
  const query = new URLSearchParams();
  query.set('showRevenue', String(resolved.showRevenue));
  query.set('layout', resolved.layout);
  if (resolved.audience) query.set('audience', resolved.audience);
  query.set('showSupplier', String(resolved.showSupplier));
  query.set('showPrices', String(resolved.showPrices));
  query.set('showEur', String(resolved.showEur));
  query.set('includeEnrosedCost', String(resolved.includeEnrosedCost));
  query.set('showFreight', String(resolved.showFreight));
  query.set('includeFreight', String(resolved.includeFreight));
  return query.toString();
}
