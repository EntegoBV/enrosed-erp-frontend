import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import { BankBalance, CompanyCost, RecurringCost } from './models';

/** The company's own money: costs, the recurring ones the server books, and what the bank holds. */
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

  /** Settles an open cost; no day means today. */
  markCostPaid(id: number, paidOn?: string | null): Promise<CompanyCost> {
    return firstValueFrom(this.http.post<CompanyCost>(api(`/api/costs/${id}/paid`), { paidOn: paidOn ?? null }));
  }

  deleteCost(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/costs/${id}`)));
  }

  recurringCosts(): Promise<RecurringCost[]> {
    return firstValueFrom(this.http.get<RecurringCost[]>(api('/api/recurring-costs')));
  }

  createRecurringCost(definition: RecurringCost): Promise<RecurringCost> {
    return firstValueFrom(this.http.post<RecurringCost>(api('/api/recurring-costs'), definition));
  }

  updateRecurringCost(id: number, definition: RecurringCost): Promise<RecurringCost> {
    return firstValueFrom(this.http.put<RecurringCost>(api(`/api/recurring-costs/${id}`), definition));
  }

  deleteRecurringCost(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/recurring-costs/${id}`)));
  }

  /** Books everything due today right now; returns the costs it created. */
  bookRecurringCosts(): Promise<CompanyCost[]> {
    return firstValueFrom(this.http.post<CompanyCost[]>(api('/api/recurring-costs/book'), {}));
  }

  bankBalances(): Promise<BankBalance[]> {
    return firstValueFrom(this.http.get<BankBalance[]>(api('/api/bank-balances')));
  }

  createBankBalance(balance: BankBalance): Promise<BankBalance> {
    return firstValueFrom(this.http.post<BankBalance>(api('/api/bank-balances'), balance));
  }

  updateBankBalance(id: number, balance: BankBalance): Promise<BankBalance> {
    return firstValueFrom(this.http.put<BankBalance>(api(`/api/bank-balances/${id}`), balance));
  }

  deleteBankBalance(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/bank-balances/${id}`)));
  }
}
