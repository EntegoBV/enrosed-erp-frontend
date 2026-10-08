import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type {
  ClosingArticleLocation, ClosingLocation, ClosingMovement, ClosingView, DecisionWrite,
} from '../../core/api/inventory-models';
import { BrusselsDateTimePipe } from './inventory-dates';
import { ClosingDecisionSheet, DecisionSheetResult, DecisionSheetSpec, followAnchor } from './closing-decision-sheet';
import {
  bookedLater, byName, dateText, decisionWriteMovement, laterRowsIntro, needsLook, rollEffect, rollIntro, rollLine, rollTickHead, rollTickLabel,
} from './inventory-closing';
import { InventoryScrollCue } from './inventory-scroll-cue';
import { signedQuantity } from './stock-count-booking-sheet';

/** The listed rows of one product at one location, with that product's own anchor. */
interface ProductRows {
  productId: number;
  productName: string;
  sku: string | null;
  place: ClosingArticleLocation | null;
  rows: ClosingMovement[];
}

interface LocationBlock {
  location: ClosingLocation;
  /** Rows booked between the closing date and the count. */
  between: ProductRows[];
  /** Rows of the 31 days after the later of the two moments. */
  later: ProductRows[];
  laterCount: number;
  /** A row in the fold needs a look (removed since the last calculation, or to review): the fold starts open. */
  laterOpen: boolean;
}

/**
 * Step 2 of the closing, "Bewegingen rond de afsluitdatum": per location the
 * ledger rows between the closing date and the count, each with one tick,
 * and the figure that follows per product. A tick means the same wherever it
 * stands: the movement really happened between the closing date and the
 * count, so the counted figure is corrected for it ("Terugtellen" after a
 * late count, "Bijtellen" after an early one), and the row shows what that
 * does to the closing quantity. Changing a tick asks why and emits a
 * MOVEMENT decision; "Terug naar voorstel" removes it. Rows booked after
 * both moments sit in their own fold, where the proposal is no tick.
 */
