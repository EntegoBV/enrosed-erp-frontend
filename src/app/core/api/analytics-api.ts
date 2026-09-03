import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';

/** Visits of the public website, as the ERP folds them for Analyses › Website. */
export interface WebsiteAnalyticsReport {
  days: number;
  from: string;
  to: string;
  totals: { visits: number; visitors: number; sessions: number; pagesPerSession: number; countries: number };
  perDay: { date: string; visits: number; visitors: number }[];
  pages: { path: string; kind: WebsitePageKind; visits: number; visitors: number }[];
  kinds: { kind: WebsitePageKind; visits: number }[];
  countries: { country: string | null; visits: number; visitors: number }[];
  cities: { city: string; country: string; visits: number }[];
  sources: { source: string; kind: 'DIRECT' | 'SEARCH' | 'SOCIAL' | 'CAMPAIGN' | 'SITE'; visits: number }[];
  /** Visits per weekday (Monday first) and hour, Brussels time. */
  hours: number[][];
  devices: { device: 'MOBILE' | 'TABLET' | 'DESKTOP'; visits: number }[];
  locales: { locale: string; visits: number }[];
  /** Our own Belgian towns, left out of every number. */
  excludedCities: string[];
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
