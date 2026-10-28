import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';

/** One watched shop as the backend reports it. */
export interface StockRadarRow {
  key: string;
  name: string;
  kindLabel: string;
  method: 'http' | 'browser';
  url: string;
  orderUrl: string;
  intervalSeconds: number;
  available: boolean | null;
  inStock: boolean | null;
  statusText: string | null;
  deliveryBy: string | null;
  priceEur: number | null;
  foundUrl: string | null;
  checkedAt: string | null;
  changedAt: string | null;
  notifiedAt: string | null;
  nextCheckAt: string | null;
  lastError: string | null;
  errorCount: number;
  checkCount: number;
  lastPushStatus: number | null;
  lastMailStatus: number | null;
}

export interface StockRadarFeed {
  enabled: boolean;
  pushEnabled: boolean;
  mailEnabled: boolean;
  browserEnabled: boolean;
  notifyUser: string;
  mailTo: string;
  maxDeliveryDays: number;
  product: string;
  applePart: string;
  devices: number;
  lastTickAt: string | null;
  now: string;
  stores: StockRadarRow[];
}

export interface StockRadarTestResult {
  devices: number;
  pushStatuses: number[];
  mailStatus: number;
  mailTo: string;
}

@Injectable({ providedIn: 'root' })
export class StockRadarApi {
  private readonly http = inject(HttpClient);

  feed(): Promise<StockRadarFeed> {
    return firstValueFrom(this.http.get<StockRadarFeed>(api('/api/stock-radar')));
  }

  checkAll(): Promise<StockRadarFeed> {
    return firstValueFrom(this.http.post<StockRadarFeed>(api('/api/stock-radar/check'), {}));
  }

  checkOne(key: string): Promise<StockRadarFeed> {
    return firstValueFrom(this.http.post<StockRadarFeed>(api(`/api/stock-radar/${encodeURIComponent(key)}/check`), {}));
  }

  sendTest(): Promise<StockRadarTestResult> {
    return firstValueFrom(this.http.post<StockRadarTestResult>(api('/api/stock-radar/test-notification'), {}));
  }
}
