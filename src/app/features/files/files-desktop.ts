import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, signal, untracked, viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthImage } from '../../core/api/auth-image';
import { MediaAssetSummary } from '../../core/api/media-models';
import type { ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { Icon } from '../../shared/icon';
import { keyContext } from '../../shared/key-context';
import { MenuTrigger } from '../../shared/menu-trigger';
import { DateNlPipe, DateTimeNlPipe } from '../../shared/pipes';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import { elementWidth } from '../../shared/workspace-layout';
import {
  SORT_KEYS, badgeText, datesGroupable, extensionToneClass, leavesFiles, linkLabel, recordOpenLabel, targetIconName, targetLabel,
} from './files-collections';
import type { RecordRoute, SortKey } from './files-collections';
import { folderMeta, pathTail, sizeLabel } from './files-rules';
import { fileKey, folderKey } from './files-selection';
import type { RowKey } from './files-selection';
import { filesCommand } from './files-keys';
import { FilesController, FilesSection } from './files-controller';
import { FilesInspector } from './files-inspector';

/** "Alle … tonen" after narrowing a view to one record. */
const VIEW_PLURALS: Record<string, string> = {
  product: 'producten', family: 'reeksen', purchase: 'inkooporders', cost: 'kosten', planner: 'planneritems',
};

/**
 * Documenten & media on a desk: one toolbar (where you are, filters,
 * search, info, add), a table or grid of folders and files with Finder
 * selection and drag and drop, the inspector docked beside it from 1000px
 * of page width or as a drawer below that, and a status bar that says what
 * is loaded, selected and going on. Keyboard: see files-keys.
 */
@Component({
  selector: 'app-files-desktop',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AuthImage, Icon, MenuTrigger, Segmented, Skeleton, DateTimeNlPipe, DateNlPipe, FilesInspector],
  host: { '(window:keydown)': 'onKey($event)' },
  template: `
    @let location = c.loc();
    @let sel = c.selection().selected;
    @let view = c.view();
    <div #page class="wk-page files-desk">
      <!-- ============================ the toolbar: where you are, then the tools (the selection's tools from two items) -->
      <header class="wk-toolbar files-bar" [class.wk-toolbar--selection]="c.multi()">
        <div class="wk-toolbar__lead">
          @if (c.searching()) {
            <h1 class="wk-toolbar__title">{{ c.globalSearch() ? 'Zoekresultaten' : c.placeTitle() }}</h1>
            <span class="wk-chips">
              <span class="wk-chip is-on">Zoeken: “{{ location.query }}”
                <button class="wk-chip__x" type="button" aria-label="Zoekopdracht wissen" (click)="c.clearQuery()"><app-icon name="close" [size]="10" /></button></span>
              @if (c.globalSearch()) { <span class="wk-chip files-chip--quiet">In alle mappen</span> }
            </span>
          } @else if (location.place === 'folders') {
            <nav class="wk-crumbs files-crumbs" aria-label="Pad">
              @if (c.crumbs().length) {
                <button type="button" [class.files-drop]="dropTarget() === 'top'" (click)="c.openFolder('root')"
                        (dragover)="over($event, null)" (dragleave)="leave()" (drop)="dropOnFolder($event, null)">Mappen</button>
              } @else { <h1 class="wk-crumbs__current">Mappen</h1> }
              @for (crumb of c.crumbs(); track crumb.id; let last = $last) {
                <app-icon name="chevron-right" [size]="14" />
                @if (last) { <h1 class="wk-crumbs__current">{{ crumb.name }}</h1> }
                @else {
                  <button type="button" [class.files-drop]="dropTarget() === crumb.id" (click)="c.openFolder(crumb.id)"
                          (dragover)="over($event, crumb.id)" (dragleave)="leave()" (drop)="dropOnFolder($event, crumb.id)">{{ crumb.name }}</button>
                }
              }
            </nav>
          } @else if (location.place === 'view' && view) {
            <nav class="wk-crumbs" aria-label="Pad">
              <span class="files-bar__prefix">Gekoppeld aan</span><app-icon name="chevron-right" [size]="14" />
              @if (location.targetId !== null) {
                <button type="button" (click)="c.dropRecord()">{{ view.label }}</button><app-icon name="chevron-right" [size]="14" />
                <h1 class="wk-crumbs__current">{{ c.recordLabel() }}</h1>
              } @else { <h1 class="wk-crumbs__current">{{ view.label }}</h1> }
            </nav>
          } @else {
            <h1 class="wk-toolbar__title">{{ c.placeTitle() }}</h1>
          }
        </div>
        @if (c.multi()) {
          <div class="wk-toolbar__tools files-bar__tools" role="toolbar" aria-label="Selectie">
            @let running = !!c.progress();
            <span class="wk-toolbar__count">{{ c.selectionCount() }} geselecteerd<span class="files-bar__size"> · {{ size(c.selectionSize()) }}</span></span>
            <button class="wk-btn" type="button" aria-label="Downloaden" title="Downloaden" [disabled]="c.zipping() || !c.selectedFiles().length" (click)="c.openDownloadMenu(below($event))">
              <app-icon name="download" [size]="16" /><span class="files-bar__text">Downloaden</span><app-icon name="chevron-down" [size]="14" /></button>
            @if (c.place() === 'archive') {
              <button class="wk-btn" type="button" aria-label="Terughalen" title="Terughalen" [disabled]="running || !c.selectedFiles().length" (click)="c.restore(c.selectedFiles())"><app-icon name="restore" [size]="16" /><span class="files-bar__text">Terughalen</span></button>
              <button class="wk-btn wk-btn--danger" type="button" aria-label="Definitief verwijderen…" title="Definitief verwijderen…" [disabled]="running || !c.selectedFiles().length" (click)="c.deletePermanent(c.selectedFiles())"><app-icon name="trash" [size]="16" /><span class="files-bar__text">Definitief verwijderen…</span></button>
            } @else {
              <button class="wk-btn" type="button" aria-label="Verplaatsen…" title="Verplaatsen…" [disabled]="running || !c.selectedFiles().length" (click)="c.pickMoveTarget(c.selectedFiles())"><app-icon name="move" [size]="16" /><span class="files-bar__text">Verplaatsen…</span></button>
              <button class="wk-btn" type="button" aria-label="Koppelen aan…" title="Koppelen aan…" [disabled]="running || !c.selectedFiles().length" (click)="c.pickLinkTarget(c.selectedFiles())"><app-icon name="link" [size]="16" /><span class="files-bar__text">Koppelen aan…</span></button>
              <button class="wk-btn" type="button" aria-label="Archiveren" title="Archiveren" [disabled]="running || !c.selectedFiles().length" (click)="c.archive(c.selectedFiles())"><app-icon name="archive" [size]="16" /><span class="files-bar__text">Archiveren</span></button>
            }
            <span class="wk-toolbar__divider"></span>
            <button class="wk-btn wk-btn--ghost" type="button" aria-label="Selectie wissen" title="Selectie wissen (esc)" (click)="c.clearAll()"><span class="files-bar__text">Selectie wissen</span><app-icon name="close" [size]="14" /></button>
          </div>
        } @else {
          <div class="wk-toolbar__tools files-bar__tools">
            <app-segmented label="Bestandstype" [options]="kinds" [value]="location.kind ?? 'all'" (changed)="setKind($event)" />
            <!-- Lijst/Raster and Sorteren; a narrow bar folds them into one "Weergave" menu -->
            <span class="files-bar__view">
              <app-segmented label="Weergave" [options]="layouts" [value]="c.layout()" (changed)="c.setLayout($event === 'grid' ? 'grid' : 'list')" />
              @if (c.layout() === 'grid') {
                <button class="wk-btn" type="button" aria-label="Sorteren" title="Sorteren" (click)="c.openSortMenu(below($event), sortKeys)">
                  <app-icon name="filter" [size]="15" /><span class="files-bar__text">Sorteren</span><app-icon name="chevron-down" [size]="14" /></button>
              }
            </span>
            <button class="wk-btn files-bar__viewmenu" type="button" aria-label="Weergave" title="Weergave" (click)="viewMenu(below($event))">
              <app-icon [name]="c.layout() === 'grid' ? 'grid' : 'list'" [size]="16" /><app-icon name="chevron-down" [size]="14" /></button>
            <label class="wk-search wk-search--collapsible files-bar__search">
              <app-icon name="search" [size]="15" />
              <input id="files-search" type="search" autocomplete="off" [placeholder]="c.searchPlaceholder()" [attr.aria-label]="c.searchPlaceholder()"
                     [value]="c.queryDraft()" (input)="c.typeQuery(value($event))" (keydown.enter)="c.commitQuery(value($event))"
                     (keydown.escape)="c.clearQuery(); blur($event)" />
              <button class="wk-search__clear" type="button" aria-label="Zoekopdracht wissen" (click)="c.clearQuery()"><app-icon name="close" [size]="14" /></button>
            </label>
            <button class="wk-btn wk-btn--icon" type="button" aria-label="Info" title="Info (⌘I)" [attr.aria-pressed]="infoShown()" (click)="c.toggleInspector()"><app-icon name="info" [size]="17" /></button>
            @if (location.place === 'folders' && !c.searching()) {
              <button class="wk-btn wk-btn--icon" type="button" aria-label="Nieuwe map" title="Nieuwe map" (click)="c.newFolder(c.currentFolderId())"><app-icon name="folder" [size]="17" /></button>
            }
            <button class="wk-btn wk-btn--primary files-bar__add" type="button" aria-label="Toevoegen" [disabled]="c.uploadDest().kind === 'none'" [title]="addTitle()" (click)="c.pickFiles()">
              <app-icon name="plus" [size]="16" /><span class="files-bar__text">Toevoegen</span></button>
          </div>
        }
      </header>

      <div class="wk-notices">
        @if (location.place === 'view' && location.targetId !== null && view?.targetType) {
          <div class="wk-banner files-strip" role="region" aria-label="Record">
            <app-icon [name]="view!.iconName" [size]="18" />
            <span class="wk-banner__text"><b>{{ type(view!.targetType!) }}</b> · {{ c.recordLabel() }} · {{ c.assets().length }}{{ c.hasMore() ? '+' : '' }} bestand{{ c.assets().length === 1 ? '' : 'en' }}</span>
            <span class="wk-banner__actions">
              @if (c.recordRoute(); as route) {
                <a class="wk-btn wk-btn--sm" [routerLink]="route.link" [queryParams]="route.query">{{ openLabel(view!.targetType!) }} ›</a>
              }
              <button class="wk-btn wk-btn--sm wk-btn--ghost" type="button" (click)="c.dropRecord()">Alle {{ plural(view!.key) }} tonen</button>
            </span>
          </div>
        }
      </div>

      <div class="wk-body files-body" [class.wk-body--split]="showDocked()"
           (dragenter)="osEnter($event)" (dragover)="osOver($event)" (dragleave)="osLeave($event)" (drop)="osDrop($event)">
        <div #pane class="wk-pane files-pane" [class.files-pane--grid]="c.layout() === 'grid'"
             (click)="paneClick($event)" (contextmenu)="areaMenu($event)">
          @if (c.inOverig() && !c.searching()) {
            <div class="files-pane__notice">
              <div class="wk-banner wk-banner--inset"><app-icon name="info" [size]="18" />
                <span class="wk-banner__text">Hier komen uploads zonder map. Koppel een bestand aan een product, kost of reeks en het verhuist vanzelf naar de juiste map.</span></div>
            </div>
          }
          @if (c.loading() || foldersPending()) {
            <div class="files-pane__skeleton"><app-skeleton kind="list" [rows]="8" /></div>
          } @else if (c.loadError()) {
            <div class="wk-empty" role="alert">
              <span class="wk-empty__icon"><app-icon name="alert" [size]="22" /></span>
              <p class="wk-empty__title">Bestanden niet geladen</p>
              <p class="wk-empty__text">{{ c.loadError() }}</p>
              <div class="wk-empty__actions"><button class="wk-btn" type="button" (click)="c.reload()">Opnieuw proberen</button></div>
            </div>
          } @else if (!c.childFolders().length && !c.assets().length) {
            @let e = empty();
            <div class="wk-empty">
              <span class="wk-empty__icon"><app-icon [name]="e.icon" [size]="22" /></span>
              <p class="wk-empty__title">{{ e.title }}</p>
              <p class="wk-empty__text">{{ e.text }}</p>
              <div class="wk-empty__actions">
                @switch (e.action) {
                  @case ('add') { <button class="wk-btn wk-btn--primary" type="button" (click)="c.pickFiles()"><app-icon name="plus" [size]="16" />Bestanden toevoegen</button> }
                  @case ('clear') { <button class="wk-btn" type="button" (click)="c.clearQuery()">Zoekopdracht wissen</button> }
                  @case ('kind') { <button class="wk-btn" type="button" (click)="c.setKind(null)">Alles tonen</button> }
                  @case ('area') { @if (view?.area; as area) { <a class="wk-btn" [routerLink]="area.route.link" [queryParams]="area.route.query">{{ area.label }}</a> } }
                  @case ('folders') { <button class="wk-btn" type="button" (click)="c.store.loadFolders()">Opnieuw proberen</button> }
                }
              </div>
            </div>
          } @else if (c.layout() === 'list') {
            <!-- ============================ the list -->
            <div class="wk-table files-table" role="grid" [class.files-table--map]="showMap()" [class.wk-table--selecting]="c.multi()"
                 [attr.aria-label]="c.heading()" aria-multiselectable="true">
              <div class="wk-thead" role="row">
                <span class="wk-th" role="columnheader">
                  <input class="wk-check" type="checkbox" aria-label="Alles selecteren" [checked]="allChecked()" [indeterminate]="someChecked()" (change)="toggleAll()" />
                </span>
                @for (column of columns(); track column.key) {
                  <span class="wk-th" role="columnheader" [class.wk-th--num]="column.key === 'size'" [attr.data-hide]="column.hide"
                        [attr.aria-sort]="c.sort().key === column.key ? (c.sort().dir === 'asc' ? 'ascending' : 'descending') : null">
                    <button class="wk-th__btn" type="button" (click)="c.sortBy(column.key)">{{ column.label }}
                      @if (c.sort().key === column.key) { <app-icon [name]="c.sort().dir === 'asc' ? 'chevron-up' : 'chevron-down'" [size]="12" /> }
                    </button>
                  </span>
                }
              </div>
              @for (folder of c.childFolders(); track folder.id) {
                @let key = folderKey(folder.id);
                <div class="wk-tr files-row files-row--folder" role="row" [attr.draggable]="drags" [attr.data-key]="key" [attr.aria-selected]="sel.has(key)"
                     [attr.tabindex]="tabFor(key)" [class.wk-tr--drop]="dropTarget() === folder.id"
                     (click)="c.rowClick(key, $event)" (dblclick)="c.openFolder(folder.id)" appMenuTrigger (menuTrigger)="c.openFolderMenu(folder, $event)"
                     (dragstart)="dragStart($event, key)" (dragend)="endDrag()"
                     (dragover)="over($event, folder.id)" (dragleave)="leave()" (drop)="dropOnFolder($event, folder.id)">
                  <span class="wk-td" role="gridcell"><input class="wk-check" type="checkbox" [attr.aria-label]="'Selecteer map ' + folder.name" [checked]="sel.has(key)" (click)="$event.stopPropagation()" (change)="c.toggleRow(key)" /></span>
                  <span class="wk-td files-name" role="gridcell"><span class="files-icon files-icon--folder"><app-icon name="folder" [size]="17" /></span><span class="files-name__text">{{ folder.name }}</span></span>
                  <span class="wk-td files-muted" role="gridcell" data-hide="xxs">{{ meta(folder.id) }}</span>
                  @if (showMap()) { <span class="wk-td" role="gridcell" data-hide="xs"></span> }
                  <span class="wk-td" role="gridcell"></span><span class="wk-td" role="gridcell"></span><span class="wk-td" role="gridcell" data-hide="sm"></span>
                </div>
              }
              @for (section of c.sections(); track section.key) {
                @if (section.kind !== 'plain') {
                  <div class="wk-group files-group" role="row" [class.files-group--drop]="c.dropGroup()?.targetId === section.targetId && section.targetId !== null"
                       (dragover)="groupOver($event, section)" (dragleave)="groupLeave($event, section)" (drop)="osDrop($event)">
                    <span class="wk-group__label" role="rowheader">
                      @if (section.kind === 'record') {
                        <button class="wk-group__toggle" type="button" [attr.aria-expanded]="!section.collapsed" [attr.aria-label]="(section.collapsed ? 'Toon ' : 'Verberg ') + section.label" (click)="c.toggleGroup(section.targetId!)"><app-icon name="chevron-down" [size]="14" /></button>
                      }
                      <span class="files-group__name">{{ section.label }}</span><span class="wk-group__count">· {{ section.assets.length }}</span>
                      @if (section.kind === 'record') {
                        <span class="files-group__links">
                          @if (opens(section.route); as route) { <a class="wk-link" [routerLink]="route.link" [queryParams]="route.query">Openen ›</a> }
                          <button class="wk-link" type="button" (click)="c.openView(view!.key, section.targetId)">Alleen deze ›</button>
                        </span>
                      }
                    </span>
                  </div>
                }
                @if (!section.collapsed) {
                  @for (asset of section.assets; track asset.id) {
                    @let key = fileKey(asset.id);
                    <div class="wk-tr files-row" role="row" [attr.draggable]="drags" [attr.data-key]="key" [attr.aria-selected]="sel.has(key)" [attr.tabindex]="tabFor(key)"
                         (click)="c.rowClick(key, $event)" (dblclick)="c.openQuickLook(asset.id)" appMenuTrigger (menuTrigger)="c.openFileMenu(asset, $event)"
                         (dragstart)="dragStart($event, key)" (dragend)="endDrag()">
                      <span class="wk-td" role="gridcell"><input class="wk-check" type="checkbox" [attr.aria-label]="'Selecteer ' + asset.name" [checked]="sel.has(key)" (click)="$event.stopPropagation()" (change)="c.toggleRow(key)" /></span>
                      <span class="wk-td files-name" role="gridcell">
                        @if (asset.kind === 'IMAGE') { <img class="files-thumb" [appAuthSrc]="c.media.thumbnailUrl(asset.id)" appAuthLazy alt="" draggable="false" /> }
                        @else { <span class="files-ext" [class]="tone(asset)">{{ badge(asset) }}</span> }
                        <span class="files-name__text" [title]="asset.originalFilename">{{ asset.name }}</span>
                        @if (asset.share) { <app-icon class="ok-text" name="globe" [size]="14" title="Publieke link" /> }
                      </span>
                      <span class="wk-td files-used" role="gridcell" data-hide="xxs">
                        @if (asset.links.length) {
                          <app-icon [name]="icon(asset)" [size]="14" /><span class="files-used__label">{{ firstLink(asset) }}</span>
                          @if (asset.links.length > 1) { <span class="wk-pill">+{{ asset.links.length - 1 }}</span> }
                        } @else { <span class="files-muted">Niet gekoppeld</span> }
                      </span>
                      @if (showMap()) {
                        <span class="wk-td" role="gridcell" data-hide="xs">
                          <button class="files-map" type="button" [title]="c.pathOf(asset.folderId)" (click)="$event.stopPropagation(); c.reveal(asset)">{{ tail(asset) }}</button>
                        </span>
                      }
                      <span class="wk-td files-muted" role="gridcell">{{ asset.updatedAt | dateTimeNl }}</span>
                      <span class="wk-td wk-td--num" role="gridcell" [title]="asset.web ? 'Webformaat ' + size(asset.web.sizeBytes) : ''">{{ size(asset.sizeBytes) }}</span>
                      <span class="wk-td files-muted" role="gridcell" data-hide="sm">{{ asset.createdByName || '—' }}</span>
                    </div>
                  }
                }
              }
            </div>
          } @else {
            <!-- ============================ the grid -->
            <div class="files-grid" role="listbox" [class.files-grid--selecting]="c.multi()" [attr.aria-label]="c.heading()" aria-multiselectable="true">
              @for (folder of c.childFolders(); track folder.id) {
                @let key = folderKey(folder.id);
                <div class="files-tile files-tile--folder" role="option" [attr.draggable]="drags" [attr.data-key]="key" [attr.aria-selected]="sel.has(key)"
                     [attr.tabindex]="tabFor(key)" [class.files-tile--drop]="dropTarget() === folder.id"
                     (click)="c.rowClick(key, $event)" (dblclick)="c.openFolder(folder.id)" appMenuTrigger (menuTrigger)="c.openFolderMenu(folder, $event)"
                     (dragstart)="dragStart($event, key)" (dragend)="endDrag()"
                     (dragover)="over($event, folder.id)" (dragleave)="leave()" (drop)="dropOnFolder($event, folder.id)">
                  <input class="wk-check files-tile__check" type="checkbox" [attr.aria-label]="'Selecteer map ' + folder.name" [checked]="sel.has(key)" (click)="$event.stopPropagation()" (change)="c.toggleRow(key)" />
                  <span class="files-tile__media"><span class="files-icon files-icon--folder files-icon--xl"><app-icon name="folder" [size]="44" /></span></span>
                  <span class="files-tile__name">{{ folder.name }}</span>
                  <span class="files-tile__meta">{{ meta(folder.id) }}</span>
                </div>
              }
              @for (section of c.sections(); track section.key) {
                @if (section.kind !== 'plain') {
                  <div class="files-grid__head" role="presentation" [class.files-group--drop]="c.dropGroup()?.targetId === section.targetId && section.targetId !== null"
                       (dragover)="groupOver($event, section)" (dragleave)="groupLeave($event, section)" (drop)="osDrop($event)">
                    @if (section.kind === 'record') {
                      <button class="wk-group__toggle" type="button" [attr.aria-expanded]="!section.collapsed" [attr.aria-label]="(section.collapsed ? 'Toon ' : 'Verberg ') + section.label" (click)="c.toggleGroup(section.targetId!)"><app-icon name="chevron-down" [size]="14" /></button>
                    }
                    <span class="files-group__name">{{ section.label }}</span><span class="wk-group__count">· {{ section.assets.length }}</span>
                    @if (section.kind === 'record') {
                      <span class="files-group__links">
                        @if (opens(section.route); as route) { <a class="wk-link" [routerLink]="route.link" [queryParams]="route.query">Openen ›</a> }
                        <button class="wk-link" type="button" (click)="c.openView(view!.key, section.targetId)">Alleen deze ›</button>
                      </span>
                    }
                  </div>
                }
                @if (!section.collapsed) {
                  @for (asset of section.assets; track asset.id) {
                    @let key = fileKey(asset.id);
                    <div class="files-tile" role="option" [attr.draggable]="drags" [attr.data-key]="key" [attr.aria-selected]="sel.has(key)" [attr.tabindex]="tabFor(key)"
                         [title]="asset.originalFilename"
                         (click)="c.rowClick(key, $event)" (dblclick)="c.openQuickLook(asset.id)" appMenuTrigger (menuTrigger)="c.openFileMenu(asset, $event)"
                         (dragstart)="dragStart($event, key)" (dragend)="endDrag()">
                      <input class="wk-check files-tile__check" type="checkbox" [attr.aria-label]="'Selecteer ' + asset.name" [checked]="sel.has(key)" (click)="$event.stopPropagation()" (change)="c.toggleRow(key)" />
                      <span class="files-tile__media">
                        @if (asset.kind === 'IMAGE') { <img [appAuthSrc]="c.media.thumbnailUrl(asset.id)" appAuthLazy alt="" draggable="false" /> }
                        @else { <span class="files-ext files-ext--lg" [class]="tone(asset)">{{ badge(asset) }}</span> }
                        <span class="files-tile__badges">
                          @if (asset.links.length) { <span class="files-badge" [title]="asset.links.length + ' koppelingen'"><app-icon name="link" [size]="11" />{{ asset.links.length }}</span> }
                          @if (asset.share) { <span class="files-badge files-badge--ok" title="Publieke link"><app-icon name="globe" [size]="11" /></span> }
                        </span>
                      </span>
                      <span class="files-tile__name">{{ asset.name }}</span>
                      <span class="files-tile__meta">{{ size(asset.sizeBytes) }} · {{ asset.updatedAt | dateNl }}</span>
                    </div>
                  }
                }
              }
            </div>
          }
          @if (!c.loading() && c.hasMore()) {
            @if (c.moreFailed()) {
              <div class="files-more"><button class="wk-btn" type="button" (click)="c.loadMore()">Meer laden</button></div>
            } @else {
              <div #sentinel class="files-more files-muted">{{ c.loadingMore() || c.loadingAll() ? 'Laden…' : '' }}</div>
            }
          }
        </div>
        @if (showDocked()) { <app-files-inspector layout="pane" /> }
        @if (c.dropActive()) {
          <div class="wk-drop" [class.files-drop--refused]="c.uploadDest().kind === 'none'" [class.files-drop--strip]="groupDrop()">{{ c.dropText() }}</div>
        }
      </div>

      <footer class="wk-statusbar files-status" role="status">
        <span>{{ statusLeft() }}</span>
        <span class="wk-statusbar__mid">{{ statusMid() }}</span>
        <span class="wk-statusbar__end">
          @if (c.progress(); as progress) { {{ progress.label }}… {{ progress.done }} van {{ progress.total }} }
          @else if (c.uploading()) { Uploaden… {{ c.trayStats().done + c.trayStats().failed }} van {{ c.trayStats().total }} }
          @else if (c.dragHint()) { {{ c.dragHint() }} }
          @else if (c.dropActive()) { {{ c.dropText() }} }
          @else if (!c.trayOpen() && c.trayIssue()) { Upload: {{ c.trayIssue() }} · <button type="button" (click)="c.trayOpen.set(true)">Bekijk</button> }
          @else if (c.hasMore() && !groupable()) {
            Sortering geldt voor de geladen bestanden · <button type="button" [disabled]="c.loadingAll()" (click)="c.loadAll(true)">Alles laden</button>
          }
        </span>
      </footer>

      @if (showDrawer()) { <app-files-inspector layout="drawer" /> }
    </div>
  `,
})
export class FilesDesktop {
  readonly c = inject(FilesController);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly page = viewChild<ElementRef<HTMLElement>>('page');
  private readonly pane = viewChild<ElementRef<HTMLElement>>('pane');
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');

