/**
 * The rules of Documenten & media that do not depend on Angular: the folder
 * tree and its honest counts, what may be deleted, shared, linked or
 * re-versioned, where an upload lands, the one line that says where a file
 * lives, and the one action list every menu, swipe and toolbar is built
 * from. Pure, types-only imports: node-tested.
 */
import type { ContextMenuItem } from '../../shared/context-menu';
import type {
  MediaAssetLink, MediaAssetSummary, MediaFolder, MediaTargetType,
} from '../../core/api/media-models';
import type { FilesLocation, FilesPlace, FilesSort, LinkView } from './files-collections';

/* ================================================================ folders */

export interface FolderNode extends MediaFolder {
  depth: number;
}

export interface FolderCounts {
  /** Files directly in the folder: what opening it lists. */
  direct: number;
  /** Files in the folder and every folder below it (the server's assetCount). */
  total: number;
  subfolders: number;
}

/**
 * Direct and total counts. The server adds every live file once to each
 * folder up its ancestor chain, so a folder's own files are its total minus
 * the totals of its direct children.
 */
export function folderCounts(folders: readonly MediaFolder[]): Map<number, FolderCounts> {
  const childTotals = new Map<number, number>();
  const childCounts = new Map<number, number>();
  for (const folder of folders) {
    if (folder.parentId === null) continue;
    childTotals.set(folder.parentId, (childTotals.get(folder.parentId) ?? 0) + folder.assetCount);
    childCounts.set(folder.parentId, (childCounts.get(folder.parentId) ?? 0) + 1);
  }
  const counts = new Map<number, FolderCounts>();
  for (const folder of folders) {
    counts.set(folder.id, {
      direct: Math.max(0, folder.assetCount - (childTotals.get(folder.id) ?? 0)),
      total: folder.assetCount,
      subfolders: childCounts.get(folder.id) ?? 0,
    });
  }
  return counts;
}

/** "3 bestanden · 2 submappen", or "2 submappen · 14 in totaal" when the folder itself is empty. */
export function folderMeta(counts: FolderCounts | undefined): string {
  if (!counts) return '';
  const files = `${counts.direct} bestand${counts.direct === 1 ? '' : 'en'}`;
  const subs = `${counts.subfolders} submap${counts.subfolders === 1 ? '' : 'pen'}`;
  if (!counts.subfolders) return files;
  if (!counts.direct && counts.total) return `${subs} · ${counts.total} in totaal`;
  return `${files} · ${subs}`;
}

