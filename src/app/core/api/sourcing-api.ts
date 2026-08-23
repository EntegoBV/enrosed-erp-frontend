import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import { FreightRate, LandedCost, MarketSourceStatus, PurchaseOrder, PurchaseOrderView, Supplier } from './models';

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

  /** The calculation as a PDF; with or without the extra revenue as a line. */
  purchasePdf(id: number, showRevenue: boolean): Promise<Blob> {
    return firstValueFrom(this.http.get(
      api(`/api/purchase-orders/${id}/pdf?showRevenue=${showRevenue}`), { responseType: 'blob' }));
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
