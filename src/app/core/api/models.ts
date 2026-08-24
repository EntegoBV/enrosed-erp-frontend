/**
 * The shapes that go over the wire.
 *
 * They follow the backend's DTOs; what is calculated there is not redone
 * here. The frontend shows, the server calculates.
 */

export type Currency = 'EUR' | 'USD' | 'CNY';
export type MarkupMode = 'PRODUCT' | 'ORDER';
export type Allocation = 'CBM' | 'VALUE' | 'PIECES';
export type LoadMode = 'PALLETS' | 'LOOSE_CARTONS';
export type PalletProfile = 'EURO_120X80' | 'BLOCK_120X100' | 'HALF_80X60';
export type FreightPricingStrategy = 'COUNTRY_PALLET' | 'PER_CBM' | 'FIXED';
export type PublicationStatus = 'DRAFT' | 'READY' | 'PUBLISHED';

export type QuoteStatus =
  | 'CONCEPT' | 'VERZONDEN' | 'BEKEKEN' | 'WIJZIGING_GEVRAAGD'
  | 'GEACCEPTEERD' | 'AFGEWEZEN' | 'VERLOPEN';

export type RevisionStatus = 'IN_AFWACHTING' | 'GOEDGEKEURD' | 'AFGEWEZEN' | 'INGETROKKEN';

export interface Dimensions {
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  /** Weight of the thing these sizes describe, in kilograms; null when unknown. */
  weightKg?: number | null;
}

export type PackagingKind = 'NONE' | 'GIFT_BOX' | 'DISPLAY';

/** One line in the stock book: what changed, to what, why, where and by whom. */
export interface StockMovement {
  id: number;
  at: string;
  delta: number;
  quantityAfter: number;
  kind: 'PURCHASE_RECEIPT' | 'MANUAL_CORRECTION' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'STOCKTAKE' | 'SALE' | 'DAMAGED' | 'DEMO';
  kindLabel: string;
  reference: string | null;
  actor: string | null;
  locationId: number | null;
  locationName: string | null;
}

/** A place where stock sits: the warehouse, or a sales point such as a TICA stand. */
export interface StockLocation {
  id: number | null;
  code: string | null;
  name: string;
  kind: 'WAREHOUSE' | 'SALES_POINT';
  kindLabel?: string;
  address: string | null;
  active: boolean;
  /** Adds to the stock the website and the portal show. */
  countsForWebsite: boolean;
  /** Purchase receipts land here unless the order says otherwise. */
  receivesByDefault: boolean;
  position: number;
}

/** How many pieces of one product lie at one location. */
export interface StockLevel {
  productId: number;
  locationId: number;
  quantity: number;
}

/** A product's pieces at one location, with the location spelled out. */
export interface ProductStock {
  locationId: number;
  code: string;
  name: string;
  kindLabel: string;
  countsForWebsite: boolean;
  quantity: number;
}

/** Gift box or display the product is sold in, with its own outer size. */
export interface Packaging {
  kind: PackagingKind;
  dimensions: Dimensions;
  /** EAN on the gift box or display itself, when it is scanned apart from the article. */
  barcode: string | null;
  /** Pieces one display holds; null or 1 for a gift box around a single piece. */
  piecesPerUnit?: number | null;
}

export interface CartonDto {
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  piecesPerCarton: number | null;
  weightKg: number | null;
  /** Hand-counted pieces per 40' HC; null = derived from the carton size. */
  piecesPerHc?: number | null;
  /** What fits a 40' HC: the hand count, or full cartons by volume. */
  hcCapacity?: number | null;
}

export interface PhotoDto {
  id: number;
  /** Canonical family-gallery photo behind an inherited projection. */
  familyPhotoId: number | null;
  origin: 'PRODUCT' | 'FAMILY';
  /** Inherited family photos remain downloadable but are edited on the family gallery. */
  readOnly: boolean;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  widthPx: number | null;
  heightPx: number | null;
  position: number;
  url: string;
  downloadUrl: string;
}

export interface ProductText {
  language: LanguageCode;
  name: string | null;
  description: string | null;
  colour: string | null;
  /** Localized merchandising label such as Small/Medium/Large; dimensions stay universal. */
  variantSize: string | null;
}

