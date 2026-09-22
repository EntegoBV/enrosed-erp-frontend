import type {
  CatalogChannel,
  PhotoDto,
  ProductFamilyMember,
  ProductPhotoChoice,
  ProductPhotoOverview,
  ProductPhotoOverviewPhoto,
  ProductPhotoRoleKey,
  ProductPhotoVisibility,
} from '../../core/api/models';

/*
 * The rules behind the product photo section. The server resolves every
 * effective choice (Hoofdfoto, offerte, catalogus); these helpers only decide
 * what the screen offers and how it says it. They import types only, so the
 * node tests can load this file as it is.
 */

/** The order of the rows in "Waar staat welke foto?" and of the toggles in the photo sheet. */
export const PHOTO_ROLE_ORDER: readonly ProductPhotoRoleKey[] = [
  'MAIN', 'QUOTE', 'CATALOGUE_VARIANT', 'CATALOGUE_OVERVIEW', 'CATALOGUE_DETAIL',
];

/** Where choosing a photo for a role also publishes it. */
export type PhotoPublishTarget = 'website' | 'catalogue';

export interface PhotoGroup {
  key: string;
  label: string;
  photos: ProductPhotoOverviewPhoto[];
}

export const PHOTO_UPLOAD_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
export const MAX_PHOTO_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Stable channel order, the same the family gallery always sent. */
const CHANNELS: ReadonlyArray<{ channel: CatalogChannel; flag: keyof ProductPhotoVisibility }> = [
  { channel: 'WEBSITE', flag: 'website' },
  { channel: 'ORDER_APP', flag: 'orderApp' },
  { channel: 'CATALOGUE', flag: 'catalogue' },
];

/* ------------------------------------------------------------- photo keys */

/** Signed ids of the website and catalogue world: positive = series photo, negative = own photo. */
export function photoKeyForSignedId(id: number | null | undefined): string | null {
  if (id === null || id === undefined || !Number.isSafeInteger(id) || id === 0) return null;
  return id > 0 ? `F${id}` : `P${-id}`;
}

export function signedIdForPhotoKey(key: string | null | undefined): number | null {
  const match = /^([FP])(\d+)$/.exec(key ?? '');
  if (!match) return null;
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return match[1] === 'F' ? id : -id;
}

/** The overview key of a Product.photos row: an inherited projection answers for its series photo. */
export function photoKeyForProductPhoto(photo: Pick<PhotoDto, 'id' | 'familyPhotoId'>): string {
  return photo.familyPhotoId === null || photo.familyPhotoId === undefined
    ? `P${photo.id}`
    : `F${photo.familyPhotoId}`;
}

/* ------------------------------------------------------------------ roles */

export function roleChoice(
  overview: ProductPhotoOverview | null,
  role: ProductPhotoRoleKey,
): ProductPhotoChoice | null {
  if (!overview) return null;
  switch (role) {
    case 'MAIN': return overview.main;
    case 'QUOTE': return overview.quote;
    case 'CATALOGUE_VARIANT': return overview.catalogueVariant;
    case 'CATALOGUE_OVERVIEW': return overview.catalogueOverview;
    case 'CATALOGUE_DETAIL': return overview.catalogueDetail;
  }
}

/**
 * Where choosing this photo for the role also makes it public. The server
 * publishes a series photo to the role's channel first. The per-colour leads
 * go further: the public gallery always shows a colour's lead, so an own
 * photo chosen as Hoofdfoto appears on the website and one chosen as
 * "Catalogus · <kleur>" in the catalogue. The series-wide catalogue choices
 * and the offerte photo never publish an own photo.
 */
export function publishTargetForRole(
  photo: ProductPhotoOverviewPhoto,
  role: ProductPhotoRoleKey,
): PhotoPublishTarget | null {
  const series = photo.kind === 'SERIES';
  if ((role === 'MAIN' || (role === 'QUOTE' && series)) && !photo.visibility.website) return 'website';
  const catalogue = role === 'CATALOGUE_VARIANT'
    || (series && (role === 'CATALOGUE_OVERVIEW' || role === 'CATALOGUE_DETAIL'));
  if (catalogue && !photo.visibility.catalogue) return 'catalogue';
  return null;
}

