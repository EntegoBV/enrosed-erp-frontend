import type {
  CatalogChannel,
  OtherPhoto,
  PhotoDto,
  PhotoPlace,
  PhotoPlaces,
  PhotoPlaceState,
  ProductFamilyImage,
  ProductFamilyMember,
  ProductPhotoChoice,
  ProductPhotoOverview,
  ProductPhotoOverviewPhoto,
  ProductPhotoRoleKey,
  ProductPhotoVisibility,
  WebsiteRebuildStatus,
} from '../../core/api/models';

/*
 * The rules behind the product photo section. The server resolves what every
 * place shows (website, catalogue, quotes and invoices); these helpers only
 * decide what the screen offers and how it says it. They import types only
 * and use erasable syntax, so the node tests can load this file as it is.
 *
 * Every sentence the section shows is built here, in the vocabulary of the
 * design (one name per concept). tests/product-photos-state.test.mts scans
 * what these functions return for the words the owner should never read.
 * The block "Legacy" at the end is what the old components still import; it
 * goes when they are rewritten.
 */

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
 * photo chosen for the website appears there and one chosen as the colour's
 * catalogue photo in the catalogue. The series-wide catalogue choices and
 * the order page photo never publish an own photo.
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
 * shows; the order page only receives website photos; a series photo that
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
  const one = result.added === 1;
  const website = result.channels.includes('WEBSITE');
  const catalogue = result.channels.includes('CATALOGUE');
  const where = [
    ...(website ? [`${one ? 'staat' : 'staan'} als extra foto op de website`] : []),
    ...(catalogue ? [`${one ? 'mag' : 'mogen'} in de catalogus`] : []),
  ].join(' en ') || 'nog niet in gebruik';
  const parts = [
    result.added ? `${photos(result.added)} toegevoegd · ${where}` : '',
    result.existing ? `${photos(result.existing)} stond${result.existing === 1 ? '' : 'en'} al in de reeks` : '',
    result.publishFailed ? `${photos(result.publishFailed)} niet als extra foto gezet` : '',
    result.failed ? `${photos(result.failed)} niet geüpload` : '',
  ].filter(Boolean);
  return { text: parts.join(' · ') || 'Geen foto’s toegevoegd', ok: !result.failed && !result.publishFailed };
}

/* ================================================================= places */

/** The five places a picker can change. */
export type PhotoPickerKind = 'website' | 'catalogue' | 'quote' | 'detail' | 'overview';
export type PlaceCardKey = 'website' | 'catalogue' | 'documents';
export type SeriesRowKey = 'opening' | 'quote' | 'detail' | 'overview';
export type PhotoPlaceName = keyof PhotoPlaces;
export type PhotoTone = 'accent' | 'neutral' | 'warn';
/** A photo a place can show: one of photos[] or another colour's own photo from otherPhotos[]. */
export type PlacePhoto = ProductPhotoOverviewPhoto | OtherPhoto;
/** `legacy` = built from the old fields because the server sent no places. */
export type ResolvedPlaces = PhotoPlaces & { legacy?: boolean };
/** A sentence whose opening is bold on screen; `strong` is empty when nothing is. */
export interface PhotoSentence {
  strong: string;
  rest: string;
}
export type ColourStatus = 'active' | 'inactive' | 'demo';

const PLACE_NAMES: readonly PhotoPlaceName[] = [
  'websiteColour', 'websiteOpening', 'documents', 'websiteQuote',
  'catalogueColour', 'catalogueDetail', 'catalogueOverview', 'catalogueCompactRow',
];

const SERIES_PLACE: Readonly<Record<SeriesRowKey, PhotoPlaceName>> = {
  opening: 'websiteOpening', quote: 'websiteQuote', detail: 'catalogueDetail', overview: 'catalogueOverview',
};
const SERIES_ROW_ORDER: readonly SeriesRowKey[] = ['opening', 'quote', 'detail', 'overview'];

const STATE_CHIP: Readonly<Record<PhotoPlaceState, { chip: string; tone: PhotoTone }>> = {
  CHOSEN: { chip: 'Zelf gekozen', tone: 'accent' },
  AUTOMATIC: { chip: 'Automatisch gekozen', tone: 'neutral' },
  CHOSEN_NOT_SHOWN: { chip: 'Je keuze wordt niet getoond', tone: 'warn' },
  NONE: { chip: 'Geen foto', tone: 'warn' },
};

