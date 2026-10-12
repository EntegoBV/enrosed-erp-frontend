import {
  ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, output, signal, untracked,
} from '@angular/core';
import { AuthImage } from '../../core/api/auth-image';
import { Icon } from '../../shared/icon';
import { SegmentOption, Segmented } from '../../shared/segmented';
import { Sheet } from '../../shared/ui';
import {
  PHOTO_UPLOAD_TYPES, PhotoPickerKind, PickerTexts, PickerTile, PlacePhoto, compareCounter, compareLine,
} from './product-photos-state';

/** One other colour's catalogue photo, for the strip under "Bekijk groot". */
export interface PhotoCompareNeighbour {
  label: string;
  photo: PlacePhoto | null;
}

/** What "Bekijk groot" shows on the right: one of the photos the place does not show now. */
interface PhotoCompareView {
  tile: PickerTile;
  /** "Foto 2 van 4": the tile's number in the grid. */
  name: string;
  /** "1 van 3 andere foto's". */
  counter: string;
  line: string;
  /** There is more than one other photo: previous and next are offered. */
  steps: boolean;
}

/**
 * The one picker for the five choosable places: upload bar, candidates with
 * the photo of now first, the quiet automatic row, and "Bekijk groot", the
 * one compare view with stepping. Presentational: every tap goes up, the
 * panel saves and closes the sheet when the server answered. Activation
 * saves, so the candidates are a plain list of buttons, never a radio group
 * or a listbox: arrow keys only move the focus.
 */
