import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CatalogApi } from '../core/api/catalog-api';
import { AuthImage } from '../core/api/auth-image';
import { saveBlob } from '../core/api/download';
import { messageOf } from '../core/api/errors';
import { PhotoDto, PhotoRole, Product } from '../core/api/models';
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
        <span id="photo-order-help">De hoofdfoto verschijnt in lijsten en op documenten.<small>{{ productId() === null ? 'Foto’s worden bij het opslaan toegevoegd.' : 'Wijzigingen worden direct opgeslagen.' }}</small></span>
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
      <section class="photo-series" aria-label="Foto’s van deze variant">
        <ol class="photo-strip" aria-describedby="photo-order-help">
          @for (photo of ownPhotos(); track photo.id; let i = $index) {
            <li class="photo-card"
                [class.photo-card--primary]="isEffectivePrimary(photo)"
                [class.photo-card--selected]="selectedPhoto()?.id === photo.id"
                [class.photo-card--dragging]="isDragging('saved', i)"
                [class.photo-card--drop]="isDropTarget('saved', i)"
                data-photo-kind="saved" [attr.data-photo-index]="i">
              <div class="photo-card__preview">
                <button class="photo-card__select" type="button" (click)="selectPhoto(photo)" [attr.data-photo-select]="photo.id"
                        [attr.aria-expanded]="selectedPhoto()?.id === photo.id"
                        aria-controls="photo-details" [attr.aria-label]="'Instellingen voor ' + photo.originalFilename">
                  <img [appAuthSrc]="photo.url" [alt]="photo.originalFilename" draggable="false" />
                  @if (isEffectivePrimary(photo)) { <span class="photo-card__primary">Hoofdfoto</span> }
                  @else { <span class="photo-card__position" aria-hidden="true">{{ effectivePosition(photo) }}</span> }
                </button>
                @if (ownPhotos().length > 1) {
                  <button class="photo-card__handle" type="button" [disabled]="interactionDisabled()"
                          aria-keyshortcuts="ArrowLeft ArrowRight Home End"
                          [attr.aria-label]="orderLabel(photo.originalFilename, i, ownPhotos().length)"
                          (click)="announceOrderHelp(photo.originalFilename, i, ownPhotos().length)"
                          (keydown)="orderKeydown($event, 'saved', i, photo.originalFilename)"
                          (pointerdown)="startPointerReorder($event, 'saved', i)"
                          (pointermove)="movePointerReorder($event)" (pointerup)="finishPointerReorder($event)"
                          (pointercancel)="cancelPointerReorder($event)"><span aria-hidden="true">⠿</span></button>
                }
              </div>
              <button class="photo-card__caption" type="button" (click)="selectPhoto(photo)"
                      [attr.aria-expanded]="selectedPhoto()?.id === photo.id" aria-controls="photo-details">
                <b [title]="photo.originalFilename">{{ photo.originalFilename }}</b>
                <small>{{ selectedPhoto()?.id === photo.id ? 'Instellingen sluiten' : 'Instellingen' }} <span aria-hidden="true">⌄</span></small>
              </button>
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
      <section class="photo-series photo-series--readonly" aria-label="Foto’s uit de reeks">
        <div class="photo-series__head"><h3>Uit de reeks</h3><small>Beheren bij de productreeks</small></div>
        <ol class="photo-strip">
          @for (photo of inheritedPhotos(); track photo.id) {
            <li class="photo-card photo-card--readonly" [class.photo-card--primary]="isEffectivePrimary(photo)"
                [class.photo-card--selected]="selectedPhoto()?.id === photo.id">
              <div class="photo-card__preview">
                <button class="photo-card__select" type="button" (click)="selectPhoto(photo)" [attr.data-photo-select]="photo.id"
                        [attr.aria-expanded]="selectedPhoto()?.id === photo.id" aria-controls="photo-details"
                        [attr.aria-label]="'Instellingen voor gedeelde foto ' + photo.originalFilename">
                  <img [appAuthSrc]="photo.url" [alt]="photo.originalFilename" draggable="false" />
                  @if (isEffectivePrimary(photo)) { <span class="photo-card__primary">Hoofdfoto</span> }
                  <span class="photo-card__readonly">Reeks</span>
                </button>
              </div>
              <button class="photo-card__caption" type="button" (click)="selectPhoto(photo)"
                      [attr.aria-expanded]="selectedPhoto()?.id === photo.id" aria-controls="photo-details">
                <b [title]="photo.originalFilename">{{ photo.originalFilename }}</b><small>Gedeelde foto <span aria-hidden="true">⌄</span></small>
              </button>
            </li>
          }
        </ol>
      </section>
    }

    @if (selectedPhoto(); as photo) {
      <section class="photo-details" id="photo-details" tabindex="-1" aria-label="Foto-instellingen">
        <div class="photo-details__head">
          <div><b>{{ photo.originalFilename }}</b><small>{{ isOwnPhoto(photo) ? 'Alleen deze variant' : 'Gedeeld vanuit de reeks' }}@if (photo.widthPx && photo.heightPx) { · {{ photo.widthPx }} × {{ photo.heightPx }} px } · {{ sizeLabel(photo.sizeBytes) }}</small></div>
          <button class="photo-details__close" type="button" aria-label="Foto-instellingen sluiten" (click)="closePhotoDetails()">×</button>
        </div>
        @if (isOwnPhoto(photo)) {
          <div class="photo-details__primary">
            <span>{{ isEffectivePrimary(photo) ? 'Hoofdfoto in lijsten en op documenten' : 'Gebruik als hoofdfoto in lijsten en op documenten' }}</span>
            @if (!isEffectivePrimary(photo)) { <button class="btn btn--sm" type="button" [disabled]="interactionDisabled()" (click)="makePrimary(photo)">Maak hoofdfoto</button> }
          </div>
        }
        <fieldset class="photo-role-settings">
          <legend>Eerste foto per kanaal</legend>
          <div class="photo-card__roles">
            <button class="photo-role" type="button" [class.photo-role--on]="leads(photo, 'WEBSITE')"
                    [disabled]="interactionDisabled() || productId() === null" [attr.aria-pressed]="leads(photo, 'WEBSITE')"
                    (click)="toggleLead(photo, 'WEBSITE')"><span aria-hidden="true">{{ leads(photo, 'WEBSITE') ? '✓' : '+' }}</span> Website</button>
            <button class="photo-role" type="button" [class.photo-role--on]="leads(photo, 'CATALOGUE')"
                    [disabled]="interactionDisabled() || productId() === null" [attr.aria-pressed]="leads(photo, 'CATALOGUE')"
                    (click)="toggleLead(photo, 'CATALOGUE')"><span aria-hidden="true">{{ leads(photo, 'CATALOGUE') ? '✓' : '+' }}</span> Catalogus</button>
          </div>
          <p>Geen voorkeur? Dan wordt de eerste beschikbare foto gebruikt. Dit wijzigt de publicatie niet.</p>
        </fieldset>
        <div class="photo-details__actions">
          <button class="btn btn--sm" type="button" [disabled]="interactionDisabled()" (click)="download(photo)">Download origineel</button>
          @if (isOwnPhoto(photo)) { <button class="photo-delete" type="button" [disabled]="interactionDisabled()" (click)="remove(photo)">Foto verwijderen</button> }
        </div>
      </section>
    }

    @if (!ownPhotos().length && !(showInherited() && inheritedPhotos().length) && !pendingPhotos().length) {
      <div class="photo-empty"><b>Nog geen variantfoto’s</b><small>@if (inheritedPhotos().length) { Deze variant gebruikt de foto’s uit de reeks. } @else { Voeg een foto toe via je toestel of de bibliotheek. }</small></div>
    }
    <p class="photo-help">JPEG, PNG, GIF of WebP · max. 25 MB per foto.@if (ownPhotos().length > 1) { Sleep via ⠿ om te sorteren. }</p>
    <p class="sr-only" role="status" aria-live="polite">{{ reorderAnnouncement() }}</p>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .photo-manager {
      position: relative;
      min-width: 0;
    }
    .photo-manager--drop {
      outline: 2px dashed var(--rose);
      outline-offset: 6px;
      border-radius: 14px;
    }
    .photo-dropzone {
      position: absolute;
      inset: 0;
      z-index: 5;
      display: grid;
      place-content: center;
      text-align: center;
      gap: 4px;
      border-radius: 14px;
      background: color-mix(in srgb, var(--rose-soft) 92%, transparent);
      color: var(--rose-dark);
      pointer-events: none;
    }
    .photo-dropzone b {
      font-size: 15px;
    }
    .photo-dropzone span {
      font-size: 12px;
    }
    .photo-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
    }
    .photo-toolbar__copy {
      min-width: 0;
      max-width: 320px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .photo-toolbar__copy small {
      display: block;
      margin-top: 3px;
      font-size: 10px;
    }
    .photo-add-group {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      flex-shrink: 0;
    }
    .photo-add {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      min-height: 42px;
      padding: 8px 13px;
      border: 1px solid var(--rose-line);
      border-radius: 10px;
      background: var(--rose-soft);
      color: var(--rose-dark);
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .photo-add__icon {
      font-size: 20px;
      font-weight: 400;
      line-height: 1;
    }
    .photo-add--busy {
      opacity: 0.55;
      cursor: wait;
    }
    .photo-add-group > .btn {
      min-height: 42px;
    }
    .photo-add__input,
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .photo-add:focus-within,
    button:focus-visible {
      outline: 2px solid var(--rose);
      outline-offset: 3px;
    }
    .photo-series {
      min-width: 0;
      margin-top: 14px;
    }
    .photo-series__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }
    .photo-series__head h3 {
      font-size: 12px;
      margin: 0;
    }
    .photo-series__head h3 span {
      color: var(--muted);
      margin-left: 5px;
    }
    .photo-series__head small {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.5;
    }
    .photo-strip {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(138px, 1fr));
      gap: 10px;
      min-width: 0;
      margin: 0;
      padding: 0;
      list-style: none;
      align-items: start;
    }
    .photo-card {
      position: relative;
      min-width: 0;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--surface);
      transition:
        border-color 0.18s,
        opacity 0.18s,
        transform 0.18s;
    }
    .photo-card--primary {
      border-color: var(--rose-line);
    }
    .photo-card--selected {
      border-color: var(--rose);
      box-shadow: 0 0 0 1px var(--rose);
    }
    .photo-card--pending {
      border-style: dashed;
    }
    .photo-card--failed {
      border-color: var(--danger);
    }
    .photo-card--dragging {
      opacity: 0.5;
      transform: scale(0.97);
    }
    .photo-card--drop {
      border-color: var(--rose);
      box-shadow: 0 0 0 3px var(--rose-line);
    }
    .photo-card__preview {
      position: relative;
      aspect-ratio: 1;
      overflow: hidden;
      background: var(--surface-2);
    }
    .photo-card__preview img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }
    .photo-card__select {
      position: absolute;
      inset: 0;
      display: block;
      padding: 8px;
      width: 100%;
      height: 100%;
      border: 0;
      background: transparent;
      cursor: pointer;
    }
    .photo-card__select:focus-visible {
      outline-offset: -3px;
    }
    .photo-card__primary,
    .photo-card__position,
    .photo-card__readonly,
    .photo-card__state {
      position: absolute;
      left: 7px;
      top: 7px;
      display: grid;
      place-items: center;
      min-height: 23px;
      padding: 3px 7px;
      border-radius: 7px;
      background: var(--surface);
      color: var(--ink-2);
      font-size: 10px;
      font-weight: 700;
      line-height: 1.2;
      box-shadow: 0 1px 5px #0001;
    }
    .photo-card__primary {
      background: var(--rose);
      color: white;
    }
    .photo-card__position {
      min-width: 23px;
      padding-inline: 5px;
    }
    .photo-card__readonly {
      top: auto;
      bottom: 7px;
    }
    .photo-card__state {
      top: auto;
      bottom: 7px;
    }
    .photo-card__state--failed {
      color: var(--danger);
    }
    .photo-card__handle {
      position: absolute;
      right: 5px;
      bottom: 5px;
      display: grid;
      place-items: center;
      width: 38px;
      height: 38px;
      padding: 0;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: color-mix(in srgb, var(--surface) 94%, transparent);
      color: var(--muted);
      font-size: 20px;
      cursor: grab;
      touch-action: none;
      user-select: none;
    }
    .photo-card__handle:active {
      cursor: grabbing;
    }
    .photo-card__handle:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .photo-card__caption {
      display: grid;
      gap: 4px;
      width: 100%;
      padding: 9px 10px;
      border: 0;
      border-top: 1px solid var(--line);
      background: transparent;
      text-align: left;
      color: var(--ink);
      font: inherit;
      cursor: pointer;
    }
    .photo-card__caption b {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 11px;
      font-weight: 600;
    }
    .photo-card__caption small {
      display: flex;
      justify-content: space-between;
      color: var(--muted);
      font-size: 10px;
    }
    .photo-card__caption:focus-visible {
      outline-offset: -3px;
    }
    .photo-card__footer {
      display: flex;
      align-items: center;
      min-width: 0;
      gap: 6px;
      padding: 8px;
    }
    .photo-card__copy {
      display: grid;
      min-width: 0;
      flex: 1;
      gap: 3px;
    }
    .photo-card__copy b {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 11px;
    }
    .photo-card__copy small {
      font-size: 10px;
      color: var(--muted);
    }
    .photo-card__copy .photo-card__error {
      color: var(--danger);
      overflow-wrap: anywhere;
    }
    .photo-card__actions button {
      width: 36px;
      height: 36px;
      border: 0;
      border-radius: 9px;
      background: var(--surface-2);
      color: var(--danger);
      font-size: 19px;
      cursor: pointer;
    }
    .retry-button {
      min-height: 42px;
      padding: 8px 12px;
      border: 1px solid var(--rose-line);
      border-radius: 10px;
      background: var(--surface);
      color: var(--rose);
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    .photo-details {
      min-width: 0;
      margin-top: 14px;
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: var(--surface-2);
      animation: photo-details-in 0.18s ease-out;
    }
    .photo-details__head {
      display: flex;
      gap: 12px;
      justify-content: space-between;
      align-items: flex-start;
    }
    .photo-details__head > div {
      display: grid;
      min-width: 0;
      gap: 5px;
    }
    .photo-details__head b {
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    .photo-details__head small {
      font-size: 11px;
      line-height: 1.5;
      color: var(--muted);
    }
    .photo-details__close {
      flex: none;
      width: 36px;
      height: 36px;
      padding: 0;
      border: 0;
      border-radius: 9px;
      background: var(--surface);
      color: var(--muted);
      font-size: 22px;
      cursor: pointer;
    }
    .photo-details__primary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid var(--line);
      font-size: 12px;
      line-height: 1.5;
    }
    .photo-details__primary .btn {
      flex: none;
    }
    .photo-role-settings {
      min-width: 0;
      margin: 14px 0 0;
      padding: 0;
      border: 0;
    }
    .photo-role-settings legend {
      font-size: 12px;
      font-weight: 650;
      margin-bottom: 8px;
    }
    .photo-card__roles {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
    }
    .photo-role {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 40px;
      padding: 8px 13px;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: var(--surface);
      color: var(--muted);
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    .photo-role--on {
      border-color: var(--rose-line);
      background: var(--rose-soft);
      color: var(--rose-dark);
    }
    .photo-role-settings p {
      margin: 7px 0 0;
      font-size: 11px;
      line-height: 1.5;
      color: var(--muted);
    }
    .photo-details__actions {
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid var(--line);
    }
    .photo-delete {
      border: 0;
      background: transparent;
      color: var(--danger);
      font: inherit;
      font-size: 12px;
      min-height: 40px;
      padding: 8px;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .photo-empty {
      display: grid;
      gap: 5px;
      margin-top: 14px;
      padding: 24px 16px;
      border: 1px dashed var(--line-strong);
      border-radius: 12px;
      text-align: center;
    }
    .photo-empty b {
      font-size: 13px;
    }
    .photo-empty small {
      font-size: 12px;
      line-height: 1.5;
      color: var(--muted);
    }
    .photo-help {
      margin: 10px 0 0;
      font-size: 10px;
      line-height: 1.6;
      color: var(--muted);
    }
    @keyframes photo-details-in {
      from {
        opacity: 0;
        transform: translateY(4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    @media (max-width: 639px) {
      .photo-toolbar {
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
      }
      .photo-toolbar__copy {
        max-width: none;
      }
      .photo-add-group {
        display: grid;
        grid-template-columns: 1fr 1fr;
      }
      .photo-add,
      .photo-add-group > .btn {
        min-height: 44px;
        padding-inline: 8px;
        font-size: 12px;
      }
      .photo-strip {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 9px;
      }
      .photo-card__handle,
      .photo-card__actions button {
        width: 44px;
        height: 44px;
      }
      .photo-card__caption {
        min-height: 54px;
      }
      .photo-details {
        padding: 13px;
      }
      .photo-details__close {
        width: 44px;
        height: 44px;
      }
      .photo-details__primary {
        align-items: flex-start;
        flex-direction: column;
        gap: 8px;
      }
      .photo-role,
      .photo-details .btn,
      .photo-delete {
        min-height: 44px;
      }
      .photo-details__actions {
        align-items: stretch;
      }
      .photo-details__actions > .btn {
        flex: 1;
      }
      .photo-card__primary {
        font-size: 10px;
      }
      .photo-series__head {
        align-items: flex-start;
      }
      .photo-series__head small {
        font-size: 10px;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .photo-card {
        transition: none;
      }
      .photo-details {
        animation: none;
      }
    }
  `,
})
export class PhotoManager {
  private readonly elementRef: ElementRef<HTMLElement> = inject(ElementRef);
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
  readonly interactionDisabled = computed(() => this.disabled() || this.busy() || this.roleBusy() !== null);
  readonly ownPhotos = computed(() => this.photos().filter((photo) => this.isOwnPhoto(photo)));
  readonly inheritedPhotos = computed(() => this.photos().filter((photo) => !this.isOwnPhoto(photo)));
  readonly selectedPhotoId = signal<number | null>(null);
  readonly selectedPhoto = computed(() => this.photos().find(photo => photo.id === this.selectedPhotoId()
    && (this.isOwnPhoto(photo) || this.showInherited())) ?? null);
  readonly pendingPhotos = signal<PendingPhoto[]>([]);
  readonly pendingCount = computed(() => this.pendingPhotos().length);
  readonly draggingSeries = signal<PhotoSeries | null>(null);
  readonly draggingIndex = signal<number | null>(null);
  readonly dropTargetIndex = signal<number | null>(null);
  readonly reorderAnnouncement = signal('');

  constructor() {
    let previousProductId: number | null | undefined;
    effect(() => {
      const productId = this.productId();
      const selected = this.selectedPhotoId();
      if (productId !== previousProductId || (selected !== null && !this.selectedPhoto())) {
        this.selectedPhotoId.set(null);
      }
      previousProductId = productId;
    });
    this.destroyRef.onDestroy(() => {
      for (const photo of this.pendingPhotos()) URL.revokeObjectURL(photo.previewUrl);
    });
  }

  selectPhoto(photo: PhotoDto): void {
    if (!this.photos().some(item => item.id === photo.id)) return;
    this.selectedPhotoId.set(this.selectedPhotoId() === photo.id ? null : photo.id);
    const productId = this.productId();
    requestAnimationFrame(() => {
      if (this.productId() !== productId || this.selectedPhoto()?.id !== photo.id) return;
      const panel = this.elementRef.nativeElement.querySelector<HTMLElement>('.photo-details');
      if (!panel?.getClientRects().length) return;
      panel.focus({ preventScroll: true });
      panel.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    });
  }

  closePhotoDetails(): void {
    const selected = this.selectedPhotoId();
    this.selectedPhotoId.set(null);
    if (selected !== null) this.elementRef.nativeElement.querySelector<HTMLElement>(`[data-photo-select="${selected}"]`)?.focus();
  }

  async makePrimary(photo: PhotoDto): Promise<void> {
    if (this.interactionDisabled() || !this.isCurrentOwnPhoto(photo)) return;
    const index = this.ownPhotos().findIndex(item => item.id === photo.id);
    if (index > 0) await this.reorderSaved(index, 0, photo.originalFilename);
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

  leads(photo: PhotoDto, role: PhotoRole): boolean {
    return (photo.leadFor ?? []).includes(role);
  }

  /** One lead per channel: giving it to this photo takes it from the one that had it. */
  readonly roleBusy = signal<number | null>(null);

  async toggleLead(photo: PhotoDto, role: PhotoRole): Promise<void> {
    const productId = this.productId();
    if (productId === null || this.interactionDisabled()
        || !this.photos().some(item => item.id === photo.id)) return;
    this.roleBusy.set(photo.id);
    try {
      const product = await this.catalog.setPhotoLead(productId, photo.id, role, !this.leads(photo, role));
      this.changed.emit(product);
      this.ui.toast(this.leads(photo, role)
        ? (role === 'WEBSITE' ? 'Website opent weer met de eerste foto' : 'Catalogus opent weer met de eerste foto')
        : (role === 'WEBSITE' ? 'Deze foto opent nu de website' : 'Deze foto opent nu de catalogus'));
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Fotokeuze opslaan mislukt'), 'err');
    } finally {
      this.roleBusy.set(null);
    }
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
