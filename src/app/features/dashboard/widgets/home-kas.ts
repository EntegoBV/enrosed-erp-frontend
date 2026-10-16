import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CashChart } from '../../../shared/cash-chart';
import type { CashChartSeries } from '../../../shared/cash-chart';
import { Icon } from '../../../shared/icon';
import { chartBuffer, periodText } from '../../analyses/cash-view';
import { DEFAULT_CASH_LOCATION } from '../../analyses/cash-url';
import { eurWhole, weekdayDayMonth } from '../../finance/cash-format';
import { sparkPoints } from '../home-cash';
import { HomeData } from '../home-data';
import { amount } from './home-w';
import { ageText } from '../home-figures';

const SPARK_W = 300;
const SPARK_H = 54;

/**
 * Kas (spec-home §6.1, §7, D3 and phone row 2): the bank today, the lowest
 * point and the first krap period of the same 6-month forecast Analyses
 * shows (with the scenario: "met scenario"), and on the desk the accounts,
 * a compact chart and the Vooruitblik's "Nu te betalen" and "Nog te
 * ontvangen" (which show even when the forecast failed; each reads
 * "— · Opnieuw" when a source behind it failed). The forecast is
 * built at idle; until then the bank shows with "Kasprognose wordt
 * berekend…". On the phone it is the hero: one tap target, the retry button
 * when the bank failed, "Saldo invullen" when there is no reading
 * (amendment G8: nothing interactive nested).
 */
