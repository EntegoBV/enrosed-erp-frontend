import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { Supplier } from '../../core/api/models';
import type { ProductSupplierChange, ProductSupplierRow } from '../../core/api/product-supplier-models';
import { ProductSupplierSheet } from './product-supplier-sheet';
import { sortSupplierRows, supplierRowHistory, supplierRowMeta } from './product-suppliers';

const EUR = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const AMOUNT = new Intl.NumberFormat('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

/**
 * The editor's Inkoop list of a product's suppliers (several suppliers,
 * 2026-10-25): one row per supplier (name, Voorkeur or Inactief, EXW price;
 * Versie, reference, MOQ, lead time and the last container below), inactive
 * rows folded, and the sheet to add or edit one. Rows stay at two lines.
 */
@Component({
  selector: 'app-product-supplier-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProductSupplierSheet],
  template: `
    <div class="psl" [class.psl--phone]="!desktop()">
      @if (active().length) {
        <ul class="psl-rows" aria-label="Leveranciers">
          @for (row of active(); track row.id) {
            <li>
              <button class="psl-row" type="button" [disabled]="disabled()" (click)="edit(row)"
                      [attr.aria-label]="row.supplierName + (row.preferred ? ', voorkeur' : '') + ': bewerken'">
                <span class="psl-row__line">
                  <b class="psl-row__name" [title]="row.supplierName">{{ row.supplierName }}</b>
                  @if (row.preferred) { <span class="wk-pill tone-accent psl-row__pill">Voorkeur</span> }
                  <span class="psl-row__price">{{ price(row) }}@if (row.supplierIncoterm) {<small>{{ row.supplierIncoterm }}</small>}</span>
                </span>
                <small class="psl-row__sub">{{ sub(row) }}</small>
              </button>
            </li>
          }
        </ul>
      }
      @if (inactive().length) {
        <button class="psl-fold" type="button" [attr.aria-expanded]="showInactive()" (click)="showInactive.set(!showInactive())">
          {{ inactive().length }} inactief <span aria-hidden="true">{{ showInactive() ? '⌄' : '›' }}</span>
        </button>
        @if (showInactive()) {
          <ul class="psl-rows psl-rows--inactive" aria-label="Inactieve leveranciers">
            @for (row of inactive(); track row.id) {
              <li>
                <button class="psl-row" type="button" [disabled]="disabled()" (click)="edit(row)"
                        [attr.aria-label]="row.supplierName + ', inactief: bewerken'">
                  <span class="psl-row__line">
                    <b class="psl-row__name" [title]="row.supplierName">{{ row.supplierName }}</b>
                    <span class="wk-pill psl-row__pill">Inactief</span>
                    <span class="psl-row__price">{{ price(row) }}@if (row.supplierIncoterm) {<small>{{ row.supplierIncoterm }}</small>}</span>
                  </span>
                  <small class="psl-row__sub">{{ sub(row) }}</small>
                </button>
              </li>
            }
          </ul>
        }
      }
      <button class="psl-add" id="ps-add" type="button" [disabled]="disabled()" (click)="add()">+ Leverancier toevoegen</button>
    </div>
    @if (sheet(); as open) {
      <app-product-supplier-sheet [productId]="productId()" [row]="open.row" [suppliers]="suppliers()" [taken]="taken()"
                                  [unitSingular]="unitSingular()" [variant]="desktop() ? 'default' : 'ios'"
                                  (changed)="changed.emit($event)" (stale)="reload.emit()" (closed)="sheet.set(null)" />
    }
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .psl { display: grid; gap: 8px; min-width: 0; margin-bottom: 14px; }
    .psl-rows { display: grid; margin: 0; padding: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); list-style: none; }
    .psl-rows > li + li { border-top: 1px solid var(--line); }
    .psl-rows--inactive { opacity: .78; }
    .psl-row {
      display: grid; gap: 2px; width: 100%; min-width: 0; min-height: 54px; padding: 9px 14px;
      border: 0; background: transparent; color: var(--ink); font: inherit; text-align: left; cursor: pointer;
    }
    .psl-row:hover:not(:disabled) { background: var(--surface-2); }
    .psl-row:disabled { cursor: default; }
    .psl-row:focus-visible { outline: 3px solid color-mix(in srgb, var(--rose-mid) 55%, transparent); outline-offset: -3px; }
    .psl-row__line { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .psl-row__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 700; }
    .psl-row__pill { flex: none; }
    .psl-row__price { flex: none; white-space: nowrap; margin-left: auto; font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .psl-row__price small { margin-left: 5px; color: var(--muted); font-size: 11px; font-weight: 650; }
    .psl-row__sub { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 12px; }
    .psl-fold { justify-self: start; padding: 2px 4px; border: 0; background: none; color: var(--muted); font: inherit; font-size: 12.5px; font-weight: 650; cursor: pointer; }
    .psl-add {
      justify-self: start; min-height: 38px; padding: 7px 14px; border: 1px dashed var(--line-strong); border-radius: 999px;
      background: transparent; color: var(--rose-dark, var(--rose)); font: inherit; font-size: 13px; font-weight: 700; cursor: pointer;
    }
    .psl-add:hover:not(:disabled) { border-color: var(--rose); background: var(--rose-soft); }
    .psl-add:disabled { opacity: .45; cursor: not-allowed; }
    .psl--phone .psl-rows { border: 0; border-radius: 16px; }
    .psl--phone .psl-rows > li + li { border-top: .5px solid var(--ios-sep, var(--line)); }
    .psl--phone .psl-row { min-height: 60px; padding: 10px 16px; }
    .psl--phone .psl-row__name, .psl--phone .psl-row__price { font-size: 15px; }
    .psl--phone .psl-row__sub { font-size: 12.5px; }
    .psl--phone .psl-add { justify-self: stretch; min-height: 44px; }
  `,
})
export class ProductSupplierList {
  readonly productId = input.required<number>();
  readonly rows = input<ProductSupplierRow[]>([]);
  readonly suppliers = input<Supplier[]>([]);
  readonly unitSingular = input('stuk');
  readonly disabled = input(false);
  readonly desktop = input(true);
  readonly changed = output<ProductSupplierChange>();
  /** A write hit a newer row (409): the host loads the rows again. */
  readonly reload = output<void>();

  readonly showInactive = signal(false);
  readonly sheet = signal<{ row: ProductSupplierRow | null } | null>(null);

  readonly sorted = computed(() => sortSupplierRows(this.rows()));
  readonly active = computed(() => this.sorted().filter((row) => row.active));
  readonly inactive = computed(() => this.sorted().filter((row) => !row.active));
  readonly taken = computed(() => this.rows().map((row) => row.supplierId));

  add(): void {
    if (!this.disabled()) this.sheet.set({ row: null });
  }

  edit(row: ProductSupplierRow): void {
    if (!this.disabled()) this.sheet.set({ row });
  }

  /** "US$ 2,35 + 0,10": the row's own currency; "—" without a price. */
  price(row: ProductSupplierRow): string {
    if (row.exwPrice == null) return '—';
    const currency = row.exwCurrency ?? row.supplierCurrency ?? 'USD';
    const amount = new Intl.NumberFormat('nl-BE', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 3 })
      .format(row.exwPrice);
    return row.extraUnitCost != null && row.extraUnitCost > 0 ? `${amount} + ${AMOUNT.format(row.extraUnitCost)}` : amount;
  }

  /** Line 2: Versie · ref · MOQ · days, then the last container and cost. */
  sub(row: ProductSupplierRow): string {
    return [supplierRowMeta(row), supplierRowHistory(row, (n) => EUR.format(n))].filter(Boolean).join(' · ');
  }
}
