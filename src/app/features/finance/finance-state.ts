import { Injectable, computed, inject, signal } from '@angular/core';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import { FinanceApi } from '../../core/api/finance-api';
import { MediaApi } from '../../core/api/media-api';
import { MediaAssetSummary } from '../../core/api/media-models';
import { BankBalance, CompanyCost, Customer, IncomingPaymentRow, PurchasePaymentRow, RecurringCost, SalesOrderView } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { Ui } from '../../shared/ui';
import { PaidInvoice, addDays, bankOverview, cashOutlook, inclOf, latestBankReading, movementsSince, upcomingRecurring } from './finance-metrics';
import { TODAY, blankBalance, blankCost, blankRecurring } from './finance-sections';
import { costLedger } from './cost-ledger';
import { incomingMoneyTotals, incomingPurposeLabel, paymentLocalDay, receivableTotals, uniqueIncomingPayments } from './incoming-money';

const round2 = (value: number): number => Math.round(value * 100) / 100;
const eur = (value: number): string => value.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Everything the Kosten & bank sections share: the costs, the recurring
 * definitions, the bank readings and the open invoices, plus the three
 * forms. Provided by the workspace page, so a section never loads on its own.
 */
@Injectable()
export class FinanceState {
  private readonly finance = inject(FinanceApi);
  private readonly sales = inject(SalesApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly media = inject(MediaApi);
  private readonly ui = inject(Ui);

  readonly today = TODAY;
  readonly costs = signal<CompanyCost[]>([]);
  readonly recurring = signal<RecurringCost[]>([]);
  readonly balances = signal<BankBalance[]>([]);
  readonly salesOrders = signal<SalesOrderView[]>([]);
  readonly customers = signal<Customer[]>([]);
  readonly payments = signal<PurchasePaymentRow[]>([]);
  readonly incomingPayments = signal<IncomingPaymentRow[]>([]);
  readonly incomingTotals = computed(() => incomingMoneyTotals(this.incomingPayments()));
  /** The common costs list; container rows always follow their original payment. */
  readonly ledger = computed(() => costLedger(this.costs(), this.payments()));
  /** Every file linked to a cost: the invoices, receipts and contracts. */
  readonly attachments = signal<MediaAssetSummary[]>([]);
  readonly uploading = signal(false);
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
  readonly openInvoices = computed(() => receivableTotals(this.salesOrders()));
  private readonly customerNames = computed(() => new Map(this.customers().map((customer) => [customer.id, customer.company])));
  /** Actual receipts survive document archival and use the entered payment moment and amount. */
  readonly paidInvoices = computed<PaidInvoice[]>(() => uniqueIncomingPayments(this.incomingPayments()).map((row) => ({
    id: row.id, salesOrderId: row.salesOrderId, purchaseOrderId: row.purchaseOrderId, receivedAt: row.receivedAt, timeZone: row.timeZone,
    date: paymentLocalDay(row), number: row.orderNumber, customer: this.customerNames().get(row.customerId) ?? null,
    amountEur: row.amountEur, reference: row.reference, purposeLabel: incomingPurposeLabel(row.purpose),
  })));
  /** The bank rolled forward: the last reading plus what the ERP saw move after it. */
  readonly movements = computed(() => movementsSince(this.bank().asOf, this.bank().totalEur, this.costs(), this.payments(), this.paidInvoices(), this.bank().asOfAt, this.bank().timeZone || 'Europe/Brussels'));
  readonly currentBankEur = computed(() => this.movements().currentEur);
  readonly outlook = computed(() => cashOutlook(this.currentBankEur(), this.openCostsInclEur(), this.upcomingInclEur(), this.openInvoices().totalEur));
  /** Files per cost id. */
  readonly attachmentsByCost = computed(() => {
    const map = new Map<number, MediaAssetSummary[]>();
    for (const asset of this.attachments()) {
      for (const link of asset.links ?? []) {
        if (link.targetType === 'COMPANY_COST') map.set(link.targetId, [...(map.get(link.targetId) ?? []), asset]);
      }
    }
    return map;
  });
  /** Definitions whose next occurrence is today or earlier: the hourly job has not passed yet. */
  readonly dueNow = computed(() => this.recurring().filter((definition) => definition.active && !!definition.nextDate && definition.nextDate <= this.today));
  readonly accounts = computed(() => [...new Set(this.balances().map((row) => row.account))].sort((left, right) => left.localeCompare(right)));

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [costs, recurring, balances, orders, customers, payments, attachments, incoming] = await Promise.allSettled([
        this.finance.costs(), this.finance.recurringCosts(), this.finance.bankBalances(), this.sales.orders(),
        this.sales.customers(), this.sourcing.purchasePayments(), this.media.assets({ targetType: 'COMPANY_COST', limit: 500 }),
        this.sales.incomingPayments(),
      ]);
      if (costs.status === 'fulfilled') this.costs.set(costs.value); else this.ui.toast(messageOf(costs.reason, 'Kosten laden mislukt'), 'err');
      if (recurring.status === 'fulfilled') this.recurring.set(recurring.value);
      if (balances.status === 'fulfilled') this.balances.set(balances.value);
      if (orders.status === 'fulfilled') this.salesOrders.set(orders.value);
      if (customers.status === 'fulfilled') this.customers.set(customers.value);
      if (payments.status === 'fulfilled') this.payments.set(payments.value);
      else this.ui.toast(messageOf(payments.reason, 'Containerbetalingen laden mislukt; kosten en banksaldo kunnen onvolledig zijn'), 'err');
      if (attachments.status === 'fulfilled') this.attachments.set(attachments.value);
      if (incoming.status === 'fulfilled') this.incomingPayments.set(incoming.value);
      else this.ui.toast(messageOf(incoming.reason, 'Ontvangsten laden mislukt; het banksaldo kan onvolledig zijn'), 'err');
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

  async saveCost(draft: CompanyCost): Promise<CompanyCost | null> {
    if (this.saving()) return null;
    this.saving.set(true);
    try {
      const body: CompanyCost = { ...draft, party: draft.party || null, reference: draft.reference || null, notes: draft.notes || null };
      const saved = draft.id ? await this.finance.updateCost(draft.id, body) : await this.finance.createCost(body);
      this.costs.update((rows) => (draft.id ? rows.map((row) => (row.id === saved.id ? saved : row)) : [saved, ...rows]));
      this.ui.toast(draft.id ? 'Kost bewaard' : 'Kost geboekt', 'ok');
      this.costDraft.set(null);
      return saved;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Bewaren mislukt'), 'err');
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  /* ------------------------------------------------------ attachments */

  attachmentsFor(costId: number | null | undefined): MediaAssetSummary[] {
    return costId ? this.attachmentsByCost().get(costId) ?? [] : [];
  }

  private async reloadAttachments(): Promise<void> {
    try {
      this.attachments.set(await this.media.assets({ targetType: 'COMPANY_COST', limit: 500 }));
    } catch { /* the list on screen stays as it was */ }
  }

  /** The invoice or receipt goes into the library, filed under Kosten / year, and hangs on this cost. */
  async attach(costId: number, files: readonly File[]): Promise<void> {
    if (!files.length) return;
    this.uploading.set(true);
    let done = 0;
    try {
      for (const file of files) {
        const result = await this.media.upload(file);
        await this.media.addLink(result.asset.id, { targetType: 'COMPANY_COST', targetId: costId, role: 'INTERNAL' });
        done += 1;
      }
      this.ui.toast(done === 1 ? 'Document bij de kost gezet' : `${done} documenten bij de kost gezet`, 'ok');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Opladen mislukt'), 'err');
    } finally {
      await this.reloadAttachments();
      this.uploading.set(false);
    }
  }

  /** Cuts the file loose from the cost; the file itself stays in the library. */
  async detach(asset: MediaAssetSummary, costId: number): Promise<void> {
    const link = (asset.links ?? []).find((row) => row.targetType === 'COMPANY_COST' && row.targetId === costId);
    if (!link) return;
    try {
      await this.media.removeLink(asset.id, link.id);
      await this.reloadAttachments();
      this.ui.toast('Document losgemaakt');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Losmaken mislukt'), 'err');
    }
  }

  async openAttachment(asset: MediaAssetSummary): Promise<void> {
    try {
      saveBlob(await this.media.download(asset.id), asset.originalFilename || asset.name);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Openen mislukt'), 'err');
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

  /**
   * Writes the rolled-forward balance down as today's reading of the account
   * that was read last, so the bank line in the ERP catches up with the movements.
   */
  async rollForward(): Promise<void> {
    const moves = this.movements();
    const latest = latestBankReading(this.balances());
    if (!latest || !moves.rows.length || this.saving()) return;
    const account = this.bank().accounts.find((row) => row.account === latest.account);
    if (!account) return;
    const value = Math.round((account.balanceEur + moves.netEur) * 100) / 100;
    this.saving.set(true);
    try {
      const saved = await this.finance.createBankBalance({
        id: null, account: latest.account, date: this.today, asOfAt: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Brussels', balanceEur: value,
        notes: `Doorgetrokken vanuit het saldo van ${moves.since}: € ${eur(moves.inEur)} erin, € ${eur(moves.outEur)} eruit (${moves.rows.length} ${moves.rows.length === 1 ? 'beweging' : 'bewegingen'}).`,
      });
      this.balances.update((rows) => [saved, ...rows]);
      this.ui.toast(`Saldo doorgetrokken naar € ${eur(value)}`, 'ok');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Doortrekken mislukt'), 'err');
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
