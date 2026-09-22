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
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { AuthImage } from '../../core/api/auth-image';
import { CatalogApi } from '../../core/api/catalog-api';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import { MediaApi } from '../../core/api/media-api';
import { MediaAssetSummary } from '../../core/api/media-models';
import {
  CatalogChannel,
  Product,
  ProductFamilyMember,
  ProductPhotoChoice,
  ProductPhotoOverview,
  ProductPhotoOverviewPhoto,
  ProductPhotoRoleKey,
} from '../../core/api/models';
import { FilePicker } from '../../shared/file-picker';
import { Icon } from '../../shared/icon';
import { salesPhoto } from '../../shared/sales-photo';
import { Skeleton } from '../../shared/skeleton';
import { escapeHtml, Sheet, Ui } from '../../shared/ui';
import {
  ProductPhotoChannelsRequest,
  ProductPhotoPromoteRequest,
  ProductPhotoScopeRequest,
  ProductPhotoSheet,
} from './product-photo-sheet';
import {
  PHOTO_ROLE_ORDER,
  PHOTO_UPLOAD_TYPES,
  PhotoUploadResult,
  colourPhotos,
  familyOrderWith,
  mainDiffersFromDocuments,
  movedOrder,
  photoScopeLabel,
  photoTileLabel,
  publishTargetForRole,
  roleCandidates,
  roleChoice,
  roleExplanation,
  roleSavedMessage,
  roleStatus,
  roleTitle,
  seriesInFamilyOrder,
  seriesPhotoGroups,
  signedIdForPhotoKey,
  splitPhotoFiles,
  tileRoleBadges,
  uploadSummary,
  variantShortLabel,
} from './product-photos-state';

interface StagedPhoto {
  file: File;
  previewUrl: string;
}

interface OrderDrag {
  pointerId: number;
  from: number;
  startX: number;
  startY: number;
  started: boolean;
  handle: HTMLElement;
}

/**
 * The photo section of a product that belongs to a series.
 *
 * One screen, one vocabulary: the owner first sees where each photo is used
 * (Hoofdfoto, offerte, catalogus), then the photos of this colour or of the
 * whole series. Everything comes from the server's photo overview; every
 * change is saved at once, the overview is fetched again and the editor is
 * told so the product and the series never show stale photos.
 */
