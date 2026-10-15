import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../../shared/icon';
import { eurWhole, weekdayDayMonth } from '../finance/cash-format';
import { CashState } from './cash-state';
import { underBuffer } from './cash-view';

/**
 * Analyses › Overzicht: the bank today and the lowest point ahead, one line
 * on top that leads to the Kasprognose (spec §4.6). Everything else on
 * Overzicht stays as it was.
 */
@Component({
  selector: 'app-cash-overview-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  template: `
    @if (failed()) {
      <div class="card cf-overview cf-overview--failed" role="status">
        <span class="cf-overview__icon"><app-icon name="bank" [size]="18" /></span>
        <span class="cf-overview__text">Banksaldo kon niet laden</span>
        <button class="cf-overview__retry" type="button" (click)="retry()">Opnieuw</button>
      </div>
    } @else if (forecast(); as f) {
      <a class="card cf-overview" routerLink="/analyses/cash">
        <span class="cf-overview__icon"><app-icon name="bank" [size]="18" /></span>
        <span class="cf-overview__text">Op de bank <b>{{ f.mode === 'relative' ? '—' : whole(f.startEur) }}</b> · laagste stand
          <b [class.is-warn]="low(f, f.lowestWith.eur)" [class.is-neg]="f.lowestWith.eur < 0">{{ whole(f.lowestWith.eur) }}</b> op {{ wd(f.lowestWith.day) }}<span class="cf-overview__dot"> · </span></span>
        <span class="cf-overview__go">Kasprognose ›</span>
      </a>
    } @else {
      <div class="card cf-overview cf-overview--loading" aria-busy="true">
        <span class="cf-overview__icon"><app-icon name="bank" [size]="18" /></span>
        <span class="cf-overview__text">Banksaldo laden…</span>
      </div>
    }
  `,
})
export class CashOverviewCard {
  private readonly state = inject(CashState);
  readonly forecast = this.state.forecast;
  readonly failed = computed(() => this.state.sources.state() === 'ready' && this.state.sources.bankMissing());
  readonly whole = eurWhole;
  readonly wd = weekdayDayMonth;
  readonly low = underBuffer;

  retry(): void {
    void this.state.sources.reload(this.state.today);
  }
}
