import type { BankAccount, BankStatementLine } from '../../core/api/banking-api';
import type {
  AppNotification, BankBalance, CompanyCost, Customer, IncomingPaymentRow, Payee, PurchaseOrderView, RecurringCost, SalesOrderView,
} from '../../core/api/models';
import type { PlannerItem } from '../../core/api/planner-api';
import { overdueInvoiceRows } from '../analyses/analysis-metrics';
import type { PartnerFinancingAnalysis } from '../analyses/analysis-metrics';
import { itemLink } from '../analyses/cash-view';
import { canonicalBankAccount, reconciledBank } from '../finance/bank-reconciliation';
import type { CashForecast, ForecastItem, ForecastVatQuarter } from '../finance/cash-forecast';
import { OVERDUE_COST_DAYS, financeAttention } from '../finance/finance-attention';
import type { AttentionItem, AttentionKind } from '../finance/finance-attention';
import { openOf, upcomingRecurring } from '../finance/finance-metrics';
import { DEFAULT_LOCATION, financeQueryParams, patchLocation } from '../finance/finance-url';
import type { FinanceLocation } from '../finance/finance-url';
import { openInvoiceRows, receivableTotals } from '../finance/incoming-money';
import { containerPayables } from '../finance/payables';
import { containerName } from '../purchasing/container-name';
import { agendaForecastMoney } from './agenda-entries';
import type { AgendaInput, AgendaLink, PlannerItemLite } from './agenda-entries';
import type { CashHeadline } from './home-cash';
import { filingDeadlineOf, homeMarkersOf, vatCashByDeadline } from './home-priority';
import type { CoverageSource, HomeTarget, HomeTaskInput, LaterState } from './home-priority';
import type { PlannerMilestone } from './planner-cards';

/*
 * The adapters between the API data the home loads and the pure models
 * (spec-home §4.3, §5.1): HomeTaskInput for home-priority.ts and AgendaInput
 * for agenda-entries.ts. Every figure comes from the helper the rest of the
 * ERP already trusts - containerPayables, partnerFinancingAnalysis,
 * overdueInvoiceRows, receivableTotals, financeAttention (its sentences and
 * targets, so the home and Kosten & bank say the same thing), the forecast's
 * BASE items - and every container is named through containerName().
 * Angular side: runtime imports, no injection; HomeData calls these in its
 * computeds.
 */

const DAY_MS = 86_400_000;
const days = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const cents = (value: number): number => Math.round((Number.isFinite(value) ? value : 0) * 100);
const PAYEE_LABEL: Readonly<Record<Payee, string>> = {
  SUPPLIER: 'Leverancier', LOGISTICS: 'Douane & transport', SEPARATE: 'Inspectie & andere kosten', OTHER: 'Bijkomende kosten',
};

/** A finance location as plain strings (HomeTarget 'finance'); empty and null fields left out. */
export function locationRecord(location: Partial<FinanceLocation>): Record<string, string> {
  return Object.fromEntries(Object.entries(location).filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => [key, String(value)]));
}

/** Where a home task leads; null for the bell and the planner, which the page opens itself. */
export function homeTargetLink(target: HomeTarget): { commands: (string | number)[]; queryParams: Record<string, string> } | null {
  switch (target.kind) {
    case 'route': return { commands: target.path, queryParams: { ...(target.query ?? {}) } };
    case 'cash': return { commands: ['/analyses/cash'], queryParams: {} };
    case 'finance': return { commands: ['/costs'], queryParams: financeQueryParams(patchLocation(DEFAULT_LOCATION, target.location as Partial<FinanceLocation>)) };
    default: return null;
  }
}

/* ---------------------------------------------------------------- tasks */

/** The bell's action items, as the "Klanten wachten" row reads them (one set: bell = row = Verkoop tab). */
export function customersOf(actions: readonly AppNotification[]): HomeTaskInput['customers'] {
  return actions.map((item) => ({ kind: item.kind, title: item.title, orderNumber: item.orderNumber, customer: item.customer, at: item.at, detail: item.detail ?? '' }));
}