export interface Product {
  id: number | null;
  /** Canonical customer-facing model shared by all colour variants. */
  familyId: number | null;
  canonicalVariantKey: string | null;
  canonicalBarcode: string | null;
  variantPosition: number | null;
  /** False when a migrated source did not contain a reliable stock value. */
  inventoryKnown: boolean | null;
  sku: string | null;
  name: string;
  /** Dimensions of the product itself - apart from variant and outer carton. */
  dimensions: Dimensions;
  /** Presentation packaging around the product; kind NONE when sold bare. */
  packaging: Packaging;
  /** Colour of the article; first of what may become product options. */
  colour: string | null;
  /** Optional exact swatch for this variant, stored as #RRGGBB. */
  colourHex: string | null;
  /** Human-readable size option such as S, 30 cm or XL. */
  variantSize: string | null;
  /** Customer-facing base copy; translated variants live in texts. */
  description: string | null;
  categoryId: number | null;
  supplierId: number | null;
  active: boolean;
  /** Optional merchandising parent shared by colour/size SKUs. */
  familyKey: string | null;
  /** Stable URL identity used by the website and ordering app. */
  publicHandle: string | null;
  websiteStatus: PublicationStatus;
  orderAppStatus: PublicationStatus;
  barcodeInner: string | null;
  barcodeOuter: string | null;
  hsCode: string | null;
  carton: CartonDto;
  exwPrice: number | null;
  exwCurrency: Currency;
  extraUnitCost: number | null;
  landedCostEur: number | null;
  landedCostSource: string | null;
  markupPct: number | null;
  fixedSalesPriceEur: number | null;
  /** Server-owned result of the active price strategy. */
  computedSalesPriceEur: number;
  /** Stock in pieces; grows when a purchase order is received. */
  stockQuantity: number;
  photos: PhotoDto[];
  texts: ProductText[];
  /** Server-owned blockers that must be resolved before publishing. */
  publicationIssues: string[];
  describedAs?: string;
  cartonCbm?: number;
  pieceCbm?: number;
}

export interface ProductFamilyText {
  language: LanguageCode;
  name: string | null;
  summary: string | null;
  description: string | null;
  format: string | null;
  highlights: string[];
  seoTitle: string | null;
  seoDescription: string | null;
}

export interface ProductFamilyImageAlt {
  language: LanguageCode;
  alt: string | null;
}

export interface ProductFamilyImage {
  id: number;
  sourceKey: string;
  sourceAssetId: string | null;
  sourceUrl: string | null;
  originalFilename: string;
  originalWidthPx: number | null;
  originalHeightPx: number | null;
  smallUrl: string;
  largeUrl: string;
  smallSha256: string;
  smallWidthPx: number | null;
  smallHeightPx: number | null;
  largeSha256: string;
  largeWidthPx: number | null;
  largeHeightPx: number | null;
  position: number;
  /** Product variant this image belongs to; null means the whole family. */
  variantProductId: number | null;
  variantExternalId: string | null;
  variantColor: string | null;
  altTextSource: string | null;
  altTexts: ProductFamilyImageAlt[];
}

export interface ProductPublicTranslationImage {
  imageId: number;
  position: number;
  altTexts: ProductFamilyImageAlt[];
}

export interface ProductPublicTranslationsSnapshot {
  revision: string;
  /** Null for a deliberately standalone product. */
  familyId: number | null;
  productId: number;
  familyTexts: ProductFamilyText[];
  productTexts: ProductText[];
  images: ProductPublicTranslationImage[];
  family: ProductFamily | null;
  product: Product;
}

export interface ProductPublicTranslationsWrite {
  revision: string;
  familyId: number | null;
  familyTexts: ProductFamilyText[];
  productTexts: ProductText[];
  images: ProductPublicTranslationImage[];
}

export interface ProductExternalIdentifier {
  source: string;
  identifierType: string;
  value: string;
}

export interface ProductFieldProvenance {
  fieldName: string;
  source: string;
  sourceRecordKey: string | null;
  rawValue: string | null;
  confidence: string | null;
  status: string;
}

export interface ProductSourceConflict {
  fieldName: string;
  reason: string;
  confidence: string | null;
  status: string;
}

export interface ProductFamilyDimensions {
  length: number | null;
  width: number | null;
  height: number | null;
  unit: string | null;
  raw: string | null;
}

export interface ProductPackage {
  id: number | null;
  sourceKey: string;
  packageType: string | null;
  position: number;
  length: number | null;
  width: number | null;
  height: number | null;
  dimensionUnit: string | null;
  piecesPerPackage: number | null;
  weight: number | null;
  weightUnit: string | null;
  raw: string | null;
  variantExternalId: string | null;
  productId: number | null;
  axisMeaningConfirmed: boolean | null;
  sourceType: string | null;
  sourceLocation: string | null;
  operational: boolean | null;
  confidence: string | null;
}

