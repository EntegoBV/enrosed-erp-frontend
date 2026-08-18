/**
 * De vormen die over de lijn gaan.
 *
 * Ze volgen de DTO's van de backend; wat daar berekend wordt, wordt hier niet
 * nog eens overgedaan. De frontend toont, de server rekent.
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
  /** Afmeting van het product zelf - los van de variant en van de omdoos. */
  dimensions: Dimensions;
  /** Kleur van het artikel; eerste van wat later productopties kan worden. */
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
  /** Voorraad in stuks; groeit bij een ontvangen inkooporder. */
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

/** De talen waarin wij naar een klant communiceren. */
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
  /** Taal waarin deze klant zijn offerte, mail en klantportaal krijgt. */
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
  /** Lidstaat van de EU? Bepaalt het BTW-regime. */
  euMember: boolean;
}

export interface DiscountTier {
  id: number | null;
  scope: 'LINE' | 'ORDER';
  minQuantity: number;
  percent: number;
}

/* ---------------------------------------------------------------- inkoop */

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
  /** Fabriek tot Chinese haven - telt mee in de douanewaarde. */
  originCosts: number;
  originCurrency: Currency;
  /** Vanaf de loshaven - valt buiten de douanewaarde. */
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

/** Wat de server bijstelde om op volle dozen uit te komen. */
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

/* --------------------------------------------------------------- verkoop */

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
  /** Losse extra korting, bv. een beurskorting. Optioneel. */
  extraDiscountPct: number | null;
  extraDiscountLabel: string | null;
  portalToken: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  /** Hoe vaak de klant de offerte geopend heeft. */
  viewCount: number;
  decidedAt: string | null;
  signedByName: string | null;
  customerMessage: string | null;
  /** Notities voor onszelf; komen nooit op het klantdocument. */
  internalNotes: string | null;
  /** Stand van de levertermijnen; stuurt wat de klant bovenaan zijn offerte leest. */
  deliveryTerms?: 'VOLLEDIG' | 'TE_BEPALEN' | 'AANGEVULD';
  /** Stand van de vracht; TE_BEPALEN laat het bedrag als open post vertrekken. */
  freight?: 'BEREKEND' | 'TE_BEPALEN' | 'AANGEVULD';
  /** Eigen vrachtbedrag in plaats van het landtarief; leeg betekent: reken het tarief. */
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
  /** Doosinhoud, om aantallen op volle dozen af te ronden. */
  piecesPerCarton: number;
  unitPrice: number;
  discountPct: number;
  net: number;
  inStock: boolean;
  deliveryDate: string | null;
  deliveryWeek: string | null;
}

/** Product dat de klant zelf kan bijbestellen. */
export interface PortalCatalogItem {
  productId: number;
  sku: string;
  description: string;
  photoUrl: string | null;
  piecesPerCarton: number;
  unitPrice: number;
  /** Leverbaar uit voorraad, of moeten we het eerst bestellen? */
  inStock: boolean;
}

/** Onze eigen bedrijfsgegevens; komen op offertes, facturen en de catalogus. */
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

/** Eén stap in het leven van een offerte. */
export interface QuoteEvent {
  id: number;
  salesOrderId: number;
  type: string;
  at: string;
  actor: string | null;
  /** Kwam het van de klantkant? Bepaalt de kleur in het scherm. */
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

/** Melding voor het belletje rechtsboven. */
export interface AppNotification {
  kind: 'LEVERTERMIJN' | 'VRACHT' | 'VOORSTEL' | 'GETEKEND' | 'AFGEWEZEN' | 'BEKEKEN';
  orderId: number | null;
  orderNumber: string;
  customer: string | null;
  title: string;
  detail: string;
  /** Moeten wij iets doen, of is dit alleen nieuws? */
  actionNeeded: boolean;
  at: string | null;
}

export interface NotificationFeed {
  items: AppNotification[];
  /** Alleen wat wij moeten doen; dat is het cijfer op het belletje. */
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
   * Stand van de levertermijnen. AANGEVULD betekent dat wij de termijn die de
   * klant miste hebben ingevuld en de offerte opnieuw verstuurd hebben.
   */
  deliveryTerms: 'VOLLEDIG' | 'TE_BEPALEN' | 'AANGEVULD';
  /** Stand van de vracht; TE_BEPALEN betekent dat het bedrag nog moet komen. */
  freight: 'BEREKEND' | 'TE_BEPALEN' | 'AANGEVULD';
  /** Taal van de klant, zodat het portaal in zijn taal opent. */
  language: LanguageCode;
  /** De vertaalde teksten voor dit portaal, van de server. */
  text: Record<string, string>;
}
