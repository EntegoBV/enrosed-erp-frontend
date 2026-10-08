/*
 * The types of the Jaarinventaris endpoints (/api/stock-counts,
 * /api/stock-opening-layers, /api/stock-closings, /api/stock-valuation-rule),
 * exactly as the backend serves them. Money and unit values are JSON numbers,
 * dates yyyy-MM-dd, instants ISO-8601.
 */

export type CountStatus = 'OPEN' | 'GEBOEKT' | 'GEANNULEERD';
export interface CountSummary { id: number; countYear: number; locationId: number; locationName: string; status: CountStatus;
  correctsCountId: number | null;   // null = full count
  note: string | null; lineCount: number; countedCount: number; differenceCount: number; missingReasonCount: number;
  startedByName: string; startedAt: string; bookedByName: string | null; bookedAt: string | null; }
// lineCount = lines that are counted, or have a live or expected quantity other than 0, or were added by hand
//             (the same set as countProgress.total of 9.6); countedCount = the counted lines among them
export interface CountLocation { locationId: number; locationName: string; kindLabel: string; active: boolean;
  productsWithStock: number; open: CountSummary | null;
  booked: CountSummary | null;      // the latest booked FULL count of the year
  correctionCount: number; }        // booked corrections of that full count
export interface CountOverview { year: number; years: number[];   // distinct count_year of all sessions, newest first
  locations: CountLocation[]; counts: CountSummary[]; }
export interface OpenDocument { kind: 'FACTUUR' | 'CONTAINER'; id: number;
  number: string;                   // FACTUUR: the invoice number; CONTAINER: the display name (the order number only when it has none)
  quantity: number; }
export interface CountLine { id: number; productId: number; sku: string | null; productName: string; categoryName: string | null;
  familyId: number | null; unitKey: string | null; salesUnit: 'PIECE' | 'DISPLAY'; piecesPerUnit: number | null;
  addedByHand: boolean; liveQuantity: number; expectedQuantity: number | null; countedQuantity: number | null;
  difference: number | null; reasonCode: string | null; reasonLabel: string | null; reasonNote: string | null;
  countedByName: string | null; countedAt: string | null; revision: number; moved: boolean; bookedQuantity: number | null;
  openDocuments: OpenDocument[]; documentsConfirmed: boolean; }
export interface CountView extends CountSummary {
  warnings: { unbookedContainers: { purchaseOrderId: number; number: string; displayName: string; receivedOn: string | null }[];
              unshippedInvoices: { salesOrderId: number; number: string; orderDate: string }[];
              olderUnshippedInvoiceCount: number;
              orphanLevels: { productId: number; quantity: number }[] };
  reasons: { code: string; label: string; noteRequired: boolean }[];
  lines: CountLine[]; }
export interface CountLineWrite { countedQuantity: number | null; reasonCode: string | null; reasonNote: string | null; revision: number;
  rebase?: boolean; documentsConfirmed?: boolean; }   // 4.3
export interface BookingCheck {
  uncounted: { productId: number; lineId: number | null; sku: string | null; productName: string; liveQuantity: number }[];
  missingReasons: number[];
  openDocuments: number[];          // line ids, 4.5
  moved: { lineId: number; productId: number; sku: string | null; productName: string; expectedQuantity: number;
           countedQuantity: number; difference: number; liveQuantity: number; resultQuantity: number;
           movements: { at: string; delta: number; kindLabel: string; reference: string | null; actor: string | null }[] }[];
  negative: { lineId: number; productName: string; resultQuantity: number }[];
  summary: { lines: number; equal: number; short: number; shortUnits: number; over: number; overUnits: number };
  checkToken: string; }

export interface OpeningLayer { id: number; productId: number; sku: string | null; productName: string; quantity: number;
  unitValueEur: number; asOfDate: string; source: string; note: string | null; createdByName: string; createdAt: string; }
export interface OpeningLayerWrite { asOfDate: string; source: string;
  rows: { productId: number; quantity: number; unitValueEur: number; note?: string | null }[]; }

export interface ValuationRule { method: 'FIFO_LOT'; methodLabel: string; effectiveFromYear: number; ruleVersion: string; text: string; }
export type ClosingStatus = 'CONCEPT' | 'DEFINITIEF';
export interface ClosingSummary { id: number; closingYear: number; versionNo: number; closingDate: string; status: ClosingStatus;
  superseded: boolean; totalValueEur: number | null; estimatedEur: number | null; blockerCount: number; warningCount: number;
  correctionReason: string | null; finalizedByName: string | null; finalizedAt: string | null; hasFiles: boolean; }