@Component({
  selector: 'app-product-photo-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, Icon, Segmented, Sheet],
  host: {
    '(document:keydown)': 'onKey($event)',
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'onDragLeave($event)',
    '(drop)': 'onDrop($event)',
  },
  template: `
    <app-sheet [title]="texts().title" [wide]="true" (closed)="closed.emit()">
      <div body class="pk" [class.pk--drop]="dropping()" [attr.data-picker]="kind()" [attr.data-view]="compare() ? 'compare' : 'grid'"
           [attr.aria-busy]="busy()">
        <!-- The grid stays in the document under "Bekijk groot": its pictures are not fetched twice. -->
        <div class="pk-list" [hidden]="compare() !== null">
          <div class="pk-top">
            @if (texts().upload; as upload) {
              <label class="pk-upload" [class.pk-upload--off]="busy()">
                <span class="pk-upload__icon" aria-hidden="true"><app-icon name="upload" [size]="20" /></span>
                <span><b>{{ uploading() === 'upload' ? upload.uploading : uploading() === 'save' ? upload.saving : upload.title }}</b><small>{{ upload.sub }}</small></span>
                <input class="pk-file" type="file" [accept]="acceptTypes" [disabled]="busy()"
                       [attr.data-initial-focus]="candidates().length ? null : ''" (change)="pickFile($event)" />
              </label>
            } @else if (texts().noUpload; as line) {
              <p class="pk-note">{{ line }}</p>
            }
            <p class="pk-intro">{{ texts().sentence }}</p>
          </div>

          @if (texts().size; as size) {
            <div class="pk-size"><span>{{ size.label }}</span>
              <app-segmented class="pk-seg" variant="ios" [label]="size.label" [options]="sizeOptions()" [value]="detailSize() ?? 'STANDARD'"
                             (changed)="!busy() && sizeChanged.emit($event === 'LARGE' ? 'LARGE' : 'STANDARD')" />
            </div>
          }

          @if (candidates().length) {
            <ul class="pk-grid" (keydown)="moveFocus($event)">
              @for (tile of candidates(); track tile.photo.key) {
                <li class="pk-tile" [class.pk-tile--on]="tile.current">
                  <button class="pk-tile__pick" type="button" [disabled]="busy()" [attr.aria-current]="tile.current ? 'true' : null"
                          [attr.aria-label]="tile.label" [attr.data-initial-focus]="tile.photo.key === focusKey() ? '' : null"
                          [attr.data-photo-key]="tile.photo.key" (click)="picked.emit(tile.photo.key)">
                    <span class="pk-tile__pic"><img [appAuthSrc]="tile.photo.smallUrl" alt="" draggable="false" appAuthLazy /></span>
                    <span class="pk-tile__label" [class.pk-tile__label--warn]="tile.captionTone === 'warn'">
                      @if (tile.current) { <span class="pk-tick" aria-hidden="true"><app-icon name="tick" [size]="11" /></span> }
                      {{ busyKey() === tile.photo.key ? texts().saving : tile.caption }}
                    </span>
                  </button>
                  @if (tile.compareLabel; as compareLabel) {
                    <button class="pk-tile__zoom" type="button" [disabled]="busy()" [attr.aria-label]="compareLabel"
                            [attr.data-zoom-key]="tile.photo.key" (click)="openCompare(tile.photo.key)">
                      <app-icon name="search" [size]="15" />Bekijk groot
                    </button>
                  }
                </li>
              }
            </ul>
          } @else {
            <p class="pk-note">{{ texts().empty }}</p>
          }

          @if (texts().automatic; as automatic) {
            <div class="pk-auto">
              <p>{{ automatic.text }}</p>
              @if (automatic.link; as link) {
                <button class="pk-link" type="button" [disabled]="busy()" (click)="clear()">{{ clearing() && busy() ? texts().saving : link }}</button>
              }
            </div>
          }
          @if (texts().footnote; as footnote) { <p class="pk-foot">{{ footnote }}</p> }
        </div>

        @if (compare(); as view) {
          <div class="pk-cmp">
            <div class="pk-cmp__pair">
              <figure class="pk-cmp__fig">
                <figcaption>{{ texts().currentLabel }}</figcaption>
                @if (current(); as now) {
                  <div class="pk-cmp__img"><img [appAuthSrc]="now.mediumUrl" appAuthSize="medium" appAuthKeepSize alt="De foto van nu" draggable="false" /></div>
                } @else {
                  <div class="pk-cmp__img"><span class="pk-cmp__none">Nog geen foto</span></div>
                }
              </figure>
              <figure class="pk-cmp__fig pk-cmp__fig--this">
                <figcaption>Deze foto <small aria-live="polite">{{ view.counter }}</small></figcaption>
                <div class="pk-cmp__img">
                  <!-- A new element per photo: the picture of the previous step never stands under the new counter. -->
                  @for (shown of [view.tile.photo]; track shown.key) {
                    <img [appAuthSrc]="shown.mediumUrl" appAuthSize="medium" appAuthKeepSize [alt]="view.name" draggable="false" />
                  }
                  @if (view.steps) {
                    <button class="pk-cmp__nav pk-cmp__nav--prev" type="button" aria-label="Vorige foto" [disabled]="busy()" (click)="step(-1)">
                      <app-icon name="chevron-left" [size]="18" />
                    </button>
                    <button class="pk-cmp__nav pk-cmp__nav--next" type="button" aria-label="Volgende foto" [disabled]="busy()" (click)="step(1)">
                      <app-icon name="chevron-right" [size]="18" />
                    </button>
                  }
                </div>
              </figure>
            </div>
            <p class="pk-cmp__info">{{ view.line }}</p>
            @if (compareNeighbours(); as neighbours) {
              <div class="pk-cmp__next">
                <b>Zo staat hij naast de andere kleuren in de catalogus</b>
                <ul class="pk-cmp__row">
                  <li class="pk-cmp__this">
                    <!-- A new element per photo here too: after a step the previous photo never stands over "Deze foto". -->
                    @for (shown of [view.tile.photo]; track shown.key) { <img [appAuthSrc]="shown.smallUrl" alt="" draggable="false" /> }
                    <span>Deze foto</span>
                  </li>
                  @for (neighbour of neighbours; track $index) {
                    @if (neighbour.photo; as photo) {
                      <li><img [appAuthSrc]="photo.smallUrl" alt="" draggable="false" /><span>{{ neighbour.label }}</span></li>
                    }
                  }
                </ul>
              </div>
            }
          </div>
        }
      </div>
      <ng-container ngProjectAs="[foot]">
        @if (compare(); as view) {
          <button class="btn pk-back" type="button" [disabled]="busy()" (click)="closeCompare()">Terug naar alle foto’s</button>
          <span class="spacer"></span>
          <button class="btn btn--primary pk-use" type="button" [disabled]="busy()" [attr.data-photo-key]="view.tile.photo.key"
                  (click)="picked.emit(view.tile.photo.key)">
            {{ busyKey() === view.tile.photo.key ? texts().saving : 'Gebruik deze foto' }}
          </button>
        }
      </ng-container>
    </app-sheet>
  `,
  styles: `
    :host { display: contents; }
    /* The grid view has no foot (ui-spec 4.7); the shared sheet would draw an empty bar. */
    :host ::ng-deep .sheet__foot:empty { display: none; }
    .pk, .pk-list { display: grid; gap: 14px; min-width: 0; }
    .pk-list[hidden] { display: none; }
    .pk :is(button, label):focus-visible, .pk-upload:focus-within { outline: 2px solid var(--ink); outline-offset: 2px; }
    .pk-top { display: grid; gap: 14px; }
    .pk-upload { position: relative; display: grid; grid-template-columns: 44px minmax(0, 1fr); align-items: center; gap: 12px; min-height: 64px; padding: 9px 14px;
      border: 1.5px dashed var(--rose-mid); border-radius: 14px; background: var(--rose-soft); color: var(--rose-dark); cursor: pointer; }
    .pk-upload--off { opacity: .6; cursor: wait; }
    .pk--drop .pk-upload { border-style: solid; border-color: var(--rose); background: var(--rose-line); }
    .pk-upload__icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; background: var(--rose); color: #fff; }
    .pk-upload b { display: block; font-size: 14.5px; }
    .pk-upload small { display: block; font-size: 12.5px; line-height: 1.35; }
    .pk-file { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; }
    .pk-intro { color: var(--ink-2); font-size: 13.5px; line-height: 1.5; }
    .pk-note, .pk-foot { color: #6a615b; font-size: 12.5px; line-height: 1.45; }
    .pk-foot { font-size: 12px; }
    .pk-size { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; font-size: 13px; font-weight: 650; }
    .pk-seg { flex: 1 1 240px; height: 44px; max-width: 360px; }
    .pk-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0; padding: 0; list-style: none; }
    .pk-tile { display: grid; grid-template-rows: 1fr auto; min-width: 0; overflow: hidden; border: 1px solid var(--line-strong); border-radius: 14px;
      background: var(--surface); }
    .pk-tile__pick { display: grid; grid-template-rows: auto 1fr; min-width: 0; padding: 0; border: 0; background: transparent; color: inherit; font: inherit;
      text-align: left; cursor: pointer; }
    .pk-tile :is(.pk-tile__pick, .pk-tile__zoom):focus-visible { outline-offset: -3px; }
    .pk-tile__pick:disabled, .pk-tile__zoom:disabled { cursor: wait; }
    .pk-tile__pic { display: grid; place-items: center; height: 132px; padding: 6px; border-bottom: 1px solid var(--line); background: #fff; }
    .pk-tile__pic img { max-width: 100%; max-height: 120px; object-fit: contain; }
    /* Not fetched yet: the empty image fills its frame, so the lazy fetch starts as soon as the frame shows in the sheet. */
    .pk-tile__pic img:not([src]) { width: 100%; height: 100%; }
    .pk-tile__label { display: flex; align-items: center; gap: 6px; min-height: 40px; padding: 6px 10px; color: var(--ink-2); font-size: 12.5px; font-weight: 600;
      line-height: 1.3; overflow-wrap: anywhere; }
    .pk-tile__label--warn { color: #7c450b; }
    .pk-tile__zoom { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 0 8px; border: 0;
      border-top: 1px solid var(--line); background: var(--surface-2); color: var(--ink); font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; }
    .pk-tile__zoom app-icon { color: var(--ink-2); }
    .pk-tile--on { border-color: var(--rose); box-shadow: 0 0 0 2px var(--rose); }
    .pk-tile--on .pk-tile__label { background: var(--rose-soft); color: var(--rose-dark); font-weight: 700; }
    .pk-tick { display: grid; place-items: center; flex: none; width: 18px; height: 18px; border-radius: 50%; background: var(--rose); color: #fff; }
    .pk-auto { display: grid; justify-items: start; padding: 10px 12px 4px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface-2);
      color: var(--ink-2); font-size: 12.5px; line-height: 1.45; }
    .pk-auto p:only-child { padding-bottom: 6px; }
    .pk-link { min-height: 44px; padding: 0; border: 0; background: none; color: var(--rose-dark); font: inherit; font-size: 13px; font-weight: 650;
      text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
    .pk-link:disabled { opacity: .5; cursor: wait; }

    /* The foot of "Bekijk groot" on a narrow phone: the back button shrinks and wraps, so "Gebruik deze foto" stays whole on the screen. */
    .pk-back { flex: 0 1 auto; min-width: 0; white-space: normal; line-height: 1.2; }
    .pk-use { flex: none; }
    .pk-cmp, .pk-cmp__pair { display: grid; gap: 10px; min-width: 0; }
    .pk-cmp__fig { display: grid; grid-template-rows: auto 1fr; min-width: 0; margin: 0; overflow: hidden; border: 1px solid var(--line-strong); border-radius: 14px;
      background: #fff; }
    .pk-cmp__fig figcaption { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 7px 12px; border-bottom: 1px solid var(--line);
      background: var(--surface-2); font-size: 13px; font-weight: 700; }
    .pk-cmp__fig small { color: var(--ink-2); font-size: 12px; font-weight: 500; }
    .pk-cmp__fig--this { border-color: var(--ink); box-shadow: 0 0 0 1px var(--ink); }
    /* Two pictures and the foot on one phone screen, also on a short one. */
    .pk-cmp__img { position: relative; display: grid; place-items: center; height: min(176px, 22dvh); padding: 8px; }
    .pk-cmp__img img { max-width: 100%; max-height: calc(min(176px, 22dvh) - 16px); object-fit: contain; }
    .pk-cmp__none { display: grid; place-items: center; align-self: stretch; justify-self: stretch; border: 1.5px dashed var(--line-strong); border-radius: 10px;
      color: #6a615b; font-size: 13px; }
    .pk-cmp__nav { position: absolute; top: 50%; display: grid; place-items: center; width: 44px; height: 44px; margin-top: -22px; padding: 0;
      border: 1px solid var(--line-strong); border-radius: 50%; background: #fff; color: var(--ink); box-shadow: var(--sh-1); cursor: pointer; }
    .pk-cmp__nav:disabled { opacity: .5; cursor: wait; }
    .pk-cmp__nav--prev { left: 8px; }
    .pk-cmp__nav--next { right: 8px; }
    .pk-cmp__info { color: var(--ink-2); font-size: 12.5px; line-height: 1.4; overflow-wrap: anywhere; }
    .pk-cmp__next { display: grid; gap: 6px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface-2); }
    .pk-cmp__next > b { font-size: 12.5px; }
    .pk-cmp__row { display: flex; gap: 8px; margin: 0; padding: 2px; overflow-x: auto; list-style: none; }
    .pk-cmp__row li { display: grid; justify-items: center; gap: 3px; flex: none; max-width: 96px; color: var(--ink-2); font-size: 12px; text-align: center;
      overflow-wrap: anywhere; }
    .pk-cmp__row img { width: 76px; height: 64px; border: 1px solid var(--line-strong); border-radius: 10px; background: #fff; object-fit: contain; }
    .pk-cmp__this img { border-color: var(--ink); box-shadow: 0 0 0 1px var(--ink); }
    @media (min-width: 680px) {
      .pk-top:has(.pk-upload) { grid-template-columns: minmax(0, 1fr) 360px; align-items: center; gap: 20px; }
      .pk-top .pk-intro { order: -1; }
      .pk-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
      .pk-tile__pic { height: 196px; padding: 8px; }
      .pk-tile__pic img { max-height: 180px; }
      .pk-cmp__pair { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
      .pk-cmp__img { height: min(372px, 46dvh); padding: 12px; }
      .pk-cmp__img img { max-height: calc(min(372px, 46dvh) - 24px); }
      /* One line on a laptop: the other colours stay on screen under the two pictures, also at 1440 x 800. */
      .pk-cmp__next { grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 16px; padding: 8px 12px; }
      .pk-cmp__next > b { max-width: 16em; line-height: 1.3; }
      .pk-cmp__row { gap: 14px; }
      .pk-cmp__row li { display: flex; align-items: center; gap: 8px; max-width: 220px; text-align: left; }
      .pk-cmp__row img { flex: none; }
    }
  `,
})
export class ProductPhotoPicker {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** The picker that is open (after the one-colour rule: see `pickerModel`). */
  readonly kind = input.required<PhotoPickerKind>();
  readonly texts = input.required<PickerTexts>();
  /** The photo the place shows now: the left half of "Bekijk groot". */
  readonly current = input<PlacePhoto | null>(null);
  /** The photo of now first, then the gallery order (a photo that was just uploaded can lead: trust `tile.current`). */
  readonly candidates = input.required<PickerTile[]>();
  /** The tile whose choice is being saved; it reads "Bewaren…". */
  readonly busyKey = input<string | null>(null);
  /** The upload-and-use flow: sending the file, then saving the choice. */
  readonly uploading = input<'upload' | 'save' | null>(null);
  readonly detailSize = input<'STANDARD' | 'LARGE' | null>(null);
  /** Other colours' catalogue photos for "Bekijk groot"; null = no strip. */
  readonly compareNeighbours = input<PhotoCompareNeighbour[] | null>(null);
  readonly disabled = input(false);