@Component({
  selector: 'app-product-photos-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, FilePicker, Icon, NgTemplateOutlet, ProductPhotoSheet, Sheet, Skeleton],
  template: `
    <div class="pp" [class.pp--drop]="dropActive()" [attr.aria-busy]="busy() || loading()"
         (dragenter)="dragEnter($event)" (dragover)="dragOver($event)" (dragleave)="dragLeave($event)" (drop)="drop($event)">
      @if (dropActive()) {
        <div class="pp-drop" aria-hidden="true"><b>Laat los om toe te voegen</b><span>Daarna kies je voor welke kleuren</span></div>
      }

      @if (!overview()) {
        @if (loadError(); as error) {
          <div class="pp-error" role="alert"><span><b>Foto’s niet geladen</b><small>{{ error }}</small></span>
            <button class="btn btn--sm" type="button" (click)="reload()">Opnieuw proberen</button></div>
        } @else {
          <div class="pp-card" aria-hidden="true"><app-skeleton kind="list" [rows]="5" /></div>
          <div class="pp-grid" aria-hidden="true">@for (tile of [1, 2, 3, 4]; track tile) { <div class="skel pp-skel"></div> }</div>
          <p class="sr-only" role="status">Foto’s laden…</p>
        }
      } @else {
        <section class="pp-card" aria-labelledby="pp-roles-title">
          <header class="pp-card__head">
            <h3 id="pp-roles-title">Waar staat welke foto?</h3>
            <p>Tik op een regel om een andere foto te kiezen. Elke keuze wordt meteen bewaard.</p>
          </header>
          <ul class="pp-roles">
            @for (row of roleRows(); track row.role) {
              <li>
                <button class="pp-role" type="button" aria-haspopup="dialog" [disabled]="interactionDisabled()"
                        [attr.aria-label]="row.title + ': ' + (row.status === 'explicit' ? 'zelf gekozen' : row.status === 'automatic' ? 'automatisch' : 'nog geen foto') + '. Andere foto kiezen'"
                        (click)="openPicker(row.role)">
                  <span class="pp-thumb">
                    @if (row.photo) { <img [appAuthSrc]="row.photo.smallUrl" alt="" draggable="false" /> }
                    @else { <app-icon [name]="row.status === 'automatic' ? 'auto' : 'media'" [size]="20" /> }
                  </span>
                  <span class="pp-role__copy">
                    <span class="pp-role__title"><b>{{ row.title }}</b>
                      <span class="pp-chip" [class.pp-chip--own]="row.status === 'explicit'" [class.pp-chip--none]="row.status === 'none'">
                        {{ row.status === 'explicit' ? 'Zelf gekozen' : row.status === 'automatic' ? 'Automatisch' : 'Geen foto' }}</span>
                      @if (row.large) { <span class="pp-chip">Groot en breed</span> }
                    </span>
                    <small>{{ row.explanation }}@if (row.note) { <em>{{ row.note }}</em> }</small>
                  </span>
                  <app-icon class="pp-role__chevron" name="chevron" [size]="18" />
                </button>
              </li>
            }
          </ul>
        </section>

        <section class="pp-photos" aria-labelledby="pp-photos-title">
          <header class="pp-photos__head">
            <h3 id="pp-photos-title">Foto’s van {{ colour() }}</h3>
            <div class="pp-segment" role="group" aria-label="Welke foto’s tonen">
              <button type="button" [attr.aria-pressed]="view() === 'colour'" (click)="setView('colour')">Deze kleur <span>{{ colourList().length }}</span></button>
              <button type="button" [attr.aria-pressed]="view() === 'series'" (click)="setView('series')">Hele reeks <span>{{ overview()!.photos.length }}</span></button>
            </div>
          </header>

          <div class="pp-actions">
            <label class="btn btn--sm pp-add" [class.pp-add--off]="interactionDisabled()">
              <app-icon name="plus" [size]="17" /> Foto’s toevoegen
              <input class="pp-file" type="file" multiple [accept]="acceptTypes" [disabled]="interactionDisabled()" (change)="pickFiles($event)" />
            </label>
            <button class="btn btn--sm" type="button" [disabled]="interactionDisabled()" (click)="libraryOpen.set(true)">Uit bibliotheek</button>
            @if (view() === 'series' && orderList().length > 1) {
              <button class="btn btn--sm pp-order" type="button" [attr.aria-pressed]="reordering()" [disabled]="interactionDisabled() && !reordering()"
                      (click)="reordering.set(!reordering())"><app-icon name="grip" [size]="17" /> {{ reordering() ? 'Klaar' : 'Volgorde' }}</button>
            }
          </div>

          @if (reordering() && view() === 'series') {
            <p id="pp-order-help" class="pp-hint">Sleep aan <app-icon name="grip" [size]="13" /> of gebruik de pijltjestoetsen. De volgorde geldt voor alle kleuren en wordt meteen bewaard.</p>
            <ol class="pp-grid" aria-describedby="pp-order-help">
              @for (photo of orderList(); track photo.key; let i = $index) {
                <li class="pp-tile pp-tile--order" [class.pp-tile--dragging]="dragIndex() === i"
                    [class.pp-tile--drop]="dragIndex() !== null && dragIndex() !== i && dropIndex() === i" [attr.data-order-index]="i">
                  <img [appAuthSrc]="photo.smallUrl" alt="" draggable="false" loading="lazy" />
                  <span class="pp-pos" aria-hidden="true">{{ i + 1 }}</span>
                  <span class="pp-tile__foot"><span class="pp-tile__scope">{{ photoScopeLabel(photo, colour()) }}</span></span>
                  <button class="pp-handle" type="button" [attr.data-order-key]="photo.key" [attr.aria-disabled]="busy()"
                          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End"
                          [attr.aria-label]="'Positie ' + (i + 1) + ' van ' + orderList().length + ', ' + photoScopeLabel(photo, colour()) + '. Verplaats met de pijltjes, Home of End.'"
                          (keydown)="orderKeydown($event, i)" (pointerdown)="startDrag($event, i)" (pointermove)="moveDrag($event)"
                          (pointerup)="finishDrag($event)" (pointercancel)="cancelDrag($event)"><app-icon name="grip" [size]="18" /></button>
                </li>
              }
            </ol>
          } @else if (view() === 'series') {
            @for (group of groups(); track group.key) {
              <h4 class="pp-group">{{ group.label }} <span>{{ group.photos.length }}</span></h4>
              <ul class="pp-grid">
                @for (photo of group.photos; track photo.key) {
                  <li><ng-container *ngTemplateOutlet="tile; context: { $implicit: photo }" /></li>
                }
              </ul>
            } @empty {
              <div class="pp-empty"><b>Nog geen foto’s in deze reeks</b><small>Voeg foto’s toe; daarna kies je waar ze verschijnen.</small></div>
            }
          } @else {
            <ul class="pp-grid">
              @for (photo of colourList(); track photo.key) {
                <li><ng-container *ngTemplateOutlet="tile; context: { $implicit: photo }" /></li>
              } @empty {
                <li class="pp-empty"><b>Nog geen foto’s voor {{ colour() }}</b><small>Voeg foto’s toe, of kijk bij ‘Hele reeks’ naar de foto’s van andere kleuren.</small></li>
              }
            </ul>
          }
          @if (overview()!.photos.length && !reordering()) {
            <p class="pp-legend"><app-icon name="globe" [size]="13" /> op de website <app-icon name="book" [size]="13" /> in de catalogus · Tik op een foto voor alle keuzes.</p>
          }
        </section>
      }
      <p class="sr-only" role="status" aria-live="polite">{{ announcement() }}</p>
    </div>

    <ng-template #tile let-photo>
      <button class="pp-tile" type="button" [attr.data-photo-key]="photo.key" aria-haspopup="dialog"
              [attr.aria-label]="tileLabel(photo)" (click)="openKey.set(photo.key)">
        <img [appAuthSrc]="photo.smallUrl" alt="" draggable="false" loading="lazy" />
        @if (tileRoleBadges(photo).length || photo.duplicateOfKey) {
          <span class="pp-tile__badges" aria-hidden="true">
            @for (badge of tileRoleBadges(photo); track badge) { <span>{{ badge }}</span> }
            @if (photo.duplicateOfKey) { <span class="pp-dup">Dubbel</span> }
          </span>
        }
        <span class="pp-tile__foot" aria-hidden="true">
          <span class="pp-tile__scope" [class.pp-tile__scope--own]="photo.kind === 'OWN'">{{ photoScopeLabel(photo, colour()) }}</span>
          <span class="pp-tile__icons">
            @if (photo.visibility.website) { <app-icon name="globe" [size]="14" /> }
            @if (photo.visibility.catalogue) { <app-icon name="book" [size]="14" /> }
          </span>
        </span>
      </button>
    </ng-template>

    @if (picker(); as picker) {
      <app-sheet [title]="roleTitle(picker.role, colour())" (closed)="pickerRole.set(null)">
        <div body class="pp-picker" [attr.aria-busy]="busy()">
          <p>{{ roleExplanation(picker.role) }}</p>
          @if (picker.role === 'QUOTE' && overview()?.familyWebsiteStatus !== 'PUBLISHED') {
            <p class="pp-note">Deze reeks staat nog niet op de website. De keuze geldt zodra ze online staat.</p>
          }
          @if (picker.role === 'MAIN' && documentsDiffer()) {
            <p class="pp-note">Offertes, facturen en de productlijst tonen nu een andere foto dan de website. Kies hieronder zelf een foto; dan tonen ze allemaal dezelfde.</p>
          }
          @if (picker.role === 'CATALOGUE_DETAIL') {
            <div class="pp-size"><span id="pp-size-label">Formaat</span>
              <div class="pp-segment" role="group" aria-labelledby="pp-size-label">
                <button type="button" [attr.aria-pressed]="overview()?.catalogueDetailSize !== 'LARGE'" [disabled]="busy()" (click)="setDetailSize('STANDARD')">Standaard</button>
                <button type="button" [attr.aria-pressed]="overview()?.catalogueDetailSize === 'LARGE'" [disabled]="busy()" (click)="setDetailSize('LARGE')">Groot en breed</button>
              </div>
            </div>
          }
          <ul class="pp-picks">
            <li>
              <button class="pp-pick" type="button" [class.pp-pick--on]="!picker.choice?.explicit" [attr.aria-pressed]="!picker.choice?.explicit"
                      [disabled]="busy()" data-initial-focus (click)="pickRole(picker.role, null)"
                      [attr.aria-label]="'Automatisch' + (picker.automatic ? ', kiest nu: ' + photoScopeLabel(picker.automatic, colour()) : '')">
                @if (picker.automatic) { <img [appAuthSrc]="picker.automatic.smallUrl" alt="" draggable="false" /> }
                @else { <span class="pp-pick__auto" aria-hidden="true"><app-icon name="auto" [size]="26" /></span> }
                <span class="pp-pick__label">Automatisch</span>
                @if (!picker.choice?.explicit) { <span class="pp-pick__check" aria-hidden="true">✓</span> }
              </button>
            </li>
            @for (photo of picker.candidates; track photo.key) {
              @let selected = !!picker.choice?.explicit && picker.choice?.key === photo.key;
              @let publish = publishTargetForRole(photo, picker.role);
              <li>
                <button class="pp-pick" type="button" [class.pp-pick--on]="selected" [attr.aria-pressed]="selected" [disabled]="busy()"
                        [attr.aria-label]="photoScopeLabel(photo, colour()) + (publish ? (publish === 'website' ? ', nog niet op de website' : ', nog niet in de catalogus') : '')"
                        (click)="pickRole(picker.role, photo.key)">
                  <img [appAuthSrc]="photo.smallUrl" alt="" draggable="false" loading="lazy" />
                  <span class="pp-pick__label">{{ photoScopeLabel(photo, colour()) }}</span>
                  @if (publish) { <span class="pp-pick__publish" [class.pp-pick__publish--full]="!selected" aria-hidden="true">{{ publish === 'website' ? 'Niet online' : 'Niet in catalogus' }}</span> }
                  @if (selected) { <span class="pp-pick__check" aria-hidden="true">✓</span> }
                </button>
              </li>
            }
          </ul>
          @if (!picker.candidates.length) {
            <p class="pp-note">Er is nog geen foto die hiervoor kan. Voeg eerst foto’s toe.</p>
          } @else if (picker.publishes === 'website') {
            <p class="pp-note">Kies je een foto met ‘Niet online’? Deze foto komt dan ook op de website.</p>
          } @else if (picker.publishes === 'catalogue') {
            <p class="pp-note">Kies je een foto met ‘Niet in catalogus’? Deze foto komt dan ook in de catalogus.</p>
          }
        </div>
      </app-sheet>
    }

    @if (staged(); as files) {
      <app-sheet [title]="files.length === 1 ? 'Foto toevoegen' : files.length + ' foto’s toevoegen'" (closed)="cancelAdd()">
        <div body class="pp-add-sheet" [attr.aria-busy]="busy()">
          <ul class="pp-previews" aria-label="Gekozen foto’s">
            @for (item of files; track item.previewUrl) { <li><img [src]="item.previewUrl" [alt]="item.file.name" /></li> }
          </ul>
          @if (addError(); as error) { <p class="pp-error" role="alert"><span>{{ error }}</span></p> }
          @if (overview()?.familyId) {
            <fieldset class="pp-fieldset" [disabled]="busy()">
              <legend id="pp-add-scope">Voor welke kleuren?</legend>
              <div class="pp-segment" role="group" aria-labelledby="pp-add-scope">
                <button type="button" data-initial-focus [attr.aria-pressed]="addScope() === 'THIS_VARIANT'" (click)="addScope.set('THIS_VARIANT')">Alleen {{ colour() }}</button>
                <button type="button" [attr.aria-pressed]="addScope() === 'ALL_VARIANTS'" (click)="addScope.set('ALL_VARIANTS')">Alle kleuren</button>
              </div>
              <small>{{ addScope() === 'ALL_VARIANTS' ? 'De foto verschijnt bij elke kleur van deze reeks.' : 'De foto verschijnt alleen bij ' + colour() + '.' }}</small>
            </fieldset>
            <fieldset class="pp-fieldset" [disabled]="busy()">
              <legend>Meteen tonen op</legend>
              <button class="switch-row pp-switch" type="button" role="switch" [class.switch-row--on]="addWebsite()" [attr.aria-checked]="addWebsite()" (click)="addWebsite.set(!addWebsite())">
                <span class="switch-row__copy"><b>Website</b><small>Productpagina en galerij van deze reeks</small></span><span class="switch-row__track" aria-hidden="true"><i></i></span>
              </button>
              <button class="switch-row pp-switch" type="button" role="switch" [class.switch-row--on]="addCatalogue()" [attr.aria-checked]="addCatalogue()" (click)="addCatalogue.set(!addCatalogue())">
                <span class="switch-row__copy"><b>Catalogus</b><small>Gedrukte catalogus en catalogus-pdf</small></span><span class="switch-row__track" aria-hidden="true"><i></i></span>
              </button>
              <small>Uit laten? Dan blijft de foto intern tot je hem zelf online zet.</small>
            </fieldset>
          } @else {
            <p class="pp-note">Dit product hoort niet bij een reeks: de foto’s worden losse productfoto’s.</p>
          }
          @if (uploadProgress(); as progress) { <p class="pp-progress" role="status">Foto {{ progress.done + 1 }} van {{ progress.total }} uploaden…</p> }
        </div>
        <div foot class="pp-foot">
          <button class="btn" type="button" [disabled]="busy()" (click)="cancelAdd()">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="busy()" (click)="confirmUpload()">{{ busy() ? 'Uploaden…' : 'Toevoegen' }}</button>
        </div>
      </app-sheet>
    }

    @if (libraryOpen()) {
      <app-file-picker kind="IMAGE" [multiple]="true" title="Foto’s uit de bibliotheek" (picked)="addFromLibrary($event)" (closed)="libraryOpen.set(false)" />
    }

    @if (openKey(); as key) {
      @if (overview(); as overview) {
        <app-product-photo-sheet [photos]="sheetList()" [key]="key" (keyChange)="openKey.set($event)" [overview]="overview"
                                 [colour]="colour()" [productId]="overview.productId" [busy]="busy() || disabled()"
                                 (roleRequested)="pickRole($event.role, $event.photoKey)" (channelsRequested)="setChannels($event)"
                                 (scopeRequested)="setScope($event)" (promoteRequested)="promote($event)"
                                 (downloadRequested)="download($event)" (removeRequested)="remove($event)" (closed)="openKey.set(null)" />
      }
    }
  `,
  styles: `
    :host { display: block; min-width: 0; }
    /* The query container stays inside: containment would trap the fixed sheets below. */
    .pp { position: relative; display: grid; gap: 18px; min-width: 0; container-type: inline-size; }
    .pp--drop { outline: 2px dashed var(--rose); outline-offset: 6px; border-radius: 16px; }
    .pp-drop { position: absolute; inset: 0; z-index: 5; display: grid; place-content: center; gap: 4px; border-radius: 16px; text-align: center;
      background: color-mix(in srgb, var(--rose-soft) 92%, transparent); color: var(--rose-dark); font-size: 12px; pointer-events: none; }
    .pp-drop b { font-size: 15px; }
    h3 { font-size: 15px; font-weight: 700; letter-spacing: -.01em; }
    .pp-card { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); }
    .pp-card__head { display: grid; gap: 2px; padding: 12px 14px 11px; border-bottom: 1px solid var(--line); }
    .pp-card__head p, .pp-hint, .pp-legend, .pp-note { color: var(--muted); font-size: 12px; line-height: 1.5; }
    .pp-roles { margin: 0; padding: 0; list-style: none; }
    .pp-roles li + li { border-top: 1px solid var(--line); }
    .pp-role { display: grid; grid-template-columns: 56px minmax(0, 1fr) 18px; align-items: center; gap: 12px; width: 100%; min-height: 76px;
      padding: 10px 12px 10px 10px; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
    .pp-role:focus-visible { outline: 2px solid var(--rose); outline-offset: -3px; border-radius: 12px; }
    .pp-role:disabled { cursor: default; opacity: .6; }
    .pp-thumb { display: grid; place-items: center; width: 56px; height: 56px; overflow: hidden; border: 1px solid var(--line); border-radius: 12px;
      background: var(--surface-2); color: var(--muted-2); }
    .pp-thumb img { width: 100%; height: 100%; object-fit: contain; }
    .pp-role__copy { display: grid; gap: 3px; min-width: 0; }
    .pp-role__title { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
    .pp-role__title b { font-size: 14px; line-height: 1.3; }
    .pp-role__copy small { color: var(--muted); font-size: 12px; line-height: 1.4; }
    .pp-role__copy em { display: block; color: var(--warn); font-style: normal; font-weight: 650; }
    .pp-role__chevron { color: var(--muted-2); }
    .pp-chip { display: inline-flex; align-items: center; padding: 1px 8px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface-2);
      color: var(--muted); font-size: 11px; font-weight: 650; white-space: nowrap; }
    .pp-chip--own { border-color: var(--rose-line); background: var(--rose-soft); color: var(--rose-dark); }
    .pp-chip--none { border-color: transparent; background: var(--warn-soft); color: var(--warn); }
    .pp-photos { display: grid; gap: 12px; min-width: 0; }
    .pp-photos__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
    .pp-photos__head .pp-segment { flex: 1 1 100%; }
    .pp-segment { display: flex; gap: 4px; min-width: 0; padding: 4px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface-2); }
    .pp-segment button { display: inline-flex; flex: 1; align-items: center; justify-content: center; gap: 7px; min-width: 0; min-height: 44px; padding: 6px 10px;
      border: 0; border-radius: 10px; background: transparent; color: var(--ink-2); font-size: 13px; font-weight: 650; cursor: pointer; }
    .pp-segment button[aria-pressed=true] { background: var(--surface); color: var(--ink); box-shadow: 0 2px 6px rgb(25 36 32 / 8%); }
    .pp-segment button span { display: grid; place-items: center; min-width: 21px; height: 21px; padding-inline: 5px; border-radius: 7px;
      background: color-mix(in srgb, var(--line) 55%, transparent); font-size: 11px; }
    .pp-segment button[aria-pressed=true] span { background: var(--rose-soft); color: var(--rose); }
    .pp-segment button:disabled { opacity: .5; cursor: not-allowed; }
    .pp-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .pp-actions .btn { min-height: 44px; }
    .pp-add { position: relative; }
    .pp-add:focus-within { outline: 2px solid var(--rose); outline-offset: 2px; }
    .pp-add--off { opacity: .45; pointer-events: none; }
    .pp-file { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; }
    .pp-order[aria-pressed=true] { border-color: var(--rose); background: var(--rose-soft); color: var(--rose-dark); }
    .pp-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0; padding: 0; list-style: none; }
    @container (min-width: 481px) { .pp-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } .pp-photos__head .pp-segment { flex: 0 1 340px; } }
    @container (min-width: 760px) { .pp-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
    .pp-grid > li { min-width: 0; }
    .pp-tile { position: relative; display: block; width: 100%; aspect-ratio: 1; padding: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 14px;
      background: var(--surface-2); color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .pp-tile img { position: absolute; top: 8px; left: 8px; width: calc(100% - 16px); height: calc(100% - 44px); object-fit: contain; user-select: none; }
    .pp-tile:focus-visible, .pp-handle:focus-visible, .pp-pick:focus-visible, .pp-segment button:focus-visible, .pp-switch:focus-visible { outline: 2px solid var(--rose); outline-offset: 2px; }
    .pp-tile__badges { position: absolute; top: 6px; left: 6px; display: flex; flex-wrap: wrap; gap: 4px; max-width: calc(100% - 12px); }
    .pp-tile__badges span { padding: 2px 7px; border-radius: 999px; background: var(--rose); color: #fff; font-size: 10.5px; font-weight: 700;
      box-shadow: 0 1px 3px rgb(0 0 0 / 14%); }
    .pp-tile__badges .pp-dup { background: var(--warn); }
    .pp-tile__foot { position: absolute; right: 0; bottom: 0; left: 0; display: flex; align-items: center; justify-content: space-between; gap: 6px;
      min-height: 30px; padding: 4px 9px; border-top: 1px solid var(--line); background: var(--surface); font-size: 11px; }
    .pp-tile__scope { overflow: hidden; color: var(--ink-2); font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
    .pp-tile__scope--own { color: var(--gold); }
    .pp-tile__icons { display: flex; flex: none; gap: 5px; color: var(--rose-dark); }
    .pp-tile--order { cursor: default; }
    .pp-tile--dragging { opacity: .45; }
    .pp-tile--drop { border-color: var(--rose); box-shadow: 0 0 0 2px var(--rose); }
    .pp-pos { position: absolute; top: 6px; left: 6px; display: grid; place-items: center; min-width: 24px; height: 24px; padding-inline: 6px;
      border-radius: 999px; background: var(--ink); color: #fff; font-size: 11px; font-weight: 800; }
    .pp-handle { position: absolute; top: 4px; right: 4px; display: grid; place-items: center; width: 44px; height: 44px; padding: 0;
      border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--ink-2); cursor: grab; touch-action: none; }
    .pp-handle:active { cursor: grabbing; }
    .pp-group { display: flex; align-items: baseline; gap: 6px; margin: 4px 0 -4px; color: var(--ink-2); font-size: 12px; font-weight: 750; }
    .pp-group span { color: var(--muted); font-weight: 600; }
    .pp-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: -2px; }
    .pp-legend app-icon, .pp-hint app-icon { color: var(--rose-dark); vertical-align: -2px; }
    .pp-empty { display: grid; gap: 4px; grid-column: 1 / -1; padding: 26px 16px; border: 1px dashed var(--line-strong); border-radius: 14px;
      color: var(--muted); font-size: 12.5px; text-align: center; }
    .pp-empty b { color: var(--ink-2); font-size: 14px; }
    .pp-error { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; border-radius: 14px;
      background: var(--danger-soft); color: var(--danger); font-size: 12.5px; }
    .pp-error span { display: grid; gap: 2px; }
    .pp-skel { aspect-ratio: 1; border-radius: 14px; }
    .pp-picker, .pp-add-sheet { display: grid; gap: 14px; min-width: 0; }
    .pp-picker > p:first-child { color: var(--ink-2); font-size: 13.5px; line-height: 1.5; }
    .pp-size { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; font-size: 13px; font-weight: 650; }
    .pp-size .pp-segment { flex: 1 1 240px; }
    .pp-picks { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; }
    @media (min-width: 680px) { .pp-picks { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
    .pp-pick { position: relative; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 4px; width: 100%; aspect-ratio: 1; padding: 6px;
      overflow: hidden; border: 1px solid var(--line); border-radius: 14px; background: var(--surface-2); color: inherit; font: inherit; cursor: pointer; }
    .pp-pick img { width: 100%; height: 100%; min-height: 0; object-fit: contain; }
    .pp-pick:disabled { cursor: wait; }
    .pp-pick--on { border-color: var(--rose); box-shadow: 0 0 0 2px var(--rose); background: var(--rose-soft); }
    .pp-pick__auto { display: grid; place-items: center; color: var(--rose); }
    .pp-pick__label { overflow: hidden; color: var(--ink-2); font-size: 10.5px; font-weight: 650; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
    .pp-pick__check { position: absolute; top: 5px; right: 5px; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%;
      background: var(--rose); color: #fff; font-size: 12px; font-weight: 800; }
    .pp-pick__publish { position: absolute; top: 5px; left: 5px; max-width: calc(100% - 36px); padding: 1px 6px; overflow: hidden; border-radius: 999px;
      background: var(--warn-soft); color: var(--warn); font-size: 9.5px; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
    .pp-pick__publish--full { max-width: calc(100% - 10px); }
    .pp-previews { display: flex; gap: 8px; margin: 0; padding: 2px; overflow-x: auto; list-style: none; }
    .pp-previews li { flex: 0 0 72px; height: 72px; overflow: hidden; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2); }
    .pp-previews img { width: 100%; height: 100%; object-fit: contain; }
    .pp-fieldset { display: grid; gap: 8px; min-width: 0; margin: 0; padding: 0; border: 0; }
    .pp-fieldset legend { margin-bottom: 8px; padding: 0; color: var(--muted); font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
    .pp-fieldset small { color: var(--muted); font-size: 12px; }
    .pp-switch { width: 100%; min-height: 52px; font: inherit; color: inherit; text-align: left; }
    .pp-progress { color: var(--rose-dark); font-size: 13px; font-weight: 650; }
    .pp-foot { display: contents; }
    @media (hover: hover) and (pointer: fine) {
      .pp-role:hover { background: var(--surface-2); }
      .pp-tile:not(.pp-tile--order):hover, .pp-pick:hover { border-color: var(--line-strong); box-shadow: var(--sh-1); }
    }
    @media (prefers-reduced-motion: reduce) {
      .pp-skel::after { animation: none; }
    }
  `,
})
export class ProductPhotosPanel {
  private readonly catalog = inject(CatalogApi);
  private readonly media = inject(MediaApi);
  private readonly ui = inject(Ui);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  /** The saved product; the panel only mounts once it belongs to a saved series. */
  readonly product = input.required<Product>();
  /** Family members, only for the colour order of "Hele reeks". */
  readonly members = input<ProductFamilyMember[]>([]);
  readonly disabled = input(false);
  /** The editor bumps this when something outside the panel may have changed photos. */
  readonly revision = input(0);
  /** A photo change was saved: the editor refreshes the product and the series. */
  readonly changed = output<void>();

