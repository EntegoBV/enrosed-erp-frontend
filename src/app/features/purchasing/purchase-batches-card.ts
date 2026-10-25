import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { PurchaseStockBatches } from '../../core/api/stock-batch-models';
import { eurText } from '../../core/api/stock-batch-units';
import { EurPipe } from '../../shared/pipes';
import { Icon } from '../../shared/icon';
import { purchaseBatchFigures, purchaseBatchSummary, type PurchaseBatchRow } from './purchase-batches-model';

/**
 * Stock batches (2026-10-25): what became of the batches this container
 * booked. The desk shows a table under the products (its look lives in
 * styles/purchase-desk.scss, scoped to app-purchase-desk); the phone read
 * view an iOS section on Overzicht. Every product name leads to that
 * product's Batches card. The host shows it only once batches started and
 * the container has rows.
 */
@Component({
  selector: 'app-purchase-batches-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EurPipe, Icon],
  template: `
    @let d = data();
    @if (layout() === 'desk') {
      <section class="pbc-desk" aria-labelledby="pbc-desk-title">
        <div class="desk-table-bar pbc-bar">
          <div><h2 id="pbc-desk-title">Batches uit deze container</h2><p>{{ summary() }}</p></div>
        </div>
        <div class="pbc-wrap">
          <table class="desk-table desk-table--batches">
            <thead>
              <tr>
                <th class="c-bprod">Product</th>
                <th class="c-bin">Ontvangen</th>
                <th class="c-bout">Uit voorraad</th>
                <th class="c-bleft">Nog</th>
                <th class="c-bcost">Kost per eenheid</th>
                <th class="c-bval">Waarde</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track $index) {
                <tr>
                  <td class="c-bprod">
                    <a class="pbc-name" [routerLink]="row.productLink" fragment="pd-batches" [title]="row.name">{{ row.name }}</a>
                    @if (row.variant) { <small class="pbc-sub">{{ row.variant }}</small> }
                  </td>
                  <td class="c-bin num"><b>{{ row.received }}</b></td>
                  <td class="c-bout num">
                    <b>@for (part of figureParts(row.out); track $index) {<span class="pbc-part">{{ part }}</span>}</b>
                    @if (row.outDetail) { <small class="pbc-sub" [title]="row.outDetail">{{ row.outDetail }}</small> }
                  </td>
                  <td class="c-bleft num"><b>@for (part of figureParts(row.left); track $index) {<span class="pbc-part">{{ part }}</span>}</b><small class="pbc-sub pbc-from">van {{ row.received }}</small></td>
                  <td class="c-bcost num" [title]="costTitle(row)">
                    <b [class.pbc-warn]="row.stale">{{ row.cost ?? '—' }}</b>
                    @if (row.costNote) { <small class="pbc-sub" [class.pbc-warn]="row.stale">{{ row.costNote }}</small> }
                  </td>
                  <td class="c-bval num"><b>{{ row.valueEur === null ? '—' : (row.valueEur | eur: 0) }}</b></td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <th class="c-bprod">Totaal</th>
                <th class="c-bin"></th>
                <th class="c-bout"></th>
                <th class="c-bleft"></th>
                <th class="c-bcost"></th>
                <th class="c-bval num">{{ d.totals.valueLeftEur | eur: 0 }}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    } @else {
      @let figures = phoneFigures();
      <section class="ios-section pbc-phone" id="purchase-batches-section" aria-labelledby="pbc-phone-title">
        <div class="ios-section__head"><h2 id="pbc-phone-title">Batches uit deze container</h2></div>
        <div class="ios-figures ios-figures--3">
          <div><small>Producten</small><strong>{{ figures.products }}</strong></div>
          <div><small>Nog op voorraad</small><strong>{{ figures.valueLeftEur | eur: 0 }}</strong></div>
          <div><small>Uitverkocht</small><strong>{{ figures.soldOut }}</strong></div>
        </div>
        <div class="ios-group">
          @for (row of rows(); track $index) {
            <a class="ios-cell pbc-cell" [routerLink]="row.productLink" fragment="product-batches" [attr.aria-label]="row.name + ': ' + costTitle(row)">
              <span class="ios-cell__body">
                <span class="ios-cell__title">{{ row.name }}</span>
                <span class="ios-cell__sub pbc-cell__sub">nog {{ row.left }} van {{ row.received }}</span>
              </span>
              <span class="ios-cell__trail">
                <span class="ios-cell__value pbc-cell__value" [class.pbc-warn]="row.stale">{{ row.cost ?? '—' }}</span>
                @if (row.costNow) { <span class="ios-cell__meta pbc-warn">→ {{ row.costNow }}</span> }
              </span>
              <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
            </a>
          }
        </div>
        <p class="ios-section__foot">Oudste batch gaat eerst.</p>
      </section>
    }
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .pbc-phone .pbc-cell { align-items: center; }
    .pbc-phone .ios-cell__title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* The units may not fit beside the cost at 375 px: the line wraps once instead of cutting a figure. */
    .pbc-phone .pbc-cell__sub { display: -webkit-box; overflow: hidden; white-space: normal; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .pbc-phone .pbc-cell__value { font-size: 15px; }
    .pbc-phone .pbc-warn { color: var(--warn); }
  `,
})
export class PurchaseBatchesCard {
  readonly data = input.required<PurchaseStockBatches>();
  readonly rows = input.required<PurchaseBatchRow[]>();
  readonly layout = input<'desk' | 'phone'>('desk');

  readonly summary = computed(() => purchaseBatchSummary(this.data(), eurText));
  readonly phoneFigures = computed(() => purchaseBatchFigures(this.data()));

  /** "105 displays + 4 los" as ["105 displays", "+ 4 los"]: a narrow cell may break between the two, never inside one. */
  figureParts(text: string): string[] {
    const at = text.indexOf(' + ');
    return at < 0 ? [text] : [text.slice(0, at), text.slice(at + 1)];
  }

  /** The cost cell in full, for its tooltip and the phone cell's name: "€ 8,3180 · toegepast", "€ 8,3180 → 10,3858". */
  costTitle(row: PurchaseBatchRow): string {
    if (row.costNow) return `${row.cost ?? '—'} → ${row.costNow}`;
    return [row.cost ?? '—', row.costNote].filter((part) => !!part).join(' · ');
  }
}
