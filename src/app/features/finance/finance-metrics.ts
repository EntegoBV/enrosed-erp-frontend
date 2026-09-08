import type { BankBalance, CompanyCost, Payee, RecurringCost, RecurringInterval } from '../../core/api/models';

/*
 * Pure arithmetic for the Kosten & bank workspace: the rhythm of a recurring
 * cost, what is coming up, what the bank holds, and how the months compare.
 * No runtime imports: the node tests run this file on its own.
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

export function vatOf(row: { amountExclEur: number; vatPct: number | null }): number {
  const pct = finite(row.vatPct);
  return pct > 0 ? round2(finite(row.amountExclEur) * pct / 100) : 0;
}

export function inclOf(row: { amountExclEur: number; vatPct: number | null }): number {
  return round2(finite(row.amountExclEur) + vatOf(row));
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
      rows.push({ definition, date, amountExclEur: finite(definition.amountExclEur), amountInclEur: inclOf(definition) });
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
  const yearlyInclEur = round2(active.reduce((sum, definition) => sum + inclOf(definition) * perYear(definition.interval), 0));
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

export interface AccountBalance {
  account: string;
  date: string;
  balanceEur: number;
  previousEur: number | null;
  deltaEur: number | null;
  readings: number;
}

export interface BankOverview {
  accounts: AccountBalance[];
  /** The latest reading of every account added up. */
  totalEur: number;
  /** The newest reading date, or null without readings. */
  asOf: string | null;
  asOfAt?: string | null;
  timeZone?: string | null;
  /** The total over time: on every reading date, each account at its latest reading up to then. */
  series: { dates: string[]; values: number[] };
}

function orderedBankReadings(balances: readonly BankBalance[]): BankBalance[] {
  const checkpoint = (row: BankBalance): number => row.asOfAt ? Date.parse(row.asOfAt) : new Date(`${row.date}T23:59:59.999`).getTime();
  return [...balances].sort((left, right) => checkpoint(left) - checkpoint(right) || (left.id ?? 0) - (right.id ?? 0));
}

export function latestBankReading(balances: readonly BankBalance[]): BankBalance | null {
  return orderedBankReadings(balances).at(-1) ?? null;
}

/** Same identity rule as bank reconciliation; labels remain human-readable. */
function bankAccountIdentity(value: string): string {
  const key = value.trim().replace(/\s+/g, ' ').toUpperCase();
  return /^[A-Z]{2}[0-9]{2}[A-Z0-9 ]{11,34}$/.test(key) ? key.replace(/ /g, '') : key;
}

export function bankOverview(balances: readonly BankBalance[]): BankOverview {
  const ordered = orderedBankReadings(balances.filter(row => !!bankAccountIdentity(row.account)));
  const perAccount = new Map<string, BankBalance[]>();
  for (const row of ordered) {
    const key = bankAccountIdentity(row.account);
    perAccount.set(key, [...(perAccount.get(key) ?? []), row]);
  }
  const accounts: AccountBalance[] = [...perAccount.values()].map((rows) => {
    const latest = rows[rows.length - 1];
    const previous = rows.length > 1 ? rows[rows.length - 2] : null;
    return {
      account: latest.account.trim().replace(/\s+/g, ' '),
      date: latest.date,
      balanceEur: finite(latest.balanceEur),
      previousEur: previous ? finite(previous.balanceEur) : null,
      deltaEur: previous ? round2(finite(latest.balanceEur) - finite(previous.balanceEur)) : null,
      readings: rows.length,
    };
  }).sort((left, right) => right.balanceEur - left.balanceEur || left.account.localeCompare(right.account));
  const dates = [...new Set(ordered.map((row) => row.date))];
  const running = new Map<string, number>();
  const values: number[] = [];
  let cursor = 0;
  for (const date of dates) {
    while (cursor < ordered.length && ordered[cursor].date <= date) {
      running.set(bankAccountIdentity(ordered[cursor].account), finite(ordered[cursor].balanceEur));
      cursor += 1;
    }
    values.push(round2([...running.values()].reduce((sum, value) => sum + value, 0)));
  }
  return {
    accounts,
    totalEur: round2(accounts.reduce((sum, row) => sum + row.balanceEur, 0)),
    asOf: dates.length ? dates[dates.length - 1] : null,
    ...(ordered.at(-1)?.asOfAt ? { asOfAt: ordered.at(-1)!.asOfAt } : {}),
    ...(ordered.at(-1)?.timeZone ? { timeZone: ordered.at(-1)!.timeZone } : {}),
    series: { dates, values },
  };
}