  readonly kinds: SegmentOption[] = [
    { id: 'all', label: 'Alles' },
    { id: 'IMAGE', label: 'Foto’s' },
    { id: 'DOCUMENT', label: 'Documenten', shortLabel: 'Docs' },
  ];
  readonly layouts: SegmentOption[] = [
    { id: 'list', label: '', icon: 'list', ariaLabel: 'Lijst' },
    { id: 'grid', label: '', icon: 'grid', ariaLabel: 'Raster' },
  ];
  readonly sortKeys = SORT_KEYS.map((option) => ({ id: option.key, label: option.label, key: option.key }));

  private readonly pageWidth = elementWidth(() => this.page()?.nativeElement);
  private readonly paneWidth = elementWidth(() => this.pane()?.nativeElement);

  /** Rows drag with a mouse; on a touch screen a long press opens the menu instead of lifting the row. */
  readonly drags = !isCoarsePointer();
  /** A link view without a record: files dropped on a group row link to it, so the overlay leaves the rows in sight. */
  readonly groupDrop = computed(() => {
    const destination = this.c.uploadDest();
    return destination.kind === 'record' && destination.targetId === null;
  });
  /** The Mappen home waits for the folders before it can say there are none. */
  readonly foldersPending = computed(() =>
    this.c.showsFolders() && this.c.currentFolderId() === null && this.c.store.loading() && !this.c.store.folders().length);
  readonly showDocked = computed(() => this.c.docked() && this.c.inspectorOn());
  readonly showDrawer = computed(() => !this.c.docked() && this.c.drawerOpen());
  readonly infoShown = computed(() => this.c.docked() ? this.c.inspectorOn() : this.c.drawerOpen());
  readonly groupable = computed(() => datesGroupable(this.c.sort()));
  /** The Map column only where files come from several folders. */
  readonly showMap = computed(() => this.c.place() !== 'folders' || this.c.searching());
  readonly columns = computed(() => [
    { key: 'name' as SortKey, label: 'Naam', hide: null },
    { key: 'links' as SortKey, label: 'Gebruikt bij', hide: 'xxs' },
    ...(this.showMap() ? [{ key: 'folder' as SortKey, label: 'Map', hide: 'xs' }] : []),
    { key: 'updated' as SortKey, label: 'Gewijzigd', hide: null },
    { key: 'size' as SortKey, label: 'Grootte', hide: null },
    { key: 'by' as SortKey, label: 'Door', hide: 'sm' },
  ]);
  readonly allChecked = computed(() => {
    const keys = this.c.orderedKeys();
    return keys.length > 0 && keys.every((key) => this.c.selection().selected.has(key));
  });
  readonly someChecked = computed(() => this.c.selectionCount() > 0 && !this.allChecked());

