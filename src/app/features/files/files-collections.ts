/**
 * The places of Documenten & media and the words for them: one reader for
 * the address bar (the page and the workspace navigation both use it), the
 * record lens "Gekoppeld aan", where a linked record lives in the ERP, and
 * how a file type reads. Pure and import-free (types only): node-tested,
 * and small enough for the eager workspace navigation.
 */
import type { MediaAssetLink, MediaAssetSummary, MediaKind, MediaTargetType } from '../../core/api/media-models';

/* ================================================================ the record lens */

export type LinkViewKey = 'product' | 'family' | 'purchase' | 'cost' | 'planner' | 'unused';

/** A route inside the ERP: router commands plus optional query parameters. */
export interface RecordRoute {
  link: readonly (string | number)[];
  query: Record<string, string | number> | null;
}

/** One view of "Gekoppeld aan": every file linked to a record of one type. */
export interface LinkView {
  key: LinkViewKey;
  label: string;
  /** The word under the icon in the 88px rail. */
  railLabel: string;
  hint: string;
  iconName: string;
  tone: string;
  /** The record type the view lists; null for Niet gekoppeld. */
  targetType: MediaTargetType | null;
  /** false lists files nothing uses (Niet gekoppeld). */
  linked: boolean | null;
  /**
   * Cost and purchase documents. With isSensitive and costTargetMeta this is
   * one of the three single places a customer-safe mode would gate.
   */
  sensitive: boolean;
  /** Planner attachments are added in the planner, never here. */
  canUpload: boolean;
  emptyTitle: string;
  emptyText: string;
  /** Where the records themselves are managed, for the empty state and the inspector. */
  area: { label: string; route: RecordRoute } | null;
}

export const LINK_VIEWS: readonly LinkView[] = [
  {
    key: 'product', label: 'Producten', railLabel: 'Product', hint: 'Foto’s en documenten per product',
    iconName: 'products', tone: 'tone-accent', targetType: 'PRODUCT', linked: null, sensitive: false, canUpload: true,
    emptyTitle: 'Nog geen productbestanden',
    emptyText: 'Foto’s en documenten die je bij een product zet, verschijnen hier per product.',
    area: { label: 'Naar Producten', route: { link: ['/products'], query: null } },
  },
  {
    key: 'family', label: 'Reeksen & website', railLabel: 'Reeks', hint: 'Per productreeks',
    iconName: 'layers', tone: 'tone-accent', targetType: 'PRODUCT_FAMILY', linked: null, sensitive: false, canUpload: true,
    emptyTitle: 'Nog geen reeksfoto’s',
    emptyText: 'Foto’s die bij een productreeks horen, verschijnen hier per reeks.',
    area: { label: 'Naar Website › Producten', route: { link: ['/website/products'], query: null } },
  },
  {
    key: 'purchase', label: 'Inkooporders', railLabel: 'Inkoop', hint: 'Dossierstukken per container',
    iconName: 'purchase', tone: 'tone-blue', targetType: 'PURCHASE_ORDER', linked: null, sensitive: true, canUpload: true,
    emptyTitle: 'Nog geen inkoopdocumenten',
    emptyText: 'Documenten uit inkoopdossiers verschijnen hier per order.',
    area: { label: 'Naar Inkoop', route: { link: ['/purchasing'], query: null } },
  },
  {
    key: 'cost', label: 'Kosten', railLabel: 'Kosten', hint: 'Facturen en tickets per kost',
    iconName: 'receipt', tone: 'tone-teal', targetType: 'COMPANY_COST', linked: null, sensitive: true, canUpload: true,
    emptyTitle: 'Nog geen kostendocumenten',
    emptyText: 'Zet de factuur of het ticket bij de kost in Kosten & bank.',
    area: { label: 'Naar Kosten & bank', route: { link: ['/costs'], query: { view: 'costs' } } },
  },
  {
    key: 'planner', label: 'Planner', railLabel: 'Planner', hint: 'Bijlagen per planneritem',
    iconName: 'calendar', tone: 'tone-amber', targetType: 'PLANNER_ITEM', linked: null, sensitive: false, canUpload: false,
    emptyTitle: 'Nog geen planner-bijlagen',
    emptyText: 'Bijlagen die je in de planner toevoegt, verschijnen hier per planneritem.',
    area: null,
  },
  {
    key: 'unused', label: 'Niet gekoppeld', railLabel: 'Los', hint: 'Hangt nergens aan',
    iconName: 'unlink', tone: 'tone-grey', targetType: null, linked: false, sensitive: false, canUpload: true,
    emptyTitle: 'Alles hangt ergens aan',
    emptyText: 'Elk bestand is aan een product, reeks, order, kost of planneritem gekoppeld.',
    area: null,
  },
];

