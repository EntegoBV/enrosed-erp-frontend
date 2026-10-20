import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';

export type ProductChannelPriceUnit = 'PIECE' | 'DISPLAY' | 'TICA_ARTICLE';
export interface ProductChannelPrice {
  channel: 'TICA';
  priceExclVat: number | null;
  source: 'MANUAL' | 'TICA' | null;
  unit: ProductChannelPriceUnit | null;
  observedPriceExclVat: number | null;
  observedUnit: ProductChannelPriceUnit | null;
  observedAt: string | null;
  updatedAt: string | null;
  manualPriceExclVat: number | null;
  manualUnit: ProductChannelPriceUnit | null;
}
export interface ProductChannelPriceHistory {
  id: number;
  priceExclVat: number | null;
  unit: ProductChannelPriceUnit | null;
  source: 'MANUAL' | 'TICA' | null;
  changedAt: string;
  changedBy: string | null;
}

@Injectable({ providedIn: 'root' })
export class ProductChannelPriceApi {
  private readonly http = inject(HttpClient);
  prices(id: number): Promise<ProductChannelPrice[]> {
    return firstValueFrom(this.http.get<ProductChannelPrice[]>(api(`/api/products/${id}/channel-prices`)));
  }
  saveTica(id: number, priceExclVat: number | null, unit: ProductChannelPriceUnit): Promise<ProductChannelPrice> {
    return firstValueFrom(this.http.put<ProductChannelPrice>(api(`/api/products/${id}/channel-prices/TICA`), { priceExclVat, unit }));
  }
  history(id: number): Promise<ProductChannelPriceHistory[]> {
    return firstValueFrom(this.http.get<ProductChannelPriceHistory[]>(api(`/api/products/${id}/channel-prices/TICA/history`)));
  }
}
