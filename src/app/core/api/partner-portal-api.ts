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
 * numbers (4.5). Quantities are in the product's sales unit.
 */

export type PartnerChannel = 'AUCTION' | 'DIRECT';
export type PartnerReportStatus = 'OPEN' | 'PARTLY_INVOICED' | 'INVOICED' | 'VOIDED';
export type PartnerExtraCostMode = 'AMOUNT' | 'PCT';

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
  piecesPerUnit: number | null;
  hasPhoto: boolean;
  /** Changes when the photo changes, so it is part of the photo URL (cache key). */
  photoVersion: string | null;
}

/** Stock at the partner's location, in sales units (only products with stock). */
export interface PartnerStockTile extends PartnerProductTile {
  quantity: number;
}

/** A product this partner reported sold in the last 60 days, whatever its stock (for Terugkoop). */
export interface PartnerRecentSale extends PartnerProductTile {
  soldQuantity: number;
  lastSoldOn: string;
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

export interface PartnerExtraCost {
  mode: PartnerExtraCostMode;
  value: number;
}

export interface PartnerReportSale {
  quantity: number;
  unitPriceEur: number;
  grossEur: number;
  commissionEur: number;
  transportEur: number;
  extraCostEur: number;
  netEur: number;
}

export interface PartnerReportBuyback {
  quantity: number;
  unitPriceEur: number;
  grossEur: number;
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
}

export interface PartnerReportTotals {
  saleQuantity: number;
  buybackQuantity: number;
  grossEur: number;
  commissionEur: number;
  transportEur: number;
  extraCostEur: number;
  saleNetEur: number;
  buybackEur: number;
  /** Sale net minus terugkoopkost; negative for a melding with only buybacks. */
  netEur: number;
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
  extraCost: PartnerExtraCost | null;
  entries: PartnerReportEntry[];
  totals: PartnerReportTotals;
  status: PartnerReportStatus;
  canUndo: boolean;
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
}

export interface PartnerReportPage {
  reports: PartnerReport[];
  more: boolean;
}

/** Exactly one of unitPriceEur / totalEur. */
export interface PartnerReportPartRequest {
  quantity: number;
  unitPriceEur?: number;
  totalEur?: number;
}

export interface PartnerReportEntryRequest {
  productId: number;
  sale?: PartnerReportPartRequest;
  buyback?: PartnerReportPartRequest;
}

/** The body of a new melding; staff send the same body plus customerId to /api/partner-sales/reports. */
export interface PartnerReportRequest {
  channel: PartnerChannel;
  soldOn?: string | null;
  /** One per melding, kept for its retries: the same ref again answers the melding already booked. */
  clientRef: string;
  note?: string | null;
  extraCost?: PartnerExtraCost | null;
  entries: PartnerReportEntryRequest[];
}

/** A created melding; `existing` when the server already had this clientRef (200 instead of 201). */
export interface PartnerReportResult {
  report: PartnerReport;
  existing: boolean;
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

  /** Meldingen newest first; `before` is the last id of the previous page. */
  reports(before: number | null = null, limit = PARTNER_REPORT_PAGE_SIZE): Promise<PartnerReportPage> {
    const params: Record<string, string> = { limit: String(limit) };
    if (before != null) params['before'] = String(before);
    return firstValueFrom(this.http.get<PartnerReportPage>(api('/api/partner-portal/reports'), { params }));
  }

  async createReport(body: PartnerReportRequest): Promise<PartnerReportResult> {
    const response = await firstValueFrom(this.http.post<PartnerReport>(
      api('/api/partner-portal/reports'), body, { observe: 'response' }));
    if (!response.body) throw { status: response.status, error: null };
    return { report: response.body, existing: response.status === 200 };
  }

  /** Ongedaan maken: voids the partner's own melding while nothing of it is invoiced. */
  voidReport(id: number): Promise<PartnerReport> {
    return firstValueFrom(this.http.delete<PartnerReport>(api(`/api/partner-portal/reports/${id}`)));
  }

  /** Ends this device's partner session on the server; the caller then signs out locally. */
  logout(): Promise<void> {
    return firstValueFrom(this.http.post<void>(api('/api/partner-portal/logout'), null));
  }
}
