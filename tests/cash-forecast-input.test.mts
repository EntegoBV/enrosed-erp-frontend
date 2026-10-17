import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import type { BankAccount, BankStatementLine } from '../src/app/core/api/banking-api.ts';
import type {
  BankBalance, CompanyCost, Customer, IncomingPaymentRow, PartnerAdvanceSchedule, PurchaseOrderView, PurchasePaymentRow, RecurringCost,
  SalesOrderView, Supplier,
} from '../src/app/core/api/models.ts';
import type { CashForecastSources } from '../src/app/features/finance/cash-forecast-input.ts';
import { NO_DEFAULTS, buildCashForecast, horizonEndOf } from '../src/app/features/finance/cash-forecast.ts';
import { addDays, cashOutlook, cashTotalOf, openOf, upcomingRecurring } from '../src/app/features/finance/finance-metrics.ts';
import { containerPayables, payableTotals, payablesFor } from '../src/app/features/finance/payables.ts';
import { receivableTotals } from '../src/app/features/finance/incoming-money.ts';

/*
 * The input builder imports bank-reconciliation.ts, which imports
 * '../../shared/received-at' at runtime without an extension: transpile
 * both, point every other relative import at its .ts file (spec §2.1).
 */
const href = (path: string) => new URL(path, import.meta.url).href;
const transpile = (source: string) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const dataUrl = (javascript: string) => `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`;
const reconciliation = dataUrl(transpile((await readFile(new URL('../src/app/features/finance/bank-reconciliation.ts', import.meta.url), 'utf8'))
  .replace("'../../shared/received-at'", JSON.stringify(href('../src/app/shared/received-at.ts')))));
const rewrites: Record<string, string> = {
  "'./bank-reconciliation'": JSON.stringify(reconciliation),
  "'./finance-metrics'": JSON.stringify(href('../src/app/features/finance/finance-metrics.ts')),
  "'./payables'": JSON.stringify(href('../src/app/features/finance/payables.ts')),
  "'./incoming-money'": JSON.stringify(href('../src/app/features/finance/incoming-money.ts')),
  "'./vat-return'": JSON.stringify(href('../src/app/features/finance/vat-return.ts')),
  "'./cost-categories'": JSON.stringify(href('../src/app/features/finance/cost-categories.ts')),
  "'../analyses/analysis-metrics'": JSON.stringify(href('../src/app/features/analyses/analysis-metrics.ts')),
  "'./cash-forecast'": JSON.stringify(href('../src/app/features/finance/cash-forecast.ts')),
};
let inputSource = await readFile(new URL('../src/app/features/finance/cash-forecast-input.ts', import.meta.url), 'utf8');
for (const [from, to] of Object.entries(rewrites)) inputSource = inputSource.replaceAll(from, to);
const { cashForecastInput, forecastStartEur, vooruitblikOf } = await import(dataUrl(transpile(inputSource))) as typeof import('../src/app/features/finance/cash-forecast-input.ts');
const { reconciledBank } = await import(reconciliation) as typeof import('../src/app/features/finance/bank-reconciliation.ts');

/* ------------------------------------------------------------------ raw sources of Example B */

const TODAY = '2026-10-15';
const K = 'BE94731074082814';
const W = 'WISE EUR';

const bankAccounts: BankAccount[] = [
  { key: K, label: 'KBC-zichtrekening', source: 'ODOO', archived: false, aliases: [], odooJournalId: 7, manualMovementsAllowed: false },
  { key: W, label: 'Wise EUR', source: 'MANUAL', archived: false, aliases: [], odooJournalId: null, manualMovementsAllowed: true, countsInCash: false },
];
const balances: BankBalance[] = [
  { id: 1, account: K, date: '2026-10-10', balanceEur: 40000, asOfAt: '2026-10-10T21:59:59.999Z', timeZone: 'Europe/Brussels', notes: null },
  { id: 2, account: W, date: '2026-10-01', balanceEur: 5000, asOfAt: '2026-10-01T08:00:00Z', timeZone: 'Europe/Brussels', notes: null },
];
const statement = (id: number, account: string, amountEur: number, bookedAt: string, counterparty: string, reference: string,
  extra: Partial<BankStatementLine> = {}): BankStatementLine => ({
  id, account, fingerprint: `f${id}`, amountEur, bookedAt, timeZone: 'Europe/Brussels', reference, counterparty, recordedAt: bookedAt, actor: 'odoo',
  salesPaymentId: null, salesOrderId: null, allocatedAt: null, allocationCreatedPayment: false, source: account === K ? 'ODOO' : null,
  allocated: true, ...extra,
});
const statements: BankStatementLine[] = [
  statement(201, W, -200, '2026-09-28T10:00:00Z', 'Alibaba.com', 'samples'),
  statement(202, W, 300, '2026-10-05T09:00:00Z', 'Topup', 'Topup', { allocated: false }),
  statement(101, K, -1500, '2026-10-07T22:00:00Z', 'Securex', 'Factuur september'),
  statement(102, K, 2000, '2026-10-08T22:00:00Z', 'Bloomstore GmbH', 'RE F2026-0376', { salesPaymentId: 501, salesOrderId: 376, allocatedAmountEur: 2000 }),
  statement(103, K, -9000, '2026-10-12T22:00:00Z', 'Yunnan Pubei Flowers Co., Ltd', 'PO-2026-043 DEPOSIT 30PCT', { allocated: false }),
  statement(104, K, 1452, '2026-10-13T22:00:00Z', 'Bloemenatelier Lies BV', '+++412/0412/66087+++', { salesPaymentId: 502, salesOrderId: 377, allocatedAmountEur: 1452 }),
  statement(105, K, -86.73, '2026-10-13T22:00:00Z', 'Proximus', 'Domiciliëring 6201554718'),
];
const receipt = (id: number, salesOrderId: number, amountEur: number, receivedAt: string, bankAccount: string | null): IncomingPaymentRow => ({
  id, salesOrderId, amountEur, receivedAt, timeZone: 'Europe/Brussels', reference: null, recordedAt: receivedAt, actor: null, bankAccount,
  orderNumber: `F${salesOrderId}`, customerId: 1, purchaseOrderId: null, purpose: 'STANDARD', legacy: false,
});
const incomingPayments: IncomingPaymentRow[] = [receipt(501, 376, 2000, '2026-10-08T22:00:00Z', K), receipt(502, 377, 1452, '2026-10-13T22:00:00Z', K)];

