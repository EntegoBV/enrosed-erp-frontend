import type { CompanyCost, CostKind, ExpenseType, RecurringCost, RecurringInterval, VatRegime } from '../../core/api/models';

/*
 * Pure arithmetic for the Kosten & bank workspace: the one money rule of a
 * cost (what leaves the bank, what the VAT return shows, what the result
 * counts), the rhythm of a recurring cost, what is coming up, what the bank
 * holds, and how the months compare. The Java side mirrors the money rule in
 * CompanyCost.totalInclEur() / returnVatEur(). No runtime imports: the node
 * tests run this file on its own, and the other pure modules receive money
 * through their inputs or a callback (COST_MONEY) rather than importing it.
 */

export interface IntervalOption { code: RecurringInterval; label: string; perYear: number; hint: string }

export const INTERVALS: readonly IntervalOption[] = [
  { code: 'WEEKLY', label: 'Wekelijks', perYear: 52, hint: 'Elke week op dezelfde weekdag' },
  { code: 'MONTHLY', label: 'Maandelijks', perYear: 12, hint: 'Elke maand op dezelfde dag' },
  { code: 'QUARTERLY', label: 'Per kwartaal', perYear: 4, hint: 'Om de drie maanden' },
  { code: 'HALF_YEARLY', label: 'Halfjaarlijks', perYear: 2, hint: 'Om de zes maanden' },
  { code: 'YEARLY', label: 'Jaarlijks', perYear: 1, hint: 'Eén keer per jaar' },
];

export function intervalLabel(code: RecurringInterval | string | null | undefined): string {
  return INTERVALS.find((option) => option.code === code)?.label ?? 'Periodiek';
}