/**
 * The photos a role may use. Per-colour roles need a photo this colour really
 * shows; the offerte page only receives website photos; a series photo that
 * cannot be published (no valid colour, no renditions) cannot be promised.
 * An own photo needs no publication step: the lead itself makes it public.
 */
export function canUseForRole(photo: ProductPhotoOverviewPhoto, role: ProductPhotoRoleKey): boolean {
  const shownHere = photo.kind === 'OWN' || photo.scope !== 'OTHER_VARIANT';
  let allowed: boolean;
  switch (role) {
    case 'MAIN':
    case 'CATALOGUE_VARIANT':
      allowed = shownHere;
      break;
    case 'QUOTE':
      allowed = photo.kind === 'SERIES' || photo.visibility.website;
      break;
    case 'CATALOGUE_OVERVIEW':
    case 'CATALOGUE_DETAIL':
      allowed = true;
      break;
  }
  return allowed && (photo.kind === 'OWN' || publishTargetForRole(photo, role) === null || photo.publishable);
}

export function roleCandidates(
  overview: ProductPhotoOverview | null,
  role: ProductPhotoRoleKey,
): ProductPhotoOverviewPhoto[] {
  return (overview?.photos ?? []).filter((photo) => canUseForRole(photo, role));
}

/** What a row in "Waar staat welke foto?" says about its role. */
export type PhotoRoleStatus = 'explicit' | 'automatic' | 'none';

/**
 * The catalogue picks its automatic photos only while it is being made, so
 * the overview names none for the three catalogue roles. They are still
 * automatic, not empty, as long as a photo could be picked.
 */
export function roleStatus(overview: ProductPhotoOverview | null, role: ProductPhotoRoleKey): PhotoRoleStatus {
  const choice = roleChoice(overview, role);
  if (choice) return choice.explicit ? 'explicit' : 'automatic';
  const catalogue = role === 'CATALOGUE_VARIANT' || role === 'CATALOGUE_OVERVIEW' || role === 'CATALOGUE_DETAIL';
  return catalogue && roleCandidates(overview, role).length ? 'automatic' : 'none';
}

/**
 * Without an explicit choice the Hoofdfoto is this colour's first website
 * photo, while quotes, invoices and ERP lists fall back to the product's
 * first series photo (shared/sales-photo.ts, the server's
 * photoForSalesDocument), which may not be online. Right after adding such a
 * photo the two differ; the owner must see that and can pin one to align them.
 */
export function mainDiffersFromDocuments(
  overview: ProductPhotoOverview | null,
  documentPhoto: Pick<PhotoDto, 'id' | 'familyPhotoId'> | null,
): boolean {
  const main = overview?.main;
  return !!main && !main.explicit && !!documentPhoto && photoKeyForProductPhoto(documentPhoto) !== main.key;
}

/** The "Gebruik als" toggles a photo sheet offers. */
export function rolesForPhoto(photo: ProductPhotoOverviewPhoto): ProductPhotoRoleKey[] {
  return PHOTO_ROLE_ORDER.filter((role) => canUseForRole(photo, role));
}

export function roleTitle(role: ProductPhotoRoleKey, colour: string): string {
  switch (role) {
    case 'MAIN': return `Hoofdfoto · ${colour}`;
    case 'QUOTE': return 'Vraag een offerte';
    case 'CATALOGUE_VARIANT': return `Catalogus · ${colour}`;
    case 'CATALOGUE_OVERVIEW': return 'Catalogus · overzicht';
    case 'CATALOGUE_DETAIL': return 'Catalogus · grote foto';
  }
}

export function roleExplanation(role: ProductPhotoRoleKey): string {
  switch (role) {
    case 'MAIN': return 'Eerste foto op de website, op offertes en facturen.';
    case 'QUOTE': return 'Deze foto ziet de klant bij het aanvragen van een offerte. Geldt voor de hele reeks.';
    case 'CATALOGUE_VARIANT': return 'Kleurfoto in de gedrukte catalogus.';
    case 'CATALOGUE_OVERVIEW': return 'Foto in het assortimentsoverzicht van de catalogus. Hele reeks.';
    case 'CATALOGUE_DETAIL': return 'Grote foto op de productpagina van de catalogus. Hele reeks.';
  }
}