/**
 * Container terms due now, one row per order (bucket 'now', not archived), named by containerName(); `terms`
 * counts the order's payables due now, as Kosten & bank's "n containertermijnen nu te betalen" does.
 */
export function containerDueOf(purchases: readonly PurchaseOrderView[]): HomeTaskInput['containerDue'] {
  const byOrder = new Map<number, { orderId: number; label: string; cents: number; count: number; terms: string[] }>();
  for (const row of containerPayables(purchases)) {
    if (row.bucket !== 'now' || row.archived) continue;
    const entry = byOrder.get(row.orderId)
      ?? { orderId: row.orderId, label: containerName({ id: row.orderId, number: row.orderNumber, alias: row.alias }), cents: 0, count: 0, terms: [] };
    entry.cents += cents(row.remainingEur);
    entry.count += 1;
    const term = row.termLabel || PAYEE_LABEL[row.payee];
    if (term && !entry.terms.includes(term)) entry.terms.push(term);
    byOrder.set(row.orderId, entry);
  }
  return [...byOrder.values()].filter((entry) => entry.cents > 0)
    .map((entry) => ({ orderId: entry.orderId, label: entry.label, eur: entry.cents / 100, termLabel: entry.terms.join(', ') || null, terms: entry.count }));
}

/** The unbilled advances of partnerFinancingAnalysis; the first one named by containerName(). */
export function advancesOf(financing: PartnerFinancingAnalysis): HomeTaskInput['advances'] {
  const first = financing.unbilledAdvances[0];
  return {
    count: financing.unbilledAdvanceCount, eur: financing.unbilledAdvanceEur, overdueEur: financing.overdueUnbilledAdvanceEur,
    first: first ? { orderId: first.purchaseOrderId, label: containerName({ id: first.purchaseOrderId, number: first.number, alias: first.alias }),
      due: first.nextAdvanceDueDate } : null,
    orderIds: financing.unbilledAdvances.map((row) => row.purchaseOrderId),
  };
}

/** Overdue invoices: the same list as Verkoop "Te laat" (overdueInvoiceRows). */
export function invoicesOverdueOf(sales: readonly SalesOrderView[], customers: readonly Customer[], today: string): HomeTaskInput['invoicesOverdue'] {
  const names = new Map(customers.map((customer) => [customer.id, customer.company]));
  return overdueInvoiceRows(sales, today).map(({ view, outstandingEur, dueDate }) => ({
    id: view.order.id, number: view.order.number, customer: names.get(view.order.customerId ?? -1) || 'onbekende klant', dueDate, remainingEur: outstandingEur,
  }));
}

/** Official, active-account bank lines (the account rules of finance-state.ts officialBankLine / archivedBankLine). */
function bankLinesOf(cash: HomeCashSources, incoming: readonly IncomingPaymentRow[]): BankStatementLine[] {
  const ledger = reconciledBank(cash.balances, cash.statements, incoming, cash.bankAccounts);
  const accountOf = (line: BankStatementLine) => ledger.accounts.find((account) => account.account === canonicalBankAccount(line.account, cash.bankAccounts));
  return cash.statements.filter((line) => {
    const account = accountOf(line);
    return (line.source === 'ODOO' || account?.source !== 'ODOO') && !(account?.archived ?? false);
  });
}

/** What the home reads of CashData; `bank` and `recurring` are null when they never loaded. */
export interface HomeCashSources {
  bankAccounts: BankAccount[];
  balances: BankBalance[];
  statements: BankStatementLine[];
  recurring: RecurringCost[] | null;
  bankLoaded: boolean;
}

/**
 * Kosten & bank's own attention items for the counts the home can make:
 * overdue costs, bank lines to link, recurring costs due, open credit notes,
 * unconfirmed VAT regimes. Bank lines and recurring costs only when CashData
 * holds them; the rest from the home's own costs and sales.
 */