/**
 * Views that no longer exist. Nothing ever set the QUOTE or INVOICE roles,
 * so old bookmarks land on Recent. Re-add a LINK_VIEWS entry if the backend
 * starts writing those roles.
 */
export const LEGACY_VIEWS: Readonly<Record<string, 'all'>> = { quote: 'all', invoice: 'all' };

/** Views that can narrow to one record with doel=. */
const RECORD_VIEWS: ReadonlySet<string> = new Set(['product', 'family', 'purchase', 'cost', 'planner']);

export function linkView(key: string | null | undefined): LinkView | null {
  return LINK_VIEWS.find((view) => view.key === key) ?? null;
}

export function linkViewFor(type: MediaTargetType): LinkView | null {
  return LINK_VIEWS.find((view) => view.targetType === type) ?? null;
}

/* ================================================================ the address bar */

export type FilesPlace = 'folders' | 'recent' | 'view' | 'archive';

/**
 * Where the workspace stands. Places (folders, Recent, a link view, Archief)
 * build history; kind, q and bestand only modify what the place shows.
 */
export interface FilesLocation {
  place: FilesPlace;
  /** The open folder; 'root' is Mappen itself (top folders plus the files without a folder). */
  folderId: number | 'root';
  view: LinkViewKey | null;
  /** doel: one record of the view's type. */
  targetId: number | null;
  kind: MediaKind | null;
  query: string | null;
  /** bestand: the file on show. */
  fileId: number | null;
  /** The address used a retired view; the page rewrites it to Recent. */
  redirected: boolean;
}

export const FILES_HOME: FilesLocation = {
  place: 'folders', folderId: 'root', view: null, targetId: null, kind: null, query: null, fileId: null, redirected: false,
};

