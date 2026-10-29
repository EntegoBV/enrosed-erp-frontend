import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Product } from '../../core/api/models';
import { StockBatchApi } from '../../core/api/stock-batch-api';
import type { StockBatch, StockBatchMove } from '../../core/api/stock-batch-models';
import { batchFormat } from '../../core/api/stock-batch-units';
import { messageOf } from '../../core/api/errors';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import { batchDate, batchDrift, batchFigures, batchStateWord, batchTitle, moveDelta, moveLabel } from './product-batches';
import { costRows, labelRows, type PriceRow, type UnitCostParts } from './product-price-build';
import { productSalesUnit } from './product-sales-unit';

/** Moves shown at first; "Meer" asks for up to 500. */
const FIRST_MOVES = 20;

/**
 * One batch of a product (2026-10-25, batches contract §7.2): what came in,
 * what left, its cost per unit taken apart like the product page's build-up,
 * and its moves. Opened from the Batches card (desk) and section (phone).
 */
@Component({
  selector: 'app-product-batch-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, RouterLink, EurPipe],
  template: `
    <app-sheet [title]="'Batch · ' + title()" variant="ios" [wide]="desktop.active()" (closed)="closed.emit()">
      <div body class="pbs-sheet">
        @if (desktop.active()) {
          <div class="pbs-stats">
            @for (figure of figures(); track figure.label) {
              <div class="stat-row"><span>{{ figure.label }}</span><b class="num">{{ figure.value }}</b></div>
            }
          </div>
        } @else {
          <div class="ios-figures pbs-figures">
            @for (figure of figures(); track figure.label) {
              <div><small>{{ figure.label }}</small><strong class="num">{{ figure.value }}</strong></div>
            }
          </div>
        }

        @if (drift(); as line) {
          <p class="pbs-drift" role="note"><b>{{ line.text }}</b> · <a [routerLink]="['/purchasing', line.orderId]" [queryParams]="{ apply: 1 }" (click)="closed.emit()">Opnieuw toepassen ›</a></p>
        }

        <section class="pbs-block" aria-labelledby="pbs-cost-title">
          <div class="ios-section__head pbs-head"><h2 id="pbs-cost-title">Kostprijs per {{ unit().singular }}</h2>
            <span class="wk-pill" [class.tone-ok]="batch().costState === 'APPLIED'" [class.tone-accent]="batch().costState === 'CALCULATED'" [class.tone-warn]="batch().costState === 'NONE'">{{ stateWord() }}</span></div>
          <dl class="price-build__list">
            @for (row of costRows(); track $index) {
              <div [class.price-build__sum]="row.sum"><dt>{{ row.label }}@if (row.hint) { <small>{{ row.hint }}</small> }</dt>
                <dd class="num">{{ row.eur === null ? '—' : (row.eur | eur: 4) }}</dd></div>
            }
          </dl>
          @if (!batch().parts && batch().unitCostEur !== null) { <p class="pbs-muted">Opbouw niet bewaard.</p> }
          @if (batch().unitCostExclEnrosedEur; as excl) {
            <div class="pbs-aside"><span>Zonder Enrosed kost</span><span class="num">{{ excl | eur: 4 }}</span></div>
          }
        </section>

        <section class="pbs-block" aria-labelledby="pbs-moves-title">
          <div class="ios-section__head pbs-head"><h2 id="pbs-moves-title">Bewegingen</h2></div>
          @if (moves(); as list) {
            <ul class="pbs-moves">
              @for (move of list.moves; track move.id) {
                <li>
                  <span class="pbs-moves__main"><b [title]="moveText(move)">{{ moveText(move) }}</b>
                    <small>{{ moveDate(move) }}@if (move.actor) { · {{ move.actor }}}</small></span>
                  <strong class="num" [class.minus]="move.pieces < 0">{{ delta(move) }}</strong>
                </li>
              } @empty {
                <li class="pbs-muted">Nog geen bewegingen.</li>
              }
            </ul>
            @if (list.total > list.moves.length && list.moves.length <= 20) {
              <button class="linklike pbs-more" type="button" [disabled]="movesBusy()" (click)="loadMoves(500)">Meer ({{ list.total - list.moves.length }}) ›</button>
            }
          } @else if (movesError(); as error) {
            <p class="pbs-muted" role="alert">{{ error }} <button class="linklike" type="button" (click)="loadMoves(20)">Opnieuw proberen</button></p>
          } @else {
            <p class="pbs-muted" role="status">Bewegingen laden…</p>
          }
        </section>
      </div>
      <div foot style="display:contents">
        @if (batch().purchaseOrderId !== null && !batch().containerGone) {
          <a class="btn pbs-to" [routerLink]="['/purchasing', batch().purchaseOrderId]" [title]="'Naar ' + title()" (click)="closed.emit()"><span>Naar {{ title() }} ›</span></a>
        }
        <span class="spacer"></span>
        <button class="btn" type="button" (click)="closed.emit()">Sluiten</button>
      </div>
    </app-sheet>
  `,
  styles: `
    .pbs-sheet { --ios-inset: 0px; display: grid; gap: 14px; min-width: 0; }
    .pbs-stats { display: grid; }
    .pbs-stats .stat-row b { font-weight: 650; text-align: right; }
    .pbs-figures { margin: 0; }
    .pbs-figures > div:last-child:nth-child(odd) { grid-column: 1 / -1; }
    .pbs-figures strong { font-size: 16px; white-space: normal; overflow-wrap: anywhere; }
    .pbs-drift { margin: 0; padding: 9px 12px; border-radius: 12px; background: var(--warn-soft); color: #7c450b; font-size: 13px; line-height: 1.45; }
    .pbs-drift a { color: inherit; font-weight: 650; }
    .pbs-block { display: grid; min-width: 0; }
    .pbs-head { align-items: center; padding: 0 0 6px; }
    .pbs-head .wk-pill { flex: none; }
    .price-build__list { margin: 0; padding: 0; }
    .price-build__list > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 14px; }
    .price-build__list > div:last-child { border-bottom: 0; }
    .price-build__list dt { min-width: 0; overflow-wrap: anywhere; }
    .price-build__list dt small { display: block; color: var(--muted); font-size: 12px; font-weight: 500; }
    .price-build__list dd { margin: 0; font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .price-build__sum { font-weight: 700; }
    .pbs-muted { margin: 4px 0 0; color: var(--muted); font-size: 13px; line-height: 1.4; }
    .pbs-aside { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0 0; color: var(--muted); font-size: 13px; }
    .pbs-aside .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .pbs-moves { display: grid; margin: 0; padding: 0; list-style: none; }
    .pbs-moves li { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
    .pbs-moves li:last-child { border-bottom: 0; }
    .pbs-moves__main { display: grid; flex: 1; min-width: 0; }
    .pbs-moves__main b { overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
    .pbs-moves__main small { overflow: hidden; color: var(--muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .pbs-moves strong { flex: none; color: var(--ok); font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .pbs-moves strong.minus { color: var(--danger); }
    .pbs-more { justify-self: start; margin-top: 6px; font-size: 13px; }
    .pbs-to { min-width: 0; max-width: 60%; }
    .pbs-to span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px) { .pbs-sheet { padding: 0 16px; } }
  `,
})
export class ProductBatchSheet {
  protected readonly desktop = inject(DesktopViewport);
  private readonly stockBatches = inject(StockBatchApi);

