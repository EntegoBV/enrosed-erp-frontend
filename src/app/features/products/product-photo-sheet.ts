import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, input, model, output, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { AuthImage } from '../../core/api/auth-image';
import {
  CatalogChannel,
  OtherPhoto,
  ProductPhotoOverview,
  ProductPhotoOverviewPhoto,
  ProductPhotoRoleKey,
} from '../../core/api/models';
import { formatBytes } from '../../shared/format-bytes';
import { Icon } from '../../shared/icon';
import { PhotoRenditionControls } from '../../shared/photo-rendition-controls';
import { SegmentOption, Segmented } from '../../shared/segmented';
import { Sheet } from '../../shared/ui';
import {
  PlacePhoto,
  ResolvedPlaces,
  SheetRow,
  cleanupScope,
  deleteTexts,
  photoFileLine,
  seenSentence,
  selectedChannels,
  sheetRows,
  sheetStage,
  switchLock,
  tileFoot,
  tileUses,
  toggledChannels,
} from './product-photos-state';

export interface ProductPhotoRoleRequest {
  role: ProductPhotoRoleKey;
  photoKey: string | null;
}

export interface ProductPhotoChannelsRequest {
  photo: ProductPhotoOverviewPhoto;
  channels: CatalogChannel[];
}

export interface ProductPhotoScopeRequest {
  photo: ProductPhotoOverviewPhoto;
  variantProductId: number | null;
}

export interface ProductPhotoPromoteRequest {
  photo: ProductPhotoOverviewPhoto;
  scope: 'THIS_VARIANT' | 'ALL_VARIANTS';
  cleanup: boolean;
}

const EXTRA_SWITCHES: ReadonlyArray<{ channel: CatalogChannel; label: string; help: string }> = [
  { channel: 'WEBSITE', label: 'In de fotogalerij op de website', help: 'Op de productpagina van deze reeks, tussen de andere foto’s.' },
  { channel: 'CATALOGUE', label: 'Mag in de catalogus', help: 'Een pdf met meer foto’s per reeks kan hem dan gebruiken.' },
  { channel: 'ORDER_APP', label: 'Bestelapp', help: 'Nog niet in gebruik: er is geen app die deze instelling leest. Aan of uit verandert voor klanten niets. De bestelpagina op de website volgt Website.' },
];

/**
 * One photo and everything about it (ui-spec 4.8): the photo, next to what
 * customers see now when that says something, where it is used for this
 * colour and for the series, and under "Meer instellingen" its colours, extra
 * switches, file and removal. Every choice goes up at once; the panel saves
 * it and hands a fresh overview back, so this sheet never guesses. The rules
 * of the rows live in product-photos-state (sheetRows, sheetStage).
 */