export function perYear(code: RecurringInterval | string | null | undefined): number {
  return INTERVALS.find((option) => option.code === code)?.perYear ?? 12;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
const finite = (value: number | null | undefined): number => (Number.isFinite(value as number) ? (value as number) : 0);
const pad = (value: number): string => String(value).padStart(2, '0');
const isoOf = (year: number, month: number, day: number): string => `${year}-${pad(month)}-${pad(day)}`;

/* ------------------------------------------------------------ regimes */

export interface VatRegimeDef {
  code: VatRegime;
  label: string;
  hint: string;
  group: 'Belgisch' | 'Verlegd' | 'Geen aftrek' | 'Invoer';
  /** The base goes to 81/82/83 by cost kind. */
  baseGrids: boolean;
  /** Reverse charge: the base is repeated in a detail grid and the VAT is due in 55/56, then deducted in 59. */
  detailGrid: 86 | 87 | 88 | null;
  dueGrid: 55 | 56 | null;
  /** The VAT comes back through grid 59. */
  deductible: boolean;
  /** Counted in the cost totals; import VAT is not a cost. */
  inExpenseTotals: boolean;
}

export const VAT_REGIMES: readonly VatRegimeDef[] = [
  { code: 'BE', label: 'België', hint: 'btw aftrekbaar', group: 'Belgisch', baseGrids: true, detailGrid: null, dueGrid: null, deductible: true, inExpenseTotals: true },
  { code: 'EU_GOODS', label: 'EU · goederen', hint: 'btw verlegd', group: 'Verlegd', baseGrids: true, detailGrid: 86, dueGrid: 55, deductible: true, inExpenseTotals: true },
  { code: 'EU_SERVICES', label: 'EU · dienst', hint: 'btw verlegd (Google, Meta, software uit de EU, beursstand)', group: 'Verlegd', baseGrids: true, detailGrid: 88, dueGrid: 55, deductible: true, inExpenseTotals: true },
  { code: 'NON_EU_SERVICES', label: 'Buiten de EU · dienst', hint: 'btw verlegd (software uit de VS)', group: 'Verlegd', baseGrids: true, detailGrid: 87, dueGrid: 56, deductible: true, inExpenseTotals: true },
  { code: 'FOREIGN_VAT', label: 'Buitenlandse btw', hint: 'op de factuur, hier niet aftrekbaar (hotel, parking in NL)', group: 'Geen aftrek', baseGrids: true, detailGrid: null, dueGrid: null, deductible: false, inExpenseTotals: true },
  { code: 'EXEMPT', label: 'Vrijgesteld', hint: 'verzekering, post, zeevracht van de expediteur', group: 'Geen aftrek', baseGrids: true, detailGrid: null, dueGrid: null, deductible: false, inExpenseTotals: true },
  { code: 'OUT_OF_SCOPE', label: 'Niet in de aangifte', hint: 'bankkosten, boetes, belastingen, lonen', group: 'Geen aftrek', baseGrids: false, detailGrid: null, dueGrid: null, deductible: false, inExpenseTotals: true },
  { code: 'NO_INVOICE', label: 'Bonnetje zonder factuur', hint: 'kasticket, btw niet aftrekbaar', group: 'Geen aftrek', baseGrids: true, detailGrid: null, dueGrid: null, deductible: false, inExpenseTotals: true },
  { code: 'IMPORT_VAT_PAID', label: 'Invoer-btw aan de douane', hint: 'betaald op het douanedocument', group: 'Invoer', baseGrids: false, detailGrid: null, dueGrid: null, deductible: true, inExpenseTotals: false },
];

export const REVERSE_CHARGE: ReadonlySet<string> = new Set(['EU_GOODS', 'EU_SERVICES', 'NON_EU_SERVICES']);

/** The select label of a regime; 'Nog te bepalen' for a cost without one. */
export function regimeLabel(code: string | null | undefined): string {
  if (!code) return 'Nog te bepalen';
  return VAT_REGIMES.find((def) => def.code === code)?.label ?? code;
}

export interface ExpensePreset { code: ExpenseType; label: string; vatPct: number | null; taxPct: number | null; hint?: string }

/** The deductibility presets (BDO table AY 2026); CUSTOM keeps whatever was typed. */
export const EXPENSE_PRESETS: readonly ExpensePreset[] = [
  { code: 'STANDARD', label: 'Volledig aftrekbaar', vatPct: 100, taxPct: 100 },
  { code: 'RESTAURANT', label: 'Restaurant', vatPct: 0, taxPct: 69 },
  { code: 'RECEPTION', label: 'Onthaal', vatPct: 0, taxPct: 50 },
  { code: 'GIFT', label: 'Relatiegeschenk', vatPct: 100, taxPct: 50 },
  { code: 'CAR', label: 'Auto en brandstof', vatPct: 50, taxPct: 100, hint: 'Fiscaal: CO₂-formule · bevestig met de boekhouder' },
  { code: 'MIXED', label: 'Gemengd gebruik', vatPct: 75, taxPct: 100 },
  { code: 'CUSTOM', label: 'Eigen percentage', vatPct: null, taxPct: null },
];

/* -------------------------------------------------------------- money */

/** What the money rule of a cost needs; the inclusive total is there when the cost was entered incl. btw. A recurring definition fits too. */
export interface VatRow {
  amountExclEur: number;
  vatPct: number | null;
  amountInclEur?: number | null;
  vatRegime?: string | null;
  vatDeductiblePct?: number | null;
  costKind?: string | null;
  category?: string | null;
}

const KNOWN_REGIMES = new Set<string>(VAT_REGIMES.map((def) => def.code));
/** The regime of a row; an unknown or missing one behaves as BE for the cash (and reads 'Nog te bepalen' in the return). */
function regimeOf(row: VatRow): VatRegime | null {
  return row.vatRegime && KNOWN_REGIMES.has(row.vatRegime) ? row.vatRegime as VatRegime : null;
}
const cents = (value: number | null | undefined): number => Math.round(finite(value) * 100);
/** The entered inclusive total in cents, when there is one. */
const storedInclCents = (row: VatRow): number | null => (Number.isFinite(row.amountInclEur as number) && (row.amountInclEur as number) !== 0 ? cents(row.amountInclEur) : null);
/** HALF_UP on positive cents, the Java scale-2 rule. */
const vatCents = (exclCents: number, pct: number | null | undefined): number => (finite(pct) > 0 ? Math.round(exclCents * finite(pct) / 100) : 0);

function vatCentsOf(row: VatRow): number {
  const regime = regimeOf(row);
  const excl = cents(row.amountExclEur);
  const incl = storedInclCents(row);
  if (regime === 'EXEMPT' || regime === 'OUT_OF_SCOPE' || regime === 'NO_INVOICE') return 0;
  if (regime === 'IMPORT_VAT_PAID') return Math.max(0, (incl ?? 0) - excl);
  /* Reverse charge: the invoice carries no VAT, the stored total is nulled on save; the rate decides. */
  if (regime !== null && REVERSE_CHARGE.has(regime)) return vatCents(excl, row.vatPct);
  return incl !== null ? incl - excl : vatCents(excl, row.vatPct);
}

/** The VAT the rate gives: the difference when the total was entered (so € 100,00 incl. stays € 100,00), else the rate on the excl. amount; reverse charge from the rate; 0 without VAT. */
export function vatOf(row: VatRow): number {
  return vatCentsOf(row) / 100;
}

function cashCentsOf(row: VatRow): number {
  const regime = regimeOf(row);
  const excl = cents(row.amountExclEur);
  if (regime === 'IMPORT_VAT_PAID') return storedInclCents(row) ?? 0;
  if (regime === null || regime === 'BE' || regime === 'FOREIGN_VAT') return storedInclCents(row) ?? excl + vatCentsOf(row);
  return excl;
}

/** What leaves the bank: the invoice total for a Belgian or foreign-VAT invoice, the excl. amount under reverse charge and without VAT, the VAT itself on an import document. */
export function cashTotalOf(row: VatRow): number {
  return cashCentsOf(row) / 100;
}

/** @deprecated Reads as cashTotalOf; kept as an alias for the older call sites. */
export const inclOf = cashTotalOf;

function returnVatCentsOf(row: VatRow): number {
  const regime = regimeOf(row);
  return regime === null || regime === 'BE' || regime === 'IMPORT_VAT_PAID' || REVERSE_CHARGE.has(regime) ? vatCentsOf(row) : 0;
}

/** What the return shows as VAT (V): Belgian, self-assessed and import VAT; nothing for foreign, exempt or ticket VAT. */
export function returnVatOf(row: VatRow): number {
  return returnVatCentsOf(row) / 100;
}

/** The deductible share, 0–100; import VAT on a customs document is always fully deductible. */
function deductiblePctOf(row: VatRow): number {
  if (regimeOf(row) === 'IMPORT_VAT_PAID') return 100;
  const pct = row.vatDeductiblePct;
  return Number.isFinite(pct as number) ? Math.min(100, Math.max(0, pct as number)) : 100;
}

function deductibleCentsOf(row: VatRow): number {
  return Math.round(returnVatCentsOf(row) * deductiblePctOf(row) / 100);
}

/** Grid 59: the deductible part of the return VAT. */
export function deductibleVatOf(row: VatRow): number {
  return deductibleCentsOf(row) / 100;
}

/** The VAT that stays a cost (and joins the base grid, Notice §161). */
export function nonDeductibleVatOf(row: VatRow): number {
  return (returnVatCentsOf(row) - deductibleCentsOf(row)) / 100;
}

function expenseCentsOf(row: VatRow): number {
  const regime = regimeOf(row);
  if (regime === 'IMPORT_VAT_PAID') return 0;
  if (regime === 'FOREIGN_VAT') return cashCentsOf(row);
  if (regime === 'EXEMPT' || regime === 'OUT_OF_SCOPE' || regime === 'NO_INVOICE') return cents(row.amountExclEur);
  return cents(row.amountExclEur) + returnVatCentsOf(row) - deductibleCentsOf(row);
}

/** What the result analysis and the cost totals count: the excl. amount plus the VAT that is not deductible; foreign VAT in full; import VAT not at all. */
export function expenseOf(row: VatRow): number {
  return expenseCentsOf(row) / 100;
}

/** The base grid a cost feeds: the stored kind, else services, or goods for Materiaal & verpakking. */
export function kindOf(row: VatRow): CostKind {
  const kind = row.costKind;
  if (kind === 'GOODS' || kind === 'SERVICES' || kind === 'INVESTMENT') return kind;
  return (row.category ?? '').trim().toUpperCase() === 'MATERIAAL' ? 'GOODS' : 'SERVICES';
}

export function isInvestment(row: VatRow): boolean {
  return kindOf(row) === 'INVESTMENT';
}

/** What is still to pay: the server's figure, else (older responses, blank drafts) the whole cash total until a paid date. Never reads paidOn to decide 'open' when the server spoke. */
export function openOf(cost: Pick<CompanyCost, 'openEur' | 'paidOn'> & VatRow): number {
  if (Number.isFinite(cost.openEur as number)) return cents(cost.openEur) / 100;
  return cost.paidOn ? 0 : cashTotalOf(cost);
}

/** What was paid: the server's sum, else the whole cash total once a paid date is there. */
export function paidOf(cost: Pick<CompanyCost, 'paidEur' | 'paidOn'> & VatRow): number {
  if (Number.isFinite(cost.paidEur as number)) return cents(cost.paidEur) / 100;
  return cost.paidOn ? cashTotalOf(cost) : 0;
}

/** The money rule handed to the pure modules that may not import this one at runtime. */
export const COST_MONEY = { cashTotalOf, returnVatOf, expenseOf, openOf } as const;
export type CostMoney = typeof COST_MONEY;

/* ----------------------------------------------------------- quarters */

export function quarterOf(date: string): { year: number; quarter: 1 | 2 | 3 | 4 } {
  const year = Number((date ?? '').slice(0, 4));
  const month = Number((date ?? '').slice(5, 7)) || 1;
  return { year, quarter: (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4 };
}

export function quarterRange(year: number, quarter: number): { from: string; to: string } {
  const first = (quarter - 1) * 3 + 1;
  const lastDay = new Date(Date.UTC(year, first + 2, 0)).getUTCDate();
  return { from: isoOf(year, first, 1), to: isoOf(year, first + 2, lastDay) };
}

/** Quarterly filers file and pay by the 25th of the month after the quarter (since 2025). */
export function filingDeadline(year: number, quarter: number): string {
  return quarter === 4 ? isoOf(year + 1, 1, 25) : isoOf(year, quarter * 3 + 1, 25);
}

/** The return to open without a period in the address: the last closed quarter. */
export function defaultReturnPeriod(today: string): { year: number; quarter: number } {
  const { year, quarter } = quarterOf(today);
  return quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: quarter - 1 };
}

/* -------------------------------------------------------- return lines */

/** One cost as the VAT return reads it: its quarter and the grid amounts it feeds. */
export interface ReturnLine {
  costId: number | null;
  date: string;
  year: number;
  quarter: number;
  regime: VatRegime | null;
  confirmed: boolean;
  kind: CostKind;
  investment: boolean;
  baseGrid: '81' | '82' | '83' | null;
  baseEur: number;
  /** The amount excl. VAT as booked: what 'Nog te bepalen' shows and the CSV writes for a cost without a regime. */
  exclEur: number;
  detailGrid: '86' | '87' | '88' | null;
  detailEur: number;
  dueGrid: '55' | '56' | null;
  dueEur: number;
  deductibleEur: number;
  /** Created after the quarter's filing date: 'na indiening'. */
  lateBooked: boolean;
  /** A deduction without its invoice or customs document. */
  needsDocument: boolean;
  /** Investments: the deduction stays provisional until this day. */
  revisionUntil: string | null;
  description: string;
  party: string | null;
  reference: string | null;
}

const BASE_GRID: Readonly<Record<CostKind, '81' | '82' | '83'>> = { GOODS: '81', SERVICES: '82', INVESTMENT: '83' };

export function returnLineOf(cost: CompanyCost, documented: boolean): ReturnLine {
  const { year, quarter } = quarterOf(cost.date);
  const regime = regimeOf(cost);
  const def = regime ? VAT_REGIMES.find((row) => row.code === regime) ?? null : null;
  const kind = kindOf(cost);
  const investment = kind === 'INVESTMENT';
  const excl = cents(cost.amountExclEur);
  const baseCents = !def?.baseGrids ? 0
    : regime === 'FOREIGN_VAT' ? cashCentsOf(cost)
    : regime === 'EXEMPT' || regime === 'NO_INVOICE' ? excl
    : excl + returnVatCentsOf(cost) - deductibleCentsOf(cost);
  const deadline = Date.parse(`${filingDeadline(year, quarter)}T23:59:59`);
  const createdAt = cost.createdAt ? Date.parse(cost.createdAt) : Number.NaN;
  const deductible = regime ? deductibleCentsOf(cost) : 0;
  return {
    costId: cost.id, date: cost.date, year, quarter, regime, confirmed: !!regime && !!cost.vatRegimeConfirmed, kind, investment,
    baseGrid: def?.baseGrids ? BASE_GRID[kind] : null, baseEur: baseCents / 100, exclEur: excl / 100,
    detailGrid: def?.detailGrid ? String(def.detailGrid) as '86' | '87' | '88' : null, detailEur: def?.detailGrid ? excl / 100 : 0,
    dueGrid: def?.dueGrid ? String(def.dueGrid) as '55' | '56' : null, dueEur: def?.dueGrid ? returnVatCentsOf(cost) / 100 : 0,
    deductibleEur: deductible / 100,
    lateBooked: Number.isFinite(createdAt) && createdAt > deadline,
    needsDocument: !documented && !cost.recurringCostId && deductible > 0,
    revisionUntil: investment && regime ? revisionUntil(cost.depreciationStart || cost.date) : null,
    description: cost.description, party: cost.party ?? null, reference: cost.reference ?? null,
  };
}

/* --------------------------------------------------------- depreciation */

export interface DepreciationAsset { acquisitionEur: number; years: number; start: string }

/** What is capitalised: the excl. amount plus the VAT that is not deductible (foreign VAT in full). */
export function acquisitionValueOf(cost: VatRow): number {
  return expenseOf(cost);
}

/** Movable goods: the deduction is revised until the end of the fourth year after the first use. */
export function revisionUntil(start: string): string {
  return `${Number(start.slice(0, 4)) + 4}-12-31`;
}

const DAY = 86_400_000;
const utc = (day: string): number => Date.parse(`${day}T00:00:00Z`);
/** Whole days of [from, to) ∩ [start, end), both ends exclusive on the right. */
const overlapDays = (from: number, to: number, start: number, end: number): number => Math.max(0, Math.round((Math.min(to, end) - Math.max(from, start)) / DAY));
const daysInYear = (year: number): number => Math.round((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY);

function lifeOf(asset: DepreciationAsset): { start: number; end: number; years: number } {
  const years = Number.isInteger(asset.years) && asset.years >= 1 ? asset.years : 1;
  const [year, month, day] = asset.start.split('-').map(Number);
  return { start: utc(asset.start), end: Date.UTC(year + years, month - 1, day), years };
}

/** Linear, pro rata by days per calendar year; the last year takes what is left so the schedule sums to the acquisition value. */
export function depreciationSchedule(asset: DepreciationAsset): { year: number; eur: number }[] {
  const life = lifeOf(asset);
  const acquisition = cents(asset.acquisitionEur);
  const annuity = Math.round(acquisition / life.years);
  const firstYear = new Date(life.start).getUTCFullYear();
  const lastYear = new Date(life.end - DAY).getUTCFullYear();
  const rows: { year: number; eur: number }[] = [];
  let charged = 0;
  for (let year = firstYear; year <= lastYear; year++) {
    const share = year === lastYear ? acquisition - charged
      : Math.round(annuity * overlapDays(Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1), life.start, life.end) / daysInYear(year));
    charged += share;
    rows.push({ year, eur: share / 100 });
  }
  return rows;
}

/** The charge of a window (both ends inclusive, null = open): each year's charge weighed by the days the window covers of that year's life. */
export function depreciationIn(asset: DepreciationAsset, from: string | null, to: string | null): number {
  const life = lifeOf(asset);
  const windowStart = from ? utc(from) : Number.NEGATIVE_INFINITY;
  const windowEnd = to ? utc(to) + DAY : Number.POSITIVE_INFINITY;
  let total = 0;
  for (const row of depreciationSchedule(asset)) {
    const yearStart = Date.UTC(row.year, 0, 1);
    const yearEnd = Date.UTC(row.year + 1, 0, 1);
    const lifeDays = overlapDays(yearStart, yearEnd, life.start, life.end);
    if (!lifeDays) continue;
    const covered = overlapDays(Math.max(yearStart, windowStart), Math.min(yearEnd, windowEnd), life.start, life.end);
    total += row.eur * covered / lifeDays;
  }
  return round2(total);
}

/** What a cost charges a period with: its expense when made in it, or, for an investment, its depreciation of the period. */
export function costChargeIn(cost: CompanyCost, from: string | null, to: string | null, today: string | null = null): { expenseEur: number; depreciationEur: number } {
  if (isInvestment(cost)) {
    const years = Number.isInteger(cost.depreciationYears) && (cost.depreciationYears as number) >= 1 ? cost.depreciationYears as number : 5;
    /* Never beyond today: an open-ended or future window ('Alle jaren') charges the days elapsed, not the years to come. */
    const until = today && (!to || to > today) ? today : to;
    return { expenseEur: 0, depreciationEur: depreciationIn({ acquisitionEur: acquisitionValueOf(cost), years, start: cost.depreciationStart || cost.date }, from, until) };
  }
  const inPeriod = (!from || cost.date >= from) && (!to || cost.date <= to);
  return { expenseEur: inPeriod ? expenseOf(cost) : 0, depreciationEur: 0 };
}

/** Whether the form should suggest booking as an investment: from the threshold on, not one yet, and in a regime with a base grid. */
export function suggestInvestment(cost: VatRow, thresholdEur = 250): boolean {
  const regime = regimeOf(cost);
  const def = VAT_REGIMES.find((row) => row.code === (regime ?? 'BE'));
  return finite(cost.amountExclEur) >= thresholdEur && !isInvestment(cost) && !!def?.baseGrids;
}

/** The date `days` after an ISO day, without any time zone getting in the way. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return isoOf(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** The n-th step from a start, months counted from the start so the 31st never drifts to the 28th for good: the server's rule. */
export function stepDate(start: string, interval: RecurringInterval, times: number): string {
  if (interval === 'WEEKLY') return addDays(start, 7 * times);
  const [year, month, day] = start.split('-').map(Number);
  const months = interval === 'MONTHLY' ? times : interval === 'QUARTERLY' ? 3 * times : interval === 'HALF_YEARLY' ? 6 * times : 12 * times;
  const total = month - 1 + months;
  const targetYear = year + Math.floor(total / 12);
  const targetMonth = ((total % 12) + 12) % 12 + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return isoOf(targetYear, targetMonth, Math.min(day, lastDay));
}

type Schedule = Pick<RecurringCost, 'interval' | 'startDate' | 'endDate'>;

/** Every occurrence of a schedule inside a window (both ends inclusive), honouring the end date. */
export function occurrencesBetween(schedule: Schedule, from: string, to: string): string[] {
  const dates: string[] = [];
  if (!schedule.startDate || !schedule.interval || to < from) return dates;
  for (let index = 0; index < 20_000; index++) {
    const date = stepDate(schedule.startDate, schedule.interval, index);
    if (schedule.endDate && date > schedule.endDate) break;
    if (date > to) break;
    if (date >= from) dates.push(date);
  }
  return dates;
}

/**
 * How many periods the server books the moment a definition is saved: from
 * its first date (a new one) or its next date (a paused one being resumed)
 * up to and including today. The server's bookDue runs on create and update.
 */
export function previewBacklog(definition: Schedule & Pick<RecurringCost, 'id' | 'nextDate'>, today: string): number {
  const from = definition.id && definition.nextDate ? definition.nextDate : definition.startDate;
  return from && from <= today ? occurrencesBetween(definition, from, today).length : 0;
}

export interface UpcomingCost {
  definition: RecurringCost;
  date: string;
  amountExclEur: number;
  amountInclEur: number;
}

/** What the active definitions will still book from a day up to a horizon, soonest first. Already booked periods (before nextDate) are skipped. */
export function upcomingRecurring(definitions: readonly RecurringCost[], from: string, to: string): UpcomingCost[] {
  const rows: UpcomingCost[] = [];
  for (const definition of definitions) {
    if (!definition.active) continue;
    if (definition.nextDate === null && definition.lastBookedOn) continue;
    const start = definition.nextDate && definition.nextDate > from ? definition.nextDate : from;
    for (const date of occurrencesBetween(definition, start, to)) {
      rows.push({ definition, date, amountExclEur: finite(definition.amountExclEur), amountInclEur: cashTotalOf(definition) });
    }
  }
  return rows.sort((left, right) => left.date.localeCompare(right.date) || left.definition.name.localeCompare(right.definition.name));
}

export function yearlyEur(definition: Pick<RecurringCost, 'amountExclEur' | 'interval'>): number {
  return round2(finite(definition.amountExclEur) * perYear(definition.interval));
}

export function monthlyEquivalentEur(definition: Pick<RecurringCost, 'amountExclEur' | 'interval'>): number {
  return round2(yearlyEur(definition) / 12);
}

export interface RecurringSummary {
  activeCount: number;
  pausedCount: number;
  endedCount: number;
  /** Every active, unfinished definition, weighed to a year, excluding VAT. */
  yearlyExclEur: number;
  monthlyExclEur: number;
  yearlyInclEur: number;
}

export function recurringSummary(definitions: readonly RecurringCost[]): RecurringSummary {
  const active = definitions.filter((definition) => definition.active && !(definition.nextDate === null && definition.lastBookedOn));
  const pausedCount = definitions.filter((definition) => !definition.active).length;
  const yearlyExclEur = round2(active.reduce((sum, definition) => sum + yearlyEur(definition), 0));
  const yearlyInclEur = round2(active.reduce((sum, definition) => sum + cashTotalOf(definition) * perYear(definition.interval), 0));
  return {
    activeCount: active.length,
    pausedCount,
    endedCount: definitions.length - active.length - pausedCount,
    yearlyExclEur,
    monthlyExclEur: round2(yearlyExclEur / 12),
    yearlyInclEur,
  };
}

export interface MonthSeries {
  /** The first day of each month, oldest first. */
  dates: string[];
  /** YYYY-MM keys in the same order. */
  months: string[];
  values: number[];
}

/** The costs per month for the last `count` months up to a day, months without costs at zero, oldest first. Excluding VAT. */
export function monthlyCostSeries(costs: readonly CompanyCost[], count: number, today: string): MonthSeries {
  const [year, month] = today.split('-').map(Number);
  const months: string[] = [];
  for (let back = count - 1; back >= 0; back--) {
    const total = month - 1 - back;
    const targetYear = year + Math.floor(total / 12);
    const targetMonth = ((total % 12) + 12) % 12 + 1;
    months.push(`${targetYear}-${pad(targetMonth)}`);
  }
  const sums = new Map<string, number>(months.map((key) => [key, 0]));
  for (const cost of costs) {
    const key = (cost.date ?? '').slice(0, 7);
    if (sums.has(key)) sums.set(key, round2((sums.get(key) ?? 0) + finite(cost.amountExclEur)));
  }
  return { months, dates: months.map((key) => `${key}-01`), values: months.map((key) => sums.get(key) ?? 0) };
}

export interface YearMonthRow { month: number; thisYearEur: number; lastYearEur: number }

/** Each month of a year against the same month a year earlier, January first. Excluding VAT. */
export function yearComparison(costs: readonly CompanyCost[], year: number): YearMonthRow[] {
  const rows: YearMonthRow[] = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, thisYearEur: 0, lastYearEur: 0 }));
  for (const cost of costs) {
    const costYear = Number((cost.date ?? '').slice(0, 4));
    const month = Number((cost.date ?? '').slice(5, 7));
    if (!month) continue;
    if (costYear === year) rows[month - 1].thisYearEur = round2(rows[month - 1].thisYearEur + finite(cost.amountExclEur));
    if (costYear === year - 1) rows[month - 1].lastYearEur = round2(rows[month - 1].lastYearEur + finite(cost.amountExclEur));
  }
  return rows;
}

