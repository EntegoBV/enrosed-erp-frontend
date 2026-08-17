import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import { LandedCost, PurchaseOrder, PurchaseOrderView, Supplier } from './models';

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

  updatePurchaseOrder(id: number, order: PurchaseOrder): Promise<PurchaseOrderView> {
    return firstValueFrom(
      this.http.put<PurchaseOrderView>(api(`/api/purchase-orders/${id}`), order));
  }

  /** De calculatie als PDF; met of zonder de gewenste extra opbrengst als regel. */
  purchasePdf(id: number, showRevenue: boolean): Promise<Blob> {
    return firstValueFrom(this.http.get(
      api(`/api/purchase-orders/${id}/pdf?showRevenue=${showRevenue}`), { responseType: 'blob' }));
  }

  /** Kopieert de calculatie om er snel een variant van door te rekenen. */
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
}
