import { Injectable, computed, inject, signal } from '@angular/core';
import { messageOf } from '../../core/api/errors';
import { MediaApi } from '../../core/api/media-api';
import { MediaAssetDetail, MediaFolder } from '../../core/api/media-models';
import { Ui } from '../../shared/ui';
import { buildTree, crumbsFor, folderCanLand, folderCounts, pathLabel } from './files-rules';

/** A dragged file, with what a drop target needs to know about it. */
export interface DraggedAsset { id: number; name: string; folderId: number | null; }

/** What is being dragged inside the workspace: files from the list, or one folder. */
export type FilesDragPayload = { assets: readonly DraggedAsset[] } | { folderId: number };

/** A folder action asked for outside the page (the navigation tree), handled by the page. */
export interface FolderRequest {
  kind: 'new' | 'edit' | 'move' | 'delete' | 'download';
  /** The folder acted on; for 'new' the parent (null is the top level). */
  folderId: number | null;
}

const TREE_KEY = 'enrosed.files.tree';

/**
 * The folders of Documenten & media, shared by the workspace navigation
 * (rendered by the app shell) and the page. Also the hand-over point for
 * drags between them: HTML drag and drop hides its payload until the drop,
 * so the dragged files or folder sit here while the pointer travels. Every
 * change bumps `revision`; the page reloads its list when it moves.
 * Never imports the page, so the navigation stays small.
 */
@Injectable({ providedIn: 'root' })
export class FilesStore {
  private readonly media = inject(MediaApi);
  private readonly ui = inject(Ui);

  readonly folders = signal<MediaFolder[]>([]);
  readonly loading = signal(false);
  /** The last load failed: "no folders" would not be true, so the page says so. */
  readonly failed = signal(false);
  readonly tree = computed(() => buildTree(this.folders()));
  readonly counts = computed(() => folderCounts(this.folders()));

  /** Tree nodes the user opened, remembered on this device. */
  readonly expanded = signal<ReadonlySet<number>>(readExpanded());
  readonly dragPayload = signal<FilesDragPayload | null>(null);
  /** Bumped after every change made here, so the page refreshes once. */
  readonly revision = signal(0);
  readonly folderRequest = signal<FolderRequest | null>(null);

  private inFlight: Promise<void> | null = null;

  /** Loads the folders; a call while one is on its way waits for that one. */
  loadFolders(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.loading.set(true);
    this.inFlight = this.media.folders()
      .then((folders) => { this.folders.set(folders); this.failed.set(false); })
      .catch((failure) => {
        this.failed.set(true);
        this.ui.toast(messageOf(failure, 'De mappen konden niet worden geladen.'), 'err');
      })
      .finally(() => {
        this.inFlight = null;
        this.loading.set(false);
      });
    return this.inFlight;
  }

  folder(id: number | null): MediaFolder | null {
    return id === null ? null : this.folders().find((folder) => folder.id === id) ?? null;
  }

  pathOf(id: number | null): string {
    return pathLabel(this.folders(), id);
  }

  /** A folder may not move into itself, a subfolder or where it already is. */
  canLand(folderId: number, targetId: number | null): boolean {
    const folder = this.folder(folderId);
    return !!folder && folderCanLand(this.folders(), folder, targetId);
  }

  /** Whether the current drag may be dropped on a folder (null is the top level). */
  canDrop(targetId: number | null): boolean {
    const payload = this.dragPayload();
    if (!payload) return false;
    if ('folderId' in payload) return this.canLand(payload.folderId, targetId);
    return payload.assets.some((asset) => (asset.folderId ?? null) !== targetId);
  }

  /** Drops the current drag on a folder; the page refreshes through `revision`. */
  async drop(targetId: number | null): Promise<MediaAssetDetail[]> {
    const payload = this.dragPayload();
    this.dragPayload.set(null);
    if (!payload) return [];
    if ('folderId' in payload) {
      await this.moveFolder(payload.folderId, targetId);
      return [];
    }
    return this.moveAssets(payload.assets, targetId);
  }