@Component({
  selector: 'app-product-photo-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, Icon, NgTemplateOutlet, PhotoRenditionControls, Segmented, Sheet],
  template: `
    @if (photo(); as photo) {
      <app-sheet [title]="title()" [wide]="true" (closed)="closed.emit()">
        <div body #root class="ps" [class.ps--fit]="!seriesOpen() && !moreOpen()" [attr.aria-busy]="busy()" (click)="rememberControl($event)">
          <div class="ps-stage" (keydown)="stageKeydown($event)">
            <div class="ps-view" [class.ps-view--pair]="stage() === 'pair'" role="group" aria-roledescription="foto" tabindex="0" [attr.aria-label]="title()"
                 (pointerdown)="startSwipe($event)" (pointerup)="finishSwipe($event)" (pointercancel)="swipe = null">
              @if (stage() === 'pair' && reference(); as now) {
                <figure class="ps-fig">
                  <figcaption><b>Dit zien klanten nu</b><small>Website en catalogus</small></figcaption>
                  <span class="ps-fig__img"><img [appAuthSrc]="now.mediumUrl || now.largeUrl" appAuthSize="medium" appAuthKeepSize draggable="false" alt="De foto die klanten nu zien" /></span>
                </figure>
              }
              <figure class="ps-fig ps-fig--this">
                @if (stage() === 'pair') { <figcaption><b>Deze foto</b><small>{{ words() }}</small></figcaption> }
                <span class="ps-fig__img"><img [appAuthSrc]="photo.mediumUrl || photo.largeUrl" appAuthSize="medium" appAuthKeepSize draggable="false" [alt]="alt()" /></span>
              </figure>
            </div>
            <div class="ps-nav">
              @if (photos().length > 1) {
                <button class="ps-step" type="button" aria-label="Vorige foto" (click)="step(-1)"><app-icon name="chevron-left" [size]="20" /></button>
              }
              <ul #stripList class="ps-strip" aria-label="Andere foto bekijken">
                @for (item of strip(); track item.key) {
                  <li><button type="button" [attr.aria-current]="item.key === photo.key ? 'true' : null" [attr.aria-label]="item.label" (click)="key.set(item.key)">
                    <img [appAuthSrc]="item.url" appAuthLazy alt="" draggable="false" />
                    @if (item.used) { <i aria-hidden="true"><app-icon name="tick" [size]="9" /></i> }
                  </button></li>
                }
              </ul>
              @if (photos().length > 1) {
                <button class="ps-step" type="button" aria-label="Volgende foto" (click)="step(1)"><app-icon name="chevron-right" [size]="20" /></button>
              }
            </div>
          </div>

          <div class="ps-side">
            <div>
              <h3>Gebruik deze foto voor</h3>
              <p class="ps-seen"><app-icon name="eye" [size]="16" /><span>{{ seen() }}</span></p>
            </div>
            <ul class="ps-rows" [attr.aria-label]="'Voor ' + colour()">
              @for (row of rows().colour; track row.key) {
                <li class="ps-row" [class.ps-row--thumb]="stage() === 'thumbs' && row.shown" [attr.data-ps]="row.key">
                  <ng-container *ngTemplateOutlet="rowBody; context: { $implicit: row, focus: row.key === focusRow(), thumb: stage() === 'thumbs' }" />
                </li>
              }
            </ul>

            @if (rows().series.length) {
              <details class="ps-fold" [open]="seriesOpen()" (toggle)="seriesOpen.set($any($event.target).open)">
                <summary><b>Voor de hele reeks</b><small>{{ rows().seriesSummary }}</small><app-icon name="chevron-down" [size]="18" /></summary>
                <ul class="ps-rows ps-rows--in" aria-label="Voor de hele reeks">
                  @for (row of rows().series; track row.key) {
                    <li class="ps-row" [attr.data-ps]="row.key"><ng-container *ngTemplateOutlet="rowBody; context: { $implicit: row, focus: false, thumb: false }" /></li>
                  }
                </ul>
              </details>
            }

            <details class="ps-fold" [open]="moreOpen()" (toggle)="moreOpen.set($any($event.target).open)">
              <summary><b>Meer instellingen</b><small>kleuren, extra tonen, bestand, verwijderen</small><app-icon name="chevron-down" [size]="18" /></summary>
              <div class="ps-more">
                @if (photo.kind === 'SERIES') {
                  <section data-ps="scope">
                    <h4>Bij welke kleuren hoort deze foto?</h4>
                    <app-segmented class="ps-seg" variant="ios" semantics="radio" label="Bij welke kleuren hoort deze foto?" [options]="scopeOptions()" [value]="photo.scope"
                                   (changed)="changeScope(photo, $event)" />
                  </section>
                  <section>
                    <h4>Ook tonen als extra foto</h4>
                    @if (!photo.publishable) { <p>Deze foto kan nog niet getoond worden. Controleer bij welke kleur hij hoort.</p> }
                    @for (item of switches(); track item.channel) {
                      <button class="switch-row ps-switch" type="button" role="switch" [class.switch-row--on]="item.on" [attr.data-ps]="item.channel"
                              [attr.aria-checked]="item.on" [attr.aria-disabled]="item.locked ? 'true' : null" [attr.aria-label]="item.label"
                              [attr.aria-describedby]="'ps-help-' + item.channel" [disabled]="busy() || !photo.publishable" (click)="toggle(photo, item.channel, item.locked)">
                        <span class="switch-row__copy"><b>{{ item.label }}</b><small [id]="'ps-help-' + item.channel">{{ item.help }}</small></span>
                        <span class="switch-row__track" aria-hidden="true"><i></i></span>
                      </button>
                    }
                  </section>
                } @else if (photo.duplicateOfKey) {
                  <section data-ps="promote">
                    <h4>Dubbele foto</h4>
                    <p>Dezelfde foto staat twee keer bij {{ colour() }}.</p>
                    <button class="btn btn--sm ps-btn" type="button" [disabled]="busy()"
                            (click)="promoteRequested.emit({ photo, scope: cleanupScope(overview(), photo), cleanup: true })">Dubbele foto opruimen</button>
                  </section>
                } @else {
                  <section data-ps="promote">
                    <h4>Bij welke kleuren hoort deze foto?</h4>
                    <p>Deze foto hoort alleen bij {{ colour() }}. Zet hem bij de reeks om hem ook bij andere kleuren of als extra foto te tonen.</p>
                    <app-segmented class="ps-seg" variant="ios" semantics="radio" label="Bij de reeks zetten voor" [options]="promoteOptions()" [value]="promoteScope()"
                                   (changed)="promoteScope.set($event === 'ALL_VARIANTS' ? 'ALL_VARIANTS' : 'THIS_VARIANT')" />
                    <button class="btn btn--sm ps-btn" type="button" [disabled]="busy()"
                            (click)="promoteRequested.emit({ photo, scope: promoteScope(), cleanup: false })">Bij de reeks zetten</button>
                  </section>
                }
                <section data-ps="file">
                  <h4>Bestand</h4>
                  <p class="ps-file">{{ fileLine() }}</p>
                  @if (moreOpen()) {
                    <details class="ps-formats" [open]="formatsOpen()" (toggle)="formatsOpen.set($any($event.target).open)">
                      <summary>Andere formaten</summary>
                      @if (formatsOpen()) {
                        <app-photo-rendition-controls [endpoint]="renditionsEndpoint(photo)" [filename]="photo.originalFilename" [disabled]="busy()" />
                      }
                    </details>
                  }
                  <button class="btn btn--sm ps-btn ps-phone" type="button" [disabled]="busy()" (click)="downloadRequested.emit(photo)"><app-icon name="download" [size]="16" /> Download origineel</button>
                </section>
                <section data-ps="remove">
                  <h4>Verwijderen</h4>
                  <p>{{ removal().line }}</p>
                  <button class="btn btn--sm btn--danger ps-btn" type="button" [disabled]="busy()" (click)="removeRequested.emit(photo)"><app-icon name="trash" [size]="16" /> Foto verwijderen</button>
                </section>
              </div>
            </details>
          </div>
          <p class="sr-only" role="status" aria-live="polite">{{ title() }}</p>
        </div>
        <div foot class="ps-foot">
          <span class="ps-foot__note">Elke keuze wordt meteen bewaard.</span>
          <button class="btn ps-desk" type="button" [disabled]="busy()" (click)="downloadRequested.emit(photo)"><app-icon name="download" [size]="17" /> Download origineel</button>
          <button class="btn btn--primary" type="button" (click)="closed.emit()">Klaar</button>
        </div>
      </app-sheet>
    }

    <ng-template #rowBody let-row let-focus="focus" let-thumb="thumb">
      @if (thumb && row.shown) { <img class="ps-row__now" [appAuthSrc]="row.shown.smallUrl" alt="De foto die hier nu staat" draggable="false" /> }
      <span class="ps-row__copy" [class.ps-row__copy--wide]="row.state === 'blocked'"><b>{{ row.name }}</b><small>{{ row.sub }}</small></span>
      @switch (row.state) {
        @case ('use') {
          <button class="btn btn--sm ps-use" type="button" [disabled]="busy()" [attr.data-initial-focus]="focus ? '' : null"
                  [attr.aria-label]="row.label" (click)="use(row, true)">Gebruik hier</button>
        }
        @case ('chosen') {
          <span class="ps-row__on"><span><i aria-hidden="true"><app-icon name="tick" [size]="11" /></i>In gebruik</span>
            <button class="ps-link" type="button" [disabled]="busy()" [attr.data-initial-focus]="focus ? '' : null"
                    [attr.aria-label]="row.label" (click)="use(row, false)"><span>Terug naar automatisch</span></button></span>
        }
        @case ('automatic') {
          <span class="ps-row__on"><span><i aria-hidden="true"><app-icon name="tick" [size]="11" /></i>In gebruik</span>
            <button class="ps-link" type="button" [disabled]="busy()" [attr.data-initial-focus]="focus ? '' : null"
                    [attr.aria-label]="row.label" (click)="use(row, true)"><span>Zelf vastzetten</span></button></span>
        }
        @case ('hidden') {
          <span class="ps-row__on ps-row__on--warn"><span>Niet getoond</span>
            <button class="ps-link" type="button" [disabled]="busy()" [attr.data-initial-focus]="focus ? '' : null"
                    [attr.aria-label]="row.label" (click)="use(row, false)"><span>Terug naar automatisch</span></button></span>
        }
        @case ('on') { <span class="ps-row__on"><span><i aria-hidden="true"><app-icon name="tick" [size]="11" /></i>In gebruik</span></span> }
        @case ('plain') { <span class="ps-row__plain">Geen eigen keuze</span> }
        @case ('order') {
          <button class="ps-link ps-link--row" type="button" [disabled]="busy()" [attr.aria-label]="row.label" (click)="reorderRequested.emit()"><span>Volgorde wijzigen</span></button>
        }
      }
    </ng-template>
  `,
  styles: `
    :host { display: contents; }
    .ps { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; min-width: 0; }
    .ps :is(button, summary):focus-visible, .ps-view:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
    .ps-rows, .ps-strip { margin: 0; padding: 0; list-style: none; }
    .ps-fig, .ps h3, .ps h4, .ps p { margin: 0; }
    .ps img { user-select: none; -webkit-user-drag: none; }
    .ps-stage, .ps-side { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; min-width: 0; align-content: start; }
    /* A phone shows the photo, the three rows and both folds on its first screen: the picture takes what is left. */
    .ps-view { --ps-h: clamp(140px, calc(92dvh - 622px), 340px); display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); gap: 8px; border-radius: 14px;
      touch-action: pan-y pinch-zoom; }
    .ps-view--pair { --ps-h: clamp(96px, calc(92dvh - 670px), 260px); grid-template: auto minmax(0, 1fr) / repeat(2, minmax(0, 1fr)); }
    /* Two captions of unequal length keep the two pictures level. */
    .ps-view--pair .ps-fig { display: grid; grid-row: span 2; grid-template-rows: subgrid; row-gap: 0; }
    .ps-fig { display: flex; flex-direction: column; min-width: 0; overflow: hidden; border: 1px solid var(--line-strong); border-radius: 14px; background: #fff; }
    .ps-view--pair .ps-fig--this { border-color: var(--ink); box-shadow: 0 0 0 1px var(--ink); }
    .ps-fig figcaption { display: grid; align-content: start; padding: 6px 10px; border-bottom: 1px solid var(--line); background: var(--surface-2); font-size: 13px; line-height: 1.35; }
    .ps-fig figcaption small { color: var(--ink-2); font-size: 12.5px; }
    .ps-fig__img { position: relative; flex: 1 0 auto; height: var(--ps-h); }
    .ps-fig__img img { position: absolute; inset: 5px; width: calc(100% - 10px); height: calc(100% - 10px); object-fit: contain; }
    .ps-nav { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .ps-step { display: grid; flex: none; place-items: center; width: 44px; height: 44px; padding: 0; border: 1px solid var(--line-strong); border-radius: 50%;
      background: #fff; color: var(--ink); cursor: pointer; }
    .ps-strip { display: flex; flex: 1 1 0; gap: 6px; min-width: 0; padding: 3px; overflow-x: auto; scrollbar-width: thin; }
    .ps-strip button { position: relative; display: block; width: 46px; height: 46px; padding: 2px; border: 1px solid var(--line-strong); border-radius: 10px; background: #fff; cursor: pointer; }
    .ps-strip li { flex: none; }
    .ps-strip img { width: 100%; height: 100%; border-radius: 7px; object-fit: contain; }
    .ps-strip button[aria-current=true] { border-color: var(--ink); box-shadow: 0 0 0 2px var(--ink); }
    .ps-strip i { position: absolute; right: -3px; bottom: -3px; display: grid; place-items: center; width: 16px; height: 16px; border: 2px solid #fff; border-radius: 50%;
      background: var(--rose); color: #fff; }
    .ps-side h3 { font-size: 14px; font-weight: 700; }
    .ps .ps-seen { display: flex; gap: 8px; margin-top: 4px; color: var(--ink-2); font-size: 12.5px; line-height: 1.45; }
    .ps-seen app-icon { flex: none; margin-top: 1px; }
    .ps-rows { overflow: hidden; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
    .ps-rows--in { border-width: 1px 0 0; border-radius: 0 0 13px 13px; }
    .ps-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 4px 10px; min-height: 60px; padding: 8px 8px 8px 12px; }
    .ps-row--thumb { grid-template-columns: 40px minmax(0, 1fr) auto; }
    .ps-row + .ps-row { border-top: 1px solid var(--line); }
    .ps-row__now { width: 40px; height: 40px; border: 1px solid var(--line-strong); border-radius: 8px; background: #fff; object-fit: contain; }
    .ps-row__copy { display: grid; min-width: 0; line-height: 1.3; }
    .ps-row__copy--wide { grid-column: span 2; padding-right: 4px; }
    .ps-row__copy b { font-size: 14px; }
    .ps-row__copy small, .ps-more p { color: var(--ink-2); font-size: 12.5px; line-height: 1.45; }
    .ps-use { min-height: 44px; padding-inline: 16px; border-color: var(--rose-line); background: var(--rose-soft); color: var(--rose-dark); }
    .ps-row__on { display: grid; justify-items: end; padding-right: 6px; color: var(--rose-dark); font-size: 13px; font-weight: 700; white-space: nowrap; }
    .ps-row__plain { padding-right: 8px; color: var(--ink-2); font-size: 12.5px; font-weight: 600; text-align: right; white-space: nowrap; }
    .ps-row__on > span { display: flex; align-items: center; gap: 6px; }
    .ps-row__on--warn { color: #7c450b; }
    .ps-row__on i { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--rose); color: #fff; }
    /* A quiet link under "In gebruik": 44 px to tap, drawn as one line so the row keeps its height. */
    .ps-link { min-height: 44px; margin-block: -11px; padding: 0; border: 0; background: none; color: #6a615b; font: inherit; font-size: 12.5px; font-weight: 600;
      text-decoration: underline; text-underline-offset: 3px; white-space: nowrap; cursor: pointer; }
    .ps-link--row { margin: 0 6px 0 0; }
    .ps-link:disabled { opacity: .55; cursor: wait; }
    .ps .ps-link:focus-visible { outline: 0; }
    .ps-link:focus-visible span { border-radius: 3px; outline: 2px solid var(--ink); outline-offset: 3px; }
    .ps-fold { border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
    /* The sub line stands under the title and wraps: "verwijderen" is never cut off. */
    .ps-fold > summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; column-gap: 8px; min-height: 52px; padding: 6px 12px;
      font-size: 14px; line-height: 1.3; cursor: pointer; list-style: none; }
    .ps-fold > summary::-webkit-details-marker { display: none; }
    .ps-fold > summary small { grid-column: 1; min-width: 0; color: var(--ink-2); font-size: 12.5px; }
    .ps-fold > summary app-icon { grid-column: 2; grid-row: 1 / span 2; }
    .ps-fold[open] > summary app-icon { transform: rotate(180deg); }
    .ps-more { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; padding: 14px 12px; border-top: 1px solid var(--line); }
    .ps-more section { display: grid; grid-template-columns: minmax(0, 1fr); justify-items: start; gap: 8px; }
    .ps-more h4 { font-size: 13px; font-weight: 700; }
    .ps-seg { justify-self: stretch; height: 44px; }
    .ps-switch { justify-self: stretch; min-height: 52px; font: inherit; color: inherit; text-align: left; }
    .ps-switch small { color: var(--ink-2); font-size: 12px; }
    /* One "on" colour in this section: the accent. */
    .ps-switch .switch-row__track { background: #8f867f; }
    .ps-switch.switch-row--on { border-color: var(--rose-line); background: var(--rose-soft); }
    .ps-switch.switch-row--on .switch-row__track { background: var(--rose); }
    .ps-switch:disabled { opacity: .55; cursor: not-allowed; }
    .ps-switch[aria-disabled=true] { cursor: not-allowed; }
    .ps-switch[aria-disabled=true] .switch-row__track { opacity: .55; }
    .ps-btn { min-height: 44px; }
    .ps-file { overflow-wrap: anywhere; }
    .ps-formats { justify-self: stretch; }
    .ps-formats summary { display: inline-flex; align-items: center; min-height: 44px; color: var(--rose-dark); font-size: 13px; font-weight: 650;
      text-decoration: underline; text-underline-offset: 3px; cursor: pointer; list-style: none; }
    .ps-formats summary::-webkit-details-marker { display: none; }
    .ps-foot { display: contents; }
    .ps-foot__note { flex: 1; align-self: center; color: var(--ink-2); font-size: 12.5px; line-height: 1.35; }
    .ps-desk { display: none; }
    @media (max-width: 679.98px) {
      /* Folds closed: the sheet is as high as it gets and the picture takes what the rows leave, so both folds stay on the first screen. */
      .ps--fit { display: flex; flex-direction: column; min-height: calc(92dvh - 186px - var(--safe-b, 0px) - env(safe-area-inset-bottom, 0px)); }
      .ps--fit .ps-stage { flex: 1 1 auto; grid-template-rows: minmax(110px, 1fr) auto; }
      .ps--fit .ps-fig__img { flex: 1 1 0; height: auto; min-height: 60px; }
    }
    @media (min-width: 680px) {
      .ps { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 20px; align-items: start; }
      /* The photo stays in view while the rows and the settings scroll. */
      .ps-stage { position: sticky; top: 0; }
      .ps-view { --ps-h: clamp(220px, calc(88dvh - 356px), 348px); }
      .ps-view--pair { --ps-h: clamp(172px, calc(88dvh - 404px), 300px); }
      .ps-strip button { width: 50px; height: 50px; }
      .ps-btn { min-height: 38px; }
      .ps-desk { display: inline-flex; }
      .ps-phone { display: none; }
    }
  `,
})
export class ProductPhotoSheet {
  /** The list the arrows walk through: the grid the sheet was opened from. */
  readonly photos = input.required<ProductPhotoOverviewPhoto[]>();
  readonly key = model.required<string>();
  readonly overview = input.required<ProductPhotoOverview>();
  readonly colour = input.required<string>();
  readonly productId = input.required<number>();
  readonly busy = input(false);
  /** What every place shows now, as the panel resolved it (also for an older server). */
  readonly places = input<ResolvedPlaces | null>(null);
  /** Other colours' own photos a series place can show; the rows read them through the overview. */
  readonly otherPhotos = input<OtherPhoto[]>([]);
  /** "Dit zien klanten nu": the photo Website and Catalogus both show, or null when they differ or show nothing. */
  readonly reference = input<PlacePhoto | null>(null);

