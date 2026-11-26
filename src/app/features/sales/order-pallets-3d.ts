import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import type { Product, SalesOrderView } from '../../core/api/models';
import {
  EMPTY_BUILD, orderLoad3d, orderLoadOn, otherNotice3d, pageForListed, palletLabel3d, palletNotice3d, type OrderLoad3d, type OtherLoad3d,
} from './order-pallets-3d-model';
import { PalletBuilder } from './pallet-builder';
import { CARRIER_WORDS, carrierOf, carrierWords, specSpillCm, type CarrierKind } from './pallet-calculator-model';
import { shippedPallets } from './pallet-stack';
import { plannerLines, plannerSpec, standardSpec } from './shipping-planner-model';

/**
 * A sales order's pallets in 3D, one at a time with the arrows between them:
 * the builder of Palletberekening with the order's omdozen loaded as full as
 * they go, the first pallet before the next (order-pallets-3d-model.ts).
 * They can be turned, laid on their side and moved to look (Emre,
 * 2026-11-25: "je mag kantelen"); none comes or goes (the planner changes
 * what stands where), nothing is kept, and "Zoals berekend" lays them back.
 * three.js loads only when it opens (the @defer below).
 *
 * Pallet | Deense kar at the top of the view (Emre, 2026-11-25: "ook bij 3d
 * weergave kunnen switchen", "alleen bekijken"): it always opens on the
 * order's own carrier; the other one shows all of the order's omdozen loaded
 * on it as full as they go (a kar at 230 cm, a europallet at 260 cm) with
 * "Alleen bekijken · de order telt 3 pallets". Nothing is stored and nothing
 * goes to the order: its count, freight and planner rows stay its own.
 *
 * Spill (2026-11-26): both carriers are loaded with the document's own spill
 * (the other one at its standard height all the same); the subtitle names a
 * spill above 0, and an omdoos within it is no warning.
 */
@Component({
  selector: 'app-order-pallets-3d',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PalletBuilder],
  host: { '(document:keydown)': 'key($event)' },
  template: `
    @defer (on immediate) {
      <app-pallet-builder [items]="build().items" [carrier]="carrier()" [spec]="spec()" [heading]="heading()" [label]="label()"
                          [turnable]="true" [fixed]="true" [initialBoxes]="build().boxes" [buildKey]="buildKey()"
                          [pages]="pages()" [page]="page()" [notice]="notice()" (paged)="chosen.set($event)" (closed)="closed.emit()"
                          [carrierSwitch]="true" (carrierPicked)="pick($event)" />
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

  /** The order's own carrier: a pallet, or the Deense kar. */
  readonly own = computed<CarrierKind>(() => carrierOf(this.view().order.palletProfile));
  /** The other carrier while it is shown (view only); null: the order's own. */
  private readonly shown = signal<CarrierKind | null>(null);
  readonly carrier = computed<CarrierKind>(() => this.shown() ?? this.own());
  /** The other carrier is shown: the order's omdozen on it for a look, not the order's own pallets. */
  readonly other = computed(() => this.carrier() !== this.own());
  /** The own carrier's page while the other one is shown: back on the own carrier, the view opens there again. */
  private ownPage: number | null = null;

  /** The order's own carrier as the server priced it; the lines (colours, problems, counts) are always its own. */
  private readonly ownSpec = computed(() => plannerSpec(this.view()));
  /** The other carrier stands at its standard height with the document's own spill (on a kar across the width only). */
  readonly spec = computed(() => (this.other() ? standardSpec(this.carrier(), specSpillCm(this.ownSpec())) : this.ownSpec()));
  private readonly lines = computed(() => plannerLines(this.view(), this.ownSpec()));
  private readonly productMap = computed(() => new Map(this.products().flatMap((product) =>
    product.id == null ? [] : [[product.id, product] as const])));
  /**
   * Every pallet laid out at once: the first is filled before the next, so one cannot be laid without the ones before it.
   * The other carrier is packed only while it is shown (a large order takes a moment).
   */
  private readonly load = computed<OrderLoad3d | OtherLoad3d>(() => (this.other()
    ? orderLoadOn(this.lines(), this.productMap(), this.spec())
    : orderLoad3d(this.view(), this.ownSpec(), this.lines(), this.productMap())));
  private readonly pallets = computed(() => this.load().pallets);

  /** start counts in the planner's list; loaded again, it opens on the pallet carrying most of that row's omdozen. */
  readonly page = computed(() => Math.min(Math.max(0, this.chosen() ?? pageForListed(this.load(), this.start())),
    Math.max(0, this.pallets().length - 1)));
  private readonly pallet = computed(() => this.pallets()[this.page()]);
  readonly build = computed(() => this.load().builds[this.page()] ?? EMPTY_BUILD);
  readonly pages = computed(() => this.pallets().map((pallet) => pallet.label));
  readonly heading = computed(() => this.pallet()?.label ?? CARRIER_WORDS[this.carrier()].label);
  /** "Europallet 120 × 80 · max 260 cm · zo vol mogelijk": the automatic pallets filled one after the other (the other carrier always). */
  readonly label = computed(() => `${palletLabel3d(this.spec())}${this.load().source === 'packed' ? ' · zo vol mogelijk' : ''}`);
  readonly notice = computed(() => {
    const load = this.load();
    if (this.other() && 'capped' in load) {
      const view = this.view();
      return otherNotice3d(load, CARRIER_WORDS[this.carrier()], carrierWords(view.order.palletProfile), shippedPallets(view.priced.totals));
    }
    return palletNotice3d(this.pallet(), this.build(), this.spec(), load);
  });
  /** Escape while "3D laden…" or its error shows; once the builder is there, Escape is its own (it first lets go of a box). */
  key(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented || this.host.nativeElement.querySelector('.pb3')) return;
    event.preventDefault();
    this.closed.emit();
  }

  /** Pallet or Deense kar, for a look: the other carrier from its first one; back on the own carrier where it was. */
  pick(kind: CarrierKind): void {
    if (kind === this.carrier()) return;
    if (kind === this.own()) {
      this.shown.set(null);
      this.chosen.set(this.ownPage);
      this.ownPage = null;
      return;
    }
    if (!this.other()) this.ownPage = this.chosen();
    this.shown.set(kind);
    this.chosen.set(0);
  }

  /** Another pallet, another carrier, another spill, or other omdozen on this one (the order changed under the view): the builder starts again from them. */
  readonly buildKey = computed(() => {
    const spec = this.spec();
    return JSON.stringify([this.carrier(), this.page(), this.pallet()?.items ?? [], spec.lengthCm, spec.widthCm, spec.baseHeightCm, spec.maxHeightCm,
      spec.spillLengthCm ?? 0, spec.spillWidthCm ?? 0]);
  });
}
