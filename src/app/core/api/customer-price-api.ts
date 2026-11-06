import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import type { LanguageCode } from './models';

/** The sales unit a price is on: per display only for a display priced per display. */
export type CustomerPriceBasis = 'PIECE' | 'DISPLAY';
export type CustomerPriceStatus = 'ACTIVE' | 'EXPIRED' | 'BASIS_CHANGED' | 'PRODUCT_GONE';
export type CustomerPriceSource = 'CUSTOMER_SCREEN' | 'CATALOG_EXPORT';
export type CatalogExportPriceSource = 'CATALOGUE' | 'CUSTOMER' | 'ONE_OFF' | 'ON_REQUEST';

/** A customer's own price for one product, EUR excl. VAT on the product's sales unit. */
export interface CustomerPrice {
  productId: number;
  sku: string | null;
  name: string;
  priceExclVat: number;
  /** The basis the price was set on; a product sold otherwise now reads BASIS_CHANGED. */
  salesUnit: CustomerPriceBasis;
  piecesPerUnit: number | null;
  unitKey: string | null;
  cataloguePriceAtSet: number | null;
  cataloguePriceNow: number | null;
  /** null: until changed. */
  validUntil: string | null;
  note: string | null;
  status: CustomerPriceStatus;
  updatedAt: string;
  updatedBy: string | null;
}

/** One customer with an own price for a product, as the product screens list them (round 3b). */
export interface ProductCustomerPrice {
  customerId: number;
  customerName: string;
  /** EUR excl. VAT on the product's sales unit, like the catalogue price. */
  priceExclVat: number;
  /** null: until changed. */
  validUntil: string | null;
  status: CustomerPriceStatus;
}

export interface CustomerPriceChange {
  productId: number;
  /** null removes the product's price. */
  priceExclVat: number | null;
  validUntil?: string | null;
  note?: string | null;
}

/** Patch: only the listed products change. */
export interface CustomerPriceSave {
  source: CustomerPriceSource;
  changes: CustomerPriceChange[];
}

export interface CustomerPriceHistoryEntry {
  productId: number;
  priceExclVat: number | null;
  previousPriceExclVat: number | null;
  salesUnit: CustomerPriceBasis | null;
  piecesPerUnit: number | null;
  validUntil: string | null;
  source: CustomerPriceSource | 'CUSTOMER_DELETED';
  changedAt: string;
  changedBy: string | null;
}

/** One catalogue PDF made with prices or for a recipient: the journal's header. */
export interface CatalogExportSummary {
  id: number;
  exportedAt: string;
  exportedBy: string | null;
  customerName: string | null;
  language: LanguageCode;
  layout: 'SIMPLE' | 'BROCHURE';
  productCount: number;
  customerPriceCount: number;
  oneOffCount: number;
  fileName: string | null;
}

export interface CatalogExportLine {
  productId: number;
  sku: string | null;
  name: string;
  /** null: "Prijs op aanvraag", or a PDF without prices. */
  printedPriceEur: number | null;
  cataloguePriceEur: number | null;
  priceSource: CatalogExportPriceSource | null;
  salesUnit: CustomerPriceBasis | null;
  piecesPerUnit: number | null;
  unitKey: string | null;
}

export interface CatalogExportDetail extends CatalogExportSummary {
  lines: CatalogExportLine[];
}

/** Klantprijzen and the journal of priced catalogues; admin only, like the other customer endpoints. */
@Injectable({ providedIn: 'root' })
export class CustomerPriceApi {
  private readonly http = inject(HttpClient);

  list(customerId: number): Promise<CustomerPrice[]> {
    return firstValueFrom(this.http.get<CustomerPrice[]>(api(`/api/customers/${customerId}/prices`)));
  }

  /** Answers the full list, as list() gives it. */
  save(customerId: number, body: CustomerPriceSave): Promise<CustomerPrice[]> {
    return firstValueFrom(this.http.put<CustomerPrice[]>(api(`/api/customers/${customerId}/prices`), body));
  }

  history(customerId: number, productId?: number): Promise<CustomerPriceHistoryEntry[]> {
    const params: Record<string, number> = productId === undefined ? {} : { productId };
    return firstValueFrom(this.http.get<CustomerPriceHistoryEntry[]>(
      api(`/api/customers/${customerId}/prices/history`), { params }));
  }

  /** Every customer with an own price for one product; an older server answers 404. */
  productPrices(productId: number): Promise<ProductCustomerPrice[]> {
    return firstValueFrom(this.http.get<ProductCustomerPrice[]>(api(`/api/products/${productId}/customer-prices`)));
  }

  exports(customerId: number, limit = 20): Promise<CatalogExportSummary[]> {
    return firstValueFrom(this.http.get<CatalogExportSummary[]>(
      api(`/api/customers/${customerId}/catalog-exports`), { params: { limit } }));
  }

  exportDetail(id: number): Promise<CatalogExportDetail> {
    return firstValueFrom(this.http.get<CatalogExportDetail>(api(`/api/catalog/exports/${id}`)));
  }
}