@Component({
  selector: 'app-closing-step-date',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, BrusselsDateTimePipe, ClosingDecisionSheet, InventoryScrollCue],
  host: { class: 'inv-step' },
  template: `
    @for (block of blocks(); track block.location.locationId) {
      <article class="wk-card inv-roll" [id]="'inv-roll-' + block.location.locationId">
        <div class="wk-card__head"><h3 class="wk-card__title">{{ block.location.locationName }}</h3></div>
        <div class="wk-card__body">
          @if (block.location.anchor !== 'TELLING') {
            <p class="inv-step__text">Nog niet geteld: dit concept rekent met de stand volgens het systeem.</p>
          }
          @if (block.between.length) {
            @if (block.location.anchor === 'TELLING' && block.location.anchoredAt) {
              <p class="inv-step__text">{{ intro(block.location) }}</p>
            }
            <ng-container [ngTemplateOutlet]="table" [ngTemplateOutletContext]="{ $implicit: block.between, result: true, after: block.location.countAfterClosingDate }" />
          } @else if (block.location.anchor === 'TELLING') {
            <p class="inv-step__text">Geen bewegingen tussen de afsluitdatum en de telling. De getelde aantallen zijn de eindvoorraad.</p>
          }
          @if (block.laterCount) {
            <details class="inv-fold" [open]="block.laterOpen">
              <summary>Later geboekt ({{ block.laterCount }})</summary>
              <p class="inv-step__text">{{ laterIntro(block.location) }}</p>
              <ng-container [ngTemplateOutlet]="table" [ngTemplateOutletContext]="{ $implicit: block.later, result: false, known: block.between, after: block.location.countAfterClosingDate }" />
            </details>
          }
        </div>
      </article>
    } @empty {
      <p class="inv-step__empty">Geen bewegingen tussen de afsluitdatum en de telling. De getelde aantallen zijn de eindvoorraad.</p>
    }
    <p class="inv-step__hint">Bewegingen kunnen in de voorraadgeschiedenis van het product nog verwijderd worden tot de afsluiting definitief is; bij het definitief maken wordt alles opnieuw gelezen.</p>

    <ng-template #table let-products let-result="result" let-known="known" let-after="after">
      <div class="wk-table inv-scroll inv-roll__table" role="table">
        <div class="wk-thead" role="row">
          <span class="wk-th" role="columnheader">Geboekt op</span>
          <span class="wk-th" role="columnheader">Soort</span>
          <span class="wk-th" role="columnheader">Referentie</span>
          <span class="wk-th" role="columnheader">Door</span>
          <span class="wk-th wk-th--num" role="columnheader">Aantal</span>
          <span class="wk-th" role="columnheader">{{ tickHead(after) }}</span>
          <span class="wk-th" role="columnheader">Voorstel</span>
        </div>
        @for (product of products; track product.productId) {
          <div class="wk-group" role="row"><span class="wk-group__label" role="cell">{{ product.productName }} @if (product.sku) { <span class="wk-group__count">{{ product.sku }}</span> }</span></div>
          @let late = product.place?.countAfterClosingDate ?? after;
          @for (row of product.rows; track row.movementId) {
            <div class="wk-tr inv-roll__row" role="row" [class.inv-roll__row--removed]="row.removed" [id]="'inv-movement-' + row.movementId">
              <span class="wk-td" role="cell">{{ row.bookedAt | brusselsDateTime }}</span>
              <span class="wk-td" role="cell">{{ row.kindLabel }}</span>
              <span class="wk-td" role="cell">{{ row.reference || '—' }}</span>
              <span class="wk-td" role="cell">{{ row.actor || '—' }}</span>
              <span class="wk-td wk-td--num" role="cell">{{ row.effectiveDelta === 0 ? 'geen voorraadwijziging' : signed(row.effectiveDelta) }}</span>
              <span class="wk-td inv-roll__tick" role="cell">
                @if (!row.removed) {
                  <label class="inv-check">
                    <input type="checkbox" [checked]="row.applied" [disabled]="!editable() || busy()" (change)="toggle(row, $event)" />
                    <span>{{ tickLabel(late) }}</span>
                  </label>
                  @if (effect(row, late); as text) { <span class="inv-roll__effect">{{ text }}</span> }
                }
              </span>
              <span class="wk-td wk-td--wrap inv-roll__note" role="cell">
                @if (row.removed) {
                  <span class="inv-roll__gone">Verwijderd uit de voorraadgeschiedenis; telt niet meer mee</span>
                } @else {
                  @if (row.review && row.decisionId === null) { <span class="wk-pill tone-warn">Nakijken</span> }
                  @if (row.defaultNote) { <span>{{ row.defaultNote }}</span> }
                  @if (row.noAnchor) { <span>Geen eerdere boeking gevonden; kijk dit aantal na</span> }
                  @if (row.decisionId !== null) {
                    <span class="inv-roll__changed">Aangepast@if (row.appliedReason) {: {{ row.appliedReason }} }</span>
                    @if (editable()) { <button class="wk-link" type="button" [disabled]="busy()" (click)="removeDecision.emit(row.decisionId)">Terug naar voorstel</button> }
                  }
                }
              </span>
            </div>
          }
          @if (product.place && (result || !listed(known, product.productId))) {
            <div class="wk-tr wk-tr--sub inv-roll__result" role="row"><span class="wk-td wk-td--wrap inv-span" role="cell">{{ roll(product.place) }}</span></div>
          }
        }
      </div>
    </ng-template>

    @if (asking(); as ask) {
      <app-closing-decision-sheet [spec]="ask.spec" [busy]="busy()" (save)="confirm(ask.row, $event)" (closed)="asking.set(null)" />
    }
  `,
})
export class ClosingStepDate {
  readonly view = input.required<ClosingView>();
  readonly busy = input(false);
  readonly decision = output<DecisionWrite>();
  readonly removeDecision = output<number>();

  /** The tick that waits for its reason. */
  readonly asking = signal<{ row: ClosingMovement; spec: DecisionSheetSpec } | null>(null);

  readonly editable = computed(() => this.view().status === 'CONCEPT');