function cost(id: number, date: string, description: string, party: string, amount: number, extra: Partial<CompanyCost> = {}): CompanyCost {
  return { id, date, category: 'ANDERE', description, party, amountExclEur: amount, vatPct: 0, reference: null, paidOn: null, salesChannel: null, notes: null,
    amountInclEur: null, vatRegime: 'EXEMPT', vatRegimeConfirmed: true, supplierCountry: 'BE', costKind: 'SERVICES', expenseType: 'STANDARD',
    vatDeductiblePct: 100, taxDeductiblePct: 100, depreciationYears: null, depreciationStart: null, payments: [], paidEur: 0, openEur: amount,
    cashTotalEur: amount, ...extra };
}
const paid = (id: number, amount: number, lineId: number | null) => ({ id, paidOn: '2026-10-08', amountEur: amount, account: K, bankStatementLineId: lineId, note: null });
const costs: CompanyCost[] = [
  cost(11, '2026-10-08', 'Boekhouder Q3', 'Fiduciaire Peeters', 665.5, { category: 'BOEKHOUDER' }),
  cost(12, '2026-10-13', 'Brochures beurs', 'Vandersanden Drukwerk', 423.5, { dueDate: '2026-11-05', reference: 'VD-2026-118' }),
  cost(90, '2026-10-08', 'Sociaal secretariaat', 'Securex', 1500, { paidOn: '2026-10-08', paidEur: 1500, openEur: 0, payments: [paid(1, 1500, 101)] }),
  cost(91, '2026-10-14', 'Proximus september', 'Proximus', 86.73, { paidOn: '2026-10-14', paidEur: 86.73, openEur: 0, bankStatementLineId: 105 }),
  cost(92, '2026-09-28', 'Stalen', 'Alibaba.com', 200, { paidOn: '2026-09-28', paidEur: 200, openEur: 0, payments: [paid(2, 200, 201)] }),
];
const recurringDefinition = (id: number, name: string, party: string, excl: number, startDate: string, autoPaid: boolean): RecurringCost => ({
  id, name, category: 'HUUR', party, amountExclEur: excl, vatPct: 21, salesChannel: null, interval: 'MONTHLY', startDate, endDate: null, nextDate: startDate,
  active: true, autoPaid, reference: null, notes: null, vatRegime: 'BE', vatRegimeConfirmed: true, supplierCountry: 'BE', costKind: 'SERVICES',
  expenseType: 'STANDARD', vatDeductiblePct: 100, taxDeductiblePct: 100,
});
const recurring: RecurringCost[] = [
  recurringDefinition(3, 'Huur loods Wilrijk', 'Immo Wilrijk', 1200, '2026-11-01', false),
  recurringDefinition(4, 'Proximus', 'Proximus', 71.68, '2026-11-14', true),
];

const suppliers = [
  { id: 1, name: 'Yunnan Pubei Flowers Co., Ltd', leadTimeDays: 35 },
  { id: 2, name: 'Ningbo Florals', leadTimeDays: 0 },
  { id: 3, name: 'Xiamen Boxes', leadTimeDays: 40 },
] as Supplier[];

function purchase(id: number, number: string, status: PurchaseOrderView['order']['status'], extra: Partial<PurchaseOrderView['order']>,
  reconciliation: PurchaseOrderView['reconciliation'], customsValueEur = 0): PurchaseOrderView {
  return { order: { id, number, alias: null, supplierId: 1, orderDate: '2026-10-10', status, destinationPort: 'Antwerp', clearance: 'BE_CUSTOMS', lines: [], ...extra },
    costing: { lines: [], totals: { customsValueEur, dutyEur: 0, goodsEur: 0, goodsUsd: 0 } }, reconciliation } as unknown as PurchaseOrderView;
}
const stream = (payee: string, remainingEur: number, paidEur = 0) => ({ payee, label: payee, status: remainingEur > 0 ? 'UNPAID' : 'PAID', plannedEur: remainingEur + paidEur,
  paidEur, remainingEur, forecastEur: remainingEur + paidEur, varianceEur: 0, overpaidEur: 0, settledSavingEur: 0, explicitlySettled: false, finalized: false, paymentCount: 0 });