export interface CashOutlook {
  bankEur: number;
  openCostsEur: number;
  upcomingEur: number;
  openInvoicesEur: number;
  /** Open credit-note tegoeden: money that goes back, already taken off openInvoicesEur. */
  openCreditEur: number;
  /** Container terms due now and later: forecasts from the reconciliation, incl. nothing else. */
  containerNowEur: number;
  containerLaterEur: number;
  /** The bank after everything due now has gone out: open costs, the coming recurring costs and the container terms due now. */
  afterPayablesEur: number;
  /** Then the open invoices come in and the later container terms go out. */
  expectedEur: number;
  /** Without a bank reading: what comes in minus everything that still goes out. */
  netOpenEur: number;
}

export function cashOutlook(bankEur: number, openCostsInclEur: number, upcomingInclEur: number, openInvoicesEur: number,
                            containerNowEur = 0, containerLaterEur = 0, openCreditEur = 0): CashOutlook {
  const bank = finite(bankEur);
  const open = finite(openCostsInclEur);
  const upcoming = finite(upcomingInclEur);
  const credit = Math.max(0, finite(openCreditEur));
  const invoices = round2(finite(openInvoicesEur) - credit);
  const containerNow = finite(containerNowEur);
  const containerLater = finite(containerLaterEur);
  const afterPayablesEur = round2(bank - open - upcoming - containerNow);
  return {
    bankEur: bank, openCostsEur: open, upcomingEur: upcoming, openInvoicesEur: invoices, openCreditEur: credit,
    containerNowEur: containerNow, containerLaterEur: containerLater, afterPayablesEur,
    expectedEur: round2(afterPayablesEur + invoices - containerLater),
    netOpenEur: round2(invoices - open - upcoming - containerNow - containerLater),
  };
}

