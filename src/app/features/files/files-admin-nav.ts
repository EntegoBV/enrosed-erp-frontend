import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { MediaFolder } from '../../core/api/media-models';
import { BrandMark } from '../../shared/brand-mark';
import { ContextMenu, ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { Icon } from '../../shared/icon';
import { WkSideFoot } from '../../shared/wk-side-foot';
import { LINK_VIEWS, navFolderId, navSection, parseFilesLocation } from './files-collections';
import { folderActions } from './files-rules';
import { FilesStore, FolderRequest } from './files-store';

const RAIL_KEY = 'enrosed.files.rail';
const RAIL_DEFAULT = 248;
const RAIL_MIN = 220;
const RAIL_MAX = 340;

/**
 * The dark workspace navigation of Documenten & media on a desk, rendered
 * by the app shell: Bibliotheek (Recent, Mappen and the folder tree),
 * Gekoppeld aan (the record lens) and Beheer (Archief), then the way back
 * to the ERP. An 88px rail from 680px, the full column with the tree from
 * 900px, as wide as it is dragged. Every entry is a query on /files, read
 * with the same parser as the page. Imports no page code, so it stays small
 * in the main bundle.
 */
@Component({
  selector: 'app-files-admin-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrandMark, ContextMenu, Icon, RouterLink, WkSideFoot],
  template: `
    @let section = section$();
    <aside class="wk-side files-side" [style.--wk-side-w.px]="width()" [class.files-side--resizing]="resizing()" aria-label="Documenten en media"
           (dragover)="osGuard($event)" (drop)="osGuard($event)">
      <header class="wk-side__brand"><app-brand-mark subtitle="Documenten & media" /></header>
      <nav class="wk-side__nav" aria-label="Onderdelen van Documenten en media">
        <span class="wk-side__label">Bibliotheek</span>
        <a class="wk-side__item" routerLink="/files" [queryParams]="{ view: 'all' }" title="Laatst gewijzigd eerst"
           [class.active]="section === 'recent'" [attr.aria-current]="section === 'recent' ? 'page' : null">
          <app-icon name="recent" [size]="18" /><span class="wk-side__text">Recent</span><span class="wk-side__short">Recent</span>
        </a>
        <div class="files-side__folders">
          <a class="wk-side__item" routerLink="/files" [queryParams]="{}" title="Zoals ze automatisch geordend worden"
             [class.active]="section === 'folders' && (!wide() || activeFolder() === null)" [class.is-drop]="dropOn() === 'top'"
             [attr.aria-current]="section === 'folders' && activeFolder() === null ? 'page' : null"
             (dragover)="over($event, null)" (dragleave)="dropOn.set(null)" (drop)="drop($event, null)">
            <app-icon name="folder" [size]="18" /><span class="wk-side__text">Mappen</span><span class="wk-side__short">Mappen</span>
          </a>
          @if (wide()) {
            <button class="files-side__add" type="button" aria-label="Nieuwe map" title="Nieuwe map" (click)="request('new', null)"><app-icon name="plus" [size]="15" /></button>
          }
        </div>
        @if (wide() && rows().length) {
          <div class="files-tree" role="tree" aria-label="Mappen" (keydown)="treeKey($event)">
            @for (row of rows(); track row.id) {
              <div class="files-tree__row" role="treeitem" [attr.data-id]="row.id" [attr.aria-level]="row.depth + 1"
                   [attr.aria-expanded]="row.parent ? row.open : null" [attr.aria-selected]="row.id === activeFolder()"
                   [attr.tabindex]="row.id === focusId() ? 0 : -1" [style.--depth]="row.depth" [title]="row.name"
                   [class.active]="row.id === activeFolder()" [class.is-drop]="dropOn() === row.id"
                   (click)="open(row.id)" (contextmenu)="menu($event, row.id)" (focus)="focusId.set(row.id)"
                   draggable="true" (dragstart)="dragFolder($event, row.id)" (dragend)="store.dragPayload.set(null)"
                   (dragover)="over($event, row.id)" (dragleave)="dropOn.set(null)" (drop)="drop($event, row.id)">
                <span class="files-tree__twist" aria-hidden="true" [class.is-open]="row.open" [class.is-leaf]="!row.parent" (click)="twist($event, row.id)">
                  @if (row.parent) { <app-icon name="chevron-right" [size]="12" /> }
                </span>
                <app-icon class="files-tree__icon" name="folder" [size]="15" />
                <span class="files-tree__name">{{ row.name }}</span>
                <span class="files-tree__count" [title]="row.total + ' bestanden, incl. submappen'">{{ row.total || '' }}</span>
                <span class="files-tree__more" aria-hidden="true" title="Mapacties" (click)="menu($event, row.id)"><app-icon name="more" [size]="14" /></span>
              </div>
            }
          </div>
        }

        <span class="wk-side__label">Gekoppeld aan</span>
        @for (view of views; track view.key) {
          <a class="wk-side__item" routerLink="/files" [queryParams]="{ view: view.key }" [title]="view.hint"
             [class.active]="section === view.key" [attr.aria-current]="section === view.key ? 'page' : null">
            <app-icon [name]="view.iconName" [size]="18" /><span class="wk-side__text">{{ view.label }}</span><span class="wk-side__short">{{ view.railLabel }}</span>
          </a>
        }

        <span class="wk-side__label">Beheer</span>
        <a class="wk-side__item" routerLink="/files" [queryParams]="{ view: 'all', archief: 1 }" title="Opgeborgen bestanden"
           [class.active]="section === 'archive'" [attr.aria-current]="section === 'archive' ? 'page' : null">
          <app-icon name="archive" [size]="18" /><span class="wk-side__text">Archief</span><span class="wk-side__short">Archief</span>
        </a>
      </nav>
      <app-wk-side-foot />
      @if (wide()) {
        <div class="files-side__resize" role="separator" aria-orientation="vertical" aria-label="Breedte van de navigatie" tabindex="0"
             title="Sleep om de navigatie breder of smaller te maken; dubbelklik zet ze terug"
             [attr.aria-valuenow]="width()" [attr.aria-valuemin]="railMin" [attr.aria-valuemax]="railMax"
             (pointerdown)="startResize($event)" (dblclick)="setWidth(railDefault)"
             (keydown.arrowleft)="$event.preventDefault(); setWidth(width() - 16)" (keydown.arrowright)="$event.preventDefault(); setWidth(width() + 16)"></div>
      }
    </aside>
    @if (folderMenu(); as open) {
      <app-context-menu [title]="open.folder.name" [items]="menuItems" [anchor]="open.anchor" (pick)="pick($event)" (closed)="folderMenu.set(null)" />
    }
  `,
})
export class FilesAdminNav {
  readonly store = inject(FilesStore);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly views = LINK_VIEWS;
  readonly menuItems = folderActions();
  readonly railMin = RAIL_MIN;
  readonly railMax = RAIL_MAX;
  readonly railDefault = RAIL_DEFAULT;

  private readonly url = toSignal(this.router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    map(() => this.router.url),
  ), { initialValue: this.router.url });

  /** Where the address bar points: the same reading as the page's. */
  private readonly location = computed(() => {
    const params = new URLSearchParams(this.url().split('?')[1]?.split('#')[0] ?? '');
    return parseFilesLocation((key) => params.get(key));
  });
  readonly section$ = computed(() => navSection(this.location()));
  readonly activeFolder = computed(() => navFolderId(this.location()));

  /** The tree only has room from 900px; below it is a rail of icons. */
  readonly wide = signal(matchWide());
  readonly width = signal(readWidth());
  readonly resizing = signal(false);
  readonly dropOn = signal<number | 'top' | null>(null);
  readonly focusId = signal<number | null>(null);
  readonly folderMenu = signal<{ folder: MediaFolder; anchor: MenuPoint } | null>(null);

  /** The visible rows: every folder whose ancestors are all open. */
  readonly rows = computed(() => {
    const expanded = this.store.expanded();
    const counts = this.store.counts();
    const tree = this.store.tree();
    const parents = new Set(tree.map((node) => node.parentId).filter((id): id is number => id !== null));
    const rows: { id: number; name: string; depth: number; parent: boolean; open: boolean; total: number; parentId: number | null }[] = [];
    let hiddenBelow = Infinity;
    for (const node of tree) {
      if (node.depth > hiddenBelow) continue;
      hiddenBelow = Infinity;
      const open = expanded.has(node.id);
      rows.push({ id: node.id, name: node.name, depth: node.depth, parent: parents.has(node.id), open, total: counts.get(node.id)?.total ?? 0, parentId: node.parentId });
      if (!open) hiddenBelow = node.depth;
    }
    return rows;
  });

  constructor() {
    void this.store.loadFolders();
    const media = typeof matchMedia === 'function' ? matchMedia('(min-width: 900px)') : null;
    const onWide = (event: MediaQueryListEvent) => this.wide.set(event.matches);
    media?.addEventListener('change', onWide);
    inject(DestroyRef).onDestroy(() => media?.removeEventListener('change', onWide));
    /* The open folder is always visible in the tree, and has the keyboard. */
    effect(() => {
      const id = this.activeFolder();
      this.store.folders();
      untracked(() => {
        if (id === null) return;
        this.store.revealInTree(id);
        this.focusId.set(id);
      });
    });
    effect(() => {
      const rows = this.rows();
      untracked(() => {
        if (this.focusId() === null || !rows.some((row) => row.id === this.focusId())) this.focusId.set(rows[0]?.id ?? null);
      });
    });
  }

  open(id: number): void {
    void this.router.navigate(['/files'], { queryParams: { map: id } });
  }

  twist(event: MouseEvent, id: number): void {
    event.stopPropagation();
    this.store.toggleExpanded(id);
  }

  request(kind: FolderRequest['kind'], folderId: number | null): void {
    this.store.folderRequest.set({ kind, folderId });
  }

  menu(event: MouseEvent, id: number): void {
    event.preventDefault();
    event.stopPropagation();
    const folder = this.store.folder(id);
    if (folder) this.folderMenu.set({ folder, anchor: { x: event.clientX, y: event.clientY } });
  }

  pick(item: ContextMenuItem): void {
    const open = this.folderMenu();
    this.folderMenu.set(null);
    if (!open) return;
    const id = open.folder.id;
    switch (item.id) {
      case 'folder-open': this.open(id); break;
      case 'folder-new': this.request('new', id); break;
      case 'folder-rename': this.request('edit', id); break;
      case 'folder-move': this.request('move', id); break;
      case 'folder-download': this.request('download', id); break;
      case 'folder-delete': this.request('delete', id); break;
    }
  }

  /* ---- drops from the page, and folders dragged within the tree */
  dragFolder(event: DragEvent, id: number): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `map:${id}`);
    this.store.dragPayload.set({ folderId: id });
  }

  over(event: DragEvent, id: number | null): void {
    if (!this.store.canDrop(id)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dropOn.set(id ?? 'top');
  }

  drop(event: DragEvent, id: number | null): void {
    if (!this.store.dragPayload()) return;
    event.preventDefault();
    this.dropOn.set(null);
    void this.store.drop(id);
  }

  /** Files from the computer let go over the navigation must not open in the tab (and leave the ERP). */
  osGuard(event: DragEvent): void {
    if (event.defaultPrevented || this.store.dragPayload() || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'none';
  }

  /* ---- the tree's keyboard: ↑/↓ move, ←/→ fold and unfold, Enter opens */
  treeKey(event: KeyboardEvent): void {
    const rows = this.rows();
    const index = rows.findIndex((row) => row.id === this.focusId());
    const row = rows[index];
    if (!row) return;
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowDown': next = rows[Math.min(rows.length - 1, index + 1)].id; break;
      case 'ArrowUp': next = rows[Math.max(0, index - 1)].id; break;
      case 'ArrowRight':
        if (row.parent && !row.open) this.store.toggleExpanded(row.id, true);
        else if (row.parent) next = rows[index + 1]?.id ?? null;
        break;
      case 'ArrowLeft':
        if (row.parent && row.open) this.store.toggleExpanded(row.id, false);
        else next = row.parentId;
        break;
      case 'Enter': this.open(row.id); break;
      case 'ContextMenu':
      case 'F10':
        if (event.key === 'F10' && !event.shiftKey) return;
        this.openMenuAtRow(row.id);
        break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (next !== null) {
      this.focusId.set(next);
      queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>(`.files-tree__row[data-id="${next}"]`)?.focus());
    }
  }

  private openMenuAtRow(id: number): void {
    const element = this.host.nativeElement.querySelector<HTMLElement>(`.files-tree__row[data-id="${id}"]`);
    const folder = this.store.folder(id);
    if (!element || !folder) return;
    const rect = element.getBoundingClientRect();
    this.folderMenu.set({ folder, anchor: { x: rect.left + 24, y: rect.bottom } });
  }

  /* ---- width */
  setWidth(width: number): void {
    this.width.set(clampWidth(width));
    try { localStorage.setItem(RAIL_KEY, String(this.width())); } catch { /* remembered for this visit only */ }
  }

  startResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startWidth = this.width();
    this.resizing.set(true);
    const move = (moveEvent: PointerEvent) => this.width.set(clampWidth(startWidth + moveEvent.clientX - startX));
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      this.resizing.set(false);
      this.setWidth(this.width());
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }
}

function clampWidth(width: number): number {
  return Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(width)));
}

function readWidth(): number {
  try {
    const stored = Number(localStorage.getItem(RAIL_KEY));
    return stored ? clampWidth(stored) : RAIL_DEFAULT;
  } catch {
    return RAIL_DEFAULT;
  }
}

function matchWide(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(min-width: 900px)').matches;
}
