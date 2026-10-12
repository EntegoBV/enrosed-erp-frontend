import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';

export interface OdooBankSyncResult {
  scanned: number;
  created: number;
  updated: number;
  unchanged: number;
  conflicts: number;
  skippedNonEur: number;
  complete: boolean;
  message: string;
}

export interface OdooConnectionStatus {
  enabled: boolean;
  configured: boolean;
  code: string;
  message: string;
  missingConfiguration: string[];
  outboundEnabled: boolean;
  lastCheckAt: string | null;
  lastSyncAt: string | null;
  lastSync: OdooBankSyncResult | null;
  companyName?: string | null;
  journalCount?: number | null;
}

export type OdooDocumentDirection = 'incoming' | 'outgoing';

export interface OdooAttachment {
  id: number;
  name: string;
  mimeType: string;
  size: number;
  kind: 'XML' | 'PDF' | 'FILE';
}

export interface OdooDocument {
  id: number;
  name: string;
  reference: string | null;
  partner: string;
  date: string | null;
  moveType: string;
  state: string;
  currency: string;
  total: number;
  peppolState: string | null;
  peppolMessageId: string | null;
  attachments: OdooAttachment[];
}

export interface OdooDocumentPage {
  documents: OdooDocument[];
  nextAfterId: number | null;
  hasMore: boolean;
  peppolSupported: boolean;
}

/** Calls our authenticated backend; Odoo credentials never reach the browser. */
@Injectable({ providedIn: 'root' })
export class OdooApi {
  private readonly http = inject(HttpClient);

  status(): Promise<OdooConnectionStatus> {
    return firstValueFrom(this.http.get<OdooConnectionStatus>(api('/api/odoo/status')));
  }

  check(): Promise<OdooConnectionStatus> {
    return firstValueFrom(this.http.post<OdooConnectionStatus>(api('/api/odoo/check'), {}));
  }

  syncBank(): Promise<OdooBankSyncResult> {
    return firstValueFrom(this.http.post<OdooBankSyncResult>(api('/api/odoo/bank-sync'), {}));
  }

  documents(direction: OdooDocumentDirection, afterId = 0): Promise<OdooDocumentPage> {
    return firstValueFrom(this.http.get<OdooDocumentPage>(api('/api/odoo/documents'), {
      params: { direction, afterId, limit: 50 },
    }));
  }

  attachment(documentId: number, attachmentId: number): Promise<Blob> {
    return firstValueFrom(this.http.get(api(`/api/odoo/documents/${documentId}/attachments/${attachmentId}`), { responseType: 'blob' }));
  }
}