  readonly addTitle = computed(() => {
    const destination = this.c.uploadDest();
    return destination.kind === 'none' ? destination.reason : `Komt in: ${destination.label}`;
  });

  readonly statusLeft = computed(() => {
    if (this.c.loading()) return 'Laden…';
    const files = this.c.assets().length;
    const count = `${files} bestand${files === 1 ? '' : 'en'}`;
    if (this.c.hasMore()) return `${files} geladen · meer bij scrollen`;
    const folders = this.c.childFolders().length;
    return folders ? `${count} · ${folders} submap${folders === 1 ? '' : 'pen'}` : count;
  });
  readonly statusMid = computed(() => {
    const count = this.c.selectionCount();
    if (!count) return '';
    const bytes = this.c.selectionSize();
    return `${count} geselecteerd${bytes ? ' · ' + sizeLabel(bytes) : ''}`;
  });

  readonly empty = computed(() => {
    const location = this.c.loc();
    const view = this.c.view();
    if (location.query) {
      return { icon: 'search', title: `Niets gevonden voor “${location.query}”`, text: 'Zoekt in namen, oorspronkelijke bestandsnamen en bronnen.', action: 'clear' };
    }
    if (location.kind) {
      return { icon: location.kind === 'IMAGE' ? 'image' : 'document', title: location.kind === 'IMAGE' ? 'Geen foto’s hier' : 'Geen documenten hier', text: 'Het filter toont alleen één soort bestand.', action: 'kind' };
    }
    switch (location.place) {
      case 'archive':
        return { icon: 'archive', title: 'Het archief is leeg', text: 'Gearchiveerde bestanden blijven hier tot je ze terughaalt of definitief verwijdert.', action: null };
      case 'recent':
        return { icon: 'recent', title: 'Nog geen bestanden', text: 'Foto’s en documenten die je toevoegt of die bij producten, kosten en inkooporders horen, verschijnen hier.', action: 'add' };
      case 'view':
        if (location.targetId !== null) {
          return { icon: view?.iconName ?? 'link', title: `Nog geen bestanden bij ${this.c.recordLabel()}`, text: 'Voeg ze toe met + Toevoegen of koppel een bestaand bestand.', action: view?.canUpload ? 'add' : null };
        }
        return { icon: view?.iconName ?? 'link', title: view?.emptyTitle ?? '', text: view?.emptyText ?? '', action: view?.area ? 'area' : null };
      default:
        if (this.c.currentFolderId() !== null) return { icon: 'folder', title: 'Deze map is leeg', text: 'Sleep bestanden hierheen of kies + Toevoegen.', action: 'add' };
        return this.c.store.failed()
          ? { icon: 'alert', title: 'Mappen niet geladen', text: 'De lijst met mappen kwam niet door.', action: 'folders' }
          : { icon: 'folder', title: 'Nog geen mappen', text: 'Bestanden komen vanzelf in de juiste map zodra je ze koppelt.', action: null };
    }
  });