export interface ClosingOverview { rule: ValuationRule | null; closings: ClosingSummary[]; }
export type NoticeSegment = 'tellen' | 'datum' | 'waarde' | 'apart' | 'afsluiten';
export interface Notice { code: string; severity: 'BLOCKER' | 'WARNING'; segment: NoticeSegment; message: string;
  productId?: number; purchaseOrderId?: number; locationId?: number; salesOrderId?: number; movementId?: number;
  payee?: string; amountEur?: number; }
export interface ClosingTotals { costValueEur: number; writeDownEur: number; ownValueEur: number; demoValueEur: number;
  partnerIncludedEur: number; partnerExcludedEur: number; transitIncludedEur: number; transitExcludedEur: number;
  invoicedOutEur: number; totalValueEur: number; estimatedEur: number; ownQuantity: number; unvaluedQuantity: number; }
export interface ClosingLocation { locationId: number; locationName: string; anchor: 'TELLING' | 'BOEKSTAND' | 'GEEN';
  // every field below comes from the closing's own stock_closing_line and stock_closing_movement rows (5.5)
  countId: number | null;           // the count_id of the location's line rows = the base session of 4.7
  anchoredAt: string | null;        // the latest anchored_at among the location's line rows that have a count_line_id
  countedByName: string | null;     // counted_by_name of that same row
  countAfterClosingDate: boolean;   // anchoredAt >= cutoffAt
  correctionCount: number;          // distinct sessions other than countId that own a count_line_id of the location
                                    // (stock_count_line.count_id; lines of a booked session never change)
  lineCount: number;                // line rows with anchor TELLING and a count_line_id
  differenceCount: number;          // those with count_difference other than 0
  movementCount: number;            // listed rows between the two moments, removed rows and the 31 days after not counted
  reviewCount: number; }            // rows with review true and no MOVEMENT decision
export interface ClosingLayer { block: 'EIGEN' | 'GEFACTUREERD'; position: number; source: 'PARTIJ' | 'VORIG' | 'BEGINWAARDE';
  originSource: 'PARTIJ' | 'BEGINWAARDE'; originClosingYear: number | null; purchaseOrderId: number | null;
  orderNumber: string | null; displayName: string | null; receivedOn: string | null; openingSource: string | null;
  salesOrderId: number | null; capacity: number | null; quantity: number; unitValueEur: number;
  unitGoodsEur: number | null; unitTransportEur: number | null; unitLogisticsEur: number | null; unitSeparateEur: number | null;
  unitEstimatedEur: number; valueEur: number; estimatedEur: number; writeDownQuantity: number; writeDownEur: number; }
export interface ClosingArticleLocation { locationId: number; locationName: string; anchor: string; countId: number | null;
  expectedQuantity: number | null; countedQuantity: number | null; countDifference: number | null;
  countReasonCode: string | null; countReasonLabel: string | null; countReasonNote: string | null;
  countedByName: string | null; countedAt: string | null;
  anchoredAt: string | null; countAfterClosingDate: boolean;   // per product: its own anchor of 4.7
  anchorQuantity: number; rollDelta: number;
  closingQuantity: number;          // ALL pieces at the location on the closing date
  ownQuantity: number;              // the part that is own stock (3.5), derived, no column
  costValueEur: number; goodsEur: number; transportEur: number; logisticsEur: number; separateEur: number; openingEur: number;
  estimatedEur: number; writeDownEur: number; ownValueEur: number; }
export interface ClosingArticle { productId: number; sku: string | null; productName: string; categoryName: string | null;
  unitKey: string | null; salesUnit: 'PIECE' | 'DISPLAY'; piecesPerUnit: number | null; demo: boolean; active: boolean;
  countedQuantity: number; rollDelta: number; closingQuantity: number; thirdPartyQuantity: number; partnerQuantity: number;
  invoicedOutQuantity: number; ownQuantity: number; unvaluedQuantity: number; costValueEur: number; goodsEur: number;
  transportEur: number; logisticsEur: number; separateEur: number; openingEur: number; estimatedEur: number;
  averageUnitEur: number | null; writeDownEur: number; ownValueEur: number; previousWriteDownEur: number | null;
  status: 'OK' | 'ZONDER_WAARDE' | 'NEGATIEF'; layers: ClosingLayer[]; locations: ClosingArticleLocation[]; }
export interface ClosingStream { payee: 'SUPPLIER' | 'LOGISTICS' | 'SEPARATE'; payeeLabel: string; status: string;
  plannedEur: number; paidEur: number;
  openEur: number;                  // open Afspraak BEFORE any accrual (2.5)
  includedEur: number; estimatedEur: number;
  // no overpaid field: an overpaid amount is read from the MEER_BETAALD notice (amountEur, payee, purchaseOrderId)
  state: 'WERKELIJK' | 'GESCHAT' | 'BEVESTIGD';
  accrual: { decisionId: number; amountEur: number; invoiceReceived: boolean; reason: string;
             stale: boolean } | null; }   // stale = the decision's basis_amount_eur differs from openEur
