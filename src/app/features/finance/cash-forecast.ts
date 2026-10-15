import type { BankClassification } from '../../core/api/banking-api';
import type { CostBasis, PriceMode, PurchaseOrderForecast } from '../../core/api/models';

/*
 * The cash forecast of Kosten & bank (Kaslijn) and Analyses (Kasprognose):
 * the bank as it stands, every expected payment and receipt on its day, an
 * optional sales scenario per container, and the reconciliation with the
 * Vooruitblik. One pure module feeds both pages (spec-bank-forecast §2);
 * cash-forecast-input.ts builds its input from the API data.
 *
 * Node-tested on its own: only `import type` from other src files, every
 * helper it needs is a local copy. Money is integer cents inside and euros
 * (two decimals) on every value it hands out.
 */

/* ================================================================== types */

export type Iso = string;   // 'YYYY-MM-DD'
export type ForecastCertainty = 'FIXED' | 'EXPECTED' | 'ESTIMATED' | 'SCENARIO';
export const CERTAINTY_LABEL: Record<ForecastCertainty, string> = { FIXED: 'Vast', EXPECTED: 'Verwacht', ESTIMATED: 'Geschat', SCENARIO: 'Scenario' };
export type ForecastKind = 'CUSTOMER' | 'PARTNER' | 'QUOTE' | 'OPEN_QUOTE' | 'CREDIT' | 'SUPPLIER' | 'LOGISTICS'
  | 'INSPECTION' | 'OTHER_CONTAINER' | 'IMPORT_VAT' | 'COST' | 'RECURRING' | 'VAT' | 'SALES';
export const KIND_LABEL: Record<ForecastKind, string> = { CUSTOMER: 'Klant', PARTNER: 'Partner', QUOTE: 'Offerte',
  OPEN_QUOTE: 'Open offerte', CREDIT: 'Tegoed', SUPPLIER: 'Leverancier', LOGISTICS: 'Douane & transport',
  INSPECTION: 'Inspectie', OTHER_CONTAINER: 'Bijkomend', IMPORT_VAT: 'Btw bij invoer', COST: 'Kost',
  RECURRING: 'Vaste kost', VAT: 'Btw', SALES: 'Verkoop' };
export type ForecastLayer = 'BASE' | 'SCENARIO';
export type ForecastRule = 'invoices' | 'quotes' | 'openQuotes' | 'partner' | 'containers' | 'costs' | 'vat';
export const CLASSIFICATION_LABEL: Record<BankClassification, string> = { INTERNAL_TRANSFER: 'Interne overboeking',
  VAT: 'Btw', LOAN: 'Lening', CAPITAL: 'Kapitaal', PRIVATE: 'Privé', OTHER: 'Andere' };
export type ForecastSource =
  | { type: 'cost'; costId: number } | { type: 'recurring'; recurringId: number } | { type: 'container'; orderId: number }
  | { type: 'invoice'; salesOrderId: number } | { type: 'quote'; salesOrderId: number }
  | { type: 'vat'; year: number; quarter: number } | { type: 'advance'; orderId: number; rowId: number }
  | { type: 'credit' } | { type: 'stock' };

export interface ForecastItem {
  key: string; layer: ForecastLayer; rule: ForecastRule | null;   // null only for SALES and scenario VAT
  kind: ForecastKind; certainty: ForecastCertainty;
  date: Iso;                    // >= today
  originalDate: Iso | null;     // the rule's date before clamping to today
  overdue: boolean;
  amountEur: number;            // signed cash incl. btw
  vatEur: number;               // output VAT inside amountEur (quotes, advances, sales), else 0
  vatDate: Iso | null;          // day the output VAT becomes due (invoice day), else null
  deductibleVatEur: number;     // input VAT this outflow lets us deduct (import VAT), else 0
  costEur: number;              // SALES: cost basis of the goods in this item; else 0
  title: string; party: string | null; ruleText: string;
  orderId: number | null; source: ForecastSource;
  /** The texts a bank reference may carry for this item (order number, invoice numbers, cost reference); the likelyPaid reference signal. */
  references?: string[];
}

/* ---- bank side ---- */
export interface ForecastAccount {
  key: string; label: string; source: 'ODOO' | 'MANUAL'; archived: boolean; countsInCash: boolean;
  currentEur: number | null;    // reconciledBank().accounts[].currentEur
  checkedAt: string | null;     // ISO instant of the latest reading
  firstReadingAtMs: number | null; latestReading: { atMs: number; balanceEur: number } | null;
  labelOnly: boolean;           // no reading and no official line: known only from receipts or cost-payment labels
}
export interface ForecastMovement { key: string /* 'bank:<id>' | 'payment:<id>' */; lineId: number | null; account: string; atMs: number; day: Iso; amountEur: number; }
export type BankLineKind = 'CONTAINERS' | 'CUSTOMERS' | 'VAT' | 'COSTS' | 'OTHER' | 'INTERNAL';
export interface ForecastBankLine {
  id: number; account: string; day: Iso; amountEur: number; counterparty: string; reference: string;
  allocated: boolean; official: boolean; classification: BankClassification | null; transferLineId: number | null;
  parts: { kind: BankLineKind; amountEur: number }[];   // sums to amountEur (§2.4)
  /** The account's label, for the "Lijkt al betaald" texts; missing = the key. */
  accountLabel?: string;
}
export interface RunningBalance { accountAfterEur: number | null; totalAfterEur: number | null; unknownBefore: Iso | null; }

/* ---- forecast inputs ---- */
export interface ForecastOpenCost { costId: number; title: string; party: string | null; date: Iso; dueDate: Iso | null; openEur: number;
  /** The cost's own reference (invoice number), a likelyPaid reference signal. */
  reference?: string | null; }
export interface ForecastRecurring { recurringId: number; name: string; party: string | null; date: Iso; amountInclEur: number; autoPaid: boolean; intervalLabel: string; }
export interface ForecastContainerRow { key: string; orderId: number; payee: 'SUPPLIER' | 'LOGISTICS' | 'SEPARATE' | 'OTHER';
  due: 'ORDERED' | 'SHIPPED' | 'FREIGHT' | 'ARRIVED' | null; termLabel: string | null; remainingEur: number; concept: boolean; }
export interface ForecastOrderLine { productId: number | null; name: string; quantity: number; externalEur: number; pricingEur: number;
  listUnitEur: number | null; historicUnitEur: number | null; paceUnitsPerWeek: number; aheadUnits: number; }
export interface ForecastOrderPayment { id: number; paidOn: Iso; amountEur: number; label: string; payee: 'SUPPLIER' | 'LOGISTICS' | 'SEPARATE' | 'OTHER';
  lineId: number | null; accountLabel: string | null; creditOffset: boolean; }
export interface ForecastOrder {
  orderId: number; number: string; alias: string | null; status: 'CONCEPT' | 'BESTELD' | 'ONDERWEG' | 'ONTVANGEN';
  partner: boolean; archived: boolean; supplierName: string; orderDate: Iso; shippedOn: Iso | null;
  expectedArrival: Iso | null; receivedOn: Iso | null; leadTimeDays: number; transitDays: number;
  importVatEur: number; importVatCovered: boolean;   // true: an IMPORT_VAT_PAID cost already covers it (§2.4)
  clearance: 'BE_CUSTOMS' | 'NL_FISCAL_REP_TO_BE' | 'NL_FISCAL_REP_SOLD_IN_NL'; clearanceConfirmed: boolean;
  paidEur: number; remainingEur: number; internalMarkupEur: number;
  lines: ForecastOrderLine[]; payments: ForecastOrderPayment[];
  /** The container's purchase invoice numbers, a likelyPaid reference signal. */
  invoiceNumbers?: string[];
  /** 'Inspectie via leverancier': the inspection item names the supplier. */
  inspectionViaSupplier?: boolean;
}
export interface ForecastInvoice { salesOrderId: number; number: string; party: string; partner: boolean; advance: boolean; dueDate: Iso; remainingEur: number; delayDays: number; }
export interface ForecastAdvanceRow { orderId: number; orderNumber: string; rowId: number; label: string; party: string; dueDate: Iso | null; amountInclEur: number; vatEur: number; }
export interface ForecastQuote { salesOrderId: number; number: string; party: string; deliveryDate: Iso | null; deliveryWeek: string | null; paymentTerms: string | null; amountInclEur: number; vatEur: number; }
export interface ForecastOpenQuote { salesOrderId: number; number: string; party: string; validUntil: Iso; valueInclEur: number; }
export interface ForecastVatQuarter { year: number; quarter: number; knownNetEur: number; }   // refundEur − payableEur as of today
export interface ForecastProduct { productId: number; name: string; stockUnits: number; externalUnitEur: number | null;
  pricingUnitEur: number | null; listUnitEur: number | null; historicUnitEur: number | null; paceUnitsPerWeek: number; }
export interface ForecastHistory {
  realisedMarkupPct: number | null;  // §2.4, on external cost, 1 decimal
  paymentDays: number | null;        // whole days
  vatPct: number;                    // effective VAT on sales, 2 decimals
  seasonal: number[] | null;         // 12 monthly weights (jan..dec), mean 1, or null = too little history
  openQuoteConversionPct: number;    // 0..100
}
export interface ForecastOutlook { bankEur: number | null; expectedEur: number; netOpenEur: number; upcoming30Eur: number; }
export interface CashForecastInput {
  today: Iso;
  statementsFrom: Iso | null;       // the ?from= day the statements were loaded with (Analyses); null = complete (Kosten & bank)
  accounts: ForecastAccount[];       // every account of reconciledBank, archived included (flagged)
  movements: ForecastMovement[];     // every account; with statementsFrom set only day >= statementsFrom
  bankLines: ForecastBankLine[];     // official lines only
  openCosts: ForecastOpenCost[]; recurring: ForecastRecurring[];
  containerRows: ForecastContainerRow[]; orders: ForecastOrder[];
  invoices: ForecastInvoice[]; openCreditEur: number; advanceRows: ForecastAdvanceRow[];
  quotes: ForecastQuote[]; openQuotes: ForecastOpenQuote[];
  vatQuarters: ForecastVatQuarter[]; paidVatPeriods: string[]; importVatDeferred: boolean;
  products: ForecastProduct[]; history: ForecastHistory; stored: PurchaseOrderForecast[];
  bufferEur: number; outlook: ForecastOutlook;
}
export interface ScenarioDefaults { priceMode: PriceMode | null; markupPct: number | null; markupEurPerUnit: number | null;
  costBasis: CostBasis | null; sellWeeks: number | null; seasonal: boolean | null; paymentDays: number | null; }
export const NO_DEFAULTS: ScenarioDefaults = { priceMode: null, markupPct: null, markupEurPerUnit: null, costBasis: null,
  sellWeeks: null, seasonal: null, paymentDays: null };
export interface ForecastOptions {
  horizonEnd: Iso; scenario: boolean; includeStock: boolean; rulesOff: readonly ForecastRule[];
  openQuotesOn: boolean; defaults: ScenarioDefaults; dismissed: readonly string[]; pastDays: number;
}

/* ---- outputs ---- */
export type ChoiceOrigin = 'stored' | 'link' | 'history';
export interface ResolvedChoice {
  priceMode: PriceMode; markupPct: number; markupEurPerUnit: number; costBasis: CostBasis; sellWeeks: number;
  paymentDays: number; seasonal: boolean; included: boolean; orderDate: Iso; expectedShipOn: Iso | null;
  defaultSellWeeks: number; seasonalAvailable: boolean;
  origin: Record<'priceMode' | 'markupPct' | 'markupEurPerUnit' | 'costBasis' | 'sellWeeks' | 'paymentDays' | 'seasonal' | 'included', ChoiceOrigin>;
}
export interface ScenarioSource { id: 'stock' | number; label: string; sub: string; status: 'STOCK' | 'CONCEPT' | 'BESTELD' | 'ONDERWEG';
  included: boolean; locked: boolean; lockedText: string | null; choice: ResolvedChoice | null;
  units: number; costEur: number; backEur: number; cashInHorizonEur: number; }
export interface LikelyPaidMatch { lineId: number; itemKey: string; orderId: number | null; title: string; amountEur: number;
  day: Iso; account: string; counterparty: string; reference: string; reason: 'reference' | 'party'; }
export interface ForecastDay { day: Iso; baseEur: number; withEur: number; slowEur: number; inEur: number; outEur: number; }
export interface Lowest { day: Iso; eur: number; causes: string[]; }
export interface TightPeriod { from: Iso; to: Iso; lowestEur: number; lowestDay: Iso; causes: string[]; }
export interface ForecastMonth { key: string; label: string; past: boolean; beginEur: number | null;
  containersOutEur: number; containersBackEur: number; customersOtherEur: number; vatEur: number; costsEur: number; otherEur: number;
  endEur: number | null; lowestEur: number | null; lowestDay: Iso | null; inEur: number; outEur: number; count: number; }
export interface RegisterRow { kind: 'past' | 'today' | 'future'; key: string; date: Iso; title: string; sub: string;
  kindLabel: string; certaintyLabel: string; amountEur: number; balanceEur: number | null; layer: ForecastLayer | null;
  item: ForecastItem | null; lineId: number | null; monthKey: string; }
export interface ForecastPin { n: number; from: Iso; to: Iso; label: string; amountEur: number; }
export interface ForecastReconciliation { startLabel: string; startEur: number; lines: { label: string; eur: number }[];
  endLabel: string; endEur: number; seriesEndEur: number; matches: boolean; }
