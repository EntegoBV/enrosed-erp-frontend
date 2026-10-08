import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type {
  ClosingArticleLocation, ClosingLocation, ClosingMovement, ClosingView, DecisionWrite,
} from '../../core/api/inventory-models';
import { DateNlPipe, DateTimeNlPipe } from '../../shared/pipes';
import { ClosingDecisionSheet, DecisionSheetResult, DecisionSheetSpec, followAnchor } from './closing-decision-sheet';
import { decisionWriteMovement, laterRowsIntro, rollLine } from './inventory-closing';
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
}

/**
 * Step 2 of the closing, "Bewegingen rond de afsluitdatum": per location the
 * ledger rows between the closing date and the count, each with the one
 * question "Meerekenen", and the figure that follows per product. Changing a
 * tick asks why and emits a MOVEMENT decision; "Terug naar voorstel" removes
 * it. Rows booked after both moments sit in their own fold, because the
 * question there is another one.
 */
@Component({
  selector: 'app-closing-step-date',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, DateNlPipe, DateTimeNlPipe, ClosingDecisionSheet],
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
              <p class="inv-step__text">
                @if (block.location.countAfterClosingDate) {
                  De telling was op {{ block.location.anchoredAt | dateNl }}. Deze bewegingen zijn geboekt tussen de afsluitdatum en de telling. Vink uit wat op {{ view().closingDate | dateNl }} al gebeurd was.
                } @else {
                  De telling was op {{ block.location.anchoredAt | dateNl }}, vóór de afsluitdatum. Vink aan wat vóór {{ view().closingDate | dateNl }} nog gebeurde.
                }
              </p>
            }
            <ng-container [ngTemplateOutlet]="table" [ngTemplateOutletContext]="{ $implicit: block.between, result: true }" />
          } @else if (block.location.anchor === 'TELLING') {
            <p class="inv-step__text">Geen bewegingen tussen de afsluitdatum en de telling. De getelde aantallen zijn de eindvoorraad.</p>
          }
          @if (block.laterCount) {
            <details class="inv-fold">
              <summary>Later geboekt ({{ block.laterCount }})</summary>
              <p class="inv-step__text">{{ laterIntro(block.location) }}</p>
              <ng-container [ngTemplateOutlet]="table" [ngTemplateOutletContext]="{ $implicit: block.later, result: false, known: block.between }" />
            </details>
          }
        </div>
      </article>
    } @empty {
      <p class="inv-step__empty">Geen bewegingen tussen de afsluitdatum en de telling. De getelde aantallen zijn de eindvoorraad.</p>
    }
    <p class="inv-step__hint">Bewegingen kunnen in de voorraadgeschiedenis van het product nog verwijderd worden tot de afsluiting definitief is; bij het definitief maken wordt alles opnieuw gelezen.</p>

    <ng-template #table let-products let-result="result" let-known="known">
      <div class="wk-table inv-scroll inv-roll__table" role="table">
        <div class="wk-thead" role="row">
          <span class="wk-th" role="columnheader">Geboekt op</span>
          <span class="wk-th" role="columnheader">Soort</span>
          <span class="wk-th" role="columnheader">Referentie</span>
          <span class="wk-th" role="columnheader">Door</span>
          <span class="wk-th wk-th--num" role="columnheader">Aantal</span>
          <span class="wk-th" role="columnheader">Meerekenen</span>
          <span class="wk-th" role="columnheader">Voorstel</span>
        </div>
        @for (product of products; track product.productId) {
          <div class="wk-group" role="row"><span class="wk-group__label" role="cell">{{ product.productName }} @if (product.sku) { <span class="wk-group__count">{{ product.sku }}</span> }</span></div>
          @for (row of product.rows; track row.movementId) {
            <div class="wk-tr inv-roll__row" role="row" [class.inv-roll__row--removed]="row.removed" [id]="'inv-movement-' + row.movementId">
              <span class="wk-td" role="cell">{{ row.bookedAt | dateTimeNl }}</span>
              <span class="wk-td" role="cell">{{ row.kindLabel }}</span>
              <span class="wk-td" role="cell">{{ row.reference || '—' }}</span>
              <span class="wk-td" role="cell">{{ row.actor || '—' }}</span>
              <span class="wk-td wk-td--num" role="cell">{{ row.effectiveDelta === 0 ? 'geen voorraadwijziging' : signed(row.effectiveDelta) }}</span>
              <span class="wk-td inv-roll__tick" role="cell">
                @if (!row.removed) {
                  <label class="inv-check">
                    <input type="checkbox" [checked]="row.applied" [disabled]="!editable() || busy()" (change)="toggle(row, $event)" />
                    <span>Meerekenen</span>
                  </label>
                }
              </span>
              <span class="wk-td wk-td--wrap inv-roll__note" role="cell">
                @if (row.removed) {
                  <span class="inv-roll__gone">Verwijderd uit de voorraadgeschiedenis</span>
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
      for (const row of view.movements) {
        if (row.locationId !== location.locationId) continue;
        const place = places.get(`${location.locationId}:${row.productId}`) ?? null;
        const isLater = bookedLater(row, place?.anchoredAt ?? location.anchoredAt, cutoff);
        if (isLater) laterCount += 1;
        const target = isLater ? later : between;
        let product = target.get(row.productId);
        if (!product) {
          product = { productId: row.productId, productName: row.productName, sku: row.sku, place, rows: [] };
          target.set(row.productId, product);
        }
        product.rows.push(row);
      }
      return { location, between: sorted(between), later: sorted(later), laterCount };
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
    this.asking.set({ row, spec: {
      title: 'Waarom?',
      lead: [`${row.productName} · ${row.kindLabel} ${signedQuantity(row.effectiveDelta)}${row.reference ? ` · ${row.reference}` : ''}`,
        wanted ? 'Je rekent deze beweging mee.' : 'Je rekent deze beweging niet mee.'],
      reason: { label: 'Waarom?', value: '', required: true },
      saveLabel: 'Bewaren',
    } });
  }

  confirm(row: ClosingMovement, result: DecisionSheetResult): void {
    this.decision.emit(decisionWriteMovement(row.movementId, !row.applied, result.reason));
  }
}

/**
 * Whether a row belongs to the 31 days after the later of the two moments
 * (4.7): after the count when the count came after the closing date, from
 * the cut-off on when it came before. Without an anchor every row is
 * between.
 */
function bookedLater(row: ClosingMovement, anchoredAt: string | null, cutoff: number): boolean {
  const anchor = anchoredAt ? Date.parse(anchoredAt) : NaN;
  const at = Date.parse(row.bookedAt);
  if (isNaN(anchor) || isNaN(at) || isNaN(cutoff)) return false;
  return anchor >= cutoff ? at > anchor : at >= cutoff;
}

function sorted(products: Map<number, ProductRows>): ProductRows[] {
  const list = [...products.values()].sort((a, b) => a.productName.localeCompare(b.productName, 'nl'));
  for (const product of list) product.rows.sort((a, b) => a.bookedAt.localeCompare(b.bookedAt) || a.movementId - b.movementId);
  return list;
}