/** Short label for the toggle buttons in the photo sheet. */
export function roleToggleLabel(role: ProductPhotoRoleKey, colour: string): string {
  switch (role) {
    case 'MAIN': return `Hoofdfoto ${colour}`;
    case 'QUOTE': return 'Vraag een offerte';
    case 'CATALOGUE_VARIANT': return `Catalogus ${colour}`;
    case 'CATALOGUE_OVERVIEW': return 'Catalogus overzicht';
    case 'CATALOGUE_DETAIL': return 'Catalogus grote foto';
  }
}

export function roleSavedMessage(
  role: ProductPhotoRoleKey,
  colour: string,
  cleared: boolean,
  published: PhotoPublishTarget | null = null,
): string {
  if (cleared) return `${roleTitle(role, colour)} kiest weer automatisch`;
  const suffix = published === 'website' ? ' · staat nu ook op de website'
    : published === 'catalogue' ? ' · staat nu ook in de catalogus' : '';
  return `${roleTitle(role, colour)} gekozen${suffix}`;
}

/** The small role badges on a tile: only the two that matter to a customer. */
export function tileRoleBadges(photo: ProductPhotoOverviewPhoto): string[] {
  return [
    ...(photo.roles.includes('MAIN') ? ['Hoofdfoto'] : []),
    ...(photo.roles.includes('QUOTE') ? ['Offerte'] : []),
  ];
}

/* --------------------------------------------------------- scope and copy */

/**
 * The colour name used in titles. A colour shared by two sizes in the same
 * series would be ambiguous ("Alleen Rood"), so the size joins it then.
 */
export function variantShortLabel(
  product: { id: number | null; colour: string | null; variantSize: string | null },
  members: readonly Pick<ProductFamilyMember, 'productId' | 'colour'>[] = [],
  fallback: string | null = null,
): string {
  const colour = product.colour?.trim();
  const size = product.variantSize?.trim();
  if (colour) {
    const shared = members.some((member) => member.productId !== product.id
      && member.colour?.trim().toLocaleLowerCase('nl') === colour.toLocaleLowerCase('nl'));
    return shared && size ? `${colour} · ${size}` : colour;
  }
  return size || fallback?.trim() || 'deze kleur';
}

export function photoScopeLabel(photo: ProductPhotoOverviewPhoto, colour: string): string {
  if (photo.kind === 'OWN') return 'Losse foto';
  if (photo.scope === 'ALL_VARIANTS') return 'Alle kleuren';
  if (photo.scope === 'THIS_VARIANT') return `Alleen ${colour}`;
  return `Alleen ${photo.variantLabel?.trim() || 'andere kleur'}`;
}

/** Why a photo is (not) on the website, in words; the fallback case used to surprise everyone. */
export function websiteReasonText(photo: ProductPhotoOverviewPhoto): string {
  switch (photo.websiteReason) {
    case 'PUBLISHED': return 'Staat op de website.';
    case 'LEAD': return 'Staat op de website omdat hij de hoofdfoto van deze kleur is.';
    case 'FALLBACK': return 'Staat op de website omdat deze kleur nog geen reeksfoto online heeft.';
    default: return 'Staat niet op de website.';
  }
}

export function photoTileLabel(
  photo: ProductPhotoOverviewPhoto,
  colour: string,
  index: number,
  total: number,
): string {
  return [
    `Foto ${index + 1} van ${total}`,
    photo.kind === 'OWN' ? 'Losse productfoto' : 'Reeksfoto',
    photoScopeLabel(photo, colour),
    ...tileRoleBadges(photo),
    photo.visibility.website ? 'op de website' : 'niet op de website',
    ...(photo.visibility.catalogue ? ['in de catalogus'] : []),
    ...(photo.duplicateOfKey ? ['dubbele foto'] : []),
  ].join(' · ');
}

/* ------------------------------------------------------------ grid views */

/** "Deze kleur": own photos plus the series photos this colour shows, in the server's order. */
export function colourPhotos(overview: ProductPhotoOverview | null): ProductPhotoOverviewPhoto[] {
  return (overview?.photos ?? []).filter((photo) => photo.kind === 'OWN' || photo.scope !== 'OTHER_VARIANT');
}

