import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import { BankBalance, CompanyCost, CostParty, Fair, RecurringCost } from './models';

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

  /* The "Aan wie" list: the server learns a name from every booking, the list edits the defaults. */
  costParties(): Promise<CostParty[]> {
    return firstValueFrom(this.http.get<CostParty[]>(api('/api/cost-parties')));
  }

  createCostParty(party: CostParty): Promise<CostParty> {
    return firstValueFrom(this.http.post<CostParty>(api('/api/cost-parties'), party));
  }

  /** A new name renames the bookings on the old one. */
  updateCostParty(id: number, party: CostParty): Promise<CostParty> {
    return firstValueFrom(this.http.put<CostParty>(api(`/api/cost-parties/${id}`), party));
  }

  deleteCostParty(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/cost-parties/${id}`)));
  }

  fairs(): Promise<Fair[]> {
    return firstValueFrom(this.http.get<Fair[]>(api('/api/fairs')));
  }

  /** Without a code the server derives one from the label ("Ede" → EDE). */
  createFair(body: { label: string; code?: string | null }): Promise<Fair> {
    return firstValueFrom(this.http.post<Fair>(api('/api/fairs'), body));
  }

  updateFair(id: number, body: { label: string; active: boolean }): Promise<Fair> {
    return firstValueFrom(this.http.put<Fair>(api(`/api/fairs/${id}`), body));
  }

  /** Refused while a cost still carries the code. */
  deleteFair(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/fairs/${id}`)));
  }
}
