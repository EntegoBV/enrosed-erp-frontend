import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductPhotoOverview, ProductPhotoOverviewPhoto } from '../src/app/core/api/models.ts';
import {
  canUseForRole,
  cleanupScope,
  colourPhotos,
  familyOrderWith,
  hoofdfotoFirst,
  movedOrder,
  photoKeyForProductPhoto,
  photoKeyForSignedId,
  photoScopeLabel,
  photoTileLabel,
  publishTargetForRole,
  roleCandidates,
  roleSavedMessage,
  roleStatus,
  roleTitle,
  rolesForPhoto,
  seriesInFamilyOrder,
  selectedChannels,
  seriesPhotoGroups,
  signedIdForPhotoKey,
  slideBadges,
  splitPhotoFiles,
  tileRoleBadges,
  toggledChannels,
  uploadSummary,
  variantShortLabel,
  visibleChannels,
  websiteReasonText,
} from '../src/app/features/products/product-photos-state.ts';

// A bowl series seen from the red colour (product 53): one own catalogue cut-out,
// a red showroom photo, a shared packshot and photos of pink (54) and white (55).
function photo(key: string, changes: Partial<ProductPhotoOverviewPhoto> = {}): ProductPhotoOverviewPhoto {
  const own = key.startsWith('P');
  const id = Number(key.slice(1));
  return {
    key, kind: own ? 'OWN' : 'SERIES', familyPhotoId: own ? null : id, productPhotoId: own ? id : null,
    scope: 'THIS_VARIANT', variantProductId: 53, variantLabel: 'Rood', originalFilename: `${key}.png`,
    contentType: 'image/png', widthPx: 1536, heightPx: 1024, sizeBytes: 1000,
    smallUrl: `/small/${key}`, mediumUrl: `/medium/${key}`, largeUrl: `/large/${key}`, downloadUrl: `/download/${key}`,
    visibility: { website: !own, catalogue: false, orderApp: false }, websiteReason: own ? null : 'PUBLISHED',
    publishable: !own, roles: [], duplicateOfKey: null, familyPosition: own ? null : id, ownPosition: own ? 0 : null,
    ...changes,
  };
}

function overview(): ProductPhotoOverview {
  return {
    productId: 53, familyId: 13, familyName: 'Bowl rozen met Display - M', variantLabel: 'Rood · 5.5*6cm',
    familyWebsiteStatus: 'PUBLISHED',
    photos: [
      photo('P5501', { roles: ['CATALOGUE_VARIANT'], duplicateOfKey: 'F229' }),
      photo('F221', { roles: ['MAIN', 'QUOTE'], familyPosition: 1 }),
      photo('F229', { scope: 'ALL_VARIANTS', variantProductId: null, variantLabel: null, familyPosition: 0,
        visibility: { website: true, catalogue: true, orderApp: false }, roles: ['CATALOGUE_OVERVIEW'] }),
      photo('F223', { scope: 'OTHER_VARIANT', variantProductId: 55, variantLabel: 'Wit', familyPosition: 3,
        visibility: { website: false, catalogue: false, orderApp: false }, websiteReason: null }),
      photo('F222', { scope: 'OTHER_VARIANT', variantProductId: 54, variantLabel: 'Roze', familyPosition: 2 }),
      photo('F224', { scope: 'OTHER_VARIANT', variantProductId: 55, variantLabel: 'Wit', familyPosition: 4, publishable: false,
        visibility: { website: false, catalogue: false, orderApp: false }, websiteReason: null }),
    ],
    main: { key: 'F221', explicit: true },
    quote: { key: 'F221', explicit: false },
    catalogueVariant: { key: 'P5501', explicit: true },
    catalogueOverview: { key: 'F229', explicit: false },
    catalogueDetail: null,
    catalogueDetailSize: 'STANDARD',
  };
}
const keys = (photos: ProductPhotoOverviewPhoto[]) => photos.map((item) => item.key);

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

test('role candidates follow the contract: per colour, website-only offerte, whole series for the catalogue', () => {
  const data = overview();
  assert.deepEqual(keys(roleCandidates(data, 'MAIN')), ['P5501', 'F221', 'F229']);
  assert.deepEqual(keys(roleCandidates(data, 'CATALOGUE_VARIANT')), ['P5501', 'F221', 'F229']);
  assert.deepEqual(keys(roleCandidates(data, 'QUOTE')), ['F221', 'F229', 'F223', 'F222'],
    'Any colour may lead the quote page; own photos only when on the website; unpublishable photos never');
  assert.deepEqual(keys(roleCandidates(data, 'CATALOGUE_OVERVIEW')), ['P5501', 'F221', 'F229', 'F223', 'F222']);
  const ownOnline = { ...data.photos[0], visibility: { website: true, catalogue: false, orderApp: false }, websiteReason: 'LEAD' as const };
  assert.equal(canUseForRole(ownOnline, 'QUOTE'), true);
  assert.equal(canUseForRole(data.photos[5], 'CATALOGUE_VARIANT'), false, 'Another colour cannot be this colour’s catalogue photo');
  assert.deepEqual(rolesForPhoto(data.photos[4]), ['QUOTE', 'CATALOGUE_OVERVIEW', 'CATALOGUE_DETAIL']);
  assert.deepEqual(roleCandidates(null, 'MAIN'), []);
});

