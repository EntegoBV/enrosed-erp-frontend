import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, signal, untracked, viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthImage } from '../../core/api/auth-image';
import { MediaAssetSummary, MediaFolder } from '../../core/api/media-models';
import { WorkspaceReturn } from '../../core/platform/workspace-return';
import { Icon } from '../../shared/icon';
import { IosNav } from '../../shared/ios-nav';
import { IosTab, IosTabbar } from '../../shared/ios-tabbar';
import { MenuTrigger } from '../../shared/menu-trigger';
import { DateNlPipe } from '../../shared/pipes';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import { SwipeActions } from '../../shared/swipe-actions';
import { Sheet } from '../../shared/ui';
import type { ContextMenuItem } from '../../shared/context-menu';
import type { RowSwipeSide } from '../../shared/row-actions';
import {
  LINK_VIEWS, PHONE_SORTS, badgeText, extensionToneClass, targetLabel,
} from './files-collections';
import { crumbsFor, folderMeta, sizeLabel, whereLine } from './files-rules';
import { fileKey } from './files-selection';
import { FilesController } from './files-controller';
import { FilesInspector } from './files-inspector';

/**
 * Documenten & media on a phone, the iOS 26 Files way: a Bladeren hub
 * (search, the newest files, the folders, "Gekoppeld aan"), list screens
 * pushed one level at a time, and a file screen. Its own glass tab bar
 * (Recent, Bladeren, Archief) with + as the accessory; selection mode, the
 * file screen and Quick Look swap the tab bar for a glass toolbar. Rows
 * swipe (Download / Archiveer, in Archief Terughalen / Verwijder) and a
 * long press opens the same actions as a desk right-click.
 */