const term = (due: string, label: string, remainingEur: number, paidEur = 0) => ({ due, label, plannedEur: remainingEur + paidEur, paidEur, remainingEur, settledSavingEur: 0,
  overpaidEur: 0, explicitlySettled: false, finalized: false });
const totals = (paidEur: number, remainingEur: number, internalMarkupEur: number, external = 0, pricing = 0) => ({ paidEur, remainingEur, internalMarkupEur,
  forecastExternalEur: external, forecastPricingEur: pricing });
const recon = (streams: unknown[], terms: unknown[], sums: unknown, lines: unknown[] = []) => ({ streams, supplierInstalments: terms, totals: sums, lines, notes: [] }) as unknown as PurchaseOrderView['reconciliation'];

const po43 = () => purchase(43, 'PO-2026-043', 'BESTELD', { expectedArrival: '2027-01-08' },
  recon([stream('SUPPLIER', 30000), stream('LOGISTICS', 6400), stream('SEPARATE', 600)],
    [term('ORDERED', '30% bij bestelling', 9000), term('SHIPPED', '70% bij vertrek', 21000)], totals(0, 37000, 2500, 37000, 39500)), 34000);
const po41 = () => purchase(41, 'PO-2026-041', 'ONDERWEG', { supplierId: 2, orderDate: '2026-08-20', shippedOn: '2026-10-02', expectedArrival: '2026-11-18',
  clearance: 'NL_FISCAL_REP_TO_BE', destinationPort: 'Rotterdam' },
  recon([stream('SUPPLIER', 8690, 20000), stream('LOGISTICS', 2318.4)], [term('ORDERED', '30% bij bestelling', 0, 20000), term('ARRIVED', 'Saldo bij aankomst', 8690)],
    totals(20000, 11008.4, 900), []), 15000);
const po44 = () => purchase(44, 'PO-2026-044', 'BESTELD', { supplierId: 2, partnerCustomerId: 5, expectedArrival: '2027-02-01' }, null);
const po30 = () => purchase(30, 'PO-2026-030', 'ONTVANGEN', { supplierId: 3, orderDate: '2026-05-01', shippedOn: '2026-07-03', receivedOn: '2026-08-10',
  clearance: 'NL_FISCAL_REP_SOLD_IN_NL', destinationPort: 'Rotterdam' }, recon([], [], totals(30000, 0, 1000, 30000, 32000)));

const customers = [
  { id: 1, company: 'Bloemen Maes', paymentTerms: '30 dagen' },
  { id: 2, company: 'Maison Vert', paymentTerms: '30 dagen' },
  { id: 3, company: 'Bloemen Lotus', paymentTerms: '30 dagen' },
  { id: 5, company: 'Kwekerij Van Gils', paymentTerms: '' },
  { id: 6, company: 'Fleur de Paris', paymentTerms: 'Vooruitbetaling' },
] as Customer[];

interface SalesFixture { id: number; number: string; customerId: number; orderDate: string; total: number; vat?: number; rate?: number; docType?: 'FACTUUR' | 'CREDITNOTA' | 'OFFERTE';
  status?: string; due?: string | null; paid?: number; paidAt?: string | null; summaryStatus?: string; purpose?: string | null; partnerPurchaseOrderId?: number | null;
  extra?: Record<string, unknown>; view?: Record<string, unknown>; }
