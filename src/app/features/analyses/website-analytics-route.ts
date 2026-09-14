import type { ParamMap } from '@angular/router';

export type WebsiteAnalyticsSource = 'INTERNAL' | 'GA4' | 'SEARCH_CONSOLE';

/** Only supported tabs and existing period choices may be selected by a link. */
export function websiteAnalyticsRouteState(params: Pick<ParamMap, 'getAll'>): { source: WebsiteAnalyticsSource; days: number } {
  const sources = params.getAll('source');
  const periods = params.getAll('days');
  const source = sources.length === 1 && ['INTERNAL', 'GA4', 'SEARCH_CONSOLE'].includes(sources[0])
    ? sources[0] as WebsiteAnalyticsSource : 'INTERNAL';
  const days = periods.length === 1 && ['1', '7', '30', '90', '365'].includes(periods[0])
    ? Number(periods[0]) : 30;
  return { source, days };
}
