export type PurchasePdfLayout = 'PORTRAIT' | 'LANDSCAPE';
export type PurchasePdfAudience = 'INTERNAL' | 'STANDARD' | 'SUPPLIER';
/** The purchase order's two designs: v1 as it was before 2026-11-18 (Klassiek), v2 the current one. */
export type PurchasePdfDesign = 'v1' | 'v2';

const PURCHASE_PDF_DESIGN_KEY = 'enrosed.purchaseOrder.design';

/** The design last chosen in this browser; v2, the current one, when nothing is stored or storage is blocked. */
export function rememberedPurchasePdfDesign(): PurchasePdfDesign {
  try {
    return localStorage.getItem(PURCHASE_PDF_DESIGN_KEY) === 'v1' ? 'v1' : 'v2';
  } catch {
    return 'v2';
  }
}

export function rememberPurchasePdfDesign(design: PurchasePdfDesign): void {
  try {
    localStorage.setItem(PURCHASE_PDF_DESIGN_KEY, design);
  } catch {
    /* a convenience only: without storage the next sheet starts at v2 again */
  }
}

/** Optional switches accepted by the purchase PDF endpoint. */
export interface PurchasePdfOptions {
  layout?: PurchasePdfLayout;
  audience?: PurchasePdfAudience;
  /** Klassiek (v1) or the current design (v2, the default); the same choice for every layout. */
  design?: PurchasePdfDesign;
  showRevenue?: boolean;
  showSupplier?: boolean;
  showPrices?: boolean;
  /** Shows the agreed purchase price per piece in the standard portrait table. */
  includeUnitPrice?: boolean;
  showEur?: boolean;
  /** Replaces original-currency product prices and totals with their EUR values. */
  eurOnly?: boolean;
  /** Shows one total landed EUR cost for the complete product line. */
  includeEnrosedCost?: boolean;
  /** Shows the total landed EUR cost for one piece. */
  includeEnrosedUnitCost?: boolean;
  /** Shows the payment agreement recorded on the purchase order. */
  showPaymentTerms?: boolean;
  /** Shows outer-carton dimensions and packing details on each product row. */
  showOuterCarton?: boolean;
  /** Shows the product barcode on each product row. */
  showBarcode?: boolean;
  /** Prints the inspection and other named costs under the order total; on unless switched off. */
  showSeparateCosts?: boolean;
  /** @deprecated Kept only for compatibility with older API deployments. */
  showFreight?: boolean;
  /** @deprecated Kept only for compatibility with older API deployments. */
  includeFreight?: boolean;
}

export interface NormalizedPurchasePdfOptions {
  layout: PurchasePdfLayout;
  audience?: PurchasePdfAudience;
  design: PurchasePdfDesign;
  showRevenue: boolean;
  showSupplier: boolean;
  showPrices: boolean;
  includeUnitPrice: boolean;
  showEur: boolean;
  eurOnly: boolean;
  includeEnrosedCost: boolean;
  includeEnrosedUnitCost: boolean;
  showPaymentTerms: boolean;
  showOuterCarton: boolean;
  showBarcode: boolean;
  showSeparateCosts: boolean;
  showFreight: boolean;
  includeFreight: boolean;
}

/**
 * Keeps impossible combinations out of both the UI and the request.
 *
 * Every optional field starts hidden. The configurable switches belong only
 * to the standard portrait document; supplier and landscape are fixed presets.
 */
export function normalizePurchasePdfOptions(
  options: PurchasePdfOptions = {},
): NormalizedPurchasePdfOptions {
  const layout = options.layout ?? 'LANDSCAPE';
  const audience = options.audience;
  const standardPortrait = layout === 'PORTRAIT' && audience === 'STANDARD';
  /* Supplier and landscape are fixed legacy presets. Only the configurable
     standard portrait starts with every optional field hidden. */
  const showSupplier = standardPortrait
    ? (options.showSupplier ?? false)
    : (options.showSupplier ?? true);
  const showPrices = standardPortrait
    ? (options.showPrices ?? false)
    : (options.showPrices ?? true);
  const eurOnly = standardPortrait && showPrices && (options.eurOnly ?? false);

  return {
    layout,
    audience,
    design: options.design === 'v1' ? 'v1' : 'v2',
    /* Landscape is the internal calculation: every cost column, unless a caller says otherwise. */
    showRevenue: options.showRevenue ?? layout === 'LANDSCAPE',
    showSupplier,
    showPrices,
    includeUnitPrice: standardPortrait
      ? showPrices && (options.includeUnitPrice ?? false)
      : true,
    showEur: showPrices && !eurOnly && (options.showEur ?? false),
    eurOnly,
    includeEnrosedCost: standardPortrait && (options.includeEnrosedCost ?? false),
    includeEnrosedUnitCost: standardPortrait && (options.includeEnrosedUnitCost ?? false),
    showPaymentTerms: standardPortrait && (options.showPaymentTerms ?? false),
    showOuterCarton: standardPortrait && (options.showOuterCarton ?? false),
    showBarcode: standardPortrait && (options.showBarcode ?? false),
    /* The one field that starts on: a booked inspection belongs on the
       internal sheet unless the buyer leaves it off this copy. The fixed
       presets always print it. */
    showSeparateCosts: standardPortrait ? (options.showSeparateCosts ?? true) : true,
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
  query.set('includeUnitPrice', String(resolved.includeUnitPrice));
  query.set('showEur', String(resolved.showEur));
  query.set('eurOnly', String(resolved.eurOnly));
  query.set('includeEnrosedCost', String(resolved.includeEnrosedCost));
  query.set('includeEnrosedUnitCost', String(resolved.includeEnrosedUnitCost));
  query.set('showPaymentTerms', String(resolved.showPaymentTerms));
  query.set('showOuterCarton', String(resolved.showOuterCarton));
  query.set('showBarcode', String(resolved.showBarcode));
  query.set('showSeparateCosts', String(resolved.showSeparateCosts));
  query.set('showFreight', String(resolved.showFreight));
  query.set('includeFreight', String(resolved.includeFreight));
  /* Only the classic design names itself, so every link to the current design stays exactly as it was. */
  if (resolved.design === 'v1') query.set('design', 'v1');
  return query.toString();
}
