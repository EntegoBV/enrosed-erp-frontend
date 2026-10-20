import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import type { Instalment, Payee, PurchasePayment, PurchasePaymentWrite } from './models';
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
export interface BankPaymentLinks { purchasePaymentIds?: number[]; companyCostId?: number; costPaymentId?: number;
  /** One cost payment only: its amount, day and account follow the line before the link (2026-10-16). */
  followBank?: boolean;
  /** Purchase payments only, the bank paid more: the difference becomes a paid company cost on the same line. */
  keepDifferenceAs?: 'BANKKOSTEN' | 'KOERSVERSCHIL' | null; }
export interface BankAccount {
  key: string; label: string; source: 'MANUAL' | 'ODOO'; archived: boolean; aliases: string[];
  odooJournalId: number | null; manualMovementsAllowed: boolean;
  /** Counts in the Kaslijn and the Kasprognose; missing (a server before 2026-10-16) = true. */
  countsInCash?: boolean;
}
/** "Boeken als…": a bank transaction that pays no invoice or cost. Plain text on the server (spec D3). */
export type BankClassification = 'INTERNAL_TRANSFER' | 'CANCELLATION' | 'VAT' | 'LOAN' | 'CAPITAL' | 'PRIVATE' | 'OTHER' | 'TICA_SETTLEMENT';
export interface BankClassificationRequest { classification: BankClassification; note: string | null; transferLineId: number | null; vatPeriod: string | null; }
/**
 * One part of POST …/{id}/purchase-payment. `purchaseOrderId` lets one
 * transfer pay several containers (owner addition 2026-10-15); a part
 * without it belongs to the request's purchaseOrderId.
 */
export interface BankPurchasePaymentPart extends PurchasePaymentWrite { purchaseOrderId?: number | null; }
/**
 * One part of POST …/{id}/purchase-share ("Verdelen over containers", Emre
 * 2026-10-16): exactly one of `paymentId` (an open payment, linked with this
 * part; `expectedAmountEur` is its euro as the screen saw it) or
 * `purchaseOrderId` (a new euro payment on that container, described by the
 * other fields). Every part takes the line's day.
 */
