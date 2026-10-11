import { ChangeDetectionStrategy, Component, computed, effect, input, model, output, signal } from '@angular/core';
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
  PhotoPickerKind,
  PlacePhoto,
  ResolvedPlaces,
  canUseForRole,
  cleanupScope,
  deleteTexts,
  photoFileLine,
  pickerTarget,
  seenSentence,
  selectedChannels,
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

interface SheetRow {
  kind: PhotoPickerKind;
  role: ProductPhotoRoleKey;
  name: string;
  sub: string;
  /** use = "Gebruik hier"; chosen / automatic = "In gebruik" with its quiet link; blocked = no control, `sub` says why. */
  state: 'use' | 'chosen' | 'automatic' | 'blocked';
}

const ROW_NAME: Readonly<Record<PhotoPickerKind, string>> = {
  website: 'Website', catalogue: 'Catalogus', quote: 'Bestelpagina', detail: 'Grote catalogusfoto', overview: 'Kleine catalogusfoto',
};

const EXTRA_SWITCHES: ReadonlyArray<{ channel: CatalogChannel; label: string; help: string }> = [
  { channel: 'WEBSITE', label: 'In de fotogalerij op de website', help: 'Op de productpagina van deze reeks, tussen de andere foto’s.' },
  { channel: 'CATALOGUE', label: 'Mag in de catalogus', help: 'Een pdf met meer foto’s per reeks kan hem dan gebruiken.' },
  { channel: 'ORDER_APP', label: 'Bestelapp', help: 'Nog niet in gebruik: er is geen app die deze instelling leest. Aan of uit verandert voor klanten niets. De bestelpagina op de website volgt Website.' },
];

/**
 * One photo and everything about it: where it is used for this colour and
 * for the series, and under "Meer instellingen" its colours, extra switches,
 * file and removal. Every choice goes up at once; the panel saves it and
 * hands a fresh overview back, so this sheet never guesses.
 *
 * TODO(photos-round): ui-spec 4.8. This is the shell with the final inputs
 * and outputs. Still to build: the stage pair "Dit zien klanten nu / Deze
 * foto" from `reference()`, the 40 px thumbnails per row when Website and
 * Catalogus differ, the thumbnail strip, the 1280 px rendition on a phone
 * (appAuthKeepSize), "Download origineel" inside "Bestand" on a phone, the
 * row state for an inactive or demo colour, and the acceptance measurements
 * of build-plan C4.
 */
