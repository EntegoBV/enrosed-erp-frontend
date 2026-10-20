import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { TicaApi } from '../../../core/api/tica-api';
import type { TicaStatus } from '../../../core/api/tica-api';
import { eur } from '../../finance/cash-format';
import { ticaToday } from '../../tica/tica-format';
import { HomeData } from '../home-data';
import type { SourceState } from '../home-data';
import { bars, shortDate } from '../home-figures';
import { ticaFreshness, ticaHomeSummary } from '../home-tica-summary';
import { HomeWidget, amount, counted } from './home-w';

/**
 * TICA (Emre, 2026-10-20): today's portal sales excl. btw with its sales
 * and pieces, seven day bars (today darkest, each day's amount on hover),
 * and 7 dagen · Gem. per stuk · this month · the latest Afrekening. The
 * days and settlements are CashData's (loaded for the Kasprognose), so the
 * card adds one call: the import status, for "bijgewerkt 14:05" or a
 * warning. Hidden while TICA has no sales at all; on the desk the first,
 * full-width card of Meer cijfers, on the phone the wide card under Verkoop.
 */
@Component({
  selector: 'app-home-tica',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HomeWidget],
  template: `
    @if (visible()) {
      <app-home-w [variant]="variant()" kind="tica" title="TICA vandaag" icon="receipt" tone="amber" link="/tica" [wide]="true"
                  [sub]="sub()" [state]="state()">
        @if (state() === 'ready') {
          @let s = summary();
          <div class="home-tica__body">
            <div class="home-w__split">
              <div class="home-w__lead">
                <span class="home-w__value">{{ whole(s.today.revenueExcl) }}</span>
                <span class="home-w__line">{{ s.today.transactions
                  ? counted(s.today.transactions, 'verkoop', 'verkopen') + ' · ' + counted(s.today.quantity, 'stuk', 'stuks') : 'Nog geen verkoop' }}</span>
                @if (fresh().warning; as warning) { <span class="home-w__note is-warn">{{ warning }}</span> }
              </div>
              <div class="home-w__bars home-w__raise" role="img" [attr.aria-label]="barsLabel()" (click)="openCard()">
                @for (bar of days(); track bar.key) {
                  <span class="home-w__bar-col" [title]="bar.title">
                    <i class="home-w__bar" [class.is-current]="bar.current" [style.height.%]="bar.pct"></i>
                    <small>{{ bar.label }}</small>
                  </span>
                }
              </div>
            </div>
            <div class="home-w__figs home-w__figs--4">
              <div class="home-w__fig"><span class="home-w__fig-label">7 dagen</span><strong class="home-w__fig-value">{{ whole(s.weekTotal.revenueExcl) }}</strong>
                <span class="home-w__fig-sub">{{ counted(s.weekTotal.transactions, 'verkoop', 'verkopen') }}</span></div>
              <div class="home-w__fig"><span class="home-w__fig-label">{{ variant() === 'desk' ? 'Gem. per stuk' : 'Per stuk' }}</span>
                <strong class="home-w__fig-value">{{ s.perPiece ? cents(s.perPiece.eur) : '—' }}</strong>
                <span class="home-w__fig-sub">{{ s.perPiece?.basis ?? 'geen stuks' }}</span></div>
              <div class="home-w__fig"><span class="home-w__fig-label">{{ monthLabel() }}</span><strong class="home-w__fig-value">{{ whole(s.month.revenueExcl) }}</strong>
                <span class="home-w__fig-sub">{{ counted(s.month.quantity, 'stuk', 'stuks') }}</span></div>
              <div class="home-w__fig" [class.is-warn]="s.settlement?.status === 'concept'"><span class="home-w__fig-label">Afrekening</span>
                <strong class="home-w__fig-value">{{ s.settlement ? whole(s.settlement.netReceivable) : '—' }}</strong>
                <span class="home-w__fig-sub">{{ s.settlement ? s.settlement.period + ' · ' + s.settlement.status : 'nog geen' }}</span></div>
            </div>
          </div>
        }
      </app-home-w>
    }
  `,
})
export class HomeTica {
  readonly data = inject(HomeData);
  private readonly api = inject(TicaApi);
  private readonly router = inject(Router);
  readonly variant = input<'desk' | 'phone'>('desk');
  readonly whole = amount;
  readonly counted = counted;

  private readonly status = signal<TicaStatus | null>(null);
  /** The portal's day (Brussels), moved by the home's minute clock. */
  private readonly today = computed(() => ticaToday(new Date(this.data.now())));

  readonly state = computed<SourceState>(() => {
    const cash = this.data.cashData;
    if (cash.state() !== 'ready') return 'loading';
    return cash.ticaSalesFailed() ? 'failed' : 'ready';
  });
  /** Shown while loading or failed (so a failure reads "— · Opnieuw"), and once TICA has sold anything. */
  readonly visible = computed(() => this.state() !== 'ready' || this.data.cashData.ticaSales().length > 0);
  readonly summary = computed(() => ticaHomeSummary(this.data.cashData.ticaSales(), this.data.cashData.ticaSettlements(), this.today()));
  readonly fresh = computed(() => ticaFreshness(this.status(), new Date(this.data.now())));
  readonly sub = computed(() => ['excl. btw', this.fresh().sub].filter(Boolean).join(' · '));
  /** "Oktober". */
  readonly monthLabel = computed(() => {
    const name = this.data.windows().monthName;
    return name.charAt(0).toUpperCase() + name.slice(1);
  });

  readonly days = computed(() => {
    const week = this.summary().week;
    return bars(week.map((day) => ({ key: day.date, label: shortDate(day.date).slice(0, 2), value: day.revenueExcl })), week.at(-1)?.date)
      .map((bar, index) => ({ ...bar, title: `${shortDate(week[index].date)}: ${amount(week[index].revenueExcl)} · ${counted(week[index].transactions, 'verkoop', 'verkopen')}` }));
  });
  readonly barsLabel = computed(() => `Omzet per dag: ${this.days().map((bar) => `${bar.label} ${amount(bar.value)}`).join(', ')}`);

  constructor() {
    /* The import status with every CashData round (the home's enter, focus and Vernieuwen); a failure shows no time. */
    effect(() => {
      this.data.cashData.loadedAt();
      untracked(() => this.api.status().then((status) => this.status.set(status), () => this.status.set(null)));
    });
  }

  cents(value: number): string {
    return eur(value).replace(/ /g, ' ');
  }

  /** The bars sit above the card's stretched link (their per-day hover); a click on them still opens the card. */
  openCard(): void {
    void this.router.navigateByUrl('/tica');
  }
}