export interface BankPurchaseSharePart {
  paymentId?: number; purchaseOrderId?: number; amountEur: number; expectedAmountEur?: number | null;
  payee?: Payee; instalmentDue?: Instalment['due'] | null; label?: string | null; settles?: boolean; invoiceId?: number | null;
  inspectionViaSupplier?: boolean | null;
}
/** What happened to one part: linked as it was (its day follows), grown to the part, carved out (the rest stays open), or new. */
export interface BankPurchaseShareOutcome {
  paymentId: number; orderId: number; amountEur: number; outcome: 'LINKED' | 'GREW' | 'CARVED' | 'CREATED';
  wasEur: number | null; wasPaidOn: string | null; restPaymentId: number | null;
}
/** The line as described now, the payment on the line per part (request order) and what happened per part. */
export interface BankPurchaseShareResult { line: BankStatementLine; payments: PurchasePayment[]; parts: BankPurchaseShareOutcome[]; }
export type BankAccountWrite = Pick<BankAccount, 'label' | 'source' | 'aliases' | 'odooJournalId'>;
export interface BankStatementLine {
  id: number; account: string; fingerprint: string; amountEur: number; bookedAt: string; timeZone: string;
  reference: string; counterparty: string; recordedAt: string; actor: string;
  salesPaymentId: number | null; salesOrderId: number | null; allocatedAt: string | null; allocationCreatedPayment: boolean;
  source?: 'ODOO' | null; sourceId?: string | null; sourceUpdatedAt?: string | null; sourceReconciled?: boolean | null;
  allocated?: boolean; allocationLabel?: string | null;
  /** A TICA settlement receipt is already allocated and cannot be reused elsewhere. */
  ticaSettlementId?: number | null;
  ticaSettlementAmountEur?: number | null;
  allocatedAmountEur?: number | null; allocationDifferenceEur?: number | null;
  /** "Boeken als…" (2026-10-16; missing = null). A classified line is allocated. */
  classification?: BankClassification | null; classificationNote?: string | null; transferLineId?: number | null;
  /** 'YYYY-Qn' for a VAT classification. */
  vatPeriod?: string | null; classifiedAt?: string | null; classifiedBy?: string | null;
}
@Injectable({ providedIn: 'root' })
export class BankingApi {
  private readonly http = inject(HttpClient);
  accounts(): Promise<BankAccount[]> { return firstValueFrom(this.http.get<BankAccount[]>(api('/api/bank-accounts'))); }
  updateAccount(key: string, body: BankAccountWrite): Promise<BankAccount> { return firstValueFrom(this.http.put<BankAccount>(api(`/api/bank-accounts/${encodeURIComponent(key)}`), body)); }
  archiveAccount(key: string): Promise<void> { return firstValueFrom(this.http.delete<void>(api(`/api/bank-accounts/${encodeURIComponent(key)}`))); }
  restoreAccount(key: string): Promise<BankAccount> { return firstValueFrom(this.http.post<BankAccount>(api(`/api/bank-accounts/${encodeURIComponent(key)}/restore`), {})); }
  /** Every line, or with `from` (YYYY-MM-DD) the lines booked from that day plus every line still to link; an older server ignores it. */
  list(from?: string | null): Promise<BankStatementLine[]> {
    const params = from ? new HttpParams().set('from', from) : undefined;
    return firstValueFrom(this.http.get<BankStatementLine[]>(api('/api/bank-statements'), params ? { params } : {}));
  }
  create(body: BankMovementRequest): Promise<BankStatementLine> { return firstValueFrom(this.http.post<BankStatementLine>(api('/api/bank-statements'), body)); }
  suggestions(id: number): Promise<BankMatch[]> { return firstValueFrom(this.http.get<BankMatch[]>(api(`/api/bank-statements/${id}/suggestions`))); }
  /** `followBank`: the existing receipt takes the line's amount, moment and account first (sent only when true). */
  allocate(id: number, salesOrderId: number, existingPaymentId: number | null, followBank = false): Promise<BankStatementLine> { return firstValueFrom(this.http.post<BankStatementLine>(api(`/api/bank-statements/${id}/allocation`), { salesOrderId, existingPaymentId, ...(followBank ? { followBank: true } : {}) })); }
  unallocate(id: number): Promise<void> { return firstValueFrom(this.http.delete<void>(api(`/api/bank-statements/${id}/allocation`))); }
  linkPayments(id: number, body: BankPaymentLinks): Promise<BankStatementLine> { return firstValueFrom(this.http.post<BankStatementLine>(api(`/api/bank-statements/${id}/links`), body)); }
  /** One transfer, one or more payments: each part on the request's order unless it names its own purchaseOrderId (one transfer for several containers). */
  addPurchasePayment(id: number, purchaseOrderId: number, payments: BankPurchasePaymentPart[]): Promise<{ line: BankStatementLine; payments: PurchasePayment[] }> { return firstValueFrom(this.http.post<{ line: BankStatementLine; payments: PurchasePayment[] }>(api(`/api/bank-statements/${id}/purchase-payment`), { purchaseOrderId, payments })); }
  /** "Verdelen over containers": one transaction over open payments and new ones, in one call; an identical retry answers the same rows. */
  sharePurchasePayment(id: number, parts: BankPurchaseSharePart[]): Promise<BankPurchaseShareResult> { return firstValueFrom(this.http.post<BankPurchaseShareResult>(api(`/api/bank-statements/${id}/purchase-share`), { parts })); }
  addCostPayment(id: number, companyCostId: number, confirmNewPayment = false): Promise<BankStatementLine> { return firstValueFrom(this.http.post<BankStatementLine>(api(`/api/bank-statements/${id}/cost-payment`), { companyCostId, ...(confirmNewPayment ? { confirmNewPayment } : {}) })); }
  unlinkPayments(id: number): Promise<void> { return firstValueFrom(this.http.delete<void>(api(`/api/bank-statements/${id}/links`))); }
  receivedOdooInvoices(id: number, afterId = 0): Promise<ReceivedOdooInvoicePage> { return firstValueFrom(this.http.get<ReceivedOdooInvoicePage>(api(`/api/bank-statements/${id}/odoo-purchase-invoices`), { params: { afterId, limit: 50 } })); }
  previewReceivedOdooInvoice(id: number, invoiceId: number, existingCompanyCostId?: number): Promise<ReceivedOdooInvoicePreview> { return firstValueFrom(this.http.get<ReceivedOdooInvoicePreview>(api(`/api/bank-statements/${id}/odoo-purchase-invoices/${invoiceId}/preview`), { params: existingCompanyCostId ? { existingCompanyCostId } : {} })); }
  linkReceivedOdooInvoice(id: number, body: { odooInvoiceId: number; snapshotHash: string; existingCompanyCostId?: number; category?: string }): Promise<ReceivedOdooInvoiceResult> { return firstValueFrom(this.http.post<ReceivedOdooInvoiceResult>(api(`/api/bank-statements/${id}/odoo-purchase-invoice`), body)); }
  delete(id: number): Promise<void> { return firstValueFrom(this.http.delete<void>(api(`/api/bank-statements/${id}`))); }
  /** "Boeken als…"; the answer carries the line and, for an internal transfer, its other leg (ascending id). */
  classify(id: number, body: BankClassificationRequest): Promise<{ lines: BankStatementLine[] }> { return firstValueFrom(this.http.post<{ lines: BankStatementLine[] }>(api(`/api/bank-statements/${id}/classification`), body)); }
  /** Undoes "Boeken als…" (both legs of an internal transfer). */
  unclassify(id: number): Promise<void> { return firstValueFrom(this.http.delete<void>(api(`/api/bank-statements/${id}/classification`))); }
  /** "Telt mee in de kasprognose" on or off. */
  setCountsInCash(key: string, counts: boolean): Promise<BankAccount> { return firstValueFrom(this.http.put<BankAccount>(api(`/api/bank-accounts/${encodeURIComponent(key)}/cash`), { counts })); }
}
