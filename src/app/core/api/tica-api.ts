import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';

export type TicaNotificationMode = 'DAILY' | 'SALES' | 'SALES_AND_DAILY' | 'NONE';
export type TicaStockStatus = 'DISABLED' | 'BEFORE_START' | 'PRODUCT_UNMATCHED' | 'LOCATION_UNMAPPED' | 'UNIT_MISMATCH' | 'INVALID_QUANTITY' | 'POSTED' | 'REVERSED';
export interface TicaStockSettingsWrite {
  enabled: boolean;
  fromDate: string | null;
  locations: { sourceLocation: string; stockLocationId: number | null }[];
  productUnits: { productId: number; sourceUnit: 'PIECE' | 'DISPLAY' | null }[];
}
export interface TicaStockSettings extends TicaStockSettingsWrite {
  timezone: string;
  configurationLocked: boolean;
  locations: { sourceLocation: string; stockLocationId: number | null; stockLocationName: string | null; locked: boolean }[];
  postedLineCount: number;
  pendingLineCount: number;
  productUnits: { productId: number; sourceUnit: 'PIECE' | 'DISPLAY' | null; productSalesUnit: 'PIECE' | 'DISPLAY'; piecesPerUnit: number; locked: boolean }[];
}
export interface TicaSettings {
  notificationMode: TicaNotificationMode;
  summaryTime: string;
  timezone: string;
}
export interface TicaStatus {
  enabled: boolean;
  credentialsReady: boolean;
  syncState: 'DISABLED' | 'NOT_CONFIGURED' | 'PENDING' | 'RUNNING' | 'ERROR' | 'READY' | 'NEVER_SYNCED';
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastRangeFrom: string | null;
  lastRangeTo: string | null;
  lastError: string | null;
  importedLineCount: number;
  unmatchedLineCount: number;
  pushSubscriptions: number;
  lastNotificationStatus: string | null;
  lastNotificationAt: string | null;
}
export interface TicaSale {
  id: number;
  location: string;
  exhibitor: string;
  soldAt: string;
  transactionNumber: string;
  lineNumber: string;
  description: string;
  beeyondArticleNumber: string;
  sku: string | null;
  barcode: string | null;
  quantity: number;
  discountPercent: number;
  grossTotal: number;
  netTotal: number;
  vatRate: number;
  transactionType: string;
  productId: number | null;
  mappingStatus: 'MATCHED' | 'UNMATCHED';
  firstSeenAt: string;
  updatedAt: string;
  stockStatus?: TicaStockStatus;
  stockMessage?: string | null;
  stockProductId?: number | null;
  stockLocationId?: number | null;
  /** Applied sales units: positive for sales, negative for returns. */
  stockQuantity?: number | null;
  stockPieces?: number | null;
  stockUnitPieces?: number | null;
  stockSourceUnit?: 'PIECE' | 'DISPLAY' | null;
  stockUpdatedAt?: string | null;
}
export interface TicaSalesPage {
  from: string;
  to: string;
  page: number;
  size: number;
  totalLines: number;
  transactionCount: number;
  quantity: number;
  grossTotal: number;
  netTotal: number;
  unmatchedLineCount: number;
  lines: TicaSale[];
}
export interface TicaSaleHistory {
  saleId: number;
  revisions: {
    id: number;
    recordedAt: string;
    sourceSoldAt: string;
    active: boolean;
    quantity: number;
    grossTotal: number;
    netTotal: number;
    productId: number | null;
    sku: string | null;
    description: string;
    stockStatus: TicaStockStatus;
    stockQuantity: number;
    stockProductId: number | null;
    stockLocationId: number | null;
    movements: { id: number; at: string; delta: number; quantityAfter: number; kind: string; reference: string | null; productId: number; locationId: number;
      looseDelta: number; loosePiecesAfter: number; unitPieces: number | null; sourceQuantity: number | null; sourceUnit: 'PIECE' | 'DISPLAY' | null }[];
  }[];
}
export interface TicaAnalyticsDay {
  date: string;
  transactionCount: number;
  quantity: number;
  revenueExcl: number;
  goodsCostEur: number;
  missingCostLines: number;
}
export interface TicaSettlementWrite {
  reference: string;
  location: string;
  documentDate: string;
  dueDate: string | null;
  periodFrom: string;
  periodTo: string;
  salesExcl: number;
  salesVat: number;
  commissionExcl: number;
  commissionVat: number;
  netReceivable: number;
  documentNote: string | null;
  sourceDocumentUrl: string | null;
}
export interface TicaSettlement extends TicaSettlementWrite {
  id: number;
  status: 'DRAFT' | 'OPEN' | 'PAID';
  importedRevenueExcl: number;
  reconciliationDifference: number;
  commissionCostId: number | null;
  bankStatementLineId: number | null;
  paidAt: string | null;
  createdAt: string;
  sourceKey: string | null;
}
export type TicaSettlementPreview = Omit<TicaSettlementWrite, 'documentNote'> & {
  fileName: string;
  warnings: string[];
};