export interface ProductPriceObservation {
  id: number;
  ownerType: string;
  ownerKey: string;
  productId: number | null;
  context: string;
  amount: number | null;
  currency: string | null;
  taxContext: string | null;
  incoterm: string | null;
  market: string | null;
  sourceType: string | null;
  sourceLocation: string | null;
  rawValue: string | null;
  publicPrice: boolean;
  publicRole: string | null;
}

export interface ProductCollection {
  id: number;
  key: string;
  name: string;
  mobileName: string | null;
  eyebrow: string | null;
  description: string | null;
  position: number;
  featuredProductId: number | null;
  primary: boolean;
}

export interface ProductFamilyMember {
  productId: number;
  canonicalVariantKey: string | null;
  sku: string | null;
  name: string;
  colour: string | null;
  colourHex: string | null;
  size: string | null;
  position: number;
  active: boolean;
}

/**
 * Customer-facing model data. Operational stock, purchase and packaging fields
 * remain on Product, while this record is shared by every colour variant.
 */
export interface ProductFamily {
  id: number | null;
  familyKey: string;
  publicHandle: string;
  categoryId: number | null;
  categoryKey: string | null;
  categoryName: string | null;
  categoryPosition: number;
  collectionKey: string | null;
  collections: ProductCollection[];
  productPosition: number;
  /** Variant whose image represents this family on listing cards. */
  cardFeaturedProductId: number | null;
  tags: string[];
  websiteStatus: PublicationStatus;
  orderAppStatus: PublicationStatus;
  /** Reserved now so the later dashboard-to-catalogue sync needs no remodel. */
  catalogueStatus: PublicationStatus;
  active: boolean;
  name: string;
  summary: string | null;
  description: string | null;
  format: string | null;
  highlights: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  dimensions: ProductFamilyDimensions | null;
  texts: ProductFamilyText[];
  packages: ProductPackage[];
  images: ProductFamilyImage[];
  externalIdentifiers: ProductExternalIdentifier[];
  /** Source observations stay read-only until currency and commercial context are confirmed. */
  priceObservations: ProductPriceObservation[];
  provenance: ProductFieldProvenance[];
  conflicts: ProductSourceConflict[];
  publicationIssues: string[];
  /** Read-only projection of the operational products linked to this family. */
  members: ProductFamilyMember[];
  variantCount: number;
}

export interface Category {
  id: number | null;
  /** Optimistic-lock revision returned by the server; null for a new/legacy draft. */
  revision?: number | null;
  code: string;
  name: string;
  /** Optional short label used in the public website's desktop navigation. */
  navigationName?: string | null;
  /** Optional label used for this category in the public website footer. */
  footerName?: string | null;
  /** Short label used where mobile navigation has limited space. */
  mobileName: string | null;
  /** Optional small line shown above the category title on the public website. */
  eyebrow: string | null;
  description: string | null;
  /** Customer-facing category copy; base fields remain the operational fallback. */
  texts: CategoryText[];
  position: number;
  /** Operational SKU used for this collection's promotional visual. */
  featuredProductId: number | null;
}

export interface CategoryText {
  language: LanguageCode;
  name: string | null;
  navigationName?: string | null;
  footerName?: string | null;
  description: string | null;
  eyebrow: string | null;
  mobileName: string | null;
}

export type ContentTranslationScope = 'WEBSITE' | 'CATALOG';

export interface ContentTranslationText {
  language: LanguageCode;
  value: string | null;
}

export interface ContentTranslationGroup {
  scope: ContentTranslationScope;
  key: string;
  label: string;
  required: boolean;
  /** Seeded public contract keys cannot be renamed, reclassified or deleted. */
  system: boolean;
  revision: number;
  texts: ContentTranslationText[];
  missingLanguages: LanguageCode[];
}

export interface ContentTranslationOverview {
  languages: ContentTranslationLanguage[];
  groups: ContentTranslationGroup[];
}

export interface ContentTranslationLanguage {
  language: LanguageCode;
  code: string;
  label: string;
}

export interface ContentTranslationWrite {
  revision: number;
  label: string;
  required: boolean;
  texts: ContentTranslationText[];
}

export interface ContentTranslationCreate {
  scope: ContentTranslationScope;
  key: string;
  label: string;
  required: boolean;
  texts: ContentTranslationText[];
}

export type WebsiteRebuildState =
  | 'NOT_CONFIGURED'
  | 'QUEUED'
  | 'TRIGGERED'
  | 'LIVE'
  | 'FAILED_OR_STALE';

