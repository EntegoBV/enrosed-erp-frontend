import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { AnalyticsApi, WebsiteAnalyticsReport, WebsitePageKind } from '../../core/api/analytics-api';
import { messageOf } from '../../core/api/errors';
import { NumPipe } from '../../shared/pipes';
import { deltaOf, durationLabel } from './website-analytics-math';

const KIND_LABEL: Record<WebsitePageKind, string> = {
  HOME: 'Startpagina', PRODUCTS: 'Productoverzicht', COLLECTION: 'Collecties', PRODUCT: 'Productpagina’s',
  QUOTE: 'Offerte', CONTACT: 'Contact', LEGAL: 'Voorwaarden', OTHER: 'Overig',
};
const DEVICE_LABEL = { MOBILE: 'Telefoon', TABLET: 'Tablet', DESKTOP: 'Computer' } as const;
const WEEKDAYS = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];
const LANGUAGE_LABEL: Record<string, string> = {
  en: 'Engels', nl: 'Nederlands', fr: 'Frans', de: 'Duits', es: 'Spaans', pl: 'Pools', pt: 'Portugees', tr: 'Turks',
};
/** The website's public address; opening it with ?intern=1 silences that browser's beacon. */
const WEBSITE_OPT_OUT_URL = 'https://www.enrosed.com/?intern=1';

interface Range {
  days: number;
  label: string;
  /** How the period before this one is called in the delta line. */
  before: string;
}

const RANGES: readonly Range[] = [
  { days: 1, label: 'Vandaag', before: 'gisteren' },
  { days: 7, label: '7 dagen', before: 'de 7 dagen ervoor' },
  { days: 30, label: '30 dagen', before: 'de 30 dagen ervoor' },
  { days: 90, label: '90 dagen', before: 'de 90 dagen ervoor' },
  { days: 365, label: 'Jaar', before: 'het jaar ervoor' },
];

/**
 * Where the website's visitors come from, where they go and when: measured
 * without cookies or addresses, so the numbers are honest per day and
 * nobody had to click a banner for them.
 */
