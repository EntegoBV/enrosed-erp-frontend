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

@Injectable({ providedIn: 'root' })
export class AnalyticsApi {
  private readonly http = inject(HttpClient);

  websiteReport(days: number): Promise<WebsiteAnalyticsReport> {
    return firstValueFrom(this.http.get<WebsiteAnalyticsReport>(
      api(`/api/analytics/website?days=${days}`)));
  }
}
