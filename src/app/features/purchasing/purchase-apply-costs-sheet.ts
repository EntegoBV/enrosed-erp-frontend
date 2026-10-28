import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import { ProductCostHistorySheet } from '../products/product-cost-history-sheet';
import { productSalesUnit } from '../products/product-sales-unit';
import { unitsText } from '../../core/api/stock-batch-units';
import { applyCostsButton, applyCostsRequest, newerNotice, withOverwrite, type ApplyCostRow, type ApplyCostsPlan } from './purchase-apply-costs';

/**
 * Kostprijzen toepassen: before a container's costs go onto the catalogue,
 * every product shows the cost it carries now and where that came from, the
 * cost it gets and the difference. Each row opens the product's history on
 * top. The editor does the applying; the sheet only shows and asks.
 * A product that carries a newer container's cost keeps its card unless its
 * row is ticked "Ook op de productkaart"; the confirm sends those ids
 * (batches round, 2026-10-25). With batches started, this container's
 * batches get the cost either way.
 */
@Component({
  selector: 'app-purchase-apply-costs-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, EurPipe, ProductCostHistorySheet],
  template: `
    @let p = shown();
    <app-sheet [title]="p.again ? 'Opnieuw kostprijzen toepassen' : 'Kostprijzen toepassen'" variant="ios"
               [wide]="desktop.active()" (closed)="cancel.emit()">
      <div body class="ac-sheet" [attr.inert]="busy() ? '' : null">
        <!-- Existing sales lines keep the cost frozen on them (SalesOrderService.withCostSnapshots, the batch stamp at shipment); only new lines take this one. -->
        @if (started()) {
          <p class="ac-sheet__intro">De kostprijs komt op de batches van deze container en op de productkaart; bestaande verkoopregels houden hun kost.</p>
        } @else {
          <p class="ac-sheet__intro">De kostprijs komt op de productkaart: nieuwe verkoopregels rekenen ermee, bestaande regels houden hun kost.</p>
        }
        <!-- The server keeps a newer container's card unless its row is ticked: say so before the button. A kept card's catalogue price does not move, so its row names no catalogue change. -->
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
              <small class="ac-row__basis">{{ row.quantity }}@if (row.per) { · kostprijs {{ row.per }}}@if (row.keepsCard ? null : row.catalogue; as price) {
                · <span class="ac-row__price">catalogus @if (price.fromEur !== null) {{{ price.fromEur | eur }} → }{{ price.toEur | eur }}</span>}@if (leftText(row); as left) {
                · <span class="ac-row__left">nog {{ left }} op voorraad</span>}</small>
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
                  <div class="ac-fig ac-fig--delta" [attr.data-state]="row.keepsCard ? 'kept' : row.state">
                    <small>Verschil</small>
                    @if (row.keepsCard) {
                      <b>{{ started() ? 'batch' : '—' }}</b><span>productkaart blijft</span>
                    } @else {
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
                    }
                  </div>
                </div>
                @if (row.newer) {
                  <label class="ac-row__keep"><input type="checkbox" [checked]="overwrite().has(row.productId)" [disabled]="busy()"
                         (change)="toggleOverwrite(row.productId, $any($event.target).checked)" /> Ook op de productkaart</label>
                }
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
        <button class="btn btn--primary" type="button" [disabled]="busy() || !p.written" (click)="confirm.emit(request())">
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
    .ac-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'name link' 'basis basis' 'figs figs' 'keep keep';
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
    .ac-fig--delta[data-state='unchanged'] b, .ac-fig--delta[data-state='same'] b, .ac-fig--delta[data-state='kept'] b { color: var(--muted); }
    .ac-row__left { white-space: nowrap; }
    .ac-row__keep { grid-area: keep; display: inline-flex; align-items: center; gap: 8px; justify-self: start; margin-top: 4px; color: var(--ink-2);
      font-size: 12.5px; font-weight: 600; cursor: pointer; }
    .ac-row__keep input { width: 16px; height: 16px; margin: 0; accent-color: var(--rose); }
    .ac-foot { display: contents; }
    /* Desk: one line per product, the figures beside the name. */
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover) {
      .ac-row { grid-template-columns: minmax(0, 1.15fr) minmax(0, 2.4fr) auto; grid-template-areas: 'name figs link' 'basis figs link' 'keep figs link'; align-items: start; gap: 2px 18px; }
      .ac-row__figures, .ac-row__skip { margin-top: 0; }
      .ac-row__skip { align-self: center; }
    }
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px) {
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
  /** Batches have started: the cost lands on this container's batches too. */
  readonly started = input(false);
  /** The newer products whose card is written after all (ApplyRequest.overwriteNewerProductIds). */
  readonly confirm = output<number[]>();
  readonly cancel = output<void>();

  /** Newer products ticked "Ook op de productkaart"; unticked by default, so a newer card stays. */
  readonly overwrite = signal<ReadonlySet<number>>(new Set());
  /** The plan with the ticks applied: which rows keep their card. */
  readonly shown = computed(() => withOverwrite(this.plan(), this.overwrite()));
  readonly request = computed(() => applyCostsRequest(this.shown()));
  readonly button = computed(() => applyCostsButton(this.shown()));
  readonly newerText = computed(() => newerNotice(this.shown().kept, this.started()));
  /** The row whose product history is open on top of this sheet. */
  readonly historyFor = signal<ApplyCostRow | null>(null);

  toggleOverwrite(productId: number, on: boolean): void {
    this.overwrite.update((ids) => {
      const next = new Set(ids);
      if (on) next.add(productId);
      else next.delete(productId);
      return next;
    });
  }

  /** "500 displays", "4 los": what this container still has on the shelf for the row's product; null before batches or without the product. */
  leftText(row: ApplyCostRow): string | null {
    if (!row.leftPieces || !row.product) return null;
    return unitsText(row.leftPieces.pieces, row.leftPieces.unitPieces, productSalesUnit(row.product));
  }

  absEur(value: number | null): number {
    return Math.abs(value ?? 0);
  }

  /** "+0,4 %", "−3,2 %". */
  signedPct(pct: number): string {
    const text = Math.abs(pct).toLocaleString('nl-BE', { maximumFractionDigits: 1 });
    return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${text} %`;
  }
}