export function attentionOf(input: { today: string; costs: readonly CompanyCost[]; sales: readonly SalesOrderView[]; costsOk: boolean; salesOk: boolean;
  cash: HomeCashSources; incoming: readonly IncomingPaymentRow[] }): AttentionItem[] {
  const { today, cash } = input;
  const since = `${today.slice(0, 4)}-01-01`;
  const credits = receivableTotals(input.sales);
  return financeAttention({
    today,
    openCosts: input.costsOk ? input.costs.filter((cost) => openOf(cost) !== 0).map((cost) => ({ date: cost.date, openEur: openOf(cost) })) : [],
    unconfirmedRegimes: { count: input.costsOk ? input.costs.filter((cost) => cost.date >= since && (!cost.vatRegimeConfirmed || !cost.vatRegime)).length : 0 },
    dueNowCount: cash.recurring ? cash.recurring.filter((row) => row.active && !!row.nextDate && row.nextDate <= today).length : 0,
    containerNow: { count: 0, eur: 0 },
    bankLines: cash.bankLoaded ? bankLinesOf(cash, input.incoming) : [],
    receiptsWithoutAccount: { count: 0, eur: 0 },
    accounts: [],
    unbanked: { count: 0, eur: 0 },
    costs: [],
    receivables: [],
    openCredits: input.salesOk ? { count: credits.creditNoteCount, eur: credits.creditNoteEur } : { count: 0, eur: 0 },
  });
}

const HOUSEKEEPING: readonly [AttentionKind, HomeTaskInput['housekeeping'][number]['kind']][] = [
  ['unlinked-incoming', 'bank-lines'], ['recurring-due', 'recurring-due'], ['open-credits', 'open-credits'], ['unconfirmed-regimes', 'regimes'],
];

/** The Ook nog rows from Kosten & bank: its sentence, sum and target; the context is its detail line. */
export function housekeepingOf(items: readonly AttentionItem[]): HomeTaskInput['housekeeping'] {
  return HOUSEKEEPING.flatMap(([attention, kind]) => {
    const item = items.find((row) => row.kind === attention);
    if (!item) return [];
    const detail = kind === 'regimes' ? `Kosten van dit jaar · ${item.detail.charAt(0).toLowerCase()}${item.detail.slice(1)}` : item.detail;
    return [{ kind, count: item.count, eur: item.amountEur, title: item.title, detail, location: locationRecord(item.target) }];
  });
}

/** The overdue-costs item of financeAttention, with the age of the oldest (the same rule as its detail line). */
export function overdueCostsOf(items: readonly AttentionItem[], costs: readonly CompanyCost[], today: string): HomeTaskInput['overdueCosts'] {
  const item = items.find((row) => row.kind === 'overdue-costs');
  if (!item) return null;
  const ages = costs.filter((cost) => openOf(cost) !== 0).map((cost) => days(cost.date, today)).filter((age) => age > OVERDUE_COST_DAYS);
  return { count: item.count, eur: item.amountEur ?? 0, oldestDays: ages.length ? Math.max(...ages) : OVERDUE_COST_DAYS + 1, title: item.title,
    location: locationRecord(item.target) };
}

/**
 * Paid VAT periods from the bank ('2026-Q3'; null without bank data) and the VAT cash per filing deadline:
 * the forecast's BASE items, and after its deadline the closed quarter's known net (vatCashByDeadline), both
 * from the same forecast build.
 */
export function vatOf(cash: HomeCashSources, forecast: CashForecast | null, quarters: readonly ForecastVatQuarter[], today: string): HomeTaskInput['vat'] {
  const paidPeriods = cash.bankLoaded
    ? [...new Set(cash.statements.flatMap((line) => (line.classification === 'VAT' && line.vatPeriod ? [line.vatPeriod] : [])))]
    : null;
  return { paidPeriods, eurByDeadline: forecast ? vatCashByDeadline(forecast.items, quarters, today) : {} };
}

