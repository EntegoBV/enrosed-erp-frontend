import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { EurPipe, NumPipe } from '../../shared/pipes';
import { formatEur } from './purchase-payment-menus';
import type { NacalcTone, PurchaseNacalcSummary } from './purchase-payment-result-metrics';

/**
 * The nacalculatie in four lines: the headline figure with its state, the
 * difference with the afspraak, the cost per piece and what is still open
 * or to be reviewed. One card for the desk rail's Kosten pane and the
 * Betalingen workbench's side column; 'Volledig ›' opens the whole story.
 * Styles live in styles/purchase-nacalc.scss.
 */
@Component({
  selector: 'app-purchase-nacalc-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EurPipe, NumPipe],
  template: `
    @if (summary(); as s) {
      <section class="wk-card nc-summary" aria-label="Nacalculatie in het kort">
        <header class="wk-card__head"><h3 class="wk-card__title">Nacalculatie</h3><button class="wk-link wk-card__trail" type="button" (click)="open.emit()">Volledig ›</button></header>
        <div class="wk-card__body">
          <dl class="wk-equation">
            <div><dt>{{ s.label }} <span class="wk-pill nc-summary__pill" [class]="pill(s.pill.tone)">{{ s.pill.label }}</span></dt><dd>{{ s.forecastEur | eur }}</dd></div>
            @if (s.kind !== 'concept') {
              <div><dt>Verschil met afspraak</dt><dd [class.wk-amount--muted]="s.varianceEur === 0" [class.wk-amount--warn]="s.varianceEur > 0" [class.wk-amount--in]="s.varianceEur < 0">{{ variance(s) }}</dd></div>
            }
            <div><dt>Per stuk</dt><dd>@if (s.unitEur !== null) { {{ s.unitEur | eur: 4 }} } @else { — }<small class="nc-summary__basis">{{ s.unitQuantity | num }} {{ s.unitBasis === 'USABLE_RECEIVED' ? 'bruikbare' : 'bestelde' }} stuks</small></dd></div>
            @if (s.kind === 'provisional' || s.kind === 'review') {
              @if (s.reviewEur > 0) {
                <div><dt>Na te kijken</dt><dd class="wk-amount--warn">{{ s.reviewEur | eur }}</dd></div>
              } @else if (s.openEur > 0) {
                <div><dt>Nog open</dt><dd>{{ s.openEur | eur }}</dd></div>
              }
            }
          </dl>
          @if (dirty()) { <p class="nc-summary__note">Server-cijfers; wijzigingen tellen na opslaan.</p> }
        </div>
      </section>
    }
  `,
})
export class PurchaseNacalcSummaryCard {
  readonly summary = input<PurchaseNacalcSummary | null>(null);
  readonly dirty = input(false);
  readonly open = output<void>();

  pill(tone: NacalcTone): string {
    return tone === 'ok' ? 'tone-ok' : tone === 'warn' ? 'tone-warn' : tone === 'outline' ? 'wk-pill--outline' : '';
  }

  /** 'geen', '+ € 320,00 · 0,5 %' or '− € 886,00 · 1,3 %' of the afspraak. */
  variance(s: PurchaseNacalcSummary): string {
    if (!s.varianceEur) return 'geen';
    const budget = s.forecastEur - s.varianceEur;
    const sign = s.varianceEur > 0 ? '+ ' : '− ';
    const pct = budget > 0 ? Math.round(Math.abs(s.varianceEur) / budget * 1000) / 10 : null;
    return sign + formatEur(Math.abs(s.varianceEur)) + (pct === null ? '' : ' · ' + pct.toLocaleString('nl-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %');
  }
}