@Component({
  selector: 'app-home-kas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, CashChart],
  template: `
    @let c = data.cash();
    @if (variant() === 'desk') {
      <article class="wk-card home-w home-w--desk home-w--kas" aria-label="Op de bank" [attr.aria-busy]="busy() || null">
        <header class="home-w__head">
          <span class="home-w__icon ios-tile ios-tile--soft tone-teal" aria-hidden="true"><app-icon name="bank" [size]="16" /></span>
          <span class="home-w__names"><h3 class="home-w__title">Op de bank</h3></span>
          <a class="home-w__go home-kas__go" routerLink="/analyses/cash" aria-label="Kasprognose openen">Kasprognose ›</a>
        </header>
        <div class="home-kas__top">
          <div class="home-kas__bank">
            @switch (c.state) {
              @case ('loading') { <span class="home-kas__value">—</span><span class="home-kas__sub">Banksaldo laden…</span> }
              @case ('no-bank') {
                <span class="home-kas__value">—</span>
                <span class="home-kas__sub is-warn">Banksaldo kon niet laden ·
                  <button class="wk-link home-w__raise" type="button" [disabled]="data.refreshing()" (click)="data.load()">Opnieuw</button></span>
              }
              @case ('no-reading') {
                <span class="home-kas__value">Nog geen saldo</span>
                <a class="wk-link home-w__raise home-kas__sub" routerLink="/costs" [queryParams]="{ view: 'bank' }">Saldo invullen ›</a>
              }
              @default {
                <span class="home-kas__value">{{ whole(c.startEur) }}</span>
                @if (age()) { <span class="home-kas__sub">bijgewerkt {{ age() }}</span> }
              }
            }
          </div>
          @if (c.accounts.length && c.state !== 'no-reading') {
            <ul class="home-kas__accounts">
              @for (account of c.accounts; track account.key) {
                <li [class.is-warn]="account.stale" [class.home-w__raise]="account.stale" [title]="account.stale ? 'Saldo ' + account.ageDays + ' d oud' : ''">
                  <span>{{ account.label }}</span><b>{{ whole(account.eur) }}</b></li>
              }
            </ul>
          }
        </div>
        @if (chart(); as chart) {
          <div class="home-kas__chart" aria-hidden="true">
            <app-cash-chart variant="compact" [height]="96" [series]="chart.series" [today]="data.today()" [bufferEur]="chart.bufferEur"
                            [tight]="chart.tight" ariaLabel="Saldo met scenario, 6 maanden" />
          </div>
        }
        @if (c.state !== 'loading' && c.state !== 'no-bank') {
          <div class="home-w__figs home-w__figs--4 home-kas__figs">
            @switch (c.state) {
              @case ('ready') {
                <div class="home-w__fig" [class.is-warn]="c.lowest!.warn" [class.is-danger]="c.lowest!.eur < 0">
                  <span class="home-w__fig-label">Laagste stand</span><strong class="home-w__fig-value">{{ whole(c.lowest!.eur) }}</strong>
                  <span class="home-w__fig-sub">{{ wd(c.lowest!.day) }} · met scenario</span></div>
                <div class="home-w__fig" [class.is-warn]="!!c.tight"><span class="home-w__fig-label">Krap</span>
                  @if (c.tight; as tight) {
                    <strong class="home-w__fig-value">{{ period(tight.from, tight.to) }}</strong>
                    <span class="home-w__fig-sub">onder {{ whole(c.bufferEur) }}</span>
                  } @else {
                    <strong class="home-w__fig-value home-w__fig-value--text">Niet de komende {{ months }} maanden</strong>
                  }
                </div>
              }
              @case ('computing') { <p class="home-kas__note">Kasprognose wordt berekend…</p> }
              @case ('partial') { <p class="home-kas__note is-warn">Prognose onvolledig: {{ c.warnings.join(', ') }}</p> }
            }
            @if (data.outlookFigures(); as o) {
              <div class="home-w__fig"><span class="home-w__fig-label">Nu te betalen</span>
                @if (o.payEur === null) {
                  <strong class="home-w__fig-value home-w__value--none">—</strong>
                  <span class="home-w__fig-sub"><button class="wk-link home-w__raise" type="button" [disabled]="data.refreshing()" (click)="data.load()">Opnieuw</button></span>
                } @else {
                  <strong class="home-w__fig-value">{{ whole(o.payEur) }}</strong>
                  <span class="home-w__fig-sub">kosten, containers, 30 d vast</span>
                }
              </div>
              <div class="home-w__fig"><span class="home-w__fig-label">Nog te ontvangen</span>
                @if (o.receiveEur === null) {
                  <strong class="home-w__fig-value home-w__value--none">—</strong>
                  <span class="home-w__fig-sub"><button class="wk-link home-w__raise" type="button" [disabled]="data.refreshing()" (click)="data.load()">Opnieuw</button></span>
                } @else {
                  <strong class="home-w__fig-value">{{ whole(o.receiveEur) }}</strong>
                  <span class="home-w__fig-sub">klant &amp; partner</span>
                }
              </div>
            }
          </div>
        }
      </article>
    } @else {
      @switch (c.state) {
        @case ('no-bank') {
          <button class="ios-hero home-kas-hero" type="button" [disabled]="data.refreshing()" (click)="data.load()">
            <span class="ios-hero__label">Op de bank</span>
            <span class="ios-hero__value">—</span>
            <span class="ios-hero__sub is-warn">Banksaldo kon niet laden · <b>Opnieuw</b></span>
          </button>
        }
        @case ('no-reading') {
          <a class="ios-hero home-kas-hero" routerLink="/costs" [queryParams]="{ view: 'bank' }">
            <span class="ios-hero__label">Op de bank</span>
            <span class="ios-hero__value">Nog geen saldo</span>
            <span class="ios-hero__sub">Saldo invullen ›</span>
          </a>
        }
        @default {
          <a class="ios-hero home-kas-hero" routerLink="/analyses/cash" [attr.aria-busy]="busy() || null" [attr.aria-label]="heroLabel()">
            <span class="ios-hero__label">Op de bank</span>
            <span class="ios-hero__value">{{ c.state === 'loading' ? '—' : whole(c.startEur) }}</span>
            @switch (c.state) {
              @case ('loading') { <span class="ios-hero__sub">Banksaldo laden…</span> }
              @case ('computing') { <span class="ios-hero__sub">Kasprognose wordt berekend…</span> }
              @case ('partial') { <span class="ios-hero__sub is-warn">Prognose onvolledig: {{ c.warnings.join(', ') }}</span> }
              @case ('ready') {
                @if (spark(); as s) {
                  <svg class="home-kas-hero__spark" [attr.viewBox]="'0 0 ' + sparkW + ' ' + sparkH" preserveAspectRatio="none" aria-hidden="true">
                    @for (band of s.bands; track band.x) { <rect class="home-kas-hero__band" [attr.x]="band.x" y="0" [attr.width]="band.w" [attr.height]="sparkH" /> }
                    @if (s.bufferY !== null) { <line class="home-kas-hero__buffer" x1="0" [attr.x2]="sparkW" [attr.y1]="s.bufferY" [attr.y2]="s.bufferY" /> }
                    <polyline class="home-kas-hero__line" [attr.points]="s.points" />
                  </svg>
                }
                <span class="home-kas-hero__figs">
                  <span class="home-kas-hero__fig">
                    <small>Laagste stand</small>
                    <b [class.is-warn]="c.lowest!.warn">{{ whole(c.lowest!.eur) }}</b>
                    <span>{{ wd(c.lowest!.day) }} · met scenario</span>
                  </span>
                  <span class="home-kas-hero__fig">
                    <small>Krap</small>
                    @if (c.tight; as tight) {
                      <b class="is-warn">{{ period(tight.from, tight.to) }}</b>
                      <span>onder {{ whole(c.bufferEur) }}</span>
                    } @else {
                      <b class="is-text">Niet de komende {{ months }} maanden</b>
                    }
                  </span>
                </span>
              }
            }
            <span class="ios-hero__chev" aria-hidden="true"><app-icon name="chevron-right" [size]="18" /></span>
          </a>
        }
      }
    }
  `,
})
export class HomeKas {
  readonly data = inject(HomeData);
  readonly variant = input<'desk' | 'phone'>('desk');
  readonly whole = amount;
  readonly wd = weekdayDayMonth;
  readonly period = periodText;
  readonly months = DEFAULT_CASH_LOCATION.horizon;
  readonly sparkW = SPARK_W;
  readonly sparkH = SPARK_H;

