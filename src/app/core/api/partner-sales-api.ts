import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import type { PartnerChannel, PartnerReport, PartnerReportRequest } from './partner-portal-api';

/**
 * The staff side of the partner portal (Verhoeven), every call admin only:
 * Instellingen › Partnerportaal (`/api/partner-portal-admin`) and the
 * Veilingverkopen page with its invoicing (`/api/partner-sales`).
 *
 * A melding is a PartnerReport; staff see it with its parts (one per source:
 * a partner container or our own stock) and who entered it. Money comes as
 * euros with 2 decimals, percents as plain numbers (4.5), quantities in the
 * product's sales unit. An older backend answers 404 on every call here: the
 * work queue then keeps the summary null and the screens say so calmly.
 */

/* ------------------------------------------------------------- settings */

export interface PartnerPortalLogin {
  id: number;
  username: string;
  displayName: string;
  active: boolean;
  passwordSetAt: string | null;
  lastLoginAt: string | null;
}

/** Stored values (null = the default applies) beside the defaults; locationName is the location that applies. */
export interface PartnerPortalSettingsView {
  auctionCommissionPct: number | null;
  auctionTransportPct: number | null;
  locationId: number | null;
  locationName: string | null;
  defaultAuctionCommissionPct: number;
  defaultAuctionTransportPct: number;
}

export interface PartnerUnshippedSettlement {
  id: number;
  number: string | null;
}

/** One partner customer (or a customer that still has a login: partner false = "geen partner meer"). */
export interface PartnerPortalAdminRow {
  customerId: number;
  customerName: string;
  partner: boolean;
  login: PartnerPortalLogin | null;
  settings: PartnerPortalSettingsView;
  /** Issued settlements whose pieces still lie in stock although sold: ship them before the portal starts. */
  unshippedSettlements: PartnerUnshippedSettlement[];
}

/** password null keeps the current one; a first login needs one. */
export interface PartnerPortalLoginRequest {
  username: string;
  displayName: string;
  password: string | null;
  active: boolean;
}

export interface PartnerPortalSettingsRequest {
  auctionCommissionPct: number | null;
  auctionTransportPct: number | null;
  locationId: number | null;
}

/* --------------------------------------------------------- veilingverkopen */

export type PartnerSalesStatusFilter = 'OPEN' | 'INVOICED' | 'ALL';
/**
 * Round 2 list filter (`state`): VOIDED > INVOICED > CONFIRMED > UNCONFIRMED per melding; CONFIRMED = confirmed,
 * not voided, at least one open part; OPEN = not fully invoiced and not voided.
 */
export type PartnerSalesState = 'UNCONFIRMED' | 'CONFIRMED' | 'INVOICED' | 'VOIDED' | 'OPEN' | 'ALL';
export type PartnerPartType = 'SALE' | 'BUYBACK';

/** One part of a melding: what one source (container or own stock) took of one product. */
export interface PartnerReportPart {
  id: number;
  entryNo: number;
  lineType: PartnerPartType;
  productId: number;
  name: string;
  variant: string | null;
  purchaseOrderId: number | null;
  /** null = "Eigen voorraad". */
  containerName: string | null;
  quantity: number;
  grossEur: number;
  netEur: number;
  unitCostEur: number | null;
  invoiceId: number | null;
  invoiceNumber: string | null;
  open: boolean;
  /* round 2 (additive): this part's share of the costs, and its pieces */
  commissionEur?: number;
  transportEur?: number;
  extraCostEur?: number;
  pieces?: number;
}

/**
 * A melding as staff see it: the partner's view plus who, the void and the parts. Round 2: canEdit / canUndo are
 * the staff rule (open and not mirrored by a later buyback; also once confirmed).
 */
export interface StaffPartnerReport extends PartnerReport {
  customerId: number;
  customerName: string;
  createdBy: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  note?: string | null;
  parts: PartnerReportPart[];
  /** An old version of an edited melding (never listed; readable by id). */
  revisionOf?: number | null;
}

export interface PartnerSalesOpenTotals {
  openReports: number;
  openSaleQuantity: number;
  openNetEur: number;
}

/** Round 2: the sums of the whole filtered list (voided meldingen left out); "Stuks" in pieces. */
export interface PartnerSalesFilteredTotals {
  reports: number;
  salePieces: number;
  grossEur: number;
  /** Veilingcommissie + transport + extra kost of the sales. */
  costsEur: number;
  /** Terugkoopkost (incl. its commission and transport). */
  buybackEur: number;
  netEur: number;
}

