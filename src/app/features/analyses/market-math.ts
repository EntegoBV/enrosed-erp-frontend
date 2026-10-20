import type { PurchaseOrderView } from '../../core/api/models';

/**
 * Pure arithmetic behind the market page: calendar baselines, windows,
 * pair inversion, freight horizons and the buying-power narrative, and the
 * container rows behind its two drill-downs (design/analyses2 §B.9).
 *
 * Everything here is deterministic over plain arrays, so the page stays a
 * thin view and the node tests can pin the behaviour without a browser.
 * Type-only imports.
 */

export type Months = 1 | 3 | 6 | 12;

export interface DatedSeries {
  /** ISO days, oldest first. */
  dates: string[];
  values: number[];
}

export interface FxRates {
  dates: string[];
  usd: number[];
  cny: number[];
}

export interface Horizon {
  label: string;
  months: Months;
  /** Percentage change of the latest value against the baseline; null without a fair baseline. */
  pct: number | null;
  /** ISO day of the observation that served as baseline. */
  comparedOn: string | null;
  /** Real distance between the latest observation and the baseline. */
  actualDays: number | null;
}

export interface FxInsight {
  verdict: string;
  tone: 'ok' | 'warn' | 'neutral';
  lead: string;
  /** "Per $10.000 aan inkoop: ongeveer € 412 minder; per ¥10.000 … dan op …"; null without a fair baseline. */
  money: string | null;
  /** The dollar and yuan apart and where the euro stands in its range (the page folds them). */
  lines: string[];
  horizons: { label: string; months: Months; pct: number | null; usd: number | null; cny: number | null }[];
}

export const MONTH_OPTIONS: ReadonlyArray<{ months: Months; label: string }> = [
  { months: 1, label: '1 mnd' },
  { months: 3, label: '3 mnd' },
  { months: 6, label: '6 mnd' },
  { months: 12, label: '12 mnd' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC of an ISO day; NaN when the text is not a day. */
export function dayTime(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return Number.NaN;
  return Date.UTC(+match[1], +match[2] - 1, +match[3]);
}

/** The same calendar day `months` earlier, clamped to the shorter month. */
export function monthsBefore(iso: string, months: number): number {
  const latest = dayTime(iso);
  if (Number.isNaN(latest)) return Number.NaN;
  const date = new Date(latest);
  const targetMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1));
  const monthEnd = new Date(Date.UTC(
    targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate();
  return Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth(),
    Math.min(date.getUTCDate(), monthEnd));
}

/**
 * Index of the last observation on or before the calendar baseline. A
 * weekend or holiday gap is expected; an observation more than `maxGapDays`
 * older than the target is not an honest "one month ago" and yields null.
 */
export function calendarBaselineIndex(dates: string[], months: Months, maxGapDays = 10): number | null {
  if (dates.length < 2) return null;
  const target = monthsBefore(dates[dates.length - 1], months);
  if (Number.isNaN(target)) return null;
  let baseline = -1;
  for (let index = 0; index < dates.length - 1; index++) {
    const time = dayTime(dates[index]);
    if (Number.isNaN(time)) return null;
    if (time <= target) baseline = index;
    else break;
  }
  if (baseline < 0) return null;
  return target - dayTime(dates[baseline]) <= maxGapDays * DAY_MS ? baseline : null;
}

/** Percentage change of the latest value against the calendar baseline. */
export function changeOverMonths(series: DatedSeries, months: Months): { pct: number; baselineIndex: number } | null {
  const baselineIndex = calendarBaselineIndex(series.dates, months);
  if (baselineIndex === null) return null;
  const from = series.values[baselineIndex];
  const to = series.values[series.values.length - 1];
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return { pct: ((to - from) / from) * 100, baselineIndex };
}

/**
 * The part of a series that belongs to the chosen period. The baseline
 * observation itself opens the window so the chart starts where the
 * comparison starts; without a baseline the window simply starts at the
 * first observation inside the period.
 */
export function windowOf(series: DatedSeries, months: Months): DatedSeries {
  if (!series.dates.length) return { dates: [], values: [] };
  const baseline = calendarBaselineIndex(series.dates, months);
  let start: number;
  if (baseline !== null) {
    start = baseline;
  } else {
    const target = monthsBefore(series.dates[series.dates.length - 1], months);
    start = series.dates.findIndex((date) => dayTime(date) >= target);
    if (start < 0) start = 0;
  }
  return { dates: series.dates.slice(start), values: series.values.slice(start) };
}

/** 1 / value for every entry: the same pair read the other way round. */
export function invert(values: number[]): number[] {
  return values.map((value) => value > 0 ? 1 / value : Number.NaN);
}

/** Quote currency per base currency out of two EUR-based series. */
export function crossOf(quotePerEur: number[], basePerEur: number[]): number[] {
  return quotePerEur.map((quote, index) => {
    const base = basePerEur[index];
    return base > 0 ? quote / base : Number.NaN;
  });
}

export interface SeriesSummary {
  min: number;
  max: number;
  mean: number;
  minOn: string;
  maxOn: string;
}

export function summarize(series: DatedSeries): SeriesSummary | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let minOn = '';
  let maxOn = '';
  let sum = 0;
  let count = 0;
  series.values.forEach((value, index) => {
    if (!Number.isFinite(value)) return;
    if (value < min) { min = value; minOn = series.dates[index]; }
    if (value > max) { max = value; maxOn = series.dates[index]; }
    sum += value;
    count++;
  });
  return count ? { min, max, mean: sum / count, minOn, maxOn } : null;
}