test('choosing a photo that is not public yet tells where it will be published', () => {
  const data = overview();
  const white = data.photos[3];
  assert.equal(publishTargetForRole(white, 'QUOTE'), 'website');
  assert.equal(publishTargetForRole(white, 'CATALOGUE_DETAIL'), 'catalogue');
  assert.equal(publishTargetForRole(data.photos[1], 'CATALOGUE_VARIANT'), 'catalogue',
    'The server publishes a series photo to the catalogue before it becomes the colour’s catalogue lead');
  assert.equal(publishTargetForRole(data.photos[2], 'CATALOGUE_VARIANT'), null, 'Already in the catalogue');
  assert.equal(publishTargetForRole(data.photos[0], 'MAIN'), 'website', 'The public gallery always shows a colour’s own lead');
  assert.equal(publishTargetForRole(data.photos[0], 'CATALOGUE_VARIANT'), 'catalogue');
  assert.equal(publishTargetForRole(data.photos[0], 'CATALOGUE_OVERVIEW'), null, 'Series-wide choices never publish an own photo');
  assert.equal(publishTargetForRole(data.photos[2], 'CATALOGUE_OVERVIEW'), null);
  const stuck = { ...data.photos[1], publishable: false };
  assert.equal(canUseForRole(stuck, 'CATALOGUE_VARIANT'), false, 'It could not be published to the catalogue');
  assert.equal(canUseForRole(stuck, 'MAIN'), true, 'Already on the website, nothing to publish');
  assert.equal(canUseForRole(data.photos[0], 'MAIN'), true, 'Own photos need no publication step');
});

test('role rows read explicit, automatic or empty; catalogue roles stay automatic while a photo is possible', () => {
  const data = overview();
  assert.equal(roleStatus(data, 'MAIN'), 'explicit');
  assert.equal(roleStatus(data, 'QUOTE'), 'automatic');
  assert.equal(roleStatus(data, 'CATALOGUE_DETAIL'), 'automatic', 'The catalogue picks it while being made');
  assert.equal(roleStatus({ ...data, quote: null }, 'QUOTE'), 'none', 'No website photo, no quote photo');
  assert.equal(roleStatus({ ...data, photos: [], catalogueDetail: null }, 'CATALOGUE_DETAIL'), 'none');
  assert.equal(roleStatus(null, 'MAIN'), 'none');
});

test('labels use the owner’s vocabulary', () => {
  const data = overview();
  assert.equal(roleTitle('MAIN', 'Rood'), 'Hoofdfoto · Rood');
  assert.equal(roleTitle('QUOTE', 'Rood'), 'Vraag een offerte');
  assert.equal(roleTitle('CATALOGUE_DETAIL', 'Rood'), 'Catalogus · grote foto');
  assert.equal(photoScopeLabel(data.photos[0], 'Rood'), 'Losse foto');
  assert.equal(photoScopeLabel(data.photos[1], 'Rood'), 'Alleen Rood');
  assert.equal(photoScopeLabel(data.photos[2], 'Rood'), 'Alle kleuren');
  assert.equal(photoScopeLabel(data.photos[3], 'Rood'), 'Alleen Wit');
  assert.deepEqual(tileRoleBadges(data.photos[1]), ['Hoofdfoto', 'Offerte']);
  assert.deepEqual(tileRoleBadges(data.photos[2]), [], 'Catalogue roles do not crowd the tile');
  assert.equal(roleSavedMessage('QUOTE', 'Rood', false, 'website'), 'Vraag een offerte gekozen · staat nu ook op de website');
  assert.equal(roleSavedMessage('MAIN', 'Rood', true), 'Hoofdfoto · Rood kiest weer automatisch');
  assert.equal(websiteReasonText({ ...data.photos[0], websiteReason: 'FALLBACK' }),
    'Staat op de website omdat deze kleur nog geen reeksfoto online heeft.');
  assert.equal(photoTileLabel(data.photos[1], 'Rood', 1, 3), 'Foto 2 van 3 · Reeksfoto · Alleen Rood · Hoofdfoto · Offerte · op de website');
  assert.match(photoTileLabel(data.photos[0], 'Rood', 0, 3), /Losse productfoto · Losse foto · niet op de website · dubbele foto$/);
});