export interface StaffPartnerReportPage {
  reports: StaffPartnerReport[];
  more: boolean;
  totals: PartnerSalesOpenTotals;
  /** Round 2; absent from an older backend (the page then sums what it got). */
  filteredTotals?: PartnerSalesFilteredTotals | null;
  apiVersion?: number | null;
}

/** The round-2 list: filters by state, channel, sold_on period, partner and buyer; newest sold_on first. */
export interface PartnerSalesListQuery {
  customerId?: number | null;
  state?: PartnerSalesState;
  channel?: PartnerChannel | null;
  /** yyyy-mm-dd, both inclusive, by sold_on. */
  from?: string | null;
  to?: string | null;
  buyerCustomerId?: number | null;
  /** At most 1000 (the server's cap; `more` says when there was more). */
  limit?: number;
}

/** Bevestigen / Terugzetten: each melding with the editToken the screen showed (a changed one is refused). */
export interface PartnerReportTokenRef {
  id: number;
  token: string;
}

export interface PartnerReportsConfirmed {
  reports: StaffPartnerReport[];
}

export interface PartnerSalesPartnerSummary extends PartnerSalesOpenTotals {
  customerId: number;
  customerName: string;
  lastReportAt: string | null;
}

/**
 * Round 2 (Bevestigen): what waits on staff to confirm, and what Factureren can take now (confirmed and still open).
 * Absent on a round-1 backend: then everything open counts as before.
 */
export interface PartnerSalesConfirmTotals {
  unconfirmedReports?: number | null;
  confirmedOpenReports?: number | null;
  confirmedOpenSaleQuantity?: number | null;
  confirmedOpenNetEur?: number | null;
}

/** The cheap count behind the nav, the bell and the home card. */
export interface PartnerSalesSummary extends PartnerSalesOpenTotals, PartnerSalesConfirmTotals {
  lastReportAt: string | null;
  recentReports14d: number;
  partners: (PartnerSalesPartnerSummary & PartnerSalesConfirmTotals)[];
  /** 2 from a round-2 backend; a round-2 screen refuses to save round-2 shapes without it. */
  apiVersion?: number | null;
}

export interface PartnerSalesAnalyticsReport {
  id: number;
  number: string;
  customerId: number;
  channel: PartnerChannel;
  soldOn: string;
  open: boolean;
  saleQuantity: number;
  buybackQuantity: number;
  grossEur: number;
  costsEur: number;
  buybackEur: number;
  netEur: number;
  /** The part not invoiced yet (open parts only); absent from an older backend. */
  openSaleQuantity?: number | null;
  openNetEur?: number | null;
}

/** One row per melding x product: per-product averages are derived, never summed across products. */
export interface PartnerSalesAnalyticsProduct {
  /** The melding of this row (a drill lists meldingen). */
  reportId: number;
  productId: number;
  name: string;
  variant: string | null;
  soldOn: string;
  channel: PartnerChannel;
  open: boolean;
  saleQuantity: number;
  buybackQuantity: number;
  grossEur: number;
  netEur: number;
  /** The part not invoiced yet (open parts only); absent from an older backend. */
  openSaleQuantity?: number | null;
  openNetEur?: number | null;
}

export interface PartnerSalesAnalytics {
  reports: PartnerSalesAnalyticsReport[];
  products: PartnerSalesAnalyticsProduct[];
}

/* -------------------------------------------------------------- factureren */

export type PartnerInvoiceSource = 'CONTAINER' | 'OWN';

export interface PartnerInvoicePreviewLine {
  productId: number;
  name: string;
  variant: string | null;
  soldQuantity: number;
  buybackQuantity: number;
  /** soldQuantity - buybackQuantity: what the invoice line counts. */
  quantity: number;
  saleNetEur: number;
  /** Terugkoopkost (round 2: incl. its commission and transport). */
  buybackEur: number;
  proceedsEur: number;
  /** null on a blocked group: the settlement was not computed. */
  costEur: number | null;
  valueEur: number | null;
  /* round 2 (additive, ERP only) */
  buybackGrossEur?: number;
  salePieces?: number;
  grossEur?: number;
  commissionEur?: number;
  transportEur?: number;
  extraEur?: number;
  buybackCostEur?: number;
  /** Proceeds moved onto this line from a product sold and bought back (q = 0); negative when moved off it. */
  absorbedEur?: number | null;
}

