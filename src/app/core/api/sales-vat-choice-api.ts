import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import type { SalesOrderView } from './models';

/**
 * The VAT route of one sales document: through our fiscal representative in the Netherlands, the
 * plain Belgian rules, or a service without goods (only on a document without product lines).
 */
export type SalesVatRoute = 'FISCAL_REPRESENTATIVE' | 'BELGIUM' | 'SERVICE';

export interface SalesVatChoice {
  /** What the document is priced with. */
  route: SalesVatRoute;
  /** What it would be without a choice: the customer's standard. */
  customerRoute: SalesVatRoute;
  chosen: boolean;
  /** What may be picked; one entry means there is nothing to choose. */
  options: SalesVatRoute[];
  editable: boolean;
  lockedReason: string | null;
  /** The document holds the regime of an issue: now, or before it was reopened. */
  pinned: boolean;
  /** A reopened invoice still on the route it was issued on: a change must be confirmed by staff first. */
  needsConfirm: boolean;
}

@Injectable({ providedIn: 'root' })
export class SalesVatChoiceApi {
  private readonly http = inject(HttpClient);

  get(id: number): Promise<SalesVatChoice> {
    return firstValueFrom(this.http.get<SalesVatChoice>(api(`/api/sales-orders/${id}/vat-choice`)));
  }

  /** The answer is the document as it is priced on the new route. */
  save(id: number, route: SalesVatRoute, confirmed = false): Promise<SalesOrderView> {
    return firstValueFrom(this.http.put<SalesOrderView>(api(`/api/sales-orders/${id}/vat-choice`), { route, confirmed }));
  }
}