function positiveInt(value: string | null): number | null {
  if (value === null || !/^\d{1,15}$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/**
 * Reads the query parameters: archief=1 is Archief; view=<key> a link view
 * (doel only with a record view); view=all Recent, as are retired views;
 * map=<id> a folder; nothing is Mappen. A view makes map meaningless.
 */
export function parseFilesLocation(get: (key: string) => string | null): FilesLocation {
  const kindParam = get('kind');
  const kind: MediaKind | null = kindParam === 'IMAGE' || kindParam === 'DOCUMENT' ? kindParam : null;
  const query = (get('q') ?? '').trim() || null;
  const base = { kind, query, fileId: positiveInt(get('bestand')), folderId: 'root' as const, redirected: false };
  if (get('archief') === '1') return { ...base, place: 'archive', view: null, targetId: null };
  const view = get('view');
  if (view !== null) {
    const known = linkView(view);
    if (known) {
      return { ...base, place: 'view', view: known.key, targetId: RECORD_VIEWS.has(known.key) ? positiveInt(get('doel')) : null };
    }
    return { ...base, place: 'recent', view: null, targetId: null, redirected: view !== 'all' };
  }
  const map = positiveInt(get('map'));
  return { ...base, place: 'folders', folderId: map ?? 'root', view: null, targetId: null };
}

/** The query parameters of a location; parseFilesLocation reads them back unchanged. */
export function filesQueryParams(location: FilesLocation): Record<string, string> {
  const params: Record<string, string> = {};
  if (location.place === 'archive') {
    params['view'] = 'all';
    params['archief'] = '1';
  } else if (location.place === 'recent') {
    params['view'] = 'all';
  } else if (location.place === 'view' && location.view) {
    params['view'] = location.view;
    if (location.targetId !== null && RECORD_VIEWS.has(location.view)) params['doel'] = String(location.targetId);
  } else if (location.place === 'folders' && location.folderId !== 'root') {
    params['map'] = String(location.folderId);
  }
  if (location.kind) params['kind'] = location.kind;
  if (location.query) params['q'] = location.query;
  if (location.fileId !== null) params['bestand'] = String(location.fileId);
  return params;
}

/** The entry of the workspace navigation that a location lights up. */
export function navSection(location: FilesLocation): 'recent' | 'folders' | 'archive' | LinkViewKey {
  if (location.place === 'archive') return 'archive';
  if (location.place === 'recent') return 'recent';
  if (location.place === 'view' && location.view) return location.view;
  return 'folders';
}

/** The folder the navigation tree highlights, if any. */
export function navFolderId(location: FilesLocation): number | null {
  return location.place === 'folders' && location.folderId !== 'root' ? location.folderId : null;
}

/**
 * What changed between two locations, the biggest step first: another place
 * (or folder, or record) reloads everything, a filter reloads the list and
 * keeps the open file, a file alone opens or closes that file.
 */
export function locationChange(previous: FilesLocation, next: FilesLocation): 'place' | 'filter' | 'file' | 'none' {
  if (previous.place !== next.place || previous.folderId !== next.folderId
    || previous.view !== next.view || previous.targetId !== next.targetId) return 'place';
  if (previous.kind !== next.kind || previous.query !== next.query) return 'filter';
  if (previous.fileId !== next.fileId) return 'file';
  return 'none';
}

/* ================================================================ linked records */

type LinkTarget = Pick<MediaAssetLink, 'targetType' | 'targetId'>;

const TARGET_LABELS: Record<MediaTargetType, string> = {
  PRODUCT: 'Product',
  PRODUCT_FAMILY: 'Productreeks',
  PURCHASE_ORDER: 'Inkooporder',
  COMPANY_COST: 'Kost',
  PLANNER_ITEM: 'Planner',
};

export function targetLabel(type: MediaTargetType): string {
  return TARGET_LABELS[type] ?? 'Record';
}

export function targetIconName(type: MediaTargetType): string {
  switch (type) {
    case 'PRODUCT': return 'products';
    case 'PRODUCT_FAMILY': return 'layers';
    case 'PURCHASE_ORDER': return 'purchase';
    case 'COMPANY_COST': return 'receipt';
    default: return 'calendar';
  }
}

/** The shared record-type tones: Product and Reeks accent, Inkooporder blue, Kost teal, Planner amber. */
export function targetTone(type: MediaTargetType): string {
  switch (type) {
    case 'PURCHASE_ORDER': return 'tone-blue';
    case 'COMPANY_COST': return 'tone-teal';
    case 'PLANNER_ITEM': return 'tone-amber';
    default: return 'tone-accent';
  }
}

/** The label of a link, with '{Type} #{id}' for records the indexer did not name. */
export function linkLabel(link: LinkTarget & { targetLabel: string | null }): string {
  return link.targetLabel || `${targetLabel(link.targetType)} #${link.targetId}`;
}

/** Where a linked record opens. There is no planner route, so planner items stay plain text. */
export function targetRoute(link: LinkTarget): RecordRoute | null {
  switch (link.targetType) {
    case 'PRODUCT': return { link: ['/products', link.targetId], query: null };
    case 'PURCHASE_ORDER': return { link: ['/purchasing', link.targetId], query: null };
    case 'COMPANY_COST': return { link: ['/costs'], query: { view: 'costs', cost: link.targetId } };
    case 'PRODUCT_FAMILY': return { link: ['/files'], query: { view: 'family', doel: link.targetId } };
    default: return null;
  }
}

/**
 * Whether a record route leads out of Documenten & media. A reeks has no
 * page of its own: its route is this workspace's own view narrowed to it,
 * so an "Openen" beside that view would go nowhere.
 */
export function leavesFiles(route: RecordRoute | null): route is RecordRoute {
  return !!route && route.link[0] !== '/files';
}

/** The words on the button that opens a record from the record strip. */
export function recordOpenLabel(type: MediaTargetType): string {
  switch (type) {
    case 'PRODUCT': return 'Product openen';
    case 'PURCHASE_ORDER': return 'Inkooporder openen';
    case 'COMPANY_COST': return 'Openen in Kosten & bank';
    case 'PRODUCT_FAMILY': return 'Reeks openen';
    default: return 'Openen';
  }
}

/** Where a link that came from a source record is managed. */
export function sourceRoute(link: LinkTarget): RecordRoute | null {
  switch (link.targetType) {
    case 'PRODUCT': return { link: ['/products', link.targetId, 'edit'], query: null };
    case 'PRODUCT_FAMILY': return { link: ['/website/products'], query: null };
    case 'PURCHASE_ORDER': return { link: ['/purchasing', link.targetId], query: null };
    default: return null;
  }
}

/**
 * A link the legacy indexer adopted from a source record (product photos,
 * reeks photos, purchase documents, planner attachments). Only the indexer
 * writes 'system'; hand-made links carry the username. The library cannot
 * remove these: the source can.
 */
export function isSourceLink(link: Pick<MediaAssetLink, 'createdBy'>): boolean {
  return link.createdBy === 'system';
}

export function sourceCaption(link: Pick<MediaAssetLink, 'targetType'>): string {
  switch (link.targetType) {
    case 'PRODUCT': return 'productfoto uit de producteditor';
    case 'PRODUCT_FAMILY': return 'reeksfoto (website)';
    case 'PURCHASE_ORDER': return 'via inkoopdossier';
    case 'PLANNER_ITEM': return 'bijlage uit de planner';
    default: return targetLabel(link.targetType);
  }
}

/* ================================================================ file types */

type FileLike = Pick<MediaAssetSummary, 'name' | 'originalFilename' | 'contentType' | 'kind'>;

/** The lower-case extension of the original file, or of the content type as a fallback. */
export function fileExtension(file: Pick<FileLike, 'name' | 'originalFilename' | 'contentType'>): string {
  const name = file.originalFilename || file.name || '';
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) return name.slice(dot + 1).toLowerCase();
  const type = (file.contentType || '').toLowerCase();
  if (type === 'application/pdf') return 'pdf';
  if (type === 'image/jpeg') return 'jpg';
  if (type.startsWith('image/')) return type.slice(6).replace(/\+.*$/, '');
  return '';
}

export type ExtensionTone = 'pdf' | 'sheet' | 'doc' | 'archive' | 'other';

export function extensionTone(file: Pick<FileLike, 'name' | 'originalFilename' | 'contentType'>): ExtensionTone {
  const extension = fileExtension(file);
  if (extension === 'pdf') return 'pdf';
  if (['xls', 'xlsx', 'xlsm', 'csv', 'numbers', 'ods'].includes(extension)) return 'sheet';
  if (['doc', 'docx', 'rtf', 'odt', 'pages', 'txt'].includes(extension)) return 'doc';
  if (['zip', 'rar', '7z', 'gz', 'tar'].includes(extension)) return 'archive';
  return 'other';
}

/** The tone class of an extension badge: PDF red, sheets green, text blue, the rest grey. */
export function extensionToneClass(file: Pick<FileLike, 'name' | 'originalFilename' | 'contentType'>): string {
  switch (extensionTone(file)) {
    case 'pdf': return 'tone-danger';
    case 'sheet': return 'tone-green';
    case 'doc': return 'tone-blue';
    default: return 'tone-grey';
  }
}

/** The short text on a badge: "PDF", "XLSX", "DOC" when nothing is known. */
export function badgeText(file: Pick<FileLike, 'name' | 'originalFilename' | 'contentType'>): string {
  return (fileExtension(file) || 'doc').slice(0, 4).toUpperCase();
}

/** The long type: "PDF-document", "JPEG-afbeelding", "Excel-werkblad"… */
export function fileKindLabel(file: FileLike): string {
  const extension = fileExtension(file);
  if (extension === 'pdf') return 'PDF-document';
  if (extension === 'jpg' || extension === 'jpeg') return 'JPEG-afbeelding';
  if (extension === 'png') return 'PNG-afbeelding';
  if (['xls', 'xlsx', 'xlsm', 'csv'].includes(extension)) return 'Excel-werkblad';
  if (extension === 'doc' || extension === 'docx') return 'Word-document';
  if (extension === 'zip') return 'ZIP-archief';
  return file.kind === 'IMAGE' ? 'Afbeelding' : 'Document';
}

/** The chip on the inspector: "Foto · JPG", "Document · PDF". */
export function fileKindChip(file: FileLike): string {
  const kind = file.kind === 'IMAGE' ? 'Foto' : 'Document';
  const extension = fileExtension(file);
  return extension ? `${kind} · ${extension.slice(0, 4).toUpperCase()}` : kind;
}

/* ================================================================ dates and sorting */

const MONTHS = ['Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni', 'Juli', 'Augustus',
  'September', 'Oktober', 'November', 'December'];

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * The section a change date falls in, seen from now (local time, weeks from
 * Monday): Vandaag, Gisteren, Eerder deze week, Eerder deze maand, then the
 * month and year ("Augustus 2026").
 */
export function dateGroupLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Eerder';
  const day = startOfDay(date);
  const today = startOfDay(now);
  if (day >= today) return 'Vandaag';
  const yesterday = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  if (day >= yesterday) return 'Gisteren';
  const weekday = (now.getDay() + 6) % 7;
  const monday = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekday));
  if (day >= monday) return 'Eerder deze week';
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) return 'Eerder deze maand';
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export type SortKey = 'updated' | 'name' | 'size' | 'links' | 'folder' | 'by';
export type SortDir = 'asc' | 'desc';
export interface FilesSort { key: SortKey; dir: SortDir; }