export interface CashForecast {
  today: Iso; horizonEnd: Iso; mode: 'absolute' | 'relative'; bufferEur: number;
  startEur: number; startAccounts: { key: string; label: string; eur: number | null; ageDays: number | null; stale: boolean }[];
  missingAccounts: string[]; excludedAccounts: { key: string; label: string; eur: number | null }[];
  items: ForecastItem[]; likelyPaid: LikelyPaidMatch[]; excludedItems: ForecastItem[];
  past: { day: Iso; eur: number | null }[]; days: ForecastDay[];
  lowestBase: Lowest; lowestWith: Lowest; lowestSlow: Lowest;
  zeroBase: Iso | null; zeroWith: Iso | null; zeroSlow: Iso | null;
  tightWith: TightPeriod[]; tightSlow: TightPeriod[]; pins: ForecastPin[];
  months: ForecastMonth[]; register: RegisterRow[];
  ruleTotals: Record<ForecastRule, number>;     // BASE items of the rule within the horizon, also when switched off
  scenario: { sources: ScenarioSource[]; salesExclEur: number; salesVatEur: number; inHorizonEur: number;
    vatPaidEur: number; marginEur: number; afterHorizonEur: number; };
  reconciliation: ForecastReconciliation;
  endBaseEur: number; endWithEur: number; endSlowEur: number;
}
export interface PoFlowRow { date: Iso | null; approx: boolean; title: string; status: string; amountEur: number;
  kind: 'paid' | 'open' | 'likely' | 'internal' | 'sales'; lineId: number | null; }
export interface PoProductRow { productId: number | null; name: string; units: number; costUnitEur: number; priceUnitEur: number; backEur: number; }
export interface PoSheet {
  orderId: number; title: string; status: ForecastOrder['status']; partner: boolean;
  netEur: number; breakEvenOn: Iso | null; breakEvenText: string;
  paidEur: number; outstandingEur: number; backEur: number; marginPct: number;
  choice: ResolvedChoice | null; departure: { date: Iso; certainty: ForecastCertainty; ruleText: string; stored: boolean } | null;
  lane: { day: Iso; eur: number }[]; flows: PoFlowRow[]; likelyPaid: LikelyPaidMatch[]; products: PoProductRow[];
  salesWindow: { from: Iso; to: Iso; weeks: number; text: string } | null;
}
export interface OrderDateSuggestion { orderId: number; currentDate: Iso; currentLowestEur: number; currentLowestDay: Iso;
  suggestedDate: Iso; rule: 'buffer' | 'lowest'; }

/* ============================================================== constants */

export const DEFAULT_CASH_BUFFER_EUR = 10000;
/** Days between departure and arrival when no received container of the supplier (or of anyone) tells. */
export const DEFAULT_TRANSIT_DAYS = 38;
/** Days between ordering and departure when the supplier has no lead time. */
export const DEFAULT_LEAD_TIME_DAYS = 35;
/** The inspection is paid this many days before departure. */
export const INSPECTION_DAYS_BEFORE_DEPARTURE = 7;
/** Customs and transport are paid this many days after arrival. */
export const LOGISTICS_DAYS_AFTER_ARRIVAL = 2;
/** "Verkoop 4 weken trager". */
export const SLOW_SALES_DAYS = 28;
/** Two 'krap' periods at most this many days apart are one. */
export const TIGHT_MERGE_GAP_DAYS = 3;
/** "Lijkt al betaald" looks at unlinked bank lines of the last 90 days. */
export const LIKELY_PAID_WINDOW_DAYS = 90;
/** Items from this size on get a pin on the chart. */
export const PIN_MIN_EUR = 5000;

const STALE_DAYS = 14;
const PAST_REGISTER_ROWS = 10;
const CONTAINER_KINDS: ReadonlySet<ForecastKind> = new Set(['SUPPLIER', 'LOGISTICS', 'INSPECTION', 'OTHER_CONTAINER']);
const RULES: readonly ForecastRule[] = ['invoices', 'quotes', 'openQuotes', 'partner', 'containers', 'costs', 'vat'];
const PAYEE_LABEL: Record<ForecastOrderPayment['payee'], string> = { SUPPLIER: 'Leverancier', LOGISTICS: 'Douane & transport',
  SEPARATE: 'Inspectie & andere kosten', OTHER: 'Bijkomende kosten' };

/* ================================================================ helpers */

const DAY_MS = 86_400_000;
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const WEEKDAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const pad2 = (value: number): string => String(value).padStart(2, '0');
const isoOf = (year: number, month: number, day: number): Iso => `${year}-${pad2(month)}-${pad2(day)}`;
const utcOf = (day: Iso): number => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
const fromUtc = (ms: number): Iso => { const date = new Date(ms); return isoOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()); };
const addDays = (day: Iso, days: number): Iso => fromUtc(utcOf(day) + days * DAY_MS);
const daysBetween = (from: Iso, to: Iso): number => Math.round((utcOf(to) - utcOf(from)) / DAY_MS);
const weekdayOf = (day: Iso): number => new Date(utcOf(day)).getUTCDay();
const lastDayOf = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();
const monthEndOf = (day: Iso): Iso => isoOf(Number(day.slice(0, 4)), Number(day.slice(5, 7)), lastDayOf(Number(day.slice(0, 4)), Number(day.slice(5, 7))));
const monthStartOf = (day: Iso): Iso => `${day.slice(0, 7)}-01`;
const minIso = (left: Iso, right: Iso): Iso => (left < right ? left : right);
const maxIso = (left: Iso, right: Iso): Iso => (left > right ? left : right);
const validIso = (day: string | null | undefined): day is Iso => !!day && /^\d{4}-\d{2}-\d{2}$/.test(day.slice(0, 10)) && Number.isFinite(utcOf(day.slice(0, 10)));
function addMonths(day: Iso, months: number): Iso {
  const total = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1 + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return isoOf(year, month, Math.min(Number(day.slice(8, 10)), lastDayOf(year, month)));
}
function eachDay(from: Iso, to: Iso): Iso[] {
  const days: Iso[] = [];
  for (let at = utcOf(from), end = utcOf(to); at <= end; at += DAY_MS) days.push(fromUtc(at));
  return days;
}
/** A cash day on a Saturday or Sunday moves to the next Monday. */
function weekdayOrMonday(day: Iso): Iso {
  const weekday = weekdayOf(day);
  return weekday === 6 ? addDays(day, 2) : weekday === 0 ? addDays(day, 1) : day;
}

