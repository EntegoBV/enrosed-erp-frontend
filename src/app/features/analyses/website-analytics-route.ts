import type { ParamMap } from '@angular/router';

/** ACCOUNTS = Klantlogins: how the customers' website logins are used. */
export type WebsiteAnalyticsSource = 'INTERNAL' | 'GA4' | 'SEARCH_CONSOLE' | 'ACCOUNTS';

const SOURCES: readonly WebsiteAnalyticsSource[] = ['INTERNAL', 'GA4', 'SEARCH_CONSOLE', 'ACCOUNTS'];

/** Only supported tabs and existing period choices may be selected by a link; login (Klantlogins only) is one login's id. */
export function websiteAnalyticsRouteState(params: Pick<ParamMap, 'getAll'>): { source: WebsiteAnalyticsSource; days: number; login: number | null } {
  const sources = params.getAll('source');
  const periods = params.getAll('days');
  const logins = params.getAll('login');
  const source = sources.length === 1 && (SOURCES as readonly string[]).includes(sources[0])
    ? sources[0] as WebsiteAnalyticsSource : 'INTERNAL';
  const days = periods.length === 1 && ['1', '7', '30', '90', '365'].includes(periods[0])
    ? Number(periods[0]) : 30;
  const login = source === 'ACCOUNTS' && logins.length === 1 && /^[1-9]\d{0,15}$/.test(logins[0]) ? Number(logins[0]) : null;
  return { source, days, login };
}

/** The query a selection writes back (replaceUrl, merged): the defaults leave the address clean. */
export function websiteAnalyticsQuery(source: WebsiteAnalyticsSource, days: number, login: number | null = null): { source: string | null; days: string | null; login: string | null } {
  return {
    source: source === 'INTERNAL' ? null : source,
    days: days === 30 ? null : String(days),
    login: source === 'ACCOUNTS' && login !== null ? String(login) : null,
  };
}