  readonly blocks = computed<LocationBlock[]>(() => {
    const view = this.view();
    const cutoff = Date.parse(view.cutoffAt);
    const places = new Map<string, ClosingArticleLocation>();
    for (const article of view.articles) {
      for (const place of article.locations) places.set(`${place.locationId}:${article.productId}`, place);
    }
    return view.locations.filter((location) => location.anchor !== 'GEEN').map((location) => {
      const between = new Map<number, ProductRows>();
      const later = new Map<number, ProductRows>();
      let laterCount = 0;
      let laterOpen = false;
      for (const row of view.movements) {
        if (row.locationId !== location.locationId) continue;
        const place = places.get(`${location.locationId}:${row.productId}`) ?? null;
        const isLater = bookedLater(row.bookedAt, place?.anchoredAt ?? location.anchoredAt, cutoff);
        if (isLater) {
          laterCount += 1;
          if (needsLook(row)) laterOpen = true;
        }
        const target = isLater ? later : between;
        let product = target.get(row.productId);
        if (!product) {
          product = { productId: row.productId, productName: row.productName, sku: row.sku, place, rows: [] };
          target.set(row.productId, product);
        }
        product.rows.push(row);
      }
      return { location, between: sorted(between), later: sorted(later), laterCount, laterOpen };
    });
  });

  constructor() {
    followAnchor();
    /* A new view is the answer to a save: the question is settled. */
    effect(() => {
      this.view();
      this.asking.set(null);
    });
  }

  signed(value: number): string {
    return signedQuantity(value);
  }

  roll(place: ClosingArticleLocation): string {
    return rollLine(place, this.view().closingDate);
  }

  intro(location: ClosingLocation): string {
    return rollIntro(location.countAfterClosingDate, this.view().closingDate, location.anchoredAt ?? this.view().cutoffAt);
  }

  tickHead(countAfterClosingDate: boolean): string {
    return rollTickHead(countAfterClosingDate, this.view().closingDate);
  }

  tickLabel(countAfterClosingDate: boolean): string {
    return rollTickLabel(countAfterClosingDate);
  }

  /** What the row does to the closing quantity while it is ticked: "+40 terug". */
  effect(row: ClosingMovement, countAfterClosingDate: boolean): string {
    return rollEffect(row.effectiveDelta, row.applied, countAfterClosingDate);
  }

  laterIntro(location: ClosingLocation): string {
    return laterRowsIntro(location.countAfterClosingDate, this.view().closingDate, location.anchoredAt ?? this.view().cutoffAt);
  }

  listed(products: ProductRows[] | undefined, productId: number): boolean {
    return !!products?.some((product) => product.productId === productId);
  }

  /** The box follows the saved row, not the click: it only moves when the decision is stored. */
  toggle(row: ClosingMovement, event: Event): void {
    const box = event.target as HTMLInputElement;
    const wanted = box.checked;
    box.checked = row.applied;
    if (!this.editable() || this.busy() || wanted === row.applied) return;
    /* Back on the proposal: the decision goes, no reason needed. */
    if (row.decisionId !== null && wanted === row.defaultApplied) {
      this.removeDecision.emit(row.decisionId);
      return;
    }
    const late = this.blocks().flatMap((block) => [...block.between, ...block.later])
      .find((product) => product.rows.includes(row))?.place?.countAfterClosingDate
      ?? this.view().locations.find((location) => location.locationId === row.locationId)?.countAfterClosingDate ?? true;
    const date = dateText(this.view().closingDate);
    const says = late
      ? (wanted ? `Je zegt: dit gebeurde na ${date}. Het wordt teruggeteld (${rollEffect(row.effectiveDelta, true, true) || 'geen voorraadwijziging'}).`
        : `Je zegt: dit was op ${date} al gebeurd. Het wordt niet teruggeteld.`)
      : (wanted ? `Je zegt: dit gebeurde nog tot en met ${date}. Het wordt bijgeteld (${rollEffect(row.effectiveDelta, true, false) || 'geen voorraadwijziging'}).`
        : `Je zegt: dit gebeurde pas na ${date}. Het wordt niet bijgeteld.`);
    this.asking.set({ row, spec: {
      title: 'Waarom?',
      lead: [`${row.productName} · ${row.kindLabel} ${signedQuantity(row.effectiveDelta)}${row.reference ? ` · ${row.reference}` : ''}`, says],
      reason: { label: 'Waarom?', value: '', required: true },
      saveLabel: 'Bewaren',
    } });
  }

  confirm(row: ClosingMovement, result: DecisionSheetResult): void {
    this.decision.emit(decisionWriteMovement(row.movementId, !row.applied, result.reason));
  }
}

function sorted(products: Map<number, ProductRows>): ProductRows[] {
  const list = [...products.values()].sort((a, b) => byName(a.productName, b.productName));
  for (const product of list) product.rows.sort((a, b) => a.bookedAt.localeCompare(b.bookedAt) || a.movementId - b.movementId);
  return list;
}
