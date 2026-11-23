import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import type { Product, SalesOrderView } from '../../core/api/models';
import {
  EMPTY_BUILD, orderPallets3d, palletBuild, palletLabel3d, palletNotice3d,
} from './order-pallets-3d-model';
import { PalletBuilder } from './pallet-builder';
import { plannerLines, plannerSpec } from './shipping-planner-model';

/**
 * A sales order's pallets in 3D, one at a time with the arrows between them:
 * the builder of Palletberekening with the omdozen the order counts on each
 * pallet. They can be turned and moved to look; none comes or goes (the
 * planner changes what stands where), nothing is kept, and "Zoals berekend"
 * lays them back. three.js loads only when it opens (the @defer below).
 */
@Component({
  selector: 'app-order-pallets-3d',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PalletBuilder],
  host: { '(document:keydown)': 'key($event)' },
  template: `
    @defer (on immediate) {
      <app-pallet-builder [items]="build().items" carrier="pallet" [spec]="spec()" [heading]="heading()" [label]="label()"
                          [turnable]="false" [fixed]="true" [initialBoxes]="build().boxes" [buildKey]="buildKey()"
                          [pages]="pages()" [page]="page()" [notice]="notice()" (paged)="chosen.set($event)" (closed)="closed.emit()" />
    } @loading (after 120ms; minimum 300ms) {
      <div class="op3-wait" role="status">3D laden…</div>
    } @error {
      <div class="op3-wait" role="alert">3D kon niet laden. <button class="btn btn--sm" type="button" (click)="closed.emit()">Sluiten</button></div>
    }
  `,
  styles: [`
    :host{display:contents}
    .op3-wait{position:fixed;inset:0;z-index:190;display:grid;place-content:center;gap:12px;justify-items:center;background:var(--surface-2);color:var(--muted);font-size:14px}
  `],
})
export class OrderPallets3d {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly view = input.required<SalesOrderView>();
  /** The catalogue: the omdoos sizes, colours and pieces (the priced order has no omdoos sizes). */
  readonly products = input<readonly Product[]>([]);
  /** The pallet it opens on, from 0. */
  readonly start = input(0);
  readonly closed = output<void>();

  readonly chosen = signal<number | null>(null);

  readonly spec = computed(() => plannerSpec(this.view()));
  private readonly lines = computed(() => plannerLines(this.view(), this.spec()));
  private readonly pallets = computed(() => orderPallets3d(this.view(), this.spec(), this.lines()));
  private readonly productMap = computed(() => new Map(this.products().flatMap((product) =>
    product.id == null ? [] : [[product.id, product] as const])));

  readonly page = computed(() => Math.min(Math.max(0, this.chosen() ?? this.start()), Math.max(0, this.pallets().length - 1)));
  private readonly pallet = computed(() => this.pallets()[this.page()]);
  readonly build = computed(() => {
    const pallet = this.pallet();
    return pallet ? palletBuild(pallet, this.spec(), this.lines(), this.productMap()) : EMPTY_BUILD;
  });
  readonly pages = computed(() => this.pallets().map((pallet) => pallet.label));
  readonly heading = computed(() => this.pallet()?.label ?? 'Pallet');
  readonly label = computed(() => palletLabel3d(this.spec()));
  readonly notice = computed(() => palletNotice3d(this.pallet(), this.build(), this.spec()));
  /** Escape while "3D laden…" or its error shows; once the builder is there, Escape is its own (it first lets go of a box). */
  key(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented || this.host.nativeElement.querySelector('.pb3')) return;
    event.preventDefault();
    this.closed.emit();
  }

  /** Another pallet, or other omdozen on this one (the order changed under the view): the builder starts again from them. */
  readonly buildKey = computed(() => {
    const spec = this.spec();
    return JSON.stringify([this.page(), this.pallet()?.items ?? [], spec.lengthCm, spec.widthCm, spec.baseHeightCm, spec.maxHeightCm]);
  });
}