@Component({
  selector: 'app-website-analytics',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NumPipe],
  template: `
    <div class="wa__toolbar">
      <div class="wa__ranges" role="group" aria-label="Periode">
        @for (range of ranges; track range.days) {
          <button type="button" [class.on]="days() === range.days" (click)="days.set(range.days)">{{ range.label }}</button>
        }
      </div>
      <div class="wa__toolbar-side">
        @if (report(); as r) {
          <span class="wa__live" [class.wa__live--on]="r.totals.activeNow > 0" [title]="'Bezoekers gezien in het laatste half uur'">
            <i aria-hidden="true"></i>{{ r.totals.activeNow | num }} nu op de site
          </span>
        }
        <button class="wa__refresh" type="button" (click)="reload()" [disabled]="loading()" title="Vernieuwen" aria-label="Vernieuwen">↻</button>
      </div>
    </div>

    @if (loading() && !report()) {
      <p class="wa__state">Bezoekcijfers laden…</p>
    } @else if (error(); as error) {
      <p class="wa__state wa__state--error">{{ error }} <button class="linklike" type="button" (click)="reload()">Opnieuw proberen</button></p>
    } @else if (report(); as r) {
      <div class="wa__kpis" [class.wa__kpis--stale]="loading()">
        <div class="wa__kpi">
          <span>Bezoeken</span><b>{{ r.totals.visits | num }}</b>
          <small>{{ deltaLine(r.totals.visits, r.previous.visits) }}</small>
        </div>
        <div class="wa__kpi">
          <span>Unieke bezoekers</span><b>{{ r.totals.visitors | num }}</b>
          <small>{{ deltaLine(r.totals.visitors, r.previous.visitors) }}</small>
        </div>
        <div class="wa__kpi">
          <span>Sessies</span><b>{{ r.totals.sessions | num }}</b>
          <small>{{ deltaLine(r.totals.sessions, r.previous.sessions) }}</small>
        </div>
        <div class="wa__kpi">
          <span>Pagina’s per sessie</span><b>{{ r.totals.pagesPerSession }}</b>
          <small>{{ r.totals.sessions ? r.totals.bounceRatePct + ' % haakt na één pagina af' : 'nog geen sessies' }}</small>
        </div>
        <div class="wa__kpi">
          <span>Sessieduur</span><b>{{ duration(r.totals.avgSessionSeconds) }}</b>
          <small>gemiddeld, bij meer dan één pagina</small>
        </div>
        <div class="wa__kpi wa__kpi--accent">
          <span>Offerte-interesse</span><b>{{ r.funnel.quoteSessions | num }}</b>
          <small>{{ r.funnel.quoteSessions ? share(r.funnel.quoteSessions, r.funnel.sessions) + ' van de sessies · ' + deltaLine(r.funnel.quoteSessions, r.previous.quoteSessions, true) : 'nog niemand op de offertepagina' }}</small>
        </div>
      </div>

      @if (!r.totals.visits) {
        <p class="wa__state">{{ days() === 1 ? 'Nog geen bezoeken vandaag.' : 'Nog geen bezoeken in deze periode.' }}</p>
      }

      <div class="wa__grid">
        <section class="wa__card wa__card--wide">
          <div class="wa__card-head">
            <h3>{{ days() === 1 ? 'Bezoeken per uur' : 'Bezoeken per dag' }}</h3>
            <span class="wa__legend"><i></i> bezoeken <em></em> unieke bezoekers</span>
          </div>
          @if (days() === 1) {
            <div class="wa__chart" role="img" aria-label="Bezoeken per uur, vandaag">
              @for (hour of r.perHour; track hour.hour) {
                <div class="wa__bar" [class.wa__bar--future]="hour.hour > currentHour()" [title]="hour.hour + 'u: ' + hour.visits + ' bezoeken, ' + hour.visitors + ' bezoekers'">
                  <i [style.height.%]="barHeight(hour.visits, maxHourOfDay())"></i>
                  <em [style.height.%]="barHeight(hour.visitors, maxHourOfDay())"></em>
                </div>
              }
            </div>
            <div class="wa__axis"><span>0u</span><span>6u</span><span>12u</span><span>18u</span><span>23u</span></div>
          } @else {
            <div class="wa__chart" role="img" [attr.aria-label]="'Bezoeken per dag, ' + r.days + ' dagen'">
              @for (day of r.perDay; track day.date) {
                <div class="wa__bar" [class.wa__bar--weekend]="isWeekend(day.date)" [title]="dateLabel(day.date) + ': ' + day.visits + ' bezoeken, ' + day.visitors + ' bezoekers'">
                  <i [style.height.%]="barHeight(day.visits, maxDay())"></i>
                  <em [style.height.%]="barHeight(day.visitors, maxDay())"></em>
                </div>
              }
            </div>
            <div class="wa__axis"><span>{{ dateLabel(r.from) }}</span><span>piek {{ maxDay() | num }} op een dag</span><span>{{ dateLabel(r.to) }}</span></div>
          }
        </section>

        <section class="wa__card">
          <h3>Hoe ver komen ze</h3>
          <p class="wa__sub">Per sessie: van de eerste pagina tot de offerte</p>
          <div class="wa__funnel">
            @for (step of funnel(); track step.label) {
              <div class="wa__funnel-step">
                <div class="wa__funnel-copy"><b>{{ step.label }}</b><span>{{ step.count | num }} · {{ step.share }}</span></div>
                <div class="wa__funnel-track"><i [style.width.%]="step.width" [class.wa__funnel-fill--accent]="step.accent"></i></div>
              </div>
            }
          </div>
        </section>

        <section class="wa__card">
          <h3>Waar gaan bezoekers naartoe</h3>
          <div class="wa__kinds">
            @for (kind of r.kinds; track kind.kind) {
              <div class="wa__kind" [style.background]="heat(kind.visits, maxKind())"><b>{{ kindLabel(kind.kind) }}</b><span>{{ kind.visits | num }}</span></div>
            }
          </div>
          <ol class="wa__list">
            @for (page of r.pages.slice(0, 12); track page.path) {
              <li [style.background]="heat(page.visits, r.pages[0].visits)">
                <span class="wa__path"><b>{{ pageLabel(page.path, page.kind) }}</b><small>{{ page.path }}</small></span>
                <span class="wa__count">{{ page.visits | num }}<small>{{ page.visitors | num }} bezoekers</small></span>
              </li>
            }
          </ol>
        </section>

        <section class="wa__card">
          <h3>Instappen en uitstappen</h3>
          <p class="wa__sub">De eerste en de laatste pagina van een sessie</p>
          <div class="wa__duo">
            <div>
              <h4>Instap</h4>
              <ol class="wa__list wa__list--tight">
                @for (page of r.entryPages.slice(0, 6); track page.path) {
                  <li [style.background]="heat(page.visits, r.entryPages[0].visits)">
                    <span class="wa__path"><b>{{ pageLabel(page.path, page.kind) }}</b></span>
                    <span class="wa__count">{{ page.visits | num }}</span>
                  </li>
                } @empty { <li class="wa__empty">Nog geen sessies</li> }
              </ol>
            </div>
            <div>
              <h4>Uitstap</h4>
              <ol class="wa__list wa__list--tight">
                @for (page of r.exitPages.slice(0, 6); track page.path) {
                  <li [style.background]="heat(page.visits, r.exitPages[0].visits)">
                    <span class="wa__path"><b>{{ pageLabel(page.path, page.kind) }}</b></span>
                    <span class="wa__count">{{ page.visits | num }}</span>
                  </li>
                } @empty { <li class="wa__empty">Nog geen sessies</li> }
              </ol>
            </div>
          </div>
        </section>

        @if (days() > 1) {
          <section class="wa__card">
            <h3>Wanneer komen ze</h3>
            <p class="wa__sub">Bezoeken per weekdag en uur, Belgische tijd</p>
            <div class="wa__hours">
              <div class="wa__hours-head"><span></span>@for (h of hourTicks; track h) { <span [style.grid-column]="h + 2">{{ h }}u</span> }</div>
              @for (row of r.hours; track $index; let d = $index) {
                <div class="wa__hours-row">
                  <span class="wa__hours-day">{{ weekdays[d] }}</span>
                  @for (count of row; track $index; let h = $index) {
                    <i [style.background]="heat(count, maxHour())" [title]="weekdays[d] + ' ' + h + 'u: ' + count + ' bezoeken'"></i>
                  }
                </div>
              }
            </div>
          </section>
        }

        <section class="wa__card">
          <h3>Vanwaar · landen</h3>
          <ol class="wa__list">
            @for (country of r.countries.slice(0, 10); track country.country) {
              <li [style.background]="heat(country.visits, r.countries[0].visits)">
                <span class="wa__path"><b>{{ flag(country.country) }} {{ countryName(country.country) }}</b></span>
                <span class="wa__count">{{ country.visits | num }}<small>{{ country.visitors | num }} bezoekers</small></span>
              </li>
            }
          </ol>
          @if (r.cities.length) {
            <p class="wa__sub wa__sub--after">Steden: @for (city of r.cities.slice(0, 8); track city.city + city.country) { <span class="wa__chip">{{ city.city }} · {{ city.visits }}</span> }</p>
          }
        </section>

        <section class="wa__card">
          <h3>Vanwaar · bronnen</h3>
          <ol class="wa__list">
            @for (source of r.sources; track source.source) {
              <li [style.background]="heat(source.visits, r.sources[0].visits)">
                <span class="wa__path"><b>{{ source.source }}</b><small>{{ sourceKind(source.kind) }}</small></span>
                <span class="wa__count">{{ source.visits | num }}<small>{{ share(source.visits, r.totals.visits) }}</small></span>
              </li>
            }
          </ol>
        </section>

        <section class="wa__card">
          <h3>Toestel &amp; taal</h3>
          <div class="wa__kinds">
            @for (device of r.devices; track device.device) {
              <div class="wa__kind" [style.background]="heat(device.visits, r.devices[0].visits)"><b>{{ deviceLabel(device.device) }}</b><span>{{ share(device.visits, r.totals.visits) }}</span></div>
            }
          </div>
          <div class="wa__kinds">
            @for (locale of r.locales; track locale.locale) {
              <div class="wa__kind" [style.background]="heat(locale.visits, r.locales[0].visits)"><b>{{ languageLabel(locale.locale) }}</b><span>{{ share(locale.visits, r.totals.visits) }}</span></div>
            }
          </div>
          <p class="wa__sub wa__sub--after">Landen in totaal: {{ r.totals.countries | num }}</p>
        </section>
      </div>

      <footer class="wa__foot">
        <p>
          Cookieloos gemeten: geen adressen, bezoekers tellen per dag uniek.
          Niet meegeteld: robots, bezoeken vanuit het ERP en previews,
          @if (r.excludedCities.length) { eigen bezoeken uit {{ r.excludedCities.join(', ') }}, }
          en toestellen die zich hebben uitgesloten. Bijgewerkt om {{ timeLabel(r.generatedAt) }}.
        </p>
        <button class="btn btn--sm" type="button" (click)="excludeThisDevice()">Dit toestel uitsluiten</button>
        <small>Opent de website één keer met een merkteken; daarna telt deze browser nooit meer mee. Doe dit op elk toestel van het team.</small>
      </footer>
    }
  `,
  styles: `
    :host{display:block}
    .wa__toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin:0 0 14px}
    .wa__toolbar-side{display:flex;align-items:center;gap:8px}
    .wa__ranges{display:inline-flex;gap:4px;padding:3px;border:1px solid var(--line);border-radius:999px;background:var(--surface);max-width:100%;overflow-x:auto}
    .wa__ranges button{padding:6px 12px;border:0;border-radius:999px;background:transparent;color:var(--muted);font:inherit;font-size:12.5px;font-weight:650;cursor:pointer;white-space:nowrap}
    .wa__ranges button.on{background:var(--ink);color:#fff}
    .wa__live{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:12px;font-weight:650;white-space:nowrap}
    .wa__live i{width:8px;height:8px;border-radius:50%;background:var(--muted-2)}
    .wa__live--on{border-color:color-mix(in srgb,var(--ok) 40%,var(--line));color:var(--ok)}
    .wa__live--on i{background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 22%,transparent)}
    .wa__refresh{width:32px;height:32px;border:1px solid var(--line);border-radius:50%;background:var(--surface);color:var(--ink-2);font-size:16px;cursor:pointer}
    .wa__refresh:disabled{opacity:.5;cursor:default}
    .wa__state{margin:0;padding:18px;color:var(--muted);font-size:13px}.wa__state--error{color:var(--danger)}
    .wa__kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px;transition:opacity .2s}
    .wa__kpis--stale{opacity:.55}
    .wa__kpi{display:grid;gap:2px;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
    .wa__kpi span{color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
    .wa__kpi b{font-size:22px;font-weight:750;letter-spacing:-.02em}
    .wa__kpi small{color:var(--muted);font-size:11.5px}
    .wa__kpi--accent{border-color:var(--rose-line);background:var(--rose-soft)}.wa__kpi--accent b{color:var(--rose-dark)}
    .wa__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .wa__card{min-width:0;padding:14px 16px 16px;border:1px solid var(--line);border-radius:16px;background:var(--surface)}
    .wa__card--wide{grid-column:1/-1}
    .wa__card h3{margin:0 0 10px;font-size:14.5px;font-weight:750}
    .wa__card h4{margin:0 0 6px;color:var(--muted);font-size:11px;font-weight:750;letter-spacing:.06em;text-transform:uppercase}
    .wa__card-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px}
    .wa__sub{margin:-4px 0 10px;color:var(--muted);font-size:12px}.wa__sub--after{margin:10px 0 0}
    .wa__chart{display:flex;align-items:flex-end;gap:2px;height:150px}
    .wa__bar{position:relative;flex:1 1 0;min-width:2px;height:100%;border-radius:3px 3px 0 0}
    .wa__bar--weekend{background:color-mix(in srgb,var(--surface-2) 70%,transparent)}
    .wa__bar--future{opacity:.35}
    .wa__bar i,.wa__bar em{position:absolute;bottom:0;left:0;right:0;border-radius:3px 3px 0 0}
    .wa__bar i{background:rgb(143 41 66 / 28%)}.wa__bar em{background:rgb(143 41 66 / 85%)}
    .wa__axis{display:flex;justify-content:space-between;margin-top:6px;color:var(--muted);font-size:11px}
    .wa__legend{color:var(--muted);font-size:11px}
    .wa__legend i,.wa__legend em{display:inline-block;width:10px;height:10px;margin:0 3px 0 6px;border-radius:2px;vertical-align:-1px}
    .wa__legend i{background:rgb(143 41 66 / 28%)}.wa__legend em{background:rgb(143 41 66 / 85%)}
    .wa__funnel{display:grid;gap:10px}
    .wa__funnel-step{display:grid;gap:4px}
    .wa__funnel-copy{display:flex;justify-content:space-between;gap:8px;font-size:12.5px}.wa__funnel-copy b{font-weight:650}.wa__funnel-copy span{color:var(--muted);font-variant-numeric:tabular-nums}
    .wa__funnel-track{height:10px;overflow:hidden;border-radius:999px;background:var(--surface-2)}
    .wa__funnel-track i{display:block;height:100%;border-radius:inherit;background:rgb(143 41 66 / 45%);transition:width .3s}
    .wa__funnel-track i.wa__funnel-fill--accent{background:var(--rose)}
    .wa__kinds{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
    .wa__kind{display:grid;gap:1px;padding:8px 10px;border-radius:10px;font-size:12px}
    .wa__kind b{font-weight:650}.wa__kind span{color:var(--muted);font-size:11.5px}
    .wa__list{margin:0;padding:0;list-style:none;display:grid;gap:4px}
    .wa__list li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 10px;border-radius:9px}
    .wa__list--tight li{padding:5px 8px}
    .wa__empty{color:var(--muted);font-size:12px}
    .wa__duo{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .wa__path{display:grid;min-width:0;gap:1px}.wa__path b{font-size:13px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .wa__path small{color:var(--muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .wa__count{display:grid;flex:none;text-align:right;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums}.wa__count small{color:var(--muted);font-size:11px;font-weight:500}
    .wa__hours{display:grid;gap:3px;font-size:11px}
    .wa__hours-head,.wa__hours-row{display:grid;grid-template-columns:28px repeat(24,minmax(0,1fr));gap:2px;align-items:center}
    .wa__hours-head span{color:var(--muted);font-size:10px}
    .wa__hours-day{color:var(--muted);font-weight:650}
    .wa__hours-row i{display:block;aspect-ratio:1;border-radius:3px;background:rgb(143 41 66 / 6%)}
    .wa__chip{display:inline-block;margin:2px 4px 0 0;padding:2px 8px;border:1px solid var(--line);border-radius:999px;font-size:11.5px}
    .wa__foot{display:grid;gap:8px;justify-items:start;margin-top:14px;padding:12px 14px;border:1px dashed var(--line);border-radius:14px;color:var(--muted);font-size:12px}
    .wa__foot p{margin:0;line-height:1.5}.wa__foot small{font-size:11px}
    @media(max-width:860px){.wa__grid{grid-template-columns:1fr}.wa__toolbar{align-items:stretch}.wa__toolbar-side{justify-content:space-between}}
    @media(max-width:520px){.wa__duo{grid-template-columns:1fr}}
  `,
})
export class WebsiteAnalytics {
  private readonly analytics = inject(AnalyticsApi);