  readonly batch = input.required<StockBatch>();
  readonly product = input.required<Product>();
  readonly closed = output<void>();

  protected readonly unit = computed(() => productSalesUnit(this.product()));
  private readonly fmt = computed(() => batchFormat(this.unit()));
  protected readonly title = computed(() => batchTitle(this.batch()));
  protected readonly figures = computed(() => batchFigures(this.batch(), this.fmt()));
  protected readonly stateWord = computed(() => batchStateWord(this.batch()));
  protected readonly drift = computed(() => batchDrift(this.batch(), this.fmt()));

  /** The product page's own build-up rows, to 4 decimals (the batch keeps the card's scale); empty parts read 0. */
  protected readonly costRows = computed((): (Omit<PriceRow, 'eur'> & { eur: number | null })[] => {
    const batch = this.batch();
    const label = `Kostprijs per ${this.unit().singular}`;
    if (batch.unitCostEur === null || batch.unitCostEur === undefined) return [{ label, eur: null, sum: true }];
    const parts = batch.parts;
    if (!parts) return [{ label, eur: batch.unitCostEur, sum: true }];
    const unitParts: UnitCostParts = {
      goodsEur: parts.goodsEur ?? 0, originEur: parts.originEur ?? 0, freightEur: parts.freightEur ?? 0,
      dutyEur: parts.dutyEur ?? 0, destinationEur: parts.destinationEur ?? 0, enrosedEur: parts.enrosedEur ?? 0,
      separateEur: parts.separateEur ?? 0,
    };
    return labelRows(costRows(unitParts, batch.unitCostEur, 4), {}, label);
  });

  protected readonly moves = signal<{ total: number; moves: StockBatchMove[] } | null>(null);
  protected readonly movesError = signal<string | null>(null);
  protected readonly movesBusy = signal(false);
  private movesFor: number | null = null;
  private movesRequest = 0;

  constructor() {
    effect(() => {
      const id = this.batch().id;
      if (this.movesFor === id) return;
      this.movesFor = id;
      this.moves.set(null);
      void this.loadMoves(FIRST_MOVES);
    });
  }

  protected async loadMoves(limit: number): Promise<void> {
    const id = this.batch().id;
    const request = ++this.movesRequest;
    this.movesBusy.set(true);
    this.movesError.set(null);
    try {
      const answer = await this.stockBatches.moves(id, limit);
      if (request === this.movesRequest) this.moves.set(answer);
    } catch (failure: unknown) {
      if (request === this.movesRequest && !this.moves()) this.movesError.set(messageOf(failure, 'Bewegingen niet geladen.'));
    } finally {
      if (request === this.movesRequest) this.movesBusy.set(false);
    }
  }

  /** "{moveLabel} · {reference}". */
  protected moveText(move: StockBatchMove): string {
    return move.reference ? `${moveLabel(move)} · ${move.reference}` : moveLabel(move);
  }

  protected moveDate(move: StockBatchMove): string {
    return batchDate(move.at) || '—';
  }

  protected delta(move: StockBatchMove): string {
    return moveDelta(move, this.fmt());
  }
}