  readonly busy = computed(() => ['loading', 'computing'].includes(this.data.cash().state));
  /** "bijgewerkt vandaag": the oldest reading of the accounts that have one. */
  readonly age = computed(() => {
    const ages = this.data.cash().accounts.map((account) => account.ageDays).filter((days): days is number => days !== null);
    return ages.length ? ageText(Math.max(...ages)) : null;
  });

  /** The desk chart: the balance with the scenario, the buffer and the krap bands; only from a complete forecast. */
  readonly chart = computed(() => {
    const forecast = this.data.forecast();
    const state = this.data.cash().state;
    if (!forecast || forecast.mode !== 'absolute' || state !== 'ready') return null;
    const series: CashChartSeries[] = [{ id: 'with', label: 'Saldo met scenario', style: 'solid', tone: 'accent',
      points: forecast.days.map((day) => ({ day: day.day, eur: day.withEur })) }];
    return { series, ...chartBuffer(forecast) };
  });

  /** The hero's sparkline with the buffer line and the krap bands. */
  readonly spark = computed(() => {
    const forecast = this.data.forecast();
    const head = this.data.cash();
    if (!forecast || head.state !== 'ready' || !forecast.days.length) return null;
    const line = sparkPoints(forecast.days, SPARK_W, SPARK_H, head.bufferEur);
    const days = forecast.days.map((day) => day.day);
    const step = days.length > 1 ? SPARK_W / (days.length - 1) : 0;
    const bands = forecast.tightWith.flatMap((tight) => {
      const from = days.findIndex((day) => day >= tight.from);
      const to = days.reduce((last, day, index) => (day <= tight.to ? index : last), -1);
      if (from < 0 || to < from) return [];
      return [{ x: Math.round(from * step * 10) / 10, w: Math.max(2, Math.round((to - from) * step * 10) / 10) }];
    });
    return { ...line, bands };
  });

  readonly heroLabel = computed(() => {
    const head = this.data.cash();
    if (head.state !== 'ready') return null;
    const tight = head.tight ? `krap ${periodText(head.tight.from, head.tight.to)} onder ${eurWhole(head.bufferEur)}` : `niet krap de komende ${this.months} maanden`;
    return `Op de bank ${eurWhole(head.startEur)}; laagste stand ${eurWhole(head.lowest!.eur)} op ${weekdayDayMonth(head.lowest!.day)} met scenario; ${tight}. Kasprognose openen`;
  });
}