function sale(f: SalesFixture): SalesOrderView {
  const vat = f.vat ?? 0;
  const paidEur = f.paid ?? 0;
  const status = f.summaryStatus ?? (paidEur >= f.total ? 'PAID' : paidEur > 0 ? 'PARTIAL' : 'UNPAID');
  const receipts = f.paidAt ? [{ id: f.id * 10, salesOrderId: f.id, amountEur: paidEur, receivedAt: f.paidAt, timeZone: 'Europe/Brussels', reference: null, recordedAt: f.paidAt, actor: null }] : [];
  return {
    order: { id: f.id, number: f.number, customerId: f.customerId, orderDate: f.orderDate, docType: f.docType ?? 'FACTUUR', status: f.status ?? 'VERZONDEN',
      invoiceDueDate: f.due ?? null, paidAt: null, purpose: f.purpose ?? null, partnerPurchaseOrderId: f.partnerPurchaseOrderId ?? null, paymentTerms: null,
      validUntil: '2026-11-30', decidedAt: null, archivedAt: null, lines: [], ...f.extra },
    priced: { lines: [], totals: { total: f.total - vat, vatAmount: vat, totalInclVat: f.total, vatRatePct: f.rate ?? (vat ? 21 : 0), vatTreatment: vat ? 'BINNENLAND' : 'INTRACOMMUNAUTAIR',
      costTotal: 0, marginEur: 0, pieces: 0 } },
    paymentSummary: f.docType === 'OFFERTE' ? null : { invoiceTotalEur: f.total, receivedEur: paidEur, remainingEur: Math.max(0, f.total - paidEur), overpaidEur: 0,
      creditEur: f.total < 0 ? -f.total : 0, status, payments: receipts, instalments: [], legacyPaidMarker: false },
    accounting: { recognizedRevenueEur: f.total - vat, recognizedCostEur: (f.total - vat) * 0.6, recognizedProfitEur: 0, recognizedQuantity: 0 },
    ...f.view,
  } as unknown as SalesOrderView;
}
const salesOrders = (): SalesOrderView[] => [
  sale({ id: 300, number: 'F2026-0300', customerId: 1, orderDate: '2026-04-20', due: '2026-05-20', total: 2000 }),
  sale({ id: 405, number: 'F2026-0405', customerId: 2, orderDate: '2026-09-02', due: '2026-10-02', total: 1906 }),
  sale({ id: 420, number: 'F2026-0420', customerId: 3, orderDate: '2026-09-21', due: '2026-10-21', total: 4235 }),
  sale({ id: 521, number: 'VF2026-0021', customerId: 5, orderDate: '2026-10-06', due: '2026-11-05', total: 6050, vat: 1050, purpose: 'PARTNER_ADVANCE', partnerPurchaseOrderId: 44 }),
  /* Maison Vert pays 10 and 18 days late: 14 on average. */
  sale({ id: 401, number: 'F2026-0401', customerId: 2, orderDate: '2026-05-02', due: '2026-06-01', total: 800, paid: 800, paidAt: '2026-06-11T09:00:00Z' }),
  sale({ id: 402, number: 'F2026-0402', customerId: 2, orderDate: '2026-06-01', due: '2026-07-01', total: 900, paid: 900, paidAt: '2026-07-19T09:00:00Z' }),
  /* The VAT the two returns know today. */
  sale({ id: 380, number: 'F2026-0380', customerId: 1, orderDate: '2026-08-10', due: '2026-09-09', total: 42706.95, vat: 7412, paid: 42706.95, paidAt: '2026-08-20T09:00:00Z' }),
  sale({ id: 410, number: 'F2026-0410', customerId: 3, orderDate: '2026-10-02', due: '2026-11-01', total: 6535.73, vat: 1134.3, paid: 6535.73, paidAt: '2026-10-09T09:00:00Z' }),
  sale({ id: 610, number: 'CN-2026-0010', customerId: 3, orderDate: '2026-10-01', total: -640, docType: 'CREDITNOTA', summaryStatus: 'CREDIT' }),
  sale({ id: 390, number: 'OF2026-0390', customerId: 6, orderDate: '2026-10-01', total: 3267, vat: 567, docType: 'OFFERTE', status: 'GEACCEPTEERD',
    extra: { paymentTerms: '30 dagen netto', lines: [{ deliveryWeek: '2026-W47' }] } }),
];
const advanceSchedules: PartnerAdvanceSchedule[] = [{ purchaseOrderId: 44, partnerCustomerId: 5, agreedAmountEur: 15000, financingPct: 50, externalCostEur: 30000,
  allocatedEur: 15000, unallocatedEur: 0, reservedOutsideScheduleEur: 0, rows: [
    { id: 6, label: '1e voorschot', percentage: null, amountEur: 5000, dueDate: '2026-11-05', invoiceId: 521, invoiceNumber: 'VF2026-0021', invoiceStatus: 'VERZONDEN', receivedEur: 0, remainingEur: 6050 },
    { id: 7, label: '2e voorschot', percentage: null, amountEur: 10000, dueDate: '2026-12-01', invoiceId: null, invoiceNumber: null, invoiceStatus: null, receivedEur: 0, remainingEur: 0 },
  ] }];
const purchasePayments: PurchasePaymentRow[] = [{ id: 70, orderId: 41, orderNumber: 'PO-2026-041', orderAlias: null, paidOn: '2026-08-25', amountEur: 20000, label: '30% bij bestelling',
  payee: null, bankStatementLineId: 990 }];

function sources(extra: Partial<CashForecastSources> = {}): CashForecastSources {
  return {
    today: TODAY, bankAccounts, balances, statements, incomingPayments, costs, recurring,
    purchaseViews: [po43(), po41(), po44(), po30()], purchasePayments, suppliers, salesOrders: salesOrders(), customers, advanceSchedules,
    company: { importVatDeferred: false, fiscalRepresentativeName: 'Fisc NL' } as CashForecastSources['company'], forecasts: [], settings: null,
    products: null, statementsFrom: null, ...extra,
  };
}

/* ------------------------------------------------------------------ tests */