  readonly overview = signal<ProductPhotoOverview | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly view = signal<'colour' | 'series'>('colour');
  readonly reordering = signal(false);
  readonly pickerRole = signal<ProductPhotoRoleKey | null>(null);
  readonly openKey = signal<string | null>(null);
  readonly libraryOpen = signal(false);
  readonly staged = signal<StagedPhoto[] | null>(null);
  readonly addScope = signal<'THIS_VARIANT' | 'ALL_VARIANTS'>('THIS_VARIANT');
  readonly addWebsite = signal(false);
  readonly addCatalogue = signal(false);
  readonly addError = signal<string | null>(null);
  readonly uploadProgress = signal<{ done: number; total: number } | null>(null);
  readonly dropActive = signal(false);
  readonly dragIndex = signal<number | null>(null);
  readonly dropIndex = signal<number | null>(null);
  /** Keys in the order just asked for, shown while the server confirms it. */
  private readonly orderOverride = signal<string[] | null>(null);
  readonly announcement = signal('');

  readonly acceptTypes = PHOTO_UPLOAD_TYPES.join(',');
  readonly photoScopeLabel = photoScopeLabel;
  readonly tileRoleBadges = tileRoleBadges;
  readonly publishTargetForRole = publishTargetForRole;
  readonly roleTitle = roleTitle;
  readonly roleExplanation = roleExplanation;