export interface RecurringGroups {
  active: RecurringCost[];
  paused: RecurringCost[];
  ended: RecurringCost[];
}

/**
 * Definitions as the server sees them: an ended schedule comes back
 * inactive with no next date, so it is ended, not paused.
 */
export function recurringGroups(definitions: readonly RecurringCost[], today: string): RecurringGroups {
  const groups: RecurringGroups = { active: [], paused: [], ended: [] };
  for (const definition of definitions) {
    const ended = !definition.nextDate && (!!definition.lastBookedOn || (!!definition.endDate && definition.endDate < today));
    if (ended) groups.ended.push(definition);
    else if (definition.active) groups.active.push(definition);
    else groups.paused.push(definition);
  }
  return groups;
}

const KIND_LABEL: Readonly<Record<CostKind, string>> = { GOODS: 'Goederen', SERVICES: 'Diensten', INVESTMENT: 'Investering' };

/** The regime columns every cost CSV carries: regime, country, kind, the two deductible percentages and the useful life. */
export function costRegimeCells(cost: CompanyCost): (string | number | null)[] {
  return [regimeLabel(cost.vatRegime), cost.supplierCountry ?? null, KIND_LABEL[kindOf(cost)],
    finite(cost.vatDeductiblePct ?? 100), finite(cost.taxDeductiblePct ?? 100), isInvestment(cost) && cost.depreciationYears ? String(cost.depreciationYears) : null];
}

