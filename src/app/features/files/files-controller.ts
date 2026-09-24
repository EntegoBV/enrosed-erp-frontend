import { DestroyRef, Injectable, Injector, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Location } from '@angular/common';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, Scroll } from '@angular/router';
import { filter } from 'rxjs';
import { ActivityApi } from '../../core/api/activity-api';
import { CatalogApi } from '../../core/api/catalog-api';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import { FinanceApi } from '../../core/api/finance-api';
import { MediaApi } from '../../core/api/media-api';
import {
  MediaAssetDetail, MediaAssetFilters, MediaAssetLink, MediaAssetSummary, MediaFolder, MediaKind, MediaTargetType, MediaVariant,
} from '../../core/api/media-models';
import { ActivityEvent, DocumentKind } from '../../core/api/models';
import { PlannerApi } from '../../core/api/planner-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import type { ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { WK_DOCK_MIN_PX } from '../../shared/workspace-layout';
import { Ui, escapeHtml } from '../../shared/ui';
import {
  FILES_HOME, FilesLocation, FilesSort, LinkView, RecordRoute, datesGroupable, filesQueryParams, groupByDate, leavesFiles, linkLabel,
  linkView, locationChange, parseFilesLocation, parseSort, targetLabel, targetRoute, toggleSort,
} from './files-collections';
import type { SortKey } from './files-collections';
import {
  FolderNode, UploadDestination, archiveWarning, areaActions, bulkSummary, canLink, canReplace, canShare, costTargetMeta,
  crumbsFor, deleteBlock, fileActions, folderActions, hasWeb, joinLabels, pathLabel, recordGroups, sensitiveNote, sizeLabel,
  sortAssets, totalSize, uploadDestination,
} from './files-rules';
import {
  EMPTY_SELECTION, RowKey, SelectionState, clearSelection, clickSelect, fileKey, folderKey, moveSelect, parseRowKey,
  pruneSelection, rangeSelect, selectAll, toggleSelect,
} from './files-selection';
import type { FilesCommand } from './files-keys';
import { FilesStore } from './files-store';
import { isCurrentMediaDetailAction } from './media-action-identity';
import type { MediaDetailActionIdentity } from './media-action-identity';

/** A page of the list; each request asks one more to learn whether more exist. */
const PAGE = 100;
/** The server's zip endpoint takes at most this many files. */
const ZIP_MAX = 500;
/** "Alles laden" and phone "Alles" stop here. */
const ALL_MAX = 1000;
const SORT_STORE = 'enrosed.files.sort';
const LAYOUT_STORE = 'enrosed.files.view';
const INSPECTOR_STORE = 'enrosed.files.inspector';
const SEARCHES_STORE = 'enrosed.files.searches';
/** The legacy indexer runs every minute; after this the pending row gives up and points at the dossier. */
const PENDING_LINK_MS = 90_000;
const PENDING_REFRESH_MS = 65_000;
/** A prepared file for the phone's two-step share stays usable this long. */
const SHARE_CACHE_MS = 60_000;

/** One list section: everything, a date, a record in a link view, or the files without a folder on the Mappen home. */
export interface FilesSection {
  key: string;
  kind: 'plain' | 'date' | 'record' | 'loose';
  label: string;
  targetId: number | null;
  route: RecordRoute | null;
  collapsed: boolean;
  assets: MediaAssetSummary[];
}

export interface UploadItem {
  id: number;
  file: File;
  status: 'queued' | 'busy' | 'done' | 'error';
  /** The server already had these bytes and returned the existing file. */
  reused: boolean;
  error: string | null;
  extension: string;
  preview: string | null;
  asset: MediaAssetDetail | null;
  /** A reused archived file is linked only after Terughalen. */
  linkWaiting: boolean;
  linkError: string | null;
}

/** The record an upload is linked to afterwards. */
export interface TrayLink {
  targetType: MediaTargetType;
  targetId: number;
  label: string;
  /** Purchase orders: the dossier's document kind. */
  documentKind: DocumentKind | null;
}

export interface UploadTray {
  items: UploadItem[];
  /** null: no folder, the server parks the file in Overig. */
  folderId: number | null;
  link: TrayLink | null;
  /** A link view without a record: "Ook koppelen aan" asks for one. */
  linkHint: boolean;
  running: boolean;
  done: boolean;
}

export interface PendingLink {
  orderId: number;
  label: string;
  until: number;
  /** Past the wait: the row now points at the dossier. */
  stale: boolean;
}

export interface MenuState {
  title: string;
  items: ContextMenuItem[];
  anchor: MenuPoint | null;
  run: (id: string) => void;
}

export type FolderTarget = number | null | 'auto';

export interface FolderPickerState {
  mode: 'move' | 'upload' | 'parent';
  title: string;
  confirmLabel: string;
  /** The folder the items are in now, marked "hier". */
  current: FolderTarget | undefined;
  /** When a folder is being placed: it cannot land in itself or below. */
  movingFolderId: number | null;
  onPick: (target: FolderTarget) => void;
  onCancel?: () => void;
}

export interface LinkPick {
  targetType: MediaTargetType;
  targetId: number;
  label: string;
  documentKind: DocumentKind | null;
}

export interface LinkPickerState {
  count: number;
  type: MediaTargetType;
  onPick: (pick: LinkPick) => void;
  onCancel?: () => void;
}

export interface TargetOption { id: number; label: string; meta: string; }

export interface FolderDraft { id: number | null; parentId: number | null; name: string; }

export interface QuickLookState { ids: number[]; index: number; original: boolean; }

/**
 * The brain of Documenten & media, shared by the desk and the phone views,
 * the inspector and the dialogs (provided by FilesPage, one per visit).
 *
 * The address bar is the source of truth for the place: every navigation,
 * from inside the page or from the workspace navigation, arrives as query
 * parameters and is diffed against the current location, so the page's own
 * echo is a no-op, a filter keeps the open file and only a new place
 * clears the selection. Every file mutation goes through one path that
 * patches the list row and updates the inspector only while it still shows
 * the same file after the same load (media-action-identity).
 */
