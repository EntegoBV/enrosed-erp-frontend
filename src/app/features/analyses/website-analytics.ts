import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Segmented } from '../../shared/segmented';
import { Icon } from '../../shared/icon';
import { Sheet } from '../../shared/ui';
import type { SegmentOption } from '../../shared/segmented';
import { AnalyticsApi, WebsiteAnalyticsReport, WebsitePageKind } from '../../core/api/analytics-api';
import { CatalogApi } from '../../core/api/catalog-api';
import { SalesApi } from '../../core/api/sales-api';
import type { Customer, SalesOrderView } from '../../core/api/models';
import { messageOf } from '../../core/api/errors';
import { NumPipe } from '../../shared/pipes';
import { eurWhole } from '../finance/cash-format';
import { hasWebsiteCustomerMessage, isWebOrder, isWebsiteQuoteRequest, statusOf } from '../sales/quote-status';
import {
  bounceLine, catalogByHandle, compareLine, deltaOf, deltaShort, durationLabel, peakLine, productPageRows, shareLabel,
  sourceShares, websiteRequestRows,
} from './website-analytics-math';
import type { CatalogProductMatch, WebsiteRequestRow } from './website-analytics-math';
import { dayMonth, plural, rangeLabel as periodRange, wholeNumber } from './analyses-words';
import { AnDrillHost } from './drill-host';
import { websiteProductsView, websiteRequestsView } from './drill-website';
import { GoogleWebsiteAnalytics } from './google-website-analytics';
import { websiteAnalyticsQuery, websiteAnalyticsRouteState, WebsiteAnalyticsSource } from './website-analytics-route';

const KIND_LABEL: Record<WebsitePageKind, string> = {
  HOME: 'Startpagina', PRODUCTS: 'Productoverzicht', COLLECTION: 'Collecties', PRODUCT: 'Productpagina’s',
  QUOTE: 'Offerte', CONTACT: 'Contact', LEGAL: 'Voorwaarden', OTHER: 'Overig',
};
const DEVICE_LABEL = { MOBILE: 'Telefoon', TABLET: 'Tablet', DESKTOP: 'Computer' } as const;
const WEEKDAYS = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];
const LANGUAGE_LABEL: Record<string, string> = {
  en: 'Engels', nl: 'Nederlands', fr: 'Frans', de: 'Duits', es: 'Spaans', pl: 'Pools', pt: 'Portugees', tr: 'Turks', el: 'Grieks',
};
/** The website's public address; opening it with ?intern=1 silences that browser's beacon. */
const WEBSITE_OPT_OUT_URL = 'https://www.enrosed.com/?intern=1';

interface Range {
  days: number;
  label: string;
}

const RANGES: readonly Range[] = [
  { days: 1, label: 'Vandaag' },
  { days: 7, label: '7 dagen' },
  { days: 30, label: '30 dagen' },
  { days: 90, label: '90 dagen' },
  { days: 365, label: 'Jaar' },
];

/** A request the website brought in: the customer's own message (channel or note marker) or a logged-in web order (design §B.10). */
const fromWebsite = (view: SalesOrderView): boolean => hasWebsiteCustomerMessage(view.order) || isWebOrder(view);
/** A website request nobody answered yet reads as such; every other document by its usual status words. */
const requestStatus = (row: WebsiteRequestRow): string => isWebsiteQuoteRequest(row.view.order) ? 'Nieuwe aanvraag' : statusOf(row.view).label;

/**
 * Where the website's visitors come from, where they go and when: measured
 * without cookies or addresses, so the numbers are honest per day and
 * nobody had to click a banner for them. Round 2 (design/analyses2 §B.10,
 * §C.10): the requests the ERP got from the website sit beside the visits
 * (Aanvragen, from the sales documents), and the Aanvragen and product-page
 * figures open the Analyses drill-down (AnDrillHost). How it is measured
 * lives in Hoe gerekend (the page projects it into the [how] slot).
 */