  /** The folder row or crumb a drag hovers; 'top' is the Mappen crumb. */
  readonly dropTarget = signal<number | 'top' | null>(null);
  private osDepth = 0;
  private keyMoved = false;
  private observer: IntersectionObserver | null = null;

  readonly fileKey = fileKey;
  readonly folderKey = folderKey;

  constructor() {
    effect(() => this.c.pageWidth.set(this.pageWidth()));
    /* The grid's columns for ↑/↓, from the width the tiles really get (without a classic scrollbar's gutter). */
    effect(() => {
      this.paneWidth();
      const width = this.pane()?.nativeElement.clientWidth ?? 0;
      this.c.gridColumns.set(Math.max(1, Math.floor((width - 32 + 12) / (152 + 12))));
    });
    /* Paging: the sentinel after the last row asks for the next page. */
    effect(() => {
      const sentinel = this.sentinel()?.nativeElement;
      untracked(() => {
        this.observer?.disconnect();
        if (!sentinel || typeof IntersectionObserver === 'undefined') return;
        this.observer ??= new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) void this.c.loadMore();
        }, { root: this.pane()?.nativeElement ?? null, rootMargin: '240px' });
        this.observer.observe(sentinel);
      });
    });
    /* The keyboard focus follows the selection's focus after an arrow press. */
    effect(() => {
      const focus = this.c.selection().focus;
      if (!this.keyMoved || focus === null) return;
      this.keyMoved = false;
      afterNextRender(() => this.focusRow(focus), { injector: this.injector });
    });
    /* A closing drawer gives the focus back to the row it was about. */
    let drawer = false;
    effect(() => {
      const open = this.showDrawer();
      if (drawer && !open) {
        const focus = untracked(() => this.c.selection().focus);
        if (focus) setTimeout(() => this.focusRow(focus));
      }
      drawer = open;
    });
    inject(DestroyRef).onDestroy(() => this.observer?.disconnect());
  }

  /* ---- words */
  size(bytes: number): string { return sizeLabel(bytes); }
  badge(asset: MediaAssetSummary): string { return badgeText(asset); }
  tone(asset: MediaAssetSummary): string { return extensionToneClass(asset); }
  icon(asset: MediaAssetSummary): string { return targetIconName(asset.links[0].targetType); }
  firstLink(asset: MediaAssetSummary): string { return linkLabel(asset.links[0]); }
  tail(asset: MediaAssetSummary): string { return pathTail(this.c.store.folders(), asset.folderId, 2); }
  meta(folderId: number): string { return folderMeta(this.c.store.counts().get(folderId)); }
  type(targetType: Parameters<typeof targetLabel>[0]): string { return targetLabel(targetType); }
  openLabel(targetType: Parameters<typeof recordOpenLabel>[0]): string { return recordOpenLabel(targetType); }
  plural(key: string): string { return VIEW_PLURALS[key] ?? 'bestanden'; }
  /** A group's "Openen ›" only where it leads out of this view (a reeks has no page of its own). */
  opens(route: RecordRoute | null): RecordRoute | null { return leavesFiles(route) ? route : null; }
  value(event: Event): string { return (event.target as HTMLInputElement).value; }
  blur(event: Event): void { (event.target as HTMLElement).blur(); }

  /** Roving focus: the keyboard's row takes Tab, or the first row when there is none. */
  tabFor(key: RowKey): number {
    const focus = this.c.selection().focus;
    return (focus ?? this.c.orderedKeys()[0]) === key ? 0 : -1;
  }

  below(event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: rect.left, y: rect.bottom + 4 };
  }

  setKind(id: string): void {
    this.c.setKind(id === 'IMAGE' || id === 'DOCUMENT' ? id : null);
  }

  toggleAll(): void {
    if (this.allChecked()) this.c.clearAll();
    else this.c.runCommand({ type: 'select-all' });
  }

  /* ---- menus (rows and tiles open theirs through appMenuTrigger: right-click or long press) */

  /** "Weergave ▾" on a narrow bar: Lijst or Raster, and the sort, in one menu. */
  viewMenu(anchor: MenuPoint): void {
    const sort = this.c.sort();
    const layout = this.c.layout();
    const items: ContextMenuItem[] = [
      { id: 'layout-list', label: 'Lijst', iconName: 'list', checked: layout === 'list' },
      { id: 'layout-grid', label: 'Raster', iconName: 'grid', checked: layout === 'grid' },
      ...SORT_KEYS.map((option, index) => ({
        id: `sort-${option.key}`, label: option.label, divider: index === 0, checked: sort.key === option.key,
        hint: sort.key === option.key ? (sort.dir === 'asc' ? 'oplopend' : 'aflopend') : undefined,
      })),
    ];
    this.c.menu.set({
      title: 'Weergave', items, anchor,
      run: (id) => {
        if (id === 'layout-list' || id === 'layout-grid') this.c.setLayout(id === 'layout-grid' ? 'grid' : 'list');
        else {
          const option = SORT_KEYS.find((choice) => `sort-${choice.key}` === id);
          if (option) this.c.sortBy(option.key);
        }
      },
    });
  }

  /** A right-click beside the rows: the place's own menu. */
  areaMenu(event: MouseEvent): void {
    if (this.onItem(event)) return;
    event.preventDefault();
    this.c.openAreaMenu({ x: event.clientX, y: event.clientY });
  }

  /** A click beside the rows clears the selection. */
  paneClick(event: MouseEvent): void {
    if (!this.onItem(event)) this.c.clearAll();
  }

  private onItem(event: Event): boolean {
    return event.target instanceof Element
      && !!event.target.closest('.files-row, .files-tile, .wk-thead, .wk-group, .files-grid__head, .wk-banner, button, a, input, .wk-empty');
  }

  /* ---- dragging inside the workspace */
  over(event: DragEvent, folderId: number | null): void {
    if (!this.c.store.dragPayload() || !this.c.canDropOn(folderId)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dropTarget.set(folderId ?? 'top');
    this.c.hintDrop(folderId);
  }

  leave(): void {
    this.dropTarget.set(null);
    this.c.dragHint.set(null);
  }

  dropOnFolder(event: DragEvent, folderId: number | null): void {
    if (!this.c.store.dragPayload()) return;
    event.preventDefault();
    event.stopPropagation();
    this.dropTarget.set(null);
    void this.c.dropOn(folderId);
  }

  /** A drag is no long press: the row's menu timer stops (not every browser cancels the pointer itself). */
  dragStart(event: DragEvent, key: RowKey): void {
    (event.currentTarget as HTMLElement).dispatchEvent(new PointerEvent('pointercancel'));
    this.c.startDrag(event, key);
  }

  endDrag(): void {
    this.dropTarget.set(null);
    this.c.endDrag();
  }

  /* ---- files from the computer */
  private isOsDrag(event: DragEvent): boolean {
    return !this.c.store.dragPayload() && !!event.dataTransfer?.types.includes('Files');
  }

  osEnter(event: DragEvent): void {
    if (!this.isOsDrag(event)) return;
    event.preventDefault();
    this.osDepth++;
    this.c.dropActive.set(true);
  }

  osOver(event: DragEvent): void {
    if (!this.isOsDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = this.c.uploadDest().kind === 'none' ? 'none' : 'copy';
    /* Only the group row under the pointer links the upload; over a file row or empty space nothing does. */
    const onGroup = event.target instanceof Element && !!event.target.closest('.files-group, .files-grid__head');
    if (!onGroup && this.c.dropGroup()) this.c.dropGroup.set(null);
  }


  osLeave(event: DragEvent): void {
    if (!this.isOsDrag(event)) return;
    this.osDepth = Math.max(0, this.osDepth - 1);
    if (!this.osDepth) {
      this.c.dropActive.set(false);
      this.c.dropGroup.set(null);
    }
  }

  osDrop(event: DragEvent): void {
    if (!this.isOsDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    this.osDepth = 0;
    this.c.dropFiles(Array.from(event.dataTransfer?.files ?? []), this.c.dropGroup());
  }

  /** Files from the computer over a record group link to that record. */
  groupOver(event: DragEvent, section: FilesSection): void {
    if (!this.isOsDrag(event) || section.kind !== 'record' || section.targetId === null) return;
    event.preventDefault();
    if (this.c.dropGroup()?.targetId !== section.targetId) this.c.dropGroup.set({ targetId: section.targetId, label: section.label });
  }

  groupLeave(event: DragEvent, section: FilesSection): void {
    const into = event.relatedTarget instanceof Node && (event.currentTarget as Element).contains(event.relatedTarget);
    if (!into && this.c.dropGroup()?.targetId === section.targetId) this.c.dropGroup.set(null);
  }

  /* ---- keyboard */
  onKey(event: KeyboardEvent): void {
    const context = keyContext(event, this.host.nativeElement);
    if (!context.inScope) return;
    const command = filesCommand({
      key: event.key, mod: context.mod, shift: event.shiftKey, alt: event.altKey,
      targetIsField: context.typing, overlayOpen: context.overlayOpen, place: this.c.place(), layout: this.c.layout(),
    });
    if (!command) return;
    const target = event.target instanceof Element ? event.target : null;
    const onBody = !target || target === document.body;
    const inList = onBody || !!target?.closest('.files-row, .files-tile, .files-pane');
    const onControl = !!target?.closest('button, a, input, select, [role=tab], [role=radio]') && !target?.matches('.files-row, .files-tile');
    switch (command.type) {
      case 'search':
        event.preventDefault();
        document.getElementById('files-search')?.focus();
        return;
      case 'inspector':
        event.preventDefault();
        this.c.toggleInspector();
        return;
      case 'shortcuts':
        event.preventDefault();
        this.c.shortcutsOpen.set(true);
        return;
      case 'move':
      case 'quick-look':
      case 'open':
        if (!inList || onControl) return;
        break;
    }
    if (command.type === 'move') this.keyMoved = true;
    if (this.c.runCommand(command)) event.preventDefault();
    else this.keyMoved = false;
  }

  private focusRow(key: string): void {
    const row = this.pane()?.nativeElement.querySelector<HTMLElement>(`[data-key="${key}"]`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'nearest' });
  }
}

function isCoarsePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}