test('raw sources of Example B give Example B: the bank, the outlook and the forecast end', () => {
  const input = cashForecastInput(sources());
  const k = input.accounts.find((account) => account.key === K)!;
  const w = input.accounts.find((account) => account.key === W)!;
  assert.deepEqual([k.currentEur, k.countsInCash, k.labelOnly, k.latestReading], [32365.27, true, false, { atMs: Date.parse('2026-10-10T21:59:59.999Z'), balanceEur: 40000 }]);
  assert.deepEqual([w.currentEur, w.countsInCash, w.source, w.firstReadingAtMs], [5300, false, 'MANUAL', Date.parse('2026-10-01T08:00:00Z')]);
  assert.deepEqual(input.movements.map((row) => [row.key, row.day]).sort(), [
    ['bank:101', '2026-10-08'], ['bank:102', '2026-10-09'], ['bank:103', '2026-10-13'], ['bank:104', '2026-10-14'], ['bank:105', '2026-10-14'],
    ['bank:201', '2026-09-28'], ['bank:202', '2026-10-05']]);
  assert.deepEqual(input.outlook, { bankEur: 37665.27, expectedEur: 580.14, netOpenEur: -37085.13, upcoming30Eur: 1538.73 });
  const forecast = buildCashForecast(input, { horizonEnd: horizonEndOf(TODAY, 6), scenario: false, includeStock: false, rulesOff: [], openQuotesOn: false,
    defaults: NO_DEFAULTS, dismissed: [], pastDays: 42 });
  assert.equal(forecast.startEur, 32365.27);
  assert.equal(forecast.endBaseEur, -7449.81);
  assert.deepEqual(forecast.likelyPaid.map((match) => [match.lineId, match.itemKey, match.reason]), [[103, 'container:43:SUPPLIER:ORDERED', 'reference']]);
  assert.equal(forecast.reconciliation.startEur, 580.14);
  assert.equal(forecast.reconciliation.matches, true);
  assert.equal(forecast.months.find((row) => row.label === '1–15 okt')!.costsEur, -10586.73);
});

test('raw sources of Example B: delays, transit, advance VAT, quote VAT, VAT quarters', () => {
  const input = cashForecastInput(sources());
  assert.deepEqual(input.invoices.map((row) => [row.salesOrderId, row.party, row.dueDate, row.remainingEur, row.delayDays, row.partner, row.advance]), [
    [300, 'Bloemen Maes', '2026-05-20', 2000, 0, false, false],
    [405, 'Maison Vert', '2026-10-02', 1906, 14, false, false],
    [420, 'Bloemen Lotus', '2026-10-21', 4235, 0, false, false],
    [521, 'Kwekerij Van Gils', '2026-11-05', 6050, 0, true, true],
  ]);
  assert.equal(input.openCreditEur, 640);
  const order43 = input.orders.find((order) => order.orderId === 43)!;
  assert.deepEqual([order43.transitDays, order43.leadTimeDays, order43.importVatEur, order43.importVatCovered, order43.clearance, order43.clearanceConfirmed,
    order43.remainingEur, order43.internalMarkupEur, order43.supplierName], [38, 35, 7140, false, 'BE_CUSTOMS', true, 37000, 2500, 'Yunnan Pubei Flowers Co., Ltd']);
  assert.equal(input.orders.find((order) => order.orderId === 41)!.leadTimeDays, 35);
  assert.deepEqual(input.containerRows.map((row) => [row.key, row.termLabel, row.remainingEur, row.concept]), [
    ['container:41:SUPPLIER:ARRIVED', 'Saldo bij aankomst', 8690, false],
    ['container:41:LOGISTICS', null, 2318.4, false],
    ['container:43:SUPPLIER:ORDERED', '30% bij bestelling', 9000, false],
    ['container:43:SUPPLIER:SHIPPED', '70% bij vertrek', 21000, false],
    ['container:43:LOGISTICS', null, 6400, false],
    ['container:43:SEPARATE', null, 600, false],
  ]);
  assert.deepEqual(input.advanceRows, [{ orderId: 44, orderNumber: 'PO-2026-044', rowId: 7, label: '2e voorschot', party: 'Kwekerij Van Gils', dueDate: '2026-12-01',
    amountInclEur: 12100, vatEur: 2100 }]);
  assert.deepEqual(input.quotes, [{ salesOrderId: 390, number: 'OF2026-0390', party: 'Fleur de Paris', deliveryDate: null, deliveryWeek: '2026-W47',
    paymentTerms: '30 dagen netto', amountInclEur: 3267, vatEur: 567 }]);
  assert.deepEqual(input.vatQuarters, [{ year: 2026, quarter: 3, knownNetEur: -7412 }, { year: 2026, quarter: 4, knownNetEur: -2184.3 }]);
  assert.equal(input.recurring.length, 26);
  assert.deepEqual(input.recurring[0], { recurringId: 3, name: 'Huur loods Wilrijk', party: 'Immo Wilrijk', date: '2026-11-01', amountInclEur: 1452, autoPaid: false, intervalLabel: 'Maandelijks' });
  assert.deepEqual(input.openCosts.map((row) => [row.costId, row.title, row.dueDate, row.openEur]), [[11, 'Boekhouder Q3', null, 665.5], [12, 'Brochures beurs', '2026-11-05', 423.5]]);
  assert.equal(input.bufferEur, 10000);
  assert.equal(cashForecastInput(sources({ settings: { cashBufferEur: 12500, cashBufferStored: true } })).bufferEur, 12500);
  /* The history over the last year: payment days, VAT on sales. */
  assert.equal(input.history.paymentDays, 26);
  assert.equal(input.history.openQuoteConversionPct, 0);
});

