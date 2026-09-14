import type { GoogleAnalyticsSource, GoogleAnalyticsStatus } from '../../core/api/analytics-api';

/** Missing/invalid API values are not measured zeroes. */
export function googleMetric(value: unknown, decimals = 0): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—';
  return new Intl.NumberFormat('nl-BE', { maximumFractionDigits: decimals }).format(value);
}

export function googlePercentage(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return '—';
  return `${googleMetric(value * 100, 1)} %`;
}

export function googleDate(value: string | null | undefined, includeTime = false): string {
  if (!value) return 'Niet beschikbaar';
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return 'Niet beschikbaar';
  return new Intl.DateTimeFormat('nl-BE', {
    day: 'numeric', month: 'short', year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' } : { timeZone: 'UTC' }),
  }).format(date);
}

export function googleSourceLabel(status: GoogleAnalyticsStatus): string {
  return ({ CONNECTED: 'Verbonden', NO_DATA: 'Nog geen rapportgegevens',
    NOT_CONFIGURED: 'Nog niet gekoppeld', ERROR: 'Niet beschikbaar', STALE: 'Eerder opgehaald' })[status]
    ?? 'Niet beschikbaar';
}

export function visibleGoogleData<T>(source: GoogleAnalyticsSource<T> | null | undefined): T | null {
  if (!source || !['CONNECTED', 'NO_DATA', 'STALE'].includes(source.status)) return null;
  return source.data ?? null;
}

/** Absolute Search Console URLs retain their host; relative Analytics paths stay compact. */
export function googlePageLabel(value: string): string {
  if (!value) return 'Onbekende pagina';
  try {
    const url = new URL(value, 'https://enrosed.com');
    const absolute = /^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(value.trim());
    return absolute ? `${url.hostname}${url.pathname}` : url.pathname;
  } catch { return value.split(/[?#]/, 1)[0] || 'Onbekende pagina'; }
}

export function googleBarHeight(value: number, values: readonly number[]): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const maximum = Math.max(0, ...values.filter((item) => Number.isFinite(item) && item >= 0));
  return maximum > 0 ? Math.max(2, value / maximum * 100) : 0;
}

export interface GoogleTimelineDay { date: string; value: number | null; }

/** Sparse provider rows must keep their real calendar position; missing is not zero. */
export function googleTimeline<T extends { date: string }>(
  from: string | null | undefined, to: string | null | undefined,
  rows: readonly T[], valueOf: (row: T) => number,
): GoogleTimelineDay[] {
  const dateValue = (value: string | null | undefined): number => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.NaN;
    const parsed = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : Number.NaN;
  };
  const start = dateValue(from), end = dateValue(to), dayMs = 86_400_000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || (end - start) / dayMs > 365) return [];
  const byDate = new Map(rows.map(row => [row.date, valueOf(row)]));
  return Array.from({ length: (end - start) / dayMs + 1 }, (_, index) => {
    const date = new Date(start + index * dayMs).toISOString().slice(0, 10);
    const value = byDate.get(date);
    return { date, value: typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null };
  });
}

export function googleLeadCount(events: readonly { name: string; count: number }[]): number | null {
  const leads = events.filter(event => event.name === 'generate_lead');
  if (leads.some(event => !Number.isFinite(event.count) || event.count < 0)) return null;
  return leads.reduce((total, event) => total + event.count, 0);
}