let brusselsFormat: Intl.DateTimeFormat | null = null;
/** The Brussels calendar day of an instant. */
function brusselsDay(ms: number): Iso {
  try {
    brusselsFormat ??= new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' });
    const parts = brusselsFormat.formatToParts(new Date(ms));
    const part = (type: string): string => parts.find((row) => row.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/* texts */
const dm = (day: Iso): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const dMon = (day: Iso): string => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
/** "15 jan – 14 mei"; a range that runs into another year carries both years: "15 jan 2027 – 7 jan 2028". */
const dMonRange = (from: Iso, to: Iso): string => from.slice(0, 4) === to.slice(0, 4)
  ? `${dMon(from)} – ${dMon(to)}` : `${dMon(from)} ${from.slice(0, 4)} – ${dMon(to)} ${to.slice(0, 4)}`;
const wdDMon = (day: Iso): string => `${WEEKDAYS[weekdayOf(day)]} ${dMon(day)}`;
const monthLabel = (day: Iso): string => MONTHS[Number(day.slice(5, 7)) - 1];
const grouped = (value: number): string => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
/** "… · nu" for a date moved to today, unless the text already says nu. */
const withNu = (text: string): string => (/(^|· )nu( ·|$)/.test(text) ? text : `${text} · nu`);

/* money */
const finite = (value: number | null | undefined): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const toCents = (value: number | null | undefined): number => Math.round(finite(value) * 100);
const toEur = (cents: number): number => (cents === 0 ? 0 : cents / 100);
const sumCents = (items: readonly { amountEur: number }[]): number => items.reduce((sum, item) => sum + toCents(item.amountEur), 0);
const round1 = (value: number): number => Math.round(value * 10) / 10;
/** Four decimals, the rounding of containerQuoteUnitPrice (purchase-quote-pricing.ts): keep the two in step. */
const round4 = (value: number): number => Math.round((value + Number.EPSILON * Math.max(1, Math.abs(value))) * 10000) / 10000;
/** A line total in cents, the rounding of containerQuoteLineTotal. */
const lineCents = (unitPrice: number, quantity: number): number => {
  const total = unitPrice * quantity;
  return Math.round((total + Number.EPSILON * Math.max(1, Math.abs(total))) * 100);
};

/* text matching (likelyPaid) */
const normalised = (text: string | null | undefined): string => (text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const compact = (text: string | null | undefined): string => normalised(text).replace(/[^a-z0-9]/g, '');

/* ============================================================ horizon */

/** The horizon end: the same day `months` later, the last day of the month when it is shorter ('2026-08-31' + 6 → '2027-02-28'). */
export function horizonEndOf(today: Iso, months: 3 | 6 | 12): Iso {
  return addMonths(today, months);
}

/* ================================================================ bank */

interface Track {
  account: ForecastAccount;
  moves: ForecastMovement[];
  /** prefix[k] = Σ cents of the first k moves. */
  prefix: number[];
  /** Moves at or before the latest reading. */
  readingIndex: number;
  readingCents: number | null;
  firstReadingAtMs: number | null;
  firstReadingDay: Iso | null;
}

const compareMoves = (left: { atMs: number; key: string }, right: { atMs: number; key: string }): number =>
  left.atMs - right.atMs || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0);

function tracksOf(movements: readonly ForecastMovement[], accounts: readonly ForecastAccount[], statementsFrom?: Iso | null): Map<string, Track> {
  const byAccount = new Map<string, ForecastMovement[]>();
  for (const move of movements) {
    if (statementsFrom && move.day < statementsFrom) continue;
    const list = byAccount.get(move.account) ?? [];
    list.push(move);
    byAccount.set(move.account, list);
  }
  const tracks = new Map<string, Track>();
  for (const account of accounts) {
    const moves = [...new Map((byAccount.get(account.key) ?? []).map((move) => [move.key, move])).values()].sort(compareMoves);
    const prefix = [0];
    for (const move of moves) prefix.push(prefix[prefix.length - 1] + toCents(move.amountEur));
    const reading = account.latestReading;
    const readingIndex = reading ? moves.filter((move) => move.atMs <= reading.atMs).length : 0;
    const firstReadingAtMs = reading ? (account.firstReadingAtMs ?? reading.atMs) : null;
    tracks.set(account.key, {
      account, moves, prefix, readingIndex,
      readingCents: reading ? toCents(reading.balanceEur) : null,
      firstReadingAtMs, firstReadingDay: firstReadingAtMs !== null ? brusselsDay(firstReadingAtMs) : null,
    });
  }
  return tracks;
}

/** The balance after move `index` (-1 = before the first move): the reading walked forward or backward. */
function valueAfter(track: Track, index: number): number | null {
  if (track.readingCents === null) return null;
  return track.readingCents + track.prefix[index + 1] - track.prefix[track.readingIndex];
}

/** Whether the balance is known at an instant: Odoo accounts always (complete import), manual ones from their first reading. */
function knownAtMs(track: Track, atMs: number): boolean {
  if (track.readingCents === null) return false;
  return track.account.source === 'ODOO' || (track.firstReadingAtMs !== null && atMs >= track.firstReadingAtMs);
}

function knownOnDay(track: Track, day: Iso): boolean {
  if (track.readingCents === null) return false;
  return track.account.source === 'ODOO' || (track.firstReadingDay !== null && track.firstReadingDay <= day);
}

/** The last move at or before a position (atMs, key); -1 when none. */
function lastAtOrBefore(track: Track, position: { atMs: number; key: string }): number {
  let low = 0;
  let high = track.moves.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (compareMoves(track.moves[middle], position) <= 0) { found = middle; low = middle + 1; } else high = middle - 1;
  }
  return found;
}

/** The last move on or before a local day; -1 when none. */
function lastOnOrBeforeDay(track: Track, day: Iso): number {
  let found = -1;
  for (let index = 0; index < track.moves.length; index++) if (track.moves[index].day <= day) found = index;
  return found;
}

/** The balance of an account at a position of another account's movement (the totalAfterEur rule). */
function balanceAtPosition(track: Track, position: { atMs: number; key: string }): number | null {
  return knownAtMs(track, position.atMs) ? valueAfter(track, lastAtOrBefore(track, position)) : null;
}

function balanceAtDayEnd(track: Track, day: Iso, statementsFrom?: Iso | null): number | null {
  if (statementsFrom && day < statementsFrom) return null;
  return knownOnDay(track, day) ? valueAfter(track, lastOnOrBeforeDay(track, day)) : null;
}

/** The balance at the start of a day (the end of the day before, but known from the opening of truncated statements on). */
function balanceAtDayStart(track: Track, day: Iso, statementsFrom?: Iso | null): number | null {
  if (statementsFrom && day < statementsFrom) return null;
  if (track.readingCents === null) return null;
  if (track.account.source !== 'ODOO' && !(track.firstReadingDay !== null && track.firstReadingDay < day)) return null;
  return valueAfter(track, lastOnOrBeforeDay(track, addDays(day, -1)));
}

function sumOrNull(values: readonly (number | null)[]): number | null {
  let sum = 0;
  for (const value of values) {
    if (value === null) return null;
    sum += value;
  }
  return sum;
}

const activeKeys = (accounts: readonly ForecastAccount[]): string[] => accounts.filter((account) => !account.archived && !account.labelOnly).map((account) => account.key);
const countedKeys = (accounts: readonly ForecastAccount[]): string[] => accounts.filter((account) => !account.archived && !account.labelOnly && account.countsInCash).map((account) => account.key);

/**
 * The balance after every movement: per account (the latest reading walked
 * forward and backward; a manual account is unknown before its first
 * reading) and over all active accounts at that instant.
 */
export function runningBalances(movements: readonly ForecastMovement[], accounts: readonly ForecastAccount[], statementsFrom?: Iso | null): Map<string, RunningBalance> {
  const tracks = tracksOf(movements, accounts, statementsFrom);
  const active = activeKeys(accounts).map((key) => tracks.get(key)!).filter(Boolean);
  const result = new Map<string, RunningBalance>();
  for (const track of tracks.values()) {
    track.moves.forEach((move, index) => {
      const own = knownAtMs(track, move.atMs) ? valueAfter(track, index) : null;
      const unknownBefore = track.account.source === 'MANUAL' && track.readingCents !== null && track.firstReadingAtMs !== null
        && move.atMs < track.firstReadingAtMs ? track.firstReadingDay : null;
      const total = track.account.labelOnly ? null : sumOrNull(active.map((other) => (other === track ? own : balanceAtPosition(other, move))));
      result.set(move.key, { accountAfterEur: own === null ? null : toEur(own), totalAfterEur: total === null ? null : toEur(total), unknownBefore });
    });
  }
  return result;
}

/** Each day's closing balance over the given accounts; null when any of them is unknown that day (or before truncated statements). */
export function dayEndBalances(movements: readonly ForecastMovement[], accounts: readonly ForecastAccount[], accountKeys: readonly string[],
  from: Iso, to: Iso, statementsFrom?: Iso | null): Map<Iso, number | null> {
  const tracks = tracksOf(movements, accounts, statementsFrom);
  const chosen = [...new Set(accountKeys)].map((key) => tracks.get(key)).filter((track): track is Track => !!track && !track.account.labelOnly);
  const result = new Map<Iso, number | null>();
  if (!validIso(from) || !validIso(to) || from > to) return result;
  for (const day of eachDay(from, to)) {
    const total = sumOrNull(chosen.map((track) => balanceAtDayEnd(track, day, statementsFrom)));
    result.set(day, total === null ? null : toEur(total));
  }
  return result;
}

/** The counted balance (active accounts that count in the cash forecast) at each day's end. */
export function balanceHistory(movements: readonly ForecastMovement[], accounts: readonly ForecastAccount[], from: Iso, to: Iso,
  statementsFrom?: Iso | null): { day: Iso; eur: number | null }[] {
  return [...dayEndBalances(movements, accounts, countedKeys(accounts), from, to, statementsFrom)].map(([day, eur]) => ({ day, eur }));
}

/* ============================================================ likelyPaid */

const LIKELY_KINDS_OUT: ReadonlySet<ForecastKind> = new Set(['SUPPLIER', 'LOGISTICS', 'INSPECTION', 'OTHER_CONTAINER', 'COST']);
const LIKELY_KINDS_IN: ReadonlySet<ForecastKind> = new Set(['CUSTOMER', 'PARTNER']);
const TAX_OFFICE = ['fod fin', 'spf fin', 'btw', 'tva'];

function quarterEndOf(source: ForecastSource): Iso | null {
  if (source.type !== 'vat') return null;
  const month = source.quarter * 3;
  return isoOf(source.year, month, lastDayOf(source.year, month));
}

/** 2 = reference, 1 = party, 0 = no signal. */
function signalOf(item: ForecastItem, line: ForecastBankLine): number {
  const counterparty = normalised(line.counterparty);
  if (item.kind === 'VAT') return TAX_OFFICE.some((word) => counterparty.includes(word)) ? 1 : 0;
  const text = compact(`${line.reference ?? ''} ${line.counterparty ?? ''}`);
  if ((item.references ?? []).some((reference) => { const ref = compact(reference); return ref.length >= 3 && text.includes(ref); })) return 2;
  const party = normalised(item.party);
  return party.length > 3 && counterparty.includes(party) ? 1 : 0;
}

function eligible(item: ForecastItem, line: ForecastBankLine, today: Iso): boolean {
  if (item.layer !== 'BASE' || line.allocated || line.classification != null) return false;
  if (line.day < addDays(today, -LIKELY_PAID_WINDOW_DAYS)) return false;
  const amount = toCents(item.amountEur);
  const lineAmount = toCents(line.amountEur);
  if (Math.abs(lineAmount - amount) > 2) return false;
  if (item.kind === 'VAT') {
    const end = quarterEndOf(item.source);
    return amount < 0 && lineAmount < 0 && !!end && line.day > end;
  }
  if (LIKELY_KINDS_OUT.has(item.kind)) return amount < 0 && lineAmount < 0;
  if (LIKELY_KINDS_IN.has(item.kind)) return amount > 0 && lineAmount > 0;
  return false;
}

/**
 * The double-count guard: open items that an unlinked bank line of the last
 * 90 days seems to have paid already (same amount ± € 0,02, and the order
 * or invoice number in the reference, or the party in the counterparty).
 * A line goes to the item with the strongest signal (a tie: to none); an
 * item takes its most recent line with the strongest signal; each line once.
 */
export function likelyPaid(items: readonly ForecastItem[], bankLines: readonly ForecastBankLine[], today: Iso, dismissed: readonly string[]): LikelyPaidMatch[] {
  const skipped = new Set(dismissed);
  const perLine = new Map<number, { item: ForecastItem; signal: number }[]>();
  for (const line of bankLines) {
    for (const item of items) {
      if (skipped.has(`${line.id}:${item.key}`) || !eligible(item, line, today)) continue;
      const signal = signalOf(item, line);
      if (signal === 0) continue;
      const list = perLine.get(line.id) ?? [];
      list.push({ item, signal });
      perLine.set(line.id, list);
    }
  }
  const lineById = new Map(bankLines.map((line) => [line.id, line]));
  const perItem = new Map<string, { line: ForecastBankLine; signal: number }[]>();
  for (const [lineId, candidates] of perLine) {
    const best = Math.max(...candidates.map((candidate) => candidate.signal));
    const top = candidates.filter((candidate) => candidate.signal === best);
    if (top.length !== 1) continue;   // ambiguous
    const list = perItem.get(top[0].item.key) ?? [];
    list.push({ line: lineById.get(lineId)!, signal: best });
    perItem.set(top[0].item.key, list);
  }
  const matches: LikelyPaidMatch[] = [];
  for (const item of items) {
    const candidates = perItem.get(item.key);
    if (!candidates?.length) continue;
    const chosen = [...candidates].sort((left, right) => right.signal - left.signal
      || right.line.day.localeCompare(left.line.day) || right.line.id - left.line.id)[0];
    matches.push({ lineId: chosen.line.id, itemKey: item.key, orderId: item.orderId, title: item.title, amountEur: item.amountEur,
      day: chosen.line.day, account: chosen.line.accountLabel || chosen.line.account, counterparty: chosen.line.counterparty,
      reference: chosen.line.reference, reason: chosen.signal === 2 ? 'reference' : 'party' });
  }
  return matches;
}

/* ===================================================== terms and helpers */

/** "30 dagen netto" → net 30; "Bij levering" → net 0; "Vooruitbetaling" → prepay; "30/70" → split 30; anything else → net 30 (assumed). */
export function parsePaymentTerms(text: string | null): { kind: 'net'; days: number; assumed: boolean } | { kind: 'prepay' } | { kind: 'split'; firstPct: number } {
  const value = (text ?? '').trim();
  const days = /(\d+)\s*dag/i.exec(value);
  if (days) return { kind: 'net', days: Number(days[1]), assumed: false };
  if (/bij levering/i.test(value)) return { kind: 'net', days: 0, assumed: false };
  if (/vooruitbetaling/i.test(value)) return { kind: 'prepay' };
  const split = /^(\d+)\//.exec(value);
  if (split && Number(split[1]) > 0 && Number(split[1]) < 100) return { kind: 'split', firstPct: Number(split[1]) };
  return { kind: 'net', days: 30, assumed: true };
}

/** Shares of a cent total by weight; the cents left over go to the largest remainders, ties to the earlier index. */
export function distributeCents(totalCents: number, weights: readonly number[]): number[] {
  if (!weights.length) return [];
  const clean = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0));
  const sum = clean.reduce((total, weight) => total + weight, 0);
  const used = sum > 0 ? clean : clean.map(() => 1);
  const usedSum = sum > 0 ? sum : used.length;
  const exact = used.map((weight) => totalCents * weight / usedSum);
  const shares = exact.map((value) => Math.floor(value));
  let rest = totalCents - shares.reduce((total, value) => total + value, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let at = 0; rest > 0 && order.length; at = (at + 1) % order.length, rest--) shares[order[at].index] += 1;
  return shares;
}

/** Twelve monthly weights (jan..dec, mean 1) from revenue per 'YYYY-MM'; null with fewer than 12 months of revenue. */
export function seasonalProfile(monthly: readonly { month: string; eur: number }[]): number[] | null {
  const perMonth = new Map<string, number>();
  for (const row of monthly) {
    if (!/^\d{4}-\d{2}$/.test(row.month)) continue;
    perMonth.set(row.month, (perMonth.get(row.month) ?? 0) + finite(row.eur));
  }
  if ([...perMonth.values()].filter((eur) => eur > 0).length < 12) return null;
  const averages = Array.from({ length: 12 }, (_, index) => {
    const values = [...perMonth].filter(([month]) => Number(month.slice(5, 7)) === index + 1).map(([, eur]) => eur);
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
  });
  const mean = averages.reduce((total, value) => total + value, 0) / 12;
  if (!(mean > 0)) return null;
  return averages.map((value) => Math.round(value / mean * 10000) / 10000);
}

/** The sell period in weeks from the pace: each product's (ahead + quantity) / pace, weighed by cost, 2..52. */
export function defaultSellWeeks(lines: readonly { basisEur: number; quantity: number; aheadUnits: number; paceUnitsPerWeek: number }[]): number {
  let weighted = 0;
  let basis = 0;
  for (const line of lines) {
    const cost = finite(line.basisEur);
    if (!(cost > 0)) continue;
    const pace = finite(line.paceUnitsPerWeek);
    const weeks = pace > 0 ? (finite(line.aheadUnits) + finite(line.quantity)) / pace : 52;
    weighted += cost * weeks;
    basis += cost;
  }
  if (!(basis > 0)) return 12;
  return Math.min(52, Math.max(2, Math.round(weighted / basis)));
}

function stockLines(products: readonly ForecastProduct[]): ForecastOrderLine[] {
  return products.filter((product) => finite(product.stockUnits) > 0).map((product) => {
    const external = product.externalUnitEur ?? product.pricingUnitEur ?? 0;
    const pricing = product.pricingUnitEur ?? product.externalUnitEur ?? 0;
    return { productId: product.productId, name: product.name, quantity: product.stockUnits,
      externalEur: toEur(toCents(external * product.stockUnits)), pricingEur: toEur(toCents(pricing * product.stockUnits)),
      listUnitEur: product.listUnitEur, historicUnitEur: product.historicUnitEur, paceUnitsPerWeek: finite(product.paceUnitsPerWeek), aheadUnits: 0 };
  });
}

const sellLines = (lines: readonly ForecastOrderLine[]) => lines.map((line) => ({ basisEur: line.externalEur, quantity: line.quantity,
  aheadUnits: line.aheadUnits, paceUnitsPerWeek: line.paceUnitsPerWeek }));

/** The choices of one order (null = the current stock): stored value, else the link default, else the history. */
export function resolveChoice(order: ForecastOrder | null, stored: PurchaseOrderForecast | null, defaults: ScenarioDefaults, history: ForecastHistory,
  today: Iso, products?: readonly ForecastProduct[]): ResolvedChoice {
  const pick = <T>(own: T | null | undefined, link: T | null | undefined, fallback: T): [T, ChoiceOrigin] =>
    own !== null && own !== undefined ? [own, 'stored'] : link !== null && link !== undefined ? [link, 'link'] : [fallback, 'history'];
  const lines = order ? order.lines : stockLines(products ?? []);
  const defaultWeeks = defaultSellWeeks(sellLines(lines));
  const seasonalAvailable = history.seasonal !== null && history.seasonal !== undefined;
  const [priceMode, priceModeOrigin] = pick(stored?.priceMode, defaults.priceMode, 'MARKUP_PCT' as PriceMode);
  const [markupPct, markupPctOrigin] = pick(stored?.markupPct, defaults.markupPct, history.realisedMarkupPct ?? 50);
  const [markupEurPerUnit, perUnitOrigin] = pick(stored?.markupEurPerUnit, defaults.markupEurPerUnit, 0);
  const [costBasis, costBasisOrigin] = pick(stored?.costBasis, defaults.costBasis, 'EXTERNAL' as CostBasis);
  const [sellWeeks, sellWeeksOrigin] = pick(stored?.sellWeeks, defaults.sellWeeks, defaultWeeks);
  const [paymentDays, paymentDaysOrigin] = pick(stored?.paymentDays, defaults.paymentDays, history.paymentDays ?? 30);
  const [seasonal, seasonalOrigin] = pick(stored?.seasonal, defaults.seasonal, seasonalAvailable);
  const statusIncluded = !order ? true : !order.partner && !order.archived && (order.status === 'BESTELD' || order.status === 'ONDERWEG');
  const [included, includedOrigin] = pick(order?.partner ? null : stored?.included, null, statusIncluded);
  const orderDate = !order ? today : order.status === 'CONCEPT' ? (stored?.orderDateOverride ?? order.orderDate) : order.orderDate;
  return {
    priceMode, markupPct: finite(markupPct), markupEurPerUnit: finite(markupEurPerUnit), costBasis,
    sellWeeks: Math.max(1, Math.round(finite(sellWeeks)) || defaultWeeks), paymentDays: Math.max(0, Math.round(finite(paymentDays))),
    seasonal, included, orderDate, expectedShipOn: stored?.expectedShipOn ?? null, defaultSellWeeks: defaultWeeks, seasonalAvailable,
    origin: { priceMode: priceModeOrigin, markupPct: markupPctOrigin, markupEurPerUnit: perUnitOrigin, costBasis: costBasisOrigin,
      sellWeeks: sellWeeksOrigin, paymentDays: paymentDaysOrigin, seasonal: seasonalOrigin, included: includedOrigin },
  };
}