  private loadVersion = 0;
  private dragDepth = 0;
  private drag: OrderDrag | null = null;
  private lastOrderToast = 0;

  readonly productId = computed(() => this.product().id);
  readonly interactionDisabled = computed(() => this.disabled() || this.busy() || !this.overview());
  readonly colour = computed(() => {
    const product = this.product();
    return variantShortLabel(product, this.members(), this.overview()?.variantLabel ?? null);
  });
  readonly colourList = computed(() => colourPhotos(this.overview()));
  readonly groups = computed(() => seriesPhotoGroups(this.overview(), this.colour(), this.members()));
  readonly orderList = computed(() => {
    const photos = seriesInFamilyOrder(this.overview());
    const override = this.orderOverride();
    if (!override) return photos;
    const byKey = new Map(photos.map((photo) => [photo.key, photo]));
    return override.map((key) => byKey.get(key)).filter((photo): photo is ProductPhotoOverviewPhoto => !!photo);
  });
  /** The photo sheet walks through exactly what the grid shows. */
  readonly sheetList = computed(() => this.view() === 'series' && !this.reordering()
    ? this.groups().flatMap((group) => group.photos)
    : this.colourList());
  /** Quotes, invoices and ERP lists print another photo than the automatic Hoofdfoto. */
  readonly documentsDiffer = computed(() => {
    const product = this.product();
    return mainDiffersFromDocuments(this.overview(), product.photos?.length ? salesPhoto(product) : null);
  });
  readonly roleRows = computed(() => {
    const overview = this.overview();
    const colour = this.colour();
    /* Series choices need a series; a product that lost its family keeps its own two. */
    const roles = overview?.familyId ? PHOTO_ROLE_ORDER : PHOTO_ROLE_ORDER.filter((role) => role === 'MAIN' || role === 'CATALOGUE_VARIANT');
    return roles.map((role) => {
      const choice = roleChoice(overview, role);
      return {
        role,
        title: roleTitle(role, colour),
        explanation: roleExplanation(role),
        photo: overview?.photos.find((photo) => photo.key === choice?.key) ?? null,
        explicit: !!choice?.explicit,
        status: roleStatus(overview, role),
        large: role === 'CATALOGUE_DETAIL' && overview?.catalogueDetailSize === 'LARGE',
        note: role === 'QUOTE' && overview?.familyWebsiteStatus !== 'PUBLISHED' ? 'Reeks staat nog niet op de website.'
          : role === 'MAIN' && this.documentsDiffer() ? 'Offertes en facturen tonen nu een andere foto. Kies er zelf een.' : '',
      };
    });
  });
  readonly picker = computed(() => {
    const role = this.pickerRole();
    const overview = this.overview();
    if (!role || !overview) return null;
    const choice: ProductPhotoChoice | null = roleChoice(overview, role);
    const candidates = roleCandidates(overview, role);
    return {
      role,
      choice,
      candidates,
      automatic: choice && !choice.explicit ? overview.photos.find((photo) => photo.key === choice.key) ?? null : null,
      publishes: candidates.map((photo) => publishTargetForRole(photo, role)).find((target) => target !== null) ?? null,
    };
  });