@Component({
  selector: 'app-website-analytics',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NumPipe, GoogleWebsiteAnalytics, Segmented, Icon, Sheet],
  template: `
    <!-- The tab's tool row (critique N10, design §3.8): source and period; Vernieuwen is the page's. Round 2 (analyses2 §C.10):
         the compare basis is said once here, with the report's time, Hoe gerekend ([how], projected by the page) and the opt-out. -->
    <div class="an-bar">
      @if (desk.active()) {
        <app-segmented label="Bron van de websitecijfers" [options]="sourceOptions" [value]="source()" (changed)="setSource($any($event))" />
        <app-segmented label="Periode" [options]="rangeOptions()" [value]="'' + days()" (changed)="setDays(+$event)" />
        @if (source() === 'INTERNAL') { @if (report(); as r) {
          <span class="an-bar__text">{{ compare() }} · bijgewerkt {{ timeLabel(r.generatedAt) }}</span>
        } }
        <div class="an-bar__end">
          @if (source() === 'INTERNAL') { @if (report(); as r) {
            <span class="wa__live" [class.wa__live--on]="r.totals.activeNow > 0" [title]="'Bezoekers gezien in het laatste half uur'">
              <i aria-hidden="true"></i>{{ r.totals.activeNow | num }} nu op de site</span>
          } }
          <ng-content select="[how]" />
          <button class="wk-btn wk-btn--ghost" type="button" (click)="excludeThisDevice()">Dit toestel uitsluiten</button>
        </div>
      } @else {
        <!-- Phone: tinted capsules that open a sheet each (design §3.8); Hoe gerekend and the opt-out are in the page's ⋯. -->
        <button class="ios-capsule ios-capsule--sm ios-capsule--tinted an-pick-phone" type="button" aria-haspopup="dialog"
                [attr.aria-label]="'Bron: ' + sourceLabel()" (click)="phoneSheet.set('source')">{{ sourceLabel() }}<app-icon name="chevron-down" [size]="14" /></button>
        <button class="ios-capsule ios-capsule--sm ios-capsule--tinted an-pick-phone" type="button" aria-haspopup="dialog"
                [attr.aria-label]="'Periode: ' + rangeLabel()" (click)="phoneSheet.set('days')">
          <app-icon name="calendar" [size]="15" />{{ rangeLabel() }}<app-icon name="chevron-down" [size]="14" /></button>
        @if (source() === 'INTERNAL') { @if (report(); as r) {
          <span class="an-bar__end"><span class="wa__live" [class.wa__live--on]="r.totals.activeNow > 0" [title]="'Bezoekers gezien in het laatste half uur'">
            <i aria-hidden="true"></i>{{ r.totals.activeNow | num }} nu op de site</span></span>
        } }
      }
    </div>
    <!-- Phone: the tiles' ▲/▼ need their basis and the report's time too (the desk says it in the tool row). -->
    @if (!desk.active() && source() === 'INTERNAL') { @if (report(); as r) {
      <p class="ios-caption wa__basis">{{ compare() }} · bijgewerkt {{ timeLabel(r.generatedAt) }}</p>
    } }

    @if (source() !== 'INTERNAL') {
      <app-google-website-analytics [source]="source() === 'GA4' ? 'GA4' : 'SEARCH_CONSOLE'" [days]="days()" [refreshKey]="googleRefresh()" (loadingChanged)="googleBusy.set($event)" />
    } @else {
    @if (loading() && !report()) {
      <p class="wa__state" role="status">Bezoekcijfers laden…</p>
    } @else if (error(); as error) {
      <p class="wa__state wa__state--error" role="alert">{{ error }} <button class="linklike" type="button" (click)="reload(true)">Opnieuw proberen</button></p>
    } @else if (report(); as r) {
      <div class="an-kpis an-kpis--6" [attr.aria-busy]="loading()">
        <div class="an-kpi"><span class="an-kpi__label">Bezoekers</span><span class="an-kpi__value">{{ r.totals.visitors | num }}</span>
          <span class="an-kpi__sub">{{ delta(r.totals.visitors, r.previous.visitors) }}</span><span class="an-kpi__foot">per dag geteld</span></div>
        <div class="an-kpi"><span class="an-kpi__label">Sessies</span><span class="an-kpi__value">{{ r.totals.sessions | num }}</span>
          <span class="an-kpi__sub">{{ delta(r.totals.sessions, r.previous.sessions) }}</span><span class="an-kpi__foot"></span></div>
        <div class="an-kpi"><span class="an-kpi__label">Paginaweergaven</span><span class="an-kpi__value">{{ r.totals.visits | num }}</span>
          <span class="an-kpi__sub">{{ delta(r.totals.visits, r.previous.visits) }}</span><span class="an-kpi__foot"></span></div>
        <div class="an-kpi"><span class="an-kpi__label">Pagina’s per sessie</span><span class="an-kpi__value">{{ r.totals.pagesPerSession | num: 1 }}</span>
          <span class="an-kpi__sub">{{ bounce(r.totals.bounceRatePct, r.totals.sessions) }}</span>
          <span class="an-kpi__foot">{{ r.totals.avgSessionSeconds > 0 ? 'duur gem. ' + duration(r.totals.avgSessionSeconds) : '' }}</span></div>
        <div class="an-kpi"><span class="an-kpi__label">Offertepagina geopend</span><span class="an-kpi__value">{{ r.funnel.quoteSessions | num }}</span>
          <span class="an-kpi__sub">{{ r.funnel.quoteSessions ? share(r.funnel.quoteSessions, r.funnel.sessions) + ' van de sessies' : 'nog niemand op de offertepagina' }}</span>
          @let quoteTrend = r.funnel.quoteSessions ? direction(r.funnel.quoteSessions, r.previous.quoteSessions) : null;
          <span class="an-kpi__foot" [class.is-ok]="quoteTrend === 'up'" [class.is-warn]="quoteTrend === 'down'">{{ r.funnel.quoteSessions && hasDelta(r.funnel.quoteSessions, r.previous.quoteSessions) ? delta(r.funnel.quoteSessions, r.previous.quoteSessions) : '' }}</span></div>
        <!-- Aanvragen (new, §B.10): counted in the ERP, so it never misses a visitor without consent; a count opens its documents. -->
        @if (requests(); as rows) {
          @if (rows.length) {
            <button type="button" class="an-kpi an-kpi--drill" aria-haspopup="dialog" (click)="openRequests()"><span class="an-kpi__label">Aanvragen</span>
              <span class="an-kpi__value">{{ rows.length | num }}</span><span class="an-kpi__sub">{{ eur(requestValue()) }} excl. btw</span><span class="an-kpi__foot"></span></button>
          } @else {
            <div class="an-kpi"><span class="an-kpi__label">Aanvragen</span><span class="an-kpi__value">0</span>
              <span class="an-kpi__sub">nog geen in deze periode</span><span class="an-kpi__foot"></span></div>
          }
        } @else {
          <div class="an-kpi"><span class="an-kpi__label">Aanvragen</span><span class="an-kpi__value">—</span>
            <span class="an-kpi__sub">{{ salesState() === 'failed' ? 'verkoop niet geladen' : 'verkoop laden…' }}</span><span class="an-kpi__foot"></span></div>
        }
      </div>

      @if (!r.totals.visits) {
        <p class="wa__state">{{ days() === 1 ? 'Nog geen bezoeken vandaag.' : 'Nog geen bezoeken in deze periode.' }}</p>
      }

      <div class="wa__grid">
        <section class="wa__card wa__card--wide">
          <div class="wa__card-head">
            <h3>{{ days() === 1 ? 'Per uur' : 'Per dag' }}</h3>
            <span class="wa__legend"><i></i> paginaweergaven · <em></em> bezoekers</span>
          </div>
          @if (days() === 1) {
            <div class="wa__plot"><span class="wa__yaxis" aria-hidden="true"><span>{{ maxHourOfDay() | num }}</span><span>{{ half(maxHourOfDay()) | num }}</span><span>0</span></span>
            <div class="wa__chart" role="img" aria-label="Paginaweergaven en bezoekers per uur, vandaag">
              @for (hour of r.perHour; track hour.hour) {
                <div class="wa__bar" [class.wa__bar--future]="hour.hour > currentHour()" [title]="hour.hour + 'u: ' + hour.visits + ' paginaweergaven, ' + hour.visitors + ' bezoekers'">
                  <i [style.height.%]="barHeight(hour.visits, maxHourOfDay())"></i>
                  <em [style.height.%]="barHeight(hour.visitors, maxHourOfDay())"></em>
                </div>
              }
            </div></div>
            <div class="wa__axis"><span>0u</span><span>6u</span><span>12u</span><span>18u</span><span>23u</span></div>
          } @else {
            <div class="wa__plot"><span class="wa__yaxis" aria-hidden="true"><span>{{ maxDay() | num }}</span><span>{{ half(maxDay()) | num }}</span><span>0</span></span>
            <div class="wa__chart" role="img" [attr.aria-label]="'Paginaweergaven en bezoekers per dag, ' + r.days + ' dagen'">
              @for (day of r.perDay; track day.date) {
                <div class="wa__bar" [class.wa__bar--weekend]="isWeekend(day.date)" [title]="dateLabel(day.date) + ': ' + day.visits + ' paginaweergaven, ' + day.visitors + ' bezoekers'">
                  <i [style.height.%]="barHeight(day.visits, maxDay())"></i>
                  <em [style.height.%]="barHeight(day.visitors, maxDay())"></em>
                </div>
              }
            </div></div>
            <div class="wa__axis"><span>{{ dateLabel(r.from) }}</span><span>{{ peak(r.perDay) }}</span><span>{{ dateLabel(r.to) }}</span></div>
          }
        </section>

        <section class="wa__card">
          <h3>Hoe ver komen ze</h3>
          <p class="wa__sub">Per sessie: wat ze openden</p>
          <div class="wa__funnel">
            @for (step of funnel(); track step.label) {
              @if (step.drill) {
                <button type="button" class="wa__funnel-step wa__funnel-step--drill" aria-haspopup="dialog" [attr.aria-busy]="step.drill === 'products' && productsBusy()" (click)="openStep(step.drill)">
                  <span class="wa__funnel-copy"><b>{{ step.label }}</b><span>{{ step.text }}</span></span>
                  <span class="wa__funnel-track"><i [style.width.%]="step.width" [class.wa__funnel-fill--accent]="step.accent"></i></span>
                </button>
              } @else {
                <div class="wa__funnel-step">
                  <div class="wa__funnel-copy"><b>{{ step.label }}</b><span>{{ step.text }}</span></div>
                  <div class="wa__funnel-track"><i [style.width.%]="step.width" [class.wa__funnel-fill--accent]="step.accent"></i></div>
                </div>
              }
            }
          </div>
          <p class="wa__sub wa__sub--after">Contactpagina: {{ counted(r.funnel.contactSessions, 'sessie', 'sessies') }}</p>
        </section>

        <section class="wa__card">
          <h3>Waar gaan bezoekers naartoe</h3>
          <div class="wa__kinds">
            @for (kind of r.kinds; track kind.kind) {
              @if (kind.kind === 'PRODUCT' && kind.visits > 0) {
                <button type="button" class="wa__kind wa__kind--drill" aria-haspopup="dialog" [attr.aria-busy]="productsBusy()" [style.background]="heat(kind.visits, maxKind())" (click)="openProducts()">
                  <b>{{ kindLabel(kind.kind) }}</b><span>{{ kind.visits | num }}</span></button>
              } @else {
                <div class="wa__kind" [style.background]="heat(kind.visits, maxKind())"><b>{{ kindLabel(kind.kind) }}</b><span>{{ kind.visits | num }}</span></div>
              }
            }
          </div>
          <ol class="wa__list">
            @for (page of r.pages.slice(0, 12); track page.path) {
              <li [style.background]="heat(page.visits, r.pages[0].visits)">
                <span class="wa__path"><b>{{ pageLabel(page.path, page.kind) }}</b></span>
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
            <p class="wa__sub">Paginaweergaven per weekdag en uur, Belgische tijd</p>
            <div class="wa__hours">
              <div class="wa__hours-head"><span></span>@for (h of hourTicks; track h) { <span [style.grid-column]="h + 2">{{ h }}u</span> }</div>
              @for (row of r.hours; track $index; let d = $index) {
                <div class="wa__hours-row">
                  <span class="wa__hours-day">{{ weekdays[d] }}</span>
                  @for (count of row; track $index; let h = $index) {
                    <i [style.background]="heat(count, maxHour())" [title]="weekdays[d] + ' ' + h + 'u: ' + count + ' paginaweergaven'"></i>
                  }
                </div>
              }
            </div>
          </section>
        }

        <section class="wa__card">
          <div class="wa__card-head"><h3>Vanwaar · landen</h3><span class="wa__trail">{{ counted(r.totals.countries, 'land', 'landen') }}</span></div>
          <ol class="wa__list">
            @for (country of r.countries.slice(0, 10); track country.country) {
              <li [style.background]="heat(country.visits, r.countries[0].visits)">
                <span class="wa__path"><b>{{ flag(country.country) }} {{ countryName(country.country) }}</b></span>
                <span class="wa__count">{{ country.visits | num }}<small>{{ country.visitors | num }} bezoekers</small></span>
              </li>
            }
          </ol>
          @if (r.cities.length) {
            <p class="wa__sub wa__sub--after">Steden: @for (city of r.cities.slice(0, 8); track city.city + city.country) { <span class="wa__chip">{{ city.city }} · {{ city.visits | num }}</span> }</p>
          }
        </section>

        <section class="wa__card">
          <div class="wa__card-head"><h3>Vanwaar · bronnen</h3><span class="wa__trail">per sessie</span></div>
          <ol class="wa__list">
            @for (source of sourceRows(); track source.source) {
              <li [style.background]="heat(source.sessions, sourceRows()[0].sessions)">
                <span class="wa__path"><b>{{ source.source }}</b><small>{{ sourceKind(source.kind) }}</small></span>
                <span class="wa__count">{{ source.sessions | num }}<small>{{ source.share }}</small></span>
              </li>
            }
          </ol>
        </section>

        <section class="wa__card">
          <h3>Toestel &amp; taal</h3>
          <h4>Toestel</h4>
          <div class="wa__kinds">
            @for (device of r.devices; track device.device) {
              <div class="wa__kind" [style.background]="heat(device.visits, r.devices[0].visits)"><b>{{ deviceLabel(device.device) }}</b><span>{{ share(device.visits, r.totals.visits) }}</span></div>
            }
          </div>
          <h4>Taal van de site</h4>
          <div class="wa__kinds">
            @for (locale of r.locales; track locale.locale) {
              <div class="wa__kind" [style.background]="heat(locale.visits, r.locales[0].visits)"><b>{{ languageLabel(locale.locale) }}</b><span>{{ share(locale.visits, r.totals.visits) }}</span></div>
            }
          </div>
        </section>
      </div>
    }
    }

    @switch (phoneSheet()) {
      @case ('source') {
        <app-sheet title="Bron" variant="ios" (closed)="phoneSheet.set(null)">
          <div body>
            <div class="ios-group" role="radiogroup" aria-label="Bron van de websitecijfers">
              @for (choice of sources; track choice.id) {
                <button class="ios-cell" type="button" role="radio" [attr.aria-checked]="source() === choice.id" (click)="pickSource(choice.id)">
                  <span class="ios-cell__body"><span class="ios-cell__title">{{ choice.label }}</span></span>
                  @if (source() === choice.id) { <app-icon class="ios-cell__tick" name="tick" [size]="18" /> }
                </button>
              }
            </div>
            <p class="ios-section__foot">Google gebruikt andere meetregels dan de eigen websitemeting; de aantallen worden niet samengevoegd.</p>
          </div>
        </app-sheet>
      }
      @case ('days') {
        <app-sheet title="Periode" variant="ios" (closed)="phoneSheet.set(null)">
          <div body>
            <div class="ios-group" role="radiogroup" aria-label="Periode">
              @for (range of rangeOptions(); track range.id) {
                <button class="ios-cell" type="button" role="radio" [attr.aria-checked]="'' + days() === range.id" (click)="pickDays(+range.id)">
                  <span class="ios-cell__body"><span class="ios-cell__title">{{ range.label }}</span></span>
                  @if ('' + days() === range.id) { <app-icon class="ios-cell__tick" name="tick" [size]="18" /> }
                </button>
              }
            </div>
          </div>
        </app-sheet>
      }
    }
  `,
  styles: `
    :host{display:block}
    .wa__live{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:12px;font-weight:650;white-space:nowrap}
    .wa__live i{width:8px;height:8px;border-radius:50%;background:var(--muted-2)}
    .wa__live--on{border-color:color-mix(in srgb,var(--ok) 40%,var(--line));color:var(--ok)}
    .wa__live--on i{background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 22%,transparent)}
    .wa__state{margin:0;padding:18px;color:var(--muted);font-size:13px}.wa__state--error{color:var(--danger)}
    .wa__basis{margin:-4px 4px 0;color:var(--muted)}
    .wa__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .wa__card{min-width:0;padding:14px 16px 16px;border:1px solid var(--line);border-radius:16px;background:var(--surface)}
    .wa__card--wide{grid-column:1/-1}
    .wa__card h3{margin:0 0 10px;font-size:14px;font-weight:700;letter-spacing:-.01em}
    .wa__card h4{margin:0 0 6px;color:var(--muted);font-size:11px;font-weight:750;letter-spacing:.06em;text-transform:uppercase}
    .wa__card-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px}
    .wa__sub{margin:-4px 0 10px;color:var(--muted);font-size:12px}.wa__sub--after{margin:10px 0 0}
    .wa__chart{display:flex;align-items:flex-end;gap:clamp(.2px,.15vw,2px);height:150px}
    .wa__bar{position:relative;flex:1 1 0;min-width:0;height:100%;border-radius:3px 3px 0 0}
    .wa__bar--weekend{background:color-mix(in srgb,var(--surface-2) 70%,transparent)}
    .wa__bar--future{opacity:.35}
    .wa__bar i,.wa__bar em{position:absolute;bottom:0;left:0;right:0;border-radius:3px 3px 0 0}
    .wa__bar i{background:rgb(143 41 66 / 28%)}.wa__bar em{background:rgb(143 41 66 / 85%)}
    .wa__axis{display:flex;justify-content:space-between;margin-top:6px;color:var(--muted);font-size:11px}
    .wa__legend,.wa__trail{color:var(--muted);font-size:11px}
    .wa__legend i,.wa__legend em{display:inline-block;width:10px;height:10px;margin:0 3px 0 6px;border-radius:2px;vertical-align:-1px}
    .wa__legend i{background:rgb(143 41 66 / 28%)}.wa__legend em{background:rgb(143 41 66 / 85%)}
    .wa__funnel{display:grid;gap:10px}
    .wa__funnel-step{display:grid;gap:4px}
    .wa__funnel-copy{display:flex;justify-content:space-between;gap:8px;font-size:12.5px}.wa__funnel-copy b{font-weight:650}.wa__funnel-copy span{color:var(--muted);font-variant-numeric:tabular-nums}
    .wa__funnel-track{display:block;height:10px;overflow:hidden;border-radius:999px;background:var(--surface-2)}
    .wa__funnel-track i{display:block;height:100%;border-radius:inherit;background:rgb(143 41 66 / 45%);transition:width .3s}
    .wa__funnel-track i.wa__funnel-fill--accent{background:var(--rose)}
    .wa__funnel-step--drill{margin:-4px -6px;padding:4px 6px;border:0;border-radius:10px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
    .wa__funnel-step--drill:hover{background:var(--surface-2)}
    .wa__funnel-step--drill b::after,.wa__kind--drill b::after{content:' ›';color:var(--muted-2)}
    .wa__kinds{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
    .wa__kind{display:grid;gap:1px;padding:8px 10px;border-radius:10px;font-size:12px}
    .wa__kind b{font-weight:650}.wa__kind span{color:var(--muted);font-size:11.5px}
    .wa__kind--drill{border:0;color:inherit;font:inherit;text-align:left;cursor:pointer}.wa__kind--drill:hover{box-shadow:inset 0 0 0 1px var(--rose-line)}
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
    @media(max-width:860px){.wa__grid{grid-template-columns:1fr}}
    @media(max-width:520px){.wa__duo{grid-template-columns:1fr}}
    :host { min-width: 0; }
    .wa__live { min-height: 36px; }
    .wa__chart { min-width: 0; width: 100%; }
    .wa__axis { gap: 8px; font-size: 10px; }
    .wa__axis > span { min-width: 0; }
    .wa__axis > span:nth-child(2) { text-align: center; }
    .wa__axis > span:last-child { text-align: right; }
    .wa__funnel-copy { align-items: baseline; flex-wrap: wrap; row-gap: 3px; }
    .wa__funnel-copy > span { margin-left: auto; white-space: nowrap; }
    .wa__list li { min-height: 44px; border-radius: 12px; }
    .wa__hours { min-width: 0; }
    .wa__state .linklike { min-height: 44px; }
    button:focus-visible { outline: 2px solid var(--rose); outline-offset: 2px; }
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px) {
      .wa__card { padding: 15px; border-radius: 20px; }
      .wa__hours-head, .wa__hours-row { grid-template-columns: 22px repeat(24, minmax(0, 1fr)); gap: 1px; }
    }
    @media (prefers-reduced-motion: reduce) { .wa__funnel-track i { transition: none; } }

  `,
})
export class WebsiteAnalytics {
  private readonly analytics = inject(AnalyticsApi);
  private readonly sales = inject(SalesApi);
  private readonly catalog = inject(CatalogApi);
  private readonly drill = inject(AnDrillHost);
  private readonly route = inject(ActivatedRoute);
  private readonly initialRouteState = websiteAnalyticsRouteState(this.route.snapshot.queryParamMap);