/* ======================================================= item generation */

interface Draft {
  key: string; layer: ForecastLayer; rule: ForecastRule | null; kind: ForecastKind; certainty: ForecastCertainty;
  ruleDate: Iso; ruleText: string;
  /** The rule text and certainty when the rule date has passed (else "· nu" is appended). */
  pastText?: string; pastCertainty?: ForecastCertainty;
  amountCents: number; vatCents?: number; vatDate?: Iso | 'date' | null; deductibleCents?: number; costCents?: number;
  title: string; party: string | null; orderId: number | null; source: ForecastSource; references?: string[];
}

function itemOf(draft: Draft, today: Iso): ForecastItem {
  const past = draft.ruleDate < today;
  const date = past ? today : draft.ruleDate;
  const item: ForecastItem = {
    key: draft.key, layer: draft.layer, rule: draft.rule, kind: draft.kind,
    certainty: past && draft.pastCertainty ? draft.pastCertainty : draft.certainty,
    date, originalDate: past ? draft.ruleDate : null, overdue: past,
    amountEur: toEur(draft.amountCents), vatEur: toEur(draft.vatCents ?? 0),
    vatDate: draft.vatDate === 'date' ? date : draft.vatDate ?? null,
    deductibleVatEur: toEur(draft.deductibleCents ?? 0), costEur: toEur(draft.costCents ?? 0),
    title: draft.title, party: draft.party, ruleText: past ? (draft.pastText ?? withNu(draft.ruleText)) : draft.ruleText,
    orderId: draft.orderId, source: draft.source,
  };
  if (draft.references?.length) item.references = draft.references;
  return item;
}

interface DateRule { date: Iso; certainty: ForecastCertainty; text: string }

/** The effective order day: a Concept's planned day, else the order date. */
function orderDayOf(order: ForecastOrder, stored: PurchaseOrderForecast | null): Iso {
  return order.status === 'CONCEPT' && stored?.orderDateOverride ? stored.orderDateOverride : order.orderDate;
}

const transitOf = (order: ForecastOrder): number => (order.transitDays > 0 ? Math.round(order.transitDays) : DEFAULT_TRANSIT_DAYS);
const leadOf = (order: ForecastOrder): number => (order.leadTimeDays > 0 ? Math.round(order.leadTimeDays) : DEFAULT_LEAD_TIME_DAYS);

function departureOf(order: ForecastOrder, stored: PurchaseOrderForecast | null): DateRule {
  if (order.shippedOn) return { date: order.shippedOn, certainty: 'FIXED', text: `vertrokken ${dm(order.shippedOn)}` };
  if (stored?.expectedShipOn) return { date: stored.expectedShipOn, certainty: 'FIXED', text: `vertrek vastgelegd ${dm(stored.expectedShipOn)}` };
  const transit = transitOf(order);
  if (order.expectedArrival) return { date: addDays(order.expectedArrival, -transit), certainty: 'ESTIMATED', text: `aankomst ${dm(order.expectedArrival)} − ${transit} d transit` };
  const ordered = orderDayOf(order, stored);
  const lead = leadOf(order);
  return { date: addDays(ordered, lead), certainty: 'ESTIMATED', text: `besteld ${dm(ordered)} + ${lead} d levertijd` };
}

function arrivalOf(order: ForecastOrder, stored: PurchaseOrderForecast | null): DateRule {
  if (order.status === 'ONTVANGEN' && order.receivedOn) return { date: order.receivedOn, certainty: 'FIXED', text: `ontvangen ${dm(order.receivedOn)}` };
  if (order.expectedArrival) return { date: order.expectedArrival, certainty: 'EXPECTED', text: `ETA ${dm(order.expectedArrival)}` };
  const departure = departureOf(order, stored);
  const transit = transitOf(order);
  return { date: addDays(departure.date, transit), certainty: 'ESTIMATED', text: `vertrek ${dm(departure.date)} + ${transit} d transit` };
}

/** The departure and arrival rules of §2.5 (the input builder dates import VAT bookings and the stock ahead of a container with them). */
export function containerDates(order: ForecastOrder, stored: PurchaseOrderForecast | null): { departure: { date: Iso; certainty: ForecastCertainty; text: string }; arrival: { date: Iso; certainty: ForecastCertainty; text: string } } {
  return { departure: departureOf(order, stored), arrival: arrivalOf(order, stored) };
}

const shippedText = (order: ForecastOrder): string => (order.shippedOn ? `nu · vertrokken ${dm(order.shippedOn)}` : 'nu · onderweg');
const receivedText = (order: ForecastOrder): string => (order.receivedOn ? `nu · ontvangen ${dm(order.receivedOn)}` : 'nu · ontvangen');
const KIND_OF_PAYEE: Record<ForecastContainerRow['payee'], ForecastKind> = { SUPPLIER: 'SUPPLIER', LOGISTICS: 'LOGISTICS', SEPARATE: 'INSPECTION', OTHER: 'OTHER_CONTAINER' };

/** One container row (a supplier term or a payee stream) on its day. */
function containerDraft(order: ForecastOrder, row: ForecastContainerRow, stored: PurchaseOrderForecast | null, today: Iso): Draft {
  const status = order.status;
  const goneOrArrived = status === 'ONDERWEG' || status === 'ONTVANGEN';
  const fixedToday = (text: string): DateRule => ({ date: today, certainty: 'FIXED', text });
  let rule: DateRule;
  let title: string;
  let party: string | null = null;
  if (row.payee === 'SUPPLIER') {
    party = order.supplierName || null;
    title = `${order.number} · ${row.termLabel || 'Leverancier'}`;
    if (row.due === null || row.due === 'ORDERED') {
      const ordered = orderDayOf(order, stored);
      rule = status === 'CONCEPT' ? { date: ordered, certainty: 'SCENARIO', text: `bij bestelling ${dm(ordered)}` }
        : fixedToday(row.due === null ? 'nu' : 'nu · bij bestelling');
    } else if (row.due === 'SHIPPED' || row.due === 'FREIGHT') {
      if (goneOrArrived) rule = fixedToday(shippedText(order));
      else { const departure = departureOf(order, stored); rule = { ...departure, text: `bij vertrek · ${departure.text}` }; }
    } else if (status === 'ONTVANGEN') {
      rule = fixedToday(receivedText(order));
    } else {
      const arrival = arrivalOf(order, stored);
      rule = { ...arrival, text: `bij aankomst · ${arrival.text}` };
    }
  } else if (row.payee === 'LOGISTICS') {
    title = `${order.number} · Douane & transport`;
    if (status === 'ONTVANGEN') rule = fixedToday(receivedText(order));
    else { const arrival = arrivalOf(order, stored); rule = { date: addDays(arrival.date, LOGISTICS_DAYS_AFTER_ARRIVAL), certainty: arrival.certainty, text: `aankomst ${dm(arrival.date)} + ${LOGISTICS_DAYS_AFTER_ARRIVAL} d` }; }
  } else if (row.payee === 'SEPARATE') {
    title = `${order.number} · Inspectie & andere kosten`;
    party = order.inspectionViaSupplier ? order.supplierName || null : null;
    if (goneOrArrived) rule = fixedToday(shippedText(order));
    else { const departure = departureOf(order, stored); rule = { date: addDays(departure.date, -INSPECTION_DAYS_BEFORE_DEPARTURE), certainty: departure.certainty, text: `vertrek ${dm(departure.date)} − ${INSPECTION_DAYS_BEFORE_DEPARTURE} d (inspectie)` }; }
  } else {
    title = `${order.number} · Bijkomende kosten`;
    if (status === 'ONTVANGEN') rule = fixedToday(receivedText(order));
    else { const arrival = arrivalOf(order, stored); rule = { date: arrival.date, certainty: arrival.certainty, text: `bij aankomst ${dm(arrival.date)}` }; }
  }
  return {
    key: row.key, layer: row.concept ? 'SCENARIO' : 'BASE', rule: 'containers', kind: KIND_OF_PAYEE[row.payee], certainty: rule.certainty,
    ruleDate: rule.date, ruleText: rule.text, amountCents: -toCents(row.remainingEur), title, party, orderId: order.orderId,
    source: { type: 'container', orderId: order.orderId }, references: [order.number, ...(order.invoiceNumbers ?? [])].filter(Boolean),
  };
}

/** Import VAT at arrival for a container cleared in Belgium (not under ET 14000, not already booked as a customs cost). */
function importVatDraft(input: CashForecastInput, order: ForecastOrder, stored: PurchaseOrderForecast | null, layer: ForecastLayer): Draft | null {
  const statusOk = layer === 'BASE' ? order.status === 'BESTELD' || order.status === 'ONDERWEG' : order.status === 'CONCEPT';
  if (!statusOk || order.archived || order.clearance !== 'BE_CUSTOMS' || input.importVatDeferred || order.importVatCovered) return null;
  const vat = toCents(order.importVatEur);
  if (vat <= 0) return null;
  const arrival = arrivalOf(order, stored);
  return {
    key: `importvat:${order.orderId}`, layer, rule: 'containers', kind: 'IMPORT_VAT', certainty: arrival.certainty, ruleDate: arrival.date,
    ruleText: `btw bij invoer · inklaring België · ${arrival.text}${order.clearanceConfirmed ? '' : ' · inklaring te bevestigen'}`,
    amountCents: -vat, deductibleCents: vat, title: `${order.number} · btw bij invoer`, party: 'Douane', orderId: order.orderId,
    source: { type: 'container', orderId: order.orderId },
  };
}

function mondayOfIsoWeek(year: number, week: number): Iso {
  const jan4 = isoOf(year, 1, 4);
  const firstMonday = addDays(jan4, -((weekdayOf(jan4) + 6) % 7));
  return addDays(firstMonday, 7 * (week - 1));
}

function quoteDrafts(quote: ForecastQuote, today: Iso): Draft[] {
  const amount = toCents(quote.amountInclEur);
  if (amount <= 0) return [];
  const vat = toCents(quote.vatEur);
  const base = { layer: 'BASE' as const, rule: 'quotes' as const, kind: 'QUOTE' as const, certainty: 'ESTIMATED' as const,
    title: `Offerte ${quote.number}`, party: quote.party || null, orderId: null, source: { type: 'quote' as const, salesOrderId: quote.salesOrderId } };
  const week = /^(\d{4})-W(\d{2})$/.exec(quote.deliveryWeek ?? '');
  let delivery: Iso;
  let deliveryText: string;
  if (week) { delivery = mondayOfIsoWeek(Number(week[1]), Number(week[2])); deliveryText = `leverweek ${week[2]}`; }
  else if (validIso(quote.deliveryDate)) { delivery = quote.deliveryDate.slice(0, 10); deliveryText = `levering ${dm(delivery)}`; }
  else { delivery = addDays(today, 14); deliveryText = 'geen leverweek · over 2 weken'; }
  const terms = parsePaymentTerms(quote.paymentTerms);
  if (terms.kind === 'prepay') {
    return [{ ...base, key: `quote:${quote.salesOrderId}`, ruleDate: today, ruleText: 'vooruitbetaling · nu', amountCents: amount, vatCents: vat, vatDate: today }];
  }
  if (terms.kind === 'split') {
    const first = Math.round(amount * terms.firstPct / 100);
    const firstVat = Math.round(vat * first / amount);
    return [
      { ...base, key: `quote:${quote.salesOrderId}:1`, ruleDate: today, ruleText: `${terms.firstPct}% bij aanvaarding · nu`, amountCents: first, vatCents: firstVat, vatDate: today },
      { ...base, key: `quote:${quote.salesOrderId}:2`, ruleDate: delivery, ruleText: `${100 - terms.firstPct}% bij levering ${dm(delivery)}`,
        amountCents: amount - first, vatCents: vat - firstVat, vatDate: delivery },
    ];
  }
  const termsText = terms.assumed ? '30 d (geen betaalvoorwaarde)' : (quote.paymentTerms ?? '').trim();
  return [{ ...base, key: `quote:${quote.salesOrderId}`, ruleDate: addDays(delivery, terms.days), ruleText: `${deliveryText} + ${termsText}`,
    amountCents: amount, vatCents: vat, vatDate: delivery }];
}