test('vooruitblikOf equals cashOutlook fed like FinanceState', () => {
  const raw = sources();
  const ledger = reconciledBank(raw.balances, raw.statements, raw.incomingPayments, raw.bankAccounts);
  const openCosts = raw.costs.filter((row) => openOf(row) !== 0).map((row) => ({ ...row, openEur: openOf(row), cashTotalEur: cashTotalOf(row) }));
  const upcoming = upcomingRecurring(raw.recurring, TODAY, addDays(TODAY, 30));
  const invoices = receivableTotals(raw.salesOrders);
  const payable = payableTotals(payablesFor({ openCosts, upcoming30: upcoming, containerRows: containerPayables(raw.purchaseViews), today: TODAY }));
  const expected = cashOutlook(ledger.totalEur, Math.round(openCosts.reduce((sum, row) => sum + row.openEur, 0) * 100) / 100,
    Math.round(upcoming.reduce((sum, row) => sum + row.amountInclEur, 0) * 100) / 100, invoices.totalEur, payable.containerNowEur, payable.containerLaterEur, invoices.creditNoteEur);
  assert.deepEqual(vooruitblikOf(raw), expected);
  assert.equal(expected.expectedEur, 580.14);
});

test('bank line parts: payments, receipts, legacy cost links, refunds and transfers to a non-counted account', () => {
  const refund = statement(107, K, 50, '2026-10-14T08:00:00Z', 'Securex', 'Terugbetaling', { allocated: true });
  const transfer = statement(108, K, -1000, '2026-10-14T09:00:00Z', 'Wise', 'Naar Wise', { classification: 'INTERNAL_TRANSFER', transferLineId: 203 });
  const otherLeg = statement(203, W, 1000, '2026-10-14T09:30:00Z', 'KBC', 'Van KBC', { classification: 'INTERNAL_TRANSFER', transferLineId: 108 });
  const vatPaid = statement(109, K, -500, '2026-10-14T10:00:00Z', 'FOD Financiën', 'Btw Q3', { classification: 'VAT', vatPeriod: '2026-Q3' });
  const refunded = cost(93, '2026-10-14', 'Teveel betaald', 'Securex', -50, { payments: [{ ...paid(3, -50, 107), paidOn: '2026-10-14' }], openEur: 0, paidEur: -50 });
  const containerPaid = statement(110, K, -700, '2026-10-14T11:00:00Z', 'Ningbo Florals', 'PO-2026-041');
  const input = cashForecastInput(sources({ statements: [...statements, refund, transfer, otherLeg, vatPaid, containerPaid], costs: [...costs, refunded],
    purchasePayments: [...purchasePayments, { id: 71, orderId: 41, orderNumber: 'PO-2026-041', orderAlias: null, paidOn: '2026-10-14', amountEur: 700, label: null, payee: null, bankStatementLineId: 110 }] }));
  const parts = (id: number) => input.bankLines.find((line) => line.id === id)!.parts;
  assert.deepEqual(parts(101), [{ kind: 'COSTS', amountEur: -1500 }]);
  assert.deepEqual(parts(102), [{ kind: 'CUSTOMERS', amountEur: 2000 }]);
  assert.deepEqual(parts(103), [{ kind: 'COSTS', amountEur: -9000 }]);
  assert.deepEqual(parts(105), [{ kind: 'COSTS', amountEur: -86.73 }]);
  assert.deepEqual(parts(107), [{ kind: 'COSTS', amountEur: 50 }]);
  assert.deepEqual(parts(108), [{ kind: 'OTHER', amountEur: -1000 }]);
  assert.deepEqual(parts(109), [{ kind: 'VAT', amountEur: -500 }]);
  assert.deepEqual(parts(110), [{ kind: 'CONTAINERS', amountEur: -700 }]);
  assert.deepEqual(input.paidVatPeriods, ['2026-Q3']);
  assert.equal(input.bankLines.find((line) => line.id === 103)!.accountLabel, 'KBC-zichtrekening');
  /* A transfer between two counted accounts is internal. */
  const counted = cashForecastInput(sources({ statements: [...statements, transfer, otherLeg], bankAccounts: [bankAccounts[0], { ...bankAccounts[1], countsInCash: true }] }));
  assert.deepEqual(counted.bankLines.find((line) => line.id === 108)!.parts, [{ kind: 'INTERNAL', amountEur: -1000 }]);
  /* payee null reads as the supplier; a line that is not loaded has no account label. */
  const payment = input.orders.find((order) => order.orderId === 41)!.payments;
  assert.deepEqual(payment.map((row) => [row.id, row.payee, row.lineId, row.accountLabel]), [[70, 'SUPPLIER', 990, null], [71, 'SUPPLIER', 110, 'KBC-zichtrekening']]);
});

test('statementsFrom drops older movements but keeps older lines for the likely-paid check', () => {
  const old = statement(100, K, -650, '2026-08-20T10:00:00Z', 'Fiduciaire Peeters', 'Q2', { allocated: false });
  const input = cashForecastInput(sources({ statements: [...statements, old], statementsFrom: '2026-10-01' }));
  assert.equal(input.statementsFrom, '2026-10-01');
  assert.equal(input.movements.some((row) => row.key === 'bank:201' || row.key === 'bank:100'), false);
  assert.equal(input.movements.some((row) => row.key === 'bank:202'), true);
  assert.equal(input.bankLines.some((line) => line.id === 100), true);
  assert.equal(input.bankLines.some((line) => line.id === 201), true);
});