  readonly ranges = RANGES;
  readonly weekdays = WEEKDAYS;
  readonly hourTicks = [0, 6, 12, 18];
  readonly days = signal<number>(30);
  readonly report = signal<WebsiteAnalyticsReport | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly maxDay = computed(() => Math.max(1, ...(this.report()?.perDay.map((day) => day.visits) ?? [1])));
  readonly maxHourOfDay = computed(() => Math.max(1, ...(this.report()?.perHour.map((hour) => hour.visits) ?? [1])));
  readonly maxKind = computed(() => Math.max(1, ...(this.report()?.kinds.map((kind) => kind.visits) ?? [1])));
  readonly maxHour = computed(() => Math.max(1, ...(this.report()?.hours.flat() ?? [1])));
  readonly currentHour = signal(new Date().getHours());
  readonly range = computed(() => RANGES.find((range) => range.days === this.days()) ?? RANGES[2]);

  /** The four steps of a session, each as a share of all sessions. */
  readonly funnel = computed(() => {
    const funnel = this.report()?.funnel;
    if (!funnel) return [];
    const steps = [
      { label: 'Sessies gestart', count: funnel.sessions, accent: false },
      { label: 'Productpagina bekeken', count: funnel.productSessions, accent: false },
      { label: 'Offertepagina geopend', count: funnel.quoteSessions, accent: true },
      { label: 'Contactpagina geopend', count: funnel.contactSessions, accent: false },
    ];
    return steps.map((step) => ({
      ...step,
      share: this.share(step.count, funnel.sessions),
      width: funnel.sessions > 0 ? Math.max(step.count > 0 ? 2 : 0, (step.count / funnel.sessions) * 100) : 0,
    }));
  });