export interface PartnerInvoicePreviewGroup {
  source: PartnerInvoiceSource;
  purchaseOrderId: number | null;
  containerName: string | null;
  lines: PartnerInvoicePreviewLine[];
  /** Ons deel, the advance it nets and what is left to invoice; null on a blocked group (nothing was computed). */
  valueEur: number | null;
  advanceEur: number | null;
  balanceEur: number | null;
  finalSettlement: boolean;
  /** The profit share this group was computed with (a container's own, the customer's for own stock), when the server says it. */
  profitSharePct?: number | null;
  /** Why creating this group would be refused; null when it can be made. */
  blocked: string | null;
  warnings: string[];
  /*
   * Round 2 (additive, ERP only; the invoice's own figures, never recomputed here):
   * proceeds (netto opbrengst) − cost (inkoopkost, external) = profit; enrosedProfit = value − cost,
   * partnerProfit = proceeds − value; value − advance = balance; correction = a slotfactuur's true-up.
   */
  /** The partner's financed part of the cost, in percent (own stock 0). */
  costSharePct?: number | null;
  proceedsEur?: number | null;
  costEur?: number | null;
  profitEur?: number | null;
  enrosedProfitEur?: number | null;
  partnerProfitEur?: number | null;
  correctionEur?: number | null;
}

export interface PartnerInvoiceSkipped {
  productId: number;
  name: string;
  source: PartnerInvoiceSource;
  purchaseOrderId: number | null;
  /** The container's name, when the server sends it (a container without a group has none in the preview). */
  containerName?: string | null;
  reason: string;
}

export interface PartnerInvoicePreview {
  groups: PartnerInvoicePreviewGroup[];
  skipped: PartnerInvoiceSkipped[];
  /** The meldingen this preview covers: Facturen maken sends exactly these. */
  reportIds: number[];
  /** The partner customer's share: what the own-stock group uses (a container uses its own). */
  profitSharePct: number;
  /** Round 2: e.g. an unconfirmed buyback that mirrors a selected sale. */
  warnings?: string[] | null;
}

export interface PartnerInvoiceCreated {
  id: number;
  number: string | null;
  source: PartnerInvoiceSource;
  purchaseOrderId: number | null;
}

export interface PartnerInvoiceResult {
  invoices: PartnerInvoiceCreated[];
  blocked: { purchaseOrderId: number | null; message: string; containerName?: string | null }[];
  skipped: PartnerInvoiceSkipped[];
}

/* ------------------------------------------------ sales documents (round 2) */

/** A melding behind a document made by Factureren. */
export interface PartnerDocumentMelding {
  id: number;
  number: string;
  soldOn: string;
  channel: PartnerChannel;
}

/**
 * One product line of a report-backed document, as the margin popup explains it
 * (GET /api/partner-sales/documents/{id}/breakdown). Money in euros for the
 * whole line; quantities in the product's sales unit (pieces = those in pieces).
 * Bruto − commissie − transport − extra − terugkoopkost = proceedsEur (netto
 * opbrengst); proceedsEur − costEur (inkoopkost, extern) = profitEur;
 * valueEur (onze waarde) − costEur = enrosedProfitEur; proceedsEur − valueEur =
 * what the partner keeps; valueEur − advanceEur = what this document invoices.
 * ERP only: never in a partner response.
 */
export interface PartnerDocumentBreakdownLine {
  productId: number;
  name: string;
  variant: string | null;
  soldQuantity: number;
  boughtBackQuantity: number;
  /** soldQuantity − boughtBackQuantity: the invoice line's quantity. */
  quantity: number;
  /** The invoice quantity in pieces. */
  pieces?: number | null;
  /** What was sold, in pieces (the bruto's own count). */
  salePieces?: number | null;
  grossEur: number;
  commissionEur: number;
  transportEur: number;
  extraEur: number;
  buybackCostEur: number;
  proceedsEur: number;
  /** Proceeds moved onto this line from products sold and bought back (q = 0 netting); negative when moved off it. */
  absorbedEur?: number | null;
  /** The products whose proceeds moved here, by name. */
  absorbedFrom?: string[] | null;
  costEur: number;
  /** The partner's financed part of the cost (advance agreement / container); 0 for own stock. */
  costSharePct: number | null;
  profitEur: number;
  /** Our share of the profit, in percent. */
  profitSharePct: number | null;
  enrosedProfitEur: number;
  partnerProfitEur?: number | null;
  valueEur: number;
  advanceEur: number;
  /** A slotfactuur's true-up of earlier deelfacturen, on the line that carries it. */
  correctionEur?: number | null;
}

