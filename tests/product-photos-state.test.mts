import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import type {
  PhotoPlace,
  PhotoPlaceReason,
  PhotoPlaces,
  PhotoPlaceState,
  ProductPhotoOverview,
  ProductPhotoOverviewPhoto,
} from '../src/app/core/api/models.ts';
import * as state from '../src/app/features/products/product-photos-state.ts';
import {
  PHOTO_MESSAGES,
  addSheetTexts,
  addWarning,
  canUseForRole,
  catalogueAssumptionLine,
  cataloguePlaceFor,
  changedLine,
  changedPlaces,
  channelSavedMessage,
  cleanupScope,
  colourPhotos,
  colourStatus,
  compareCounter,
  compareLine,
  deleteTexts,
  documentsMovedNote,
  documentsState,
  duplicatesNote,
  familyOrderWith,
  galleryTexts,
  legacyPlaces,
  movedOrder,
  orderSavedMessage,
  otherColourRow,
  photoByKey,
  photoFileLine,
  photoKeyForProductPhoto,
  photoKeyForSignedId,
  photoTileLabel,
  pickerModel,
  pickerTarget,
  pickerTexts,
  placeCandidates,
  placeCards,
  placeSavedMessage,
  placeShowsChoice,
  placeWhy,
  placesHeading,
  publishTargetForRole,
  resolvedPlaces,
  scopeConfirm,
  scopeSavedMessage,
  seenSentence,
  selectedChannels,
  seriesAttention,
  seriesInFamilyOrder,
  seriesLive,
  seriesPhotoGroups,
  seriesRows,
  sheetRows,
  sheetStage,
  signedIdForPhotoKey,
  splitPhotoFiles,
  standingNotes,
  switchLock,
  syncPill,
  tileFoot,
  tileUses,
  toggledChannels,
  uploadSummary,
  uploadUseMessage,
  uploadUseVerdict,
  uploadedImage,
  usedPlacesText,
  variantShortLabel,
  visibleChannels,
} from '../src/app/features/products/product-photos-state.ts';

/*
 * The half heart 40 cm series of the contract (api-contract.md A.6) seen from
 * Kersenroze (product 100); Rood is 101, Bordeaux 127. F242 is Kersenroze's
 * own series photo, F243 an unused one, F244 an extra website photo, F250 a
 * photo of all colours; the rest belongs to Rood and Bordeaux.
 */
const K = 'Kersenroze';
const OFF = { website: false, catalogue: false, orderApp: false };

function photo(key: string, changes: Partial<ProductPhotoOverviewPhoto> = {}): ProductPhotoOverviewPhoto {
  const own = key.startsWith('P');
  const id = Number(key.slice(1));
  return {
    key, kind: own ? 'OWN' : 'SERIES', familyPhotoId: own ? null : id, productPhotoId: own ? id : null,
    scope: 'THIS_VARIANT', variantProductId: 100, variantLabel: K, originalFilename: `${key}.png`,
    contentType: 'image/png', widthPx: 1536, heightPx: 1024, sizeBytes: 1000,
    smallUrl: `/small/${key}`, mediumUrl: `/medium/${key}`, largeUrl: `/large/${key}`, downloadUrl: `/download/${key}`,
    visibility: { ...OFF }, websiteReason: null, publishedChannels: own ? null : [],
    publishable: !own, roles: [], duplicateOfKey: null, familyPosition: own ? null : id, ownPosition: own ? 0 : null,
    chosenFor: [],
    ...changes,
  };
}

const ROLE: Record<keyof PhotoPlaces, PhotoPlace['role']> = {
  websiteColour: 'MAIN', websiteOpening: null, documents: 'MAIN', websiteQuote: 'QUOTE',
  catalogueColour: 'CATALOGUE_VARIANT', catalogueDetail: 'CATALOGUE_DETAIL',
  catalogueOverview: 'CATALOGUE_OVERVIEW', catalogueCompactRow: 'CATALOGUE_VARIANT',
};

/** One place; `chosenKey` follows the state unless given. */
function place(
  name: keyof PhotoPlaces,
  shownKey: string | null,
  placeState: PhotoPlaceState,
  reason: PhotoPlaceReason | null = null,
  extra: Partial<PhotoPlace> = {},
): PhotoPlace {
  const series = name === 'websiteOpening' || name === 'websiteQuote' || name === 'catalogueDetail' || name === 'catalogueOverview';
  return {
    shownKey, chosenKey: placeState === 'CHOSEN' ? shownKey : null, state: placeState, reason,
    role: ROLE[name], scope: series ? 'SERIES' : 'COLOUR',
    relatedProductId: shownKey ? 100 : null, relatedLabel: shownKey ? K : null, thisColour: shownKey !== null,
    ...extra,
  };
}
const ROOD = { relatedProductId: 101, relatedLabel: 'Rood', thisColour: false };
const ALL = { relatedProductId: null, relatedLabel: null, thisColour: false };