  private readonly regionNames = new Intl.DisplayNames(['nl'], { type: 'region' });
  private loadVersion = 0;

  constructor() {
    effect(() => {
      this.days();
      untracked(() => void this.reload());
    });
  }

  async reload(): Promise<void> {
    const version = ++this.loadVersion;
    this.loading.set(true);
    this.error.set(null);
    try {
      const report = await this.analytics.websiteReport(this.days());
      if (version !== this.loadVersion) return;
      this.report.set(report);
      this.currentHour.set(new Date().getHours());
    } catch (failure: unknown) {
      if (version !== this.loadVersion) return;
      this.error.set(messageOf(failure, 'Bezoekcijfers laden mislukt'));
    } finally {
      if (version === this.loadVersion) this.loading.set(false);
    }
  }

  /** The website sets its own team mark when opened this way; no key or address leaves the ERP. */
  excludeThisDevice(): void {
    window.open(WEBSITE_OPT_OUT_URL, '_blank', 'noopener');
  }

  barHeight(value: number, max: number): number {
    return Math.round((value / Math.max(1, max)) * 100);
  }

  /** A rose wash that deepens with the count: the "heat" of the heat map. */
  heat(value: number, max: number): string {
    const ratio = max > 0 ? Math.min(1, value / max) : 0;
    return `rgb(143 41 66 / ${(0.04 + ratio * 0.34).toFixed(2)})`;
  }