test('an archived order keeps its open rows; a concept takes its import VAT from the Besteld mapping', () => {
  const archived = { ...po43(), order: { ...po43().order, archivedAt: '2026-10-14T10:00:00Z' } } as PurchaseOrderView;
  const concept = purchase(45, 'PO-2026-045', 'CONCEPT', { orderDate: '2026-10-20' },
    recon([stream('SUPPLIER', 20000)], [term('ORDERED', '30% bij bestelling', 6000), term('SHIPPED', '70% bij vertrek', 14000)], totals(0, 20000, 500)), 10000);
  const input = cashForecastInput(sources({ purchaseViews: [archived, po41(), po44(), po30(), concept] }));
  assert.equal(input.orders.find((order) => order.orderId === 43)!.archived, true);
  assert.ok(input.containerRows.some((row) => row.key === 'container:43:SUPPLIER:SHIPPED' && !row.concept));
  const conceptOrder = input.orders.find((order) => order.orderId === 45)!;
  assert.equal(conceptOrder.importVatEur, 2100);
  assert.deepEqual(input.containerRows.filter((row) => row.orderId === 45).map((row) => [row.key, row.remainingEur, row.concept]),
    [['container:45:SUPPLIER:ORDERED', 6000, true], ['container:45:SUPPLIER:SHIPPED', 14000, true]]);
  /* An archived concept is no scenario row. */
  const archivedConcept = { ...concept, order: { ...concept.order, archivedAt: '2026-10-14T10:00:00Z' } } as PurchaseOrderView;
  assert.equal(cashForecastInput(sources({ purchaseViews: [po43(), archivedConcept] })).containerRows.some((row) => row.orderId === 45), false);
});

test('import VAT already booked as a customs cost covers the order: by order number or by amount', () => {
  const byNumber = cost(95, '2027-01-06', 'Invoer-btw PO-2026-043', 'Douane', 0, { vatRegime: 'IMPORT_VAT_PAID', amountInclEur: 7000, openEur: 7000, cashTotalEur: 7000 });
  assert.equal(cashForecastInput(sources({ costs: [...costs, byNumber] })).orders.find((order) => order.orderId === 43)!.importVatCovered, true);
  const byAmount = cost(96, '2026-12-20', 'Invoer-btw', 'Douane', 0, { vatRegime: 'IMPORT_VAT_PAID', amountInclEur: 7140.02, openEur: 0, paidEur: 7140.02 });
  assert.equal(cashForecastInput(sources({ costs: [...costs, byAmount] })).orders.find((order) => order.orderId === 43)!.importVatCovered, true);
  const tooEarly = { ...byNumber, date: '2026-11-20' };
  assert.equal(cashForecastInput(sources({ costs: [...costs, tooEarly] })).orders.find((order) => order.orderId === 43)!.importVatCovered, false);
});

test('transit days: the supplier\'s own received containers first, else everyone\'s, else 38', () => {
  const own = purchase(31, 'PO-2026-031', 'ONTVANGEN', { orderDate: '2026-04-01', shippedOn: '2026-06-01', receivedOn: '2026-07-01' }, recon([], [], totals(1, 0, 0)));
  assert.equal(cashForecastInput(sources({ purchaseViews: [po43(), po41(), po30(), own] })).orders.find((order) => order.orderId === 43)!.transitDays, 30);
  assert.equal(cashForecastInput(sources({ purchaseViews: [po43(), po41()] })).orders.find((order) => order.orderId === 43)!.transitDays, 38);
});

test('quotes: advances issued are subtracted (VAT pro rata), concepts not; a concept invoice keeps the quote; a bare week number counts as none', () => {
  const base = salesOrders();
  const withAdvance = sale({ id: 391, number: 'OF2026-0391', customerId: 6, orderDate: '2026-10-01', total: 3267, vat: 567, docType: 'OFFERTE', status: 'GEACCEPTEERD',
    extra: { lines: [{ deliveryWeek: '47' }] }, view: { advanceInvoices: [{ status: 'VERZONDEN', totalInclVatEur: 1089 }, { status: 'CONCEPT', totalInclVatEur: 500 }] } });
  const invoicedConcept = sale({ id: 392, number: 'OF2026-0392', customerId: 6, orderDate: '2026-10-01', total: 1210, vat: 210, docType: 'OFFERTE', status: 'GEACCEPTEERD',
    view: { invoicedAsId: 700, invoiceStatus: 'CONCEPT' } });
  const invoiced = sale({ id: 393, number: 'OF2026-0393', customerId: 6, orderDate: '2026-10-01', total: 1210, vat: 210, docType: 'OFFERTE', status: 'GEACCEPTEERD',
    view: { invoicedAsId: 701, invoiceStatus: 'VERZONDEN' } });
  const quotes = cashForecastInput(sources({ salesOrders: [...base, withAdvance, invoicedConcept, invoiced] })).quotes;
  const quote391 = quotes.find((quote) => quote.salesOrderId === 391)!;
  assert.deepEqual([quote391.amountInclEur, quote391.vatEur, quote391.deliveryWeek, quote391.paymentTerms], [2178, 378, null, 'Vooruitbetaling']);
  assert.ok(quotes.some((quote) => quote.salesOrderId === 392));
  assert.equal(quotes.some((quote) => quote.salesOrderId === 393), false);
});