/** The first worked example of the contract: website and catalogue chosen, both F242. */
function examplePlaces(changes: Partial<PhotoPlaces> = {}): PhotoPlaces {
  return {
    websiteColour: place('websiteColour', 'F242', 'CHOSEN'),
    websiteOpening: place('websiteOpening', 'F214', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER', ROOD),
    documents: place('documents', 'F242', 'CHOSEN'),
    websiteQuote: place('websiteQuote', 'F242', 'AUTOMATIC', 'FIRST_COLOUR_WEBSITE_PHOTO'),
    catalogueColour: place('catalogueColour', 'F242', 'CHOSEN'),
    catalogueDetail: place('catalogueDetail', 'F242', 'AUTOMATIC', 'THIS_COLOUR_LEAD'),
    catalogueOverview: place('catalogueOverview', 'F242', 'AUTOMATIC', 'SAME_AS_LARGE_PHOTO'),
    catalogueCompactRow: place('catalogueCompactRow', 'F242', 'CHOSEN'),
    ...changes,
  };
}

function examplePhotos(): ProductPhotoOverviewPhoto[] {
  const rood = { scope: 'OTHER_VARIANT' as const, variantProductId: 101, variantLabel: 'Rood' };
  const bordeaux = { scope: 'OTHER_VARIANT' as const, variantProductId: 127, variantLabel: 'Bordeaux' };
  return [
    photo('F242', {
      visibility: { website: true, catalogue: true, orderApp: false }, websiteReason: 'PUBLISHED', publishedChannels: ['WEBSITE', 'CATALOGUE'],
      roles: ['MAIN', 'QUOTE', 'CATALOGUE_VARIANT'],
      chosenFor: [{ productId: 100, variantLabel: K, role: 'MAIN' }, { productId: 100, variantLabel: K, role: 'CATALOGUE_VARIANT' }],
    }),
    photo('F243'),
    photo('F244', { visibility: { website: true, catalogue: false, orderApp: false }, websiteReason: 'PUBLISHED', publishedChannels: ['WEBSITE'] }),
    photo('F250', {
      scope: 'ALL_VARIANTS', variantProductId: null, variantLabel: null,
      visibility: { website: false, catalogue: true, orderApp: false }, publishedChannels: ['CATALOGUE'],
    }),
    photo('F214', { ...rood, familyPosition: 0, visibility: { website: true, catalogue: false, orderApp: false }, websiteReason: 'PUBLISHED', publishedChannels: ['WEBSITE'] }),
    photo('F179', { ...rood, visibility: { website: false, catalogue: true, orderApp: false }, publishedChannels: ['CATALOGUE'] }),
    photo('F255', { ...bordeaux, visibility: { website: false, catalogue: true, orderApp: false }, publishedChannels: ['CATALOGUE'] }),
    photo('F256', { ...bordeaux, visibility: { website: true, catalogue: false, orderApp: false }, websiteReason: 'PUBLISHED', publishedChannels: ['WEBSITE'] }),
  ];
}

function example(placeChanges: Partial<PhotoPlaces> = {}, changes: Partial<ProductPhotoOverview> = {}): ProductPhotoOverview {
  return {
    productId: 100, familyId: 33, familyName: 'Half heart rose foam 40 cm', variantLabel: 'Kersenroze · 40 cm',
    familyWebsiteStatus: 'PUBLISHED',
    photos: examplePhotos(),
    main: { key: 'F242', explicit: true },
    quote: { key: 'F242', explicit: false },
    catalogueVariant: { key: 'F242', explicit: true },
    catalogueOverview: null,
    catalogueDetail: null,
    catalogueDetailSize: 'STANDARD',
    places: examplePlaces(placeChanges),
    otherPhotos: [],
    seriesLiveOnWebsite: true,
    colourOnWebsite: true,
    websitePageUrl: 'https://enrosed.com/nl/products/foam-half-heart-40/',
    catalogueAssumption: { layout: 'BROCHURE', photosPerSeries: 1, productIds: [100, 101, 127], includesThisColour: true },
    ...changes,
  };
}

const P5755 = {
  key: 'P5755', productId: 101, variantLabel: 'Rood', originalFilename: 'product-101-pvc-transparent-v3.png',
  widthPx: 1536, heightPx: 1024,
  smallUrl: '/api/products/101/photos/5755/renditions/small',
  mediumUrl: '/api/products/101/photos/5755/renditions/medium',
  largeUrl: '/api/products/101/photos/5755',
};

/** The second worked example: no catalogue choice here, Rood's own photo P5755 decides the series. */
function exampleWithoutCatalogueChoice(): ProductPhotoOverview {
  const data = example({
    catalogueColour: place('catalogueColour', 'F242', 'AUTOMATIC', 'OWN_COLOUR_SERIES_PHOTO'),
    catalogueDetail: place('catalogueDetail', 'P5755', 'AUTOMATIC', 'OTHER_COLOUR_LEAD_OVERRIDES', ROOD),
    catalogueOverview: place('catalogueOverview', 'P5755', 'AUTOMATIC', 'SAME_AS_LARGE_PHOTO', ROOD),
    catalogueCompactRow: place('catalogueCompactRow', 'F242', 'AUTOMATIC', 'FIRST_SERIES_PHOTO'),
  }, { catalogueVariant: null, otherPhotos: [P5755] });
  data.photos[0] = { ...data.photos[0], roles: ['MAIN', 'QUOTE'], chosenFor: [{ productId: 100, variantLabel: K, role: 'MAIN' }] };
  return data;
}

/** A server from before the places contract: the same series without one new field. */
function legacy(changes: Partial<ProductPhotoOverview> = {}): ProductPhotoOverview {
  const { places, otherPhotos, seriesLiveOnWebsite, colourOnWebsite, websitePageUrl, catalogueAssumption, ...old } = example();
  void places; void otherPhotos; void seriesLiveOnWebsite; void colourOnWebsite; void websitePageUrl; void catalogueAssumption;
  return {
    ...old,
    photos: old.photos.map(({ chosenFor, ...item }) => { void chosenFor; return item; }),
    ...changes,
  };
}

/** A one-colour series: the pdf prints no colour strip, the large photo is the colour's picture. */
function oneColour(detail: PhotoPlace, colourChoice: string | null = null): ProductPhotoOverview {
  const data = example({
    catalogueColour: place('catalogueColour', null, colourChoice ? 'CHOSEN_NOT_SHOWN' : 'NONE', 'SINGLE_COLOUR_SERIES', { chosenKey: colourChoice }),
    catalogueDetail: detail,
    catalogueOverview: place('catalogueOverview', detail.shownKey, detail.shownKey ? 'AUTOMATIC' : 'NONE', detail.shownKey ? 'SAME_AS_LARGE_PHOTO' : 'NO_PHOTO'),
    websiteOpening: place('websiteOpening', 'F242', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER'),
  }, { catalogueAssumption: { layout: 'BROCHURE', photosPerSeries: 1, productIds: [100], includesThisColour: true } });
  data.photos = data.photos.filter((item) => item.scope !== 'OTHER_VARIANT');
  return data;
}

const INACTIVE = { active: false, demo: false };
/** Kersenroze made inactive: not on the website, still in the assumed pdf. */
function inactiveColour(photos: ProductPhotoOverviewPhoto[] = examplePhotos()): ProductPhotoOverview {
  return example({
    websiteColour: place('websiteColour', null, 'NONE', 'COLOUR_NOT_ACTIVE'),
    documents: place('documents', 'F242', 'AUTOMATIC', 'FIRST_SERIES_PHOTO'),
    websiteQuote: place('websiteQuote', 'F214', 'AUTOMATIC', 'FIRST_COLOUR_WEBSITE_PHOTO', ROOD),
    catalogueColour: place('catalogueColour', 'P5501', 'AUTOMATIC', 'OWN_PHOTO_FIRST'),
    catalogueDetail: place('catalogueDetail', 'P5501', 'AUTOMATIC', 'OWN_PHOTO_FILLER'),
    catalogueOverview: place('catalogueOverview', 'P5501', 'AUTOMATIC', 'SAME_AS_LARGE_PHOTO'),
    catalogueCompactRow: place('catalogueCompactRow', 'P5501', 'AUTOMATIC', 'OWN_PHOTO_FIRST'),
  }, { photos, colourOnWebsite: false });
}

/** Kersenroze as a demo product: on no website and in no catalogue. */
function demoColour(): ProductPhotoOverview {
  return example({
    websiteColour: place('websiteColour', null, 'NONE', 'COLOUR_NOT_ACTIVE'),
    documents: place('documents', 'F242', 'AUTOMATIC', 'FIRST_SERIES_PHOTO'),
    websiteQuote: place('websiteQuote', 'F214', 'AUTOMATIC', 'FIRST_COLOUR_WEBSITE_PHOTO', ROOD),
    catalogueColour: place('catalogueColour', null, 'NONE', 'COLOUR_NOT_ACTIVE'),
    catalogueDetail: place('catalogueDetail', 'F179', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER', ROOD),
    catalogueOverview: place('catalogueOverview', 'F179', 'AUTOMATIC', 'SAME_AS_LARGE_PHOTO', ROOD),
    catalogueCompactRow: place('catalogueCompactRow', null, 'NONE', 'COLOUR_NOT_ACTIVE'),
  }, { colourOnWebsite: false, catalogueAssumption: { layout: 'BROCHURE', photosPerSeries: 1, productIds: [101, 127], includesThisColour: false } });
}

const keys = (photos: readonly { key: string }[]) => photos.map((item) => item.key);
const card = (data: ProductPhotoOverview, key: 'website' | 'catalogue' | 'documents', colour = K, product: { active?: boolean; demo?: boolean } | null = null) =>
  placeCards(data, colour, product).find((item) => item.key === key)!;
const row = (data: ProductPhotoOverview, key: 'opening' | 'quote' | 'detail' | 'overview') => seriesRows(data).find((item) => item.key === key)!;
const labels = (actions: readonly { label: string }[]) => actions.map((action) => action.label);
const places = (data: ProductPhotoOverview) => resolvedPlaces(data)!;
const byKey = (data: ProductPhotoOverview, key: string) => data.photos.find((item) => item.key === key)!;

/* ------------------------------------------------------------------ keys */

test('signed website/catalogue ids and product photo rows map onto overview keys', () => {
  assert.equal(photoKeyForSignedId(221), 'F221');
  assert.equal(photoKeyForSignedId(-5560), 'P5560');
  assert.equal(photoKeyForSignedId(0), null);
  assert.equal(photoKeyForSignedId(null), null);
  assert.equal(signedIdForPhotoKey('F221'), 221);
  assert.equal(signedIdForPhotoKey('P5560'), -5560);
  assert.equal(signedIdForPhotoKey('X12'), null);
  assert.equal(signedIdForPhotoKey('F0'), null);
  assert.equal(photoKeyForProductPhoto({ id: 9001, familyPhotoId: 221 }), 'F221', 'A projection answers for its series photo');
  assert.equal(photoKeyForProductPhoto({ id: 5501, familyPhotoId: null }), 'P5501');
});

/* ---------------------------------------------- the contract's two examples */

test('contract example 1: the three cards show what the server says, chosen, with one button each', () => {
  const data = example();
  assert.equal(resolvedPlaces(data), data.places, 'The server’s places are used as they come');
  assert.deepEqual(placesHeading(K), { title: 'Waar zien klanten Kersenroze?', line: 'Dit zien klanten nu. Wijzigen wordt meteen bewaard.' });
  assert.equal(placesHeading(K, true).line, 'Bewaar eerst de vertalingen; daarna pas je de foto’s weer aan.');
  const cards = placeCards(data, K);
  assert.deepEqual(cards.map((item) => [item.key, item.name, item.icon, item.photo?.key, item.chip, item.tone]), [
    ['website', 'Website', 'globe', 'F242', 'Zelf gekozen', 'accent'],
    ['catalogue', 'Catalogus', 'book', 'F242', 'Zelf gekozen', 'accent'],
    ['documents', 'Offertes en facturen', 'document', 'F242', 'Zelfde foto als de website', 'neutral'],
  ]);
  assert.deepEqual(cards.map((item) => item.caption), [
    'Als een klant Kersenroze kiest, op de productpagina en de bestelpagina.',
    'Bij Kersenroze in de pdf-catalogus. Geldt vanaf de volgende pdf.',
    'Ook op de offertepagina van de klant; die kan een dag achterlopen.',
  ]);
  assert.deepEqual(cards.map((item) => [item.alt, item.enlargeLabel]), [
    ['Websitefoto van Kersenroze', 'Bekijk de websitefoto van Kersenroze groot'],
    ['Catalogusfoto van Kersenroze', 'Bekijk de catalogusfoto van Kersenroze groot'],
    ['Foto van Kersenroze op offertes en facturen', 'Bekijk de foto van Kersenroze op offertes en facturen groot'],
  ]);
  assert.deepEqual(cards[0].actions, [{ id: 'pick', label: 'Wijzig', ariaLabel: 'Wijzig de websitefoto van Kersenroze', filled: false, picker: 'website' }]);
  assert.deepEqual(cards[1].actions, [{ id: 'pick', label: 'Wijzig', ariaLabel: 'Wijzig de catalogusfoto van Kersenroze', filled: false, picker: 'catalogue' }]);
  assert.deepEqual([cards[2].actions, cards[2].text, cards[2].textIcon], [[], 'Verandert mee als je de websitefoto wijzigt.', 'link'],
    'Offertes en facturen has no button while it shows the website photo');
  assert.deepEqual(placeCards(null, K), []);
});

test('contract example 1: the product page opens with Rood’s photo and the first colour’s choice is the series’ large and small photo', () => {
  const data = example();
  assert.deepEqual(standingNotes(data, K), [{
    id: 'opening',
    strong: 'De productpagina opent met een andere foto:',
    rest: 'de eerste van de hele reeks. De foto van Kersenroze verschijnt zodra een klant Kersenroze kiest.',
    photo: byKey(data, 'F214'),
    alt: 'Eerste foto op de productpagina: een foto van Rood',
    action: { id: 'reorder', label: 'Volgorde', picker: null },
  }]);
  assert.deepEqual(seriesRows(data).map((item) => [item.name, item.photo?.key, item.why, item.chip, item.action?.label]), [
    ['Productpagina', 'F214', 'Opent met deze foto. Nu een foto van Rood.', 'Eerste foto van de reeks', 'Volgorde'],
    ['Bestelpagina', 'F242', 'Nu de websitefoto van Kersenroze.', 'Automatisch gekozen', 'Wijzig'],
    ['Grote catalogusfoto', 'F242', 'Nu de catalogusfoto van Kersenroze.', 'Automatisch gekozen', 'Wijzig'],
    ['Kleine catalogusfoto', 'F242', 'Nu dezelfde als de grote foto.', 'Automatisch gekozen', 'Wijzig'],
  ]);
  assert.deepEqual(seriesRows(data).map((item) => [item.action?.ariaLabel, item.action?.picker]), [
    ['Volgorde op de website wijzigen', null], ['Wijzig de foto op de bestelpagina', 'quote'],
    ['Wijzig de grote catalogusfoto van de reeks', 'detail'], ['Wijzig de kleine catalogusfoto van de reeks', 'overview'],
  ]);
  assert.equal(seriesAttention(seriesRows(data)), '');
  const uses = tileUses(byKey(data, 'F242'), places(data));
  assert.deepEqual(uses, { website: true, catalogue: true, documents: false, onDocuments: true, series: ['quote', 'detail', 'overview'], any: true });
  assert.equal(photoTileLabel(byKey(data, 'F242'), K, 0, 6, uses),
    'Foto 1 van 6. Websitefoto en catalogusfoto van Kersenroze, en op 3 plekken van de reeks. Open voor alle keuzes.');
});

test('contract example 2: another colour’s own photo is drawn from otherPhotos and named by its colour', () => {
  const data = exampleWithoutCatalogueChoice();
  assert.equal(photoByKey(data, 'P5755'), data.otherPhotos![0]);
  assert.equal(photoByKey(data, 'F242'), data.photos[0], 'photos[] is looked in first');
  assert.equal(photoByKey(data, 'F999'), null);
  assert.equal(photoByKey(data, null), null);
  assert.deepEqual([card(data, 'catalogue').chip, card(data, 'catalogue').photo?.key], ['Automatisch gekozen', 'F242']);
  assert.deepEqual([row(data, 'detail').photo, row(data, 'detail').why], [P5755, 'Nu de catalogusfoto van Rood.']);
  assert.deepEqual([row(data, 'overview').photo, row(data, 'overview').why], [P5755, 'Nu dezelfde als de grote foto.']);
  // It stands first in the picker as the photo of now; it is not a candidate of this colour otherwise.
  const picker = pickerModel(data, 'detail', K)!;
  assert.deepEqual(keys(picker.tiles.map((tile) => tile.photo)).slice(0, 2), ['P5755', 'F242']);
  assert.deepEqual([picker.tiles[0].current, picker.tiles[0].caption, picker.tiles[0].compareLabel], [true, 'Nu de grote foto, automatisch gekozen', null]);
  assert.equal(standingNotes(data, K).some((note) => note.id === 'compact'), false, 'The compact row shows the same photo as the card');
});

/* ------------------------------------------- 4.2 Website and Catalogus card */

const stateRows: [string, PhotoPlaceState, PhotoPlaceReason | null, string, string][] = [
  ['CHOSEN', 'CHOSEN', null, 'Zelf gekozen', 'accent'],
  ['AUTOMATIC', 'AUTOMATIC', 'OWN_COLOUR_SERIES_PHOTO', 'Automatisch gekozen', 'neutral'],
];
for (const [name, placeState, reason, chip, tone] of stateRows) {
  test(`4.2 ${name}: both cards show the photo, the chip "${chip}" and "Wijzig"`, () => {
    const data = example({
      websiteColour: place('websiteColour', 'F242', placeState, reason),
      catalogueColour: place('catalogueColour', 'F242', placeState, reason),
    });
    for (const key of ['website', 'catalogue'] as const) {
      const item = card(data, key);
      assert.deepEqual([item.photo?.key, item.chip, item.tone, item.reason, item.chosenThumb, labels(item.actions)],
        ['F242', chip, tone, null, null, ['Wijzig']]);
    }
  });
}

test('4.2 NONE on Website: "Geen foto", why that matters on both pages, and a filled "Kies foto"', () => {
  const item = card(example({ websiteColour: place('websiteColour', null, 'NONE', 'NO_PHOTO') }), 'website');
  assert.deepEqual([item.photo, item.emptyLabel, item.chip, item.tone], [null, 'Nog geen foto', 'Geen foto', 'warn']);
  assert.equal(item.caption, 'Kersenroze heeft geen foto op de website. Op de productpagina is deze kleur daardoor niet aan te tikken; '
    + 'op de bestelpagina staat er een foto van de reeks bij, ook als die een andere kleur toont.');
  assert.deepEqual(item.actions, [{ id: 'pick', label: 'Kies foto', ariaLabel: 'Kies een websitefoto voor Kersenroze', filled: true, picker: 'website' }]);
});

test('4.2 NONE on Catalogus: the colour stands without its own photo in the Handelscatalogus', () => {
  const item = card(example({ catalogueColour: place('catalogueColour', null, 'NONE', 'NO_PHOTO') }), 'catalogue');
  assert.deepEqual([item.photo, item.chip, item.tone, labels(item.actions), item.actions[0].filled], [null, 'Geen foto', 'warn', ['Kies foto'], true]);
  assert.equal(item.caption, 'Kersenroze staat zonder eigen foto in de Handelscatalogus; daar komt bij een kleur alleen een foto van die kleur.');
});

const notShown: [string, 'website' | 'catalogue', PhotoPlaceReason, string | null, string, string, string[]][] = [
  ['Website, NOT_PUBLISHED_FOR_WEBSITE', 'website', 'NOT_PUBLISHED_FOR_WEBSITE', 'F244',
    'Je gekozen foto staat niet op de website.', 'De website toont daarom deze foto. Offertes en facturen tonen wel je gekozen foto.',
    ['Zet mijn keuze weer aan', 'Kies opnieuw']],
  ['Website, NOT_PUBLISHABLE', 'website', 'NOT_PUBLISHABLE', 'F244',
    'Je gekozen foto kan niet op de website.', 'Controleer bij welke kleur hij hoort.', ['Kies opnieuw']],
  ['Catalogus, NOT_PUBLISHED_FOR_CATALOGUE', 'catalogue', 'NOT_PUBLISHED_FOR_CATALOGUE', 'F244',
    'Je gekozen foto mag niet in de catalogus.', 'De pdf toont daarom deze foto.', ['Zet mijn keuze weer aan', 'Kies opnieuw']],
  ['Catalogus, NOT_PUBLISHED_FOR_CATALOGUE and nothing shown', 'catalogue', 'NOT_PUBLISHED_FOR_CATALOGUE', null,
    'Je gekozen foto mag niet in de catalogus.', 'Kersenroze staat nu zonder foto in de Handelscatalogus.', ['Zet mijn keuze weer aan', 'Kies opnieuw']],
  ['Catalogus, ALL_COLOURS_PHOTO_NOT_USED_PER_COLOUR', 'catalogue', 'ALL_COLOURS_PHOTO_NOT_USED_PER_COLOUR', null,
    'Je gekozen foto hoort bij alle kleuren.', 'In de Handelscatalogus komt bij een kleur alleen een foto van die kleur zelf.', ['Kies opnieuw']],
  ['Catalogus, NOT_PUBLISHABLE', 'catalogue', 'NOT_PUBLISHABLE', 'F244', 'Je gekozen foto kan niet in de pdf.', '', ['Kies opnieuw']],
  ['Catalogus, PHOTO_UNREADABLE', 'catalogue', 'PHOTO_UNREADABLE', 'F244', 'Je gekozen foto kan niet in de pdf.', '', ['Kies opnieuw']],
];
for (const [name, key, reason, shown, strong, rest, buttons] of notShown) {
  test(`4.2 CHOSEN_NOT_SHOWN: ${name}`, () => {
    const name2 = key === 'website' ? 'websiteColour' : 'catalogueColour';
    const data = example({ [name2]: place(name2, shown, 'CHOSEN_NOT_SHOWN', reason, { chosenKey: 'F243' }) });
    const item = card(data, key);
    assert.deepEqual([item.chip, item.tone, item.photo?.key ?? null, item.chosenThumb?.key], ['Je keuze wordt niet getoond', 'warn', shown, 'F243'],
      'The card shows what the place shows instead and the stored choice as a thumbnail');
    assert.deepEqual(item.reason, { strong, rest });
    assert.deepEqual(labels(item.actions), buttons);
    assert.equal(item.actions.find((action) => action.id === 'repair')?.ariaLabel,
      buttons.length === 2 ? `Zet je gekozen ${key === 'website' ? 'websitefoto' : 'catalogusfoto'} van Kersenroze weer aan` : undefined);
  });
}

test('4.2 CHOSEN_NOT_SHOWN: the website shows nothing, so "deze foto" is left out; an unknown reason gives the chip and "Kies opnieuw" only', () => {
  const nothing = card(example({ websiteColour: place('websiteColour', null, 'CHOSEN_NOT_SHOWN', 'NOT_PUBLISHED_FOR_WEBSITE', { chosenKey: 'F243' }) }), 'website');
  assert.equal(nothing.reason?.rest, 'Offertes en facturen tonen wel je gekozen foto.');
  const unknown = card(example({
    websiteColour: place('websiteColour', 'F244', 'CHOSEN_NOT_SHOWN', 'SOMETHING_NEW' as PhotoPlaceReason, { chosenKey: 'F243' }),
  }), 'website');
  assert.deepEqual([unknown.chip, unknown.reason, labels(unknown.actions)], ['Je keuze wordt niet getoond', null, ['Kies opnieuw']]);
});

test('4.2 Website, COLOUR_NOT_ACTIVE: an inactive colour and a demo product each get their own sentence and no button', () => {
  const inactive = card(inactiveColour(), 'website', K, INACTIVE);
  assert.deepEqual([inactive.photo, inactive.chip, inactive.tone, inactive.actions], [null, 'Kleur staat niet aan', 'neutral', []]);
  assert.equal(inactive.caption, 'Kersenroze is niet actief en staat daarom niet op de website.');
  assert.equal(card(inactiveColour(), 'website').caption, inactive.caption, 'The overview alone tells inactive from demo');
  const demo = card(demoColour(), 'website');
  assert.deepEqual([demo.chip, demo.caption, demo.actions], ['Kleur staat niet aan', 'Kersenroze is een demo-product en staat daarom niet op de website.', []]);
  assert.equal(card(demoColour(), 'website', K, { active: true, demo: true }).caption, demo.caption);
  assert.deepEqual([colourStatus(example()), colourStatus(inactiveColour()), colourStatus(demoColour()), colourStatus(null)],
    ['active', 'inactive', 'demo', 'active']);
});

test('4.2 any place, COLOUR_NOT_ACTIVE with a stored choice: the choice is shown with "Die kleur staat niet meer aan."', () => {
  const data = inactiveColour();
  data.places!.websiteColour = place('websiteColour', null, 'CHOSEN_NOT_SHOWN', 'COLOUR_NOT_ACTIVE', { chosenKey: 'F242' });
  const item = card(data, 'website');
  assert.deepEqual([item.chip, item.reason, item.chosenThumb?.key, item.actions],
    ['Kleur staat niet aan', { strong: '', rest: 'Die kleur staat niet meer aan.' }, 'F242', []]);
  const demo = demoColour();
  demo.places!.catalogueColour = place('catalogueColour', null, 'CHOSEN_NOT_SHOWN', 'COLOUR_NOT_ACTIVE', { chosenKey: 'F242' });
  assert.deepEqual([card(demo, 'catalogue').reason?.rest, card(demo, 'catalogue').chosenThumb?.key], ['Die kleur staat niet meer aan.', 'F242']);
});

test('4.2 Catalogus, COLOUR_NOT_ACTIVE: only a demo product is left out of every catalogue', () => {
  const item = card(demoColour(), 'catalogue');
  assert.deepEqual([item.photo, item.chip, item.tone, item.actions], [null, 'Kleur staat niet aan', 'neutral', []]);
  assert.equal(item.caption, 'Kersenroze is een demo-product en komt daarom niet in een catalogus.');
  assert.deepEqual(tileUses(byKey(demoColour(), 'F179'), places(demoColour())).catalogue, false);
});

test('4.2 Catalogus, colour inactive but not demo: the pdf still prints it; only own photos can be chosen', () => {
  const withOwn = inactiveColour([photo('P5501', { visibility: { website: false, catalogue: true, orderApp: false } }), ...examplePhotos()]);
  const item = card(withOwn, 'catalogue', K, INACTIVE);
  assert.deepEqual([item.photo?.key, item.chip, labels(item.actions)], ['P5501', 'Automatisch gekozen', ['Wijzig']]);
  assert.equal(item.caption, 'Bij Kersenroze in de pdf-catalogus. Geldt vanaf de volgende pdf. '
    + 'Kersenroze is niet actief, maar staat wel in de Catalogusstudio; haal de kleur daar weg als ze niet in de pdf hoort.');
  assert.deepEqual(keys(placeCandidates(withOwn, 'catalogue', INACTIVE)), ['P5501'], 'A series photo of an inactive colour cannot be switched on');
  const picker = pickerModel(withOwn, 'catalogue', K, INACTIVE)!;
  assert.deepEqual([picker.upload, picker.texts.upload, picker.texts.noUpload], [false, null, 'Nieuwe foto? Voeg hem eerst toe bij ‘Alle foto’s’.']);
  assert.match(picker.texts.sentence, /^Tik op de foto die bij Kersenroze/, 'Without the upload bar the sentence does not start with "Of"');

  const withoutOwn = inactiveColour();
  withoutOwn.places!.catalogueColour = place('catalogueColour', null, 'NONE', 'NO_PHOTO');
  const empty = card(withoutOwn, 'catalogue');
  assert.deepEqual(empty.actions, []);
  assert.match(empty.caption, /haal de kleur daar weg als ze niet in de pdf hoort\. Maak de kleur eerst actief om een foto te kiezen\.$/);

  const stale = inactiveColour([photo('P5501'), ...examplePhotos()]);
  stale.places!.catalogueColour = place('catalogueColour', 'P5501', 'CHOSEN_NOT_SHOWN', 'NOT_PUBLISHED_FOR_CATALOGUE', { chosenKey: 'F242' });
  assert.deepEqual(labels(card(stale, 'catalogue').actions), ['Kies opnieuw'], 'The server would refuse to switch that series photo on');
});

test('4.2 series not live: the Website card says the photo is what the colour will get', () => {
  const data = example({}, { seriesLiveOnWebsite: false, websitePageUrl: null, familyWebsiteStatus: 'DRAFT' });
  const item = card(data, 'website');
  assert.deepEqual([item.photo?.key, item.chip, labels(item.actions)], ['F242', 'Zelf gekozen', ['Wijzig']]);
  assert.equal(item.caption, 'Deze reeks staat nog niet op de website. Zo komt Kersenroze erop zodra de reeks online staat.');
  assert.equal(card(data, 'catalogue').caption, 'Bij Kersenroze in de pdf-catalogus. Geldt vanaf de volgende pdf.', 'Website card only');
  assert.equal(seriesLive(data), false);
  assert.equal(seriesLive(example()), true);
  assert.equal(seriesLive(null), false);
});

test('4.2 just changed: the line promises nothing about the live site', () => {
  assert.deepEqual(changedLine('website', true), { text: 'Gewijzigd. Bovenaan zie je of de website al is bijgewerkt.', short: 'Gewijzigd.', undo: 'Ongedaan maken' });
  assert.equal(changedLine('website', false).text, 'Gewijzigd. Geldt zodra de reeks op de website staat.');
  assert.equal(changedLine('catalogue', true).text, 'Gewijzigd. Geldt vanaf de volgende pdf.');
  assert.equal(changedLine('detail', false).text, 'Gewijzigd. Geldt vanaf de volgende pdf.');
});

/* -------------------------------------------- 4.2 Offertes en facturen card */

test('4.2 documents: same photo, website chosen', () => {
  assert.deepEqual(documentsState(places(example()), K), {
    row: 'same-chosen', chip: 'Zelfde foto als de website', tone: 'neutral',
    text: 'Verandert mee als je de websitefoto wijzigt.', textIcon: 'link', action: null,
  });
});

test('4.2 documents: same photo, website automatic', () => {
  const data = example({
    websiteColour: place('websiteColour', 'F242', 'AUTOMATIC', 'OWN_COLOUR_SERIES_PHOTO'),
    documents: place('documents', 'F242', 'AUTOMATIC', 'FIRST_SERIES_PHOTO'),
  });
  assert.deepEqual(documentsState(places(data), K), {
    row: 'same-automatic', chip: 'Nu dezelfde foto als de website', tone: 'neutral',
    text: 'Kies zelf een websitefoto; dan blijft dat zo.', textIcon: null, action: null,
  });
});

test('4.2 documents: another photo than the website, with the one-tap fix', () => {
  const data = example({
    websiteColour: place('websiteColour', 'F244', 'AUTOMATIC', 'OWN_COLOUR_SERIES_PHOTO'),
    documents: place('documents', 'F243', 'AUTOMATIC', 'FIRST_SERIES_PHOTO'),
  });
  assert.deepEqual(documentsState(places(data), K), {
    row: 'differs', chip: 'Andere foto dan de website', tone: 'warn',
    text: 'Offertes en facturen drukken deze foto af; de website toont een andere.', textIcon: null,
    action: { id: 'useWebsitePhoto', label: 'Gebruik de websitefoto', ariaLabel: 'Gebruik de websitefoto ook op offertes en facturen', filled: false, picker: null },
  });
  assert.deepEqual([card(data, 'documents').photo?.key, labels(card(data, 'documents').actions)], ['F243', ['Gebruik de websitefoto']]);
  // The same fact seen twice: the website's stored choice is not shown, documents still print it.
  const twice = example({ websiteColour: place('websiteColour', 'F244', 'CHOSEN_NOT_SHOWN', 'NOT_PUBLISHED_FOR_WEBSITE', { chosenKey: 'F242' }) });
  assert.equal(documentsState(places(twice), K).row, 'differs');
  assert.deepEqual(labels(card(twice, 'website').actions), ['Zet mijn keuze weer aan', 'Kies opnieuw'], 'Both cards carry their own repair');
});

test('4.2 documents: a photo on documents while the website shows none', () => {
  const data = example({
    websiteColour: place('websiteColour', null, 'NONE', 'NO_PHOTO'),
    documents: place('documents', 'F243', 'AUTOMATIC', 'FIRST_SERIES_PHOTO'),
  });
  assert.deepEqual(documentsState(places(data), K), {
    row: 'documents-only', chip: 'Alleen op offertes en facturen', tone: 'warn', text: null, textIcon: null,
    action: { id: 'pick', label: 'Kies een websitefoto', ariaLabel: 'Kies een websitefoto voor Kersenroze', filled: false, picker: 'website' },
  });
});

test('4.2 documents: no photo at all', () => {
  const data = example({ websiteColour: place('websiteColour', null, 'NONE', 'NO_PHOTO'), documents: place('documents', null, 'NONE', 'NO_PHOTO') });
  assert.deepEqual(documentsState(places(data), K), {
    row: 'none', chip: 'Geen foto', tone: 'warn', text: 'Offertes en facturen tonen Kersenroze zonder foto.', textIcon: null, action: null,
  });
  assert.deepEqual([card(data, 'documents').photo, card(data, 'documents').emptyLabel], [null, 'Nog geen foto']);
});

test('4.2 documents: the colour is not on the website, so no website choice is offered', () => {
  assert.deepEqual(documentsState(places(inactiveColour()), K), {
    row: 'colour-off', chip: 'Automatisch gekozen', tone: 'neutral',
    text: 'Kersenroze staat niet op de website. Op een offerte of factuur staat deze foto.', textIcon: null, action: null,
  });
  const chosen = inactiveColour();
  chosen.places!.documents = place('documents', 'F242', 'CHOSEN');
  assert.equal(documentsState(places(chosen), K).chip, 'Zelf gekozen');
  assert.equal(documentsState(places(demoColour()), K).row, 'colour-off');
});

/* --------------------------------------------------- 4.2 one-colour series */

test('one-colour series: the owner’s own choice arrives as THIS_COLOUR_LEAD on the large photo and still reads "Zelf gekozen"', () => {
  const data = oneColour(place('catalogueDetail', 'F242', 'AUTOMATIC', 'THIS_COLOUR_LEAD'), 'F242');
  const target = cataloguePlaceFor(places(data));
  assert.deepEqual([target.place, target.role, target.picker, target.allowAllColours, target.chosen, target.chosenKey, target.single],
    [data.places!.catalogueDetail, 'CATALOGUE_VARIANT', 'catalogue', true, true, 'F242', true]);
  const item = card(data, 'catalogue');
  assert.deepEqual([item.photo?.key, item.chip, item.tone, item.reason, labels(item.actions), item.actions[0].picker],
    ['F242', 'Zelf gekozen', 'accent', null, ['Wijzig'], 'catalogue'], 'catalogueColour is CHOSEN_NOT_SHOWN by construction, never a warning');
  assert.equal(item.caption, 'In de pdf-catalogus. Geldt vanaf de volgende pdf.');
  assert.equal(placeShowsChoice(data, 'catalogue', 'F242'), true, 'Upload-and-use reads success from the large photo');
  assert.equal(placeShowsChoice(data, 'catalogue', 'F243'), false);
  // Photos of all colours are candidates here, and the footnote that says otherwise is gone.
  assert.deepEqual(keys(placeCandidates(data, 'catalogue')), ['F242', 'F243', 'F244', 'F250']);
  const picker = pickerModel(data, 'catalogue', K)!;
  assert.deepEqual([picker.kind, picker.role, picker.texts.footnote, picker.tiles[0].caption, picker.texts.automatic?.link],
    ['catalogue', 'CATALOGUE_VARIANT', null, 'Nu in de catalogus', 'Laat automatisch kiezen']);
  assert.deepEqual(tileUses(byKey(data, 'F242'), places(data)).series, ['opening', 'quote', 'overview'], 'The large photo is the Catalogus card itself');
  assert.equal(scopeConfirm(byKey(data, 'F242'), places(data), K, true), null, 'No colour strip to fall out of');
  assert.equal(uploadUseVerdict({ variantProductId: null }, 100, 'catalogue', places(data)), 'ok');
});

test('one-colour series: any other automatic photo is "Automatisch gekozen"; a chosen large photo opens that picker', () => {
  const automatic = oneColour(place('catalogueDetail', 'F250', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER', ALL));
  assert.deepEqual([card(automatic, 'catalogue').chip, cataloguePlaceFor(places(automatic)).chosen, card(automatic, 'catalogue').photo?.key],
    ['Automatisch gekozen', false, 'F250']);
  const series = oneColour(place('catalogueDetail', 'F250', 'CHOSEN', null, ALL));
  const target = cataloguePlaceFor(places(series));
  assert.deepEqual([target.role, target.picker, target.chosen, target.chosenKey], ['CATALOGUE_DETAIL', 'detail', true, 'F250']);
  assert.deepEqual([card(series, 'catalogue').chip, card(series, 'catalogue').actions[0].picker], ['Zelf gekozen', 'detail']);
  assert.equal(pickerModel(series, 'catalogue', K)!.kind, 'detail', 'Asking for the Catalogus picker opens the one of the large photo');
  assert.equal(pickerModel(series, 'catalogue', K)!.texts.title, 'Grote catalogusfoto van de reeks');
  const none = oneColour(place('catalogueDetail', null, 'NONE', 'NO_PHOTO'));
  assert.deepEqual([card(none, 'catalogue').chip, card(none, 'catalogue').caption, labels(card(none, 'catalogue').actions)],
    ['Geen foto', 'Kersenroze staat zonder foto in de Handelscatalogus.', ['Kies foto']]);
  const stale = oneColour(place('catalogueDetail', 'F244', 'CHOSEN_NOT_SHOWN', 'CHOICE_NOT_AVAILABLE', { chosenKey: 'F243' }));
  assert.deepEqual([card(stale, 'catalogue').chip, card(stale, 'catalogue').reason?.strong, labels(card(stale, 'catalogue').actions)],
    ['Je keuze wordt niet getoond', 'Je gekozen foto is niet meer beschikbaar voor de catalogus.', ['Kies opnieuw']]);
});

/* ------------------------------------------------------- 4.3 standing notes */

test('4.3 the product page note needs a website photo of this colour and loses its button when an own photo opens the page', () => {
  const none = example({ websiteColour: place('websiteColour', null, 'NONE', 'NO_PHOTO') });
  assert.deepEqual(standingNotes(none, K), [], 'Its second sentence would be false without a website photo of the colour');
  const same = example({ websiteOpening: place('websiteOpening', 'F242', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER') });
  assert.deepEqual(standingNotes(same, K), []);
  const all = example({ websiteOpening: place('websiteOpening', 'F250', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER', ALL) });
  assert.equal(standingNotes(all, K)[0].alt, 'Eerste foto op de productpagina: een foto voor alle kleuren');
  const own = example({ websiteOpening: place('websiteOpening', 'P5755', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER', ROOD) }, { otherPhotos: [P5755] });
  assert.deepEqual([standingNotes(own, K)[0].photo, standingNotes(own, K)[0].action], [P5755, null], 'There is no series order to change');
  const notLive = example({}, { seriesLiveOnWebsite: false });
  assert.equal(standingNotes(notLive, K).length, 1, 'Series live or not');
});

test('4.3 the Compact overzicht note appears only when it prints another photo than the Catalogus card', () => {
  const data = example({ catalogueCompactRow: place('catalogueCompactRow', 'F243', 'AUTOMATIC', 'FIRST_SERIES_PHOTO') });
  assert.deepEqual(standingNotes(data, K)[1], {
    id: 'compact',
    strong: 'Het Compact overzicht toont een andere foto.',
    rest: 'Kies zelf een catalogusfoto; dan tonen beide dezelfde.',
    photo: byKey(data, 'F243'),
    alt: 'Foto van Kersenroze in het Compact overzicht',
    action: { id: 'pick', label: 'Kies catalogusfoto', picker: 'catalogue' },
  });
  assert.equal(standingNotes(demoColour(), K).some((note) => note.id === 'compact'), false, 'A demo product is in no catalogue');
  const nothing = example({ catalogueCompactRow: place('catalogueCompactRow', null, 'NONE', 'NO_PHOTO') });
  assert.equal(standingNotes(nothing, K).some((note) => note.id === 'compact'), false, 'Nothing to draw');
});

/* -------------------------------------------------- 4.4 Voor de hele reeks */

type WhyCase = [string, 'opening' | 'quote' | 'detail' | 'overview', PhotoPlace, string, string, string | null];
const whyCases: WhyCase[] = [
  ['Productpagina, a colour’s photo', 'opening', place('websiteOpening', 'F214', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER', ROOD),
    'Opent met deze foto. Nu een foto van Rood.', 'Eerste foto van de reeks', 'Volgorde'],
  ['Productpagina, a photo of all colours', 'opening', place('websiteOpening', 'F250', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER', ALL),
    'Opent met deze foto. Nu een foto voor alle kleuren.', 'Eerste foto van de reeks', 'Volgorde'],
  ['Productpagina, NO_PHOTO', 'opening', place('websiteOpening', null, 'NONE', 'NO_PHOTO'),
    'Er staat nog geen foto van deze reeks op de website.', 'Geen foto', null],
  ['Bestelpagina, CHOSEN', 'quote', place('websiteQuote', 'F242', 'CHOSEN'), 'In de bestellijst en bij ‘Vraag een offerte’.', 'Zelf gekozen', 'Wijzig'],
  ['Bestelpagina, FIRST_COLOUR_WEBSITE_PHOTO', 'quote', place('websiteQuote', 'F214', 'AUTOMATIC', 'FIRST_COLOUR_WEBSITE_PHOTO', ROOD),
    'Nu de websitefoto van Rood.', 'Automatisch gekozen', 'Wijzig'],
  ['Bestelpagina, FIRST_IN_SERIES_ORDER', 'quote', place('websiteQuote', 'F256', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER', ALL),
    'Nu de eerste websitefoto van de reeks.', 'Automatisch gekozen', 'Wijzig'],
  ['Bestelpagina, SERIES_NOT_ACTIVE', 'quote', place('websiteQuote', null, 'NONE', 'SERIES_NOT_ACTIVE'), 'De reeks staat niet aan.', 'Geen foto', 'Wijzig'],
  ['Bestelpagina, NO_PHOTO', 'quote', place('websiteQuote', null, 'NONE', 'NO_PHOTO'),
    'Er staat nog geen foto van deze reeks op de website.', 'Geen foto', 'Wijzig'],
  ['Bestelpagina, choice not shown', 'quote', place('websiteQuote', 'F214', 'CHOSEN_NOT_SHOWN', 'NOT_PUBLISHED_FOR_WEBSITE', { chosenKey: 'F243' }),
    'Je gekozen foto staat niet op de website.', 'Je keuze wordt niet getoond', 'Wijzig'],
  ['Grote catalogusfoto, CHOSEN', 'detail', place('catalogueDetail', 'F242', 'CHOSEN'),
    'Grote foto van de reeks, alleen in de Handelscatalogus.', 'Zelf gekozen', 'Wijzig'],
  ['Grote catalogusfoto, THIS_COLOUR_LEAD', 'detail', place('catalogueDetail', 'F242', 'AUTOMATIC', 'THIS_COLOUR_LEAD'),
    'Nu de catalogusfoto van Kersenroze.', 'Automatisch gekozen', 'Wijzig'],
  ['Grote catalogusfoto, OTHER_COLOUR_LEAD_OVERRIDES', 'detail', place('catalogueDetail', 'F179', 'AUTOMATIC', 'OTHER_COLOUR_LEAD_OVERRIDES', ROOD),
    'Nu de catalogusfoto van Rood.', 'Automatisch gekozen', 'Wijzig'],
  ['Grote catalogusfoto, FIRST_IN_SERIES_ORDER', 'detail', place('catalogueDetail', 'F179', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER', ROOD),
    'Nu de eerste catalogusfoto van de reeks.', 'Automatisch gekozen', 'Wijzig'],
  ['Grote catalogusfoto, OWN_PHOTO_FILLER', 'detail', place('catalogueDetail', 'F179', 'AUTOMATIC', 'OWN_PHOTO_FILLER', ROOD),
    'Nu een foto van Rood.', 'Automatisch gekozen', 'Wijzig'],
  ['Grote catalogusfoto, choice not available', 'detail', place('catalogueDetail', 'F179', 'CHOSEN_NOT_SHOWN', 'CHOICE_NOT_AVAILABLE', { chosenKey: 'F243' }),
    'Je gekozen foto is niet meer beschikbaar voor de catalogus.', 'Je keuze wordt niet getoond', 'Wijzig'],
  ['Grote catalogusfoto, no photo', 'detail', place('catalogueDetail', null, 'NONE', 'NO_PHOTO'), 'Nog geen foto.', 'Geen foto', 'Wijzig'],
  ['Kleine catalogusfoto, CHOSEN', 'overview', place('catalogueOverview', 'F242', 'CHOSEN'),
    'Kleine foto in het overzicht, alleen in de Handelscatalogus.', 'Zelf gekozen', 'Wijzig'],
  ['Kleine catalogusfoto, SAME_AS_LARGE_PHOTO', 'overview', place('catalogueOverview', 'F242', 'AUTOMATIC', 'SAME_AS_LARGE_PHOTO'),
    'Nu dezelfde als de grote foto.', 'Automatisch gekozen', 'Wijzig'],
  ['Kleine catalogusfoto, choice not available', 'overview', place('catalogueOverview', 'F242', 'CHOSEN_NOT_SHOWN', 'CHOICE_NOT_AVAILABLE', { chosenKey: 'F243' }),
    'Je gekozen foto is niet meer beschikbaar voor de catalogus.', 'Je keuze wordt niet getoond', 'Wijzig'],
];
const SERIES_PLACE = { opening: 'websiteOpening', quote: 'websiteQuote', detail: 'catalogueDetail', overview: 'catalogueOverview' } as const;
for (const [name, key, value, why, chip, button] of whyCases) {
  test(`4.4 row ${name}`, () => {
    const item = row(example({ [SERIES_PLACE[key]]: value }), key);
    assert.deepEqual([item.why, item.chip, item.action?.label ?? null], [why, chip, button]);
    assert.equal(item.warn, chip === 'Geen foto' || chip === 'Je keuze wordt niet getoond');
    assert.equal(item.photo?.key ?? null, value.shownKey);
  });
}

test('4.4 the size "Groot en breed" is said on the row of the large photo only', () => {
  const data = example({}, { catalogueDetailSize: 'LARGE' });
  assert.equal(row(data, 'detail').why, 'Nu de catalogusfoto van Kersenroze. Formaat: groot en breed.');
  assert.equal(row(data, 'overview').why, 'Nu dezelfde als de grote foto.');
  const chosen = example({ catalogueDetail: place('catalogueDetail', 'F242', 'CHOSEN') }, { catalogueDetailSize: 'LARGE' });
  assert.equal(row(chosen, 'detail').why, 'Grote foto van de reeks, alleen in de Handelscatalogus. Formaat: groot en breed.');
});

test('4.4 series not live: the opening row speaks of later; a warn row counts for the folded summary', () => {
  const data = example({ websiteQuote: place('websiteQuote', null, 'NONE', 'NO_PHOTO') }, { seriesLiveOnWebsite: false });
  assert.equal(row(data, 'opening').why, 'Opent met deze foto zodra de reeks op de website staat.');
  assert.equal(seriesAttention(seriesRows(data)), '1 foto vraagt aandacht');
  const two = example({
    websiteQuote: place('websiteQuote', null, 'NONE', 'NO_PHOTO'),
    catalogueDetail: place('catalogueDetail', 'F179', 'CHOSEN_NOT_SHOWN', 'CHOICE_NOT_AVAILABLE', { chosenKey: 'F243' }),
  });
  assert.equal(seriesAttention(seriesRows(two)), '2 foto’s vragen aandacht');
});

test('4.4 a sentence that needs the colour and gets none falls back; an unknown reason gives the chip and no sentence', () => {
  const nameless = { relatedProductId: 101, relatedLabel: null, thisColour: false };
  assert.equal(placeWhy(place('websiteQuote', 'F214', 'AUTOMATIC', 'FIRST_COLOUR_WEBSITE_PHOTO', nameless), 'quote'), 'Nu de eerste websitefoto van de reeks.');
  assert.equal(placeWhy(place('catalogueDetail', 'F179', 'AUTOMATIC', 'OTHER_COLOUR_LEAD_OVERRIDES', nameless), 'detail'), 'Nu de eerste catalogusfoto van de reeks.');
  assert.equal(placeWhy(place('catalogueDetail', 'F179', 'AUTOMATIC', 'OWN_PHOTO_FILLER', nameless), 'detail'), 'Nu de eerste catalogusfoto van de reeks.');
  assert.equal(placeWhy(place('websiteOpening', 'F214', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER', nameless), 'opening'), 'Opent met deze foto. Nu een foto voor alle kleuren.');
  const unknown = example({ websiteQuote: place('websiteQuote', 'F242', 'AUTOMATIC', 'A_RULE_OF_NEXT_YEAR' as PhotoPlaceReason) });
  assert.deepEqual([row(unknown, 'quote').why, row(unknown, 'quote').chip, row(unknown, 'quote').action?.label], ['', 'Automatisch gekozen', 'Wijzig']);
  for (const item of seriesRows(unknown)) assert.doesNotMatch(item.why, /A_RULE|[A-Z]{3,}_/, 'A reason code is never printed');
});

test('4.4 the page opens with a colour’s own photo ("P" key): the row says so and offers no order', () => {
  const data = example({ websiteOpening: place('websiteOpening', 'P5755', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER', ROOD) }, { otherPhotos: [P5755] });
  const item = row(data, 'opening');
  assert.deepEqual([item.photo, item.why, item.chip, item.action],
    [P5755, 'Er staat nog geen reeksfoto op de website. De pagina opent met een eigen foto van Rood.', 'Eerste foto van de reeks', null]);
});

test('4.4 a series of demo products only: the two catalogue rows say so, neutral and without a button', () => {
  const data = example({
    catalogueDetail: place('catalogueDetail', null, 'NONE', 'COLOUR_NOT_ACTIVE'),
    catalogueOverview: place('catalogueOverview', null, 'CHOSEN_NOT_SHOWN', 'COLOUR_NOT_ACTIVE', { chosenKey: 'F242' }),
  });
  for (const key of ['detail', 'overview'] as const) {
    const item = row(data, key);
    assert.deepEqual([item.photo, item.why, item.chip, item.tone, item.warn, item.action],
      [null, 'Deze reeks heeft alleen demo-producten en komt niet in een catalogus.', 'Geen foto', 'neutral', false, null]);
  }
});

test('4.4 the line under the strip names the assumed pdf, and inactive colours when the series has one', () => {
  const data = example();
  const active = [{ productId: 100, active: true }, { productId: 101, active: true }, { productId: 127, active: true }];
  assert.equal(catalogueAssumptionLine(data, active),
    'Catalogus = een Handelscatalogus met alle kleuren van deze reeks. Een pdf, offerte of factuur die al verstuurd is, verandert niet meer.');
  assert.equal(catalogueAssumptionLine(data, [active[0], { productId: 101, active: false }, active[2]]),
    'Catalogus = een Handelscatalogus met alle kleuren van deze reeks. '
    + 'Ook niet-actieve kleuren tellen mee; haal ze weg in de Catalogusstudio als ze niet in de pdf horen. '
    + 'Een pdf, offerte of factuur die al verstuurd is, verandert niet meer.');
  assert.equal(catalogueAssumptionLine(data, [...active, { productId: 300, active: false }]), catalogueAssumptionLine(data, active),
    'An inactive demo colour is not in the assumed pdf');
  assert.equal(catalogueAssumptionLine(null), catalogueAssumptionLine(data, active));
});

/* ----------------------------------------------------- 4.6 tile foot rows */

test('4.6 tile: photo of a colour place carries accent chips and names the series places it also holds', () => {
  const data = example();
  const foot = tileFoot(byKey(data, 'F242'), tileUses(byKey(data, 'F242'), places(data)), K);
  assert.deepEqual(foot, {
    chips: [{ label: 'Website', tone: 'accent' }, { label: 'Catalogus', tone: 'accent' }],
    text: '+ 3 plekken van de reeks', quiet: false,
    words: 'Websitefoto en catalogusfoto van Kersenroze, en op 3 plekken van de reeks',
  });
  const one: [Partial<PhotoPlaces>, string, string][] = [
    [{ catalogueDetail: place('catalogueDetail', 'F179', 'CHOSEN'), catalogueOverview: place('catalogueOverview', 'F179', 'CHOSEN') },
      '+ de bestelpagina', 'Websitefoto en catalogusfoto van Kersenroze, en op de bestelpagina'],
    [{ websiteQuote: place('websiteQuote', 'F214', 'CHOSEN'), catalogueOverview: place('catalogueOverview', 'F179', 'CHOSEN') },
      '+ de grote catalogusfoto', 'Websitefoto en catalogusfoto van Kersenroze, en als grote catalogusfoto'],
    [{ websiteQuote: place('websiteQuote', 'F214', 'CHOSEN'), catalogueDetail: place('catalogueDetail', 'F179', 'CHOSEN') },
      '+ de kleine catalogusfoto', 'Websitefoto en catalogusfoto van Kersenroze, en als kleine catalogusfoto'],
    [{ websiteQuote: place('websiteQuote', 'F214', 'CHOSEN'), catalogueDetail: place('catalogueDetail', 'F179', 'CHOSEN'),
      catalogueOverview: place('catalogueOverview', 'F179', 'CHOSEN'), websiteOpening: place('websiteOpening', 'F242', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER') },
      '+ eerste foto op de productpagina', 'Websitefoto en catalogusfoto van Kersenroze, en als eerste foto op de productpagina'],
  ];
  for (const [changes, text, words] of one) {
    const single = example(changes);
    const result = tileFoot(byKey(single, 'F242'), tileUses(byKey(single, 'F242'), places(single)), K);
    assert.deepEqual([result.text, result.words], [text, words]);
  }
});

test('4.6 tile: the "Offertes" chip appears only when documents print another photo than the website shows', () => {
  const data = example({
    websiteColour: place('websiteColour', 'F244', 'AUTOMATIC', 'OWN_COLOUR_SERIES_PHOTO'),
    documents: place('documents', 'F242', 'AUTOMATIC', 'FIRST_SERIES_PHOTO'),
  });
  const foot = tileFoot(byKey(data, 'F242'), tileUses(byKey(data, 'F242'), places(data)), K);
  assert.deepEqual(foot.chips.map((chip) => chip.label), ['Catalogus', 'Offertes']);
  assert.equal(foot.words, 'Catalogusfoto van Kersenroze, ook op offertes en facturen, en op 3 plekken van de reeks');
  const website = tileFoot(byKey(data, 'F244'), tileUses(byKey(data, 'F244'), places(data)), K);
  assert.deepEqual([website.chips.map((chip) => chip.label), website.text, website.words], [['Website'], '', 'Websitefoto van Kersenroze']);
});

test('4.6 tile: only series places', () => {
  const data = example({ websiteQuote: place('websiteQuote', 'F243', 'CHOSEN') });
  assert.deepEqual(tileFoot(byKey(data, 'F243'), tileUses(byKey(data, 'F243'), places(data)), K),
    { chips: [], text: 'Voor de hele reeks: bestelpagina', quiet: false, words: 'Voor de hele reeks: bestelpagina' });
  const two = example({ catalogueDetail: place('catalogueDetail', 'F243', 'CHOSEN'), catalogueOverview: place('catalogueOverview', 'F243', 'AUTOMATIC', 'SAME_AS_LARGE_PHOTO') });
  assert.equal(tileFoot(byKey(two, 'F243'), tileUses(byKey(two, 'F243'), places(two)), K).text, 'Voor de hele reeks: 2 plekken');
});

test('4.6 tile: documents only', () => {
  const data = example({
    websiteColour: place('websiteColour', 'F244', 'AUTOMATIC', 'OWN_COLOUR_SERIES_PHOTO'),
    documents: place('documents', 'F243', 'AUTOMATIC', 'FIRST_SERIES_PHOTO'),
  });
  assert.deepEqual(tileFoot(byKey(data, 'F243'), tileUses(byKey(data, 'F243'), places(data)), K),
    { chips: [], text: 'Alleen op offertes en facturen', quiet: false, words: 'Alleen op offertes en facturen' });
});

test('4.6 tile: extra website photo, allowed in the catalogue, not in use', () => {
  const data = example();
  const foot = (key: string, view: 'colour' | 'series' = 'colour') => tileFoot(byKey(data, key), tileUses(byKey(data, key), places(data)), K, view);
  assert.deepEqual(foot('F244'), { chips: [], text: 'Extra foto op de website', quiet: false, words: 'Extra foto op de website' });
  assert.deepEqual(foot('F250'), { chips: [{ label: 'Alle kleuren', tone: 'neutral' }], text: 'Mag in de catalogus', quiet: false, words: 'Mag in de catalogus' });
  assert.deepEqual(foot('F250', 'series').chips, [], 'Under "Hele reeks" the group title says it');
  assert.deepEqual(foot('F243'), { chips: [], text: 'Niet in gebruik', quiet: true, words: 'Niet in gebruik' });
  assert.equal(photoTileLabel(byKey(data, 'F243'), K, 1, 6, tileUses(byKey(data, 'F243'), places(data))), 'Foto 2 van 6. Niet in gebruik. Open voor alle keuzes.');
  assert.equal(photoTileLabel(byKey(data, 'F250'), K, 3, 6, tileUses(byKey(data, 'F250'), places(data))),
    'Foto 4 van 6. Voor alle kleuren. Mag in de catalogus. Open voor alle keuzes.');
});

test('4.6 tile: a photo of another colour shows its series places, else whether it is on the website', () => {
  const data = example();
  const foot = (key: string) => tileFoot(byKey(data, key), tileUses(byKey(data, key), places(data)), K, 'series');
  assert.equal(foot('F214').text, 'Voor de hele reeks: eerste foto op de productpagina');
  assert.equal(foot('F256').text, 'Extra foto op de website');
  assert.equal(foot('F179').text, 'Niet op de website');
});

test('4.6 tile: "Dubbel" stays on a tile only while a place uses the duplicate', () => {
  const data = example({ documents: place('documents', 'P5501', 'AUTOMATIC', 'FIRST_OWN_PHOTO') });
  const duplicate = photo('P5501', { duplicateOfKey: 'F242' });
  const used = tileFoot(duplicate, tileUses(duplicate, places(data)), K);
  assert.deepEqual(used.chips, [{ label: 'Dubbel', tone: 'warn' }]);
  assert.equal(photoTileLabel(duplicate, K, 0, 2, tileUses(duplicate, places(data))), 'Foto 1 van 2. Dubbele foto. Alleen op offertes en facturen. Open voor alle keuzes.');
  assert.deepEqual(tileFoot(duplicate, tileUses(duplicate, places(example())), K).chips, []);
  assert.deepEqual(duplicatesNote(1, K), { strong: '1 dubbele foto.', rest: 'Dezelfde foto staat twee keer bij Kersenroze.', action: 'Opruimen' });
  assert.deepEqual(duplicatesNote(3, K), { strong: '3 dubbele foto’s.', rest: 'Dezelfde foto’s staan twee keer bij Kersenroze.', action: 'Opruimen' });
});

test('4.6 headings, empty states and group titles per view', () => {
  assert.deepEqual(galleryTexts('colour', K), {
    heading: 'Alle foto’s van Kersenroze', emptyTitle: 'Nog geen foto’s voor Kersenroze', emptyText: 'Voeg een foto toe, of kijk bij ‘Hele reeks’.',
  });
  assert.deepEqual(galleryTexts('series', K), {
    heading: 'Alle foto’s van de reeks', emptyTitle: 'Nog geen foto’s in deze reeks', emptyText: 'Voeg een foto toe; daarna kies je waar hij komt.',
  });
  const data = example();
  assert.deepEqual(keys(colourPhotos(data)), ['F242', 'F243', 'F244', 'F250']);
  const groups = seriesPhotoGroups(data, K, [{ productId: 100, position: 0 }, { productId: 101, position: 1 }, { productId: 127, position: 2 }]);
  assert.deepEqual(groups.map((group) => [group.label, keys(group.photos)]), [
    ['Kersenroze · deze kleur', ['F242', 'F243', 'F244']],
    ['Alle kleuren', ['F250']],
    ['Rood', ['F214', 'F179']],
    ['Bordeaux', ['F255', 'F256']],
  ]);
  assert.deepEqual(seriesPhotoGroups(data, K, [{ productId: 127, position: 0 }, { productId: 101, position: 1 }]).slice(2).map((group) => group.label),
    ['Bordeaux', 'Rood'], 'Other colours stand in variant order');
  assert.deepEqual(seriesPhotoGroups(null, K), []);
  assert.deepEqual(keys(seriesInFamilyOrder(data)), ['F214', 'F179', 'F242', 'F243', 'F244', 'F250', 'F255', 'F256']);
});

/* ---------------------------------------------------------------- pickers */

test('picker texts: title, sentence, upload bar, automatic row and footnote per place', () => {
  const data = example();
  const website = pickerModel(data, 'website', K)!;
  assert.deepEqual([website.kind, website.role, website.chosen, website.chosenKey, website.upload], ['website', 'MAIN', true, 'F242', true]);
  assert.deepEqual(website.texts, {
    title: 'Websitefoto van Kersenroze',
    sentence: 'Of tik op de foto die klanten bij Kersenroze op de website moeten zien. Offertes en facturen krijgen dezelfde foto. Je keuze wordt meteen bewaard.',
    upload: { title: 'Nieuwe foto uploaden', sub: 'Wordt meteen de websitefoto van Kersenroze, ook op offertes en facturen.', uploading: 'Foto uploaden…', saving: 'Bewaren…' },
    noUpload: null,
    automatic: { text: 'Liever niet zelf kiezen? De website neemt dan eerst een foto van Kersenroze, anders een foto van alle kleuren.', link: 'Laat automatisch kiezen' },
    footnote: null,
    currentLabel: 'Nu op de website', currentCaption: 'Nu op de website', notShownCaption: 'Je keuze, wordt niet getoond',
    empty: 'Er is nog geen foto die hier kan staan.', saving: 'Bewaren…', pickVerb: 'Kies als websitefoto van Kersenroze', size: null,
  });
  const catalogue = pickerModel(data, 'catalogue', K)!.texts;
  assert.deepEqual([catalogue.title, catalogue.sentence, catalogue.upload?.sub, catalogue.automatic?.text, catalogue.footnote, catalogue.currentLabel], [
    'Catalogusfoto van Kersenroze',
    'Of tik op de foto die bij Kersenroze in de catalogus moet staan. Je keuze wordt meteen bewaard en geldt vanaf de volgende pdf.',
    'Wordt meteen de catalogusfoto van Kersenroze.',
    'Liever niet zelf kiezen? De catalogus neemt dan zelf de eerste foto van Kersenroze.',
    'Foto’s die bij alle kleuren horen staan hier niet: in de Handelscatalogus komt bij een kleur alleen een foto van die kleur zelf.',
    'Nu in de catalogus',
  ]);
  const seriesNote = 'Alleen in de Handelscatalogus. Het Compact overzicht gebruikt de catalogusfoto van elke kleur. '
    + 'Staat de kleur van deze foto niet in een pdf, dan kiest die pdf zelf een andere.';
  const chosen = example({
    websiteQuote: place('websiteQuote', 'F242', 'CHOSEN'), catalogueDetail: place('catalogueDetail', 'F242', 'CHOSEN'),
    catalogueOverview: place('catalogueOverview', 'F242', 'CHOSEN'),
  });
  const series = (['quote', 'detail', 'overview'] as const).map((kind) => pickerModel(chosen, kind, K)!.texts);
  assert.deepEqual(series.map((texts) => [texts.title, texts.sentence, texts.automatic?.text, texts.footnote, texts.currentLabel, texts.pickVerb]), [
    ['Foto op de bestelpagina',
      'Tik op de foto die klanten bij deze reeks zien in de bestellijst en bij ‘Vraag een offerte’. Dit geldt voor alle kleuren.',
      'Liever niet zelf kiezen? De bestelpagina neemt dan de websitefoto van de eerste kleur.', null, 'Nu op de bestelpagina', 'Kies als foto op de bestelpagina'],
    ['Grote catalogusfoto van de reeks',
      'Tik op de grote foto voor deze reeks in de Handelscatalogus. Dit geldt voor alle kleuren, vanaf de volgende pdf.',
      'Liever niet zelf kiezen? De catalogus neemt dan de catalogusfoto van de eerste kleur die er zelf een gekozen heeft, anders de eerste catalogusfoto van de reeks.',
      seriesNote, 'Nu de grote foto', 'Kies als grote catalogusfoto van de reeks'],
    ['Kleine catalogusfoto van de reeks',
      'Tik op de kleine foto voor het overzicht van deze reeks in de Handelscatalogus. Dit geldt voor alle kleuren, vanaf de volgende pdf.',
      'Liever niet zelf kiezen? De catalogus neemt dan dezelfde foto als de grote foto.', seriesNote, 'Nu de kleine foto', 'Kies als kleine catalogusfoto van de reeks'],
  ]);
  for (const texts of series) assert.deepEqual([texts.upload, texts.noUpload], [null, 'Nieuwe foto? Voeg hem eerst toe bij ‘Alle foto’s’.']);
  assert.deepEqual(series[1].size, { label: 'Formaat', standard: 'Standaard', large: 'Groot en breed' });
  assert.deepEqual([pickerModel(chosen, 'detail', K)!.detailSize, pickerModel(chosen, 'quote', K)!.detailSize], ['STANDARD', null]);
});

test('picker: an automatic place says so; a series that is not live adds the footnote to the website pickers', () => {
  const data = example({ websiteColour: place('websiteColour', 'F242', 'AUTOMATIC', 'OWN_COLOUR_SERIES_PHOTO') }, { seriesLiveOnWebsite: false });
  const texts = pickerModel(data, 'website', K)!.texts;
  assert.deepEqual(texts.automatic, { text: 'Deze foto is automatisch gekozen. Tik op een foto om zelf te kiezen.', link: null });
  assert.equal(texts.currentCaption, 'Nu op de website, automatisch gekozen');
  assert.equal(texts.footnote, 'Deze reeks staat nog niet op de website. Je keuze geldt zodra ze online staat.');
  assert.equal(pickerModel(data, 'quote', K)!.texts.footnote, texts.footnote, 'Bestelpagina as Website');
  assert.equal(pickerTexts('website', K, place('websiteColour', null, 'NONE', 'NO_PHOTO'), true).automatic, null);
});

test('picker candidates: the photo of now first, then the gallery order; the Catalogus picker takes this colour’s photos only', () => {
  const data = example({ websiteColour: place('websiteColour', 'F244', 'CHOSEN'), catalogueColour: place('catalogueColour', 'F243', 'CHOSEN') });
  assert.deepEqual(keys(placeCandidates(data, 'website')), ['F244', 'F242', 'F243', 'F250'], 'This colour and all colours');
  assert.deepEqual(keys(placeCandidates(data, 'catalogue')), ['F243', 'F242', 'F244'], 'A photo of all colours is never printed next to a colour');
  assert.deepEqual(keys(placeCandidates(data, 'quote')), ['F242', 'F243', 'F244', 'F250', 'F214', 'F179', 'F255', 'F256']);
  assert.deepEqual(keys(placeCandidates(data, 'overview')).length, 8);
  assert.deepEqual(placeCandidates(null, 'website'), []);
  // A stored choice that is not shown stays visible, also when it could not be picked today.
  const stale = example({ catalogueColour: place('catalogueColour', 'F243', 'CHOSEN_NOT_SHOWN', 'ALL_COLOURS_PHOTO_NOT_USED_PER_COLOUR', { chosenKey: 'F250' }) });
  const picker = pickerModel(stale, 'catalogue', K)!;
  assert.deepEqual(picker.tiles.map((tile) => [tile.photo.key, tile.current, tile.notShown, tile.caption, tile.captionTone]), [
    ['F243', true, false, 'Nu in de catalogus, automatisch gekozen', 'accent'],
    ['F242', false, false, 'Websitefoto van Kersenroze, en op 3 plekken van de reeks', 'quiet'],
    ['F244', false, false, 'Extra foto op de website', 'quiet'],
    ['F250', false, true, 'Je keuze, wordt niet getoond', 'warn'],
  ]);
  assert.equal(picker.texts.automatic?.link, 'Laat automatisch kiezen', 'A stored choice can be cleared also when it is not shown');
});

test('picker tiles: names for the pick buttons and "Bekijk groot"; one photo and no photo', () => {
  const data = example();
  data.photos = [data.photos[0], data.photos[1], photo('F245'), data.photos[2]];
  const picker = pickerModel(data, 'catalogue', K)!;
  assert.deepEqual(picker.tiles.map((tile) => [tile.label, tile.compareLabel]), [
    ['Foto 1 van 4. Nu in de catalogus.', null],
    ['Foto 2 van 4. Niet in gebruik. Kies als catalogusfoto van Kersenroze.', 'Bekijk foto 2 groot, naast de foto van nu'],
    ['Foto 3 van 4. Niet in gebruik. Kies als catalogusfoto van Kersenroze.', 'Bekijk foto 3 groot, naast de foto van nu'],
    ['Foto 4 van 4. Extra foto op de website. Kies als catalogusfoto van Kersenroze.', 'Bekijk foto 4 groot, naast de foto van nu'],
  ]);
  assert.equal(picker.current?.key, 'F242');
  data.photos = [data.photos[0]];
  assert.deepEqual(pickerModel(data, 'catalogue', K)!.tiles.map((tile) => tile.compareLabel), [null], 'Nothing to compare the only photo with');
  const empty = example({ websiteColour: place('websiteColour', null, 'NONE', 'NO_PHOTO') }, { photos: [] });
  const none = pickerModel(empty, 'website', K)!;
  assert.deepEqual([none.tiles, none.current, none.texts.empty, none.upload, none.texts.automatic], [[], null, 'Er is nog geen foto die hier kan staan.', true, null]);
  assert.equal(pickerModel(null, 'website', K), null);
  assert.equal(pickerTarget(places(example()), 'quote').role, 'QUOTE');
});

test('"Bekijk groot": the counter and the line under the two pictures', () => {
  assert.equal(compareCounter(0, 3), '1 van 3 andere foto’s');
  assert.equal(compareCounter(0, 1), '1 andere foto');
  assert.equal(compareLine(byKey(example(), 'F243'), 'Niet in gebruik'), 'F243.png · 1536 × 1024 px · Niet in gebruik. Er is nog niets gewijzigd.');
  assert.equal(photoFileLine({ originalFilename: 'a.jpg', widthPx: null, heightPx: null }, '1,2 MB'), 'a.jpg · 1,2 MB');
  assert.equal(photoFileLine(P5755), 'product-101-pvc-transparent-v3.png · 1536 × 1024 px');
});

test('role rules behind the pickers: per colour, website-only order page, whole series for the catalogue', () => {
  const data = example();
  assert.equal(canUseForRole(byKey(data, 'F214'), 'CATALOGUE_VARIANT'), false, 'Another colour cannot be this colour’s catalogue photo');
  assert.equal(canUseForRole(byKey(data, 'F214'), 'QUOTE'), true);
  assert.equal(canUseForRole(photo('P5501'), 'QUOTE'), false, 'An own photo only when it is on the website');
  assert.equal(canUseForRole(photo('P5501', { visibility: { website: true, catalogue: false, orderApp: false } }), 'QUOTE'), true);
  assert.equal(publishTargetForRole(byKey(data, 'F243'), 'QUOTE'), 'website');
  assert.equal(publishTargetForRole(byKey(data, 'F243'), 'CATALOGUE_DETAIL'), 'catalogue');
  assert.equal(publishTargetForRole(byKey(data, 'F242'), 'CATALOGUE_VARIANT'), null, 'Already in the catalogue');
  assert.equal(publishTargetForRole(photo('P5501'), 'MAIN'), 'website', 'The public gallery always shows a colour’s own lead');
  assert.equal(publishTargetForRole(photo('P5501'), 'CATALOGUE_OVERVIEW'), null, 'Series-wide choices never publish an own photo');
  const stuck = { ...byKey(data, 'F244'), publishable: false };
  assert.equal(canUseForRole(stuck, 'CATALOGUE_VARIANT'), false, 'It could not be published to the catalogue');
  assert.equal(canUseForRole(stuck, 'MAIN'), true, 'Already on the website, nothing to publish');
});

/* ------------------------------------------------- what a save changed */

test('a catalogue choice of the first colour moves the large and the small photo, and the toast says so', () => {
  const before = examplePlaces({
    catalogueColour: place('catalogueColour', 'F242', 'AUTOMATIC', 'OWN_COLOUR_SERIES_PHOTO'),
    catalogueDetail: place('catalogueDetail', 'F179', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER', ROOD),
    catalogueOverview: place('catalogueOverview', 'F179', 'AUTOMATIC', 'SAME_AS_LARGE_PHOTO', ROOD),
    catalogueCompactRow: place('catalogueCompactRow', 'F242', 'AUTOMATIC', 'FIRST_SERIES_PHOTO'),
  });
  const after = examplePlaces({
    catalogueColour: place('catalogueColour', 'F243', 'CHOSEN'),
    catalogueDetail: place('catalogueDetail', 'F243', 'AUTOMATIC', 'THIS_COLOUR_LEAD'),
    catalogueOverview: place('catalogueOverview', 'F243', 'AUTOMATIC', 'SAME_AS_LARGE_PHOTO'),
    catalogueCompactRow: place('catalogueCompactRow', 'F243', 'CHOSEN'),
  });
  assert.deepEqual(changedPlaces(before, after), ['catalogueColour', 'catalogueDetail', 'catalogueOverview', 'catalogueCompactRow']);
  assert.equal(placeSavedMessage('catalogue', K, before, after),
    'Catalogusfoto van Kersenroze gewijzigd. Ook de grote en de kleine catalogusfoto van de reeks tonen nu deze foto.');
  assert.deepEqual(changedPlaces(before, before), []);
  assert.deepEqual(changedPlaces(null, after), []);
  assert.equal(placeSavedMessage('catalogue', K, after, after), 'Catalogusfoto van Kersenroze gewijzigd.');
  // Only the large photo follows when the small one is chosen itself.
  const largeOnly = { ...after, catalogueOverview: before.catalogueOverview };
  assert.equal(placeSavedMessage('catalogue', K, before, largeOnly),
    'Catalogusfoto van Kersenroze gewijzigd. Ook de grote catalogusfoto van de reeks toont nu deze foto.');
});

test('toasts of 4.10: website, series places, back to automatic, own choice, repair and undo', () => {
  const before = examplePlaces();
  const after = examplePlaces({
    websiteColour: place('websiteColour', 'F244', 'CHOSEN'), documents: place('documents', 'F244', 'CHOSEN'),
    websiteQuote: place('websiteQuote', 'F244', 'AUTOMATIC', 'FIRST_COLOUR_WEBSITE_PHOTO'),
  });
  const website = 'Websitefoto van Kersenroze gewijzigd. Offertes en facturen krijgen dezelfde foto; de offertepagina van de klant kan een dag achterlopen.';
  assert.equal(placeSavedMessage('website', K, before, after), `${website} Ook de bestelpagina toont nu deze foto.`);
  assert.equal(placeSavedMessage('website', K, before, { ...after, websiteQuote: before.websiteQuote }), website, 'Documents are named in the sentence itself');
  assert.equal(placeSavedMessage('website', K, null, null), website);
  const large = examplePlaces({ catalogueDetail: place('catalogueDetail', 'F243', 'CHOSEN'), catalogueOverview: place('catalogueOverview', 'F243', 'AUTOMATIC', 'SAME_AS_LARGE_PHOTO') });
  assert.equal(placeSavedMessage('detail', K, before, large),
    'Grote catalogusfoto gewijzigd. Geldt voor alle kleuren. Ook de kleine catalogusfoto van de reeks toont nu deze foto.');
  assert.equal(placeSavedMessage('quote', K, before, before), 'Bestelpagina gewijzigd. Geldt voor alle kleuren.');
  assert.equal(placeSavedMessage('overview', K, before, before), 'Kleine catalogusfoto gewijzigd. Geldt voor alle kleuren.');
  assert.equal(placeSavedMessage('website', K, before, after, 'cleared'), 'Website: wordt weer automatisch gekozen.');
  assert.equal(placeSavedMessage('catalogue', K, before, after, 'pinned'), 'Catalogus: deze foto is nu zelf gekozen.');
  assert.equal(placeSavedMessage('quote', K, before, after, 'repaired'), 'Bestelpagina: je gekozen foto wordt weer getoond.');
  assert.equal(placeSavedMessage('catalogue', K, before, after, 'undone'), 'Ongedaan gemaakt: de catalogus toont weer de vorige foto.');
  assert.equal(placeSavedMessage('detail', K, before, after, 'undone'), 'Ongedaan gemaakt: de grote catalogusfoto toont weer de vorige foto.');
  assert.equal(PHOTO_MESSAGES.documentsUseWebsite, 'Offertes en facturen tonen nu de websitefoto.');
  assert.equal(PHOTO_MESSAGES.undoLeftOnWebsite,
    'De keuze is teruggezet, maar de foto staat nog als extra foto op de website. Zet dat uit bij de foto, onder ‘Meer instellingen’.');
  assert.equal(PHOTO_MESSAGES.undoLeftInCatalogue,
    'De keuze is teruggezet, maar de foto mag nog in de catalogus. Zet dat uit bij de foto, onder ‘Meer instellingen’.');
  assert.equal(PHOTO_MESSAGES.undoRefused, 'De wijziging is niet teruggezet.');
  assert.deepEqual([PHOTO_MESSAGES.sizeLarge, PHOTO_MESSAGES.sizeStandard], ['Grote catalogusfoto: groot en breed', 'Grote catalogusfoto: standaard formaat']);
});

test('toasts of 4.10: order, switches, colours and the photo that became the document photo', () => {
  const before = examplePlaces();
  assert.equal(orderSavedMessage(before, before), 'Volgorde bewaard. Geldt voor alle kleuren.');
  const opening = examplePlaces({ websiteOpening: place('websiteOpening', 'F256', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER') });
  assert.equal(orderSavedMessage(before, opening), 'Volgorde bewaard. Geldt voor alle kleuren. Let op: de productpagina toont nu een andere foto.');
  const more = examplePlaces({
    websiteOpening: place('websiteOpening', 'F256', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER'),
    documents: place('documents', 'F243', 'AUTOMATIC', 'FIRST_SERIES_PHOTO'),
    catalogueDetail: place('catalogueDetail', 'F179', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER'),
  });
  assert.equal(orderSavedMessage(before, more),
    'Volgorde bewaard. Geldt voor alle kleuren. Let op: de productpagina, offertes en facturen en de grote catalogusfoto tonen nu een andere foto.');
  assert.equal(documentsMovedNote(before, more), ' Let op: offertes en facturen tonen nu deze foto.');
  assert.equal(documentsMovedNote(before, opening), '');
  assert.equal(channelSavedMessage([], ['WEBSITE']), 'Foto staat nu als extra foto op de website');
  assert.equal(channelSavedMessage(['WEBSITE', 'CATALOGUE'], ['CATALOGUE']), 'Foto staat niet meer als extra foto op de website');
  assert.equal(channelSavedMessage(['WEBSITE'], ['WEBSITE', 'CATALOGUE']), 'Foto mag nu in de catalogus');
  assert.equal(channelSavedMessage(['CATALOGUE'], []), 'Foto mag niet meer in de catalogus');
  assert.equal(channelSavedMessage(['WEBSITE'], ['WEBSITE', 'ORDER_APP']), 'Bestelapp aangepast (verandert voor klanten niets)');
  assert.equal(scopeSavedMessage(true, K), 'Foto hoort nu bij alle kleuren');
  assert.equal(scopeSavedMessage(false, K), 'Foto hoort nu alleen bij Kersenroze');
});

/* ---------------------------------------------------------- upload and use */

test('upload and use: the image is identified in the server’s own order, admin upload before the same large rendition', () => {
  const sha = 'ab'.repeat(32);
  const images = [
    { id: 1, sourceKey: 'import-1', largeSha256: sha.toUpperCase(), position: 3 },
    { id: 2, sourceKey: 'import-2', largeSha256: sha, position: 1 },
    { id: 3, sourceKey: `admin-${sha}`, largeSha256: 'ff', position: 9 },
  ];
  assert.equal(uploadedImage(images, sha.toUpperCase())?.id, 3, 'The server reuses the admin upload of these bytes');
  assert.equal(uploadedImage(images.slice(0, 2), sha)?.id, 2, 'Else the lowest position with the same large rendition, compared without case');
  assert.equal(uploadedImage(images, 'cd'.repeat(32)), null);
  // Without crypto.subtle: exactly one id that was not there before.
  assert.equal(uploadedImage(images, null, [1, 2])?.id, 3);
  assert.equal(uploadedImage(images, null, [1, 2, 3]), null, 'A reused photo cannot be named');
  assert.equal(uploadedImage(images, null, [1]), null);
});

test('upload and use: a reused photo of another colour or of all colours is never relinked', () => {
  const data = example();
  assert.equal(uploadUseVerdict({ variantProductId: 100 }, 100, 'catalogue', places(data)), 'ok');
  assert.equal(uploadUseVerdict({ variantProductId: 101 }, 100, 'website', places(data)), 'otherColour');
  assert.equal(uploadUseVerdict({ variantProductId: null }, 100, 'website', places(data)), 'ok');
  assert.equal(uploadUseVerdict({ variantProductId: null }, 100, 'catalogue', places(data)), 'allColours');
  assert.equal(uploadUseVerdict({ variantProductId: null }, 100, 'catalogue', null), 'allColours');
  assert.equal(uploadUseMessage('reused', K), 'Deze foto stond al bij Kersenroze en is nu gekozen.');
  assert.equal(uploadUseMessage('otherColour', K, 'Rood'), 'Deze foto staat al in de reeks bij Rood. Er is niets gewijzigd.');
  assert.equal(uploadUseMessage('allColours', K),
    'Deze foto staat al in de reeks voor alle kleuren. In de Handelscatalogus komt bij een kleur alleen een foto van die kleur zelf. Er is niets gewijzigd.');
  assert.equal(uploadUseMessage('roleFailed', K, 'Foto kan nog niet gepubliceerd worden.'), 'De foto is toegevoegd, maar nog niet gekozen: Foto kan nog niet gepubliceerd worden.');
  assert.equal(uploadUseMessage('roleFailed', K, 'Geen verbinding'), 'De foto is toegevoegd, maar nog niet gekozen: Geen verbinding.');
  assert.equal(uploadUseMessage('unidentified', K), 'Deze foto staat al in de reeks. Kies hem in de lijst.');
  assert.equal(PHOTO_MESSAGES.retry, 'Opnieuw proberen');
});

test('upload and use: success is read from the place the card is fed by, never from the request', () => {
  const data = example();
  assert.equal(placeShowsChoice(data, 'website', 'F242'), true);
  assert.equal(placeShowsChoice(data, 'catalogue', 'F242'), true);
  const notShown = example({ catalogueColour: place('catalogueColour', 'F242', 'CHOSEN_NOT_SHOWN', 'NOT_PUBLISHABLE', { chosenKey: 'F243' }) });
  assert.equal(placeShowsChoice(notShown, 'catalogue', 'F243'), false, 'Saved, but the place does not show it');
  assert.equal(placeShowsChoice(notShown, 'catalogue', 'F242'), false, 'Shown, but not as the owner’s choice');
  assert.equal(placeShowsChoice(null, 'website', 'F242'), false);
  // An old server: main / catalogueVariant explicit and the new key.
  assert.equal(placeShowsChoice(legacy(), 'website', 'F242'), true);
  assert.equal(placeShowsChoice(legacy(), 'catalogue', 'F242'), true);
  assert.equal(placeShowsChoice(legacy({ main: { key: 'F242', explicit: false } }), 'website', 'F242'), false);
});

/* ------------------------------------------------------------ photo sheet */

test('switch lock: a stored choice keeps its switch on, for every colour that chose the photo', () => {
  const data = example();
  const own = byKey(data, 'F242');
  assert.deepEqual(switchLock(own, places(data), 'WEBSITE', K),
    { locked: true, help: 'Blijft aan: dit is de gekozen websitefoto van Kersenroze. Kies daar eerst een andere foto.' });
  assert.deepEqual(switchLock(own, places(data), 'CATALOGUE', K),
    { locked: true, help: 'Blijft aan: dit is de gekozen catalogusfoto van Kersenroze. Kies daar eerst een andere foto.' });
  assert.equal(switchLock(own, places(data), 'ORDER_APP', K), null);
  // A photo of all colours that Rood chose: Kersenroze's places do not show it, chosenFor does.
  const shared = { ...byKey(data, 'F250'), publishedChannels: ['WEBSITE', 'CATALOGUE'] as ProductPhotoOverviewPhoto['publishedChannels'],
    chosenFor: [{ productId: 101, variantLabel: 'Rood', role: 'MAIN' as const }] };
  assert.deepEqual(switchLock(shared, places(data), 'WEBSITE', K),
    { locked: true, help: 'Blijft aan: dit is de gekozen websitefoto van Rood. Kies daar eerst een andere foto.' });
  assert.equal(switchLock(shared, places(data), 'CATALOGUE', K), null, 'Rood chose it for the website only');
  const series = example({
    websiteQuote: place('websiteQuote', 'F244', 'CHOSEN'),
    catalogueDetail: place('catalogueDetail', 'F250', 'CHOSEN'),
    catalogueOverview: place('catalogueOverview', 'F255', 'CHOSEN'),
  });
  assert.equal(switchLock(byKey(series, 'F244'), places(series), 'WEBSITE', K)?.help, 'Blijft aan: dit is de gekozen foto op de bestelpagina. Kies daar eerst een andere foto.');
  assert.equal(switchLock(byKey(series, 'F250'), places(series), 'CATALOGUE', K)?.help, 'Blijft aan: dit is de gekozen grote catalogusfoto. Kies daar eerst een andere foto.');
  assert.equal(switchLock(byKey(series, 'F255'), places(series), 'CATALOGUE', K)?.help, 'Blijft aan: dit is de gekozen kleine catalogusfoto. Kies daar eerst een andere foto.');
});

test('switch lock: a stored choice whose switch is off is the repair case, not a lock', () => {
  const data = example({ websiteColour: place('websiteColour', 'F244', 'CHOSEN_NOT_SHOWN', 'NOT_PUBLISHED_FOR_WEBSITE', { chosenKey: 'F242' }) });
  const off = { ...byKey(data, 'F242'), visibility: { website: false, catalogue: true, orderApp: false },
    publishedChannels: ['CATALOGUE'] as ProductPhotoOverviewPhoto['publishedChannels'] };
  assert.deepEqual(switchLock(off, places(data), 'WEBSITE', K),
    { locked: false, help: 'Dit is de gekozen websitefoto van Kersenroze, maar hij staat uit. Zet aan om hem weer te tonen.' });
  const catalogueOff = { ...byKey(data, 'F242'), publishedChannels: ['WEBSITE'] as ProductPhotoOverviewPhoto['publishedChannels'] };
  assert.deepEqual(switchLock(catalogueOff, places(data), 'CATALOGUE', K),
    { locked: false, help: 'Dit is de gekozen catalogusfoto van Kersenroze, maar hij staat uit. Zet aan om hem weer te tonen.' });
});

test('switch lock: the automatic photo of a place can be switched off, with a word on what follows', () => {
  const data = example({
    websiteColour: place('websiteColour', 'F244', 'AUTOMATIC', 'OWN_COLOUR_SERIES_PHOTO'),
    documents: place('documents', 'F244', 'AUTOMATIC', 'FIRST_SERIES_PHOTO'),
  });
  assert.deepEqual(switchLock(byKey(data, 'F244'), places(data), 'WEBSITE', K),
    { locked: false, help: 'Zet je dit uit, dan kiest de website zelf een andere foto. Offertes en facturen blijven deze foto tonen.' });
  assert.deepEqual(switchLock(byKey(data, 'F214'), places(data), 'WEBSITE', K),
    { locked: false, help: 'Zet je dit uit, dan kiest de website zelf een andere foto.' }, 'It opens the product page');
  assert.equal(switchLock(byKey(data, 'F256'), places(data), 'WEBSITE', K), null, 'A plain extra photo');
  assert.equal(switchLock(byKey(data, 'F243'), places(data), 'WEBSITE', K), null);
  assert.equal(switchLock(byKey(data, 'F243'), null, 'WEBSITE', K), null);
});

test('photo sheet: the sentence with the eye names every place, the series ones included', () => {
  const data = example();
  const seen = (key: string) => seenSentence(byKey(data, key), places(data));
  assert.equal(seen('F242'), 'Klanten zien deze foto nu op de website, in de catalogus, op offertes en facturen, op de bestelpagina, als grote catalogusfoto en als kleine catalogusfoto.');
  assert.equal(seen('F244'), 'Klanten zien deze foto nu alleen als extra foto op de website.');
  assert.equal(seen('F243'), 'Klanten zien deze foto nu nergens.');
  assert.equal(seen('F250'), 'Klanten zien deze foto nu niet. Hij mag wel in de catalogus.');
  assert.equal(seen('F214'), 'Klanten zien deze foto nu als eerste foto op de productpagina.');
  const documents = example({ websiteColour: place('websiteColour', 'F244', 'CHOSEN'), documents: place('documents', 'F243', 'AUTOMATIC', 'FIRST_SERIES_PHOTO') });
  assert.equal(seenSentence(byKey(documents, 'F243'), places(documents)), 'Klanten zien deze foto nu alleen op offertes en facturen.');
  const simple = example({
    websiteQuote: place('websiteQuote', 'F214', 'CHOSEN'), catalogueDetail: place('catalogueDetail', 'F179', 'CHOSEN'),
    catalogueOverview: place('catalogueOverview', 'F179', 'CHOSEN'),
  });
  simple.places!.websiteQuote = place('websiteQuote', 'F242', 'CHOSEN');
  assert.equal(seenSentence(byKey(simple, 'F242'), places(simple)),
    'Klanten zien deze foto nu op de website, in de catalogus, op offertes en facturen en op de bestelpagina.');
});

test('delete and colour confirmations name the places, other colours included', () => {
  const data = example();
  const own = byKey(data, 'F242');
  assert.equal(usedPlacesText(own, places(data), K, false, 100),
    'de websitefoto van Kersenroze, de catalogusfoto van Kersenroze, de foto op de bestelpagina, de grote catalogusfoto en de kleine catalogusfoto');
  const shared = { ...byKey(data, 'F250'), chosenFor: [{ productId: 101, variantLabel: 'Rood', role: 'CATALOGUE_VARIANT' as const }] };
  const both = example({ websiteColour: place('websiteColour', 'F250', 'CHOSEN'), documents: place('documents', 'F250', 'CHOSEN') });
  assert.equal(usedPlacesText(shared, places(both), K, false, 100), 'de websitefoto van Kersenroze en de catalogusfoto van Rood');
  assert.equal(usedPlacesText(shared, places(both), K, true, 100), 'de catalogusfoto van Rood');
  assert.equal(usedPlacesText(byKey(data, 'F243'), places(data), K), '');
  assert.deepEqual(deleteTexts(byKey(data, 'F243'), places(data), K, 100), {
    line: 'Deze foto is nergens in gebruik.', title: 'Foto verwijderen', body: 'De foto wordt verwijderd.', confirm: 'Verwijderen',
  });
  assert.deepEqual(deleteTexts(shared, places(both), K, 100), {
    line: 'Deze foto is nu de websitefoto van Kersenroze en de catalogusfoto van Rood.',
    title: 'Foto verwijderen',
    body: 'De foto wordt verwijderd. Hij is nu de websitefoto van Kersenroze en de catalogusfoto van Rood. '
      + 'Daar wordt daarna een andere foto gekozen, of de plek blijft leeg als er geen andere is.',
    confirm: 'Verwijderen',
  });
  assert.equal(PHOTO_MESSAGES.deleteRefusedHint, 'Kies eerst een andere foto voor de catalogus.');
  // Narrowing a photo of all colours takes it away from the others.
  assert.deepEqual(scopeConfirm(shared, places(both), K, false, 100), {
    title: 'Foto bij minder kleuren tonen',
    body: 'De foto verdwijnt bij de andere kleuren. Hij is nu de catalogusfoto van Rood; daar kiest de website of de catalogus daarna zelf een andere foto.',
    confirm: 'Alleen bij Kersenroze',
  });
  assert.equal(scopeConfirm(byKey(data, 'F250'), places(data), K, false, 100)?.body, 'De foto verdwijnt bij de andere kleuren.');
  assert.equal(scopeConfirm(byKey(data, 'F243'), places(data), K, false), null, 'It leaves no colour');
  // Widening the colour's catalogue photo takes it out of the colour strip.
  assert.deepEqual(scopeConfirm(own, places(data), K, true), {
    title: 'Foto bij alle kleuren tonen',
    body: 'Deze foto is nu de catalogusfoto van Kersenroze. Een foto van alle kleuren komt in de Handelscatalogus niet bij een kleur te staan; '
      + 'Kersenroze krijgt daar dan een andere foto of geen.',
    confirm: 'Bij alle kleuren',
  });
  assert.equal(scopeConfirm(byKey(data, 'F243'), places(data), K, true), null);
});

/* -------------------------------------------------------------- add sheet */

test('add sheet: the words, and the warning that the photo goes straight onto quotes and invoices', () => {
  const texts = addSheetTexts(1, K, 'THIS_VARIANT');
  assert.deepEqual([texts.title, texts.scopeLabel, texts.onlyThis, texts.all, texts.extraLabel],
    ['Foto toevoegen', 'Bij welke kleuren hoort deze foto?', 'Alleen Kersenroze', 'Alle kleuren', 'Ook tonen als extra foto']);
  assert.equal(texts.scopeHelp, 'De foto hoort alleen bij Kersenroze. Alleen zo’n foto kan de catalogusfoto van Kersenroze worden.');
  assert.deepEqual([texts.website, texts.catalogue], [
    { label: 'In de fotogalerij op de website', help: 'Op de productpagina, tussen de andere foto’s.' },
    { label: 'Mag in de catalogus', help: 'Een pdf met meer foto’s per reeks kan hem gebruiken.' },
  ]);
  assert.equal(texts.extraHelp, 'Allebei uit? Dan staat de foto klaar bij ‘Alle foto’s’ en kies je later waar hij komt.');
  assert.equal(`${texts.tip.rest} ${texts.tip.strong} ${texts.tip.tail}`,
    'Moet dit meteen de website- of catalogusfoto worden? Dat gaat sneller via Wijzig bij Website of Catalogus: daar upload en kies je in één keer.');
  assert.deepEqual([addSheetTexts(3, K, 'ALL_VARIANTS').title, addSheetTexts(3, K, 'ALL_VARIANTS').scopeHelp],
    ['3 foto’s toevoegen', 'De foto hoort bij elke kleur van deze reeks.']);

  const bare = example({
    websiteColour: place('websiteColour', 'F250', 'AUTOMATIC', 'ALL_COLOURS_SERIES_PHOTO', ALL),
    documents: place('documents', 'F250', 'AUTOMATIC', 'FIRST_SERIES_PHOTO', ALL),
  });
  bare.photos = bare.photos.filter((item) => item.scope !== 'THIS_VARIANT');
  assert.equal(addWarning(bare, 'THIS_VARIANT', K), 'Let op: Kersenroze heeft nog geen eigen foto. Deze foto komt daarom meteen op offertes en facturen.');
  assert.equal(addWarning(bare, 'ALL_VARIANTS', K), null);
  assert.equal(addWarning(example(), 'THIS_VARIANT', K), null, 'A stored website choice keeps the documents where they are');
  const automatic = example({ websiteColour: place('websiteColour', 'F242', 'AUTOMATIC', 'OWN_COLOUR_SERIES_PHOTO'), documents: place('documents', 'F242', 'AUTOMATIC', 'FIRST_SERIES_PHOTO') });
  assert.equal(addWarning(automatic, 'THIS_VARIANT', K), null, 'The colour has a photo of its own in the series');
  assert.equal(addWarning(null, 'THIS_VARIANT', K), null);
});

test('files are checked before the add sheet opens and the upload result reads as one sentence', () => {
  const files = [
    { name: 'a.jpg', type: 'image/jpeg', size: 10 },
    { name: 'b.pdf', type: 'application/pdf', size: 10 },
    { name: 'c.png', type: 'IMAGE/PNG', size: 26 * 1024 * 1024 },
    { name: 'd.webp', type: 'image/webp', size: 0 },
  ];
  const { accepted, skipped } = splitPhotoFiles(files);
  assert.deepEqual(accepted.map((file) => file.name), ['a.jpg']);
  assert.equal(skipped, 'Overgeslagen: 2 bestanden zijn geen foto · 1 foto is groter dan 25 MB');
  assert.equal(splitPhotoFiles([files[0]]).skipped, null);
  assert.deepEqual(uploadSummary({ added: 1, existing: 1, failed: 0, publishFailed: 0, channels: ['WEBSITE'] }),
    { text: '1 foto toegevoegd · staat als extra foto op de website · 1 foto stond al in de reeks', ok: true });
  assert.deepEqual(uploadSummary({ added: 1, existing: 0, failed: 0, publishFailed: 0, channels: ['CATALOGUE'] }),
    { text: '1 foto toegevoegd · mag in de catalogus', ok: true });
  assert.deepEqual(uploadSummary({ added: 2, existing: 0, failed: 0, publishFailed: 0, channels: ['WEBSITE', 'CATALOGUE'] }),
    { text: '2 foto’s toegevoegd · staan als extra foto op de website en mogen in de catalogus', ok: true });
  assert.deepEqual(uploadSummary({ added: 1, existing: 0, failed: 1, publishFailed: 0, channels: [] }),
    { text: '1 foto toegevoegd · nog niet in gebruik · 1 foto niet geüpload', ok: false });
  assert.deepEqual(uploadSummary({ added: 0, existing: 0, failed: 0, publishFailed: 0, channels: [] }), { text: 'Geen foto’s toegevoegd', ok: true });
});

/* ------------------------------------------------------------ status pill */

test('status pill: one dated, site-wide line; nothing while it is unknown', () => {
  const now = new Date(2026, 9, 12, 23, 5);
  const at = (date: Date) => date.toISOString();
  const status = (value: string, liveAt: string | null = null, lastError: string | null = null) =>
    ({ status: value as 'LIVE', liveAt, lastError });
  assert.deepEqual(syncPill(status('LIVE', at(new Date(2026, 9, 12, 22, 41))), false, true, now),
    { text: 'Website is bijgewerkt · 22:41', tone: 'ok', action: null });
  assert.equal(syncPill(status('LIVE', at(new Date(2026, 9, 11, 8, 5))), false, true, now)?.text, 'Website is bijgewerkt · 11 okt 08:05');
  assert.equal(syncPill(status('LIVE', at(new Date(2026, 2, 3, 9, 30))), false, true, now)?.text, 'Website is bijgewerkt · 3 mrt 09:30');
  assert.equal(syncPill(status('LIVE'), false, true, now)?.text, 'Website is bijgewerkt');
  assert.deepEqual(syncPill(status('LIVE'), false, false, now), { text: 'Reeks staat nog niet op de website', tone: 'neutral', action: null });
  assert.deepEqual(syncPill(null, false, false, now)?.text, 'Reeks staat nog niet op de website', 'The overview knows this without the rebuild status');
  for (const value of ['QUEUED', 'TRIGGERED']) {
    assert.deepEqual(syncPill(status(value), false, true, now), { text: 'Website wordt bijgewerkt', tone: 'warn', action: null });
    assert.deepEqual(syncPill(status(value), true, true, now), { text: 'Website nog niet bijgewerkt · Kijk opnieuw', tone: 'warn', action: 'refresh' });
  }
  assert.deepEqual(syncPill(status('FAILED_OR_STALE', null, 'Missing required translation for de'), false, true, now),
    { text: 'Website wacht op vertalingen', tone: 'warn', action: 'translations' });
  assert.deepEqual(syncPill(status('FAILED_OR_STALE', null, 'Hook refused'), false, true, now),
    { text: 'Website niet bijgewerkt · Opnieuw proberen', tone: 'danger', action: 'retry' });
  assert.equal(syncPill(status('FAILED_OR_STALE'), false, true, now)?.action, 'retry');
  assert.equal(syncPill(status('NOT_CONFIGURED'), false, true, now), null);
  assert.equal(syncPill(null, false, true, now), null, 'Loading or a load error shows no pill');
});

/* ---------------------------------------------------------- other colours */

test('other colours: one row per colour from its own overview, for looking and jumping only', () => {
  const rood = { productId: 101, name: 'Half heart 40 cm rood', colour: 'Rood', colourHex: '#c00000', active: true };
  const overview = example();
  overview.productId = 101;
  assert.deepEqual(otherColourRow(rood, overview), {
    productId: 101, name: 'Rood', label: 'Rood', colourHex: '#c00000',
    website: byKey(overview, 'F242'), catalogue: byKey(overview, 'F242'), empty: null, linkLabel: 'Open Rood',
  });
  const loading = otherColourRow(rood, null);
  assert.deepEqual([loading.website, loading.catalogue, loading.empty], [null, null, null]);
  const bare = example({ websiteColour: place('websiteColour', null, 'NONE', 'NO_PHOTO'), catalogueColour: place('catalogueColour', null, 'NONE', 'NO_PHOTO') });
  bare.photos = bare.photos.filter((item) => item.scope === 'OTHER_VARIANT');
  assert.equal(otherColourRow(rood, bare).empty, 'Rood heeft nog geen foto. Op de productpagina is deze kleur daardoor niet aan te tikken.');
  const inactive = otherColourRow({ ...rood, active: false }, bare);
  assert.deepEqual([inactive.label, inactive.empty], ['Rood · niet actief', 'Rood heeft nog geen foto.'],
    'An inactive colour is on no product page: the sentence about tapping is left out');
  const demo = otherColourRow(rood, demoColour());
  assert.deepEqual([demo.label, demo.website, demo.catalogue], ['Rood · demo', null, null]);
  assert.equal(otherColourRow({ ...rood, colour: null }, null).name, 'Half heart 40 cm rood');
  const single = oneColour(place('catalogueDetail', 'F250', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER', ALL));
  assert.equal(otherColourRow(rood, single).catalogue?.key, 'F250', 'The catalogue square follows that colour’s own card');
  // Two colours with one name: the size tells them apart, in the name, the link and the sentence.
  const twin = { productId: 127, name: 'Half heart 40 cm', colour: 'Kersenroze', colourHex: null, active: true, size: '7.5*8cm' };
  const series = [{ productId: 100, colour: 'Kersenroze' }, { productId: 101, colour: 'Rood' }, { productId: 127, colour: 'Kersenroze' }];
  const second = otherColourRow(twin, bare, series);
  assert.deepEqual([second.name, second.label, second.linkLabel], ['Kersenroze · 7.5*8cm', 'Kersenroze · 7.5*8cm', 'Open Kersenroze · 7.5*8cm']);
  assert.equal(second.empty, 'Kersenroze · 7.5*8cm heeft nog geen foto. Op de productpagina is deze kleur daardoor niet aan te tikken.');
  assert.equal(otherColourRow(rood, null, series).name, 'Rood');
  assert.equal(otherColourRow({ ...twin, size: null }, null, series).name, 'Kersenroze', 'Without a size there is nothing to add');
});

/* ------------------------------------------- older server (ui-spec section 12) */

test('older server: the places are built from the old fields and marked legacy', () => {
  const data = legacy();
  const built = resolvedPlaces(data)!;
  assert.equal(built.legacy, true);
  assert.deepEqual(built, legacyPlaces(data));
  assert.deepEqual([built.websiteColour.shownKey, built.websiteColour.chosenKey, built.websiteColour.state, built.websiteColour.role],
    ['F242', 'F242', 'CHOSEN', 'MAIN']);
  assert.deepEqual([built.documents.shownKey, built.documents.state], ['F242', 'CHOSEN']);
  assert.deepEqual([built.catalogueColour.shownKey, built.catalogueColour.state], ['F242', 'CHOSEN']);
  assert.deepEqual([built.websiteQuote.shownKey, built.websiteQuote.chosenKey, built.websiteQuote.state], ['F242', null, 'AUTOMATIC']);
  assert.deepEqual([built.catalogueDetail.shownKey, built.catalogueDetail.state], [null, 'AUTOMATIC'],
    'The old server names no automatic catalogue photo; it is automatic, not missing');
  assert.equal(resolvedPlaces(null), null);
  assert.equal(seriesLive(data), true);
  assert.equal(seriesLive(legacy({ familyWebsiteStatus: 'DRAFT' })), false);
  assert.equal(colourStatus(data, { active: false, demo: true }), 'active', 'Inactive and demo states are unknown to the old server');
});

test('older server: the cards never repeat the old mix-up of the website photo and the document photo', () => {
  const chosen = placeCards(legacy(), K);
  assert.deepEqual(chosen.map((item) => [item.photo?.key ?? null, item.chip, labels(item.actions)]), [
    ['F242', 'Zelf gekozen', ['Wijzig']], ['F242', 'Zelf gekozen', ['Wijzig']], ['F242', 'Zelfde foto als de website', []],
  ]);
  // Automatic main that is on the website: drawn. One that is not: the dashed frame.
  const online = placeCards(legacy({ main: { key: 'F244', explicit: false }, catalogueVariant: null }), K);
  assert.deepEqual([online[0].photo?.key, online[0].chip, online[0].caption],
    ['F244', 'Automatisch gekozen', 'Als een klant Kersenroze kiest, op de productpagina en de bestelpagina.']);
  assert.deepEqual([online[2].photo?.key, online[2].chip, online[2].tone, online[2].text], ['F244', 'Automatisch gekozen', 'neutral', null]);
  const internal = placeCards(legacy({ main: { key: 'F243', explicit: false }, catalogueVariant: null }), K);
  assert.deepEqual([internal[0].photo, internal[0].emptyLabel, internal[0].chip, internal[0].reason, labels(internal[0].actions)],
    [null, 'De website kiest zelf een foto.', 'Automatisch gekozen', null, ['Wijzig']]);
  assert.deepEqual([internal[1].photo, internal[1].emptyLabel, internal[1].chip, labels(internal[1].actions)],
    [null, 'De catalogus kiest de foto bij het maken van de pdf.', 'Automatisch gekozen', ['Wijzig']]);
  assert.deepEqual([internal[2].photo?.key, internal[2].chip, internal[2].tone], ['F243', 'Automatisch gekozen', 'neutral'], 'No warn states');
});

test('older server: no opening row, no notes, no why sentence; pickers, tiles and locks still work', () => {
  const data = legacy({ catalogueOverview: { key: 'F250', explicit: true } });
  assert.deepEqual(seriesRows(data).map((item) => [item.name, item.photo?.key ?? null, item.chip, item.why, item.action?.label]), [
    ['Bestelpagina', 'F242', 'Automatisch gekozen', '', 'Wijzig'],
    ['Grote catalogusfoto', null, 'Automatisch gekozen', 'De catalogus kiest de foto bij het maken van de pdf.', 'Wijzig'],
    ['Kleine catalogusfoto', 'F250', 'Zelf gekozen', '', 'Wijzig'],
  ]);
  assert.deepEqual(standingNotes(data, K), []);
  assert.deepEqual(standingNotes(legacy({ main: { key: 'F243', explicit: false } }), K), []);
  const uses = tileUses(byKey(data, 'F242'), places(data));
  assert.deepEqual(tileFoot(byKey(data, 'F242'), uses, K).chips.map((chip) => chip.label), ['Website', 'Catalogus']);
  assert.deepEqual(switchLock({ ...byKey(data, 'F242'), publishedChannels: ['WEBSITE', 'CATALOGUE'] }, places(data), 'WEBSITE', K),
    { locked: true, help: 'Blijft aan: dit is de gekozen websitefoto van Kersenroze. Kies daar eerst een andere foto.' }, 'From this product’s own choice');
  assert.equal(switchLock({ ...byKey(data, 'F250'), publishedChannels: ['CATALOGUE'] }, places(data), 'CATALOGUE', K)?.help,
    'Blijft aan: dit is de gekozen kleine catalogusfoto. Kies daar eerst een andere foto.');
  const picker = pickerModel(data, 'catalogue', K)!;
  assert.deepEqual([picker.role, picker.upload, picker.tiles[0].photo.key, picker.tiles[0].caption], ['CATALOGUE_VARIANT', true, 'F242', 'Nu in de catalogus']);
  const automatic = pickerModel(legacy({ catalogueVariant: null }), 'catalogue', K)!;
  assert.deepEqual([automatic.current, automatic.texts.automatic], [null, null], 'Nothing is claimed about a photo the server did not name');
  assert.equal(placeSavedMessage('catalogue', K, places(data), places(data)), 'Catalogusfoto van Kersenroze gewijzigd.');
  assert.equal(scopeConfirm(byKey(data, 'F242'), places(data), K, true), null);
  assert.equal(otherColourRow({ productId: 101, name: 'Rood', colour: 'Rood', colourHex: null, active: true }, data).website, null);
  const empty = legacy({ photos: [], main: null, quote: null, catalogueVariant: null });
  assert.deepEqual(placeCards(empty, K).map((item) => [item.chip, labels(item.actions)]), [
    ['Geen foto', ['Kies foto']], ['Geen foto', ['Kies foto']], ['Geen foto', []],
  ]);
});

/* -------------------------------------------- long labels and "deze kleur" */

test('a colour shared by two sizes adds the size to stay unambiguous', () => {
  const product = { id: 53, colour: 'Rood', variantSize: 'M' };
  assert.equal(variantShortLabel(product, [{ productId: 53, colour: 'Rood' }, { productId: 54, colour: 'Roze' }]), 'Rood');
  assert.equal(variantShortLabel(product, [{ productId: 60, colour: ' rood ' }]), 'Rood · M');
  assert.equal(variantShortLabel({ id: 1, colour: null, variantSize: '23 cm' }), '23 cm');
  assert.equal(variantShortLabel({ id: 1, colour: ' ', variantSize: null }, [], 'Rood · 5.5*6cm'), 'Rood · 5.5*6cm');
  assert.equal(variantShortLabel({ id: 1, colour: null, variantSize: null }), 'deze kleur');
});

for (const colour of ['Kersenroze · 5.5*6cm', 'deze kleur']) {
  test(`the label "${colour}" reads as a sentence everywhere it is used`, () => {
    const data = example();
    assert.equal(placesHeading(colour).title, `Waar zien klanten ${colour}?`);
    assert.equal(card(data, 'website', colour).caption, `Als een klant ${colour} kiest, op de productpagina en de bestelpagina.`);
    assert.equal(card(data, 'catalogue', colour).actions[0].ariaLabel, `Wijzig de catalogusfoto van ${colour}`);
    assert.equal(pickerModel(data, 'catalogue', colour)!.texts.title, `Catalogusfoto van ${colour}`);
    assert.equal(galleryTexts('colour', colour).heading, `Alle foto’s van ${colour}`);
    assert.equal(addSheetTexts(1, colour, 'THIS_VARIANT').onlyThis, `Alleen ${colour}`);
    assert.equal(seriesPhotoGroups(data, colour)[0].label, `${colour} · deze kleur`);
    assert.equal(placeSavedMessage('catalogue', colour, null, null), `Catalogusfoto van ${colour} gewijzigd.`);
    assert.equal(photoTileLabel(byKey(data, 'F242'), colour, 0, 6, tileUses(byKey(data, 'F242'), places(data))),
      `Foto 1 van 6. Websitefoto en catalogusfoto van ${colour}, en op 3 plekken van de reeks. Open voor alle keuzes.`);
  });
}

/* ------------------------------------------------- reorder, channels, files */

test('reordering keeps hidden family images in their slots and ignores stale or repeated ids', () => {
  assert.deepEqual(movedOrder(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(movedOrder(['a', 'b', 'c'], 0, 9), ['b', 'c', 'a'], 'Targets are clamped');
  assert.equal(movedOrder(['a', 'b'], 1, 1), null);
  assert.equal(movedOrder(['a', 'b'], -1, 0), null);
  // 300 belongs to an inactive colour: the overview does not list it.
  assert.deepEqual(familyOrderWith([229, 300, 221, 222], [221, 229, 222]), [221, 300, 229, 222]);
  assert.deepEqual(familyOrderWith([1, 2, 3], [9, 3, 3, 1]), [3, 2, 1]);
});

test('channel toggles change one channel in a stable order', () => {
  const visibility = { website: false, catalogue: true, orderApp: false };
  assert.deepEqual(visibleChannels(visibility), ['CATALOGUE']);
  // Older servers send no stored channels: the switches start from what is visible.
  assert.deepEqual(selectedChannels({ visibility }), ['CATALOGUE']);
  assert.deepEqual(toggledChannels({ visibility }, 'WEBSITE'), ['WEBSITE', 'CATALOGUE']);
  assert.deepEqual(toggledChannels({ visibility }, 'CATALOGUE'), []);
  assert.deepEqual(toggledChannels({ visibility: { website: true, catalogue: true, orderApp: false } }, 'ORDER_APP'), ['WEBSITE', 'ORDER_APP', 'CATALOGUE']);
});

test('channel toggles start from the stored channels, so a hidden selection survives', () => {
  // Selected for website and order app, but only the order app shows it right now.
  const stored = {
    visibility: { website: false, catalogue: false, orderApp: true },
    publishedChannels: ['ORDER_APP', 'WEBSITE'] as ProductPhotoOverviewPhoto['publishedChannels'],
  };
  assert.deepEqual(selectedChannels(stored), ['WEBSITE', 'ORDER_APP']);
  assert.deepEqual(toggledChannels(stored, 'CATALOGUE'), ['WEBSITE', 'ORDER_APP', 'CATALOGUE']);
  assert.deepEqual(toggledChannels(stored, 'ORDER_APP'), ['WEBSITE']);
  // An empty stored list is a deliberate "internal only", not a missing field.
  assert.deepEqual(selectedChannels({ visibility: { website: true, catalogue: false, orderApp: false }, publishedChannels: [] }), []);
  assert.deepEqual(selectedChannels({ visibility: { website: true, catalogue: false, orderApp: false }, publishedChannels: null }), ['WEBSITE']);
});

test('cleaning a duplicate keeps the reach of the series photo it reuses', () => {
  const data = example();
  const duplicate = photo('P5501', { duplicateOfKey: 'F250' });
  assert.equal(cleanupScope(data, duplicate), 'ALL_VARIANTS', 'The duplicate of a shared photo stays shared');
  assert.equal(cleanupScope(data, { ...duplicate, duplicateOfKey: 'F242' }), 'THIS_VARIANT');
  assert.equal(cleanupScope(data, { ...duplicate, duplicateOfKey: 'F214' }), 'ALL_VARIANTS', 'Rood keeps it, Kersenroze gains it');
  assert.equal(cleanupScope(data, { ...duplicate, duplicateOfKey: 'F999' }), 'THIS_VARIANT');
});

/* ------------------------------------------------------- photo sheet rows */

const sheetRow = (data: ProductPhotoOverview, key: string, row: string) => {
  const built = sheetRows(data, byKey(data, key), K);
  return [...built.colour, ...built.series].find((item) => item.key === row)!;
};
const brief = (data: ProductPhotoOverview, key: string, row: string) => {
  const found = sheetRow(data, key, row);
  return [found.state, found.sub];
};

test('sheet rows: an unused photo can be used everywhere it fits, and says where it cannot', () => {
  const data = example();
  const rows = sheetRows(data, byKey(data, 'F243'), K);
  assert.deepEqual(rows.colour.map((row) => [row.name, row.state, row.sub, row.role, row.shown?.key ?? null]), [
    ['Website', 'use', 'Als een klant Kersenroze kiest', 'MAIN', 'F242'],
    ['Catalogus', 'use', 'Bij Kersenroze in de pdf-catalogus', 'CATALOGUE_VARIANT', 'F242'],
    ['Offertes en facturen', 'plain', 'Zelfde foto als de website', null, 'F242'],
  ]);
  assert.equal(rows.colour[0].label, 'Website: niet in gebruik. Gebruik hier.');
  assert.equal(rows.colour[2].label, '', 'quotes and invoices have no choice of their own');
  assert.deepEqual(rows.series.map((row) => [row.name, row.state, row.sub, row.role]), [
    ['Bestelpagina', 'use', 'Voor alle kleuren', 'QUOTE'],
    ['Grote catalogusfoto', 'use', 'Voor alle kleuren', 'CATALOGUE_DETAIL'],
    ['Kleine catalogusfoto', 'use', 'Voor alle kleuren', 'CATALOGUE_OVERVIEW'],
    // Not in the website gallery: the order has no position for it, so no dead link to reorder mode.
    ['Productpagina', 'blocked', 'Deze foto staat niet in de fotogalerij op de website.', null],
  ]);
  assert.equal(rows.seriesSummary, 'nergens in gebruik');
});

test('sheet rows: the photo in use offers back to automatic or pinning, never "Gebruik hier"', () => {
  const data = example();
  const rows = sheetRows(data, byKey(data, 'F242'), K);
  assert.deepEqual(rows.colour.map((row) => [row.state, row.sub, row.shown]), [
    ['chosen', 'Zelf gekozen', null], ['chosen', 'Zelf gekozen', null], ['on', 'Zelfde foto als de website', null],
  ]);
  assert.equal(rows.colour[0].label, 'Website: in gebruik, zelf gekozen. Terug naar automatisch.');
  assert.deepEqual(rows.series.map((row) => [row.state, row.sub]), [
    ['automatic', 'Automatisch gekozen'], ['automatic', 'Automatisch gekozen'], ['automatic', 'Automatisch gekozen'],
    ['order', 'Opent met de eerste foto van de reeks'],
  ]);
  assert.equal(rows.series[0].label, 'Bestelpagina: in gebruik, automatisch gekozen. Zelf vastzetten.');
  assert.equal(rows.series[3].label, 'Volgorde op de website wijzigen');
  assert.equal(rows.seriesSummary, 'op 3 plekken in gebruik');
  assert.deepEqual(brief(data, 'F214', 'opening'), ['on', 'Eerste foto van de reeks']);
  assert.equal(sheetRows(data, byKey(data, 'F214'), K).seriesSummary, 'op 1 plek in gebruik');
});

test('sheet rows: photos of all colours and of another colour', () => {
  const data = example();
  assert.deepEqual(brief(data, 'F250', 'website'), ['use', 'Als een klant Kersenroze kiest']);
  assert.deepEqual(brief(data, 'F250', 'catalogue'),
    ['blocked', 'Kan niet: in de Handelscatalogus komt bij een kleur alleen een foto van die kleur zelf.']);
  assert.deepEqual(brief(data, 'F214', 'website'), ['blocked', 'Deze foto hoort bij Rood.']);
  assert.deepEqual(brief(data, 'F214', 'catalogue'), ['blocked', 'Deze foto hoort bij Rood.']);
  assert.deepEqual(brief(data, 'F214', 'quote'), ['use', 'Voor alle kleuren']);
  assert.equal(sheetRow(data, 'F214', 'website').label, '');
  // One colour in the series: no colour strip, so a photo of all colours can be the catalogue picture.
  const single = oneColour(place('catalogueDetail', 'F250', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER', ALL));
  assert.deepEqual(brief(single, 'F243', 'catalogue'), ['use', 'In de pdf-catalogus']);
  assert.deepEqual(brief(single, 'F250', 'catalogue'), ['automatic', 'Automatisch gekozen']);
  assert.equal(sheetRow(single, 'F250', 'catalogue').role, 'CATALOGUE_VARIANT');
  const chosen = oneColour(place('catalogueDetail', 'F242', 'AUTOMATIC', 'THIS_COLOUR_LEAD'), 'F242');
  assert.deepEqual(brief(chosen, 'F242', 'catalogue'), ['chosen', 'Zelf gekozen']);
});

test('sheet rows: a stored choice that is not shown can only go back to automatic', () => {
  const data = example({ websiteColour: place('websiteColour', 'F244', 'CHOSEN_NOT_SHOWN', 'NOT_PUBLISHED_FOR_WEBSITE', { chosenKey: 'F242' }) });
  const hidden = sheetRow(data, 'F242', 'website');
  assert.deepEqual([hidden.state, hidden.sub, hidden.role, hidden.shown?.key], ['hidden', 'Je gekozen foto staat niet op de website.', 'MAIN', 'F244']);
  assert.equal(hidden.label, 'Website: zelf gekozen, maar niet getoond. Terug naar automatisch.');
  // The photo shown instead is there automatically and can be pinned.
  assert.deepEqual(brief(data, 'F244', 'website'), ['automatic', 'Automatisch gekozen']);
  assert.deepEqual(brief(data, 'F243', 'documents'), ['plain', 'Andere foto dan de website']);
  const series = example({ catalogueDetail: place('catalogueDetail', 'F242', 'CHOSEN_NOT_SHOWN', 'CHOICE_NOT_AVAILABLE', { chosenKey: 'F243' }) });
  assert.deepEqual(brief(series, 'F243', 'detail'), ['hidden', 'Je keuze wordt niet getoond.']);
});

test('sheet rows: a colour that is not sold has no website row to tap, a demo no catalogue row either', () => {
  const inactive = inactiveColour([...examplePhotos(), photo('P5501')]);
  assert.deepEqual(brief(inactive, 'F243', 'website'), ['blocked', 'Kersenroze is niet actief en staat daarom niet op de website.']);
  assert.deepEqual(brief(inactive, 'F243', 'catalogue'), ['blocked', 'Kersenroze is niet actief. Maak de kleur eerst actief om deze foto te kiezen.']);
  // The server marks such a photo as not publishable; the row still names the real reason.
  inactive.photos[1] = { ...inactive.photos[1], publishable: false };
  assert.deepEqual(brief(inactive, 'F243', 'catalogue'), ['blocked', 'Kersenroze is niet actief. Maak de kleur eerst actief om deze foto te kiezen.']);
  assert.deepEqual(brief(inactive, 'P5501', 'catalogue'), ['automatic', 'Automatisch gekozen']);
  assert.deepEqual(brief(inactive, 'F243', 'documents'), ['plain', 'Kersenroze staat niet op de website']);
  assert.equal(sheetRow(inactive, 'F242', 'website').shown, null, 'nothing is drawn for a place that shows nothing');
  const demo = demoColour();
  assert.deepEqual(brief(demo, 'F243', 'website'), ['blocked', 'Kersenroze is een demo-product en staat daarom niet op de website.']);
  assert.deepEqual(brief(demo, 'F243', 'catalogue'), ['blocked', 'Kersenroze is een demo-product en komt daarom niet in een catalogus.']);
  assert.deepEqual(brief(demo, 'F243', 'detail'), ['use', 'Voor alle kleuren']);
});

test('sheet rows: an own photo, a photo that cannot be shown, an older server', () => {
  const data = example();
  data.photos.push(photo('P5501'), photo('F260', { publishable: false }));
  assert.deepEqual(brief(data, 'P5501', 'website'), ['use', 'Als een klant Kersenroze kiest']);
  assert.deepEqual(brief(data, 'P5501', 'quote'), ['blocked', 'Kan niet: deze foto hoort alleen bij dit product.']);
  assert.deepEqual(brief(data, 'P5501', 'opening'), ['blocked', 'Kan niet: deze foto hoort alleen bij dit product.']);
  assert.deepEqual(brief(data, 'F260', 'website'), ['blocked', 'Deze foto kan nog niet getoond worden. Controleer bij welke kleur hij hoort.']);
  const old = legacy();
  assert.deepEqual(brief(old, 'F242', 'website'), ['chosen', 'Zelf gekozen']);
  assert.equal(sheetRow(old, 'F243', 'catalogue').state, 'use');
  assert.deepEqual(sheetRows(null, photo('F243'), K), { colour: [], series: [], seriesSummary: 'nergens in gebruik' });
  assert.deepEqual(sheetRows({ ...data, familyId: null }, byKey(data, 'F243'), K).series, []);
});

test('sheet stage: the pair only when Website and Catalogus show one other photo', () => {
  const data = example();
  const reference = byKey(data, 'F242');
  assert.equal(sheetStage({ key: 'F243' }, places(data), reference), 'pair');
  assert.equal(sheetStage({ key: 'F242' }, places(data), reference), 'single', 'a photo this colour uses stands alone');
  const differ = example({ catalogueColour: place('catalogueColour', 'F244', 'CHOSEN') });
  assert.equal(sheetStage({ key: 'F243' }, places(differ), null), 'thumbs');
  assert.equal(sheetStage({ key: 'F244' }, places(differ), null), 'single');
  assert.equal(sheetStage({ key: 'F243' }, places(demoColour()), null), 'single', 'nothing to compare with');
  assert.equal(sheetStage({ key: 'F243' }, null, null), 'single');
});

/* ------------------------------------------------------ vocabulary guard */

// ui-spec section 2: the words the owner should never read in this section.
const BANNED_ANYWHERE = ['hoofdfoto', 'kleurfoto', 'brochure', 'export', 'kanaal', 'zet vast', 'het systeem', 'assortiment', 'reeksfoto'];
// The old dot-joined place names. The bare separator stays: the pill, the file line and a colour label use it.
const BANNED_EXACT = ['Website · ', 'Catalogus · '];
// The one sentence of the spec (4.4, own photo opens the page) that names the thing the series lacks.
const ALLOWED = ['Er staat nog geen reeksfoto op de website.'];

function banned(text: string): string | null {
  let cleaned = text;
  for (const allowed of ALLOWED) cleaned = cleaned.split(allowed).join('');
  const lower = cleaned.toLocaleLowerCase('nl');
  return BANNED_ANYWHERE.find((word) => lower.includes(word)) ?? BANNED_EXACT.find((word) => cleaned.includes(word)) ?? null;
}

function strings(value: unknown, found: Set<string> = new Set(), seen: Set<unknown> = new Set()): Set<string> {
  if (typeof value === 'string') found.add(value);
  else if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const item of Array.isArray(value) ? value : Object.values(value)) strings(item, found, seen);
  }
  return found;
}

/** Every sentence the module can build for one overview, with the colour "Kersenroze". */
function everything(data: ProductPhotoOverview, product: { active?: boolean; demo?: boolean } | null): unknown[] {
  const built = places(data);
  const out: unknown[] = [
    placesHeading(K), placesHeading(K, true), placeCards(data, K, product), standingNotes(data, K, product), seriesRows(data),
    seriesAttention(seriesRows(data)), documentsState(built, K), addWarning(data, 'THIS_VARIANT', K),
    catalogueAssumptionLine(data, [{ productId: 100, active: true }, { productId: 101, active: false }]),
    otherColourRow({ productId: 100, name: 'Half heart', colour: K, colourHex: null, active: product?.active !== false }, data),
    seriesPhotoGroups(data, K).map((group) => group.label),
    data.photos.map((item) => sheetRows(data, item, K)),
  ];
  for (const kind of ['website', 'catalogue', 'quote', 'detail', 'overview'] as const) {
    const picker = pickerModel(data, kind, K, product)!;
    out.push(picker.texts, picker.tiles.map((tile) => [tile.caption, tile.label, tile.compareLabel]));
    out.push(pickerTexts(kind, K, picker.place, false, { upload: false }), pickerTexts(kind, K, picker.place, true, { stored: true }));
    for (const event of ['chosen', 'cleared', 'pinned', 'repaired', 'undone'] as const) {
      out.push(placeSavedMessage(kind, K, examplePlaces({ catalogueDetail: place('catalogueDetail', 'F179', 'CHOSEN'), websiteQuote: place('websiteQuote', 'F214', 'CHOSEN') }), built, event));
    }
    out.push(changedLine(kind, true), changedLine(kind, false));
  }
  data.photos.forEach((item, index) => {
    const uses = tileUses(item, built);
    for (const view of ['colour', 'series'] as const) out.push(tileFoot(item, uses, K, view), photoTileLabel(item, K, index, data.photos.length, uses, view));
    for (const channel of ['WEBSITE', 'CATALOGUE', 'ORDER_APP'] as const) {
      out.push(switchLock(item, built, channel, K), switchLock({ ...item, publishedChannels: ['WEBSITE', 'CATALOGUE'] }, built, channel, K));
    }
    out.push(seenSentence(item, built), usedPlacesText(item, built, K, false, 100), deleteTexts(item, built, K, 100),
      scopeConfirm(item, built, K, true, 100), scopeConfirm(item, built, K, false, 100), compareLine(item, tileFoot(item, uses, K).words));
  });
  return out;
}

test('vocabulary: no sentence the module builds uses a word of the old screen', () => {
  const fixtures: [ProductPhotoOverview, { active?: boolean; demo?: boolean } | null][] = [
    [example(), null],
    [exampleWithoutCatalogueChoice(), null],
    [legacy(), null],
    [legacy({ main: { key: 'F243', explicit: false }, catalogueVariant: null }), null],
    [oneColour(place('catalogueDetail', 'F242', 'AUTOMATIC', 'THIS_COLOUR_LEAD'), 'F242'), null],
    [oneColour(place('catalogueDetail', null, 'NONE', 'NO_PHOTO')), null],
    [inactiveColour([photo('P5501'), ...examplePhotos()]), INACTIVE],
    [inactiveColour(), INACTIVE],
    [demoColour(), { active: true, demo: true }],
    [example({}, { seriesLiveOnWebsite: false, catalogueDetailSize: 'LARGE' }), null],
    [example({
      websiteOpening: place('websiteOpening', 'P5755', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER', ROOD),
      catalogueCompactRow: place('catalogueCompactRow', 'F243', 'AUTOMATIC', 'FIRST_SERIES_PHOTO'),
      websiteQuote: place('websiteQuote', null, 'NONE', 'SERIES_NOT_ACTIVE'),
      catalogueDetail: place('catalogueDetail', null, 'NONE', 'COLOUR_NOT_ACTIVE'),
      catalogueOverview: place('catalogueOverview', 'F179', 'CHOSEN_NOT_SHOWN', 'CHOICE_NOT_AVAILABLE', { chosenKey: 'F243' }),
    }, { otherPhotos: [P5755] }), null],
    [example({
      websiteColour: place('websiteColour', null, 'NONE', 'NO_PHOTO'), documents: place('documents', null, 'NONE', 'NO_PHOTO'),
      catalogueColour: place('catalogueColour', null, 'NONE', 'NO_PHOTO'), websiteOpening: place('websiteOpening', null, 'NONE', 'NO_PHOTO'),
      websiteQuote: place('websiteQuote', null, 'NONE', 'NO_PHOTO'),
    }), null],
    [example({
      websiteColour: place('websiteColour', 'F244', 'AUTOMATIC', 'OWN_COLOUR_SERIES_PHOTO'),
      documents: place('documents', 'F243', 'AUTOMATIC', 'FIRST_SERIES_PHOTO'),
      websiteQuote: place('websiteQuote', 'F214', 'AUTOMATIC', 'A_RULE_OF_NEXT_YEAR' as PhotoPlaceReason, ROOD),
    }), null],
  ];
  for (const [name, reason, key] of notShown.map(([, cardKey, why, shown]) => [cardKey === 'website' ? 'websiteColour' : 'catalogueColour', why, shown] as const)) {
    fixtures.push([example({ [name]: place(name, key, 'CHOSEN_NOT_SHOWN', reason, { chosenKey: 'F243' }) }), null]);
  }
  const before = examplePlaces();
  const moved = examplePlaces({
    websiteOpening: place('websiteOpening', 'F256', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER'), websiteColour: place('websiteColour', 'F243', 'CHOSEN'),
    documents: place('documents', 'F243', 'CHOSEN'), websiteQuote: place('websiteQuote', 'F243', 'CHOSEN'),
    catalogueColour: place('catalogueColour', 'F243', 'CHOSEN'), catalogueDetail: place('catalogueDetail', 'F243', 'CHOSEN'),
    catalogueOverview: place('catalogueOverview', 'F243', 'CHOSEN'),
  });
  const now = new Date(2026, 9, 12, 23, 5);
  const fixed: unknown[] = [
    PHOTO_MESSAGES, state.OTHER_COLOURS_TEXTS, state.SERIES_STRIP_TITLE, state.SERIES_STRIP_LINE,
    orderSavedMessage(before, moved), documentsMovedNote(before, moved),
    (['website', 'catalogue', 'quote', 'detail', 'overview'] as const).map((kind) => placeSavedMessage(kind, K, before, moved)),
    channelSavedMessage([], ['WEBSITE']), channelSavedMessage(['WEBSITE'], []), channelSavedMessage([], ['CATALOGUE']),
    channelSavedMessage(['CATALOGUE'], []), channelSavedMessage([], ['ORDER_APP']), scopeSavedMessage(true, K), scopeSavedMessage(false, K),
    (['reused', 'otherColour', 'allColours', 'roleFailed', 'unidentified'] as const).map((outcome) => [uploadUseMessage(outcome, K, 'Rood'), uploadUseMessage(outcome, K)]),
    addSheetTexts(1, K, 'THIS_VARIANT'), addSheetTexts(4, K, 'ALL_VARIANTS'), galleryTexts('colour', K), galleryTexts('series', K),
    duplicatesNote(1, K), duplicatesNote(2, K), compareCounter(0, 1), compareCounter(1, 3),
    splitPhotoFiles([{ type: 'x', size: 1 }, { type: 'image/png', size: 26 * 1024 * 1024 }]),
    [0, 1, 2].flatMap((added) => [[], ['WEBSITE'], ['CATALOGUE'], ['WEBSITE', 'CATALOGUE', 'ORDER_APP']].map((channels) =>
      uploadSummary({ added, existing: added, failed: added, publishFailed: added, channels: channels as ('WEBSITE' | 'CATALOGUE' | 'ORDER_APP')[] }))),
    ['LIVE', 'QUEUED', 'TRIGGERED', 'FAILED_OR_STALE', 'NOT_CONFIGURED'].flatMap((value) => [true, false].flatMap((ended) => [true, false].flatMap((live) =>
      ['vertaling ontbreekt', 'kapot'].map((lastError) => syncPill({ status: value as 'LIVE', liveAt: now.toISOString(), lastError }, ended, live, now))))),
    variantShortLabel({ id: 1, colour: null, variantSize: null }),
  ];
  const all = strings([fixed, ...fixtures.map(([data, product]) => everything(data, product))]);
  assert.ok(all.size > 250, `The scan must see the module's sentences, it saw ${all.size}`);
  for (const text of all) assert.equal(banned(text), null, `"${text}" uses a word the owner should not read`);
  assert.ok([...all].some((text) => text.includes(ALLOWED[0])), 'The allowed sentence is really built');
  assert.equal(banned('Hoofdfoto · Kersenroze'), 'hoofdfoto', 'The scan itself works');
  assert.equal(banned('Catalogus · overzicht'), 'Catalogus · ');
  assert.equal(banned('Website is bijgewerkt · 22:41'), null);
  assert.equal(banned('1 foto toegevoegd · staat als extra foto op de website · 1 foto stond al in de reeks'), null);
});

test('vocabulary: the literals of the module hold none of those words either', async () => {
  const source = await readFile(new URL('../src/app/features/products/product-photos-state.ts', import.meta.url), 'utf8');
  const live = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const literals = live.match(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? [];
  assert.ok(literals.length > 300);
  for (const literal of literals) assert.equal(banned(literal), null, `${literal} uses a word the owner should not read`);
  // The helpers of the old product page went with their last caller; nothing speaks the old vocabulary any more.
  for (const name of ['LEGACY_PHOTO_EXPORTS', 'hoofdfotoFirst', 'slideBadges']) assert.ok(!(name in state), `${name} is gone`);
  assert.ok(!source.includes('= Legacy'), 'No legacy block is left');
});