/** The first krap period, only from a complete forecast ('ready'). */
export function tightOf(cash: CashHeadline, forecast: CashForecast | null): HomeTaskInput['tight'] {
  const first = forecast?.tightWith[0];
  if (cash.state !== 'ready' || !cash.tight || !first || cash.bufferEur === null) return null;
  return { from: first.from, to: first.to, lowestEur: first.lowestEur, lowestDay: first.lowestDay, bufferEur: cash.bufferEur };
}

/** Expected arrivals (milestones) named by containerName(), with the milestone's "2.400 st · supplier". */
export function arrivalsOf(milestones: readonly PlannerMilestone[], purchases: readonly PurchaseOrderView[]): HomeTaskInput['arrivals'] {
  const byId = new Map(purchases.map((row) => [row.order.id, row.order]));
  return milestones.filter((stone) => stone.kind === 'EXPECTED_ARRIVAL').map((stone) => {
    const order = byId.get(stone.orderId);
    return { orderId: stone.orderId, label: containerName(order ?? { id: stone.orderId }), date: stone.date, sub: stone.sub ?? '' };
  });
}

/** The `<key>#<hash>` markers in the notes of open planner tasks ("Taak van maken"). */
export function taskKeysOf(items: readonly PlannerItem[]): string[] {
  return items.filter((item) => item.kind === 'TASK' && !item.done).flatMap((item) => homeMarkersOf(item.note));
}

export function plannerLite(items: readonly PlannerItem[]): HomeTaskInput['planner'] {
  return items.filter((item) => item.id !== null).map((item) => ({
    id: item.id!, kind: item.kind, title: item.title, onDate: item.onDate, done: item.done, pinned: !!item.pinned, note: item.note,
  }));
}

export interface HomeTaskSources {
  today: string; nowMs: number;
  planner: readonly PlannerItem[];
  actions: readonly AppNotification[];
  loginRequests: number;
  purchases: readonly PurchaseOrderView[];
  financing: PartnerFinancingAnalysis;
  sales: readonly SalesOrderView[];
  customers: readonly Customer[];
  costs: readonly CompanyCost[];
  attention: readonly AttentionItem[];
  cash: HomeCashSources;
  forecast: CashForecast | null;
  /** The VAT quarters the forecast was built from (cashForecastInput). */
  vatQuarters: readonly ForecastVatQuarter[];
  headline: CashHeadline;
  milestones: readonly PlannerMilestone[];
  catalog: number;
  later: LaterState;
  sources: Readonly<Record<CoverageSource, boolean>>;
}

export function homeTaskInputOf(s: HomeTaskSources): HomeTaskInput {
  return {
    today: s.today, nowMs: s.nowMs,
    planner: plannerLite(s.planner),
    customers: customersOf(s.actions),
    loginRequests: s.loginRequests,
    containerDue: containerDueOf(s.purchases),
    advances: advancesOf(s.financing),
    settlements: s.financing.awaitingSettlement,
    invoicesOverdue: invoicesOverdueOf(s.sales, s.customers, s.today),
    overdueCosts: overdueCostsOf(s.attention, s.costs, s.today),
    vat: vatOf(s.cash, s.forecast, s.vatQuarters, s.today),
    tight: tightOf(s.headline, s.forecast),
    arrivals: arrivalsOf(s.milestones, s.purchases),
    purchaseCheck: s.purchases.filter((row) => (row.attention?.length ?? 0) > 0).length,
    catalog: s.catalog,
    housekeeping: housekeepingOf(s.attention),
    later: s.later,
    taskKeys: taskKeysOf(s.planner),
    sources: s.sources,
  };
}

/* --------------------------------------------------------------- agenda */

const linkOf = (item: ForecastItem): AgendaLink => {
  const link = itemLink(item);
  if (!link || !link.path.length) return { path: ['/analyses/cash'] };
  return link.query ? { path: link.path, query: link.query } : { path: link.path };
};

