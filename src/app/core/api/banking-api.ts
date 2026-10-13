import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import type { PurchasePayment, PurchasePaymentWrite } from './models';
import type { OdooDocument } from './odoo-api';

export interface ReceivedOdooInvoice extends OdooDocument {
  companyCostId: number | null; registered: boolean; eligible: boolean; unavailableReason: string | null; actionMessage?: string | null;
}
export interface ReceivedOdooInvoicePage {
  documents: ReceivedOdooInvoice[]; nextAfterId: number | null; hasMore: boolean; peppolSupported: boolean;
}
export interface ReceivedOdooInvoicePreview {
  document: ReceivedOdooInvoice; snapshotHash: string; invoiceTotalEur: number; netEur: number; vatEur: number;
  paymentAmountEur: number; differenceEur: number; supplierCountry: string | null; companyCostId: number | null;
  existingCandidates: { id: number; description: string; party: string | null; date: string; reference: string | null; totalEur: number; openEur: number; bankStatementLineId: number | null }[];
  eligible: boolean; unavailableReason: string | null; actionMessage?: string | null;
}
export interface ReceivedOdooInvoiceResult {
  line: BankStatementLine; companyCostId: number; alreadyRegistered: boolean;
  invoiceTotalEur: number; paymentAmountEur: number; differenceEur: number; documentsSaved: number;
}

export interface BankMovementRequest {
  account: string; amountEur: number; direction: 'INCOMING' | 'OUTGOING'; bookedAt: string;
  timeZone: string; reference: string | null; counterparty: string | null; requestId: string;
  /** The container payments and the cost this line pays; the server links them in the same transaction. */
  purchasePaymentIds?: number[]; companyCostId?: number | null;
  /** The cost payment this line covers; wins over companyCostId. */
  costPaymentId?: number | null;
}
export interface BankMatch { salesOrderId: number; number: string; openEur: number; score: number; existingPaymentId: number | null; reason: string; receivedAt: string | null; reference: string | null; }
export interface BankPaymentLinks { purchasePaymentIds?: number[]; companyCostId?: number; costPaymentId?: number; }
export interface BankAccount {
  key: string; label: string; source: 'MANUAL' | 'ODOO'; archived: boolean; aliases: string[];
  odooJournalId: number | null; manualMovementsAllowed: boolean;
}
export type BankAccountWrite = Pick<BankAccount, 'label' | 'source' | 'aliases' | 'odooJournalId'>;
export interface BankStatementLine {
  id: number; account: string; fingerprint: string; amountEur: number; bookedAt: string; timeZone: string;
  reference: string; counterparty: string; recordedAt: string; actor: string;
  salesPaymentId: number | null; salesOrderId: number | null; allocatedAt: string | null; allocationCreatedPayment: boolean;
  source?: 'ODOO' | null; sourceId?: string | null; sourceUpdatedAt?: string | null; sourceReconciled?: boolean | null;
  allocated?: boolean; allocationLabel?: string | null;
  allocatedAmountEur?: number | null; allocationDifferenceEur?: number | null;
}
@Injectable({ providedIn: 'root' })
export class BankingApi {
  private readonly http = inject(HttpClient);
  accounts(): Promise<BankAccount[]> { return firstValueFrom(this.http.get<BankAccount[]>(api('/api/bank-accounts'))); }
  updateAccount(key: string, body: BankAccountWrite): Promise<BankAccount> { return firstValueFrom(this.http.put<BankAccount>(api(`/api/bank-accounts/${encodeURIComponent(key)}`), body)); }
  archiveAccount(key: string): Promise<void> { return firstValueFrom(this.http.delete<void>(api(`/api/bank-accounts/${encodeURIComponent(key)}`))); }
  restoreAccount(key: string): Promise<BankAccount> { return firstValueFrom(this.http.post<BankAccount>(api(`/api/bank-accounts/${encodeURIComponent(key)}/restore`), {})); }
  list(): Promise<BankStatementLine[]> { return firstValueFrom(this.http.get<BankStatementLine[]>(api('/api/bank-statements'))); }
  create(body: BankMovementRequest): Promise<BankStatementLine> { return firstValueFrom(this.http.post<BankStatementLine>(api('/api/bank-statements'), body)); }
  suggestions(id: number): Promise<BankMatch[]> { return firstValueFrom(this.http.get<BankMatch[]>(api(`/api/bank-statements/${id}/suggestions`))); }
  allocate(id: number, salesOrderId: number, existingPaymentId: number | null): Promise<BankStatementLine> { return firstValueFrom(this.http.post<BankStatementLine>(api(`/api/bank-statements/${id}/allocation`), { salesOrderId, existingPaymentId })); }
  unallocate(id: number): Promise<void> { return firstValueFrom(this.http.delete<void>(api(`/api/bank-statements/${id}/allocation`))); }
  linkPayments(id: number, body: BankPaymentLinks): Promise<BankStatementLine> { return firstValueFrom(this.http.post<BankStatementLine>(api(`/api/bank-statements/${id}/links`), body)); }
  addPurchasePayment(id: number, purchaseOrderId: number, payments: PurchasePaymentWrite[]): Promise<{ line: BankStatementLine; payments: PurchasePayment[] }> { return firstValueFrom(this.http.post<{ line: BankStatementLine; payments: PurchasePayment[] }>(api(`/api/bank-statements/${id}/purchase-payment`), { purchaseOrderId, payments })); }
  addCostPayment(id: number, companyCostId: number, confirmNewPayment = false): Promise<BankStatementLine> { return firstValueFrom(this.http.post<BankStatementLine>(api(`/api/bank-statements/${id}/cost-payment`), { companyCostId, ...(confirmNewPayment ? { confirmNewPayment } : {}) })); }
  unlinkPayments(id: number): Promise<void> { return firstValueFrom(this.http.delete<void>(api(`/api/bank-statements/${id}/links`))); }
  receivedOdooInvoices(id: number, afterId = 0): Promise<ReceivedOdooInvoicePage> { return firstValueFrom(this.http.get<ReceivedOdooInvoicePage>(api(`/api/bank-statements/${id}/odoo-purchase-invoices`), { params: { afterId, limit: 50 } })); }
  previewReceivedOdooInvoice(id: number, invoiceId: number, existingCompanyCostId?: number): Promise<ReceivedOdooInvoicePreview> { return firstValueFrom(this.http.get<ReceivedOdooInvoicePreview>(api(`/api/bank-statements/${id}/odoo-purchase-invoices/${invoiceId}/preview`), { params: existingCompanyCostId ? { existingCompanyCostId } : {} })); }
  linkReceivedOdooInvoice(id: number, body: { odooInvoiceId: number; snapshotHash: string; existingCompanyCostId?: number; category?: string }): Promise<ReceivedOdooInvoiceResult> { return firstValueFrom(this.http.post<ReceivedOdooInvoiceResult>(api(`/api/bank-statements/${id}/odoo-purchase-invoice`), body)); }
  delete(id: number): Promise<void> { return firstValueFrom(this.http.delete<void>(api(`/api/bank-statements/${id}`))); }
}
