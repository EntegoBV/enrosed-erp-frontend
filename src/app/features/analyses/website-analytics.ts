import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { AnalyticsApi, WebsiteAnalyticsReport, WebsitePageKind } from '../../core/api/analytics-api';
import { messageOf } from '../../core/api/errors';
import { NumPipe } from '../../shared/pipes';

const KIND_LABEL: Record<WebsitePageKind, string> = {
  HOME: 'Startpagina', PRODUCTS: 'Productoverzicht', COLLECTION: 'Collecties', PRODUCT: 'Productpagina’s',
  QUOTE: 'Offerte', CONTACT: 'Contact', LEGAL: 'Voorwaarden', OTHER: 'Overig',
};
const DEVICE_LABEL = { MOBILE: 'Telefoon', TABLET: 'Tablet', DESKTOP: 'Computer' } as const;
const WEEKDAYS = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];
const LANGUAGE_LABEL: Record<string, string> = {
  en: 'Engels', nl: 'Nederlands', fr: 'Frans', de: 'Duits', es: 'Spaans', pl: 'Pools', pt: 'Portugees', tr: 'Turks',
};

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
        @for (range of ranges; track range) {
          <button type="button" [class.on]="days() === range" (click)="days.set(range)">{{ range }} dagen</button>
        }
      </div>
      <span class="wa__hint">Cookieloos gemeten: geen adressen, bezoekers tellen per dag uniek. Robots tellen niet mee.</span>
    </div>

    @if (loading()) {
      <p class="wa__state">Bezoekcijfers laden…</p>
    } @else if (error(); as error) {
      <p class="wa__state wa__state--error">{{ error }} <button class="linklike" type="button" (click)="reload()">Opnieuw proberen</button></p>
    } @else if (report(); as r) {
      <div class="wa__kpis">
        <div class="wa__kpi"><span>Bezoeken</span><b>{{ r.totals.visits | num }}</b><small>pagina’s bekeken</small></div>
        <div class="wa__kpi"><span>Unieke bezoekers</span><b>{{ r.totals.visitors | num }}</b><small>per dag geteld</small></div>
        <div class="wa__kpi"><span>Sessies</span><b>{{ r.totals.sessions | num }}</b><small>{{ r.totals.pagesPerSession }} pagina’s per sessie</small></div>
        <div class="wa__kpi"><span>Landen</span><b>{{ r.totals.countries | num }}</b><small>{{ topCountry() || '—' }} voorop</small></div>
        <div class="wa__kpi"><span>Belangrijkste bron</span><b class="wa__kpi--text">{{ r.sources[0]?.source || '—' }}</b><small>{{ r.sources[0] ? share(r.sources[0].visits, r.totals.visits) + ' van de bezoeken' : 'nog geen bezoeken' }}</small></div>
      </div>

      @if (!r.totals.visits) {
        <p class="wa__state">Nog geen bezoeken in deze periode. De website meldt elke bekeken pagina zodra de nieuwe versie live staat.</p>
      }

      <div class="wa__grid">
        <section class="wa__card wa__card--wide">
          <h3>Bezoeken per dag</h3>
          <div class="wa__chart" role="img" [attr.aria-label]="'Bezoeken per dag, ' + r.days + ' dagen'">
            @for (day of r.perDay; track day.date) {
              <div class="wa__bar" [title]="dateLabel(day.date) + ': ' + day.visits + ' bezoeken, ' + day.visitors + ' bezoekers'">
                <i [style.height.%]="barHeight(day.visits)"></i>
                <em [style.height.%]="barHeight(day.visitors)"></em>
              </div>
            }
          </div>
          <div class="wa__axis"><span>{{ dateLabel(r.from) }}</span><span class="wa__legend"><i></i> bezoeken <em></em> unieke bezoekers</span><span>{{ dateLabel(r.to) }}</span></div>
        </section>

        <section class="wa__card">
          <h3>Waar gaan bezoekers naartoe</h3>
          <div class="wa__kinds">
            @for (kind of r.kinds; track kind.kind) {
              <div class="wa__kind" [style.background]="heat(kind.visits, maxKind())"><b>{{ kindLabel(kind.kind) }}</b><span>{{ kind.visits | num }}</span></div>
            }
          </div>
          <ol class="wa__list">
            @for (page of r.pages.slice(0, 15); track page.path) {
              <li [style.background]="heat(page.visits, r.pages[0].visits)">
                <span class="wa__path"><b>{{ pageLabel(page.path, page.kind) }}</b><small>{{ page.path }}</small></span>
                <span class="wa__count">{{ page.visits | num }}<small>{{ page.visitors | num }} bezoekers</small></span>
              </li>
            }
          </ol>
        </section>

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

        <section class="wa__card">
          <h3>Vanwaar · landen</h3>
          <ol class="wa__list">
            @for (country of r.countries.slice(0, 12); track country.country) {
              <li [style.background]="heat(country.visits, r.countries[0].visits)">
                <span class="wa__path"><b>{{ flag(country.country) }} {{ countryName(country.country) }}</b></span>
                <span class="wa__count">{{ country.visits | num }}<small>{{ country.visitors | num }} bezoekers</small></span>
              </li>
            }
          </ol>
          @if (r.cities.length) {
            <p class="wa__sub">Steden: @for (city of r.cities.slice(0, 8); track city.city + city.country) { <span class="wa__chip">{{ city.city }} · {{ city.visits }}</span> }</p>
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
        </section>
      </div>
    }
  `,
  styles: `
    :host{display:block}
    .wa__toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin:0 0 14px}
    .wa__ranges{display:inline-flex;gap:4px;padding:3px;border:1px solid var(--line);border-radius:999px;background:var(--surface)}
    .wa__ranges button{padding:6px 12px;border:0;border-radius:999px;background:transparent;color:var(--muted);font:inherit;font-size:12.5px;font-weight:650;cursor:pointer}
    .wa__ranges button.on{background:var(--ink);color:#fff}
    .wa__hint{color:var(--muted);font-size:12px}
    .wa__state{margin:0;padding:18px;color:var(--muted);font-size:13px}.wa__state--error{color:var(--danger)}
    .wa__kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px}
    .wa__kpi{display:grid;gap:2px;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
    .wa__kpi span{color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
    .wa__kpi b{font-size:22px;font-weight:750;letter-spacing:-.02em}.wa__kpi b.wa__kpi--text{font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .wa__kpi small{color:var(--muted);font-size:11.5px}
    .wa__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .wa__card{min-width:0;padding:14px 16px 16px;border:1px solid var(--line);border-radius:16px;background:var(--surface)}
    .wa__card--wide{grid-column:1/-1}
    .wa__card h3{margin:0 0 10px;font-size:14.5px;font-weight:750}
    .wa__sub{margin:-4px 0 10px;color:var(--muted);font-size:12px}
    .wa__chart{display:flex;align-items:flex-end;gap:2px;height:140px}
    .wa__bar{position:relative;flex:1 1 0;min-width:2px;height:100%}
    .wa__bar i,.wa__bar em{position:absolute;bottom:0;left:0;right:0;border-radius:3px 3px 0 0}
    .wa__bar i{background:rgb(143 41 66 / 28%)}.wa__bar em{background:rgb(143 41 66 / 85%)}
    .wa__axis{display:flex;justify-content:space-between;margin-top:6px;color:var(--muted);font-size:11px}
    .wa__legend i,.wa__legend em{display:inline-block;width:10px;height:10px;margin:0 3px 0 6px;border-radius:2px;vertical-align:-1px}
    .wa__legend i{background:rgb(143 41 66 / 28%)}.wa__legend em{background:rgb(143 41 66 / 85%)}
    .wa__kinds{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
    .wa__kind{display:grid;gap:1px;padding:8px 10px;border-radius:10px;font-size:12px}
    .wa__kind b{font-weight:650}.wa__kind span{color:var(--muted);font-size:11.5px}
    .wa__list{margin:0;padding:0;list-style:none;display:grid;gap:4px}
    .wa__list li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 10px;border-radius:9px}
    .wa__path{display:grid;min-width:0;gap:1px}.wa__path b{font-size:13px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .wa__path small{color:var(--muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .wa__count{display:grid;flex:none;text-align:right;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums}.wa__count small{color:var(--muted);font-size:11px;font-weight:500}
    .wa__hours{display:grid;gap:3px;font-size:11px}
    .wa__hours-head,.wa__hours-row{display:grid;grid-template-columns:28px repeat(24,minmax(0,1fr));gap:2px;align-items:center}
    .wa__hours-head span{color:var(--muted);font-size:10px}
    .wa__hours-day{color:var(--muted);font-weight:650}
    .wa__hours-row i{display:block;aspect-ratio:1;border-radius:3px;background:rgb(143 41 66 / 6%)}
    .wa__chip{display:inline-block;margin:2px 4px 0 0;padding:2px 8px;border:1px solid var(--line);border-radius:999px;font-size:11.5px}
    @media(max-width:860px){.wa__grid{grid-template-columns:1fr}}
  `,
})
export class WebsiteAnalytics {
  private readonly analytics = inject(AnalyticsApi);

  readonly ranges = [7, 30, 90] as const;
  readonly weekdays = WEEKDAYS;
  readonly hourTicks = [0, 6, 12, 18];
  readonly days = signal<number>(30);
  readonly report = signal<WebsiteAnalyticsReport | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly maxDay = computed(() => Math.max(1, ...(this.report()?.perDay.map((day) => day.visits) ?? [1])));
  readonly maxKind = computed(() => Math.max(1, ...(this.report()?.kinds.map((kind) => kind.visits) ?? [1])));
  readonly maxHour = computed(() => Math.max(1, ...(this.report()?.hours.flat() ?? [1])));
  readonly topCountry = computed(() => {
    const first = this.report()?.countries.find((row) => row.country);
    return first ? `${this.flag(first.country)} ${this.countryName(first.country)}` : null;
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
    } catch (failure: unknown) {
      if (version !== this.loadVersion) return;
      this.error.set(messageOf(failure, 'Bezoekcijfers laden mislukt'));
    } finally {
      if (version === this.loadVersion) this.loading.set(false);
    }
  }

  barHeight(value: number): number {
    return Math.round((value / this.maxDay()) * 100);
  }

  /** A rose wash that deepens with the count: the "heat" of the heat map. */
  heat(value: number, max: number): string {
    const ratio = max > 0 ? Math.min(1, value / max) : 0;
    return `rgb(143 41 66 / ${(0.04 + ratio * 0.34).toFixed(2)})`;
  }

  share(part: number, total: number): string {
    return total > 0 ? `${Math.round((part / total) * 100)} %` : '0 %';
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
}