  readonly roleRequested = output<ProductPhotoRoleRequest>();
  readonly channelsRequested = output<ProductPhotoChannelsRequest>();
  readonly scopeRequested = output<ProductPhotoScopeRequest>();
  readonly promoteRequested = output<ProductPhotoPromoteRequest>();
  readonly downloadRequested = output<ProductPhotoOverviewPhoto>();
  readonly removeRequested = output<ProductPhotoOverviewPhoto>();
  /** "Volgorde wijzigen": the panel closes the sheet and opens reorder mode. */
  readonly reorderRequested = output<void>();
  readonly closed = output<void>();

  readonly cleanupScope = cleanupScope;

  readonly index = computed(() => Math.max(0, this.photos().findIndex((photo) => photo.key === this.key())));
  readonly photo = computed(() => this.photos().find((photo) => photo.key === this.key()) ?? null);
  readonly uses = computed(() => tileUses({ key: this.key() }, this.places()));
  readonly title = computed(() => {
    const photo = this.photo();
    const whose = !photo || photo.kind === 'OWN' || photo.scope === 'THIS_VARIANT' ? this.colour()
      : photo.scope === 'ALL_VARIANTS' ? 'alle kleuren' : photo.variantLabel || 'andere kleur';
    return `Foto ${this.index() + 1} van ${this.photos().length} · ${whose}`;
  });
  /** The tile words: caption of "Deze foto". */
  readonly words = computed(() => {
    const photo = this.photo();
    return photo ? tileFoot(photo, this.uses(), this.colour()).words : '';
  });
  readonly alt = computed(() => `Foto ${this.index() + 1} van ${this.photos().length}. ${this.words()}.`);
  readonly seen = computed(() => {
    const photo = this.photo();
    return photo ? seenSentence(photo, this.places()) : '';
  });
  /** pair = next to what customers see now; thumbs = the rows carry what their place shows; single = the photo alone. */
  readonly stage = computed(() => sheetStage({ key: this.key() }, this.places(), this.reference()));
  readonly strip = computed(() => {
    const places = this.places();
    return this.photos().map((photo, index) => {
      const used = tileUses(photo, places).any;
      return { key: photo.key, url: photo.smallUrl, used, label: `Foto ${index + 1}${used ? ', in gebruik' : ''}` };
    });
  });
  readonly rows = computed(() => {
    const photo = this.photo();
    return photo ? sheetRows(this.overview(), photo, this.colour()) : { colour: [], series: [], seriesSummary: '' };
  });
  /** The sheet opens with focus on the first row that has something to tap, not on the picture. */
  readonly focusRow = computed(() => this.rows().colour.find((row) => row.label)?.key ?? null);
  readonly switches = computed(() => {
    const photo = this.photo();
    const on = photo ? selectedChannels(photo) : [];
    return EXTRA_SWITCHES.map((item) => {
      const lock = photo ? switchLock(photo, this.places(), item.channel, this.colour()) : null;
      const plain = lock && !lock.locked && on.includes(item.channel);
      return {
        ...item, on: on.includes(item.channel), locked: lock?.locked === true,
        // The automatic photo of a place keeps the plain help and adds what switching off does.
        help: !lock ? item.help : plain ? `${item.help} ${lock.help}` : lock.help,
      };
    });
  });
  readonly scopeOptions = computed<SegmentOption[]>(() => {
    const photo = this.photo();
    const disabled = this.busy();
    const other = photo?.variantLabel || 'andere kleur';
    return [
      { id: 'THIS_VARIANT', label: `Alleen ${this.colour()}`, ariaLabel: `Alleen ${this.colour()}`, disabled },
      { id: 'ALL_VARIANTS', label: 'Alle kleuren', disabled },
      ...(photo?.scope === 'OTHER_VARIANT' ? [{ id: 'OTHER_VARIANT', label: `Alleen ${other}`, ariaLabel: `Alleen ${other}`, disabled: true }] : []),
    ];
  });
  readonly promoteOptions = computed<SegmentOption[]>(() => [
    { id: 'THIS_VARIANT', label: `Alleen ${this.colour()}`, ariaLabel: `Alleen ${this.colour()}`, disabled: this.busy() },
    { id: 'ALL_VARIANTS', label: 'Alle kleuren', disabled: this.busy() },
  ]);
  readonly fileLine = computed(() => {
    const photo = this.photo();
    return photo ? photoFileLine(photo, formatBytes(photo.sizeBytes)) : '';
  });
  readonly removal = computed(() => {
    const photo = this.photo();
    return photo ? deleteTexts(photo, this.places(), this.colour(), this.productId()) : { line: '', title: '', body: '', confirm: '' };
  });
  readonly promoteScope = signal<'THIS_VARIANT' | 'ALL_VARIANTS'>('THIS_VARIANT');
  /** The folds keep their state while the arrows step through the photos. */
  readonly seriesOpen = signal(false);
  readonly moreOpen = signal(false);
  /** The renditions block fires a request when shown, so it only exists while opened. */
  readonly formatsOpen = signal(false);
  swipe: { id: number; x: number; y: number } | null = null;
  private readonly root = viewChild<ElementRef<HTMLElement>>('root');
  private readonly stripList = viewChild<ElementRef<HTMLElement>>('stripList');
  private lastControl: HTMLElement | null = null;
  /** The row, switch or block the last tap was in: its control can be replaced by the save. */
  private lastBlock: string | null = null;