/** The columns a list can sort on, with the direction a first click picks. */
export const SORT_KEYS: readonly { key: SortKey; label: string; firstDir: SortDir }[] = [
  { key: 'updated', label: 'Gewijzigd', firstDir: 'desc' },
  { key: 'name', label: 'Naam', firstDir: 'asc' },
  { key: 'size', label: 'Grootte', firstDir: 'desc' },
  { key: 'links', label: 'Gebruikt bij', firstDir: 'desc' },
  { key: 'folder', label: 'Map', firstDir: 'asc' },
  { key: 'by', label: 'Door', firstDir: 'asc' },
];

/** The phone's sort sheet: the same keys, spelled as choices. */
export const PHONE_SORTS: readonly { id: string; label: string; key: SortKey; dir: SortDir }[] = [
  { id: 'updated-desc', label: 'Nieuwste eerst', key: 'updated', dir: 'desc' },
  { id: 'updated-asc', label: 'Oudste eerst', key: 'updated', dir: 'asc' },
  { id: 'name-asc', label: 'Naam A–Z', key: 'name', dir: 'asc' },
  { id: 'name-desc', label: 'Naam Z–A', key: 'name', dir: 'desc' },
  { id: 'size-desc', label: 'Grootste eerst', key: 'size', dir: 'desc' },
  { id: 'links-desc', label: 'Meest gebruikt', key: 'links', dir: 'desc' },
];

