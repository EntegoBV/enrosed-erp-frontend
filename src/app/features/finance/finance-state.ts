import { Injectable, computed, inject, signal } from '@angular/core';
import { messageOf } from '../../core/api/errors';
import { FinanceApi } from '../../core/api/finance-api';
import { BankBalance, CompanyCost, RecurringCost, SalesOrderView } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { Ui } from '../../shared/ui';
import { addDays, bankOverview, cashOutlook, inclOf, upcomingRecurring } from './finance-metrics';
import { TODAY, blankBalance, blankCost, blankRecurring } from './finance-sections';

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Everything the Kosten & bank sections share: the costs, the recurring
 * definitions, the bank readings and the open invoices, plus the three
 * forms. Provided by the workspace page, so a section never loads on its own.
 */
@Injectable()
export class FinanceState {
  private readonly finance = inject(FinanceApi);
  private readonly sales = inject(SalesApi);
  private readonly ui = inject(Ui);

  readonly today = TODAY;
  readonly costs = signal<CompanyCost[]>([]);
  readonly recurring = signal<RecurringCost[]>([]);
  readonly balances = signal<BankBalance[]>([]);
  readonly salesOrders = signal<SalesOrderView[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly booking = signal(false);

  readonly costDraft = signal<CompanyCost | null>(null);
  readonly recurringDraft = signal<RecurringCost | null>(null);
  readonly bankDraft = signal<BankBalance | null>(null);

  /** Open costs, the oldest first: that is the order they should be paid in. */
  readonly openCosts = computed(() => this.costs().filter((cost) => !cost.paidOn)
    .sort((left, right) => left.date.localeCompare(right.date) || (left.id ?? 0) - (right.id ?? 0)));
  readonly openCostsInclEur = computed(() => round2(this.openCosts().reduce((sum, cost) => sum + inclOf(cost), 0)));
  readonly bank = computed(() => bankOverview(this.balances()));
  readonly upcoming = computed(() => upcomingRecurring(this.recurring(), this.today, addDays(this.today, 30)));
  readonly upcomingInclEur = computed(() => round2(this.upcoming().reduce((sum, row) => sum + row.amountInclEur, 0)));
  /** Sent invoices the customer has not paid: money on its way in, including VAT. */
  readonly openInvoices = computed(() => {
    const rows = this.salesOrders().filter((row) => row.order.docType === 'FACTUUR' && row.order.status !== 'CONCEPT'
      && !row.order.paidAt && !row.order.archivedAt);
    return { count: rows.length, totalEur: round2(rows.reduce((sum, row) => sum + (row.priced?.totals?.totalInclVat ?? 0), 0)) };
  });
  readonly outlook = computed(() => cashOutlook(this.bank().totalEur, this.openCostsInclEur(), this.upcomingInclEur(), this.openInvoices().totalEur));
  /** Definitions whose next occurrence is today or earlier: the hourly job has not passed yet. */
  readonly dueNow = computed(() => this.recurring().filter((definition) => definition.active && !!definition.nextDate && definition.nextDate <= this.today));
  readonly accounts = computed(() => [...new Set(this.balances().map((row) => row.account))].sort((left, right) => left.localeCompare(right)));

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [costs, recurring, balances, orders] = await Promise.allSettled([
        this.finance.costs(), this.finance.recurringCosts(), this.finance.bankBalances(), this.sales.orders(),
      ]);
      if (costs.status === 'fulfilled') this.costs.set(costs.value); else this.ui.toast(messageOf(costs.reason, 'Kosten laden mislukt'), 'err');
      if (recurring.status === 'fulfilled') this.recurring.set(recurring.value);
      if (balances.status === 'fulfilled') this.balances.set(balances.value);
      if (orders.status === 'fulfilled') this.salesOrders.set(orders.value);
    } finally {
      this.loading.set(false);
    }
  }

  private async refreshCosts(): Promise<void> {
    try {
      const [costs, recurring] = await Promise.all([this.finance.costs(), this.finance.recurringCosts()]);
      this.costs.set(costs);
      this.recurring.set(recurring);
    } catch { /* the lists on screen stay as they were */ }
  }

  /* ------------------------------------------------------------ costs */

  openCost(cost: CompanyCost | null): void {
    this.costDraft.set(cost ? { ...cost } : blankCost());
  }

  async saveCost(draft: CompanyCost): Promise<boolean> {
    if (this.saving()) return false;
    this.saving.set(true);
    try {
      const body: CompanyCost = { ...draft, party: draft.party || null, reference: draft.reference || null, notes: draft.notes || null };
      const saved = draft.id ? await this.finance.updateCost(draft.id, body) : await this.finance.createCost(body);
      this.costs.update((rows) => (draft.id ? rows.map((row) => (row.id === saved.id ? saved : row)) : [saved, ...rows]));
      this.ui.toast(draft.id ? 'Kost bewaard' : 'Kost geboekt', 'ok');
      this.costDraft.set(null);
      return true;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Bewaren mislukt'), 'err');
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  async markPaid(cost: CompanyCost, paidOn: string = this.today): Promise<void> {
    if (!cost.id) return;
    try {
      const saved = await this.finance.markCostPaid(cost.id, paidOn);
      this.costs.update((rows) => rows.map((row) => (row.id === saved.id ? saved : row)));
      this.costDraft.update((draft) => (draft && draft.id === saved.id ? saved : draft));
      this.ui.toast(`${cost.description} betaald`, 'ok');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Betaald zetten mislukt'), 'err');
    }
  }

  deleteCost(cost: CompanyCost): void {
    if (!cost.id) return;
    this.ui.confirm({
      title: 'Kost verwijderen',
      message: `${cost.description} van ${cost.date} verdwijnt uit de boeken.`,
      confirmLabel: 'Verwijderen', danger: true,
    }, async () => {
      try {
        await this.finance.deleteCost(cost.id!);
        this.costs.update((rows) => rows.filter((row) => row.id !== cost.id));
        this.costDraft.set(null);
        this.ui.toast('Kost verwijderd');
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
      }
    });
  }

  /* -------------------------------------------------------- recurring */

  openRecurring(definition: RecurringCost | null): void {
    this.recurringDraft.set(definition ? { ...definition } : blankRecurring());
  }

  async saveRecurring(draft: RecurringCost): Promise<boolean> {
    if (this.saving()) return false;
    this.saving.set(true);
    try {
      const body: RecurringCost = { ...draft, party: draft.party || null, reference: draft.reference || null, notes: draft.notes || null, endDate: draft.endDate || null };
      const before = this.costs().length;
      const saved = draft.id ? await this.finance.updateRecurringCost(draft.id, body) : await this.finance.createRecurringCost(body);
      this.recurring.update((rows) => (draft.id ? rows.map((row) => (row.id === saved.id ? saved : row)) : [saved, ...rows]));
      /* The server books what already fell due; show that straight away. */
      await this.refreshCosts();
      const booked = this.costs().length - before;
      this.ui.toast(draft.id ? 'Vaste kost bewaard' : booked > 0 ? `Vaste kost ingesteld, ${booked} ${booked === 1 ? 'periode' : 'periodes'} geboekt` : 'Vaste kost ingesteld', 'ok');
      this.recurringDraft.set(null);
      return true;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Bewaren mislukt'), 'err');
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  deleteRecurring(definition: RecurringCost): void {
    if (!definition.id) return;
    this.ui.confirm({
      title: 'Vaste kost verwijderen',
      message: `${definition.name} wordt niet meer geboekt. De kosten die al geboekt zijn, blijven staan.`,
      confirmLabel: 'Verwijderen', danger: true,
    }, async () => {
      try {
        await this.finance.deleteRecurringCost(definition.id!);
        this.recurring.update((rows) => rows.filter((row) => row.id !== definition.id));
        this.recurringDraft.set(null);
        this.ui.toast('Vaste kost verwijderd');
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
      }
    });
  }

  async bookNow(): Promise<void> {
    if (this.booking()) return;
    this.booking.set(true);
    try {
      const booked = await this.finance.bookRecurringCosts();
      await this.refreshCosts();
      this.ui.toast(booked.length ? `${booked.length} ${booked.length === 1 ? 'vaste kost' : 'vaste kosten'} geboekt` : 'Niets te boeken: alles is al in de boeken', 'ok');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Boeken mislukt'), 'err');
    } finally {
      this.booking.set(false);
    }
  }

  /* ------------------------------------------------------------- bank */

  openBank(balance: BankBalance | null, account = ''): void {
    this.bankDraft.set(balance ? { ...balance } : blankBalance(account || this.accounts()[0] || ''));
  }

  async saveBank(draft: BankBalance): Promise<boolean> {
    if (this.saving()) return false;
    this.saving.set(true);
    try {
      const body: BankBalance = { ...draft, notes: draft.notes || null };
      const saved = draft.id ? await this.finance.updateBankBalance(draft.id, body) : await this.finance.createBankBalance(body);
      this.balances.update((rows) => (draft.id ? rows.map((row) => (row.id === saved.id ? saved : row)) : [saved, ...rows]));
      this.ui.toast(draft.id ? 'Saldo bewaard' : 'Saldo ingegeven', 'ok');
      this.bankDraft.set(null);
      return true;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Bewaren mislukt'), 'err');
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  deleteBank(balance: BankBalance): void {
    if (!balance.id) return;
    this.ui.confirm({
      title: 'Saldo verwijderen',
      message: `Het saldo van ${balance.account} op ${balance.date} verdwijnt.`,
      confirmLabel: 'Verwijderen', danger: true,
    }, async () => {
      try {
        await this.finance.deleteBankBalance(balance.id!);
        this.balances.update((rows) => rows.filter((row) => row.id !== balance.id));
        this.bankDraft.set(null);
        this.ui.toast('Saldo verwijderd');
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
      }
    });
  }
}