/** Public-safe deploy state. Hook URLs and credentials never leave the backend. */
export interface WebsiteRebuildStatus {
  status: WebsiteRebuildState;
  queuedAt: string | null;
  lastAttemptAt: string | null;
  hookAcceptedAt: string | null;
  liveAt: string | null;
  nextAttemptAt: string | null;
  currentRevision: string | null;
  liveRevision: string | null;
  lastError: string | null;
}

export interface HsCode {
  id: number | null;
  code: string;
  description: string | null;
  dutyRatePct: number;
}

export interface Supplier {
  id: number | null;
  /** Legal/company name used on purchase documents. */
  name: string;
  /** ISO country code. The backend keeps the country name out of the wire shape. */
  country: string;
  /** International postal address; nullable because older suppliers may be incomplete. */
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string;
  region: string | null;
  contact: string;
  email: string;
  phone: string;
  currency: Currency;
  incoterm: string;
  portOfLoading: string;
  leadTimeDays: number;
  notes: string;
}

/** The languages we communicate to a customer in. */
export type LanguageCode = 'NL' | 'FR' | 'EN' | 'DE' | 'ES' | 'PL' | 'PT' | 'TR';

export const LANGUAGES: { code: LanguageCode; label: string }[] = [
  { code: 'NL', label: 'Nederlands' },
  { code: 'FR', label: 'Frans' },
  { code: 'EN', label: 'Engels' },
  { code: 'DE', label: 'Duits' },
  { code: 'ES', label: 'Spaans' },
  { code: 'PL', label: 'Pools' },
  { code: 'PT', label: 'Portugees' },
  { code: 'TR', label: 'Turks' },
];

export interface Customer {
  id: number | null;
  company: string;
  contact: string;
  email: string;
  phone: string;
  vatNumber: string;
  countryCode: string;
  /** Language this customer gets their quote, mail and portal in. */
  language: LanguageCode;
  address: string;
  postalCode: string;
  city: string;
  incoterm: string;
  paymentTerms: string;
  notes: string;
  createdAt?: string;
}

export interface Country {
  code: string;
  name: string;
  minOrderValue: number;
  freightPerPallet: number;
  minFreight: number;
  handling: number;
  vatRatePct: number;
  transitDays: number;
  /** EU member state? Determines the VAT regime. */
  euMember: boolean;
}

export interface DiscountTier {
  id: number | null;
  scope: 'LINE' | 'ORDER';
  minQuantity: number;
  percent: number;
}

/* ------------------------------------------------------------ purchasing */

/** One forwarder quote on a China -> Rotterdam route; feeds the dashboard. */
export interface FreightRate {
  id: number | null;
  route: string;
  quotedOn: string;
  usdPerContainer: number;
}

/** Provenance and cache health for one licensed freight benchmark. */
export interface MarketSourceStatus {
  code: string;
  label: string;
  scope: string;
  metric: 'USD_PER_40FT' | 'INDEX_POINTS';
  referenceKind: 'EXACT_ROUTE' | 'BROAD_REFERENCE';
  sourceName: string;
  sourceUrl: string;
  termsUrl: string;
  automatedAccessAuthorized: boolean;
  state: 'CURRENT' | 'STALE' | 'NO_DATA' | 'FAILED' |
      'CACHE_AFTER_FAILURE' | 'DISABLED' | 'PROVIDER_ACCESS_REQUIRED' |
      'CACHE_AFTER_ACCESS_BLOCK';
  detail: string;
  lastCheckedAt: string | null;
  lastSuccessfulAt: string | null;
  latestPublishedOn: string | null;
  latestValue: number | null;
}

export interface PurchaseOrderLine {
  id: number | null;
  productId: number;
  quantity: number;
  exwPrice: number | null;
  exwCurrency: Currency | null;
  extraUnitCost: number | null;
  /** Quantity as placed with the supplier; null for lines added afterwards. */
  orderedQuantity: number | null;
  /** What the agreed price covers: at the factory gate, or delivered with duty paid. Null = EXW. */
  priceBasis?: 'EXW' | 'DDP' | null;
  /** Pieces that arrived broken; in quantity, never in stock. */
  damagedQuantity?: number | null;
}

/** What arrived of one line, and how much of that was broken. */
export interface ReceivedLine { productId: number; received: number; damaged: number; }

export interface Receipt {
  lines: ReceivedLine[];
  bookStock: boolean;
  paidTotalEur: number | null;
  receivedOn: string | null;
  note: string | null;
}

