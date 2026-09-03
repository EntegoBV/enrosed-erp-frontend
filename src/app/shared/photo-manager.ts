import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CatalogApi } from '../core/api/catalog-api';
import { AuthImage } from '../core/api/auth-image';
import { saveBlob } from '../core/api/download';
import { messageOf } from '../core/api/errors';
import { PhotoDto, Product } from '../core/api/models';
import { MediaApi } from '../core/api/media-api';
import { MediaAssetSummary } from '../core/api/media-models';
import { FilePicker } from './file-picker';
import { Ui } from './ui';

const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const PHOTO_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

interface PendingPhoto {
  id: number;
  file: File;
  previewUrl: string;
  status: 'queued' | 'uploading' | 'failed';
  error: string | null;
}

type PhotoSeries = 'saved' | 'pending';

interface PointerReorder {
  kind: PhotoSeries;
  pointerId: number;
  sourceIndex: number;
  startX: number;
  startY: number;
  lastX: number;
  started: boolean;
  handle: HTMLElement;
}

export interface PendingPhotoUploadResult {
  uploaded: number;
  remaining: number;
}

/**
 * A product's effective photo series. Product-owned photos are editable;
 * family-gallery projections stay visible but read-only.
 *
 * No rescaling: the file goes to the server as it is and comes back the
 * same. That is the difference between a photo reusable for print or a
 * webshop, and one only usable inside this app.
 *
 * The first effective photo is the primary one and appears in lists and on
 * order lines. Reorder calls only ever send the product-owned IDs.
 */