export interface CashOutlook {
  bankEur: number;
  openCostsEur: number;
  upcomingEur: number;
  openInvoicesEur: number;
  /** The bank after the open and coming costs go out and the open invoices come in. */
  expectedEur: number;
}

export function cashOutlook(bankEur: number, openCostsInclEur: number, upcomingInclEur: number, openInvoicesEur: number): CashOutlook {
  const bank = finite(bankEur);
  const open = finite(openCostsInclEur);
  const upcoming = finite(upcomingInclEur);
  const invoices = finite(openInvoicesEur);
  return { bankEur: bank, openCostsEur: open, upcomingEur: upcoming, openInvoicesEur: invoices, expectedEur: round2(bank - open - upcoming + invoices) };
}

/** A semicolon-separated CSV with a decimal comma, the way a Belgian accountant's Excel opens it. */
export function costsCsv(costs: readonly CompanyCost[], categoryLabel: (code: string) => string): string {
  const cell = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'number' ? value.toFixed(2).replace('.', ',') : String(value);
    return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const header = ['Datum', 'Categorie', 'Omschrijving', 'Aan wie', 'Referentie', 'Bedrag excl. btw', 'Btw %', 'Btw', 'Bedrag incl. btw', 'Betaald op', 'Verkoopkanaal', 'Vaste kost', 'Notities'];
  const lines = [...costs]
    .sort((left, right) => left.date.localeCompare(right.date) || (left.id ?? 0) - (right.id ?? 0))
    .map((cost) => [
      cost.date, categoryLabel(cost.category), cost.description, cost.party, cost.reference,
      finite(cost.amountExclEur), finite(cost.vatPct), vatOf(cost), inclOf(cost), cost.paidOn, cost.salesChannel,
      cost.recurringCostId ? 'ja' : 'nee', cost.notes,
    ].map(cell).join(';'));
  return [header.join(';'), ...lines].join('\r\n');
}

export type MovementKind = 'COST' | 'PURCHASE' | 'INVOICE';

/** One thing the ERP saw move on the bank after the last reading: out is negative, in is positive. */
export interface BankMovement {
  key?: string;
  purchaseOrderId?: number;
  salesOrderId?: number;
  receivedAt?: string;
  timeZone?: string;
  date: string;
  kind: MovementKind;
  label: string;
  detail: string;
  amountEur: number;
}

export interface BankMovements {
  since: string | null;
  rows: BankMovement[];
  outEur: number;
  inEur: number;
  netEur: number;
  /** The last reading plus what moved after it. */
  currentEur: number;
}

export interface PurchasePaymentLike { id?: number; orderId?: number; paidOn: string; amountEur: number; orderNumber: string | null; orderAlias?: string | null; label: string | null; payee?: Payee | null }
export interface PaidInvoice { date: string; number: string; customer: string | null; amountEur: number; id?: number; salesOrderId?: number; purchaseOrderId?: number | null; receivedAt?: string; timeZone?: string; purposeLabel?: string; reference?: string | null }

/**
 * The bank rolled forward from its last reading: costs paid, containers paid
 * and invoices received after that day. Without a reading nothing rolls; the
 * ERP cannot know what was on the account before it was told.
 */