/** An open invoice on its due date plus the customer's usual delay; overdue ones today. */
function invoiceDraft(invoice: ForecastInvoice, today: Iso): Draft {
  const delay = invoice.partner ? 0 : Math.max(0, Math.round(finite(invoice.delayDays)));
  const due = invoice.dueDate;
  const target = addDays(due, delay);
  const base = { key: `invoice:${invoice.salesOrderId}`, layer: 'BASE' as const, rule: 'invoices' as const,
    kind: (invoice.partner ? 'PARTNER' : 'CUSTOMER') as ForecastKind, amountCents: toCents(invoice.remainingEur),
    title: `${invoice.advance ? 'Voorschotfactuur' : 'Factuur'} ${invoice.number}`, party: invoice.party || null, orderId: null,
    source: { type: 'invoice' as const, salesOrderId: invoice.salesOrderId }, references: [invoice.number],
    pastText: `vervallen ${dm(due)} · nu`, pastCertainty: 'EXPECTED' as ForecastCertainty, ruleDate: target };
  return { ...base, certainty: delay > 0 ? 'ESTIMATED' : 'FIXED',
    ruleText: delay === 0 ? `vervaldag ${dm(due)}` : due >= today ? `vervaldag ${dm(due)} + ${delay} d (betaalt meestal later)`
      : `vervallen ${dm(due)} · betaalt meestal ${delay} d later` };
}

/** Every BASE item except the VAT returns: all rules, all dates (the caller switches rules off). */
function baseItems(input: CashForecastInput): ForecastItem[] {
  const today = input.today;
  const stored = storedMap(input);
  const drafts: Draft[] = [];
  for (const cost of input.openCosts) {
    const amount = -toCents(cost.openEur);
    if (amount === 0) continue;
    const base = { key: `cost:${cost.costId}`, layer: 'BASE' as const, rule: 'costs' as const, kind: 'COST' as const, amountCents: amount,
      title: cost.title, party: cost.party || null, orderId: null, source: { type: 'cost' as const, costId: cost.costId },
      references: cost.reference ? [cost.reference] : undefined };
    drafts.push(cost.dueDate
      ? { ...base, certainty: 'FIXED', ruleDate: cost.dueDate, ruleText: `vervaldag ${dm(cost.dueDate)}`, pastText: `vervallen ${dm(cost.dueDate)} · nu` }
      : { ...base, certainty: 'EXPECTED', ruleDate: cost.date, ruleText: `kostdatum ${dm(cost.date)} · geen vervaldag`, pastText: `kostdatum ${dm(cost.date)} voorbij · nu` });
  }
  for (const row of input.recurring) {
    drafts.push({ key: `recurring:${row.recurringId}:${row.date}`, layer: 'BASE', rule: 'costs', kind: 'RECURRING', certainty: 'FIXED',
      ruleDate: row.date, ruleText: `vaste kost · ${row.intervalLabel.toLowerCase()}${row.autoPaid ? ' · domiciliëring' : ''}`,
      amountCents: -toCents(row.amountInclEur), title: row.name, party: row.party || null, orderId: null, source: { type: 'recurring', recurringId: row.recurringId } });
  }
  const orders = new Map(input.orders.map((order) => [order.orderId, order]));
  for (const row of input.containerRows) {
    if (row.concept) continue;
    const order = orders.get(row.orderId);
    if (!order || toCents(row.remainingEur) <= 0) continue;
    drafts.push(containerDraft(order, row, stored.get(order.orderId) ?? null, today));
  }
  for (const order of input.orders) {
    const draft = importVatDraft(input, order, stored.get(order.orderId) ?? null, 'BASE');
    if (draft) drafts.push(draft);
  }
  for (const invoice of input.invoices) if (toCents(invoice.remainingEur) > 0) drafts.push(invoiceDraft(invoice, today));
  if (toCents(input.openCreditEur) > 0) {
    drafts.push({ key: 'credit', layer: 'BASE', rule: 'invoices', kind: 'CREDIT', certainty: 'FIXED', ruleDate: today, ruleText: 'tegoed af te handelen',
      amountCents: -toCents(input.openCreditEur), title: 'Tegoeden klanten', party: null, orderId: null, source: { type: 'credit' } });
  }
  for (const row of input.advanceRows) {
    const amount = toCents(row.amountInclEur);
    if (amount <= 0) continue;
    const base = { key: `advance:${row.orderId}:${row.rowId}`, layer: 'BASE' as const, rule: 'partner' as const, kind: 'PARTNER' as const,
      amountCents: amount, vatCents: toCents(row.vatEur), vatDate: 'date' as const, title: `${row.orderNumber} · ${row.label}`,
      party: row.party || null, orderId: row.orderId, source: { type: 'advance' as const, orderId: row.orderId, rowId: row.rowId } };
    drafts.push(row.dueDate
      ? { ...base, certainty: 'FIXED', ruleDate: row.dueDate, ruleText: `voorschotschema · vervalt ${dm(row.dueDate)}`,
          pastText: `voorschotschema · vervallen ${dm(row.dueDate)} · nu`, pastCertainty: 'EXPECTED' }
      : { ...base, certainty: 'EXPECTED', ruleDate: today, ruleText: 'voorschotschema · geen vervaldag · nu' });
  }
  for (const quote of input.quotes) drafts.push(...quoteDrafts(quote, today));
  const conversion = Math.max(0, Math.min(100, finite(input.history.openQuoteConversionPct)));
  for (const quote of input.openQuotes) {
    const amount = Math.round(toCents(quote.valueInclEur) * conversion / 100);
    if (amount <= 0 || !validIso(quote.validUntil)) continue;
    drafts.push({ key: `openquote:${quote.salesOrderId}`, layer: 'BASE', rule: 'openQuotes', kind: 'OPEN_QUOTE', certainty: 'ESTIMATED',
      ruleDate: addDays(quote.validUntil, 30), ruleText: `${grouped(conversion)} % kans (12 mnd) · geldig tot ${dm(quote.validUntil)} + 30 d`,
      amountCents: amount, title: `Offerte ${quote.number}`, party: quote.party || null, orderId: null, source: { type: 'quote', salesOrderId: quote.salesOrderId } });
  }
  return drafts.map((draft) => itemOf(draft, today));
}

function storedMap(input: CashForecastInput): Map<number, PurchaseOrderForecast> {
  return new Map((input.stored ?? []).map((row) => [row.orderId, row]));
}

export function compareItems(left: ForecastItem, right: ForecastItem): number {
  return left.date.localeCompare(right.date) || (left.layer === right.layer ? 0 : left.layer === 'BASE' ? -1 : 1)
    || toCents(right.amountEur) - toCents(left.amountEur) || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}

/* ================================================================== VAT */

interface Quarter { year: number; quarter: number }
const quarterOfDay = (day: Iso): Quarter => ({ year: Number(day.slice(0, 4)), quarter: Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1 });
const nextQuarter = (q: Quarter): Quarter => (q.quarter === 4 ? { year: q.year + 1, quarter: 1 } : { year: q.year, quarter: q.quarter + 1 });
const previousQuarter = (q: Quarter): Quarter => (q.quarter === 1 ? { year: q.year - 1, quarter: 4 } : { year: q.year, quarter: q.quarter - 1 });
const quarterKey = (q: Quarter): string => `${q.year}-Q${q.quarter}`;
/** Quarterly filers file and pay by the 25th of the month after the quarter (finance-metrics filingDeadline). */
const filingDeadline = (q: Quarter): Iso => (q.quarter === 4 ? isoOf(q.year + 1, 1, 25) : isoOf(q.year, q.quarter * 3 + 1, 25));
const inQuarter = (day: Iso | null, q: Quarter): boolean => !!day && quarterKey(quarterOfDay(day)) === quarterKey(q);

/** The returns the forecast shows: the previous quarter, the current one, then each later one due within the horizon. */
function vatQuarters(today: Iso, horizonEnd: Iso): Quarter[] {
  const current = quarterOfDay(today);
  const list = [previousQuarter(current), current];
  for (let next = nextQuarter(current); filingDeadline(next) <= horizonEnd; next = nextQuarter(next)) list.push(next);
  return list;
}

/** Each quarter's net (negative = to pay) from what is known and the items in the series; a refund carries forward. */
function vatNets(input: CashForecastInput, quarters: readonly Quarter[], items: readonly ForecastItem[]): number[] {
  const paid = new Set(input.paidVatPeriods ?? []);
  let carry = 0;
  return quarters.map((q, index) => {
    const knownRow = input.vatQuarters.find((row) => row.year === q.year && row.quarter === q.quarter);
    const known = index === 0 ? (filingDeadline(q) >= input.today && !paid.has(quarterKey(q)) ? toCents(knownRow?.knownNetEur) : 0)
      : index === 1 ? toCents(knownRow?.knownNetEur) : 0;
    let net = known + carry;
    for (const item of items) {
      if (item.vatEur > 0 && item.amountEur > 0 && inQuarter(item.vatDate, q)) net -= toCents(item.vatEur);
      if (item.kind === 'IMPORT_VAT' && inQuarter(item.date, q)) net += toCents(item.deductibleVatEur);
    }
    carry = Math.max(0, net);
    return net;
  });
}

function vatRuleText(q: Quarter, index: number): string {
  const head = `aangifte Q${q.quarter} ${q.year}`;
  const deadline = `vóór ${dm(filingDeadline(q))}`;
  return index === 0 ? `${head} · ${deadline}` : index === 1 ? `${head} · tot nu + geschat · ${deadline}` : `${head} · geschat · ${deadline}`;
}

function baseVatItems(input: CashForecastInput, quarters: readonly Quarter[], items: readonly ForecastItem[]): ForecastItem[] {
  const nets = vatNets(input, quarters, items);
  const result: ForecastItem[] = [];
  quarters.forEach((q, index) => {
    if (index === 0 && filingDeadline(q) < input.today) return;
    if (nets[index] >= 0) return;
    result.push(itemOf({ key: `vat:${quarterKey(q)}`, layer: 'BASE', rule: 'vat', kind: 'VAT', certainty: index === 0 ? 'FIXED' : 'ESTIMATED',
      ruleDate: filingDeadline(q), ruleText: vatRuleText(q, index), amountCents: nets[index], title: `Btw-aangifte Q${q.quarter} ${q.year}`,
      party: 'FOD Financiën', orderId: null, source: { type: 'vat', year: q.year, quarter: q.quarter } }, input.today));
  });
  return result;
}

function scenarioVatItems(input: CashForecastInput, quarters: readonly Quarter[], baseSet: readonly ForecastItem[], scenarioSet: readonly ForecastItem[]): ForecastItem[] {
  if (!scenarioSet.length) return [];
  const row = (net: number): number => (net < 0 ? net : 0);
  const base = vatNets(input, quarters, baseSet);
  const withScenario = vatNets(input, quarters, [...baseSet, ...scenarioSet]);
  const result: ForecastItem[] = [];
  quarters.forEach((q, index) => {
    if (index === 0 && filingDeadline(q) < input.today) return;
    const difference = row(withScenario[index]) - row(base[index]);
    if (difference === 0) return;
    result.push(itemOf({ key: `vat:${quarterKey(q)}:scenario`, layer: 'SCENARIO', rule: null, kind: 'VAT', certainty: 'SCENARIO',
      ruleDate: filingDeadline(q), ruleText: `btw op scenarioverkoop · aangifte Q${q.quarter} ${q.year} · vóór ${dm(filingDeadline(q))}`,
      amountCents: difference, title: `Btw-aangifte Q${q.quarter} ${q.year}`, party: 'FOD Financiën', orderId: null,
      source: { type: 'vat', year: q.year, quarter: q.quarter } }, input.today));
  });
  return result;
}

/* ============================================================= scenario */

interface SalesPlan { items: ForecastItem[]; slow: ForecastItem[]; backCents: number; costCents: number; units: number;
  products: PoProductRow[]; window: { from: Iso; to: Iso; weeks: number } | null; seasonal: boolean; }

function unitPriceOf(line: ForecastOrderLine, choice: ResolvedChoice, costUnit: number): number {
  const markup = round4(costUnit * (1 + choice.markupPct / 100));
  if (choice.priceMode === 'EUR_PER_UNIT') return round4(costUnit + choice.markupEurPerUnit);
  if (choice.priceMode === 'LIST') return line.listUnitEur !== null && line.listUnitEur !== undefined ? round4(line.listUnitEur) : markup;
  if (choice.priceMode === 'HISTORIC') {
    const price = line.historicUnitEur ?? line.listUnitEur;
    return price !== null && price !== undefined ? round4(price) : markup;
  }
  return markup;
}

