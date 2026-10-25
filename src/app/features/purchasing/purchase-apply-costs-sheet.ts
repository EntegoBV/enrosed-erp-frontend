import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import { ProductCostHistorySheet } from '../products/product-cost-history-sheet';
import { applyCostsButton, newerNotice, type ApplyCostRow, type ApplyCostsPlan } from './purchase-apply-costs';

/**
 * Kostprijzen toepassen: before a container's costs go onto the catalogue,
 * every product shows the cost it carries now and where that came from, the
 * cost it gets and the difference. Each row opens the product's history on
 * top. The editor does the applying; the sheet only shows and asks.
 */
@Component({
  selector: 'app-purchase-apply-costs-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, EurPipe, ProductCostHistorySheet],
  template: `
    @let p = plan();
    <app-sheet [title]="p.again ? 'Opnieuw kostprijzen toepassen' : 'Kostprijzen toepassen'" variant="ios"
               [wide]="desktop.active()" (closed)="cancel.emit()">
      <div body class="ac-sheet" [attr.inert]="busy() ? '' : null">
        <!-- Existing sales lines keep the cost frozen on them (SalesOrderService.withCostSnapshots); only new lines take this one. -->
        <p class="ac-sheet__intro">De kostprijs komt op de productkaart: nieuwe verkoopregels rekenen ermee, bestaande regels houden hun kost.</p>
        <!-- The server writes every received line, also over a newer container's cost: say so before the button. -->
        @if (newerText(); as warn) {
          <div class="wk-banner wk-banner--warn wk-banner--inset ac-sheet__warn" role="status"><span class="wk-banner__text">{{ warn }}</span></div>
        }
        @if (!p.rows.length) {
          <p class="ac-sheet__empty">Deze container heeft nog geen producten.</p>
        }
        <ul class="ac-rows">
          @for (row of p.rows; track row.productId) {
            <li class="ac-row" [attr.data-state]="row.state" [attr.data-newer]="row.newer ? '' : null">
              <b class="ac-row__name">{{ row.name }}@if (row.variant) {<span class="ac-row__variant"> · {{ row.variant }}</span>}</b>
              @if (row.product) {
                <button class="linklike ac-row__history" type="button" [attr.aria-label]="'Kostprijshistoriek van ' + row.label"
                        (click)="historyFor.set(row)">Historiek ›</button>
              } @else {
                <span class="linklike ac-row__history ac-row__history--none" aria-hidden="true">Historiek ›</span>
              }
              <small class="ac-row__basis">{{ row.quantity }}@if (row.per) { · kostprijs {{ row.per }}}@if (row.catalogue; as price) {
                · <span class="ac-row__price">catalogus @if (price.fromEur !== null) {{{ price.fromEur | eur }} → }{{ price.toEur | eur }}</span>}</small>
              @if (row.state === 'skipped') {
                <p class="ac-row__skip">
                  niets ontvangen · blijft {{ row.currentEur !== null ? (row.currentEur | eur: 4) : 'zonder kostprijs' }}
                </p>
              } @else {
                <div class="ac-row__figures">
                  <div class="ac-fig">
                    <small>Nu</small>
                    <b>{{ row.currentEur !== null ? (row.currentEur | eur: 4) : '—' }}</b>
                    <span>{{ row.state === 'unknown' ? 'niet geladen' : (row.currentSource ?? 'nog geen kostprijs') }}@if (row.newer) {<span class="ac-fig__newer"> · nieuwer</span>}</span>
                  </div>
                  <div class="ac-fig ac-fig--new">
                    <small>Nieuw</small>
                    <b>{{ row.newEur | eur: 4 }}</b>
                    @if (row.other; as other) { <span>{{ other.sign }} {{ other.price | eur: 4 }} {{ other.per }}</span> }
                  </div>
                  <div class="ac-fig ac-fig--delta" [attr.data-state]="row.state">
                    <small>Verschil</small>
                    @switch (row.state) {
                      @case ('new') { <b>nieuw</b><span>eerste kostprijs</span> }
                      @case ('unknown') { <b>—</b><span>huidige kostprijs onbekend</span> }
                      @case ('unchanged') { <b>=</b><span>geen wijziging</span> }
                      @case ('same') { <b>=</b><span>zelfde kostprijs · nieuwe bron</span> }
                      @default {
                        <b>{{ row.state === 'up' ? '▲' : '▼' }} {{ absEur(row.deltaEur) | eur: 4 }}</b>
                        @if (row.deltaPct !== null) { <span>{{ signedPct(row.deltaPct) }}</span> }
                      }
                    }
                  </div>
                </div>
              }
            </li>
          }
        </ul>
        @if (p.skipped) {
          <p class="ac-sheet__note">Een product dat niets ontving, houdt zijn kostprijs; het telt niet mee.</p>
        }
      </div>
      <div foot class="ac-foot">
        <button class="btn" type="button" [disabled]="busy()" (click)="cancel.emit()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="busy() || !p.written" (click)="confirm.emit()">
          {{ busy() ? 'Bezig…' : button() }}
        </button>
      </div>
    </app-sheet>
    @if (historyFor(); as row) {
      @if (row.product; as product) {
        <app-product-cost-history-sheet [product]="product" [currentOrderId]="orderId()" (closed)="historyFor.set(null)" />
      }
    }
  `,
  styles: `
    .ac-sheet { display: grid; gap: 12px; min-width: 0; }
    .ac-sheet__intro { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
    .ac-sheet__empty, .ac-sheet__note { margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.45; }
    .ac-rows { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .ac-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'name link' 'basis basis' 'figs figs';
      align-items: baseline; gap: 4px 12px; min-width: 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
    .ac-row[data-state='unchanged'], .ac-row[data-state='skipped'] { background: var(--surface-2); }
    .ac-sheet__warn { margin: 0; }
    .ac-row[data-newer] { border-color: #f0dcbc; background: var(--warn-soft); }
    .ac-fig .ac-fig__newer { color: var(--warn); font-weight: 700; }
    .ac-row[data-state='skipped'] .ac-row__name { color: var(--muted); }
    .ac-row__name { grid-area: name; min-width: 0; font-size: 14px; line-height: 1.35; overflow-wrap: anywhere; }
    .ac-row__variant { color: var(--rose-dark); font-weight: 650; }
    .ac-row__history { grid-area: link; white-space: nowrap; }
    /* A product the screen could not load has no history to open; the hidden link keeps its width, so the figures line up. */
    .ac-row__history--none { visibility: hidden; }
    .ac-row__basis { grid-area: basis; color: var(--muted); font-size: 11.5px; line-height: 1.4; }
    .ac-row__price { white-space: nowrap; }
    .ac-row__skip { grid-area: figs; margin: 2px 0 0; color: var(--muted); font-size: 12.5px; font-style: italic; }
    .ac-row__figures { grid-area: figs; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 4px; }
    .ac-fig { display: grid; align-content: start; gap: 1px; min-width: 0; }
    .ac-fig small { color: var(--muted); font-size: 9.5px; font-weight: 750; letter-spacing: .07em; text-transform: uppercase; }
    .ac-fig b { font-size: 14px; font-variant-numeric: tabular-nums; line-height: 1.3; overflow-wrap: anywhere; }
    .ac-fig span { color: var(--muted); font-size: 11px; line-height: 1.35; overflow-wrap: anywhere; }
    .ac-fig--new b { color: var(--rose-dark); }
    .ac-fig--delta[data-state='up'] b { color: var(--danger); }
    .ac-fig--delta[data-state='down'] b { color: var(--ok); }
    .ac-fig--delta[data-state='unchanged'] b, .ac-fig--delta[data-state='same'] b { color: var(--muted); }
    .ac-foot { display: contents; }
    /* Desk: one line per product, the figures beside the name. */
    @media (min-width: 680px) {
      .ac-row { grid-template-columns: minmax(0, 1.15fr) minmax(0, 2.4fr) auto; grid-template-areas: 'name figs link' 'basis figs link'; align-items: start; gap: 2px 18px; }
      .ac-row__figures, .ac-row__skip { margin-top: 0; }
      .ac-row__skip { align-self: center; }
    }
    @media (max-width: 679.98px) {
      .ac-sheet { padding: 0 16px; }
      .ac-row__history--none { display: none; }
      .ac-foot { display: flex; flex-direction: column-reverse; gap: 8px; width: 100%; }
      .ac-foot .btn { flex: none; width: 100%; }
    }
  `,
})
export class PurchaseApplyCostsSheet {
  protected readonly desktop = inject(DesktopViewport);

  readonly plan = input.required<ApplyCostsPlan>();
  /** The container being applied; its own rows in a product's history need no link back. */
  readonly orderId = input<number | null>(null);
  readonly busy = input(false);
  readonly confirm = output<void>();
  readonly cancel = output<void>();

  readonly button = computed(() => applyCostsButton(this.plan()));
  readonly newerText = computed(() => newerNotice(this.plan().newer));
  /** The row whose product history is open on top of this sheet. */
  readonly historyFor = signal<ApplyCostRow | null>(null);

  absEur(value: number | null): number {
    return Math.abs(value ?? 0);
  }

  /** "+0,4 %", "−3,2 %". */
  signedPct(pct: number): string {
    const text = Math.abs(pct).toLocaleString('nl-BE', { maximumFractionDigits: 1 });
    return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${text} %`;
  }
}