test('advance rows: a concept invoice is still a row to invoice; none after a settlement invoice', () => {
  const schedule = { ...advanceSchedules[0], rows: [...advanceSchedules[0].rows, { id: 8, label: '3e voorschot', percentage: null, amountEur: 1000, dueDate: null,
    invoiceId: 530, invoiceNumber: null, invoiceStatus: 'CONCEPT', receivedEur: 0, remainingEur: 0 }] } as PartnerAdvanceSchedule;
  const rows = cashForecastInput(sources({ advanceSchedules: [schedule] })).advanceRows;
  assert.deepEqual(rows.map((row) => [row.rowId, row.amountInclEur, row.vatEur, row.dueDate]), [[7, 12100, 2100, '2026-12-01'], [8, 1210, 210, null]]);
  const settlement = sale({ id: 540, number: 'PF2026-0040', customerId: 5, orderDate: '2026-10-10', total: 2000, purpose: 'PARTNER_SETTLEMENT', partnerPurchaseOrderId: 44 });
  assert.deepEqual(cashForecastInput(sources({ advanceSchedules: [schedule], salesOrders: [...salesOrders(), settlement] })).advanceRows, []);
});

test('an overpaid invoice counts as paid for the customer\'s delay', () => {
  const overpaid = sale({ id: 403, number: 'F2026-0403', customerId: 3, orderDate: '2026-06-01', due: '2026-07-01', total: 500, paid: 520, summaryStatus: 'OVERPAID', paidAt: '2026-07-21T09:00:00Z' });
  const second = sale({ id: 404, number: 'F2026-0404', customerId: 3, orderDate: '2026-07-01', due: '2026-08-01', total: 500, paid: 500, paidAt: '2026-08-11T09:00:00Z' });
  const input = cashForecastInput(sources({ salesOrders: [...salesOrders(), overpaid, second] }));
  /* Bloemen Lotus: 20 and 10 days late, plus the paid VAT invoice 410 (paid before its due date: 0) → 10. */
  assert.equal(input.invoices.find((row) => row.salesOrderId === 420)!.delayDays, 10);
});

test('an account known only from a receipt label is label-only and leaves the forecast absolute', () => {
  const stray = receipt(503, 378, 250, '2026-10-09T10:00:00Z', 'KBC Zakelijk');
  const input = cashForecastInput(sources({ incomingPayments: [...incomingPayments, stray] }));
  const label = input.accounts.find((account) => account.label === 'KBC Zakelijk')!;
  assert.equal(label.labelOnly, true);
  assert.equal(label.currentEur, null);
  assert.ok(input.movements.some((row) => row.key === 'payment:503'));
  assert.equal(input.outlook.bankEur, null);
  const forecast = buildCashForecast(input, { horizonEnd: horizonEndOf(TODAY, 6), scenario: false, includeStock: false, rulesOff: [], openQuotesOn: false,
    defaults: NO_DEFAULTS, dismissed: [], pastDays: 42 });
  assert.equal(forecast.mode, 'absolute');
  assert.equal(forecast.startEur, 32365.27);
  assert.equal(forecast.reconciliation.matches, true);
});

test('forecastStartEur: the forecast\'s own start, without building it (the home\'s Op de bank while it computes)', () => {
  const options = { horizonEnd: horizonEndOf(TODAY, 6), scenario: false, includeStock: false, rulesOff: [] as never[], openQuotesOn: false,
    defaults: NO_DEFAULTS, dismissed: [], pastDays: 42 };
  /* Wise EUR does not count in cash: the Vooruitblik's bank has it, the forecast's start does not. */
  const raw = sources();
  assert.equal(vooruitblikOf(raw).bankEur, 37665.27);
  assert.equal(forecastStartEur(raw), 32365.27);
  assert.equal(forecastStartEur(raw), buildCashForecast(cashForecastInput(raw), options).startEur);
  /* A label-only account (known from a receipt) is not counted and keeps the start absolute. */
  const labelled = sources({ incomingPayments: [...incomingPayments, receipt(503, 378, 250, '2026-10-09T10:00:00Z', 'KBC Zakelijk')] });
  assert.equal(forecastStartEur(labelled), buildCashForecast(cashForecastInput(labelled), options).startEur);
  /* A counted account with lines but no reading makes the forecast relative: no start then. */
  const unread = sources({ statements: [...statements, statement(301, 'ING ZICHT', -100, '2026-10-12T10:00:00Z', 'Iemand', 'x', { source: null })] });
  assert.equal(buildCashForecast(cashForecastInput(unread), options).mode, 'relative');
  assert.equal(forecastStartEur(unread), null);
  /* Every account counting in cash: the start is the reconciled total. */
  const all = sources({ bankAccounts: bankAccounts.map((account) => ({ ...account, countsInCash: true })) });
  assert.equal(forecastStartEur(all), 37665.27);
  assert.equal(forecastStartEur(all), buildCashForecast(cashForecastInput(all), options).startEur);
});