  constructor() {
    effect(() => {
      this.key();
      this.formatsOpen.set(false);
      this.promoteScope.set('THIS_VARIANT');
    });
    /* The strip is one row that scrolls sideways; the open photo is brought into view without moving the sheet. */
    effect(() => {
      this.key();
      this.photos();
      const strip = this.stripList()?.nativeElement;
      if (strip) requestAnimationFrame(() => showInStrip(strip));
    });
    /* A save disables every control for a moment, which drops keyboard focus.
       Hand it back to the control that started the save, or to what took its
       place ("Gebruik hier" becomes "Terug naar automatisch"). */
    let wasBusy = false;
    effect(() => {
      const busy = this.busy();
      if (wasBusy && !busy) setTimeout(() => requestAnimationFrame(() => this.restoreFocus()));
      wasBusy = busy;
    });
  }

  rememberControl(event: Event): void {
    const target = event.target as HTMLElement;
    this.lastControl = target.closest('button');
    this.lastBlock = target.closest<HTMLElement>('[data-ps]')?.dataset['ps'] ?? null;
  }

  /** `set` true = use or pin this photo; false = back to automatic. */
  use(row: SheetRow, set: boolean): void {
    if (!this.busy() && row.role) this.roleRequested.emit({ role: row.role, photoKey: set ? this.key() : null });
  }

