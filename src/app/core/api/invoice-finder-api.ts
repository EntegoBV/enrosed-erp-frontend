import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';

/*
 * Facturen (invoice finder, 2026-10-25): one read-only list over the
 * container invoices, the company costs, Odoo/Peppol and our own sales
 * documents. The shapes are exactly the server's JSON (invoices contract §4).
 */

export type InvoiceDirection = 'IN' | 'OUT';
export type InvoiceScope = 'ALL' | 'CONTAINERS' | 'COSTS' | 'ODOO_NEW' | 'NO_FILE' | 'INVOICES' | 'CREDIT_NOTES' | 'ODOO';
export type InvoiceSource = 'CONTAINER_INVOICE' | 'CONTAINER_FILE' | 'COST' | 'ODOO' | 'SALES';
export type InvoiceKind = 'INVOICE' | 'CREDIT_NOTE' | 'PROFORMA';
export type InvoiceStatus = 'PAID' | 'PARTIAL' | 'OPEN' | 'OVERDUE' | 'SETTLED' | 'NO_DATA' | 'NEW' | 'HANDLED' | 'CONTAINER' | 'TICA' | 'CANCELLED';

export interface InvoiceParty {
  name: string | null;
  type: 'SUPPLIER' | 'PAYEE' | 'COST_PARTY' | 'ODOO_PARTNER' | 'CUSTOMER';
  id: number | null;
}

export interface InvoiceContainerRef {
  id: number;
  number: string | null;
  alias: string | null;
}

export interface InvoiceLink {
  type: 'CONTAINER' | 'TRANSACTION' | 'TICA';
  id: number;
  label: string | null;
  date: string | null;
  account: string | null;
}

export interface InvoiceFile {
  type: 'PURCHASE_DOCUMENT' | 'MEDIA_ASSET' | 'ODOO_ATTACHMENT' | 'SALES_PDF';
  id: number;
  orderId: number | null;
  moveId: number | null;
  name: string;
  contentType: string | null;
  kind: 'PDF' | 'XML' | 'IMAGE' | 'FILE';
  sizeBytes: number | null;
  archived: boolean;
}

export interface InvoiceMark {
  resolution: 'HANDLED' | 'CONTAINER';
  purchaseOrderId: number | null;
  note: string | null;
  markedAt: string;
  markedBy: string;
}

export interface InvoiceOdooFacts {
  moveId: number;
  name: string | null;
  moveType: 'in_invoice' | 'in_refund' | 'out_invoice' | 'out_refund';
  state: 'draft' | 'posted' | 'cancel';
  paymentState: 'not_paid' | 'in_payment' | 'paid' | 'partial' | 'reversed' | null;
  registrable: boolean;
  blockedBy: 'OUTGOING' | 'CANCELLED' | 'NO_DATE' | 'ZERO' | 'NOT_EUR' | 'TICA' | 'MARKED' | 'COST_REMOVED' | 'DEMO' | null;
  mark: InvoiceMark | null;
}

export interface InvoiceRow {
  key: string;
  source: InvoiceSource;
  direction: InvoiceDirection;
  kind: InvoiceKind;
  docLabel: string | null;
  number: string | null;
  date: string;
  sortDate: string;
  dateKind: 'INVOICE' | 'UPLOADED' | 'RECORDED';
  dueDate: string | null;
  amount: number | null;
  currency: string | null;
  amountEur: number | null;
  paidEur: number | null;
  openEur: number | null;
  party: InvoiceParty;
  payee: 'SUPPLIER' | 'LOGISTICS' | 'SEPARATE' | 'OTHER' | null;
  description: string | null;
  category: string | null;
  salesPurpose: 'STANDARD' | 'PARTNER_ADVANCE' | 'PARTNER_SETTLEMENT' | null;
  status: InvoiceStatus;
  statusReason: 'COST_REMOVED' | 'BEFORE_START' | null;
  origin: 'UPLOAD' | 'MANUAL' | 'ODOO' | 'ENROSED';
  peppolState: string | null;
  odooMoveId: number | null;
  odoo: InvoiceOdooFacts | null;
  container: InvoiceContainerRef | null;
  links: InvoiceLink[];
  files: InvoiceFile[];
  missingFile: boolean;
}