export type PaymentTerms = 'THIRDS' | 'HALF_HALF' | 'DEPOSIT_30_70' | 'DEPOSIT_30_40_30' | 'FULL_UPFRONT' | 'FULL_ON_ARRIVAL' | 'CUSTOM';

/** One instalment of a payment plan: a share of the goods value and when it falls due. */
export interface Instalment { label: string; share: number; due: 'ORDERED' | 'SHIPPED' | 'ARRIVED'; }

export const PAYMENT_TERMS: { value: PaymentTerms; label: string; instalments: Instalment[] }[] = [
  { value: 'THIRDS', label: '1/3 · 1/3 · 1/3 (bestelling, vertrek, aankomst)', instalments: [
    { label: '1/3 bij bestelling', share: 1 / 3, due: 'ORDERED' },
    { label: '1/3 bij vertrek', share: 1 / 3, due: 'SHIPPED' },
    { label: '1/3 bij aankomst', share: 1 / 3, due: 'ARRIVED' } ] },
  { value: 'HALF_HALF', label: '50% bij bestelling, 50% bij vertrek', instalments: [
    { label: '50% bij bestelling', share: 0.5, due: 'ORDERED' },
    { label: '50% bij vertrek', share: 0.5, due: 'SHIPPED' } ] },
  { value: 'DEPOSIT_30_70', label: '30% bij bestelling, 70% bij vertrek', instalments: [
    { label: '30% bij bestelling', share: 0.3, due: 'ORDERED' },
    { label: '70% bij vertrek', share: 0.7, due: 'SHIPPED' } ] },
  { value: 'DEPOSIT_30_40_30', label: '30% · 40% · 30% (bestelling, vertrek, aankomst)', instalments: [
    { label: '30% bij bestelling', share: 0.3, due: 'ORDERED' },
    { label: '40% bij vertrek', share: 0.4, due: 'SHIPPED' },
    { label: '30% bij aankomst', share: 0.3, due: 'ARRIVED' } ] },
  { value: 'FULL_UPFRONT', label: '100% bij bestelling', instalments: [ { label: '100% bij bestelling', share: 1, due: 'ORDERED' } ] },
  { value: 'FULL_ON_ARRIVAL', label: '100% bij aankomst', instalments: [ { label: '100% bij aankomst', share: 1, due: 'ARRIVED' } ] },
  { value: 'CUSTOM', label: 'Anders (vrij)', instalments: [] },
];

/** Who got the money: the factory, or the forwarder and customs. */
export type Payee = 'SUPPLIER' | 'LOGISTICS';

/** One amount paid on a purchase order, kept as it left the bank. */
export interface PurchasePayment {
  id: number;
  orderId: number;
  paidOn: string;
  amount: number;
  currency: Currency;
  amountEur: number;
  label: string | null;
  actor: string | null;
  recordedAt: string;
  payee?: Payee | null;
}

export type DocumentKind = 'PAYMENT_PROOF' | 'COMMERCIAL_INVOICE' | 'PACKING_LIST' | 'BILL_OF_LADING' | 'CUSTOMS' | 'OTHER';

/** A file that belongs to a container. */
export interface PurchaseDocument {
  id: number;
  kind: DocumentKind;
  kindLabel: string;
  label: string | null;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  paymentId: number | null;
  actor: string | null;
  addedAt: string;
  orderId: number;
}

/** Who is owed what, in euro. */
export interface Payable {
  supplierEur: number;
  logisticsEur: number;
  enrosedEur: number;
  freightInSupplierPrice: boolean;
  ddp: boolean;
}

/** Pieces on the water for one product. */
export interface ExpectedStock {
  productId: number;
  quantity: number;
  expectedArrival: string | null;
  orderNumbers: string[];
  orderIds: number[];
}

