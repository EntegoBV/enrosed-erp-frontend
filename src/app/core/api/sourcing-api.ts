import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import {
  FreightRate, LandedCost, MarketSourceStatus, PurchaseOrder, PurchaseOrderView, Supplier, Receipt,
  ReceiptVarianceFilters, ReceiptVarianceReport, ReceiptIssue, ExpectedStock, PurchasePayment, Currency, Payee,
  PurchaseDocument, DocumentKind, PartnerFinancing, PurchasePaymentRow, PurchaseReconciliation,
  PartnerAdvanceSchedule, PartnerAdvanceScheduleRequest, PartnerSettlementAvailability, SalesOrderView,
} from './models';
import {
  PurchasePdfAudience, PurchasePdfLayout, PurchasePdfOptions, purchasePdfQuery,
} from './purchase-pdf-options';
import { DEFAULT_PURCHASE_CONTAINER_TYPE, PurchaseContainerType } from './geo';

export type {
  NormalizedPurchasePdfOptions, PurchasePdfAudience, PurchasePdfLayout, PurchasePdfOptions,
} from './purchase-pdf-options';

@Injectable({ providedIn: 'root' })
export class SourcingApi {
  private readonly http = inject(HttpClient);

  suppliers(): Promise<Supplier[]> {
    return firstValueFrom(this.http.get<Supplier[]>(api('/api/suppliers')));
  }

  createSupplier(supplier: Supplier): Promise<Supplier> {
    return firstValueFrom(this.http.post<Supplier>(api('/api/suppliers'), supplier));
  }

  updateSupplier(id: number, supplier: Supplier): Promise<Supplier> {
    return firstValueFrom(this.http.put<Supplier>(api(`/api/suppliers/${id}`), supplier));
  }

