import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import type { PurchasePayment, PurchasePaymentWrite } from './models';

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
export interface BankStatementLine {
  id: number; account: string; fingerprint: string; amountEur: number; bookedAt: string; timeZone: string;
  reference: string; counterparty: string; recordedAt: string; actor: string;
  salesPaymentId: number | null; salesOrderId: number | null; allocatedAt: string | null; allocationCreatedPayment: boolean;
  source?: 'ODOO' | null; sourceId?: string | null; sourceUpdatedAt?: string | null; sourceReconciled?: boolean | null;
  allocated?: boolean; allocationLabel?: string | null;
}
@Injectable({ providedIn: 'root' })
export class BankingApi {
  private readonly http = inject(HttpClient);
  list(): Promise<BankStatementLine[]> { return firstValueFrom(this.http.get<BankStatementLine[]>(api('/api/bank-statements'))); }
  create(body: BankMovementRequest): Promise<BankStatementLine> { return firstValueFrom(this.http.post<BankStatementLine>(api('/api/bank-statements'), body)); }
  suggestions(id: number): Promise<BankMatch[]> { return firstValueFrom(this.http.get<BankMatch[]>(api(`/api/bank-statements/${id}/suggestions`))); }
  allocate(id: number, salesOrderId: number, existingPaymentId: number | null): Promise<BankStatementLine> { return firstValueFrom(this.http.post<BankStatementLine>(api(`/api/bank-statements/${id}/allocation`), { salesOrderId, existingPaymentId })); }
  unallocate(id: number): Promise<void> { return firstValueFrom(this.http.delete<void>(api(`/api/bank-statements/${id}/allocation`))); }
  linkPayments(id: number, body: BankPaymentLinks): Promise<BankStatementLine> { return firstValueFrom(this.http.post<BankStatementLine>(api(`/api/bank-statements/${id}/links`), body)); }
  addPurchasePayment(id: number, purchaseOrderId: number, payments: PurchasePaymentWrite[]): Promise<{ line: BankStatementLine; payments: PurchasePayment[] }> { return firstValueFrom(this.http.post<{ line: BankStatementLine; payments: PurchasePayment[] }>(api(`/api/bank-statements/${id}/purchase-payment`), { purchaseOrderId, payments })); }
  addCostPayment(id: number, companyCostId: number): Promise<BankStatementLine> { return firstValueFrom(this.http.post<BankStatementLine>(api(`/api/bank-statements/${id}/cost-payment`), { companyCostId })); }
  unlinkPayments(id: number): Promise<void> { return firstValueFrom(this.http.delete<void>(api(`/api/bank-statements/${id}/links`))); }
  delete(id: number): Promise<void> { return firstValueFrom(this.http.delete<void>(api(`/api/bank-statements/${id}`))); }
}
