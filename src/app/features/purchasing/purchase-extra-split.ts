import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LandedCost, PurchaseOrder, PurchaseOrderLine } from '../../core/api/models';
import { EurPipe, NumPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';

interface SplitRow {
  index: number;
  line: PurchaseOrderLine;
  name: string;
  quantity: number;
  goodsEur: number;
  cbm: number;
  shareEur: number;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The Enrosed kost spread over the products by hand: one amount per line,
 * the running total against what the container should carry, and three
 * quick fills to start from before nudging a line up or down. Every change
 * goes straight into the draft, so the piece prices follow while typing.
 */
@Component({
  selector: 'app-purchase-extra-split',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, EurPipe, NumPipe],
  template: `
    <app-sheet title="Enrosed kost per product" (closed)="closed.emit()">
      <div body class="xs">
        <p class="xs__intro">Verdeel {{ target() | eur }} zelf over de producten. Wat je hier per regel zet, komt in de stukprijs van dat product; de rest van de container volgt de gewone verdeelsleutels.</p>
        <div class="xs__quick" role="group" aria-label="Snel verdelen">
          <button type="button" class="fin-chip" (click)="fill('PIECES')">Naar stuks</button>
          <button type="button" class="fin-chip" (click)="fill('VALUE')">Naar waarde</button>
          <button type="button" class="fin-chip" (click)="fill('CBM')">Naar volume</button>
          <button type="button" class="fin-chip" (click)="fill('EVEN')">Gelijk per regel</button>
        </div>
        <ul class="xs__rows">
          @for (row of rows(); track row.index) {
            <li class="xs__row">
              <span class="xs__what"><b>{{ row.name }}</b><small>{{ row.quantity | num }} stuks{{ row.shareEur > 0 && row.quantity > 0 ? ' · ' + (row.shareEur / row.quantity | eur: 4) + ' per stuk' : '' }}</small></span>
              <span class="xs__money"><i>€</i><input class="input num right" type="number" min="0" step="10" inputmode="decimal" [attr.aria-label]="'Enrosed kost voor ' + row.name"
                     [value]="row.shareEur || ''" (input)="setShare(row.index, $any($event.target).value)" /></span>
            </li>
          }
        </ul>
        <div class="xs__total" [class.xs__total--short]="remainder() > 0.004" [class.xs__total--over]="remainder() < -0.004">
          <span><b>{{ spread() | eur }}</b> verdeeld van {{ target() | eur }}</span>
          @if (remainder() > 0.004) { <em>nog {{ remainder() | eur }} te verdelen <button class="linklike" type="button" (click)="restToLast()">op de laatste regel</button></em> }
          @else if (remainder() < -0.004) { <em>{{ -remainder() | eur }} meer dan de Enrosed kost</em> }
          @else { <em>✓ alles verdeeld</em> }
        </div>
      </div>
      <div foot style="display:contents">
        <button class="btn btn--danger" type="button" (click)="automatic.emit()">Weer automatisch</button>
        <span class="spacer"></span>
        <button class="btn btn--primary" type="button" (click)="closed.emit()">Klaar</button>
      </div>
    </app-sheet>
  `,
  styles: `
    :host { display: contents; }
    .xs { display: grid; gap: 12px; }
    .xs__intro { margin: 0; color: var(--ink-2); font-size: 12.5px; line-height: 1.45; }
    .xs__quick { display: flex; flex-wrap: wrap; gap: 6px; }
    .xs__rows { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
    .xs__row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
    .xs__what { display: grid; min-width: 0; }
    .xs__what b { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
    .xs__what small { color: var(--muted); font-size: 11px; }
    .xs__money { display: inline-flex; align-items: center; gap: 4px; }
    .xs__money i { color: var(--muted); font-style: normal; }
    .xs__money .input { width: 110px; }
    .xs__total { display: grid; gap: 2px; padding: 10px 12px; border-radius: 12px; background: var(--surface-2); font-size: 13px; }
    .xs__total em { color: var(--ok); font-size: 12px; font-style: normal; font-weight: 650; }
    .xs__total--short em { color: var(--warn); }
    .xs__total--over em { color: var(--danger, #b3261e); }
  `,
})
export class PurchaseExtraSplit {
  readonly order = input.required<PurchaseOrder>();
  readonly costing = input<LandedCost | null>(null);
  /** The lines with their new shares; the host puts them in the draft. */
  readonly changed = output<PurchaseOrderLine[]>();
  /** Back to a key: the host resets the allocation and clears the shares. */
  readonly automatic = output<void>();
  readonly closed = output<void>();

  readonly target = computed(() => this.order().extraRevenueEur || 0);
  readonly rows = computed<SplitRow[]>(() => this.order().lines.map((line, index) => {
    const costed = this.costing()?.lines.find((row) => row.productId === line.productId);
    return {
      index, line,
      name: costed?.productName ?? `Product ${line.productId}`,
      quantity: line.quantity,
      goodsEur: costed?.goodsEur ?? 0,
      cbm: costed?.cbm ?? 0,
      shareEur: line.extraShareEur ?? 0,
    };
  }));
  readonly spread = computed(() => round2(this.rows().reduce((sum, row) => sum + row.shareEur, 0)));
  readonly remainder = computed(() => round2(this.target() - this.spread()));

  setShare(index: number, raw: string): void {
    const value = Number(String(raw).replace(',', '.'));
    this.emit(this.order().lines.map((line, at) => (at === index ? { ...line, extraShareEur: Number.isFinite(value) && value > 0 ? round2(value) : 0 } : line)));
  }

  /** Spreads the whole Enrosed kost by a key, cents landing on the last line, as a starting point to adjust. */
  fill(key: 'PIECES' | 'VALUE' | 'CBM' | 'EVEN'): void {
    const rows = this.rows();
    const weights = rows.map((row) => key === 'PIECES' ? row.quantity : key === 'VALUE' ? row.goodsEur : key === 'CBM' ? row.cbm : 1);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (!rows.length) return;
    const shares = weights.map((weight) => (total > 0 ? round2(this.target() * weight / total) : 0));
    const given = round2(shares.reduce((sum, share) => sum + share, 0));
    shares[shares.length - 1] = round2(shares[shares.length - 1] + this.target() - given);
    this.emit(this.order().lines.map((line, at) => ({ ...line, extraShareEur: Math.max(0, shares[at]) })));
  }

  restToLast(): void {
    const lines = this.order().lines;
    if (!lines.length) return;
    const last = lines.length - 1;
    this.emit(lines.map((line, at) => (at === last ? { ...line, extraShareEur: round2((line.extraShareEur ?? 0) + this.remainder()) } : line)));
  }

  private emit(lines: PurchaseOrderLine[]): void {
    this.changed.emit(lines);
  }
}
