import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  TemplateRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthImage } from '../../core/api/auth-image';
import { CatalogApi } from '../../core/api/catalog-api';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import { MediaApi } from '../../core/api/media-api';
import { MediaAssetSummary } from '../../core/api/media-models';
import {
  CatalogChannel,
  PhotoPlace,
  Product,
  ProductFamilyMember,
  ProductPhotoOverview,
  ProductPhotoOverviewPhoto,
  ProductPhotoRoleKey,
} from '../../core/api/models';
import { FilePicker } from '../../shared/file-picker';
import { formatBytes } from '../../shared/format-bytes';
import { Icon } from '../../shared/icon';
import { SegmentOption, Segmented } from '../../shared/segmented';
import { escapeHtml, Sheet, Ui } from '../../shared/ui';
import { WebsiteSyncStore } from '../settings/website-sync-store';
import { ProductPhotoColours } from './product-photo-colours';
import { PhotoCompareNeighbour, ProductPhotoPicker } from './product-photo-picker';
import {
  ProductPhotoChannelsRequest,
  ProductPhotoPromoteRequest,
  ProductPhotoScopeRequest,
  ProductPhotoSheet,
} from './product-photo-sheet';
import {
  PHOTO_MESSAGES,
  PHOTO_UPLOAD_TYPES,
  SERIES_STRIP_LINE,
  SERIES_STRIP_TITLE,
  PhotoPickerKind,
  PhotoUploadResult,
  PlaceAction,
  PlaceCard,
  PlaceCardKey,
  PlaceEvent,
  ResolvedPlaces,
  TileFoot,
  addSheetTexts,
  addWarning,
  catalogueAssumptionLine,
  cataloguePlaceFor,
  changedLine,
  changedPlaces,
  channelSavedMessage,
  cleanupScope,
  colourPhotos,
  colourStatus,
  deleteTexts,
  documentsMovedNote,
  duplicatesNote,
  familyOrderWith,
  galleryTexts,
  movedOrder,
  orderSavedMessage,
  otherColourRow,
  photoKeyForSignedId,
  photoTileLabel,
  pickerModel,
  pickerTarget,
  placeCards,
  placeSavedMessage,
  placeShowsChoice,
  placesHeading,
  resolvedPlaces,
  scopeConfirm,
  scopeSavedMessage,
  selectedChannels,
  seriesAttention,
  seriesInFamilyOrder,
  seriesLive,
  seriesPhotoGroups,
  seriesRows,
  signedIdForPhotoKey,
  splitPhotoFiles,
  standingNotes,
  switchLock,
  syncPill,
  tileFoot,
  tileUses,
  uploadSummary,
  uploadUseMessage,
  uploadUseVerdict,
  uploadedImage,
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

/** The "Ook tonen als extra foto" switches of a series photo as they stood before a choice. */
export interface PhotoSwitchMemory {
  key: string;
  imageId: number;
  channels: CatalogChannel[];
}

/** The other colours of the series, fetched fresh each time they are looked at. */
export interface OtherColoursState {
  state: 'loading' | 'ready' | 'failed';
  overviews: ProductPhotoOverview[];
}

/** The last choice of this session: what the undo line in the card and the toast take back. */
export interface PhotoPlaceChange {
  kind: PhotoPickerKind;
  role: ProductPhotoRoleKey;
  /** The card that carries the undo line; null for a series row. */
  card: PlaceCardKey | null;
  /** The stored choice before the change; null = it was automatic. */
  previousKey: string | null;
  newKey: string | null;
  /**
   * The role call switches the website or the catalogue on for the photo it
   * is given, on the first tap and on the undo call. These are the switches of
   * the new and of the previous photo before the first tap; undo puts them back.
   */
  restore: PhotoSwitchMemory[];
}

/**
 * The photo section of a product that belongs to a series.
 *
 * It opens with what customers see for this colour in three fixed places
 * (Website, Catalogus, Offertes en facturen), then the four photos that
 * count for the whole series, then every photo with its use in words. Each
 * picture is what the server says a place shows; nothing is drawn before the
 * server answered. Every change is saved at once, the overview is applied or
 * fetched again and the editor is told.
 */
@Component({
  selector: 'app-product-photos-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, FilePicker, Icon, NgTemplateOutlet, ProductPhotoColours, ProductPhotoPicker, ProductPhotoSheet, RouterLink, Segmented, Sheet],
  template: `
    <!-- The status pill: the editor draws this template in the section head, next to "Foto's". -->
    <ng-template #pill>
      @if (syncPill(); as state) {
        @if (state.action === 'translations') {
          <a class="pp-pill pp-pill--warn" routerLink="/website" fragment="translation-work"><i aria-hidden="true"></i>{{ state.text }}</a>
        } @else if (state.action; as action) {
          <button [class]="'pp-pill pp-pill--' + state.tone" type="button" (click)="pillTap(action)"><i aria-hidden="true"></i>{{ state.text }}</button>
        } @else {
          <span [class]="'pp-pill pp-pill--' + state.tone" role="status"><i aria-hidden="true"></i>{{ state.text }}</span>
        }
      }
    </ng-template>

    <div class="pp" [class.pp--drop]="dropActive()" [attr.aria-busy]="busy() || loading()" (click)="rememberControl($event)"
         (dragenter)="dragEnter($event)" (dragover)="dragOver($event)" (dragleave)="dragLeave($event)" (drop)="drop($event)">
      @if (dropActive()) {
        <div class="pp-drop" aria-hidden="true"><b>Laat los om toe te voegen</b><span>Daarna kies je bij welke kleuren de foto hoort</span></div>
      }

      @if (!overview()) {
        @if (loadError(); as error) {
          <div class="pp-error" role="alert"><span><b>Foto’s niet geladen</b><small>{{ error }}</small></span>
            <button class="btn btn--sm" type="button" (click)="reload()">Opnieuw proberen</button></div>
        } @else {
          <div class="pp-skels" aria-hidden="true">
            <div class="skel pp-skel pp-skel--line"></div>
            <div class="places">@for (card of [1, 2, 3]; track card) { <div class="skel pp-skel pp-skel--card" [class.place--docs]="card === 3"></div> }</div>
            <div class="skel pp-skel pp-skel--strip"></div>
            <div class="gl-grid">@for (tile of [1, 2, 3, 4]; track tile) { <div class="skel pp-skel pp-skel--tile"></div> }</div>
          </div>
          <p class="sr-only" role="status">Foto’s laden…</p>
        }
      } @else {
        <section class="pl" aria-labelledby="pp-places-title">
          <header class="pl-head">
            <h3 id="pp-places-title">@if (colourHex(); as hex) { <i class="pp-dot" [style.background]="hex" aria-hidden="true"></i> }{{ heading().title }}</h3>
            <p>{{ heading().line }}</p>
          </header>
          <ul class="places">
            @for (card of cards(); track card.key) {
              @let change = lastChange()?.card === card.key ? changedText() : null;
              <li class="place" [class.place--docs]="card.key === 'documents'" [class.place--changed]="!!change"
                  [attr.aria-labelledby]="'pp-place-' + card.key" [attr.data-place]="card.key">
                <div class="place__name" [id]="'pp-place-' + card.key"><app-icon [name]="card.icon" [size]="16" />{{ card.name }}</div>
                @if (card.photo; as photo) {
                  @if (listed(photo.key)) {
                    <button class="place__pic" type="button" aria-haspopup="dialog" [attr.aria-label]="card.enlargeLabel" (click)="openPhoto(photo.key)">
                      <img [appAuthSrc]="photo.smallUrl" [alt]="card.alt" draggable="false" />
                      <span class="place__zoom" aria-hidden="true"><app-icon name="expand" [size]="14" /></span>
                    </button>
                  } @else {
                    <div class="place__pic"><img [appAuthSrc]="photo.smallUrl" [alt]="card.alt" draggable="false" /></div>
                  }
                } @else {
                  <div class="place__pic place__pic--none"><app-icon name="image" [size]="22" /><span>{{ card.emptyLabel }}</span></div>
                }
                <div class="place__meta">
                  <span [class]="'pp-chip pp-chip--' + card.tone" [id]="'pp-chip-' + card.key">{{ card.chip }}</span>
                  @if (card.reason; as reason) {
                    <p class="place__why">
                      @if (card.chosenThumb; as thumb) { <img [appAuthSrc]="thumb.smallUrl" alt="Je gekozen foto" draggable="false" /> }
                      <span><b>{{ reason.strong }}</b> {{ reason.rest }}</span>
                    </p>
                  }
                  @if (change) {
                    <p class="place__done" role="status"><span>{{ change.short }}<span class="pp-long">{{ change.long }}</span></span>
                      <button class="pp-link" type="button" [disabled]="interactionDisabled()" (click)="undo()">{{ change.undo }}</button></p>
                  } @else {
                    <p class="place__cap" [id]="'pp-cap-' + card.key">{{ card.caption }}</p>
                  }
                </div>
                <div class="place__act">
                  @if (card.text; as text) {
                    <p class="place__same">@if (card.textIcon) { <app-icon name="link" [size]="14" /> }<span>{{ text }}</span></p>
                  }
                  @for (action of card.actions; track action.id) {
                    <button class="btn" type="button" [class.btn--primary]="action.filled" [disabled]="interactionDisabled()"
                            [attr.aria-haspopup]="action.id === 'pick' ? 'dialog' : null" [attr.aria-label]="action.ariaLabel"
                            [attr.aria-describedby]="'pp-chip-' + card.key + ' pp-cap-' + card.key" [attr.data-action]="action.id"
                            (click)="cardAction(card, action)">{{ action.label }}</button>
                  }
                </div>
              </li>
            }
          </ul>
          <p class="pl-links">
            @if (overview()!.websitePageUrl; as url) {
              <a class="pp-link" [href]="url" target="_blank" rel="noopener">Bekijk de productpagina<app-icon name="external" [size]="14" /></a>
            }
            <a class="pp-link" routerLink="/catalog-export">Maak catalogus-pdf<app-icon name="chevron-right" [size]="14" /></a>
          </p>
        </section>

        @if (notes().length) {
          <div class="notes">
            @for (note of notes(); track note.id) {
              <p class="note" [attr.data-note]="note.id">
                @if (note.photo; as photo) { <img [appAuthSrc]="photo.smallUrl" [alt]="note.alt" draggable="false" /> } @else { <span></span> }
                <span><b>{{ note.strong }}</b> {{ note.rest }}</span>
                @if (note.action; as action) {
                  <button class="btn btn--sm" type="button" [disabled]="interactionDisabled()"
                          (click)="action.picker ? openPicker(action.picker) : openReorder()">
                    @if (action.id === 'reorder') { <app-icon name="order" [size]="15" /> }{{ action.label }}</button>
                }
              </p>
            }
          </div>
        }

        @if (rows().length) {
          <div class="pp-series">
            <details class="sr" [open]="seriesOpen() || wide()" (toggle)="seriesToggled($event)">
              <summary [attr.tabindex]="wide() ? -1 : null" (click)="wide() && $event.preventDefault()">
                <span class="sr__thumbs" aria-hidden="true">
                  @for (row of rows(); track row.key) { @if (row.photo; as photo) { <img [appAuthSrc]="photo.smallUrl" alt="" draggable="false" /> } }
                </span>
                <span class="sr__title"><b>{{ stripTitle }}</b><small>{{ wide() ? stripLine : attention() || stripLine }}</small></span>
                <app-icon class="sr__chev" name="chevron-down" [size]="18" />
              </summary>
              <div class="sr__rows">
                @for (row of rows(); track row.key) {
                  <div class="sr-row" [attr.data-row]="row.key">
                    @if (row.photo; as photo) { <img [appAuthSrc]="photo.smallUrl" alt="" draggable="false" /> }
                    @else { <span class="sr-row__none" aria-hidden="true"><app-icon name="image" [size]="20" /></span> }
                    <div class="sr-row__body"><b>{{ row.name }}</b>@if (row.why) { <span>{{ row.why }}</span> }
                      <span [class]="'pp-chip pp-chip--' + row.tone">{{ row.chip }}</span></div>
                    @if (row.action; as action) {
                      <button class="btn btn--sm" type="button" [disabled]="interactionDisabled()" [attr.aria-label]="action.ariaLabel"
                              [attr.aria-haspopup]="action.picker ? 'dialog' : null"
                              (click)="action.picker ? openPicker(action.picker) : openReorder()">{{ action.label }}</button>
                    }
                  </div>
                }
              </div>
            </details>
            <p class="pp-quiet">{{ assumption() }}</p>
          </div>
        }

        @if (otherMembers().length) {
          <app-product-photo-colours [rows]="otherRows()" [state]="others()?.state ?? null" [open]="othersOpen()"
                                     (toggled)="othersToggled($event)" (retry)="loadOthers()" />
        }

        <section class="gl" id="pp-gallery" aria-labelledby="pp-photos-title">
          <header class="gl__head">
            <h3 id="pp-photos-title">{{ reordering() ? 'Volgorde op de website' : gallery().heading }}</h3>
            <app-segmented class="pp-seg" variant="ios" semantics="radio" label="Welke foto’s tonen" [options]="viewOptions()" [value]="view()"
                           (changed)="setView($event === 'series' ? 'series' : 'colour')" />
            <div class="gl__actions">
              <label class="btn pp-add" [class.pp-add--off]="interactionDisabled()">
                <app-icon name="plus" [size]="17" /> Foto toevoegen
                <input class="pp-file" type="file" multiple [accept]="acceptTypes" [disabled]="interactionDisabled()" (change)="pickFiles($event)" />
              </label>
              @if (view() === 'series' && (orderList().length > 1 || reordering())) {
                <button class="btn pp-order" type="button" [attr.aria-pressed]="reordering()" [disabled]="interactionDisabled() && !reordering()"
                        (click)="reordering.set(!reordering())"><app-icon name="order" [size]="17" /> {{ reordering() ? 'Klaar' : 'Volgorde op de website' }}</button>
              }
            </div>
          </header>

          @if (reordering() && view() === 'series') {
            <p id="pp-order-help" class="pp-hint">Sleep aan <app-icon name="grip" [size]="13" /> of gebruik de pijltjestoetsen. Foto 1 opent de productpagina, voor alle kleuren. De volgorde bepaalt ook welke foto een kleur automatisch krijgt op de website, op offertes en in de catalogus. Elke verplaatsing wordt meteen bewaard.</p>
            <ol class="gl-grid" aria-describedby="pp-order-help">
              @for (photo of orderList(); track photo.key; let i = $index) {
                <li class="gl-tile gl-tile--order" [class.gl-tile--dragging]="dragIndex() === i"
                    [class.gl-tile--drop]="dragIndex() !== null && dragIndex() !== i && dropIndex() === i" [attr.data-order-index]="i">
                  <span class="gl-tile__pic"><img [appAuthSrc]="photo.smallUrl" alt="" draggable="false" loading="lazy" /></span>
                  <span class="pp-pos" aria-hidden="true">{{ i + 1 }}</span>
                  <span class="gl-tile__foot">{{ photo.key === openingKey() ? 'Opent de productpagina' : whose(photo) }}</span>
                  <button class="pp-handle" type="button" [attr.data-order-key]="photo.key" [attr.aria-disabled]="busy()"
                          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End"
                          [attr.aria-label]="'Positie ' + (i + 1) + ' van ' + orderList().length + ', ' + whose(photo) + (photo.key === openingKey() ? ', opent de productpagina' : '') + '. Verplaats met de pijltjes, Home of End.'"
                          (keydown)="orderKeydown($event, i)" (pointerdown)="startDrag($event, i)" (pointermove)="moveDrag($event)"
                          (pointerup)="finishDrag($event)" (pointercancel)="cancelDrag($event)"><app-icon name="grip" [size]="18" /></button>
                </li>
              } @empty {
                <li class="pp-empty"><b>Er staat nog geen foto van deze reeks op de website.</b></li>
              }
            </ol>
            @if (orderRest().length) {
              <h4 class="gl-group">Niet op de website <span>{{ orderRest().length }}</span></h4>
              <ul class="gl-grid">
                @for (photo of orderRest(); track photo.key) {
                  <li class="gl-tile gl-tile--order"><span class="gl-tile__pic"><img [appAuthSrc]="photo.smallUrl" alt="" draggable="false" loading="lazy" /></span>
                    <span class="gl-tile__foot">{{ whose(photo) }}</span></li>
                }
              </ul>
            }
          } @else if (view() === 'series') {
            @for (group of shownGroups(); track group.key) {
              <h4 class="gl-group"><b [title]="group.label">{{ group.label }}</b> <span>{{ group.photos.length }}</span></h4>
              <ul class="gl-grid">
                @for (photo of group.photos; track photo.key) {
                  <li><ng-container *ngTemplateOutlet="tile; context: { $implicit: photo }" /></li>
                }
              </ul>
            } @empty {
              <div class="pp-empty"><b>{{ gallery().emptyTitle }}</b><small>{{ gallery().emptyText }}</small></div>
            }
          } @else {
            <ul class="gl-grid">
              @for (photo of shownColour(); track photo.key) {
                <li><ng-container *ngTemplateOutlet="tile; context: { $implicit: photo }" /></li>
              } @empty {
                <li class="pp-empty"><b>{{ gallery().emptyTitle }}</b><small>{{ gallery().emptyText }}</small></li>
              }
            </ul>
          }
          @if (!reordering()) {
            @if (duplicates(); as doubles) {
              @if (doubles.length) {
                @let double = duplicateNote();
                <p class="gl-dup"><img [appAuthSrc]="doubles[0].smallUrl" alt="" draggable="false" />
                  <span><b>{{ double.strong }}</b> {{ double.rest }}</span>
                  <button class="btn btn--sm" type="button" [disabled]="interactionDisabled()" (click)="cleanDuplicate()">{{ double.action }}</button></p>
              }
            }
            <p class="gl-lib">Staat de foto al bij Documenten &amp; media?
              <button class="pp-link" type="button" aria-haspopup="dialog" [disabled]="interactionDisabled()" (click)="libraryOpen.set(true)">Kies uit bibliotheek</button></p>
          }
        </section>
      }
      <p class="sr-only" role="status" aria-live="polite">{{ announcement() }}</p>
    </div>

    <ng-template #tile let-photo>
      @let foot = footOf(photo);
      <button class="gl-tile" type="button" [attr.data-photo-key]="photo.key" aria-haspopup="dialog"
              [attr.aria-label]="tileLabel(photo)" (click)="openKey.set(photo.key)">
        <span class="gl-tile__pic"><img [appAuthSrc]="photo.smallUrl" alt="" draggable="false" loading="lazy" /></span>
        <span class="gl-tile__foot" [class.gl-tile__foot--quiet]="foot.quiet" aria-hidden="true">
          @for (chip of foot.chips; track chip.label) { <span [class]="'pp-chip pp-chip--' + chip.tone">{{ chip.label }}</span> }
          @if (foot.text) { <span class="gl-tile__also">{{ foot.text }}</span> }
        </span>
      </button>
    </ng-template>

    @if (picker(); as model) {
      <app-product-photo-picker [kind]="model.kind" [texts]="model.texts" [current]="model.current" [candidates]="model.tiles"
                                [busyKey]="pickerBusyKey()" [uploading]="uploadStage()" [detailSize]="model.detailSize"
                                [compareNeighbours]="compareNeighbours()" [disabled]="disabled() || busy()"
                                (picked)="pickFromPicker($event)" (cleared)="clearFromPicker()" (uploadRequested)="uploadFromPicker($event)"
                                (sizeChanged)="setDetailSize($event)" (compareOpened)="compareOpened()" (closed)="closePicker()" />
    }

    @if (staged(); as files) {
      @let add = addTexts();
      <app-sheet [title]="add.title" (closed)="cancelAdd()">
        <div body class="pp-add-sheet" [attr.aria-busy]="busy()">
          <ul class="pp-previews" aria-label="Gekozen foto’s">
            @for (item of files; track item.previewUrl) {
              <li><img [src]="item.previewUrl" alt="" /><span><b [title]="item.file.name">{{ item.file.name }}</b><small>{{ fileSize(item.file.size) }}</small></span></li>
            }
          </ul>
          @if (addError(); as error) { <p class="pp-error" role="alert"><span>{{ error }}</span></p> }
          @if (overview()?.familyId) {
            <div class="pp-field">
              <h4>{{ add.scopeLabel }}</h4>
              <app-segmented class="pp-seg" variant="ios" semantics="radio" [label]="add.scopeLabel" [options]="addScopeOptions()" [value]="addScope()"
                             (changed)="!busy() && addScope.set($event === 'ALL_VARIANTS' ? 'ALL_VARIANTS' : 'THIS_VARIANT')" />
              <small>{{ add.scopeHelp }}</small>
            </div>
            <fieldset class="pp-field" [disabled]="busy()">
              <legend>{{ add.extraLabel }}</legend>
              <button class="switch-row pp-switch" type="button" role="switch" [class.switch-row--on]="addWebsite()" [attr.aria-checked]="addWebsite()" (click)="addWebsite.set(!addWebsite())">
                <span class="switch-row__copy"><b>{{ add.website.label }}</b><small>{{ add.website.help }}</small></span><span class="switch-row__track" aria-hidden="true"><i></i></span>
              </button>
              <button class="switch-row pp-switch" type="button" role="switch" [class.switch-row--on]="addCatalogue()" [attr.aria-checked]="addCatalogue()" (click)="addCatalogue.set(!addCatalogue())">
                <span class="switch-row__copy"><b>{{ add.catalogue.label }}</b><small>{{ add.catalogue.help }}</small></span><span class="switch-row__track" aria-hidden="true"><i></i></span>
              </button>
              <small>{{ add.extraHelp }}</small>
            </fieldset>
            @if (addWarningText(); as warning) { <p class="pp-warn"><app-icon name="alert" [size]="16" /><span>{{ warning }}</span></p> }
            <p class="pp-tip"><app-icon name="info" [size]="16" /><span>{{ add.tip.rest }} <b>{{ add.tip.strong }}</b> {{ add.tip.tail }}</span></p>
          } @else {
            <p class="pp-quiet">Dit product hoort niet bij een reeks: de foto’s horen alleen bij dit product.</p>
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
                                 [places]="places()" [otherPhotos]="overview.otherPhotos ?? []" [reference]="reference()"
                                 (roleRequested)="pickRole($event.role, $event.photoKey)" (channelsRequested)="setChannels($event)"
                                 (scopeRequested)="setScope($event)" (promoteRequested)="promote($event)"
                                 (downloadRequested)="download($event)" (removeRequested)="remove($event)"
                                 (reorderRequested)="openReorder()" (closed)="openKey.set(null)" />
      }
    }
  `,
  styles: `
    :host { display: block; min-width: 0; }
    /* The query container stays inside: containment would trap the fixed sheets below. */
    .pp { position: relative; display: grid; gap: 18px; min-width: 0; container: pp / inline-size; }
    .pp--drop { outline: 2px dashed var(--rose); outline-offset: 6px; border-radius: 16px; }
    .pp-drop { position: absolute; inset: 0; z-index: 5; display: grid; place-content: center; gap: 4px; border-radius: 16px; text-align: center;
      background: color-mix(in srgb, var(--rose-soft) 92%, transparent); color: var(--rose-dark); font-size: 12.5px; pointer-events: none; }
    .pp-drop b { font-size: 15px; }
    .pp :is(button, a, summary, label):focus-visible, .pp-add:focus-within, .pp-switch:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
    h3 { font-size: 16px; font-weight: 700; letter-spacing: -.015em; }
    ul, ol { margin: 0; padding: 0; list-style: none; }
    img { user-select: none; }
    .pp-pill { display: inline-flex; align-items: center; gap: 7px; min-height: 30px; padding: 4px 12px; border: 1px solid var(--line); border-radius: 999px;
      background: var(--surface); color: var(--ink-2); font: inherit; font-size: 12.5px; font-weight: 650; line-height: 1.3; text-align: left; }
    .pp-pill i { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--muted-2); }
    .pp-pill--ok i { background: var(--ok); } .pp-pill--warn i { background: var(--warn); } .pp-pill--danger i { background: var(--danger); }
    :is(a, button).pp-pill { min-height: 44px; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
    :is(a, button).pp-pill:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
    .pp-chip { display: inline-block; max-width: 100%; padding: 2px 9px; overflow: hidden; border: 1px solid var(--line); border-radius: 12px; background: #f1ede9;
      color: var(--ink-2); font-size: 11.5px; font-weight: 650; line-height: 1.5; text-overflow: ellipsis; white-space: nowrap; }
    .pp-chip--accent { border-color: var(--rose-line); background: var(--rose-soft); color: var(--rose-dark); }
    .pp-chip--warn { border-color: #f0dcbc; background: var(--warn-soft); color: #7c450b; }
    .pp-quiet, .pp-hint, .gl-lib, .pp-field small { color: #6a615b; font-size: 12px; line-height: 1.45; }
    .pp-hint app-icon { vertical-align: -2px; }
    .pp-link { display: inline-flex; align-items: center; gap: 5px; min-height: 44px; padding: 0; border: 0; background: none; color: var(--rose-dark);
      font: inherit; font-size: 12.5px; font-weight: 650; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
    .pp-link:disabled { opacity: .5; cursor: default; }
    .pp-dot { display: inline-block; flex: none; width: 12px; height: 12px; border-radius: 50%; background: var(--muted-2); box-shadow: inset 0 0 0 1px rgb(0 0 0 / 12%); }

    .pl-head h3 { display: flex; align-items: center; gap: 8px; font-size: 17px; overflow-wrap: anywhere; }
    .pl-head p { margin-top: 2px; color: var(--ink-2); font-size: 13px; line-height: 1.4; }
    .places { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }
    .place { display: grid; grid-template-rows: auto auto 1fr auto; min-width: 0; overflow: hidden; border: 1px solid var(--line-strong); border-radius: 16px;
      background: var(--surface-2); }
    .place--changed { border-color: var(--rose); box-shadow: 0 0 0 1px var(--rose); }
    .place__name { display: flex; align-items: center; gap: 7px; min-width: 0; padding: 9px 12px 8px; font-size: 14px; font-weight: 700; line-height: 1.25; }
    .place__name app-icon { flex: none; color: var(--ink-2); }
    .place__pic { position: relative; display: grid; place-items: center; width: 100%; height: 138px; padding: 6px; border: 0; border-block: 1px solid var(--line);
      background: #fff; font: inherit; }
    button.place__pic { cursor: zoom-in; }
    .place__pic img { max-width: 100%; max-height: 124px; object-fit: contain; }
    .place__zoom { position: absolute; right: 6px; bottom: 6px; display: grid; place-items: center; width: 26px; height: 26px; border: 1px solid var(--line);
      border-radius: 8px; background: rgb(255 255 255 / 92%); color: var(--ink-2); }
    .place__pic--none { align-content: center; gap: 4px; border-block-style: dashed; background: var(--surface-2); color: #6a615b; font-size: 12.5px;
      line-height: 1.35; text-align: center; }
    .place__meta { display: grid; align-content: start; justify-items: start; gap: 5px; min-width: 0; padding: 9px 12px 0; }
    .place .pp-chip { white-space: normal; }
    .place__cap, .place__why, .place__same { color: var(--ink-2); font-size: 12.5px; line-height: 1.4; }
    /* On a phone the caption stays for screen readers only. */
    .place__cap { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .place__why { display: grid; grid-template-columns: 40px minmax(0, 1fr); align-items: start; gap: 8px; color: #5e3608; }
    .place__why img { width: 40px; height: 40px; border: 1px solid #e6cfa9; border-radius: 8px; background: #fff; object-fit: contain; }
    .place__why span:only-child { grid-column: 1 / -1; }
    .place__why b { color: #4a2a05; }
    .place__done { display: flex; flex-wrap: wrap; align-items: center; gap: 0 10px; color: var(--rose-dark); font-size: 12.5px; font-weight: 600; line-height: 1.35; }
    .pp-long { display: none; }
    .place__act { display: grid; gap: 6px; padding: 10px 12px 12px; }
    .place__act:empty { padding-bottom: 2px; }
    .place__act .btn { width: 100%; padding-inline: 8px; white-space: normal; line-height: 1.2; }
    .place__same { display: flex; align-items: flex-start; gap: 6px; }
    .place__same app-icon { flex: none; margin-top: 2px; }
    .place--docs { grid-column: 1 / -1; grid-template-columns: 112px minmax(0, 1fr); grid-template-rows: auto auto 1fr; }
    .place--docs .place__pic { grid-column: 1; grid-row: 1 / 4; height: 100%; min-height: 104px; border-block: 0; border-right: 1px solid var(--line); }
    .place--docs .place__pic--none { border-right-style: dashed; font-size: 12px; }
    .place--docs .place__pic img { max-height: 92px; }
    .place--docs .place__name { grid-column: 2; padding-bottom: 2px; }
    .place--docs .place__meta { grid-column: 2; padding-top: 2px; }
    .place--docs .place__act { grid-column: 2; padding-top: 6px; }
    .pl-links { display: flex; flex-wrap: wrap; gap: 0 12px; margin-top: 4px; }

    .notes, .pp-series { display: grid; gap: 8px; }
    .note { display: grid; grid-template-columns: 48px minmax(0, 1fr); align-items: center; gap: 4px 12px; padding: 10px 12px; border: 1px solid #f0dcbc;
      border-radius: 14px; background: var(--warn-soft); color: #5e3608; font-size: 12.5px; line-height: 1.45; }
    .note img { width: 48px; height: 48px; border: 1px solid #e6cfa9; border-radius: 10px; background: #fff; object-fit: cover; }
    .note b { color: #4a2a05; }
    .note .btn { grid-column: 2; justify-self: start; min-height: 44px; background: #fff; }

    .sr { border: 1px solid var(--line); border-radius: 16px; background: var(--surface-2); }
    .sr > summary { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; min-height: 64px; padding: 8px 12px;
      border-radius: 16px; cursor: pointer; list-style: none; }
    .sr > summary::-webkit-details-marker { display: none; }
    .sr__thumbs { display: flex; }
    .sr__thumbs img { width: 40px; height: 40px; margin-left: -10px; border: 2px solid #fff; border-radius: 10px; background: #fff; object-fit: cover;
      box-shadow: 0 0 0 1px var(--line-strong); }
    .sr__thumbs img:first-child { margin-left: 0; }
    .sr__title { display: grid; line-height: 1.3; }
    .sr__title b { font-size: 14px; }
    .sr__title small { color: var(--ink-2); font-size: 12.5px; }
    .sr__chev { color: var(--ink-2); }
    .sr[open] .sr__chev { transform: rotate(180deg); }
    .sr__rows { display: grid; border-top: 1px solid var(--line); }
    .sr-row { display: grid; grid-template-columns: 64px minmax(0, 1fr); align-items: start; gap: 4px 12px; padding: 12px; border-bottom: 1px solid var(--line);
      background: var(--surface); }
    .sr-row:last-child { border-bottom: 0; border-radius: 0 0 15px 15px; }
    .sr-row > img, .sr-row__none { grid-row: 1 / 3; width: 64px; height: 64px; padding: 2px; border: 1px solid var(--line-strong); border-radius: 12px; background: #fff;
      object-fit: contain; }
    .sr-row__none { display: grid; place-items: center; border-style: dashed; background: var(--surface-2); color: #6a615b; }
    .sr-row__body { display: grid; justify-items: start; gap: 3px; min-width: 0; }
    .sr-row__body b { font-size: 13.5px; line-height: 1.3; }
    .sr-row__body > span:not(.pp-chip) { color: var(--ink-2); font-size: 12.5px; line-height: 1.4; }
    .sr-row .pp-chip { white-space: normal; }
    .sr-row .btn { grid-column: 2; justify-self: start; min-height: 44px; }

    .gl { display: grid; gap: 12px; min-width: 0; }
    .gl__head { display: grid; gap: 10px; }
    .gl__head h3 { overflow-wrap: anywhere; }
    .pp-seg { height: 44px; }
    .gl__actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .pp-add { position: relative; }
    .pp-add--off { opacity: .45; pointer-events: none; }
    .pp-file { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; }
    .pp-order[aria-pressed=true] { border-color: var(--rose); background: var(--rose-soft); color: var(--rose-dark); }
    .gl-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .gl-grid > li { display: grid; min-width: 0; }
    .gl-tile { position: relative; display: grid; grid-template-rows: auto 1fr; width: 100%; min-width: 0; padding: 0; overflow: hidden; border: 1px solid var(--line-strong);
      border-radius: 14px; background: var(--surface-2); color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .gl-tile__pic { display: grid; place-items: center; height: 132px; padding: 6px; border-bottom: 1px solid var(--line); background: #fff; }
    .gl-tile__pic img { max-width: 100%; max-height: 120px; object-fit: contain; }
    .gl-tile__foot { display: flex; flex-wrap: wrap; align-content: center; align-items: center; gap: 4px 5px; min-width: 0; min-height: 52px; padding: 8px 10px;
      color: var(--ink-2); font-size: 12.5px; line-height: 1.35; overflow-wrap: anywhere; }
    .gl-tile__foot--quiet { color: #6a615b; }
    .gl-tile__also { flex-basis: 100%; }
    .gl-tile--order { cursor: default; }
    .gl-tile--dragging { opacity: .45; }
    .gl-tile--drop { border-color: var(--rose); box-shadow: 0 0 0 2px var(--rose); }
    .pp-pos { position: absolute; top: 6px; left: 6px; display: grid; place-items: center; min-width: 24px; height: 24px; padding-inline: 6px;
      border-radius: 999px; background: var(--ink); color: #fff; font-size: 11.5px; font-weight: 800; }
    .pp-handle { position: absolute; top: 4px; right: 4px; display: grid; place-items: center; width: 44px; height: 44px; padding: 0;
      border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--ink-2); cursor: grab; touch-action: none; }
    .pp-handle:active { cursor: grabbing; }
    .gl-group { display: flex; align-items: baseline; gap: 6px; min-width: 0; margin: 4px 0 -4px; color: var(--ink-2); font-size: 12.5px; font-weight: 750; }
    .gl-group b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gl-group span { color: #6a615b; font-weight: 600; }
    .gl-dup { display: grid; grid-template-columns: 44px minmax(0, 1fr); align-items: center; gap: 8px 12px; padding: 10px 12px; border: 1px solid var(--line);
      border-radius: 14px; background: var(--surface-2); color: var(--ink-2); font-size: 12.5px; line-height: 1.4; }
    .gl-dup img { width: 44px; height: 44px; border: 1px solid var(--line-strong); border-radius: 10px; background: #fff; object-fit: contain; }
    .gl-dup b { color: var(--ink); }
    .gl-dup .btn { grid-column: 2; justify-self: start; min-height: 44px; }
    .gl-lib .pp-link { display: flex; }
    .pp-empty { display: grid; gap: 4px; grid-column: 1 / -1; padding: 26px 16px; border: 1px dashed var(--line-strong); border-radius: 14px;
      color: var(--ink-2); font-size: 12.5px; text-align: center; }
    .pp-empty b { font-size: 14px; }
    .pp-empty small { font-size: 12.5px; }
    .pp-error { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; border-radius: 14px;
      background: var(--danger-soft); color: var(--danger); font-size: 12.5px; }
    .pp-error span { display: grid; gap: 2px; }
    .pp-skels { display: grid; gap: 18px; }
    .pp-skel { border-radius: 14px; }
    .pp-skel--line { width: min(320px, 80%); height: 22px; }
    .pp-skel--card { height: 250px; } .pp-skel--card.place--docs { height: 108px; }
    .pp-skel--strip { height: 64px; } .pp-skel--tile { height: 186px; }

    .pp-add-sheet { display: grid; gap: 16px; min-width: 0; }
    .pp-previews { display: flex; gap: 8px; padding: 2px; overflow-x: auto; }
    .pp-previews li { display: grid; flex: 0 0 104px; align-content: start; gap: 4px; min-width: 0; font-size: 12px; line-height: 1.3; }
    .pp-previews li:only-child { flex: 1; grid-template-columns: 72px minmax(0, 1fr); align-items: center; gap: 12px; font-size: 13px; }
    .pp-previews img { width: 72px; height: 72px; border: 1px solid var(--line); border-radius: 12px; background: #fff; object-fit: contain; }
    .pp-previews span { display: grid; min-width: 0; }
    .pp-previews b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pp-previews small { color: #6a615b; font-size: 12px; }
    .pp-field { display: grid; gap: 8px; min-width: 0; margin: 0; padding: 0; border: 0; }
    .pp-field :is(h4, legend) { padding: 0; font-size: 14px; font-weight: 700; }
    .pp-field legend { margin-bottom: 8px; }
    .pp-field small { font-size: 12.5px; }
    .pp-switch { width: 100%; min-height: 52px; font: inherit; color: inherit; text-align: left; }
    .pp-warn, .pp-tip { display: flex; gap: 8px; color: var(--ink-2); font-size: 12.5px; line-height: 1.45; }
    .pp-warn { padding: 10px 12px; border: 1px solid #f0dcbc; border-radius: 12px; background: var(--warn-soft); color: #5e3608; }
    :is(.pp-warn, .pp-tip) app-icon { flex: none; margin-top: 1px; }
    .pp-progress { color: var(--rose-dark); font-size: 13px; font-weight: 650; }
    .pp-foot { display: contents; }

    @container pp (min-width: 700px) {
      .places { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
      .place__name { padding: 10px 14px 8px; font-size: 15px; }
      .place .place__pic { grid-column: auto; grid-row: auto; height: 204px; min-height: 0; padding: 8px; border-right: 0; border-block: 1px solid var(--line); }
      .place .place__pic--none { border-block-style: dashed; font-size: 12.5px; }
      .place .place__pic img { max-height: 188px; }
      .place .place__meta { grid-column: auto; padding: 9px 14px 0; }
      .place__cap { position: static; width: auto; height: auto; overflow: visible; clip-path: none; white-space: normal; }
      .pp-long { display: inline; }
      .place .place__act { grid-column: auto; padding: 10px 14px 12px; }
      .place--docs { grid-column: auto; grid-template-columns: none; grid-template-rows: auto auto 1fr auto; }
      .place--docs .place__name { grid-column: auto; padding-bottom: 8px; }
      .pp-link { font-size: 13px; }
      .pl-links { gap: 0 20px; }
      .note { grid-template-columns: 48px minmax(0, 1fr) auto; }
      .note .btn { grid-column: auto; }
      .sr > summary { grid-template-columns: minmax(0, 1fr); min-height: 48px; cursor: default; pointer-events: none; }
      .sr__thumbs, .sr__chev { display: none; }
      .sr__title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 10px; }
      .sr__rows { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .sr-row { grid-template-columns: 64px minmax(0, 1fr) auto; align-items: center; }
      .sr-row:nth-child(odd) { border-right: 1px solid var(--line); border-radius: 0; }
      .sr-row:nth-last-child(-n+2):not(:nth-child(even):nth-last-child(2)) { border-bottom: 0; }
      .sr-row:nth-child(odd):nth-last-child(-n+2) { border-radius: 0 0 0 15px; }
      .sr-row:nth-child(even):last-child { border-radius: 0 0 15px 0; }
      .sr-row:nth-child(odd):last-child { grid-column: 1 / -1; border-right: 0; border-radius: 0 0 15px 15px; }
      .sr-row > img, .sr-row__none { grid-row: auto; }
      .sr-row .btn { grid-column: auto; min-height: 38px; padding: 6px 14px; }
      .gl__head { grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; }
      .pp-seg { width: 300px; }
      .gl-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
      .gl-tile__pic { height: 176px; }
      .gl-tile__pic img { max-height: 160px; }
      .gl-dup { grid-template-columns: 44px minmax(0, 1fr) auto; }
      .gl-dup .btn { grid-column: auto; min-height: 38px; }
      .gl-lib .pp-link { display: inline-flex; }
    }
    @media (hover: hover) and (pointer: fine) {
      .gl-tile:not(.gl-tile--order):hover { box-shadow: var(--sh-1); }
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
  private readonly sync = inject(WebsiteSyncStore);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  /** The saved product; the panel only mounts once it belongs to a saved series. */
  readonly product = input.required<Product>();
  /** Family members: colour order of "Hele reeks", the colour dot, the inactive colours of the series. */
  readonly members = input<ProductFamilyMember[]>([]);
  /** Translations are unsaved or saving: every control is off and the line under the heading says why. */
  readonly disabled = input(false);
  /** The editor bumps this when something outside the panel may have changed photos. */
  readonly revision = input(0);
  /** A link asked for a picker (`?kies=`): it opens once, when the overview is there and the panel is enabled. */
  readonly pick = input<'website' | 'catalogus' | null>(null);
  /** A photo change was saved: the editor refreshes the product and the series. */
  readonly changed = output<void>();
  /** The asked picker was opened, or its card has no "Wijzig" now: the editor drops the parameter. */
  readonly pickHandled = output<void>();
  /** The status pill; the editor draws it in the section head. */
  readonly pillTemplate = viewChild<TemplateRef<unknown>>('pill');

  readonly overview = signal<ProductPhotoOverview | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly view = signal<'colour' | 'series'>('colour');
  readonly reordering = signal(false);
  /** The open picker; null = closed. */
  readonly pickerKind = signal<PhotoPickerKind | null>(null);
  /** The candidate whose choice is being saved: its tile reads "Bewaren…". */
  readonly pickerBusyKey = signal<string | null>(null);
  /** "Nieuwe foto uploaden" in the picker: sending the file, then saving the choice. */
  readonly uploadStage = signal<'upload' | 'save' | null>(null);
  /** A photo that was uploaded in the picker but could not be chosen: it leads the candidates for a retry. */
  readonly uploadedKey = signal<string | null>(null);
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
  /** The choice the undo line and the toast can take back; dropped by any other photo change. */
  readonly lastChange = signal<PhotoPlaceChange | null>(null);
  /** "Andere kleuren van deze reeks" is unfolded. */
  readonly othersOpen = signal(false);
  /** The other colours' own overviews; null = not asked, or a save made the last answer old. */
  readonly others = signal<OtherColoursState | null>(null);
  /** "Voor de hele reeks" on a phone; remembered for the session. */
  readonly seriesOpen = signal(storedFlag(SERIES_OPEN_KEY));
  /** The panel is at least 700 px wide (the same line as the container query). */
  readonly wide = signal(false);

  readonly acceptTypes = PHOTO_UPLOAD_TYPES.join(',');
  readonly stripTitle = SERIES_STRIP_TITLE;
  readonly stripLine = SERIES_STRIP_LINE;
  readonly fileSize = formatBytes;

  private loadVersion = 0;
  private othersVersion = 0;
  private dragDepth = 0;
  private drag: OrderDrag | null = null;
  private lastOrderToast = 0;
  private lastControl: HTMLElement | null = null;

  readonly productId = computed(() => this.product().id);
  readonly interactionDisabled = computed(() => this.disabled() || this.busy() || !this.overview());
  readonly colour = computed(() => {
    const product = this.product();
    return variantShortLabel(product, this.members(), this.overview()?.variantLabel ?? null);
  });
  readonly colourHex = computed(() => {
    const id = this.productId();
    return this.members().find((member) => member.productId === id)?.colourHex || this.product().colourHex || null;
  });
  /** What every place shows now: the server's places, or the ones built from an older server's fields. */
  readonly places = computed<ResolvedPlaces | null>(() => resolvedPlaces(this.overview()));
  readonly live = computed(() => seriesLive(this.overview()));
  readonly heading = computed(() => placesHeading(this.colour(), this.disabled()));
  readonly cards = computed(() => placeCards(this.overview(), this.colour(), this.product()));
  readonly notes = computed(() => standingNotes(this.overview(), this.colour(), this.product()));
  readonly rows = computed(() => (this.overview()?.familyId ? seriesRows(this.overview()) : []));
  readonly attention = computed(() => seriesAttention(this.rows()));
  readonly assumption = computed(() => catalogueAssumptionLine(this.overview(), this.members()));
  /** The one place that speaks about the live site; null = no pill. */
  readonly syncPill = computed(() => {
    if (!this.overview() || this.sync.loadError()) return null;
    return syncPill(this.sync.status(), this.sync.pollEnded(), this.live(), new Date());
  });
  /** The undo line of the card that was just changed. */
  readonly changedText = computed(() => {
    const change = this.lastChange();
    if (!change) return null;
    const line = changedLine(change.kind, this.live());
    return { short: line.short, long: line.text.slice(line.short.length), undo: line.undo };
  });

  readonly colourList = computed(() => colourPhotos(this.overview()));
  readonly groups = computed(() => seriesPhotoGroups(this.overview(), this.colour(), this.members()));
  /** A duplicate leaves the grid for the row under it, unless a place still uses it. */
  readonly duplicates = computed(() => {
    const places = this.places();
    return this.colourList().filter((photo) => !!photo.duplicateOfKey && !tileUses(photo, places).any);
  });
  readonly duplicateNote = computed(() => duplicatesNote(this.duplicates().length, this.colour()));
  readonly shownColour = computed(() => {
    const hidden = this.duplicates();
    return this.colourList().filter((photo) => !hidden.includes(photo));
  });
  readonly shownGroups = computed(() => {
    const hidden = this.duplicates();
    return this.groups()
      .map((group) => ({ ...group, photos: group.photos.filter((photo) => !hidden.includes(photo)) }))
      .filter((group) => group.photos.length);
  });
  readonly gallery = computed(() => galleryTexts(this.view(), this.colour()));
  readonly viewOptions = computed<SegmentOption[]>(() => [
    { id: 'colour', label: 'Deze kleur', count: this.shownColour().length },
    { id: 'series', label: 'Hele reeks', count: this.shownGroups().reduce((sum, group) => sum + group.photos.length, 0) },
  ]);
  /** The tile words of every photo, from what the places show now. */
  private readonly feet = computed(() => {
    const places = this.places();
    const colour = this.colour();
    const view = this.view();
    return new Map((this.overview()?.photos ?? []).map((photo) => [photo.key, tileFoot(photo, tileUses(photo, places), colour, view)]));
  });
  /** Reorder mode: the series photos the website receives, in series order. */
  readonly orderList = computed(() => {
    const photos = seriesInFamilyOrder(this.overview()).filter((photo) => photo.visibility.website);
    const override = this.orderOverride();
    if (!override) return photos;
    const byKey = new Map(photos.map((photo) => [photo.key, photo]));
    return override.map((key) => byKey.get(key)).filter((photo): photo is ProductPhotoOverviewPhoto => !!photo);
  });
  /** Reorder mode: series photos the website does not receive; they have no place in the order. */
  readonly orderRest = computed(() => seriesInFamilyOrder(this.overview()).filter((photo) => !photo.visibility.website));
  /** The photo the product page opens with, as the server says after each move. */
  readonly openingKey = computed(() => this.overview()?.places?.websiteOpening.shownKey ?? null);
  /** The photo sheet walks through exactly what the grid shows; a place photo outside it opens among all photos. */
  readonly sheetList = computed(() => {
    const shown = this.view() === 'series' && !this.reordering()
      ? this.shownGroups().flatMap((group) => group.photos)
      : this.shownColour();
    const open = this.openKey();
    return open && !shown.some((photo) => photo.key === open) ? this.overview()?.photos ?? shown : shown;
  });
  /** "Dit zien klanten nu" in the photo sheet: the photo Website and Catalogus both show. */
  readonly reference = computed(() => {
    const [website, catalogue] = this.cards();
    return website?.photo && website.photo.key === catalogue?.photo?.key ? website.photo : null;
  });
  readonly picker = computed(() => {
    const kind = this.pickerKind();
    return kind ? pickerModel(this.overview(), kind, this.colour(), this.product(), this.uploadedKey()) : null;
  });
  /** The other colours of the series; none against an older server, which cannot say what they show. */
  readonly otherMembers = computed(() => {
    const id = this.productId();
    return this.overview()?.places ? this.members().filter((member) => member.productId !== id) : [];
  });
  readonly otherRows = computed(() => {
    const loaded = this.others();
    const overviews = loaded?.state === 'ready' ? loaded.overviews : [];
    return this.otherMembers().map((member) => otherColourRow(member, overviews.find((item) => item.productId === member.productId) ?? null));
  });
  /**
   * "Bekijk groot" in the Catalogus picker: the catalogue photos of the other
   * colours the pdf prints next to this one. Null = no strip (loading, failed,
   * a one-colour series, a colour that is not sold, no other colour with a photo).
   */
  readonly compareNeighbours = computed<PhotoCompareNeighbour[] | null>(() => {
    const overview = this.overview();
    const loaded = this.others();
    if (this.picker()?.kind !== 'catalogue' || !overview?.places || loaded?.state !== 'ready') return null;
    if (cataloguePlaceFor(overview.places).single || colourStatus(overview, this.product()) !== 'active') return null;
    const printed = overview.catalogueAssumption?.productIds;
    const list = this.otherRows()
      .filter((row) => row.catalogue && (!printed || printed.includes(row.productId)))
      .map((row) => ({ label: row.name, photo: row.catalogue }));
    return list.length ? list : null;
  });
  readonly addTexts = computed(() => addSheetTexts(this.staged()?.length ?? 1, this.colour(), this.addScope()));
  readonly addScopeOptions = computed<SegmentOption[]>(() => [
    { id: 'THIS_VARIANT', label: this.addTexts().onlyThis }, { id: 'ALL_VARIANTS', label: this.addTexts().all },
  ]);
  readonly addWarningText = computed(() => addWarning(this.overview(), this.addScope(), this.colour()));

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
    /* A save disables every control for a moment, which drops keyboard focus.
       Hand it back to the control that started it (the sheets do the same). */
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
    /* A link from the product page or the Catalogusstudio asks for a picker; it waits for the overview. */
    let handledPick: string | null = null;
    effect(() => {
      const pick = this.pick();
      if (!pick) handledPick = null;
      if (!pick || pick === handledPick || this.interactionDisabled()) return;
      handledPick = pick;
      untracked(() => this.openRequestedPicker(pick));
    });
    /* One status for the whole app: watch it while the section is on screen. */
    this.sync.attach();
    this.sync.refresh();
    let resize: ResizeObserver | null = null;
    afterNextRender(() => {
      const panel = this.host.nativeElement.querySelector('.pp');
      if (!panel || typeof ResizeObserver === 'undefined') return;
      resize = new ResizeObserver((entries) => this.wide.set((entries[0]?.contentRect.width ?? 0) >= 700));
      resize.observe(panel);
    });
    inject(DestroyRef).onDestroy(() => {
      this.releaseStaged();
      this.sync.detach();
      resize?.disconnect();
    });
  }

  footOf(photo: ProductPhotoOverviewPhoto): TileFoot {
    return this.feet().get(photo.key) ?? tileFoot(photo, tileUses(photo, this.places()), this.colour(), this.view());
  }

  tileLabel(photo: ProductPhotoOverviewPhoto): string {
    const list = this.sheetList();
    return photoTileLabel(photo, this.colour(), Math.max(0, list.findIndex((item) => item.key === photo.key)), list.length,
      tileUses(photo, this.places()), this.view());
  }

  /** Whose photo a reorder tile is: this colour, another colour or all colours. */
  whose(photo: ProductPhotoOverviewPhoto): string {
    return photo.scope === 'ALL_VARIANTS' ? 'Alle kleuren'
      : photo.scope === 'OTHER_VARIANT' ? photo.variantLabel || 'Andere kleur' : this.colour();
  }

  /** A place can show another colour's own photo; only this product's photos open in the photo sheet. */
  listed(key: string): boolean {
    return !!this.overview()?.photos.some((photo) => photo.key === key);
  }

  setView(view: 'colour' | 'series'): void {
    this.view.set(view);
    if (view === 'colour') this.reordering.set(false);
  }

  rememberControl(event: Event): void {
    this.lastControl = (event.target as HTMLElement).closest('button');
  }

  openPhoto(key: string): void {
    if (this.listed(key)) this.openKey.set(key);
  }

  openPicker(kind: PhotoPickerKind): void {
    if (!this.interactionDisabled()) this.pickerKind.set(kind);
  }

  closePicker(): void {
    if (this.pickerBusyKey() || this.uploadStage()) return;
    this.pickerKind.set(null);
    this.uploadedKey.set(null);
  }

  /** `?kies=website|catalogus`: opens that card's picker when the card has a "Wijzig" now; its own sentence says why not. */
  openRequestedPicker(pick: 'website' | 'catalogus'): void {
    if (this.interactionDisabled()) return;
    const card = this.cards().find((item) => item.key === (pick === 'website' ? 'website' : 'catalogue'));
    const picker = card?.actions.find((action) => action.id === 'pick')?.picker;
    if (picker) this.openPicker(picker);
    this.pickHandled.emit();
  }

  othersToggled(open: boolean): void {
    if (open === this.othersOpen()) return;
    this.othersOpen.set(open);
    if (open) void this.loadOthers();
  }

  /**
   * Fetches what the other colours show, fresh: an older answer is never
   * shown as "nu". Looking only; nothing here writes for another product.
   */
  async loadOthers(): Promise<void> {
    const members = this.otherMembers();
    const version = ++this.othersVersion;
    if (!members.length) {
      this.others.set(null);
      return;
    }
    this.others.set({ state: 'loading', overviews: [] });
    try {
      const overviews = await Promise.all(members.map((member) => this.catalog.productPhotoOverview(member.productId)));
      if (version === this.othersVersion) this.others.set({ state: 'ready', overviews });
    } catch {
      if (version === this.othersVersion) this.others.set({ state: 'failed', overviews: [] });
    }
  }

  /** "Volgorde": the whole series in reorder mode, scrolled to. The only scroll the panel does itself. */
  openReorder(): void {
    if (this.interactionDisabled()) return;
    this.openKey.set(null);
    this.view.set('series');
    this.reordering.set(true);
    setTimeout(() => this.host.nativeElement.querySelector('#pp-gallery')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  seriesToggled(event: Event): void {
    /* On a laptop the strip is always open; only a phone's own choice is remembered. */
    if (this.wide()) return;
    const open = (event.target as HTMLDetailsElement).open;
    if (open === this.seriesOpen()) return;
    this.seriesOpen.set(open);
    storeFlag(SERIES_OPEN_KEY, open);
  }

  pillTap(action: 'refresh' | 'retry' | 'translations'): void {
    if (action === 'retry') void this.sync.retry(); else void this.sync.load();
  }

  cardAction(card: PlaceCard, action: PlaceAction): void {
    if (action.id === 'pick') {
      if (action.picker) this.openPicker(action.picker);
    } else if (action.id === 'repair') {
      void this.repair(card.key === 'website' ? 'website' : 'catalogue');
    } else {
      void this.useWebsitePhotoForDocuments();
    }
  }

  async reload(): Promise<void> {
    await this.load(this.productId());
  }

  /* ------------------------------------------------------------ choices */

  /**
   * Stores a choice for one role, or hands it back to the automatic rule
   * with null. The stored choice again only closes the picker, unless `force`
   * says to send it anyway ("Zet mijn keuze weer aan": the role call switches
   * the photo on for the website or the catalogue).
   */
  async pickRole(role: ProductPhotoRoleKey, photoKey: string | null, force = false): Promise<void> {
    const overview = this.overview();
    const before = this.places();
    if (!overview || !before || this.interactionDisabled()) return;
    const place = placeOfRole(before, role);
    if (!force && place.chosenKey === photoKey) {
      this.pickerKind.set(null);
      this.uploadedKey.set(null);
      return;
    }
    const productId = overview.productId;
    const kind = kindOfRole(role);
    const single = cataloguePlaceFor(before);
    const shownKey = role === single.role ? single.place.shownKey : place.shownKey;
    const event: PlaceEvent = force ? 'repaired' : photoKey === null ? 'cleared'
      : place.chosenKey === null && shownKey === photoKey ? 'pinned' : 'chosen';
    const change: PhotoPlaceChange = {
      kind, role, previousKey: place.chosenKey, newKey: photoKey,
      card: role === 'MAIN' ? 'website' : role === single.role ? 'catalogue' : null,
      restore: this.switchesOf([photoKey, place.chosenKey]),
    };
    this.pickerBusyKey.set(photoKey);
    const saved = await this.run(
      () => this.catalog.setProductPhotoRole(productId, role, photoKey),
      /* Success is read from the answer: a choice the place still does not show is not announced as shown. */
      () => (this.choiceHidden(kind) ? null : placeSavedMessage(kind, this.colour(), before, this.places(), event)),
      PHOTO_MESSAGES.roleFailed,
      force ? undefined : { label: PHOTO_MESSAGES.undo, run: () => void this.undo() },
    );
    this.pickerBusyKey.set(null);
    if (!saved) return;
    this.pickerKind.set(null);
    this.uploadedKey.set(null);
    this.lastChange.set(force ? null : change);
    if (this.choiceHidden(kind)) this.announcement.set(HIDDEN_CHOICE);
  }

  pickFromPicker(key: string): void {
    const model = this.picker();
    if (model) void this.pickRole(model.role, key);
  }

  clearFromPicker(): void {
    const model = this.picker();
    if (model) void this.pickRole(model.role, null);
  }

  uploadFromPicker(file: File): void {
    const kind = this.pickerKind();
    if (kind === 'website' || kind === 'catalogue') void this.uploadAndUse(kind, file);
  }

  /** "Bekijk groot" opened in the picker: the Catalogus strip shows the other colours as they are now. */
  compareOpened(): void {
    if (this.picker()?.kind === 'catalogue' && this.otherMembers().length) void this.loadOthers();
  }

  /**
   * Takes the last choice back: the stored choice of before, or the automatic
   * rule. The role call may have switched the website or the catalogue on for
   * a photo (on the first tap and again here), so the switches of the new and
   * of the previous photo go back to what they were, where the answer differs.
   */
  async undo(): Promise<void> {
    const change = this.lastChange();
    const overview = this.overview();
    const before = this.places();
    if (!change || !overview || this.interactionDisabled()) return;
    const productId = overview.productId;
    const familyId = overview.familyId;
    let refused: string | null = null;
    let left: CatalogChannel | null = null;
    let done = false;
    /* One step only: the line goes, whatever the server answers. */
    this.lastChange.set(null);
    this.busy.set(true);
    try {
      try {
        const answer = await this.catalog.setProductPhotoRole(productId, change.role, change.previousKey);
        if (this.productId() !== productId) return;
        this.apply(answer);
        done = true;
      } catch (failure: unknown) {
        /* The previous choice can no longer be stored, for example its colour was made inactive meanwhile. */
        refused = messageOf(failure, PHOTO_MESSAGES.roleFailed);
      }
      let restored = false;
      for (const memory of done && familyId ? change.restore : []) {
        const photo = this.overview()?.photos.find((item) => item.key === memory.key);
        const now = photo ? selectedChannels(photo) : memory.channels;
        const extra = now.filter((channel) => !memory.channels.includes(channel));
        if (!extra.length && now.length === memory.channels.length) continue;
        try {
          await this.catalog.updateProductFamilyImagePublication(familyId!, memory.imageId, memory.channels);
          restored = true;
        } catch {
          left ??= extra.includes('WEBSITE') ? 'WEBSITE' : 'CATALOGUE';
        }
        if (this.productId() !== productId) return;
      }
      /* A publication call answers with the series, not an overview. */
      if (restored || left || refused) await this.load(productId);
    } finally {
      this.busy.set(false);
    }
    if (this.productId() !== productId) return;
    if (refused) {
      this.ui.toast(`${refused.trim().replace(/[.\s]+$/, '')}. ${PHOTO_MESSAGES.undoRefused}`, 'err');
      return;
    }
    if (left) {
      this.ui.toast(left === 'WEBSITE' ? PHOTO_MESSAGES.undoLeftOnWebsite : PHOTO_MESSAGES.undoLeftInCatalogue, 'err');
    } else {
      const message = placeSavedMessage(change.kind, this.colour(), before, this.places(), 'undone');
      this.ui.toast(message);
      this.announcement.set(message);
    }
    this.afterSave(before);
  }

  /** "Zet mijn keuze weer aan": sends the stored choice again, which switches it on for that place. */
  async repair(kind: 'website' | 'catalogue'): Promise<void> {
    const places = this.places();
    if (!places || places.legacy) return;
    const target = pickerTarget(places, kind);
    if (target.chosenKey) await this.pickRole(target.role, target.chosenKey, true);
  }

  /** "Gebruik de websitefoto": quotes and invoices move to the photo the website shows. No undo line: the website card did not change. */
  async useWebsitePhotoForDocuments(): Promise<void> {
    const overview = this.overview();
    const places = this.places();
    const key = places?.websiteColour.shownKey;
    if (!overview || !places || places.legacy || !key || key === places.documents.shownKey) return;
    const productId = overview.productId;
    await this.run(() => this.catalog.setProductPhotoRole(productId, 'MAIN', key), PHOTO_MESSAGES.documentsUseWebsite, PHOTO_MESSAGES.roleFailed);
  }

  /**
   * "Nieuwe foto uploaden" in the picker (api-contract part E): upload for
   * this colour, name the photo the server stored or reused, then choose it.
   * The photo is named the way the server reuses one: by the SHA-256 of the
   * file; without crypto.subtle (plain http) by the one id that is new. A
   * photo of another colour, or of all colours for the colour strip, is never
   * taken over. It keeps `busy` itself (run() refuses while busy) and reports
   * success only when the place shows the new photo as the owner's choice.
   * `addedKey` is the photo a failed attempt already added ("Opnieuw
   * proberen"): for the owner it is still the new photo, not one that was there.
   */
  async uploadAndUse(kind: 'website' | 'catalogue', file: File, addedKey: string | null = null): Promise<void> {
    const overview = this.overview();
    const before = this.places();
    const familyId = overview?.familyId;
    if (!overview || !before || !familyId || this.busy() || this.disabled()) return;
    const { accepted, skipped } = splitPhotoFiles([file]);
    if (skipped) this.ui.toast(skipped, 'err');
    if (!accepted.length) return;
    const productId = overview.productId;
    const target = pickerTarget(before, kind);
    const colour = this.colour();
    const listed = overview.photos.filter((photo) => photo.kind === 'SERIES' && photo.familyPhotoId !== null);
    let failure: string | null = null;
    let retry = false;
    let key: string | null = null;
    let uploaded = false;
    let reused = false;
    let restore: PhotoSwitchMemory[] = [];
    this.lastChange.set(null);
    this.uploadedKey.set(null);
    this.busy.set(true);
    this.uploadStage.set('upload');
    try {
      const sha = await fileSha256(file);
      const idsBefore = sha ? null : (await this.catalog.productFamily(familyId)).images.map((image) => image.id);
      const family = await this.catalog.uploadProductFamilyImage(familyId, file, productId);
      uploaded = true;
      if (this.productId() !== productId) return;
      /* The hash names a new and a reused photo alike. Should a server answer without it, the one id the overview did not list is the new photo. */
      const image = uploadedImage(family.images, sha, idsBefore ?? [])
        ?? (sha ? uploadedImage(family.images, null, listed.map((photo) => photo.familyPhotoId!)) : null);
      const verdict = image ? uploadUseVerdict(image, productId, kind, before) : null;
      if (!image) {
        failure = uploadUseMessage('unidentified', colour);
      } else if (verdict === 'otherColour') {
        const owner = listed.find((photo) => photo.familyPhotoId === image.id)?.variantLabel
          || this.members().find((member) => member.productId === image.variantProductId)?.colour
          || image.variantColor;
        failure = uploadUseMessage('otherColour', colour, owner ?? null);
      } else if (verdict === 'allColours') {
        failure = uploadUseMessage('allColours', colour);
      } else {
        key = photoKeyForSignedId(image.id);
        reused = key !== addedKey && (idsBefore ? idsBefore.includes(image.id) : listed.some((photo) => photo.familyPhotoId === image.id));
        /* A new photo starts without any switch; undo takes the one the role call adds away again. */
        restore = [
          ...(reused ? this.switchesOf([key]) : [{ key: key!, imageId: image.id, channels: [] }]),
          ...this.switchesOf([target.chosenKey === key ? null : target.chosenKey]),
        ];
        this.uploadStage.set('save');
        try {
          const answer = await this.catalog.setProductPhotoRole(productId, target.role, key);
          if (this.productId() !== productId) return;
          this.apply(answer);
        } catch (refused: unknown) {
          failure = uploadUseMessage('roleFailed', colour, messageOf(refused, ''));
          retry = true;
        }
      }
    } catch (failed: unknown) {
      failure = messageOf(failed, 'Uploaden mislukt. Controleer het bestand en probeer opnieuw.');
    } finally {
      this.uploadStage.set(null);
      this.busy.set(false);
    }
    if (this.productId() !== productId) return;
    if (failure) {
      /* The photo is in the series, not chosen: the same file again is safe (the server reuses it). */
      if (retry) this.ui.toast(failure, 'err', { label: PHOTO_MESSAGES.retry, run: () => void this.uploadAndUse(kind, file, key) });
      else this.ui.toast(failure, 'err');
      await this.load(productId);
      if (retry && this.pickerKind()) this.uploadedKey.set(key);
    } else {
      this.pickerKind.set(null);
      if (key && placeShowsChoice(this.overview(), kind, key)) {
        const message = reused ? uploadUseMessage('reused', colour) : placeSavedMessage(target.kind, colour, before, this.places(), 'chosen');
        if (target.chosenKey !== key) {
          this.lastChange.set({ kind: target.kind, role: target.role, card: kind, previousKey: target.chosenKey, newKey: key, restore });
          this.ui.toast(message, 'ok', { label: PHOTO_MESSAGES.undo, run: () => void this.undo() });
        } else {
          this.ui.toast(message);
        }
        this.announcement.set(message);
      } else {
        /* Saved, but the place does not show it: the card says so with its reason; no success is claimed. */
        this.announcement.set(HIDDEN_CHOICE);
      }
    }
    if (uploaded) this.afterSave(before);
  }

  async setDetailSize(size: 'STANDARD' | 'LARGE'): Promise<void> {
    const overview = this.overview();
    const places = this.places();
    if (!overview?.familyId || !places || overview.catalogueDetailSize === size) return;
    /* The stored choices go back unchanged, also one that is not shown now (api-contract D.2). */
    await this.run(
      () => this.catalog.updateCataloguePhotos(overview.familyId!, {
        catalogueOverviewPhotoId: signedIdForPhotoKey(places.catalogueOverview.chosenKey),
        catalogueDetailPhotoId: signedIdForPhotoKey(places.catalogueDetail.chosenKey),
        catalogueDetailSize: size,
      }),
      size === 'LARGE' ? PHOTO_MESSAGES.sizeLarge : PHOTO_MESSAGES.sizeStandard,
      PHOTO_MESSAGES.sizeFailed,
    );
  }

  async setChannels(request: ProductPhotoChannelsRequest): Promise<void> {
    const familyId = this.overview()?.familyId;
    const imageId = request.photo.familyPhotoId;
    if (!familyId || imageId === null) return;
    const channels: CatalogChannel[] = request.channels;
    /* A stored choice keeps its switch on, for every colour that chose the photo. */
    const locked = selectedChannels(request.photo).filter((channel) => !channels.includes(channel))
      .map((channel) => switchLock(request.photo, this.places(), channel, this.colour())).find((lock) => lock?.locked);
    if (locked) {
      this.ui.toast(locked.help, 'err');
      return;
    }
    await this.run(
      () => this.catalog.updateProductFamilyImagePublication(familyId, imageId, channels),
      channelSavedMessage(selectedChannels(request.photo), channels),
      PHOTO_MESSAGES.channelsFailed,
    );
  }

  async setScope(request: ProductPhotoScopeRequest): Promise<void> {
    const overview = this.overview();
    const familyId = overview?.familyId;
    const imageId = request.photo.familyPhotoId;
    if (!overview || !familyId || imageId === null) return;
    const toAll = request.variantProductId === null;
    const go = () => this.run(
      () => this.catalog.updateProductFamilyImageVariant(familyId, imageId, request.variantProductId),
      scopeSavedMessage(toAll, this.colour()),
      PHOTO_MESSAGES.scopeFailed,
    );
    const ask = scopeConfirm(request.photo, this.places(), this.colour(), toAll, overview.productId);
    if (!ask) {
      await go();
      return;
    }
    this.ui.confirm({ title: ask.title, message: escapeHtml(ask.body), confirmLabel: ask.confirm }, () => void go());
  }

  promote(request: ProductPhotoPromoteRequest): void {
    const productId = this.overview()?.productId;
    if (productId === undefined || this.interactionDisabled()) return;
    const go = () => void this.run(
      () => this.catalog.promoteProductPhoto(productId, request.photo.key, request.scope),
      request.cleanup ? PHOTO_MESSAGES.duplicateCleaned : scopeSavedMessage(request.scope === 'ALL_VARIANTS', this.colour()),
      request.cleanup ? 'Dubbele foto opruimen mislukt' : 'Bij de reeks zetten mislukt',
    );
    if (!request.cleanup) { go(); return; }
    this.ui.confirm({
      title: 'Dubbele foto opruimen',
      message: 'De dubbele kopie wordt verwijderd. De andere foto blijft staan en neemt de keuzes over.',
      confirmLabel: 'Opruimen',
    }, go);
  }

  /** "Opruimen" in the row under the grid: one duplicate per tap. */
  cleanDuplicate(): void {
    const photo = this.duplicates()[0];
    if (photo) this.promote({ photo, scope: cleanupScope(this.overview(), photo), cleanup: true });
  }

  remove(photo: ProductPhotoOverviewPhoto): void {
    const overview = this.overview();
    if (!overview || this.interactionDisabled()) return;
    const texts = deleteTexts(photo, this.places(), this.colour(), overview.productId);
    this.ui.confirm({ title: texts.title, message: escapeHtml(texts.body), confirmLabel: texts.confirm, danger: true }, () => {
      const request = photo.kind === 'OWN'
        ? () => this.catalog.deletePhoto(overview.productId, photo.productPhotoId!)
        : () => this.catalog.deleteProductFamilyImage(overview.familyId!, photo.familyPhotoId!);
      /* The server refuses to delete the stored large or small catalogue photo; its sentence gets the way out. */
      const places = this.places();
      const seriesChoice = places?.catalogueDetail.chosenKey === photo.key || places?.catalogueOverview.chosenKey === photo.key;
      void this.run(request, 'Foto verwijderd', PHOTO_MESSAGES.deleteFailed, undefined,
        seriesChoice ? PHOTO_MESSAGES.deleteRefusedHint : undefined).then((done) => {
        if (done) this.openKey.set(null);
      });
    });
  }

  async download(photo: ProductPhotoOverviewPhoto): Promise<void> {
    try {
      saveBlob(await this.catalog.photoBlob(photo.downloadUrl), photo.originalFilename);
      this.ui.toast('Origineel gedownload');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, PHOTO_MESSAGES.downloadFailed), 'err');
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
    const before = this.places();
    const channels: CatalogChannel[] = [
      ...(this.addWebsite() ? ['WEBSITE' as const] : []),
      ...(this.addCatalogue() ? ['CATALOGUE' as const] : []),
    ];
    const variantProductId = this.addScope() === 'THIS_VARIANT' ? overview.productId : null;
    const result: PhotoUploadResult = { added: 0, existing: 0, failed: 0, publishFailed: 0, channels };
    const failed: StagedPhoto[] = [];
    let firstError: string | null = null;
    this.lastChange.set(null);
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
              firstError ??= messageOf(failure, 'Als extra foto zetten mislukt.');
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
      this.afterSave(before);
    }
    const summary = uploadSummary(result);
    const text = summary.text + documentsMovedNote(before, this.places());
    this.ui.toast(!summary.ok && firstError && !failed.length ? `${text}. ${firstError}` : text, summary.ok ? 'ok' : 'err');
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
    this.pickerKind.set(null);
    this.pickerBusyKey.set(null);
    this.uploadedKey.set(null);
    this.openKey.set(null);
    this.orderOverride.set(null);
    this.lastChange.set(null);
    ++this.othersVersion;
    this.others.set(null);
    this.othersOpen.set(false);
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
   * have done part of the work (a publication before a choice, for example).
   * `success` can be read after the answer, so it can name what moved.
   * `refusedHint` follows the server's own sentence when it refuses.
   */
  private async run(
    request: () => Promise<unknown>,
    success: string | (() => string | null),
    failureText: string,
    action?: { label: string; run: () => void },
    refusedHint?: string,
  ): Promise<boolean> {
    const productId = this.productId();
    if (productId === null || this.interactionDisabled()) return false;
    const before = this.places();
    /* The undo line is for the last change only. */
    this.lastChange.set(null);
    this.busy.set(true);
    try {
      const answer = await request();
      if (this.productId() !== productId) return false;
      if (isOverview(answer)) this.apply(answer); else await this.load(productId);
      /* Null = the answer does not show what was asked: nothing is claimed, the screen says what is. */
      const text = typeof success === 'string' ? success : success();
      if (text !== null) {
        if (action) this.ui.toast(text, 'ok', action); else this.ui.toast(text);
        this.announcement.set(text);
      }
      this.afterSave(before);
      return true;
    } catch (failure: unknown) {
      const text = messageOf(failure, failureText);
      this.ui.toast(refusedHint && text !== failureText ? `${text.trim().replace(/[.\s]+$/, '')}. ${refusedHint}` : text, 'err');
      if (this.productId() === productId) await this.load(productId);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /** After every saved change: the pill follows, the editor is told, and the other colours are asked again while they are looked at. */
  private afterSave(before: ResolvedPlaces | null): void {
    this.refreshSync(before);
    this.changed.emit();
    if (this.othersOpen()) void this.loadOthers();
    else {
      ++this.othersVersion;
      this.others.set(null);
    }
  }

  /** The switches of these photos as the overview has them now; own photos and other colours' photos have none. */
  private switchesOf(keys: readonly (string | null)[]): PhotoSwitchMemory[] {
    const photos = this.overview()?.photos ?? [];
    const memories: PhotoSwitchMemory[] = [];
    for (const key of keys) {
      const photo = key === null ? undefined : photos.find((item) => item.key === key);
      if (!photo || photo.kind !== 'SERIES' || photo.familyPhotoId === null || memories.some((item) => item.key === key)) continue;
      memories.push({ key: photo.key, imageId: photo.familyPhotoId, channels: selectedChannels(photo) });
    }
    return memories;
  }

  /** The stored choice of this picker's place is not what the place shows (read after a save). */
  private choiceHidden(kind: PhotoPickerKind): boolean {
    const places = this.places();
    return !!places && pickerTarget(places, kind).place.state === 'CHOSEN_NOT_SHOWN';
  }

  /** The website is rebuilt after a change of what it shows; ask the shared status once so the pill follows. */
  private refreshSync(before: ResolvedPlaces | null): void {
    const moved = changedPlaces(before, this.places());
    if (moved.includes('websiteColour') || moved.includes('websiteOpening') || moved.includes('websiteQuote')) this.sync.refresh();
  }

  private async moveOrder(from: number, to: number, keyboard: boolean): Promise<void> {
    const overview = this.overview();
    const current = this.orderList();
    const next = movedOrder(current, from, to);
    if (!overview?.familyId || !next || this.interactionDisabled()) return;
    const familyId = overview.familyId;
    const before = this.places();
    const moved = current[from];
    const target = next.indexOf(moved);
    this.orderOverride.set(next.map((photo) => photo.key));
    if (keyboard) this.focusHandle(moved.key);
    this.lastChange.set(null);
    this.busy.set(true);
    try {
      const family = await this.catalog.productFamily(familyId);
      const allIds = [...family.images].sort((left, right) => left.position - right.position).map((image) => image.id);
      /* Photos that are not on the website keep their slot; only the website photos trade places. */
      await this.catalog.reorderProductFamilyImages(familyId, familyOrderWith(allIds, next.map((photo) => photo.familyPhotoId!)));
      await this.load(overview.productId);
      const message = `Foto staat nu op positie ${target + 1} van ${next.length}`;
      this.announcement.set(message);
      /* Arrow keys save each step; one toast per burst is enough. */
      if (Date.now() - this.lastOrderToast > 3000) this.ui.toast(orderSavedMessage(before, this.places()));
      this.lastOrderToast = Date.now();
      this.afterSave(before);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, PHOTO_MESSAGES.orderFailed), 'err');
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

const SERIES_OPEN_KEY = 'erp.product-photos.series-open';
/** Read to screen readers when a saved choice is not what the place shows; the card carries the reason. */
const HIDDEN_CHOICE = 'Je keuze wordt niet getoond';

/**
 * SHA-256 of a file as lower-case hex, the way the server names an upload.
 * Null where the browser cannot: crypto.subtle only exists on https and
 * localhost, not on a plain-http address.
 */
async function fileSha256(file: Blob): Promise<string | null> {
  try {
    const subtle = typeof crypto === 'undefined' ? null : crypto.subtle;
    if (!subtle) return null;
    const digest = await subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/** Session flags are a comfort; a browser that refuses storage simply forgets. */
function storedFlag(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function storeFlag(key: string, on: boolean): void {
  try {
    if (on) sessionStorage.setItem(key, '1'); else sessionStorage.removeItem(key);
  } catch {
    /* Private mode: the strip then starts folded again. */
  }
}

/** The place a role's stored choice lives on. */
function placeOfRole(places: ResolvedPlaces, role: ProductPhotoRoleKey): PhotoPlace {
  switch (role) {
    case 'MAIN': return places.websiteColour;
    case 'QUOTE': return places.websiteQuote;
    case 'CATALOGUE_VARIANT': return places.catalogueColour;
    case 'CATALOGUE_DETAIL': return places.catalogueDetail;
    case 'CATALOGUE_OVERVIEW': return places.catalogueOverview;
  }
}

function kindOfRole(role: ProductPhotoRoleKey): PhotoPickerKind {
  switch (role) {
    case 'MAIN': return 'website';
    case 'QUOTE': return 'quote';
    case 'CATALOGUE_VARIANT': return 'catalogue';
    case 'CATALOGUE_DETAIL': return 'detail';
    case 'CATALOGUE_OVERVIEW': return 'overview';
  }
}

function isOverview(value: unknown): value is ProductPhotoOverview {
  return !!value && typeof value === 'object' && Array.isArray((value as ProductPhotoOverview).photos)
    && 'productId' in value && 'main' in value;
}
