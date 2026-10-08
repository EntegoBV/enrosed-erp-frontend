import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ClosingLocation, ClosingView, Notice } from '../../core/api/inventory-models';
import { NumPipe } from '../../shared/pipes';
import { BrusselsDatePipe } from './inventory-dates';
import { followAnchor } from './closing-decision-sheet';
import { noticesFor } from './inventory-closing';

/**
 * Step 1 of the closing, "Tellen": per location what the closing stands on
 * (a booked count, the stand volgens systeem, or nothing) with the way to
 * the count. It decides nothing and emits nothing: counting happens on the
 * count screen, reached by plain links.
 */
@Component({
  selector: 'app-closing-step-count',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, BrusselsDatePipe, NumPipe],
  host: { class: 'inv-step' },
  template: `
    @if (view().status === 'CONCEPT') {
      <p class="inv-step__hint">Zonder telling toont dit concept de stand volgens het systeem; definitief maken kan pas na de telling.</p>
    }
    @for (location of view().locations; track location.locationId) {
      <article class="wk-card inv-loc" [id]="'inv-loc-' + location.locationId">
        <div class="wk-card__head">
          <h3 class="wk-card__title">{{ location.locationName }}</h3>
          @if (location.anchor === 'TELLING' && location.countId !== null) {
            <a class="wk-link" [routerLink]="['/stock/inventaris/telling', location.countId]">Bekijk telling</a>
          } @else if (location.anchor === 'BOEKSTAND' && view().status === 'CONCEPT') {
            <a class="wk-link" routerLink="/stock/inventaris" [queryParams]="{ jaar: view().closingYear }">Telling starten</a>
          }
        </div>
        <div class="wk-card__body">
          @switch (location.anchor) {
            @case ('TELLING') {
              <p class="inv-loc__state">
                @if (location.anchoredAt) {
                  Geteld op {{ location.anchoredAt | brusselsDate }}@if (location.countedByName) { door {{ location.countedByName }} }
                } @else { Geteld }
                · {{ location.differenceCount | num }} {{ location.differenceCount === 1 ? 'verschil' : 'verschillen' }}
                @if (location.correctionCount > 0) { · {{ location.correctionCount | num }} {{ location.correctionCount === 1 ? 'correctie' : 'correcties' }} }
              </p>
            }
            @case ('BOEKSTAND') { <p class="inv-loc__state inv-loc__state--open">Stand volgens systeem, niet geteld</p> }
            @default { <p class="inv-loc__state inv-loc__state--none">Geen voorraad</p> }
          }
          @for (notice of noticesOf(location); track $index) {
            <p class="inv-note" [class.inv-note--stop]="notice.severity === 'BLOCKER'">{{ notice.message }}</p>
          }
        </div>
      </article>
    } @empty {
      <p class="inv-step__empty">Er zijn nog geen locaties met voorraad of een telling.</p>
    }
    @for (notice of loose(); track $index) {
      <p class="inv-note" [class.inv-note--stop]="notice.severity === 'BLOCKER'">{{ notice.message }}</p>
    }
  `,
})
export class ClosingStepCount {
  readonly view = input.required<ClosingView>();
  readonly busy = input(false);

  private readonly notices = computed(() => noticesFor(this.view(), 'tellen'));
  /** Notices of this step that belong to no listed location: an unbooked container, a deleted product. */
  readonly loose = computed(() => {
    const listed = new Set(this.view().locations.map((location) => location.locationId));
    return this.notices().filter((notice) => notice.locationId == null || !listed.has(notice.locationId));
  });

  constructor() {
    followAnchor();
  }

  noticesOf(location: ClosingLocation): Notice[] {
    return this.notices().filter((notice) => notice.locationId === location.locationId);
  }
}