export interface PartnerDocumentBreakdown {
  salesOrderId?: number | null;
  source?: PartnerInvoiceSource | null;
  finalSettlement?: boolean | null;
  lines: PartnerDocumentBreakdownLine[];
  meldingen: PartnerDocumentMelding[];
  /** AUCTION, DIRECT, or MIXED when the meldingen are of both. */
  channel?: PartnerChannel | 'MIXED' | null;
  correctionEur?: number | null;
  /** A document from before round 2: the figures come from its invoice lines, no detail was kept. */
  fallback?: boolean | null;
  /** The server's own words for that fallback, when it sends them. */
  fallbackNote?: string | null;
}

/* ----------------------------------------- Eenheid per product (round 2) */

/** How the partner counts a product in the portal: per piece (roos, bowl …), per display, per outer carton. */
export type PartnerCountUnitCode = 'STUK' | 'VERPAKKING' | 'OMDOOS';

/** A stored default of one product; a product without a row counts per piece. */
export interface PartnerProductUnitRow {
  productId: number;
  unit: PartnerCountUnitCode;
}

/** A partial update: null = back to the default (per piece). */
export interface PartnerProductUnitChange {
  productId: number;
  unit: PartnerCountUnitCode | null;
}

/** A melding staff enter for the partner (Frans phoned it in): the partner's body plus the customer. */
export type StaffPartnerReportRequest = PartnerReportRequest & { customerId: number };

export interface StaffPartnerReportResult {
  report: StaffPartnerReport;
  /** The server already had this clientRef (200 instead of 201): nothing was booked twice. */
  existing: boolean;
}

/** True for a 404: the backend does not have the partner portal yet. */
export function isMissingEndpoint(failure: unknown): boolean {
  return (failure as { status?: number } | null)?.status === 404;
}

@Injectable({ providedIn: 'root' })
export class PartnerSalesApi {
  private readonly http = inject(HttpClient);

  /* ---- Instellingen › Partnerportaal */

  adminRows(): Promise<PartnerPortalAdminRow[]> {
    return firstValueFrom(this.http.get<PartnerPortalAdminRow[]>(api('/api/partner-portal-admin')));
  }

  saveLogin(customerId: number, body: PartnerPortalLoginRequest): Promise<PartnerPortalAdminRow> {
    return firstValueFrom(this.http.put<PartnerPortalAdminRow>(api(`/api/partner-portal-admin/${customerId}/login`), body));
  }

  saveSettings(customerId: number, body: PartnerPortalSettingsRequest): Promise<PartnerPortalAdminRow> {
    return firstValueFrom(this.http.put<PartnerPortalAdminRow>(api(`/api/partner-portal-admin/${customerId}/settings`), body));
  }

  /** The stored unit defaults of the partner's products (rows only; no row = per piece). */
  units(customerId: number): Promise<PartnerProductUnitRow[]> {
    return firstValueFrom(this.http.get<PartnerProductUnitRow[]>(api(`/api/partner-portal-admin/${customerId}/units`)));
  }

  /** Changes only the products named (never a full replace); answers the stored rows when the server sends them. */
  async saveUnits(customerId: number, changes: PartnerProductUnitChange[]): Promise<PartnerProductUnitRow[] | null> {
    const answer = await firstValueFrom(this.http.put<unknown>(api(`/api/partner-portal-admin/${customerId}/units`), { changes }));
    return Array.isArray(answer) ? answer as PartnerProductUnitRow[] : null;
  }

  /** Nagekeken: staff checked a customer the partner made (the bell item goes away). */
  async markCustomerReviewed(customerId: number): Promise<string | null> {
    const answer = await firstValueFrom(this.http.post<unknown>(api(`/api/partner-portal-admin/customers/${customerId}/reviewed`), {}));
    const reviewedAt = (answer as { reviewedAt?: unknown; partnerOrigin?: { reviewedAt?: unknown } } | null);
    const at = reviewedAt?.reviewedAt ?? reviewedAt?.partnerOrigin?.reviewedAt;
    return typeof at === 'string' ? at : null;
  }

  /* ---- sales documents */

  /** The margin popup of a report-backed document: per product line the way from bruto to what this document invoices. */
  documentBreakdown(salesOrderId: number): Promise<PartnerDocumentBreakdown> {
    return firstValueFrom(this.http.get<PartnerDocumentBreakdown>(api(`/api/partner-sales/documents/${salesOrderId}/breakdown`)));
  }

  /* ---- Veilingverkopen */

  /** Round 1 paging: newest id first; `before` is the last id of the previous page. */
  reports(options: { customerId?: number | null; status?: PartnerSalesStatusFilter; before?: number | null; limit?: number } = {}):
      Promise<StaffPartnerReportPage> {
    const params: Record<string, string> = { status: options.status ?? 'ALL', limit: String(options.limit ?? 100) };
    if (options.customerId != null) params['customerId'] = String(options.customerId);
    if (options.before != null) params['before'] = String(options.before);
    return firstValueFrom(this.http.get<StaffPartnerReportPage>(api('/api/partner-sales'), { params }));
  }