export const DEFAULT_SORT: FilesSort = { key: 'updated', dir: 'desc' };

/** A stored sort, or the default when it is missing or no longer known. */
export function parseSort(raw: string | null): FilesSort {
  if (!raw) return DEFAULT_SORT;
  try {
    const value = JSON.parse(raw) as Partial<FilesSort> | null;
    const key = SORT_KEYS.find((option) => option.key === value?.key)?.key;
    const dir = value?.dir === 'asc' || value?.dir === 'desc' ? value.dir : null;
    return key && dir ? { key, dir } : DEFAULT_SORT;
  } catch {
    return DEFAULT_SORT;
  }
}

/** A click on a column: the same column turns around, another starts in its natural direction. */
export function toggleSort(current: FilesSort, key: SortKey): FilesSort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: SORT_KEYS.find((option) => option.key === key)?.firstDir ?? 'asc' };
}

/** Date sections only make sense in the server's own order: newest change first. */
export function datesGroupable(sort: FilesSort): boolean {
  return sort.key === 'updated' && sort.dir === 'desc';
}

/** Files in date sections, in the order given; the sections follow their first file. */
export function groupByDate<T extends { updatedAt: string }>(assets: readonly T[], now: Date): { label: string; assets: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const asset of assets) {
    const label = dateGroupLabel(asset.updatedAt, now);
    const list = groups.get(label) ?? [];
    list.push(asset);
    groups.set(label, list);
  }
  return [...groups].map(([label, list]) => ({ label, assets: list }));
}