export interface ClosingLot { productId: number; sku: string | null; productName: string; orderedQuantity: number;
  receivedQuantity: number; damagedQuantity: number; laterLostQuantity: number; billedQuantity: number;
  goodsDivisor: number; costDivisor: number; capacity: number; unitPriceEur: number;
  goodsKeyEur: number; transportKeyEur: number | null; logisticsKeyEur: number; separateKeyEur: number;   // 2.7
  goodsEur: number;
  priceCreditEur: number; transportEur: number; logisticsEur: number; separateEur: number; lotCostEur: number;
  estimatedEur: number; unitGoodsEur: number; unitTransportEur: number; unitLogisticsEur: number; unitSeparateEur: number;
  unitValueEur: number; unitEstimatedEur: number; calcOriginEur: number; calcFreightEur: number; calcDutyEur: number;
  calcDestinationEur: number; calcDutyRatePct: number | null; previousUnitValueEur: number | null;
  status: 'OK' | 'TEKORT' | 'MEER_ONTVANGEN' | 'GEEN_PRIJS' | 'GEEN_ONTVANGST'; }
export interface ClosingContainer { purchaseOrderId: number; orderNumber: string | null; displayName: string;
  supplierName: string | null; role: 'EIGEN' | 'PARTNER' | 'ONDERWEG' | 'VORIG'; partnerName: string | null;
  orderDate: string | null; shippedOn: string | null; receivedOn: string | null; rateCutoffDate: string | null;
  rateCutoffSource: 'BESLISSING' | 'ONDERWEG' | 'VORIGE_AFSLUITING' | 'ONTVANGST' | 'AFSLUITDATUM';
  rateCutoffSourceLabel: string; ownershipDecisionId: number | null; supplierIncoterm: string | null;
  quantityBasis: 'ONTVANGEN' | 'BESTELD'; billedBasis: 'BESTELD' | 'GELEVERD'; hasShortage: boolean;
  cnyToUsd: number | null; usdToEurGoods: number | null; usdToEurTransport: number | null; cif: boolean;
  groupVariants: boolean; separateInPiecePrice: boolean;
  allocOrigin: string | null; allocFreight: string | null; allocDestination: string | null; allocSeparate: string | null;
  allocationLabel: string;          // the "Verdeelsleutels" text below, built from the six stored fields
  notes: string | null;
  streams: ClosingStream[]; supplierGoodsEur: number; supplierTransportEur: number; otherExcludedEur: number;
  priceCreditEur: number; lossCreditEur: number; exchangeDifferenceEur: number; enrosedCostExcludedEur: number;
  acquisitionEur: number; estimatedEur: number;
  payments: { paymentId: number; paidOn: string; payee: string; payeeLabel: string; label: string | null; amount: number;
              currency: string; storedEur: number | null; countedEur: number; inValue: boolean; rule: string }[];
  credits: { creditId: number; notedOn: string; reasonLabel: string; amount: number; currency: string; countedEur: number;
             treatment: 'VERLAAGT' | 'BUITEN' | 'IN_BETALING' | 'NOG_TE_BESLISSEN'; treatmentLabel: string;
             decisionId: number | null; decisionRequired: boolean; reason: string | null }[];
  missingAndDamagedCostEur: number;
  lots: ClosingLot[]; }
export interface SeparateItem { id: number; kind: 'PARTNER' | 'GEFACTUREERD' | 'DERDEN' | 'ONDERWEG';   // never 'OUDER'
  purchaseOrderId: number | null; salesOrderId: number | null; documentNumber: string | null; documentName: string | null;
  documentDate: string | null; counterparty: string | null; productId: number | null; sku: string | null;
  productName: string | null; proposedQuantity: number | null; quantity: number;
  carvedQuantity: number | null;    // GEFACTUREERD only: the pieces taken out of the own stock; unitValueEur and valueEur cover
                                    // these, not `quantity` (the invoiced pieces). 0 = nothing taken out; null on other kinds
  unitValueEur: number | null;
  valueEur: number | null; estimatedEur: number | null; included: boolean | null; choice: string | null;
  ownershipDate: string | null; shippedOn: string | null; receivedOn: string | null; paidUntilClosingEur: number | null;
  reason: string | null; automatic: boolean; decidedByName: string | null; decidedAt: string | null;
  decisionId: number | null;
  supplierIncoterm: string | null; transportViaSupplier: boolean | null; }   // ONDERWEG rows: from the container row
export interface WriteDownRow { decisionId: number; productId: number; sku: string | null; productName: string;
  layerPosition: number; layerLabel: string; quantity: number; layerUnitEur: number; marketUnitEur: number;
  amountEur: number; reasonCode: string; reasonLabel: string; reason: string; decidedByName: string; decidedAt: string; }