  constructor() {
    let shownProduct: number | null | undefined;
    effect(() => {
      const productId = this.productId();
      this.revision();
      untracked(() => {
        if (productId !== shownProduct) this.resetFor(productId);
        shownProduct = productId;
        void this.load(productId);
      });
    });
    inject(DestroyRef).onDestroy(() => this.releaseStaged());
  }

  tileLabel(photo: ProductPhotoOverviewPhoto): string {
    const list = this.sheetList();
    return photoTileLabel(photo, this.colour(), Math.max(0, list.findIndex((item) => item.key === photo.key)), list.length);
  }

  setView(view: 'colour' | 'series'): void {
    this.view.set(view);
    if (view === 'colour') this.reordering.set(false);
  }

  openPicker(role: ProductPhotoRoleKey): void {
    if (!this.interactionDisabled()) this.pickerRole.set(role);
  }

  async reload(): Promise<void> {
    await this.load(this.productId());
  }

  /* ------------------------------------------------------------ choices */

  async pickRole(role: ProductPhotoRoleKey, photoKey: string | null): Promise<void> {
    const overview = this.overview();
    const productId = overview?.productId;
    if (!overview || productId === undefined || this.interactionDisabled()) return;
    const current = roleChoice(overview, role);
    if ((photoKey === null && !current?.explicit) || (photoKey !== null && current?.explicit && current.key === photoKey)) {
      this.pickerRole.set(null);
      return;
    }
    const photo = photoKey === null ? null : overview.photos.find((item) => item.key === photoKey) ?? null;
    const published = photo ? publishTargetForRole(photo, role) : null;
    const saved = await this.run(
      () => this.catalog.setProductPhotoRole(productId, role, photoKey),
      roleSavedMessage(role, this.colour(), photoKey === null, published),
      'Fotokeuze opslaan mislukt',
    );
    if (saved) this.pickerRole.set(null);
  }