/** The weekly sales of one source from `start`: price per product, spread over the sell weeks, paid after the payment term. */
function salesPlan(input: CashForecastInput, keyBase: string, titleBase: string, orderId: number | null, lines: readonly ForecastOrderLine[],
  choice: ResolvedChoice, start: Iso): SalesPlan {
  const today = input.today;
  const products: PoProductRow[] = [];
  let backCents = 0;
  let costCents = 0;
  let units = 0;
  for (const line of lines) {
    const quantity = finite(line.quantity);
    if (!(quantity > 0)) continue;
    const basis = choice.costBasis === 'PRICING' ? line.pricingEur : line.externalEur;
    const costUnit = round4(finite(basis) / quantity);
    const price = unitPriceOf(line, choice, costUnit);
    const back = lineCents(price, quantity);
    backCents += back;
    costCents += toCents(basis);
    units += quantity;
    products.push({ productId: line.productId, name: line.name, units: quantity, costUnitEur: costUnit, priceUnitEur: price, backEur: toEur(back) });
  }
  const weeks = Math.max(1, choice.sellWeeks);
  const seasonal = choice.seasonal && !!input.history.seasonal;
  if (backCents <= 0) return { items: [], slow: [], backCents, costCents, units, products, window: null, seasonal };
  const saleDays = Array.from({ length: weeks }, (_, index) => addDays(start, 7 * index));
  const weights = saleDays.map((day) => (seasonal ? input.history.seasonal![Number(day.slice(5, 7)) - 1] : 1));
  const excl = distributeCents(backCents, weights);
  const cost = distributeCents(costCents, weights);
  const vatPct100 = Math.round(finite(input.history.vatPct) * 100);
  const source: ForecastSource = orderId === null ? { type: 'stock' } : { type: 'container', orderId };
  const make = (index: number, shift: number): ForecastItem => {
    const sale = addDays(saleDays[index], shift);
    const cash = weekdayOrMonday(addDays(sale, choice.paymentDays));
    const vat = Math.round(excl[index] * vatPct100 / 10000);
    return itemOf({ key: `${keyBase}:${index}`, layer: 'SCENARIO', rule: null, kind: 'SALES', certainty: 'SCENARIO', ruleDate: cash,
      ruleText: `verkoop ${dm(sale)} + ${choice.paymentDays} d betaaltermijn`, amountCents: excl[index] + vat, vatCents: vat, vatDate: sale,
      costCents: cost[index], title: `${titleBase} · verkoop week ${index + 1}/${weeks}`, party: null, orderId, source }, today);
  };
  return {
    items: saleDays.map((_, index) => make(index, 0)), slow: saleDays.map((_, index) => make(index, SLOW_SALES_DAYS)),
    backCents, costCents, units, products, window: { from: saleDays[0], to: saleDays[saleDays.length - 1], weeks }, seasonal,
  };
}

/** Selling starts a week after arrival (never before next week). */
function salesStartOf(order: ForecastOrder, stored: PurchaseOrderForecast | null, today: Iso): Iso {
  return addDays(maxIso(arrivalOf(order, stored).date, today), 7);
}

const STATUS_RANK: Record<ForecastOrder['status'], number> = { ONDERWEG: 0, BESTELD: 1, CONCEPT: 2, ONTVANGEN: 3 };

interface ScenarioResult { sources: ScenarioSource[]; items: ForecastItem[]; slow: ForecastItem[]; }

function scenarioOf(input: CashForecastInput, options: ForecastOptions): ScenarioResult {
  const today = input.today;
  const stored = storedMap(input);
  const sources: ScenarioSource[] = [];
  const items: ForecastItem[] = [];
  const slow: ForecastItem[] = [];
  const inHorizon = (list: readonly ForecastItem[]): number => toEur(sumCents(list.filter((item) => item.date <= options.horizonEnd)));
  const stock = stockLines(input.products);
  if (stock.length) {
    const choice = resolveChoice(null, null, options.defaults, input.history, today, input.products);
    const plan = salesPlan(input, 'sales:stock', 'Huidige voorraad', null, stock, choice, today);
    const included = options.includeStock;
    if (included) { items.push(...plan.items); slow.push(...plan.slow); }
    sources.push({ id: 'stock', label: 'Huidige voorraad', sub: `${grouped(plan.units)} st · verkocht in ${choice.sellWeeks} w`, status: 'STOCK',
      included, locked: false, lockedText: null, choice: { ...choice, included }, units: plan.units, costEur: toEur(plan.costCents),
      backEur: toEur(plan.backCents), cashInHorizonEur: included ? inHorizon(plan.items) : 0 });
  }
  const orders = input.orders.filter((order) => !order.archived && (order.status === 'BESTELD' || order.status === 'ONDERWEG' || order.status === 'CONCEPT'))
    .sort((left, right) => Number(left.partner) - Number(right.partner) || STATUS_RANK[left.status] - STATUS_RANK[right.status]
      || left.number.localeCompare(right.number) || left.orderId - right.orderId);
  for (const order of orders) {
    const own = stored.get(order.orderId) ?? null;
    const label = order.alias ? `${order.number} · ${order.alias}` : order.number;
    const status = order.status as ScenarioSource['status'];
    const units = order.lines.reduce((sum, line) => sum + finite(line.quantity), 0);
    if (order.partner) {
      sources.push({ id: order.orderId, label, sub: 'Partner · Volgt het voorschotschema, geen marge', status, included: false, locked: true,
        lockedText: 'Volgt het voorschotschema, geen marge', choice: null, units,
        costEur: toEur(order.lines.reduce((sum, line) => sum + toCents(line.externalEur), 0)), backEur: 0, cashInHorizonEur: 0 });
      continue;
    }
    const choice = resolveChoice(order, own, options.defaults, input.history, today, input.products);
    const plan = salesPlan(input, `sales:${order.orderId}`, order.number, order.orderId, order.lines, choice, salesStartOf(order, own, today));
    if (choice.included) {
      if (order.status === 'CONCEPT') {
        for (const row of input.containerRows) {
          if (!row.concept || row.orderId !== order.orderId || toCents(row.remainingEur) <= 0) continue;
          const item = itemOf(containerDraft(order, row, own, today), today);
          items.push(item);
          slow.push(item);
        }
        const vat = importVatDraft(input, order, own, 'SCENARIO');
        if (vat) { const item = itemOf(vat, today); items.push(item); slow.push(item); }
      }
      items.push(...plan.items);
      slow.push(...plan.slow);
    }
    const arrival = arrivalOf(order, own).date;
    const sub = order.status === 'CONCEPT' ? `Bestellen ${dMon(orderDayOf(order, own))}`
      : `${order.status === 'ONDERWEG' ? 'Onderweg' : 'Besteld'} · aankomst ${dMon(arrival)}`;
    sources.push({ id: order.orderId, label, sub, status, included: choice.included, locked: false, lockedText: null, choice, units: plan.units || units,
      costEur: toEur(plan.costCents), backEur: toEur(plan.backCents), cashInHorizonEur: choice.included ? inHorizon(plan.items) : 0 });
  }
  return { sources, items, slow };
}

/* ================================================================= core */

interface BasePhase {
  generated: ForecastItem[];
  /** Rules on, before likelyPaid. */
  activeBefore: ForecastItem[];
  matches: LikelyPaidMatch[];
  excluded: ForecastItem[];
  active: ForecastItem[];
}

function isOn(item: ForecastItem, options: ForecastOptions): boolean {
  if (item.kind === 'OPEN_QUOTE') return options.openQuotesOn && !options.rulesOff.includes('openQuotes');
  return item.rule === null || !options.rulesOff.includes(item.rule);
}

function basePhase(input: CashForecastInput, options: ForecastOptions): BasePhase {
  const generated = baseItems(input);
  const activeBefore = generated.filter((item) => isOn(item, options));
  const matches = likelyPaid(activeBefore, input.bankLines, input.today, options.dismissed);
  const matched = new Set(matches.map((match) => match.itemKey));
  return { generated, activeBefore, matches, excluded: activeBefore.filter((item) => matched.has(item.key)),
    active: activeBefore.filter((item) => !matched.has(item.key)) };
}

interface Core {
  input: CashForecastInput; options: ForecastOptions; today: Iso; horizonEnd: Iso;
  base: BasePhase; quarters: Quarter[];
  baseVat: ForecastItem[]; vatMatches: LikelyPaidMatch[]; vatExcluded: ForecastItem[];
  /** BASE series items (all dates). */
  baseSet: ForecastItem[];
  scenario: ScenarioResult; scenarioVat: ForecastItem[]; slowVat: ForecastItem[];
  withSet: ForecastItem[]; slowSet: ForecastItem[];
  absolute: boolean; startCents: number;
  days: Iso[]; baseValues: number[]; withValues: number[]; slowValues: number[];
}

/** Day-end values from today to the horizon: the start plus every item dated on or before that day. */
function seriesOf(startCents: number, items: readonly ForecastItem[], days: readonly Iso[]): number[] {
  const sorted = [...items].sort((left, right) => left.date.localeCompare(right.date));
  const values: number[] = [];
  let running = startCents;
  let at = 0;
  for (const day of days) {
    while (at < sorted.length && sorted[at].date <= day) running += toCents(sorted[at++].amountEur);
    values.push(running);
  }
  return values;
}

function countedAccounts(input: CashForecastInput): ForecastAccount[] {
  return input.accounts.filter((account) => !account.archived && !account.labelOnly && account.countsInCash);
}

function coreOf(input: CashForecastInput, options: ForecastOptions, base: BasePhase = basePhase(input, options)): Core {
  const today = input.today;
  const horizonEnd = maxIso(options.horizonEnd, today);
  const quarters = vatQuarters(today, horizonEnd);
  const vatOn = !options.rulesOff.includes('vat');
  const vatRows = vatOn ? baseVatItems(input, quarters, base.active) : [];
  const usedLines = new Set(base.matches.map((match) => match.lineId));
  const vatMatches = likelyPaid(vatRows, input.bankLines.filter((line) => !usedLines.has(line.id)), today, options.dismissed);
  const vatMatched = new Set(vatMatches.map((match) => match.itemKey));
  const baseVat = vatRows.filter((item) => !vatMatched.has(item.key));
  const baseSet = [...base.active, ...baseVat];
  const scenario = options.scenario ? scenarioOf(input, { ...options, horizonEnd }) : { sources: [], items: [], slow: [] };
  const scenarioVat = scenarioVatItems(input, quarters, base.active, scenario.items);
  const slowVat = scenarioVatItems(input, quarters, base.active, scenario.slow);
  const withSet = [...baseSet, ...scenario.items, ...scenarioVat];
  const slowSet = [...baseSet, ...scenario.slow, ...slowVat];
  const counted = countedAccounts(input);
  const absolute = counted.every((account) => account.currentEur !== null);
  const startCents = absolute ? counted.reduce((sum, account) => sum + toCents(account.currentEur), 0) : 0;
  const days = eachDay(today, horizonEnd);
  return {
    input, options, today, horizonEnd, base, quarters, baseVat, vatMatches, vatExcluded: vatRows.filter((item) => vatMatched.has(item.key)),
    baseSet, scenario, scenarioVat, slowVat, withSet, slowSet, absolute, startCents, days,
    baseValues: seriesOf(startCents, baseSet, days), withValues: seriesOf(startCents, withSet, days), slowValues: seriesOf(startCents, slowSet, days),
  };
}

/** The titles of the two most negative items in the fortnight up to a day, most negative first. */
function causesOf(items: readonly ForecastItem[], day: Iso): string[] {
  const from = addDays(day, -14);
  return items.filter((item) => item.amountEur < 0 && item.date > from && item.date <= day)
    .sort((left, right) => toCents(left.amountEur) - toCents(right.amountEur) || compareItems(left, right))
    .slice(0, 2).map((item) => item.title);
}

function lowestOf(days: readonly Iso[], values: readonly number[], items: readonly ForecastItem[]): Lowest {
  let at = 0;
  for (let index = 1; index < values.length; index++) if (values[index] < values[at]) at = index;
  return { day: days[at], eur: toEur(values[at] ?? 0), causes: days.length ? causesOf(items, days[at]) : [] };
}

function zeroOf(days: readonly Iso[], values: readonly number[]): Iso | null {
  const index = values.findIndex((value) => value < 0);
  return index < 0 ? null : days[index];
}

function tightOf(days: readonly Iso[], values: readonly number[], bufferCents: number, items: readonly ForecastItem[]): TightPeriod[] {
  const runs: { from: number; to: number }[] = [];
  values.forEach((value, index) => {
    if (value >= bufferCents) return;
    const last = runs[runs.length - 1];
    if (last && index - last.to - 1 <= TIGHT_MERGE_GAP_DAYS) last.to = index;
    else runs.push({ from: index, to: index });
  });
  return runs.map((run) => {
    let low = run.from;
    for (let index = run.from + 1; index <= run.to; index++) if (values[index] < values[low]) low = index;
    return { from: days[run.from], to: days[run.to], lowestEur: toEur(values[low]), lowestDay: days[low], causes: causesOf(items, days[low]) };
  });
}

function pinsOf(items: readonly ForecastItem[], horizonEnd: Iso): ForecastPin[] {
  const big = items.filter((item) => item.date <= horizonEnd && Math.abs(toCents(item.amountEur)) >= PIN_MIN_EUR * 100).sort(compareItems);
  const groups: ForecastItem[][] = [];
  for (const item of big) {
    const group = groups[groups.length - 1];
    if (group && daysBetween(group[0].date, item.date) <= 3) group.push(item);
    else groups.push([item]);
  }
  return groups.map((group) => {
    const named = [...group].sort((left, right) => Math.abs(toCents(right.amountEur)) - Math.abs(toCents(left.amountEur)) || compareItems(left, right));
    const label = named.slice(0, 2).map((item) => item.title).join(' · ') + (group.length > 2 ? ` +${group.length - 2}` : '');
    return { from: group[0].date, to: group[group.length - 1].date, label, cents: sumCents(group) };
  }).sort((left, right) => Math.abs(right.cents) - Math.abs(left.cents) || left.from.localeCompare(right.from))
    .slice(0, 4).sort((left, right) => left.from.localeCompare(right.from))
    .map((group, index) => ({ n: index + 1, from: group.from, to: group.to, label: group.label, amountEur: toEur(group.cents) }));
}

const inOutlook = (item: ForecastItem): boolean => item.layer === 'BASE'
  && (item.kind === 'COST' || CONTAINER_KINDS.has(item.kind) || item.kind === 'CREDIT' || item.source.type === 'invoice');

