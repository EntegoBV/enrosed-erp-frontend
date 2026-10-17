import type { BankAccount, BankStatementLine } from '../../core/api/banking-api';
import type {
  BankBalance, CashForecastSettings, CompanyCost, CompanyProfile, Customer, IncomingPaymentRow, PartnerAdvanceSchedule, Product,
  PurchaseOrderForecast, PurchaseOrderView, PurchasePaymentRow, RecurringCost, SalesOrderView, Supplier,
} from '../../core/api/models';
import { bankAccountKey, bankCheckpoint, canonicalBankAccount, reconciledBank } from './bank-reconciliation';
import { addDays, cashOutlook, cashTotalOf, intervalLabel, openOf, returnLineOf, upcomingRecurring } from './finance-metrics';
import type { CashOutlook } from './finance-metrics';
import { containerPayables, payableTotals, payablesFor } from './payables';
import type { OpenCost } from './payables';
import { openInvoiceRows, paymentLocalDay, receivableTotals } from './incoming-money';
import { clearanceSuggestion, containerLines, salesDocLines, vatReturn } from './vat-return';
import { categoryLabel } from './cost-categories';
import { documentAccounting, isPartnerFundingDocument, piecesSoldByProduct } from '../analyses/analysis-metrics';
import { DEFAULT_CASH_BUFFER_EUR, DEFAULT_LEAD_TIME_DAYS, DEFAULT_TRANSIT_DAYS, containerDates, seasonalProfile } from './cash-forecast';
import type {
  BankLineKind, CashForecastInput, ForecastAccount, ForecastAdvanceRow, ForecastBankLine, ForecastContainerRow, ForecastHistory,
  ForecastInvoice, ForecastMovement, ForecastOpenQuote, ForecastOrder, ForecastOrderLine, ForecastProduct, ForecastQuote, Iso,
} from './cash-forecast';

/*
 * Builds the cash forecast's input from the API data both pages load, with
 * the helpers the rest of Kosten & bank already trusts (reconciledBank,
 * containerPayables, receivableTotals, vatReturn, …), so every figure of
 * the forecast is the one those screens show (spec-bank-forecast §2.4).
 * Angular-free; runtime imports allowed. The node test transpiles it with
 * its imports rewritten: keep every imported module free of runtime imports
 * that node cannot follow.
 */

export interface CashForecastSources {
  today: Iso;
  bankAccounts: BankAccount[]; balances: BankBalance[]; statements: BankStatementLine[]; incomingPayments: IncomingPaymentRow[];
  costs: CompanyCost[]; recurring: RecurringCost[];
  purchaseViews: PurchaseOrderView[]; purchasePayments: PurchasePaymentRow[]; suppliers: Supplier[];
  salesOrders: SalesOrderView[]; customers: Customer[]; advanceSchedules: PartnerAdvanceSchedule[];
  company: CompanyProfile | null; forecasts: PurchaseOrderForecast[]; settings: CashForecastSettings | null;
  products: Product[] | null;   // null on Kosten & bank (no scenario); history then holds no product data
  statementsFrom: Iso | null;   // Analyses: the ?from= day of §4.1; Kosten & bank: null
}

type VooruitblikSources = Pick<CashForecastSources, 'today' | 'bankAccounts' | 'balances' | 'statements'
  | 'incomingPayments' | 'costs' | 'recurring' | 'purchaseViews' | 'salesOrders'>;

