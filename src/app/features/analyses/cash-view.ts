import type { PartnerFinancing, PurchaseOrderForecast, PurchaseOrderForecastWrite } from '../../core/api/models';
import type { CashChartMarker, CashChartSeries } from '../../shared/cash-chart';
import type {
  CashForecast, CashForecastInput, ForecastItem, ForecastMonth, ForecastPin, ForecastRule, Iso, OrderDateSuggestion, RegisterRow,
} from '../finance/cash-forecast';
import { CERTAINTY_LABEL, containerDates } from '../finance/cash-forecast';
import { dayMon, dayMonth, eur, eurWhole, monthShort, weekdayDayMonth } from '../finance/cash-format';
import type { CashLocation } from './cash-url';

/*
 * The texts and groupings of Analyses › Kasprognose, kept out of the
 * components so one test reads them (tests/cash-view.test.mts, through a
 * transpile harness: this module imports cash-format and cash-forecast at
 * runtime). Every figure comes from buildCashForecast; nothing here
 * computes money of its own beyond sums of what it shows.
 */

const MONTH_NAMES = ['Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni', 'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December'];
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥'];
const cents = (value: number | null | undefined): number => Math.round((typeof value === 'number' && Number.isFinite(value) ? value : 0) * 100);
const euros = (value: number): number => (value === 0 ? 0 : value / 100);
const sameMonth = (left: Iso, right: Iso): boolean => left.slice(0, 7) === right.slice(0, 7);

/** '1–13 dec', '8 jan–4 mrt', '28 jan' (one day). */
export function periodText(from: Iso, to: Iso): string {
  if (from === to) return dayMon(from);
  return sameMonth(from, to) ? `${Number(from.slice(8, 10))}–${dayMon(to)}` : `${dayMon(from)}–${dayMon(to)}`;
}

/** 'van 1 tot 13 dec', 'van 8 jan tot 4 mrt' (the phone banner). */
export function fromToText(from: Iso, to: Iso): string {
  return sameMonth(from, to) ? `van ${Number(from.slice(8, 10))} tot ${dayMon(to)}` : `van ${dayMon(from)} tot ${dayMon(to)}`;
}

/** Keeps an amount on one line inside a sentence ('€ 7.173' never breaks after the euro sign). */
export function keepAmounts(text: string): string {
  return text.replace(/− € /g, '−\u00a0€\u00a0').replace(/€ /g, '€\u00a0');
}

/** Signed whole euros for differences: '+ € 82.019', '− € 61.007', '€ 0'. */
export function signedWhole(value: number): string {
  const text = eurWhole(value);
  return Math.round(value) > 0 ? `+ ${text}` : text;
}

/** A month group's name: 'Oktober', 'Januari ’27' when the year is not today's. */
export function monthName(key: string, today: Iso): string {
  const name = MONTH_NAMES[Number(key.slice(5, 7)) - 1] ?? key;
  return key.slice(0, 4) === today.slice(0, 4) ? name : `${name} ’${key.slice(2, 4)}`;
}

/* ------------------------------------------------------------------ banner */

export interface KrapBanner { kind: 'tight' | 'slow' | 'relative'; text: string; from: Iso | null; to: Iso | null; }

/** The desk banner: the first krap period with the scenario, else the first of the slow band; the relative mode replaces it. */
export function krapBanner(forecast: CashForecast): KrapBanner | null {
  if (forecast.mode === 'relative') {
    return { kind: 'relative', text: `Saldo ontbreekt voor ${forecast.missingAccounts.join(', ')}: de prognose toont het verschil t.o.v. vandaag.`, from: null, to: null };
  }
  const zero = forecast.zeroBase ? ` Zonder nieuwe verkoop onder nul vanaf ${weekdayDayMonth(forecast.zeroBase)}.` : '';
  const tight = forecast.tightWith[0];
  if (tight) {
    const causes = tight.causes.length ? `, na ${tight.causes[0]}${tight.causes[1] ? ` en ${tight.causes[1]}` : ''}` : '';
    return { kind: 'tight', from: tight.from, to: tight.to,
      text: keepAmounts(`Krap van ${dayMon(tight.from)} tot ${dayMon(tight.to)}: laagste stand ${eurWhole(tight.lowestEur)} op ${weekdayDayMonth(tight.lowestDay)}${causes}.${zero}`) };
  }
  const slow = forecast.tightSlow[0];
  if (slow) {
    return { kind: 'slow', from: slow.from, to: slow.to,
      text: keepAmounts(`Als de verkoop 4 weken trager loopt: krap van ${dayMon(slow.from)} tot ${dayMon(slow.to)}, laagste stand ${eurWhole(slow.lowestEur)} op ${weekdayDayMonth(slow.lowestDay)}.${zero}`) };
  }
  return null;
}

/** The phone banner: shorter, the same period. */
export function phoneKrapBanner(forecast: CashForecast): KrapBanner | null {
  const desk = krapBanner(forecast);
  if (!desk || desk.kind === 'relative') return desk;
  const period = desk.kind === 'tight' ? forecast.tightWith[0] : forecast.tightSlow[0];
  const lead = desk.kind === 'slow' ? 'Bij 4 weken tragere verkoop krap' : 'Krap';
  return { ...desk, text: keepAmounts(`${lead} ${fromToText(period.from, period.to)}. Laagste stand ${eurWhole(period.lowestEur)} op ${weekdayDayMonth(period.lowestDay)}.`) };
}