export interface InvoiceFinderOdoo {
  state: 'READY' | 'DEMO' | 'NOT_CONNECTED' | 'ERROR';
  code: string | null;
  message: string | null;
  included: boolean;
}

export interface InvoiceFinderPage {
  rows: InvoiceRow[];
  nextCursor: string | null;
  erpCount: number;
  odoo: InvoiceFinderOdoo;
}

export interface InvoiceFinderQuery {
  direction: InvoiceDirection;
  scope?: InvoiceScope;
  q?: string;
  from?: string;
  to?: string;
  orderId?: number | null;
  cursor?: string | null;
  limit?: number;
}

export interface InvoiceMarkRequest {
  resolution: 'HANDLED' | 'CONTAINER';
  purchaseOrderId: number | null;
  note: string | null;
}

@Injectable({ providedIn: 'root' })
export class InvoiceFinderApi {
  private readonly http = inject(HttpClient);

  /** One page; empty parameters stay out of the address. */
  list(query: InvoiceFinderQuery): Promise<InvoiceFinderPage> {
    let params = new HttpParams().set('direction', query.direction);
    if (query.scope && query.scope !== 'ALL') params = params.set('scope', query.scope);
    if (query.q?.trim()) params = params.set('q', query.q.trim());
    if (query.from) params = params.set('from', query.from);
    if (query.to) params = params.set('to', query.to);
    if (query.orderId) params = params.set('orderId', query.orderId);
    if (query.cursor) params = params.set('cursor', query.cursor);
    if (query.limit) params = params.set('limit', query.limit);
    return firstValueFrom(this.http.get<InvoiceFinderPage>(api('/api/invoice-finder'), { params }));
  }

  /** The row of a key, or the row that now stands for it (a registered Odoo bill answers with its cost). */
  row(key: string): Promise<InvoiceRow> {
    return firstValueFrom(this.http.get<InvoiceRow>(api(`/api/invoice-finder/rows/${encodeURIComponent(key).replace("%3A", ":")}`)));
  }

  /** The file itself, through the route of the place that holds it. */
  file(file: InvoiceFile, variant?: 'web'): Promise<Blob> {
    return firstValueFrom(this.http.get(api(fileUrl(file, variant)), { responseType: 'blob' }));
  }

  /** A PDF to preview: an Odoo attachment or a media asset as is, or the PDF inside its Peppol XML. */
  pdf(file: InvoiceFile): Promise<Blob> {
    const path = file.type === 'ODOO_ATTACHMENT'
      ? `/api/invoice-finder/odoo/${file.moveId}/attachments/${file.id}/pdf`
      : `/api/invoice-finder/media/${file.id}/pdf`;
    return firstValueFrom(this.http.get(api(path), { responseType: 'blob' }));
  }

  mark(moveId: number, body: InvoiceMarkRequest): Promise<InvoiceRow> {
    return firstValueFrom(this.http.put<InvoiceRow>(api(`/api/invoice-finder/odoo/${moveId}/mark`), body));
  }

  clearMark(moveId: number): Promise<InvoiceRow> {
    return firstValueFrom(this.http.delete<InvoiceRow>(api(`/api/invoice-finder/odoo/${moveId}/mark`)));
  }
}

function fileUrl(file: InvoiceFile, variant?: 'web'): string {
  switch (file.type) {
    case 'PURCHASE_DOCUMENT': return `/api/purchase-orders/${file.orderId}/documents/${file.id}/file`;
    case 'MEDIA_ASSET': return `/api/media-assets/${file.id}/download${variant === 'web' && file.kind === 'IMAGE' ? '?variant=web' : ''}`;
    case 'ODOO_ATTACHMENT': return `/api/invoice-finder/odoo/${file.moveId}/attachments/${file.id}`;
    default: return `/api/sales-orders/${file.id}/pdf`;
  }
}
