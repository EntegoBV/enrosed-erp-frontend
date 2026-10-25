import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Icon } from '../../shared/icon';
import { EurPipe } from '../../shared/pipes';
import type { PurchaseNacalc } from './purchase-nacalc-metrics';
import { nacalcGlance, type PhonePaymentState } from './purchase-phone-model';

/**
 * The Nacalculatie's headline on a phone purchase order's Overzicht: the
 * expected final cost, the Afspraak and the difference, with the way to the
 * full Nacalculatie on Kosten (which stays complete there). Inputs and
 * outputs only. Styles: styles/purchase-phone.scss (.mpo-glance).
 */
@Component({
  selector: 'app-purchase-nacalc-glance',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, EurPipe],
  template: `
    @if (glance(); as g) {
      <section class="ios-section mpo-glance" aria-label="Nacalculatie">
        <div class="ios-section__head"><h2>Nacalculatie</h2><span class="wk-pill" [class]="g.pillTone">{{ g.pill }}</span></div>
        <div class="ios-group">
          <div class="ios-cell ios-cell--tall"><span class="ios-cell__body">
            <span class="ios-cell__sub">{{ g.label }}</span>
            <span class="mpo-glance__value">{{ g.eindkostEur | eur }}</span>
            @if (g.concept) { <span class="ios-cell__sub">{{ g.sub }}</span> }
          </span></div>
          @if (!g.concept) {
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Afspraak</span></span>
              <span class="ios-cell__trail"><span class="ios-cell__value">{{ g.afspraakEur | eur }}</span></span></div>
            <!-- 'Verschil · 5,0 %' · '€ 3.271,34 minder' in one line, as on the Nacalculatie; a review adds its amount under it. -->
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title mpo-wrap">{{ g.verschilTitle }}</span>
              @if (g.reviewText) { <span class="ios-cell__sub mpo-glance__words wk-amount--warn">{{ g.reviewText }}</span> }</span>
              <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong"
                [class.wk-amount--in]="g.verschilTone === 'in'" [class.wk-amount--warn]="g.verschilTone === 'warn'">{{ g.verschilText }}</span></span></div>
          }
          <button class="ios-cell" type="button" (click)="open.emit()">
            <span class="ios-cell__body"><span class="ios-cell__title">Volledige nacalculatie</span></span>
            <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
          </button>
        </div>
        <p class="ios-section__foot">{{ g.foot }}</p>
      </section>
    } @else if (state() === 'loading') {
      <section class="ios-section mpo-glance" aria-label="Nacalculatie">
        <div class="ios-section__head"><h2>Nacalculatie</h2></div>
        <div class="ios-group"><div class="ios-cell" role="status"><span class="ios-cell__body"><span class="ios-cell__sub mpo-glance__loading">Nacalculatie laden…</span></span></div></div>
      </section>
    } @else {
      <section class="ios-section mpo-glance" aria-label="Nacalculatie">
        <div class="ios-section__head"><h2>Nacalculatie</h2></div>
        <p class="ios-caption mpo-glance__empty">De nacalculatie is nog niet beschikbaar.</p>
      </section>
    }
  `,
  styles: `:host{display:block}`,
})
export class PurchaseNacalcGlance {
  readonly nacalc = input<PurchaseNacalc | null>(null);
  readonly state = input<PhonePaymentState>('loading');
  readonly open = output<void>();

  readonly glance = computed(() => {
    const nacalc = this.nacalc();
    return nacalc ? nacalcGlance(nacalc.headline) : null;
  });
}