@Component({
  selector: 'app-files-phone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet, RouterLink, AuthImage, Icon, IosNav, IosTabbar, MenuTrigger, DateNlPipe, Segmented, Skeleton, SwipeActions, Sheet, FilesInspector,
  ],
  template: `
    @let location = c.loc();
    @let sel = c.selection().selected;
    <div class="ios-page files-phone" [class.files-phone--picking]="c.picking()">
      @if (location.fileId !== null) {
        <!-- ============================ the file screen -->
        <app-ios-nav [title]="c.detail()?.name ?? 'Bestand'" [largeTitle]="false" backLabel=""
                     [backAriaLabel]="'Terug naar ' + c.heading()" (back)="c.goBack()">
          <span trail>
            <button class="ios-circle" type="button" aria-label="Meer acties" [disabled]="!c.detail()" (click)="fileScreenMenu()"><app-icon name="more" [size]="22" /></button>
          </span>
        </app-ios-nav>
        <app-files-inspector layout="screen" />
      } @else {
        <app-ios-nav [title]="navTitle()" [backLabel]="c.picking() ? null : isRoot() ? 'App' : ''"
                     [backUrl]="isRoot() ? ret.phoneUrl() : null"
                     [backAriaLabel]="isRoot() ? 'Terug naar ' + ret.label() : 'Terug naar ' + c.parentTitle()" (back)="c.goBack()">
          @if (c.picking()) {
            <span lead><button class="ios-capsule ios-capsule--sm" type="button" (click)="allOrNone()">{{ allPicked() ? 'Geen' : 'Alles' }}</button></span>
          }
          @if (c.picking()) {
            <span trail><button class="ios-capsule ios-capsule--sm" type="button" (click)="c.togglePicking(false)"><b>Klaar</b></button></span>
          } @else {
            <span trail class="ios-glass-group">
              @if (isList()) {
                <button class="ios-capsule ios-capsule--sm" type="button" [disabled]="!c.assets().length" (click)="c.togglePicking(true)">Selecteer</button>
              }
              <button class="ios-circle" type="button" aria-label="Meer" (click)="screenMenu()"><app-icon name="more" [size]="22" /></button>
            </span>
          }
          @if (caption(); as text) {
            <p caption class="ios-large__sub files-phone__caption">
              {{ text }}
              @if (c.recordRoute(); as route) { · <a [routerLink]="route.link" [queryParams]="route.query">Openen ›</a> }
            </p>
          }
          <div below class="ios-subbar files-phone__subbar">
            <div class="ios-search" [class.is-active]="searchFocus()">
              <label class="ios-search__field">
                <app-icon name="search" [size]="16" />
                <input type="search" enterkeyhint="search" autocomplete="off" [placeholder]="placeholder()" [attr.aria-label]="placeholder()"
                       [value]="c.queryDraft()" (input)="c.typeQuery(value($event))" (focus)="searchFocus.set(true)"
                       (blur)="searchBlur()" (keydown.enter)="submit($event)" />
                <button class="ios-search__clear" type="button" aria-label="Zoekopdracht wissen" (click)="c.clearQuery()"><app-icon name="close" [size]="15" /></button>
              </label>
              <button class="ios-search__cancel" type="button" (pointerdown)="$event.preventDefault()" (click)="cancelSearch()">Annuleer</button>
            </div>
            @if (showKinds()) {
              <app-segmented class="files-phone__kinds" variant="ios" label="Bestandstype" [options]="kinds" [value]="location.kind ?? 'all'" (changed)="setKind($event)" />
            }
          </div>
        </app-ios-nav>

        @if (showRecentSearches()) {
          <!-- ============================ recent searches -->
          <section class="ios-section">
            <div class="ios-section__head"><h2>Recente zoekopdrachten</h2><button class="ios-section__link" type="button" (pointerdown)="$event.preventDefault()" (click)="c.clearSearches()">Wis</button></div>
            <div class="ios-group">
              @for (term of c.recentSearches(); track term) {
                <button class="ios-cell" type="button" (pointerdown)="$event.preventDefault()" (click)="useSearch(term)"><app-icon class="files-muted" name="recent" [size]="17" /><span class="ios-cell__body"><span class="ios-cell__title">{{ term }}</span></span></button>
              }
            </div>
          </section>
        } @else if (isHub()) {
          <!-- ============================ the hub -->
          <section class="ios-section">
            <div class="ios-section__head"><h2>Recent</h2><button class="ios-section__link" type="button" (click)="c.openRecent()">Alles ›</button></div>
            <div class="files-shelf" role="list" aria-label="Nieuwste bestanden">
              @if (c.recentStripFailed()) {
                <p class="files-muted files-shelf__empty">Niet geladen · <button class="ios-section__link" type="button" (click)="c.loadRecentStrip()">Opnieuw proberen</button></p>
              } @else if (c.recentStrip(); as strip) {
                @for (asset of strip; track asset.id) {
                  <div class="files-shelf__cell" role="listitem">
                    <button class="files-shelf__item" type="button" appMenuTrigger (menuTrigger)="c.openFileMenu(asset, null)" (click)="c.openFileScreen(asset.id)">
                      @if (asset.kind === 'IMAGE') { <img [appAuthSrc]="c.media.thumbnailUrl(asset.id)" appAuthLazy alt="" draggable="false" /> }
                      @else { <span class="files-ext files-ext--lg" [class]="tone(asset)">{{ badge(asset) }}</span> }
                      <span>{{ asset.name }}</span>
                    </button>
                  </div>
                } @empty { <p class="files-muted files-shelf__empty">Nog geen bestanden.</p> }
              } @else {
                @for (slot of [1, 2, 3, 4]; track slot) { <span class="files-shelf__item files-shelf__item--skel"><span class="skel"></span></span> }
              }
            </div>
          </section>
          <section class="ios-section">
            <div class="ios-section__head"><h2>Mappen</h2></div>
            <div class="ios-group ios-group--icons">
              @for (folder of c.childFolders(); track folder.id) {
                <button class="ios-cell" type="button" appMenuTrigger (menuTrigger)="c.openFolderMenu(folder, null)" (click)="c.openFolder(folder.id)">
                  <span class="ios-tile ios-tile--soft tone-amber"><app-icon name="folder" [size]="18" /></span>
                  <span class="ios-cell__body"><span class="ios-cell__title">{{ folder.name }}</span><span class="ios-cell__sub">{{ meta(folder.id) }}</span></span>
                  <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
                </button>
              } @empty {
                @if (c.store.loading()) {
                  <div class="files-phone__skel"><app-skeleton kind="list" [rows]="3" /></div>
                } @else if (c.store.failed()) {
                  <button class="ios-cell" type="button" (click)="c.store.loadFolders()">
                    <span class="ios-tile ios-tile--soft tone-grey"><app-icon name="alert" [size]="18" /></span>
                    <span class="ios-cell__body"><span class="ios-cell__title">Mappen niet geladen</span><span class="ios-cell__sub">Tik om het opnieuw te proberen</span></span>
                  </button>
                } @else {
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Nog geen mappen</span><span class="ios-cell__sub">Bestanden komen vanzelf in de juiste map zodra je ze koppelt.</span></span></div>
                }
              }
            </div>
          </section>
          @if (c.assets().length) {
            <section class="ios-section">
              <div class="ios-section__head"><h2>Zonder map</h2><span class="ios-section__trail">{{ c.assets().length }}{{ c.hasMore() ? '+' : '' }}</span></div>
              <div class="ios-group ios-group--thumbs">
                @for (asset of c.sorted(); track asset.id) { <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: asset }" /> }
              </div>
            </section>
          }
          <section class="ios-section">
            <div class="ios-section__head"><h2>Gekoppeld aan</h2></div>
            <div class="ios-group ios-group--icons">
              @for (view of views; track view.key) {
                <button class="ios-cell" type="button" (click)="c.openView(view.key)">
                  <span class="ios-tile" [class]="view.tone"><app-icon [name]="view.iconName" [size]="18" /></span>
                  <span class="ios-cell__body"><span class="ios-cell__title">{{ view.label }}</span><span class="ios-cell__sub">{{ view.hint }}</span></span>
                  <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
                </button>
              }
            </div>
          </section>
        } @else {
          <!-- ============================ a list screen -->
          @if (c.inOverig() && !c.searching()) {
            <div class="ios-banner ios-banner--info"><app-icon name="info" [size]="18" /><span>Hier komen uploads zonder map. Koppel een bestand aan een product, kost of reeks en het verhuist vanzelf naar de juiste map.</span></div>
          }
          @if (c.childFolders().length) {
            <section class="ios-section">
              <div class="ios-section__head"><h2>Mappen</h2></div>
              <div class="ios-group ios-group--icons">
                @for (folder of c.childFolders(); track folder.id) {
                  <button class="ios-cell" type="button" [disabled]="c.picking()" appMenuTrigger (menuTrigger)="c.openFolderMenu(folder, null)" (click)="c.openFolder(folder.id)">
                    <span class="ios-tile ios-tile--soft tone-amber"><app-icon name="folder" [size]="18" /></span>
                    <span class="ios-cell__body"><span class="ios-cell__title">{{ folder.name }}</span><span class="ios-cell__sub">{{ meta(folder.id) }}</span></span>
                    <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
                  </button>
                }
              </div>
            </section>
          }
          @if (c.loading()) {
            <section class="ios-section"><div class="ios-group files-phone__skel"><app-skeleton kind="list" [rows]="6" /></div></section>
          } @else if (c.loadError()) {
            <div class="ios-empty" role="alert">
              <span class="ios-empty__icon"><app-icon name="alert" [size]="26" /></span>
              <p class="ios-empty__title">Bestanden niet geladen</p>
              <p class="ios-empty__text">{{ c.loadError() }}</p>
              <button class="ios-capsule ios-capsule--tinted" type="button" (click)="c.reload()">Opnieuw proberen</button>
            </div>
          } @else if (!c.assets().length) {
            @if (!c.childFolders().length) {
              @let e = empty();
              <div class="ios-empty">
                <span class="ios-empty__icon"><app-icon [name]="e.icon" [size]="26" /></span>
                <p class="ios-empty__title">{{ e.title }}</p>
                <p class="ios-empty__text">{{ e.text }}</p>
                @if (e.action === 'add') { <button class="ios-capsule ios-capsule--tinted" type="button" (click)="addOpen.set(true)">Bestanden toevoegen</button> }
                @else if (e.action === 'clear') { <button class="ios-capsule ios-capsule--tinted" type="button" (click)="c.clearQuery()">Zoekopdracht wissen</button> }
                @else if (e.action === 'kind') { <button class="ios-capsule ios-capsule--tinted" type="button" (click)="c.setKind(null)">Alles tonen</button> }
              </div>
            }
          } @else {
            @for (section of c.sections(); track section.key) {
              <section class="ios-section">
                @if (section.kind === 'record') {
                  <div class="ios-section__head">
                    @if (section.route; as route) {
                      <a class="ios-section__title files-phone__record" [routerLink]="route.link" [queryParams]="route.query">{{ section.label }} · {{ section.assets.length }} ›</a>
                    } @else { <h2>{{ section.label }} · {{ section.assets.length }}</h2> }
                  </div>
                } @else if (section.kind === 'date') {
                  <div class="ios-section__head"><h2>{{ section.label }}</h2></div>
                } @else if (c.childFolders().length) {
                  <div class="ios-section__head"><h2>Bestanden</h2></div>
                }
                @if (c.layout() === 'grid') {
                  <div class="files-tiles">
                    @for (asset of section.assets; track asset.id) {
                      <button class="files-tiles__item" type="button" [attr.data-file]="asset.id" [class.files-flash]="asset.id === c.flashFileId()"
                              [attr.aria-pressed]="c.picking() ? sel.has(key(asset)) : null"
                              appMenuTrigger [appMenuTriggerDisabled]="c.picking()" (menuTrigger)="c.openFileMenu(asset, null)" (click)="tap(asset)">
                        @if (asset.kind === 'IMAGE') { <img [appAuthSrc]="c.media.thumbnailUrl(asset.id)" appAuthLazy alt="" draggable="false" /> }
                        @else { <span class="files-ext files-ext--lg" [class]="tone(asset)">{{ badge(asset) }}</span> }
                        @if (c.picking()) { <span class="ios-check" [class.is-on]="sel.has(key(asset))"><app-icon name="tick" [size]="14" /></span> }
                        <span class="files-tiles__name">{{ asset.name }}</span>
                      </button>
                    }
                  </div>
                } @else {
                  <div class="ios-group ios-group--thumbs">
                    @for (asset of section.assets; track asset.id) { <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: asset }" /> }
                  </div>
                }
              </section>
            }
            @if (c.hasMore()) {
              <p #sentinel class="ios-section__foot files-phone__more">
                @if (c.moreFailed()) { <button class="ios-section__link" type="button" (click)="c.loadMore()">Meer laden</button> }
                @else { {{ c.assets().length }}+ · meer laden… }
              </p>
            }
          }
        }

        @if (c.picking()) {
          <!-- ============================ selection toolbar -->
          @let files = c.selectedFiles();
          @let idle = files.length > 0 && !c.progress();
          <nav class="ios-toolbar" aria-label="Selectie">
            @if (location.place === 'archive') {
              <button class="ios-toolbar__btn" type="button" [disabled]="!idle" (click)="c.restore(files)"><app-icon name="restore" [size]="22" />Terughalen</button>
              <button class="ios-toolbar__btn ios-toolbar__btn--danger" type="button" [disabled]="!idle" (click)="c.deletePermanent(files)"><app-icon name="trash" [size]="22" />Verwijder</button>
            } @else {
              <button class="ios-toolbar__btn" type="button" [disabled]="!files.length || c.zipping()" (click)="c.downloadZip(files, 'original')">
                <span class="files-toolbar__icon"><app-icon name="download" [size]="22" />@if (files.length) { <span class="files-count">{{ files.length }}</span> }</span>{{ c.zipping() ? 'Bezig…' : 'Download' }}</button>
              <button class="ios-toolbar__btn" type="button" [disabled]="!idle" (click)="c.pickMoveTarget(files)"><app-icon name="move" [size]="22" />Verplaats</button>
              <button class="ios-toolbar__btn" type="button" [disabled]="!idle" (click)="c.pickLinkTarget(files)"><app-icon name="link" [size]="22" />Koppel</button>
              <button class="ios-toolbar__btn" type="button" [disabled]="!idle" (click)="c.archive(files)"><app-icon name="archive" [size]="22" />Archiveer</button>
            }
          </nav>
        } @else if (!c.quickLook()) {
          <app-ios-tabbar label="Documenten en media" [tabs]="tabs()" [accessoryIcon]="canAdd() ? 'plus' : null"
                          accessoryLabel="Toevoegen" (accessory)="addOpen.set(true)" />
        }
      }

      @if (pill(); as state) {
        <button class="ios-float files-pill" type="button" [style.--progress]="state.progress + '%'" (click)="pillTap()">
          <span class="files-pill__stack" aria-hidden="true">
            @for (preview of state.previews; track $index) { <img [src]="preview" alt="" /> }
          </span>
          <span>{{ state.text }}</span>
          @if (state.running) { <i class="ios-float__bar" aria-hidden="true"></i> }
        </button>
      }
    </div>

    <ng-template #row let-asset>
      @let archive = c.place() === 'archive';
      @let where = whereOf(asset);
      <div class="ios-swipe" appSwipeActions #sw="swipeActions" [swipeStart]="1" [swipeEnd]="1" [swipeFull]="archive ? 'start' : 'both'"
           [swipeDisabled]="c.picking()" (swipeCommit)="swiped($event, asset)">
        <div class="ios-swipe__actions ios-swipe__actions--start">
          @if (archive) {
            <button class="ios-swipe__btn tone-blue" type="button" (click)="sw.close(); c.restore([asset])"><app-icon name="restore" [size]="18" />Terughalen</button>
          } @else {
            <button class="ios-swipe__btn tone-ok" type="button" (click)="sw.close(); c.download(asset)"><app-icon name="download" [size]="18" />Download</button>
          }
        </div>
        <div class="ios-swipe__actions ios-swipe__actions--end">
          @if (archive) {
            <button class="ios-swipe__btn tone-danger" type="button" [disabled]="asset.links.length > 0" (click)="sw.close(); c.deletePermanent([asset])">
              <app-icon [name]="asset.links.length ? 'link' : 'trash'" [size]="18" />{{ asset.links.length ? 'Gekoppeld' : 'Verwijder' }}</button>
          } @else {
            <button class="ios-swipe__btn tone-warn" type="button" (click)="sw.close(); c.archive([asset])"><app-icon name="archive" [size]="18" />Archiveer</button>
          }
        </div>
        <div class="ios-swipe__row">
          <button class="ios-cell ios-cell--tall" type="button" [attr.data-file]="asset.id" [class.files-flash]="asset.id === c.flashFileId()"
                  [attr.aria-pressed]="c.picking() ? c.selection().selected.has(key(asset)) : null"
                  appMenuTrigger [appMenuTriggerDisabled]="c.picking()" (menuTrigger)="c.openFileMenu(asset, null)" (click)="tap(asset)">
            @if (c.picking()) { <span class="ios-check" [class.is-on]="c.selection().selected.has(key(asset))"><app-icon name="tick" [size]="14" /></span> }
            @if (asset.kind === 'IMAGE') { <img class="ios-thumb" [appAuthSrc]="c.media.thumbnailUrl(asset.id)" appAuthLazy alt="" draggable="false" /> }
            @else { <span class="files-ext files-ext--row" [class]="tone(asset)">{{ badge(asset) }}</span> }
            <span class="ios-cell__body">
              <span class="ios-cell__title ios-cell__title--2 ios-cell__title--strong files-phone__name">{{ asset.name }}</span>
              <span class="ios-cell__sub">@if (where.kind === 'link') { <app-icon name="link" [size]="11" /> }{{ where.text }}{{ where.text ? ' · ' : '' }}{{ size(asset.sizeBytes) }} · {{ asset.updatedAt | dateNl }}</span>
            </span>
            @if (asset.share) { <app-icon class="ok-text" name="globe" [size]="16" /> }
          </button>
        </div>
      </div>
    </ng-template>

    @if (addOpen()) {
      <app-sheet title="Toevoegen" variant="ios" (closed)="addOpen.set(false)">
        <div body>
          <section class="ios-section">
            <p class="ios-section__foot files-phone__dest">Komt in: {{ destLabel() }}</p>
            <div class="ios-group ios-group--icons">
              <button class="ios-cell" type="button" (click)="camera.click()"><span class="ios-tile tone-accent"><app-icon name="camera" [size]="18" /></span>Foto maken</button>
              <input #camera type="file" accept="image/*" capture="environment" hidden (change)="picked($event)" />
              <button class="ios-cell" type="button" (click)="photos.click()"><span class="ios-tile tone-blue"><app-icon name="image" [size]="18" /></span>Foto’s kiezen</button>
              <input #photos type="file" accept="image/*" multiple hidden (change)="picked($event)" />
              <button class="ios-cell" type="button" (click)="documents.click()"><span class="ios-tile tone-teal"><app-icon name="document" [size]="18" /></span>Bestanden kiezen</button>
              <input #documents type="file" multiple hidden (change)="picked($event)" />
              @if (location.place === 'folders' && !c.searching()) {
                <button class="ios-cell" type="button" (click)="addOpen.set(false); c.newFolder(c.currentFolderId())"><span class="ios-tile tone-amber"><app-icon name="folder" [size]="18" /></span>Nieuwe map</button>
              }
            </div>
          </section>
        </div>
      </app-sheet>
    }
  `,
})
export class FilesPhone {
  readonly c = inject(FilesController);
  readonly ret = inject(WorkspaceReturn);
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');

