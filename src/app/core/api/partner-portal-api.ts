import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';

/**
 * The partner portal (Verhoeven): what a signed-in partner reads and reports.
 *
 * Every call here is `/api/partner-portal/*`, which the server allows for the
 * role `partner` only and scopes to the partner's own customer from the
 * session. The partner app (features/partner) never calls a staff endpoint.
 * Money comes as euros with 2 decimals, unit prices with 4, percents as plain
 * numbers (4.5). Stock and booked quantities are in the product's sales unit;
 * round 2 adds what was typed (a count in a count unit: roos, display,
 * omdoos) and pieces beside them.
 *
 * Round-2 fields are optional in these types: a round-1 server (the deploy
 * window) does not send them, and the screens fall back to the sales units.
 * The round-2 screens only save when the overview answers `apiVersion: 2`.
 */

export type PartnerChannel = 'AUCTION' | 'DIRECT';
export type PartnerReportStatus = 'OPEN' | 'PARTLY_INVOICED' | 'INVOICED' | 'VOIDED';
export type PartnerExtraCostMode = 'AMOUNT' | 'PCT';
/** How a count is typed: one piece (roos, bowl, stuk), the display/verpakking, or the outer carton. */
export type PartnerCountUnitKey = 'STUK' | 'VERPAKKING' | 'OMDOOS';
export type PartnerSalesUnit = 'PIECE' | 'DISPLAY';

/** The server's round of the portal API; the round-2 screens save only against this one. */
export const PARTNER_API_VERSION = 2;

/** A count unit the product offers: "roos/rozen" x 1, "display/displays" x 12, "omdoos/omdozen" x 144 (pieces). */
export interface PartnerCountUnit {
  unit: PartnerCountUnitKey;
  one: string;
  other: string;
  /** Pieces in one of this unit. */
  pieces: number;
}

/** A product as the partner sees it: name, colour and unit; never a price, cost, supplier or container. */
export interface PartnerProductTile {
  productId: number;
  sku: string | null;
  name: string;
  variant: string | null;
  colourHex: string | null;
  familyId: number | null;
  familyName: string | null;
  /** The sales unit: 'stuk' / 'stuks', 'display' / 'displays'. */
  unitOne: string;
  unitOther: string;
  /** Round 1: pieces per sales unit (a display's pieces), null or 1 otherwise. */
  piecesPerUnit: number | null;
  hasPhoto: boolean;
  /** Changes when the photo changes, so it is part of the photo URL (cache key). */
  photoVersion: string | null;
  /* ---- round 2 (additive) */
  salesUnit?: PartnerSalesUnit;
  piecesPerSalesUnit?: number;
  /** The piece noun: roos / rozen, bowl / bowls, stuk / stuks. */
  pieceOne?: string;
  pieceOther?: string;
  /** The offered count units, smallest first (STUK always). */
  countUnits?: PartnerCountUnit[];
  /** Enrosed's default for this partner and product (STUK unless staff set another). */
  defaultUnit?: PartnerCountUnitKey;
  /**
   * The product's category, for grouping like the ERP's Voorraad (left out by servers that do not send it yet: the
   * screens then take it from the containers answer's specs). Never a price.
   */
  categoryId?: number | null;
  categoryName?: string | null;
  /** The category's place in Enrosed's own category order. */
  categoryOrder?: number | null;
}

/** Stock at the partner's location, in sales units (only products with stock). */
export interface PartnerStockTile extends PartnerProductTile {
  quantity: number;
}

/** A product this partner reported sold in the last 60 days, whatever its stock (for Terugkoop). */
export interface PartnerRecentSale extends PartnerProductTile {
  soldQuantity: number;
  lastSoldOn: string;
  /** Per sales unit. */
  lastAverageEur: number | null;
}

export interface PartnerCosts {
  auctionCommissionPct: number;
  auctionTransportPct: number;
}

export interface PartnerContact {
  name: string | null;
  phone: string | null;
}

/** Round 1: the one extra kost of a melding. */
export interface PartnerExtraCost {
  mode: PartnerExtraCostMode;
  value: number;
}

/** Round 2: an extra kost line ("Doosjes € 40", "Veilingfee 1 %"). */
export interface PartnerExtraCostLine {
  description: string | null;
  mode: PartnerExtraCostMode;
  value: number;
}

/** What was typed for a part (round 2); the server falls back to the sales units for round-1 rows. */
export interface PartnerEnteredPart {
  enteredUnit?: PartnerCountUnitKey;
  enteredCount?: number;
  piecePriceEur?: number;
  /** The pieces per entered unit when it was booked (a carton's content may change later). */
  enteredPiecesPerUnit?: number;
  pieces?: number;
}