/** The quarter whose filing deadline is the next one from today: 25 Oct closes Q3, after it 25 Jan closes Q4. */
export function nextVatPeriod(today: string): { year: number; quarter: number; deadline: string } {
  const year = Number(today.slice(0, 4));
  const quarter = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
  const previous = quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: quarter - 1 };
  const deadline = filingDeadlineOf(previous.year, previous.quarter);
  if (deadline >= today) return { ...previous, deadline };
  return { year, quarter, deadline: filingDeadlineOf(year, quarter) };
}

export interface HomeAgendaSources {
  today: string; nowTime: string;
  planner: readonly PlannerItem[];
  milestones: readonly PlannerMilestone[];
  forecast: CashForecast | null;
  headline: CashHeadline;
  sales: readonly SalesOrderView[];
  salesOk: boolean;
  customers: readonly Customer[];
  cash: HomeCashSources;
  vat: HomeTaskInput['vat'];
}

/**
 * The agenda's input: money from the forecast's BASE items when it is
 * there (agendaForecastMoney: no scenario, nothing overdue), else open
 * invoices on their due day and the recurring costs on their next day,
 * neither once that day has passed; the next VAT filing deadline unless
 * that quarter is paid; the first krap period.
 */
export function agendaInputOf(s: HomeAgendaSources): AgendaInput {
  const vatPeriod = nextVatPeriod(s.today);
  const paid = s.vat.paidPeriods?.includes(`${vatPeriod.year}-Q${vatPeriod.quarter}`) ?? false;
  const vatEur = s.vat.eurByDeadline[vatPeriod.deadline];
  const vatDeadline = paid ? null : { date: vatPeriod.deadline, label: `Btw-aangifte Q${vatPeriod.quarter}`, eur: vatEur ?? null,
    link: { path: ['/costs'], query: { view: 'analysis', tab: 'vat', year: vatPeriod.year, quarter: vatPeriod.quarter } } };
  const forecastUsable = !!s.forecast && (s.headline.state === 'ready' || s.headline.state === 'no-reading');
  let money: AgendaInput['money'][number][] = [];
  let moneySource: AgendaInput['moneySource'] = null;
  if (forecastUsable) {
    moneySource = 'prognose';
    money = agendaForecastMoney(s.forecast!.items, vatPeriod.deadline)
      .map((item) => ({ date: item.date, eur: item.amountEur, title: item.title, party: item.party, orderId: item.orderId, link: linkOf(item) }));
  } else if (s.salesOk) {
    moneySource = 'facturen';
    const names = new Map(s.customers.map((customer) => [customer.id, customer.company]));
    money = openInvoiceRows(s.sales).flatMap((row) => {
      const due = row.view.order.invoiceDueDate?.slice(0, 10);
      if (!due || due < s.today) return [];
      return [{ date: due, eur: row.remainingEur, title: `Factuur ${row.view.order.number}`, party: names.get(row.view.order.customerId ?? -1) ?? null,
        orderId: null, link: { path: ['/sales', row.view.order.id] } }];
    });
    for (const definition of s.cash.recurring ?? []) {
      const next = definition.nextDate;
      if (!definition.active || !next || next < s.today) continue;
      const occurrence = upcomingRecurring([definition], next, next)[0];
      if (!occurrence) continue;
      money.push({ date: next, eur: -occurrence.amountInclEur, title: definition.name, party: definition.party, orderId: null,
        link: { path: ['/costs'], query: { view: 'costs', tab: 'recurring' } } });
    }
  }
  const first = s.forecast?.tightWith[0];
  return {
    today: s.today, nowTime: s.nowTime,
    items: s.planner.filter((item) => item.id !== null).map((item): PlannerItemLite => ({
      id: item.id, kind: item.kind, title: item.title, onDate: item.onDate, atTime: item.atTime, note: item.note, done: item.done,
      pinned: !!item.pinned, parentId: item.parentId ?? null,
    })),
    milestones: s.milestones, money, moneySource, vatDeadline,
    tight: s.headline.state === 'ready' && first ? { from: first.from, to: first.to } : null,
  };
}
