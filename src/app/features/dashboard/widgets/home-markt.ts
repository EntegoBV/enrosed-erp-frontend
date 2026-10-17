import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Fx } from '../../../core/api/fx';
import { SourcingApi } from '../../../core/api/sourcing-api';
import { Icon } from '../../../shared/icon';
import { dayMonthShort, latestOwnQuote } from '../home-figures';
import type { OwnQuote } from '../home-figures';
import { HomeWidget, count } from './home-w';

const rate = (value: number | null | undefined, decimals: number): string =>
  Number.isFinite(value as number) ? (value as number).toLocaleString('nl-BE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : '—';

/** "▲ 0,4%" / "▼ 0,3%"; '' without a change. */
function change(pct: number | null | undefined): string {
  if (!Number.isFinite(pct as number)) return '';
  const value = Math.round((pct as number) * 10) / 10;
  if (value === 0) return '= 0%';
  return `${value > 0 ? '▲' : '▼'} ${Math.abs(value).toLocaleString('nl-BE', { maximumFractionDigits: 1 })}%`;
}

/**
 * Markt (spec-home §6.9, amendment I): the euro in dollars and yuan (ECB,
 * through Fx; the change over a month) and our forwarder's latest 40ft
 * quote - never an index in points. Rendered inside @defer on the pages, so
 * the two calls only run when it scrolls into view; either one fails
 * quietly to "—". On the desk one full-width strip (the head, the three
 * figures inline, "t.o.v. een maand geleden ›"); on the phone the Meer
 * cijfers row.
 */
@Component({
  selector: 'app-home-markt',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, HomeWidget],
  template: `
    @if (variant() === 'desk') {
      <app-home-w variant="desk" kind="markt" [strip]="true" title="Valuta en containermarkt" icon="exchange" tone="teal" link="/analyses/market">
        <dl class="home-w__rates">
          <div><dt>EUR → USD</dt><dd><b>{{ usd() }}</b>@if (usdChange()) { <small [class.is-up]="usdChange().startsWith('▲')">{{ usdChange() }}</small> }</dd></div>
          <div><dt>EUR → CNY</dt><dd><b>{{ cny() }}</b>@if (cnyChange()) { <small [class.is-up]="cnyChange().startsWith('▲')">{{ cnyChange() }}</small> }</dd></div>
          <div><dt>40ft {{ quote()?.short ?? 'container' }}</dt>
            <dd><b>{{ quote() ? '$\u00a0' + count(quote()!.usd) : '—' }}</b>@if (quote(); as q) { <small>offerte {{ day(q.quotedOn) }}</small> }</dd></div>
        </dl>
        <span class="home-w__line">t.o.v. een maand geleden <span aria-hidden="true">›</span></span>
      </app-home-w>
    } @else {
      <a class="ios-cell ios-cell--tall home-markt" routerLink="/analyses/market" [attr.aria-label]="ariaLabel()">
        <span class="ios-tile ios-tile--soft tone-teal ios-cell__lead" aria-hidden="true"><app-icon name="exchange" [size]="17" /></span>
        <span class="ios-cell__body">
          <span class="ios-cell__title">Valuta en containermarkt</span>
          <span class="home-markt__lines"><span>€ 1 = <b>{{ phoneTrail() }}</b></span><span>{{ phoneSub() }}</span></span>
        </span>
        <span class="ios-cell__chev" aria-hidden="true">›</span>
      </a>
    }
  `,
})
export class HomeMarkt {
  private readonly fx = inject(Fx);
  private readonly sourcing = inject(SourcingApi);
  readonly variant = input<'desk' | 'phone'>('desk');
  readonly count = count;
  readonly day = dayMonthShort;

  readonly quote = signal<OwnQuote | null>(null);
  readonly usd = computed(() => rate(this.fx.series()?.latestUsd, 3));
  readonly cny = computed(() => rate(this.fx.series()?.latestCny, 2));
  readonly usdChange = computed(() => change(this.fx.series()?.usdChangePct));
  readonly cnyChange = computed(() => change(this.fx.series()?.cnyChangePct));
  /** "$ 1,084 · ¥ 7,72": on the phone a line under the title (beside it the title would be cut at 390 px). */
  readonly phoneTrail = computed(() => (this.fx.series() ? `$\u00a0${this.usd()} · ¥\u00a0${this.cny()}` : '—'));
  readonly phoneSub = computed(() => {
    const quote = this.quote();
    return quote ? `40ft ${quote.origin} $\u00a0${count(quote.usd)} · offerte ${dayMonthShort(quote.quotedOn)}` : '40ft —';
  });
  readonly ariaLabel = computed(() => {
    const quote = this.quote();
    return `Valuta en containermarkt: euro ${this.usd()} dollar, ${this.cny()} yuan; ${quote ? `40ft ${quote.short} ${count(quote.usd)} dollar, offerte ${dayMonthShort(quote.quotedOn)}` : 'geen vrachtofferte'}`;
  });

  constructor() {
    if (!this.fx.series() && !this.fx.failed()) void this.fx.load();
    this.sourcing.freightRates().then((rates) => this.quote.set(latestOwnQuote(rates))).catch(() => this.quote.set(null));
  }
}
