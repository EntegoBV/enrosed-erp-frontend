import { Location } from '@angular/common';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import { BankingApi, BankAccount, BankMovementRequest, BankPurchasePaymentPart, BankStatementLine } from '../../core/api/banking-api';
import { CashForecastApi } from '../../core/api/cash-forecast-api';
import { FinanceApi } from '../../core/api/finance-api';
import { MediaApi } from '../../core/api/media-api';
import { MediaAssetSummary } from '../../core/api/media-models';
import {
  BankBalance, CashForecastSettings, CompanyCost, CompanyProfile, CostParty, CostPayment, Country, Customer, Fair, IncomingPaymentRow, PartnerAdvanceSchedule,
  PartnerFinancing, PurchaseOrderForecast, PurchaseOrderView, PurchasePaymentRow, RecurringCost, SalesOrderView, SalesPurpose, Supplier,
} from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { receiptInstant, receiptLocalParts, receiptRequest } from '../../shared/received-at';
import type { ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { Ui, escapeHtml } from '../../shared/ui';
import { SALES_CHANNELS, channelLabel } from '../sales/sales-channels';
import type { SalesChannel } from '../sales/sales-channels';
import { bankAccountKey, canonicalBankAccount, bankCheckpoint, reconciledBank } from './bank-reconciliation';
import { bankAllocationTargets } from './bank-allocation-targets';
import { changePreview } from './bank-change-preview';
import type { KeepAs, LinkTarget } from './bank-change-preview';
import { runLink, undoLink } from './bank-link-actions';
import type { LinkOutcome } from './bank-link-actions';
import { lineSuggestions } from './bank-suggestions';
import type { LineSuggestion } from './bank-suggestions';
import { addDismissed, readDismissed } from './cash-dismissed';
import { NO_DEFAULTS, buildCashForecast, dayEndBalances, runningBalances } from './cash-forecast';
import { cashForecastInput, vooruitblikOf } from './cash-forecast-input';
import { bankAmountsMatch, bankTransactionDay } from '../../shared/bank-transaction-options';
import { bankMarker, lineMarkers, matchOutgoings, unbankedOutgoings, unbankedSinceDay } from './bank-markers';
import type { MarkerKind, OutgoingRow } from './bank-markers';
import { mergeChannels } from './channel-choices';
import { SUPPLIER_COUNTRIES } from './cost-countries';
import type { CountryChoice } from './cost-countries';
import { newPaymentOf, paymentsBanked } from './cost-payments';
import { readPayToBank, writePayToBank } from './pay-to-bank-preference';
import type { PayToBankPreference } from './pay-to-bank-preference';
import { categoryLabel } from './cost-categories';
import { CONTAINER_PAYMENT_CATEGORIES, CostLedgerRow, costLedger, costLedgerCsv } from './cost-ledger';
import { financeAttention } from './finance-attention';
import { dayMonthYear } from './finance-format';
import { FinanceIntake } from './finance-intake';
import {
  addDays, cashTotalOf, costRegimeCells, occurrencesBetween, openOf, previewBacklog, quarterOf, returnLineOf, returnVatOf, upcomingRecurring,
} from './finance-metrics';
import { blankBalance, blankCost, blankCostParty, blankFair, blankRecurring, FINANCE_TABS, financeSection, localIsoDay, periodRange } from './finance-sections';
import type { PeriodId } from './finance-sections';
import type { FinanceMenu } from './finance-section';
import { FinanceLocation, NO_ACCOUNT, financeQueryParams, parseFinanceLocation, patchLocation } from './finance-url';
import { incomingMoneyTotals, invoiceReceivable, paymentLocalDay, receivableTotals, uniqueIncomingPayments } from './incoming-money';
import { partyKey } from './party-suggestions';
import type { PartyCandidate } from './party-suggestions';
import { containerPayables, daysBetween, payableTotals, payablesFor } from './payables';
import { containerPaymentTree, type PayeeBranch } from './container-payment-tree';
import { reconciliationStatusLabel } from '../purchasing/purchase-reconciliation-metrics';
import type { OpenCost } from './payables';
import { containerLines, salesDocLines, vatReturn, vatReturnCsv } from './vat-return';
import type { VatReturn } from './vat-return';

/** A place the data comes from; each can fail on its own and keeps its last good value. */
export type FinanceSource = 'costs' | 'recurring' | 'balances' | 'orders' | 'customers' | 'payments' | 'attachments'
  | 'bankAccounts' | 'incoming' | 'statements' | 'containers' | 'parties' | 'fairs' | 'countries' | 'company'
  | 'suppliers' | 'financing' | 'forecasts' | 'cashSettings';

const SOURCE_NAMES: Readonly<Record<FinanceSource, string>> = {
  bankAccounts: 'Bankrekeningen', costs: 'Bedrijfskosten', recurring: 'Vaste kosten', balances: 'Banksaldi', orders: 'Verkoopfacturen', customers: 'Klanten',
  payments: 'Containerbetalingen', attachments: 'Kostendocumenten', incoming: 'Ontvangsten en terugbetalingen',
  statements: 'Banktransacties', containers: 'Containers', parties: 'Aan wie', fairs: 'Beurzen', countries: 'Landen', company: 'Bedrijf',
  suppliers: 'Leveranciers', financing: 'Partnervoorschotten', forecasts: 'Prognosekeuzes', cashSettings: 'Kasbuffer',
};
/** What the Kaslijn needs beyond the main load; fetched after it, like the containers. */
const CASH_SOURCES: readonly FinanceSource[] = ['suppliers', 'financing', 'forecasts', 'cashSettings'];
const MAIN_SOURCES: readonly FinanceSource[] = ['bankAccounts', 'costs', 'recurring', 'balances', 'orders', 'customers', 'payments', 'attachments', 'incoming', 'statements', 'parties', 'fairs', 'countries', 'company'];
const BANK_ZONE = 'Europe/Brussels';
const INACTIVE = new Set(['CONCEPT', 'GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN']);
const round2 = (value: number): number => Math.round(value * 100) / 100;
const euro = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
export const formatEuro = (value: number): string => euro.format(value);
/** A phase-2 control on a server without the 2026-10-16 round (cashRound false), as the Inkoop sheet words it. */
export const SERVER_PENDING = 'Kan zodra de server bijgewerkt is.';
const shortDay = (day: string): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** What the inspector (desk) or the detail sheet (phone) shows; a bank line ('line') has its own address (line=). */
export interface InspectTarget {
  kind: 'cost' | 'container' | 'invoice' | 'recurring' | 'line';
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
  /** The payment the action wrote; null on an older server that returned no payments. */
  paymentId: number | null;
  line: BankStatementLine | null;
}

/** A paid row as the bank matching reads it, with the ledger row it came from. */
type PaidOutgoing = OutgoingRow & { row: CostLedgerRow; costId: number | null };

/** One name as the bookings know it: how often it came back and the newest booking's defaults. */
interface PartyBooking {
  name: string;
  count: number;
  lastDate: string;
  category: string | null;
  vatPct: number | null;
  salesChannel: string | null;
}

/** What a new cost to a name takes over: the stored defaults of the Aan wie list, else the newest booking's. */
export interface PartyPrefill {
  name: string;
  category: string | null;
  vatPct: number | null;
  salesChannel: string | null;
  stored: boolean;
}

/** A name's figures in the loaded costs: this year's count and total excl. btw, and the last cost date. */
export interface PartyFigures {
  count: number;
  exclEur: number;
  lastDate: string | null;
}

const byName = (left: CostParty, right: CostParty): number => left.name.localeCompare(right.name, 'nl');
const byLabel = (left: Fair, right: Fair): number => left.label.localeCompare(right.label, 'nl');

/**
 * Everything the Kosten & bank sections share: the data, the address, the
 * forms and the actions. Provided by the workspace page, so a section never
 * loads on its own and the address (see finance-url.ts) is the page's.
 */
@Injectable()
export class FinanceState {
  private readonly finance = inject(FinanceApi);
  private readonly banking = inject(BankingApi);
  private readonly cash = inject(CashForecastApi);
  private readonly sales = inject(SalesApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly media = inject(MediaApi);
  private readonly ui = inject(Ui);
  private readonly intake = inject(FinanceIntake);
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
  readonly bankAccountEditor = signal<BankAccount | null>(null);
  readonly bankAccounts = signal<BankAccount[]>([]);
  readonly bankStatements = signal<BankStatementLine[]>([]);
  readonly salesOrders = signal<SalesOrderView[]>([]);
  readonly customers = signal<Customer[]>([]);
  readonly payments = signal<PurchasePaymentRow[]>([]);
  readonly incomingPayments = signal<IncomingPaymentRow[]>([]);
  /** Every file linked to a cost: the invoices, receipts and contracts. */
  readonly attachments = signal<MediaAssetSummary[]>([]);
  /** The purchase orders with their reconciliation: heavy, so loaded apart and never awaited. */
  readonly purchaseViews = signal<PurchaseOrderView[]>([]);
  /** The "Aan wie" list, by name; the server adds every name it sees on a booking. */
  readonly costParties = signal<CostParty[]>([]);
  /** The fairs, by label; their codes are sales channels. */
  readonly fairs = signal<Fair[]>([]);
  /** The countries the sales side knows (names and EU membership), for the supplier country picker. */
  readonly countries = signal<Country[]>([]);
  /** Our own profile: the fiscal representative and the ET 14000 setting the return reads. */
  readonly company = signal<CompanyProfile | null>(null);
  /** The Kaslijn's other sources: lead times, unbilled partner advances, the stored per-order choices and the buffer. */
  readonly suppliers = signal<Supplier[]>([]);
  readonly partnerFinancing = signal<PartnerFinancing[]>([]);
  readonly advanceSchedules = signal<PartnerAdvanceSchedule[]>([]);
  readonly forecasts = signal<PurchaseOrderForecast[]>([]);
  /** The buffer; null on a server without the 2026-10-16 round (cashRound false). */
  readonly cashSettings = signal<CashForecastSettings | null>(null);

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
  /** Reconciliation must not use retained data when one of its required sources failed to refresh. */
  sourceErrors(sources: readonly FinanceSource[]): string[] {
    const errors = this.errorMap();
    return [...new Set(sources)].map(source => errors[source]).filter((message): message is string => !!message);
  }
  private readonly requests: Record<FinanceSource, number> = {
    bankAccounts: 0, costs: 0, recurring: 0, balances: 0, orders: 0, customers: 0, payments: 0, attachments: 0, incoming: 0, statements: 0, containers: 0, parties: 0, fairs: 0, countries: 0, company: 0,
    suppliers: 0, financing: 0, forecasts: 0, cashSettings: 0,
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
      void this.reload(CASH_SOURCES);
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
    return this.reload(['statements', 'incoming', 'orders', 'balances', 'bankAccounts']);
  }

  refreshCosts(): Promise<void> {
    return this.reload(['costs', 'recurring']);
  }

  private fetch(source: FinanceSource): Promise<unknown> {
    switch (source) {
      case 'costs': return this.finance.costs();
      case 'recurring': return this.finance.recurringCosts();
      case 'bankAccounts': return this.banking.accounts();
      case 'balances': return this.finance.bankBalances();
      case 'orders': return this.sales.orders();
      case 'customers': return this.sales.customers();
      case 'payments': return this.sourcing.purchasePayments();
      /* The server pages at 200; archived files stay on their cost with a tag. */
      case 'attachments': return this.media.allAssets({ targetType: 'COMPANY_COST', includeArchived: true }, 5000).then((page) => page.items);
      case 'incoming': return this.sales.incomingPayments();
      case 'statements': return this.banking.list();
      case 'containers': return this.sourcing.purchaseOrders();
      case 'parties': return this.finance.costParties();
      case 'fairs': return this.finance.fairs();
      case 'countries': return this.sales.countries();
      case 'company': return this.sales.company();
      case 'suppliers': return this.sourcing.suppliers();
      case 'financing': return this.fetchFinancing();
      case 'forecasts': return this.cash.forecasts();
      case 'cashSettings': return this.cash.settings();
    }
  }

  /**
   * The partner financings and the advance schedules the Kaslijn counts: one
   * call per financing without a settlement invoice that still has unbilled
   * rows or a concept advance invoice (spec §3).
   */
  private async fetchFinancing(): Promise<{ financing: PartnerFinancing[]; schedules: PartnerAdvanceSchedule[] }> {
    const financing = await this.sourcing.partnerFinancings();
    const wanted = financing.filter((row) => row.settlementInvoiceId == null && ((row.unbilledAdvanceCount ?? 0) > 0
      || row.documents.some((doc) => doc.purpose === 'PARTNER_ADVANCE' && doc.docType === 'FACTUUR' && doc.status === 'CONCEPT')));
    const schedules = await Promise.all(wanted.map((row) => this.sourcing.partnerAdvanceSchedule(row.purchaseOrderId)));
    return { financing, schedules };
  }

  private apply(source: FinanceSource, value: unknown): void {
    switch (source) {
      case 'costs': this.costs.set(value as CompanyCost[]); break;
      case 'recurring': this.recurring.set(value as RecurringCost[]); break;
      case 'bankAccounts': this.bankAccounts.set(value as BankAccount[]); break;
      case 'balances': this.balances.set(value as BankBalance[]); break;
      case 'orders': this.salesOrders.set(value as SalesOrderView[]); break;
      case 'customers': this.customers.set(value as Customer[]); break;
      case 'payments': this.payments.set(value as PurchasePaymentRow[]); break;
      case 'attachments': this.attachments.set(value as MediaAssetSummary[]); break;
      case 'incoming': this.incomingPayments.set(value as IncomingPaymentRow[]); break;
      case 'statements': this.bankStatements.set(value as BankStatementLine[]); break;
      case 'containers': this.purchaseViews.set(value as PurchaseOrderView[]); break;
      case 'parties': this.costParties.set([...(value as CostParty[])].sort(byName)); break;
      case 'fairs': this.fairs.set([...(value as Fair[])].sort(byLabel)); break;
      case 'countries': this.countries.set(value as Country[]); break;
      case 'company': this.company.set(value as CompanyProfile); break;
      case 'suppliers': this.suppliers.set(value as Supplier[]); break;
      case 'financing': {
        const { financing, schedules } = value as { financing: PartnerFinancing[]; schedules: PartnerAdvanceSchedule[] };
        this.partnerFinancing.set(financing); this.advanceSchedules.set(schedules); break;
      }
      case 'forecasts': this.forecasts.set(value as PurchaseOrderForecast[]); break;
      case 'cashSettings': this.cashSettings.set(value as CashForecastSettings | null); break;
    }
  }

  /* ----------------------------------------------------------- derived */

  /**
   * The one switch for purchase figures. There is no customer-safe mode since
   * fd979b4 (staff always see them); a future one needs only this computed.
   */
  readonly purchaseFiguresVisible = computed(() => true);

  readonly bankLedger = computed(() => reconciledBank(this.balances(), this.bankStatements(), this.incomingPayments(), this.bankAccounts()));
  readonly currentBankEur = computed(() => this.bankLedger().totalEur);
  /** Company costs and container payments side by side; container rows follow their original payment. */
  readonly ledger = computed(() => costLedger(this.costs(), this.purchaseFiguresVisible() ? this.payments() : [], cashTotalOf));

  /** Costs with something still to pay (partly paid ones included), the oldest first: that is the order they should be paid in. */
  readonly openCosts = computed<OpenCost[]>(() => this.costs().filter((cost) => openOf(cost) !== 0)
    .map((cost) => ({ ...cost, openEur: openOf(cost), cashTotalEur: cashTotalOf(cost) }))
    .sort((left, right) => left.date.localeCompare(right.date) || (left.id ?? 0) - (right.id ?? 0)));
  readonly openCostsInclEur = computed(() => round2(this.openCosts().reduce((sum, cost) => sum + cost.openEur, 0)));
  /** Costs of this year whose regime was only derived (the backfill) or is still unknown: 'Btw-regeling bevestigen'. */
  readonly unconfirmedRegimeCount = computed(() => {
    const since = `${this.today().slice(0, 4)}-01-01`;
    return this.costs().filter((cost) => cost.date >= since && (!cost.vatRegimeConfirmed || !cost.vatRegime)).length;
  });
  /** The recurring costs of the coming 30 days: the one horizon of Te betalen. */
  readonly upcoming = computed(() => upcomingRecurring(this.recurring(), this.today(), addDays(this.today(), 30)));
  readonly upcomingInclEur = computed(() => round2(this.upcoming().reduce((sum, row) => sum + row.amountInclEur, 0)));
  /** Definitions whose next occurrence is today or earlier. */
  readonly dueNow = computed(() => this.recurring().filter((definition) => definition.active && !!definition.nextDate && definition.nextDate <= this.today()));
  /** Bank lines without a saved invoice, cost or purchase payment allocation. */
  readonly unlinkedIncomingCount = computed(() => this.bankStatements().filter((line) => this.officialBankLine(line) && !this.archivedBankLine(line) && !line.allocated && line.salesPaymentId === null).length);

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
  readonly accountOptions = computed(() => this.bankLedger().accounts.filter(account => !account.archived)
    .map((account) => ({ key: account.account, label: account.label }))
    .sort((left, right) => left.label.localeCompare(right.label, 'nl')));
  readonly manualAccountOptions = computed(() => this.accountOptions().filter(option => this.manualAccountAllowed(option.key)));
  readonly hasOdooAccounts = computed(() => this.bankLedger().accounts.some(account => account.source === 'ODOO' && !account.archived));
  readonly archivedAccounts = computed(() => this.bankLedger().accounts.filter(account => account.archived));
  canonicalAccount(key: string | null | undefined): string { return canonicalBankAccount(key, this.bankAccounts()); }
  manualAccountAllowed(key: string): boolean {
    return this.bankLedger().accounts.find(account => account.account === this.canonicalAccount(key))?.manualMovementsAllowed ?? true;
  }
  archivedBankLine(line: BankStatementLine): boolean {
    return this.bankLedger().accounts.find(account => account.account === this.canonicalAccount(line.account))?.archived ?? false;
  }
  officialBankLine(line: BankStatementLine): boolean {
    return line.source === 'ODOO' || this.bankLedger().accounts.find(account => account.account === this.canonicalAccount(line.account))?.source !== 'ODOO';
  }
  /** Readable account names, for the older pickers. */
  readonly accounts = computed(() => this.accountOptions().map((option) => option.label));
  readonly accountsView = computed(() => this.bankLedger().accounts.filter(account => !account.archived).map((account) => ({
    ...account,
    ageDays: account.checkedAt ? Math.max(0, daysBetween(paymentLocalDay({ receivedAt: account.checkedAt, timeZone: account.reading?.timeZone || BANK_ZONE }), this.today())) : null,
    /* "Telt mee in de kasprognose": missing (an older server, an account without a row) is true. */
    countsInCash: this.bankAccounts().find((row) => row.key === account.account)?.countsInCash !== false,
  })));

  accountLabel(key: string | null | undefined): string {
    if (!key) return '';
    if (key === NO_ACCOUNT) return 'Geen rekening';
    const normalised = this.canonicalAccount(key);
    return this.bankLedger().accounts.find((option) => option.account === normalised)?.label ?? key;
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
  /** The Vooruitblik: computed in one place (cash-forecast-input), so Bank, Kasprognose and Analyse never disagree. */
  readonly outlook = computed(() => vooruitblikOf({
    today: this.today(), bankAccounts: this.bankAccounts(), balances: this.balances(), statements: this.bankStatements(), incomingPayments: this.incomingPayments(),
    costs: this.costs(), recurring: this.recurring(), purchaseViews: this.purchaseFiguresVisible() ? this.purchaseViews() : [], salesOrders: this.salesOrders(),
  }));

  /* ------------------------------------------------- cash: Kaslijn, running saldo */

  /** The server knows the 2026-10-16 round (buffer, classification, follow the bank, due dates, accounts that count). */
  readonly cashRound = computed(() => this.cashSettings() !== null);
  /** "Niet deze" on a "Lijkt al betaald" match; per browser (cash-dismissed.ts). */
  readonly dismissed = signal<string[]>(readDismissed());
  dismiss(key: string): void { this.dismissed.set(addDismissed(key)); }
  /** The forecast input from everything this page loads; Kosten & bank loads complete statements and no products (no scenario). */
  readonly cashInput = computed(() => cashForecastInput({
    today: this.today(), bankAccounts: this.bankAccounts(), balances: this.balances(), statements: this.bankStatements(), incomingPayments: this.incomingPayments(),
    costs: this.costs(), recurring: this.recurring(), purchaseViews: this.purchaseViews(), purchasePayments: this.payments(), suppliers: this.suppliers(),
    salesOrders: this.salesOrders(), customers: this.customers(), advanceSchedules: this.advanceSchedules(), company: this.company(),
    forecasts: this.forecasts(), settings: this.cashSettings(), products: null, statementsFrom: null,
  }));
  /** The Kaslijn span in weeks (weeks= on Bank, 8 by default). */
  readonly kaslijnWeeks = computed(() => this.location().weeks ?? 8);
  /** The base forecast of the Kaslijn: no sales, no scenario, 28 days of bank behind it. */
  readonly kaslijn = computed(() => buildCashForecast(this.cashInput(), {
    horizonEnd: addDays(this.today(), this.kaslijnWeeks() * 7), scenario: false, includeStock: false, rulesOff: [], openQuotesOn: false,
    defaults: NO_DEFAULTS, dismissed: this.dismissed(), pastDays: 28,
  }));
  /** The saldo after every bank movement, per account and over the active accounts (the register's Saldo column). */
  readonly running = computed(() => runningBalances(this.cashInput().movements, this.cashInput().accounts));
  /** Saldo einde dag of one day: one account (its key) or every active account ('' or null). */
  dayEndEur(day: string, account: string | null = null): number | null {
    const input = this.cashInput();
    const keys = account ? [this.canonicalAccount(account)] : input.accounts.filter((row) => !row.archived && !row.labelOnly).map((row) => row.key);
    return dayEndBalances(input.movements, input.accounts, keys, day, day).get(day) ?? null;
  }
  /** A line's local day in its own zone (Odoo lines: the booking day). */
  lineDay(line: Pick<BankStatementLine, 'bookedAt' | 'timeZone'>): string {
    return paymentLocalDay({ receivedAt: line.bookedAt, timeZone: line.timeZone });
  }

  /** The cost payments on a line, with their cost: what the cost pattern learns from. */
  private readonly costPaymentLines = computed(() => this.costs().flatMap((cost) => (cost.payments ?? [])
    .filter((payment) => payment.bankStatementLineId != null && cost.id !== null)
    .map((payment) => ({ lineId: payment.bankStatementLineId!, costId: cost.id!, category: cost.category, party: cost.party ?? null, description: cost.description, date: payment.paidOn }))));
  /** The best match per unlinked official line of an active account (§3.8). */
  readonly suggestions = computed<Map<number, LineSuggestion>>(() => {
    const lines = this.bankStatements().filter((line) => this.officialBankLine(line) && !this.archivedBankLine(line));
    const containers = this.containerPayables();
    const supplierNames = new Map(this.suppliers().filter((row) => row.id != null).map((row) => [row.id!, row.name]));
    return lineSuggestions({
      lines, costs: this.costs(), sales: this.salesOrders(), containers, purchasePayments: this.payments(),
      customerName: (id) => this.customerNames().get(id ?? -1) ?? '', costPaymentsLinkedLines: this.costPaymentLines(),
      accountLabel: (key) => this.accountLabel(key), categoryLabel, lineDay: (line) => this.lineDay(line), today: this.today(),
      targets: (line) => bankAllocationTargets(line.amountEur, this.costs(), this.salesOrders(), containers, (id) => this.customerNames().get(id ?? -1) ?? '',
        cashTotalOf, openOf, (id) => {
          const order = this.purchaseViews().find((view) => view.order.id === id)?.order;
          return { party: supplierNames.get(order?.supplierId ?? -1) ?? '', date: order?.orderDate ?? '' };
        }),
    });
  });

  /* bank links: hard by payment, soft by marker */
  readonly lineMarkers = computed(() => lineMarkers(this.bankStatements()));
  /** One row per payment of every cost (a legacy paid cost without rows counts whole), plus the container payments. */
  private readonly paidOutgoings = computed<PaidOutgoing[]>(() => {
    const rows: PaidOutgoing[] = [];
    for (const row of this.ledger()) {
      if (row.cost) {
        const cost = row.cost;
        const payments = cost.payments ?? [];
        for (const payment of payments) {
          if (!payment.id) continue;
          rows.push({ kind: 'kostbetaling' as MarkerKind, id: payment.id, paidOn: payment.paidOn, amountEur: payment.amountEur,
            linkedLineId: payment.bankStatementLineId ?? null, legacyCostId: payments.length === 1 ? cost.id : null, row, costId: cost.id });
        }
        if (!payments.length && row.paidOn && cost.id) {
          rows.push({ kind: 'kost' as MarkerKind, id: cost.id, paidOn: row.paidOn, amountEur: row.amountEur, linkedLineId: cost.bankStatementLineId ?? null, row, costId: cost.id });
        }
      } else if (row.payment && row.paidOn && !row.payment.creditOffset) {
        // A credit offset left no bank: never 'zonder bankkoppeling', never in the attention count or the matching.
        rows.push({ kind: 'containerbetaling' as MarkerKind, id: row.payment.id, paidOn: row.paidOn, amountEur: row.amountEur,
          linkedLineId: row.payment.bankStatementLineId ?? null, row, costId: null });
      }
    }
    return rows;
  });
  readonly unbankedSince = computed(() => unbankedSinceDay(this.bankLedger().accounts.filter(account => !account.archived).flatMap((account) => account.reading ? [{
    day: account.reading.asOfAt ? paymentLocalDay({ receivedAt: account.reading.asOfAt, timeZone: account.reading.timeZone || BANK_ZONE }) : account.reading.date,
    endOfDay: !account.reading.asOfAt,
  }] : []), this.today()));
  /** Paid, but no bank line after the last check: 'Nog niet op de bank'. */
  readonly unbanked = computed(() => unbankedOutgoings(this.paidOutgoings(), this.bankStatements().filter(line => this.officialBankLine(line)), this.hasOdooAccounts() ? '0000-01-01' : this.unbankedSince())
    .sort((left, right) => (right.paidOn ?? '').localeCompare(left.paidOn ?? '')));
  /** Receipts on an active Odoo account that no line carries yet: "Betalingen zonder transactie" lists them with the unbanked payments. */
  readonly pendingReceipts = computed(() => {
    const linked = new Set(this.bankStatements().map(line => line.salesPaymentId));
    return this.incomingPayments().filter(payment => !linked.has(payment.id) && this.bankLedger().accounts.some(account => account.source === 'ODOO'
      && !account.archived && account.account === this.canonicalAccount(payment.bankAccount)));
  });
  /** The bank line that holds a paid row, by 'kostbetaling#7', 'kost#12' (a cost's only payment answers to both) or 'containerbetaling#3'. */
  readonly bankedLines = computed(() => {
    const map = new Map<string, BankStatementLine>();
    const lines = new Map(this.bankStatements().map((line) => [line.id, line]));
    for (const [row, line] of matchOutgoings(this.paidOutgoings(), this.bankStatements().filter(line => this.officialBankLine(line)))) {
      const full = lines.get(line.id);
      if (!full) continue;
      map.set(`${row.kind}#${row.id}`, full);
      if (row.legacyCostId) map.set(`kost#${row.legacyCostId}`, full);
    }
    return map;
  });

  /** How much of a cost's payments the bank holds: by hard link, marker or amount match. */
  paymentsBanked(cost: CompanyCost): 'none' | 'some' | 'all' {
    const payments = cost.payments ?? [];
    if (!payments.length) return cost.id && this.bankedLines().has(`kost#${cost.id}`) ? 'all' : 'none';
    const banked = this.bankedLines();
    return paymentsBanked(payments.map((payment) => ({ bankStatementLineId: payment.bankStatementLineId ?? (payment.id && banked.has(`kostbetaling#${payment.id}`) ? banked.get(`kostbetaling#${payment.id}`)!.id : null) })));
  }

  /** The account label of the last payment that is on the bank; '' when none is. */
  bankedOn(cost: CompanyCost): string {
    const banked = this.bankedLines();
    const payments = [...(cost.payments ?? [])].sort((left, right) => left.paidOn.localeCompare(right.paidOn) || (left.id ?? 0) - (right.id ?? 0));
    for (const payment of payments.reverse()) {
      const line = payment.id ? banked.get(`kostbetaling#${payment.id}`) : undefined;
      if (line) return this.accountLabel(line.account);
    }
    const legacy = cost.id ? banked.get(`kost#${cost.id}`) : undefined;
    return legacy ? this.accountLabel(legacy.account) : '';
  }

  /** The bank line a linked receipt went into, by receipt id. */
  private readonly lineByReceipt = computed(() => new Map(this.bankStatements()
    .filter((line) => line.salesPaymentId !== null).map((line) => [line.salesPaymentId!, line])));

  /** The account a receipt counts on: its own, else the one of the bank line it was linked to. */
  receiptAccountKey(row: { id: number; bankAccount?: string | null }): string {
    return this.canonicalAccount(this.lineByReceipt().get(row.id)?.account || row.bankAccount);
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
      openCosts: this.openCosts().map((cost) => ({ date: cost.date, openEur: cost.openEur })),
      unconfirmedRegimes: { count: this.unconfirmedRegimeCount() },
      dueNowCount: this.dueNow().length,
      containerNow: { count: containersNow.length, eur: round2(containersNow.reduce((sum, row) => sum + row.remainingEur, 0)) },
      bankLines: this.bankStatements().filter(line => this.officialBankLine(line) && !this.archivedBankLine(line)),
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

  /** Lines that mark a container payment by text only ('containerbetaling #id'): older than the hard link. */
  private readonly containerMarkerLines = computed(() => {
    const map = new Map<number, BankStatementLine>();
    for (const line of this.bankStatements()) {
      for (const marker of this.lineMarkers().get(line.id) ?? []) {
        if (marker.kind === 'containerbetaling' && !map.has(marker.id)) map.set(marker.id, line);
      }
    }
    return map;
  });
  /** A container payment's bank line: the hard link, else an older line's marker; never a guess by amount (as the order screens). */
  readonly containerPaymentLine = (row: PurchasePaymentRow): { accountLabel: string; day: string; lineId: number | null } | null => {
    const line = row.bankStatementLineId != null
      ? this.bankStatements().find((item) => item.id === row.bankStatementLineId) : this.containerMarkerLines().get(row.id);
    if (!line) return row.bankStatementLineId != null ? { accountLabel: '', day: '', lineId: row.bankStatementLineId } : null;
    return { accountLabel: this.accountLabel(line.account), day: bankTransactionDay(line), lineId: line.id };
  };
  /** One container as invoices → terms → payments, for Uitgaven › Containers and the inspector. */
  containerTree(view: PurchaseOrderView): PayeeBranch[] {
    return containerPaymentTree(view, this.payments(), this.containerPaymentLine,
      (stream) => reconciliationStatusLabel(stream, stream.payee === 'SUPPLIER' ? view.reconciliation?.supplierInstalments : undefined));
  }
  /** 'Bestand ↗' of a container invoice: the purchase document's file. */
  async openPurchaseFile(orderId: number, documentId: number, name: string): Promise<void> {
    try { saveBlob(await this.sourcing.documentFile(orderId, documentId), name || 'factuur'); }
    catch (failure) { this.ui.toast(messageOf(failure, 'Bestand openen mislukt'), 'err'); }
  }

  readonly categoryName = (code: string): string => CONTAINER_PAYMENT_CATEGORIES.find((category) => category.code === code)?.label ?? categoryLabel(code);

  /* channels: the built-in ones and the fairs, which are channel codes too */
  private readonly fairLabels = computed(() => new Map(this.fairs().map((fair) => [fair.code.trim().toUpperCase(), fair.label])));
  /** The channel pickers: every fair (active, or inactive but still on a cost) flagged by hint 'Beurs', then the built-in channels that are no fair. */
  readonly channelChoices = computed<SalesChannel[]>(() =>
    mergeChannels(SALES_CHANNELS, this.fairs(), [...this.costs(), ...this.recurring()].map((row) => row.salesChannel)));
  /** What a channel code is called: the fair's name when it is one, else the sales label. */
  readonly channelName = (code: string | null | undefined): string => this.fairLabels().get((code ?? '').trim().toUpperCase()) ?? channelLabel(code);

  /* countries and company settings the regime fields and the return read */
  /** The supplier country picker: the short built-in list (BE first), then every other country the sales side knows, by name. */
  readonly countryChoices = computed<CountryChoice[]>(() => {
    const known = new Set(SUPPLIER_COUNTRIES.map((row) => row.code));
    const extra = this.countries().map((row) => ({ code: row.code.toUpperCase(), name: row.name })).filter((row) => !known.has(row.code))
      .sort((left, right) => left.name.localeCompare(right.name, 'nl'));
    return [...SUPPLIER_COUNTRIES, ...extra];
  });
  /** Our limited fiscal representative in the Netherlands, named on the 86/55 rows. */
  readonly representativeName = computed(() => this.company()?.fiscalRepresentativeName?.trim() || null);

  /* "Aan wie": the stored list, and the names the bookings know */
  private readonly partyByKey = computed(() => new Map(this.costParties().map((party) => [partyKey(party.name), party])));
  /** Per name key: how often it was booked, and the defaults of the newest cost or recurring cost on it (outgoing bank lines only count). */
  private readonly partyBookings = computed(() => {
    const memory = new Map<string, PartyBooking>();
    const note = (raw: string | null | undefined, date: string, defaults: { category: string; vatPct: number | null; salesChannel: string | null } | null): void => {
      const key = partyKey(raw);
      if (!key) return;
      const name = (raw ?? '').trim().replace(/\s+/g, ' ');
      const known = memory.get(key);
      if (!known) {
        memory.set(key, { name, count: 1, lastDate: date, category: defaults?.category ?? null, vatPct: defaults?.vatPct ?? null, salesChannel: defaults?.salesChannel ?? null });
        return;
      }
      known.count += 1;
      if (defaults && date >= known.lastDate) Object.assign(known, { name, lastDate: date, category: defaults.category, vatPct: defaults.vatPct, salesChannel: defaults.salesChannel });
    };
    for (const cost of this.costs()) note(cost.party, cost.date, cost);
    for (const row of this.recurring()) note(row.party, row.startDate, row);
    for (const line of this.bankStatements()) if (line.amountEur < 0) note(line.counterparty, paymentLocalDay({ receivedAt: line.bookedAt, timeZone: line.timeZone }), null);
    return memory;
  });
  /** The suggestions of an "Aan wie" field: the stored names with their defaults, then the names only seen in bookings. */
  readonly partySuggestions = computed<PartyCandidate[]>(() => {
    const bookings = this.partyBookings();
    const stored = this.costParties().map((party) => {
      const count = bookings.get(partyKey(party.name))?.count ?? 0;
      return { name: party.name, stored: true, count, detail: this.partyDetail(party) || (count ? `${count} ${count === 1 ? 'kost' : 'kosten'}` : undefined) };
    });
    const seen = [...bookings.entries()].filter(([key]) => !this.partyByKey().has(key))
      .map(([, row]) => ({ name: row.name, stored: false, count: row.count, detail: `${row.count} ${row.count === 1 ? 'kost' : 'kosten'}` }));
    return [...stored, ...seen];
  });
  /** Per name key: this year's costs (count, total excl. btw) and the last cost date, for the Aan wie list and sheet. */
  readonly partyFigures = computed(() => {
    const year = this.today().slice(0, 4);
    const map = new Map<string, PartyFigures>();
    for (const cost of this.costs()) {
      const key = partyKey(cost.party);
      if (!key) continue;
      const row = map.get(key) ?? { count: 0, exclEur: 0, lastDate: null };
      if (cost.date.startsWith(year)) {
        row.count += 1;
        row.exclEur = round2(row.exclEur + (Number.isFinite(cost.amountExclEur) ? cost.amountExclEur : 0));
      }
      if (!row.lastDate || cost.date > row.lastDate) row.lastDate = cost.date;
      map.set(key, row);
    }
    return map;
  });

  /** "Beurs & stand · 21 % · TICA": the defaults a stored name carries, or '' when it has none. */
  partyDetail(party: CostParty): string {
    return [party.category ? categoryLabel(party.category) : '', party.vatPct !== null && party.vatPct !== undefined ? `${party.vatPct} %` : '',
      party.salesChannel ? this.channelName(party.salesChannel) : ''].filter(Boolean).join(' · ');
  }

  /** The stored name behind what was typed, when there is one. */
  costPartyFor(name: string | null | undefined): CostParty | null {
    return this.partyByKey().get(partyKey(name)) ?? null;
  }

  /** What a cost to this name takes over: the stored defaults, else the newest booking's; null for an unknown name. */
  partyDefaultsFor(name: string | null | undefined): PartyPrefill | null {
    const key = partyKey(name);
    if (!key) return null;
    const stored = this.partyByKey().get(key);
    if (stored) return { name: stored.name, category: stored.category, vatPct: stored.vatPct, salesChannel: stored.salesChannel, stored: true };
    const seen = this.partyBookings().get(key);
    return seen ? { name: seen.name, category: seen.category, vatPct: seen.vatPct, salesChannel: seen.salesChannel, stored: false } : null;
  }

  partyFiguresFor(name: string | null | undefined): PartyFigures {
    return this.partyFigures().get(partyKey(name)) ?? { count: 0, exclEur: 0, lastDate: null };
  }

  /* ------------------------------------------------------- page chrome */

  readonly inspect = signal<InspectTarget | null>(null);
  private readonly inspectParents = signal<InspectTarget[]>([]);
  private readonly inspectOrigin = signal<string | null>(null);
  readonly inspectorBackLabel = computed(() => {
    const parent = this.inspectParents().at(-1);
    return parent ? `Terug naar ${this.inspectTitle(parent)}` : this.inspectOrigin() || this.inspectorOriginLabel();
  });
  private inspectorOriginLabel(): string {
    const location = this.location();
    if (location.view === 'bank' && location.tab === 'movements') return 'Terug naar transacties';
    const tab = FINANCE_TABS[location.view].find(item => item.id === location.tab);
    const label = location.view === 'costs' ? tab?.label : financeSection(location.view).label;
    return `Terug naar ${(label || 'overzicht').toLocaleLowerCase('nl-BE')}`;
  }
  readonly menu = signal<FinanceMenu | null>(null);
  readonly helpOpen = signal(false);
  readonly shortcutsOpen = signal(false);
  readonly packageOpen = signal(false);
  /** The quarter 'Pakket' on Analyse opens the package sheet with. */
  readonly packagePreset = signal<{ year: number; quarter: number } | null>(null);
  /** What the cost sheet should open on: the regime disclosure ('Btw-regeling wijzigen…'); the sheet reads it once. */
  readonly costSheetFocus = signal<'regime' | null>(null);

  openPackage(preset: { year: number; quarter: number } | null = null): void {
    this.packagePreset.set(preset);
    this.packageOpen.set(true);
  }
  /** The account key whose balance history is open. */
  readonly historyAccount = signal<string | null>(null);
  readonly outlookOpen = signal(false);

  constructor() {
    /* ?line=<id> opens that bank transaction (it wins over ?cost=<id>), ?cost=<id> inspects that cost; leaving the section closes the inspector. */
    let section = '';
    effect(() => {
      const location = this.location();
      untracked(() => {
        const here = `${location.view}/${location.tab}/${location.view === 'bank' ? location.account : ''}`;
        const open = this.inspect();
        if (location.line) { if (open?.kind !== 'line' || open.id !== location.line) this.inspect.set({ kind: 'line', id: location.line }); }
        else if (location.cost) this.inspect.set({ kind: 'cost', id: location.cost });
        else if (here !== section || open?.kind === 'line' || (open?.kind === 'cost' && location.view === 'costs' && location.tab === 'company')) this.clearInspector();
        if (location.view !== 'analysis') this.analysisPushed = false;
        /* "Gezocht vanuit" belongs to the search it describes: gone once Transacties is left or searches something else. */
        if (this.searchedFrom() !== null && (location.view !== 'bank' || location.tab !== 'movements' || location.q !== this.searchedQuery)) this.searchedFrom.set(null);
        section = here;
      });
    });

    /* The phone home's '+' hands over a photo to book or a movement to note; the movement form waits for the accounts. */
    const request = this.intake.take();
    if (request?.kind === 'cost') this.openCost(null, request.files);
    else if (request?.kind === 'movement') {
      const waiting = effect(() => {
        if (!this.loadedAt()) return;
        untracked(() => this.openMovement());
        waiting.destroy();
      });
    }
  }

  /**
   * Every route to the inspector. On Uitgaven › Bedrijfskosten the address
   * carries the cost (?cost=<id>), so a cost goes through it and anything
   * else first takes the cost off it; elsewhere the target is set directly.
   */
  inspectItem(target: InspectTarget): void {
    this.inspectOrigin.set(this.inspectorOriginLabel());
    this.inspectParents.set([]);
    this.selectInspector(target);
  }

  /** Related records keep a small detail trail; closing still returns to the original list. */
  inspectRelated(target: InspectTarget): void {
    const current = this.inspect();
    if (current?.kind === target.kind && current.id === target.id) return;
    if (!this.inspectOrigin()) this.inspectOrigin.set(this.inspectorOriginLabel());
    if (current) this.inspectParents.update(parents => [...parents, current]);
    this.selectInspector(target);
  }

  backInspector(): void {
    const parents = this.inspectParents();
    const parent = parents.at(-1);
    if (!parent) { this.closeInspector(); return; }
    this.inspectParents.set(parents.slice(0, -1));
    this.selectInspector(parent);
  }

  private selectInspector(target: InspectTarget): void {
    const location = this.location();
    /* A transaction has an address: Back, a shared link and a toast's 'Bekijken' return to it. */
    if (target.kind === 'line') {
      if (location.line !== target.id) this.go({ line: target.id }, 'push');
      else this.inspect.set(target);
      return;
    }
    /*
     * line= wins the inspector and cost= (only ever on Facturen & kosten)
     * comes back with the next address change (the location effect), so
     * anything else first takes them off the address; Back to a transaction
     * pushes line= again (above).
     */
    const company = location.view === 'costs' && location.tab === 'company';
    if (target.kind === 'cost' && company) {
      if (location.cost !== target.id || location.line) this.go({ cost: target.id, line: null });
      else this.inspect.set(target);
      return;
    }
    if (location.cost || location.line) this.go({ cost: null, line: null });
    this.inspect.set(target);
  }

  /** What the inspector head and the phone detail sheet call the item: its description, number or name. */
  inspectTitle(target: InspectTarget): string {
    switch (target.kind) {
      case 'cost': return this.costs().find((row) => row.id === target.id)?.description || 'Kost';
      case 'container': return this.purchaseViews().find((view) => view.order.id === target.id)?.order.number
        ?? this.payments().find((row) => row.orderId === target.id)?.orderNumber ?? 'Container';
      case 'invoice': return this.receivables().find((row) => row.id === target.id)?.number ?? 'Document';
      case 'line': return 'Transactie';
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

  /** Analyse › Btw-aangifte on a quarter; from a phone it is a pushed sub-screen like Analyse. */
  openVatReturn(year: number, quarter: number): void {
    if (this.location().view !== 'analysis') this.analysisPushed = true;
    this.go({ view: 'analysis', tab: 'vat', year: String(year), quarter: String(quarter) as FinanceLocation['quarter'] }, 'push');
  }

  /* ------------------------------------------------------- vat return */

  /** The return of a quarter from the loaded costs, sales documents and containers (the latter may still be loading). */
  vatReturnFor(year: number, quarter: number): VatReturn {
    const documented = this.documentedIds();
    const importVatDeferred = this.company()?.importVatDeferred ?? false;
    return vatReturn(year, quarter,
      this.costs().map((cost) => returnLineOf(cost, cost.id !== null && documented.has(cost.id))),
      salesDocLines(this.salesOrders(), (id) => this.customerNames().get(id ?? -1) ?? ''),
      containerLines(this.purchaseViews(), { importVatDeferred, representative: this.representativeName() }),
      { importVatDeferred, today: this.today() });
  }

  /** The running quarter's return: the Overzicht tile. */
  readonly vatReturnCurrent = computed(() => {
    const { year, quarter } = quarterOf(this.today());
    return this.vatReturnFor(year, quarter);
  });

  leaveAnalysis(): void {
    if (this.analysisPushed) this.browserLocation.back();
    else this.go({ view: 'bank' });
  }

  closeInspector(): void {
    const location = this.location();
    if (location.cost || location.line) this.go({ cost: null, line: null });
    this.clearInspector();
  }

  /** Opens a transaction (desk inspector, phone sheet) by its address; push, so Back returns. */
  openLine(id: number): void {
    this.inspectItem({ kind: 'line', id });
  }

  private clearInspector(): void {
    this.inspect.set(null);
    this.inspectParents.set([]);
    this.inspectOrigin.set(null);
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
    const regimeItems: ContextMenuItem[] = !cost.vatRegime ? [{ id: 'regime-pick', label: 'Btw-regeling kiezen…', iconName: 'pencil' }]
      : !cost.vatRegimeConfirmed ? [{ id: 'regime-ok', label: 'Btw-regeling klopt', iconName: 'tick' }, { id: 'regime-pick', label: 'Btw-regeling wijzigen…', iconName: 'pencil' }] : [];
    const items: ContextMenuItem[] = [
      ...(open?.kind === 'cost' && open.id === cost.id ? [] : [{ id: 'open', label: 'Openen', iconName: 'eye' }]),
      { id: 'edit', label: 'Bewerken', iconName: 'pencil' },
      openOf(cost) !== 0 ? { id: 'pay', label: 'Betaald zetten…', iconName: 'tick' } : { id: 'unpaid', label: 'Weer open zetten', iconName: 'restore' },
      ...regimeItems,
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
      else if (id === 'regime-ok') void this.confirmRegime([cost]);
      else if (id === 'regime-pick') this.openCost(cost, [], { regime: true });
      else if (id === 'duplicate') this.duplicateCost(cost);
      else if (id === 'document') void this.pickFiles().then((files) => this.attach(cost.id!, files));
      else if (id === 'amount') void this.copyAmount(cashTotalOf(cost));
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
  /** The existing bank row that opened a new manual cost; never create a second bank movement for it. */
  readonly costBankTransaction = signal<BankStatementLine | null>(null);
  /** A lost response must resend the exact original operation, including after closing and reopening its form. */
  readonly costBankCreatePending = signal<{ requestId: string; line: BankStatementLine; cost: CompanyCost; files: readonly File[] } | null>(null);
  readonly costBankCreateConflict = signal('');
  /** Files picked before the cost exists (the '+' photo, a drop); they go up after the first save. */
  readonly costFiles = signal<File[]>([]);
  private duplicating = false;

  /** The cost form; `regime: true` opens it on the Btw-regeling disclosure. */
  openCost(cost: CompanyCost | null, files: readonly File[] = [], options: { regime?: boolean } = {}): void {
    this.duplicating = false;
    this.costBankTransaction.set(null);
    this.costFiles.set([...files]);
    this.costSheetFocus.set(options.regime ? 'regime' : null);
    this.costDraft.set(cost ? { ...cost } : blankCost(this.today()));
  }

  /**
   * Starts from known cash facts only; the document must supply its VAT
   * treatment and invoice date. `prefill` starts from more: Bankkosten and
   * Rente (Boeken als), or the latest cost of a cost pattern.
   */
  openCostFromBank(line: BankStatementLine, prefill: Partial<CompanyCost> = {}): void {
    if (this.saving()) return;
    const current = this.bankStatements().find(row => row.id === line.id) ?? line;
    const registration = this.costBankCreatePending();
    if (registration) {
      if (registration.line.id !== line.id) {
        this.ui.toast('Bevestig eerst de vorige kostregistratie. Open daarvoor dezelfde banktransactie.', 'err'); return;
      }
      this.openCost({ ...registration.cost, paidOn: bankTransactionDay(registration.line) }, registration.files);
      this.costBankTransaction.set(registration.line);
      return;
    }
    const pending = this.bankCostLinkPending();
    if (pending) {
      const cost = this.costs().find(row => row.id === pending.costId);
      if (cost) this.paySheet.set({ costs: [cost] });
      this.ui.toast('Rond eerst de bewaarde kost en haar bankkoppeling af. Er wordt geen tweede kost aangemaakt.', 'err');
      return;
    }
    if (!Number.isFinite(current.amountEur) || current.amountEur >= 0 || current.allocated || current.salesPaymentId != null || this.archivedBankLine(current)) {
      this.ui.toast('Kies een vrije uitgaande transactie van een actieve bankrekening.', 'err');
      return;
    }
    const day = bankTransactionDay(current), gross = -current.amountEur;
    const party = (current.counterparty ?? '').trim();
    this.openCost({ ...blankCost(day), date: day, paidOn: day, description: party.slice(0, 300), party: party.slice(0, 200) || null,
      reference: (current.reference ?? '').slice(0, 100) || null, amountExclEur: gross, amountInclEur: gross,
      vatPct: null, vatRegime: null, vatRegimeConfirmed: false, supplierCountry: null,
      costKind: null, expenseType: null, vatDeductiblePct: null, taxDeductiblePct: null, ...prefill }, [], { regime: !prefill.vatRegime });
    this.costBankTransaction.set(current);
  }

  /** A copy dated today, open, not tied to a recurring definition; its documents and payments stay with the original. */
  duplicateCost(cost: CompanyCost): void {
    const { payments: _payments, paidEur: _paid, openEur: _open, cashTotalEur: _cash, bankStatementLineId: _line, ...rest } = cost;
    this.openCost({ ...rest, id: null, date: this.today(), paidOn: null, recurringCostId: null, createdAt: null });
    this.duplicating = true;
  }

  /**
   * Books or corrects a cost. With `bankAccountKey` ("Ook als bankbeweging
   * noteren" in the form) a cost that becomes paid in this save goes onto
   * that account straight away, in one toast whose undo reverts the paid
   * date and the line together; otherwise the toast offers the movement
   * form. The form closes once the line is in, so a failed line is seen.
   */
  async saveCost(draft: CompanyCost, options: { bankAccountKey?: string | null; bankTransaction?: BankStatementLine | null } = {}): Promise<CompanyCost | null> {
    if (this.saving()) return null;
    if (!draft.id && options.bankTransaction) return this.createCostFromBank(draft, options.bankTransaction);
    const pending = this.bankCostLinkPending();
    if (options.bankTransaction && pending) {
      const cost = this.costs().find(row => row.id === pending.costId);
      if (cost) this.paySheet.set({ costs: [cost] });
      this.ui.toast('De kost is al bewaard. Probeer de openstaande bankkoppeling opnieuw; maak geen nieuwe kost.', 'err');
      return null;
    }
    if (options.bankTransaction && !bankAmountsMatch(-options.bankTransaction.amountEur, cashTotalOf(draft))) {
      this.ui.toast('Het totaal inclusief btw mag maximaal € 0,02 afwijken van de gekozen banktransactie. Gebruik Betaling noteren voor een deelbetaling.', 'err'); return null;
    }
    this.saving.set(true);
    const before = draft.id ? this.costs().find((row) => row.id === draft.id) : null;
    try {
      const body: CompanyCost = { ...draft, ...(options.bankTransaction ? { paidOn: null } : {}), party: draft.party || null, reference: draft.reference || null, notes: draft.notes || null,
        amountInclEur: Number.isFinite(draft.amountInclEur as number) && (draft.amountInclEur as number) !== 0 ? draft.amountInclEur : null };
      let saved = draft.id ? await this.finance.updateCost(draft.id, body) : await this.finance.createCost(body);
      /* "Vervalt op" is the server's own on a PUT (2026-10-16): a changed due date goes through its endpoint after the save. */
      if (draft.id && this.cashRound() && (draft.dueDate ?? null) !== (before?.dueDate ?? null)) saved = await this.finance.setCostDueDate(draft.id, draft.dueDate ?? null);
      this.costs.update((rows) => (draft.id ? rows.map((row) => (row.id === saved.id ? saved : row)) : [saved, ...rows]));
      const text = this.duplicating && !draft.id ? 'Kost gedupliceerd' : draft.id ? 'Kost bewaard' : 'Kost geboekt';
      /* A cost that just became paid can go onto the bank in one more tap, or right away when the form said so. */
      const newlyPaid = !!saved.paidOn && !before?.paidOn && !!saved.id;
      this.duplicating = false;
      const accountKey = options.bankAccountKey ?? '';
      const toBank = newlyPaid && !!accountKey && this.manualAccountAllowed(accountKey) && this.manualAccountOptions().some((option) => option.key === bankAccountKey(accountKey));
      if (options.bankTransaction && saved.id) {
        this.bankCostLinkPending.set({ costId: saved.id, line: options.bankTransaction });
        this.bankCostLinkError.set('');
        try {
          const line = await this.banking.addCostPayment(options.bankTransaction.id, saved.id);
          this.bankStatements.update(rows => [line, ...rows.filter(row => row.id !== line.id)]);
          this.bankCostLinkPending.set(null);
          void this.refreshBank(); void this.refreshCosts();
          this.ui.toast('Kost bewaard en banktransactie gekoppeld', 'ok');
        } catch (failure) {
          this.bankCostLinkError.set(`Kost bewaard. De bankbetaling kon nog niet worden bevestigd: ${messageOf(failure, 'Probeer opnieuw.')} Opnieuw proberen maakt geen extra betaling.`);
          this.paySheet.set({ costs: [saved] });
        }
      } else if (!toBank) {
        this.ui.toast(text, 'ok', newlyPaid ? { label: 'Op de bank noteren', run: () => this.openMovement(this.costMovement(saved)) } : undefined);
      } else {
        const account = this.canonicalAccount(accountKey);
        /* The server wrote one full payment for the switch; the line links to it. */
        const payment = newPaymentOf(before, saved);
        try {
          const line = await this.banking.create(this.payLine(saved, saved.paidOn!, account, payment?.id ?? null, payment?.amountEur ?? cashTotalOf(saved)));
          this.bankStatements.update((rows) => [line, ...rows.filter((row) => row.id !== line.id)]);
          void this.refreshBank();
          this.ui.toast(`Kost geboekt · ook op ${account} genoteerd`, 'ok',
            { label: 'Ongedaan maken', run: () => void this.undoPaid([{ cost: saved, paidOn: saved.paidOn!, paymentId: payment?.id ?? null, line }]) });
        } catch {
          this.ui.toast('Kost geboekt, maar de bankbeweging is niet bewaard.', 'err',
            { label: 'Op de bank noteren', run: () => this.openMovement(this.costMovement(saved, payment)) });
        }
      }
      this.costDraft.set(null);
      this.costBankTransaction.set(null);
      /* The server learned the name; the Aan wie list follows. */
      if (saved.party) void this.reload(['parties']);
      return saved;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Bewaren mislukt'), 'err');
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  private async createCostFromBank(draft: CompanyCost, line: BankStatementLine): Promise<CompanyCost | null> {
    if (line.amountEur >= 0 || !bankAmountsMatch(-line.amountEur, cashTotalOf(draft))) {
      this.ui.toast('Kies een uitgaande banktransactie die maximaal € 0,02 van het factuurtotaal verschilt.', 'err'); return null;
    }
    const cost: CompanyCost = { ...draft, id: null, paidOn: null, party: draft.party || null,
      reference: draft.reference || null, notes: draft.notes || null,
      amountInclEur: Number.isFinite(draft.amountInclEur as number) && draft.amountInclEur !== 0 ? draft.amountInclEur : null };
    const pending = this.costBankCreatePending();
    if (pending && (pending.line.id !== line.id || JSON.stringify(pending.cost) !== JSON.stringify(cost))) {
      this.ui.toast('De vorige registratie is nog niet bevestigd. Open dezelfde banktransactie opnieuw en bevestig de oorspronkelijke gegevens.', 'err'); return null;
    }
    const operation = pending ?? { requestId: crypto.randomUUID(), line, cost, files: [...this.costFiles()] };
    this.costBankCreatePending.set(operation);
    this.costBankCreateConflict.set('');
    this.saving.set(true);
    try {
      const result = await this.finance.createCostFromBank(line.id, { requestId: operation.requestId, cost: operation.cost });
      this.costs.update(rows => [result.cost, ...rows.filter(row => row.id !== result.cost.id)]);
      this.bankStatements.update(rows => [result.line, ...rows.filter(row => row.id !== result.line.id)]);
      this.costBankCreatePending.set(null); this.costBankTransaction.set(null); this.costDraft.set(null);
      this.duplicating = false;
      this.ui.toast('Kost bewaard en banktransactie gekoppeld', 'ok');
      void this.refreshBank(); void this.refreshCosts();
      if (result.cost.party) void this.reload(['parties']);
      return result.cost;
    } catch (failure: unknown) {
      const status = failure && typeof failure === 'object' && 'status' in failure ? Number(failure.status) : 0;
      // A validation rejection precedes every write; uncertain outcomes keep their immutable retry identity.
      if (status === 400 || status === 422) this.costBankCreatePending.set(null);
      if (status === 409) this.costBankCreateConflict.set(messageOf(failure, 'Deze banktransactie heeft intussen een andere registratie. Vernieuw de banktransactie om de bestaande koppeling te bekijken.'));
      this.ui.toast(messageOf(failure, 'De registratie kon niet worden bevestigd. Probeer opnieuw; dezelfde kostregistratie wordt hergebruikt.'), 'err');
      return null;
    } finally { this.saving.set(false); }
  }

  /** A definite conflict may abandon its local draft after a fresh bank read; financial records are never undone. */
  async reviewCostBankConflict(): Promise<void> {
    const operation = this.costBankCreatePending();
    if (!operation || !this.costBankCreateConflict() || this.saving()) return;
    this.saving.set(true);
    try {
      await this.reload(['statements', 'costs', 'incoming', 'orders', 'payments']);
      const errors = this.sourceErrors(['statements', 'costs']);
      if (errors.length) { this.ui.toast(errors.join(' · '), 'err'); return; }
      const line = this.bankStatements().find(row => row.id === operation.line.id);
      const cost = this.costs().find(row => row.bankStatementLineId === operation.line.id || row.payments?.some(payment => payment.bankStatementLineId === operation.line.id));
      this.costBankCreatePending.set(null); this.costBankCreateConflict.set('');
      this.costBankTransaction.set(null); this.costDraft.set(null);
      this.go({ view: 'bank', tab: 'movements', account: line?.account ?? operation.line.account, q: '', link: '', dir: '', period: 'all', from: '', to: '' });
      this.ui.toast((line?.allocated || line?.salesPaymentId ? 'De bestaande bankkoppeling is opnieuw geladen.' : 'De banktransactie is opnieuw geladen. Controleer de eerdere registratie.')
        + (operation.files.length ? ' De gekozen bestanden zijn nog niet geüpload.' : ''), 'ok',
        cost?.id ? { label: 'Kost bekijken', run: () => this.inspectItem({ kind: 'cost', id: cost.id! }) } : undefined);
    } finally { this.saving.set(false); }
  }

  /** The bank movement that goes with a payment on a cost (its amount and day), or with what is still open on it; the marker finds it back. */
  costMovement(cost: CompanyCost, payment: CostPayment | null = null): MovementPrefill {
    const marker = payment?.id ? bankMarker('kostbetaling', payment.id) : cost.id ? bankMarker('kost', cost.id) : null;
    const amount = payment ? payment.amountEur : openOf(cost) || cashTotalOf(cost);
    return { direction: amount < 0 ? 'INCOMING' : 'OUTGOING', amount: Math.abs(amount), day: payment?.paidOn ?? cost.paidOn ?? this.today(),
      counterparty: (cost.party ?? '').slice(0, 300),
      reference: marker ? this.markedReference(cost.reference || cost.description, marker) : cost.reference || cost.description };
  }

  /** The payment a bank line covers, by the line's marker or hard link; the bank panel opens its cost. */
  costOfPayment(paymentId: number): CompanyCost | null {
    return this.costs().find((cost) => (cost.payments ?? []).some((payment) => payment.id === paymentId)) ?? null;
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
      this.ui.toast(`${messageOf(failure, 'Opladen mislukt')}. De kost blijft bewaard; voeg de ontbrekende bestanden opnieuw toe.`, 'err',
        { label: 'Kost bekijken', run: () => this.inspectItem({ kind: 'cost', id: costId }) });
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

  readonly paySheet = signal<{ costs: CompanyCost[]; existingPayment?: CostPayment } | null>(null);

  openPay(costs: readonly CompanyCost[]): void {
    const open = costs.filter((cost) => !!cost.id && openOf(cost) !== 0);
    if (!open.length) {
      this.ui.toast(costs.length === 1 ? 'Deze kost is al betaald' : 'Deze kosten zijn al betaald');
      return;
    }
    this.bankCostLinkError.set('');
    this.paySheet.set({ costs: open });
  }

  openBankCostPayment(cost: CompanyCost, payment: CostPayment): void {
    this.bankCostLinkError.set('');
    this.paySheet.set({ costs: [cost], existingPayment: payment });
  }

  deferBankCostLink(): void {
    this.bankCostLinkPending.set(null); this.bankCostLinkError.set(''); this.paySheet.set(null);
    this.ui.toast('Je kunt de banktransactie later koppelen. Controleer de betalingen op deze kost voordat je handmatig een betaling toevoegt.');
  }

  /** The remembered "Ook als bankbeweging noteren" choice of this device, shared with the container payment sheet. */
  payToBank(): PayToBankPreference {
    return readPayToBank(globalThis.localStorage);
  }

  rememberPayToBank(preference: PayToBankPreference): void {
    writePayToBank(globalThis.localStorage, preference);
  }

  /** A phone swipe opens the same payment sheet, including existing bank transactions. */
  swipePay(cost: CompanyCost): void {
    if (!this.busy() && !this.saving()) this.openPay([cost]);
  }

  /**
   * Pays what is still open on each cost on a day, one by one under the busy
   * lock (the server writes one payment per cost), and notes an outgoing bank
   * line per payment when an account is given (linked to the payment, with a
   * "kostbetaling #id" marker so it can be found back). The toast offers to
   * undo both.
   */
  async markPaid(costs: readonly CompanyCost[], options: PayOptions): Promise<boolean> {
    if (options.bankAccount && !this.manualAccountAllowed(options.bankAccount)) { this.ui.toast('Kies voor deze rekening een opgehaalde banktransactie.', 'err'); return false; }
    const targets = costs.filter((cost) => !!cost.id && openOf(cost) !== 0);
    if (!targets.length || this.busy()) return false;
    const account = options.bankAccount ? this.canonicalAccount(options.bankAccount) : null;
    const done: PaidEntry[] = [];
    let firstError = '';
    let bankFailed = false;
    this.busy.set(true);
    this.progress.set({ done: 0, total: targets.length });
    try {
      for (const cost of targets) {
        try {
          const remainder = openOf(cost);
          const saved = await this.finance.markCostPaid(cost.id!, options.paidOn);
          this.replaceCost(saved);
          const payment = newPaymentOf(cost, saved);
          let line: BankStatementLine | null = null;
          if (account) {
            try {
              line = await this.banking.create(this.payLine(saved, options.paidOn, account, payment?.id ?? null, payment?.amountEur ?? remainder));
              const created = line;
              this.bankStatements.update((rows) => [created, ...rows.filter((row) => row.id !== created.id)]);
            } catch (failure: unknown) {
              bankFailed = true;
              firstError ||= messageOf(failure, 'Bankbeweging bewaren mislukt');
            }
          }
          done.push({ cost: saved, paidOn: options.paidOn, paymentId: payment?.id ?? null, line });
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

  /**
   * Whether a bank line on a day lands after the account's last check (and
   * so moves its balance): the hint under the account chips of the pay
   * sheet and the cost form. '' for an unknown account or day.
   */
  accountHint(accountKey: string, day: string): string {
    const account = this.accountsView().find((row) => row.account === accountKey);
    if (!account) return '';
    if (!account.reading) return `${account.label} heeft nog geen saldo; de beweging telt mee zodra je er een invult.`;
    let at: number;
    try { at = day === this.today() ? Date.now() : Date.parse(receiptInstant(day, '12:00:00', BANK_ZONE)); } catch { return ''; }
    if (!Number.isFinite(at)) return '';
    return at <= bankCheckpoint(account.reading)
      ? `Valt vóór je laatste saldocontrole van ${account.label} (${dayMonthYear(account.reading.date)}); zit al in dat saldo.`
      : `Telt mee in het saldo van ${account.label}.`;
  }

  /** The outgoing line of one payment on a cost: its amount, linked to the payment (an older server without payments gets the cost marker). */
  private payLine(cost: CompanyCost, paidOn: string, account: string, paymentId: number | null, amountEur: number): BankMovementRequest {
    const now = receiptLocalParts(Date.now(), BANK_ZONE);
    return {
      account, amountEur: Math.abs(round2(amountEur)), direction: amountEur < 0 ? 'INCOMING' : 'OUTGOING',
      bookedAt: receiptInstant(paidOn, paidOn === now.day ? now.time : '12:00:00', BANK_ZONE), timeZone: BANK_ZONE,
      reference: this.markedReference(cost.reference || cost.description, paymentId ? bankMarker('kostbetaling', paymentId) : bankMarker('kost', cost.id!)),
      counterparty: (cost.party ?? '').trim().slice(0, 300) || null, requestId: crypto.randomUUID(),
      costPaymentId: paymentId,
    };
  }

  /**
   * Notes one payment on a cost (less, the whole remainder or more than it)
   * and, with an account, the bank line linked to it. The cost comes back
   * with its payments and what is still open.
   */
  async addPayment(cost: CompanyCost, options: { paidOn: string; amountEur: number; bankAccountKey: string | null; note?: string | null }): Promise<boolean> {
    if (!cost.id || this.saving()) return false;
    if (options.bankAccountKey && !this.manualAccountAllowed(options.bankAccountKey)) { this.ui.toast('Kies voor deze rekening een opgehaalde banktransactie.', 'err'); return false; }
    const account = options.bankAccountKey ? this.canonicalAccount(options.bankAccountKey) : null;
    this.saving.set(true);
    try {
      const saved = await this.finance.addCostPayment(cost.id, { paidOn: options.paidOn, amountEur: round2(options.amountEur), account, note: options.note ?? null });
      this.replaceCost(saved);
      const payment = newPaymentOf(cost, saved);
      let banked = '';
      if (account) {
        try {
          const line = await this.banking.create(this.payLine(saved, options.paidOn, account, payment?.id ?? null, payment?.amountEur ?? options.amountEur));
          this.bankStatements.update((rows) => [line, ...rows.filter((row) => row.id !== line.id)]);
          void this.refreshBank();
          banked = ` · ook op ${account} genoteerd`;
        } catch {
          this.ui.toast('Betaling genoteerd, maar de bankbeweging is niet bewaard.', 'err',
            { label: 'Op de bank noteren', run: () => this.openMovement(this.costMovement(saved, payment)) });
          return true;
        }
      }
      const open = openOf(saved);
      this.ui.toast(open !== 0 ? `Betaling van ${formatEuro(payment?.amountEur ?? options.amountEur)} genoteerd · nog ${formatEuro(open)} open${banked}`
        : `${saved.description} volledig betaald${banked}`, 'ok');
      void this.refreshCosts();
      return true;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Betaling noteren mislukt'), 'err');
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /** Keep the saved payment id until its selected bank line is linked; retries never create another payment. */
  readonly bankCostLinkPending = signal<{ costId: number; paymentId?: number; line: BankStatementLine } | null>(null);
  readonly bankCostLinkError = signal('');

  async addPaymentFromBank(cost: CompanyCost, line: BankStatementLine, existingPayment: CostPayment | null = null): Promise<boolean> {
    if (!cost.id || this.saving() || Math.sign(cashTotalOf(cost)) !== -Math.sign(line.amountEur)) return false;
    if (existingPayment && !bankAmountsMatch(existingPayment.amountEur, -line.amountEur)) {
      this.bankCostLinkError.set('Het bedrag van de transactie mag maximaal € 0,02 afwijken van de bestaande betaling.'); return false;
    }
    const pending = this.bankCostLinkPending();
    if (pending && (pending.costId !== cost.id || pending.line.id !== line.id)) {
      this.bankCostLinkError.set('Rond eerst de openstaande bankkoppeling af of kies Koppeling later.'); return false;
    }
    this.saving.set(true); this.bankCostLinkError.set('');
    try {
      const paymentId = pending?.paymentId ?? existingPayment?.id;
      this.bankCostLinkPending.set({ costId: cost.id, ...(paymentId ? { paymentId } : {}), line });
      const linked = paymentId
        ? await this.banking.linkPayments(line.id, { costPaymentId: paymentId })
        : await this.banking.addCostPayment(line.id, cost.id);
      this.bankStatements.update(rows => [linked, ...rows.filter(row => row.id !== linked.id)]);
      this.bankCostLinkPending.set(null);
      void this.refreshCosts(); void this.refreshBank();
      this.ui.toast('Betaling bewaard en banktransactie gekoppeld', 'ok');
      return true;
    } catch (failure) {
      this.bankCostLinkError.set(this.bankCostLinkPending()
        ? `De bankbetaling kon nog niet worden bevestigd: ${messageOf(failure, 'Probeer opnieuw.')} Opnieuw proberen maakt geen extra betaling.`
        : messageOf(failure, 'Betaling bewaren mislukt.'));
      return false;
    } finally { this.saving.set(false); }
  }

  /** Takes one payment off a cost; a bank line it was on stays (the bank's truth), only the link goes. */
  async deletePayment(cost: CompanyCost, payment: CostPayment): Promise<boolean> {
    if (!cost.id || !payment.id || this.saving()) return false;
    this.saving.set(true);
    try {
      this.replaceCost(await this.finance.deleteCostPayment(cost.id, payment.id));
      this.ui.toast('Betaling verwijderd');
      if (payment.bankStatementLineId) void this.refreshBank();
      return true;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /** Reverts only what nobody touched since: the payment this action wrote (when still there and on no other line), and lines not linked since. */
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
        const payment = entry.paymentId ? (current?.payments ?? []).find((row) => row.id === entry.paymentId) : undefined;
        if (payment && (!payment.bankStatementLineId || payment.bankStatementLineId === entry.line?.id)) {
          try {
            this.replaceCost(await this.finance.deleteCostPayment(current!.id!, payment.id!));
          } catch (failure: unknown) { failed ||= messageOf(failure, 'Terugzetten mislukt'); }
        } else if (!entry.paymentId && current && current.paidOn === entry.paidOn && !current.payments?.length) {
          /* An older server without payments: the paid date is the switch. */
          try {
            this.replaceCost(await this.finance.updateCost(current.id!, { ...current, paidOn: null }));
          } catch (failure: unknown) { failed ||= messageOf(failure, 'Terugzetten mislukt'); }
        } else skipped = true;
        if (entry.line) {
          const line = this.bankStatements().find((row) => row.id === entry.line!.id);
          if (line && line.salesPaymentId === null && line.source !== 'ODOO') {
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

  /** 'Weer open zetten': every payment goes (the bank lines stay), after a confirm; a legacy paid cost without rows just loses its date. */
  async markUnpaid(cost: CompanyCost): Promise<void> {
    const payments = (cost.payments ?? []).filter((payment) => !!payment.id);
    if (!cost.id || (!payments.length && !cost.paidOn) || this.busy() || this.saving()) return;
    if (!payments.length) {
      this.saving.set(true);
      try {
        this.replaceCost(await this.finance.updateCost(cost.id, { ...cost, paidOn: null }));
        this.ui.toast('Weer open gezet');
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Terugzetten mislukt'), 'err');
      } finally {
        this.saving.set(false);
      }
      return;
    }
    const n = payments.length;
    const k = payments.filter((payment) => !!payment.bankStatementLineId).length;
    const total = round2(payments.reduce((sum, payment) => sum + payment.amountEur, 0));
    const lines = k === 0 ? '' : `; ${k === 1 ? 'de bankbeweging blijft' : `de ${k} bankbewegingen blijven`} staan`;
    this.ui.confirm({
      title: 'Weer open zetten',
      message: `${n === 1 ? 'De betaling' : `De ${n} betalingen`} (${escapeHtml(formatEuro(total))}) ${n === 1 ? 'wordt' : 'worden'} verwijderd${escapeHtml(lines)}.`,
      confirmLabel: 'Weer open zetten', danger: true,
    }, async () => {
      if (this.saving()) return;
      this.saving.set(true);
      try {
        for (const payment of payments) this.replaceCost(await this.finance.deleteCostPayment(cost.id!, payment.id!));
        this.ui.toast('Weer open gezet');
        if (k > 0) void this.refreshBank();
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Terugzetten mislukt'), 'err');
        void this.refreshCosts();
      } finally {
        this.saving.set(false);
      }
    });
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

  /** 'Klopt': the derived regime of these costs stands; costs without a regime need the form instead. */
  confirmRegime(costs: readonly CompanyCost[]): Promise<void> {
    return this.runBulk(costs.filter((cost) => !!cost.id && !!cost.vatRegime && !cost.vatRegimeConfirmed), async (cost) => {
      this.replaceCost(await this.finance.updateCost(cost.id!, { ...cost, vatRegimeConfirmed: true }));
    }, (count) => `${count} ${count === 1 ? 'btw-regeling' : 'btw-regelingen'} bevestigd`);
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
    saveBlob(new Blob(['﻿' + costLedgerCsv(rows, this.categoryName, undefined, this.channelName, returnVatOf, costRegimeCells)], { type: 'text/csv;charset=utf-8' }), filename);
  }

  /** 'Exporteer CSV' where a section has no list of its own: every cost and container payment of this year. */
  exportThisYear(): void {
    const year = this.today().slice(0, 4);
    this.exportCsv(this.ledger().filter((row) => row.date >= `${year}-01-01` && row.date <= `${year}-12-31`), `kosten-${year}.csv`);
  }

  /** CSV of a quarter with the file names, the VAT return of that quarter as CSV, plus a zip of the documents linked to its company costs. */
  async accountantPackage(year: number, quarter: number): Promise<void> {
    if (this.containersLoading()) {
      this.ui.toast('Containers laden…');
      return;
    }
    const first = (quarter - 1) * 3 + 1;
    const from = `${year}-${String(first).padStart(2, '0')}-01`;
    const to = new Date(Date.UTC(year, first + 2, 0)).toISOString().slice(0, 10);
    const rows = this.ledger().filter((row) => row.date >= from && row.date <= to);
    const names = (row: CostLedgerRow): string => this.attachmentsFor(row.cost?.id).map((asset) => asset.originalFilename || asset.name).join(', ');
    saveBlob(new Blob(['﻿' + costLedgerCsv(rows, this.categoryName, names, this.channelName, returnVatOf, costRegimeCells)], { type: 'text/csv;charset=utf-8' }), `kosten-${year}-Q${quarter}.csv`);
    saveBlob(new Blob(['﻿' + vatReturnCsv(this.vatReturnFor(year, quarter))], { type: 'text/csv;charset=utf-8' }), `btw-aangifte-${year}-Q${quarter}.csv`);
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
      if (saved.party) void this.reload(['parties']);
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

  /* ----------------------------------------------------------- aan wie */

  readonly costPartyDraft = signal<CostParty | null>(null);

  /** The party sheet: a stored name to edit, or a new one (with a name typed elsewhere, when given). */
  openCostParty(party: CostParty | null, name = ''): void {
    this.costPartyDraft.set(party ? { ...party } : blankCostParty(name));
  }

  /** Creates or updates a name in the list; a new name renames the bookings on the old one (the server cascades). */
  async saveCostParty(draft: CostParty | null = this.costPartyDraft()): Promise<CostParty | null> {
    if (!draft || this.saving()) return null;
    const name = draft.name.trim().replace(/\s+/g, ' ');
    if (!name) {
      this.ui.toast('Geef een naam', 'err');
      return null;
    }
    const before = draft.id ? this.costParties().find((row) => row.id === draft.id) : null;
    this.saving.set(true);
    try {
      const body: CostParty = { ...draft, name, category: (draft.category ?? '').trim().toUpperCase() || null,
        salesChannel: (draft.salesChannel ?? '').trim().toUpperCase() || null, iban: (draft.iban ?? '').replace(/\s+/g, '').toUpperCase() || null };
      const saved = draft.id ? await this.finance.updateCostParty(draft.id, body) : await this.finance.createCostParty(body);
      this.costParties.update((rows) => (draft.id ? rows.map((row) => (row.id === saved.id ? saved : row)) : [...rows, saved]).sort(byName));
      const renamed = !!before && before.name !== saved.name;
      /* The rename ran through the costs, recurring costs and bank lines on the server: show them renamed before saying so. */
      if (renamed) await this.reload(['costs', 'recurring', 'statements', 'parties']);
      this.ui.toast(!draft.id ? `${saved.name} staat in de lijst Aan wie` : renamed ? `Hernoemd naar ${saved.name}; de boekingen zijn mee aangepast` : 'Aan wie bewaard', 'ok');
      this.costPartyDraft.set(null);
      return saved;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Bewaren mislukt'), 'err');
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  deleteCostParty(party: CostParty): void {
    if (!party.id) return;
    this.ui.confirm({
      title: 'Uit de lijst Aan wie halen',
      message: `${escapeHtml(party.name)} verdwijnt uit de lijst. Boekingen op deze naam blijven staan; de naam komt terug in de lijst zodra je er opnieuw op boekt.`,
      confirmLabel: 'Verwijderen', danger: true,
    }, async () => {
      try {
        await this.finance.deleteCostParty(party.id!);
        this.costParties.update((rows) => rows.filter((row) => row.id !== party.id));
        this.costPartyDraft.set(null);
        this.ui.toast('Uit de lijst gehaald');
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
      }
    });
  }

  /* ----------------------------------------------------------- beurzen */

  readonly fairDraft = signal<Fair | null>(null);

  openFair(fair: Fair | null): void {
    this.fairDraft.set(fair ? { ...fair } : blankFair());
  }

  /** Creates (the server derives the code from the label) or renames and switches a fair. */
  async saveFair(draft: Fair | null = this.fairDraft()): Promise<Fair | null> {
    if (!draft || this.saving()) return null;
    const label = draft.label.trim().replace(/\s+/g, ' ');
    if (!label) {
      this.ui.toast('Geef de beurs een naam', 'err');
      return null;
    }
    this.saving.set(true);
    try {
      const saved = draft.id ? await this.finance.updateFair(draft.id, { label, active: draft.active }) : await this.finance.createFair({ label });
      this.putFair(saved);
      this.ui.toast(draft.id ? 'Beurs bewaard' : `Beurs ${saved.label} toegevoegd`, 'ok');
      this.fairDraft.set(null);
      return saved;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Bewaren mislukt'), 'err');
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  /** 'Andere…' in the cost form: a fair by name, straight into the list; null when the server refused (the toast says why). */
  createFair(label: string): Promise<Fair | null> {
    return this.saveFair({ ...blankFair(), label });
  }

  async setFairActive(fair: Fair, active: boolean): Promise<void> {
    if (!fair.id || fair.active === active || this.saving()) return;
    this.saving.set(true);
    try {
      this.putFair(await this.finance.updateFair(fair.id, { label: fair.label, active }));
      this.ui.toast(active ? `${fair.label} staat weer aan` : `${fair.label} staat uit`);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, active ? 'Aanzetten mislukt' : 'Uitzetten mislukt'), 'err');
    } finally {
      this.saving.set(false);
    }
  }

  /** The server refuses while a cost or recurring cost still carries the code; its message says to switch the fair off instead. */
  deleteFair(fair: Fair): void {
    if (!fair.id) return;
    this.ui.confirm({
      title: 'Beurs verwijderen',
      message: `${escapeHtml(fair.label)} verdwijnt uit de lijst. Een beurs met kosten erop kun je niet verwijderen; zet ze dan uit.`,
      confirmLabel: 'Verwijderen', danger: true,
    }, async () => {
      try {
        await this.finance.deleteFair(fair.id!);
        this.fairs.update((rows) => rows.filter((row) => row.id !== fair.id));
        this.fairDraft.set(null);
        this.ui.toast('Beurs verwijderd');
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
      }
    });
  }

  private putFair(saved: Fair): void {
    this.fairs.update((rows) => (rows.some((row) => row.id === saved.id) ? rows.map((row) => (row.id === saved.id ? saved : row)) : [...rows, saved]).sort(byLabel));
  }

  /* ---------------------------------------------------- bank readings */

  readonly bankDraft = signal<BankBalance | null>(null);
  readonly accountCheck = signal<{ key: string } | null>(null);

  /** A new reading for an account (its label prefilled), or an empty one for a new account. */
  openBank(balance: BankBalance | null, key = ''): void {
    const account = this.bankLedger().accounts.find(row => row.account === this.canonicalAccount(key));
    this.bankDraft.set(balance ? { ...balance } : blankBalance(account?.source === 'ODOO' ? addDays(this.today(), -1) : this.today(), key ? this.canonicalAccount(key) : ''));
  }

  /** 'Klopt het saldo?' for an account with a reading; the first reading otherwise. */
  checkOrFill(key: string): void {
    const account = this.accountsView().find((row) => row.account === key);
    if (account?.source === 'ODOO') this.openBank(null, key);
    else if (account?.reading) this.accountCheck.set({ key });
    else this.openBank(null, key);
  }

  async saveBank(draft: BankBalance): Promise<boolean> {
    if (this.saving()) return false;
    this.saving.set(true);
    try {
      const body: BankBalance = { ...draft, account: this.canonicalAccount(draft.account), notes: draft.notes || null };
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
        id: null, account: account.account, date: receiptLocalParts(asOfAt, BANK_ZONE).day, asOfAt, timeZone: BANK_ZONE,
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
    const options = this.manualAccountOptions();
    const remembered = this.payToBank().accountKey;
    const given = prefill.accountKey && prefill.accountKey !== NO_ACCOUNT ? prefill.accountKey : '';
    const key = given || (options.some((option) => option.key === remembered) ? remembered : '')
      || (options.length === 1 ? options[0].key : '');
    this.movementError.set('');
    this.movementDraft.set({
      direction: prefill.direction ?? 'INCOMING', amount: prefill.amount ?? 0, account: key ? this.canonicalAccount(key) : '',
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
      if (!this.manualAccountAllowed(draft.account)) throw new Error('Deze rekening ontvangt banktransacties via Odoo of is gearchiveerd. Koppel een bestaande banktransactie.');
      if (!Number.isFinite(draft.amount) || draft.amount <= 0) throw new Error('Vul een bedrag groter dan nul in.');
      if (Math.abs(draft.amount * 100 - Math.round(draft.amount * 100)) > 0.00001) throw new Error('Gebruik maximaal twee decimalen voor het bankbedrag.');
      const timing = receiptRequest({ amount: draft.amount, day: draft.day, time: this.movementTime(draft), timeZone: draft.timeZone, reference: draft.reference });
      body = { account: this.canonicalAccount(draft.account), amountEur: timing.amountEur, direction: draft.direction,
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
      /* An outgoing line to a name teaches the server a payee; incoming money comes from customers. */
      if (body.direction === 'OUTGOING' && body.counterparty) void this.reload(['parties']);
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
      || (location.link === 'unlinked' && (line.allocated || !!line.salesPaymentId))
      || (!!location.account && this.canonicalAccount(location.account) !== this.canonicalAccount(line.account))
      || (!!location.q.trim() && !text.includes(location.q.trim().toLocaleLowerCase('nl-BE')))
      || (!!range.from && day < range.from) || (!!range.to && day > range.to);
  }

  /* ------------------------------------------------ linking a bank transaction */

  /** The transaction being linked, booked or unlinked right now; one at a time. */
  readonly linking = signal<number | null>(null);
  /** "Betalingen zonder transactie" as a sheet over Transacties. */
  readonly unbankedOpen = signal(false);
  /** "Gezocht vanuit: {party} · {description}" over Transacties after "Transactie zoeken"; it goes with that search (the location effect). */
  readonly searchedFrom = signal<string | null>(null);
  /** The amount "Transactie zoeken" put in the search: the chip stays while Transacties still searches it ("Ruimer zoeken" keeps it). */
  private searchedQuery: string | null = null;
  /** "Boeken als…" on this line. */
  readonly bookAsLine = signal<BankStatementLine | null>(null);
  /** "{k} exacte suggesties koppelen". */
  readonly exactLinksOpen = signal(false);
  /** ⋯ › "Gearchiveerde rekeningen". */
  readonly archivedOpen = signal(false);
  /** The Kaslijn's "Buffer voor 'krap'" sheet. */
  readonly bufferOpen = signal(false);

  /** A new container term takes the bank's day and euro, one EUR payment on its term (today's sheet logic). */
  termPart(line: BankStatementLine, target: Extract<LinkTarget, { kind: 'term-new' }>): BankPurchasePaymentPart {
    return { paidOn: this.lineDay(line), amount: Math.abs(round2(line.amountEur)), currency: 'EUR', amountEur: null,
      label: target.payable.termLabel || 'Bankbetaling', payee: target.payable.payee, instalmentDue: target.payable.due, settles: false };
  }

  /**
   * Links a transaction to one target (§3.6): the call of its kind, the bank
   * refreshed (and the containers when a purchase payment was touched), and
   * the notice as a toast with "Ongedaan maken". Returns the refusal, or ''.
   */
  async linkLine(line: BankStatementLine, target: LinkTarget, options: { follow?: boolean; keepAs?: KeepAs; surplus?: 'ADJUST' | 'INSPECTION';
    parts?: BankPurchasePaymentPart[]; toast?: boolean; confirmNew?: boolean } = {}): Promise<string> {
    if (this.linking() !== null) return 'Er loopt al een koppeling.';
    /* An existing cost payment or receipt follows the bank only on a server that knows followBank; the preview and toast say what really happens. */
    const follow = (options.follow ?? true) && (target.kind === 'purchase-existing' || this.cashRound());
    const choice = { follow, keepAs: options.keepAs ?? 'BANKKOSTEN' as KeepAs, surplus: options.surplus ?? 'ADJUST' as const, cashRound: this.cashRound(), confirmNew: options.confirmNew === true };
    const preview = changePreview(target, { amountEur: line.amountEur, day: this.lineDay(line), accountLabel: this.accountLabel(line.account) }, choice.follow, choice.keepAs, choice.surplus);
    const parts = options.parts ?? (target.kind === 'term-new' ? [this.termPart(line, target)] : []);
    this.linking.set(line.id);
    try {
      const outcome = await runLink({ banking: this.banking, sourcing: this.sourcing, finance: this.finance }, line, target, choice, parts);
      this.bankStatements.update((rows) => rows.map((row) => outcome.lines.find((saved) => saved.id === row.id) ?? row));
      const purchase = target.kind === 'term-new' || target.kind === 'purchase-existing';
      await Promise.all([this.refreshBank(), this.reload(['costs', 'payments', ...(purchase ? ['containers' as const] : [])])]);
      if (options.toast !== false) {
        const followed = preview.rows.some((row) => (row.label === 'Bedrag' || row.label === 'Betaald op' || row.label === 'Ontvangen op') && row.changed)
          && !['sales-new', 'cost-new', 'term-new'].includes(target.kind) && preview.primaryLabel === 'Koppelen en aanpassen';
        const notice = outcome.serverNotice ? `Gekoppeld aan ${target.title}. ${outcome.serverNotice}` : preview.notice;
        this.ui.toast(notice, 'ok', { label: 'Ongedaan maken', run: () => void this.undoLinkLine(line, target, outcome, followed) });
      }
      return '';
    } catch (failure: unknown) {
      const message = messageOf(failure, 'Koppelen mislukt');
      if (options.toast !== false) this.ui.toast(message, 'err');
      return message;
    } finally {
      this.linking.set(null);
    }
  }

  /** "Ongedaan maken" after a link: unlinks, removes what the link created; never restores old amounts (the toast says so). */
  private async undoLinkLine(line: BankStatementLine, target: LinkTarget, outcome: LinkOutcome, followed: boolean): Promise<void> {
    if (this.linking() !== null) { this.ui.toast('Even wachten: er loopt nog een actie.'); return; }
    const costPaymentId = target.kind === 'cost-new'
      ? this.costs().find((cost) => cost.id === target.costId)?.payments?.find((payment) => payment.bankStatementLineId === line.id)?.id ?? null : null;
    this.linking.set(line.id);
    try {
      await undoLink({ banking: this.banking, sourcing: this.sourcing, finance: this.finance }, line, target, { costPaymentId, purchase: outcome.purchasePayments });
      await Promise.all([this.refreshBank(), this.reload(['costs', 'payments', 'containers'])]);
      const paid = target.kind === 'purchase-existing' ? this.payments().find((row) => row.id === target.paymentId)
        : target.kind === 'cost-existing' ? this.costs().flatMap((cost) => cost.payments ?? []).find((row) => row.id === target.costPaymentId) : null;
      this.ui.toast(followed && paid ? `Ontkoppeld. De betaling houdt ${formatEuro(paid.amountEur)} op ${shortDay(paid.paidOn)}; pas ze aan in de betaling als dat niet klopt.` : 'Ontkoppeld.');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Ongedaan maken mislukt'), 'err');
    } finally {
      this.linking.set(null);
    }
  }

  /**
   * "Verdelen over containers" (owner addition 2026-10-15): one transfer that
   * paid a term of several containers, every part on its own container, in
   * one atomic call. The toast's "Ongedaan maken" unlinks and removes them.
   */
  async linkContainers(line: BankStatementLine, parts: BankPurchasePaymentPart[], numbers: readonly string[]): Promise<string> {
    /* An older server reads only the request's order and would book every part on the first container. */
    if (!this.cashRound()) return SERVER_PENDING;
    if (this.linking() !== null || !parts.length) return 'Er loopt al een koppeling.';
    this.linking.set(line.id);
    try {
      const result = await this.banking.addPurchasePayment(line.id, parts[0].purchaseOrderId!, parts);
      this.bankStatements.update((rows) => rows.map((row) => (row.id === result.line.id ? result.line : row)));
      await Promise.all([this.refreshBank(), this.reload(['payments', 'containers'])]);
      this.ui.toast(`Gekoppeld aan ${numbers.length} containers (${numbers.join(', ')}).`, 'ok', { label: 'Ongedaan maken', run: () => void this.undoContainers(line, result.payments) });
      return '';
    } catch (failure: unknown) {
      return messageOf(failure, 'Koppelen mislukt');
    } finally {
      this.linking.set(null);
    }
  }

  private async undoContainers(line: BankStatementLine, payments: readonly { id: number; orderId: number }[]): Promise<void> {
    if (this.linking() !== null) return;
    this.linking.set(line.id);
    try {
      await this.banking.unlinkPayments(line.id);
      for (const payment of payments) await this.sourcing.deletePayment(payment.orderId, payment.id);
      await Promise.all([this.refreshBank(), this.reload(['payments', 'containers'])]);
      this.ui.toast('Ontkoppeld.');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Ongedaan maken mislukt'), 'err');
    } finally {
      this.linking.set(null);
    }
  }

  /** "Koppeling losmaken" of a linked line (the payments stay; a receipt the link created goes). */
  unlinkLine(line: BankStatementLine): void {
    if (this.linking() !== null) return;
    const receipt = line.salesPaymentId != null;
    this.ui.confirm({ title: 'Koppeling losmaken',
      message: receipt && line.allocationCreatedPayment ? 'Koppeling losmaken? De ontvangst die bij het koppelen werd aangemaakt, wordt verwijderd.' : 'Koppeling losmaken? De betalingen blijven staan.',
      confirmLabel: 'Koppeling losmaken', danger: true }, async () => {
      this.linking.set(line.id);
      try {
        if (receipt) await this.banking.unallocate(line.id); else await this.banking.unlinkPayments(line.id);
        await Promise.all([this.refreshBank(), this.reload(['costs', 'payments', 'containers'])]);
        this.ui.toast('Koppeling losgemaakt');
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Losmaken mislukt'), 'err');
      } finally {
        this.linking.set(null);
      }
    });
  }

  /** "Ongedaan maken" of "Boeken als…" (both legs of an internal transfer). */
  async unclassifyLine(line: BankStatementLine): Promise<void> {
    if (this.linking() !== null) return;
    this.linking.set(line.id);
    try {
      await this.banking.unclassify(line.id);
      await this.refreshBank();
      this.ui.toast('Boeken als ongedaan gemaakt');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Ongedaan maken mislukt'), 'err');
    } finally {
      this.linking.set(null);
    }
  }

  /**
   * "Transactie zoeken" for a payment without a transaction (§3.11): Transacties
   * in the payment's direction, five days either side, the amount as search;
   * the party is shown, not filtered (bank names differ).
   */
  searchTransaction(payment: { amountEur: number; paidOn: string; party?: string | null; description?: string | null; account?: string | null; incoming?: boolean }): void {
    const amount = Math.abs(round2(payment.amountEur)).toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const account = payment.account ? this.canonicalAccount(payment.account) : '';
    this.searchedFrom.set([payment.party, payment.description].filter(Boolean).join(' · ') || null);
    this.searchedQuery = amount;
    this.unbankedOpen.set(false);
    this.go({ view: 'bank', tab: 'movements', dir: payment.incoming ? 'in' : 'out', link: '', q: amount,
      from: addDays(payment.paidOn, -5), to: addDays(payment.paidOn, 5), account: account && this.bankLedger().accounts.some((row) => row.account === account && !row.archived) ? account : '' }, 'push');
  }

  /** `b` without a manual account (every account comes from Odoo): say so instead of opening the form. */
  noteOnOdoo(): void {
    const label = this.accountsView().filter((account) => account.source === 'ODOO').map((account) => account.label).join(', ') || 'je rekening';
    this.ui.toast(`Transacties van ${label} komen uit Odoo`);
  }

  /* ------------------------------------------------ accounts that count, the buffer */

  /** "Telt mee in de kasprognose" on or off (§3.12); turning off asks first. */
  setCountsInCash(key: string, counts: boolean): void {
    const label = this.accountLabel(key);
    const apply = async (): Promise<void> => {
      try {
        const saved = await this.banking.setCountsInCash(key, counts);
        this.bankAccounts.update((rows) => rows.some((row) => row.key === saved.key) ? rows.map((row) => (row.key === saved.key ? saved : row)) : [...rows, saved]);
        this.ui.toast(`${label} telt ${counts ? 'weer' : 'niet meer'} mee in de kasprognose`);
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Bewaren mislukt'), 'err');
      }
    };
    if (counts) { void apply(); return; }
    this.ui.confirm({ title: 'Niet meetellen', message: `${escapeHtml(label)} niet meetellen in de kaslijn en de kasprognose? Het saldo blijft op Bank staan.`,
      confirmLabel: 'Niet meetellen' }, () => void apply());
  }

  /** The buffer of "krap" (null goes back to € 10.000); one amount for the company, also in Analyses. */
  async saveBuffer(eur: number | null): Promise<boolean> {
    try {
      this.cashSettings.set(await this.cash.saveSettings(eur));
      this.ui.toast(eur === null ? 'Buffer terug op € 10.000' : `Buffer bewaard: ${formatEuro(eur)}`);
      return true;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Bewaren mislukt'), 'err');
      return false;
    }
  }
}
