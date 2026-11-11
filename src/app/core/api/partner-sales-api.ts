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
}

/** A melding as staff see it: the partner's view plus who, the void and the parts. */
export interface StaffPartnerReport extends PartnerReport {
  customerId: number;
  customerName: string;
  createdBy: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  note?: string | null;
  parts: PartnerReportPart[];
}

export interface PartnerSalesOpenTotals {
  openReports: number;
  openSaleQuantity: number;
  openNetEur: number;
}

export interface StaffPartnerReportPage {
  reports: StaffPartnerReport[];
  more: boolean;
  totals: PartnerSalesOpenTotals;
}

export interface PartnerSalesPartnerSummary extends PartnerSalesOpenTotals {
  customerId: number;
  customerName: string;
  lastReportAt: string | null;
}

/** The cheap count behind the nav, the bell and the home card. */
export interface PartnerSalesSummary extends PartnerSalesOpenTotals {
  lastReportAt: string | null;
  recentReports14d: number;
  partners: PartnerSalesPartnerSummary[];
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
  buybackEur: number;
  proceedsEur: number;
  /** null on a blocked group: the settlement was not computed. */
  costEur: number | null;
  valueEur: number | null;
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

  /* ---- Veilingverkopen */

  /** Newest first; `before` is the last id of the previous page. */
  reports(options: { customerId?: number | null; status?: PartnerSalesStatusFilter; before?: number | null; limit?: number } = {}):
      Promise<StaffPartnerReportPage> {
    const params: Record<string, string> = { status: options.status ?? 'ALL', limit: String(options.limit ?? 100) };
    if (options.customerId != null) params['customerId'] = String(options.customerId);
    if (options.before != null) params['before'] = String(options.before);
    return firstValueFrom(this.http.get<StaffPartnerReportPage>(api('/api/partner-sales'), { params }));
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