/** A semicolon-separated CSV with a decimal comma, the way a Belgian accountant's Excel opens it; 'Btw' is what the return shows, the total what the bank paid. */
export function costsCsv(costs: readonly CompanyCost[], categoryLabel: (code: string) => string, channelLabel: (code: string) => string = (code) => code): string {
  const cell = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'number' ? value.toFixed(2).replace('.', ',') : String(value);
    return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const header = ['Datum', 'Categorie', 'Omschrijving', 'Aan wie', 'Referentie', 'Bedrag excl. btw', 'Btw %', 'Btw', 'Bedrag incl. btw', 'Betaald op', 'Verkoopkanaal', 'Vaste kost',
    'Btw-regeling', 'Land', 'Soort', 'Btw aftrekbaar %', 'Fiscaal aftrekbaar %', 'Investering (jaren)', 'Notities'];
  const lines = [...costs]
    .sort((left, right) => left.date.localeCompare(right.date) || (left.id ?? 0) - (right.id ?? 0))
    .map((cost) => [
      cost.date, categoryLabel(cost.category), cost.description, cost.party, cost.reference,
      finite(cost.amountExclEur), finite(cost.vatPct), returnVatOf(cost), cashTotalOf(cost), cost.paidOn, cost.salesChannel ? channelLabel(cost.salesChannel) : null,
      cost.recurringCostId ? 'ja' : 'nee', ...costRegimeCells(cost), cost.notes,
    ].map(cell).join(';'));
  return [header.join(';'), ...lines].join('\r\n');
}