/** "a", "a en b", "a, b en c". */
function listNl(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} en ${items[items.length - 1]}`;
}

function capitalised(text: string): string {
  return text ? text[0].toLocaleUpperCase('nl') + text.slice(1) : text;
}

function isOtherPhoto(photo: PlacePhoto): photo is OtherPhoto {
  return !('kind' in photo);
}

function legacyPlace(
  role: ProductPhotoRoleKey | null,
  scope: 'COLOUR' | 'SERIES',
  shownKey: string | null,
  chosenKey: string | null,
  state: PhotoPlaceState,
): PhotoPlace {
  return { shownKey, chosenKey, state, reason: null, role, scope, relatedProductId: null, relatedLabel: null, thisColour: false };
}

/**
 * Places for a server that sends none (the frontend can go live before the
 * backend). The old `main` is the photo of quotes and invoices, not the
 * website's own pick, so an automatic website photo is drawn only when that
 * photo is on the website. An automatic catalogue photo is unknown to the old
 * server: the place is AUTOMATIC with no photo, never "Geen foto".
 */
export function legacyPlaces(overview: ProductPhotoOverview): ResolvedPlaces {
  const photos = overview.photos ?? [];
  const main = overview.main;
  const mainOnWebsite = !!main && !!photos.find((photo) => photo.key === main.key)?.visibility.website;
  const fromChoice = (
    choice: ProductPhotoChoice | null,
    role: ProductPhotoRoleKey,
    scope: 'COLOUR' | 'SERIES',
    unknownAutomatic: boolean,
  ): PhotoPlace => {
    if (choice) return legacyPlace(role, scope, choice.key, choice.explicit ? choice.key : null, choice.explicit ? 'CHOSEN' : 'AUTOMATIC');
    const possible = unknownAutomatic && photos.some((photo) => canUseForRole(photo, role));
    return legacyPlace(role, scope, null, null, possible ? 'AUTOMATIC' : 'NONE');
  };
  return {
    legacy: true,
    websiteColour: !main ? legacyPlace('MAIN', 'COLOUR', null, null, 'NONE')
      : main.explicit ? legacyPlace('MAIN', 'COLOUR', main.key, main.key, 'CHOSEN')
        : legacyPlace('MAIN', 'COLOUR', mainOnWebsite ? main.key : null, null, 'AUTOMATIC'),
    websiteOpening: legacyPlace(null, 'SERIES', null, null, 'NONE'),
    documents: fromChoice(main, 'MAIN', 'COLOUR', false),
    websiteQuote: fromChoice(overview.quote, 'QUOTE', 'SERIES', false),
    catalogueColour: fromChoice(overview.catalogueVariant, 'CATALOGUE_VARIANT', 'COLOUR', true),
    catalogueDetail: fromChoice(overview.catalogueDetail, 'CATALOGUE_DETAIL', 'SERIES', true),
    catalogueOverview: fromChoice(overview.catalogueOverview, 'CATALOGUE_OVERVIEW', 'SERIES', true),
    catalogueCompactRow: legacyPlace('CATALOGUE_VARIANT', 'COLOUR', null, null, 'NONE'),
  };
}

/** The server's places, or the ones built from the old fields. Null only without an overview. */
export function resolvedPlaces(overview: ProductPhotoOverview | null): ResolvedPlaces | null {
  if (!overview) return null;
  return overview.places ?? legacyPlaces(overview);
}

/** A place photo by key: this product's photos first, then other colours' own photos. */
export function photoByKey(overview: ProductPhotoOverview | null, key: string | null | undefined): PlacePhoto | null {
  if (!overview || !key) return null;
  return overview.photos?.find((photo) => photo.key === key)
    ?? overview.otherPhotos?.find((photo) => photo.key === key)
    ?? null;
}

/** The feed carries the series. An old server only knows the publication status. */
export function seriesLive(overview: ProductPhotoOverview | null): boolean {
  if (!overview) return false;
  return overview.places ? overview.seriesLiveOnWebsite === true : overview.familyWebsiteStatus === 'PUBLISHED';
}

/**
 * Whether this colour is sold. The server says it through the places: a demo
 * product is not in the assumed catalogue, an inactive colour is not on the
 * website. An old server tells neither, so the colour then counts as active.
 */
export function colourStatus(
  overview: ProductPhotoOverview | null,
  product: { active?: boolean | null; demo?: boolean | null } | null = null,
): ColourStatus {
  const places = overview?.places;
  if (!places) return 'active';
  if (product?.demo === true || overview?.catalogueAssumption?.includesThisColour === false) return 'demo';
  if (product?.active === false || places.websiteColour.reason === 'COLOUR_NOT_ACTIVE') return 'inactive';
  return 'active';
}

export interface CataloguePlace {
  /** The place the Catalogus card, the picker and the photo sheet row are fed by. */
  place: PhotoPlace;
  /** The role a choice is sent with. */
  role: 'CATALOGUE_VARIANT' | 'CATALOGUE_DETAIL';
  /** The picker "Wijzig" opens. */
  picker: 'catalogue' | 'detail';
  /** Photos of all colours can be this colour's catalogue photo (one-colour series only). */
  allowAllColours: boolean;
  /** The owner chose the photo the place shows. */
  chosen: boolean;
  /** The stored choice that `role` would replace; null = none. */
  chosenKey: string | null;
  /** The series prints no colour strip: the large photo is this colour's picture. */
  single: boolean;
}

/**
 * The catalogue picture of this colour. In a one-colour series the pdf prints
 * no colour strip, so the series' large photo is the picture; the owner's own
 * choice for the colour then arrives as AUTOMATIC / THIS_COLOUR_LEAD on that
 * place and still is a choice.
 */
export function cataloguePlaceFor(places: PhotoPlaces): CataloguePlace {
  const colour = places.catalogueColour;
  if (colour.reason !== 'SINGLE_COLOUR_SERIES') {
    return {
      place: colour, role: 'CATALOGUE_VARIANT', picker: 'catalogue', allowAllColours: false,
      chosen: colour.state === 'CHOSEN', chosenKey: colour.chosenKey, single: false,
    };
  }
  const detail = places.catalogueDetail;
  const series = detail.chosenKey !== null;
  return {
    place: detail,
    role: series ? 'CATALOGUE_DETAIL' : 'CATALOGUE_VARIANT',
    picker: series ? 'detail' : 'catalogue',
    allowAllColours: true,
    chosen: detail.state === 'CHOSEN' || (detail.state === 'AUTOMATIC' && detail.reason === 'THIS_COLOUR_LEAD'),
    chosenKey: series ? detail.chosenKey : colour.chosenKey,
    single: true,
  };
}

/** An old server's automatic catalogue or website photo: something will be shown, it cannot say what. */
function unknownAutomatic(place: PhotoPlace): boolean {
  return place.state === 'AUTOMATIC' && place.shownKey === null;
}

/* ------------------------------------------------------------ place cards */

export interface PlaceAction {
  /** pick = open `picker`; repair = send the stored choice again; useWebsitePhoto = role MAIN with the website's photo. */
  id: 'pick' | 'repair' | 'useWebsitePhoto';
  label: string;
  ariaLabel: string;
  filled: boolean;
  picker: PhotoPickerKind | null;
}

export interface PlaceCard {
  key: PlaceCardKey;
  name: string;
  icon: 'globe' | 'book' | 'document';
  /** The place the card is fed by. */
  place: PhotoPlace;
  /** What the place shows now; null = the dashed frame with `emptyLabel`. */
  photo: PlacePhoto | null;
  alt: string;
  /** Label of the picture button that opens the photo large. */
  enlargeLabel: string;
  emptyLabel: string;
  chip: string;
  tone: PhotoTone;
  /** Laptop only; on a phone it stays in the accessible description. */
  caption: string;
  /** Why a stored choice is not shown; drawn with `chosenThumb`, on a phone too. */
  reason: PhotoSentence | null;
  chosenThumb: PlacePhoto | null;
  /** Offertes en facturen: the text of the action slot. */
  text: string | null;
  textIcon: 'link' | null;
  actions: PlaceAction[];
}

function pickAction(kind: 'website' | 'catalogue', picker: PhotoPickerKind, colour: string, mode: 'change' | 'first' | 'again'): PlaceAction {
  const noun = kind === 'website' ? 'websitefoto' : 'catalogusfoto';
  if (mode === 'first') return { id: 'pick', label: 'Kies foto', ariaLabel: `Kies een ${noun} voor ${colour}`, filled: true, picker };
  if (mode === 'again') return { id: 'pick', label: 'Kies opnieuw', ariaLabel: `Kies opnieuw een ${noun} voor ${colour}`, filled: false, picker };
  return { id: 'pick', label: 'Wijzig', ariaLabel: `Wijzig de ${noun} van ${colour}`, filled: false, picker };
}

function repairAction(kind: 'website' | 'catalogue', picker: PhotoPickerKind, colour: string): PlaceAction {
  const noun = kind === 'website' ? 'websitefoto' : 'catalogusfoto';
  return { id: 'repair', label: 'Zet mijn keuze weer aan', ariaLabel: `Zet je gekozen ${noun} van ${colour} weer aan`, filled: false, picker };
}

/** Why the website does not show the stored choice, and whether one tap puts it back. */
function websiteNotShown(place: PhotoPlace): { reason: PhotoSentence | null; repair: boolean } {
  switch (place.reason) {
    case 'NOT_PUBLISHED_FOR_WEBSITE':
      return {
        reason: {
          strong: 'Je gekozen foto staat niet op de website.',
          rest: `${place.shownKey ? 'De website toont daarom deze foto. ' : ''}Offertes en facturen tonen wel je gekozen foto.`,
        },
        repair: true,
      };
    case 'NOT_PUBLISHABLE':
      return { reason: { strong: 'Je gekozen foto kan niet op de website.', rest: 'Controleer bij welke kleur hij hoort.' }, repair: false };
    default:
      return { reason: null, repair: false };
  }
}

function catalogueNotShown(place: PhotoPlace, colour: string): { reason: PhotoSentence | null; repair: boolean } {
  switch (place.reason) {
    case 'NOT_PUBLISHED_FOR_CATALOGUE':
      return {
        reason: {
          strong: 'Je gekozen foto mag niet in de catalogus.',
          rest: place.shownKey ? 'De pdf toont daarom deze foto.' : `${colour} staat nu zonder foto in de Handelscatalogus.`,
        },
        repair: true,
      };
    case 'ALL_COLOURS_PHOTO_NOT_USED_PER_COLOUR':
      return {
        reason: {
          strong: 'Je gekozen foto hoort bij alle kleuren.',
          rest: 'In de Handelscatalogus komt bij een kleur alleen een foto van die kleur zelf.',
        },
        repair: false,
      };
    case 'NOT_PUBLISHABLE':
    case 'PHOTO_UNREADABLE':
      return { reason: { strong: 'Je gekozen foto kan niet in de pdf.', rest: '' }, repair: false };
    case 'CHOICE_NOT_AVAILABLE':
      return { reason: { strong: 'Je gekozen foto is niet meer beschikbaar voor de catalogus.', rest: '' }, repair: false };
    default:
      return { reason: null, repair: false };
  }
}

const COLOUR_OFF_CHOICE: PhotoSentence = { strong: '', rest: 'Die kleur staat niet meer aan.' };

function websiteCard(overview: ProductPhotoOverview, places: ResolvedPlaces, colour: string, status: ColourStatus): PlaceCard {
  const place = places.websiteColour;
  const normal = `Als een klant ${colour} kiest, op de productpagina en de bestelpagina.`;
  const card: PlaceCard = {
    key: 'website', name: 'Website', icon: 'globe', place,
    photo: photoByKey(overview, place.shownKey),
    alt: `Websitefoto van ${colour}`,
    enlargeLabel: `Bekijk de websitefoto van ${colour} groot`,
    emptyLabel: 'Nog geen foto',
    ...STATE_CHIP[place.state],
    caption: normal, reason: null, chosenThumb: null, text: null, textIcon: null,
    actions: [pickAction('website', 'website', colour, 'change')],
  };
  if (place.reason === 'COLOUR_NOT_ACTIVE') {
    return {
      ...card, photo: null, chip: 'Kleur staat niet aan', tone: 'neutral',
      caption: status === 'demo'
        ? `${colour} is een demo-product en staat daarom niet op de website.`
        : `${colour} is niet actief en staat daarom niet op de website.`,
      reason: place.chosenKey ? COLOUR_OFF_CHOICE : null,
      chosenThumb: photoByKey(overview, place.chosenKey),
      actions: [],
    };
  }
  if (unknownAutomatic(place)) return { ...card, emptyLabel: 'De website kiest zelf een foto.' };
  if (place.state === 'NONE') {
    return {
      ...card,
      caption: `${colour} heeft geen foto op de website. Op de productpagina is deze kleur daardoor niet aan te tikken; `
        + 'op de bestelpagina staat er een foto van de reeks bij, ook als die een andere kleur toont.',
      actions: [pickAction('website', 'website', colour, 'first')],
    };
  }
  const notLive = !seriesLive(overview) && card.photo !== null
    ? `Deze reeks staat nog niet op de website. Zo komt ${colour} erop zodra de reeks online staat.` : normal;
  if (place.state === 'CHOSEN_NOT_SHOWN') {
    const { reason, repair } = websiteNotShown(place);
    return {
      ...card, caption: notLive, reason, chosenThumb: photoByKey(overview, place.chosenKey),
      actions: [
        ...(repair ? [repairAction('website', 'website', colour)] : []),
        pickAction('website', 'website', colour, 'again'),
      ],
    };
  }
  return { ...card, caption: notLive };
}

function catalogueCard(overview: ProductPhotoOverview, places: ResolvedPlaces, colour: string, status: ColourStatus): PlaceCard {
  const target = cataloguePlaceFor(places);
  const place = target.place;
  const normal = target.single
    ? 'In de pdf-catalogus. Geldt vanaf de volgende pdf.'
    : `Bij ${colour} in de pdf-catalogus. Geldt vanaf de volgende pdf.`;
  const state = target.single && target.chosen ? STATE_CHIP.CHOSEN : STATE_CHIP[place.state];
  const card: PlaceCard = {
    key: 'catalogue', name: 'Catalogus', icon: 'book', place,
    photo: photoByKey(overview, place.shownKey),
    alt: `Catalogusfoto van ${colour}`,
    enlargeLabel: `Bekijk de catalogusfoto van ${colour} groot`,
    emptyLabel: 'Nog geen foto',
    ...state,
    caption: normal, reason: null, chosenThumb: null, text: null, textIcon: null,
    actions: [pickAction('catalogue', target.picker, colour, 'change')],
  };
  // Only a demo product is left out of the pdf; the server says so on the colour place.
  if (places.catalogueColour.reason === 'COLOUR_NOT_ACTIVE') {
    const chosen = places.catalogueColour.chosenKey;
    return {
      ...card, place: places.catalogueColour, photo: null, chip: 'Kleur staat niet aan', tone: 'neutral',
      caption: `${colour} is een demo-product en komt daarom niet in een catalogus.`,
      reason: chosen ? COLOUR_OFF_CHOICE : null,
      chosenThumb: photoByKey(overview, chosen),
      actions: [],
    };
  }
  let filled: PlaceCard;
  if (unknownAutomatic(place)) {
    filled = { ...card, emptyLabel: 'De catalogus kiest de foto bij het maken van de pdf.' };
  } else if (place.state === 'NONE') {
    filled = {
      ...card,
      caption: target.single
        ? `${colour} staat zonder foto in de Handelscatalogus.`
        : `${colour} staat zonder eigen foto in de Handelscatalogus; daar komt bij een kleur alleen een foto van die kleur.`,
      actions: [pickAction('catalogue', target.picker, colour, 'first')],
    };
  } else if (place.state === 'CHOSEN_NOT_SHOWN') {
    const { reason, repair } = catalogueNotShown(place, colour);
    filled = {
      ...card, reason, chosenThumb: photoByKey(overview, place.chosenKey),
      actions: [
        // Switching the catalogue on for a series photo of an inactive colour is refused by the server.
        ...(repair && status === 'active' ? [repairAction('catalogue', target.picker, colour)] : []),
        pickAction('catalogue', target.picker, colour, 'again'),
      ],
    };
  } else {
    filled = card;
  }
  if (status !== 'inactive') return filled;
  // An inactive colour still counts for the pdf, but only its own photos can be chosen.
  const ownPhoto = (overview.photos ?? []).some((photo) => photo.kind === 'OWN');
  return {
    ...filled,
    caption: `${filled.caption} ${colour} is niet actief, maar staat wel in de Catalogusstudio; `
      + `haal de kleur daar weg als ze niet in de pdf hoort.${ownPhoto ? '' : ' Maak de kleur eerst actief om een foto te kiezen.'}`,
    actions: ownPhoto ? filled.actions : [],
  };
}

export type DocumentsRow = 'same-chosen' | 'same-automatic' | 'differs' | 'documents-only' | 'none' | 'colour-off' | 'legacy';

export interface DocumentsState {
  row: DocumentsRow;
  chip: string;
  tone: PhotoTone;
  text: string | null;
  textIcon: 'link' | null;
  action: PlaceAction | null;
}

/**
 * Quotes and invoices print the photo of one rule, the website shows the
 * photo of another. Usually they agree; this names the five ways they relate.
 */
export function documentsState(places: ResolvedPlaces, colour: string): DocumentsState {
  const documents = places.documents;
  const website = places.websiteColour;
  const base = { textIcon: null, action: null } as const;
  if (documents.shownKey === null) {
    return { ...base, row: 'none', chip: 'Geen foto', tone: 'warn', text: `Offertes en facturen tonen ${colour} zonder foto.` };
  }
  if (places.legacy) {
    return documents.state === 'CHOSEN'
      ? { row: 'legacy', chip: 'Zelfde foto als de website', tone: 'neutral', text: 'Verandert mee als je de websitefoto wijzigt.', textIcon: 'link', action: null }
      : { ...base, row: 'legacy', chip: 'Automatisch gekozen', tone: 'neutral', text: null };
  }
  if (website.reason === 'COLOUR_NOT_ACTIVE') {
    return {
      ...base, row: 'colour-off', chip: documents.state === 'CHOSEN' ? 'Zelf gekozen' : 'Automatisch gekozen', tone: 'neutral',
      text: `${colour} staat niet op de website. Op een offerte of factuur staat deze foto.`,
    };
  }
  if (documents.shownKey === website.shownKey) {
    return website.state === 'CHOSEN'
      ? { row: 'same-chosen', chip: 'Zelfde foto als de website', tone: 'neutral', text: 'Verandert mee als je de websitefoto wijzigt.', textIcon: 'link', action: null }
      : { ...base, row: 'same-automatic', chip: 'Nu dezelfde foto als de website', tone: 'neutral', text: 'Kies zelf een websitefoto; dan blijft dat zo.' };
  }
  if (website.shownKey !== null) {
    return {
      row: 'differs', chip: 'Andere foto dan de website', tone: 'warn',
      text: 'Offertes en facturen drukken deze foto af; de website toont een andere.', textIcon: null,
      action: {
        id: 'useWebsitePhoto', label: 'Gebruik de websitefoto', ariaLabel: 'Gebruik de websitefoto ook op offertes en facturen',
        filled: false, picker: null,
      },
    };
  }
  return {
    row: 'documents-only', chip: 'Alleen op offertes en facturen', tone: 'warn', text: null, textIcon: null,
    action: { id: 'pick', label: 'Kies een websitefoto', ariaLabel: `Kies een websitefoto voor ${colour}`, filled: false, picker: 'website' },
  };
}

function documentsCard(overview: ProductPhotoOverview, places: ResolvedPlaces, colour: string): PlaceCard {
  const state = documentsState(places, colour);
  return {
    key: 'documents', name: 'Offertes en facturen', icon: 'document', place: places.documents,
    photo: photoByKey(overview, places.documents.shownKey),
    alt: `Foto van ${colour} op offertes en facturen`,
    enlargeLabel: `Bekijk de foto van ${colour} op offertes en facturen groot`,
    emptyLabel: 'Nog geen foto',
    chip: state.chip, tone: state.tone,
    caption: 'Ook op de offertepagina van de klant; die kan een dag achterlopen.',
    reason: null, chosenThumb: null, text: state.text, textIcon: state.textIcon,
    actions: state.action ? [state.action] : [],
  };
}

/** The three fixed cards under "Waar zien klanten {kleur}?": Website, Catalogus, Offertes en facturen. */
export function placeCards(
  overview: ProductPhotoOverview | null,
  colour: string,
  product: { active?: boolean | null; demo?: boolean | null } | null = null,
): PlaceCard[] {
  const places = resolvedPlaces(overview);
  if (!overview || !places) return [];
  const status = colourStatus(overview, product);
  return [
    websiteCard(overview, places, colour, status),
    catalogueCard(overview, places, colour, status),
    documentsCard(overview, places, colour),
  ];
}

/** Heading and line above the cards; the line changes while the translations block the panel. */
export function placesHeading(colour: string, disabled = false): { title: string; line: string } {
  return {
    title: `Waar zien klanten ${colour}?`,
    line: disabled
      ? 'Bewaar eerst de vertalingen; daarna pas je de foto’s weer aan.'
      : 'Dit zien klanten nu. Wijzigen wordt meteen bewaard.',
  };
}

/** The line in a card right after a choice made in this session; `short` is the phone's. */
export function changedLine(kind: PhotoPickerKind, live: boolean): { text: string; short: string; undo: string } {
  const website = kind === 'website' || kind === 'quote';
  return {
    text: !website ? 'Gewijzigd. Geldt vanaf de volgende pdf.'
      : live ? 'Gewijzigd. Bovenaan zie je of de website al is bijgewerkt.'
        : 'Gewijzigd. Geldt zodra de reeks op de website staat.',
    short: 'Gewijzigd.',
    undo: 'Ongedaan maken',
  };
}

/* --------------------------------------------------------- standing notes */

export interface StandingNote {
  id: 'opening' | 'compact';
  strong: string;
  rest: string;
  photo: PlacePhoto | null;
  alt: string;
  /** reorder = open "Hele reeks" in reorder mode; pick = open `picker`. */
  action: { id: 'reorder' | 'pick'; label: string; picker: PhotoPickerKind | null } | null;
}

/** The two things that surprise, said only while they are true. An old server cannot tell either. */
export function standingNotes(
  overview: ProductPhotoOverview | null,
  colour: string,
  product: { active?: boolean | null; demo?: boolean | null } | null = null,
): StandingNote[] {
  const places = resolvedPlaces(overview);
  if (!overview || !places || places.legacy) return [];
  const notes: StandingNote[] = [];
  const opening = places.websiteOpening;
  const website = places.websiteColour;
  // Without a website photo of this colour "verschijnt zodra een klant ... kiest" would be false.
  if (opening.shownKey && website.shownKey && opening.shownKey !== website.shownKey) {
    notes.push({
      id: 'opening',
      strong: 'De productpagina opent met een andere foto:',
      rest: `de eerste van de hele reeks. De foto van ${colour} verschijnt zodra een klant ${colour} kiest.`,
      photo: photoByKey(overview, opening.shownKey),
      alt: `Eerste foto op de productpagina: ${opening.relatedLabel ? `een foto van ${opening.relatedLabel}` : 'een foto voor alle kleuren'}`,
      // An own photo opens the page: there is no series order to change.
      action: opening.shownKey.startsWith('P') ? null : { id: 'reorder', label: 'Volgorde', picker: null },
    });
  }
  const compact = places.catalogueCompactRow;
  const card = catalogueCard(overview, places, colour, colourStatus(overview, product));
  const inCatalogue = places.catalogueColour.reason !== 'COLOUR_NOT_ACTIVE' && compact.reason !== 'COLOUR_NOT_ACTIVE';
  if (inCatalogue && compact.shownKey && compact.shownKey !== card.place.shownKey) {
    const pick = card.actions.find((action) => action.id === 'pick');
    notes.push({
      id: 'compact',
      strong: 'Het Compact overzicht toont een andere foto.',
      rest: 'Kies zelf een catalogusfoto; dan tonen beide dezelfde.',
      photo: photoByKey(overview, compact.shownKey),
      alt: `Foto van ${colour} in het Compact overzicht`,
      action: pick ? { id: 'pick', label: 'Kies catalogusfoto', picker: pick.picker } : null,
    });
  }
  return notes;
}

/* ------------------------------------------------- "Voor de hele reeks" */

export interface SeriesRow {
  key: SeriesRowKey;
  name: string;
  place: PhotoPlace;
  /** Null = the dashed thumbnail. */
  photo: PlacePhoto | null;
  /** Empty when the server names a reason this screen has no words for. */
  why: string;
  chip: string;
  tone: PhotoTone;
  /** Counts for "1 foto vraagt aandacht" in the folded summary. */
  warn: boolean;
  action: { id: 'reorder' | 'pick'; label: string; ariaLabel: string; picker: PhotoPickerKind | null } | null;
}

const SERIES_ROW_NAME: Readonly<Record<SeriesRowKey, string>> = {
  opening: 'Productpagina', quote: 'Bestelpagina', detail: 'Grote catalogusfoto', overview: 'Kleine catalogusfoto',
};

export const SERIES_STRIP_TITLE = 'Voor de hele reeks';
export const SERIES_STRIP_LINE = 'Vier foto’s die voor alle kleuren gelden.';

/**
 * Why a series place shows its photo, from the server's reason. A reason the
 * table does not know gives no sentence: never the code, never an error.
 */
export function placeWhy(
  place: PhotoPlace,
  kind: SeriesRowKey,
  context: { live?: boolean; detailSize?: 'STANDARD' | 'LARGE' | null; legacy?: boolean } = {},
): string {
  if (context.legacy) {
    return unknownAutomatic(place) ? 'De catalogus kiest de foto bij het maken van de pdf.'
      : place.state === 'NONE' ? 'Nog geen foto.' : '';
  }
  const label = place.relatedLabel?.trim() || null;
  const catalogue = kind === 'detail' || kind === 'overview';
  if (catalogue && place.reason === 'COLOUR_NOT_ACTIVE') {
    return 'Deze reeks heeft alleen demo-producten en komt niet in een catalogus.';
  }
  if (!catalogue && place.reason === 'SERIES_NOT_ACTIVE') return 'De reeks staat niet aan.';
  if (!catalogue && place.reason === 'NO_PHOTO') return 'Er staat nog geen foto van deze reeks op de website.';
  if (kind === 'opening') {
    if (place.shownKey === null) return 'Nog geen foto.';
    if (place.shownKey.startsWith('P')) {
      return `Er staat nog geen reeksfoto op de website. De pagina opent met een eigen foto van ${label ?? 'een kleur'}.`;
    }
    if (context.live === false) return 'Opent met deze foto zodra de reeks op de website staat.';
    return `Opent met deze foto. Nu een foto ${label ? `van ${label}` : 'voor alle kleuren'}.`;
  }
  if (place.state === 'CHOSEN_NOT_SHOWN') {
    return catalogue ? 'Je gekozen foto is niet meer beschikbaar voor de catalogus.' : 'Je gekozen foto staat niet op de website.';
  }
  if (place.state === 'NONE') return 'Nog geen foto.';
  const size = kind === 'detail' && context.detailSize === 'LARGE' ? ' Formaat: groot en breed.' : '';
  if (place.state === 'CHOSEN') {
    return kind === 'quote' ? 'In de bestellijst en bij ‘Vraag een offerte’.'
      : kind === 'detail' ? `Grote foto van de reeks, alleen in de Handelscatalogus.${size}`
        : 'Kleine foto in het overzicht, alleen in de Handelscatalogus.';
  }
  switch (place.reason) {
    case 'FIRST_COLOUR_WEBSITE_PHOTO':
      return kind === 'quote' ? (label ? `Nu de websitefoto van ${label}.` : 'Nu de eerste websitefoto van de reeks.') : '';
    case 'FIRST_IN_SERIES_ORDER':
      return kind === 'quote' ? 'Nu de eerste websitefoto van de reeks.' : `Nu de eerste catalogusfoto van de reeks.${size}`;
    case 'THIS_COLOUR_LEAD':
    case 'OTHER_COLOUR_LEAD_OVERRIDES':
      return catalogue ? `${label ? `Nu de catalogusfoto van ${label}.` : 'Nu de eerste catalogusfoto van de reeks.'}${size}` : '';
    case 'OWN_PHOTO_FILLER':
      return catalogue ? `${label ? `Nu een foto van ${label}.` : 'Nu de eerste catalogusfoto van de reeks.'}${size}` : '';
    case 'SAME_AS_LARGE_PHOTO':
      return kind === 'overview' ? 'Nu dezelfde als de grote foto.' : '';
    default:
      return '';
  }
}

const SERIES_ROW_ARIA: Readonly<Record<SeriesRowKey, string>> = {
  opening: 'Volgorde op de website wijzigen',
  quote: 'Wijzig de foto op de bestelpagina',
  detail: 'Wijzig de grote catalogusfoto van de reeks',
  overview: 'Wijzig de kleine catalogusfoto van de reeks',
};

/** The four photos that count for every colour. An old server knows no opening photo: that row is left out. */
export function seriesRows(overview: ProductPhotoOverview | null): SeriesRow[] {
  const places = resolvedPlaces(overview);
  if (!overview || !places) return [];
  const live = seriesLive(overview);
  const legacy = places.legacy === true;
  return SERIES_ROW_ORDER.filter((key) => !(legacy && key === 'opening')).map((key): SeriesRow => {
    const place = places[SERIES_PLACE[key]];
    const catalogue = key === 'detail' || key === 'overview';
    const demoOnly = catalogue && place.reason === 'COLOUR_NOT_ACTIVE';
    const state = key === 'opening' && place.shownKey !== null
      ? { chip: 'Eerste foto van de reeks', tone: 'neutral' as PhotoTone }
      : demoOnly ? { chip: 'Geen foto', tone: 'neutral' as PhotoTone } : STATE_CHIP[place.state];
    const ownOpening = key === 'opening' && (place.shownKey === null || place.shownKey.startsWith('P'));
    return {
      key, name: SERIES_ROW_NAME[key], place,
      photo: demoOnly ? null : photoByKey(overview, place.shownKey),
      why: placeWhy(place, key, { live, detailSize: overview.catalogueDetailSize, legacy }),
      ...state,
      warn: state.tone === 'warn',
      action: demoOnly || ownOpening ? null
        : key === 'opening' ? { id: 'reorder', label: 'Volgorde', ariaLabel: SERIES_ROW_ARIA.opening, picker: null }
          : { id: 'pick', label: 'Wijzig', ariaLabel: SERIES_ROW_ARIA[key], picker: key },
    };
  });
}

/** The small line in the folded strip on a phone; empty when no row asks for attention. */
export function seriesAttention(rows: readonly SeriesRow[]): string {
  const count = rows.filter((row) => row.warn).length;
  return count === 0 ? '' : count === 1 ? '1 foto vraagt aandacht' : `${count} foto’s vragen aandacht`;
}

/**
 * The line under the strip: which pdf "Catalogus" stands for. The assumed pdf
 * holds every non-demo colour, inactive ones included, as the Catalogusstudio
 * ticks them; the second sentence says so when the series has one.
 */
export function catalogueAssumptionLine(
  overview: ProductPhotoOverview | null,
  members: readonly Pick<ProductFamilyMember, 'productId' | 'active'>[] = [],
): string {
  const counted = new Set(overview?.catalogueAssumption?.productIds ?? []);
  const inactive = members.some((member) => member.active === false && counted.has(member.productId));
  return 'Catalogus = een Handelscatalogus met alle kleuren van deze reeks.'
    + (inactive ? ' Ook niet-actieve kleuren tellen mee; haal ze weg in de Catalogusstudio als ze niet in de pdf horen.' : '')
    + ' Een pdf, offerte of factuur die al verstuurd is, verandert niet meer.';
}

/* ------------------------------------------------------------- tile words */

export interface TileUses {
  /** The Website card shows this photo. */
  website: boolean;
  /** The Catalogus card shows this photo. */
  catalogue: boolean;
  /** Quotes and invoices print it while the website shows another photo or none. */
  documents: boolean;
  /** Quotes and invoices print it, whatever the website shows. */
  onDocuments: boolean;
  /** The series places that show it. */
  series: SeriesRowKey[];
  any: boolean;
}

/** Where a photo is used now, from what the places really show. */
export function tileUses(photo: Pick<PlacePhoto, 'key'>, places: ResolvedPlaces | null): TileUses {
  if (!places) return { website: false, catalogue: false, documents: false, onDocuments: false, series: [], any: false };
  const target = cataloguePlaceFor(places);
  const website = places.websiteColour.shownKey === photo.key;
  const catalogue = places.catalogueColour.reason !== 'COLOUR_NOT_ACTIVE' && target.place.shownKey === photo.key;
  const onDocuments = places.documents.shownKey === photo.key;
  // In a one-colour series the large photo is the Catalogus card itself.
  const series = SERIES_ROW_ORDER.filter((key) => places[SERIES_PLACE[key]].shownKey === photo.key
    && !(key === 'detail' && target.single && catalogue));
  return {
    website, catalogue, documents: onDocuments && !website, onDocuments, series,
    any: website || catalogue || onDocuments || series.length > 0,
  };
}

export interface TileFoot {
  chips: { label: string; tone: PhotoTone }[];
  /** The line of words under or next to the chips; empty when the chips say it all. */
  text: string;
  /** "Niet in gebruik" is drawn in quiet ink. */
  quiet: boolean;
  /** The same in one phrase without a full stop, for labels, picker captions and the file line. */
  words: string;
}

const SERIES_PLUS: Readonly<Record<SeriesRowKey, string>> = {
  opening: '+ eerste foto op de productpagina', quote: '+ de bestelpagina',
  detail: '+ de grote catalogusfoto', overview: '+ de kleine catalogusfoto',
};
const SERIES_ONLY: Readonly<Record<SeriesRowKey, string>> = {
  opening: 'eerste foto op de productpagina', quote: 'bestelpagina',
  detail: 'grote catalogusfoto', overview: 'kleine catalogusfoto',
};
const SERIES_SPOKEN: Readonly<Record<SeriesRowKey, string>> = {
  opening: 'als eerste foto op de productpagina', quote: 'op de bestelpagina',
  detail: 'als grote catalogusfoto', overview: 'als kleine catalogusfoto',
};

/** The words under a tile, first match wins: colour places, series places, extra photo, nothing. */
export function tileFoot(
  photo: ProductPhotoOverviewPhoto,
  uses: TileUses,
  colour: string,
  view: 'colour' | 'series' = 'colour',
): TileFoot {
  const seriesOnly = uses.series.length > 1
    ? `Voor de hele reeks: ${uses.series.length} plekken`
    : uses.series.length === 1 ? `Voor de hele reeks: ${SERIES_ONLY[uses.series[0]]}` : '';
  if (photo.kind === 'SERIES' && photo.scope === 'OTHER_VARIANT') {
    const text = seriesOnly || (photo.visibility.website ? 'Extra foto op de website' : 'Niet op de website');
    return { chips: [], text, quiet: false, words: text };
  }
  const lead: TileFoot['chips'] = [
    ...(photo.kind === 'SERIES' && photo.scope === 'ALL_VARIANTS' && view === 'colour' ? [{ label: 'Alle kleuren', tone: 'neutral' as PhotoTone }] : []),
    // A duplicate normally leaves the grid for the row under it; it stays only while a place uses it.
    ...(photo.duplicateOfKey && uses.any ? [{ label: 'Dubbel', tone: 'warn' as PhotoTone }] : []),
  ];
  if (uses.website || uses.catalogue || uses.documents) {
    const chips = [
      ...(uses.website ? ['Website'] : []),
      ...(uses.catalogue ? ['Catalogus'] : []),
      ...(uses.documents ? ['Offertes'] : []),
    ];
    if (chips.length === 1 && uses.documents && !uses.series.length) {
      return { chips: lead, text: 'Alleen op offertes en facturen', quiet: false, words: 'Alleen op offertes en facturen' };
    }
    const text = uses.series.length > 1 ? `+ ${uses.series.length} plekken van de reeks`
      : uses.series.length === 1 ? SERIES_PLUS[uses.series[0]] : '';
    const nouns = [...(uses.website ? ['websitefoto'] : []), ...(uses.catalogue ? ['catalogusfoto'] : [])];
    const spoken = [
      nouns.length ? `${capitalised(listNl(nouns))} van ${colour}` : '',
      uses.documents ? (nouns.length ? 'ook op offertes en facturen' : 'Op offertes en facturen') : '',
      uses.series.length > 1 ? `en op ${uses.series.length} plekken van de reeks`
        : uses.series.length === 1 ? `en ${SERIES_SPOKEN[uses.series[0]]}` : '',
    ].filter(Boolean);
    return {
      chips: [...lead, ...chips.map((label) => ({ label, tone: 'accent' as PhotoTone }))],
      text, quiet: false, words: spoken.join(', '),
    };
  }
  if (seriesOnly) return { chips: lead, text: seriesOnly, quiet: false, words: seriesOnly };
  const text = photo.visibility.website ? 'Extra foto op de website'
    : photo.visibility.catalogue ? 'Mag in de catalogus' : 'Niet in gebruik';
  return { chips: lead, text, quiet: text === 'Niet in gebruik', words: text };
}

/**
 * The accessible name of a tile: "Foto 1 van 6. Websitefoto van Kersenroze,
 * en op 3 plekken van de reeks. Open voor alle keuzes."
 */
export function photoTileLabel(
  photo: ProductPhotoOverviewPhoto,
  colour: string,
  index: number,
  total: number,
  uses: TileUses,
  view: 'colour' | 'series' = 'colour',
): string {
  const foot = tileFoot(photo, uses, colour, view);
  return [
    `Foto ${index + 1} van ${total}.`,
    ...foot.chips.filter((chip) => chip.tone !== 'accent').map((chip) => (chip.label === 'Dubbel' ? 'Dubbele foto.' : 'Voor alle kleuren.')),
    `${foot.words}.`,
    'Open voor alle keuzes.',
  ].join(' ');
}

/** "{bestandsnaam} · {b} × {h} px" with an optional tail (tile words, file size). */
export function photoFileLine(
  photo: Pick<PlacePhoto, 'originalFilename' | 'widthPx' | 'heightPx'>,
  tail = '',
): string {
  return [
    photo.originalFilename,
    photo.widthPx && photo.heightPx ? `${photo.widthPx} × ${photo.heightPx} px` : '',
    tail,
  ].filter(Boolean).join(' · ');
}

/** The row under the grid that stands for the duplicates taken out of it. */
export function duplicatesNote(count: number, colour: string): PhotoSentence & { action: string } {
  return count === 1
    ? { strong: '1 dubbele foto.', rest: `Dezelfde foto staat twee keer bij ${colour}.`, action: 'Opruimen' }
    : { strong: `${count} dubbele foto’s.`, rest: `Dezelfde foto’s staan twee keer bij ${colour}.`, action: 'Opruimen' };
}

/** Heading and empty state of "Alle foto's" per view. */
export function galleryTexts(view: 'colour' | 'series', colour: string): { heading: string; emptyTitle: string; emptyText: string } {
  return view === 'colour'
    ? { heading: `Alle foto’s van ${colour}`, emptyTitle: `Nog geen foto’s voor ${colour}`, emptyText: 'Voeg een foto toe, of kijk bij ‘Hele reeks’.' }
    : { heading: 'Alle foto’s van de reeks', emptyTitle: 'Nog geen foto’s in deze reeks', emptyText: 'Voeg een foto toe; daarna kies je waar hij komt.' };
}

/* ----------------------------------------------------------------- picker */

const PICKER_ROLE: Readonly<Record<PhotoPickerKind, ProductPhotoRoleKey>> = {
  website: 'MAIN', catalogue: 'CATALOGUE_VARIANT', quote: 'QUOTE', detail: 'CATALOGUE_DETAIL', overview: 'CATALOGUE_OVERVIEW',
};
const PICKER_PLACE: Readonly<Record<PhotoPickerKind, PhotoPlaceName>> = {
  website: 'websiteColour', catalogue: 'catalogueColour', quote: 'websiteQuote', detail: 'catalogueDetail', overview: 'catalogueOverview',
};

export interface PickerTarget {
  /** The picker that really opens: "catalogue" becomes "detail" in a one-colour series with a chosen large photo. */
  kind: PhotoPickerKind;
  role: ProductPhotoRoleKey;
  /** The place whose photo is "now". */
  place: PhotoPlace;
  /** The owner chose the photo the place shows. */
  chosen: boolean;
  /** The stored choice this picker replaces; a tap on it only closes the picker. */
  chosenKey: string | null;
  allowAllColours: boolean;
}

/** Which place, role and stored choice a picker works on. */
export function pickerTarget(places: PhotoPlaces, kind: PhotoPickerKind): PickerTarget {
  if (kind === 'catalogue') {
    const target = cataloguePlaceFor(places);
    return {
      kind: target.picker, role: target.role, place: target.place, chosen: target.chosen,
      chosenKey: target.chosenKey, allowAllColours: target.allowAllColours,
    };
  }
  const place = places[PICKER_PLACE[kind]];
  return { kind, role: PICKER_ROLE[kind], place, chosen: place.state === 'CHOSEN', chosenKey: place.chosenKey, allowAllColours: true };
}

/**
 * The photos a picker shows: the photo of now first (also when it is another
 * colour's own photo), then the gallery order. The Catalogus picker offers
 * this colour's photos only, because the pdf puts no photo of all colours
 * next to a colour; a one-colour series has no such strip and takes them. An
 * inactive colour can only use its own photos. A stored choice that is not
 * shown stays in the list so the owner sees it. `firstKey` is a photo that
 * was just uploaded but could not be chosen: it leads the list for a retry.
 */
export function placeCandidates(
  overview: ProductPhotoOverview | null,
  kind: PhotoPickerKind,
  product: { active?: boolean | null; demo?: boolean | null } | null = null,
  firstKey: string | null = null,
): PlacePhoto[] {
  const places = resolvedPlaces(overview);
  if (!overview || !places) return [];
  const target = pickerTarget(places, kind);
  const colourPlace = target.role === 'MAIN' || target.role === 'CATALOGUE_VARIANT';
  const inactive = colourPlace && colourStatus(overview, product) === 'inactive';
  const fits = (photo: ProductPhotoOverviewPhoto): boolean => {
    if (!canUseForRole(photo, target.role)) return false;
    if (inactive) return photo.kind === 'OWN';
    if (target.role === 'CATALOGUE_VARIANT' && !target.allowAllColours) return photo.kind === 'OWN' || photo.scope === 'THIS_VARIANT';
    return true;
  };
  const current = photoByKey(overview, target.place.shownKey);
  const rest = (overview.photos ?? []).filter((photo) => photo.key !== current?.key && (fits(photo) || photo.key === target.chosenKey));
  const list = current ? [current, ...rest] : rest;
  const lead = firstKey ? list.find((photo) => photo.key === firstKey) : undefined;
  return lead ? [lead, ...list.filter((photo) => photo !== lead)] : list;
}

export interface PickerTexts {
  title: string;
  sentence: string;
  /** The upload bar; null when this picker has none (see `noUpload`). */
  upload: { title: string; sub: string; uploading: string; saving: string } | null;
  noUpload: string | null;
  /** The quiet row under the grid; `link` is "Laat automatisch kiezen" while a choice is stored. */
  automatic: { text: string; link: string | null } | null;
  footnote: string | null;
  /** "Nu in de catalogus": the left half of "Bekijk groot". */
  currentLabel: string;
  /** Caption of the tile the place shows now. */
  currentCaption: string;
  notShownCaption: string;
  empty: string;
  saving: string;
  /** "Kies als catalogusfoto van Kersenroze": the end of a pick button's name. */
  pickVerb: string;
  size: { label: string; standard: string; large: string } | null;
}

/**
 * Every sentence of a picker. `options.upload` false = this colour cannot
 * upload-and-use (inactive); `chosen` and `stored` override what the place
 * says for the one-colour series (take them from `pickerTarget`).
 */
export function pickerTexts(
  kind: PhotoPickerKind,
  colour: string,
  place: PhotoPlace,
  live: boolean,
  options: { upload?: boolean; chosen?: boolean; stored?: boolean; allColours?: boolean } = {},
): PickerTexts {
  const chosen = options.chosen ?? place.state === 'CHOSEN';
  const stored = options.stored ?? place.chosenKey !== null;
  const canUpload = (kind === 'website' || kind === 'catalogue') && options.upload !== false;
  const notLive = live ? null : 'Deze reeks staat nog niet op de website. Je keuze geldt zodra ze online staat.';
  const seriesFootnote = 'Alleen in de Handelscatalogus. Het Compact overzicht gebruikt de catalogusfoto van elke kleur. '
    + 'Staat de kleur van deze foto niet in een pdf, dan kiest die pdf zelf een andere.';
  const table = {
    website: {
      title: `Websitefoto van ${colour}`,
      sentence: `ik op de foto die klanten bij ${colour} op de website moeten zien. Offertes en facturen krijgen dezelfde foto. Je keuze wordt meteen bewaard.`,
      uploadSub: `Wordt meteen de websitefoto van ${colour}, ook op offertes en facturen.`,
      automatic: `Liever niet zelf kiezen? De website neemt dan eerst een foto van ${colour}, anders een foto van alle kleuren.`,
      footnote: notLive, currentLabel: 'Nu op de website', pickVerb: `Kies als websitefoto van ${colour}`,
    },
    catalogue: {
      title: `Catalogusfoto van ${colour}`,
      sentence: `ik op de foto die bij ${colour} in de catalogus moet staan. Je keuze wordt meteen bewaard en geldt vanaf de volgende pdf.`,
      uploadSub: `Wordt meteen de catalogusfoto van ${colour}.`,
      automatic: `Liever niet zelf kiezen? De catalogus neemt dan zelf de eerste foto van ${colour}.`,
      footnote: options.allColours ? null
        : 'Foto’s die bij alle kleuren horen staan hier niet: in de Handelscatalogus komt bij een kleur alleen een foto van die kleur zelf.',
      currentLabel: 'Nu in de catalogus', pickVerb: `Kies als catalogusfoto van ${colour}`,
    },
    quote: {
      title: 'Foto op de bestelpagina',
      sentence: 'ik op de foto die klanten bij deze reeks zien in de bestellijst en bij ‘Vraag een offerte’. Dit geldt voor alle kleuren.',
      uploadSub: '',
      automatic: 'Liever niet zelf kiezen? De bestelpagina neemt dan de websitefoto van de eerste kleur.',
      footnote: notLive, currentLabel: 'Nu op de bestelpagina', pickVerb: 'Kies als foto op de bestelpagina',
    },
    detail: {
      title: 'Grote catalogusfoto van de reeks',
      sentence: 'ik op de grote foto voor deze reeks in de Handelscatalogus. Dit geldt voor alle kleuren, vanaf de volgende pdf.',
      uploadSub: '',
      automatic: 'Liever niet zelf kiezen? De catalogus neemt dan de catalogusfoto van de eerste kleur die er zelf een gekozen heeft, '
        + 'anders de eerste catalogusfoto van de reeks.',
      footnote: seriesFootnote, currentLabel: 'Nu de grote foto', pickVerb: 'Kies als grote catalogusfoto van de reeks',
    },
    overview: {
      title: 'Kleine catalogusfoto van de reeks',
      sentence: 'ik op de kleine foto voor het overzicht van deze reeks in de Handelscatalogus. Dit geldt voor alle kleuren, vanaf de volgende pdf.',
      uploadSub: '',
      automatic: 'Liever niet zelf kiezen? De catalogus neemt dan dezelfde foto als de grote foto.',
      footnote: seriesFootnote, currentLabel: 'Nu de kleine foto', pickVerb: 'Kies als kleine catalogusfoto van de reeks',
    },
  }[kind];
  return {
    title: table.title,
    // "Of" joins the sentence to the upload bar above it.
    sentence: `${canUpload ? 'Of t' : 'T'}${table.sentence}`,
    upload: canUpload ? { title: 'Nieuwe foto uploaden', sub: table.uploadSub, uploading: 'Foto uploaden…', saving: 'Bewaren…' } : null,
    noUpload: canUpload ? null : 'Nieuwe foto? Voeg hem eerst toe bij ‘Alle foto’s’.',
    automatic: stored ? { text: table.automatic, link: 'Laat automatisch kiezen' }
      : place.shownKey !== null ? { text: 'Deze foto is automatisch gekozen. Tik op een foto om zelf te kiezen.', link: null } : null,
    footnote: table.footnote,
    currentLabel: table.currentLabel,
    currentCaption: chosen ? table.currentLabel : `${table.currentLabel}, automatisch gekozen`,
    notShownCaption: 'Je keuze, wordt niet getoond',
    empty: 'Er is nog geen foto die hier kan staan.',
    saving: 'Bewaren…',
    pickVerb: table.pickVerb,
    size: kind === 'detail' ? { label: 'Formaat', standard: 'Standaard', large: 'Groot en breed' } : null,
  };
}

export interface PickerTile {
  photo: PlacePhoto;
  /** The photo the place shows now: accent border, check, `aria-current`. */
  current: boolean;
  /** The stored choice the place does not show. */
  notShown: boolean;
  caption: string;
  captionTone: 'accent' | 'warn' | 'quiet';
  /** Accessible name of the pick button. */
  label: string;
  /** Name of the sibling "Bekijk groot" button; null on the current photo (nothing to compare it with). */
  compareLabel: string | null;
}

export interface PickerModel extends PickerTarget {
  texts: PickerTexts;
  tiles: PickerTile[];
  current: PlacePhoto | null;
  /** The upload bar is offered. */
  upload: boolean;
  detailSize: 'STANDARD' | 'LARGE' | null;
}

/** Everything one picker needs, assembled from the overview. */
export function pickerModel(
  overview: ProductPhotoOverview | null,
  kind: PhotoPickerKind,
  colour: string,
  product: { active?: boolean | null; demo?: boolean | null } | null = null,
  firstKey: string | null = null,
): PickerModel | null {
  const places = resolvedPlaces(overview);
  if (!overview || !places) return null;
  const target = pickerTarget(places, kind);
  const colourPlace = target.kind === 'website' || target.kind === 'catalogue';
  const upload = colourPlace && colourStatus(overview, product) === 'active';
  const texts = pickerTexts(target.kind, colour, target.place, seriesLive(overview), {
    upload, chosen: target.chosen, stored: target.chosenKey !== null, allColours: target.allowAllColours,
  });
  const photos = placeCandidates(overview, kind, product, firstKey);
  const current = photoByKey(overview, target.place.shownKey);
  const tiles = photos.map((photo, index): PickerTile => {
    const isCurrent = photo.key === current?.key;
    const notShown = !isCurrent && photo.key === target.chosenKey;
    const words = isOtherPhoto(photo) ? `Foto van ${photo.variantLabel}` : tileFoot(photo, tileUses(photo, places), colour).words;
    const caption = isCurrent ? texts.currentCaption : notShown ? texts.notShownCaption : words;
    const position = `Foto ${index + 1} van ${photos.length}.`;
    return {
      photo, current: isCurrent, notShown, caption,
      captionTone: isCurrent ? 'accent' : notShown ? 'warn' : 'quiet',
      label: isCurrent ? `${position} ${texts.currentLabel}.` : `${position} ${caption}. ${texts.pickVerb}.`,
      compareLabel: isCurrent ? null : `Bekijk foto ${index + 1} groot, naast de foto van nu`,
    };
  });
  return {
    ...target, texts, tiles, current, upload,
    detailSize: target.kind === 'detail' ? overview.catalogueDetailSize : null,
  };
}

/** "Bekijk groot": "2 van 3 andere foto's"; with one other photo there is nothing to step through. */
export function compareCounter(index: number, total: number): string {
  return total === 1 ? '1 andere foto' : `${index + 1} van ${total} andere foto’s`;
}

/** The line under the two pictures of "Bekijk groot". */
export function compareLine(photo: PlacePhoto, words: string): string {
  return `${photoFileLine(photo, words)}. Er is nog niets gewijzigd.`;
}

/* ---------------------------------------------------- what a save changed */

/** The places that show another photo after a save than before it. */
export function changedPlaces(before: PhotoPlaces | null, after: PhotoPlaces | null): PhotoPlaceName[] {
  if (!before || !after) return [];
  return PLACE_NAMES.filter((name) => before[name].shownKey !== after[name].shownKey);
}

export type PlaceEvent = 'chosen' | 'cleared' | 'pinned' | 'repaired' | 'undone';

const PLACE_TITLE: Readonly<Record<PhotoPickerKind, string>> = {
  website: 'Website', catalogue: 'Catalogus', quote: 'Bestelpagina', detail: 'Grote catalogusfoto', overview: 'Kleine catalogusfoto',
};
const PLACE_SUBJECT: Readonly<Record<PhotoPickerKind, string>> = {
  website: 'de website', catalogue: 'de catalogus', quote: 'de bestelpagina',
  detail: 'de grote catalogusfoto', overview: 'de kleine catalogusfoto',
};

/** "de bestelpagina", "de grote en de kleine catalogusfoto van de reeks" and whether the verb is plural. */
function seriesSubjects(names: readonly PhotoPlaceName[]): { text: string; plural: boolean } {
  const large = names.includes('catalogueDetail');
  const small = names.includes('catalogueOverview');
  const parts = [
    ...(names.includes('websiteQuote') ? ['de bestelpagina'] : []),
    ...(large && small ? ['de grote en de kleine catalogusfoto van de reeks']
      : large ? ['de grote catalogusfoto van de reeks'] : small ? ['de kleine catalogusfoto van de reeks'] : []),
  ];
  return { text: listNl(parts), plural: parts.length > 1 || (large && small) };
}

/**
 * The toast after a choice. For a new choice it also names the series places
 * that moved along to the same photo: a catalogue choice of the first colour
 * becomes the large and the small photo of the series as well.
 */
export function placeSavedMessage(
  kind: PhotoPickerKind,
  colour: string,
  before: PhotoPlaces | null,
  after: PhotoPlaces | null,
  event: PlaceEvent = 'chosen',
): string {
  const title = PLACE_TITLE[kind];
  if (event === 'cleared') return `${title}: wordt weer automatisch gekozen.`;
  if (event === 'pinned') return `${title}: deze foto is nu zelf gekozen.`;
  if (event === 'repaired') return `${title}: je gekozen foto wordt weer getoond.`;
  if (event === 'undone') return `Ongedaan gemaakt: ${PLACE_SUBJECT[kind]} toont weer de vorige foto.`;
  const base = kind === 'website'
    ? `Websitefoto van ${colour} gewijzigd. Offertes en facturen krijgen dezelfde foto; de offertepagina van de klant kan een dag achterlopen.`
    : kind === 'catalogue' ? `Catalogusfoto van ${colour} gewijzigd.`
      : `${title} gewijzigd. Geldt voor alle kleuren.`;
  if (!after) return base;
  const own = kind === 'catalogue' ? cataloguePlaceFor(after).place : after[PICKER_PLACE[kind]];
  const key = kind === 'catalogue' ? (after.catalogueColour.shownKey ?? own.shownKey) : own.shownKey;
  const moved = changedPlaces(before, after).filter((name) => name !== PICKER_PLACE[kind]
    && (name === 'websiteQuote' || name === 'catalogueDetail' || name === 'catalogueOverview')
    && key !== null && after[name].shownKey === key);
  if (!moved.length) return base;
  const subjects = seriesSubjects(moved);
  return `${base} Ook ${subjects.text} ${subjects.plural ? 'tonen' : 'toont'} nu deze foto.`;
}

/** The toast after a move in "Volgorde op de website"; it names every place that now shows another photo. */
export function orderSavedMessage(before: PhotoPlaces | null, after: PhotoPlaces | null): string {
  const moved = changedPlaces(before, after);
  const base = 'Volgorde bewaard. Geldt voor alle kleuren.';
  const subjects = [
    ...(moved.includes('websiteOpening') ? ['de productpagina'] : []),
    ...(moved.includes('websiteColour') ? ['de website'] : []),
    ...(moved.includes('documents') ? ['offertes en facturen'] : []),
    ...(moved.includes('websiteQuote') ? ['de bestelpagina'] : []),
    ...(moved.includes('catalogueColour') || moved.includes('catalogueCompactRow') ? ['de catalogus'] : []),
    ...(moved.includes('catalogueDetail') ? ['de grote catalogusfoto'] : []),
    ...(moved.includes('catalogueOverview') ? ['de kleine catalogusfoto'] : []),
  ];
  if (!subjects.length) return base;
  const plural = subjects.length > 1 || subjects[0] === 'offertes en facturen';
  return `${base} Let op: ${listNl(subjects)} ${plural ? 'tonen' : 'toont'} nu een andere foto.`;
}

/** Added to the upload summary when the new photo became the photo of quotes and invoices. */
export function documentsMovedNote(before: PhotoPlaces | null, after: PhotoPlaces | null): string {
  return changedPlaces(before, after).includes('documents') && after?.documents.shownKey
    ? ' Let op: offertes en facturen tonen nu deze foto.' : '';
}

/** The toast after one of the three "Ook tonen als extra foto" switches moved. */
export function channelSavedMessage(before: readonly CatalogChannel[], after: readonly CatalogChannel[]): string {
  const moved = (channel: CatalogChannel) => before.includes(channel) !== after.includes(channel);
  if (moved('WEBSITE')) return after.includes('WEBSITE') ? 'Foto staat nu als extra foto op de website' : 'Foto staat niet meer als extra foto op de website';
  if (moved('CATALOGUE')) return after.includes('CATALOGUE') ? 'Foto mag nu in de catalogus' : 'Foto mag niet meer in de catalogus';
  return 'Bestelapp aangepast (verandert voor klanten niets)';
}

export function scopeSavedMessage(allColours: boolean, colour: string): string {
  return allColours ? 'Foto hoort nu bij alle kleuren' : `Foto hoort nu alleen bij ${colour}`;
}

/** Fixed toasts and fallbacks of the section; the server's own sentence wins for a failure. */
export const PHOTO_MESSAGES = {
  documentsUseWebsite: 'Offertes en facturen tonen nu de websitefoto.',
  undoLeftOnWebsite: 'De keuze is teruggezet, maar de foto staat nog als extra foto op de website. Zet dat uit bij de foto, onder ‘Meer instellingen’.',
  undoLeftInCatalogue: 'De keuze is teruggezet, maar de foto mag nog in de catalogus. Zet dat uit bij de foto, onder ‘Meer instellingen’.',
  undoRefused: 'De wijziging is niet teruggezet.',
  sizeLarge: 'Grote catalogusfoto: groot en breed',
  sizeStandard: 'Grote catalogusfoto: standaard formaat',
  duplicateCleaned: 'Dubbele foto opgeruimd',
  retry: 'Opnieuw proberen',
  undo: 'Ongedaan maken',
  roleFailed: 'Fotokeuze opslaan mislukt',
  sizeFailed: 'Formaat opslaan mislukt',
  channelsFailed: 'Zichtbaarheid aanpassen mislukt',
  scopeFailed: 'Kleurkeuze opslaan mislukt',
  deleteFailed: 'Foto verwijderen mislukt',
  orderFailed: 'Volgorde aanpassen mislukt',
  downloadFailed: 'Downloaden mislukt',
  deleteRefusedHint: 'Kies eerst een andere foto voor de catalogus.',
} as const;

/* ---------------------------------------------------------- upload and use */

export type UploadUseOutcome = 'reused' | 'otherColour' | 'allColours' | 'roleFailed' | 'unidentified';

/** What "Nieuwe foto uploaden" says when the file was in the series already or the choice did not go through. */
export function uploadUseMessage(outcome: UploadUseOutcome, colour: string, detail: string | null = null): string {
  switch (outcome) {
    case 'reused': return `Deze foto stond al bij ${colour} en is nu gekozen.`;
    case 'otherColour': return `Deze foto staat al in de reeks bij ${detail?.trim() || 'een andere kleur'}. Er is niets gewijzigd.`;
    case 'allColours':
      return 'Deze foto staat al in de reeks voor alle kleuren. In de Handelscatalogus komt bij een kleur alleen een foto van die kleur zelf. Er is niets gewijzigd.';
    case 'roleFailed': {
      const why = detail?.trim().replace(/[.\s]+$/, '');
      return why ? `De foto is toegevoegd, maar nog niet gekozen: ${why}.` : 'De foto is toegevoegd, maar nog niet gekozen.';
    }
    case 'unidentified': return 'Deze foto staat al in de reeks. Kies hem in de lijst.';
  }
}

/**
 * The series image an upload answered with, found the way the server reuses
 * one: first the admin upload of these bytes, then the first image with the
 * same large rendition. Without a hash (no crypto.subtle on plain http) the
 * one id that was not there before; null = the file was in the series already
 * and cannot be named.
 */
export function uploadedImage<T extends Pick<ProductFamilyImage, 'id' | 'sourceKey' | 'largeSha256' | 'position'>>(
  images: readonly T[],
  sha256: string | null,
  idsBefore: readonly number[] = [],
): T | null {
  if (sha256) {
    const sha = sha256.toLowerCase();
    const admin = images.find((image) => image.sourceKey === `admin-${sha}`);
    if (admin) return admin;
    const same = images.filter((image) => image.largeSha256?.toLowerCase() === sha);
    return same.length ? same.reduce((first, image) => (image.position < first.position ? image : first)) : null;
  }
  const known = new Set(idsBefore);
  const added = images.filter((image) => !known.has(image.id));
  return added.length === 1 ? added[0] : null;
}

/**
 * Whether the uploaded (or reused) series image can become the choice. A
 * photo of another colour never; a photo of all colours for the website, and
 * for the catalogue only in a one-colour series. It is never relinked.
 */
export function uploadUseVerdict(
  image: Pick<ProductFamilyImage, 'variantProductId'>,
  productId: number,
  kind: 'website' | 'catalogue',
  places: PhotoPlaces | null,
): 'ok' | 'otherColour' | 'allColours' {
  if (image.variantProductId === productId) return 'ok';
  if (image.variantProductId !== null) return 'otherColour';
  if (kind === 'website') return 'ok';
  return places && cataloguePlaceFor(places).allowAllColours ? 'ok' : 'allColours';
}

/**
 * Success is read from the answer, never from the request: the place the
 * card is fed by must show the key as the owner's choice.
 */
export function placeShowsChoice(overview: ProductPhotoOverview | null, kind: 'website' | 'catalogue', key: string): boolean {
  const places = resolvedPlaces(overview);
  if (!places) return false;
  if (kind === 'website') return places.websiteColour.shownKey === key && places.websiteColour.state === 'CHOSEN';
  const target = cataloguePlaceFor(places);
  return target.place.shownKey === key && target.chosen;
}

/* ------------------------------------------------------------ photo sheet */

/**
 * The help under an "Ook tonen als extra foto" switch when the photo is more
 * than an extra: a stored choice keeps its switch on (locked) for every
 * colour that chose it; a stored choice whose switch is off is the "niet
 * getoond" case and can be switched on; the automatic photo of a place can be
 * switched off, with a word on what happens then. Null = the plain help.
 */
export function switchLock(
  photo: ProductPhotoOverviewPhoto,
  places: ResolvedPlaces | null,
  channel: CatalogChannel,
  colour: string,
): { locked: boolean; help: string } | null {
  if (!places || channel === 'ORDER_APP') return null;
  const website = channel === 'WEBSITE';
  const noun = website ? 'websitefoto' : 'catalogusfoto';
  const role = website ? 'MAIN' : 'CATALOGUE_VARIANT';
  const colourPlace = website ? places.websiteColour : places.catalogueColour;
  const choices = (photo.chosenFor ?? []).filter((item) => item.role === role).map((item) => `de gekozen ${noun} van ${item.variantLabel}`);
  if (!choices.length && colourPlace.chosenKey === photo.key) choices.push(`de gekozen ${noun} van ${colour}`);
  if (website) {
    if (places.websiteQuote.chosenKey === photo.key) choices.push('de gekozen foto op de bestelpagina');
  } else {
    if (places.catalogueDetail.chosenKey === photo.key) choices.push('de gekozen grote catalogusfoto');
    if (places.catalogueOverview.chosenKey === photo.key) choices.push('de gekozen kleine catalogusfoto');
  }
  const on = selectedChannels(photo).includes(channel);
  if (choices.length) {
    return on
      ? { locked: true, help: `Blijft aan: dit is ${choices[0]}. Kies daar eerst een andere foto.` }
      : { locked: false, help: `Dit is ${choices[0]}, maar hij staat uit. Zet aan om hem weer te tonen.` };
  }
  if (!on) return null;
  const shown = website
    ? [places.websiteColour, places.websiteOpening, places.websiteQuote]
    : [places.catalogueColour, places.catalogueDetail, places.catalogueOverview, places.catalogueCompactRow];
  if (!shown.some((place) => place.shownKey === photo.key)) return null;
  return {
    locked: false,
    help: `Zet je dit uit, dan kiest de ${website ? 'website' : 'catalogus'} zelf een andere foto.`
      + (website && places.documents.shownKey === photo.key ? ' Offertes en facturen blijven deze foto tonen.' : ''),
  };
}

/** The sentence with the eye in the photo sheet: every place that shows the photo now, the series ones included. */
export function seenSentence(photo: ProductPhotoOverviewPhoto, places: ResolvedPlaces | null): string {
  const uses = tileUses(photo, places);
  const where = [
    ...(uses.website ? ['op de website'] : []),
    ...(uses.catalogue ? ['in de catalogus'] : []),
    ...(uses.onDocuments ? ['op offertes en facturen'] : []),
    ...uses.series.map((key) => SERIES_SPOKEN[key]),
  ];
  if (where.length === 1 && uses.onDocuments) return 'Klanten zien deze foto nu alleen op offertes en facturen.';
  if (where.length) return `Klanten zien deze foto nu ${listNl(where)}.`;
  if (photo.visibility.website) return 'Klanten zien deze foto nu alleen als extra foto op de website.';
  if (photo.visibility.catalogue) return 'Klanten zien deze foto nu niet. Hij mag wel in de catalogus.';
  return 'Klanten zien deze foto nu nergens.';
}

/**
 * What a photo is, for the delete and the colour confirmations: "de
 * websitefoto van Kersenroze en de catalogusfoto van Rood". Other colours
 * count through `chosenFor`. `othersOnly` leaves this colour out (a photo
 * that leaves the other colours keeps its place here). Empty = nothing.
 */
export function usedPlacesText(
  photo: ProductPhotoOverviewPhoto,
  places: ResolvedPlaces | null,
  colour: string,
  othersOnly = false,
  productId: number | null = null,
): string {
  const uses = tileUses(photo, places);
  const chosen = photo.chosenFor ?? [];
  const mine = (item: { productId: number }) => productId !== null && item.productId === productId;
  const parts: string[] = [];
  const add = (text: string) => { if (!parts.includes(text)) parts.push(text); };
  if (!othersOnly) {
    if (uses.website || chosen.some((item) => item.role === 'MAIN' && mine(item))) add(`de websitefoto van ${colour}`);
    if (uses.catalogue || chosen.some((item) => item.role === 'CATALOGUE_VARIANT' && mine(item))) add(`de catalogusfoto van ${colour}`);
  }
  for (const item of chosen) {
    if (mine(item)) continue;
    add(`de ${item.role === 'MAIN' ? 'websitefoto' : 'catalogusfoto'} van ${item.variantLabel}`);
  }
  if (!othersOnly) {
    if (uses.documents) add('de foto op offertes en facturen');
    for (const key of uses.series) {
      add(key === 'opening' ? 'de eerste foto op de productpagina' : key === 'quote' ? 'de foto op de bestelpagina'
        : key === 'detail' ? 'de grote catalogusfoto' : 'de kleine catalogusfoto');
    }
  }
  return listNl(parts);
}

/** The "Verwijderen" block of the photo sheet and the body of its confirmation. */
export function deleteTexts(
  photo: ProductPhotoOverviewPhoto,
  places: ResolvedPlaces | null,
  colour: string,
  productId: number | null = null,
): { line: string; title: string; body: string; confirm: string } {
  const used = usedPlacesText(photo, places, colour, false, productId);
  return {
    line: used ? `Deze foto is nu ${used}.` : 'Deze foto is nergens in gebruik.',
    title: 'Foto verwijderen',
    body: 'De foto wordt verwijderd.'
      + (used ? ` Hij is nu ${used}. Daar wordt daarna een andere foto gekozen, of de plek blijft leeg als er geen andere is.` : ''),
    confirm: 'Verwijderen',
  };
}

/**
 * The question before a colour change that costs something; null = no
 * question. Narrowing to this colour takes the photo away from the others;
 * widening the colour's catalogue photo to all colours takes it out of the
 * colour strip of the pdf.
 */
export function scopeConfirm(
  photo: ProductPhotoOverviewPhoto,
  places: ResolvedPlaces | null,
  colour: string,
  toAllColours: boolean,
  productId: number | null = null,
): { title: string; body: string; confirm: string } | null {
  if (!toAllColours) {
    if (photo.kind !== 'SERIES' || photo.scope !== 'ALL_VARIANTS') return null;
    const used = usedPlacesText(photo, places, colour, true, productId);
    return {
      title: 'Foto bij minder kleuren tonen',
      body: 'De foto verdwijnt bij de andere kleuren.'
        + (used ? ` Hij is nu ${used}; daar kiest de website of de catalogus daarna zelf een andere foto.` : ''),
      confirm: `Alleen bij ${colour}`,
    };
  }
  if (!places || places.legacy || photo.scope !== 'THIS_VARIANT') return null;
  const target = cataloguePlaceFor(places);
  if (target.single || places.catalogueColour.shownKey !== photo.key) return null;
  return {
    title: 'Foto bij alle kleuren tonen',
    body: `Deze foto is nu de catalogusfoto van ${colour}. Een foto van alle kleuren komt in de Handelscatalogus niet bij een kleur te staan; `
      + `${colour} krijgt daar dan een andere foto of geen.`,
    confirm: 'Bij alle kleuren',
  };
}

/* ------------------------------------------------------------ photo sheet */

export type SheetRowKey = PhotoPickerKind | 'documents' | 'opening';

/** One line of "Gebruik deze foto voor" in the photo sheet. */
export interface SheetRow {
  key: SheetRowKey;
  /** The role a tap is sent with; null = the row has no choice of its own. */
  role: ProductPhotoRoleKey | null;
  name: string;
  sub: string;
  /**
   * use = "Gebruik hier"; chosen = in use, "Terug naar automatisch";
   * automatic = in use, "Zelf vastzetten"; hidden = the stored choice of a
   * place that does not show it, "Terug naar automatisch"; on = in use,
   * nothing to tap; plain = "Geen eigen keuze"; order = "Volgorde wijzigen";
   * blocked = no control, `sub` says why.
   */
  state: 'use' | 'chosen' | 'automatic' | 'hidden' | 'on' | 'plain' | 'order' | 'blocked';
  /** Accessible name of the control; empty when the row has none. */
  label: string;
  /** What the place shows now when that is another photo. */
  shown: PlacePhoto | null;
}

const SHEET_ROW_NAME: Readonly<Record<PhotoPickerKind, string>> = {
  website: 'Website', catalogue: 'Catalogus', quote: 'Bestelpagina', detail: 'Grote catalogusfoto', overview: 'Kleine catalogusfoto',
};

function sheetChoiceRow(
  overview: ProductPhotoOverview,
  places: ResolvedPlaces,
  kind: PhotoPickerKind,
  photo: ProductPhotoOverviewPhoto,
  colour: string,
  status: ColourStatus,
): SheetRow {
  const target = pickerTarget(places, kind);
  const name = SHEET_ROW_NAME[kind];
  const perColour = kind === 'website' || kind === 'catalogue';
  // The card of a colour that is not sold is fed by the colour place, also in a one-colour series.
  const gate = kind === 'website' ? places.websiteColour : kind === 'catalogue' ? places.catalogueColour : target.place;
  const off = gate.reason === 'COLOUR_NOT_ACTIVE';
  const shownHere = !off && target.place.shownKey === photo.key;
  const row = (state: SheetRow['state'], sub: string, label = ''): SheetRow => ({
    key: kind, role: target.role, name, sub, state, label,
    shown: off || shownHere ? null : photoByKey(overview, target.place.shownKey),
  });
  if (off) {
    return row('blocked', kind === 'website'
      ? (status === 'demo' ? `${colour} is een demo-product en staat daarom niet op de website.` : `${colour} is niet actief en staat daarom niet op de website.`)
      : kind === 'catalogue' ? `${colour} is een demo-product en komt daarom niet in een catalogus.`
        : 'Deze reeks heeft alleen demo-producten en komt niet in een catalogus.');
  }
  if (shownHere) {
    if (target.chosen) return row('chosen', 'Zelf gekozen', `${name}: in gebruik, zelf gekozen. Terug naar automatisch.`);
    return canUseForRole(photo, target.role)
      ? row('automatic', 'Automatisch gekozen', `${name}: in gebruik, automatisch gekozen. Zelf vastzetten.`)
      : row('on', 'Automatisch gekozen');
  }
  // Sending the stored key again would change nothing: the way out is back to automatic, or the switch under "Meer instellingen".
  if (target.chosenKey === photo.key) {
    const why = kind === 'website' ? websiteNotShown(target.place).reason
      : kind === 'catalogue' ? catalogueNotShown(target.place, colour).reason : null;
    return row('hidden', why?.strong || 'Je keuze wordt niet getoond.', `${name}: zelf gekozen, maar niet getoond. Terug naar automatisch.`);
  }
  if (perColour && photo.kind === 'SERIES' && photo.scope === 'OTHER_VARIANT') {
    return row('blocked', `Deze foto hoort bij ${photo.variantLabel || 'een andere kleur'}.`);
  }
  if (target.role === 'CATALOGUE_VARIANT' && !target.allowAllColours && photo.kind === 'SERIES' && photo.scope === 'ALL_VARIANTS') {
    return row('blocked', 'Kan niet: in de Handelscatalogus komt bij een kleur alleen een foto van die kleur zelf.');
  }
  // The server refuses to switch the catalogue on for a series photo of a colour that is not active.
  if (perColour && status === 'inactive' && photo.kind !== 'OWN') {
    return row('blocked', `${colour} is niet actief. Maak de kleur eerst actief om deze foto te kiezen.`);
  }
  if (!canUseForRole(photo, target.role)) {
    return row('blocked', photo.kind === 'OWN' ? 'Kan niet: deze foto hoort alleen bij dit product.'
      : 'Deze foto kan nog niet getoond worden. Controleer bij welke kleur hij hoort.');
  }
  return row('use', kind === 'website' ? `Als een klant ${colour} kiest`
    : kind === 'catalogue' ? (target.allowAllColours ? 'In de pdf-catalogus' : `Bij ${colour} in de pdf-catalogus`)
      : 'Voor alle kleuren', `${name}: niet in gebruik. Gebruik hier.`);
}

function sheetDocumentsRow(overview: ProductPhotoOverview, places: ResolvedPlaces, photo: ProductPhotoOverviewPhoto, colour: string): SheetRow {
  const documents = places.documents;
  const on = documents.shownKey === photo.key;
  const relation = documentsState(places, colour);
  const sub = relation.row === 'differs' ? 'Andere foto dan de website'
    : relation.row === 'documents-only' ? 'De website toont geen foto'
      : relation.row === 'none' ? 'Geen foto'
        : relation.row === 'colour-off' ? `${colour} staat niet op de website`
          : relation.row === 'legacy' && documents.state !== 'CHOSEN' ? 'Automatisch gekozen'
            : 'Zelfde foto als de website';
  return {
    key: 'documents', role: null, name: 'Offertes en facturen', sub, state: on ? 'on' : 'plain', label: '',
    shown: on ? null : photoByKey(overview, documents.shownKey),
  };
}

function sheetOpeningRow(places: ResolvedPlaces, photo: ProductPhotoOverviewPhoto): SheetRow {
  const row = (state: SheetRow['state'], sub: string, label = ''): SheetRow => ({
    key: 'opening', role: null, name: 'Productpagina', sub, state, label, shown: null,
  });
  if (places.websiteOpening.shownKey === photo.key) return row('on', 'Eerste foto van de reeks');
  if (photo.kind === 'OWN') return row('blocked', 'Kan niet: deze foto hoort alleen bij dit product.');
  // The order holds the photos the website receives; another one has no position to move.
  if (!photo.visibility.website) return row('blocked', 'Deze foto staat niet in de fotogalerij op de website.');
  return row('order', 'Opent met de eerste foto van de reeks', 'Volgorde op de website wijzigen');
}

/**
 * The rows of the photo sheet: the two choices of this colour with what
 * quotes and invoices print, and the four places of the series. A row never
 * offers a tap the server would refuse or that would change nothing.
 */
export function sheetRows(
  overview: ProductPhotoOverview | null,
  photo: ProductPhotoOverviewPhoto,
  colour: string,
): { colour: SheetRow[]; series: SheetRow[]; seriesSummary: string } {
  const places = resolvedPlaces(overview);
  if (!overview || !places) return { colour: [], series: [], seriesSummary: 'nergens in gebruik' };
  const status = colourStatus(overview);
  const choice = (kind: PhotoPickerKind) => sheetChoiceRow(overview, places, kind, photo, colour, status);
  const series = overview.familyId ? [choice('quote'), choice('detail'), choice('overview'), sheetOpeningRow(places, photo)] : [];
  const used = series.filter((row) => row.state === 'chosen' || row.state === 'automatic' || row.state === 'on').length;
  return {
    colour: [choice('website'), choice('catalogue'), sheetDocumentsRow(overview, places, photo, colour)],
    series,
    seriesSummary: used === 0 ? 'nergens in gebruik' : used === 1 ? 'op 1 plek in gebruik' : `op ${used} plekken in gebruik`,
  };
}

/**
 * What the picture side of the photo sheet draws. "pair" puts the photo
 * next to what customers see now, which only says something when Website and
 * Catalogus show one and the same other photo; when they differ the rows
 * carry a thumbnail each ("thumbs"); a photo this colour uses stands alone.
 */
export function sheetStage(photo: Pick<PlacePhoto, 'key'>, places: ResolvedPlaces | null, reference: PlacePhoto | null): 'pair' | 'thumbs' | 'single' {
  const uses = tileUses(photo, places);
  if (!places || uses.website || uses.catalogue) return 'single';
  if (reference && reference.key !== photo.key) return 'pair';
  const website = places.websiteColour.reason === 'COLOUR_NOT_ACTIVE' ? null : places.websiteColour.shownKey;
  const catalogue = places.catalogueColour.reason === 'COLOUR_NOT_ACTIVE' ? null : cataloguePlaceFor(places).place.shownKey;
  return website || catalogue ? 'thumbs' : 'single';
}

/* -------------------------------------------------------------- add sheet */

/**
 * A photo added for this colour alone is printed on quotes and invoices at
 * once when the colour chose no website photo and has no photo of its own in
 * the series yet. The add sheet says so before the upload.
 */
export function addWarning(
  overview: ProductPhotoOverview | null,
  scope: 'THIS_VARIANT' | 'ALL_VARIANTS',
  colour: string,
): string | null {
  const places = resolvedPlaces(overview);
  if (!overview || !places || scope !== 'THIS_VARIANT') return null;
  if (places.websiteColour.chosenKey !== null || places.documents.state === 'CHOSEN') return null;
  if ((overview.photos ?? []).some((photo) => photo.kind === 'SERIES' && photo.scope === 'THIS_VARIANT')) return null;
  return `Let op: ${colour} heeft nog geen eigen foto. Deze foto komt daarom meteen op offertes en facturen.`;
}

/** The words of the add sheet. */
export function addSheetTexts(count: number, colour: string, scope: 'THIS_VARIANT' | 'ALL_VARIANTS'): {
  title: string; scopeLabel: string; onlyThis: string; all: string; scopeHelp: string;
  extraLabel: string; website: { label: string; help: string }; catalogue: { label: string; help: string };
  extraHelp: string; tip: PhotoSentence & { tail: string };
} {
  return {
    title: count === 1 ? 'Foto toevoegen' : `${count} foto’s toevoegen`,
    scopeLabel: 'Bij welke kleuren hoort deze foto?',
    onlyThis: `Alleen ${colour}`,
    all: 'Alle kleuren',
    scopeHelp: scope === 'THIS_VARIANT'
      ? `De foto hoort alleen bij ${colour}. Alleen zo’n foto kan de catalogusfoto van ${colour} worden.`
      : 'De foto hoort bij elke kleur van deze reeks.',
    extraLabel: 'Ook tonen als extra foto',
    website: { label: 'In de fotogalerij op de website', help: 'Op de productpagina, tussen de andere foto’s.' },
    catalogue: { label: 'Mag in de catalogus', help: 'Een pdf met meer foto’s per reeks kan hem gebruiken.' },
    extraHelp: 'Allebei uit? Dan staat de foto klaar bij ‘Alle foto’s’ en kies je later waar hij komt.',
    // "Wijzig" is bold: rest + strong + tail.
    tip: {
      rest: 'Moet dit meteen de website- of catalogusfoto worden? Dat gaat sneller via',
      strong: 'Wijzig',
      tail: 'bij Website of Catalogus: daar upload en kies je in één keer.',
    },
  };
}

/* ------------------------------------------------------------ status pill */

export interface SyncPill {
  text: string;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
  /** refresh = ask the status again; retry = start the rebuild again; translations = link to /website#translation-work. */
  action: 'refresh' | 'retry' | 'translations' | null;
}

const MONTHS_NL = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

function pillTime(instant: string | null, now: Date): string {
  const date = instant ? new Date(instant) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const two = (value: number) => String(value).padStart(2, '0');
  const time = `${two(date.getHours())}:${two(date.getMinutes())}`;
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return sameDay ? time : `${date.getDate()} ${MONTHS_NL[date.getMonth()]} ${time}`;
}

/**
 * The one place that speaks about the live site. `pollEnded` = the shared
 * status stopped asking by itself (five minutes); null = no pill (not
 * configured, loading, load error).
 */
export function syncPill(
  status: Pick<WebsiteRebuildStatus, 'status' | 'liveAt' | 'lastError'> | null,
  pollEnded: boolean,
  live: boolean,
  now: Date,
): SyncPill | null {
  if (!live) return { text: 'Reeks staat nog niet op de website', tone: 'neutral', action: null };
  switch (status?.status) {
    case 'LIVE': {
      const time = pillTime(status.liveAt, now);
      return { text: time ? `Website is bijgewerkt · ${time}` : 'Website is bijgewerkt', tone: 'ok', action: null };
    }
    case 'QUEUED':
    case 'TRIGGERED':
      return pollEnded
        ? { text: 'Website nog niet bijgewerkt · Kijk opnieuw', tone: 'warn', action: 'refresh' }
        : { text: 'Website wordt bijgewerkt', tone: 'warn', action: null };
    case 'FAILED_OR_STALE':
      // The same test the settings panel uses for "Wacht op vertalingen".
      return /missing required translation|translation entry|invalid public website copy|vertal|ontbrekende?\s+taal/i.test(status.lastError ?? '')
        ? { text: 'Website wacht op vertalingen', tone: 'warn', action: 'translations' }
        : { text: 'Website niet bijgewerkt · Opnieuw proberen', tone: 'danger', action: 'retry' };
    default:
      return null;
  }
}

/* ---------------------------------------------------------- other colours */

export interface OtherColourRow {
  productId: number;
  name: string;
  /** "Rood · niet actief" / "Rood · demo" / "Rood". */
  label: string;
  colourHex: string | null;
  /** Null while that colour's overview is loading or when the place shows nothing (dashed square). */
  website: PlacePhoto | null;
  catalogue: PlacePhoto | null;
  /** The sentence for a colour without any photo; null otherwise. */
  empty: string | null;
  linkLabel: string;
}

export const OTHER_COLOURS_TEXTS = {
  title: 'Andere kleuren van deze reeks',
  loading: 'Foto’s van de andere kleuren laden…',
  failed: 'Niet geladen.',
  retry: 'Opnieuw proberen',
  website: 'Website',
  catalogue: 'Catalogus',
} as const;

/**
 * One row of "Andere kleuren van deze reeks", from that colour's own
 * overview. Looking and jumping only: nothing here writes.
 */
export function otherColourRow(
  member: Pick<ProductFamilyMember, 'productId' | 'name' | 'colour' | 'colourHex' | 'active'>,
  overview: ProductPhotoOverview | null,
): OtherColourRow {
  const name = member.colour?.trim() || member.name?.trim() || 'Andere kleur';
  const places = overview?.places ?? null;
  const demo = overview?.catalogueAssumption?.includesThisColour === false;
  const sold = member.active !== false && !demo;
  const website = places ? photoByKey(overview, places.websiteColour.shownKey) : null;
  const catalogue = places && places.catalogueColour.reason !== 'COLOUR_NOT_ACTIVE'
    ? photoByKey(overview, cataloguePlaceFor(places).place.shownKey) : null;
  const noPhoto = !!overview && (overview.photos ?? []).every((photo) => photo.kind === 'SERIES' && photo.scope === 'OTHER_VARIANT');
  return {
    productId: member.productId,
    name,
    label: demo ? `${name} · demo` : member.active === false ? `${name} · niet actief` : name,
    colourHex: member.colourHex ?? null,
    website, catalogue,
    empty: !noPhoto ? null
      : sold ? `${name} heeft nog geen foto. Op de productpagina is deze kleur daardoor niet aan te tikken.`
        : `${name} heeft nog geen foto.`,
    linkLabel: `Open ${name}`,
  };
}

/* ================================================================= Legacy
 * What product-view.ts still imports until it is rewritten on the places
 * above. These exports speak the old vocabulary ("Hoofdfoto", "Offerte") and
 * are not part of the new screen: delete each one together with its last caller.
 * LEGACY_PHOTO_EXPORTS names them for the vocabulary test.
 */

export const LEGACY_PHOTO_EXPORTS: readonly string[] = ['hoofdfotoFirst', 'slideBadges'];

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