  /** A locked switch stays on: its help line says which choice holds it. */
  toggle(photo: ProductPhotoOverviewPhoto, channel: CatalogChannel, locked: boolean): void {
    if (!locked && !this.busy()) this.channelsRequested.emit({ photo, channels: toggledChannels(photo, channel) });
  }

  changeScope(photo: ProductPhotoOverviewPhoto, scope: string): void {
    if (this.busy() || scope === photo.scope || scope === 'OTHER_VARIANT') return;
    this.scopeRequested.emit({ photo, variantProductId: scope === 'ALL_VARIANTS' ? null : this.productId() });
  }

  step(direction: -1 | 1): void {
    const photos = this.photos();
    if (photos.length < 2) return;
    this.key.set(photos[(this.index() + direction + photos.length) % photos.length].key);
  }

  stageKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      this.step(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }

  startSwipe(event: PointerEvent): void {
    if (!event.isPrimary || (event.target as HTMLElement).closest('button')) { this.swipe = null; return; }
    this.swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  finishSwipe(event: PointerEvent): void {
    const start = this.swipe;
    this.swipe = null;
    if (!start || start.id !== event.pointerId) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 42 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.15) return;
    this.step(deltaX < 0 ? 1 : -1);
  }

  renditionsEndpoint(photo: ProductPhotoOverviewPhoto): string {
    const overview = this.overview();
    return photo.kind === 'OWN'
      ? `/api/products/${this.productId()}/photos/${photo.productPhotoId}/renditions`
      : `/api/product-families/${overview.familyId}/images/${photo.familyPhotoId}/renditions`;
  }