export interface PurchaseOrder {
  id: number;
  number: string;
  /** Nickname next to the number, e.g. "voor Frans". */
  alias: string | null;
  supplierId: number;
  orderDate: string;
  status: 'CONCEPT' | 'BESTELD' | 'ONDERWEG' | 'ONTVANGEN';
  containerType: string;
  cnyToUsd: number;
  usdToEurGoods: number;
  usdToEurTransport: number;
  freightUsd: number;
  /** Factory to Chinese port - counts towards the customs value. */
  originCosts: number;
  originCurrency: Currency;
  /** From the port of discharge - outside the customs value. */
  destinationCostsEur: number;
  defaultDutyRatePct: number;
  extraRevenueEur: number;
  allocFreight: Allocation;
  allocOrigin: Allocation;
  allocDestination: Allocation;
  allocExtra: Allocation;
  /** Port where this order leaves; fixed per order instead of following later supplier edits. */
  departurePort: string;
  /** Port of arrival (Rotterdam, Amsterdam, ...); drives the cost labels. */
  destinationPort: string;
  /** Stock location the container is unloaded at; null = the warehouse. */
  receivingLocationId?: number | null;
  /** Variants of one series share out costs as one product; null = on. */
  groupVariants?: boolean | null;
  /** When the container is expected; drives "te verwachten" on the products. */
  expectedArrival?: string | null;
  receivedOn?: string | null;
  /** What was actually paid for the whole order; sometimes differs from the sum. */
  paidTotalEur?: number | null;
  /** Whether the received pieces were booked into stock; null on old orders = yes if received. */
  stockBooked?: boolean | null;
  /** How the supplier is paid; null = thirds. */
  paymentTerms?: PaymentTerms | null;
  /** The day the container sailed. */
  shippedOn?: string | null;
  /** Container / bill-of-lading number or a carrier tracking link. */
  trackingReference?: string | null;
  notes: string;
  lines: PurchaseOrderLine[];
}

export interface LandedCostLine {
  productId: number;
  productName: string;
  quantity: number;
  cartons: number;
  cbm: number;
  goodsUsd: number;
  goodsEur: number;
  originEur: number;
  freightEur: number;
  customsValueEur: number;
  dutyRatePct: number;
  dutySource: string;
  dutyEur: number;
  destinationEur: number;
  extraRevenueEur: number;
  totalEur: number;
  landedUnitEur: number;
  cbmShare: number;
}

export interface LandedCost {
  lines: LandedCostLine[];
  totals: {
    pieces: number; cartons: number; cbm: number;
    goodsUsd: number; goodsEur: number; originEur: number; freightEur: number;
    customsValueEur: number; dutyEur: number; destinationEur: number;
    extraRevenueEur: number; totalEur: number;
    averageUnitEur: number; effectiveDutyPct: number;
  };
  containerFill: {
    containerCode: string; capacityCbm: number; usedCbm: number;
    fillPercent: number; freeCbm: number; overflowCbm: number;
  } | null;
}

/** What the server adjusted to land on full cartons. */
export interface CartonAdjustment {
  productId: number;
  productName: string;
  requested: number;
  adjusted: number;
  piecesPerCarton: number;
}

/** Server-owned wording for every physical cost leg of the purchase route. */
export interface PurchaseCostLabels {
  originCountry: string;
  loadingPort: string;
  destinationPort: string;
  originCostsLabel: string;
  originRoute: string;
  seaFreightLabel: string;
  seaFreightRoute: string;
  destinationCostsLabel: string;
}

export interface PurchaseOrderView {
  order: PurchaseOrder;
  costing: LandedCost;
  adjustments: CartonAdjustment[];
  /** Optional while a cached/older backend response is still in the browser. */
  costLabels?: PurchaseCostLabels;
  payable?: Payable;
  /** What the order waits on from us, in words; empty when nothing. */
  attention?: string[];
}

/* ----------------------------------------------------------------- sales */

export interface SalesOrderLine {
  id: number | null;
  productId: number;
  quantity: number;
  unitPriceEur: number | null;
  manualDiscountPct: number | null;
  /** Zelf ingevulde leverweek, bv. "2026-W34". Optioneel. */
  deliveryWeek: string | null;
}

/** A hand-built pallet: label plus product/carton assignments. */
export interface OrderPallet {
  id: number | null;
  label: string;
  /** Pallet type; "Europallet" unless another was picked. Informational. */
  type: string;
  /** Stacked height in cm; the transporter asks for it on every booking. */
  heightCm: number | null;
  items: { productId: number; cartons: number }[];
}