  readonly picked = output<string>();
  readonly cleared = output<void>();
  readonly uploadRequested = output<File>();
  readonly sizeChanged = output<'STANDARD' | 'LARGE'>();
  /** "Bekijk groot" opened: the panel fetches the other colours fresh. */
  readonly compareOpened = output<void>();
  readonly closed = output<void>();

  readonly acceptTypes = PHOTO_UPLOAD_TYPES.join(',');
  readonly busy = computed(() => this.disabled() || this.busyKey() !== null || this.uploading() !== null);
  readonly sizeOptions = computed<SegmentOption[]>(() => {
    const size = this.texts().size;
    return size ? [{ id: 'STANDARD', label: size.standard }, { id: 'LARGE', label: size.large }] : [];
  });
  /** The pick button that gets the focus when the sheet opens: the photo of now, else the first one. */
  readonly focusKey = computed(() => {
    const tiles = this.candidates();
    return (tiles.find((tile) => tile.current) ?? tiles[0])?.photo.key ?? null;
  });

  /** The photo "Bekijk groot" shows; null = the grid. */
  readonly compareKey = signal<string | null>(null);
  /** "Laat automatisch kiezen" was pressed: it reads "Bewaren…" until the panel answers. */
  readonly clearing = signal(false);
  /** A file is being dragged over the sheet. */
  readonly dropping = signal(false);
  /** The photos the place does not show now, in grid order: what "Bekijk groot" steps through. */
  private readonly others = computed(() => this.candidates().filter((tile) => !tile.current));
  readonly compare = computed<PhotoCompareView | null>(() => {
    const key = this.compareKey();
    const others = this.others();
    const index = key === null ? -1 : others.findIndex((tile) => tile.photo.key === key);
    if (index < 0) return null;
    const tile = others[index];
    const tiles = this.candidates();
    return {
      tile,
      name: `Foto ${tiles.indexOf(tile) + 1} van ${tiles.length}`,
      counter: compareCounter(index, others.length),
      line: compareLine(tile.photo, tile.caption),
      steps: others.length > 1,
    };
  });