  private restoreFocus(): void {
    const root = this.root()?.nativeElement;
    const active = document.activeElement as HTMLElement | null;
    if (!root) return;
    /* Focus that moved on by itself (a confirmation, the close button) is left alone. Focus on the page behind
       this sheet is not: the panel hands it back to the tile that opened the sheet, which lies under it. */
    const moved = active && active !== document.body && active !== this.lastControl && !(active as HTMLButtonElement).disabled;
    if (moved && active.closest('.sheet')) return;
    const usable = (element: HTMLElement | null | undefined): element is HTMLElement =>
      !!element?.isConnected && !(element as HTMLButtonElement).disabled;
    const block = this.lastBlock ? root.querySelector<HTMLElement>(`[data-ps="${this.lastBlock}"]`) : null;
    const next = usable(this.lastControl) ? this.lastControl
      : block?.matches('button:not([disabled])') ? block
        : block?.querySelector<HTMLElement>('button:not([disabled])')
          ?? root.querySelector<HTMLElement>('.ps-rows button:not([disabled])')
          ?? root.querySelector<HTMLElement>('.ps-view');
    next?.focus();
  }
}

/** Scrolls the strip sideways, and only sideways, until the open photo is in view. */
function showInStrip(strip: HTMLElement): void {
  const open = strip.querySelector<HTMLElement>('[aria-current="true"]');
  if (!open) return;
  const box = strip.getBoundingClientRect();
  const item = open.getBoundingClientRect();
  if (item.left < box.left) strip.scrollLeft -= box.left - item.left + 8;
  else if (item.right > box.right) strip.scrollLeft += item.right - box.right + 8;
}