  readonly ranges = RANGES;
  readonly sources = [
    { id: 'INTERNAL', label: 'Eigen meting' }, { id: 'GA4', label: 'Google Analytics' },
    { id: 'SEARCH_CONSOLE', label: 'Google zoeken' },
  ] as const;
  readonly source = signal<WebsiteAnalyticsSource>(this.initialRouteState.source);
  readonly desk = inject(DesktopViewport);
  private readonly router = inject(Router);
  readonly sourceOptions: SegmentOption[] = this.sources.map((choice) => ({ id: choice.id, label: choice.label }));
  /** "Vandaag" reads "Laatste dag" for Google zoeken (its data lag a day). */
  readonly rangeOptions = computed<SegmentOption[]>(() => RANGES.map((range) => ({ id: String(range.days),
    label: this.source() === 'SEARCH_CONSOLE' && range.days === 1 ? 'Laatste dag' : range.label })));
  /** The phone capsules' texts and their sheets. */
  readonly sourceLabel = computed(() => this.sources.find((choice) => choice.id === this.source())?.label ?? '');
  readonly rangeLabel = computed(() => this.rangeOptions().find((option) => option.id === String(this.days()))?.label ?? this.range().label);
  readonly phoneSheet = signal<'source' | 'days' | null>(null);
  readonly googleRefresh = signal(0);
  readonly googleBusy = signal(false);
  readonly weekdays = WEEKDAYS;
  readonly hourTicks = [0, 6, 12, 18];
  readonly days = signal<number>(this.initialRouteState.days);
  readonly report = signal<WebsiteAnalyticsReport | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  /** The sales documents and customers behind Aanvragen; loaded with the report, again on Vernieuwen. */
  readonly salesViews = signal<SalesOrderView[] | null>(null);
  readonly customers = signal<Customer[]>([]);
  readonly salesState = signal<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  /** The catalogue lookup of Bekeken producten, fetched on its first open. */
  readonly productsBusy = signal(false);
  private catalogIndex: ReadonlyMap<string, CatalogProductMatch> | null = null;