  async setDetailSize(size: 'STANDARD' | 'LARGE'): Promise<void> {
    const overview = this.overview();
    if (!overview?.familyId || overview.catalogueDetailSize === size) return;
    const stored = (choice: ProductPhotoChoice | null) => choice?.explicit ? signedIdForPhotoKey(choice.key) : null;
    await this.run(
      () => this.catalog.updateCataloguePhotos(overview.familyId!, {
        catalogueOverviewPhotoId: stored(overview.catalogueOverview),
        catalogueDetailPhotoId: stored(overview.catalogueDetail),
        catalogueDetailSize: size,
      }),
      size === 'LARGE' ? 'Grote catalogusfoto: groot en breed' : 'Grote catalogusfoto: standaard formaat',
      'Formaat opslaan mislukt',
    );
  }

  async setChannels(request: ProductPhotoChannelsRequest): Promise<void> {
    const familyId = this.overview()?.familyId;
    const imageId = request.photo.familyPhotoId;
    if (!familyId || imageId === null) return;
    const labels = { WEBSITE: 'website', CATALOGUE: 'catalogus', ORDER_APP: 'bestelapp' } as const;
    await this.run(
      () => this.catalog.updateProductFamilyImagePublication(familyId, imageId, request.channels),
      request.channels.length
        ? `Foto zichtbaar op ${request.channels.map((channel: CatalogChannel) => labels[channel]).join(', ')}`
        : 'Foto is nu alleen intern',
      'Zichtbaarheid aanpassen mislukt',
    );
  }

  async setScope(request: ProductPhotoScopeRequest): Promise<void> {
    const familyId = this.overview()?.familyId;
    const imageId = request.photo.familyPhotoId;
    if (!familyId || imageId === null) return;
    await this.run(
      () => this.catalog.updateProductFamilyImageVariant(familyId, imageId, request.variantProductId),
      request.variantProductId === null ? 'Foto geldt nu voor alle kleuren' : `Foto geldt nu alleen voor ${this.colour()}`,
      'Kleurkeuze opslaan mislukt',
    );
  }

  promote(request: ProductPhotoPromoteRequest): void {
    const productId = this.overview()?.productId;
    if (productId === undefined || this.interactionDisabled()) return;
    const go = () => void this.run(
      () => this.catalog.promoteProductPhoto(productId, request.photo.key, request.scope),
      request.cleanup ? 'Dubbele foto opgeruimd · de reeksfoto blijft'
        : request.scope === 'ALL_VARIANTS' ? 'Foto staat nu in de reeks · alle kleuren'
        : `Foto staat nu in de reeks · alleen ${this.colour()}`,
      'In de reeks zetten mislukt',
    );
    if (!request.cleanup) { go(); return; }
    this.ui.confirm({
      title: 'Dubbele foto opruimen',
      message: 'De losse kopie wordt verwijderd. De reeksfoto blijft staan en neemt de keuzes voor hoofdfoto, offerte en catalogus over.',
      confirmLabel: 'Opruimen',
    }, go);
  }

