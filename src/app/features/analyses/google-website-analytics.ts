import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { AnalyticsApi, GoogleSearchConsoleReport, GoogleWebsiteReport } from '../../core/api/analytics-api';
import { messageOf } from '../../core/api/errors';
import { SearchConsoleReport } from './search-console-report';
import { googleBarHeight, googleTimeline, googleLeadCount, googleDate, googleMetric, googlePageLabel, googlePercentage, googleSourceLabel, visibleGoogleData } from './google-analytics-display';

@Component({
  selector: 'app-google-website-analytics',
  imports: [SearchConsoleReport],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (source() === 'SEARCH_CONSOLE') {
      <section class="google-report" aria-label="Google Search Console" [attr.aria-busy]="loading()">
        @if (loading()) {
          <div class="google-state" role="status"><span class="google-state__loader" aria-hidden="true"></span>Zoekprestaties ophalen…</div>
        } @else if (error(); as failure) {
          <div class="google-state google-state--error" role="alert"><b>Search Console kon niet worden opgehaald</b><p>{{ failure }}</p><button class="btn btn--sm" type="button" (click)="reload()">Opnieuw proberen</button></div>
        } @else if (searchReport()?.searchConsole; as provider) {
          <header class="google-head"><div><span class="google-eyebrow">Vindbaarheid in Google</span><h3>Search Console</h3><p>{{ date(provider.from) }} – {{ date(provider.to) }}</p></div><span class="google-status" [class.google-status--warning]="provider.status === 'STALE' || provider.status === 'ERROR'" [class.google-status--ready]="provider.status === 'CONNECTED'">{{ status(provider.status) }}</span></header>
          @if (provider.status === 'NOT_CONFIGURED') {
            <div class="google-state"><b>Search Console is nog niet gekoppeld</b><p>{{ provider.message || 'De beveiligde serverkoppeling heeft nog geen toegang tot deze property.' }}</p><span class="google-property">{{ provider.property }}</span><button class="btn btn--sm" type="button" (click)="reload()">Koppeling opnieuw controleren</button></div>
          } @else if (provider.status === 'ERROR') {
            <div class="google-state google-state--error" role="alert"><b>Search Console is tijdelijk niet beschikbaar</b><p>{{ provider.message || 'Google heeft geen bruikbaar rapport teruggestuurd.' }}</p><button class="btn btn--sm" type="button" (click)="reload()">Opnieuw proberen</button></div>
          } @else {
            @if (provider.status === 'STALE') { <div class="google-notice google-notice--warning" role="status"><b>Je ziet eerder opgehaalde gegevens.</b> De laatste vernieuwing is niet gelukt. {{ provider.message }} <button type="button" (click)="reload()">Opnieuw proberen</button></div> }
            @if (provider.status === 'NO_DATA') { <div class="google-notice"><b>Nog geen zoekresultaten voor deze periode.</b><p>Search Console verwerkt zoekgegevens met vertraging. Een ontbrekend deelrapport betekent geen gemeten nul.</p></div> }
            <app-search-console-report [source]="provider" (reloadRequested)="reload()" />
            <footer class="google-freshness">Opgehaald: {{ date(provider.fetchedAt, true) }} · Tijd weergegeven in België. Vernieuwen kan binnen de cacheperiode hetzelfde rapport opleveren.</footer>
          }
        }
      </section>
    } @else {
    <section class="google-report" [attr.aria-label]="source() === 'GA4' ? 'Google Analytics 4' : 'Google Search Console'" [attr.aria-busy]="loading()">
      @if (loading()) {
        <div class="google-state" role="status"><span class="google-state__loader" aria-hidden="true"></span>Google-rapport ophalen…</div>
      } @else if (error(); as failure) {
        <div class="google-state google-state--error" role="alert"><b>Google-gegevens konden niet worden opgehaald</b><p>{{ failure }}</p><button class="btn btn--sm" type="button" (click)="reload()">Opnieuw proberen</button></div>
      } @else if (report(); as r) {
        @if (selectedSource(); as provider) {
          <header class="google-head">
            <div><span class="google-eyebrow">{{ source() === 'GA4' ? 'Bezoekers en gedrag' : 'Vindbaarheid in Google' }}</span><h3>{{ source() === 'GA4' ? 'Google Analytics 4' : 'Search Console' }}</h3><p>{{ date(provider.from) }} – {{ date(provider.to) }}</p></div>
            <span class="google-status" [class.google-status--warning]="provider.status === 'STALE' || provider.status === 'ERROR'" [class.google-status--ready]="provider.status === 'CONNECTED'">{{ status(provider.status) }}</span>
          </header>
          @if (source() === 'GA4') {
            @if (realtimeData(); as live) {
              <div class="google-realtime"><i aria-hidden="true"></i><b>{{ metric(live.activeUsers) }}</b><span>actieve gebruikers in de laatste {{ metric(live.windowMinutes) }} minuten</span><small>{{ r.realtime.status === 'STALE' ? 'Eerder opgehaald · ' : '' }}{{ date(r.realtime.fetchedAt, true) }}</small></div>
            } @else if (r.realtime.status === 'ERROR') {
              <div class="google-notice" role="status"><b>Realtime tijdelijk niet beschikbaar.</b> {{ r.realtime.message || 'De overige Google-rapporten blijven hieronder beschikbaar.' }}</div>
            }
          }
          @if (provider.status === 'NOT_CONFIGURED') {
            <div class="google-state"><b>Deze Google-bron is nog niet gekoppeld</b><p>{{ provider.message || 'De beveiligde serverkoppeling moet nog toegang krijgen tot deze property. Zodra dat geregeld is, verschijnen de beschikbare gegevens hier.' }}</p><span class="google-property">{{ provider.property }}</span><button class="btn btn--sm" type="button" (click)="reload()">Koppeling opnieuw controleren</button></div>
          } @else if (provider.status === 'ERROR') {
            <div class="google-state google-state--error" role="alert"><b>Deze bron is tijdelijk niet beschikbaar</b><p>{{ provider.message || 'Google heeft geen bruikbaar rapport teruggestuurd. Probeer het opnieuw.' }}</p><button class="btn btn--sm" type="button" (click)="reload()">Opnieuw proberen</button></div>
          } @else {
            @if (provider.status === 'STALE') {
              <div class="google-notice google-notice--warning" role="status"><b>De laatste vernieuwing is niet gelukt.</b> Je ziet de eerder opgehaalde gegevens van {{ date(provider.fetchedAt, true) }}. {{ provider.message }} <button type="button" (click)="reload()">Opnieuw proberen</button></div>
            }
            @if (provider.status === 'NO_DATA') {
              <div class="google-notice"><b>{{ source() === 'GA4' ? 'Google heeft voor deze periode nog geen activiteit gerapporteerd.' : 'Nog geen zoekresultaten voor deze periode.' }}</b><p>{{ source() === 'GA4' ? 'Bij een nieuwe koppeling of recente bezoeken kan realtime al activiteit tonen terwijl de standaardrapporten nog worden verwerkt. Eerdere bezoekers worden niet achteraf aangevuld.' : 'Search Console verwerkt zoekgegevens met vertraging. Kies eventueel een ruimere periode; nul zoekverkeer en een nog te verwerken periode zijn hier niet van elkaar te onderscheiden.' }}</p></div>
            }
            @if (source() === 'GA4') {
              @if (analyticsData(); as data) {
                <div class="google-kpis">
                  <div><span>Gebruikers</span><b>{{ metric(data.totals.users) }}</b></div>
                  <div><span>Sessies</span><b>{{ metric(data.totals.sessions) }}</b></div>
                  <div><span>Paginaweergaven</span><b>{{ metric(data.totals.views) }}</b></div>
                  <div><span>Betrokken sessies</span><b>{{ metric(data.totals.engagedSessions) }}</b><small>{{ percentage(data.totals.engagementRate) }} van de sessies</small></div>
                </div>
                <div class="google-footnote">Gemiddelde sessieduur: {{ metric(data.totals.avgSessionDurationSeconds, 1) }} s · Belangrijke gebeurtenissen: {{ metric(data.totals.keyEvents) }}</div>
                @if (sessionTimeline().length) {
                  <section class="google-card google-trend"><div class="google-card__head"><h4>Sessies per dag</h4><span>{{ metric(data.totals.sessions) }} totaal</span></div><div class="google-chart" role="img" aria-label="Google Analytics-sessies per dag">
                    @for (day of sessionTimeline(); track day.date) { <div [class.google-chart__missing]="day.value === null" [attr.title]="date(day.date) + ': ' + (day.value === null ? 'Geen gegevens' : metric(day.value) + ' sessies')"><i [style.height.%]="bar(day.value ?? 0, sessionValues())"></i></div> }
                  </div><div class="google-axis"><span>{{ date(provider.from) }}</span><span>{{ date(provider.to) }}</span></div></section>
                }
                <div class="google-grid">
                  <details class="google-card google-breakdown"><summary>Kanalen</summary><ol class="google-list">
                    @for (channel of data.channels.slice(0, 8); track channel.channel) { <li><span>{{ channel.channel }}</span><b>{{ metric(channel.sessions) }}<small>sessies</small></b></li> } @empty { <li class="google-empty">Nog geen kanaalgegevens</li> }
                  </ol></details>
                  <details class="google-card google-breakdown"><summary>Meest bekeken pagina’s</summary><ol class="google-list">
                    @for (page of data.pages.slice(0, 8); track page.path) { <li><span class="google-path" [title]="pageLabel(page.path)">{{ pageLabel(page.path) }}</span><b>{{ metric(page.views) }}<small>weergaven</small></b></li> } @empty { <li class="google-empty">Nog geen paginagegevens</li> }
                  </ol></details>
                </div>
                <div class="google-card google-leads"><div><h4>Ingediende aanvragen</h4><p>Succesvolle offerte- en contactaanvragen, gemeten door Google als generate_lead.</p></div><b>{{ metric(leadCount(data.events)) }}</b></div>
                <details class="google-explanation"><summary>Over deze cijfers en de koppeling</summary><p>Google Analytics telt gebruikers en sessies volgens zijn eigen meetregels. Toestemming, advertentieblokkers en verwerkingstijd kunnen verschillen met de eigen websitemeting veroorzaken. Tel deze bronnen niet bij elkaar op.</p><p>Property: <b>{{ provider.property }}</b> · Rapporttijdzone: {{ data.timeZone || 'Niet beschikbaar' }}</p><p>Laatste dag met geretourneerde gegevens: {{ date(data.availableThrough) }}. Dit betekent niet dat die dag volledig verwerkt is.</p>@for (warning of data.warnings; track $index) { <p>{{ warning }}</p> }</details>
              }
            }
            <footer class="google-freshness">Opgehaald: {{ date(provider.fetchedAt, true) }} · Tijd weergegeven in België. Vernieuwen kan binnen de cacheperiode hetzelfde Google-rapport opleveren.</footer>
          }
        }
      }
    </section>
    }
  `,
  styles: `
    :host{display:block;min-width:0}.google-report{display:grid;gap:14px;min-width:0}.google-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.google-head h3{font-size:clamp(22px,3vw,29px);letter-spacing:-.035em;margin:3px 0 6px}.google-head p{margin:0;color:var(--muted);font-size:12px}.google-eyebrow{font-size:11px;font-weight:700;color:var(--rose-dark)}.google-status{padding:7px 10px;border-radius:999px;background:var(--surface-2);border:1px solid var(--line);color:var(--muted);font-size:11px;font-weight:700;flex:none}.google-status--ready{background:color-mix(in srgb,var(--ok) 9%,var(--surface));color:var(--ok)}.google-status--warning{color:var(--danger)}
    .google-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.google-kpis>div{display:grid;align-content:start;gap:7px;padding:18px;border:1px solid var(--line);border-radius:20px;background:var(--surface);min-width:0}.google-kpis span{font-size:12px;color:var(--muted)}.google-kpis b{font-size:clamp(25px,3vw,34px);letter-spacing:-.04em;line-height:1.15;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}.google-kpis small{font-size:11px;color:var(--muted)}.google-realtime{display:flex;flex-wrap:wrap;align-items:center;gap:7px 9px;padding:12px 15px;background:var(--surface-2);border-radius:16px;font-size:12px}.google-realtime i{height:7px;width:7px;background:var(--ok);border-radius:50%;flex:none}.google-realtime>b{font-size:18px;font-variant-numeric:tabular-nums}.google-realtime small{color:var(--muted);margin-left:auto;font-size:10px}
    .google-card{min-width:0;background:var(--surface);border:1px solid var(--line);border-radius:22px;padding:18px}.google-card h4{font-size:15px;margin:0 0 13px}.google-card__head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.google-card__head>span{font-size:11px;color:var(--muted)}.google-breakdown>summary{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:44px;cursor:pointer;font-size:14px;font-weight:650;list-style:none}.google-breakdown>summary::-webkit-details-marker{display:none}.google-breakdown>summary::after{content:"+";color:var(--muted);font-size:20px;font-weight:400}.google-breakdown[open]>summary::after{content:"−"}.google-breakdown[open]>summary{margin-bottom:8px}.google-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.google-list{list-style:none;padding:0;margin:0;display:grid;gap:2px}.google-list li{min-width:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;min-height:44px;border-top:1px solid var(--line);font-size:12px}.google-list li:first-child{border-top:0}.google-list li>span{min-width:0;overflow-wrap:anywhere}.google-list li>b{text-align:right;flex:none;font-variant-numeric:tabular-nums}.google-list small{display:block;color:var(--muted);font-size:10px;font-weight:400;line-height:1.5;margin-top:2px}.google-path{overflow:hidden;text-overflow:ellipsis}.google-empty,.google-footnote{font-size:11px;color:var(--muted);line-height:1.6}.google-footnote{margin:0}.google-chart{height:145px;display:flex;gap:0;align-items:flex-end;min-width:0}.google-chart>div{height:100%;position:relative;min-width:0;flex:1}.google-chart i{display:block;position:absolute;bottom:0;width:80%;left:10%;border-radius:3px 3px 0 0;background:color-mix(in srgb,var(--rose) 65%,var(--surface))}.google-chart__missing{border-bottom:1px dashed var(--line)}.google-chart--search i{background:#497bc1}.google-axis{display:flex;justify-content:space-between;gap:12px;margin-top:7px;color:var(--muted);font-size:10px}.google-leads{display:flex;align-items:center;justify-content:space-between;gap:15px}.google-leads h4{margin-bottom:5px}.google-leads p{font-size:11px;color:var(--muted);margin:0}.google-leads>b{font-size:27px}
    .google-state{display:grid;justify-items:start;gap:12px;padding:24px;border-radius:22px;border:1px solid var(--line);background:var(--surface);font-size:13px;line-height:1.6}.google-state p{margin:0;max-width:68ch;color:var(--muted)}.google-state--error{color:var(--danger)}.google-property{font-size:12px;color:var(--muted);overflow-wrap:anywhere}.google-notice{padding:16px 18px;border-radius:18px;border:1px solid var(--line);background:var(--surface-2);font-size:12px;line-height:1.65}.google-notice p{margin:5px 0 0;color:var(--muted)}.google-notice--warning{border-color:color-mix(in srgb,var(--danger) 30%,var(--line))}.google-notice button{background:none;border:0;text-decoration:underline;color:inherit;font:inherit;min-height:44px;padding:0 6px}.google-explanation{border:1px solid var(--line);border-radius:18px;background:var(--surface)}.google-explanation summary{padding:14px 16px;font-size:12px;font-weight:650;min-height:44px;cursor:pointer}.google-explanation p{font-size:12px;color:var(--muted);line-height:1.6;margin:0;padding:0 16px 12px;overflow-wrap:anywhere}.google-freshness{font-size:10px;line-height:1.6;color:var(--muted)}.google-state__loader{width:18px;height:18px;border:2px solid var(--line);border-top-color:var(--rose);border-radius:50%;animation:google-turn 1s linear infinite}button:focus-visible,summary:focus-visible{outline:2px solid var(--rose);outline-offset:3px}.btn{min-height:44px}@keyframes google-turn{to{transform:rotate(360deg)}}
    @media(max-width:679px){.google-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.google-kpis>div{padding:14px;border-radius:18px}.google-kpis b{font-size:26px}.google-grid{grid-template-columns:1fr}.google-card{padding:15px;border-radius:20px}.google-head{flex-wrap:wrap}.google-status{font-size:10px}.google-realtime small{flex-basis:100%;margin-left:16px}.google-state{padding:19px}.google-chart{height:115px}}
    @media(prefers-reduced-motion:reduce){.google-state__loader{animation:none}}
  `,
})
export class GoogleWebsiteAnalytics {
  readonly source = input<'GA4' | 'SEARCH_CONSOLE'>('GA4');
  readonly days = input(30);
  readonly refreshKey = input(0);
  readonly loadingChanged = output<boolean>();
  private readonly analytics = inject(AnalyticsApi);
  private readonly destroyRef = inject(DestroyRef);
  readonly report = signal<GoogleWebsiteReport | null>(null);
  readonly searchReport = signal<GoogleSearchConsoleReport | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly selectedSource = computed(() => this.source() === 'GA4'
    ? this.report()?.googleAnalytics ?? null : this.report()?.searchConsole ?? null);
  readonly analyticsData = computed(() => visibleGoogleData(this.report()?.googleAnalytics));
  readonly realtimeData = computed(() => visibleGoogleData(this.report()?.realtime));
  readonly sessionTimeline = computed(() => googleTimeline(this.report()?.googleAnalytics.from, this.report()?.googleAnalytics.to, this.analyticsData()?.perDay ?? [], day => day.sessions));
  readonly sessionValues = computed(() => this.analyticsData()?.perDay.map((day) => day.sessions) ?? []);
  private loadVersion = 0;
  private requestedDays: number | null = null;
  private requestedSource: 'GA4' | 'SEARCH_CONSOLE' | null = null;
  readonly metric = googleMetric;
  readonly percentage = googlePercentage;
  readonly date = googleDate;
  readonly status = googleSourceLabel;
  readonly pageLabel = googlePageLabel;
  readonly bar = googleBarHeight;
  readonly leadCount = googleLeadCount;

  constructor() {
    this.destroyRef.onDestroy(() => ++this.loadVersion);
    effect(() => { this.days(); this.source(); this.refreshKey(); untracked(() => void this.reload()); });
  }

  async reload(): Promise<void> {
    const days = this.days();
    const source = this.source();
    if (this.loading() && this.requestedDays === days && this.requestedSource === source) return;
    const version = ++this.loadVersion;
    this.requestedDays = days;
    this.requestedSource = source;
    this.loading.set(true);
    this.loadingChanged.emit(true);
    this.error.set(null);
    // Never label a report from the previous period with the newly selected dates.
    this.report.set(null);
    this.searchReport.set(null);
    try {
      if (source === 'SEARCH_CONSOLE') {
        const report = await this.analytics.searchConsoleReport(days);
        if (version !== this.loadVersion) return;
        if (!report || report.days !== days || !report.searchConsole
          || !['CONNECTED', 'NO_DATA', 'STALE', 'ERROR', 'NOT_CONFIGURED'].includes(report.searchConsole.status)
          || (['CONNECTED', 'NO_DATA', 'STALE'].includes(report.searchConsole.status) && !report.searchConsole.data)) {
          throw new Error('Google gaf een onvolledig rapport terug. Probeer het opnieuw.');
        }
        const data = report.searchConsole.data;
        const validMetrics = (row: unknown): boolean => {
          if (!row || typeof row !== 'object') return false;
          const values = row as Record<string, unknown>;
          return ['clicks', 'impressions', 'ctr', 'position'].every(key =>
            typeof values[key] === 'number' && Number.isFinite(values[key]) && values[key] >= 0)
            && (values['ctr'] as number) <= 1;
        };
        const validRows = (rows: unknown, key: string): boolean => Array.isArray(rows) && rows.every(row =>
          validMetrics(row) && typeof row[key] === 'string' && row[key].trim().length > 0);
        if (data && (!validMetrics(data.totals) || !validRows(data.perDay, 'date')
          || !validRows(data.queries, 'query') || !validRows(data.pages, 'page') || !Array.isArray(data.warnings))) {
          throw new Error('Google gaf een onvolledig rapport terug. Probeer het opnieuw.');
        }
        this.searchReport.set(report);
        return;
      }
      const report = await this.analytics.googleWebsiteReport(days);
      if (version !== this.loadVersion) return;
      if (!report || report.days !== days || !report.googleAnalytics || !report.searchConsole || !report.realtime) {
        throw new Error('Google gaf een onvolledig rapport terug. Probeer het opnieuw.');
      }
      this.report.set(report);
    } catch (failure: unknown) {
      if (version !== this.loadVersion) return;
      this.error.set(messageOf(failure, 'Probeer het opnieuw. De eigen websitemeting blijft afzonderlijk beschikbaar.'));
    } finally {
      if (version === this.loadVersion) { this.loading.set(false); this.loadingChanged.emit(false); }
    }
  }
}
