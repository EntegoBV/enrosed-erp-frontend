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
  showFreight?: boolean;
  includeFreight?: boolean;
}

export interface NormalizedPurchasePdfOptions {
  layout: PurchasePdfLayout;
  audience?: PurchasePdfAudience;
  showRevenue: boolean;
  showSupplier: boolean;
  showPrices: boolean;
  showEur: boolean;
  showFreight: boolean;
  includeFreight: boolean;
}

/**
 * Keeps impossible combinations out of both the UI and the request.
 * Logistics stays independently visible because it is an explicit cost block
 * of its own. A combined total needs both visible product prices and freight.
 */
export function normalizePurchasePdfOptions(
  options: PurchasePdfOptions = {},
): NormalizedPurchasePdfOptions {
  const showPrices = options.showPrices ?? true;
  const showFreight = options.showFreight ?? false;
  return {
    layout: options.layout ?? 'LANDSCAPE',
    audience: options.audience,
    showRevenue: options.showRevenue ?? false,
    showSupplier: options.showSupplier ?? true,
    showPrices,
    showEur: showPrices && (options.showEur ?? false),
    showFreight,
    includeFreight: showPrices && showFreight && (options.includeFreight ?? false),
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
  query.set('showFreight', String(resolved.showFreight));
  query.set('includeFreight', String(resolved.includeFreight));
  return query.toString();
}