const DEAD = new Set(['GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN']);
const round2 = (value: number): number => Math.round(value * 100) / 100;
const cents = (value: number | null | undefined): number => Math.round((Number.isFinite(value as number) ? value as number : 0) * 100);
const eur = (value: number): number => (value === 0 ? 0 : value / 100);
const finite = (value: number | null | undefined): number => (Number.isFinite(value as number) ? value as number : 0);
const days = (from: Iso, to: Iso): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const isoDay = (value: string | null | undefined): Iso | null => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);
const compact = (text: string | null | undefined): string => (text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function addMonths(day: Iso, months: number): Iso {
  const total = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1 + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(Number(day.slice(8, 10)), last)).padStart(2, '0')}`;
}
const quarterOf = (day: Iso): { year: number; quarter: number } => ({ year: Number(day.slice(0, 4)), quarter: Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1 });
/** A paid-at value as a Brussels day (an instant), or the day itself. */
const dayOfInstant = (value: string | null | undefined): Iso | null => {
  if (!value) return null;
  if (!value.includes('T')) return isoDay(value);
  return paymentLocalDay({ receivedAt: value, timeZone: 'Europe/Brussels' }) || isoDay(value);
};

/* ------------------------------------------------------------ Vooruitblik */

/** The Vooruitblik as FinanceState shows it; the one function that computes it (FinanceState.outlook uses it from 1b). */
export function vooruitblikOf(sources: VooruitblikSources): CashOutlook {
  const ledger = reconciledBank(sources.balances, sources.statements, sources.incomingPayments, sources.bankAccounts);
  const openCosts: OpenCost[] = sources.costs.filter((cost) => openOf(cost) !== 0)
    .map((cost) => ({ ...cost, openEur: openOf(cost), cashTotalEur: cashTotalOf(cost) }));
  const openCostsInclEur = round2(openCosts.reduce((sum, cost) => sum + cost.openEur, 0));
  const upcoming = upcomingRecurring(sources.recurring, sources.today, addDays(sources.today, 30));
  const upcomingInclEur = round2(upcoming.reduce((sum, row) => sum + row.amountInclEur, 0));
  const invoices = receivableTotals(sources.salesOrders);
  const totals = payableTotals(payablesFor({ openCosts, upcoming30: upcoming, containerRows: containerPayables(sources.purchaseViews), today: sources.today }));
  return cashOutlook(ledger.totalEur, openCostsInclEur, upcomingInclEur, invoices.totalEur, totals.containerNowEur, totals.containerLaterEur, invoices.creditNoteEur);
}

/* ---------------------------------------------------------------- accounts */

type BankSources = Pick<CashForecastSources, 'bankAccounts' | 'balances' | 'statements' | 'incomingPayments'>;
type LedgerAccount = ReturnType<typeof reconciledBank>['accounts'][number];

/** A line the forecast reads on its account: on an Odoo account only Odoo's own lines. */
const officialLine = (line: BankStatementLine, source: 'ODOO' | 'MANUAL'): boolean => source !== 'ODOO' || line.source === 'ODOO';

/** One reconciled account as the forecast counts it (countsInCash, labelOnly), with its official statement lines. */
function forecastAccountOf(account: LedgerAccount, sources: BankSources, statements: readonly BankStatementLine[]): { forecast: ForecastAccount; lines: BankStatementLine[] } {
  const keyOf = (value: string | null | undefined): string => canonicalBankAccount(value, sources.bankAccounts);
  const registry = sources.bankAccounts.find((row) => bankAccountKey(row.key) === account.account);
  const checkpoints = sources.balances.filter((row) => keyOf(row.account) === account.account).map(bankCheckpoint).filter(Number.isFinite);
  const lines = statements.filter((line) => keyOf(line.account) === account.account && officialLine(line, account.source));
  const readingAt = account.reading ? bankCheckpoint(account.reading) : Number.NaN;
  const latestReading = account.reading && Number.isFinite(readingAt) ? { atMs: readingAt, balanceEur: finite(account.reading.balanceEur) } : null;
  return {
    forecast: {
      key: account.account, label: account.label, source: account.source, archived: account.archived,
      countsInCash: registry?.countsInCash !== false && !account.archived, currentEur: account.currentEur, checkedAt: account.checkedAt,
      firstReadingAtMs: checkpoints.length ? Math.min(...checkpoints) : null, latestReading, labelOnly: !latestReading && !lines.length,
    },
    lines,
  };
}

/**
 * The bank the forecast starts from, without building it: the accounts buildCashForecast counts (countedAccounts:
 * not archived, not label-only, counting in cash), summed in cents; null when one of them has no reading (the
 * forecast is relative then and shows no bank). The home shows it while the forecast is being built, so "Op de
 * bank" reads one figure from the first paint on - the Vooruitblik's bankEur also counts the accounts that do not
 * count in cash (Kosten & bank's equation, unchanged).
 */
export function forecastStartEur(sources: BankSources): number | null {
  const statements = [...new Map(sources.statements.map((line) => [line.id, line])).values()];
  const ledger = reconciledBank(sources.balances, statements, sources.incomingPayments, sources.bankAccounts);
  const counted = ledger.accounts.map((account) => forecastAccountOf(account, sources, statements).forecast)
    .filter((account) => !account.archived && !account.labelOnly && account.countsInCash);
  if (counted.some((account) => account.currentEur === null)) return null;
  return eur(counted.reduce((sum, account) => sum + cents(account.currentEur), 0));
}

/* ------------------------------------------------------------------ input */

/** Everything the forecast needs, field by field as §2.4 of the spec describes it. */
export function cashForecastInput(sources: CashForecastSources): CashForecastInput {
  const today = sources.today;
  const statements = [...new Map(sources.statements.map((line) => [line.id, line])).values()];
  const keyOf = (value: string | null | undefined): string => canonicalBankAccount(value, sources.bankAccounts);
  const ledger = reconciledBank(sources.balances, statements, sources.incomingPayments, sources.bankAccounts);
  const customerName = new Map(sources.customers.map((customer) => [customer.id, customer.company]));
  const nameOf = (id: number | null | undefined): string => customerName.get(id ?? -1) ?? '';

  /* accounts and movements */
  const linkedReceipts = new Set(statements.map((line) => line.salesPaymentId).filter((id): id is number => id !== null && id !== undefined));
  const accounts: ForecastAccount[] = [];
  const movements: ForecastMovement[] = [];
  const sourceOf = new Map<string, 'ODOO' | 'MANUAL'>();
  for (const account of ledger.accounts) {
    sourceOf.set(account.account, account.source);
    const { forecast, lines } = forecastAccountOf(account, sources, statements);
    accounts.push(forecast);
    for (const line of lines) {
      const day = paymentLocalDay({ receivedAt: line.bookedAt, timeZone: line.timeZone });
      if (!day || (sources.statementsFrom && day < sources.statementsFrom)) continue;
      movements.push({ key: `bank:${line.id}`, lineId: line.id, account: account.account, atMs: Date.parse(line.bookedAt), day, amountEur: finite(line.amountEur) });
    }
    if (account.source === 'ODOO') continue;
    for (const receipt of new Map(sources.incomingPayments.map((row) => [row.id, row])).values()) {
      if (linkedReceipts.has(receipt.id) || !receipt.bankAccount || keyOf(receipt.bankAccount) !== account.account) continue;
      const day = paymentLocalDay(receipt);
      if (!day || (sources.statementsFrom && day < sources.statementsFrom)) continue;
      movements.push({ key: `payment:${receipt.id}`, lineId: null, account: account.account, atMs: Date.parse(receipt.receivedAt), day, amountEur: finite(receipt.amountEur) });
    }
  }
  const accountByKey = new Map(accounts.map((account) => [account.key, account]));
  const counts = (key: string): boolean => { const account = accountByKey.get(key); return !!account && account.countsInCash && !account.archived; };

  /* bank lines with what each one paid */
  const purchaseOnLine = new Map<number, number>();
  for (const payment of sources.purchasePayments) {
    if (payment.bankStatementLineId === null || payment.bankStatementLineId === undefined) continue;
    purchaseOnLine.set(payment.bankStatementLineId, (purchaseOnLine.get(payment.bankStatementLineId) ?? 0) + cents(payment.amountEur));
  }
  const costOnLine = new Map<number, number>();
  for (const cost of sources.costs) {
    const payments = cost.payments ?? [];
    for (const payment of payments) {
      if (payment.bankStatementLineId === null || payment.bankStatementLineId === undefined) continue;
      costOnLine.set(payment.bankStatementLineId, (costOnLine.get(payment.bankStatementLineId) ?? 0) + cents(payment.amountEur));
    }
    const legacy = cost.bankStatementLineId;
    if (legacy !== null && legacy !== undefined && !payments.some((payment) => payment.bankStatementLineId === legacy)) {
      costOnLine.set(legacy, (costOnLine.get(legacy) ?? 0) + cents(cashTotalOf(cost)));
    }
  }
  const lineById = new Map(statements.map((line) => [line.id, line]));
  const bankLines: ForecastBankLine[] = [];
  for (const line of statements) {
    const key = keyOf(line.account);
    if (!officialLine(line, sourceOf.get(key) ?? 'MANUAL')) continue;
    const amount = cents(line.amountEur);
    const parts: { kind: BankLineKind; cents: number }[] = [];
    if (line.classification) {
      let kind: BankLineKind = line.classification === 'VAT' ? 'VAT' : 'OTHER';
      if (line.classification === 'INTERNAL_TRANSFER') {
        const other = line.transferLineId !== null && line.transferLineId !== undefined ? lineById.get(line.transferLineId) : undefined;
        kind = other && counts(keyOf(other.account)) ? 'INTERNAL' : 'OTHER';
      }
      parts.push({ kind, cents: amount });
    } else {
      const containers = -(purchaseOnLine.get(line.id) ?? 0);
      const costs = -(costOnLine.get(line.id) ?? 0);
      const customers = line.salesPaymentId !== null && line.salesPaymentId !== undefined ? cents(line.allocatedAmountEur ?? line.amountEur) : 0;
      const rest = amount - containers - costs - customers;
      parts.push({ kind: 'CONTAINERS', cents: containers }, { kind: 'COSTS', cents: costs + (amount < 0 ? rest : 0) },
        { kind: 'CUSTOMERS', cents: customers + (amount < 0 ? 0 : rest) });
    }
    const day = paymentLocalDay({ receivedAt: line.bookedAt, timeZone: line.timeZone });
    if (!day) continue;
    bankLines.push({
      id: line.id, account: key, day, amountEur: eur(amount), counterparty: line.counterparty ?? '', reference: line.reference ?? '',
      allocated: (line.allocated ?? false) || (line.salesPaymentId !== null && line.salesPaymentId !== undefined), official: true,
      classification: line.classification ?? null, transferLineId: line.transferLineId ?? null,
      parts: parts.filter((part) => part.cents !== 0).map((part) => ({ kind: part.kind, amountEur: eur(part.cents) })),
      accountLabel: accountByKey.get(key)?.label ?? key,
    });
  }

  /* products and the history (both read the sales of the last year) */
  const regularInvoice = (view: SalesOrderView): boolean => view.order.docType === 'FACTUUR' && view.order.status !== 'CONCEPT'
    && !DEAD.has(view.order.status) && !isPartnerFundingDocument(view) && view.advanceBilling?.stage !== 'ADVANCE';
  const yearAgo = addDays(today, -365);
  const window = addDays(today, -364);
  const recognised = sources.salesOrders.filter((view) => (view.order.docType === 'FACTUUR' || view.order.docType === 'CREDITNOTA')
    && !isPartnerFundingDocument(view) && view.advanceBilling?.stage !== 'ADVANCE');
  const inWindow = recognised.filter((view) => view.order.orderDate >= window && view.order.orderDate <= today);
  const revenue = inWindow.reduce((sum, view) => sum + finite(documentAccounting(view).recognizedRevenueEur), 0);
  const cost = inWindow.reduce((sum, view) => sum + finite(documentAccounting(view).recognizedCostEur), 0);
  const received = sources.purchaseViews.filter((view) => !view.order.partnerCustomerId && view.order.status === 'ONTVANGEN'
    && !!view.order.receivedOn && view.order.receivedOn >= window && view.order.receivedOn <= today && view.reconciliation);
  const externalSum = received.reduce((sum, view) => sum + finite(view.reconciliation!.totals.forecastExternalEur), 0);
  const pricingSum = received.reduce((sum, view) => sum + finite(view.reconciliation!.totals.forecastPricingEur), 0);
  const externalShare = received.length && pricingSum > 0 ? externalSum / pricingSum : 1;
  const realisedMarkupPct = revenue > 0 && cost > 0 ? Math.round((revenue / (cost * externalShare) - 1) * 1000) / 10 : null;

  const paidDayOf = (view: SalesOrderView): Iso | null => {
    const marker = dayOfInstant(view.order.paidAt);
    if (marker) return marker;
    const receipts = (view.paymentSummary?.payments ?? []).filter((payment) => payment.offsetPaymentId === null || payment.offsetPaymentId === undefined)
      .map((payment) => paymentLocalDay(payment)).filter(Boolean).sort();
    return receipts.length ? receipts[receipts.length - 1] : null;
  };
  const fullyPaid = (view: SalesOrderView): boolean => view.paymentSummary?.status === 'PAID' || view.paymentSummary?.status === 'OVERPAID' || !!view.order.paidAt;
  const paidInvoices = sources.salesOrders.filter((view) => regularInvoice(view) && fullyPaid(view))
    .map((view) => ({ view, paidDay: paidDayOf(view) })).filter((row): row is { view: SalesOrderView; paidDay: Iso } => !!row.paidDay);
  const recentPaid = paidInvoices.filter((row) => row.paidDay >= yearAgo && row.paidDay <= today);
  const paymentDays = recentPaid.length ? Math.round(recentPaid.reduce((sum, row) => sum + days(row.view.order.orderDate, row.paidDay), 0) / recentPaid.length) : null;
  const lastYearInvoices = sources.salesOrders.filter((view) => regularInvoice(view) && view.order.orderDate >= yearAgo && view.order.orderDate <= today);
  const vatSum = lastYearInvoices.reduce((sum, view) => sum + finite(view.priced?.totals?.vatAmount), 0);
  const netSum = lastYearInvoices.reduce((sum, view) => sum + finite(view.priced?.totals?.total), 0);
  const perMonth = new Map<string, number>();
  for (const view of recognised) {
    const month = (view.order.orderDate ?? '').slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) perMonth.set(month, (perMonth.get(month) ?? 0) + finite(documentAccounting(view).recognizedRevenueEur));
  }
  const decided = sources.salesOrders.filter((view) => (view.order.docType ?? 'OFFERTE') === 'OFFERTE' && !!view.order.decidedAt
    && (dayOfInstant(view.order.decidedAt) ?? '') >= yearAgo);
  const accepted = decided.filter((view) => view.order.status === 'GEACCEPTEERD' || view.order.status === 'BETAALD').length;
  const declined = decided.filter((view) => view.order.status === 'AFGEWEZEN' || view.order.status === 'VERLOPEN').length;
  const history: ForecastHistory = {
    realisedMarkupPct, paymentDays,
    vatPct: netSum > 0 ? round2(vatSum / netSum * 100) : 21,
    seasonal: seasonalProfile([...perMonth].map(([month, value]) => ({ month, eur: value }))),
    openQuoteConversionPct: accepted + declined > 0 ? Math.round(accepted / (accepted + declined) * 100) : 0,
  };

  const products: ForecastProduct[] = [];
  if (sources.products) {
    const sold = piecesSoldByProduct(sources.salesOrders, today, 90);
    const invoiced = new Map<number, { net: number; quantity: number }>();
    for (const view of lastYearInvoices) {
      for (const line of view.priced?.lines ?? []) {
        if (!Number.isInteger(line.productId) || !(finite(line.quantity) > 0)) continue;
        const row = invoiced.get(line.productId) ?? { net: 0, quantity: 0 };
        row.net += finite(line.net);
        row.quantity += finite(line.quantity);
        invoiced.set(line.productId, row);
      }
    }
    for (const product of sources.products) {
      if (product.id === null || product.demo || product.inventoryKnown === false) continue;
      const landed = Number.isFinite(product.landedCostEur as number) ? product.landedCostEur as number : null;
      const sales = invoiced.get(product.id);
      products.push({
        productId: product.id, name: product.name, stockUnits: Math.max(0, finite(product.stockQuantity)),
        externalUnitEur: landed === null ? null : Math.round(landed * externalShare * 10000) / 10000, pricingUnitEur: landed,
        listUnitEur: Number.isFinite(product.computedSalesPriceEur) ? product.computedSalesPriceEur : null,
        historicUnitEur: sales && sales.quantity > 0 ? Math.round(sales.net / sales.quantity * 10000) / 10000 : null,
        paceUnitsPerWeek: (sold.get(product.id) ?? 0) * 7 / 90,
      });
    }
  }
  const productById = new Map(products.map((product) => [product.productId, product]));

  /* containers */
  const forecasts = new Map(sources.forecasts.map((row) => [row.orderId, row]));
  const asOrdered = (view: PurchaseOrderView): PurchaseOrderView => ({ ...view, order: { ...view.order, status: 'BESTELD' } });
  const toRow = (concept: boolean) => (row: ReturnType<typeof containerPayables>[number]): ForecastContainerRow => ({
    key: row.key, orderId: row.orderId, payee: row.payee, due: row.due, termLabel: row.termLabel, remainingEur: row.remainingEur, concept,
  });
  const containerRows: ForecastContainerRow[] = [
    ...containerPayables(sources.purchaseViews).map(toRow(false)),
    ...sources.purchaseViews.filter((view) => view.order.status === 'CONCEPT' && !view.order.archivedAt && view.reconciliation)
      .flatMap((view) => containerPayables([asOrdered(view)]).map(toRow(true))),
  ];
  const importVatDeferred = sources.company?.importVatDeferred === true;
  const lineSettings = { importVatDeferred, representative: sources.company?.fiscalRepresentativeName ?? null };
  const importVat = new Map(containerLines(sources.purchaseViews, lineSettings).map((line) => [line.id, line.vatEur]));
  const supplierById = new Map(sources.suppliers.map((supplier) => [supplier.id, supplier]));
  const transitOf = (rows: readonly PurchaseOrderView[]): number | null => {
    const spans = rows.filter((view) => view.order.status === 'ONTVANGEN' && view.order.shippedOn && view.order.receivedOn && view.order.receivedOn >= view.order.shippedOn)
      .map((view) => days(view.order.shippedOn!, view.order.receivedOn!));
    return spans.length ? Math.round(spans.reduce((sum, value) => sum + value, 0) / spans.length) : null;
  };
  const transitAll = transitOf(sources.purchaseViews) ?? DEFAULT_TRANSIT_DAYS;
  const statementAccount = (lineId: number | null | undefined): string | null => {
    const line = lineId !== null && lineId !== undefined ? lineById.get(lineId) : undefined;
    return line ? accountByKey.get(keyOf(line.account))?.label ?? line.account : null;
  };
  const importCosts = sources.costs.filter((row) => row.vatRegime === 'IMPORT_VAT_PAID');
  const orders: ForecastOrder[] = sources.purchaseViews.map((view) => {
    const order = view.order;
    const supplier = supplierById.get(order.supplierId);
    const totals = view.reconciliation?.totals;
    const vatEur = order.status === 'CONCEPT' ? containerLines([asOrdered(view)], lineSettings)[0]?.vatEur ?? 0 : importVat.get(order.id) ?? 0;
    return {
      orderId: order.id, number: order.number, alias: order.alias ?? null, status: order.status, partner: !!order.partnerCustomerId,
      archived: !!order.archivedAt, supplierName: supplier?.name ?? '', orderDate: order.orderDate, shippedOn: order.shippedOn ?? null,
      expectedArrival: order.expectedArrival ?? null, receivedOn: order.receivedOn ?? null,
      leadTimeDays: supplier && supplier.leadTimeDays > 0 ? supplier.leadTimeDays : DEFAULT_LEAD_TIME_DAYS,
      transitDays: transitOf(sources.purchaseViews.filter((other) => other.order.supplierId === order.supplierId)) ?? transitAll,
      importVatEur: vatEur, importVatCovered: false,
      clearance: order.clearance ?? clearanceSuggestion(order.destinationPort), clearanceConfirmed: order.clearance !== null && order.clearance !== undefined,
      paidEur: finite(totals?.paidEur), remainingEur: finite(totals?.remainingEur), internalMarkupEur: finite(totals?.internalMarkupEur),
      lines: [],
      payments: sources.purchasePayments.filter((payment) => payment.orderId === order.id).map((payment) => ({
        id: payment.id, paidOn: payment.paidOn, amountEur: finite(payment.amountEur), label: payment.label ?? '', payee: payment.payee ?? 'SUPPLIER',
        lineId: payment.bankStatementLineId ?? null, accountLabel: statementAccount(payment.bankStatementLineId), creditOffset: !!payment.creditOffset,
      })),
      invoiceNumbers: (view.invoices ?? []).map((invoice) => invoice.number).filter(Boolean),
      inspectionViaSupplier: !!order.inspectionViaSupplier,
    };
  });
  /* The arrival rule needs the order itself; import VAT and the stock ahead read it. */
  const arrivals = new Map(orders.map((order) => [order.orderId, containerDates(order, forecasts.get(order.orderId) ?? null).arrival.date]));
  orders.forEach((order, index) => {
    const view = sources.purchaseViews[index];
    const arrival = arrivals.get(order.orderId)!;
    const number = compact(order.number);
    order.importVatCovered = order.importVatEur > 0 && importCosts.some((row) => Math.abs(days(arrival, row.date)) <= 30
      && ((number.length > 0 && [row.description, row.reference, row.notes].some((text) => compact(text).includes(number)))
        || Math.abs(cents(cashTotalOf(row)) - cents(order.importVatEur)) <= 2));
    order.lines = (view.reconciliation?.lines ?? []).map((line): ForecastOrderLine => {
      const product = line.productId !== null ? productById.get(line.productId) : undefined;
      const pace = product?.paceUnitsPerWeek ?? 0;
      const sourceProduct = line.productId !== null ? sources.products?.find((row) => row.id === line.productId) : undefined;
      const earlier = sources.purchaseViews.filter((other) => other.order.id !== order.orderId && (other.order.status === 'BESTELD' || other.order.status === 'ONDERWEG')
        && (arrivals.get(other.order.id) ?? '9999-12-31') < arrival)
        .reduce((sum, other) => sum + (other.reconciliation?.lines ?? []).filter((row) => row.productId === line.productId)
          .reduce((total, row) => total + finite(row.orderedQuantity), 0), 0);
      const ahead = product && sourceProduct ? Math.max(0, finite(sourceProduct.stockQuantity) + earlier - pace * days(today, arrival) / 7) : 0;
      return {
        productId: line.productId, name: line.productName, quantity: finite(line.unitCostQuantity), externalEur: finite(line.forecastExternalEur),
        pricingEur: finite(line.forecastPricingEur), listUnitEur: product?.listUnitEur ?? null, historicUnitEur: product?.historicUnitEur ?? null,
        paceUnitsPerWeek: pace, aheadUnits: ahead,
      };
    });
  });

  /* invoices */
  const delayFor = new Map<number, number>();
  const delayOf = (customerId: number | null): number => {
    if (customerId === null) return 0;
    if (delayFor.has(customerId)) return delayFor.get(customerId)!;
    const rows = paidInvoices.filter((row) => row.view.order.customerId === customerId && row.view.order.orderDate >= yearAgo
      && !!isoDay(row.view.order.invoiceDueDate));
    const delay = rows.length >= 2
      ? Math.round(rows.reduce((sum, row) => sum + Math.max(0, days(isoDay(row.view.order.invoiceDueDate)!, row.paidDay)), 0) / rows.length) : 0;
    delayFor.set(customerId, delay);
    return delay;
  };
  const invoices: ForecastInvoice[] = openInvoiceRows(sources.salesOrders).map((row) => {
    const order = row.view.order;
    const partner = order.purpose ? order.purpose !== 'STANDARD' : !!order.partnerPurchaseOrderId;
    return {
      salesOrderId: order.id, number: order.number, party: nameOf(order.customerId), partner, advance: order.purpose === 'PARTNER_ADVANCE',
      dueDate: isoDay(order.invoiceDueDate) ?? addDays(order.orderDate, 30), remainingEur: row.remainingEur, delayDays: partner ? 0 : delayOf(order.customerId),
    };
  });

  /* partner advance rows not yet invoiced */
  const isAdvanceInvoice = (view: SalesOrderView, orderId: number): boolean => view.order.docType === 'FACTUUR' && view.order.partnerPurchaseOrderId === orderId
    && (view.order.purpose === 'PARTNER_ADVANCE' || (!view.order.purpose && !view.order.partnerSettlement));
  const settled = (orderId: number): boolean => sources.salesOrders.some((view) => view.order.docType === 'FACTUUR' && view.order.partnerPurchaseOrderId === orderId
    && (view.order.purpose === 'PARTNER_SETTLEMENT' || !!view.order.partnerSettlement) && view.order.status !== 'GEANNULEERD');
  const numberOf = new Map(sources.purchaseViews.map((view) => [view.order.id, view.order.number]));
  const advanceRows: ForecastAdvanceRow[] = [];
  for (const schedule of sources.advanceSchedules) {
    if (settled(schedule.purchaseOrderId)) continue;
    const latest = sources.salesOrders.filter((view) => isAdvanceInvoice(view, schedule.purchaseOrderId) && view.order.status !== 'CONCEPT' && !DEAD.has(view.order.status))
      .sort((left, right) => right.order.orderDate.localeCompare(left.order.orderDate) || right.order.id - left.order.id)[0];
    const rate = latest && Number.isFinite(latest.priced?.totals?.vatRatePct) ? latest.priced.totals.vatRatePct : 21;
    for (const row of schedule.rows) {
      if (row.invoiceId !== null && row.invoiceStatus !== 'CONCEPT') continue;
      const excl = cents(row.amountEur);
      if (excl <= 0) continue;
      const incl = Math.round(excl * (1 + rate / 100));
      advanceRows.push({ orderId: schedule.purchaseOrderId, orderNumber: numberOf.get(schedule.purchaseOrderId) ?? `Inkoop #${schedule.purchaseOrderId}`,
        rowId: row.id, label: row.label, party: nameOf(schedule.partnerCustomerId), dueDate: isoDay(row.dueDate), amountInclEur: eur(incl), vatEur: eur(incl - excl) });
    }
  }

  /* quotes */
  const customerTerms = new Map(sources.customers.map((customer) => [customer.id, customer.paymentTerms]));
  const quotes: ForecastQuote[] = [];
  const openQuotes: ForecastOpenQuote[] = [];
  for (const view of sources.salesOrders) {
    const order = view.order;
    if ((order.docType ?? 'OFFERTE') !== 'OFFERTE' || order.archivedAt) continue;
    const totalIncl = cents(view.priced?.totals?.totalInclVat);
    if (['VERZONDEN', 'BEKEKEN', 'WIJZIGING_GEVRAAGD'].includes(order.status) && totalIncl > 0 && isoDay(order.validUntil)) {
      openQuotes.push({ salesOrderId: order.id, number: order.number, party: nameOf(order.customerId), validUntil: isoDay(order.validUntil)!, valueInclEur: eur(totalIncl) });
    }
    if (order.status !== 'GEACCEPTEERD' || (order.purpose && order.purpose !== 'STANDARD')) continue;
    if (view.invoicedAsId && view.invoiceStatus !== 'CONCEPT') continue;
    const advances = (view.advanceInvoices ?? []).filter((advance) => advance.status !== 'CONCEPT' && advance.status !== 'GEANNULEERD')
      .reduce((sum, advance) => sum + cents(advance.totalInclVatEur), 0);
    const amount = totalIncl - advances;
    if (amount <= 0 || totalIncl <= 0) continue;
    const deliveries = (view.priced?.lines ?? []).map((line) => isoDay(line.deliveryDate)).filter((day): day is Iso => !!day).sort();
    const week = view.priced?.lines?.[0]?.deliveryWeek ?? order.lines?.[0]?.deliveryWeek ?? null;
    const terms = (order.paymentTerms ?? '').trim() || (customerTerms.get(order.customerId ?? -1) ?? '').trim() || null;
    quotes.push({ salesOrderId: order.id, number: order.number, party: nameOf(order.customerId), deliveryDate: deliveries.length ? deliveries[deliveries.length - 1] : null,
      deliveryWeek: week && /^\d{4}-W\d{2}$/.test(week) ? week : null, paymentTerms: terms, amountInclEur: eur(amount),
      vatEur: eur(Math.round(cents(view.priced?.totals?.vatAmount) * amount / totalIncl)) });
  }

  /* VAT returns of the previous and the current quarter as known today */
  const current = quarterOf(today);
  const previous = current.quarter === 1 ? { year: current.year - 1, quarter: 4 } : { year: current.year, quarter: current.quarter - 1 };
  const returnLines = sources.costs.map((row) => returnLineOf(row, true));
  const salesLines = salesDocLines(sources.salesOrders, nameOf);
  const vatQuarters = [previous, current].map(({ year, quarter }) => {
    const result = vatReturn(year, quarter, returnLines, salesLines, containerLines(sources.purchaseViews, lineSettings), { importVatDeferred, today });
    return { year, quarter, knownNetEur: eur(cents(result.totals.refundEur) - cents(result.totals.payableEur)) };
  });

  const outlook = vooruitblikOf({ ...sources, statements });
  return {
    today, statementsFrom: sources.statementsFrom, accounts, movements, bankLines,
    openCosts: sources.costs.filter((row) => row.id !== null && openOf(row) !== 0).map((row) => ({
      costId: row.id!, title: row.description || categoryLabel(row.category), party: row.party ?? null, date: row.date, dueDate: isoDay(row.dueDate),
      openEur: openOf(row), reference: row.reference ?? null,
    })),
    recurring: upcomingRecurring(sources.recurring, today, addMonths(today, 13)).filter((row) => row.definition.id !== null).map((row) => ({
      recurringId: row.definition.id!, name: row.definition.name, party: row.definition.party ?? null, date: row.date,
      amountInclEur: row.amountInclEur, autoPaid: !!row.definition.autoPaid, intervalLabel: intervalLabel(row.definition.interval),
    })),
    containerRows, orders, invoices, openCreditEur: receivableTotals(sources.salesOrders).creditNoteEur, advanceRows, quotes, openQuotes,
    vatQuarters, paidVatPeriods: statements.filter((line) => line.classification === 'VAT' && line.vatPeriod).map((line) => line.vatPeriod!),
    importVatDeferred, products, history, stored: sources.forecasts,
    bufferEur: sources.settings?.cashBufferEur ?? DEFAULT_CASH_BUFFER_EUR,
    outlook: { bankEur: ledger.missingReadings > 0 ? null : ledger.totalEur, expectedEur: outlook.expectedEur, netOpenEur: outlook.netOpenEur, upcoming30Eur: outlook.upcomingEur },
  };
}
