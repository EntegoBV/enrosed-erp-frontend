import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthImage } from '../../core/api/auth-image';
import { Icon } from '../../shared/icon';
import { OTHER_COLOURS_TEXTS, OtherColourRow } from './product-photos-state';

/**
 * "Andere kleuren van deze reeks": what the other colours of the series show
 * on the website and in the catalogue, for looking and jumping only.
 * Presentational: the panel fetches each colour's own overview when this is
 * unfolded and after every save while it is open; nothing here writes.
 */
@Component({
  selector: 'app-product-photo-colours',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, Icon, RouterLink],
  template: `
    <details class="oc" [open]="open()" (toggle)="toggled.emit($any($event.target).open)">
      <summary>
        <span class="oc__dots" aria-hidden="true">@for (row of rows(); track row.productId) { <i class="oc-dot" [style.background]="row.colourHex"></i> }</span>
        <span class="oc__title"><b>{{ texts.title }}</b><small>{{ names() }}</small></span>
        <app-icon class="oc__chev" name="chevron-down" [size]="18" />
      </summary>
      @if (open()) {
        @if (state() === 'ready') {
          <ul class="oc__rows">
            @for (row of rows(); track row.productId) {
              <li class="oc-row" [attr.data-colour]="row.productId">
                <b class="oc-row__name"><i class="oc-dot" [style.background]="row.colourHex" aria-hidden="true"></i><span>{{ row.label }}</span></b>
                @if (row.empty; as empty) {
                  <p class="oc-row__none">{{ empty }}</p>
                } @else {
                  <div class="oc-row__pics">
                    @for (pic of [{ photo: row.website, label: texts.website }, { photo: row.catalogue, label: texts.catalogue }]; track pic.label) {
                      <figure>
                        @if (pic.photo; as photo) { <img [appAuthSrc]="photo.smallUrl" [alt]="pic.label + ': foto van ' + row.name" draggable="false" /> }
                        @else { <span class="oc-row__dash" role="img" [attr.aria-label]="pic.label + ': geen foto'"></span> }
                        <figcaption>{{ pic.label }}</figcaption>
                      </figure>
                    }
                  </div>
                }
                <a class="oc-link" [routerLink]="['/products', row.productId, 'edit']" [queryParams]="{ tab: 'media' }">{{ row.linkLabel }}<app-icon name="chevron-right" [size]="14" /></a>
              </li>
            }
          </ul>
        } @else if (state() === 'failed') {
          <p class="oc__msg" role="alert">{{ texts.failed }} <button class="oc-link" type="button" (click)="retry.emit()">{{ texts.retry }}</button></p>
        } @else {
          <div class="oc__rows" aria-hidden="true">@for (row of rows(); track row.productId) { <div class="skel oc-skel"></div> }</div>
          <p class="sr-only" role="status">{{ texts.loading }}</p>
        }
      }
    </details>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .oc { border: 1px solid var(--line); border-radius: 16px; background: var(--surface-2); }
    .oc :is(summary, a, button):focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
    .oc > summary { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 6px 12px; border-radius: 16px; cursor: pointer; list-style: none; }
    .oc > summary::-webkit-details-marker { display: none; }
    .oc__dots { display: flex; gap: 4px; }
    .oc-dot { display: inline-block; flex: none; width: 12px; height: 12px; border-radius: 50%; background: var(--muted-2); box-shadow: inset 0 0 0 1px rgb(0 0 0 / 12%); }
    .oc__title { display: flex; flex: 1; flex-wrap: wrap; align-items: baseline; gap: 0 10px; min-width: 0; font-size: 14px; line-height: 1.3; }
    /* The names join the title on a laptop only. */
    .oc__title small { display: none; color: var(--ink-2); font-size: 12.5px; overflow-wrap: anywhere; }
    .oc__chev { color: var(--ink-2); }
    .oc[open] .oc__chev { transform: rotate(180deg); }
    .oc__rows { display: grid; gap: 8px; margin: 0; padding: 0 12px 12px; list-style: none; }
    .oc__msg { padding: 0 12px 6px; color: var(--ink-2); font-size: 12.5px; }
    .oc-skel { height: 64px; border-radius: 12px; }
    .oc-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 4px 12px; padding: 10px 12px; border: 1px solid var(--line);
      border-radius: 12px; background: var(--surface); }
    .oc-row__name { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13.5px; overflow-wrap: anywhere; }
    .oc-row__none { grid-column: 1 / -1; grid-row: 2; color: var(--ink-2); font-size: 12.5px; line-height: 1.4; }
    .oc-row__pics { display: flex; grid-column: 1 / -1; grid-row: 2; gap: 12px; }
    .oc-row figure { display: grid; justify-items: center; gap: 2px; margin: 0; color: #6a615b; font-size: 12px; }
    .oc-row :is(img, .oc-row__dash) { width: 52px; height: 52px; border: 1px solid var(--line-strong); border-radius: 10px; background: #fff; object-fit: contain; }
    .oc-row .oc-row__dash { border-style: dashed; background: var(--surface-2); }
    .oc-link { display: inline-flex; align-items: center; gap: 5px; min-height: 44px; padding: 0; border: 0; background: none; color: var(--rose-dark);
      font: inherit; font-size: 12.5px; font-weight: 650; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
    @container pp (min-width: 700px) {
      .oc__title small { display: inline; }
      .oc-row { grid-template-columns: minmax(140px, 1fr) auto auto; }
      .oc-row :is(.oc-row__pics, .oc-row__none) { grid-column: auto; grid-row: auto; }
      .oc-link { font-size: 13px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .oc-skel::after { animation: none; }
    }
  `,
})
export class ProductPhotoColours {
  /** One row per other colour; pictures only once `state` is "ready". */
  readonly rows = input.required<OtherColourRow[]>();
  /** Null and "loading" both draw the skeleton: an older answer is never shown as "nu". */
  readonly state = input<'loading' | 'ready' | 'failed' | null>(null);
  readonly open = input(false);

  readonly toggled = output<boolean>();
  readonly retry = output<void>();

  readonly texts = OTHER_COLOURS_TEXTS;
  readonly names = computed(() => this.rows().map((row) => row.name).join(', '));
}