export interface PartyRow { party: string; count: number; exclEur: number; sharePct: number }

/** Who got the most, excluding VAT; costs without a party count under "Zonder naam". */
export function topParties(costs: readonly CompanyCost[], limit = 8): PartyRow[] {
  const total = costs.reduce((sum, cost) => sum + finite(cost.amountExclEur), 0);
  const map = new Map<string, PartyRow>();
  for (const cost of costs) {
    const party = (cost.party ?? '').trim() || 'Zonder naam';
    const row = map.get(party) ?? { party, count: 0, exclEur: 0, sharePct: 0 };
    row.count += 1;
    row.exclEur = round2(row.exclEur + finite(cost.amountExclEur));
    map.set(party, row);
  }
  return [...map.values()]
    .map((row) => ({ ...row, sharePct: total > 0 ? round2(row.exclEur / total * 100) : 0 }))
    .sort((left, right) => right.exclEur - left.exclEur || left.party.localeCompare(right.party))
    .slice(0, limit);
}

/** The biggest single costs, excluding VAT. */
export function largestCosts(costs: readonly CompanyCost[], limit = 8): CompanyCost[] {
  return [...costs].sort((left, right) => finite(right.amountExclEur) - finite(left.amountExclEur) || left.date.localeCompare(right.date)).slice(0, limit);
}