  readonly maxDay = computed(() => Math.max(1, ...(this.report()?.perDay.map((day) => day.visits) ?? [1])));
  readonly maxHourOfDay = computed(() => Math.max(1, ...(this.report()?.perHour.map((hour) => hour.visits) ?? [1])));
  readonly maxKind = computed(() => Math.max(1, ...(this.report()?.kinds.map((kind) => kind.visits) ?? [1])));
  readonly maxHour = computed(() => Math.max(1, ...(this.report()?.hours.flat() ?? [1])));
  readonly currentHour = signal(new Date().getHours());
  readonly range = computed(() => RANGES.find((range) => range.days === this.days()) ?? RANGES[2]);
  /** "t.o.v. vorige 30 dagen": the tiles' "▲ 12 %" against what, said once in the tool row. */
  readonly compare = computed(() => compareLine(this.days()));
  readonly share = shareLabel;
  /** "▲ 12 %": the figure's change; the tool row says against what (compare). */
  readonly delta = deltaShort;
  readonly bounce = bounceLine;
  readonly peak = peakLine;
  readonly duration = durationLabel;
  readonly eur = eurWhole;
  readonly counted = plural;

  /** The website's requests in the report's window (§B.10); null until the sales documents loaded. */
  readonly requests = computed(() => {
    const report = this.report();
    const views = this.salesViews();
    if (!report || !views) return null;
    return websiteRequestRows(views, this.customers(), { from: report.from, to: report.to, isWebsite: fromWebsite });
  });
  readonly requestValue = computed(() => (this.requests() ?? []).reduce((sum, row) => sum + row.valueExclEur, 0));
  /** Vanwaar · bronnen: sessions since the server books a source on a session's first page (D-W1). */
  readonly sourceRows = computed(() => { const report = this.report(); return report ? sourceShares(report.sources, report.totals.sessions) : []; });