@Component({
  selector: 'app-photo-manager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, FilePicker],
  template: `
    <!-- Files dragged in from the desktop land anywhere on the manager;
         several at once queue in the order they were dropped. -->
    <div class="photo-manager"
         [class.photo-manager--drop]="fileDropActive()"
         [attr.aria-busy]="interactionDisabled()"
         [attr.aria-disabled]="interactionDisabled()"
         (dragenter)="fileDragEnter($event)"
         (dragover)="fileDragOver($event)"
         (dragleave)="fileDragLeave($event)"
         (drop)="fileDrop($event)">
      @if (fileDropActive()) {
        <div class="photo-dropzone" aria-hidden="true">
          <b>Laat los om toe te voegen</b>
          <span>Meerdere foto’s tegelijk mag</span>
        </div>
      }
    <div class="photo-toolbar">
      <div class="photo-toolbar__copy">
        <b>Foto’s van deze variant</b>
        <span id="photo-order-help">
          Voeg foto’s toe of sleep ze hierheen. Deze beelden horen alleen bij dit artikel.
        </span>
      </div>

      <div class="photo-add-group">
        <label class="photo-add" [class.photo-add--busy]="interactionDisabled()">
          <span class="photo-add__icon" aria-hidden="true">{{ interactionDisabled() ? '…' : '+' }}</span>
          <span>{{ busy() ? 'Uploaden…' : (disabled() ? 'Opslaan…' : "Foto's toevoegen") }}</span>
          <input class="photo-add__input" type="file"
                 accept="image/jpeg,image/png,image/gif,image/webp" multiple
                 [disabled]="interactionDisabled()"
                 (change)="upload($event)" />
        </label>
        <button class="btn btn--sm" type="button" [disabled]="interactionDisabled()" (click)="libraryOpen.set(true)">Uit bibliotheek</button>
      </div>
    </div>
    @if (libraryOpen()) {
      <app-file-picker kind="IMAGE" [multiple]="true" title="Foto’s uit de bibliotheek" (picked)="addFromLibrary($event)" (closed)="libraryOpen.set(false)" />
    }

    @if (ownPhotos().length) {
      <section class="photo-series" aria-labelledby="saved-photo-title">
        <div class="photo-series__head">
          <h3 id="saved-photo-title">Variantfoto’s <span>{{ ownPhotos().length }}</span></h3>
          <small>Sleep, veeg of gebruik de pijltjes om te sorteren</small>
        </div>

        <ol class="photo-strip" aria-describedby="photo-order-help">
          @for (photo of ownPhotos(); track photo.id; let i = $index) {
            <li class="photo-card"
                [class.photo-card--primary]="isEffectivePrimary(photo)"
                [class.photo-card--dragging]="isDragging('saved', i)"
                [class.photo-card--drop]="isDropTarget('saved', i)"
                data-photo-kind="saved"
                [attr.data-photo-index]="i">
              <div class="photo-card__preview">
                <img [appAuthSrc]="photo.url" [alt]="photo.originalFilename" draggable="false" />
                @if (isEffectivePrimary(photo)) {
                  <span class="photo-card__primary">Hoofdfoto</span>
                } @else {
                  <span class="photo-card__position" aria-hidden="true">{{ effectivePosition(photo) }}</span>
                }
                <button class="photo-card__handle" type="button"
                        [disabled]="interactionDisabled() || ownPhotos().length < 2"
                        aria-keyshortcuts="ArrowLeft ArrowRight Home End"
                        [attr.aria-label]="orderLabel(photo.originalFilename, i, ownPhotos().length)"
                        (click)="announceOrderHelp(photo.originalFilename, i, ownPhotos().length)"
                        (keydown)="orderKeydown($event, 'saved', i, photo.originalFilename)"
                        (pointerdown)="startPointerReorder($event, 'saved', i)"
                        (pointermove)="movePointerReorder($event)"
                        (pointerup)="finishPointerReorder($event)"
                        (pointercancel)="cancelPointerReorder($event)">
                  <span aria-hidden="true">⠿</span>
                </button>
              </div>

              <div class="photo-card__footer">
                <span class="photo-card__copy">
                  <b title="{{ photo.originalFilename }}">{{ photo.originalFilename }}</b>
                  <small>
                    @if (photo.widthPx !== null && photo.heightPx !== null) {
                      {{ photo.widthPx }} × {{ photo.heightPx }} ·
                    }
                    {{ sizeLabel(photo.sizeBytes) }}
                  </small>
                </span>
                <span class="photo-card__actions" role="group"
                      [attr.aria-label]="'Acties voor ' + photo.originalFilename">
                  <button type="button" title="Downloaden" [disabled]="interactionDisabled()"
                          [attr.aria-label]="photo.originalFilename + ' downloaden'"
                          (click)="download(photo)"><span aria-hidden="true">↓</span></button>
                  <button class="danger" type="button" title="Verwijderen"
                          [disabled]="interactionDisabled()"
                          [attr.aria-label]="photo.originalFilename + ' verwijderen'"
                          (click)="remove(photo)"><span aria-hidden="true">×</span></button>
                </span>
              </div>
            </li>
          }
        </ol>
      </section>
    }

    @if (pendingPhotos().length) {
      <section class="photo-series photo-series--pending" aria-labelledby="pending-photo-title">
        <div class="photo-series__head">
          <div>
            <h3 id="pending-photo-title">Nog niet opgeslagen <span>{{ pendingPhotos().length }}</span></h3>
            <small>
              @if (productId() === null) {
                Worden geüpload zodra je het product opslaat
              } @else {
                Wachten om geüpload te worden
              }
            </small>
          </div>
          @if (productId() !== null && pendingPhotos()[0].status !== 'uploading') {
            <button class="retry-button" type="button" [disabled]="interactionDisabled()"
                    (click)="retryPendingUploads()">
              {{ pendingPhotos()[0].status === 'failed' ? 'Opnieuw proberen' : 'Nu uploaden' }}
            </button>
          }
        </div>

        <ol class="photo-strip" aria-describedby="photo-order-help">
          @for (pendingPhoto of pendingPhotos(); track pendingPhoto.id; let i = $index) {
            <li class="photo-card photo-card--pending"
                [class.photo-card--primary]="ownPhotos().length === 0 && i === 0"
                [class.photo-card--failed]="pendingPhoto.status === 'failed'"
                [class.photo-card--dragging]="isDragging('pending', i)"
                [class.photo-card--drop]="isDropTarget('pending', i)"
                data-photo-kind="pending"
                [attr.data-photo-index]="i">
              <div class="photo-card__preview">
                <img [src]="pendingPhoto.previewUrl" [alt]="pendingPhoto.file.name" draggable="false" />
                @if (ownPhotos().length === 0 && i === 0) {
                  <span class="photo-card__primary">Hoofdfoto na opslaan</span>
                } @else {
                  <span class="photo-card__position" aria-hidden="true">{{ i + 1 }}</span>
                }
                <span class="photo-card__state"
                      [class.photo-card__state--failed]="pendingPhoto.status === 'failed'">
                  @switch (pendingPhoto.status) {
                    @case ('uploading') { Uploaden… }
                    @case ('failed') { Mislukt }
                    @default { Klaar }
                  }
                </span>
                <button class="photo-card__handle" type="button"
                        [disabled]="interactionDisabled() || pendingPhotos().length < 2"
                        aria-keyshortcuts="ArrowLeft ArrowRight Home End"
                        [attr.aria-label]="orderLabel(pendingPhoto.file.name, i, pendingPhotos().length)"
                        (click)="announceOrderHelp(pendingPhoto.file.name, i, pendingPhotos().length)"
                        (keydown)="orderKeydown($event, 'pending', i, pendingPhoto.file.name)"
                        (pointerdown)="startPointerReorder($event, 'pending', i)"
                        (pointermove)="movePointerReorder($event)"
                        (pointerup)="finishPointerReorder($event)"
                        (pointercancel)="cancelPointerReorder($event)">
                  <span aria-hidden="true">⠿</span>
                </button>
              </div>

              <div class="photo-card__footer">
                <span class="photo-card__copy">
                  <b title="{{ pendingPhoto.file.name }}">{{ pendingPhoto.file.name }}</b>
                  <small>{{ sizeLabel(pendingPhoto.file.size) }}</small>
                  @if (pendingPhoto.error) {
                    <small class="photo-card__error">{{ pendingPhoto.error }}</small>
                  }
                </span>
                <span class="photo-card__actions">
                  <button class="danger" type="button" title="Uit selectie verwijderen"
                          [disabled]="interactionDisabled()"
                          [attr.aria-label]="pendingPhoto.file.name + ' uit de selectie verwijderen'"
                          (click)="removePending(pendingPhoto.id)">
                    <span aria-hidden="true">×</span>
                  </button>
                </span>
              </div>
            </li>
          }
        </ol>
      </section>
    }

    @if (showInherited() && inheritedPhotos().length) {
      <section class="photo-series photo-series--readonly" aria-labelledby="shared-photo-title">
        <div class="photo-series__head">
          <div>
            <h3 id="shared-photo-title">Gedeelde productgalerij <span>{{ inheritedPhotos().length }}</span></h3>
            <small>Gekoppeld aan de productreeks · kies het gebruik hieronder</small>
          </div>
        </div>

        <ol class="photo-strip" aria-label="Foto’s uit de gedeelde productgalerij">
          @for (photo of inheritedPhotos(); track photo.id) {
            <li class="photo-card photo-card--readonly"
                [class.photo-card--primary]="isEffectivePrimary(photo)">
              <div class="photo-card__preview">
                <img [appAuthSrc]="photo.url" [alt]="photo.originalFilename" draggable="false" />
                @if (isEffectivePrimary(photo)) {
                  <span class="photo-card__primary">Hoofdfoto</span>
                } @else {
                  <span class="photo-card__position" aria-hidden="true">{{ effectivePosition(photo) }}</span>
                }
                <span class="photo-card__readonly">Gedeeld</span>
              </div>

              <div class="photo-card__footer">
                <span class="photo-card__copy">
                  <b title="{{ photo.originalFilename }}">{{ photo.originalFilename }}</b>
                  <small>
                    @if (photo.widthPx !== null && photo.heightPx !== null) {
                      {{ photo.widthPx }} × {{ photo.heightPx }} ·
                    }
                    {{ sizeLabel(photo.sizeBytes) }}
                  </small>
                </span>
                <span class="photo-card__actions" role="group"
                      [attr.aria-label]="'Acties voor ' + photo.originalFilename">
                  <button type="button" title="Downloaden" [disabled]="interactionDisabled()"
                          [attr.aria-label]="photo.originalFilename + ' downloaden'"
                          (click)="download(photo)"><span aria-hidden="true">↓</span></button>
                </span>
              </div>
            </li>
          }
        </ol>
      </section>
    }

    @if (!photos().length && !pendingPhotos().length) {
      <div class="photo-empty">
        <span aria-hidden="true">◇</span>
        <div><b>Nog geen foto's</b><small>Voeg meteen meerdere bestanden toe.</small></div>
      </div>
    }

    <p class="photo-help">
      @if (showInherited()) {
        Eigen foto’s staan vooraan. Zonder eigen foto gebruikt het ERP de eerste foto uit de
        gedeelde productgalerij.
      } @else {
        Variantfoto’s staan vóór de gedeelde galerij hieronder.
      }
      JPEG, PNG, GIF of WebP · max. 25 MB per foto.
    </p>
    <p class="sr-only" role="status" aria-live="polite">{{ reorderAnnouncement() }}</p>
    </div>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .photo-manager { position: relative; min-width: 0; }
    .photo-manager--drop { outline: 2px dashed var(--rose); outline-offset: 6px; border-radius: var(--r-sm); }
    .photo-dropzone {
      position: absolute; inset: 0; z-index: 5; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 2px; border-radius: var(--r-sm);
      background: color-mix(in srgb, var(--rose-soft) 88%, transparent); color: var(--rose-dark);
      pointer-events: none;
    }
    .photo-dropzone b { font-size: 15px; }
    .photo-dropzone span { font-size: 12px; opacity: .8; }
    .photo-toolbar {
      display: flex; flex-direction: column; gap: 12px;
      padding: 12px; border: 1px solid var(--line); border-radius: var(--r-sm);
      background: var(--surface-2);
    }
    .photo-toolbar__copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .photo-add-group { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .photo-toolbar__copy b { color: var(--ink-2); font-size: 12.5px; }
    .photo-toolbar__copy span { color: var(--muted); font-size: 10.5px; line-height: 1.4; }
    .photo-add {
      position: relative; display: flex; align-items: center; justify-content: center; gap: 8px;
      min-height: 44px; padding: 8px 13px;
      border: 1px solid var(--rose-mid); border-radius: 10px;
      background: var(--surface); color: var(--rose);
      font-size: 12px; font-weight: 750; cursor: pointer;
    }
    .photo-add:hover { border-color: var(--rose); background: var(--rose-soft); }
    .photo-add:focus-within { outline: 3px solid var(--rose-line); outline-offset: 2px; }
    .photo-add--busy { cursor: wait; opacity: .68; }
    .photo-add__icon {
      display: grid; width: 24px; height: 24px; place-items: center;
      border-radius: 50%; background: var(--rose); color: #fff;
      font-size: 17px; font-weight: 500; line-height: 1;
    }
    .photo-add__input {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }
    .photo-series { min-width: 0; margin-top: 14px; }
    .photo-series__head {
      display: flex; align-items: flex-end; justify-content: space-between; gap: 10px;
      margin: 0 2px 7px;
    }
    .photo-series__head > div { min-width: 0; }
    .photo-series__head h3 { display: flex; align-items: center; gap: 6px; font-size: 12px; }
    .photo-series__head h3 span {
      display: inline-grid; min-width: 20px; min-height: 20px; padding: 0 5px; place-items: center;
      border-radius: 999px; background: var(--surface-2); color: var(--muted);
      font: 700 9px/1 var(--mono);
    }
    .photo-series__head small { display: block; color: var(--muted); font-size: 10px; line-height: 1.35; }
    .photo-strip {
      display: flex; gap: 9px; min-width: 0; margin: 0; padding: 2px 2px 8px;
      overflow-x: auto; overscroll-behavior-inline: contain;
      list-style: none; scroll-padding-inline: 2px; scroll-snap-type: inline proximity;
      scrollbar-width: thin;
    }
    .photo-card {
      position: relative; flex: 0 0 clamp(132px, 42vw, 158px); min-width: 0; overflow: hidden;
      border: 1px solid var(--line); border-radius: var(--r-sm);
      background: var(--surface); box-shadow: 0 2px 8px rgb(26 22 20 / 5%);
      scroll-snap-align: start; transition: border-color .16s, opacity .16s, transform .16s;
    }
    .photo-card--primary { flex-basis: clamp(178px, 57vw, 220px); border-color: var(--rose-line); }
    .photo-card--pending { border-style: dashed; }
    .photo-card--readonly { background: color-mix(in srgb, var(--surface-2) 55%, var(--surface)); }
    .photo-card--failed { border-color: color-mix(in srgb, var(--danger) 55%, var(--line)); }
    .photo-card--dragging { z-index: 2; opacity: .5; transform: scale(.97); }
    .photo-card--drop { border-color: var(--rose); box-shadow: 0 0 0 3px var(--rose-line); }
    .photo-card__preview {
      position: relative; aspect-ratio: 1; overflow: hidden;
      background: linear-gradient(145deg, var(--surface-2), #fff 70%);
    }
    .photo-card--primary .photo-card__preview { aspect-ratio: 4 / 3; }
    .photo-card__preview img { width: 100%; height: 100%; object-fit: contain; display: block; }
    .photo-card__primary {
      position: absolute; left: 7px; top: 7px;
      padding: 4px 7px; border-radius: 999px;
      background: rgb(176 31 63 / 92%); color: #fff;
      box-shadow: 0 3px 10px rgb(26 22 20 / 18%);
      font-size: 8.5px; font-weight: 750; letter-spacing: .04em; text-transform: uppercase;
    }
    .photo-card__position {
      position: absolute; left: 7px; top: 7px; display: grid; width: 23px; height: 23px; place-items: center;
      border-radius: 50%; background: rgb(255 255 255 / 92%); color: var(--ink-2);
      box-shadow: 0 2px 7px rgb(26 22 20 / 12%); font: 750 9px/1 var(--mono);
    }
    .photo-card__state {
      position: absolute; left: 7px; bottom: 7px;
      padding: 4px 7px; border: 1px solid var(--rose-line); border-radius: 999px;
      background: rgb(255 255 255 / 92%); color: var(--rose); font-size: 8.5px; font-weight: 750;
    }
    .photo-card__state--failed {
      border-color: color-mix(in srgb, var(--danger) 35%, var(--line));
      background: color-mix(in srgb, var(--danger) 8%, #fff); color: var(--danger);
    }
    .photo-card__readonly {
      position: absolute; right: 7px; top: 7px; padding: 4px 7px;
      border: 1px solid rgb(255 255 255 / 75%); border-radius: 999px;
      background: rgb(35 31 29 / 76%); color: #fff;
      font-size: 8.5px; font-weight: 750; letter-spacing: .04em; text-transform: uppercase;
    }
    .photo-card__handle {
      position: absolute; right: 7px; top: 7px; display: grid; width: 38px; height: 38px; place-items: center;
      border: 1px solid rgb(255 255 255 / 75%); border-radius: 11px;
      background: rgb(35 31 29 / 76%); color: #fff; box-shadow: 0 3px 10px rgb(26 22 20 / 18%);
      font: 800 18px/1 var(--mono); cursor: grab; touch-action: none; user-select: none;
    }
    .photo-card__handle:active { cursor: grabbing; }
    .photo-card__handle:hover { background: rgb(35 31 29 / 88%); }
    .photo-card__handle:focus-visible { outline: 3px solid var(--rose-line); outline-offset: 2px; }
    .photo-card__handle:disabled { cursor: default; opacity: .45; }
    .photo-card__footer {
      display: flex; align-items: center; gap: 4px; min-width: 0; min-height: 46px;
      padding: 5px 5px 5px 8px; border-top: 1px solid var(--line);
    }
    .photo-card__copy { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; }
    .photo-card__copy b {
      overflow: hidden; color: var(--ink-2); font-size: 9.5px; font-weight: 700;
      text-overflow: ellipsis; white-space: nowrap;
    }
    .photo-card__copy small {
      overflow: hidden; color: var(--muted); font-size: 8.5px; text-overflow: ellipsis; white-space: nowrap;
    }
    .photo-card__copy .photo-card__error { color: var(--danger); }
    .photo-card__actions { display: flex; flex: 0 0 auto; gap: 2px; }
    .photo-card__actions button {
      display: grid; width: 36px; height: 36px; padding: 0; place-items: center;
      border: 0; border-radius: 9px; background: transparent; color: var(--ink-2);
      font: 750 17px/1 var(--mono); cursor: pointer;
    }
    .photo-card__actions button:hover { background: var(--surface-2); }
    .photo-card__actions button:focus-visible { outline: 3px solid var(--rose-line); outline-offset: -2px; }
    .photo-card__actions button:disabled { cursor: wait; opacity: .45; }
    .photo-card__actions .danger { color: var(--danger); }
    .retry-button {
      flex: 0 0 auto; min-height: 36px; padding: 6px 10px;
      border: 1px solid var(--rose-mid); border-radius: 9px; background: var(--surface);
      color: var(--rose); font: inherit; font-size: 10px; font-weight: 750; cursor: pointer;
    }
    .retry-button:hover { border-color: var(--rose); background: var(--rose-soft); }
    .retry-button:disabled { cursor: wait; opacity: .55; }
    .photo-empty {
      display: flex; align-items: center; gap: 10px; min-height: 68px; margin-top: 12px; padding: 10px 12px;
      border: 1px dashed var(--line-strong); border-radius: var(--r-sm); background: var(--surface-2);
    }
    .photo-empty > span { color: var(--rose); font-size: 23px; }
    .photo-empty > div { display: flex; flex-direction: column; gap: 1px; }
    .photo-empty b { font-size: 11.5px; }
    .photo-empty small { color: var(--muted); font-size: 10px; }
    .photo-help { margin: 8px 2px 0; color: var(--muted); font-size: 9.5px; line-height: 1.4; }
    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }

    @media (min-width: 640px) {
      .photo-toolbar { flex-direction: row; align-items: center; justify-content: space-between; padding: 10px 12px; }
      .photo-add { flex: 0 0 auto; }
      .photo-card { flex-basis: 150px; }
      .photo-card--primary { flex-basis: 210px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .photo-card { transition: none; }
    }
  `,
})
export class PhotoManager {
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  private readonly media = inject(MediaApi);
  readonly libraryOpen = signal(false);
  private readonly destroyRef = inject(DestroyRef);
  private nextPendingId = 0;
  private pointerReorder: PointerReorder | null = null;