/* -------------------------------------------------------------------- KPIs */

export interface KpiCard { id: 'bank' | 'lowest' | 'end' | 'zero' | 'scenario'; label: string; value: string; sub: string; foot: string;
  footWarn: boolean; valueTone: 'normal' | 'ok' | 'warn' | 'danger';
  /** 'text' for a value in words ("Blijft boven nul"): it may wrap (critique B2). */
  kind?: 'text'; }

function checkedText(forecast: CashForecast): { text: string; warn: boolean } {
  const stale = forecast.startAccounts.find((account) => account.stale);
  if (stale) return { text: `Saldo ${stale.label} · ${stale.ageDays} d oud`, warn: true };
  const ages = forecast.startAccounts.map((account) => account.ageDays).filter((age): age is number => age !== null);
  if (!ages.length) return { text: 'Nog geen saldocontrole', warn: true };
  const oldest = Math.max(...ages);
  return { text: oldest === 0 ? 'Gecontroleerd vandaag' : `Gecontroleerd ${oldest} d geleden`, warn: false };
}

/** The tight periods as one short text: '1–13 dec, 28 jan', at most three. */
export function periodsText(periods: readonly { from: Iso; to: Iso }[]): string {
  const shown = periods.slice(0, 3).map((period) => periodText(period.from, period.to));
  return shown.join(', ') + (periods.length > 3 ? ` +${periods.length - 3}` : '');
}

/** The five cards of §4.2 (whole euros). */
export function kpiCards(forecast: CashForecast): KpiCard[] {
  const end = dayMon(forecast.horizonEnd);
  const checked = checkedText(forecast);
  const relative = forecast.mode === 'relative';
  const included = forecast.scenario.sources.filter((source) => source.included && !source.locked).length;
  return [
    { id: 'bank', label: 'Op de bank vandaag', value: relative ? '—' : eurWhole(forecast.startEur),
      sub: relative ? `Saldo ontbreekt: ${forecast.missingAccounts.join(', ')}` : forecast.startAccounts.map((account) => `${account.label} ${eurWhole(account.eur)}`).join(' · '),
      foot: checked.text, footWarn: checked.warn, valueTone: 'normal' },
    { id: 'lowest', label: 'Laagste stand', value: eurWhole(forecast.lowestWith.eur), sub: `${weekdayDayMonth(forecast.lowestWith.day)} · met scenario`,
      foot: relative ? 'verschil t.o.v. vandaag' : forecast.tightWith.length ? `Onder buffer · ${periodsText(forecast.tightWith)}` : 'Boven de buffer',
      footWarn: !relative && forecast.tightWith.length > 0,
      valueTone: forecast.lowestWith.eur < 0 ? 'danger' : underBuffer(forecast, forecast.lowestWith.eur) ? 'warn' : 'normal' },
    { id: 'end', label: `Op ${end}`, value: eurWhole(forecast.endWithEur), sub: 'met scenario',
      foot: `T.o.v. vandaag ${signedWhole(forecast.endWithEur - forecast.startEur)}`, footWarn: false, valueTone: forecast.endWithEur < 0 ? 'danger' : 'normal' },
    { id: 'zero', label: 'Zonder nieuwe verkoop', value: forecast.zeroBase ? dayMon(forecast.zeroBase) : relative ? 'Niet lager dan vandaag' : 'Blijft boven nul',
      kind: forecast.zeroBase ? undefined : 'text',
      sub: forecast.zeroBase ? (relative ? 'lager dan vandaag vanaf die dag' : 'onder nul vanaf die dag') : '', foot: `Op ${end} ${eurWhole(forecast.endBaseEur)}`, footWarn: false,
      valueTone: forecast.zeroBase ? 'danger' : 'normal' },
    { id: 'scenario', label: 'Scenario binnen', value: `+ ${eurWhole(forecast.scenario.inHorizonEur)}`, sub: `tot ${end} · incl. btw`,
      foot: `Marge op goederen ${eurWhole(forecast.scenario.marginEur)} · ${included} ${included === 1 ? 'bron' : 'bronnen'}`, footWarn: false,
      valueTone: forecast.scenario.inHorizonEur > 0 ? 'ok' : 'normal' },
  ];
}

/* ------------------------------------------------------------- chart parts */

export const SERIES_LABEL = { balance: 'Saldo: bank, daarna prognose met scenario', base: 'Wat vastligt (zonder nieuwe verkoop)', slow: 'Verkoop 4 weken trager' } as const;

/** The lines of "Saldo per dag": the bank's last `pastDays` days running into the forecast with the scenario, what is fixed, the slow band. */
export function forecastSeries(forecast: CashForecast, pastDays: number): CashChartSeries[] {
  const from = forecast.past.length > pastDays ? forecast.past.length - pastDays : 0;
  const past = forecast.past.slice(from).map((point) => ({ day: point.day, eur: point.eur }));
  if (past.length && forecast.mode === 'absolute') past.push({ day: forecast.today, eur: forecast.startEur });
  return [
    { id: 'past', label: SERIES_LABEL.balance, points: past, style: 'solid', tone: 'accent' },
    { id: 'with', label: SERIES_LABEL.balance, points: forecast.days.map((day) => ({ day: day.day, eur: day.withEur })), style: 'solid', tone: 'accent' },
    { id: 'base', label: SERIES_LABEL.base, points: forecast.days.map((day) => ({ day: day.day, eur: day.baseEur })), style: 'dashed', tone: 'muted' },
    { id: 'slow', label: SERIES_LABEL.slow, points: forecast.days.map((day) => ({ day: day.day, eur: day.slowEur })), style: 'dashed', tone: 'warn' },
  ];
}

