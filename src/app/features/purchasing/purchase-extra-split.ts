import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { LandedCost, PurchaseOrder } from '../../core/api/models';
import { EurPipe, EurUpPipe, NumPipe, ceilTo } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';

interface SplitRow {
  productId: number;
  name: string;
  quantity: number;
  /** The landed piece price without any Enrosed kost. */
  baseUnit: number;
  landedUnit: number;
  extraUnit: number;
  shareEur: number;
}

export type SplitFill = 'PIECES' | 'VALUE' | 'CBM' | 'EVEN';

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The Enrosed kost spread by hand, in a window of its own: every product
 * with what it costs without the Enrosed kost, the amount it carries, and
 * the resulting piece price, which can be typed the other way round. What
 * is spread and what is left sits on one row on top, with the quick fills.
 */
@Component({
  selector: 'app-purchase-extra-split',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, EurPipe, EurUpPipe, NumPipe],
  template: `
    <app-sheet title="Enrosed kost per product" [wide]="true" (closed)="closed.emit()">
      <div body class="xs" [class.xs--over]="remainder() < -0.004" [class.xs--done]="remainder() >= -0.004 && remainder() <= 0.004">
        <div class="xs__bar">
          <div class="xs__sum">
            <p><b>{{ spread() | eur: 0 }}</b> van {{ target() | eur: 0 }} verdeeld
              @if (remainder() > 0.004) { <em>· nog {{ remainder() | eur: 0 }}</em> }
              @else if (remainder() < -0.004) { <em>· {{ -remainder() | eur: 0 }} boven de Enrosed kost, dat mag</em> }
              @else { <em>· alles verdeeld</em> }</p>
            @if (negative()) { <p class="xs__warn">Een product staat onder nul: de kostprijs ligt onder wat het zonder Enrosed kost al kost. Zet dat recht, anders kan de order niet bewaard worden.</p> }
            <div class="payments-meter"><div class="payments-meter__fill" [style.width.%]="pct()"></div></div>
          </div>
          <div class="xs__fill">
            <span>Vul in</span>
            <button type="button" class="fin-chip" (click)="fill.emit('PIECES')">naar stuks</button>
            <button type="button" class="fin-chip" (click)="fill.emit('VALUE')">naar waarde</button>
            <button type="button" class="fin-chip" (click)="fill.emit('CBM')">naar volume</button>
            <button type="button" class="fin-chip" (click)="fill.emit('EVEN')">gelijk</button>
            @if (remainder() > 0.004) { <button type="button" class="fin-chip fin-chip--warn" (click)="rest.emit()">rest op de laatste</button> }
          </div>
        </div>

        <div class="xs__table" role="table" aria-label="Enrosed kost per product">
          <div class="xs__head" role="row">
            <span>Product</span><span class="num">Stuks</span><span class="num">Zonder Enrosed kost</span><span>Enrosed kost</span><span>Kostprijs / stuk</span>
          </div>
          @for (row of rows(); track row.productId) {
            <div class="xs__row" role="row" [class.xs__row--negative]="row.shareEur < 0">
              <span class="xs__name"><b>{{ row.name }}</b><small>{{ row.quantity | num }} stuks · zonder Enrosed kost {{ row.baseUnit | eurUp: 3 }}</small></span>
              <span class="xs__qty num">{{ row.quantity | num }}</span>
              <span class="xs__base num">{{ row.baseUnit | eurUp: 3 }}</span>
              <span class="xs__money">
                <span class="xs__lbl">Enrosed kost</span>
                <label>
                  <i>€</i><input class="input num right" type="number" step="10" inputmode="decimal" [attr.aria-label]="'Enrosed kost voor ' + row.name"
                         [value]="draftOf('s' + row.productId, shareText(row))"
                         (input)="onShareInput(row.productId, $any($event.target).value)" (blur)="settle('s' + row.productId)" />
                </label>
                <small>{{ row.extraUnit | eurUp: 3 }} per stuk</small>
              </span>
              <span class="xs__money">
                <span class="xs__lbl">Kostprijs / stuk</span>
                <label>
                  <i>€</i><input class="input num right" type="number" min="0" step="0.01" inputmode="decimal" [attr.aria-label]="'Kostprijs per stuk voor ' + row.name + ', de Enrosed kost volgt'"
                         [value]="draftOf('t' + row.productId, fixed3(row.landedUnit))"
                         (input)="onTargetInput(row.productId, $any($event.target).value)" (blur)="settle('t' + row.productId)" />
                </label>
                <small>typ de kostprijs, de Enrosed kost ernaast volgt</small>
              </span>
            </div>
          }
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
    .xs { display: grid; gap: 14px; container-type: inline-size; }
    .xs__bar { display: grid; grid-template-columns: minmax(220px, 1fr) auto; align-items: center; gap: 10px 18px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2); }
    .xs__sum p { margin: 0 0 6px; font-size: 13px; }
    .xs__sum b { font-variant-numeric: tabular-nums; }
    .xs__sum em { color: var(--warn); font-style: normal; font-weight: 650; }
    .xs--over .xs__sum em { color: var(--ink-2); font-weight: 600; }
    .xs__warn { margin: 6px 0 0; color: var(--danger, #b3261e); font-size: 12px; font-weight: 650; }
    .xs--done .xs__sum em { color: var(--ok); }
    .xs__sum .payments-meter { margin: 0; }
    .xs__fill { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .xs__fill > span { color: var(--muted); font-size: 11.5px; }
    .xs__table { display: grid; gap: 4px; }
    .xs__head, .xs__row { display: grid; grid-template-columns: minmax(140px, 1.6fr) 56px 120px minmax(150px, 1fr) minmax(150px, 1fr); align-items: center; gap: 12px; }
    .xs__head { padding: 0 12px; color: var(--muted); font-size: 10px; font-weight: 750; letter-spacing: .05em; text-transform: uppercase; }
    .xs__head .num { text-align: right; }
    .xs__row { padding: 8px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
    .xs__row--negative { border-color: var(--danger, #b3261e); background: var(--danger-soft, #fdecea); }
    .xs__name { display: grid; min-width: 0; }
    .xs__name b { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
    .xs__name small { display: none; color: var(--muted); font-size: 11px; }
    .xs__qty, .xs__base { text-align: right; font-variant-numeric: tabular-nums; }
    .xs__base { color: var(--ink-2); }
    .xs__money { display: grid; gap: 2px; min-width: 0; }
    .xs__lbl { display: none; color: var(--muted); font-size: 10px; font-weight: 750; letter-spacing: .05em; text-transform: uppercase; }
    .xs__money label { display: flex; align-items: center; gap: 4px; min-width: 0; }
    .xs__money i { color: var(--muted); font-style: normal; }
    .xs__money .input { width: 100%; min-width: 0; min-height: 36px; }
    .xs__money small { overflow: hidden; color: var(--muted); font-size: 10.5px; text-overflow: ellipsis; white-space: nowrap; }
    /* A window narrower than the five columns stacks each product: name, then the two fields with their own labels. */
    @container (max-width: 700px) {
      .xs__bar { grid-template-columns: 1fr; }
      .xs__head { display: none; }
      .xs__row { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 10px; }
      .xs__name { grid-column: 1 / -1; }
      .xs__name small { display: block; }
      .xs__qty, .xs__base { display: none; }
      .xs__lbl { display: block; }
      .xs__money small { white-space: normal; line-height: 1.2; }
    }
    @container (max-width: 380px) {
      .xs__row { grid-template-columns: 1fr; }
    }
  `,
})
export class PurchaseExtraSplit {
  readonly order = input.required<PurchaseOrder>();
  readonly costing = input<LandedCost | null>(null);
  readonly shareChange = output<{ productId: number; raw: unknown }>();
  readonly targetChange = output<{ productId: number; raw: unknown }>();
  readonly fill = output<SplitFill>();
  readonly rest = output<void>();
  readonly automatic = output<void>();
  readonly closed = output<void>();

