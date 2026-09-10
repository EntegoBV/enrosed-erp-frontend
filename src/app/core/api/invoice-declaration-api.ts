import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';

export type InvoiceDeclarationMode = 'DEFAULT' | 'CUSTOMS_REPRESENTATIVE' | 'REVERSE_CHARGE';
export interface InvoiceDeclarationRequest {
  mode: InvoiceDeclarationMode;
  reference: string | null;
}
export interface InvoiceDeclaration extends InvoiceDeclarationRequest { textVersion: 1 }

@Injectable({ providedIn: 'root' })
export class InvoiceDeclarationApi {
  private readonly http = inject(HttpClient);

  get(id: number): Promise<InvoiceDeclaration> {
    return firstValueFrom(this.http.get<InvoiceDeclaration>(api(`/api/sales-orders/${id}/invoice-declaration`)));
  }

  save(id: number, declaration: InvoiceDeclarationRequest): Promise<InvoiceDeclaration> {
    return firstValueFrom(this.http.put<InvoiceDeclaration>(api(`/api/sales-orders/${id}/invoice-declaration`), { ...declaration, textVersion: 1 }));
  }
}
