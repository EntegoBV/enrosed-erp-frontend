import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';

/** Visits of the public website, as the ERP folds them for Analyses › Website. */
export interface WebsiteAnalyticsReport {
  days: number;
  from: string;
  to: string;
  totals: {
    visits: number;
    visitors: number;
    sessions: number;
    pagesPerSession: number;
    countries: number;
    /** Sessions of a single page, as a share of all sessions. */
    bounceRatePct: number;
    /** Over sessions that had a second page; a lone view has no length. */
    avgSessionSeconds: number;
    /** Visitors seen in the last half hour, whatever the period. */
    activeNow: number;
  };
  /** The same window one period earlier. */
  previous: { visits: number; visitors: number; sessions: number; quoteSessions: number };
  perDay: { date: string; visits: number; visitors: number }[];
  perHour: { hour: number; visits: number; visitors: number }[];
  pages: WebsitePageRow[];
  kinds: { kind: WebsitePageKind; visits: number }[];
  countries: { country: string | null; visits: number; visitors: number }[];
  cities: { city: string; country: string; visits: number }[];
  sources: { source: string; kind: 'DIRECT' | 'SEARCH' | 'SOCIAL' | 'CAMPAIGN' | 'SITE'; visits: number }[];
  /** Visits per weekday (Monday first) and hour, Brussels time. */
  hours: number[][];
  devices: { device: 'MOBILE' | 'TABLET' | 'DESKTOP'; visits: number }[];
  locales: { locale: string; visits: number }[];
  /** Where sessions began and ended; `visits` counts sessions on these rows. */
  entryPages: WebsitePageRow[];
  exitPages: WebsitePageRow[];
  funnel: { sessions: number; productSessions: number; quoteSessions: number; contactSessions: number };
  /** Our own Belgian towns, left out of every number. */
  excludedCities: string[];
  generatedAt: string;
}

export interface WebsitePageRow {
  path: string;
  kind: WebsitePageKind;
  visits: number;
  visitors: number;
}

export type WebsitePageKind =
  | 'HOME' | 'PRODUCTS' | 'COLLECTION' | 'PRODUCT' | 'QUOTE' | 'CONTACT' | 'LEGAL' | 'OTHER';

export type GoogleAnalyticsStatus = 'NOT_CONFIGURED' | 'CONNECTED' | 'NO_DATA' | 'ERROR' | 'STALE';

export interface GoogleAnalyticsSource<T> {
  status: GoogleAnalyticsStatus;
  property: string;
  from: string | null;
  to: string | null;
  fetchedAt: string | null;
  errorCode: string | null;
  message: string | null;
  data: T | null;
}

export interface GoogleAnalyticsData {
  totals: {
    users: number; sessions: number; views: number; engagedSessions: number;
    engagementRate: number; keyEvents: number; avgSessionDurationSeconds: number;
  };
  perDay: { date: string; users: number; sessions: number; views: number }[];
  pages: { path: string; views: number; users: number }[];
  channels: { channel: string; sessions: number; users: number }[];
  events: { name: string; count: number }[];
  timeZone: string | null;
  availableThrough: string | null;
  warnings: string[];
}

export interface SearchPerformance {
  clicks: number; impressions: number; ctr: number; position: number;
}

export interface GoogleSearchComparison {
  status: GoogleAnalyticsStatus;
  from: string | null;
  to: string | null;
  totals: SearchPerformance | null;
  errorCode: string | null;
  message: string | null;
}

export interface GoogleSearchDevices {
  status: GoogleAnalyticsStatus;
  rows: (SearchPerformance & { device: string })[] | null;
  errorCode: string | null;
  message: string | null;
}

export interface GoogleSearchIssue {
  section: 'AVAILABILITY' | 'PER_DAY' | 'QUERIES' | 'PAGES';
  errorCode: string;
  message: string;
}

export interface GoogleSearchData {
  totals: SearchPerformance;
  perDay: (SearchPerformance & { date: string })[];
  queries: (SearchPerformance & { query: string })[];
  pages: (SearchPerformance & { page: string })[];
  dataState: 'final';
  timeZone: string;
  availableThrough: string | null;
  warnings: string[];
  /** Optional while the combined GA4 endpoint retains its existing report shape. */
  comparison?: GoogleSearchComparison | null;
  devices?: GoogleSearchDevices | null;
  rowLimit?: number | null;
  periodBasis?: 'GOOGLE_FINAL_BOUNDARY' | 'LATEST_REPORTED_FINAL_DAY' | 'UNCONFIRMED' | null;
  issues?: GoogleSearchIssue[];
}

export interface GoogleSearchConsoleReport {
  days: number;
  generatedAt: string;
  searchConsole: GoogleAnalyticsSource<GoogleSearchData>;
}

export interface GoogleWebsiteReport {
  days: number;
  from: string;
  to: string;
  generatedAt: string;
  googleAnalytics: GoogleAnalyticsSource<GoogleAnalyticsData>;
  searchConsole: GoogleAnalyticsSource<GoogleSearchData>;
  realtime: GoogleAnalyticsSource<{ activeUsers: number; windowMinutes: number }>;
}

@Injectable({ providedIn: 'root' })
export class AnalyticsApi {
  private readonly http = inject(HttpClient);

  websiteReport(days: number): Promise<WebsiteAnalyticsReport> {
    return firstValueFrom(this.http.get<WebsiteAnalyticsReport>(
      api(`/api/analytics/website?days=${days}`)));
  }

  googleWebsiteReport(days: number): Promise<GoogleWebsiteReport> {
    return firstValueFrom(this.http.get<GoogleWebsiteReport>(
      api(`/api/analytics/website/google?days=${days}`)));
  }

  searchConsoleReport(days: number): Promise<GoogleSearchConsoleReport> {
    return firstValueFrom(this.http.get<GoogleSearchConsoleReport>(
      api(`/api/analytics/website/search-console?days=${days}`)));
  }
}