export interface PartnerReportSale extends PartnerEnteredPart {
  /** Sales units. */
  quantity: number;
  unitPriceEur: number;
  grossEur: number;
  commissionEur: number;
  transportEur: number;
  extraCostEur: number;
  netEur: number;
}

export interface PartnerReportBuyback extends PartnerEnteredPart {
  quantity: number;
  unitPriceEur: number;
  /** The clock price total. */
  grossEur: number;
  /* round 2: a buyback carries the melding's commission and transport too */
  commissionEur?: number;
  transportEur?: number;
  /** Terugkoopkost = gross + commission + transport (= -net). */
  costEur?: number;
  netEur?: number;
}

/** One product of a melding: its sale and/or (auction only) its buyback on the clock. */
export interface PartnerReportEntry {
  productId: number;
  name: string;
  variant: string | null;
  colourHex: string | null;
  unitOne: string;
  unitOther: string;
  hasPhoto: boolean;
  photoVersion: string | null;
  sale: PartnerReportSale | null;
  buyback: PartnerReportBuyback | null;
  /* ---- round 2: the full tile, so an edit rebuilds the form without the stock list */
  sku?: string | null;
  familyId?: number | null;
  familyName?: string | null;
  piecesPerUnit?: number | null;
  salesUnit?: PartnerSalesUnit;
  piecesPerSalesUnit?: number;
  pieceOne?: string;
  pieceOther?: string;
  countUnits?: PartnerCountUnit[];
  defaultUnit?: PartnerCountUnitKey;
}

export interface PartnerReportTotals {
  /** Sales units. */
  saleQuantity: number;
  buybackQuantity: number;
  grossEur: number;
  commissionEur: number;
  transportEur: number;
  extraCostEur: number;
  saleNetEur: number;
  /** Terugkoopkost: round 2 the buyback's cost incl. commission and transport, round 1 its gross. */
  buybackEur: number;
  /** Sale net minus terugkoopkost; negative for a melding with only buybacks. */
  netEur: number;
  /* round 2 */
  salePieces?: number;
  buybackPieces?: number;
  buybackGrossEur?: number;
}

/** The buyer of a direct sale: name and city only. */
export interface PartnerBuyerRef {
  customerId: number;
  company: string;
  city: string | null;
}

/** A melding (VV-<id>), its parts merged back per product. */
export interface PartnerReport {
  id: number;
  number: string;
  channel: PartnerChannel;
  soldOn: string;
  createdAt: string;
  createdByName: string | null;
  commissionPct: number;
  transportPct: number;
  /** Round 1's one extra kost; round 2 fills it from a single line, or as the sum (AMOUNT) of several. */
  extraCost: PartnerExtraCost | null;
  entries: PartnerReportEntry[];
  totals: PartnerReportTotals;
  status: PartnerReportStatus;
  /** Round 2: open, not mirrored by a later buyback and (for the partner) not yet confirmed by Enrosed. */
  canUndo: boolean;
  /* ---- round 2 (additive) */
  /** The version the client loaded; a PUT sends it back as expectedToken. */
  editToken?: string;
  updatedAt?: string | null;
  updatedByName?: string | null;
  note?: string | null;
  extraCosts?: PartnerExtraCostLine[];
  buyer?: PartnerBuyerRef | null;
  /** Enrosed confirmed it (or a document holds part of it): Frans cannot change it any more. */
  confirmed?: boolean;
  confirmedAt?: string | null;
  confirmedByName?: string | null;
  canEdit?: boolean;
}

export interface PartnerOverview {
  partner: { customerId: number; name: string; displayName: string | null };
  costs: PartnerCosts;
  contact: PartnerContact | null;
  stock: PartnerStockTile[];
  recentSales: PartnerRecentSale[];
  /** Newest first, at most 10. */
  reports: PartnerReport[];
  /** Today in Europe/Brussels (yyyy-mm-dd): the date row's "Vandaag" and its 90-day limit. */
  serverDate: string;
  /** 2 from round 2 on; absent on a round-1 server. */
  apiVersion?: number;
}

export interface PartnerReportPage {
  reports: PartnerReport[];
  more: boolean;
}

/** Round 1: quantity in sales units and exactly one of unitPriceEur / totalEur (older clients). */
export interface PartnerReportPartRequestV1 {
  quantity: number;
  unitPriceEur?: number;
  totalEur?: number;
}

/** Round 2: what was typed; the server computes the sales units (refuses a count that is not whole). */
export interface PartnerReportPartRequestV2 {
  enteredUnit: PartnerCountUnitKey;
  enteredCount: number;
  /** Per piece (per roos), 4 decimals. */
  piecePriceEur: number;
}