  share(part: number, total: number): string {
    return total > 0 ? `${Math.round((part / total) * 100)} %` : '0 %';
  }

  /** "▲ 12 % t.o.v. gisteren", or what there is to say when nothing came before. */
  deltaLine(current: number, previous: number, short = false): string {
    const delta = deltaOf(current, previous);
    const before = this.range().before;
    if (!delta) return short ? '' : `geen vergelijking met ${before}`;
    const arrow = delta.direction === 'up' ? '▲' : delta.direction === 'down' ? '▼' : '=';
    const pct = `${Math.abs(delta.pct)} %`;
    return short ? `${arrow} ${pct}` : `${arrow} ${pct} t.o.v. ${before}`;
  }

  duration(seconds: number): string {
    return durationLabel(seconds);
  }

  kindLabel(kind: WebsitePageKind): string {
    return KIND_LABEL[kind] ?? kind;
  }

  deviceLabel(device: keyof typeof DEVICE_LABEL): string {
    return DEVICE_LABEL[device] ?? device;
  }

  languageLabel(locale: string): string {
    return LANGUAGE_LABEL[locale] ?? locale.toUpperCase();
  }

  sourceKind(kind: string): string {
    return ({ DIRECT: 'adres ingetypt of bladwijzer', SEARCH: 'zoekmachine', SOCIAL: 'sociale media', CAMPAIGN: 'campagnelink', SITE: 'andere website' } as Record<string, string>)[kind] ?? kind;
  }