  readonly target = computed(() => this.order().extraRevenueEur || 0);
  readonly rows = computed<SplitRow[]>(() => this.order().lines.map((line) => {
    const costed = this.costing()?.lines.find((row) => row.productId === line.productId);
    const quantity = line.quantity;
    const extra = costed?.extraRevenueEur ?? 0;
    return {
      productId: line.productId,
      name: costed?.productName ?? `Product ${line.productId}`,
      quantity,
      baseUnit: costed && quantity > 0 ? (costed.totalEur - extra) / quantity : 0,
      landedUnit: costed?.landedUnitEur ?? 0,
      extraUnit: quantity > 0 ? extra / quantity : 0,
      shareEur: line.extraShareEur ?? 0,
    };
  }));
  readonly spread = computed(() => round2(this.rows().reduce((sum, row) => sum + row.shareEur, 0)));
  readonly remainder = computed(() => round2(this.target() - this.spread()));
  readonly pct = computed(() => (this.target() > 0 ? Math.min(100, Math.max(0, this.spread()) / this.target() * 100) : 0));
  readonly negative = computed(() => this.rows().some((row) => row.shareEur < 0));

  shareText(row: SplitRow): string {
    return row.shareEur ? String(row.shareEur) : '';
  }

  fixed3(value: number): string {
    return ceilTo(value, 3).toFixed(3);
  }

  /* What is being typed stays as typed until the field is left; only then the recalculated value shows. */
  private readonly drafts = signal<Record<string, string>>({});

  draftOf(key: string, fallback: string): string {
    return this.drafts()[key] ?? fallback;
  }

  onShareInput(productId: number, raw: string): void {
    this.drafts.update((drafts) => ({ ...drafts, ['s' + productId]: raw }));
    this.shareChange.emit({ productId, raw });
  }

  onTargetInput(productId: number, raw: string): void {
    this.drafts.update((drafts) => ({ ...drafts, ['t' + productId]: raw }));
    this.targetChange.emit({ productId, raw });
  }

  settle(key: string): void {
    this.drafts.update((drafts) => {
      const rest = { ...drafts };
      delete rest[key];
      return rest;
    });
  }
}