  readonly views = LINK_VIEWS;
  readonly kinds: SegmentOption[] = [
    { id: 'all', label: 'Alles' },
    { id: 'IMAGE', label: 'Foto’s' },
    { id: 'DOCUMENT', label: 'Documenten' },
  ];
  readonly addOpen = signal(false);
  readonly searchFocus = signal(false);
  private observer: IntersectionObserver | null = null;

  readonly isHub = computed(() => {
    const location = this.c.loc();
    return location.place === 'folders' && location.folderId === 'root' && !location.query;
  });
  /** The roots of the three tabs lead out of the workspace; everything else goes up a level. */
  readonly isRoot = computed(() => this.isHub() || (!this.c.searching() && (this.c.place() === 'recent' || this.c.place() === 'archive')));
  readonly isList = computed(() => !this.isHub());
  readonly showKinds = computed(() => !this.isHub() || this.c.searching());
  readonly showRecentSearches = computed(() => this.searchFocus() && !this.c.queryDraft() && this.c.recentSearches().length > 0);
  readonly navTitle = computed(() => {
    if (this.c.picking()) {
      const count = this.c.selectionCount();
      return count ? `${count} geselecteerd` : 'Selecteer bestanden';
    }
    const location = this.c.loc();
    /* A search in a folder place looks through every folder, so the screen no longer is that folder. */
    if (this.c.globalSearch()) return this.c.heading();
    if (this.isHub() || (location.place === 'folders' && location.folderId === 'root')) return 'Documenten & media';
    if (location.place === 'view' && location.targetId !== null) return `${this.c.view()?.label ?? ''} · ${this.c.recordLabel()}`;
    return this.c.placeTitle();
  });
  readonly caption = computed(() => {
    const location = this.c.loc();
    if (this.c.picking()) return null;
    if (this.c.globalSearch()) return 'In alle mappen';
    if (location.place === 'folders' && location.folderId !== 'root') {
      const path = crumbsFor(this.c.store.folders(), location.folderId).slice(0, -1).map((crumb) => crumb.name);
      return ['in Mappen', ...path].join(' › ');
    }
    if (location.place === 'view') {
      const view = this.c.view();
      if (location.targetId !== null && view?.targetType) return `${targetLabel(view.targetType)} · ${this.c.recordLabel()}`;
      return view?.hint ?? null;
    }
    if (location.place === 'archive') return 'Opgeborgen bestanden';
    if (location.place === 'recent') return 'Laatst gewijzigd eerst';
    return null;
  });
  readonly placeholder = computed(() => this.isHub() || this.c.globalSearch() ? 'Zoek in alle bestanden' : this.c.searchPlaceholder());
  readonly canAdd = computed(() => this.c.uploadDest().kind !== 'none');
  readonly destLabel = computed(() => {
    const destination = this.c.uploadDest();
    return destination.kind === 'none' ? destination.reason : destination.label;
  });
  readonly allPicked = computed(() => {
    const ids = this.c.visibleFileIds();
    return ids.length > 0 && !this.c.hasMore() && ids.every((id) => this.c.selection().selected.has(fileKey(id)));
  });