  readonly productId = input<number | null>(null);
  readonly photos = input.required<PhotoDto[]>();
  readonly disabled = input(false);
  /** The product editor renders canonical family images in its gallery below. */
  readonly showInherited = input(true);
  readonly changed = output<Product>();

  readonly busy = signal(false);
  readonly interactionDisabled = computed(() => this.disabled() || this.busy());
  readonly ownPhotos = computed(() => this.photos().filter((photo) => this.isOwnPhoto(photo)));
  readonly inheritedPhotos = computed(() => this.photos().filter((photo) => !this.isOwnPhoto(photo)));
  readonly pendingPhotos = signal<PendingPhoto[]>([]);
  readonly pendingCount = computed(() => this.pendingPhotos().length);
  readonly draggingSeries = signal<PhotoSeries | null>(null);
  readonly draggingIndex = signal<number | null>(null);
  readonly dropTargetIndex = signal<number | null>(null);
  readonly reorderAnnouncement = signal('');

  constructor() {
    this.destroyRef.onDestroy(() => {
      for (const photo of this.pendingPhotos()) URL.revokeObjectURL(photo.previewUrl);
    });
  }

  async upload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (this.interactionDisabled()) {
      input.value = '';
      return;
    }
    const files = Array.from(input.files ?? []);
    input.value = '';
    await this.addFiles(files);
  }

  /* ---- drag files in from the desktop ---- */
  readonly fileDropActive = signal(false);
  private fileDragDepth = 0;

  private carriesFiles(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
  }

  fileDragEnter(event: DragEvent): void {
    if (!this.carriesFiles(event)) return;
    event.preventDefault();
    this.fileDragDepth++;
    if (!this.interactionDisabled()) this.fileDropActive.set(true);
  }

  fileDragOver(event: DragEvent): void {
    if (!this.carriesFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = this.interactionDisabled() ? 'none' : 'copy';
  }

  fileDragLeave(event: DragEvent): void {
    if (!this.carriesFiles(event)) return;
    this.fileDragDepth = Math.max(0, this.fileDragDepth - 1);
    if (this.fileDragDepth === 0) this.fileDropActive.set(false);
  }

  async fileDrop(event: DragEvent): Promise<void> {
    if (!this.carriesFiles(event)) return;
    event.preventDefault();
    this.fileDragDepth = 0;
    this.fileDropActive.set(false);
    if (this.interactionDisabled()) return;
    await this.addFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  /** Library photos take the same road as a picked file: fetched once, then queued. */
  async addFromLibrary(assets: MediaAssetSummary[]): Promise<void> {
    this.libraryOpen.set(false);
    if (!assets.length || this.interactionDisabled()) return;
    const files: File[] = [];
    try {
      for (const asset of assets) {
        const blob = await this.media.download(asset.id);
        files.push(new File([blob], asset.originalFilename || asset.name, { type: asset.contentType || blob.type }));
      }
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'De foto kon niet uit de bibliotheek worden gehaald.'), 'err');
      return;
    }
    await this.addFiles(files);
  }

  /** Picker and drop share one road: check, queue, upload when the product exists. */
  private async addFiles(files: File[]): Promise<void> {
    if (!files.length) return;

    const accepted = this.acceptedFiles(files);
    if (!accepted.length) return;
    this.queue(accepted);

    const productId = this.productId();
    if (productId === null) {
      this.ui.toast(`${accepted.length} foto('s) klaar om mee op te slaan`, 'ok');
      return;
    }

    const result = await this.uploadPending(productId);
    this.reportUploadResult(result);
  }

  /** Uploads the local queue in order after the product has a server id. */
  async uploadPending(
    productId: number,
    allowWhileDisabled = false,
  ): Promise<PendingPhotoUploadResult> {
    if (this.busy() || (this.disabled() && !allowWhileDisabled)) {
      return { uploaded: 0, remaining: this.pendingCount() };
    }

    this.busy.set(true);
    let uploaded = 0;
    try {
      while (this.pendingPhotos().length) {
        const pendingPhoto = this.pendingPhotos()[0];
        this.updatePending(pendingPhoto.id, { status: 'uploading', error: null });
        try {
          const product = await this.catalog.uploadPhoto(productId, pendingPhoto.file);
          this.changed.emit(product);
          this.discardPending(pendingPhoto.id);
          uploaded++;
        } catch (failure: unknown) {
          this.updatePending(pendingPhoto.id, {
            status: 'failed',
            error: messageOf(failure, 'Uploaden mislukt. Controleer het bestand en probeer opnieuw.'),
          });
          break;
        }
      }
    } finally {
      this.busy.set(false);
    }

    return { uploaded, remaining: this.pendingCount() };
  }

  async retryPendingUploads(): Promise<void> {
    if (this.interactionDisabled()) return;
    const productId = this.productId();
    if (productId === null) return;
    this.reportUploadResult(await this.uploadPending(productId));
  }

  removePending(id: number): void {
    if (!this.interactionDisabled()) this.discardPending(id);
  }

  movePending(index: number, direction: -1 | 1): void {
    this.reorderPending(index, index + direction);
  }

  async remove(photo: PhotoDto): Promise<void> {
    if (this.interactionDisabled() || !this.isCurrentOwnPhoto(photo)) return;
    const productId = this.productId();
    if (productId === null) return;
    this.ui.confirm(
      {
        title: 'Foto verwijderen',
        message: `<b>${photo.originalFilename}</b> verwijderen?`,
        confirmLabel: 'Verwijderen',
        danger: true,
      },
      async () => {
        if (this.interactionDisabled() || !this.isCurrentOwnPhoto(photo)) return;
        this.busy.set(true);
        try {
          this.changed.emit(await this.catalog.deletePhoto(productId, photo.id));
          this.ui.toast('Foto verwijderd');
        } catch (failure: unknown) {
          this.ui.toast(messageOf(failure, 'Foto verwijderen mislukt'), 'err');
        } finally {
          this.busy.set(false);
        }
      },
    );
  }

  async move(index: number, direction: -1 | 1): Promise<void> {
    await this.reorderSaved(index, index + direction);
  }

  isDragging(kind: PhotoSeries, index: number): boolean {
    return !this.interactionDisabled()
      && this.draggingSeries() === kind && this.draggingIndex() === index;
  }

  isDropTarget(kind: PhotoSeries, index: number): boolean {
    return !this.interactionDisabled()
      && this.draggingSeries() === kind
      && this.draggingIndex() !== index
      && this.dropTargetIndex() === index;
  }

  orderLabel(filename: string, index: number, total: number): string {
    return `Volgorde van ${filename}, positie ${index + 1} van ${total}. `
      + 'Sleep of veeg; gebruik met een toetsenbord de pijltjes, Home of End.';
  }

  announceOrderHelp(filename: string, index: number, total: number): void {
    this.reorderAnnouncement.set(this.orderLabel(filename, index, total));
  }

  orderKeydown(event: KeyboardEvent, kind: PhotoSeries, index: number, filename: string): void {
    if (this.interactionDisabled()) return;
    const total = kind === 'saved' ? this.ownPhotos().length : this.pendingPhotos().length;
    if (index < 0 || index >= total) return;
    let target = index;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        target--;
        break;
      case 'ArrowRight':
      case 'ArrowDown':
        target++;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = total - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.reorder(kind, index, target, filename);
  }

  startPointerReorder(event: PointerEvent, kind: PhotoSeries, index: number): void {
    if (this.interactionDisabled() || event.button !== 0) return;
    const total = kind === 'saved' ? this.ownPhotos().length : this.pendingPhotos().length;
    if (index < 0 || index >= total) return;
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    this.pointerReorder = {
      kind,
      pointerId: event.pointerId,
      sourceIndex: index,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      started: false,
      handle,
    };
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      this.pointerReorder = null;
    }
  }

  movePointerReorder(event: PointerEvent): void {
    const active = this.pointerReorder;
    if (!active || event.pointerId !== active.pointerId) return;
    if (this.interactionDisabled()) {
      this.releasePointer(active);
      this.resetPointerReorder();
      return;
    }
    active.lastX = event.clientX;
    const distance = Math.hypot(event.clientX - active.startX, event.clientY - active.startY);
    if (!active.started && distance < 7) return;

    event.preventDefault();
    event.stopPropagation();
    if (!active.started) {
      active.started = true;
      this.draggingSeries.set(active.kind);
      this.draggingIndex.set(active.sourceIndex);
      this.dropTargetIndex.set(active.sourceIndex);
    }

    const card = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-photo-kind]');
    if (card?.dataset['photoKind'] !== active.kind) return;
    const target = Number(card.dataset['photoIndex']);
    if (Number.isInteger(target)) this.dropTargetIndex.set(target);
  }

  finishPointerReorder(event: PointerEvent): void {
    const active = this.pointerReorder;
    if (!active || event.pointerId !== active.pointerId) return;
    if (this.interactionDisabled()) {
      this.releasePointer(active);
      this.resetPointerReorder();
      return;
    }
    active.lastX = event.clientX;
    if (active.started) {
      event.preventDefault();
      event.stopPropagation();
    }

    const source = active.sourceIndex;
    let target = this.dropTargetIndex() ?? source;
    const horizontalDistance = active.lastX - active.startX;
    if (active.started && target === source && Math.abs(horizontalDistance) >= 32) {
      // A short swipe follows list navigation: left is previous, right is next.
      target += horizontalDistance < 0 ? -1 : 1;
    }
    const filename = this.photoName(active.kind, source);
    this.releasePointer(active);
    this.resetPointerReorder();
    if (active.started) this.reorder(active.kind, source, target, filename);
  }

  cancelPointerReorder(event: PointerEvent): void {
    const active = this.pointerReorder;
    if (!active || event.pointerId !== active.pointerId) return;
    this.releasePointer(active);
    this.resetPointerReorder();
  }

  private reorder(kind: PhotoSeries, source: number, target: number, filename: string): void {
    if (this.interactionDisabled()) return;
    const total = kind === 'saved' ? this.ownPhotos().length : this.pendingPhotos().length;
    const boundedTarget = Math.max(0, Math.min(target, total - 1));
    if (source === boundedTarget || source < 0 || source >= total) return;
    if (kind === 'saved') {
      void this.reorderSaved(source, boundedTarget, filename);
    } else {
      this.reorderPending(source, boundedTarget, filename);
    }
  }

  private async reorderSaved(source: number, target: number, filename?: string): Promise<void> {
    if (this.interactionDisabled()) return;
    const productId = this.productId();
    if (productId === null) return;
    const ownPhotos = this.ownPhotos();
    const order = ownPhotos.map((photo) => photo.id);
    if (source < 0 || source >= order.length || target < 0 || target >= order.length) return;
    const [movedPhotoId] = order.splice(source, 1);
    order.splice(target, 0, movedPhotoId);
    const movedName = filename ?? ownPhotos[source]?.originalFilename ?? 'Foto';
    this.busy.set(true);
    try {
      this.changed.emit(await this.catalog.reorderPhotos(productId, order));
      this.announceMoved(movedName, target, order.length, target === 0);
    } catch (failure: unknown) {
      this.reorderAnnouncement.set(`${movedName} kon niet worden verplaatst.`);
      this.ui.toast(messageOf(failure, 'Volgorde aanpassen mislukt'), 'err');
    } finally {
      this.busy.set(false);
    }
  }

  private reorderPending(source: number, target: number, filename?: string): void {
    if (this.interactionDisabled()) return;
    const pending = [...this.pendingPhotos()];
    if (source < 0 || source >= pending.length || target < 0 || target >= pending.length) return;
    const [movedPhoto] = pending.splice(source, 1);
    pending.splice(target, 0, movedPhoto);
    this.pendingPhotos.set(pending);
    this.announceMoved(
      filename ?? movedPhoto.file.name,
      target,
      pending.length,
      this.ownPhotos().length === 0 && target === 0,
    );
  }

  private announceMoved(filename: string, target: number, total: number, primary: boolean): void {
    const position = primary ? ' en is nu de hoofdfoto' : '';
    this.reorderAnnouncement.set(
      `${filename} staat nu op positie ${target + 1} van ${total}${position}.`,
    );
  }

  private photoName(kind: PhotoSeries, index: number): string {
    return kind === 'saved'
      ? this.ownPhotos()[index]?.originalFilename ?? 'Foto'
      : this.pendingPhotos()[index]?.file.name ?? 'Foto';
  }

  private releasePointer(active: PointerReorder): void {
    try {
      if (active.handle.hasPointerCapture(active.pointerId)) {
        active.handle.releasePointerCapture(active.pointerId);
      }
    } catch {
      /* A cancelled pointer is already released by the browser. */
    }
  }

  private resetPointerReorder(): void {
    this.pointerReorder = null;
    this.draggingSeries.set(null);
    this.draggingIndex.set(null);
    this.dropTargetIndex.set(null);
  }

  async download(photo: PhotoDto): Promise<void> {
    if (this.interactionDisabled()) return;
    const blob = await this.catalog.photoBlob(photo.downloadUrl);
    saveBlob(blob, photo.originalFilename);
  }

  isOwnPhoto(photo: PhotoDto): boolean {
    /* Ownership must be explicit: mixed or older payloads remain read-only. */
    return photo.origin === 'PRODUCT' && photo.readOnly === false && photo.familyPhotoId === null;
  }

  isEffectivePrimary(photo: PhotoDto): boolean {
    return this.photos()[0]?.id === photo.id;
  }

  effectivePosition(photo: PhotoDto): number | string {
    const index = this.photos().findIndex((candidate) => candidate.id === photo.id);
    return index >= 0 ? index + 1 : '—';
  }

  private isCurrentOwnPhoto(photo: PhotoDto): boolean {
    return this.isOwnPhoto(photo)
      && this.ownPhotos().some((candidate) => candidate.id === photo.id);
  }

  sizeLabel(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' kB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  private acceptedFiles(files: File[]): File[] {
    const known = new Set(this.pendingPhotos().map(({ file }) => this.fileKey(file)));
    /* Already on the product under the same name and size: almost surely the
       same picture; the server checks the bytes for everything else. */
    const onProduct = new Set(this.ownPhotos()
      .filter((photo) => !photo.readOnly)
      .map((photo) => `${photo.originalFilename}\u0000${photo.sizeBytes}`));
    const accepted: File[] = [];
    let invalid = 0;
    let tooLarge = 0;
    let duplicate = 0;

    for (const file of files) {
      if (!PHOTO_CONTENT_TYPES.has(file.type.toLowerCase()) || file.size === 0) {
        invalid++;
        continue;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        tooLarge++;
        continue;
      }
      const key = this.fileKey(file);
      if (known.has(key) || onProduct.has(`${file.name}\u0000${file.size}`)) {
        duplicate++;
        continue;
      }
      known.add(key);
      accepted.push(file);
    }

    const problems = [
      invalid ? `${invalid} ongeldig bestand` : '',
      tooLarge ? `${tooLarge} foto boven 25 MB` : '',
      duplicate ? `${duplicate} foto staat er al` : '',
    ].filter(Boolean);
    if (problems.length) this.ui.toast(`${problems.join(' · ')} overgeslagen`, 'err');
    return accepted;
  }

  private queue(files: File[]): void {
    const additions = files.map((file): PendingPhoto => ({
      id: ++this.nextPendingId,
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'queued',
      error: null,
    }));
    this.pendingPhotos.update((pending) => [...pending, ...additions]);
  }

  private discardPending(id: number): void {
    const pendingPhoto = this.pendingPhotos().find((photo) => photo.id === id);
    if (!pendingPhoto) return;
    URL.revokeObjectURL(pendingPhoto.previewUrl);
    this.pendingPhotos.update((pending) => pending.filter((photo) => photo.id !== id));
  }

  private updatePending(id: number, changes: Partial<Pick<PendingPhoto, 'status' | 'error'>>): void {
    this.pendingPhotos.update((pending) => pending.map((photo) =>
      photo.id === id ? { ...photo, ...changes } : photo));
  }

  private fileKey(file: File): string {
    return `${file.name}\u0000${file.size}\u0000${file.lastModified}\u0000${file.type}`;
  }

  private reportUploadResult(result: PendingPhotoUploadResult): void {
    if (result.remaining) {
      const prefix = result.uploaded ? `${result.uploaded} toegevoegd; ` : '';
      this.ui.toast(`${prefix}${result.remaining} foto('s) nog niet geüpload`, 'err');
    } else if (result.uploaded) {
      this.ui.toast(`${result.uploaded} foto('s) toegevoegd`, 'ok');
    }
  }
}
