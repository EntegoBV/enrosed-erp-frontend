import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import { CompanyCost } from './models';

/** The company's own costs: the fair, the accountant, rent, the TICA stand. */
@Injectable({ providedIn: 'root' })
export class FinanceApi {
  private readonly http = inject(HttpClient);

  costs(from?: string | null, to?: string | null): Promise<CompanyCost[]> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return firstValueFrom(this.http.get<CompanyCost[]>(api('/api/costs'), { params }));
  }

  createCost(cost: CompanyCost): Promise<CompanyCost> {
    return firstValueFrom(this.http.post<CompanyCost>(api('/api/costs'), cost));
  }

  updateCost(id: number, cost: CompanyCost): Promise<CompanyCost> {
    return firstValueFrom(this.http.put<CompanyCost>(api(`/api/costs/${id}`), cost));
  }

  deleteCost(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/costs/${id}`)));
  }
}