/* -------------------------------------------------- reverse charge, container difference */

/**
 * The VAT of a reverse-charge cost ("verlegd"): it is in the return on both
 * sides and never leaves the bank, so a strip that wants Excl + Btw = Incl
 * shows it apart. 0 for every other regime.
 */
export function reverseChargeOf(row: VatRow): number {
  const regime = regimeOf(row);
  return regime !== null && REVERSE_CHARGE.has(regime) ? vatCentsOf(row) / 100 : 0;
}

/** What the difference of a container needs: the three figures on screen and the payee streams. */
export interface ContainerDifferenceSource {
  totals: { plannedExternalEur: number; paidEur: number; remainingEur: number };
  streams: readonly { payee: string; plannedEur: number; paidEur: number; remainingEur: number }[];
}

/** open − (afspraak − betaald), split: moreEur for the payees with an Afspraak (+ meer, − minder betaald), otherEur for Bijkomende kosten. */
export interface ContainerDifference { diffEur: number; moreEur: number; otherEur: number }

/**
 * "Verschil € 4.959,42 meer": why Afspraak − Betaald ≠ Open on a container.
 * Per payee the difference is remaining − (planned − paid). Bijkomende
 * kosten (OTHER) have no Afspraak, so what was paid there shows on its own
 * line; any rest (credits, rounding) joins the supplier, so moreEur +
 * otherEur always equals open − (afspraak − betaald) and the screen closes.
 */
export function meerBetaaldOf(source: ContainerDifferenceSource): ContainerDifference {
  const diff = cents(source.totals.remainingEur) - (cents(source.totals.plannedExternalEur) - cents(source.totals.paidEur));
  const other = source.streams.filter((stream) => stream.payee === 'OTHER')
    .reduce((sum, stream) => sum + cents(stream.remainingEur) - (cents(stream.plannedEur) - cents(stream.paidEur)), 0);
  return { diffEur: diff / 100, moreEur: (diff - other) / 100, otherEur: other / 100 };
}
