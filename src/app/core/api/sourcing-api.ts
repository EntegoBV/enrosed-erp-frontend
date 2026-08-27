import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import {
  FreightRate, LandedCost, MarketSourceStatus, PurchaseOrder, PurchaseOrderView, Supplier, Receipt, ExpectedStock, PurchasePayment, Currency, Payee, PurchaseDocument, DocumentKind,
} from './models';

export type PurchasePdfLayout = 'PORTRAIT' | 'LANDSCAPE';

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

  purchaseOrder(id: number): Promise<PurchaseOrderView> {
    return firstValueFrom(this.http.get<PurchaseOrderView>(api(`/api/purchase-orders/${id}`)));
  }

  createPurchaseOrder(supplierId: number, cnyToUsd: number, usdToEur: number,
                      defaultDutyRatePct: number): Promise<PurchaseOrderView> {
    return firstValueFrom(this.http.post<PurchaseOrderView>(api('/api/purchase-orders'),
      { supplierId, cnyToUsd, usdToEur, defaultDutyRatePct }));
  }

  /** The calculation for an order as it stands on screen, without saving. */
  previewPurchaseOrder(id: number, order: PurchaseOrder): Promise<PurchaseOrderView> {
    return firstValueFrom(
      this.http.post<PurchaseOrderView>(api(`/api/purchase-orders/${id}/preview`), order));
  }

  updatePurchaseOrder(id: number, order: PurchaseOrder): Promise<PurchaseOrderView> {
    return firstValueFrom(
      this.http.put<PurchaseOrderView>(api(`/api/purchase-orders/${id}`), order));
  }

  /**
   * Purchase PDF in one of two explicit paper jobs. Existing callers keep the
   * historical landscape calculation because LANDSCAPE remains the default.
   */
  purchasePdf(id: number, showRevenue: boolean,
              layout: PurchasePdfLayout = 'LANDSCAPE'): Promise<Blob> {
    return firstValueFrom(this.http.get(
      api(`/api/purchase-orders/${id}/pdf?showRevenue=${showRevenue}&layout=${layout}`),
      { responseType: 'blob' }));
  }

  /** The container is in: counts, damage, payment, and optionally the booking. */
  receivePurchaseOrder(id: number, receipt: Receipt): Promise<PurchaseOrderView> {
    return firstValueFrom(this.http.post<PurchaseOrderView>(api(`/api/purchase-orders/${id}/receive`), receipt));
  }

  /** Books the usable pieces of a received container into stock - once. */
  bookPurchaseStock(id: number): Promise<PurchaseOrderView> {
    return firstValueFrom(this.http.post<PurchaseOrderView>(api(`/api/purchase-orders/${id}/book-stock`), {}));
  }

  payments(orderId: number): Promise<PurchasePayment[]> {
    return firstValueFrom(this.http.get<PurchasePayment[]>(api(`/api/purchase-orders/${orderId}/payments`)));
  }

  addPayment(orderId: number, payment: { paidOn: string; amount: number; currency: Currency; label: string | null; payee: Payee }): Promise<PurchasePayment> {
    return firstValueFrom(this.http.post<PurchasePayment>(api(`/api/purchase-orders/${orderId}/payments`), payment));
  }

  deletePayment(orderId: number, paymentId: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/purchase-orders/${orderId}/payments/${paymentId}`)));
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

  addFreightRate(route: string, usdPerContainer: number,
                 quotedOn: string | null = null): Promise<FreightRate> {
    return firstValueFrom(this.http.post<FreightRate>(api('/api/freight-rates'),
        { id: null, route, quotedOn, usdPerContainer }));
  }

  deleteFreightRate(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/freight-rates/${id}`)));
  }

}