@Injectable()
export class FilesController {
  readonly media = inject(MediaApi);
  readonly store = inject(FilesStore);
  private readonly ui = inject(Ui);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly documentTitle = inject(Title);
  private readonly catalog = inject(CatalogApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly planner = inject(PlannerApi);
  private readonly finance = inject(FinanceApi);
  private readonly activity = inject(ActivityApi);
  private readonly injector = inject(Injector);
  readonly desktop = inject(DesktopViewport);

  /* ================================================================ where we are */
  readonly loc = signal<FilesLocation>(FILES_HOME);
  readonly place = computed(() => this.loc().place);
  readonly view = computed<LinkView | null>(() => linkView(this.loc().view));
  readonly currentFolderId = computed(() => {
    const location = this.loc();
    return location.place === 'folders' && location.folderId !== 'root' ? location.folderId : null;
  });
  readonly currentFolder = computed(() => {
    const id = this.currentFolderId();
    return id === null ? null : this.store.folders().find((folder) => folder.id === id) ?? null;
  });
  readonly crumbs = computed(() => crumbsFor(this.store.folders(), this.currentFolderId()));
  readonly searching = computed(() => !!this.loc().query);
  /** Search in folder places and Recent looks through every folder. */
  readonly globalSearch = computed(() => this.searching() && (this.place() === 'folders' || this.place() === 'recent'));
  /** Folder rows show in Mappen and in folders, not in search results. */
  readonly showsFolders = computed(() => this.place() === 'folders' && !this.searching());
  readonly childFolders = computed<FolderNode[]>(() => {
    if (!this.showsFolders()) return [];
    const parent = this.currentFolderId();
    return this.store.tree().filter((node) => node.parentId === parent);
  });
  /** Overig and everything under it: the server's parking place for files without a folder. */
  readonly inOverig = computed(() => this.crumbs()[0]?.name === 'Overig');
  readonly placeTitle = computed(() => {
    const location = this.loc();
    if (location.place === 'archive') return 'Archief';
    if (location.place === 'recent') return 'Recent';
    if (location.place === 'view') return this.view()?.label ?? 'Gekoppeld aan';
    return this.currentFolder()?.name ?? 'Mappen';
  });
  readonly heading = computed(() => this.globalSearch() ? 'Zoekresultaten' : this.placeTitle());
  readonly searchPlaceholder = computed(() => {
    const place = this.place();
    if (place === 'archive') return 'Zoek in Archief';
    if (place === 'view') return `Zoek in ${this.view()?.label ?? 'deze weergave'}`;
    return 'Zoek in alle mappen';
  });
  /** The record of a view narrowed with doel, as its files name it. */
  readonly recordLabel = computed(() => {
    const location = this.loc();
    const type = this.view()?.targetType;
    if (location.place !== 'view' || !type || location.targetId === null) return null;
    for (const asset of this.assets()) {
      const link = asset.links.find((item) => item.targetType === type && item.targetId === location.targetId && item.targetLabel);
      if (link?.targetLabel) return link.targetLabel;
    }
    return this.targetOptions()[type]?.find((option) => option.id === location.targetId)?.label
      ?? `${targetLabel(type)} #${location.targetId}`;
  });
  /** Where the narrowed record opens; null when that would be this very view (a reeks). */
  readonly recordRoute = computed(() => {
    const location = this.loc();
    const type = this.view()?.targetType;
    const route = type && location.targetId !== null ? targetRoute({ targetType: type, targetId: location.targetId }) : null;
    return leavesFiles(route) ? route : null;
  });
  readonly uploadDest = computed<UploadDestination>(() =>
    uploadDestination(this.loc(), this.store.folders(), this.view(), this.recordLabel()));

  /* ================================================================ the list */
  readonly assets = signal<MediaAssetSummary[]>([]);
  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly loadingAll = signal(false);
  readonly hasMore = signal(false);
  readonly loadError = signal('');
  /** The last "more" page failed: the sentinel becomes a button. */
  readonly moreFailed = signal(false);
  private requestId = 0;

  readonly sort = signal<FilesSort>(parseSort(readStore(SORT_STORE)));
  readonly layout = signal<'list' | 'grid'>(readStore(LAYOUT_STORE) === 'grid' ? 'grid' : 'list');
  readonly sorted = computed(() => sortAssets(this.assets(), this.sort(), this.store.folders()));
  /** Record groups folded shut in this visit. */
  readonly collapsed = signal<ReadonlySet<number>>(new Set());
  readonly sections = computed<FilesSection[]>(() => {
    const list = this.sorted();
    const location = this.loc();
    const type = this.view()?.targetType;
    const collapsed = this.collapsed();
    if (location.place === 'view' && type && location.targetId === null) {
      return recordGroups(list, type).map((group) => ({
        key: `rec:${group.targetId}`, kind: 'record' as const, label: group.label, targetId: group.targetId,
        route: targetRoute({ targetType: type, targetId: group.targetId }), collapsed: collapsed.has(group.targetId), assets: group.assets,
      }));
    }
    if (location.place === 'recent' && datesGroupable(this.sort())) {
      return groupByDate(list, new Date()).map((group) => ({
        key: `date:${group.label}`, kind: 'date' as const, label: group.label, targetId: null, route: null, collapsed: false, assets: group.assets,
      }));
    }
    /* The Mappen home lists the folders, then the files that have none. */
    if (location.place === 'folders' && location.folderId === 'root' && !location.query && list.length) {
      return [{ key: 'loose', kind: 'loose', label: 'Zonder map', targetId: null, route: null, collapsed: false, assets: list }];
    }
    return [{ key: 'all', kind: 'plain', label: '', targetId: null, route: null, collapsed: false, assets: list }];
  });
  /** Every row as shown, folders first; a file under two records counts once. */
  readonly orderedKeys = computed<RowKey[]>(() => [...new Set([
    ...this.childFolders().map((folder) => folderKey(folder.id)),
    ...this.sections().flatMap((section) => section.collapsed ? [] : section.assets.map((asset) => fileKey(asset.id))),
  ])]);
  readonly visibleFileIds = computed(() => this.orderedKeys()
    .map((key) => parseRowKey(key)).filter((row) => row?.type === 'file').map((row) => row!.id));

  /* ================================================================ selection and the open file */
  readonly selection = signal<SelectionState>(EMPTY_SELECTION);
  readonly selectedFiles = computed(() => {
    const ids = new Set([...this.selection().selected].map((key) => parseRowKey(key))
      .filter((row) => row?.type === 'file').map((row) => row!.id));
    const found = this.assets().filter((asset) => ids.has(asset.id));
    const detail = this.detail();
    if (detail && ids.has(detail.id) && !found.some((asset) => asset.id === detail.id)) found.push(detail);
    return found;
  });
  readonly selectedFolderNodes = computed(() => {
    const ids = new Set([...this.selection().selected].map((key) => parseRowKey(key))
      .filter((row) => row?.type === 'folder').map((row) => row!.id));
    return this.store.tree().filter((node) => ids.has(node.id));
  });
  readonly selectionCount = computed(() => this.selection().selected.size);
  readonly multi = computed(() => this.selectionCount() > 1);
  readonly selectionSize = computed(() => totalSize(this.selectedFiles()));
  /** The one folder picked with a single click, for the folder card. */
  readonly selectedFolder = computed(() => this.selectionCount() === 1 ? this.selectedFolderNodes()[0] ?? null : null);

  /** The file the inspector or the phone file screen shows (bestand=). */
  readonly openFileId = signal<number | null>(null);
  readonly detail = signal<MediaAssetDetail | null>(null);
  /** The open file could not be loaded and there was no summary to show instead. */
  readonly detailError = signal<string | null>(null);
  readonly nameDraft = signal('');
  readonly busy = signal(false);
  readonly downloading = signal(false);
  readonly zipping = signal(false);
  private activeIdentity: MediaDetailActionIdentity | null = null;
  private detailRequestId = 0;
  private actionSeq = 0;

  readonly history = signal<ActivityEvent[] | null>(null);
  readonly historyLoading = signal(false);
  readonly historyFailed = signal(false);
  private historyFor: number | null = null;
  readonly pendingLinks = signal<ReadonlyMap<number, PendingLink>>(new Map());

  /* ================================================================ the desk inspector */
  /** The page host's width, measured by the desk view; the inspector docks from WK_DOCK_MIN_PX. */
  readonly pageWidth = signal(0);
  readonly docked = computed(() => this.pageWidth() >= WK_DOCK_MIN_PX);
  readonly inspectorOn = signal(readStore(INSPECTOR_STORE) !== '0');
  readonly drawerOpen = signal(false);
  private drawerFocus = false;
  /** Grid columns as laid out, for the arrow keys. */
  readonly gridColumns = signal(4);

  /* ================================================================ dialogs, menus, progress */
  readonly menu = signal<MenuState | null>(null);
  readonly folderPicker = signal<FolderPickerState | null>(null);
  readonly linkPicker = signal<LinkPickerState | null>(null);
  readonly folderDraft = signal<FolderDraft | null>(null);
  readonly shortcutsOpen = signal(false);
  readonly quickLook = signal<QuickLookState | null>(null);
  readonly progress = signal<{ label: string; done: number; total: number } | null>(null);
  /** The status bar's line while something is dragged over a target. */
  readonly dragHint = signal<string | null>(null);
  /** OS files hover the list; the group row under them links the upload. */
  readonly dropActive = signal(false);
  readonly dropGroup = signal<{ targetId: number; label: string } | null>(null);

  /* ================================================================ uploads */
  readonly tray = signal<UploadTray | null>(null);
  readonly trayOpen = signal(false);
  readonly uploading = computed(() => !!this.tray()?.running);
  readonly trayStats = computed(() => {
    const items = this.tray()?.items ?? [];
    return {
      total: items.length,
      done: items.filter((item) => item.status === 'done').length,
      failed: items.filter((item) => item.status === 'error').length,
      /* Uploaded, but the link to the record did not take. */
      linkFailed: items.filter((item) => !!item.linkError).length,
      reused: items.filter((item) => item.reused).length,
      size: totalSize(items.map((item) => ({ sizeBytes: item.file.size }))),
    };
  });
  /**
   * A finished tray that still needs a look: failures, failed links, files
   * the library already had. Such a tray never closes by itself; the phone's
   * pill and the desk's status bar reopen it.
   */
  readonly trayIssue = computed(() => {
    if (!this.tray()?.done) return null;
    const stats = this.trayStats();
    const parts = [
      stats.failed ? `${stats.failed} mislukt` : '',
      stats.linkFailed ? `${stats.linkFailed} niet gekoppeld` : '',
      stats.reused ? `${stats.reused} bestond al` : '',
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  });
  /** "{n} toegevoegd · Toon", for a moment after the tray finished while closed (phone). */
  readonly uploadedNote = signal<{ count: number; folderId: number | null } | null>(null);
  private trayId = 0;
  private versionFor: number | null = null;

  /* ================================================================ phone */
  readonly picking = signal(false);
  /** The search field's text; it reaches the address bar 240ms after the last key. */
  readonly queryDraft = signal('');
  readonly recentSearches = signal<string[]>(readSearches());
  readonly recentStrip = signal<MediaAssetSummary[] | null>(null);
  readonly recentStripFailed = signal(false);
  private stripLoading = false;
  /** The row "Toon in map" points at on a phone, flashed once it is in the list. */
  readonly flashFileId = signal<number | null>(null);
  readonly shareSheetFor = signal<number | null>(null);
  readonly sharePrepared = signal<{ assetId: number; file: File } | null>(null);
  readonly sharePreparing = signal(false);
  private readonly shareCache = new Map<number, { file: File; at: number }>();
  private readonly scrollMemory = new Map<string, number>();
  private restoreScrollFor: string | null = null;

  /* ================================================================ link targets */
  readonly targetOptions = signal<Partial<Record<MediaTargetType, TargetOption[]>>>({});
  readonly targetsLoading = signal<MediaTargetType | null>(null);
  /** The picker's list of this type could not be loaded (it offers "Opnieuw proberen"). */
  readonly targetsFailed = signal<MediaTargetType | null>(null);

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private initialised = false;

  constructor() {
    void this.store.loadFolders();
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) =>
      this.applyLocation(parseFilesLocation((key) => params.get(key))));

    /* A change made through the store (a drop on the tree, a folder edit) makes the list stale. */
    let seenRevision = this.store.revision();
    effect(() => {
      const revision = this.store.revision();
      if (revision === seenRevision) return;
      seenRevision = revision;
      untracked(() => {
        void this.reload({ quiet: true });
        const open = this.openFileId();
        if (open !== null) void this.refreshDetail(open);
      });
    });
    effect(() => {
      const request = this.store.folderRequest();
      if (!request) return;
      untracked(() => {
        this.store.folderRequest.set(null);
        this.handleFolderRequest(request.kind, request.folderId);
      });
    });
    effect(() => this.documentTitle.setTitle(`Documenten & media · ${this.heading()} — Enrosed`));
    effect(() => {
      const keys = this.orderedKeys();
      untracked(() => this.selection.update((state) => pruneSelection(state, keys)));
    });
    /* The phone returns from a file to the list at the same height (the router scrolls to the top first). */
    this.router.events.pipe(filter((event) => event instanceof Scroll), takeUntilDestroyed()).subscribe(() => {
      const key = this.restoreScrollFor;
      if (key === null || key !== this.listKey()) return;
      this.restoreScrollFor = null;
      const y = this.scrollMemory.get(key) ?? 0;
      window.scrollTo(0, y);
      requestAnimationFrame(() => window.scrollTo(0, y));
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.searchTimer) clearTimeout(this.searchTimer);
      for (const timer of this.timers) clearTimeout(timer);
      this.revokeTray();
    });
  }

  /* ================================================================ navigation */

  /**
   * Applies a location from the address bar. The page's own navigations
   * apply first and then write the address, so their echo changes nothing.
   */
  private applyLocation(next: FilesLocation): void {
    if (next.redirected) {
      this.navigate({ ...next, redirected: false }, { replace: true });
      return;
    }
    const previous = this.loc();
    const change = this.initialised ? locationChange(previous, next) : 'place';
    this.initialised = true;
    if (change === 'none') return;
    this.loc.set(next);
    /* The echo of a typed search leaves the field alone, so a trailing space survives the pause. */
    if (change === 'place' || (this.queryDraft().trim() || null) !== next.query) this.queryDraft.set(next.query ?? '');
    if (change === 'place') {
      this.selection.set(EMPTY_SELECTION);
      this.picking.set(false);
      this.collapsed.set(new Set());
      this.menu.set(null);
      this.quickLook.set(null);
      this.flashFileId.set(null);
      if (next.fileId === null) this.drawerOpen.set(false);
      void this.reload();
      if (!this.desktop.active() && next.place === 'folders' && next.folderId === 'root' && !next.query) void this.loadRecentStrip();
    } else if (change === 'filter') {
      void this.reload({ quiet: true, keepSelection: true });
    }
    if (change === 'place' || previous.fileId !== next.fileId) this.applyFile(next.fileId, previous.fileId);
  }

  /** Moves to a location: places push a history entry, modifiers replace the current one. */
  navigate(next: FilesLocation, options: { replace?: boolean } = {}): void {
    const depth = this.historyDepth();
    const target = { ...next, redirected: false };
    this.applyLocation(target);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: filesQueryParams(target),
      replaceUrl: !!options.replace,
      state: { filesDepth: options.replace ? depth : depth + 1 },
      scroll: options.replace ? 'manual' : undefined,
    });
  }

  /** How many history entries inside the workspace lie behind this one. */
  private historyDepth(): number {
    const state = this.location.getState() as { filesDepth?: unknown } | null;
    return typeof state?.filesDepth === 'number' ? state.filesDepth : 0;
  }

  openFolder(id: number | 'root'): void {
    this.navigate({ ...FILES_HOME, folderId: id, kind: this.loc().kind });
  }

  openHome(): void { this.navigate(FILES_HOME); }

  openRecent(): void { this.navigate({ ...FILES_HOME, place: 'recent' }); }

  openArchive(): void { this.navigate({ ...FILES_HOME, place: 'archive' }); }

  openView(key: LinkView['key'], targetId: number | null = null): void {
    this.navigate({ ...FILES_HOME, place: 'view', view: key, targetId });
  }

  /** "Alle … tonen": the view without its record. */
  dropRecord(): void {
    this.navigate({ ...this.loc(), targetId: null, fileId: null });
  }

  setKind(kind: MediaKind | null): void {
    this.navigate({ ...this.loc(), kind }, { replace: true });
  }

  /** Typing: the field follows at once, the list after a short pause. */
  typeQuery(text: string): void {
    this.queryDraft.set(text);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.commitQuery(text), 240);
  }

  commitQuery(text: string): void {
    if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = null; }
    const query = text.trim() || null;
    if (query === this.loc().query) return;
    this.navigate({ ...this.loc(), query, fileId: this.desktop.active() ? this.loc().fileId : null }, { replace: true });
  }

  clearQuery(): void {
    this.queryDraft.set('');
    this.commitQuery('');
  }

  /** ⌘↑ and the phone's back when there is no history: one folder up. */
  goParent(): void {
    const folder = this.currentFolder();
    if (!folder) return;
    this.openFolder(folder.parentId ?? 'root');
  }

  /** The phone's back button: history when we came from inside the workspace, else one level up. */
  goBack(): void {
    if (this.historyDepth() > 0) {
      this.location.back();
      return;
    }
    const location = this.loc();
    if (location.fileId !== null) this.navigate({ ...location, fileId: null }, { replace: true });
    else if (location.place === 'folders' && location.folderId !== 'root') {
      this.navigate({ ...FILES_HOME, folderId: this.currentFolder()?.parentId ?? 'root' }, { replace: true });
    } else if (location.place === 'view' && location.targetId !== null) {
      this.navigate({ ...location, targetId: null }, { replace: true });
    } else {
      this.navigate(FILES_HOME, { replace: true });
    }
  }

  /** Where "back" leads, for the button's accessible name. */
  readonly parentTitle = computed(() => {
    const location = this.loc();
    if (location.fileId !== null) return this.heading();
    if (location.place === 'folders' && location.folderId !== 'root') {
      const parent = this.currentFolder()?.parentId ?? null;
      return parent === null ? 'Mappen' : this.store.folder(parent)?.name ?? 'Mappen';
    }
    if (location.place === 'view' && location.targetId !== null) return this.view()?.label ?? 'Gekoppeld aan';
    return 'Documenten & media';
  });

  /**
   * "Toon in map": the file's own folder. A desk selects the file there (the
   * inspector shows it); a phone shows the folder list itself, with the row
   * flashed, because its file screen would cover the list again.
   */
  reveal(asset: Pick<MediaAssetSummary, 'id' | 'folderId'>): void {
    const folderId = asset.folderId ?? 'root';
    if (this.desktop.active()) {
      this.navigate({ ...FILES_HOME, folderId, fileId: asset.id });
      return;
    }
    this.navigate({ ...FILES_HOME, folderId });
    this.flashFileId.set(asset.id);
  }

  /* ================================================================ the list */

  private listFilters(offset: number, limit: number): MediaAssetFilters {
    const location = this.loc();
    const view = this.view();
    const inView = location.place === 'view' && !!view;
    return {
      q: location.query ?? undefined,
      kind: location.kind ?? undefined,
      archived: location.place === 'archive' ? true : undefined,
      includeArchived: false,
      folder: location.place === 'folders' && !location.query ? location.folderId : undefined,
      targetType: inView ? view!.targetType ?? undefined : undefined,
      targetId: inView && location.targetId !== null ? location.targetId : undefined,
      linked: inView && view!.linked === false ? false : undefined,
      offset,
      limit,
    };
  }

  /** The first page again. Quiet keeps the rows on screen until the new ones arrive. */
  async reload(options: { quiet?: boolean; keepSelection?: boolean } = {}): Promise<void> {
    const requestId = ++this.requestId;
    if (!options.keepSelection && !options.quiet) this.selection.set(EMPTY_SELECTION);
    if (!options.quiet) this.loading.set(true);
    this.loadingMore.set(false);
    this.loadError.set('');
    this.moreFailed.set(false);
    try {
      const result = await this.media.assets(this.listFilters(0, PAGE + 1));
      if (requestId !== this.requestId) return;
      this.assets.set(result.slice(0, PAGE));
      this.hasMore.set(result.length > PAGE);
      /* A file opened from the address bar before its row arrived is marked once it is there. */
      const open = this.openFileId();
      if (open !== null && this.desktop.active() && !this.selection().selected.size && result.some((asset) => asset.id === open)) {
        this.selection.set(clickSelect(EMPTY_SELECTION, fileKey(open)));
      }
    } catch (failure) {
      if (requestId !== this.requestId) return;
      this.assets.set([]);
      this.hasMore.set(false);
      this.loadError.set(messageOf(failure, 'De bestanden konden niet worden geladen.'));
    } finally {
      if (requestId === this.requestId) this.loading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    if (this.loading() || this.loadingMore() || this.loadingAll() || !this.hasMore()) return;
    const requestId = this.requestId;
    this.loadingMore.set(true);
    this.moreFailed.set(false);
    try {
      const result = await this.media.assets(this.listFilters(this.assets().length, PAGE + 1));
      if (requestId !== this.requestId) return;
      const known = new Set(this.assets().map((asset) => asset.id));
      this.assets.update((items) => [...items, ...result.slice(0, PAGE).filter((asset) => !known.has(asset.id))]);
      this.hasMore.set(result.length > PAGE);
    } catch (failure) {
      if (requestId !== this.requestId) return;
      this.moreFailed.set(true);
      this.ui.toast(messageOf(failure, 'Meer bestanden konden niet worden geladen.'), 'err');
    } finally {
      if (requestId === this.requestId) this.loadingMore.set(false);
    }
  }

  /** "Alles laden": up to 1000 files, so a sort or select-all covers them all. */
  async loadAll(announce = false): Promise<boolean> {
    if (!this.hasMore()) return true;
    const requestId = this.requestId;
    this.loadingAll.set(true);
    try {
      const { items, complete } = await this.media.allAssets(this.listFilters(0, 0), ALL_MAX);
      if (requestId !== this.requestId) return false;
      this.assets.set(items);
      this.hasMore.set(!complete);
      if (announce) this.ui.toast(complete ? `Alle ${items.length} bestanden geladen` : `De eerste ${items.length} bestanden geladen`);
      return true;
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'De bestanden konden niet worden geladen.'), 'err');
      return false;
    } finally {
      this.loadingAll.set(false);
    }
  }

  setSort(sort: FilesSort): void {
    this.sort.set(sort);
    writeStore(SORT_STORE, JSON.stringify(sort));
  }

  sortBy(key: SortKey): void {
    this.setSort(toggleSort(this.sort(), key));
  }

  setLayout(layout: 'list' | 'grid'): void {
    this.layout.set(layout);
    writeStore(LAYOUT_STORE, layout);
  }

  toggleGroup(targetId: number): void {
    this.collapsed.update((ids) => {
      const next = new Set(ids);
      if (next.has(targetId)) next.delete(targetId); else next.add(targetId);
      return next;
    });
  }

  /** The phone hub's shelf of the ten newest files; a failure says so instead of looking empty. */
  async loadRecentStrip(): Promise<void> {
    if (this.stripLoading) return;
    this.stripLoading = true;
    /* A retry after a failure shows the placeholders again, not "Nog geen bestanden". */
    if (this.recentStripFailed()) this.recentStrip.set(null);
    this.recentStripFailed.set(false);
    try {
      this.recentStrip.set(await this.media.assets({ limit: 10 }));
    } catch {
      this.recentStrip.set([]);
      this.recentStripFailed.set(true);
    } finally {
      this.stripLoading = false;
    }
  }

  private patchRow(detail: MediaAssetSummary): void {
    this.assets.update((items) => items.map((item) => item.id === detail.id ? detail : item));
    this.recentStrip.update((items) => items?.map((item) => item.id === detail.id ? detail : item) ?? items);
  }

  private dropRows(ids: ReadonlySet<number>): void {
    this.assets.update((items) => items.filter((item) => !ids.has(item.id)));
    this.recentStrip.update((items) => items?.filter((item) => !ids.has(item.id)) ?? items);
  }

  /** A summary of a loaded file (or the open one). */
  assetById(id: number): MediaAssetSummary | null {
    const detail = this.detail();
    return this.assets().find((asset) => asset.id === id) ?? (detail?.id === id ? detail : null)
      ?? this.recentStrip()?.find((asset) => asset.id === id) ?? null;
  }

  /* ================================================================ selection (desk) and the inspector */

  /** A click on a row: alone, toggled with ⌘/Ctrl, a range with Shift. */
  rowClick(key: RowKey, event: MouseEvent): void {
    /* The click that trails a long press (MenuTrigger marks it) must not select, or open a folder, under the menu. */
    if (event.defaultPrevented) return;
    const state = this.selection();
    const mod = event.metaKey || event.ctrlKey;
    if (mod) this.select(toggleSelect(state, key), true);
    else if (event.shiftKey) this.select(rangeSelect(state, this.orderedKeys(), key), true);
    else this.select(clickSelect(state, key), true);
    const row = parseRowKey(key);
    /* A finger has no double click: one tap opens a folder. */
    if (!mod && !event.shiftKey && row?.type === 'folder' && isCoarsePointer()) this.openFolder(row.id);
  }

  /** The checkbox of a row: the same as a ⌘-click. */
  toggleRow(key: RowKey): void {
    this.select(toggleSelect(this.selection(), key), false);
  }

  rowOpen(key: RowKey): void {
    const row = parseRowKey(key);
    if (!row) return;
    if (row.type === 'folder') this.openFolder(row.id);
    else this.openQuickLook(row.id);
  }

  clearAll(): void {
    this.select(clearSelection(this.selection()), false);
  }

  /**
   * Takes a new selection and lets the inspector follow: one file shows in
   * it (and in bestand=), anything else closes the file. `reveal` opens the
   * drawer when the inspector is not docked.
   */
  select(state: SelectionState, reveal: boolean): void {
    this.selection.set(state);
    const keys = [...state.selected];
    const only = keys.length === 1 ? parseRowKey(keys[0]) : null;
    if (only?.type === 'file') {
      if (this.openFileId() !== only.id) {
        void this.openDetail(only.id, this.assetById(only.id));
        this.writeFile(only.id);
      }
      if (reveal && !this.docked()) this.drawerOpen.set(true);
      return;
    }
    if (this.openFileId() !== null) {
      this.closeDetail();
      this.writeFile(null);
    }
    /* The drawer follows the selection; "nothing chosen" is a docked-only card. */
    if (!keys.length && !this.docked()) this.drawerOpen.set(false);
  }

  /** bestand= mirrors the desk's single file, without a history entry. */
  private writeFile(fileId: number | null): void {
    if (this.loc().fileId === fileId) return;
    const next = { ...this.loc(), fileId };
    this.loc.set(next);
    void this.router.navigate([], {
      relativeTo: this.route, queryParams: filesQueryParams(next), replaceUrl: true,
      state: { filesDepth: this.historyDepth() }, scroll: 'manual',
    });
  }

  /** Opens a file (from the address bar or a click); a phone shows the file screen. */
  private applyFile(fileId: number | null, previous: number | null): void {
    if (fileId === null) {
      if (this.openFileId() !== null) this.closeDetail();
      const only = [...this.selection().selected];
      if (this.desktop.active() && only.length === 1 && parseRowKey(only[0])?.type === 'file') {
        this.selection.set(EMPTY_SELECTION);
        if (!this.docked()) this.drawerOpen.set(false);
      }
      if (!this.desktop.active() && previous !== null) this.restoreScrollFor = this.listKey();
      return;
    }
    if (this.desktop.active()) {
      this.selection.set(clickSelect(this.selection(), fileKey(fileId)));
      if (!this.docked()) this.drawerOpen.set(true);
    }
    if (this.openFileId() !== fileId) void this.openDetail(fileId, this.assetById(fileId));
  }

  /** The key of a list screen, for the phone's scroll memory. */
  private listKey(location = this.loc()): string {
    return JSON.stringify(filesQueryParams({ ...location, fileId: null }));
  }

  private isCurrent(stamp: MediaDetailActionIdentity): boolean {
    return this.openFileId() === stamp.assetId && isCurrentMediaDetailAction(stamp, this.activeIdentity);
  }

  /** Shows the summary at once and the full detail when it arrives, unless another file was opened meanwhile. */
  async openDetail(id: number, summary: MediaAssetSummary | null): Promise<void> {
    const stamp: MediaDetailActionIdentity = { assetId: id, detailRequestId: ++this.detailRequestId, actionId: this.actionSeq };
    this.activeIdentity = stamp;
    this.openFileId.set(id);
    this.detailError.set(null);
    if (this.historyFor !== id) { this.history.set(null); this.historyFailed.set(false); this.historyFor = null; }
    this.detail.set(summary ? { ...summary, versions: [] } : null);
    this.nameDraft.set(summary?.name ?? '');
    try {
      const detail = await this.media.asset(id);
      if (!this.isCurrent(stamp)) return;
      this.applyDetail(detail);
    } catch (failure) {
      if (!this.isCurrent(stamp)) return;
      if ((failure as { status?: number })?.status === 404) {
        this.ui.toast('Bestand niet gevonden (misschien verwijderd)', 'err');
        this.closeDetail();
        if (this.desktop.active()) this.navigate({ ...this.loc(), fileId: null }, { replace: true });
        else this.closeFileScreen();
        return;
      }
      const reason = messageOf(failure, 'De bestandsdetails konden niet worden geladen.');
      /* Without a summary to show, the inspector says so instead of loading forever. */
      if (!this.detail()) this.detailError.set(reason);
      else this.ui.toast(reason, 'err');
    }
  }

  /** "Opnieuw proberen" after the open file failed to load. */
  retryDetail(): void {
    const id = this.openFileId();
    if (id !== null) void this.openDetail(id, this.assetById(id));
  }

  closeDetail(): void {
    this.activeIdentity = null;
    this.openFileId.set(null);
    this.detail.set(null);
    this.detailError.set(null);
    this.history.set(null);
    this.historyFailed.set(false);
    this.historyFor = null;
  }

  private applyDetail(detail: MediaAssetDetail): void {
    const previous = this.detail();
    this.detail.set(detail);
    /* A name being typed survives a refresh of the same file (an upload finishing, the pending-link check). */
    if (!previous || previous.id !== detail.id || this.nameDraft() === previous.name) this.nameDraft.set(detail.name);
    this.patchRow(detail);
    const pending = this.pendingLinks().get(detail.id);
    if (pending && detail.links.some((link) => link.targetType === 'PURCHASE_ORDER' && link.targetId === pending.orderId)) {
      this.pendingLinks.update((map) => { const next = new Map(map); next.delete(detail.id); return next; });
    }
  }

  /** The open file again, under a new action stamp so an older answer cannot overwrite it. */
  private async refreshDetail(id: number): Promise<void> {
    if (this.openFileId() !== id || !this.activeIdentity) return;
    const stamp = { ...this.activeIdentity, actionId: ++this.actionSeq };
    this.activeIdentity = stamp;
    try {
      const detail = await this.media.asset(id);
      if (this.isCurrent(stamp)) this.applyDetail(detail);
      else this.patchRow(detail);
    } catch {
      /* The next open loads it again. */
    }
  }

  /**
   * One change to one file. The list row is always patched; the inspector
   * only while it still shows this file and no newer change started.
   */
  private async mutate(asset: Pick<MediaAssetSummary, 'id'>, failureLabel: string,
    action: (id: number) => Promise<MediaAssetDetail>): Promise<MediaAssetDetail | null> {
    let stamp: MediaDetailActionIdentity | null = null;
    if (this.openFileId() === asset.id && this.activeIdentity) {
      stamp = { ...this.activeIdentity, actionId: ++this.actionSeq };
      this.activeIdentity = stamp;
    }
    this.busy.set(true);
    try {
      const detail = await action(asset.id);
      this.patchRow(detail);
      if (stamp && this.isCurrent(stamp)) this.applyDetail(detail);
      return detail;
    } catch (failure) {
      this.ui.toast(messageOf(failure, failureLabel), 'err');
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  /** The inspector's ⓘ: the docked column on or off, or the drawer for the selection. */
  toggleInspector(): void {
    if (this.docked()) {
      const on = !this.inspectorOn();
      this.inspectorOn.set(on);
      writeStore(INSPECTOR_STORE, on ? '1' : '0');
    } else {
      const open = !this.drawerOpen();
      if (open) this.drawerFocus = true;
      this.drawerOpen.set(open);
    }
  }

  /**
   * Whether a drawer that just opened takes the focus to its heading: only
   * when asked for (ⓘ, ⌘I, "Info"), not after a click on a row, so the
   * arrow keys keep working in the list.
   */
  takeDrawerFocus(): boolean {
    const wanted = this.drawerFocus;
    this.drawerFocus = false;
    return wanted;
  }

  /** "Info" from a menu or Quick Look: this file in the inspector. */
  showInfo(asset: Pick<MediaAssetSummary, 'id'>): void {
    if (!this.docked() && !this.drawerOpen()) this.drawerFocus = true;
    this.select(clickSelect(this.selection(), fileKey(asset.id)), true);
    if (this.docked() && !this.inspectorOn()) this.toggleInspector();
  }

  /* ================================================================ keyboard (desk) */

  /** Esc: a multi-selection first, then the drawer, then the search, then the last selection. */
  escape(): void {
    if (this.multi()) { this.clearAll(); return; }
    if (!this.docked() && this.drawerOpen()) { this.drawerOpen.set(false); return; }
    if (this.loc().query) { this.clearQuery(); return; }
    if (this.selectionCount()) this.clearAll();
  }

  /** Runs a keyboard command; the desk view handles focus-only commands (search, inspector, shortcuts). */
  runCommand(command: FilesCommand): boolean {
    const files = this.selectedFiles();
    const single = this.selectionCount() === 1 ? parseRowKey([...this.selection().selected][0]) : null;
    switch (command.type) {
      case 'move': {
        const columns = this.layout() === 'grid' ? this.gridColumns() : 1;
        const delta = command.direction === 'up' ? -columns : command.direction === 'down' ? columns
          : command.direction === 'left' ? -1 : 1;
        this.select(moveSelect(this.selection(), this.orderedKeys(), delta, command.extend, columns), false);
        return true;
      }
      case 'quick-look': {
        const id = single?.type === 'file' ? single.id : files[0]?.id;
        if (id !== undefined) this.openQuickLook(id);
        return id !== undefined;
      }
      case 'open':
        if (!single) return false;
        this.rowOpen([...this.selection().selected][0]);
        return true;
      case 'parent': this.goParent(); return true;
      case 'rename':
        if (single?.type !== 'file') return false;
        this.startRename(single.id);
        return true;
      case 'select-all': this.select(selectAll(this.selection(), this.orderedKeys()), false); return true;
      case 'archive': if (!files.length) return false; void this.archive(files); return true;
      case 'delete': if (!files.length) return false; void this.deletePermanent(files); return true;
      case 'escape': this.escape(); return true;
      default: return false;
    }
  }

  /** F2 and "Hernoemen": the name field of the inspector, opened if needed. */
  startRename(id: number): void {
    if (this.desktop.active()) {
      if (this.openFileId() !== id) this.select(clickSelect(this.selection(), fileKey(id)), true);
      if (!this.docked()) this.drawerOpen.set(true);
      else if (!this.inspectorOn()) this.toggleInspector();
      this.focusName(50);
      return;
    }
    /* A phone opens its keyboard only inside the tap: park the focus on a proxy first. */
    document.getElementById('files-focus-proxy')?.focus({ preventScroll: true });
    if (this.loc().fileId !== id) this.openFileScreen(id);
    this.focusName(320);
  }

  private focusName(delay: number): void {
    this.later(() => {
      const input = document.getElementById('files-name') as HTMLInputElement | null;
      input?.focus();
      input?.select();
    }, delay);
  }

  /* ================================================================ menus */

  /**
   * The menu of a file. A right-click on a row outside the selection selects
   * that row first; on a row inside a multi-selection it acts on all of it.
   */
  openFileMenu(asset: MediaAssetSummary, anchor: MenuPoint | null): void {
    const key = fileKey(asset.id);
    let targets: MediaAssetSummary[] = [asset];
    if (this.desktop.active()) {
      if (!this.selection().selected.has(key)) this.select(clickSelect(this.selection(), key), false);
      else if (this.multi()) targets = this.selectedFiles();
    }
    const phone = !this.desktop.active();
    this.menu.set({
      title: targets.length > 1 ? `${targets.length} bestanden` : asset.name,
      items: fileActions(targets, this.place(), {
        drawer: !this.docked(), phone,
        inOwnFolder: this.place() === 'folders' && !this.searching() && (asset.folderId ?? 'root') === this.loc().folderId,
      }),
      anchor,
      run: (id) => this.runFileAction(id, targets),
    });
  }

  openFolderMenu(folder: MediaFolder, anchor: MenuPoint | null): void {
    if (this.desktop.active() && !this.selection().selected.has(folderKey(folder.id))) {
      this.select(clickSelect(this.selection(), folderKey(folder.id)), false);
    }
    this.menu.set({ title: folder.name, items: folderActions(), anchor, run: (id) => this.runFolderAction(id, folder) });
  }

  openAreaMenu(anchor: MenuPoint): void {
    this.clearAll();
    this.menu.set({
      title: this.heading(),
      items: areaActions({
        folderPlace: this.place() === 'folders', canAdd: this.uploadDest().kind !== 'none',
        layout: this.layout(), hasFiles: this.assets().length > 0,
      }),
      anchor,
      run: (id) => this.runAreaAction(id),
    });
  }

  /** The selection bar's "Downloaden ▾". */
  openDownloadMenu(anchor: MenuPoint | null): void {
    const files = this.selectedFiles();
    this.menu.set({
      title: `${files.length} bestanden`,
      items: [
        { id: 'download-zip', label: 'Origineel', hint: sizeLabel(totalSize(files)), iconName: 'download' },
        ...(files.some(hasWeb) ? [{ id: 'download-zip-web', label: 'Webformaat', hint: 'lichter, voor mail en web', iconName: 'image' }] : []),
      ],
      anchor,
      run: (id) => this.runFileAction(id, files),
    });
  }

  /** The grid's "Sorteren ▾" and the phone's "Sorteren op…". */
  openSortMenu(anchor: MenuPoint | null, choices: readonly { id: string; label: string; key: SortKey; dir?: 'asc' | 'desc' }[]): void {
    const sort = this.sort();
    this.menu.set({
      title: 'Sorteren op',
      items: choices.map((choice) => ({
        id: choice.id, label: choice.label,
        checked: choice.key === sort.key && (!choice.dir || choice.dir === sort.dir),
        hint: !choice.dir && choice.key === sort.key ? (sort.dir === 'asc' ? 'oplopend' : 'aflopend') : undefined,
      })),
      anchor,
      run: (id) => {
        const choice = choices.find((item) => item.id === id);
        if (!choice) return;
        if (choice.dir) this.setSort({ key: choice.key, dir: choice.dir });
        else this.sortBy(choice.key);
      },
    });
  }

  closeMenu(): void { this.menu.set(null); }

  pickMenu(item: ContextMenuItem): void {
    const menu = this.menu();
    this.menu.set(null);
    menu?.run(item.id);
  }

  runFileAction(id: string, assets: MediaAssetSummary[]): void {
    const asset = assets[0];
    if (!asset) return;
    switch (id) {
      case 'quick-look': this.openQuickLook(asset.id); break;
      case 'info': this.showInfo(asset); break;
      case 'download': void this.download(asset); break;
      case 'download-web': void this.download(asset, 'web'); break;
      case 'download-zip': void this.downloadZip(assets, 'original'); break;
      case 'download-zip-web': void this.downloadZip(assets, 'web'); break;
      case 'share': void this.share(asset); break;
      case 'copy-link': if (asset.share) void this.copyLink(asset.share.token); break;
      case 'unshare': void this.unshare(asset); break;
      case 'rename': this.startRename(asset.id); break;
      case 'move': this.pickMoveTarget(assets); break;
      case 'link': this.pickLinkTarget(assets); break;
      case 'version': this.chooseVersion(asset); break;
      case 'reveal': this.reveal(asset); break;
      case 'select':
        this.picking.set(true);
        this.selection.set(clickSelect(EMPTY_SELECTION, fileKey(asset.id)));
        break;
      case 'archive': void this.archive(assets); break;
      case 'restore': void this.restore(assets); break;
      case 'delete': void this.deletePermanent(assets); break;
    }
  }

  runFolderAction(id: string, folder: MediaFolder): void {
    switch (id) {
      case 'folder-open': this.openFolder(folder.id); break;
      case 'folder-new': this.newFolder(folder.id); break;
      case 'folder-rename': this.editFolder(folder); break;
      case 'folder-move': this.pickFolderParent(folder); break;
      case 'folder-download': void this.downloadFolder(folder); break;
      case 'folder-delete': void this.deleteFolder(folder); break;
    }
  }

  private runAreaAction(id: string): void {
    switch (id) {
      case 'new-folder': this.newFolder(this.currentFolderId()); break;
      case 'add': this.pickFiles(); break;
      case 'layout-list': this.setLayout('list'); break;
      case 'layout-grid': this.setLayout('grid'); break;
      case 'download-all': void this.downloadAll(); break;
    }
  }

  /** A folder action asked for by the navigation tree. */
  private handleFolderRequest(kind: 'new' | 'edit' | 'move' | 'delete' | 'download', folderId: number | null): void {
    if (kind === 'new') { this.newFolder(folderId); return; }
    const folder = this.store.folder(folderId);
    if (!folder) return;
    if (kind === 'edit') this.editFolder(folder);
    else if (kind === 'move') this.pickFolderParent(folder);
    else if (kind === 'delete') void this.deleteFolder(folder);
    else void this.downloadFolder(folder);
  }

  /* ================================================================ asking */

  /**
   * Ui.confirm as a promise. Annuleren calls no callback, so a closed dialog
   * is noticed by watching the request go away.
   */
  private ask(options: { title: string; message: string; confirmLabel: string; danger?: boolean }): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      this.ui.confirm(options, () => { settled = true; resolve(true); });
      const request = this.ui.confirmRequest();
      const watch = effect(() => {
        if (this.ui.confirmRequest() === request) return;
        watch.destroy();
        if (!settled) resolve(false);
      }, { injector: this.injector });
    });
  }

  /* ================================================================ file actions */

  async saveName(): Promise<void> {
    const detail = this.detail();
    const name = this.nameDraft().trim();
    if (!detail || !name || name === detail.name) return;
    const saved = await this.mutate(detail, 'Hernoemen mislukt', (id) => this.media.updateName(id, name));
    if (!saved) return;
    if (this.openFileId() === saved.id) this.nameDraft.set(saved.name);
    this.ui.toast('Naam bewaard');
  }

  revertName(): void {
    this.nameDraft.set(this.detail()?.name ?? '');
  }

  async download(asset: MediaAssetSummary, variant: MediaVariant = 'original'): Promise<void> {
    if (this.downloading()) return;
    this.downloading.set(true);
    try {
      const name = asset.originalFilename || asset.name;
      const webName = name.replace(/\.[a-z0-9]+$/i, '') + '-web.jpg';
      saveBlob(await this.media.download(asset.id, variant), variant === 'web' ? webName : name);
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Downloaden mislukt'), 'err');
    } finally {
      this.downloading.set(false);
    }
  }

  /** Several files as one zip, named after where they come from. */
  async downloadZip(assets: readonly MediaAssetSummary[], variant: MediaVariant, where = this.heading()): Promise<void> {
    if (!assets.length || this.zipping()) return;
    if (assets.length === 1) { await this.download(assets[0], variant); return; }
    if (assets.length > ZIP_MAX) { this.ui.toast('Downloaden als zip kan tot 500 bestanden tegelijk.', 'err'); return; }
    this.zipping.set(true);
    try {
      const name = `enrosed-${where}-${new Date().toISOString().slice(0, 10)}${variant === 'web' ? '-web' : ''}.zip`
        .toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
      saveBlob(await this.media.downloadZip(assets.map((asset) => asset.id), variant), name);
      this.ui.toast(`${assets.length} bestanden als zip gedownload`);
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'De download is mislukt.'), 'err');
    } finally {
      this.zipping.set(false);
    }
  }

  /** "Alles downloaden": every file of the place, not only the loaded ones. */
  async downloadAll(): Promise<void> {
    await this.downloadEverything(this.listFilters(0, 0), this.heading());
  }

  /** "Map downloaden": the files directly in the folder. */
  async downloadFolder(folder: MediaFolder): Promise<void> {
    await this.downloadEverything({ folder: folder.id, includeArchived: false }, folder.name);
  }

  private async downloadEverything(filters: MediaAssetFilters, where: string): Promise<void> {
    if (this.zipping()) return;
    this.zipping.set(true);
    let items: MediaAssetSummary[];
    try {
      items = (await this.media.allAssets(filters, ZIP_MAX + 1)).items;
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'De bestanden konden niet worden geladen.'), 'err');
      return;
    } finally {
      this.zipping.set(false);
    }
    if (!items.length) { this.ui.toast('Hier staan geen bestanden om te downloaden.', 'err'); return; }
    if (items.length > ZIP_MAX) { this.ui.toast('Downloaden als zip kan tot 500 bestanden tegelijk.', 'err'); return; }
    if (items.length > 100) {
      const ok = await this.ask({
        title: 'Alles downloaden',
        message: `${items.length} bestanden (${sizeLabel(totalSize(items))}) als zip downloaden?`,
        confirmLabel: 'Downloaden',
      });
      if (!ok) return;
    }
    await this.downloadZip(items, 'original', where);
  }

  /** A public link always asks first, with a word of caution for cost and purchase documents. */
  async share(asset: MediaAssetSummary): Promise<void> {
    if (!canShare(asset)) return;
    const note = sensitiveNote(asset);
    const noteHtml = note ? `<br><br><b>${escapeHtml(note)}</b>` : '';
    const ok = await this.ask({
      title: 'Publieke link maken',
      message: `Iedereen met de link kan “${escapeHtml(asset.name)}” openen, zonder in te loggen. De link toont altijd de nieuwste versie tot je hem intrekt.${noteHtml}`,
      confirmLabel: 'Link maken en kopiëren',
    });
    if (!ok) return;
    const detail = await this.mutate(asset, 'De publieke link kon niet worden gemaakt', (id) => this.media.share(id));
    if (detail?.share) await this.copyLink(detail.share.token, 'Publieke link gemaakt en gekopieerd');
  }

  async unshare(asset: MediaAssetSummary): Promise<void> {
    const ok = await this.ask({
      title: 'Link intrekken',
      message: 'Wie de link heeft, kan het bestand daarna niet meer openen.',
      confirmLabel: 'Link intrekken',
      danger: true,
    });
    if (!ok) return;
    if (await this.mutate(asset, 'Intrekken mislukt', (id) => this.media.unshare(id))) this.ui.toast('Publieke link ingetrokken');
  }

  async copyLink(token: string, message = 'Link gekopieerd', variant: MediaVariant = 'original'): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.media.publicUrl(token, variant));
      this.ui.toast(message);
    } catch {
      this.ui.toast('Kopiëren lukte niet; probeer het nog eens.', 'err');
    }
  }

  /** The phone's "Deel link via…": the system share sheet with the public address. */
  async shareLinkVia(asset: MediaAssetSummary): Promise<void> {
    if (!asset.share) return;
    const url = this.media.publicUrl(asset.share.token);
    try {
      if (typeof navigator.share === 'function') await navigator.share({ url, title: asset.name });
      else await this.copyLink(asset.share.token);
    } catch {
      /* Closing the share sheet is not an error. */
    }
  }

  /**
   * The phone's "Bestand delen…", step one: fetch the bytes (the web size for
   * photos) so step two can hand them to the share sheet inside its tap.
   */
  async prepareShare(asset: MediaAssetSummary): Promise<void> {
    const cached = this.shareCache.get(asset.id);
    if (cached && Date.now() - cached.at < SHARE_CACHE_MS) {
      this.sharePrepared.set({ assetId: asset.id, file: cached.file });
      return;
    }
    this.sharePreparing.set(true);
    try {
      const web = asset.kind === 'IMAGE' && hasWeb(asset);
      const blob = await this.media.download(asset.id, web ? 'web' : 'original');
      const base = asset.originalFilename || asset.name;
      const name = web ? base.replace(/\.[a-z0-9]+$/i, '') + '.jpg' : base;
      const file = new File([blob], name, { type: blob.type || asset.contentType || 'application/octet-stream' });
      this.shareCache.set(asset.id, { file, at: Date.now() });
      this.sharePrepared.set({ assetId: asset.id, file });
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Het bestand kon niet worden opgehaald.'), 'err');
    } finally {
      this.sharePreparing.set(false);
    }
  }

  /** Step two ("Nu delen"): must run inside the tap, so it does no waiting before share(). */
  shareNow(asset: MediaAssetSummary): void {
    const prepared = this.sharePrepared();
    if (!prepared || prepared.assetId !== asset.id) return;
    const data = { files: [prepared.file], title: asset.name };
    if (typeof navigator.canShare === 'function' && navigator.canShare(data) && typeof navigator.share === 'function') {
      navigator.share(data).catch(() => { /* cancelled */ });
    } else {
      saveBlob(prepared.file, prepared.file.name);
      this.ui.toast('Delen kan hier niet; het bestand is gedownload.');
    }
    this.sharePrepared.set(null);
    this.shareSheetFor.set(null);
  }

  openShareSheet(asset: MediaAssetSummary): void {
    this.sharePrepared.set(null);
    this.shareSheetFor.set(asset.id);
  }

  /** "Nieuwe versie…": a linked file first says honestly where the new version shows. */
  chooseVersion(asset: MediaAssetSummary): void {
    if (!canReplace(asset)) return;
    this.versionFor = asset.id;
    const pick = () => document.getElementById('files-replace-version')?.click();
    if (!asset.links.length) { pick(); return; }
    /* The picker opens inside the confirm's own click, which browsers require. */
    this.ui.confirm({
      title: 'Nieuwe versie',
      message: 'De nieuwe versie vervangt het bestand in Documenten &amp; media, bij kosten en in de bestandenlijst van producten. Inkoopdossiers, de producteditor, de website en de planner bewaren hun eigen kopie.',
      confirmLabel: 'Kies nieuwe versie',
    }, pick);
  }

  async replaceVersion(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const id = this.versionFor;
    this.versionFor = null;
    if (!file || id === null) return;
    if (await this.mutate({ id }, 'De nieuwe versie kon niet worden bewaard', (assetId) => this.media.replaceVersion(assetId, file))) {
      this.ui.toast('Nieuwe versie bewaard');
    }
  }

  /** Archiving asks only when a file is linked, and says what changes where. */
  async archive(assets: readonly MediaAssetSummary[]): Promise<void> {
    const list = assets.filter((asset) => !asset.archived);
    if (!list.length || this.stillRunning()) return;
    const warning = archiveWarning(list);
    if (warning) {
      const linesHtml = warning.map((line) => escapeHtml(line)).join('<br>');
      const labels = joinLabels(list.flatMap((asset) => asset.links.map((link) => linkLabel(link))));
      const message = list.length === 1
        ? `“${escapeHtml(list[0].name)}” hangt aan ${escapeHtml(labels)}.<br><br>${linesHtml}<br><br>Terughalen kan altijd via Archief.`
        : `${list.length} bestanden archiveren?<br><br>${linesHtml}<br><br>Terughalen kan altijd via Archief.`;
      const ok = await this.ask({ title: 'Archiveren', message, confirmLabel: 'Archiveren' });
      if (!ok) return;
    }
    if (list.length === 1) {
      const asset = list[0];
      const detail = await this.mutate(asset, 'Archiveren mislukt', (id) => this.media.archive(id));
      if (!detail) return;
      this.leaveList([asset.id]);
      this.endPicking();
      this.ui.toast('Gearchiveerd · terug te vinden in Archief', 'ok', {
        label: 'Ongedaan maken',
        run: () => void this.restore([detail]),
      });
      void this.store.refresh();
      return;
    }
    await this.bulk(list, 'Archiveren', 'gearchiveerd', (id) => this.media.archive(id));
  }

  async restore(assets: readonly MediaAssetSummary[]): Promise<void> {
    const list = assets.filter((asset) => asset.archived);
    if (!list.length || this.stillRunning()) return;
    if (list.length === 1) {
      const detail = await this.mutate(list[0], 'Terughalen mislukt', (id) => this.media.restore(id));
      if (!detail) return;
      if (this.place() === 'archive') this.leaveList([detail.id]);
      this.endPicking();
      void this.store.refresh();
      this.ui.toast(`Teruggehaald in ${this.store.pathOf(detail.folderId)}`);
      return;
    }
    await this.bulk(list, 'Terughalen', 'teruggehaald', (id) => this.media.restore(id));
  }

  /** Files leave a list they no longer belong in; the inspector (or the phone's file screen) lets go of them. */
  private leaveList(ids: number[]): void {
    const leaving = new Set(ids);
    this.dropRows(leaving);
    const open = this.openFileId();
    if (open === null || !leaving.has(open)) return;
    this.closeDetail();
    if (!this.desktop.active()) { this.closeFileScreen(); return; }
    this.writeFile(null);
    if (!this.docked()) this.drawerOpen.set(false);
  }

  /**
   * The phone leaves a file screen it no longer shows: back to the list it
   * was pushed from (a replace would leave that list twice in the history,
   * and the next Back would do nothing), or up when it came from a link.
   */
  private closeFileScreen(): void {
    if (this.historyDepth() > 0) this.location.back();
    else this.navigate({ ...this.loc(), fileId: null }, { replace: true });
  }

  /** Selection mode ends once its action is done. */
  private endPicking(): void {
    if (this.picking()) this.togglePicking(false);
  }

  /** One run at a time: a second archive, link or delete waits for the first. */
  private stillRunning(): boolean {
    const progress = this.progress();
    if (progress) this.ui.toast(`Even wachten: ${progress.label.toLowerCase()} loopt nog.`, 'err');
    return !!progress;
  }

  /** Only archived files nothing links to; the rest is skipped and reported. */
  async deletePermanent(assets: readonly MediaAssetSummary[]): Promise<void> {
    if (this.stillRunning()) return;
    const place = this.place();
    const blocks = assets.map((asset) => deleteBlock(asset, place));
    const deletable = assets.filter((_, index) => blocks[index] === null);
    const skipped = assets.length - deletable.length;
    if (!deletable.length) {
      this.ui.toast(blocks.includes('linked') ? 'Kan pas als het bestand nergens meer gekoppeld is.' : 'Archiveer het bestand eerst.', 'err');
      return;
    }
    const skippedHtml = skipped ? `<br><br>${skipped} gekoppelde bestanden blijven staan.` : '';
    const message = deletable.length === 1 && !skipped
      ? `“${escapeHtml(deletable[0].name)}” en alle eerdere versies definitief verwijderen? Dit kan niet ongedaan worden.`
      : `${deletable.length} bestanden en al hun eerdere versies definitief verwijderen? Dit kan niet ongedaan worden.${skippedHtml}`;
    const ok = await this.ask({ title: 'Definitief verwijderen', message, confirmLabel: 'Definitief verwijderen', danger: true });
    if (!ok) return;
    let deleted = 0;
    let reason: string | null = null;
    this.progress.set({ label: 'Verwijderen', done: 0, total: deletable.length });
    for (const asset of deletable) {
      try {
        await this.media.deleteAsset(asset.id);
        deleted++;
        this.leaveList([asset.id]);
      } catch (failure) {
        reason ??= messageOf(failure, 'Verwijderen mislukt');
      }
      this.progress.set({ label: 'Verwijderen', done: deleted, total: deletable.length });
    }
    this.progress.set(null);
    const failed = deletable.length - deleted;
    if (deletable.length === 1 && !skipped) {
      this.ui.toast(deleted ? 'Definitief verwijderd' : reason ?? 'Verwijderen mislukt', deleted ? 'ok' : 'err');
    } else {
      const base = skipped ? `${deleted} verwijderd, ${skipped} overgeslagen (nog gekoppeld)` : `${deleted} definitief verwijderd`;
      this.ui.toast(failed ? `${base}, ${failed} mislukt${reason ? ': ' + reason : ''}` : base, failed ? 'err' : 'ok');
    }
    this.clearAll();
    this.endPicking();
    await this.store.refresh();
  }

  /** A sequential run with the progress in the status bar, one summary and one reload at the end. */
  private async bulk(list: readonly MediaAssetSummary[], label: string, verb: string,
    action: (id: number) => Promise<MediaAssetDetail>): Promise<void> {
    if (this.stillRunning()) return;
    let done = 0;
    let failed = 0;
    let reason: string | null = null;
    this.progress.set({ label, done: 0, total: list.length });
    for (const asset of list) {
      try {
        this.patchRow(await action(asset.id));
        done++;
      } catch (failure) {
        failed++;
        reason ??= messageOf(failure, `${label} mislukt`);
      }
      this.progress.set({ label, done: done + failed, total: list.length });
    }
    this.progress.set(null);
    this.ui.toast(bulkSummary(verb, done, failed, reason), failed ? 'err' : 'ok');
    this.clearAll();
    this.picking.set(false);
    await this.store.refresh();
  }

  /* ================================================================ moving */

  pickMoveTarget(assets: readonly MediaAssetSummary[]): void {
    if (!assets.length) return;
    const folders = new Set(assets.map((asset) => asset.folderId ?? null));
    this.folderPicker.set({
      mode: 'move', title: 'Verplaatsen naar…', confirmLabel: 'Hierheen verplaatsen',
      current: folders.size === 1 ? [...folders][0] : undefined, movingFolderId: null,
      onPick: (target) => void this.moveTo(assets, target === 'auto' ? null : target),
    });
  }

  async moveTo(assets: readonly MediaAssetSummary[], folderId: number | null): Promise<void> {
    /* The store's refresh reloads the list and the open file afterwards. */
    this.afterMove(await this.store.moveAssets(assets, folderId), assets.length);
  }

  /**
   * After a move: a selection of several files (or selection mode) is done.
   * One open file stays open (the phone's file screen, the inspector) with
   * its new folder, unless it left the folder the desk is showing.
   */
  private afterMove(moved: readonly MediaAssetDetail[], count: number): void {
    for (const detail of moved) this.patchRow(detail);
    if (!moved.length) return;
    if (count > 1 || this.picking()) {
      this.clearAll();
      this.picking.set(false);
      return;
    }
    const open = moved.find((detail) => detail.id === this.openFileId());
    if (!open) return;
    if (this.desktop.active() && this.showsFolders() && (open.folderId ?? 'root') !== this.loc().folderId) {
      this.leaveList([open.id]);
      return;
    }
    if (this.activeIdentity) {
      this.activeIdentity = { ...this.activeIdentity, actionId: ++this.actionSeq };
      this.applyDetail(open);
    }
  }

  /** Drop targets: may the dragged files or folder land here? */
  canDropOn(folderId: number | null): boolean {
    return this.store.canDrop(folderId);
  }

  async dropOn(folderId: number | null): Promise<void> {
    this.dragHint.set(null);
    const payload = this.store.dragPayload();
    const count = payload && 'assets' in payload ? payload.assets.length : 0;
    this.afterMove(await this.store.drop(folderId), count);
  }

  /** Starts dragging a row: the whole selection when the row is part of it. */
  startDrag(event: DragEvent, key: RowKey): void {
    const row = parseRowKey(key);
    if (!row || !event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    if (row.type === 'folder') {
      this.store.dragPayload.set({ folderId: row.id });
      event.dataTransfer.setData('text/plain', `map:${row.id}`);
      return;
    }
    const picked = this.selection().selected.has(key) ? this.selectedFiles() : [this.assetById(row.id)].filter((asset) => !!asset);
    const assets = picked.map((asset) => ({ id: asset!.id, name: asset!.name, folderId: asset!.folderId ?? null }));
    const ids = assets.map((asset) => asset.id);
    this.store.dragPayload.set({ assets });
    event.dataTransfer.setData('text/plain', ids.join(','));
    if (ids.length > 1) {
      const ghost = document.createElement('div');
      ghost.className = 'files-drag-ghost';
      ghost.textContent = `${ids.length} bestanden`;
      document.body.appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, 16, 16);
      setTimeout(() => ghost.remove());
    }
  }

  endDrag(): void {
    this.store.dragPayload.set(null);
    this.dragHint.set(null);
  }

  hintDrop(folderId: number | null): void {
    this.dragHint.set(`Laat los: verplaatsen naar ${folderId === null ? 'Mappen' : this.store.pathOf(folderId)}`);
  }

  /* ================================================================ linking */

  pickLinkTarget(assets: readonly MediaAssetSummary[]): void {
    const usable = assets.filter((asset) => canLink(asset));
    if (!usable.length || this.stillRunning()) return;
    this.linkPicker.set({
      count: usable.length,
      type: this.view()?.targetType ?? 'PRODUCT',
      onPick: (pick) => void this.applyLink(usable, pick),
    });
  }

  /**
   * Links files to a record; purchase orders take the dossier's own road
   * (see addToOrder). A file already linked, or on its way into that
   * dossier, is skipped: every repeat would add another dossier document.
   */
  async applyLink(assets: readonly MediaAssetSummary[], pick: LinkPick): Promise<void> {
    if (this.stillRunning()) return;
    const pending = this.pendingLinks();
    const todo = assets.filter((asset) => !asset.links.some((link) => link.targetType === pick.targetType && link.targetId === pick.targetId)
      && !(pick.targetType === 'PURCHASE_ORDER' && pending.get(asset.id)?.orderId === pick.targetId));
    if (!todo.length) { this.ui.toast(`Al gekoppeld aan ${pick.label}`); return; }
    if (pick.targetType === 'PURCHASE_ORDER') {
      let added = 0;
      let failed = 0;
      let reason: string | null = null;
      this.progress.set({ label: 'Koppelen', done: 0, total: todo.length });
      for (const asset of todo) {
        const error = await this.addToOrder(asset, pick);
        if (error === null) added++;
        else { failed++; reason ??= error; }
        this.progress.set({ label: 'Koppelen', done: added + failed, total: todo.length });
      }
      this.progress.set(null);
      if (failed) this.ui.toast(bulkSummary(`toegevoegd aan de documenten van ${pick.label}`, added, failed, reason), 'err');
      else this.ui.toast(`Toegevoegd aan de documenten van ${pick.label}; de koppeling verschijnt hier binnen een minuut.`);
      if (assets.length > 1 || this.picking()) { this.clearAll(); this.picking.set(false); }
      return;
    }
    if (todo.length === 1) {
      const asset = todo[0];
      const before = asset.folderId ?? null;
      const detail = await this.mutate(asset, 'Koppelen mislukt',
        (id) => this.media.addLink(id, { targetType: pick.targetType, targetId: pick.targetId, role: 'INTERNAL' }));
      if (!detail) return;
      const moved = (detail.folderId ?? null) !== before;
      this.ui.toast(moved ? `Gekoppeld aan ${pick.label} en verplaatst naar ${this.store.pathOf(detail.folderId)}` : `Gekoppeld aan ${pick.label}`);
      if (moved || this.place() === 'view') void this.store.refresh();
      return;
    }
    await this.bulk(todo, 'Koppelen', `gekoppeld aan ${pick.label}`,
      (id) => this.media.addLink(id, { targetType: pick.targetType, targetId: pick.targetId, role: 'INTERNAL' }));
  }

  /**
   * A purchase order lists its own document store, not library links. So a
   * file goes the way the dossier's "Uit bibliotheek" goes: its bytes are
   * added as a dossier document, and the one-minute indexer then finds the
   * same bytes and links this library file back (createdBy 'system').
   */
  private async addToOrder(asset: MediaAssetSummary, pick: LinkPick): Promise<string | null> {
    try {
      const blob = await this.media.download(asset.id);
      const bytes = new File([blob], asset.originalFilename || asset.name, { type: blob.type || asset.contentType });
      await this.sourcing.addDocument(pick.targetId, bytes, pick.documentKind ?? 'OTHER', asset.name, null);
      this.trackPending(asset.id, pick.targetId, pick.label);
      return null;
    } catch (failure) {
      return messageOf(failure, 'Toevoegen aan de inkooporder mislukt');
    }
  }

  /** The inspector's pending row until the indexer's link shows up, or the wait runs out. */
  private trackPending(assetId: number, orderId: number, label: string): void {
    this.pendingLinks.update((map) => new Map(map).set(assetId, { orderId, label, until: Date.now() + PENDING_LINK_MS, stale: false }));
    this.later(() => { if (this.pendingLinks().has(assetId)) void this.refreshDetail(assetId); }, PENDING_REFRESH_MS);
    this.later(() => {
      const pending = this.pendingLinks().get(assetId);
      if (pending && !pending.stale) this.pendingLinks.update((map) => new Map(map).set(assetId, { ...pending, stale: true }));
    }, PENDING_LINK_MS);
  }

  /** Hand-made links go with a toast; links from a source are managed there. */
  async unlink(asset: MediaAssetSummary, link: MediaAssetLink): Promise<void> {
    if (link.createdBy === 'system') return;
    const detail = await this.mutate(asset, 'Loskoppelen mislukt', (id) => this.media.removeLink(id, link.id));
    if (!detail) return;
    this.ui.toast(`Losgekoppeld van ${linkLabel(link)}`);
    if (this.place() === 'view') void this.reload({ quiet: true, keepSelection: true });
  }

  /** The picker's lists, loaded once per type and visit. */
  async loadTargets(type: MediaTargetType): Promise<void> {
    if (this.targetOptions()[type] || this.targetsLoading() === type) return;
    this.targetsLoading.set(type);
    if (this.targetsFailed() === type) this.targetsFailed.set(null);
    const byName = (a: TargetOption, b: TargetOption) => a.label.localeCompare(b.label, 'nl');
    try {
      let options: TargetOption[] = [];
      switch (type) {
        case 'PRODUCT':
          options = (await this.catalog.products()).filter((product) => product.id !== null)
            .map((product) => ({ id: product.id!, label: product.describedAs || product.name, meta: product.sku || '' })).sort(byName);
          break;
        case 'PRODUCT_FAMILY':
          options = (await this.catalog.productFamilies()).filter((family) => family.id !== null)
            .map((family) => ({ id: family.id!, label: family.name, meta: family.familyKey || '' })).sort(byName);
          break;
        case 'PURCHASE_ORDER':
          options = (await this.sourcing.purchaseOrders())
            .map(({ order }) => ({ id: order.id, label: order.number, meta: order.alias || '' })).sort((a, b) => b.id - a.id);
          break;
        case 'COMPANY_COST':
          options = (await this.finance.costs()).filter((cost) => cost.id !== null)
            .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.id ?? 0) - (a.id ?? 0)))
            .map((cost) => ({ id: cost.id!, label: cost.description || cost.category, meta: costTargetMeta(cost) }));
          break;
        case 'PLANNER_ITEM':
          options = (await this.planner.list()).filter((item) => item.id !== null)
            .map((item) => ({ id: item.id!, label: item.title, meta: item.onDate || '' })).sort(byName);
          break;
      }
      this.targetOptions.update((all) => ({ ...all, [type]: options }));
    } catch (failure) {
      this.targetsFailed.set(type);
      this.ui.toast(messageOf(failure, 'De keuzelijst kon niet worden geladen.'), 'err');
    } finally {
      if (this.targetsLoading() === type) this.targetsLoading.set(null);
    }
  }

  /* ================================================================ history */

  /** The file's own trail from the activity log; moves are not logged there. */
  async loadHistory(assetId: number): Promise<void> {
    if (this.historyFor === assetId && this.history()) return;
    this.historyFor = assetId;
    this.historyLoading.set(true);
    this.historyFailed.set(false);
    try {
      const page = await this.activity.list({ entityType: 'MEDIA_ASSET', entityId: assetId, limit: 50 });
      if (this.historyFor === assetId) this.history.set(page.items);
    } catch {
      /* Not "nothing logged": the history is simply not known. */
      if (this.historyFor === assetId) { this.history.set(null); this.historyFailed.set(true); }
    } finally {
      if (this.historyFor === assetId) this.historyLoading.set(false);
    }
  }

  /* ================================================================ folders */

  newFolder(parentId: number | null): void {
    this.folderDraft.set({ id: null, parentId, name: '' });
  }

  editFolder(folder: MediaFolder): void {
    this.folderDraft.set({ id: folder.id, parentId: folder.parentId, name: folder.name });
  }

  /** The draft's "In map": the picker takes the draft's place, then hands it back. */
  pickDraftParent(): void {
    const draft = this.folderDraft();
    if (!draft) return;
    this.folderDraft.set(null);
    this.folderPicker.set({
      mode: 'parent', title: 'Map kiezen', confirmLabel: 'Kiezen', current: draft.parentId, movingFolderId: draft.id,
      onPick: (target) => this.folderDraft.set({ ...draft, parentId: target === 'auto' ? null : target }),
      onCancel: () => this.folderDraft.set(draft),
    });
  }

  async saveFolder(): Promise<void> {
    const draft = this.folderDraft();
    if (!draft || !draft.name.trim()) return;
    const saved = draft.id === null
      ? await this.store.createFolder(draft.name, draft.parentId)
      : await this.store.updateFolder(draft.id, draft.name, draft.parentId);
    if (!saved) return;
    this.folderDraft.set(null);
    if (draft.id === null) this.openFolder(saved.id);
  }

  pickFolderParent(folder: MediaFolder): void {
    this.folderPicker.set({
      mode: 'parent', title: 'Verplaatsen naar…', confirmLabel: 'Hierheen verplaatsen', current: folder.parentId, movingFolderId: folder.id,
      onPick: (target) => void this.store.moveFolder(folder.id, target === 'auto' ? null : target),
    });
  }

  async deleteFolder(folder: MediaFolder): Promise<void> {
    const parentName = folder.parentId === null ? 'Mappen' : this.store.folder(folder.parentId)?.name ?? 'Mappen';
    const ok = await this.ask({
      title: 'Map verwijderen',
      message: `Map “${escapeHtml(folder.name)}” verwijderen? De bestanden en submappen erin gaan naar “${escapeHtml(parentName)}”.`,
      confirmLabel: 'Verwijderen',
      danger: true,
    });
    if (!ok) return;
    const wasOpen = this.currentFolderId() === folder.id;
    if (!(await this.store.deleteFolder(folder.id))) return;
    this.ui.toast(`Map “${folder.name}” verwijderd`);
    if (!wasOpen) return;
    /* A phone pops the folder screen it pushed, so Back does not land on its parent twice. */
    if (!this.desktop.active() && this.historyDepth() > 0) this.location.back();
    else this.navigate({ ...FILES_HOME, folderId: folder.parentId ?? 'root' }, { replace: true });
  }

  /* ================================================================ Quick Look */

  openQuickLook(fileId: number): void {
    const visible = this.visibleFileIds();
    const ids = visible.includes(fileId) ? visible : [fileId];
    this.quickLook.set({ ids, index: ids.indexOf(fileId), original: false });
  }

  stepQuickLook(delta: number): void {
    this.quickLook.update((state) => state && ({
      ...state, original: false, index: Math.max(0, Math.min(state.ids.length - 1, state.index + delta)),
    }));
  }

  closeQuickLook(): void { this.quickLook.set(null); }

  readonly quickLookAsset = computed(() => {
    const state = this.quickLook();
    return state ? this.assetById(state.ids[state.index]) : null;
  });

  /** Quick Look's "Info": the desk shows the inspector, the phone the file screen. */
  quickLookInfo(): void {
    const asset = this.quickLookAsset();
    this.closeQuickLook();
    if (!asset) return;
    if (this.desktop.active()) this.showInfo(asset);
    else if (this.loc().fileId !== asset.id) this.openFileScreen(asset.id);
  }

  /* ================================================================ phone */

  /** A file row on the phone: the file screen, one history entry deeper. */
  openFileScreen(id: number): void {
    this.scrollMemory.set(this.listKey(), window.scrollY);
    if (this.loc().query) this.rememberSearch(this.loc().query!);
    this.navigate({ ...this.loc(), fileId: id });
  }

  togglePicking(on = !this.picking()): void {
    this.picking.set(on);
    this.selection.set(EMPTY_SELECTION);
  }

  togglePick(id: number): void {
    this.selection.set(toggleSelect(this.selection(), fileKey(id)));
  }

  /** "Alles": everything of the place, loading the rest first when needed. */
  async pickAll(): Promise<void> {
    if (this.hasMore() && !(await this.loadAll(true))) return;
    this.selection.set(selectAll(this.selection(), this.visibleFileIds().map((id) => fileKey(id))));
  }

  rememberSearch(term: string): void {
    const text = term.trim();
    if (text.length < 2) return;
    const next = [text, ...this.recentSearches().filter((item) => item.toLocaleLowerCase('nl') !== text.toLocaleLowerCase('nl'))].slice(0, 6);
    this.recentSearches.set(next);
    writeStore(SEARCHES_STORE, JSON.stringify(next));
  }

  clearSearches(): void {
    this.recentSearches.set([]);
    writeStore(SEARCHES_STORE, '[]');
  }

  /* ================================================================ uploads */

  /** "+ Toevoegen": the file picker; the tray opens with what was picked. */
  pickFiles(): void {
    const destination = this.uploadDest();
    if (destination.kind === 'none') { this.ui.toast(destination.reason, 'err'); return; }
    document.getElementById('files-upload')?.click();
  }

  chooseFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.queueFiles(files, false);
  }

  /**
   * Adds files to the tray. Drops start at once where the destination is
   * unambiguous; picks and pastes wait for "Uploaden" so the folder and the
   * link can still change.
   */
  queueFiles(files: File[], start: boolean, link: TrayLink | null = null): void {
    if (!files.length) return;
    const destination = this.uploadDest();
    if (destination.kind === 'none') { this.ui.toast(destination.reason, 'err'); return; }
    const items: UploadItem[] = files.map((file) => ({
      id: ++this.trayId, file, status: 'queued', reused: false, error: null,
      extension: (file.name.split('.').pop() || 'file').slice(0, 4).toUpperCase(),
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      asset: null, linkWaiting: false, linkError: null,
    }));
    const recordLink: TrayLink | null = destination.kind === 'record' && destination.targetId !== null
      ? {
        targetType: destination.targetType, targetId: destination.targetId, label: this.recordLabel() ?? '',
        documentKind: destination.targetType === 'PURCHASE_ORDER' ? 'OTHER' : null,
      }
      : null;
    const folderId = destination.kind === 'folder' ? destination.folderId : null;
    const wantedLink = link ?? recordLink;
    const current = this.tray();
    /* A running tray uploads into its own folder and link; files meant for somewhere else wait their turn. */
    if (current?.running && (current.folderId !== folderId || !sameLink(current.link, wantedLink))) {
      for (const item of items) if (item.preview) URL.revokeObjectURL(item.preview);
      this.ui.toast('Wacht tot de vorige upload klaar is; die gaat naar een andere plek.', 'err');
      return;
    }
    this.uploadedNote.set(null);
    if (current?.done) this.revokeTray();
    this.tray.update((tray) => tray && !tray.done
      ? { ...tray, items: [...tray.items, ...items], link: link ?? tray.link }
      : {
        items, folderId, link: wantedLink, linkHint: destination.kind === 'record' && destination.targetId === null && !link,
        running: false, done: false,
      });
    this.trayOpen.set(true);
    if (start) void this.startTray();
  }

  /** OS files dropped on the list (or on a record group). */
  dropFiles(files: File[], group: { targetId: number; label: string } | null): void {
    const destination = this.uploadDest();
    this.dropActive.set(false);
    this.dropGroup.set(null);
    if (destination.kind === 'none') { this.ui.toast(destination.reason, 'err'); return; }
    if (destination.kind === 'record' && destination.targetId === null) {
      if (!group) { this.queueFiles(files, false); return; }
      this.queueFiles(files, true, {
        targetType: destination.targetType, targetId: group.targetId, label: group.label,
        documentKind: destination.targetType === 'PURCHASE_ORDER' ? 'OTHER' : null,
      });
      return;
    }
    this.queueFiles(files, true);
  }

  readonly dropText = computed(() => {
    const destination = this.uploadDest();
    const group = this.dropGroup();
    if (destination.kind === 'none') return destination.reason;
    if (destination.kind === 'folder') return `Loslaten om te uploaden naar ${destination.label}`;
    if (destination.kind === 'record') {
      const record = group?.label ?? (destination.targetId !== null ? this.recordLabel() : null);
      return record ? `Loslaten om te uploaden naar Overig en te koppelen aan ${record}` : 'Loslaten: komt in Overig (verschijnt pas hier na koppelen)';
    }
    return `Loslaten om te uploaden naar ${destination.label}`;
  });

  setTrayFolder(folderId: number | null): void {
    this.tray.update((tray) => tray && ({ ...tray, folderId }));
  }

  /** "Wijzigen…": the folder picker takes the tray's place for a moment. */
  pickTrayFolder(): void {
    const tray = this.tray();
    if (!tray || tray.running) return;
    this.trayOpen.set(false);
    this.folderPicker.set({
      mode: 'upload', title: 'Uploaden naar…', confirmLabel: 'Kiezen', current: tray.folderId ?? 'auto', movingFolderId: null,
      onPick: (target) => { this.setTrayFolder(target === 'auto' ? null : target); this.trayOpen.set(true); },
      onCancel: () => this.trayOpen.set(true),
    });
  }

  /** "Ook koppelen aan": the link picker, then back to the tray. */
  pickTrayLink(): void {
    const tray = this.tray();
    if (!tray || tray.running) return;
    this.trayOpen.set(false);
    this.linkPicker.set({
      count: tray.items.length,
      type: tray.link?.targetType ?? this.view()?.targetType ?? 'PRODUCT',
      onPick: (pick) => {
        this.tray.update((current) => current && ({ ...current, link: pick, linkHint: false }));
        this.trayOpen.set(true);
      },
      onCancel: () => this.trayOpen.set(true),
    });
  }

  clearTrayLink(): void {
    this.tray.update((tray) => tray && ({ ...tray, link: null }));
  }

  dropFromTray(id: number): void {
    this.tray.update((tray) => {
      if (!tray) return tray;
      const item = tray.items.find((entry) => entry.id === id);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      const items = tray.items.filter((entry) => entry.id !== id);
      return items.length ? { ...tray, items } : null;
    });
    if (!this.tray()) this.trayOpen.set(false);
  }

  /** Closing while it runs only hides the tray; the pill or the status bar keeps counting. */
  closeTray(): void {
    if (this.tray()?.running) { this.trayOpen.set(false); return; }
    this.revokeTray();
    this.tray.set(null);
    this.trayOpen.set(false);
  }

  private revokeTray(): void {
    for (const item of this.tray()?.items ?? []) if (item.preview) URL.revokeObjectURL(item.preview);
  }

  /** "Mislukte opnieuw": failed uploads go again, and failed links are tried once more. */
  async retryTray(): Promise<void> {
    const tray = this.tray();
    if (!tray || tray.running) return;
    const relink = tray.link ? tray.items.filter((item) => item.linkError && item.asset) : [];
    const requeue = tray.items.some((item) => item.status === 'error');
    this.tray.update((current) => current && ({
      ...current, done: !requeue,
      items: current.items.map((item) => item.status === 'error' ? { ...item, status: 'queued' as const, error: null }
        : item.linkError ? { ...item, linkError: null } : item),
    }));
    for (const item of relink) await this.linkUpload(item.id, item.file, item.asset!, tray.link!);
    if (relink.length) void this.store.refresh();
    if (requeue) await this.startTray();
  }

  private setItem(id: number, patch: Partial<UploadItem>): void {
    this.tray.update((tray) => tray && ({ ...tray, items: tray.items.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  }

  /** Three at a time, each row saying where it stands; one refresh at the end. */
  async startTray(): Promise<void> {
    const tray = this.tray();
    if (!tray || tray.running) return;
    const queued = tray.items.filter((item) => item.status === 'queued');
    if (!queued.length) return;
    this.tray.update((current) => current && ({ ...current, running: true, done: false }));
    const fresh: MediaAssetDetail[] = [];
    const worker = async () => {
      for (;;) {
        const next = (this.tray()?.items ?? []).find((item) => item.status === 'queued');
        if (!next) return;
        this.setItem(next.id, { status: 'busy' });
        try {
          const result = await this.media.upload(next.file, undefined, this.tray()?.folderId ?? null);
          const link = this.tray()?.link ?? null;
          const waiting = !!link && result.reused && result.asset.archived;
          this.setItem(next.id, { status: 'done', reused: result.reused, asset: result.asset, linkWaiting: waiting });
          if (!result.reused) fresh.push(result.asset);
          if (link && !waiting) await this.linkUpload(next.id, next.file, result.asset, link);
        } catch (failure) {
          this.setItem(next.id, { status: 'error', error: messageOf(failure, 'mislukt') });
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    this.tray.update((current) => current && ({ ...current, running: false, done: true }));
    const stats = this.trayStats();
    const items = this.tray()?.items ?? [];
    const folderId = this.tray()?.folderId ?? null;
    const trouble = stats.failed > 0 || stats.linkFailed > 0;
    if (stats.done) {
      const where = folderId === null ? 'Overig' : this.store.pathOf(folderId);
      if (!trouble) this.ui.toast(`${stats.done} bestand${stats.done === 1 ? '' : 'en'} toegevoegd in ${where}`);
      await this.store.refresh();
      if (!this.desktop.active()) void this.loadRecentStrip();
      if (this.desktop.active() && fresh.length === 1 && stats.done === 1) {
        this.select(clickSelect(this.selection(), fileKey(fresh[0].id)), true);
      }
    }
    if (trouble) {
      /* Said out loud even when the tray is hidden; the tray stays until it is closed, so "Mislukte opnieuw" remains. */
      const reason = items.find((item) => item.error)?.error ?? items.find((item) => item.linkError)?.linkError ?? null;
      const parts = [
        stats.done ? `${stats.done} toegevoegd` : '',
        stats.failed ? `${stats.failed} mislukt` : '',
        stats.linkFailed ? `${stats.linkFailed} niet gekoppeld` : '',
      ].filter(Boolean);
      this.ui.toast(`${parts.join(', ')}${reason ? ': ' + reason : ''}`, 'err',
        this.trayOpen() ? undefined : { label: 'Toon', run: () => { if (this.tray()) this.trayOpen.set(true); } });
      return;
    }
    if (stats.reused) return;
    if (!this.trayOpen()) {
      this.uploadedNote.set({ count: stats.done, folderId });
      this.later(() => { this.uploadedNote.set(null); if (!this.trayOpen() && this.tray()?.done && !this.trayIssue()) this.closeTray(); }, 4000);
    } else {
      this.later(() => { if (this.tray()?.done && !this.tray()?.running && !this.trayIssue()) this.closeTray(); }, 1200);
    }
  }

  /** Links a finished upload; purchase orders get the bytes as a dossier document. */
  private async linkUpload(itemId: number, file: File, asset: MediaAssetDetail, link: TrayLink): Promise<void> {
    if (asset.links.some((item) => item.targetType === link.targetType && item.targetId === link.targetId)) return;
    if (link.targetType === 'PURCHASE_ORDER' && this.pendingLinks().get(asset.id)?.orderId === link.targetId) return;
    try {
      if (link.targetType === 'PURCHASE_ORDER') {
        await this.sourcing.addDocument(link.targetId, file, link.documentKind ?? 'OTHER', asset.name, null);
        this.trackPending(asset.id, link.targetId, link.label);
      } else {
        const linked = await this.media.addLink(asset.id, { targetType: link.targetType, targetId: link.targetId, role: 'INTERNAL' });
        this.setItem(itemId, { asset: linked });
      }
    } catch (failure) {
      this.setItem(itemId, { linkError: messageOf(failure, 'Koppelen mislukt') });
    }
  }

  /** A reused file: show it where it already is. */
  trayShow(item: UploadItem): void {
    if (!item.asset) return;
    this.closeTray();
    this.reveal(item.asset);
  }

  /** A reused file into the tray's folder, only on this explicit tap. */
  async trayMoveHere(item: UploadItem): Promise<void> {
    const folderId = this.tray()?.folderId ?? null;
    if (!item.asset || folderId === null) return;
    try {
      const moved = await this.media.move(item.asset.id, folderId);
      this.setItem(item.id, { asset: moved });
      this.ui.toast(`“${moved.name}” verplaatst naar ${this.store.pathOf(folderId)}`);
      void this.store.refresh();
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Verplaatsen mislukt'), 'err');
    }
  }

  /** A reused archived file comes back; then the tray's link runs. */
  async trayRestore(item: UploadItem): Promise<void> {
    if (!item.asset) return;
    try {
      const restored = await this.media.restore(item.asset.id);
      this.setItem(item.id, { asset: restored, linkWaiting: false });
      const link = this.tray()?.link;
      if (item.linkWaiting && link) await this.linkUpload(item.id, item.file, restored, link);
      this.ui.toast(`Teruggehaald in ${this.store.pathOf(restored.folderId)}`);
      void this.store.refresh();
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Terughalen mislukt'), 'err');
    }
  }

  /** "Toon in map" after the tray: the folder the files went to. */
  showUploaded(): void {
    const folderId = this.tray()?.folderId ?? this.uploadedNote()?.folderId ?? null;
    this.closeTray();
    this.uploadedNote.set(null);
    if (folderId !== null) this.openFolder(folderId);
    else this.openRecent();
  }

  /* ================================================================ helpers */

  private later(run: () => void, ms: number): void {
    const timer = setTimeout(() => { this.timers.delete(timer); run(); }, ms);
    this.timers.add(timer);
  }

  pathOf(folderId: number | null): string {
    return pathLabel(this.store.folders(), folderId);
  }
}

function readStore(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStore(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* remembered for this visit only */ }
}

function readSearches(): string[] {
  try {
    const value = JSON.parse(readStore(SEARCHES_STORE) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}

function sameLink(a: TrayLink | null, b: TrayLink | null): boolean {
  return a === b || (!!a && !!b && a.targetType === b.targetType && a.targetId === b.targetId);
}

function isCoarsePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}