export type PartnerReportPartRequest = PartnerReportPartRequestV1 | PartnerReportPartRequestV2;

export interface PartnerReportEntryRequest {
  productId: number;
  sale?: PartnerReportPartRequest;
  buyback?: PartnerReportPartRequest;
}

/**
 * The body of a new melding (POST) and of an edit (PUT, + expectedToken); staff send the same body plus
 * customerId to /api/partner-sales/reports.
 */
export interface PartnerReportRequest {
  channel: PartnerChannel;
  soldOn?: string | null;
  /** One per melding, kept for its retries: the same ref again answers the melding already booked. */
  clientRef: string;
  note?: string | null;
  /** Round 1 only; absent when extraCosts is sent. */
  extraCost?: PartnerExtraCost | null;
  entries: PartnerReportEntryRequest[];
  /* ---- round 2 */
  apiVersion?: number;
  /** 0..5 lines; [] = none. */
  extraCosts?: PartnerExtraCostLine[];
  /** Direct only; required for a partner's direct sale. */
  buyerCustomerId?: number | null;
  /** PUT only: the editToken of the version that was loaded (409 when it changed meanwhile). */
  expectedToken?: string;
}

/** A created or saved melding; `existing` when the server already had this clientRef (200 instead of 201). */
export interface PartnerReportResult {
  report: PartnerReport;
  existing: boolean;
}

/** An ERP customer the partner may pick as the buyer of a direct sale: name, city and country, nothing else. */
export interface PartnerBuyer {
  customerId: number;
  company: string;
  city: string | null;
  countryCode: string | null;
  /** This partner added it from the portal (staff still complete it). */
  addedByYou: boolean;
}

/** A new buyer with the fewest fields; staff complete the rest in the ERP. */
export interface PartnerBuyerRequest {
  company: string;
  countryCode?: string | null;
  city?: string | null;
  email?: string | null;
  phone?: string | null;
}

/* ---- containers (round 2): every container of Enrosed's, logistics only, never a price, amount or supplier */

/** The order's own status (a concept never comes). */
export type PartnerContainerStatus = 'BESTELD' | 'ONDERWEG' | 'ONTVANGEN';
/** The partner's word: Besteld, Onderweg, Binnenkort (departed, due within 14 days), Aangekomen. */
export type PartnerContainerState = 'BESTELD' | 'ONDERWEG' | 'BINNENKORT' | 'AANGEKOMEN';

/** B x D x H in cm. */
export interface PartnerSize {
  b: number | null;
  d: number | null;
  h: number | null;
}

/** The pallet the ± pallets are counted on (Enrosed's europallet and its loaded height). */
export interface PartnerPallet {
  widthCm: number;
  depthCm: number;
  maxHeightCm: number;
}

/** One product on a container: sales units, pieces, cartons, m³, pallets (each product on its own), weight. */
export interface PartnerContainerLine {
  productId: number;
  /** Sales units: what is ordered now, or (received) what went on the shelf. */
  quantity: number;
  /** Received only, when it differs from what arrived. */
  orderedQuantity: number | null;
  pieces: number;
  cartons: number;
  cbm: number;
  pallets: number | null;
  weightKg: number | null;
}

export interface PartnerContainerTotals {
  products: number;
  units: number;
  pieces: number;
  cartons: number;
  cbm: number;
  /** Null for groupage (LCL). */
  capacityCbm: number | null;
  fillPercent: number | null;
  /** Null when no line has a fit; palletsUnknown lines are not in it. */
  pallets: number | null;
  palletsUnknown: number;
  weightKg: number | null;
  weightUnknown: boolean;
  cbmUnknown?: boolean;
}

/** A container: its PO number, whether it is his own (shared with him), dates, ports and cargo. */
export interface PartnerContainer {
  id: number;
  number: string | null;
  /** The PO number ("PO-2026-010"); never Enrosed's own nickname. */
  name: string;
  /** His own container (Samen met jou). */
  own: boolean;
  status: PartnerContainerStatus;
  /** The server's word; a server without it is read with the same rule (partner-containers-model). */
  state?: PartnerContainerState;
  containerType: string;
  containerLabel: string | null;
  orderDate: string | null;
  shippedOn: string | null;
  expectedArrival: string | null;
  /** The expected date while it can still hold. */
  due?: string | null;
  receivedOn: string | null;
  /** Tracking moved the arrival from this date (not received yet). */
  arrivalMovedFrom: string | null;
  stockBooked: boolean;
  /** Received (or put away) more than 60 days ago: shown behind "Ook oude containers". */
  old?: boolean;
  departurePort: string | null;
  destinationPort: string | null;
  /** Only for his own container or the main warehouse. */
  locationName: string | null;
  totals: PartnerContainerTotals;
  lines: PartnerContainerLine[];
}