/** "Hele reeks": this colour, then the shared photos, then every other colour in variant order. */
export function seriesPhotoGroups(
  overview: ProductPhotoOverview | null,
  colour: string,
  members: readonly Pick<ProductFamilyMember, 'productId' | 'position'>[] = [],
): PhotoGroup[] {
  const photos = overview?.photos ?? [];
  const groups: PhotoGroup[] = [];
  const here = photos.filter((photo) => photo.kind === 'OWN' || photo.scope === 'THIS_VARIANT');
  if (here.length) groups.push({ key: 'this', label: `${colour} · deze kleur`, photos: here });
  const shared = photos.filter((photo) => photo.kind === 'SERIES' && photo.scope === 'ALL_VARIANTS');
  if (shared.length) groups.push({ key: 'all', label: 'Alle kleuren', photos: shared });

  const others = new Map<string, PhotoGroup & { variantProductId: number | null }>();
  for (const photo of photos) {
    if (photo.kind !== 'SERIES' || photo.scope !== 'OTHER_VARIANT') continue;
    const key = photo.variantProductId === null ? `label:${photo.variantLabel ?? ''}` : `v${photo.variantProductId}`;
    let group = others.get(key);
    if (!group) {
      group = { key, label: photo.variantLabel?.trim() || 'Andere kleur', photos: [], variantProductId: photo.variantProductId };
      others.set(key, group);
    }
    group.photos.push(photo);
  }
  const position = new Map(members.map((member) => [member.productId, member.position]));
  const rank = (id: number | null) => (id === null ? undefined : position.get(id)) ?? Number.MAX_SAFE_INTEGER;
  const ordered = [...others.values()].sort((left, right) => rank(left.variantProductId) - rank(right.variantProductId));
  return [...groups, ...ordered.map(({ key, label, photos: items }) => ({ key, label, photos: items }))];
}

/** Series photos in their family order: the list the "Volgorde" mode rearranges. */
export function seriesInFamilyOrder(overview: ProductPhotoOverview | null): ProductPhotoOverviewPhoto[] {
  return (overview?.photos ?? [])
    .filter((photo) => photo.kind === 'SERIES' && photo.familyPhotoId !== null)
    .sort((left, right) => (left.familyPosition ?? Number.MAX_SAFE_INTEGER) - (right.familyPosition ?? Number.MAX_SAFE_INTEGER));
}

/* ---------------------------------------------------------------- reorder */