test('a colour shared by two sizes adds the size to stay unambiguous', () => {
  const product = { id: 53, colour: 'Rood', variantSize: 'M' };
  assert.equal(variantShortLabel(product, [{ productId: 53, colour: 'Rood' }, { productId: 54, colour: 'Roze' }]), 'Rood');
  assert.equal(variantShortLabel(product, [{ productId: 60, colour: ' rood ' }]), 'Rood · M');
  assert.equal(variantShortLabel({ id: 1, colour: null, variantSize: '23 cm' }), '23 cm');
  assert.equal(variantShortLabel({ id: 1, colour: ' ', variantSize: null }, [], 'Rood · 5.5*6cm'), 'Rood · 5.5*6cm');
  assert.equal(variantShortLabel({ id: 1, colour: null, variantSize: null }), 'deze kleur');
});

test('this colour shows own and applicable series photos; the whole series groups other colours in variant order', () => {
  const data = overview();
  assert.deepEqual(keys(colourPhotos(data)), ['P5501', 'F221', 'F229']);
  const groups = seriesPhotoGroups(data, 'Rood', [
    { productId: 53, position: 0 }, { productId: 54, position: 1 }, { productId: 55, position: 2 },
  ]);
  assert.deepEqual(groups.map((group) => [group.label, keys(group.photos)]), [
    ['Rood · deze kleur', ['P5501', 'F221']],
    ['Alle kleuren', ['F229']],
    ['Roze', ['F222']],
    ['Wit', ['F223', 'F224']],
  ]);
  const unknownOrder = seriesPhotoGroups(data, 'Rood');
  assert.deepEqual(unknownOrder.slice(2).map((group) => group.label), ['Wit', 'Roze'], 'Without members first appearance wins');
  assert.deepEqual(seriesPhotoGroups(null, 'Rood'), []);
  assert.deepEqual(keys(seriesInFamilyOrder(data)), ['F229', 'F221', 'F222', 'F223', 'F224']);
});

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
  const photo = {
    visibility: { website: false, catalogue: false, orderApp: true },
    publishedChannels: ['ORDER_APP', 'WEBSITE'] as ProductPhotoOverviewPhoto['publishedChannels'],
  };
  assert.deepEqual(selectedChannels(photo), ['WEBSITE', 'ORDER_APP']);
  assert.deepEqual(toggledChannels(photo, 'CATALOGUE'), ['WEBSITE', 'ORDER_APP', 'CATALOGUE']);
  assert.deepEqual(toggledChannels(photo, 'ORDER_APP'), ['WEBSITE']);
  // An empty stored list is a deliberate "internal only", not a missing field.
  assert.deepEqual(selectedChannels({ visibility: { website: true, catalogue: false, orderApp: false }, publishedChannels: [] }), []);
  assert.deepEqual(selectedChannels({ visibility: { website: true, catalogue: false, orderApp: false }, publishedChannels: null }), ['WEBSITE']);
});

test('cleaning a duplicate keeps the reach of the series photo it reuses', () => {
  const data = overview();
  assert.equal(cleanupScope(data, data.photos[0]), 'ALL_VARIANTS', 'The duplicate of a shared photo stays shared');
  assert.equal(cleanupScope(data, { ...data.photos[0], duplicateOfKey: 'F221' }), 'THIS_VARIANT');
  assert.equal(cleanupScope(data, { ...data.photos[0], duplicateOfKey: 'F222' }), 'ALL_VARIANTS', 'Pink keeps it, red gains it');
  assert.equal(cleanupScope(data, { ...data.photos[0], duplicateOfKey: 'F999' }), 'THIS_VARIANT');
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
  assert.deepEqual(uploadSummary({ added: 2, existing: 1, failed: 0, publishFailed: 0, channels: ['WEBSITE', 'CATALOGUE'] }),
    { text: '2 foto’s toegevoegd · op de website en de catalogus · 1 foto stond al in de reeks', ok: true });
  assert.deepEqual(uploadSummary({ added: 1, existing: 0, failed: 1, publishFailed: 0, channels: [] }),
    { text: '1 foto toegevoegd · nog niet online · 1 foto niet geüpload', ok: false });
});

test('carousels open on the Hoofdfoto and badge the current slide from the overview', () => {
  const photos = [{ id: 5501, familyPhotoId: null }, { id: 9001, familyPhotoId: 229 }, { id: 9002, familyPhotoId: 221 }];
  assert.deepEqual(hoofdfotoFirst(photos, photos[2]).map((item) => item.id), [9002, 5501, 9001]);
  assert.deepEqual(hoofdfotoFirst(photos, null).map((item) => item.id), [5501, 9001, 9002]);
  assert.deepEqual(hoofdfotoFirst(photos, { id: 1, familyPhotoId: null }).map((item) => item.id), [5501, 9001, 9002]);
  const data = overview();
  assert.deepEqual(slideBadges(photos[2], true, data), ['Hoofdfoto', 'Website', 'Offerte']);
  assert.deepEqual(slideBadges(photos[1], false, data), ['Website']);
  assert.deepEqual(slideBadges(photos[0], false, data), []);
  assert.deepEqual(slideBadges(photos[2], true, null), ['Hoofdfoto'], 'Without the overview only the local rule speaks');
});