/** The last observation of every ISO week: a readable table twin of a daily series. */
export function weeklyRows(series: DatedSeries): { date: string; value: number }[] {
  const rows: { date: string; value: number }[] = [];
  let currentWeek = '';
  series.dates.forEach((date, index) => {
    const week = isoWeekKey(date);
    if (week === currentWeek && rows.length) {
      rows[rows.length - 1] = { date, value: series.values[index] };
    } else {
      rows.push({ date, value: series.values[index] });
      currentWeek = week;
    }
  });
  return rows;
}

function isoWeekKey(iso: string): string {
  const time = dayTime(iso);
  if (Number.isNaN(time)) return iso;
  const date = new Date(time);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${date.getUTCFullYear()}-${week}`;
}

/**
 * Change versus roughly 1, 3, 6 and 12 months back, computed from DATED
 * entries of a sparse log. Each horizon takes the entry closest to its
 * target date; the acceptance window grows with the horizon so a nine-day
 * old point can never pretend to be a month. Nothing is interpolated.
 */
export function sparseHorizons(entries: DatedSeries): Horizon[] {
  const definitions: { label: string; months: Months; days: number; toleranceDays: number }[] = [
    { label: '1 mnd', months: 1, days: 30, toleranceDays: 8 },
    { label: '3 mnd', months: 3, days: 91, toleranceDays: 14 },
    { label: '6 mnd', months: 6, days: 182, toleranceDays: 21 },
    { label: '12 mnd', months: 12, days: 365, toleranceDays: 28 },
  ];
  const count = entries.dates.length;
  if (count < 2) {
    return definitions.map(({ label, months }) => ({ label, months, pct: null, comparedOn: null, actualDays: null }));
  }
  const latestValue = entries.values[count - 1];
  const latestTime = dayTime(entries.dates[count - 1]);
  return definitions.map((definition) => {
    const target = latestTime - definition.days * DAY_MS;
    let best: { distance: number; index: number } | null = null;
    for (let index = 0; index < count - 1; index++) {
      const distance = Math.abs(dayTime(entries.dates[index]) - target);
      if (!best || distance < best.distance) best = { distance, index };
    }
    if (!best || best.distance > definition.toleranceDays * DAY_MS) {
      return { label: definition.label, months: definition.months, pct: null, comparedOn: null, actualDays: null };
    }
    const baseline = entries.values[best.index];
    return {
      label: definition.label,
      months: definition.months,
      pct: baseline > 0 ? ((latestValue - baseline) / baseline) * 100 : null,
      comparedOn: entries.dates[best.index],
      actualDays: Math.round((latestTime - dayTime(entries.dates[best.index])) / DAY_MS),
    };
  });
}

/** Change against the previous entry of a sparse log, when there is one. */
export function lastStep(entries: DatedSeries): { pct: number; days: number } | null {
  const count = entries.values.length;
  if (count < 2) return null;
  const previous = entries.values[count - 2];
  if (!(previous > 0)) return null;
  return {
    pct: ((entries.values[count - 1] - previous) / previous) * 100,
    days: Math.round((dayTime(entries.dates[count - 1]) - dayTime(entries.dates[count - 2])) / DAY_MS),
  };
}

const NL = (value: number, decimals = 1) => value.toLocaleString('nl-BE', {
  minimumFractionDigits: decimals, maximumFractionDigits: decimals,
});

export function periodWords(months: Months): string {
  if (months === 1) return 'een maand';
  if (months === 3) return 'drie maanden';
  if (months === 6) return 'zes maanden';
  return 'twaalf maanden';
}

export function longDate(iso: string): string {
  const time = dayTime(iso);
  if (Number.isNaN(time)) return iso;
  return new Intl.DateTimeFormat('nl-BE', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(time));
}

export function shortDate(iso: string): string {
  const time = dayTime(iso);
  if (Number.isNaN(time)) return iso;
  return new Intl.DateTimeFormat('nl-BE', {
    day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC',
  }).format(new Date(time));
}

/**
 * What the currency move means at the buying desk. We pay in euro while
 * the EXW price is agreed in dollar or yuan, so every horizon answers the
 * question for both currencies and the verdict averages them.
 */
export function fxInsight(rates: FxRates, months: Months): FxInsight | null {
  if (rates.usd.length < 2 || rates.usd.length !== rates.dates.length ||
      rates.cny.length !== rates.dates.length) return null;
  const latestIndex = rates.usd.length - 1;
  const latestUsd = rates.usd[latestIndex];
  const latestCny = rates.cny[latestIndex];
  /* Positive means one dollar (or yuan) costs fewer euros now. */
  const cheaper = (baseline: number | undefined, latest: number) =>
    baseline !== undefined && baseline > 0 && latest > 0 ? (1 - baseline / latest) * 100 : null;
  const contexts = MONTH_OPTIONS.map((option) => {
    const index = calendarBaselineIndex(rates.dates, option.months);
    const usd = index === null ? null : cheaper(rates.usd[index], latestUsd);
    const cny = index === null ? null : cheaper(rates.cny[index], latestCny);
    const pct = usd === null ? null : cny === null ? usd : (usd + cny) / 2;
    return { ...option, index, pct, usd, cny };
  });
  const horizons = contexts.map(({ label, months: horizonMonths, pct, usd, cny }) =>
    ({ label, months: horizonMonths, pct, usd, cny }));
  const selected = contexts.find((context) => context.months === months);
  const period = periodWords(months);

  if (!selected || selected.index === null || selected.pct === null || selected.usd === null) {
    return {
      verdict: 'Onvoldoende historiek',
      tone: 'neutral',
      lead: `Voor ${period} zijn nog niet genoeg ECB-koersen beschikbaar.`,
      money: null,
      lines: ['Kies een kortere periode om de vergelijking te zien.'],
      horizons,
    };
  }

  const baselineIndex = selected.index;
  const baselineDate = longDate(rates.dates[baselineIndex]);
  const baselineUsd = rates.usd[baselineIndex];
  const baselineCny = rates.cny[baselineIndex];
  const usdCheaperPct = selected.usd;
  const cnyCheaperPct = selected.cny;
  const powerPct = selected.pct;
  const windowUsd = rates.usd.slice(baselineIndex).filter((value) => value > 0);
  const min = Math.min(...windowUsd);
  const max = Math.max(...windowUsd);
  /* 1 = euro at its strongest (dollar cheapest), 0 = weakest. */
  const rangePosition = max === min ? 0.5 : (latestUsd - min) / (max - min);
  const rangePeriod = months === 1 ? 'maand' : period;

  const lines: string[] = [];
  const abs = (value: number) => NL(Math.abs(value));
  const gain = (value: number) => value >= 0 ? 'won' : 'verloor';

  if (cnyCheaperPct === null) {
    lines.push(`De euro ${gain(usdCheaperPct)} ${abs(usdCheaperPct)}% tegenover de dollar sinds ${baselineDate}.`);
  } else {
    const usdBetter = usdCheaperPct >= 0;
    const cnyBetter = cnyCheaperPct >= 0;
    const dollarMovedMore = Math.abs(usdCheaperPct) > Math.abs(cnyCheaperPct) + 0.5;
    const yuanMovedMore = Math.abs(cnyCheaperPct) > Math.abs(usdCheaperPct) + 0.5;
    if (usdBetter && cnyBetter) {
      lines.push(`Waarom nu beter: de euro won ${abs(usdCheaperPct)}% op de dollar en ` +
        `${abs(cnyCheaperPct)}% op de yuan sinds ${baselineDate}. Dezelfde EXW-prijs kost je nu ` +
        `minder euro, in beide munten.`);
      if (dollarMovedMore) {
        lines.push(`De dollar zakte harder dan de yuan. Een leverancier met een dollarafspraak krijgt ` +
          `nu minder yuan voor zijn dollars, verdient dus minder en zal zijn dollarprijs willen ` +
          `verhogen. Bij een yuan-afspraak blijft zijn opbrengst gelijk, maar jouw voordeel is daar ` +
          `kleiner (${abs(cnyCheaperPct)}% in plaats van ${abs(usdCheaperPct)}%).`);
      } else if (yuanMovedMore) {
        lines.push(`De yuan zakte harder dan de dollar. Een yuan-afspraak is nu het voordeligst ` +
          `(${abs(cnyCheaperPct)}% tegenover ${abs(usdCheaperPct)}%). Een leverancier met een ` +
          `dollarafspraak krijgt juist meer yuan per dollar en zit comfortabel; prijsdruk van zijn ` +
          `kant is onwaarschijnlijk.`);
      } else {
        lines.push(`Dollar en yuan bewogen gelijk op: een dollar- of yuan-afspraak maakt nu geen ` +
          `verschil, en de leverancier merkt er in zijn yuan weinig van.`);
      }
    } else if (!usdBetter && !cnyBetter) {
      lines.push(`Waarom toen beter: de euro verloor ${abs(usdCheaperPct)}% op de dollar en ` +
        `${abs(cnyCheaperPct)}% op de yuan sinds ${baselineDate}. Dezelfde EXW-prijs kost je nu ` +
        `meer euro, in beide munten.`);
      if (dollarMovedMore) {
        lines.push(`De dollar werd harder duurder dan de yuan. Een dollarafspraak kost je nu het ` +
          `meest extra; die leverancier krijgt meer yuan per dollar en verdient beter dan toen. ` +
          `Dat is ruimte om over zijn dollarprijs te onderhandelen. Een yuan-afspraak kost ` +
          `${abs(cnyCheaperPct)}% extra.`);
      } else if (yuanMovedMore) {
        lines.push(`De yuan werd harder duurder dan de dollar. Een yuan-afspraak kost je nu het ` +
          `meest extra (${abs(cnyCheaperPct)}% tegenover ${abs(usdCheaperPct)}%); met een ` +
          `dollarafspraak beperk je de schade.`);
      } else {
        lines.push(`Dollar en yuan werden gelijk op duurder: de munt van de afspraak maakt nu geen verschil.`);
      }
    } else if (usdBetter) {
      lines.push(`Gemengd: de euro won ${abs(usdCheaperPct)}% op de dollar maar verloor ` +
        `${abs(cnyCheaperPct)}% op de yuan sinds ${baselineDate}. Een dollarafspraak werd goedkoper, ` +
        `een yuan-afspraak duurder. De dollarleverancier krijgt minder yuan per dollar, verdient ` +
        `minder en zal zijn dollarprijs willen verhogen.`);
    } else {
      lines.push(`Gemengd: de euro verloor ${abs(usdCheaperPct)}% op de dollar maar won ` +
        `${abs(cnyCheaperPct)}% op de yuan sinds ${baselineDate}. Een yuan-afspraak werd goedkoper, ` +
        `een dollarafspraak duurder. De dollarleverancier krijgt meer yuan per dollar en verdient ` +
        `beter; daar valt over de prijs te praten.`);
    }
  }

  if (rangePosition >= 0.85) {
    lines.push(`De euro staat dicht bij zijn sterkste punt van de afgelopen ${rangePeriod} tegenover ` +
      `de dollar; de winst zit er grotendeels al in.`);
  } else if (rangePosition <= 0.15) {
    lines.push(`De euro staat dicht bij zijn zwakste punt van de afgelopen ${rangePeriod} tegenover de dollar.`);
  }

  const eurPerTenKUsd = 10000 / baselineUsd - 10000 / latestUsd;
  const usdMoney = Math.round(Math.abs(eurPerTenKUsd));
  let money = usdMoney < 1
    ? 'Per $10.000 aan inkoop: minder dan € 1 verschil'
    : `Per $10.000 aan inkoop: ongeveer € ${usdMoney.toLocaleString('nl-BE')} ` +
      `${eurPerTenKUsd > 0 ? 'minder' : 'meer'}`;
  if (cnyCheaperPct !== null && baselineCny > 0) {
    const eurPerTenKCny = 10000 / baselineCny - 10000 / latestCny;
    const cnyMoney = Math.round(Math.abs(eurPerTenKCny));
    if (cnyMoney >= 1) {
      money += `; per ¥10.000 ongeveer € ${cnyMoney.toLocaleString('nl-BE')} ` +
        `${eurPerTenKCny > 0 ? 'minder' : 'meer'}`;
    }
  }
  money = `${money} dan op ${baselineDate}.`;

  let verdict: string;
  let tone: FxInsight['tone'];
  let lead: string;
  if (powerPct >= 0.5) {
    verdict = 'Sterker dan toen';
    tone = 'ok';
    lead = `Jullie koopkracht is ${NL(powerPct)}% sterker dan op ${baselineDate} (gemiddeld over dollar en yuan).`;
  } else if (powerPct <= -0.5) {
    verdict = 'Zwakker dan toen';
    tone = 'warn';
    lead = `Jullie koopkracht is ${NL(Math.abs(powerPct))}% zwakker dan op ${baselineDate} (gemiddeld over dollar en yuan).`;
  } else {
    verdict = 'Vrijwel gelijk';
    tone = 'neutral';
    lead = `Jullie koopkracht ligt op het niveau van ${baselineDate} (gemiddeld over dollar en yuan).`;
  }
  return { verdict, tone, lead, money, lines, horizons };
}

/** Narrative for a sparse freight log: direction of the last weeks and the longest fair comparison. */
export function freightNarrative(entries: DatedSeries, unit: 'usd' | 'points'): string[] {
  const count = entries.dates.length;
  if (!count) return ['Nog geen notering. Zodra er een meetpunt is, verschijnt hier de analyse.'];
  if (count === 1) {
    return [`Eerste notering op ${shortDate(entries.dates[0])}. Een tweede meetpunt is nodig om een richting te zien.`];
  }
  const lines: string[] = [];
  const recent = Math.min(4, count);
  const from = entries.values[count - recent];
  const to = entries.values[count - 1];
  const recentPct = from > 0 ? ((to - from) / from) * 100 : 0;
  const noun = unit === 'usd' ? 'het tarief' : 'de index';
  const direction = Math.abs(recentPct) < 1 ? 'zijwaarts'
    : recentPct > 0 ? 'omhoog' : 'omlaag';
  lines.push(`De laatste ${recent} noteringen gaan ${direction}` +
    (direction === 'zijwaarts' ? '' : ` (${recentPct > 0 ? '+' : '−'}${NL(Math.abs(recentPct))}% sinds ${shortDate(entries.dates[count - recent])})`) +
    `.`);
  const step = lastStep(entries);
  if (step && Math.abs(step.pct) >= 0.05) {
    lines.push(`Vorige notering (${step.days} dagen eerder): ${step.pct > 0 ? '+' : '−'}${NL(Math.abs(step.pct))}%, ` +
      `${noun} werd dus ${step.pct > 0 ? (unit === 'usd' ? 'duurder' : 'hoger') : (unit === 'usd' ? 'goedkoper' : 'lager')}.`);
  }
  const longest = sparseHorizons(entries).slice().reverse().find((horizon) => horizon.pct !== null);
  if (longest && longest.pct !== null && longest.comparedOn) {
    lines.push(`Over ${longest.label} staat ${noun} ${NL(Math.abs(longest.pct))}% ` +
      `${longest.pct > 0 ? 'hoger' : 'lager'} dan op ${shortDate(longest.comparedOn)} (${longest.actualDays} dagen).`);
  } else {
    lines.push('De langere vergelijking volgt zodra er voldoende wekelijkse historiek is.');
  }
  return lines;
}

/**
 * Our latest freight quote against the latest market price in the same unit
 * (USD per 40ft): "+ 36 %" means we pay 36 % above the market. Null without
 * a positive market price or a finite quote.
 */
export function quoteVsMarketPct(ownUsd: number, marketUsd: number): number | null {
  if (!Number.isFinite(ownUsd) || !Number.isFinite(marketUsd) || marketUsd <= 0) return null;
  return Math.round(((ownUsd - marketUsd) / marketUsd) * 1000) / 10;
}

/* ------------------------------------------------- freight against its week */

/**
 * The market's point of a day: the last entry on or before `day`, at most
 * `maxDays` earlier (a weekly index publishes once a week); null when the
 * series has none in that window. `series` runs oldest first.
 */
export function marketOnOrBefore(series: DatedSeries, day: string, maxDays = 14): { date: string; value: number } | null {
  const at = dayTime(day);
  if (Number.isNaN(at)) return null;
  for (let index = series.dates.length - 1; index >= 0; index--) {
    const time = dayTime(series.dates[index]);
    if (Number.isNaN(time) || time > at) continue;
    if (at - time > maxDays * DAY_MS) return null;
    const value = series.values[index];
    return Number.isFinite(value) && value > 0 ? { date: series.dates[index], value } : null;
  }
  return null;
}

export interface QuoteVsMarket { route: string; quotedOn: string; ownUsd: number; benchmark: string; marketOn: string; marketUsd: number; pct: number }

/**
 * Our latest forwarder quote against the market of the same week (design
 * D-M1): the first market in `markets` (Drewry WCI Shanghai → Rotterdam,
 * then FBX11) with a point on or before the quote day, at most `maxDays`
 * before it. Never the newest market point: that mixes months of movement.
 */
export function alignedQuoteVsMarket(own: readonly { route: string; quotedOn: string; usd: number }[],
  markets: readonly { name: string; series: DatedSeries }[], maxDays = 14): QuoteVsMarket | null {
  const latest = [...own].sort((left, right) => right.quotedOn.localeCompare(left.quotedOn))[0];
  if (!latest) return null;
  for (const market of markets) {
    const point = marketOnOrBefore(market.series, latest.quotedOn, maxDays);
    const pct = point ? quoteVsMarketPct(latest.usd, point.value) : null;
    if (point && pct !== null) {
      return { route: latest.route, quotedOn: latest.quotedOn, ownUsd: latest.usd, benchmark: market.name, marketOn: point.date, marketUsd: point.value, pct };
    }
  }
  return null;
}

/* ------------------------------------------------ the containers behind it */

const OPEN_STATUSES: ReadonlySet<string> = new Set(['CONCEPT', 'BESTELD', 'ONDERWEG']);
const cents = (value: number): number => Math.round((Number.isFinite(value) ? value : 0) * 100);

export interface UsdContainerRow {
  id: number; number: string; alias: string | null; status: PurchaseOrderView['order']['status'];
  goodsUsd: number;
  /** The order's goods rate as dollars for € 1 (the page's direction); null without a rate. */
  orderRate: number | null;
  /** The goods in euro as the order computed them, and at today's ECB rate; diff = today − order. */
  eurOrder: number; eurToday: number; diffEur: number;
}

/**
 * Koopkracht › "Open containers": every open container (concept, ordered, on
 * the way; not archived) with goods in dollar, at the order's rate and at
 * today's ECB rate (`latestUsdPerEur`, dollars for € 1). Cents.
 */
export function usdContainerRows(views: readonly PurchaseOrderView[], latestUsdPerEur: number): UsdContainerRow[] {
  if (!(latestUsdPerEur > 0)) return [];
  return views.filter((view) => !view.order.archivedAt && OPEN_STATUSES.has(view.order.status) && (view.costing?.totals?.goodsUsd ?? 0) > 0)
    .map((view) => {
      const goodsUsd = view.costing.totals.goodsUsd;
      const eurOrder = cents(view.costing.totals.goodsEur);
      const eurToday = cents(goodsUsd / latestUsdPerEur);
      const rate = view.order.usdToEurGoods;
      return { id: view.order.id, number: view.order.number, alias: view.order.alias, status: view.order.status, goodsUsd,
        orderRate: rate > 0 ? 1 / rate : null, eurOrder: eurOrder / 100, eurToday: eurToday / 100, diffEur: (eurToday - eurOrder) / 100 };
    });
}

export interface FreightContainerRow {
  id: number; number: string; alias: string | null; status: PurchaseOrderView['order']['status'];
  route: string;
  /** The day it sailed, else the order date (`shipped` false). */
  day: string; shipped: boolean;
  freightUsd: number;
  /** Drewry that week (marketOnOrBefore); null when it published nothing in the 14 days before. */
  marketUsd: number | null; marketOn: string | null;
  /** + 36,3 = we paid 36,3 % above the market of that week. */
  diffPct: number | null;
}

/**
 * Zeevracht › "Per container": every container with sea freight of our own
 * in dollar (not via the supplier, not archived) against the market of its
 * week, newest first.
 */
export function freightContainerRows(views: readonly PurchaseOrderView[], market: DatedSeries, maxDays = 14): FreightContainerRow[] {
  return views.filter((view) => !view.order.archivedAt && !view.order.freightViaSupplier && view.order.freightUsd > 0)
    .map((view) => {
      const order = view.order;
      const day = (order.shippedOn || order.orderDate).slice(0, 10);
      const point = marketOnOrBefore(market, day, maxDays);
      return { id: order.id, number: order.number, alias: order.alias, status: order.status,
        route: [order.departurePort, order.destinationPort].filter(Boolean).join(' → '), day, shipped: !!order.shippedOn,
        freightUsd: order.freightUsd, marketUsd: point?.value ?? null, marketOn: point?.date ?? null,
        diffPct: point ? quoteVsMarketPct(order.freightUsd, point.value) : null };
    })
    .sort((left, right) => right.day.localeCompare(left.day) || right.id - left.id);
}
