import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';

export interface PartnerContainerDeletionPreview {
  purchaseOrderId: number;
  number: string;
  allowed: boolean;
  blockReason: string | null;
  invoices: { id: number; number: string; status: string; totalEur: number | null }[];
}
export interface PartnerContainerDeletionResult {
  purchaseOrderId: number;
  deletedInvoiceIds: number[];
}

@Injectable({ providedIn: 'root' })
export class PartnerContainerDeletionApi {
  private readonly http = inject(HttpClient);

  preview(id: number): Promise<PartnerContainerDeletionPreview> {
    return firstValueFrom(this.http.get<PartnerContainerDeletionPreview>(api(`/api/purchase-orders/${id}/partner-container-deletion`)));
  }

  remove(id: number, expectedInvoiceIds: number[]): Promise<PartnerContainerDeletionResult> {
    return firstValueFrom(this.http.post<PartnerContainerDeletionResult>(api(`/api/purchase-orders/${id}/partner-container-deletion`), { expectedInvoiceIds }));
  }
}