@Component({
  selector: 'app-product-photo-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, Icon, NgTemplateOutlet, PhotoRenditionControls, Segmented, Sheet],
  template: `
    @if (photo(); as photo) {
      <app-sheet [title]="title()" [wide]="true" (closed)="closed.emit()">
        <div body class="ps" [attr.aria-busy]="busy()" (click)="rememberControl($event)">
          <div class="ps-stage" role="group" aria-roledescription="foto" tabindex="0" [attr.aria-label]="title()"
               (keydown)="stageKeydown($event)" (pointerdown)="startSwipe($event)" (pointerup)="finishSwipe($event)" (pointercancel)="swipe = null">
            <img [appAuthSrc]="photo.mediumUrl || photo.largeUrl" appAuthSize="medium" draggable="false" [alt]="words()" />
            @if (photos().length > 1) {
              <button class="ps-step ps-step--prev" type="button" aria-label="Vorige foto" (click)="step(-1)"><app-icon name="chevron-left" [size]="20" /></button>
              <button class="ps-step ps-step--next" type="button" aria-label="Volgende foto" (click)="step(1)"><app-icon name="chevron-right" [size]="20" /></button>
            }
          </div>

          <div class="ps-side">
            <h3>Gebruik deze foto voor</h3>
            <p class="ps-seen"><app-icon name="eye" [size]="16" /><span>{{ seen() }}</span></p>
            <ul class="ps-rows">
              @for (row of colourRows(); track row.kind; let first = $first) {
                <li class="ps-row"><ng-container *ngTemplateOutlet="rowBody; context: { $implicit: row, first }" /></li>
              }
              <li class="ps-row">
                <span class="ps-row__copy"><b>Offertes en facturen</b><small>Zelfde foto als de website</small></span>
                @if (uses().onDocuments) { <span class="ps-row__on"><i aria-hidden="true"><app-icon name="tick" [size]="11" /></i>In gebruik</span> }
                @else { <span class="ps-row__plain">Geen eigen keuze</span> }
              </li>
            </ul>

            <details class="ps-fold">
              <summary><b>Voor de hele reeks</b><small>{{ seriesSummary() }}</small><app-icon name="chevron-down" [size]="18" /></summary>
              <ul class="ps-rows ps-rows--in">
                @for (row of seriesRows(); track row.kind) {
                  <li class="ps-row"><ng-container *ngTemplateOutlet="rowBody; context: { $implicit: row, first: false }" /></li>
                }
                @if (photo.kind === 'SERIES') {
                  <li class="ps-row">
                    <span class="ps-row__copy"><b>Productpagina</b><small>Eerste foto van de reeks</small></span>
                    @if (uses().series.includes('opening')) { <span class="ps-row__on"><i aria-hidden="true"><app-icon name="tick" [size]="11" /></i>In gebruik</span> }
                    @else { <button class="ps-link" type="button" [disabled]="busy()" (click)="reorderRequested.emit()">Volgorde wijzigen</button> }
                  </li>
                }
              </ul>
            </details>

            <details class="ps-fold" [open]="moreOpen()" (toggle)="moreOpen.set($any($event.target).open)">
              <summary><b>Meer instellingen</b><small>kleuren, extra tonen, bestand, verwijderen</small><app-icon name="chevron-down" [size]="18" /></summary>
              <div class="ps-more">
                @if (photo.kind === 'SERIES') {
                  <h4 id="ps-scope">Bij welke kleuren hoort deze foto?</h4>
                  <app-segmented class="ps-seg" variant="ios" label="Bij welke kleuren hoort deze foto?" [options]="scopeOptions()" [value]="photo.scope"
                                 (changed)="changeScope(photo, $event)" />
                  <h4>Ook tonen als extra foto</h4>
                  @let channels = selectedChannels(photo);
                  @for (item of switches(); track item.channel) {
                    <button class="switch-row ps-switch" type="button" role="switch" [class.switch-row--on]="channels.includes(item.channel)"
                            [attr.aria-checked]="channels.includes(item.channel)" [attr.aria-disabled]="item.locked ? 'true' : null"
                            [disabled]="busy() || !photo.publishable" (click)="!item.locked && channelsRequested.emit({ photo, channels: toggledChannels(photo, item.channel) })">
                      <span class="switch-row__copy"><b>{{ item.label }}</b><small>{{ item.help }}</small></span>
                      <span class="switch-row__track" aria-hidden="true"><i></i></span>
                    </button>
                  }
                  @if (!photo.publishable) { <p>Deze foto kan nog niet getoond worden. Controleer bij welke kleur hij hoort.</p> }
                } @else if (photo.duplicateOfKey) {
                  <p>Deze foto staat twee keer bij {{ colour() }}.</p>
                  <button class="btn btn--sm" type="button" [disabled]="busy()"
                          (click)="promoteRequested.emit({ photo, scope: cleanupScope(overview(), photo), cleanup: true })">Dubbele foto opruimen</button>
                } @else {
                  <p>Deze foto hoort alleen bij {{ colour() }}. Zet hem bij de reeks om hem ook bij andere kleuren of als extra foto te tonen.</p>
                  <app-segmented class="ps-seg" variant="ios" label="Bij de reeks zetten voor" [options]="promoteOptions()" [value]="promoteScope()"
                                 (changed)="promoteScope.set($event === 'ALL_VARIANTS' ? 'ALL_VARIANTS' : 'THIS_VARIANT')" />
                  <button class="btn btn--sm" type="button" [disabled]="busy()"
                          (click)="promoteRequested.emit({ photo, scope: promoteScope(), cleanup: false })">Bij de reeks zetten</button>
                }
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
                <h4>Verwijderen</h4>
                <p>{{ removal().line }}</p>
                <button class="btn btn--sm btn--danger" type="button" [disabled]="busy()" (click)="removeRequested.emit(photo)"><app-icon name="trash" [size]="16" /> Foto verwijderen</button>
              </div>
            </details>
          </div>
          <p class="sr-only" role="status" aria-live="polite">{{ title() }}</p>
        </div>
        <div foot class="ps-foot">
          <span class="ps-foot__note">Elke keuze wordt meteen bewaard.</span>
          <button class="btn" type="button" [disabled]="busy()" (click)="downloadRequested.emit(photo)"><app-icon name="download" [size]="17" /> Download origineel</button>
          <button class="btn btn--primary" type="button" (click)="closed.emit()">Klaar</button>
        </div>
      </app-sheet>
    }

    <ng-template #rowBody let-row let-first="first">
      <span class="ps-row__copy"><b>{{ row.name }}</b><small>{{ row.sub }}</small></span>
      @switch (row.state) {
        @case ('use') {
          <button class="btn btn--sm ps-use" type="button" [disabled]="busy()" [attr.data-initial-focus]="first ? '' : null"
                  [attr.aria-label]="row.name + ': niet in gebruik. Gebruik hier.'" (click)="use(row, true)">Gebruik hier</button>
        }
        @case ('chosen') {
          <span class="ps-row__on"><i aria-hidden="true"><app-icon name="tick" [size]="11" /></i>In gebruik
            <button class="ps-link" type="button" [disabled]="busy()" [attr.data-initial-focus]="first ? '' : null"
                    [attr.aria-label]="row.name + ': in gebruik, zelf gekozen. Terug naar automatisch.'" (click)="use(row, false)">Terug naar automatisch</button></span>
        }
        @case ('automatic') {
          <span class="ps-row__on"><i aria-hidden="true"><app-icon name="tick" [size]="11" /></i>In gebruik
            <button class="ps-link" type="button" [disabled]="busy()" [attr.data-initial-focus]="first ? '' : null"
                    [attr.aria-label]="row.name + ': in gebruik, automatisch gekozen. Zelf vastzetten.'" (click)="use(row, true)">Zelf vastzetten</button></span>
        }
      }
    </ng-template>
  `,
  styles: `
    :host { display: contents; }
    .ps { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; min-width: 0; }
    .ps :is(button, summary):focus-visible, .ps-stage:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
    .ps-stage { position: relative; display: grid; place-items: center; height: 240px; padding: 8px; overflow: hidden; border: 1px solid var(--line-strong);
      border-radius: 14px; background: #fff; touch-action: pan-y pinch-zoom; }
    .ps-stage img { max-width: 100%; max-height: 224px; object-fit: contain; user-select: none; -webkit-user-drag: none; }
    .ps-step { position: absolute; top: 50%; display: grid; place-items: center; width: 44px; height: 44px; margin-top: -22px; padding: 0;
      border: 1px solid var(--line-strong); border-radius: 50%; background: #fff; color: var(--ink); box-shadow: var(--sh-1); cursor: pointer; }
    .ps-step--prev { left: 8px; } .ps-step--next { right: 8px; }
    .ps-side { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; min-width: 0; align-content: start; }
    .ps-side h3 { font-size: 14px; font-weight: 700; }
    .ps-seen { display: flex; gap: 8px; color: var(--ink-2); font-size: 12.5px; line-height: 1.45; }
    .ps-seen app-icon { flex: none; margin-top: 1px; }
    .ps-rows { margin: 0; padding: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); list-style: none; }
    .ps-rows--in { border-width: 1px 0 0; border-radius: 0 0 13px 13px; }
    .ps-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 4px 10px; min-height: 58px; padding: 8px 8px 8px 12px; }
    .ps-row + .ps-row { border-top: 1px solid var(--line); }
    .ps-row__copy { display: grid; min-width: 0; line-height: 1.3; }
    .ps-row__copy b { font-size: 14px; }
    .ps-row__copy small, .ps-more p { color: var(--ink-2); font-size: 12.5px; line-height: 1.45; }
    .ps-use { min-height: 44px; padding-inline: 16px; border-color: var(--rose-line); background: var(--rose-soft); color: var(--rose-dark); }
    .ps-row__on { display: grid; grid-template-columns: 18px auto; align-items: center; justify-items: end; gap: 0 6px; padding-right: 6px; color: var(--rose-dark);
      font-size: 13px; font-weight: 700; }
    .ps-row__on i { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--rose); color: #fff; }
    .ps-row__on .ps-link { grid-column: 1 / -1; }
    .ps-row__plain { padding-right: 8px; color: var(--ink-2); font-size: 12.5px; font-weight: 600; text-align: right; }
    .ps-link { min-height: 44px; padding: 0; border: 0; background: none; color: #6a615b; font: inherit; font-size: 12.5px; font-weight: 600;
      text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
    .ps-fold { border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
    .ps-fold > summary { display: flex; align-items: center; gap: 8px; min-height: 52px; padding: 6px 12px; font-size: 14px; white-space: nowrap; cursor: pointer; list-style: none; }
    .ps-fold > summary::-webkit-details-marker { display: none; }
    .ps-fold > summary small { flex: 1 1 0; min-width: 0; overflow: hidden; color: var(--ink-2); font-size: 12.5px; text-overflow: ellipsis; }
    .ps-fold[open] > summary app-icon { transform: rotate(180deg); }
    .ps-more { display: grid; justify-items: start; gap: 8px; padding: 4px 12px 14px; border-top: 1px solid var(--line); }
    .ps-more h4 { margin-top: 10px; font-size: 13px; font-weight: 700; }
    .ps-seg { justify-self: stretch; height: 44px; }
    .ps-switch { justify-self: stretch; min-height: 52px; font: inherit; color: inherit; text-align: left; }
    .ps-switch:disabled { opacity: .55; cursor: not-allowed; }
    .ps-switch[aria-disabled=true] { cursor: not-allowed; }
    .ps-file { overflow-wrap: anywhere; }
    .ps-formats { justify-self: stretch; }
    .ps-formats summary { display: inline-flex; align-items: center; min-height: 44px; color: var(--rose-dark); font-size: 13px; font-weight: 650; cursor: pointer; }
    .ps-foot { display: contents; }
    .ps-foot__note { display: none; }
    @media (min-width: 680px) {
      .ps { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 20px; align-items: start; }
      .ps-stage { height: 420px; }
      .ps-stage img { max-height: 400px; }
      .ps-foot__note { display: block; flex: 1; align-self: center; color: var(--ink-2); font-size: 12.5px; }
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
  /** Other colours' own photos a series place can show. */
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

  readonly selectedChannels = selectedChannels;
  readonly toggledChannels = toggledChannels;
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
  readonly words = computed(() => {
    const photo = this.photo();
    return photo ? tileFoot(photo, this.uses(), this.colour()).words : '';
  });
  readonly seen = computed(() => {
    const photo = this.photo();
    return photo ? seenSentence(photo, this.places()) : '';
  });
  readonly colourRows = computed(() => this.rowsFor(['website', 'catalogue']));
  readonly seriesRows = computed(() => (this.overview().familyId ? this.rowsFor(['quote', 'detail', 'overview']) : []));
  readonly seriesSummary = computed(() => {
    const count = this.uses().series.length;
    return count === 0 ? 'nergens in gebruik' : count === 1 ? 'op 1 plek in gebruik' : `op ${count} plekken in gebruik`;
  });
  readonly switches = computed(() => {
    const photo = this.photo();
    return EXTRA_SWITCHES.map((item) => {
      const lock = photo ? switchLock(photo, this.places(), item.channel, this.colour()) : null;
      return { ...item, help: lock?.help ?? item.help, locked: lock?.locked === true };
    });
  });
  readonly scopeOptions = computed<SegmentOption[]>(() => {
    const photo = this.photo();
    const disabled = this.busy();
    return [
      ...(photo?.scope === 'OTHER_VARIANT' ? [{ id: 'OTHER_VARIANT', label: `Alleen ${photo.variantLabel || 'andere kleur'}`, disabled: true }] : []),
      { id: 'THIS_VARIANT', label: `Alleen ${this.colour()}`, disabled },
      { id: 'ALL_VARIANTS', label: 'Alle kleuren', disabled },
    ];
  });
  readonly promoteOptions = computed<SegmentOption[]>(() => [
    { id: 'THIS_VARIANT', label: `Alleen ${this.colour()}` }, { id: 'ALL_VARIANTS', label: 'Alle kleuren' },
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
  readonly moreOpen = signal(false);
  /** The renditions block fires a request when shown, so it only exists while opened. */
  readonly formatsOpen = signal(false);
  swipe: { id: number; x: number; y: number } | null = null;
  private lastControl: HTMLElement | null = null;

  constructor() {
    effect(() => {
      this.key();
      this.formatsOpen.set(false);
      this.promoteScope.set('THIS_VARIANT');
    });
    /* A save disables every control for a moment, which drops keyboard focus.
       Hand it back to the control that started the save. */
    let wasBusy = false;
    effect(() => {
      const busy = this.busy();
      if (wasBusy && !busy) {
        const target = this.lastControl;
        setTimeout(() => requestAnimationFrame(() => {
          const active = document.activeElement;
          if (target?.isConnected && (!active || active === document.body)) target.focus();
        }));
      }
      wasBusy = busy;
    });
  }

  rememberControl(event: Event): void {
    this.lastControl = (event.target as HTMLElement).closest('button');
  }

  /** `set` true = use or pin this photo; false = back to automatic. */
  use(row: SheetRow, set: boolean): void {
    if (!this.busy()) this.roleRequested.emit({ role: row.role, photoKey: set ? this.key() : null });
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

  private rowsFor(kinds: PhotoPickerKind[]): SheetRow[] {
    const photo = this.photo();
    const places = this.places();
    if (!photo || !places) return [];
    const colour = this.colour();
    const otherColour = photo.kind === 'SERIES' && photo.scope === 'OTHER_VARIANT';
    return kinds.map((kind): SheetRow => {
      const target = pickerTarget(places, kind);
      const perColour = kind === 'website' || kind === 'catalogue';
      const row = { kind, role: target.role, name: ROW_NAME[kind] };
      const shown = target.place.shownKey === photo.key && !(kind === 'catalogue' && places.catalogueColour.reason === 'COLOUR_NOT_ACTIVE');
      if (shown) return { ...row, state: target.chosen ? 'chosen' : 'automatic', sub: target.chosen ? 'Zelf gekozen' : 'Automatisch gekozen' };
      if (perColour && otherColour) return { ...row, state: 'blocked', sub: `Deze foto hoort bij ${photo.variantLabel || 'een andere kleur'}.` };
      if (target.role === 'CATALOGUE_VARIANT' && !target.allowAllColours && photo.kind === 'SERIES' && photo.scope === 'ALL_VARIANTS') {
        return { ...row, state: 'blocked', sub: 'Kan niet: in de Handelscatalogus komt bij een kleur alleen een foto van die kleur zelf.' };
      }
      if (!canUseForRole(photo, target.role)) {
        return {
          ...row, state: 'blocked',
          sub: photo.kind === 'OWN' ? 'Kan niet: deze foto hoort alleen bij dit product.'
            : 'Deze foto kan nog niet getoond worden. Controleer bij welke kleur hij hoort.',
        };
      }
      return {
        ...row, state: 'use',
        sub: kind === 'website' ? `Als een klant ${colour} kiest`
          : kind === 'catalogue' ? (target.allowAllColours ? 'In de pdf-catalogus' : `Bij ${colour} in de pdf-catalogus`)
            : 'Voor alle kleuren',
      };
    });
  }
}