/** A product as the container screen shows it: the tile plus the product card's sizes and packaging. */
export interface PartnerProductSpec extends PartnerProductTile {
  categoryId: number | null;
  categoryName: string | null;
  colour: string | null;
  variantSize: string | null;
  productCm: PartnerSize | null;
  productWeightKg: number | null;
  packagingKind: string | null;
  packagingCm: PartnerSize | null;
  /** Sales units per omdoos. */
  unitsPerCarton: number | null;
  cartonCm: PartnerSize | null;
  cartonWeightKg: number | null;
  cartonsPerPallet: number | null;
}

export interface PartnerContainerPage {
  /** Today in Europe/Brussels (yyyy-mm-dd). */
  serverDate: string;
  pallet: PartnerPallet | null;
  /** Open ones by arrival, then received ones newest first. */
  containers: PartnerContainer[];
  /** Once per product on the listed lines. */
  products: PartnerProductSpec[];
}

export const PARTNER_REPORT_PAGE_SIZE = 50;

/** The partner-scoped photo of a product (small for tiles), versioned so a changed photo is fetched anew. */
export function partnerPhotoUrl(productId: number, photoVersion: string | null | undefined,
    size: 'small' | 'medium' = 'small'): string {
  const version = photoVersion ? `&v=${encodeURIComponent(photoVersion)}` : '';
  return `/api/partner-portal/products/${productId}/photo?size=${size}${version}`;
}

@Injectable({ providedIn: 'root' })
export class PartnerPortalApi {
  private readonly http = inject(HttpClient);

  overview(): Promise<PartnerOverview> {
    return firstValueFrom(this.http.get<PartnerOverview>(api('/api/partner-portal/overview')));
  }

  /** Meldingen newest first; `before` is an id: the page holds older ids only. */
  reports(before: number | null = null, limit = PARTNER_REPORT_PAGE_SIZE): Promise<PartnerReportPage> {
    const params: Record<string, string> = { limit: String(limit) };
    if (before != null) params['before'] = String(before);
    return firstValueFrom(this.http.get<PartnerReportPage>(api('/api/partner-portal/reports'), { params }));
  }

  /** One of the partner's own meldingen (an edit loads it); 404 for anything else. */
  report(id: number): Promise<PartnerReport> {
    return firstValueFrom(this.http.get<PartnerReport>(api(`/api/partner-portal/reports/${id}`)));
  }

  async createReport(body: PartnerReportRequest): Promise<PartnerReportResult> {
    const response = await firstValueFrom(this.http.post<PartnerReport>(
      api('/api/partner-portal/reports'), body, { observe: 'response' }));
    if (!response.body) throw { status: response.status, error: null };
    return { report: response.body, existing: response.status === 200 };
  }

  /** Bewerken: the whole melding again, with the editToken it was loaded with (409 when it changed meanwhile). */
  async updateReport(id: number, body: PartnerReportRequest): Promise<PartnerReportResult> {
    const report = await firstValueFrom(this.http.put<PartnerReport>(api(`/api/partner-portal/reports/${id}`), body));
    return { report, existing: false };
  }

  /** Ongedaan maken: voids the partner's own melding while nothing of it is invoiced or confirmed. */
  voidReport(id: number): Promise<PartnerReport> {
    return firstValueFrom(this.http.delete<PartnerReport>(api(`/api/partner-portal/reports/${id}`)));
  }

  /** ERP customers by name or city (2 letters or more); an empty query answers his last buyers. */
  customers(query: string): Promise<PartnerBuyer[]> {
    return firstValueFrom(this.http.get<PartnerBuyer[]>(api('/api/partner-portal/customers'), { params: { q: query } }));
  }

  /** A new buyer (or the one he already added under that name). */
  createCustomer(body: PartnerBuyerRequest): Promise<PartnerBuyer> {
    return firstValueFrom(this.http.post<PartnerBuyer>(api('/api/partner-portal/customers'), body));
  }

  /** Every container of Enrosed's (no concepts), with its products' specifications; no price, amount or supplier. */
  containers(): Promise<PartnerContainerPage> {
    return firstValueFrom(this.http.get<PartnerContainerPage>(api('/api/partner-portal/containers')));
  }

  /** Ends this device's partner session on the server; the caller then signs out locally. */
  logout(): Promise<void> {
    return firstValueFrom(this.http.post<void>(api('/api/partner-portal/logout'), null));
  }
}