/** The buffer and its krap periods mean nothing while the forecast only knows differences (relative mode). */
export function chartBuffer(forecast: CashForecast): { bufferEur: number | null; tight: { from: Iso; to: Iso }[] } {
  return forecast.mode === 'relative' ? { bufferEur: null, tight: [] } : { bufferEur: forecast.bufferEur, tight: forecast.tightWith };
}

/**
 * Whether a balance is under the buffer (amber). Never in relative mode: the
 * figures are differences from today there, so the buffer means nothing (the
 * chart drops it for the same reason). Below zero stays the danger tone.
 */
export function underBuffer(forecast: Pick<CashForecast, 'mode' | 'bufferEur'>, eur: number | null | undefined): boolean {
  return forecast.mode !== 'relative' && typeof eur === 'number' && eur < forecast.bufferEur;
}

/**
 * The labelled points: the lowest with the scenario, where the fixed line crosses zero, both ends (one when they are
 * the same). `short` is the phone's narrow chart: the labels keep the figure and the day, the figures under the chart
 * say the rest ("Laagste € 2.124", "Onder nul · 3 jan"), so they find room next to their points.
 */
export function forecastMarkers(forecast: CashForecast, ends = true, short = false): CashChartMarker[] {
  const markers: CashChartMarker[] = [
    { day: forecast.lowestWith.day, eur: forecast.lowestWith.eur, kind: 'lowest',
      label: short ? `Laagste ${eurWhole(forecast.lowestWith.eur)}` : `Laagste ${eurWhole(forecast.lowestWith.eur)} · ${weekdayDayMonth(forecast.lowestWith.day)}` },
  ];
  if (forecast.zeroBase) {
    const day = forecast.days.find((row) => row.day === forecast.zeroBase);
    const words = forecast.mode === 'relative' ? short ? 'Lager dan vandaag' : 'Zonder verkoop lager dan vandaag' : short ? 'Onder nul' : 'Zonder verkoop onder nul';
    if (day) markers.push({ day: day.day, eur: day.baseEur, kind: 'zero', label: `${words} · ${short ? dayMon(day.day) : weekdayDayMonth(day.day)}` });
  }
  if (ends) {
    markers.push({ day: forecast.horizonEnd, eur: forecast.endWithEur, kind: 'end', label: eurWhole(forecast.endWithEur) });
    if (cents(forecast.endBaseEur) !== cents(forecast.endWithEur)) {
      markers.push({ day: forecast.horizonEnd, eur: forecast.endBaseEur, kind: 'end', label: `${eurWhole(forecast.endBaseEur)} vastligt` });
    }
  }
  return markers;
}

/** '① PO-2026-041 · Saldo bij aankomst · 18–20 nov · − € 20.100'. */
export function pinLegend(pins: readonly ForecastPin[]): string[] {
  return pins.map((pin) => `${CIRCLED[pin.n - 1] ?? `${pin.n}.`} ${pin.label} · ${periodText(pin.from, pin.to)} · ${signedWhole(pin.amountEur)}`);
}

/** The tooltip lines of a day: its items, largest first. */
export function dayItems(forecast: CashForecast, day: Iso): string[] {
  return forecast.items.filter((item) => item.date === day)
    .sort((left, right) => Math.abs(cents(right.amountEur)) - Math.abs(cents(left.amountEur)))
    .map((item) => `${item.title} ${signedWhole(item.amountEur)}`);
}

export interface StripColumn { key: string; label: string; endEur: number | null; inEur: number; outEur: number; lowestEur: number | null;
  lowestDay: Iso | null; lowWarn: boolean; current: boolean; }

/** One column per month from the current one (its past and future parts together) to the horizon. */
export function monthStrip(forecast: CashForecast): StripColumn[] {
  const currentKey = forecast.today.slice(0, 7);
  const past = forecast.months.find((month) => month.key === `${currentKey}:past`);
  const columns: StripColumn[] = [];
  for (const month of forecast.months) {
    if (month.past) continue;
    const current = month.key === currentKey;
    let inEur = month.inEur;
    let outEur = month.outEur;
    let lowestEur = month.lowestEur;
    let lowestDay = month.lowestDay;
    if (current && past) {
      inEur = euros(cents(inEur) + cents(past.inEur));
      outEur = euros(cents(outEur) + cents(past.outEur));
      if (past.lowestEur !== null && (lowestEur === null || past.lowestEur < lowestEur)) { lowestEur = past.lowestEur; lowestDay = past.lowestDay; }
    }
    columns.push({ key: month.key, label: monthShort(month.key), endEur: month.endEur, inEur, outEur, lowestEur, lowestDay,
      lowWarn: underBuffer(forecast, lowestEur), current });
  }
  return columns;
}

/* ---------------------------------------------------------------- register */