  remove(photo: ProductPhotoOverviewPhoto): void {
    const overview = this.overview();
    if (!overview || this.interactionDisabled()) return;
    const family = escapeHtml(overview.familyName || 'deze reeks');
    const message = photo.kind === 'OWN'
      ? `Deze losse productfoto verwijderen? Hij verdwijnt alleen bij <b>${escapeHtml(this.colour())}</b>.`
      : photo.scope === 'ALL_VARIANTS'
        ? `Deze reeksfoto geldt voor alle kleuren. Hij verdwijnt bij <b>alle kleuren van ${family}</b>, van de website en uit de catalogus.`
        : `Deze reeksfoto hoort bij <b>${escapeHtml(photo.scope === 'THIS_VARIANT' ? this.colour() : photo.variantLabel || 'een andere kleur')}</b>. Hij verdwijnt daar, van de website en uit de catalogus.`;
    this.ui.confirm({ title: 'Foto verwijderen', message, confirmLabel: 'Verwijderen', danger: true }, () => {
      const request = photo.kind === 'OWN'
        ? () => this.catalog.deletePhoto(overview.productId, photo.productPhotoId!)
        : () => this.catalog.deleteProductFamilyImage(overview.familyId!, photo.familyPhotoId!);
      void this.run(request, 'Foto verwijderd', 'Foto verwijderen mislukt').then((done) => {
        if (done) this.openKey.set(null);
      });
    });
  }

  async download(photo: ProductPhotoOverviewPhoto): Promise<void> {
    try {
      saveBlob(await this.catalog.photoBlob(photo.downloadUrl), photo.originalFilename);
      this.ui.toast('Origineel gedownload');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Downloaden mislukt'), 'err');
    }
  }

  /* ---------------------------------------------------------------- add */

  pickFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.stage(files);
  }

  async addFromLibrary(assets: MediaAssetSummary[]): Promise<void> {
    this.libraryOpen.set(false);
    if (!assets.length || this.interactionDisabled()) return;
    try {
      const files: File[] = [];
      for (const asset of assets) {
        const blob = await this.media.download(asset.id);
        files.push(new File([blob], asset.originalFilename || asset.name, { type: asset.contentType || blob.type }));
      }
      this.stage(files);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'De foto kon niet uit de bibliotheek worden gehaald.'), 'err');
    }
  }

  cancelAdd(): void {
    if (this.busy()) return;
    this.releaseStaged();
    this.staged.set(null);
  }

  async confirmUpload(): Promise<void> {
    const files = this.staged();
    const overview = this.overview();
    if (!files?.length || !overview || this.busy() || this.disabled()) return;
    if (!overview.familyId) {
      await this.uploadOwn(files, overview.productId);
      return;
    }
    const familyId = overview.familyId;
    const channels: CatalogChannel[] = [
      ...(this.addWebsite() ? ['WEBSITE' as const] : []),
      ...(this.addCatalogue() ? ['CATALOGUE' as const] : []),
    ];
    const variantProductId = this.addScope() === 'THIS_VARIANT' ? overview.productId : null;
    const result: PhotoUploadResult = { added: 0, existing: 0, failed: 0, publishFailed: 0, channels };
    const failed: StagedPhoto[] = [];
    let firstError: string | null = null;
    this.busy.set(true);
    this.addError.set(null);
    try {
      /* The upload answers with the whole series; a fresh id list tells new photos apart
         from a silently reused identical one, including photos the overview does not list. */
      let known = new Set((await this.catalog.productFamily(familyId)).images.map((image) => image.id));
      for (const [index, item] of files.entries()) {
        this.uploadProgress.set({ done: index, total: files.length });
        try {
          const family = await this.catalog.uploadProductFamilyImage(familyId, item.file, variantProductId);
          const added = family.images.filter((image) => !known.has(image.id));
          known = new Set(family.images.map((image) => image.id));
          if (!added.length) { result.existing++; continue; }
          result.added += added.length;
          for (const image of channels.length ? added : []) {
            try {
              await this.catalog.updateProductFamilyImagePublication(familyId, image.id, channels);
            } catch (failure: unknown) {
              result.publishFailed++;
              firstError ??= messageOf(failure, 'Online zetten mislukt.');
            }
          }
        } catch (failure: unknown) {
          result.failed++;
          failed.push(item);
          firstError ??= messageOf(failure, 'Uploaden mislukt. Controleer het bestand en probeer opnieuw.');
        }
      }
    } catch (failure: unknown) {
      result.failed = files.length;
      failed.push(...files);
      firstError = messageOf(failure, 'De reeks kon niet worden geladen. Probeer opnieuw.');
    } finally {
      this.uploadProgress.set(null);
      this.busy.set(false);
    }

    for (const item of files) if (!failed.includes(item)) URL.revokeObjectURL(item.previewUrl);
    this.staged.set(failed.length ? failed : null);
    this.addError.set(failed.length ? firstError : null);
    if (result.added || result.existing) {
      await this.reload();
      this.changed.emit();
    }
    const summary = uploadSummary(result);
    this.ui.toast(!summary.ok && firstError && !failed.length ? `${summary.text}. ${firstError}` : summary.text, summary.ok ? 'ok' : 'err');
  }

  /** Without a series the files become own photos, exactly like the classic photo manager. */
  private async uploadOwn(files: StagedPhoto[], productId: number): Promise<void> {
    const failed: StagedPhoto[] = [];
    let firstError: string | null = null;
    this.busy.set(true);
    try {
      for (const [index, item] of files.entries()) {
        this.uploadProgress.set({ done: index, total: files.length });
        try {
          await this.catalog.uploadPhoto(productId, item.file);
          URL.revokeObjectURL(item.previewUrl);
        } catch (failure: unknown) {
          failed.push(item);
          firstError ??= messageOf(failure, 'Uploaden mislukt. Controleer het bestand en probeer opnieuw.');
        }
      }
    } finally {
      this.uploadProgress.set(null);
      this.busy.set(false);
    }
    this.staged.set(failed.length ? failed : null);
    this.addError.set(firstError);
    const added = files.length - failed.length;
    if (added) {
      await this.reload();
      this.changed.emit();
    }
    this.ui.toast(uploadSummary({ added, existing: 0, failed: failed.length, publishFailed: 0, channels: [] }).text, failed.length ? 'err' : 'ok');
  }

  dragEnter(event: DragEvent): void {
    if (!this.carriesFiles(event)) return;
    event.preventDefault();
    this.dragDepth++;
    if (!this.interactionDisabled()) this.dropActive.set(true);
  }

  dragOver(event: DragEvent): void {
    if (!this.carriesFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = this.interactionDisabled() ? 'none' : 'copy';
  }

  dragLeave(event: DragEvent): void {
    if (!this.carriesFiles(event)) return;
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (!this.dragDepth) this.dropActive.set(false);
  }

  drop(event: DragEvent): void {
    if (!this.carriesFiles(event)) return;
    event.preventDefault();
    this.dragDepth = 0;
    this.dropActive.set(false);
    this.stage(Array.from(event.dataTransfer?.files ?? []));
  }

  /* ------------------------------------------------------------ reorder */

  orderKeydown(event: KeyboardEvent, index: number): void {
    const last = this.orderList().length - 1;
    const target = ({ ArrowLeft: index - 1, ArrowUp: index - 1, ArrowRight: index + 1, ArrowDown: index + 1, Home: 0, End: last } as Record<string, number>)[event.key];
    if (target === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    void this.moveOrder(index, target, true);
  }

  startDrag(event: PointerEvent, index: number): void {
    if (this.busy() || event.button !== 0) return;
    const handle = event.currentTarget as HTMLElement;
    this.drag = { pointerId: event.pointerId, from: index, startX: event.clientX, startY: event.clientY, started: false, handle };
    try { handle.setPointerCapture(event.pointerId); } catch { this.drag = null; }
  }

  moveDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.started && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 7) return;
    event.preventDefault();
    if (!drag.started) {
      drag.started = true;
      this.dragIndex.set(drag.from);
      this.dropIndex.set(drag.from);
    }
    const tile = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-order-index]');
    const target = Number(tile?.dataset['orderIndex']);
    if (tile && Number.isInteger(target)) this.dropIndex.set(target);
  }

  finishDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const target = this.dropIndex();
    this.endDrag();
    if (drag.started && target !== null) void this.moveOrder(drag.from, target, false);
  }

  cancelDrag(event: PointerEvent): void {
    if (this.drag?.pointerId === event.pointerId) this.endDrag();
  }

  /* ------------------------------------------------------------ private */

  private resetFor(productId: number | null): void {
    ++this.loadVersion;
    this.overview.set(null);
    this.loadError.set(null);
    this.view.set('colour');
    this.reordering.set(false);
    this.pickerRole.set(null);
    this.openKey.set(null);
    this.orderOverride.set(null);
    if (!this.busy()) {
      this.releaseStaged();
      this.staged.set(null);
    }
    if (productId === null) this.loading.set(false);
  }

  private async load(productId: number | null): Promise<void> {
    const version = ++this.loadVersion;
    if (productId === null) return;
    this.loading.set(true);
    try {
      const overview = await this.catalog.productPhotoOverview(productId);
      if (version === this.loadVersion) this.apply(overview);
    } catch (failure: unknown) {
      if (version !== this.loadVersion) return;
      this.loading.set(false);
      this.loadError.set(messageOf(failure, 'Controleer de verbinding en probeer opnieuw.'));
    }
  }

  private apply(overview: ProductPhotoOverview): void {
    if (overview.productId !== this.productId()) return;
    /* The newest server answer wins over any reload still under way. */
    ++this.loadVersion;
    this.loading.set(false);
    this.loadError.set(null);
    this.overview.set(overview);
    const open = this.openKey();
    if (open && !overview.photos.some((photo) => photo.key === open)) this.openKey.set(null);
  }

  /**
   * One road for every change: save, show the server's answer, tell the
   * editor, and say what happened. A failure reloads, because the server may
   * have done part of the work (a publication before a lead, for example).
   */
  private async run(request: () => Promise<unknown>, success: string, failureText: string): Promise<boolean> {
    const productId = this.productId();
    if (productId === null || this.interactionDisabled()) return false;
    this.busy.set(true);
    try {
      const answer = await request();
      if (this.productId() !== productId) return false;
      if (isOverview(answer)) this.apply(answer); else await this.load(productId);
      this.ui.toast(success);
      this.announcement.set(success);
      this.changed.emit();
      return true;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, failureText), 'err');
      if (this.productId() === productId) await this.load(productId);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private async moveOrder(from: number, to: number, keyboard: boolean): Promise<void> {
    const overview = this.overview();
    const current = this.orderList();
    const next = movedOrder(current, from, to);
    if (!overview?.familyId || !next || this.interactionDisabled()) return;
    const familyId = overview.familyId;
    const moved = current[from];
    const target = next.indexOf(moved);
    this.orderOverride.set(next.map((photo) => photo.key));
    if (keyboard) this.focusHandle(moved.key);
    this.busy.set(true);
    try {
      const family = await this.catalog.productFamily(familyId);
      const allIds = [...family.images].sort((left, right) => left.position - right.position).map((image) => image.id);
      await this.catalog.reorderProductFamilyImages(familyId, familyOrderWith(allIds, next.map((photo) => photo.familyPhotoId!)));
      await this.load(overview.productId);
      const message = `Foto staat nu op positie ${target + 1} van ${next.length}`;
      this.announcement.set(message);
      /* Arrow keys save each step; one toast per burst is enough. */
      if (Date.now() - this.lastOrderToast > 3000) this.ui.toast('Volgorde bewaard · geldt voor alle kleuren');
      this.lastOrderToast = Date.now();
      this.changed.emit();
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Volgorde aanpassen mislukt'), 'err');
      await this.load(overview.productId);
    } finally {
      this.orderOverride.set(null);
      this.busy.set(false);
    }
    if (keyboard) this.focusHandle(moved.key);
  }

  /** A moved tile is re-inserted in the list, which drops keyboard focus; hand it back. */
  private focusHandle(key: string): void {
    setTimeout(() => requestAnimationFrame(() => this.host.nativeElement
      .querySelector<HTMLElement>(`[data-order-key="${key}"]`)?.focus()));
  }

  private endDrag(): void {
    const drag = this.drag;
    try {
      if (drag?.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
    } catch {
      /* A cancelled pointer is already released by the browser. */
    }
    this.drag = null;
    this.dragIndex.set(null);
    this.dropIndex.set(null);
  }

  private stage(files: File[]): void {
    if (!files.length || this.interactionDisabled()) return;
    const { accepted, skipped } = splitPhotoFiles(files);
    if (skipped) this.ui.toast(skipped, 'err');
    if (!accepted.length) return;
    this.releaseStaged();
    this.addError.set(null);
    /* Every batch starts from the safe defaults: this colour, not yet online. */
    this.addScope.set('THIS_VARIANT');
    this.addWebsite.set(false);
    this.addCatalogue.set(false);
    this.staged.set(accepted.map((file) => ({ file, previewUrl: URL.createObjectURL(file) })));
  }

  private releaseStaged(): void {
    for (const item of this.staged() ?? []) URL.revokeObjectURL(item.previewUrl);
  }

  private carriesFiles(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
  }
}

function isOverview(value: unknown): value is ProductPhotoOverview {
  return !!value && typeof value === 'object' && Array.isArray((value as ProductPhotoOverview).photos)
    && 'productId' in value && 'main' in value;
}