  constructor() {
    effect(() => {
      if (!this.busy()) untracked(() => this.clearing.set(false));
    });
  }

  pickFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (file && !this.busy()) this.uploadRequested.emit(file);
  }

  clear(): void {
    if (this.busy()) return;
    this.clearing.set(true);
    this.cleared.emit();
  }

  /* ------------------------------------------------------ "Bekijk groot" */

  openCompare(key: string): void {
    if (this.busy()) return;
    this.compareKey.set(key);
    if (!this.compare()) return;
    this.compareOpened.emit();
    this.focusAfterRender('.pk-cmp__nav--next, .pk-back');
  }

  closeCompare(): void {
    const key = this.compareKey();
    if (key === null) return;
    this.compareKey.set(null);
    this.focusAfterRender(`.pk-tile__zoom[data-zoom-key="${CSS.escape(key)}"]`, '.pk-tile__pick');
  }

  step(delta: number): void {
    const view = this.compare();
    if (!view?.steps || this.busy()) return;
    const others = this.others();
    const index = (others.indexOf(view.tile) + delta + others.length) % others.length;
    this.compareKey.set(others[index].photo.key);
  }

  /**
   * In "Bekijk groot" the arrow keys step and Escape goes back to the grid; a
   * second Escape closes the sheet. This listener sits on the document before
   * the sheet's own (a parent registers first), so it can keep Escape from it.
   */
  onKey(event: KeyboardEvent): void {
    if (!this.compare() || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!this.busy()) this.closeCompare();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      this.step(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }

  /** Arrow keys, Home and End move the focus through the grid. They never choose: only Enter, Space or a tap does. */
  moveFocus(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const from = (event.target as HTMLElement).closest<HTMLElement>('.pk-tile');
    if (!from) return;
    const tiles = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.pk-tile'));
    const index = tiles.indexOf(from);
    const columns = Math.max(1, tiles.filter((tile) => tile.offsetTop === tiles[0].offsetTop).length);
    const target = ({
      ArrowLeft: index - 1, ArrowRight: index + 1, ArrowUp: index - columns, ArrowDown: index + columns, Home: 0, End: tiles.length - 1,
    } as Record<string, number | undefined>)[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = tiles[target];
    if (!next || next === from) return;
    /* From "Bekijk groot" to the neighbour's "Bekijk groot"; the photo of now has none and gives its pick button. */
    const zoom = (event.target as HTMLElement).classList.contains('pk-tile__zoom') ? next.querySelector<HTMLElement>('.pk-tile__zoom') : null;
    (zoom ?? next.querySelector<HTMLElement>('.pk-tile__pick'))?.focus();
  }

  /* ------------------------------------------- a file dropped on the sheet */

  onDragOver(event: DragEvent): void {
    if (!carriesFiles(event)) return;
    /* Always taken over: a file let go beside the bar must not replace the ERP page in the browser. */
    event.preventDefault();
    const accepts = this.acceptsDrop();
    if (event.dataTransfer) event.dataTransfer.dropEffect = accepts ? 'copy' : 'none';
    this.dropping.set(accepts);
  }

  onDragLeave(event: DragEvent): void {
    const to = event.relatedTarget;
    if (!(to instanceof Node) || !this.host.nativeElement.contains(to)) this.dropping.set(false);
  }

  onDrop(event: DragEvent): void {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    const accepts = this.acceptsDrop();
    this.dropping.set(false);
    const file = event.dataTransfer?.files?.[0] ?? null;
    if (accepts && file) this.uploadRequested.emit(file);
  }

  /** The upload bar is on screen and free: only then a dropped file becomes the photo. */
  private acceptsDrop(): boolean {
    return this.texts().upload !== null && !this.busy() && !this.compare();
  }

  private focusAfterRender(selector: string, fallback = selector): void {
    const host = this.host.nativeElement;
    afterNextRender(() => (host.querySelector<HTMLElement>(selector) ?? host.querySelector<HTMLElement>(fallback))?.focus(), { injector: this.injector });
  }
}

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}
