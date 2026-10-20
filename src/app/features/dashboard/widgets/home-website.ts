import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { HomeData } from '../home-data';
import { bars, countryWithFlag, shortDate } from '../home-figures';
import { HomeWidget, count, counted } from './home-w';

/**
 * Website (spec-home §6.8): the week's visitors (counted per day, so never
 * "unieke": analyses2 D-W4) and visits, seven
 * bars with today darkest (each with its day's visitors and visits on
 * hover), and Vandaag · Voorop · Bron (country and source names wrap, never
 * cut), plus "Aanvullen n producten" as the block's one inline link
 * (families not ready for the website). All six figures on the phone too.
 */
@Component({
  selector: 'app-home-website',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, HomeWidget],
  template: `
    <app-home-w [variant]="variant()" kind="website" title="Website · 7 dagen" icon="globe" tone="blue" link="/analyses/website" [wide]="true"
                [state]="state()">
      @if (state() === 'ready' && data.website(); as web) {
        <div class="home-w__split">
          <div class="home-w__lead">
            <span class="home-w__value">{{ count(web.totals.visitors) }}</span>
            <span class="home-w__line">{{ web.totals.visitors === 1 ? 'bezoeker' : 'bezoekers' }} · {{ counted(web.totals.visits, 'paginaweergave', 'paginaweergaven') }}</span>
          </div>
          <div class="home-w__bars home-w__bars--days home-w__raise" role="img" [attr.aria-label]="barsLabel()" (click)="openCard()">
            @for (bar of days(); track bar.key) {
              <span class="home-w__bar-col" [title]="bar.title">
                <i class="home-w__bar" [class.is-current]="bar.current" [style.height.%]="bar.pct"></i>
                <small>{{ bar.label }}</small>
              </span>
            }
          </div>
        </div>
        <div class="home-w__figs home-w__figs--4">
          @if (web.totals.visits) {
            <div class="home-w__fig"><span class="home-w__fig-label">Vandaag</span><strong class="home-w__fig-value">{{ count(todayVisitors()) }}</strong>
              <span class="home-w__fig-sub">bezoekers</span></div>
            <div class="home-w__fig"><span class="home-w__fig-label">Voorop</span>
              <strong class="home-w__fig-value home-w__fig-value--text">{{ topCountry() || '—' }}</strong></div>
            <div class="home-w__fig"><span class="home-w__fig-label">Bron</span>
              <strong class="home-w__fig-value home-w__fig-value--text">{{ web.sources[0]?.source || '—' }}</strong></div>
          } @else {
            <p class="home-w__empty home-w__figs-wide">Nog geen bezoeken gemeten deze week.</p>
          }
          <a class="home-w__fig home-w__fig--link home-w__raise" routerLink="/website/products" [class.is-warn]="data.catalogAttention() > 0">
            <span class="home-w__fig-label">Aanvullen ›</span>
            <strong class="home-w__fig-value">{{ counted(data.catalogAttention(), 'product', 'producten') }}</strong>
            <span class="home-w__fig-sub">niet publicatieklaar</span></a>
        </div>
      }
    </app-home-w>
  `,
})
export class HomeWebsite {
  readonly data = inject(HomeData);
  private readonly router = inject(Router);
  readonly variant = input<'desk' | 'phone'>('desk');
  readonly state = computed(() => this.data.combined('websitebezoek'));
  readonly count = count;
  readonly counted = counted;

  readonly days = computed(() => {
    const perDay = this.data.website()?.perDay ?? [];
    const last = perDay.at(-1)?.date;
    return bars(perDay.map((day) => ({ key: day.date, label: shortDate(day.date).slice(0, 2), value: day.visitors })), last)
      .map((bar, index) => ({ ...bar, title: `${shortDate(perDay[index].date)}: ${perDay[index].visitors} bezoekers, ${perDay[index].visits} paginaweergaven` }));
  });
  readonly barsLabel = computed(() => `Bezoekers per dag: ${this.days().map((bar) => `${bar.label} ${bar.value}`).join(', ')}`);
  readonly todayVisitors = computed(() => this.data.website()?.perDay.at(-1)?.visitors ?? 0);
  readonly topCountry = computed(() => countryWithFlag(this.data.website()?.countries.find((row) => row.country)?.country));

  /** The bars sit above the card's stretched link (their per-day hover); a click on them still opens the card. */
  openCard(): void {
    void this.router.navigateByUrl('/analyses/website');
  }
}