export interface ClosingMovement { movementId: number; productId: number; sku: string | null; productName: string;
  locationId: number; locationName: string; bookedAt: string; kind: string; kindLabel: string; reference: string | null;
  actor: string | null; delta: number; effectiveDelta: number; noAnchor: boolean; businessDate: string | null;
  businessDateSource: string | null; defaultApplied: boolean;
  defaultNote: string | null;       // the server's own sentence, shown as it is (also the two that ask for a look: a row that
                                    // does not join the booking before it, and a row booked at the instant of the count)
  applied: boolean; appliedReason: string | null; review: boolean;
  removed: boolean;                 // no longer in the stock book: stays listed, counts for nothing (applied false); a correction
                                    // version also lists the removed rows of the version it replaces
  decisionId: number | null; }
export type DecisionKind = 'ACCRUAL' | 'SUPPLIER_BILLED' | 'CREDIT_TREATMENT' | 'OWNERSHIP_DATE' | 'TRANSIT' | 'PARTNER_CONTAINER'
  | 'PARTNER_QUANTITY' | 'INVOICED' | 'THIRD_PARTY' | 'WRITE_DOWN' | 'MOVEMENT' | 'VAT_CONFIRMATION';
export interface Decision { id: number; kind: DecisionKind; kindLabel: string; subjectLabel: string;
  purchaseOrderId: number | null; salesOrderId: number | null; productId: number | null; movementId: number | null;
  creditId: number | null;
  payee: string | null; choice: string | null; flag: boolean | null; quantity: number | null; unitValueEur: number | null;
  amountEur: number | null; decisionDate: string | null; reasonCode: string | null; reason: string | null;
  counterparty: string | null; decidedByName: string; decidedAt: string; }
export interface DecisionWrite { id?: number | null; kind: DecisionKind; purchaseOrderId?: number | null; salesOrderId?: number | null;
  salesOrderIds?: number[] | null;   // INVOICED only: one decision per listed invoice, same choice and reason
  productId?: number | null; movementId?: number | null; creditId?: number | null; payee?: string | null; choice?: string | null; flag?: boolean | null;
  quantity?: number | null; unitValueEur?: number | null; amountEur?: number | null; decisionDate?: string | null;
  reasonCode?: string | null; reason?: string | null; counterparty?: string | null; }
export interface VersionChanges { againstClosingId: number; againstVersionNo: number; totalBeforeEur: number; totalAfterEur: number;
  articles: { productId: number; sku: string | null; productName: string; quantityBefore: number | null;
              quantityAfter: number | null; costValueBeforeEur: number | null; costValueAfterEur: number | null;
              writeDownBeforeEur: number | null; writeDownAfterEur: number | null }[];
  lots: { purchaseOrderId: number; displayName: string; productId: number; productName: string;
          unitValueBeforeEur: number | null; unitValueAfterEur: number | null }[];
  movements: { movementId: number; productName: string; locationName: string; reference: string | null;
               effectBefore: number | null; effectAfter: number | null }[];   // null = not listed (or removed)
  openingLayers: { openingLayerId: number; productName: string; source: string | null; quantityBefore: number | null;
                   unitValueBeforeEur: number | null; quantityAfter: number | null; unitValueAfterEur: number | null }[]; }
// a list holds only the entries that differ; "before" = the replaced version, null = absent on that side
export interface OlderInvoice { salesOrderId: number; number: string; orderDate: string; customerName: string | null; quantity: number; }
export interface ClosingView { id: number; closingYear: number; versionNo: number; closingDate: string; cutoffAt: string;
  status: ClosingStatus; superseded: boolean; supersedesId: number | null; supersededById: number | null;
  correctionReason: string | null; previousClosing: { id: number; closingYear: number; closingDate: string; versionNo: number } | null;
  previousClosingReplacedBy: { id: number; versionNo: number } | null;   // read time, 5.1
  versionChanges: VersionChanges | null;                                 // only with supersedesId
  olderInvoices: OlderInvoice[];                                         // 3.4: the stored rows of kind OUDER, by date then number
  rule: ValuationRule; totals: ClosingTotals; notices: Notice[]; locations: ClosingLocation[]; articles: ClosingArticle[];
  containers: ClosingContainer[]; separate: SeparateItem[]; writeDowns: WriteDownRow[]; movements: ClosingMovement[];
  decisions: Decision[]; openingLayers: OpeningLayer[]; writeDownReasons: { code: string; label: string }[];
  computedAt: string; dataSha256: string; finalizedByName: string | null; finalizedAt: string | null;
  signerName: string | null; pdfSha256: string | null; xlsxSha256: string | null;
  versions: ClosingSummary[]; canFinalize: boolean; canCorrect: boolean; }
