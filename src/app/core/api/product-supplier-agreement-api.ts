import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import type { ProductSupplierAgreementPhoto } from './models';

export interface SupplierAgreementVariant {
  productId: number;
  sku: string;
  name: string;
  color: string | null;
  hasOwnAgreement: boolean;
}

export interface ProductSupplierAgreement {
  productId: number;
  sourceProductId: number;
  supplierId: number | null;
  familyId: number | null;
  groupKey: string;
  inherited: boolean;
  available: boolean;
  revision: string;
  note: string | null;
  photos: ProductSupplierAgreementPhoto[];
  variants: SupplierAgreementVariant[];
  eligibleVariants: SupplierAgreementVariant[];
}

@Injectable({ providedIn: 'root' })
export class ProductSupplierAgreementApi {
  private readonly http = inject(HttpClient);
  get(productId: number): Promise<ProductSupplierAgreement> {
    return firstValueFrom(this.http.get<ProductSupplierAgreement>(api(`/api/products/${productId}/supplier-agreement`)));
  }
  saveApplicability(productId: number, revision: string, productIds: number[]): Promise<ProductSupplierAgreement> {
    return firstValueFrom(this.http.put<ProductSupplierAgreement>(api(`/api/products/${productId}/supplier-agreement/applicability`), { revision, productIds }));
  }
  unlink(productId: number, revision: string): Promise<ProductSupplierAgreement> {
    return firstValueFrom(this.http.put<ProductSupplierAgreement>(api(`/api/products/${productId}/supplier-agreement/unlink`), { revision }));
  }
}