  /**
   * Round 2: the meldingen of a filter, newest sold_on first (then id), at most `limit` (1000) with `more` when cut,
   * and `filteredTotals` over the whole filtered set. `status` goes along for an older backend (it ignores the
   * rest and answers by id; the page then filters and sums what it got).
   */
  list(query: PartnerSalesListQuery = {}): Promise<StaffPartnerReportPage> {
    const state = query.state ?? 'ALL';
    const params: Record<string, string> = {
      state, status: state === 'INVOICED' ? 'INVOICED' : state === 'ALL' || state === 'VOIDED' ? 'ALL' : 'OPEN',
      limit: String(query.limit ?? 1000),
    };
    if (query.customerId != null) params['customerId'] = String(query.customerId);
    if (query.channel) params['channel'] = query.channel;
    if (query.from) params['from'] = query.from;
    if (query.to) params['to'] = query.to;
    if (query.buyerCustomerId != null) params['buyerCustomerId'] = String(query.buyerCustomerId);
    return firstValueFrom(this.http.get<StaffPartnerReportPage>(api('/api/partner-sales'), { params }));
  }

  /** One melding with its parts (also an archive row, by id). */
  report(id: number): Promise<StaffPartnerReport> {
    return firstValueFrom(this.http.get<StaffPartnerReport>(api(`/api/partner-sales/reports/${id}`)));
  }

  /** Bevestigen: all or nothing; a melding changed since its token was read is refused (409). */
  confirmReports(reports: readonly PartnerReportTokenRef[]): Promise<PartnerReportsConfirmed> {
    return firstValueFrom(this.http.post<PartnerReportsConfirmed>(api('/api/partner-sales/reports/confirm'), { reports }));
  }

  /** Terugzetten: back to "te bevestigen" (the partner can change it again); refused once a document holds a part. */
  unconfirmReports(reports: readonly PartnerReportTokenRef[]): Promise<PartnerReportsConfirmed> {
    return firstValueFrom(this.http.post<PartnerReportsConfirmed>(api('/api/partner-sales/reports/unconfirm'), { reports }));
  }

  /** Bewerken by staff: the create body + expectedToken (409 when it changed meanwhile); stays confirmed. */
  updateReport(id: number, body: StaffPartnerReportRequest): Promise<StaffPartnerReport> {
    return firstValueFrom(this.http.put<StaffPartnerReport>(api(`/api/partner-sales/reports/${id}`), body));
  }

  summary(): Promise<PartnerSalesSummary> {
    return firstValueFrom(this.http.get<PartnerSalesSummary>(api('/api/partner-sales/summary')));
  }

  /** By sold_on, from and to inclusive (yyyy-mm-dd); either may be null (open-ended): Analyses asks everything once. */
  analytics(from: string | null = null, to: string | null = null): Promise<PartnerSalesAnalytics> {
    const params: Record<string, string> = {};
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    return firstValueFrom(this.http.get<PartnerSalesAnalytics>(api('/api/partner-sales/analytics'), { params }));
  }

  async createReport(body: StaffPartnerReportRequest): Promise<StaffPartnerReportResult> {
    const response = await firstValueFrom(this.http.post<StaffPartnerReport>(
      api('/api/partner-sales/reports'), body, { observe: 'response' }));
    if (!response.body) throw { status: response.status, error: null };
    return { report: response.body, existing: response.status === 200 };
  }

  /** Intrekken: books the pieces back and keeps the melding as Ingetrokken, with the reason. */
  voidReport(id: number, reason: string): Promise<StaffPartnerReport> {
    return firstValueFrom(this.http.delete<StaffPartnerReport>(api(`/api/partner-sales/reports/${id}`), { params: { reason } }));
  }

  /** reportIds null = every open melding of the partner; until limits by sold_on. */
  invoicePreview(customerId: number, reportIds: number[] | null = null, until: string | null = null): Promise<PartnerInvoicePreview> {
    return firstValueFrom(this.http.post<PartnerInvoicePreview>(api('/api/partner-sales/invoice-preview'), { customerId, reportIds, until }));
  }

  /** Makes the concept invoices of a preview: send the preview's reportIds, never more. */
  invoice(customerId: number, reportIds: number[]): Promise<PartnerInvoiceResult> {
    return firstValueFrom(this.http.post<PartnerInvoiceResult>(api('/api/partner-sales/invoice'), { customerId, reportIds }));
  }
}