export interface SalesOrder {
  id: number;
  number: string;
  customerId: number | null;
  countryCode: string | null;
  orderDate: string;
  validUntil: string;
  status: QuoteStatus;
  incoterm: string;
  /** Order-specific payment terms; null means the customer's default. */
  paymentTerms: string | null;
  notes: string;
  markupMode: MarkupMode;
  orderMarkupPct: number;
  /** Loose extra discount, e.g. a fair discount. Optional. */
  extraDiscountPct: number | null;
  extraDiscountLabel: string | null;
  portalToken: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  /** How many times the customer opened the quote. */
  viewCount: number;
  decidedAt: string | null;
  signedByName: string | null;
  customerMessage: string | null;
  /** Notes for ourselves; never on the customer document. */
  internalNotes: string | null;
  /** Delivery-terms state; drives what the customer reads atop their quote. */
  deliveryTerms?: 'VOLLEDIG' | 'TE_BEPALEN' | 'AANGEVULD';
  /** Freight state; TE_BEPALEN lets the amount leave as an open item. */
  freight?: 'BEREKEND' | 'TE_BEPALEN' | 'AANGEVULD';
  /** Own freight amount instead of the country rate; empty means: charge the rate. */
  manualFreightEur: number | null;
  /** Physical load calculation; absent on legacy orders means pallets. */
  loadMode?: LoadMode | null;
  /** Footprint used by the server's pallet fit calculation. */
  palletProfile?: PalletProfile | null;
  /** Order override for total loaded height, including the pallet base. */
  maxPalletHeightCm?: number | null;
  /** Mutually exclusive source of the freight amount. */
  freightPricingStrategy?: FreightPricingStrategy | null;
  /** Used only with PER_CBM; the inactive strategy keeps no shadow value. */
  freightRatePerCbmEur?: number | null;
  lines: SalesOrderLine[];
  /** Hand-built pallet layout; empty means the calculated stacking applies. */
  pallets: OrderPallet[];
}

export interface PricedLine {
  productId: number;
  sku: string;
  description: string;
  photoUrl: string | null;
  quantity: number;
  cartons: number;
  cartonsPerPallet: number;
  /** Server-owned explanation of the pallet fit. Optional for older responses. */
  cartonsPerLayer?: number;
  palletLayers?: number;
  calculatedPalletHeightCm?: number;
  pallets: number;
  cbm: number;
  weightKg: number;
  unitPrice: number;
  gross: number;
  tierPercent: number;
  manualPercent: number;
  discountPct: number;
  discountAmount: number;
  net: number;
  netUnitPrice: number;
  landedUnitCost: number;
  costTotal: number;
  marginEur: number;
  marginPct: number;
  nextTierAtQuantity: number | null;
  nextTierPercent: number | null;
  stockQuantity: number | null;
  inventoryKnown: boolean;
  inStock: boolean;
  shortfall: number | null;
  deliveryDate: string | null;
  deliveryWeek: string | null;
  deliveryExplanation: string | null;
}

export interface PricedOrder {
  lines: PricedLine[];
  totals: {
    pieces: number; cartons: number; palletsStrict: number; palletsOptimised: number;
    /** Hand-built pallets (0 = calculated stacking) and cartons on no pallet. */
    palletsManual: number; unassignedCartons: number;
    /** Effective server settings used for this calculation. */
    palletBaseHeightCm?: number; palletMaxHeightCm?: number;
    cbm: number; weightKg: number;
    gross: number; lineDiscountTotal: number; subtotal: number;
    orderDiscountPercent: number; orderDiscountAmount: number;
    extraDiscountPercent: number; extraDiscountLabel: string | null; extraDiscountAmount: number;
    goodsTotal: number;
    freight: number; freightIsMinimum: boolean; handling: number; shippingTotal: number;
    total: number; vatRatePct: number; vatAmount: number; totalInclVat: number;
    vatTreatment: string; vatLegalMention: string | null; vatReason: string | null;
    costTotal: number; marginEur: number; marginPct: number; marginAfterFreightEur: number;
  };
  validation: {
    minOrderValue: number; meetsMinimum: boolean; shortfall: number;
    hasLines: boolean; countrySelected: boolean; productsWithoutCost: string[];
    productsWithoutCartonDimensions?: string[];
    productsWithoutPalletFit?: string[];
    freightPricingIssue?: string | null;
  };
}

export interface SalesOrderView {
  order: SalesOrder;
  priced: PricedOrder;
}

/**
 * Copy-safe customer portal capability returned by the server.
 *
 * The browser deliberately receives no raw token here and never constructs
 * the public URL itself. A reopened draft can therefore keep its historical
 * token without accidentally making that unsent version shareable.
 */
export interface CustomerPortalLink {
  available: boolean;
  status: 'BESCHIKBAAR' | 'NIET_VERSTUURD' | 'CONCEPT_IN_BEWERKING';
  url: string | null;
}

export interface QuoteRevisionLine {
  id: number | null;
  productId: number;
  quantity: number;
  note: string | null;
}