function reconciliationOf(core: Core, excludedAccounts: CashForecast['excludedAccounts']): ForecastReconciliation {
  const { input, options, horizonEnd } = core;
  const outlook = input.outlook;
  const inSeries = core.baseSet.filter((item) => item.date <= horizonEnd);
  const sum = (filter: (item: ForecastItem) => boolean, list: readonly ForecastItem[] = inSeries): number => sumCents(list.filter(filter));
  const startCents = core.absolute ? toCents(outlook.expectedEur) : toCents(outlook.netOpenEur);
  const excluded = new Set([...core.base.excluded, ...core.vatExcluded].map((item) => item.key));
  const switchedOff = core.base.generated.filter((item) => !isOn(item, options));
  const lines: { label: string; cents: number }[] = [
    { label: 'Rekeningen die niet meetellen', cents: core.absolute ? -excludedAccounts.reduce((total, account) => total + toCents(account.eur), 0) : 0 },
    { label: 'Vaste kosten na de eerste 30 dagen', cents: sum((item) => item.kind === 'RECURRING') + toCents(outlook.upcoming30Eur) },
    { label: 'Btw-aangiften', cents: sum((item) => item.kind === 'VAT') },
    { label: 'Btw bij invoer', cents: sum((item) => item.kind === 'IMPORT_VAT') },
    { label: 'Geaccepteerde offertes', cents: sum((item) => item.kind === 'QUOTE') },
    { label: 'Open offertes', cents: sum((item) => item.kind === 'OPEN_QUOTE') },
    { label: 'Partnervoorschotten nog te factureren', cents: sum((item) => item.source.type === 'advance') },
    { label: `Na ${dMon(horizonEnd)}`, cents: -sum((item) => inOutlook(item) && item.date > horizonEnd && !excluded.has(item.key), core.base.active) },
    { label: 'Lijkt al betaald (niet dubbel geteld)', cents: -sum(inOutlook, core.base.excluded) },
    { label: 'Uitgezet in Wat telt mee', cents: -sum(inOutlook, switchedOff) },
  ];
  const kept = lines.filter((line) => line.cents !== 0);
  const endCents = startCents + kept.reduce((total, line) => total + line.cents, 0);
  const seriesEnd = core.baseValues[core.baseValues.length - 1] ?? core.startCents;
  return {
    startLabel: core.absolute ? 'Vooruitblik · als alles betaald en ontvangen is' : 'Vooruitblik · netto open positie', startEur: toEur(startCents),
    lines: kept.map((line) => ({ label: line.label, eur: toEur(line.cents) })), endLabel: `Wat vastligt op ${dMon(horizonEnd)}`,
    endEur: toEur(endCents), seriesEndEur: toEur(seriesEnd), matches: Math.abs(endCents - seriesEnd) < 0.5,
  };
}

interface MonthBank {
  tracks: Map<string, Track>;
  counted: Track[];
}

function monthsOf(core: Core, bank: MonthBank): ForecastMonth[] {
  const { input, today, horizonEnd } = core;
  const from = input.statementsFrom;
  const counted = new Set(bank.counted.map((track) => track.account.key));
  const dayEnd = (day: Iso): number | null => sumOrNull(bank.counted.map((track) => balanceAtDayEnd(track, day, from)));
  const dayStart = (day: Iso): number | null => sumOrNull(bank.counted.map((track) => balanceAtDayStart(track, day, from)));
  const empty = { containersOutEur: 0, containersBackEur: 0, customersOtherEur: 0, vatEur: 0, costsEur: 0, otherEur: 0 };
  const months: ForecastMonth[] = [];

  const pastMonth = (key: string, label: string, start: Iso, end: Iso): ForecastMonth => {
    const cents = { containersOut: 0, customersOther: 0, vat: 0, costs: 0, other: 0, in: 0, out: 0 };
    let count = 0;
    for (const line of input.bankLines) {
      if (!counted.has(line.account) || line.day < start || line.day > end || (from && line.day < from)) continue;
      count += 1;
      for (const part of line.parts) {
        const amount = toCents(part.amountEur);
        if (part.kind === 'INTERNAL') continue;
        if (part.kind === 'CONTAINERS') cents.containersOut += amount;
        else if (part.kind === 'CUSTOMERS') cents.customersOther += amount;
        else if (part.kind === 'VAT') cents.vat += amount;
        else if (part.kind === 'COSTS') cents.costs += amount;
        else cents.other += amount;
        if (amount > 0) cents.in += amount; else cents.out += amount;
      }
    }
    for (const move of input.movements) {
      if (!move.key.startsWith('payment:') || !counted.has(move.account) || move.day < start || move.day > end || (from && move.day < from)) continue;
      count += 1;
      const amount = toCents(move.amountEur);
      cents.customersOther += amount;
      if (amount > 0) cents.in += amount; else cents.out += amount;
    }
    const ends = eachDay(start, end).map((day) => ({ day, value: dayEnd(day) }));
    const known = ends.every((row) => row.value !== null);
    let low = known && ends.length ? ends[0] : null;
    if (known) for (const row of ends) if ((row.value as number) < (low!.value as number)) low = row;
    const begin = dayStart(start);
    const finish = ends.length ? ends[ends.length - 1].value : null;
    return { key, label, past: true, beginEur: begin === null ? null : toEur(begin), containersOutEur: toEur(cents.containersOut), containersBackEur: 0,
      customersOtherEur: toEur(cents.customersOther), vatEur: toEur(cents.vat), costsEur: toEur(cents.costs), otherEur: toEur(cents.other),
      endEur: finish === null ? null : toEur(finish), lowestEur: low ? toEur(low.value as number) : null, lowestDay: low ? low.day : null,
      inEur: toEur(cents.in), outEur: toEur(cents.out), count };
  };

  const futureMonth = (key: string, label: string, start: Iso, end: Iso): ForecastMonth => {
    const first = core.days.indexOf(start);
    const last = core.days.indexOf(end);
    const begin = first <= 0 ? core.startCents : core.withValues[first - 1];
    const cents = { containersOut: 0, containersBack: 0, customersOther: 0, vat: 0, costs: 0, in: 0, out: 0 };
    let count = 0;
    for (const item of core.withSet) {
      if (item.date < start || item.date > end) continue;
      const amount = toCents(item.amountEur);
      count += 1;
      if (CONTAINER_KINDS.has(item.kind)) cents.containersOut += amount;
      else if (item.kind === 'SALES' && item.orderId !== null) cents.containersBack += amount;
      else if (item.kind === 'VAT' || item.kind === 'IMPORT_VAT') cents.vat += amount;
      else if (item.kind === 'COST' || item.kind === 'RECURRING') cents.costs += amount;
      else cents.customersOther += amount;
      if (amount > 0) cents.in += amount; else cents.out += amount;
    }
    let low = first;
    for (let index = first + 1; index <= last; index++) if (core.withValues[index] < core.withValues[low]) low = index;
    return { key, label, past: false, beginEur: toEur(begin), ...empty, containersOutEur: toEur(cents.containersOut),
      containersBackEur: toEur(cents.containersBack), customersOtherEur: toEur(cents.customersOther), vatEur: toEur(cents.vat),
      costsEur: toEur(cents.costs), endEur: toEur(core.withValues[last]), lowestEur: toEur(core.withValues[low]), lowestDay: core.days[low],
      inEur: toEur(cents.in), outEur: toEur(cents.out), count };
  };

  const currentStart = monthStartOf(today);
  const previousStart = addMonths(currentStart, -1);
  const previous = pastMonth(previousStart.slice(0, 7), monthLabel(previousStart), previousStart, monthEndOf(previousStart));
  if (previous.beginEur !== null) months.push(previous);
  const day = (value: Iso): number => Number(value.slice(8, 10));
  months.push(pastMonth(`${today.slice(0, 7)}:past`, `1–${day(today)} ${monthLabel(today)}`, currentStart, today));
  const currentEnd = minIso(monthEndOf(today), horizonEnd);
  months.push(futureMonth(today.slice(0, 7), `${day(today)}–${day(currentEnd)} ${monthLabel(today)}`, today, currentEnd));
  for (let start = addMonths(currentStart, 1); start <= horizonEnd; start = addMonths(start, 1)) {
    const end = minIso(monthEndOf(start), horizonEnd);
    const partial = end < monthEndOf(start);
    months.push(futureMonth(start.slice(0, 7), partial ? `1–${day(end)} ${monthLabel(start)}` : monthLabel(start), start, end));
  }
  return months;
}

function registerOf(core: Core, bank: MonthBank): RegisterRow[] {
  const { input, options, today, horizonEnd } = core;
  const rows: RegisterRow[] = [];
  const currentMonth = today.slice(0, 7);
  const monthKey = (day: Iso, past: boolean): string => (past && day.slice(0, 7) === currentMonth ? `${currentMonth}:past` : day.slice(0, 7));
  const counted = new Set(bank.counted.map((track) => track.account.key));
  const lines = new Map(input.bankLines.map((line) => [line.id, line]));
  const labels = new Map(input.accounts.map((account) => [account.key, account.label]));
  const since = addDays(today, -Math.max(0, options.pastDays));
  const moves = input.movements.filter((move) => counted.has(move.account) && move.day >= since && move.day <= today
    && (!input.statementsFrom || move.day >= input.statementsFrom)).sort(compareMoves).slice(-PAST_REGISTER_ROWS);
  for (const move of moves) {
    const line = move.lineId !== null ? lines.get(move.lineId) : undefined;
    const total = sumOrNull(bank.counted.map((track) => balanceAtPosition(track, move)));
    const label = labels.get(move.account) ?? move.account;
    rows.push({ kind: 'past', key: move.key, date: move.day, title: line?.counterparty || (move.key.startsWith('payment:') ? 'Ontvangst' : 'Banktransactie'),
      sub: [`Bank · ${label}`, line?.reference].filter(Boolean).join(' · '), kindLabel: 'Bank', certaintyLabel: 'Gebeurd',
      amountEur: move.amountEur, balanceEur: total === null ? null : toEur(total), layer: null, item: null, lineId: move.lineId, monthKey: monthKey(move.day, true) });
  }
  rows.push({ kind: 'today', key: 'today', date: today, title: 'Vandaag · berekend saldo', sub: '', kindLabel: '', certaintyLabel: '',
    amountEur: 0, balanceEur: toEur(core.startCents), layer: null, item: null, lineId: null, monthKey: currentMonth });
  let running = core.startCents;
  for (const item of core.withSet.filter((row) => row.date <= horizonEnd).sort(compareItems)) {
    running += toCents(item.amountEur);
    rows.push({ kind: 'future', key: item.key, date: item.date, title: item.title,
      sub: `${KIND_LABEL[item.kind]} · ${CERTAINTY_LABEL[item.certainty]} · ${item.ruleText}`, kindLabel: KIND_LABEL[item.kind],
      certaintyLabel: CERTAINTY_LABEL[item.certainty], amountEur: item.amountEur, balanceEur: toEur(running), layer: item.layer, item,
      lineId: null, monthKey: item.date.slice(0, 7) });
  }
  return rows;
}