  /**
   * What a session opened, each as a share of all sessions (unordered: a
   * session can open the quote page without a product page), ending with the
   * requests the ERP received (D-W8). The contact page is a side exit, a line
   * under the steps.
   */
  readonly funnel = computed(() => {
    const funnel = this.report()?.funnel;
    if (!funnel) return [];
    const requests = this.requests()?.length ?? null;
    const steps: { label: string; count: number | null; accent: boolean; drill: 'products' | 'requests' | null }[] = [
      { label: 'Sessies gestart', count: funnel.sessions, accent: false, drill: null },
      { label: 'Productpagina bekeken', count: funnel.productSessions, accent: false, drill: 'products' },
      { label: 'Offertepagina geopend', count: funnel.quoteSessions, accent: false, drill: null },
      { label: 'Aanvraag verstuurd', count: requests, accent: true, drill: 'requests' },
    ];
    return steps.map((step) => ({
      ...step,
      drill: step.count ? step.drill : null,
      text: step.count === null ? '—' : `${wholeNumber(step.count)} · ${this.share(step.count, funnel.sessions)}`,
      width: funnel.sessions > 0 && step.count ? Math.max(2, Math.min(100, (step.count / funnel.sessions) * 100)) : 0,
    }));
  });

  private readonly regionNames = new Intl.DisplayNames(['nl'], { type: 'region' });
  private loadVersion = 0;
  private salesVersion = 0;
  private alive = true;

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.alive = false; });
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe(params => this.applyRouteQuery(params));
    effect(() => {
      this.days();
      if (this.source() !== 'INTERNAL') return;
      untracked(() => void this.reload());
    });
  }

  applyRouteQuery(params: Pick<ParamMap, 'getAll'>): void {
    const selection = websiteAnalyticsRouteState(params);
    this.source.set(selection.source);
    this.days.set(selection.days);
  }

  /** Every choice goes into the address (?source=&days=, replaceUrl) and reads back through applyRouteQuery. */
  setSource(source: WebsiteAnalyticsSource): void {
    this.source.set(source);
    this.writeQuery();
  }

  setDays(days: number): void {
    if (!RANGES.some((range) => range.days === days)) return;
    this.days.set(days);
    this.writeQuery();
  }

  /** A choice in a phone sheet: apply and close. */
  pickSource(source: WebsiteAnalyticsSource): void {
    this.setSource(source);
    this.phoneSheet.set(null);
  }

  pickDays(days: number): void {
    this.setDays(days);
    this.phoneSheet.set(null);
  }

  half(value: number): number { return Math.round(value / 2); }

  private writeQuery(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: websiteAnalyticsQuery(this.source(), this.days()), queryParamsHandling: 'merge', replaceUrl: true });
  }

  /** The page's Vernieuwen: past the report's one-minute memory (D-W13), the sales documents too. */
  reloadSelected(): void {
    if (this.source() === 'INTERNAL') { if (!this.loading()) void this.reload(true); }
    else if (!this.googleBusy()) this.googleRefresh.update(value => value + 1);
  }

  async reload(force = false): Promise<void> {
    const version = ++this.loadVersion;
    this.loading.set(true);
    this.error.set(null);
    if (force || this.salesState() === 'idle' || this.salesState() === 'failed') void this.loadSales();
    try {
      const report = await this.analytics.websiteReport(this.days(), force);
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

  /** Orders and customers for Aanvragen; a failure reads "—" on that figure only, the visits stay. */
  private async loadSales(): Promise<void> {
    const version = ++this.salesVersion;
    this.salesState.set('loading');
    try {
      const [views, customers] = await Promise.all([this.sales.orders(), this.sales.customers()]);
      if (version !== this.salesVersion) return;
      this.salesViews.set(views);
      this.customers.set(customers);
      this.salesState.set('ready');
    } catch {
      if (version === this.salesVersion) this.salesState.set('failed');
    }
  }

  /** A drill funnel step: the product pages or the requests. */
  openStep(drill: 'products' | 'requests'): void {
    /* The step counts sessions, the dialog views: it names both (rule A.4). */
    if (drill === 'products') void this.openProducts(this.report()?.funnel.productSessions ?? null);
    else this.openRequests();
  }

  /** Aanvragen (tile and last funnel step): the documents behind the count (website.requests). */
  openRequests(): void {
    const report = this.report();
    const rows = this.requests();
    if (!report || !rows?.length) return;
    this.drill.open([websiteRequestsView(rows, {
      scope: `${this.range().label} · ${periodRange(report.from, report.to)} · op documentdatum · excl. btw`,
      count: rows.length, status: requestStatus, countryName: (code) => this.countryName(code),
    })]);
  }

  /** Productpagina's (kind tile and funnel step): the views per product over every language (website.products). */
  async openProducts(productSessions: number | null = null): Promise<void> {
    const report = this.report();
    if (!report || this.productsBusy()) return;
    this.productsBusy.set(true);
    try {
      const catalog = await this.catalogMatches();
      // The period changed or the tab went while the catalogue loaded: nothing opens.
      if (!this.alive || this.report() !== report) return;
      this.drill.open([websiteProductsView(productPageRows(report.pages), {
        scope: `${this.range().label} · ${periodRange(report.from, report.to)} · eigen meting`,
        productViews: report.kinds.find((kind) => kind.kind === 'PRODUCT')?.visits ?? 0,
        catalog, productSessions,
      })]);
    } finally {
      this.productsBusy.set(false);
    }
  }

  /** Handle → ERP product, once; without the catalogue the rows keep their handle and link to the website (next open tries again). */
  private async catalogMatches(): Promise<ReadonlyMap<string, CatalogProductMatch>> {
    if (this.catalogIndex) return this.catalogIndex;
    try {
      const [products, families] = await Promise.all([this.catalog.products(), this.catalog.productFamilies()]);
      this.catalogIndex = catalogByHandle(products, families);
      return this.catalogIndex;
    } catch {
      return new Map();
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

  /** Up is good, down is a warning, the same rule as the Overzicht's Bezoekers row (deltaMeta); flat or unknown stays muted. */
  direction(current: number, previous: number): 'up' | 'down' | null {
    const delta = deltaOf(current, previous);
    return delta && delta.direction !== 'flat' ? delta.direction : null;
  }

  hasDelta(current: number, previous: number): boolean {
    return deltaOf(current, previous) !== null;
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

  /** "17 sep", with the year when it is not this year: the area's date words (was "17/09/2026"). */
  dateLabel(date: string): string {
    return dayMonth(date, String(new Date().getFullYear())) || date;
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