export function movedOrder<T>(items: readonly T[], from: number, to: number): T[] | null {
  const target = Math.max(0, Math.min(to, items.length - 1));
  if (from < 0 || from >= items.length || from === target) return null;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/**
 * The family order endpoint wants every image exactly once. Images the
 * overview does not list (for instance of an inactive colour) keep their slot;
 * the listed ones take the new order in the slots they occupied.
 */
export function familyOrderWith(allIds: readonly number[], visibleOrder: readonly number[]): number[] {
  const known = new Set(allIds);
  const queue = visibleOrder.filter((id, index) => known.has(id) && visibleOrder.indexOf(id) === index);
  const moving = new Set(queue);
  return allIds.map((id) => (moving.has(id) ? queue.shift()! : id));
}

/* --------------------------------------------------------------- channels */

export function visibleChannels(visibility: ProductPhotoVisibility): CatalogChannel[] {
  return CHANNELS.filter((item) => visibility[item.flag]).map((item) => item.channel);
}

/**
 * The channels the "Zichtbaar op" switches start from: the series photo's
 * stored selection when the server sends it, otherwise what is visible.
 * Starting from the stored list means toggling one switch never drops a
 * channel that is selected but not visible right now.
 */
export function selectedChannels(
  photo: Pick<ProductPhotoOverviewPhoto, 'visibility' | 'publishedChannels'>,
): CatalogChannel[] {
  const stored = photo.publishedChannels;
  if (!Array.isArray(stored)) return visibleChannels(photo.visibility);
  return CHANNELS.map((item) => item.channel).filter((channel) => stored.includes(channel));
}

export function toggledChannels(
  photo: Pick<ProductPhotoOverviewPhoto, 'visibility' | 'publishedChannels'>,
  channel: CatalogChannel,
): CatalogChannel[] {
  const selected = new Set(selectedChannels(photo));
  if (selected.has(channel)) selected.delete(channel); else selected.add(channel);
  return CHANNELS.map((item) => item.channel).filter((item) => selected.has(item));
}

/**
 * Cleaning a duplicate reuses the series photo. Keep its reach: a photo of
 * this colour stays with this colour; a shared photo or one of another colour
 * becomes shared, so no colour loses a photo it showed.
 */
export function cleanupScope(
  overview: ProductPhotoOverview | null,
  photo: ProductPhotoOverviewPhoto,
): 'THIS_VARIANT' | 'ALL_VARIANTS' {
  const original = overview?.photos.find((item) => item.key === photo.duplicateOfKey);
  return original && original.scope !== 'THIS_VARIANT' ? 'ALL_VARIANTS' : 'THIS_VARIANT';
}

/* ----------------------------------------------------------------- upload */

export function splitPhotoFiles<T extends { type: string; size: number }>(
  files: readonly T[],
): { accepted: T[]; skipped: string | null } {
  let invalid = 0;
  let tooLarge = 0;
  const accepted: T[] = [];
  for (const file of files) {
    if (!PHOTO_UPLOAD_TYPES.includes(file.type.toLowerCase()) || file.size === 0) invalid++;
    else if (file.size > MAX_PHOTO_UPLOAD_BYTES) tooLarge++;
    else accepted.push(file);
  }
  const problems = [
    invalid ? `${invalid} ${invalid === 1 ? 'bestand is geen foto' : 'bestanden zijn geen foto'}` : '',
    tooLarge ? `${tooLarge} ${tooLarge === 1 ? 'foto is' : 'foto’s zijn'} groter dan 25 MB` : '',
  ].filter(Boolean);
  return { accepted, skipped: problems.length ? `Overgeslagen: ${problems.join(' · ')}` : null };
}

export interface PhotoUploadResult {
  added: number;
  existing: number;
  failed: number;
  publishFailed: number;
  channels: CatalogChannel[];
}

export function uploadSummary(result: PhotoUploadResult): { text: string; ok: boolean } {
  const photos = (count: number) => `${count} ${count === 1 ? 'foto' : 'foto’s'}`;
  const where = result.channels.length
    ? `op ${result.channels.map((channel) => channel === 'WEBSITE' ? 'de website' : channel === 'CATALOGUE' ? 'de catalogus' : 'de bestelapp').join(' en ')}`
    : 'nog niet online';
  const parts = [
    result.added ? `${photos(result.added)} toegevoegd · ${where}` : '',
    result.existing ? `${photos(result.existing)} stond${result.existing === 1 ? '' : 'en'} al in de reeks` : '',
    result.publishFailed ? `${photos(result.publishFailed)} niet gepubliceerd` : '',
    result.failed ? `${photos(result.failed)} niet geüpload` : '',
  ].filter(Boolean);
  return { text: parts.join(' · ') || 'Geen foto’s toegevoegd', ok: !result.failed && !result.publishFailed };
}

/* ----------------------------------------------------- read-only displays */

/** Carousels open on the Hoofdfoto; the other photos keep their order. */
export function hoofdfotoFirst<T extends { id: number }>(photos: readonly T[], main: T | null): T[] {
  const index = main ? photos.findIndex((photo) => photo.id === main.id) : -1;
  return index <= 0 ? [...photos] : [photos[index], ...photos.slice(0, index), ...photos.slice(index + 1)];
}

/** Badges on the current slide of the product view and desk carousels. */
export function slideBadges(
  photo: Pick<PhotoDto, 'id' | 'familyPhotoId'>,
  main: boolean,
  overview: ProductPhotoOverview | null,
): string[] {
  const entry = overview?.photos.find((item) => item.key === photoKeyForProductPhoto(photo));
  return [
    ...(main ? ['Hoofdfoto'] : []),
    ...(entry?.visibility.website ? ['Website'] : []),
    ...(entry?.roles.includes('QUOTE') ? ['Offerte'] : []),
  ];
}