  readonly tabs = computed<IosTab[]>(() => {
    const place = this.c.place();
    return [
      { id: 'recent', label: 'Recent', icon: 'recent', link: '/files', query: { view: 'all' }, active: place === 'recent' },
      { id: 'browse', label: 'Bladeren', icon: 'folder', link: '/files', query: {}, active: place === 'folders' || place === 'view' },
      { id: 'archive', label: 'Archief', icon: 'archive', link: '/files', query: { view: 'all', archief: 1 }, active: place === 'archive' },
    ];
  });

  readonly empty = computed(() => {
    const location = this.c.loc();
    const view = this.c.view();
    if (location.query) return { icon: 'search', title: `Niets gevonden voor “${location.query}”`, text: 'Zoekt in namen, oorspronkelijke bestandsnamen en bronnen.', action: 'clear' };
    if (location.kind) return { icon: location.kind === 'IMAGE' ? 'image' : 'document', title: location.kind === 'IMAGE' ? 'Geen foto’s hier' : 'Geen documenten hier', text: 'Het filter toont alleen één soort bestand.', action: 'kind' };
    switch (location.place) {
      case 'archive': return { icon: 'archive', title: 'Het archief is leeg', text: 'Gearchiveerde bestanden blijven hier tot je ze terughaalt of definitief verwijdert.', action: null };
      case 'recent': return { icon: 'recent', title: 'Nog geen bestanden', text: 'Foto’s en documenten die je toevoegt of die bij producten, kosten en inkooporders horen, verschijnen hier.', action: 'add' };
      case 'view':
        if (location.targetId !== null) return { icon: view?.iconName ?? 'link', title: `Nog geen bestanden bij ${this.c.recordLabel()}`, text: 'Voeg ze toe met + of koppel een bestaand bestand.', action: view?.canUpload ? 'add' : null };
        return { icon: view?.iconName ?? 'link', title: view?.emptyTitle ?? '', text: view?.emptyText ?? '', action: null };
      default: return { icon: 'folder', title: 'Deze map is leeg', text: 'Kies + om bestanden toe te voegen.', action: 'add' };
    }
  });

