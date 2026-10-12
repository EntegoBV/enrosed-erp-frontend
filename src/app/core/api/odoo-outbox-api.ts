import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';

export interface OdooInvoicePreview {
  number: string;
  moveType: 'out_invoice' | 'out_refund';
  date: string;
  dueDate: string | null;
  customerName: string;
  customerVat: string | null;
  vatTreatment: string;
  vatRate: number;
  net: number;
  vat: number;
  total: number;
  lines: { description: string; quantity: number; unitPrice: number; discount: number; total: number }[];
  legalMention: string | null;
  creditReference: string | null;
}
export interface OdooOutboxEntry {
  state: 'PREVIEW' | 'DRAFT' | 'QUEUED' | 'DONE' | 'UNKNOWN_CREATE' | 'UNKNOWN_SEND' | 'BLOCKED';
  snapshotHash: string;
  odooMoveId: number | null;
  number: string | null;
  peppolState: string | null;
  updatedAt: string | null;
  message: string | null;
}
export interface OdooOutboxView {
  enabled: boolean;
  sendEnabled: boolean;
  configured: boolean;
  code: string;
  message: string;
  missingConfiguration: string[];
  localPreview: OdooInvoicePreview | null;
  entry: OdooOutboxEntry | null;
}
export interface OdooCustomerMatch { id: number; name: string; vat: string | null; country: string | null; }
export interface OdooCustomerMatches { partners: OdooCustomerMatch[]; message?: string | null; }

@Injectable({ providedIn: 'root' })
export class OdooOutboxApi {
  private readonly http = inject(HttpClient);
  view(id: number): Promise<OdooOutboxView> { return firstValueFrom(this.http.get<OdooOutboxView>(api(`/api/odoo/outbox/${id}`))); }
  partners(id: number): Promise<OdooCustomerMatches> { return firstValueFrom(this.http.get<OdooCustomerMatches>(api(`/api/odoo/outbox/${id}/partners`))); }
  preview(id: number, odooPartnerId: number): Promise<OdooOutboxView> { return firstValueFrom(this.http.post<OdooOutboxView>(api(`/api/odoo/outbox/${id}/preview`), { odooPartnerId })); }
  draft(id: number, snapshotHash: string): Promise<OdooOutboxView> { return firstValueFrom(this.http.post<OdooOutboxView>(api(`/api/odoo/outbox/${id}/draft`), { snapshotHash })); }
  send(id: number, snapshotHash: string): Promise<OdooOutboxView> { return firstValueFrom(this.http.post<OdooOutboxView>(api(`/api/odoo/outbox/${id}/send`), { snapshotHash })); }
  refresh(id: number): Promise<OdooOutboxView> { return firstValueFrom(this.http.post<OdooOutboxView>(api(`/api/odoo/outbox/${id}/refresh`), {})); }
}