export type RegisterFilter = 'all' | 'in' | 'out' | 'containers' | 'scenario' | 'estimated';
export interface RegisterGroup { key: string; label: string; rows: RegisterRow[]; inEur: number; outEur: number; lowestEur: number | null;
  endEur: number | null; lowWarn: boolean; }

export function matchesFilter(row: RegisterRow, filter: RegisterFilter): boolean {
  const item = row.item;
  if (!item) return filter === 'all';
  switch (filter) {
    case 'in': return item.amountEur > 0;
    case 'out': return item.amountEur < 0;
    case 'containers': return item.source.type === 'container';
    case 'scenario': return item.layer === 'SCENARIO';
    case 'estimated': return item.certainty === 'ESTIMATED';
    default: return true;
  }
}

export function filterCounts(forecast: CashForecast): Record<RegisterFilter, number> {
  const future = forecast.register.filter((row) => row.kind === 'future');
  const count = (filter: RegisterFilter) => future.filter((row) => matchesFilter(row, filter)).length;
  return { all: future.length, in: count('in'), out: count('out'), containers: count('containers'), scenario: count('scenario'), estimated: count('estimated') };
}

/** The future rows per month, filtered; a month's in and out read the rows shown, lowest and end the balance. */
export function registerGroups(forecast: CashForecast, filter: RegisterFilter, period: { from: Iso; to: Iso } | null): RegisterGroup[] {
  const months = new Map(forecast.months.filter((month) => !month.past).map((month) => [month.key, month]));
  const groups = new Map<string, RegisterGroup>();
  for (const row of forecast.register) {
    if (row.kind !== 'future' || !matchesFilter(row, filter)) continue;
    if (period && (row.date < period.from || row.date > period.to)) continue;
    const month: ForecastMonth | undefined = months.get(row.monthKey);
    const group = groups.get(row.monthKey) ?? { key: row.monthKey, label: monthName(row.monthKey, forecast.today), rows: [], inEur: 0, outEur: 0,
      lowestEur: month?.lowestEur ?? null, endEur: month?.endEur ?? null, lowWarn: underBuffer(forecast, month?.lowestEur) };
    group.rows.push(row);
    if (row.amountEur > 0) group.inEur = euros(cents(group.inEur) + cents(row.amountEur)); else group.outEur = euros(cents(group.outEur) + cents(row.amountEur));
    groups.set(row.monthKey, group);
  }
  return [...groups.values()];
}

/** The month line in three parts, so the page can mark 'laagste' amber under the buffer (`lowWarn`). */
export function groupSummaryParts(group: RegisterGroup): { lead: string; lowest: string; end: string } {
  const n = group.rows.length;
  return { lead: `${n} ${n === 1 ? 'beweging' : 'bewegingen'} · in ${eurWhole(group.inEur)} · uit ${eurWhole(group.outEur)} · `,
    lowest: `laagste ${eurWhole(group.lowestEur)}`, end: ` · einde ${eurWhole(group.endEur)}` };
}

/** '4 bewegingen · in € 8.319 · uit − € 20.435 · laagste € 46.296 · einde € 46.296' (the name goes in front). */
export function groupSummary(group: RegisterGroup): string {
  const parts = groupSummaryParts(group);
  return `${parts.lead}${parts.lowest}${parts.end}`;
}

/** The phone row's second line: 'di 20 okt · Vaste kost · vast'. */
export function phoneRowSub(row: RegisterRow): string {
  return row.kind === 'past' ? `${weekdayDayMonth(row.date)} · ${row.sub}` : `${weekdayDayMonth(row.date)} · ${row.kindLabel} · ${row.certaintyLabel.toLowerCase()}`;
}