export interface QuoteRevision {
  id: number;
  salesOrderId: number;
  status: RevisionStatus;
  proposedAt: string;
  proposedBy: string | null;
  message: string | null;
  handledAt: string | null;
  handledBy: string | null;
  responseMessage: string | null;
  lines: QuoteRevisionLine[];
}

/* ---------------------------------------------------------------- portaal */

export interface PortalLine {
  productId: number;
  sku: string;
  description: string;
  photoUrl: string | null;
  quantity: number;
  cartons: number;
  pallets: number;
  cbm?: number;
  /** Carton content, for rounding quantities to full cartons. */
  piecesPerCarton: number;
  unitPrice: number;
  discountPct: number;
  net: number;
  inventoryKnown: boolean;
  inStock: boolean;
  deliveryDate: string | null;
  deliveryWeek: string | null;
}

/** Product the customer can add themselves. */
export interface PortalCatalogItem {
  productId: number;
  sku: string;
  description: string;
  photoUrl: string | null;
  piecesPerCarton: number;
  unitPrice: number;
  /** Available from stock, or do we have to order it first? */
  inventoryKnown: boolean;
  inStock: boolean;
}

/** Our own company details; appear on quotes, invoices and the catalogue. */
export interface CompanyProfile {
  name: string;
  legalName: string;
  vatNumber: string;
  registrationNumber: string;
  addressLine: string;
  postalCode: string;
  city: string;
  countryCode: string;
  email: string;
  phone: string;
  website: string;
  iban: string;
  bic: string;
  documentFooter: string;
  /** English footer; non-Dutch documents use this one, falling back to Dutch. */
  documentFooterEn: string | null;
  /** General terms; editable here, publicly readable at /voorwaarden. */
  termsAndConditions: string | null;
  termsAndConditionsEn: string | null;
  privacyPolicy: string | null;
  privacyPolicyEn: string | null;
}

/** One step in the life of a quote. */
export interface QuoteEvent {
  id: number;
  salesOrderId: number;
  type: string;
  at: string;
  actor: string | null;
  /** Did it come from the customer side? Drives the colour on screen. */
  byCustomer: boolean;
  summary: string;
  detail: string | null;
}

/** What the catalogue Excel import did, problem by problem. */
export interface CatalogImportResult {
  updatedProducts: number;
  updatedRows: number;
  problems: string[];
}

/** Notification for the bell in the top right. */
export interface AppNotification {
  kind: 'LEVERTERMIJN' | 'VRACHT' | 'VOORSTEL' | 'GETEKEND' | 'AFGEWEZEN' | 'BEKEKEN';
  orderId: number | null;
  orderNumber: string;
  customer: string | null;
  title: string;
  detail: string;
  /** Do we need to act, or is this just news? */
  actionNeeded: boolean;
  at: string | null;
}

export interface NotificationFeed {
  items: AppNotification[];
  /** Only what we must act on; that is the number on the bell. */
  actionCount: number;
}

export interface PortalQuote {
  /** True only for the authenticated, read-only staff preview. */
  preview?: boolean;
  number: string;
  status: QuoteStatus;
  orderDate: string;
  validUntil: string;
  incoterm: string;
  notes: string | null;
  companyName: string | null;
  contactName: string | null;
  countryCode: string | null;
  /** Optional while an older portal backend is still serving cached quotes. */
  loadMode?: LoadMode;
  freightPricingStrategy?: FreightPricingStrategy;
  lines: PortalLine[];
  totals: {
    pieces: number; cartons: number; pallets: number; cbm?: number;
    subtotal: number; orderDiscountPercent: number; orderDiscountAmount: number;
    extraDiscountPercent: number; extraDiscountLabel: string | null; extraDiscountAmount: number;
    goodsTotal: number; freight: number; handling: number;
    total: number; vatRatePct: number; vatAmount: number; totalInclVat: number;
    vatTreatment: string; vatLegalMention: string | null;
  };
  canRespond: boolean;
  signedByName: string | null;
  proposals: { status: string; proposedAt: string; message: string | null;
               responseMessage: string | null }[];
  /**
   * Delivery-terms state. AANGEVULD means we filled in the term the
   * customer was missing and sent the quote again.
   */
  deliveryTerms: 'VOLLEDIG' | 'TE_BEPALEN' | 'AANGEVULD';
  /** Freight state; TE_BEPALEN means the amount is still to come. */
  freight: 'BEREKEND' | 'TE_BEPALEN' | 'AANGEVULD';
  /** The customer's language, so the portal opens in it. */
  language: LanguageCode;
  /** The translated texts for this portal, from the server. */
  text: Record<string, string>;
}
