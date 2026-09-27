import { Location } from '@angular/common';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import { BankingApi, BankMovementRequest, BankStatementLine } from '../../core/api/banking-api';
import { FinanceApi } from '../../core/api/finance-api';
import { MediaApi } from '../../core/api/media-api';
import { MediaAssetSummary } from '../../core/api/media-models';
import {
  BankBalance, CompanyCost, Customer, IncomingPaymentRow, PurchaseOrderView, PurchasePaymentRow, RecurringCost, SalesOrderView, SalesPurpose,
} from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { receiptInstant, receiptLocalParts, receiptRequest } from '../../shared/received-at';
import type { ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { Ui, escapeHtml } from '../../shared/ui';
import { bankAccountKey, reconciledBank } from './bank-reconciliation';
import { bankMarker, lineMarkers, matchOutgoings, unbankedOutgoings, unbankedSinceDay } from './bank-markers';
import type { MarkerKind } from './bank-markers';
import { categoryLabel } from './cost-categories';
import { CONTAINER_PAYMENT_CATEGORIES, CostLedgerRow, costLedger, costLedgerCsv } from './cost-ledger';
import { financeAttention } from './finance-attention';
import { addDays, cashOutlook, inclOf, occurrencesBetween, previewBacklog, upcomingRecurring } from './finance-metrics';
import { blankBalance, blankCost, blankRecurring, localIsoDay, periodRange } from './finance-sections';
import type { PeriodId } from './finance-sections';
import type { FinanceMenu } from './finance-section';
import { FinanceLocation, NO_ACCOUNT, financeQueryParams, parseFinanceLocation, patchLocation } from './finance-url';
import { incomingMoneyTotals, invoiceReceivable, paymentLocalDay, receivableTotals, uniqueIncomingPayments } from './incoming-money';
import { containerPayables, daysBetween, payableTotals, payablesFor } from './payables';

/** A place the data comes from; each can fail on its own and keeps its last good value. */
export type FinanceSource = 'costs' | 'recurring' | 'balances' | 'orders' | 'customers' | 'payments' | 'attachments'
  | 'incoming' | 'statements' | 'containers';

const SOURCE_NAMES: Readonly<Record<FinanceSource, string>> = {
  costs: 'Bedrijfskosten', recurring: 'Vaste kosten', balances: 'Banksaldi', orders: 'Verkoopfacturen', customers: 'Klanten',
  payments: 'Containerbetalingen', attachments: 'Kostendocumenten', incoming: 'Ontvangsten en terugbetalingen',
  statements: 'Bankbewegingen', containers: 'Containers',
};
const MAIN_SOURCES: readonly FinanceSource[] = ['costs', 'recurring', 'balances', 'orders', 'customers', 'payments', 'attachments', 'incoming', 'statements'];
const BANK_ZONE = 'Europe/Brussels';
const PAY_TO_BANK_KEY = 'enrosed.finance.payToBank';
const INACTIVE = new Set(['CONCEPT', 'GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN']);
const round2 = (value: number): number => Math.round(value * 100) / 100;
const euro = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
export const formatEuro = (value: number): string => euro.format(value);
const shortDay = (day: string): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** What the inspector (desk) or the detail sheet (phone) shows. */
export interface InspectTarget {
  kind: 'cost' | 'container' | 'invoice' | 'recurring';
  id: number;
}

/** The bank movement form, lifted out of the list so '+' can open it anywhere. */
export interface MovementDraft {
  direction: 'INCOMING' | 'OUTGOING';
  amount: number;
  account: string;
  day: string;
  /** HH:MM, or null for "nu" (today) and midday (another day). */
  time: string | null;
  timeZone: string;
  counterparty: string;
  reference: string;
  requestId: string;
}

export interface MovementPrefill {
  direction?: 'INCOMING' | 'OUTGOING';
  amount?: number;
  accountKey?: string;
  day?: string;
  time?: string | null;
  counterparty?: string;
  reference?: string;
}

export interface PayOptions {
  paidOn: string;
  /** The account key to note a bank line on, or null for only "paid". */
  bankAccount: string | null;
}

/** The remembered "Ook als bankbeweging noteren" choice of this device. */
export interface PayToBankPreference {
  on: boolean;
  accountKey: string;
}

/** An open invoice in Te ontvangen. */
export interface ReceivableRow {
  key: string;
  id: number;
  number: string;
  customerId: number | null;
  customer: string;
  kind: 'customer' | 'partner' | 'credit';
  purpose: SalesPurpose;
  orderDate: string;
  ageDays: number;
  totalEur: number;
  receivedEur: number;
  remainingEur: number;
  /** Credit rows: the open tegoed (money the other way); 0 on invoices. */
  creditEur: number;
  creditedInvoiceId: number | null;
  creditedInvoiceNumber: string | null;
  view: SalesOrderView;
}

interface PaidEntry {
  cost: CompanyCost;
  paidOn: string;
  line: BankStatementLine | null;
}

/**
 * Everything the Kosten & bank sections share: the data, the address, the
 * forms and the actions. Provided by the workspace page, so a section never
 * loads on its own and the address (see finance-url.ts) is the page's.
 */
@Injectable()
export class FinanceState {
  private readonly finance = inject(FinanceApi);
  private readonly banking = inject(BankingApi);
  private readonly sales = inject(SalesApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly media = inject(MediaApi);
  private readonly ui = inject(Ui);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly browserLocation = inject(Location);

  /** Desk (680px and up) or phone; templates choose their markup by it. */
  readonly desk = inject(DesktopViewport).active;

  /* ------------------------------------------------------------- clock */

  /** Today in the local calendar. The page refreshes it on focus, on return and at midnight. */
  readonly today = signal(localIsoDay());

  refreshToday(): void {
    const day = localIsoDay();
    if (day !== this.today()) this.today.set(day);
  }

  /* ----------------------------------------------------------- address */

  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  readonly location = computed<FinanceLocation>(() => {
    const params = this.params();
    return parseFinanceLocation((key) => params.get(key));
  }, { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) });

  /** Changes the address. Sections, segments and filters replace the entry; drill-ins push one. */
  go(patch: Partial<FinanceLocation>, mode: 'replace' | 'push' = 'replace'): void {
    const next = patchLocation(this.location(), patch);
    void this.router.navigate([], { relativeTo: this.route, queryParams: financeQueryParams(next), replaceUrl: mode === 'replace' });
  }

  /** The day range a period of the current list stands for. */
  rangeOf(location: FinanceLocation = this.location()): { from: string; to: string } {
    if (location.period === 'custom') return { from: location.from, to: location.to };
    return periodRange((location.period || 'all') as PeriodId, this.today());
  }

  /* -------------------------------------------------------------- data */

  readonly costs = signal<CompanyCost[]>([]);
  readonly recurring = signal<RecurringCost[]>([]);
  readonly balances = signal<BankBalance[]>([]);
  readonly bankStatements = signal<BankStatementLine[]>([]);
  readonly salesOrders = signal<SalesOrderView[]>([]);
  readonly customers = signal<Customer[]>([]);
  readonly payments = signal<PurchasePaymentRow[]>([]);
  readonly incomingPayments = signal<IncomingPaymentRow[]>([]);
  /** Every file linked to a cost: the invoices, receipts and contracts. */
  readonly attachments = signal<MediaAssetSummary[]>([]);
  /** The purchase orders with their reconciliation: heavy, so loaded apart and never awaited. */
  readonly purchaseViews = signal<PurchaseOrderView[]>([]);

  readonly loading = signal(true);
  readonly containersLoading = signal(true);
  readonly uploading = signal(false);
  readonly saving = signal(false);
  readonly booking = signal(false);
  /** A bulk action or pay run is going; it locks the other actions. */
  readonly busy = signal(false);
  readonly progress = signal<{ done: number; total: number } | null>(null);
  /** Completion time of the most recent refresh; loadErrors says whether it was partial. */
  readonly loadedAt = signal<Date | null>(null);
  private readonly errorMap = signal<Partial<Record<FinanceSource, string>>>({});
  /** Failed sources in Dutch; their last good data stays on screen. */
  readonly loadErrors = computed(() => Object.values(this.errorMap()).filter((text): text is string => !!text));
  readonly failedSources = computed(() => (Object.keys(this.errorMap()) as FinanceSource[]).map((source) => SOURCE_NAMES[source]));
  private readonly requests: Record<FinanceSource, number> = {
    costs: 0, recurring: 0, balances: 0, orders: 0, customers: 0, payments: 0, attachments: 0, incoming: 0, statements: 0, containers: 0,
  };
  private loadTicket = 0;
  private containerTicket = 0;

  /** Reloads some sources; a newer request for a source wins, a failed one keeps its last good value. */
  async reload(sources: readonly FinanceSource[]): Promise<void> {
    const tickets = sources.map((source) => ++this.requests[source]);
    const results = await Promise.allSettled(sources.map((source) => this.fetch(source)));
    const errors: Partial<Record<FinanceSource, string>> = {};
    const cleared: FinanceSource[] = [];
    results.forEach((result, index) => {
      const source = sources[index];
      if (tickets[index] !== this.requests[source]) return;
      if (result.status === 'fulfilled') {
        this.apply(source, result.value);
        cleared.push(source);
      } else {
        errors[source] = `${SOURCE_NAMES[source]}: ${messageOf(result.reason, 'laden mislukt')}`;
      }
    });
    this.errorMap.update((current) => {
      const next = { ...current, ...errors };
      for (const source of cleared) delete next[source];
      return next;
    });
  }

  /** Everything, with the heavy container source on its own so it never holds up the first paint. */
  async load(): Promise<void> {
    const ticket = ++this.loadTicket;
    this.loading.set(true);
    void this.loadContainers();
    try {
      await this.reload(MAIN_SOURCES);
    } finally {
      if (ticket === this.loadTicket) {
        this.loading.set(false);
        this.loadedAt.set(new Date());
      }
    }
  }

  private async loadContainers(): Promise<void> {
    const ticket = ++this.containerTicket;
    this.containersLoading.set(true);
    try {
      await this.reload(['containers']);
    } finally {
      if (ticket === this.containerTicket) this.containersLoading.set(false);
    }
  }

  /** After a bank action: the lines, the receipts, the invoices they touch and the readings. */
  refreshBank(): Promise<void> {
    return this.reload(['statements', 'incoming', 'orders', 'balances']);
  }

  refreshCosts(): Promise<void> {
    return this.reload(['costs', 'recurring']);
  }

  private fetch(source: FinanceSource): Promise<unknown> {
    switch (source) {
      case 'costs': return this.finance.costs();
      case 'recurring': return this.finance.recurringCosts();
      case 'balances': return this.finance.bankBalances();
      case 'orders': return this.sales.orders();
      case 'customers': return this.sales.customers();
      case 'payments': return this.sourcing.purchasePayments();
      /* The server pages at 200; archived files stay on their cost with a tag. */
      case 'attachments': return this.media.allAssets({ targetType: 'COMPANY_COST', includeArchived: true }, 5000).then((page) => page.items);
      case 'incoming': return this.sales.incomingPayments();
      case 'statements': return this.banking.list();
      case 'containers': return this.sourcing.purchaseOrders();
    }
  }

  private apply(source: FinanceSource, value: unknown): void {
    switch (source) {
      case 'costs': this.costs.set(value as CompanyCost[]); break;
      case 'recurring': this.recurring.set(value as RecurringCost[]); break;
      case 'balances': this.balances.set(value as BankBalance[]); break;
      case 'orders': this.salesOrders.set(value as SalesOrderView[]); break;
      case 'customers': this.customers.set(value as Customer[]); break;
      case 'payments': this.payments.set(value as PurchasePaymentRow[]); break;
      case 'attachments': this.attachments.set(value as MediaAssetSummary[]); break;
      case 'incoming': this.incomingPayments.set(value as IncomingPaymentRow[]); break;
      case 'statements': this.bankStatements.set(value as BankStatementLine[]); break;
      case 'containers': this.purchaseViews.set(value as PurchaseOrderView[]); break;
    }
  }

  /* ----------------------------------------------------------- derived */

  /**
   * The one switch for purchase figures. There is no customer-safe mode since
   * fd979b4 (staff always see them); a future one needs only this computed.
   */
  readonly purchaseFiguresVisible = computed(() => true);

  readonly bankLedger = computed(() => reconciledBank(this.balances(), this.bankStatements(), this.incomingPayments()));
  readonly currentBankEur = computed(() => this.bankLedger().totalEur);
  /** Company costs and container payments side by side; container rows follow their original payment. */
  readonly ledger = computed(() => costLedger(this.costs(), this.purchaseFiguresVisible() ? this.payments() : []));

  /** Open costs, the oldest first: that is the order they should be paid in. */
  readonly openCosts = computed(() => this.costs().filter((cost) => !cost.paidOn)
    .sort((left, right) => left.date.localeCompare(right.date) || (left.id ?? 0) - (right.id ?? 0)));
  readonly openCostsInclEur = computed(() => round2(this.openCosts().reduce((sum, cost) => sum + inclOf(cost), 0)));
  /** The recurring costs of the coming 30 days: the one horizon of Te betalen. */
  readonly upcoming = computed(() => upcomingRecurring(this.recurring(), this.today(), addDays(this.today(), 30)));
  readonly upcomingInclEur = computed(() => round2(this.upcoming().reduce((sum, row) => sum + row.amountInclEur, 0)));
  /** Definitions whose next occurrence is today or earlier. */
  readonly dueNow = computed(() => this.recurring().filter((definition) => definition.active && !!definition.nextDate && definition.nextDate <= this.today()));
  /** Incoming bank lines not linked to an invoice yet: 'Te koppelen'. */
  readonly unlinkedIncomingCount = computed(() => this.bankStatements().filter((line) => line.amountEur > 0 && line.salesPaymentId === null).length);

  /**
   * The work a segment holds that its section's badge counts (Vaste kosten
   * due to be booked, bank lines to link), so the segment can show it too.
   */
  segmentWarn(view: string, tab: string): number {
    if (view === 'costs' && tab === 'recurring') return this.dueNow().length;
    if (view === 'bank' && tab === 'movements') return this.unlinkedIncomingCount();
    return 0;
  }

  /** Sent invoices not yet paid: money on its way in, incl. btw. */
  readonly openInvoices = computed(() => receivableTotals(this.salesOrders()));
  readonly customerNames = computed(() => new Map(this.customers().map((customer) => [customer.id, customer.company])));

  /** Open invoices, and issued credit notes with a tegoed (kind 'credit', money the other way). */
  readonly receivables = computed<ReceivableRow[]>(() => this.salesOrders()
    .filter((view) => (view.order.docType === 'FACTUUR' || view.order.docType === 'CREDITNOTA') && !INACTIVE.has(view.order.status))
    .map((view) => {
      const money = invoiceReceivable(view);
      const credit = view.order.docType === 'CREDITNOTA';
      const purpose: SalesPurpose = view.order.purpose ?? (view.order.partnerPurchaseOrderId ? 'PARTNER_ADVANCE' : 'STANDARD');
      const partner = view.order.purpose ? view.order.purpose !== 'STANDARD' : !!view.order.partnerPurchaseOrderId;
      return {
        key: `invoice:${view.order.id}`, id: view.order.id, number: view.order.number, customerId: view.order.customerId,
        customer: this.customerNames().get(view.order.customerId ?? -1) ?? '', kind: credit ? 'credit' as const : partner ? 'partner' as const : 'customer' as const,
        purpose, orderDate: view.order.orderDate, ageDays: Math.max(0, daysBetween(view.order.orderDate, this.today())),
        totalEur: view.paymentSummary?.invoiceTotalEur ?? view.priced?.totals?.totalInclVat ?? 0,
        receivedEur: money.receivedEur, remainingEur: credit ? 0 : money.remainingEur, creditEur: credit ? money.creditEur : 0,
        creditedInvoiceId: view.order.creditedInvoiceId ?? view.creditedInvoiceId ?? null, creditedInvoiceNumber: view.creditedInvoiceNumber ?? null, view,
      };
    })
    .filter((row) => row.remainingEur > 0 || row.creditEur > 0)
    .sort((left, right) => left.orderDate.localeCompare(right.orderDate) || left.id - right.id));

  readonly incomingThisMonth = computed(() => incomingMoneyTotals(this.incomingPayments(), periodRange('month', this.today()).from, this.today()));

  /* accounts: keys merge, labels are what people read */
  readonly accountOptions = computed(() => this.bankLedger().accounts
    .map((account) => ({ key: account.account, label: account.label }))
    .sort((left, right) => left.label.localeCompare(right.label, 'nl')));
  /** Readable account names, for the older pickers. */
  readonly accounts = computed(() => this.accountOptions().map((option) => option.label));
  readonly accountsView = computed(() => this.bankLedger().accounts.map((account) => ({
    ...account,
    ageDays: account.checkedAt ? Math.max(0, daysBetween(paymentLocalDay({ receivedAt: account.checkedAt, timeZone: account.reading?.timeZone || BANK_ZONE }), this.today())) : null,
  })));

  accountLabel(key: string | null | undefined): string {
    if (!key) return '';
    if (key === NO_ACCOUNT) return 'Geen rekening';
    const normalised = bankAccountKey(key);
    return this.accountOptions().find((option) => option.key === normalised)?.label ?? key;
  }

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
  readonly documentedIds = computed(() => new Set(this.attachmentsByCost().keys()));

  attachmentsFor(costId: number | null | undefined): MediaAssetSummary[] {
    return costId ? this.attachmentsByCost().get(costId) ?? [] : [];
  }

  /* payables: costs, containers and recurring in one list */
  readonly containerPayables = computed(() => (this.purchaseFiguresVisible() ? containerPayables(this.purchaseViews()) : []));
  readonly payables = computed(() => payablesFor({
    openCosts: this.openCosts(), upcoming30: this.upcoming(), containerRows: this.containerPayables(), today: this.today(),
  }));
  readonly payableTotals = computed(() => payableTotals(this.payables()));
  readonly outlook = computed(() => cashOutlook(this.currentBankEur(), this.openCostsInclEur(), this.upcomingInclEur(),
    this.openInvoices().totalEur, this.payableTotals().containerNowEur, this.payableTotals().containerLaterEur, this.openInvoices().creditNoteEur));

  /* soft bank links */
  readonly lineMarkers = computed(() => lineMarkers(this.bankStatements()));
  private readonly paidOutgoings = computed(() => this.ledger().filter((row) => !!row.paidOn).map((row) => ({
    kind: (row.cost ? 'kost' : 'containerbetaling') as MarkerKind, id: row.cost?.id ?? row.payment?.id ?? 0,
    paidOn: row.paidOn, amountEur: row.amountEur, row,
  })).filter((row) => row.id > 0));
  readonly unbankedSince = computed(() => unbankedSinceDay(this.bankLedger().accounts.flatMap((account) => account.reading ? [{
    day: account.reading.asOfAt ? paymentLocalDay({ receivedAt: account.reading.asOfAt, timeZone: account.reading.timeZone || BANK_ZONE }) : account.reading.date,
    endOfDay: !account.reading.asOfAt,
  }] : []), this.today()));
  /** Paid, but no bank line after the last check: 'Nog niet op de bank'. */
  readonly unbanked = computed(() => unbankedOutgoings(this.paidOutgoings(), this.bankStatements(), this.unbankedSince())
    .sort((left, right) => (right.paidOn ?? '').localeCompare(left.paidOn ?? '')));
  /** The bank line that holds a paid row, by 'kost#12' or 'containerbetaling#3'. */
  readonly bankedLines = computed(() => {
    const map = new Map<string, BankStatementLine>();
    const lines = new Map(this.bankStatements().map((line) => [line.id, line]));
    for (const [row, line] of matchOutgoings(this.paidOutgoings(), this.bankStatements())) {
      const full = lines.get(line.id);
      if (full) map.set(`${row.kind}#${row.id}`, full);
    }
    return map;
  });

  /** The bank line a linked receipt went into, by receipt id. */
  private readonly lineByReceipt = computed(() => new Map(this.bankStatements()
    .filter((line) => line.salesPaymentId !== null).map((line) => [line.salesPaymentId!, line])));

  /** The account a receipt counts on: its own, else the one of the bank line it was linked to. */
  receiptAccountKey(row: { id: number; bankAccount?: string | null }): string {
    return bankAccountKey(row.bankAccount) || bankAccountKey(this.lineByReceipt().get(row.id)?.account);
  }

  /** Receipts on invoices on no account at all, not even through a bank line: they never count in the bank. */
  readonly receiptsWithoutAccount = computed(() => uniqueIncomingPayments(this.incomingPayments())
    .filter((row) => !this.receiptAccountKey(row as IncomingPaymentRow)));

  readonly attention = computed(() => {
    const containersNow = this.containerPayables().filter((row) => row.bucket === 'now');
    const unassigned = this.receiptsWithoutAccount();
    const unbanked = this.unbanked();
    return financeAttention({
      today: this.today(),
      openCosts: this.openCosts().map((cost) => ({ date: cost.date, amountInclEur: inclOf(cost) })),
      dueNowCount: this.dueNow().length,
      containerNow: { count: containersNow.length, eur: round2(containersNow.reduce((sum, row) => sum + row.remainingEur, 0)) },
      bankLines: this.bankStatements(),
      receiptsWithoutAccount: { count: unassigned.length, eur: round2(unassigned.reduce((sum, row) => sum + row.amountEur, 0)) },
      accounts: this.accountsView().map((account) => ({ key: account.account, label: account.label, hasReading: !!account.reading, ageDays: account.ageDays })),
      unbanked: { count: unbanked.length, eur: round2(unbanked.reduce((sum, row) => sum + row.amountEur, 0)) },
      costs: this.costs().map((cost) => ({ date: cost.date, recurringCostId: cost.recurringCostId, documented: cost.id !== null && this.documentedIds().has(cost.id) })),
      receivables: this.receivables().map((row) => ({ orderDate: row.orderDate, remainingEur: row.remainingEur })),
      openCredits: { count: this.openInvoices().creditNoteCount, eur: round2(this.receivables().filter((row) => row.kind === 'credit').reduce((sum, row) => sum + row.creditEur, 0)) },
    });
  });

  /** Container rows the Uitgaven › Containers list and the inspector read from. */
  paymentsFor(orderId: number): PurchasePaymentRow[] {
    return this.payments().filter((payment) => payment.orderId === orderId).sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b.id - a.id);
  }

  readonly categoryName = (code: string): string => CONTAINER_PAYMENT_CATEGORIES.find((category) => category.code === code)?.label ?? categoryLabel(code);

  /* ------------------------------------------------------- page chrome */

  readonly inspect = signal<InspectTarget | null>(null);
  readonly menu = signal<FinanceMenu | null>(null);
  readonly helpOpen = signal(false);
  readonly shortcutsOpen = signal(false);
  readonly packageOpen = signal(false);
  /** The quarter 'Pakket' on Analyse opens the package sheet with. */
  readonly packagePreset = signal<{ year: number; quarter: number } | null>(null);

  openPackage(preset: { year: number; quarter: number } | null = null): void {
    this.packagePreset.set(preset);
    this.packageOpen.set(true);
  }
  /** The account key whose balance history is open. */
  readonly historyAccount = signal<string | null>(null);
  readonly outlookOpen = signal(false);

  constructor() {
    /* ?cost=<id> inspects that cost; leaving the section closes the inspector. */
    let section = '';
    effect(() => {
      const location = this.location();
      untracked(() => {
        const here = `${location.view}/${location.tab}`;
        if (location.cost) this.inspect.set({ kind: 'cost', id: location.cost });
        else if (here !== section || (this.inspect()?.kind === 'cost' && here === 'costs/company')) this.inspect.set(null);
        if (location.view !== 'analysis') this.analysisPushed = false;
        section = here;
      });
    });
  }

  /**
   * Every route to the inspector. On Uitgaven › Bedrijfskosten the address
   * carries the cost (?cost=<id>), so a cost goes through it and anything
   * else first takes the cost off it; elsewhere the target is set directly.
   */
  inspectItem(target: InspectTarget): void {
    const location = this.location();
    const company = location.view === 'costs' && location.tab === 'company';
    if (target.kind === 'cost' && company) {
      if (location.cost !== target.id) this.go({ cost: target.id });
      else this.inspect.set(target);
      return;
    }
    if (company && location.cost) this.go({ cost: null });
    this.inspect.set(target);
  }

  /** What the inspector head and the phone detail sheet call the item: its description, number or name. */
  inspectTitle(target: InspectTarget): string {
    switch (target.kind) {
      case 'cost': return this.costs().find((row) => row.id === target.id)?.description || 'Kost';
      case 'container': return this.purchaseViews().find((view) => view.order.id === target.id)?.order.number
        ?? this.payments().find((row) => row.orderId === target.id)?.orderNumber ?? 'Container';
      case 'invoice': return this.receivables().find((row) => row.id === target.id)?.number ?? 'Document';
      default: return this.recurring().find((row) => row.id === target.id)?.name || 'Vaste kost';
    }
  }

  /* Analyse is a sub-screen on a phone: pushed from Overzicht or ⋯, and its back button pops it. */
  private analysisPushed = false;

  openAnalysis(): void {
    if (this.location().view === 'analysis') return;
    this.analysisPushed = true;
    this.go({ view: 'analysis' }, 'push');
  }

  leaveAnalysis(): void {
    if (this.analysisPushed) this.browserLocation.back();
    else this.go({ view: 'overview' });
  }

  closeInspector(): void {
    if (this.location().cost) this.go({ cost: null });
    this.inspect.set(null);
  }

  openMenu(menu: FinanceMenu): void {
    this.menu.set(menu);
  }

  /** Links out push history, so Back returns to the same list and filters. */
  openContainer(orderId: number): void {
    void this.router.navigate(['/purchasing', orderId], { queryParams: { section: 'ledger' } });
  }

  /** Partner money comes in on the container's payments block. */
  openPartnerContainer(orderId: number): void {
    void this.router.navigate(['/purchasing', orderId], { queryParams: { section: 'payments' } });
  }

  openInvoice(salesOrderId: number): void {
    void this.router.navigate(['/sales', salesOrderId]);
  }

  /** The row menu of a company cost: right-click on a desk, long press or 'Meer' on a phone. */
  costMenu(cost: CompanyCost, anchor: MenuPoint | null): void {
    const open = this.inspect();
    const items: ContextMenuItem[] = [
      ...(open?.kind === 'cost' && open.id === cost.id ? [] : [{ id: 'open', label: 'Openen', iconName: 'eye' }]),
      { id: 'edit', label: 'Bewerken', iconName: 'pencil' },
      cost.paidOn ? { id: 'unpaid', label: 'Niet betaald', iconName: 'restore' } : { id: 'pay', label: 'Betaald zetten…', iconName: 'tick' },
      { id: 'duplicate', label: 'Dupliceren', iconName: 'copy' },
      { id: 'document', label: 'Document toevoegen…', iconName: 'clip' },
      { id: 'amount', label: 'Kopieer bedrag', iconName: 'copy' },
      { id: 'delete', label: 'Verwijderen', iconName: 'trash', danger: true, divider: true },
    ];
    this.openMenu({ title: cost.description, items, anchor, cancelLabel: anchor ? '' : 'Annuleren', pick: (id) => {
      if (id === 'open') this.inspectItem({ kind: 'cost', id: cost.id! });
      else if (id === 'edit') this.openCost(cost);
      else if (id === 'pay') this.openPay([cost]);
      else if (id === 'unpaid') void this.markUnpaid(cost);
      else if (id === 'duplicate') this.duplicateCost(cost);
      else if (id === 'document') void this.pickFiles().then((files) => this.attach(cost.id!, files));
      else if (id === 'amount') void this.copyAmount(inclOf(cost));
      else if (id === 'delete') this.deleteCost(cost);
    } });
  }

  /** The row menu of a recurring definition. */
  recurringMenu(definition: RecurringCost, anchor: MenuPoint | null): void {
    const items: ContextMenuItem[] = [
      { id: 'edit', label: 'Bewerken', iconName: 'pencil' },
      definition.active ? { id: 'pause', label: 'Pauzeren', iconName: 'recent' } : { id: 'resume', label: 'Hervatten', iconName: 'repeat' },
      { id: 'delete', label: 'Verwijderen', iconName: 'trash', danger: true, divider: true },
    ];
    this.openMenu({ title: definition.name, items, anchor, cancelLabel: anchor ? '' : 'Annuleren', pick: (id) => {
      if (id === 'edit') this.openRecurring(definition);
      else if (id === 'pause' || id === 'resume') this.setRecurringActive(definition, id === 'resume');
      else if (id === 'delete') this.deleteRecurring(definition);
    } });
  }

  async copyAmount(amount: number): Promise<void> {
    try {
      await navigator.clipboard.writeText(amount.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      this.ui.toast('Bedrag gekopieerd');
    } catch {
      this.ui.toast('Kopiëren lukt niet in deze browser', 'err');
    }
  }

  /** A file dialog without a form: resolves with the chosen files (or none). */
  pickFiles(accept = 'application/pdf,image/*,.doc,.docx,.xls,.xlsx,.txt'): Promise<File[]> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = accept;
      input.addEventListener('change', () => resolve([...(input.files ?? [])]), { once: true });
      input.addEventListener('cancel', () => resolve([]), { once: true });
      input.click();
    });
  }

  /* ------------------------------------------------------------- costs */

  readonly costDraft = signal<CompanyCost | null>(null);
  /** Files picked before the cost exists (the '+' photo, a drop); they go up after the first save. */
  readonly costFiles = signal<File[]>([]);
  private duplicating = false;

  openCost(cost: CompanyCost | null, files: readonly File[] = []): void {
    this.duplicating = false;
    this.costFiles.set([...files]);
    this.costDraft.set(cost ? { ...cost } : blankCost(this.today()));
  }

  /** A copy dated today, open, not tied to a recurring definition; its documents stay with the original. */
  duplicateCost(cost: CompanyCost): void {
    this.openCost({ ...cost, id: null, date: this.today(), paidOn: null, recurringCostId: null, createdAt: null });
    this.duplicating = true;
  }

  async saveCost(draft: CompanyCost): Promise<CompanyCost | null> {
    if (this.saving()) return null;
    this.saving.set(true);
    const before = draft.id ? this.costs().find((row) => row.id === draft.id) : null;
    try {
      const body: CompanyCost = { ...draft, party: draft.party || null, reference: draft.reference || null, notes: draft.notes || null };
      const saved = draft.id ? await this.finance.updateCost(draft.id, body) : await this.finance.createCost(body);
      this.costs.update((rows) => (draft.id ? rows.map((row) => (row.id === saved.id ? saved : row)) : [saved, ...rows]));
      const text = this.duplicating && !draft.id ? 'Kost gedupliceerd' : draft.id ? 'Kost bewaard' : 'Kost geboekt';
      /* A cost that just became paid can go onto the bank in one more tap. */
      const newlyPaid = !!saved.paidOn && !before?.paidOn && !!saved.id;
      this.ui.toast(text, 'ok', newlyPaid ? { label: 'Op de bank noteren', run: () => this.openMovement(this.costMovement(saved)) } : undefined);
      this.duplicating = false;
      this.costDraft.set(null);
      return saved;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Bewaren mislukt'), 'err');
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  /** The bank movement that goes with a paid cost, with its marker. */
  costMovement(cost: CompanyCost): MovementPrefill {
    return { direction: 'OUTGOING', amount: inclOf(cost), day: cost.paidOn ?? this.today(), counterparty: (cost.party ?? '').slice(0, 300),
      reference: cost.id ? this.markedReference(cost.reference || cost.description, bankMarker('kost', cost.id)) : cost.reference || cost.description };
  }

  private markedReference(text: string | null, marker: string): string {
    const head = (text ?? '').trim().slice(0, 500 - marker.length - 3);
    return head ? `${head} · ${marker}` : marker;
  }

  deleteCost(cost: CompanyCost): void {
    if (!cost.id) return;
    this.ui.confirm({
      title: 'Kost verwijderen',
      message: `${escapeHtml(cost.description)} van ${escapeHtml(cost.date)} verdwijnt uit de boeken.`,
      confirmLabel: 'Verwijderen', danger: true,
    }, async () => {
      try {
        await this.finance.deleteCost(cost.id!);
        this.costs.update((rows) => rows.filter((row) => row.id !== cost.id));
        this.costDraft.set(null);
        if (this.inspect()?.kind === 'cost' && this.inspect()?.id === cost.id) this.closeInspector();
        this.ui.toast('Kost verwijderd');
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
      }
    });
  }

  /* ------------------------------------------------------ attachments */

  private async reloadAttachments(): Promise<void> {
    await this.reload(['attachments']);
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

  /** Files being cut loose right now; their × is disabled so a double click sends one call. */
  readonly detaching = signal<ReadonlySet<number>>(new Set());

  /** Cuts the file loose from the cost; the file itself stays in the library. */
  async detach(asset: MediaAssetSummary, costId: number): Promise<void> {
    const link = (asset.links ?? []).find((row) => row.targetType === 'COMPANY_COST' && row.targetId === costId);
    if (!link || this.detaching().has(asset.id)) return;
    this.detaching.update((ids) => new Set([...ids, asset.id]));
    try {
      await this.media.removeLink(asset.id, link.id);
      await this.reloadAttachments();
      this.ui.toast('Document losgemaakt');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Losmaken mislukt'), 'err');
    } finally {
      this.detaching.update((ids) => new Set([...ids].filter((id) => id !== asset.id)));
    }
  }

  async openAttachment(asset: MediaAssetSummary): Promise<void> {
    try {
      saveBlob(await this.media.download(asset.id), asset.originalFilename || asset.name);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Openen mislukt'), 'err');
    }
  }

  /* --------------------------------------------------------------- pay */

  readonly paySheet = signal<{ costs: CompanyCost[] } | null>(null);

  openPay(costs: readonly CompanyCost[]): void {
    const open = costs.filter((cost) => !!cost.id && !cost.paidOn);
    if (!open.length) {
      this.ui.toast(costs.length === 1 ? 'Deze kost is al betaald' : 'Deze kosten zijn al betaald');
      return;
    }
    this.paySheet.set({ costs: open });
  }

  payToBank(): PayToBankPreference {
    try {
      const raw = globalThis.localStorage?.getItem(PAY_TO_BANK_KEY);
      const parsed = raw ? JSON.parse(raw) as Partial<PayToBankPreference> : null;
      return { on: parsed?.on === true, accountKey: typeof parsed?.accountKey === 'string' ? parsed.accountKey : '' };
    } catch {
      return { on: false, accountKey: '' };
    }
  }

  rememberPayToBank(preference: PayToBankPreference): void {
    try { globalThis.localStorage?.setItem(PAY_TO_BANK_KEY, JSON.stringify(preference)); } catch { /* private mode: this visit only */ }
  }

  /** The full swipe on a phone: paid today, onto the bank when this device said so before. */
  swipePay(cost: CompanyCost): void {
    const preference = this.payToBank();
    const known = this.accountOptions().some((option) => option.key === preference.accountKey);
    void this.markPaid([cost], { paidOn: this.today(), bankAccount: preference.on && known ? preference.accountKey : null });
  }

  /**
   * Marks costs paid on a day, one by one under the busy lock, and notes an
   * outgoing bank line per cost when an account is given (with a "kost #id"
   * marker so it can be found back). The toast offers to undo both.
   */
  async markPaid(costs: readonly CompanyCost[], options: PayOptions): Promise<boolean> {
    const targets = costs.filter((cost) => !!cost.id && !cost.paidOn);
    if (!targets.length || this.busy()) return false;
    const account = options.bankAccount ? this.accountLabel(options.bankAccount) : null;
    const done: PaidEntry[] = [];
    let firstError = '';
    let bankFailed = false;
    this.busy.set(true);
    this.progress.set({ done: 0, total: targets.length });
    try {
      for (const cost of targets) {
        try {
          const saved = await this.finance.markCostPaid(cost.id!, options.paidOn);
          this.replaceCost(saved);
          let line: BankStatementLine | null = null;
          if (account) {
            try {
              line = await this.banking.create(this.payLine(saved, options.paidOn, account));
              const created = line;
              this.bankStatements.update((rows) => [created, ...rows.filter((row) => row.id !== created.id)]);
            } catch (failure: unknown) {
              bankFailed = true;
              firstError ||= messageOf(failure, 'Bankbeweging bewaren mislukt');
            }
          }
          done.push({ cost: saved, paidOn: options.paidOn, line });
        } catch (failure: unknown) {
          firstError ||= messageOf(failure, 'Betaald zetten mislukt');
        }
        this.progress.update((progress) => progress && { ...progress, done: progress.done + 1 });
      }
    } finally {
      this.busy.set(false);
      this.progress.set(null);
    }
    this.paySheet.set(null);
    if (done.some((entry) => entry.line)) void this.refreshBank();
    if (!done.length) {
      this.ui.toast(firstError || 'Betaald zetten mislukt', 'err');
      return false;
    }
    if (done.length < targets.length) {
      this.ui.toast(`${done.length} van ${targets.length} gelukt; ${firstError}`, 'err');
      void this.refreshCosts();
      return true;
    }
    if (bankFailed) {
      this.ui.toast('Betaald gezet, maar de bankbeweging is niet bewaard.', 'err');
      return true;
    }
    const text = done.length === 1
      ? `${done[0].cost.description} betaald op ${shortDay(options.paidOn)}${done[0].line ? ` · ook op ${account} genoteerd` : ''}`
      : `${done.length} kosten betaald op ${shortDay(options.paidOn)}`;
    this.ui.toast(text, 'ok', { label: 'Ongedaan maken', run: () => void this.undoPaid(done) });
    return true;
  }

  private payLine(cost: CompanyCost, paidOn: string, account: string): BankMovementRequest {
    const now = receiptLocalParts(Date.now(), BANK_ZONE);
    return {
      account, amountEur: inclOf(cost), direction: 'OUTGOING',
      bookedAt: receiptInstant(paidOn, paidOn === now.day ? now.time : '12:00:00', BANK_ZONE), timeZone: BANK_ZONE,
      reference: this.markedReference(cost.reference || cost.description, bankMarker('kost', cost.id!)),
      counterparty: (cost.party ?? '').trim().slice(0, 300) || null, requestId: crypto.randomUUID(),
    };
  }

  /** Reverts only what nobody touched since: the paid date this action set, and lines not linked since. */
  private async undoPaid(entries: readonly PaidEntry[]): Promise<void> {
    if (this.busy()) {
      this.ui.toast('Even wachten: er loopt nog een actie.');
      return;
    }
    let skipped = false;
    let failed = '';
    this.busy.set(true);
    this.progress.set({ done: 0, total: entries.length });
    try {
      for (const entry of entries) {
        const current = this.costs().find((cost) => cost.id === entry.cost.id);
        if (current && current.paidOn === entry.paidOn) {
          try {
            this.replaceCost(await this.finance.updateCost(current.id!, { ...current, paidOn: null }));
          } catch (failure: unknown) { failed ||= messageOf(failure, 'Terugzetten mislukt'); }
        } else skipped = true;
        if (entry.line) {
          const line = this.bankStatements().find((row) => row.id === entry.line!.id);
          if (line && line.salesPaymentId === null) {
            try {
              await this.banking.delete(line.id);
              this.bankStatements.update((rows) => rows.filter((row) => row.id !== line.id));
            } catch (failure: unknown) { failed ||= messageOf(failure, 'Bankbeweging intrekken mislukt'); }
          } else if (line) skipped = true;
        }
        this.progress.update((progress) => progress && { ...progress, done: progress.done + 1 });
      }
    } finally {
      this.busy.set(false);
      this.progress.set(null);
    }
    if (entries.some((entry) => entry.line)) void this.refreshBank();
    if (failed) this.ui.toast(failed, 'err');
    else if (skipped) this.ui.toast('Niet alles ongedaan gemaakt: intussen gewijzigd.');
    else this.ui.toast('Betaling teruggezet');
  }

  /** 'Weer open zetten' / 'Niet betaald'. */
  async markUnpaid(cost: CompanyCost): Promise<void> {
    if (!cost.id || !cost.paidOn || this.busy() || this.saving()) return;
    this.saving.set(true);
    try {
      this.replaceCost(await this.finance.updateCost(cost.id, { ...cost, paidOn: null }));
      this.ui.toast('Weer open gezet');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Terugzetten mislukt'), 'err');
    } finally {
      this.saving.set(false);
    }
  }

  private replaceCost(saved: CompanyCost): void {
    this.costs.update((rows) => rows.map((row) => (row.id === saved.id ? saved : row)));
    this.costDraft.update((draft) => (draft && draft.id === saved.id ? saved : draft));
  }

  /* -------------------------------------------------------------- bulk */

  /** Runs one call per item, in order, under the busy lock; a partial failure says how far it got. */
  private async runBulk<T>(items: readonly T[], work: (item: T) => Promise<void>, doneText: (count: number) => string): Promise<void> {
    if (!items.length || this.busy()) return;
    let ok = 0;
    let firstError = '';
    this.busy.set(true);
    this.progress.set({ done: 0, total: items.length });
    try {
      for (const item of items) {
        try { await work(item); ok += 1; } catch (failure: unknown) { firstError ||= messageOf(failure, 'Mislukt'); }
        this.progress.update((progress) => progress && { ...progress, done: progress.done + 1 });
      }
    } finally {
      this.busy.set(false);
      this.progress.set(null);
    }
    if (ok < items.length) {
      this.ui.toast(`${ok} van ${items.length} gelukt; ${firstError}`, 'err');
      await this.refreshCosts();
    } else this.ui.toast(doneText(ok));
  }

  setCategory(costs: readonly CompanyCost[], code: string): Promise<void> {
    return this.runBulk(costs.filter((cost) => !!cost.id), async (cost) => {
      this.replaceCost(await this.finance.updateCost(cost.id!, { ...cost, category: code }));
    }, (count) => `${count} ${count === 1 ? 'kost' : 'kosten'} naar ${categoryLabel(code)}`);
  }

  deleteCosts(costs: readonly CompanyCost[]): void {
    const targets = costs.filter((cost) => !!cost.id);
    if (!targets.length) return;
    if (targets.length === 1) { this.deleteCost(targets[0]); return; }
    this.ui.confirm({
      title: 'Kosten verwijderen', message: `${targets.length} kosten verdwijnen uit de boeken.`, confirmLabel: 'Verwijderen', danger: true,
    }, () => void this.runBulk(targets, async (cost) => {
      await this.finance.deleteCost(cost.id!);
      this.costs.update((rows) => rows.filter((row) => row.id !== cost.id));
    }, (count) => `${count} kosten verwijderd`));
  }

  async downloadDocuments(costs: readonly CompanyCost[]): Promise<void> {
    const ids = [...new Set(costs.flatMap((cost) => this.attachmentsFor(cost.id).map((asset) => asset.id)))];
    if (!ids.length) {
      this.ui.toast('Deze kosten hebben geen documenten');
      return;
    }
    try {
      saveBlob(await this.media.downloadZip(ids, 'original'), `kosten-documenten-${this.today()}.zip`);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Downloaden mislukt'), 'err');
    }
  }

  /** The list as the accountant wants it: semicolons, a decimal comma, a BOM. */
  exportCsv(rows: readonly CostLedgerRow[], filename: string): void {
    if (!rows.length) {
      this.ui.toast('Niets om te exporteren');
      return;
    }
    saveBlob(new Blob(['﻿' + costLedgerCsv(rows, this.categoryName)], { type: 'text/csv;charset=utf-8' }), filename);
  }

  /** 'Exporteer CSV' where a section has no list of its own: every cost and container payment of this year. */
  exportThisYear(): void {
    const year = this.today().slice(0, 4);
    this.exportCsv(this.ledger().filter((row) => row.date >= `${year}-01-01` && row.date <= `${year}-12-31`), `kosten-${year}.csv`);
  }

  /** CSV of a quarter with the file names, plus a zip of the documents linked to its company costs. */
  async accountantPackage(year: number, quarter: number): Promise<void> {
    const first = (quarter - 1) * 3 + 1;
    const from = `${year}-${String(first).padStart(2, '0')}-01`;
    const to = new Date(Date.UTC(year, first + 2, 0)).toISOString().slice(0, 10);
    const rows = this.ledger().filter((row) => row.date >= from && row.date <= to);
    const names = (row: CostLedgerRow): string => this.attachmentsFor(row.cost?.id).map((asset) => asset.originalFilename || asset.name).join(', ');
    saveBlob(new Blob(['﻿' + costLedgerCsv(rows, this.categoryName, names)], { type: 'text/csv;charset=utf-8' }), `kosten-${year}-Q${quarter}.csv`);
    const ids = [...new Set(rows.flatMap((row) => this.attachmentsFor(row.cost?.id).map((asset) => asset.id)))];
    if (!ids.length) return;
    try {
      saveBlob(await this.media.downloadZip(ids, 'original'), `kosten-${year}-Q${quarter}-documenten.zip`);
    } catch {
      this.ui.toast('Documenten downloaden mislukt; de CSV is bewaard.', 'err');
    }
  }

  /* --------------------------------------------------------- recurring */

  readonly recurringDraft = signal<RecurringCost | null>(null);

  openRecurring(definition: RecurringCost | null): void {
    this.recurringDraft.set(definition ? { ...definition } : blankRecurring(this.today()));
  }

  /**
   * How many missed periods a save books at once because it resumes a
   * paused definition (its 'Actief' switch went on); 0 for anything else.
   */
  resumeBacklog(draft: RecurringCost): number {
    const stored = draft.id ? this.recurring().find((row) => row.id === draft.id) : null;
    if (!stored || stored.active || !draft.active || !stored.nextDate) return 0;
    return previewBacklog({ ...draft, nextDate: stored.nextDate }, this.today());
  }

  /** Saves the form; a resume with a backlog is confirmed first, the same as the switch on the row. */
  saveRecurring(draft: RecurringCost): void {
    if (this.saving()) return;
    const missed = this.resumeBacklog(draft);
    const since = this.recurring().find((row) => row.id === draft.id)?.nextDate ?? draft.startDate;
    if (missed > 0) {
      this.ui.confirm({
        title: 'Vaste kost hervatten',
        message: `Hervatten boekt meteen ${missed} gemiste ${missed === 1 ? 'periode' : 'periodes'} sinds ${escapeHtml(since.split('-').reverse().join('/'))}.`,
        confirmLabel: 'Hervatten',
      }, () => void this.persistRecurring(draft));
    } else void this.persistRecurring(draft);
  }

  private async persistRecurring(draft: RecurringCost): Promise<boolean> {
    if (this.saving()) return false;
    this.saving.set(true);
    try {
      const body: RecurringCost = { ...draft, party: draft.party || null, reference: draft.reference || null, notes: draft.notes || null, endDate: draft.endDate || null };
      const before = this.costs().length;
      const saved = draft.id ? await this.finance.updateRecurringCost(draft.id, body) : await this.finance.createRecurringCost(body);
      this.recurring.update((rows) => (draft.id ? rows.map((row) => (row.id === saved.id ? saved : row)) : [saved, ...rows]));
      /* The server books what already fell due (on create, and on an update that resumes); show that straight away. */
      await this.refreshCosts();
      const booked = this.costs().length - before;
      const periods = booked > 0 ? `, ${booked} ${booked === 1 ? 'periode' : 'periodes'} geboekt` : '';
      this.ui.toast(`${draft.id ? 'Vaste kost bewaard' : 'Vaste kost ingesteld'}${periods}`, 'ok');
      this.recurringDraft.set(null);
      return true;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Bewaren mislukt'), 'err');
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Pause or resume. Resuming books every missed period at once (the
   * server runs bookDue on update), so a backlog is confirmed first.
   */
  setRecurringActive(definition: RecurringCost, active: boolean): void {
    if (!definition.id || definition.active === active) return;
    const missed = active && definition.nextDate && definition.nextDate <= this.today()
      ? occurrencesBetween(definition, definition.nextDate, this.today()).length : 0;
    const apply = async (): Promise<void> => {
      if (this.saving()) return;
      this.saving.set(true);
      try {
        const before = this.costs().length;
        const saved = await this.finance.updateRecurringCost(definition.id!, { ...definition, active });
        this.recurring.update((rows) => rows.map((row) => (row.id === saved.id ? saved : row)));
        await this.refreshCosts();
        const booked = this.costs().length - before;
        this.ui.toast(active ? `Hervat: ${definition.name}${booked > 0 ? `, ${booked} ${booked === 1 ? 'periode' : 'periodes'} geboekt` : ''}` : `Gepauzeerd: ${definition.name}`);
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, active ? 'Hervatten mislukt' : 'Pauzeren mislukt'), 'err');
      } finally {
        this.saving.set(false);
      }
    };
    if (missed > 0) {
      this.ui.confirm({
        title: 'Vaste kost hervatten',
        message: `Hervatten boekt meteen ${missed} gemiste ${missed === 1 ? 'periode' : 'periodes'} sinds ${escapeHtml(definition.nextDate!.split('-').reverse().join('/'))}.`,
        confirmLabel: 'Hervatten',
      }, () => void apply());
    } else void apply();
  }

  deleteRecurring(definition: RecurringCost): void {
    if (!definition.id) return;
    this.ui.confirm({
      title: 'Vaste kost verwijderen',
      message: `${escapeHtml(definition.name)} wordt niet meer geboekt. De kosten die al geboekt zijn, blijven staan.`,
      confirmLabel: 'Verwijderen', danger: true,
    }, async () => {
      try {
        await this.finance.deleteRecurringCost(definition.id!);
        this.recurring.update((rows) => rows.filter((row) => row.id !== definition.id));
        this.recurringDraft.set(null);
        if (this.inspect()?.kind === 'recurring' && this.inspect()?.id === definition.id) this.inspect.set(null);
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

  /* ---------------------------------------------------- bank readings */

  readonly bankDraft = signal<BankBalance | null>(null);
  readonly accountCheck = signal<{ key: string } | null>(null);

  /** A new reading for an account (its label prefilled), or an empty one for a new account. */
  openBank(balance: BankBalance | null, key = ''): void {
    this.bankDraft.set(balance ? { ...balance } : blankBalance(this.today(), key ? this.accountLabel(key) : ''));
  }

  /** 'Klopt het saldo?' for an account with a reading; the first reading otherwise. */
  checkOrFill(key: string): void {
    const account = this.accountsView().find((row) => row.account === key);
    if (account?.reading) this.accountCheck.set({ key });
    else this.openBank(null, key);
  }

  async saveBank(draft: BankBalance): Promise<boolean> {
    if (this.saving()) return false;
    this.saving.set(true);
    try {
      const body: BankBalance = { ...draft, account: draft.account.trim().replace(/\s+/g, ' '), notes: draft.notes || null };
      const saved = draft.id ? await this.finance.updateBankBalance(draft.id, body) : await this.finance.createBankBalance(body);
      this.balances.update((rows) => (draft.id ? rows.map((row) => (row.id === saved.id ? saved : row)) : [saved, ...rows]));
      this.ui.toast(draft.id ? 'Saldo bewaard' : 'Saldo ingevuld', 'ok');
      this.bankDraft.set(null);
      return true;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Bewaren mislukt'), 'err');
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /** Writes what the bank app says as a reading taken now; the difference goes into its notes. */
  async checkAccount(key: string, balanceEur: number): Promise<boolean> {
    const account = this.accountsView().find((row) => row.account === key);
    if (!account || this.saving() || !Number.isFinite(balanceEur)) return false;
    const difference = Math.round(balanceEur * 100) - Math.round((account.currentEur ?? 0) * 100);
    const asOfAt = new Date().toISOString();
    this.saving.set(true);
    try {
      const saved = await this.finance.createBankBalance({
        id: null, account: account.label, date: receiptLocalParts(asOfAt, BANK_ZONE).day, asOfAt, timeZone: BANK_ZONE,
        balanceEur: round2(balanceEur),
        notes: difference === 0 ? 'Gecontroleerd met bankapp' : `Gecontroleerd; verschil ${formatEuro(difference / 100)} met berekend saldo`,
      });
      this.balances.update((rows) => [saved, ...rows]);
      this.accountCheck.set(null);
      this.ui.toast(difference === 0 ? 'Saldo klopt' : `Nieuw saldo bewaard · verschil ${formatEuro(difference / 100)}`);
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
      message: `Het saldo van ${escapeHtml(balance.account)} op ${escapeHtml(balance.date)} verdwijnt.`,
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

  /* ---------------------------------------------------- bank movements */

  readonly movementDraft = signal<MovementDraft | null>(null);
  readonly movementBusy = signal(false);
  readonly movementError = signal('');

  /** The movement form from anywhere; the account comes from the prefill, this device's pay account, or the only one. */
  openMovement(prefill: MovementPrefill = {}): void {
    const options = this.accountOptions();
    const remembered = this.payToBank().accountKey;
    const given = prefill.accountKey && prefill.accountKey !== NO_ACCOUNT ? prefill.accountKey : '';
    const key = given || (options.some((option) => option.key === remembered) ? remembered : '')
      || (options.length === 1 ? options[0].key : '');
    this.movementError.set('');
    this.movementDraft.set({
      direction: prefill.direction ?? 'INCOMING', amount: prefill.amount ?? 0, account: key ? this.accountLabel(key) : '',
      day: prefill.day ?? this.today(), time: prefill.time ?? null, timeZone: BANK_ZONE,
      counterparty: prefill.counterparty ?? '', reference: prefill.reference ?? '', requestId: crypto.randomUUID(),
    });
  }

  closeMovement(): void {
    if (this.movementBusy()) return;
    this.movementDraft.set(null);
    this.movementError.set('');
  }

  /** "nu" is the current time today and midday on another day; an explicit HH:MM gets its seconds. */
  movementTime(draft: MovementDraft): string {
    if (draft.time) return draft.time.length === 5 ? `${draft.time}:00` : draft.time;
    const now = receiptLocalParts(Date.now(), draft.timeZone);
    return draft.day === now.day ? now.time : '12:00:00';
  }

  async saveMovement(): Promise<boolean> {
    const draft = this.movementDraft();
    if (!draft || this.movementBusy()) return false;
    let body: BankMovementRequest;
    try {
      if (!draft.account.trim()) throw new Error('Vul de bankrekening in.');
      if (!Number.isFinite(draft.amount) || draft.amount <= 0) throw new Error('Vul een bedrag groter dan nul in.');
      if (Math.abs(draft.amount * 100 - Math.round(draft.amount * 100)) > 0.00001) throw new Error('Gebruik maximaal twee decimalen voor het bankbedrag.');
      const timing = receiptRequest({ amount: draft.amount, day: draft.day, time: this.movementTime(draft), timeZone: draft.timeZone, reference: draft.reference });
      body = { account: draft.account.trim(), amountEur: timing.amountEur, direction: draft.direction,
        bookedAt: timing.receivedAt, timeZone: timing.timeZone, reference: timing.reference,
        counterparty: draft.counterparty.trim() || null, requestId: draft.requestId };
    } catch (failure) {
      this.movementError.set((failure as Error).message.replace('Een ontvangen betaling', 'Een bankbeweging'));
      return false;
    }
    this.movementBusy.set(true);
    this.movementError.set('');
    try {
      const saved = await this.banking.create(body);
      this.bankStatements.update((rows) => [saved, ...rows.filter((row) => row.id !== saved.id)]);
      this.movementDraft.set(null);
      this.ui.toast('Bankbeweging bewaard', 'ok', this.hiddenByFilters(saved) ? {
        label: 'Tonen', run: () => this.go({ view: 'bank', tab: 'movements', dir: '', link: '', account: '', q: '', period: 'all', from: '', to: '' }),
      } : undefined);
      void this.refreshBank();
      return true;
    } catch (failure: unknown) {
      this.movementError.set(messageOf(failure, 'Bankbeweging bewaren mislukt'));
      return false;
    } finally {
      this.movementBusy.set(false);
    }
  }

  /** Whether the Bewegingen list as filtered now would hide a line. */
  private hiddenByFilters(line: BankStatementLine): boolean {
    const location = this.location();
    if (location.view !== 'bank' || location.tab !== 'movements') return false;
    const day = paymentLocalDay({ receivedAt: line.bookedAt, timeZone: line.timeZone });
    const range = this.rangeOf(location);
    const text = [line.reference, line.counterparty, line.account].join(' ').toLocaleLowerCase('nl-BE');
    return (location.dir === 'in' && line.amountEur < 0) || (location.dir === 'out' && line.amountEur > 0)
      || (location.link === 'unlinked' && line.amountEur < 0)
      || (!!location.account && bankAccountKey(location.account) !== bankAccountKey(line.account))
      || (!!location.q.trim() && !text.includes(location.q.trim().toLocaleLowerCase('nl-BE')))
      || (!!range.from && day < range.from) || (!!range.to && day > range.to);
  }
}