  /**
   * The glass pill over the tab bar while a closed tray uploads, a moment
   * after it finished, and for as long as a finished tray needs a look
   * (failures, failed links, files the library already had).
   */
  readonly pill = computed(() => {
    const tray = this.c.tray();
    const note = this.c.uploadedNote();
    const issue = this.c.trayIssue();
    if (!tray || this.c.trayOpen() || (!tray.running && !note && !issue)) return null;
    const stats = this.c.trayStats();
    const previews = tray.items.map((item) => item.preview).filter((url): url is string => !!url).slice(0, 3);
    return {
      running: tray.running,
      previews,
      progress: stats.total ? Math.round(((stats.done + stats.failed) / stats.total) * 100) : 0,
      text: tray.running ? `${stats.done + stats.failed} van ${stats.total} geüpload`
        : issue ? `${issue} · Bekijk` : `${note?.count ?? stats.done} toegevoegd · Toon`,
    };
  });

  constructor() {
    const injector = inject(Injector);
    /* The hub's shelf also loads when the page was opened on a desk and then narrowed to a phone. */
    effect(() => {
      if (this.isHub() && this.c.recentStrip() === null && !this.c.recentStripFailed()) untracked(() => void this.c.loadRecentStrip());
    });
    /* "Toon in map": once the folder's rows are there, the file's row comes into view and flashes. */
    effect(() => {
      const id = this.c.flashFileId();
      if (id === null || this.c.loading() || !this.c.assets().some((asset) => asset.id === id)) return;
      afterNextRender(() => {
        document.querySelector(`.files-phone [data-file="${id}"]`)?.scrollIntoView({ block: 'center' });
        setTimeout(() => { if (this.c.flashFileId() === id) this.c.flashFileId.set(null); }, 1600);
      }, { injector });
    });
    effect(() => {
      const sentinel = this.sentinel()?.nativeElement;
      untracked(() => {
        this.observer?.disconnect();
        if (!sentinel || typeof IntersectionObserver === 'undefined') return;
        this.observer ??= new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) void this.c.loadMore();
        }, { rootMargin: '320px' });
        this.observer.observe(sentinel);
      });
    });
    inject(DestroyRef).onDestroy(() => this.observer?.disconnect());
  }

  key(asset: MediaAssetSummary): string { return fileKey(asset.id); }
  size(bytes: number): string { return sizeLabel(bytes); }
  badge(asset: MediaAssetSummary): string { return badgeText(asset); }
  tone(asset: MediaAssetSummary): string { return extensionToneClass(asset); }
  meta(folderId: number): string { return folderMeta(this.c.store.counts().get(folderId)); }
  whereOf(asset: MediaAssetSummary) { return whereLine(asset, this.c.loc(), this.c.store.folders()); }
  value(event: Event): string { return (event.target as HTMLInputElement).value; }

  setKind(id: string): void {
    this.c.setKind(id === 'IMAGE' || id === 'DOCUMENT' ? id : null);
  }

  /** A row or tile: picked in selection mode, otherwise the file screen. */
  tap(asset: MediaAssetSummary): void {
    if (this.c.picking()) this.c.togglePick(asset.id);
    else this.c.openFileScreen(asset.id);
  }

  swiped(side: RowSwipeSide, asset: MediaAssetSummary): void {
    const archive = this.c.place() === 'archive';
    if (side === 'start') {
      if (archive) void this.c.restore([asset]);
      else void this.c.download(asset);
    } else if (!archive) {
      void this.c.archive([asset]);
    }
  }

  async allOrNone(): Promise<void> {
    if (this.allPicked()) this.c.togglePicking(true);
    else await this.c.pickAll();
  }

  submit(event: Event): void {
    const text = this.value(event);
    this.c.commitQuery(text);
    this.c.rememberSearch(text);
    (event.target as HTMLElement).blur();
  }

  searchBlur(): void {
    /* Late enough for a tap on a recent search to land first. */
    setTimeout(() => this.searchFocus.set(false), 150);
  }

  cancelSearch(): void {
    this.c.clearQuery();
    this.searchFocus.set(false);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  useSearch(term: string): void {
    this.c.queryDraft.set(term);
    this.c.commitQuery(term);
    this.c.rememberSearch(term);
    this.searchFocus.set(false);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  picked(event: Event): void {
    this.c.chooseFiles(event);
    this.addOpen.set(false);
  }

  pillTap(): void {
    if (this.c.uploadedNote() && !this.c.trayIssue()) this.c.showUploaded();
    else this.c.trayOpen.set(true);
  }

  /** The ⋯ of a list screen or the hub, with what that screen can do. */
  screenMenu(): void {
    const location = this.c.loc();
    const layout = this.c.layout();
    const view: ContextMenuItem[] = [
      { id: 'layout-list', label: 'Lijst', iconName: 'list', checked: layout === 'list', divider: true },
      { id: 'layout-grid', label: 'Tegels', iconName: 'grid', checked: layout === 'grid' },
    ];
    const select: ContextMenuItem = { id: 'select', label: 'Selecteren', iconName: 'check', disabled: !this.c.assets().length };
    const sort: ContextMenuItem = { id: 'sort', label: 'Sorteren op…', iconName: 'filter', divider: true };
    let items: ContextMenuItem[];
    const folder = this.c.currentFolder();
    if (this.isHub()) {
      items = [{ id: 'new-folder', label: 'Nieuwe map', iconName: 'folder' }];
    } else if (location.place === 'archive') {
      items = [select, sort];
    } else if (folder) {
      items = [
        select,
        { id: 'new-folder', label: 'Nieuwe submap', iconName: 'plus' },
        ...view, sort,
        { id: 'folder-download', label: 'Map downloaden', iconName: 'download', divider: true },
        { id: 'folder-rename', label: 'Map hernoemen', iconName: 'pencil' },
        { id: 'folder-move', label: 'Map verplaatsen…', iconName: 'move' },
        { id: 'folder-delete', label: 'Map verwijderen', iconName: 'trash', danger: true, divider: true },
      ];
    } else {
      items = [select, ...view, sort, { id: 'download-all', label: 'Alles downloaden', iconName: 'download', divider: true, disabled: !this.c.assets().length }];
    }
    this.c.menu.set({
      title: this.navTitle(), items, anchor: null,
      run: (id) => {
        switch (id) {
          case 'select': this.c.togglePicking(true); break;
          case 'new-folder': this.c.newFolder(this.c.currentFolderId()); break;
          case 'layout-list': this.c.setLayout('list'); break;
          case 'layout-grid': this.c.setLayout('grid'); break;
          case 'sort': this.c.openSortMenu(null, PHONE_SORTS); break;
          case 'download-all': void this.c.downloadAll(); break;
          default: if (folder) this.c.runFolderAction(id, folder as MediaFolder);
        }
      },
    });
  }

  /** The file screen's ⋯: what the toolbar and the groups do not already offer. */
  fileScreenMenu(): void {
    const asset = this.c.detail();
    if (!asset) return;
    const items: ContextMenuItem[] = [
      { id: 'rename', label: 'Hernoemen', iconName: 'pencil' },
      { id: 'version', label: 'Nieuwe versie…', iconName: 'upload', disabled: asset.archived },
      { id: 'link', label: 'Koppelen aan…', iconName: 'link', disabled: asset.archived },
      { id: 'reveal', label: 'Toon in map', iconName: 'folder' },
      ...(asset.share ? [{ id: 'copy-link', label: 'Kopieer publieke link', iconName: 'copy', divider: true }] : []),
    ];
    this.c.menu.set({ title: asset.name, items, anchor: null, run: (id) => this.c.runFileAction(id, [asset]) });
  }
}