const csvCell = (value: string): string => (/[;"\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
const csvAmount = (value: number | null): string => (value === null ? '' : (cents(value) / 100).toFixed(2).replace('.', ','));
const csvDay = (day: Iso): string => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

/** 'Datum;Omschrijving;Soort;Zekerheid;Regel;Bedrag;Saldo', one line per row shown (past rows and items; not the today divider). */
export function registerCsv(rows: readonly RegisterRow[]): string {
  const lines = ['Datum;Omschrijving;Soort;Zekerheid;Regel;Bedrag;Saldo'];
  for (const row of rows) {
    if (row.kind === 'today') continue;
    const party = row.item?.party && row.item.party !== row.title ? ` · ${row.item.party}` : '';
    lines.push([csvDay(row.date), `${row.title}${party}`, row.kindLabel, row.certaintyLabel, row.item ? row.item.ruleText : row.sub,
      csvAmount(row.amountEur), csvAmount(row.balanceEur)].map(csvCell).join(';'));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/* ------------------------------------------------------------------- links */

export interface CashLink { path: (string | number)[]; query: Record<string, string | number> | null; po: number | null; }

/** Where a forecast row leads (spec §1.5); a container's sales open its sheet. */
export function itemLink(item: ForecastItem): CashLink | null {
  const source = item.source;
  switch (source.type) {
    case 'cost': return { path: ['/costs'], query: { cost: source.costId }, po: null };
    case 'recurring': return { path: ['/costs'], query: { view: 'costs', tab: 'recurring' }, po: null };
    case 'container': return item.kind === 'SALES' ? { path: [], query: null, po: source.orderId } : { path: ['/costs'], query: { container: source.orderId }, po: null };
    case 'tica': return { path: ['/tica'], query: { settlement: source.settlementId }, po: null };
    case 'invoice': return { path: ['/sales', source.salesOrderId], query: null, po: null };
    case 'quote': return { path: ['/sales', source.salesOrderId], query: null, po: null };
    case 'vat': return { path: ['/costs'], query: { view: 'analysis', tab: 'vat', year: source.year, quarter: source.quarter }, po: null };
    case 'advance': return { path: ['/purchasing', source.orderId], query: { section: 'payments' }, po: null };
    case 'credit': return { path: ['/costs'], query: { view: 'incoming' }, po: null };
    default: return null;
  }
}

export function lineLink(lineId: number): CashLink {
  return { path: ['/costs'], query: { view: 'bank', tab: 'movements', line: lineId }, po: null };
}

/* ------------------------------------------------------------ data quality */

export interface QualityLine { text: string; action: string; link: CashLink | null; po: number | null; warn: boolean; }

const countedKeys = (input: CashForecastInput): Set<string> => new Set(input.accounts.filter((account) => !account.archived && !account.labelOnly && account.countsInCash).map((account) => account.key));

/** Unlinked, unclassified bank lines of the active accounts (the "Te koppelen" of Kosten & bank). */
export function unlinkedLines(input: CashForecastInput): { count: number; eur: number } {
  const active = new Set(input.accounts.filter((account) => !account.archived && !account.labelOnly).map((account) => account.key));
  const lines = input.bankLines.filter((line) => active.has(line.account) && !line.allocated && line.classification == null);
  return { count: lines.length, eur: euros(lines.reduce((sum, line) => sum + cents(line.amountEur), 0)) };
}

/** The lines under "Aansluiting met de Vooruitblik" that say what makes the forecast less sure. */
export function dataQuality(input: CashForecastInput, forecast: CashForecast): QualityLine[] {
  const lines: QualityLine[] = [];
  if (input.ticaVatIncomplete) lines.push({ text: 'TICA-btw nog onvolledig: verkopen zonder geboekte afrekening. Alleen bevestigde creditnota’s tellen in de btw-prognose.',
    action: 'Afrekeningen controleren', link: { path: ['/tica'], query: null, po: null }, po: null, warn: true });
  for (const account of forecast.startAccounts) {
    if (!account.stale) continue;
    lines.push({ text: `${account.label}: saldo ${account.ageDays} d niet gecontroleerd.`, action: 'Controleren', po: null, warn: true,
      link: { path: ['/costs'], query: { view: 'bank', tab: 'movements', account: account.key }, po: null } });
  }
  const unlinked = unlinkedLines(input);
  if (unlinked.count) {
    lines.push({ text: `${unlinked.count} ${unlinked.count === 1 ? 'banktransactie' : 'banktransacties'} nog te koppelen.`, action: 'Koppelen', po: null, warn: true,
      link: { path: ['/costs'], query: { view: 'bank', tab: 'movements', link: 'unlinked' }, po: null } });
  }
  const stored = new Map((input.stored ?? []).map((row) => [row.orderId, row]));
  for (const order of input.orders) {
    if (order.archived || order.status !== 'BESTELD') continue;
    const departure = containerDates(order, stored.get(order.orderId) ?? null).departure;
    if (departure.certainty !== 'ESTIMATED') continue;
    lines.push({ text: `${order.number}: vertrek geschat (${departure.text}).`, action: 'Datum', po: order.orderId, link: null, warn: false });
  }
  const undated = input.openCosts.filter((cost) => cost.dueDate === null && cost.openEur >= 1000);
  if (undated.length) {
    lines.push({ text: `${undated.length} open ${undated.length === 1 ? 'kost' : 'kosten'} zonder vervaldag.`, action: 'Bekijken', po: null, warn: false,
      link: { path: ['/costs'], query: { view: 'open', tab: 'costs' }, po: null } });
  }
  return lines;
}

/* ------------------------------------------------------------ rule switches */

export interface RuleSwitch { rule: ForecastRule; label: string; sub: string; totalEur: number; on: boolean; }

export function ruleSwitches(forecast: CashForecast, location: CashLocation, conversionPct: number): RuleSwitch[] {
  const on = (rule: Exclude<ForecastRule, 'openQuotes'>) => !location.rulesOff.includes(rule);
  return [
    { rule: 'invoices', label: 'Open facturen', sub: 'op vervaldag, plus wat de klant gewoonlijk later betaalt', totalEur: forecast.ruleTotals.invoices, on: on('invoices') },
    { rule: 'tica', label: 'TICA-afrekeningen', sub: 'netto-uitbetaling na commissie, op vervaldag', totalEur: forecast.ruleTotals.tica ?? 0, on: on('tica') },
    { rule: 'quotes', label: 'Geaccepteerde offertes', sub: 'leverweek + betaalvoorwaarde van de klant', totalEur: forecast.ruleTotals.quotes, on: on('quotes') },
    { rule: 'openQuotes', label: 'Open offertes', sub: `waarde × ${Math.round(conversionPct)} % conversie (12 mnd)`, totalEur: forecast.ruleTotals.openQuotes, on: location.openQuotesOn },
    { rule: 'partner', label: 'Partnervoorschotten', sub: 'vervaldagen uit het voorschotschema', totalEur: forecast.ruleTotals.partner, on: on('partner') },
    { rule: 'containers', label: 'Containertermijnen', sub: 'open bedrag per termijn; vertrek = aankomst − transit', totalEur: forecast.ruleTotals.containers, on: on('containers') },
    { rule: 'costs', label: 'Kosten en vaste kosten', sub: 'vervaldag of kostdatum; domiciliëringen op hun dag', totalEur: forecast.ruleTotals.costs, on: on('costs') },
    { rule: 'vat', label: 'Btw-aangiften', sub: 'op de 25e na het kwartaal, ook op scenarioverkoop', totalEur: forecast.ruleTotals.vat, on: on('vat') },
  ];
}

/** '6 van 7 regels aan · open offertes uit'. */
export function ruleSummary(switches: readonly RuleSwitch[]): string {
  const on = switches.filter((row) => row.on).length;
  const open = switches.find((row) => row.rule === 'openQuotes')?.on;
  return `${on} van ${switches.length} regels aan · open offertes ${open ? 'aan' : 'uit'}`;
}

/* ----------------------------------------------------------------- scenario */

/** One scenario VAT row of the outcome: `eur` is never negative, `op` says which way it goes. */
export interface ScenarioVatRow { label: string; op: '−' | '+'; eur: number; }
export interface ScenarioOutcome { salesExclEur: number; salesVatEur: number; inHorizonEur: number; vatRows: ScenarioVatRow[];
  /** The rows together as cash: negative = paid to the returns, positive = less to pay (a concept's import VAT outweighs the sales VAT). */
  vatEur: number; vatNote: string | null; marginEur: number; marginPct: number | null; afterHorizonEur: number; }

/**
 * "Uitkomst tot {d mmm}": the scenario's sales, the VAT they send to the
 * returns in the horizon, the margin and what comes later. A scenario VAT
 * row is the difference a return makes with the scenario; it lowers the
 * return when an included concept's import VAT outweighs the sales VAT.
 */
export function scenarioOutcome(forecast: CashForecast): ScenarioOutcome {
  const scenario = forecast.scenario;
  const vatItems = forecast.items.filter((item) => item.layer === 'SCENARIO' && item.kind === 'VAT' && item.date <= forecast.horizonEnd);
  const vatRows = vatItems.map((item): ScenarioVatRow => {
    const quarter = item.source.type === 'vat' ? ` (aangifte Q${item.source.quarter}, ${dayMon(item.date)})` : '';
    return cents(item.amountEur) > 0 ? { label: `Btw minder af te dragen${quarter}`, op: '+', eur: item.amountEur }
      : { label: `Btw afgedragen${quarter}`, op: '−', eur: euros(-cents(item.amountEur)) };
  });
  return {
    salesExclEur: scenario.salesExclEur, salesVatEur: scenario.salesVatEur, inHorizonEur: scenario.inHorizonEur, vatRows,
    vatEur: euros(vatItems.reduce((sum, item) => sum + cents(item.amountEur), 0)),
    vatNote: vatRows.length ? null : `na ${dayMon(forecast.horizonEnd)}`,
    marginEur: scenario.marginEur, marginPct: scenario.salesExclEur > 0 ? Math.round(scenario.marginEur / scenario.salesExclEur * 1000) / 10 : null,
    afterHorizonEur: scenario.afterHorizonEur,
  };
}

/** The order-date hint as one sentence. */
export function suggestionText(suggestion: OrderDateSuggestion, number: string): string {
  const keeps = suggestion.rule === 'buffer' ? 'blijft je laagste stand boven de buffer' : 'wordt je laagste stand niet lager dan nu';
  return keepAmounts(`Bestel je ${number} op ${dayMon(suggestion.currentDate)}, dan sta je op ${weekdayDayMonth(suggestion.currentLowestDay)} op ${eurWhole(suggestion.currentLowestEur)}. `
    + `Vanaf ${weekdayDayMonth(suggestion.suggestedDate)} ${keeps}.`);
}

/**
 * A typed euro amount, Dutch or plain: '12.500', '12.500,50', '12500,5',
 * '12500.50', '€ 7.999'. Dots are thousands when a comma is the decimal mark
 * or when they group by three ('12.500'); a lone other dot is the decimal
 * mark ('12.5'). Null when empty, signed or not an amount.
 */
export function parseAmount(text: string): number | null {
  const compact = text.replace(/[€\s]/g, '');
  if (!/^\d[\d.,]*$/.test(compact)) return null;
  let normal = compact;
  if (compact.includes(',')) {
    if (compact.indexOf(',') !== compact.lastIndexOf(',')) return null;
    normal = compact.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(compact)) {
    normal = compact.replace(/\./g, '');
  } else if (compact.indexOf('.') !== compact.lastIndexOf('.')) {
    return null;
  }
  const value = Number(normal);
  return Number.isFinite(value) ? value : null;
}

/** An amount as a field shows it: '10.000', '12.500,50'. */
export function amountText(value: number): string {
  return eur(Math.abs(value)).replace(/^€ /, '').replace(/,00$/, '');
}

/** "= marge 33,3 %" of a markup on cost. */
export function marginOfMarkup(markupPct: number): string {
  const margin = Math.round(markupPct / (100 + markupPct) * 1000) / 10;
  return `${String(margin).replace('.', ',')} %`;
}

/** A percentage with a Dutch comma: 37.5 → '37,5'. */
export function pct(value: number): string {
  return String(Math.round(value * 10) / 10).replace('.', ',');
}

/* ----------------------------------------------------------- stored choices */

export const CHOICE_FIELDS = ['priceMode', 'markupPct', 'markupEurPerUnit', 'costBasis', 'sellWeeks', 'paymentDays', 'seasonal', 'included',
  'expectedShipOn', 'orderDateOverride'] as const;
export type ChoiceField = typeof CHOICE_FIELDS[number];

/** The full write of one order: what is stored plus this change (spec §4.4 save rule). */
export function forecastWrite(stored: PurchaseOrderForecast | PurchaseOrderForecastWrite | null, change: Partial<PurchaseOrderForecastWrite>): PurchaseOrderForecastWrite {
  const write = {} as Record<ChoiceField, unknown>;
  for (const field of CHOICE_FIELDS) write[field] = field in change ? change[field] ?? null : stored?.[field] ?? null;
  return write as unknown as PurchaseOrderForecastWrite;
}

/** Whether an order has any stored choice (the "aangepast" dot). */
export function adjusted(stored: PurchaseOrderForecast | PurchaseOrderForecastWrite | null | undefined): boolean {
  return !!stored && CHOICE_FIELDS.some((field) => stored[field] !== null && stored[field] !== undefined);
}

/* ------------------------------------------------------------ month table */

export interface MonthTableRow { id: 'begin' | 'containersOut' | 'containersBack' | 'customersOther' | 'vat' | 'costs' | 'other' | 'end' | 'lowest';
  label: string; values: (number | null)[]; }

/** The rows of "Per maand"; Andere only when any month has one. */
export function monthTable(forecast: CashForecast): { months: ForecastMonth[]; rows: MonthTableRow[] } {
  const months = forecast.months;
  const pick = (read: (month: ForecastMonth) => number | null) => months.map(read);
  const rows: MonthTableRow[] = [
    { id: 'begin', label: 'Begin', values: pick((month) => month.beginEur) },
    { id: 'containersOut', label: 'Containers · uit', values: pick((month) => month.containersOutEur) },
    { id: 'containersBack', label: 'Containers · terug', values: pick((month) => month.containersBackEur) },
    { id: 'customersOther', label: 'Klanten · overig', values: pick((month) => month.customersOtherEur) },
    { id: 'vat', label: 'Btw', values: pick((month) => month.vatEur) },
    { id: 'costs', label: 'Kosten', values: pick((month) => month.costsEur) },
    { id: 'other', label: 'Andere', values: pick((month) => month.otherEur) },
    { id: 'end', label: 'Einde', values: pick((month) => month.endEur) },
    { id: 'lowest', label: 'Laagste', values: pick((month) => month.lowestEur) },
  ];
  return { months, rows: rows.filter((row) => row.id !== 'other' || row.values.some((value) => value !== null && cents(value) !== 0)) };
}

/** A month table cell: whole euros, '—' for 0 or null. */
export function tableCell(value: number | null): string {
  return value === null || Math.round(value) === 0 ? '—' : eurWhole(value);
}

/** The note under "Per maand": what is still to link in the past months, what the customer row holds, the VAT deadlines. */
export function monthTableNote(input: CashForecastInput, forecast: CashForecast): string {
  const counted = countedKeys(input);
  const pastStart = forecast.months.find((month) => month.past)?.key.slice(0, 7);
  const open = pastStart ? input.bankLines.filter((line) => counted.has(line.account) && !line.allocated && line.classification == null
    && line.day.slice(0, 7) >= pastStart && line.day <= forecast.today) : [];
  const openEur = euros(open.reduce((sum, line) => sum + cents(line.amountEur), 0));
  const quarters = new Map<string, { q: number; date: Iso; cents: number }>();
  for (const item of forecast.items) {
    if (item.kind !== 'VAT' || item.source.type !== 'vat') continue;
    const key = `${item.source.year}-${item.source.quarter}`;
    const row = quarters.get(key) ?? { q: item.source.quarter, date: item.date, cents: 0 };
    row.cents += cents(item.amountEur);
    quarters.set(key, row);
  }
  const vat = [...quarters.values()].map((row) => `Btw-aangifte Q${row.q} ${eurWhole(euros(row.cents))} (${dayMon(row.date)})`).join(' · ');
  return keepAmounts(`Gebeurd = banktransacties per koppeling; ${open.length} nog te koppelen (${eurWhole(openEur)}) staan bij Kosten of Klanten. `
    + `Klanten · overig = facturen, offertes, partnervoorschotten en de huidige voorraad.${vat ? ` ${vat}` : ''}`);
}

/** The lines behind one month: bank lines of the counted accounts for a past month, items for a future one. */
export function monthLines(input: CashForecastInput, forecast: CashForecast, month: ForecastMonth): { day: Iso; title: string; sub: string; amountEur: number; lineId: number | null; item: ForecastItem | null }[] {
  if (month.past) {
    const counted = countedKeys(input);
    const key = month.key.slice(0, 7);
    const labels = new Map(input.accounts.map((account) => [account.key, account.label]));
    return input.bankLines.filter((line) => counted.has(line.account) && line.day.slice(0, 7) === key && line.day <= forecast.today
      && (!input.statementsFrom || line.day >= input.statementsFrom))
      .sort((left, right) => left.day.localeCompare(right.day) || left.id - right.id)
      .map((line) => ({ day: line.day, title: line.counterparty || 'Banktransactie',
        sub: [`${labels.get(line.account) ?? line.account}`, line.reference, line.allocated || line.classification ? null : 'Te koppelen'].filter(Boolean).join(' · '),
        amountEur: line.amountEur, lineId: line.id, item: null }));
  }
  const first = month.key === forecast.today.slice(0, 7) ? forecast.today : `${month.key}-01`;
  return forecast.items.filter((item) => item.date.slice(0, 7) === month.key && item.date >= first)
    .map((item) => ({ day: item.date, title: item.title, sub: `${CERTAINTY_LABEL[item.certainty]} · ${item.ruleText}`, amountEur: item.amountEur, lineId: null, item }));
}

/* --------------------------------------------------------------- PO sheet */

/** The likely-paid box of the PO sheet. */
export function likelyPaidText(match: { account: string; day: Iso; amountEur: number; reference: string }): string {
  return keepAmounts(`Lijkt al betaald: ${match.account} ${dayMonth(match.day)} · ${eur(match.amountEur)} · “${match.reference}”. Nog niet gekoppeld; de prognose rekent hem als betaald.`);
}

/** The month a seasonal profile peaks in ('januari'), or null without one. */
export function peakMonth(seasonal: readonly number[] | null): string | null {
  if (!seasonal || seasonal.length !== 12) return null;
  let at = 0;
  for (let index = 1; index < 12; index++) if (seasonal[index] > seasonal[at]) at = index;
  return MONTH_NAMES[at].toLowerCase();
}

/* --------------------------------------------------------- realised markup */

type RealisedSample = { invoices: number; revenueEur: number; markupPct: number | null };

/**
 * The 12-month markup beside the default (critique B4): "12 mnd: −2,5 %"
 * when it is the default; with its basis when the sample is too thin to use
 * ("12 mnd: −2,5 % (1 factuur, te weinig om op te rekenen)"); '' without one.
 */
export function realisedHint(guardedPct: number | null, sample: RealisedSample | null | undefined): string {
  if (guardedPct !== null) return `12 mnd: ${pct(guardedPct)} %`;
  if (!sample || sample.markupPct === null) return '';
  return `12 mnd: ${pct(sample.markupPct)} % (${sample.invoices} ${sample.invoices === 1 ? 'factuur' : 'facturen'}, te weinig om op te rekenen)`;
}

/** Why the default is 50 %: "standaard: te weinig verkoophistoriek (1 factuur)"; '' when the realised markup is used. */
export function standardMarkupNote(guardedPct: number | null, sample: RealisedSample | null | undefined): string {
  if (guardedPct !== null || !sample) return '';
  return `standaard: te weinig verkoophistoriek (${sample.invoices} ${sample.invoices === 1 ? 'factuur' : 'facturen'})`;
}

/* ----------------------------------------------------------------- loading */

/**
 * The forecast may build once the advance schedules of this round are in
 * (critique N13): without them the first figures showed a wrong lowest point
 * for half a second. Not needed when no financing has a schedule or the
 * partner financings failed to load.
 */
export function forecastReady(generation: number, schedulesFor: number, schedulesNeeded: boolean): boolean {
  return !schedulesNeeded || schedulesFor === generation;
}

/**
 * A past bank row's text without the account plumbing (design §3.1): IBANs,
 * BICs, "KBC Mobile", masked card numbers and repeated spaces go; the
 * counterparty and the free text stay. The full text stays in the title.
 */
export function bankTextShort(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g, ' ')
    .replace(/\b[A-Z]{4}(?:BE|NL|DE|FR|LU|GB|IT|ES|AT|CH|PL|CN|HK|US|IE|DK|SE|NO|FI|PT|CZ)[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g, ' ')
    .replace(/\bKBC[- ]Mobile\b/gi, ' ')
    .replace(/\b\d{4}[ -]?[X*]{2,4}[ -]?[X*]{2,4}[ -]?\d{4}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(?:\s*[,;:/|-]\s*){2,}/g, ' - ')
    .replace(/^[\s,;:/|-]+|[\s,;:/|-]+$/g, '')
    .trim();
}

/** The first day of the month three months before today ('2026-10-15' → '2026-07-01'). */
export function threeMonthsBack(today: string): string {
  const total = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 - 3;
  return `${Math.floor(total / 12)}-${String(total % 12 + 1).padStart(2, '0')}-01`;
}

/** The financings that still invoice advances: no settlement yet, and unbilled rows or a concept advance invoice (spec §3). */
export function financingsWithSchedule(financings: readonly PartnerFinancing[]): number[] {
  return financings.filter((row) => row.settlementInvoiceId == null && ((row.unbilledAdvanceCount ?? 0) > 0
    || (row.documents ?? []).some((doc) => doc.purpose === 'PARTNER_ADVANCE' && doc.docType === 'FACTUUR' && doc.status === 'CONCEPT')))
    .map((row) => row.purchaseOrderId);
}