/** Only the authenticated ERP backend is called; portal credentials stay on the server. */
@Injectable({ providedIn: 'root' })
export class TicaApi {
  private readonly http = inject(HttpClient);
  status(): Promise<TicaStatus> {
    return firstValueFrom(this.http.get<TicaStatus>(api('/api/tica/status')));
  }
  sales(from: string, to: string, page = 0): Promise<TicaSalesPage> {
    return firstValueFrom(this.http.get<TicaSalesPage>(api('/api/tica/sales'), {
      params: { from, to, page, size: 100 },
    }));
  }
  settings(): Promise<TicaSettings> {
    return firstValueFrom(this.http.get<TicaSettings>(api('/api/tica/settings')));
  }
  saveSettings(settings: TicaSettings): Promise<TicaSettings> {
    return firstValueFrom(this.http.put<TicaSettings>(api('/api/tica/settings'), settings));
  }
  sync(): Promise<{ queued: boolean }> {
    return firstValueFrom(this.http.post<{ queued: boolean }>(api('/api/tica/sync'), {}));
  }
  stockSettings(): Promise<TicaStockSettings> {
    return firstValueFrom(this.http.get<TicaStockSettings>(api('/api/tica/stock-settings')));
  }
  saveStockSettings(settings: TicaStockSettingsWrite): Promise<TicaStockSettings> {
    return firstValueFrom(this.http.put<TicaStockSettings>(api('/api/tica/stock-settings'), settings));
  }
  saleHistory(id: number): Promise<TicaSaleHistory> {
    return firstValueFrom(this.http.get<TicaSaleHistory>(api(`/api/tica/sales/${id}/history`)));
  }
  analytics(): Promise<TicaAnalyticsDay[]> {
    return firstValueFrom(this.http.get<TicaAnalyticsDay[]>(api('/api/tica/analytics')));
  }
  settlements(): Promise<TicaSettlement[]> {
    return firstValueFrom(this.http.get<TicaSettlement[]>(api('/api/tica/settlements')));
  }
  saveSettlement(id: number | null, value: TicaSettlementWrite): Promise<TicaSettlement> {
    return firstValueFrom(id === null
      ? this.http.post<TicaSettlement>(api('/api/tica/settlements'), value)
      : this.http.put<TicaSettlement>(api(`/api/tica/settlements/${id}`), value));
  }
  confirmSettlement(id: number): Promise<TicaSettlement> {
    return firstValueFrom(this.http.post<TicaSettlement>(api(`/api/tica/settlements/${id}/confirm`), {}));
  }
  linkSettlementBank(id: number, bankStatementLineId: number): Promise<TicaSettlement> {
    return firstValueFrom(this.http.post<TicaSettlement>(api(`/api/tica/settlements/${id}/bank-link`), { bankStatementLineId }));
  }
  unlinkSettlementBank(id: number): Promise<TicaSettlement> {
    return firstValueFrom(this.http.delete<TicaSettlement>(api(`/api/tica/settlements/${id}/bank-link`)));
  }
  previewSettlementDocument(file: File): Promise<TicaSettlementPreview> {
    const form = new FormData();
    form.set('file', file);
    return firstValueFrom(this.http.post<TicaSettlementPreview>(api('/api/tica/settlements/document-preview'), form));
  }
  settlementDocument(path: string): Promise<Blob> {
    if (!/^\/api\/tica\/settlements\/documents\/[A-Za-z0-9-]+$/.test(path)) return Promise.reject(new Error('Onbekend documentadres.'));
    return firstValueFrom(this.http.get(api(path), { responseType: 'blob' }));
  }
}