  toggleExpanded(id: number, open?: boolean): void {
    this.expanded.update((ids) => {
      const next = new Set(ids);
      const wanted = open ?? !next.has(id);
      if (wanted) next.add(id); else next.delete(id);
      storeExpanded(next);
      return next;
    });
  }

  /** Opens the tree down to a folder, so the open folder is always visible. */
  revealInTree(id: number): void {
    const ancestors = crumbsFor(this.folders(), id).slice(0, -1).map((crumb) => crumb.id);
    if (ancestors.every((ancestor) => this.expanded().has(ancestor))) return;
    this.expanded.update((ids) => {
      const next = new Set([...ids, ...ancestors]);
      storeExpanded(next);
      return next;
    });
  }

  async createFolder(name: string, parentId: number | null): Promise<MediaFolder | null> {
    try {
      const folder = await this.media.createFolder(name, parentId);
      await this.refresh();
      return folder;
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'De map kon niet worden bewaard.'), 'err');
      return null;
    }
  }

  async updateFolder(id: number, name: string, parentId: number | null): Promise<MediaFolder | null> {
    try {
      const folder = await this.media.updateFolder(id, name, parentId);
      await this.refresh();
      return folder;
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'De map kon niet worden bewaard.'), 'err');
      return null;
    }
  }

  /** The server moves the files and subfolders of a deleted folder to its parent. */
  async deleteFolder(id: number): Promise<boolean> {
    try {
      await this.media.deleteFolder(id);
      await this.refresh();
      return true;
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'De map kon niet worden verwijderd.'), 'err');
      return false;
    }
  }

  async moveFolder(id: number, parentId: number | null): Promise<boolean> {
    const folder = this.folder(id);
    if (!folder || !this.canLand(id, parentId)) return false;
    const moved = await this.updateFolder(id, folder.name, parentId);
    if (moved) this.ui.toast(`Map “${folder.name}” verplaatst naar ${parentId === null ? 'Mappen' : this.pathOf(parentId)}`);
    return !!moved;
  }

  /**
   * Moves files one by one; the list rows are patched by the page through
   * `revision`. Returns the updated files so the caller can patch at once.
   */
  async moveAssets(assets: readonly { id: number; name: string; folderId: number | null }[], folderId: number | null): Promise<MediaAssetDetail[]> {
    const moving = assets.filter((asset) => (asset.folderId ?? null) !== folderId);
    if (!moving.length) return [];
    const moved: MediaAssetDetail[] = [];
    let failure: unknown = null;
    for (const asset of moving) {
      try {
        moved.push(await this.media.move(asset.id, folderId));
      } catch (error) {
        failure = error;
        break;
      }
    }
    const where = folderId === null ? 'Zonder map' : this.pathOf(folderId);
    if (moved.length) {
      this.ui.toast(moved.length === 1 ? `“${moving[0].name}” verplaatst naar ${where}` : `${moved.length} bestanden verplaatst naar ${where}`);
    }
    if (failure) this.ui.toast(messageOf(failure, 'Verplaatsen mislukt'), 'err');
    await this.refresh();
    return moved;
  }

  /**
   * Folders again, and a signal to the page that its list is stale. A load
   * already on its way may have been asked before the change: it is waited
   * out and a fresh one follows (two refreshes in a row share that one).
   */
  async refresh(): Promise<void> {
    if (this.inFlight) await this.inFlight;
    await this.loadFolders();
    this.revision.update((value) => value + 1);
  }
}

function readExpanded(): ReadonlySet<number> {
  try {
    const raw = JSON.parse(localStorage.getItem(TREE_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((id): id is number => Number.isInteger(id)) : []);
  } catch {
    return new Set();
  }
}

function storeExpanded(ids: ReadonlySet<number>): void {
  try {
    localStorage.setItem(TREE_KEY, JSON.stringify([...ids]));
  } catch {
    /* Private mode: the tree folds back next visit. */
  }
}
