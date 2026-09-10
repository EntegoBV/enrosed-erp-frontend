import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';

export type DeletedItemType = 'INVOICE' | 'QUOTE' | 'PURCHASE_ORDER';
export interface DeletedItemSummary {
  id: number;
  type: DeletedItemType;
  sourceId: number;
  number: string;
  partyName: string;
  status: string;
  deletedAt: string;
  expiresAt: string;
  deletedBy: string | null;
  totalEur: number | null;
  restoreAllowed: boolean;
  blockReason: string | null;
}
export interface DeletedItemDetail extends DeletedItemSummary {
  fields: { label: string; value: string }[];
  lines: { description: string; sku: string | null; quantity: number | null; unit: string | null; unitPriceEur: number | null; totalEur: number | null }[];
  notes: string | null;
  attachments: { id: number; name: string; url: string | null }[];
}
export interface DeletedItemsResponse { retentionDays: number; items: DeletedItemSummary[] }
export interface RestoredItem { sourceId: number; targetRoute: string }

@Injectable({ providedIn: 'root' })
export class DeletedItemsApi {
  private readonly http = inject(HttpClient);
  list(): Promise<DeletedItemsResponse> {
    return firstValueFrom(this.http.get<DeletedItemsResponse>(api('/api/deleted-items')));
  }
  detail(id: number): Promise<DeletedItemDetail> {
    return firstValueFrom(this.http.get<DeletedItemDetail>(api(`/api/deleted-items/${id}`)));
  }
  attachment(id: number, attachmentId: number): Promise<Blob> {
    return firstValueFrom(this.http.get(api(`/api/deleted-items/${id}/attachments/${attachmentId}/file`), { responseType: 'blob' }));
  }
  restore(id: number): Promise<RestoredItem> {
    return firstValueFrom(this.http.post<RestoredItem>(api(`/api/deleted-items/${id}/restore`), {}));
  }
}