/** Depth-first, siblings in Dutch alphabetical order; deeper than 8 levels is cut off. */
export function buildTree(folders: readonly MediaFolder[]): FolderNode[] {
  const byParent = new Map<number | null, MediaFolder[]>();
  for (const folder of folders) {
    const list = byParent.get(folder.parentId) ?? [];
    list.push(folder);
    byParent.set(folder.parentId, list);
  }
  const out: FolderNode[] = [];
  const seen = new Set<number>();
  const walk = (parentId: number | null, depth: number) => {
    if (depth > 8) return;
    const children = [...(byParent.get(parentId) ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'nl'));
    for (const folder of children) {
      if (seen.has(folder.id)) continue;
      seen.add(folder.id);
      out.push({ ...folder, depth });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** The path from the top down to a folder, the folder last. */
export function crumbsFor(folders: readonly MediaFolder[], folderId: number | null): { id: number; name: string }[] {
  if (folderId === null) return [];
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: { id: number; name: string }[] = [];
  for (let cursor = byId.get(folderId); cursor && path.length < 12; cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId)) {
    path.unshift({ id: cursor.id, name: cursor.name });
  }
  return path;
}

/** "Kosten › 2026"; files without a folder read "Zonder map". */
export function pathLabel(folders: readonly MediaFolder[], folderId: number | null): string {
  if (folderId === null) return 'Zonder map';
  const path = crumbsFor(folders, folderId);
  return path.length ? path.map((crumb) => crumb.name).join(' › ') : 'Zonder map';
}

/** The last segments of a path, for a narrow column: "Productfoto’s › Rose Box". */
export function pathTail(folders: readonly MediaFolder[], folderId: number | null, segments = 2): string {
  if (folderId === null) return 'Zonder map';
  const path = crumbsFor(folders, folderId);
  return path.length ? path.slice(-segments).map((crumb) => crumb.name).join(' › ') : 'Zonder map';
}

/** The folder itself and everything below it. */
export function subtreeIds(folders: readonly MediaFolder[], folderId: number): Set<number> {
  const ids = new Set<number>([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId !== null && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        grew = true;
      }
    }
  }
  return ids;
}

/**
 * Whether a folder may move under a target (null is the top level): never
 * into itself or one of its own subfolders, and not where it already is.
 */
export function folderCanLand(
  folders: readonly MediaFolder[],
  moving: Pick<MediaFolder, 'id' | 'parentId'>,
  targetId: number | null,
): boolean {
  if (targetId === (moving.parentId ?? null)) return false;
  if (targetId === null) return true;
  return !subtreeIds(folders, moving.id).has(targetId);
}

/** Where a folder may be placed: every folder outside its own subtree. */
export function parentChoices(tree: readonly FolderNode[], folderId: number | null): FolderNode[] {
  if (folderId === null) return [...tree];
  const blocked = subtreeIds(tree, folderId);
  return tree.filter((node) => !blocked.has(node.id));
}

/* ================================================================ lifecycle */

/** Kept in step with targetLabel in files-collections (node-tested modules share no runtime imports). */
const TYPE_NAMES: Record<MediaTargetType, string> = {
  PRODUCT: 'Product', PRODUCT_FAMILY: 'Productreeks', PURCHASE_ORDER: 'Inkooporder', COMPANY_COST: 'Kost', PLANNER_ITEM: 'Planner',
};

function labelOf(link: Pick<MediaAssetLink, 'targetType' | 'targetId' | 'targetLabel'>): string {
  return link.targetLabel || `${TYPE_NAMES[link.targetType] ?? 'Record'} #${link.targetId}`;
}

/** "A", "A en B", "A, B en 3 andere": at most two names, then a count. */
export function joinLabels(labels: readonly string[]): string {
  const unique = [...new Set(labels)];
  if (unique.length <= 1) return unique[0] ?? '';
  if (unique.length === 2) return `${unique[0]} en ${unique[1]}`;
  return `${unique[0]}, ${unique[1]} en ${unique.length - 2} andere`;
}

/**
 * Why "Definitief verwijderen" is not possible (yet): the file has to be
 * archived first, and a linked file is never deleted. An archived file
 * shown outside Archief ("Toon in map", a deep link) counts as archived.
 */
export function deleteBlock(asset: Pick<MediaAssetSummary, 'links' | 'archived'>, place: FilesPlace): 'archive-first' | 'linked' | null {
  if (place !== 'archive' && !asset.archived) return 'archive-first';
  if (asset.links.length > 0) return 'linked';
  return null;
}

/**
 * What archiving changes where the files are used, one line per kind of
 * record; null when nothing is linked (then archiving needs no question).
 */
export function archiveWarning(assets: readonly Pick<MediaAssetSummary, 'links'>[]): string[] | null {
  const products: string[] = [];
  const costs: string[] = [];
  const sources: string[] = [];
  for (const asset of assets) {
    for (const link of asset.links) {
      if (link.targetType === 'PRODUCT') products.push(labelOf(link));
      else if (link.targetType === 'COMPANY_COST') costs.push(labelOf(link));
      else sources.push(labelOf(link));
    }
  }
  const lines: string[] = [];
  if (products.length) lines.push(`Het verdwijnt uit Bestanden bij ${joinLabels(products)}.`);
  if (costs.length) lines.push(`Bij ${joinLabels(costs)} blijft het staan met het label ‘gearchiveerd’.`);
  if (sources.length) lines.push(`In ${joinLabels(sources)} blijft het gewoon staan.`);
  return lines.length ? lines : null;
}

/** Cost and purchase documents deserve a second look before they go public. */
export function isSensitive(asset: Pick<MediaAssetSummary, 'links'>): boolean {
  return asset.links.some((link) => link.targetType === 'COMPANY_COST' || link.targetType === 'PURCHASE_ORDER');
}

export function sensitiveNote(asset: Pick<MediaAssetSummary, 'links'>): string | null {
  if (asset.links.some((link) => link.targetType === 'COMPANY_COST')) return 'Let op: dit is een kostendocument.';
  if (asset.links.some((link) => link.targetType === 'PURCHASE_ORDER')) return 'Let op: dit is een inkoopdocument.';
  return null;
}

/* The backend refuses links and new versions for archived files; the UI refuses sharing as well. */
export function canShare(asset: Pick<MediaAssetSummary, 'archived'>): boolean { return !asset.archived; }
export function canLink(asset: Pick<MediaAssetSummary, 'archived'>): boolean { return !asset.archived; }
export function canReplace(asset: Pick<MediaAssetSummary, 'archived'>): boolean { return !asset.archived; }

export function hasWeb(asset: Pick<MediaAssetSummary, 'web' | 'sizeBytes'>): boolean {
  return !!asset.web && asset.web.sizeBytes !== asset.sizeBytes;
}

/* ================================================================ uploads */

export type UploadDestination =
  | { kind: 'folder'; folderId: number; label: string }
  | { kind: 'auto'; label: string }
  | { kind: 'record'; targetType: MediaTargetType; targetId: number | null; label: string }
  | { kind: 'none'; reason: string };

export const AUTO_LABEL = 'Overig (automatisch)';
export const ARCHIVE_UPLOAD_REASON = 'In het archief kun je niets toevoegen.';
export const PLANNER_UPLOAD_REASON = 'Bijlagen voor de planner voeg je in de planner toe.';

/**
 * Where an upload lands, spelled out: the open folder; Overig (where the
 * server parks files without a folder) for Mappen, Recent, Niet gekoppeld
 * and search results; Overig plus a link in a record view; nowhere in
 * Archief and Planner.
 */
export function uploadDestination(
  location: FilesLocation,
  folders: readonly MediaFolder[],
  view: Pick<LinkView, 'targetType' | 'canUpload'> | null,
  recordLabel: string | null = null,
): UploadDestination {
  if (location.place === 'archive') return { kind: 'none', reason: ARCHIVE_UPLOAD_REASON };
  if (location.place === 'view') {
    if (view && !view.canUpload) return { kind: 'none', reason: PLANNER_UPLOAD_REASON };
    if (view?.targetType) {
      const targetId = location.targetId;
      return {
        kind: 'record', targetType: view.targetType, targetId,
        label: targetId !== null && recordLabel ? `${AUTO_LABEL} · gekoppeld aan ${recordLabel}` : AUTO_LABEL,
      };
    }
    return { kind: 'auto', label: AUTO_LABEL };
  }
  if (location.place === 'folders' && location.folderId !== 'root' && !location.query) {
    return { kind: 'folder', folderId: location.folderId, label: pathLabel(folders, location.folderId) };
  }
  return { kind: 'auto', label: AUTO_LABEL };
}

/* ================================================================ how a row reads */

/**
 * Where a file lives, in one line: its first link (the record it belongs to)
 * or its folder path, never both, and nothing where the place already says
 * it (a link view, or the file's own folder).
 */
export function whereLine(
  asset: Pick<MediaAssetSummary, 'links' | 'folderId'>,
  location: FilesLocation,
  folders: readonly MediaFolder[],
): { kind: 'link' | 'folder' | 'none'; text: string } {
  if (location.place === 'view') return { kind: 'none', text: '' };
  if (asset.links.length) {
    const more = asset.links.length - 1;
    return { kind: 'link', text: labelOf(asset.links[0]) + (more > 0 ? ` +${more}` : '') };
  }
  if (location.place === 'folders' && !location.query && (asset.folderId ?? 'root') === location.folderId) {
    return { kind: 'none', text: '' };
  }
  return { kind: 'folder', text: pathTail(folders, asset.folderId, 2) };
}

/** "1,2 MB", "340 kB", "512 B". */
export function sizeLabel(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '';
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toLocaleString('nl-BE', { maximumFractionDigits: 1 })} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${bytes} B`;
}

export function totalSize(assets: readonly Pick<MediaAssetSummary, 'sizeBytes'>[]): number {
  return assets.reduce((sum, asset) => sum + (asset.sizeBytes || 0), 0);
}

/**
 * The line under a cost in the link picker: party, date and amount. The one
 * place a customer-safe mode would hide the amount.
 */
export function costTargetMeta(cost: { party: string | null; date: string | null; amountInclEur?: number | null; amountExclEur?: number | null }): string {
  const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(cost.date ?? '');
  const amount = cost.amountInclEur ?? cost.amountExclEur;
  return [
    cost.party?.trim() || '',
    date ? `${date[3]}/${date[2]}/${date[1]}` : '',
    amount === null || amount === undefined ? '' : new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' }).format(amount),
  ].filter(Boolean).join(' · ');
}

/* ================================================================ sorting and groups */

/**
 * The client sort of the loaded files. Ties fall back to the newest change,
 * then the id, so equal names keep a stable order while paging.
 */
export function sortAssets<T extends MediaAssetSummary>(assets: readonly T[], sort: FilesSort, folders: readonly MediaFolder[]): T[] {
  const factor = sort.dir === 'asc' ? 1 : -1;
  const paths = sort.key === 'folder' ? new Map(assets.map((asset) => [asset.id, pathLabel(folders, asset.folderId)])) : null;
  const text = (a: string, b: string) => a.localeCompare(b, 'nl', { sensitivity: 'base', numeric: true });
  const compare = (a: T, b: T): number => {
    switch (sort.key) {
      case 'name': return text(a.name, b.name);
      case 'size': return a.sizeBytes - b.sizeBytes;
      case 'links': return a.links.length - b.links.length;
      case 'folder': return text(paths!.get(a.id) ?? '', paths!.get(b.id) ?? '');
      case 'by': return text(a.createdByName || '', b.createdByName || '');
      default: return a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0;
    }
  };
  return [...assets].sort((a, b) => compare(a, b) * factor
    || (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)
    || b.id - a.id);
}

export interface RecordGroup<T extends MediaAssetSummary = MediaAssetSummary> {
  targetId: number;
  label: string;
  assets: T[];
  /** The newest change among its files; groups are ordered by it. */
  newest: string;
}

/**
 * The files of a link view per record. A file linked to two records of the
 * type appears under both; groups follow their most recently changed file.
 */
export function recordGroups<T extends MediaAssetSummary>(assets: readonly T[], targetType: MediaTargetType): RecordGroup<T>[] {
  const groups = new Map<number, RecordGroup<T>>();
  for (const asset of assets) {
    const ids = new Set<number>();
    for (const link of asset.links) {
      if (link.targetType !== targetType || ids.has(link.targetId)) continue;
      ids.add(link.targetId);
      const group = groups.get(link.targetId) ?? { targetId: link.targetId, label: labelOf(link), assets: [], newest: '' };
      group.assets.push(asset);
      if (asset.updatedAt > group.newest) group.newest = asset.updatedAt;
      groups.set(link.targetId, group);
    }
  }
  return [...groups.values()].sort((a, b) => (a.newest < b.newest ? 1 : a.newest > b.newest ? -1 : a.targetId - b.targetId));
}

/* ================================================================ one action list for every surface */

export interface FileActionContext {
  /** The desk shows its inspector as a drawer: "Info" opens it. */
  drawer: boolean;
  phone: boolean;
  /** The place already shows the file's own folder, so "Toon in map" would lead nowhere. */
  inOwnFolder: boolean;
}

/**
 * The actions for one or more files, in menu order. The desk context menu,
 * the phone long-press sheet, the inspector ⋯ and the selection bar all
 * come from here, so the verbs and the rules are the same everywhere.
 */
export function fileActions(
  assets: readonly MediaAssetSummary[],
  place: FilesPlace,
  context: FileActionContext,
): ContextMenuItem[] {
  if (!assets.length) return [];
  const archive = place === 'archive';
  if (assets.length > 1) {
    const zip: ContextMenuItem[] = [
      { id: 'download-zip', label: 'Downloaden', hint: 'zip', iconName: 'download' },
      ...(!archive && assets.some(hasWeb) ? [{ id: 'download-zip-web', label: 'Webformaat', hint: 'zip', iconName: 'image' }] : []),
    ];
    if (archive) {
      return [
        ...zip,
        { id: 'restore', label: 'Terughalen', iconName: 'restore', divider: true },
        { id: 'delete', label: 'Definitief verwijderen…', iconName: 'trash', danger: true },
      ];
    }
    return [
      ...zip,
      { id: 'move', label: 'Verplaatsen…', iconName: 'move', divider: true },
      { id: 'link', label: 'Koppelen aan…', iconName: 'link' },
      { id: 'archive', label: 'Archiveren', iconName: 'archive', divider: true },
    ];
  }
  const asset = assets[0];
  const desk = !context.phone;
  /* One archived file gets the Archief actions wherever it shows. */
  const archivedOne = archive || asset.archived;
  const look: ContextMenuItem = { id: 'quick-look', label: 'Snel bekijken', iconName: 'eye', hint: desk ? '␣' : undefined };
  const download: ContextMenuItem = { id: 'download', label: 'Downloaden', iconName: 'download', hint: sizeLabel(asset.sizeBytes), divider: true };
  const reveal: ContextMenuItem[] = context.inOwnFolder ? [] : [{ id: 'reveal', label: 'Toon in map', iconName: 'folder' }];
  const select: ContextMenuItem[] = context.phone ? [{ id: 'select', label: 'Selecteren', iconName: 'check' }] : [];
  if (archivedOne) {
    const block = deleteBlock(asset, place);
    return [
      look, download, ...reveal, ...select,
      ...(asset.share ? [{ id: 'unshare', label: 'Link intrekken', iconName: 'unlink', divider: true }] : []),
      { id: 'restore', label: 'Terughalen', iconName: 'restore', divider: true },
      {
        id: 'delete', label: 'Definitief verwijderen…', iconName: 'trash', danger: true,
        disabled: block === 'linked', hint: block === 'linked' ? 'Nog gekoppeld' : undefined,
      },
    ];
  }
  return [
    look,
    ...(context.drawer && desk ? [{ id: 'info', label: 'Info', iconName: 'info' }] : []),
    download,
    ...(hasWeb(asset) ? [{ id: 'download-web', label: 'Downloaden als webformaat', iconName: 'image', hint: sizeLabel(asset.web!.sizeBytes) }] : []),
    asset.share
      ? { id: 'copy-link', label: 'Publieke link kopiëren', iconName: 'copy', divider: true }
      : { id: 'share', label: 'Publieke link maken…', iconName: 'globe', divider: true, disabled: !canShare(asset) },
    { id: 'rename', label: 'Hernoemen', iconName: 'pencil', hint: desk ? 'F2' : undefined },
    { id: 'move', label: 'Verplaatsen…', iconName: 'move' },
    { id: 'link', label: 'Koppelen aan…', iconName: 'link', disabled: !canLink(asset) },
    { id: 'version', label: 'Nieuwe versie…', iconName: 'upload', disabled: !canReplace(asset) },
    ...reveal,
    ...select,
    { id: 'archive', label: 'Archiveren', iconName: 'archive', hint: desk ? '⌫' : undefined, divider: true },
  ];
}

/** The actions of a folder: the same list on a row, a tree node and the folder card. */
export function folderActions(): ContextMenuItem[] {
  return [
    { id: 'folder-open', label: 'Openen', iconName: 'folder' },
    { id: 'folder-new', label: 'Nieuwe submap', iconName: 'plus' },
    { id: 'folder-rename', label: 'Hernoemen', iconName: 'pencil' },
    { id: 'folder-move', label: 'Verplaatsen…', iconName: 'move' },
    { id: 'folder-download', label: 'Map downloaden', iconName: 'download' },
    { id: 'folder-delete', label: 'Map verwijderen…', iconName: 'trash', danger: true, divider: true },
  ];
}

/** A right-click on the empty part of the list. */
export function areaActions(context: { folderPlace: boolean; canAdd: boolean; layout: 'list' | 'grid'; hasFiles: boolean }): ContextMenuItem[] {
  return [
    ...(context.folderPlace ? [{ id: 'new-folder', label: 'Nieuwe map', iconName: 'folder' }] : []),
    ...(context.canAdd ? [{ id: 'add', label: 'Bestanden toevoegen…', iconName: 'upload' }] : []),
    { id: 'layout-list', label: 'Lijst', iconName: 'list', checked: context.layout === 'list', divider: true },
    { id: 'layout-grid', label: 'Raster', iconName: 'grid', checked: context.layout === 'grid' },
    { id: 'download-all', label: 'Alles downloaden', iconName: 'download', divider: true, disabled: !context.hasFiles },
  ];
}

/** One summary for a bulk run: "12 gearchiveerd, 2 mislukt: reden". */
export function bulkSummary(verb: string, done: number, failed: number, reason: string | null): string {
  const base = `${done} ${verb}`;
  return failed ? `${base}, ${failed} mislukt${reason ? ': ' + reason : ''}` : base;
}