  deleteSupplier(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/suppliers/${id}`)));
  }

  purchaseOrders(): Promise<PurchaseOrderView[]> {
    return firstValueFrom(this.http.get<PurchaseOrderView[]>(api('/api/purchase-orders')));
  }

  partnerFinancings(): Promise<PartnerFinancing[]> {
    return firstValueFrom(this.http.get<PartnerFinancing[]>(api('/api/partner-financing')));
  }

  partnerFinancing(id: number): Promise<PartnerFinancing> {
    return firstValueFrom(this.http.get<PartnerFinancing>(api(`/api/purchase-orders/${id}/partner-financing`)));
  }

  partnerAdvanceSchedule(id: number): Promise<PartnerAdvanceSchedule> {
    return firstValueFrom(this.http.get<PartnerAdvanceSchedule>(api(`/api/purchase-orders/${id}/partner-advance-schedule`)));
  }

  savePartnerAdvanceSchedule(id: number, body: PartnerAdvanceScheduleRequest): Promise<PartnerAdvanceSchedule> {
    return firstValueFrom(this.http.put<PartnerAdvanceSchedule>(api(`/api/purchase-orders/${id}/partner-advance-schedule`), body));
  }

  invoicePartnerAdvance(id: number, rowId: number): Promise<SalesOrderView> {
    return firstValueFrom(this.http.post<SalesOrderView>(api(`/api/purchase-orders/${id}/partner-advance-schedule/${rowId}/invoice`), {}));
  }

  partnerSettlementAvailability(id: number): Promise<PartnerSettlementAvailability> {
    return firstValueFrom(this.http.get<PartnerSettlementAvailability>(api(`/api/purchase-orders/${id}/partner-settlement-availability`)));
  }

  purchaseOrder(id: number): Promise<PurchaseOrderView> {
    return firstValueFrom(this.http.get<PurchaseOrderView>(api(`/api/purchase-orders/${id}`)));
  }

  createPurchaseOrder(supplierId: number, cnyToUsd: number, usdToEur: number,
                      defaultDutyRatePct: number,
                      containerType: PurchaseContainerType = DEFAULT_PURCHASE_CONTAINER_TYPE)
      : Promise<PurchaseOrderView> {
    return firstValueFrom(this.http.post<PurchaseOrderView>(api('/api/purchase-orders'),
      { supplierId, cnyToUsd, usdToEur, defaultDutyRatePct, containerType }));
  }

  /** The calculation for an order as it stands on screen, without saving. */
  previewPurchaseOrder(id: number, order: PurchaseOrder): Promise<PurchaseOrderView> {
    return firstValueFrom(
      this.http.post<PurchaseOrderView>(api(`/api/purchase-orders/${id}/preview`), order));
  }

  /** A partner comes in, the deal changes, or the partner leaves; a null customer ends the deal. */
  setPartner(id: number, request: { customerId: number | null; costPct: number | null; sharePct: number | null }): Promise<PurchaseOrderView> {
    return firstValueFrom(this.http.put<PurchaseOrderView>(api(`/api/purchase-orders/${id}/partner`), request));
  }

  updatePurchaseOrder(id: number, order: PurchaseOrder): Promise<PurchaseOrderView> {
    return firstValueFrom(
      this.http.put<PurchaseOrderView>(api(`/api/purchase-orders/${id}`), order));
  }

  /** Purchase PDF in one of two A4 orientations, with explicit portrait display options. */
  purchasePdf(id: number, options: PurchasePdfOptions): Promise<Blob>;
  /** Backwards-compatible signature for older callers. */
  purchasePdf(id: number, showRevenue: boolean,
              layout?: PurchasePdfLayout, audience?: PurchasePdfAudience): Promise<Blob>;
  purchasePdf(id: number, optionsOrRevenue: PurchasePdfOptions | boolean,
              layout: PurchasePdfLayout = 'LANDSCAPE',
              audience?: PurchasePdfAudience): Promise<Blob> {
    const options: PurchasePdfOptions = typeof optionsOrRevenue === 'boolean'
      ? { showRevenue: optionsOrRevenue, layout, audience }
      : optionsOrRevenue;
    return firstValueFrom(this.http.get(
      api(`/api/purchase-orders/${id}/pdf?${purchasePdfQuery(options)}`),
      { responseType: 'blob' }));
  }

  /** The container is in: counts, damage, payment, and optionally the booking. */
  receivePurchaseOrder(id: number, receipt: Receipt): Promise<PurchaseOrderView> {
    return firstValueFrom(this.http.post<PurchaseOrderView>(api(`/api/purchase-orders/${id}/receive`), receipt));
  }

  /** Earlier containers on which one product arrived short or damaged, newest first. */
  /** Damage or a shortage found while unpacking, booked against the container it came on. */
  reportAfterReceipt(orderId: number, body: {
    productId: number; locationId: number | null; quantity: number; kind: 'DAMAGED' | 'SHORTAGE'; note: string | null;
  }): Promise<PurchaseOrderView> {
    return firstValueFrom(this.http.post<PurchaseOrderView>(api(`/api/purchase-orders/${orderId}/receipt-reports`), body));
  }

  receiptIssues(productId: number, excludeOrderId?: number): Promise<ReceiptIssue[]> {
    const query = new URLSearchParams({ productId: String(productId) });
    if (excludeOrderId !== undefined) query.set('excludeOrderId', String(excludeOrderId));
    return firstValueFrom(this.http.get<ReceiptIssue[]>(api(`/api/purchase-orders/receipt-issues?${query}`)));
  }

  /** Historical shortages and damage, optionally narrowed to a reporting period or entity. */
  receiptVariances(filters: ReceiptVarianceFilters = {}): Promise<ReceiptVarianceReport> {
    const query = new URLSearchParams();
    if (filters.from) query.set('from', filters.from);
    if (filters.to) query.set('to', filters.to);
    if (filters.supplierId != null) query.set('supplierId', String(filters.supplierId));
    if (filters.productId != null) query.set('productId', String(filters.productId));
    if (filters.orderId != null) query.set('orderId', String(filters.orderId));
    const suffix = query.size ? `?${query}` : '';
    return firstValueFrom(this.http.get<ReceiptVarianceReport>(
      api('/api/purchase-orders/receipt-variances' + suffix)));
  }

  /** Supplies or clears the frozen receipt value for one legacy/unknown line. */
  setReceiptLineValue(orderId: number, lineId: number, unitValueEur: number | null): Promise<void> {
    return firstValueFrom(this.http.put<void>(
      api(`/api/purchase-orders/${orderId}/receipt-lines/${lineId}/value`), { unitValueEur }));
  }

  /** Books the usable pieces of a received container into stock - once. */
  bookPurchaseStock(id: number): Promise<PurchaseOrderView> {
    return firstValueFrom(this.http.post<PurchaseOrderView>(api(`/api/purchase-orders/${id}/book-stock`), {}));
  }

  payments(orderId: number): Promise<PurchasePayment[]> {
    return firstValueFrom(this.http.get<PurchasePayment[]>(api(`/api/purchase-orders/${orderId}/payments`)));
  }

  purchaseReconciliation(orderId: number): Promise<PurchaseReconciliation> {
    return firstValueFrom(this.http.get<PurchaseReconciliation>(api(`/api/purchase-orders/${orderId}/reconciliation`)));
  }

  purchasePaymentsPdf(orderId: number): Promise<Blob> {
    return firstValueFrom(this.http.get(api(`/api/purchase-orders/${orderId}/payments/pdf`), { responseType: 'blob' }));
  }

  addPayment(orderId: number, payment: { paidOn: string; amount: number; currency: Currency; label: string | null; payee: Payee; settles?: boolean; instalmentDue?: PurchasePayment['instalmentDue'] }): Promise<PurchasePayment> {
    return firstValueFrom(this.http.post<PurchasePayment>(api(`/api/purchase-orders/${orderId}/payments`), payment));
  }

  updatePayment(orderId: number, paymentId: number, payment: { paidOn: string; amount: number; currency: Currency; label: string | null; payee: Payee; settles?: boolean; instalmentDue?: PurchasePayment['instalmentDue'] }): Promise<PurchasePayment> {
    return firstValueFrom(this.http.put<PurchasePayment>(api(`/api/purchase-orders/${orderId}/payments/${paymentId}`), payment));
  }

  deletePayment(orderId: number, paymentId: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/purchase-orders/${orderId}/payments/${paymentId}`)));
  }

  /** Every payment on every container from a day on: what left the bank for purchasing. */
  purchasePayments(from?: string | null): Promise<PurchasePaymentRow[]> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    return firstValueFrom(this.http.get<PurchasePaymentRow[]>(api('/api/purchase-payments'), { params }));
  }

  documents(orderId: number): Promise<PurchaseDocument[]> {
    return firstValueFrom(this.http.get<PurchaseDocument[]>(api(`/api/purchase-orders/${orderId}/documents`)))
      .then((list) => list.map((doc) => ({ ...doc, orderId })));
  }

  addDocument(orderId: number, file: File, kind: DocumentKind, label: string | null, paymentId: number | null): Promise<PurchaseDocument> {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('kind', kind);
    if (label) form.append('label', label);
    if (paymentId !== null) form.append('paymentId', String(paymentId));
    return firstValueFrom(this.http.post<PurchaseDocument>(api(`/api/purchase-orders/${orderId}/documents`), form))
      .then((doc) => ({ ...doc, orderId }));
  }

  documentFile(orderId: number, documentId: number): Promise<Blob> {
    return firstValueFrom(this.http.get(api(`/api/purchase-orders/${orderId}/documents/${documentId}/file`), { responseType: 'blob' }));
  }

  renameDocument(orderId: number, documentId: number, label: string | null): Promise<PurchaseDocument> {
    return firstValueFrom(this.http.put<PurchaseDocument>(
      api(`/api/purchase-orders/${orderId}/documents/${documentId}/label`), { label }));
  }

  deleteDocument(orderId: number, documentId: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/purchase-orders/${orderId}/documents/${documentId}`)));
  }

  /** Pieces on the water, per product. */
  expectedStock(): Promise<ExpectedStock[]> {
    return firstValueFrom(this.http.get<ExpectedStock[]>(api('/api/purchase-orders/expected-stock')));
  }

  /** Copies the calculation to price a variant quickly. */
  duplicatePurchaseOrder(id: number): Promise<PurchaseOrderView> {
    return firstValueFrom(this.http.post<PurchaseOrderView>(
      api(`/api/purchase-orders/${id}/duplicate`), {}));
  }

  deletePurchaseOrder(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/purchase-orders/${id}`)));
  }

  /** Off the working list into the archive tab; the order itself does not change. */
  archivePurchaseOrder(id: number): Promise<PurchaseOrderView> {
    return firstValueFrom(this.http.post<PurchaseOrderView>(
      api(`/api/purchase-orders/${id}/archive`), {}));
  }

  unarchivePurchaseOrder(id: number): Promise<PurchaseOrderView> {
    return firstValueFrom(this.http.post<PurchaseOrderView>(
      api(`/api/purchase-orders/${id}/unarchive`), {}));
  }

  /** Legt de berekende kostprijzen vast op de producten. */
  applyLandedCosts(id: number): Promise<LandedCost> {
    return firstValueFrom(this.http.post<LandedCost>(api(`/api/purchase-orders/${id}/apply`), {}));
  }
  /* ---- freight-rate log (dashboard market card) ---- */

  freightRates(): Promise<FreightRate[]> {
    return firstValueFrom(this.http.get<FreightRate[]>(api('/api/freight-rates')));
  }

  marketSourceStatuses(): Promise<MarketSourceStatus[]> {
    return firstValueFrom(this.http.get<MarketSourceStatus[]>(
        api('/api/freight-rates/market-sources')));
  }

  /** One extra lookup of a single market source right now, outside the daily cadence. */
  refreshMarketSource(code: string): Promise<MarketSourceStatus> {
    return firstValueFrom(this.http.post<MarketSourceStatus>(
        api(`/api/freight-rates/market-sources/${encodeURIComponent(code)}/refresh`), {}));
  }

  addFreightRate(route: string, usdPerContainer: number,
                 quotedOn: string | null = null): Promise<FreightRate> {
    return firstValueFrom(this.http.post<FreightRate>(api('/api/freight-rates'),
        { id: null, route, quotedOn, usdPerContainer }));
  }

  deleteFreightRate(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/freight-rates/${id}`)));
  }

}
