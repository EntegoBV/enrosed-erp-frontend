import type { GoogleAnalyticsSource, GoogleSearchData, GoogleWebsiteReport } from '../../core/api/analytics-api';

/** Only this provider determines the card state; an unrelated GA error must not hide it. */
export function dashboardSearchSource(report: GoogleWebsiteReport): GoogleAnalyticsSource<GoogleSearchData> {
  const source = report?.searchConsole;
  if (report?.days !== 30 || !source || !['CONNECTED', 'NO_DATA', 'STALE', 'ERROR', 'NOT_CONFIGURED'].includes(source.status)) {
    throw new Error('Search Console gaf een onvolledig rapport terug.');
  }
  if (['CONNECTED', 'NO_DATA', 'STALE'].includes(source.status)) {
    const totals = source.data?.totals;
    if (!totals || ![totals.clicks, totals.impressions, totals.ctr, totals.position]
      .every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0) || totals.ctr > 1) {
      throw new Error('Search Console gaf onvolledige zoekcijfers terug.');
    }
  }
  return source;
}