  pageLabel(path: string, kind: WebsitePageKind): string {
    const parts = path.split('/').filter(Boolean);
    const localePrefix = parts.length && parts[0].length === 2 ? parts[0].toUpperCase() : null;
    const handle = parts[parts.length - 1] ?? '';
    const suffix = localePrefix ? ` (${localePrefix})` : '';
    switch (kind) {
      case 'HOME': return `Startpagina${suffix}`;
      case 'PRODUCT': return `Product: ${handle.replace(/-/g, ' ')}${suffix}`;
      case 'COLLECTION': return `Collectie: ${handle.replace(/-/g, ' ')}${suffix}`;
      case 'LEGAL': return `Voorwaarden: ${handle.replace(/-/g, ' ')}${suffix}`;
      default: return `${KIND_LABEL[kind] ?? path}${suffix}`;
    }
  }

  countryName(code: string | null): string {
    if (!code) return 'Onbekend';
    try { return this.regionNames.of(code) ?? code; } catch { return code; }
  }

  flag(code: string | null): string {
    if (!code) return '🌐';
    return [...code].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join('');
  }

  dateLabel(date: string): string {
    const [year, month, day] = date.split('-');
    return `${day}/${month}/${year}`;
  }

  isWeekend(date: string): boolean {
    const day = new Date(`${date}T12:00:00`).getDay();
    return day === 0 || day === 6;
  }

  timeLabel(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
  }
}