/** The forecast both pages show: the bank today, every expected item on its day, the scenario, the checks. */
export function buildCashForecast(input: CashForecastInput, options: ForecastOptions): CashForecast {
  const core = coreOf(input, options);
  const { today, horizonEnd, days } = core;
  const bufferCents = toCents(input.bufferEur);
  const tracks = tracksOf(input.movements, input.accounts, input.statementsFrom);
  const counted = countedAccounts(input);
  const bank: MonthBank = { tracks, counted: counted.map((account) => tracks.get(account.key)).filter((track): track is Track => !!track) };

  const startAccounts = counted.map((account) => {
    const ageDays = account.checkedAt && Number.isFinite(Date.parse(account.checkedAt)) ? Math.max(0, daysBetween(brusselsDay(Date.parse(account.checkedAt)), today)) : null;
    return { key: account.key, label: account.label, eur: account.currentEur, ageDays, stale: ageDays !== null && ageDays > STALE_DAYS };
  });
  const excludedAccounts = input.accounts.filter((account) => !account.archived && !account.labelOnly && !account.countsInCash)
    .map((account) => ({ key: account.key, label: account.label, eur: account.currentEur }));
  const scenarioIn = core.scenario.items.filter((item) => item.kind === 'SALES' && item.date <= horizonEnd);
  const scenarioAfter = core.scenario.items.filter((item) => item.kind === 'SALES' && item.date > horizonEnd);
  const scenarioVatIn = core.scenarioVat.filter((item) => item.date <= horizonEnd);

  const flows = new Map<Iso, { in: number; out: number }>();
  for (const item of core.withSet) {
    const amount = toCents(item.amountEur);
    const flow = flows.get(item.date) ?? { in: 0, out: 0 };
    if (amount > 0) flow.in += amount; else flow.out += amount;
    flows.set(item.date, flow);
  }
  const dayRows: ForecastDay[] = days.map((day, index) => ({ day, baseEur: toEur(core.baseValues[index]), withEur: toEur(core.withValues[index]),
    slowEur: toEur(core.slowValues[index]), inEur: toEur(flows.get(day)?.in ?? 0), outEur: toEur(flows.get(day)?.out ?? 0) }));

  /* Rule totals: every rule's BASE items in the horizon, also the switched-off ones (and the VAT rows computed as if on). */
  const ruleTotals = Object.fromEntries(RULES.map((rule) => [rule, 0])) as Record<ForecastRule, number>;
  const excludedKeys = new Set(core.base.excluded.map((item) => item.key));
  for (const item of core.base.generated) {
    if (item.date > horizonEnd || excludedKeys.has(item.key)) continue;
    const rule: ForecastRule | null = item.kind === 'OPEN_QUOTE' ? 'openQuotes' : item.rule;
    if (rule) ruleTotals[rule] = toEur(toCents(ruleTotals[rule]) + toCents(item.amountEur));
  }
  const vatRows = options.rulesOff.includes('vat') ? baseVatItems(input, core.quarters, core.base.active) : core.baseVat;
  ruleTotals.vat = toEur(sumCents(vatRows.filter((item) => item.date <= horizonEnd)));

  return {
    today, horizonEnd, mode: core.absolute ? 'absolute' : 'relative', bufferEur: toEur(bufferCents),
    startEur: toEur(core.startCents), startAccounts,
    missingAccounts: core.absolute ? [] : counted.filter((account) => account.currentEur === null).map((account) => account.label),
    excludedAccounts,
    items: core.withSet.filter((item) => item.date <= horizonEnd).sort(compareItems),
    likelyPaid: [...core.base.matches, ...core.vatMatches],
    excludedItems: [...core.base.excluded, ...core.vatExcluded].sort(compareItems),
    past: options.pastDays > 0 ? balanceHistory(input.movements, input.accounts, addDays(today, -options.pastDays), addDays(today, -1), input.statementsFrom) : [],
    days: dayRows,
    lowestBase: lowestOf(days, core.baseValues, core.baseSet),
    lowestWith: lowestOf(days, core.withValues, core.withSet),
    lowestSlow: lowestOf(days, core.slowValues, core.slowSet),
    zeroBase: zeroOf(days, core.baseValues), zeroWith: zeroOf(days, core.withValues), zeroSlow: zeroOf(days, core.slowValues),
    tightWith: tightOf(days, core.withValues, bufferCents, core.withSet),
    tightSlow: tightOf(days, core.slowValues, bufferCents, core.slowSet),
    pins: pinsOf(core.withSet, horizonEnd),
    months: monthsOf(core, bank),
    register: registerOf(core, bank),
    ruleTotals,
    scenario: {
      sources: core.scenario.sources,
      salesExclEur: toEur(scenarioIn.reduce((sum, item) => sum + toCents(item.amountEur) - toCents(item.vatEur), 0)),
      salesVatEur: toEur(scenarioIn.reduce((sum, item) => sum + toCents(item.vatEur), 0)),
      inHorizonEur: toEur(sumCents(scenarioIn)),
      vatPaidEur: toEur(-sumCents(scenarioVatIn)),
      marginEur: toEur(scenarioIn.reduce((sum, item) => sum + toCents(item.amountEur) - toCents(item.vatEur) - toCents(item.costEur), 0)),
      afterHorizonEur: toEur(sumCents(scenarioAfter)),
    },
    reconciliation: reconciliationOf(core, excludedAccounts),
    endBaseEur: toEur(core.baseValues[core.baseValues.length - 1]),
    endWithEur: toEur(core.withValues[core.withValues.length - 1]),
    endSlowEur: toEur(core.slowValues[core.slowValues.length - 1]),
  };
}

/* ============================================================ PO sheet */

/** One container on its own, excl. btw: what went out, what still goes out, what the sales bring back and when it is earned back. */
export function poSheet(input: CashForecastInput, options: ForecastOptions, orderId: number): PoSheet | null {
  const order = input.orders.find((row) => row.orderId === orderId);
  if (!order) return null;
  const today = input.today;
  const stored = storedMap(input).get(orderId) ?? null;
  const choice = order.partner ? null : resolveChoice(order, stored, options.defaults, input.history, today, input.products);
  const title = order.alias ? `${order.number} · ${order.alias}` : order.number;
  const outflows = input.containerRows.filter((row) => row.orderId === orderId && toCents(row.remainingEur) > 0)
    .map((row) => itemOf({ ...containerDraft(order, row, stored, today), layer: 'BASE' }, today));
  const outflowKeys = new Set(outflows.map((item) => item.key));
  const base = basePhase(input, options);
  const pool = [...base.activeBefore.filter((item) => !outflowKeys.has(item.key) && item.kind !== 'VAT'), ...outflows];
  const matches = likelyPaid(pool, input.bankLines, today, options.dismissed).filter((match) => outflowKeys.has(match.itemKey));
  const matchOf = new Map(matches.map((match) => [match.itemKey, match]));
  const plan = choice ? salesPlan(input, `sales:${orderId}`, order.number, orderId, order.lines, choice, salesStartOf(order, stored, today)) : null;

  const paidCents = toCents(order.paidEur);
  const outstandingCents = -sumCents(outflows);
  const backCents = plan?.backCents ?? 0;
  const short = (item: ForecastItem): string => item.title.startsWith(`${order.number} · `) ? item.title.slice(order.number.length + 3) : item.title;

  /* Events of the lane: the paid total, the open outflows (a likely-paid one on its line's day), the sales excl. btw on their cash day. */
  const events: { day: Iso; cents: number; outflow: boolean }[] = [];
  const payments = order.payments.filter((payment) => validIso(payment.paidOn));
  if (payments.length && Math.abs(payments.reduce((sum, payment) => sum + toCents(payment.amountEur), 0) - paidCents) <= 2) {
    for (const payment of payments) events.push({ day: payment.paidOn, cents: -toCents(payment.amountEur), outflow: true });
  } else if (paidCents !== 0) {
    events.push({ day: payments.length ? [...payments].sort((left, right) => left.paidOn.localeCompare(right.paidOn))[0].paidOn : today, cents: -paidCents, outflow: true });
  }
  for (const item of outflows) events.push({ day: matchOf.get(item.key)?.day ?? item.date, cents: toCents(item.amountEur), outflow: true });
  for (const item of plan?.items ?? []) events.push({ day: item.date, cents: toCents(item.amountEur) - toCents(item.vatEur), outflow: false });
  events.sort((left, right) => left.day.localeCompare(right.day));

  let breakEvenOn: Iso | null = null;
  if (!order.partner) {
    const lastOutflow = events.filter((event) => event.outflow).map((event) => event.day).sort().pop() ?? null;
    let cumulative = 0;
    for (let index = 0; index < events.length; index++) {
      cumulative += events[index].cents;
      const day = events[index].day;
      if (events[index + 1]?.day === day) continue;
      if (!events[index].outflow && cumulative >= 0 && (!lastOutflow || lastOutflow <= day) && events.slice(0, index + 1).some((event) => !event.outflow)) { breakEvenOn = day; break; }
    }
  }
  const arrival = arrivalOf(order, stored).date;
  const breakEvenText = order.partner ? 'Partnercontainer · volgt het voorschotschema, geen marge'
    : breakEvenOn ? `Terugverdiend op ${wdDMon(breakEvenOn)} · ${Math.round(daysBetween(arrival, breakEvenOn) / 7)} weken na aankomst`
      : 'Nog niet terugverdiend binnen de verkoopperiode';

  const lane: { day: Iso; eur: number }[] = [];
  if (events.length) {
    const last = plan?.items.length ? plan.items[plan.items.length - 1].date : events[events.length - 1].day;
    let cumulative = 0;
    let at = 0;
    for (const day of eachDay(events[0].day, maxIso(last, events[events.length - 1].day))) {
      while (at < events.length && events[at].day <= day) cumulative += events[at++].cents;
      lane.push({ day, eur: toEur(cumulative) });
    }
  }

  const dated: PoFlowRow[] = [];
  for (const payment of order.payments) {
    const status = payment.creditOffset ? 'verrekend tegoed' : payment.lineId !== null
      ? `● ${payment.accountLabel ?? 'op de bank'} · gekoppeld` : 'niet op de bank';
    dated.push({ date: payment.paidOn, approx: false, title: payment.label || PAYEE_LABEL[payment.payee], status, amountEur: toEur(-toCents(payment.amountEur)), kind: 'paid', lineId: payment.lineId });
  }
  for (const item of outflows) {
    const match = matchOf.get(item.key);
    dated.push(match
      ? { date: match.day, approx: false, title: short(item), status: `Lijkt al betaald · ${match.account} ${dm(match.day)}`, amountEur: item.amountEur, kind: 'likely', lineId: match.lineId }
      : { date: item.date, approx: item.certainty !== 'FIXED', title: short(item), status: `Afspraak · ${item.ruleText}`, amountEur: item.amountEur, kind: 'open', lineId: null });
  }
  if (order.partner) {
    for (const row of input.advanceRows.filter((advance) => advance.orderId === orderId)) {
      const due = row.dueDate && row.dueDate >= today ? row.dueDate : today;
      dated.push({ date: due, approx: row.dueDate === null || row.dueDate < today, title: row.label,
        status: row.dueDate ? `Afspraak · voorschotschema · vervalt ${dm(row.dueDate)}` : 'Afspraak · voorschotschema · geen vervaldag',
        amountEur: toEur(toCents(row.amountInclEur) - toCents(row.vatEur)), kind: 'open', lineId: null });
    }
  }
  dated.sort((left, right) => (left.date ?? '').localeCompare(right.date ?? ''));
  const flows: PoFlowRow[] = [...dated,
    { date: null, approx: false, title: 'Enrosed-kost', status: 'intern, geen transactie', amountEur: toEur(toCents(order.internalMarkupEur)), kind: 'internal', lineId: null }];
  const salesWindow = plan?.window && choice ? { ...plan.window, text: `${dMonRange(plan.window.from, plan.window.to)} · ${plan.window.weeks} w · ${plan.seasonal ? 'seizoen' : 'gelijkmatig'} · ${choice.paymentDays} d` } : null;
  if (plan && salesWindow) {
    flows.push({ date: salesWindow.from, approx: true, title: `Verkoop · ${grouped(plan.units)} stuks`, status: salesWindow.text, amountEur: toEur(backCents), kind: 'sales', lineId: null });
  }
  const marginPct = !choice || backCents <= 0 ? 0 : choice.priceMode === 'MARKUP_PCT'
    ? round1(choice.markupPct / (100 + choice.markupPct) * 100) : round1((backCents - (plan?.costCents ?? 0)) / backCents * 100);
  const departure = order.status === 'BESTELD' ? departureOf(order, stored) : null;
  return {
    orderId, title, status: order.status, partner: order.partner,
    netEur: toEur(backCents - paidCents - outstandingCents), breakEvenOn, breakEvenText,
    paidEur: toEur(paidCents), outstandingEur: toEur(outstandingCents), backEur: toEur(backCents), marginPct, choice,
    departure: departure ? { date: departure.date, certainty: departure.certainty, ruleText: departure.text, stored: !!stored?.expectedShipOn } : null,
    lane, flows, likelyPaid: matches, products: plan?.products ?? [], salesWindow,
  };
}

/* ===================================================== order-date hint */

/**
 * For a Concept: the first Monday (within a year) on which ordering keeps
 * the lowest balance of the half year after it above the buffer (or, when
 * even without the order it dips below, no lower than without it).
 */
export function suggestOrderDate(input: CashForecastInput, options: ForecastOptions, orderId: number): OrderDateSuggestion | null {
  const order = input.orders.find((row) => row.orderId === orderId);
  if (!order || order.status !== 'CONCEPT' || order.archived || order.partner) return null;
  const today = input.today;
  const own = storedMap(input).get(orderId) ?? null;
  const blank: PurchaseOrderForecast = { orderId, priceMode: null, markupPct: null, markupEurPerUnit: null, costBasis: null, sellWeeks: null,
    paymentDays: null, seasonal: null, included: null, expectedShipOn: null, orderDateOverride: null, updatedAt: null, actor: null };
  const withOrder = (orderDate: Iso | null): CashForecastInput => ({ ...input,
    stored: [...input.stored.filter((row) => row.orderId !== orderId), { ...(own ?? blank), included: orderDate !== null, orderDateOverride: orderDate ?? own?.orderDateOverride ?? null }] });
  const runOptions = (horizonEnd: Iso): ForecastOptions => ({ ...options, scenario: true, horizonEnd });
  const base = basePhase(input, runOptions(today));
  const lowest = (runInput: CashForecastInput, horizonEnd: Iso): { day: Iso; cents: number } => {
    const core = coreOf(runInput, runOptions(horizonEnd), base);
    let at = 0;
    for (let index = 1; index < core.withValues.length; index++) if (core.withValues[index] < core.withValues[at]) at = index;
    return { day: core.days[at], cents: core.withValues[at] };
  };
  const bufferCents = toCents(input.bufferEur);
  const currentDate = orderDayOf(order, own);
  const current = lowest(withOrder(currentDate), addDays(maxIso(currentDate, today), 182));
  let first = addDays(today, 1);
  while (weekdayOf(first) !== 1) first = addDays(first, 1);
  /* Without the order, one long run covers every candidate's window (later returns only add later items). */
  const lastWindow = addDays(addDays(first, 7 * 51), 182);
  const without = coreOf(withOrder(null), runOptions(lastWindow), base);
  for (let week = 0; week < 52; week++) {
    const candidate = addDays(first, 7 * week);
    const windowEnd = addDays(candidate, 182);
    const reach = without.days.indexOf(windowEnd);
    const floor = Math.min(...without.withValues.slice(0, reach + 1));
    const result = lowest(withOrder(candidate), windowEnd);
    const rule: 'buffer' | 'lowest' = floor >= bufferCents ? 'buffer' : 'lowest';
    if (rule === 'buffer' ? result.cents >= bufferCents : result.cents >= floor) {
      return { orderId, currentDate, currentLowestEur: toEur(current.cents), currentLowestDay: current.day, suggestedDate: candidate, rule };
    }
  }
  return null;
}