export function movementsSince(since: string | null, bankEur: number, costs: readonly CompanyCost[],
                               payments: readonly PurchasePaymentLike[], invoices: readonly PaidInvoice[], sinceAt?: string | null,
                               sinceTimeZone = 'Europe/Brussels'): BankMovements {
  if (!since) return { since: null, rows: [], outEur: 0, inEur: 0, netEur: 0, currentEur: round2(finite(bankEur)) };
  const rows: BankMovement[] = [];
  for (const cost of costs) {
    if (cost.paidOn && cost.paidOn > since) {
      rows.push({ date: cost.paidOn, kind: 'COST', label: cost.description, detail: cost.party ? `${cost.party} · kost` : 'kost', amountEur: -inclOf(cost) });
    }
  }
  const seenPaymentIds = new Set<number>();
  for (const payment of payments) {
    if (payment.id !== undefined && seenPaymentIds.has(payment.id)) continue;
    if (payment.id !== undefined) seenPaymentIds.add(payment.id);
    if (payment.paidOn > since) {
      const payee = payment.payee === 'LOGISTICS' ? 'Logistiek / douane' : payment.payee === 'SEPARATE' ? 'Aparte kosten'
        : payment.payee === 'OTHER' ? 'Overige ontvanger' : payment.payee === 'SUPPLIER' ? 'Leverancier' : null;
      rows.push({
        date: payment.paidOn, kind: 'PURCHASE',
        key: payment.id !== undefined ? `payment:${payment.id}` : undefined, purchaseOrderId: payment.orderId,
        label: payment.orderNumber ? `Inkoop ${payment.orderNumber}` : 'Inkoopbetaling',
        detail: [payment.orderAlias, payee, payment.label].filter((part): part is string => !!part).join(' · ') || 'inkoop',
        amountEur: -finite(payment.amountEur),
      });
    }
  }
  const seenReceiptIds = new Set<number>();
  for (const invoice of invoices) {
    if (invoice.id !== undefined && seenReceiptIds.has(invoice.id)) continue;
    if (invoice.id !== undefined) seenReceiptIds.add(invoice.id);
    const receiptDay = invoice.receivedAt ? calendarDay(invoice.receivedAt, sinceTimeZone || 'Europe/Brussels') : invoice.date;
    const after = sinceAt && invoice.receivedAt ? Date.parse(invoice.receivedAt) > Date.parse(sinceAt) : receiptDay > since;
    if (after) {
      rows.push({ date: invoice.date, kind: 'INVOICE', label: `Factuur ${invoice.number}`,
        detail: [invoice.customer, invoice.purposeLabel, invoice.reference].filter(Boolean).join(' · ') || 'ontvangen', amountEur: finite(invoice.amountEur),
        key: invoice.id !== undefined ? `receipt:${invoice.id}` : undefined, salesOrderId: invoice.salesOrderId,
        purchaseOrderId: invoice.purchaseOrderId ?? undefined, receivedAt: invoice.receivedAt, timeZone: invoice.timeZone });
    }
  }
  rows.sort((left, right) => right.date.localeCompare(left.date) || (right.receivedAt ?? '').localeCompare(left.receivedAt ?? '') || left.label.localeCompare(right.label));
  const outEur = round2(rows.filter((row) => row.amountEur < 0).reduce((sum, row) => sum - row.amountEur, 0));
  const inEur = round2(rows.filter((row) => row.amountEur > 0).reduce((sum, row) => sum + row.amountEur, 0));
  return { since, rows, outEur, inEur, netEur: round2(inEur - outEur), currentEur: round2(finite(bankEur) + inEur - outEur) };
}

/** Legacy balance readings mean end of their local calendar day, regardless of the receipt entry's zone. */
function calendarDay(instant: string, timeZone: string): string {
  if (!Number.isFinite(Date.parse(instant))) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((row) => row.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
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

export interface QuarterRow { quarter: number; label: string; count: number; exclEur: number; vatEur: number; inclEur: number }

/** The four quarters of a year, the way the VAT return wants them. */
export function vatByQuarter(costs: readonly CompanyCost[], year: number): QuarterRow[] {
  const rows: QuarterRow[] = [1, 2, 3, 4].map((quarter) => ({ quarter, label: `Q${quarter}`, count: 0, exclEur: 0, vatEur: 0, inclEur: 0 }));
  for (const cost of costs) {
    if (Number((cost.date ?? '').slice(0, 4)) !== year) continue;
    const month = Number((cost.date ?? '').slice(5, 7));
    if (!month) continue;
    const row = rows[Math.floor((month - 1) / 3)];
    row.count += 1;
    row.exclEur = round2(row.exclEur + finite(cost.amountExclEur));
    row.vatEur = round2(row.vatEur + vatOf(cost));
    row.inclEur = round2(row.inclEur + inclOf(cost));
  }
  return rows;
}
