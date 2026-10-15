import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import type { CashForecastSettings, PurchaseOrderForecast, PurchaseOrderForecastWrite } from './models';

/** A server from before the cash forecast round answers these paths with 404. */
function missing(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 404;
}

/**
 * The stored Kasprognose choices per purchase order and the company's
 * 'krap' buffer. Reads tolerate a server without this round (404): no
 * settings (null) and no stored choices ([]), so the pages hide the
 * controls that would write them.
 */
@Injectable({ providedIn: 'root' })
export class CashForecastApi {
  private readonly http = inject(HttpClient);

  /** The buffer; null when the server does not know the endpoint yet. */
  async settings(): Promise<CashForecastSettings | null> {
    try {
      return await firstValueFrom(this.http.get<CashForecastSettings>(api('/api/cash-forecast/settings')));
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }

  /** null goes back to the default (€ 10.000). */
  saveSettings(cashBufferEur: number | null): Promise<CashForecastSettings> {
    return firstValueFrom(this.http.put<CashForecastSettings>(api('/api/cash-forecast/settings'), { cashBufferEur }));
  }

  /** Every stored choice of a visible (not trashed) order; [] on a server without this round. */
  async forecasts(): Promise<PurchaseOrderForecast[]> {
    try {
      return await firstValueFrom(this.http.get<PurchaseOrderForecast[]>(api('/api/purchase-order-forecasts')));
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
  }

  /** The full set of choices of one order (stored values plus the change); all null removes the row. */
  saveForecast(orderId: number, body: PurchaseOrderForecastWrite): Promise<PurchaseOrderForecast> {
    return firstValueFrom(this.http.put<PurchaseOrderForecast>(api(`/api/purchase-order-forecasts/${orderId}`), body));
  }

  /** 'Terug naar standaard'; idempotent. */
  deleteForecast(orderId: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/purchase-order-forecasts/${orderId}`)));
  }
}
