import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AnalyticsApi, GoogleAnalyticsSource, GoogleSearchData } from '../../core/api/analytics-api';
import { messageOf } from '../../core/api/errors';
import { Icon } from '../../shared/icon';
import { googleDate, googleMetric, googlePercentage, googleSourceLabel, visibleGoogleData } from '../analyses/google-analytics-display';
import { dashboardSearchSource } from './dashboard-search-console-state';

@Component({
  selector: 'app-dashboard-search-console',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon],
  template: `
    <section class="search-summary" aria-labelledby="home-search-title" [attr.aria-busy]="loading()">
      <header class="search-summary__head">
        <span class="search-summary__icon"><app-icon name="analytics" [size]="18" /></span>
        <div><h3 id="home-search-title">Search Console</h3><p>Google zoeken · afgelopen 30 dagen</p></div>
      </header>

      @if (loading()) {
        <p class="search-summary__state" role="status">Zoekcijfers ophalen…</p>
      } @else if (error(); as failure) {
        <div class="search-summary__state search-summary__state--error" role="alert">
          <b>Zoekcijfers niet beschikbaar</b><p>{{ failure }}</p>
          <button type="button" (click)="reload()">Opnieuw proberen</button>
        </div>
      } @else if (source(); as provider) {
        @if (provider.status === 'NOT_CONFIGURED' || provider.status === 'ERROR') {
          <div class="search-summary__state" [class.search-summary__state--error]="provider.status === 'ERROR'" role="status">
            <b>{{ provider.status === 'NOT_CONFIGURED' ? 'Nog niet gekoppeld' : 'Zoekcijfers niet beschikbaar' }}</b>
            <p>{{ provider.message || 'De Google-koppeling heeft nog geen bruikbaar rapport geleverd.' }}</p>
            <button type="button" (click)="reload()">{{ provider.status === 'NOT_CONFIGURED' ? 'Koppeling controleren' : 'Opnieuw proberen' }}</button>
          </div>
        } @else if (data(); as search) {
          @if (provider.status === 'STALE') {
            <p class="search-summary__notice" role="status">Eerder opgehaald · vernieuwen is niet gelukt. <button type="button" (click)="reload()">Opnieuw</button></p>
          } @else if (provider.status === 'NO_DATA') {
            <p class="search-summary__notice" role="status">Nog geen zoekgegevens gerapporteerd. Recente dagen kunnen nog ontbreken.</p>
          }
          <dl class="search-summary__metrics">
            <div><dt>Klikken</dt><dd>{{ metric(search.totals.clicks) }}</dd></div>
            <div><dt>Vertoningen</dt><dd>{{ metric(search.totals.impressions) }}</dd></div>
            <div><dt>Klikratio (CTR)</dt><dd>{{ search.totals.impressions > 0 ? percentage(search.totals.ctr) : '—' }}</dd></div>
            <div><dt>Gemiddelde positie</dt><dd>{{ search.totals.impressions > 0 ? metric(search.totals.position, 1) : '—' }}</dd></div>
          </dl>
          <details class="search-summary__details">
            <summary><span>Periode en actualiteit</span><small>{{ status(provider.status) }}</small></summary>
            <p>{{ date(provider.from) }} – {{ date(provider.to) }} · {{ search.timeZone }}</p>
            <p>Opgehaald: {{ date(provider.fetchedAt, true) }}.</p>
            <p>Laatste dag met gegevens: {{ date(search.availableThrough) }}. Recente dagen kunnen nog ontbreken.</p>
            <p>Zoekprestaties zijn geen bezoekersaantallen. Een lagere gemiddelde positie is beter, maar is geen vaste ranking.</p>
          </details>
        }
      }
      <a class="search-summary__link" routerLink="/analyses/website" [queryParams]="{ source: 'SEARCH_CONSOLE', days: 30 }">Bekijk websiteanalyse <span aria-hidden="true">›</span></a>
    </section>
  `,
  styles: `
    :host { display: block; grid-column: 1 / -1; min-width: 0; }
    .search-summary { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); box-shadow: var(--sh-1); }
    .search-summary__head { display: flex; align-items: center; gap: 9px; padding: 13px 14px 12px; }
    .search-summary__head > div { min-width: 0; }
    .search-summary__head h3 { margin: 0; font-size: 14px; font-weight: 750; letter-spacing: -.02em; }
    .search-summary__head p { margin: 3px 0 0; color: var(--muted); font-size: 10.5px; line-height: 1.5; }
    .search-summary__icon { display: grid; place-items: center; flex: none; width: 33px; height: 33px; color: #386db2; border-radius: 11px; background: color-mix(in srgb, #497bc1 11%, var(--surface)); }
    .search-summary__metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; margin: 0; padding: 2px 15px 15px; }
    .search-summary__metrics > div { min-width: 0; }
    .search-summary__metrics dt { color: var(--muted); font-size: 10.5px; line-height: 1.4; }
    .search-summary__metrics dd { margin: 4px 0 0; color: var(--ink); font-size: 24px; font-weight: 750; line-height: 1.1; letter-spacing: -.035em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .search-summary__metrics > div:nth-child(n + 3) dd { font-size: 20px; }
    .search-summary__details { border-top: 1px solid var(--line); }
    .search-summary__details summary { display: flex; align-items: center; flex-wrap: wrap; gap: 5px 9px; min-height: 44px; padding: 9px 14px; cursor: pointer; font-size: 10.5px; list-style: none; }
    .search-summary__details summary::-webkit-details-marker { display: none; }
    .search-summary__details summary::after { content: '+'; font-size: 17px; color: var(--muted); margin-left: auto; }
    .search-summary__details[open] summary::after { content: '−'; }
    .search-summary__details small { color: var(--muted); font-size: 10px; }
    .search-summary__details p { margin: 0; padding: 0 14px 10px; color: var(--muted); font-size: 11px; line-height: 1.55; overflow-wrap: anywhere; }
    .search-summary__state { display: grid; justify-items: start; gap: 7px; margin: 0; padding: 3px 14px 13px; font-size: 12px; line-height: 1.5; }
    .search-summary__state p { margin: 0; color: var(--muted); font-size: 11px; }
    .search-summary__state--error > b { color: var(--danger); }
    .search-summary__state button, .search-summary__notice button { min-height: 44px; border: 0; border-radius: 10px; background: var(--surface-2); color: var(--ink-2); padding: 8px 12px; font: inherit; font-size: 11px; cursor: pointer; }
    .search-summary__notice { margin: 0 14px 12px; padding: 10px; border-radius: 11px; background: var(--surface-2); color: var(--muted); font-size: 11px; line-height: 1.5; }
    .search-summary__notice button { text-decoration: underline; }
    .search-summary__link { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 44px; padding: 10px 14px; border-top: 1px solid var(--line); color: var(--rose-dark); text-decoration: none; font-size: 11.5px; font-weight: 700; }
    .search-summary__link span { font-size: 18px; font-weight: 400; }
    .search-summary__link:hover { background: var(--surface-2); }
    .search-summary :is(a, button, summary):focus-visible { outline: 2px solid var(--rose); outline-offset: -3px; }
  `,
})
export class DashboardSearchConsole {
  private readonly analytics = inject(AnalyticsApi);
  private readonly destroyRef = inject(DestroyRef);
  private loadVersion = 0;
  readonly source = signal<GoogleAnalyticsSource<GoogleSearchData> | null>(null);
  readonly data = computed(() => visibleGoogleData(this.source()));
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly metric = googleMetric;
  readonly percentage = googlePercentage;
  readonly date = googleDate;
  readonly status = googleSourceLabel;

  constructor() {
    this.destroyRef.onDestroy(() => ++this.loadVersion);
    void this.reload();
  }

  async reload(): Promise<void> {
    if (this.loading()) return;
    const version = ++this.loadVersion;
    this.loading.set(true);
    this.error.set(null);
    this.source.set(null);
    try {
      const report = await this.analytics.googleWebsiteReport(30);
      if (version !== this.loadVersion) return;
      this.source.set(dashboardSearchSource(report));
    } catch (failure: unknown) {
      if (version === this.loadVersion) this.error.set(messageOf(failure, 'Probeer het opnieuw. De overige dashboardgegevens blijven beschikbaar.'));
    } finally {
      if (version === this.loadVersion) this.loading.set(false);
    }
  }
}
