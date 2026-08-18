/**
 * The shapes that go over the wire.
 *
 * They follow the backend's DTOs; what is calculated there is not redone
 * here. The frontend shows, the server calculates.
 */

export type Currency = 'EUR' | 'USD' | 'CNY';
export type MarkupMode = 'PRODUCT' | 'ORDER';
export type Allocation = 'CBM' | 'VALUE' | 'PIECES';

export type QuoteStatus =
  | 'CONCEPT' | 'VERZONDEN' | 'BEKEKEN' | 'WIJZIGING_GEVRAAGD'
  | 'GEACCEPTEERD' | 'AFGEWEZEN' | 'VERLOPEN';

export type RevisionStatus = 'IN_AFWACHTING' | 'GOEDGEKEURD' | 'AFGEWEZEN';

export interface Dimensions {
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
}

export interface CartonDto {
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  piecesPerCarton: number | null;
  weightKg: number | null;
}

export interface PhotoDto {
  id: number;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  widthPx: number | null;
  heightPx: number | null;
  position: number;
  url: string;
  downloadUrl: string;
}

export interface Product {
  id: number | null;
  sku: string | null;
  name: string;
  /** Dimensions of the product itself - apart from variant and outer carton. */
  dimensions: Dimensions;
  /** Colour of the article; first of what may become product options. */
  colour: string | null;
  categoryId: number | null;
  supplierId: number | null;
  active: boolean;
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
  /** Stock in pieces; grows when a purchase order is received. */
  stockQuantity: number;
  photos: PhotoDto[];
  describedAs?: string;
  cartonCbm?: number;
  pieceCbm?: number;
}

export interface Category {
  id: number | null;
  code: string;
  name: string;
  description: string | null;
  position: number;
}

export interface HsCode {
  id: number | null;
  code: string;
  description: string | null;
  dutyRatePct: number;
}

export interface Supplier {
  id: number | null;
  name: string;
  country: string;
  city: string;
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

export interface PurchaseOrderLine {
  id: number | null;
  productId: number;
  quantity: number;
  exwPrice: number | null;
  exwCurrency: Currency | null;
  extraUnitCost: number | null;
  /** Quantity as placed with the supplier; null for lines added afterwards. */
  orderedQuantity: number | null;
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
  /** Port of arrival (Rotterdam, Amsterdam, ...); drives the cost labels. */
  destinationPort: string;
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

export interface PurchaseOrderView {
  order: PurchaseOrder;
  costing: LandedCost;
  adjustments: CartonAdjustment[];
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
  lines: SalesOrderLine[];
}

export interface PricedLine {
  productId: number;
  sku: string;
  description: string;
  photoUrl: string | null;
  quantity: number;
  cartons: number;
  cartonsPerPallet: number;
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
  stockQuantity: number;
  inStock: boolean;
  shortfall: number;
  deliveryDate: string | null;
  deliveryWeek: string | null;
  deliveryExplanation: string | null;
}

export interface PricedOrder {
  lines: PricedLine[];
  totals: {
    pieces: number; cartons: number; palletsStrict: number; palletsOptimised: number;
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
  };
}

export interface SalesOrderView {
  order: SalesOrder;
  priced: PricedOrder;
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
  /** Carton content, for rounding quantities to full cartons. */
  piecesPerCarton: number;
  unitPrice: number;
  discountPct: number;
  net: number;
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

/** What a CSV import did, problem by problem. */
export interface CsvImportResult {
  updatedProducts: number;
  /** Only the translation import reports this; absent on the bulk import. */
  updatedRows?: number;
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
  number: string;
  status: QuoteStatus;
  orderDate: string;
  validUntil: string;
  incoterm: string;
  notes: string | null;
  companyName: string | null;
  contactName: string | null;
  countryCode: string | null;
  lines: PortalLine[];
  totals: {
    pieces: number; cartons: number; pallets: number;
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
