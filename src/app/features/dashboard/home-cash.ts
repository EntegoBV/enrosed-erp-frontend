import type { CashForecast, ForecastDay } from '../finance/cash-forecast';

/*
 * The home's Kas headline (spec-home §7.4): the bank today, the lowest point
 * and the first krap period of the same 6-month forecast Analyses shows, or
 * the state that explains why a figure is missing. The phone hero's
 * sparkline comes from here too. Formatting stays in the components.
 *
 * Pure and node-tested: only `import type`; the under-buffer rule is a local
 * copy of cash-view.ts underBuffer.
 */

export type CashHeadlineState = 'loading' | 'computing' | 'ready' | 'partial' | 'no-bank' | 'no-reading';

export interface CashHeadline {
  state: CashHeadlineState;
  /** The bank today; null while unknown (no bank, no reading, nothing loaded yet). */
  startEur: number | null;
  accounts: { key: string; label: string; eur: number | null; ageDays: number | null; stale: boolean }[];
  /** The lowest point with the scenario; `warn` when it is under the buffer or below zero. Null unless 'ready'. */
  lowest: { day: string; eur: number; warn: boolean } | null;
  /** The first krap period; null when there is none, or unless 'ready'. */
  tight: { from: string; to: string; lowestEur: number } | null;
  bufferEur: number | null;
  /** The words of "Prognose onvolledig: …" ('partial'), as handed in. */
  warnings: string[];
}

export interface CashHeadlineContext {
  /** The bank could not load (CashData.bankMissing). */
  bankMissing: boolean;
  /** CashData's words plus the home's own failed forecast sources; any of them makes the forecast partial. */
  warnings: readonly string[];
  /** The forecast is being built (the bank is in, the idle callback has not run yet). */
  computing: boolean;
  /** The bank balance known before the forecast (the Vooruitblik's bankEur), shown while computing. */
  startEur?: number | null;
}

/** Under the buffer, never in relative mode (copy of cash-view.ts underBuffer). */
function underBuffer(forecast: Pick<CashForecast, 'mode' | 'bufferEur'>, eur: number): boolean {
  return forecast.mode !== 'relative' && eur < forecast.bufferEur;
}

export function cashHeadline(forecast: CashForecast | null, context: CashHeadlineContext): CashHeadline {
  const warnings = [...new Set(context.warnings)];
  const empty: CashHeadline = { state: 'loading', startEur: null, accounts: [], lowest: null, tight: null, bufferEur: null, warnings };
  if (context.bankMissing) return { ...empty, state: 'no-bank' };
  if (!forecast) {
    return context.computing ? { ...empty, state: 'computing', startEur: context.startEur ?? null } : empty;
  }
  const accounts = forecast.startAccounts.map((account) => ({ ...account }));
  if (forecast.mode === 'relative') return { ...empty, state: 'no-reading', accounts };
  const known = { ...empty, startEur: forecast.startEur, accounts, bufferEur: forecast.bufferEur };
  if (warnings.length) return { ...known, state: 'partial' };
  const lowest = forecast.lowestWith;
  const tight = forecast.tightWith[0];
  return {
    ...known, state: 'ready',
    lowest: { day: lowest.day, eur: lowest.eur, warn: lowest.eur < 0 || underBuffer(forecast, lowest.eur) },
    tight: tight ? { from: tight.from, to: tight.to, lowestEur: tight.lowestEur } : null,
  };
}

export interface SparkLine {
  /** SVG polyline points, x from 0 to w, y from 0 (top, highest) to h (bottom, lowest). */
  points: string;
  /** Where the buffer line sits; null without a buffer or without days. */
  bufferY: number | null;
  minEur: number;
  maxEur: number;
}

/**
 * The hero's sparkline of the balance with the scenario, scaled into a w×h
 * box. The buffer is part of the scale, so its dashed line always shows.
 */
export function sparkPoints(days: readonly Pick<ForecastDay, 'day' | 'withEur'>[], w: number, h: number, bufferEur: number | null): SparkLine {
  if (!days.length) return { points: '', bufferY: null, minEur: 0, maxEur: 0 };
  const values = days.map((day) => day.withEur);
  const scale = bufferEur === null ? values : [...values, bufferEur];
  const minEur = Math.min(...scale);
  const maxEur = Math.max(...scale);
  const span = maxEur - minEur;
  const round = (value: number): number => Math.round(value * 10) / 10;
  const y = (eur: number): number => round(span === 0 ? h / 2 : h - ((eur - minEur) / span) * h);
  const step = days.length > 1 ? w / (days.length - 1) : 0;
  const points = values.map((eur, index) => `${round(days.length > 1 ? index * step : w / 2)},${y(eur)}`).join(' ');
  return { points, bufferY: bufferEur === null ? null : y(bufferEur), minEur, maxEur };
}
