import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import type { OdooDocument } from './odoo-api';
import { BankBalance, CompanyCost, CostParty, CostPayment, Fair, RecurringCost } from './models';

export interface CostOdooSource {
  snapshot: { document: OdooDocument; netEur: number; vatEur: number; totalEur: number; supplierCountry: string | null };
  documents: { odooAttachmentId: number; mediaAssetId: number; name: string; kind: string }[];
  registeredAt: string;
}

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

  costOdooSource(id: number): Promise<CostOdooSource | null> {
    return firstValueFrom(this.http.get<CostOdooSource | null>(api(`/api/costs/${id}/odoo-source`)));
  }

  createCost(cost: CompanyCost): Promise<CompanyCost> {
    return firstValueFrom(this.http.post<CompanyCost>(api('/api/costs'), cost));
  }

  updateCost(id: number, cost: CompanyCost): Promise<CompanyCost> {
    return firstValueFrom(this.http.put<CompanyCost>(api(`/api/costs/${id}`), cost));
  }

  /** Pays what is still open on a cost as one payment; no day means today. The response carries the payments. */
  markCostPaid(id: number, paidOn?: string | null): Promise<CompanyCost> {
    return firstValueFrom(this.http.post<CompanyCost>(api(`/api/costs/${id}/paid`), { paidOn: paidOn ?? null }));
  }

  deleteCost(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/costs/${id}`)));
  }

  /* The payments on a cost: each call that changes them returns the cost with its payments and open amount. */
  costPayments(costId: number): Promise<CostPayment[]> {
    return firstValueFrom(this.http.get<CostPayment[]>(api(`/api/costs/${costId}/payments`)));
  }

  addCostPayment(costId: number, body: { paidOn: string; amountEur: number; account?: string | null; note?: string | null }): Promise<CompanyCost> {
    return firstValueFrom(this.http.post<CompanyCost>(api(`/api/costs/${costId}/payments`), body));
  }

  updateCostPayment(costId: number, paymentId: number, body: { paidOn: string; amountEur: number; account?: string | null; note?: string | null }): Promise<CompanyCost> {
    return firstValueFrom(this.http.put<CompanyCost>(api(`/api/costs/${costId}/payments/${paymentId}`), body));
  }

  /** The bank line the payment was on stays; the cost comes back with the payments left. */
  deleteCostPayment(costId: number, paymentId: number): Promise<CompanyCost> {
    return firstValueFrom(this.http.delete<CompanyCost>(api(`/api/costs/${costId}/payments/${paymentId}`)));
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
