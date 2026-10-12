import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { parseSupplierNote } from '../src/app/features/products/supplier-note.ts';
import { orderedSupplierAgreementPhotos } from '../src/app/features/products/product-supplier-agreement-state.ts';
import { photoKeyForProductPhoto, placeCards, resolvedPlaces, tileUses, variantShortLabel } from '../src/app/features/products/product-photos-state.ts';
import { salesPhoto } from '../src/app/shared/sales-photo.ts';

const source = await readFile(new URL('../src/app/features/products/product-view.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('product-view.ts', source, ts.ScriptTarget.Latest, true);
const viewClass = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'ProductView');
assert.ok(viewClass);
const names = new Set(['galleryPhotos', 'photoOverview', 'currentSlideBadges', 'photoColour', 'placeLine', 'family', 'lightbox', 'galleryIndex', 'galleryPointer', 'gallerySuppressClickUntil', 'selectGalleryPhoto', 'stepGallery', 'openCurrentGalleryPhoto', 'startGallerySwipe', 'finishGallerySwipe', 'cancelGallerySwipe', 'scrollToDetailSection', 'revealSelectedVariant', 'supplierAgreement', 'agreementPhotos', 'agreementLoading', 'agreementLoadError', 'supplierNoteBlocks', 'loadSupplierAgreement']);
const members = viewClass.members.filter(member => member.name && ts.isIdentifier(member.name) && names.has(member.name.text));
assert.equal(members.length, names.size);
const selectedClass = ts.factory.updateClassDeclaration(viewClass, viewClass.modifiers?.filter(modifier => !ts.isDecorator(modifier)), viewClass.name, viewClass.typeParameters, undefined, members);
const code = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [selectedClass])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function harness() {
  const exports: { ProductView?: new () => any } = {};
  let now = 1000;
  const scrolls: unknown[] = [];
  const hashes: string[] = [];
  const target = { scrollIntoView: (value: unknown) => scrolls.push(value) };
  const window = { matchMedia: () => ({ matches: true }), location: { href: 'http://fixture/products/45' }, history: { state: {}, replaceState: (_state: unknown, _title: string, url: URL) => hashes.push(url.hash) } };
  vm.runInNewContext(code, { exports, signal, computed, parseSupplierNote, orderedSupplierAgreementPhotos, photoKeyForProductPhoto, placeCards, resolvedPlaces, tileUses, variantShortLabel, salesPhoto, messageOf: (failure: Error) => failure.message, performance: { now: () => now }, window, URL, HTMLDetailsElement: class {}, document: { getElementById: (id: string) => id === 'stock-card' ? target : null } });
  const view = new exports.ProductView!();
  view.loadVersion = 1;
  view.product = signal({ id: 45, supplierNote: 'Old local instruction must not leak', photos: [{ id: 1 }, { id: 2 }, { id: 3 }] });
  const events: string[] = [];
  const element = { setPointerCapture: () => events.push('capture'), hasPointerCapture: () => true, releasePointerCapture: () => events.push('release') };
  const pointer = (x: number, y: number, extra = {}) => ({ pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: x, clientY: y, currentTarget: element, preventDefault: () => events.push('prevent'), ...extra });
  return { view, pointer, events, scrolls, hashes, advance: () => { now += 400; } };
}

test('photo controls stay inside the selected product and magnify the displayed photo', () => {
  const { view } = harness();
  view.selectGalleryPhoto(99);
  assert.equal(view.galleryIndex(), 2);
  view.openCurrentGalleryPhoto();
  assert.equal(view.lightbox(), 2);
  view.stepGallery(1, 3);
  assert.equal(view.galleryIndex(), 0);
  view.selectGalleryPhoto(-1);
  assert.equal(view.galleryIndex(), 0);
  view.product.set({ id: 46, photos: [] });
  view.selectGalleryPhoto(1);
  view.stepGallery(1, 0);
  assert.equal(view.galleryIndex(), 0);
});

/* The half heart series seen from Kersenroze (product 100); Rood is 101. */
const OFF = { website: false, catalogue: false, orderApp: false };
const entry = (key: string, extra: Record<string, unknown> = {}) => ({
  key, kind: key.startsWith('P') ? 'OWN' : 'SERIES', scope: 'THIS_VARIANT', variantProductId: 100, variantLabel: 'Kersenroze',
  smallUrl: `/small/${key}`, mediumUrl: `/medium/${key}`, visibility: { ...OFF }, roles: [], publishable: true, duplicateOfKey: null, ...extra,
});
const spot = (shownKey: string | null, state: string, reason: string | null = null, extra: Record<string, unknown> = {}) => ({
  shownKey, chosenKey: state === 'CHOSEN' ? shownKey : null, state, reason, role: null, scope: 'COLOUR',
  relatedProductId: null, relatedLabel: null, thisColour: false, ...extra,
});
function overview(places: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    productId: 100, familyId: 33, variantLabel: 'Kersenroze', familyWebsiteStatus: 'PUBLISHED',
    photos: [
      entry('F242', { visibility: { website: true, catalogue: true, orderApp: false }, roles: ['MAIN', 'QUOTE', 'CATALOGUE_VARIANT'] }),
      entry('F243'),
      entry('F244', { visibility: { website: true, catalogue: false, orderApp: false } }),
      entry('P5601'),
    ],
    main: { key: 'F242', explicit: true }, quote: { key: 'F242', explicit: false }, catalogueVariant: { key: 'F243', explicit: true },
    catalogueOverview: null, catalogueDetail: null, catalogueDetailSize: 'STANDARD',
    places: {
      websiteColour: spot('F242', 'CHOSEN'), websiteOpening: spot('F214', 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER'),
      documents: spot('F242', 'CHOSEN'), websiteQuote: spot('F244', 'CHOSEN'),
      catalogueColour: spot('F243', 'CHOSEN'), catalogueDetail: spot('F243', 'AUTOMATIC', 'THIS_COLOUR_LEAD'),
      catalogueOverview: spot('F243', 'AUTOMATIC', 'SAME_AS_LARGE_PHOTO'), catalogueCompactRow: spot('F243', 'CHOSEN'),
      ...places,
    },
    otherPhotos: [], seriesLiveOnWebsite: true, colourOnWebsite: true, websitePageUrl: 'https://enrosed.com/nl/products/half-heart/',
    catalogueAssumption: { layout: 'BROCHURE', photosPerSeries: 1, productIds: [100, 101], includesThisColour: true },
    ...extra,
  };
}
/** The same answer from a server of before the places: none of the new fields. */
function legacyOverview() {
  const { places, otherPhotos, seriesLiveOnWebsite, colourOnWebsite, websitePageUrl, catalogueAssumption, ...old } = overview();
  void places; void otherPhotos; void seriesLiveOnWebsite; void colourOnWebsite; void websitePageUrl; void catalogueAssumption;
  return old;
}
const kersenroze = (extra: Record<string, unknown> = {}) => ({
  id: 100, familyId: 33, colour: 'Kersenroze', variantSize: null, active: true, demo: false,
  photos: [{ id: 5601, familyPhotoId: null, leadFor: [] }, { id: 9001, familyPhotoId: 243, leadFor: ['CATALOGUE'] },
    { id: 9002, familyPhotoId: 242, leadFor: ['WEBSITE'] }, { id: 9003, familyPhotoId: 244, leadFor: [] }],
  ...extra,
});
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test('the carousel opens on the photo of quotes and invoices and names where customers see the current slide', () => {
  const { view } = harness();
  view.product.set(kersenroze());
  assert.deepEqual(plain(view.galleryPhotos().map((photo: any) => photo.id)), [9002, 5601, 9001, 9003], 'The website choice opens the carousel');
  assert.deepEqual(plain(view.product().photos.map((photo: any) => photo.id)), [5601, 9001, 9002, 9003], 'The product keeps its own order');
  assert.deepEqual(plain(view.currentSlideBadges()), [], 'Nothing is claimed before the server answered');
  view.photoOverview.set(overview());
  assert.deepEqual(plain(view.currentSlideBadges()), ['Website']);
  view.stepGallery(1, 4);
  assert.deepEqual(plain(view.currentSlideBadges()), [], 'The own cut-out is used nowhere');
  view.stepGallery(1, 4);
  assert.deepEqual(plain(view.currentSlideBadges()), ['Catalogus']);
  view.stepGallery(1, 4);
  assert.deepEqual(plain(view.currentSlideBadges()), ['Bestelpagina'], 'An extra website photo is only named for the place that shows it');
  view.openCurrentGalleryPhoto();
  assert.equal(view.lightbox(), 3, 'The lightbox follows the same order as the carousel');
  view.photoOverview.set(overview({ websiteQuote: spot('F242', 'AUTOMATIC', 'FIRST_COLOUR_WEBSITE_PHOTO'), catalogueColour: spot('F242', 'CHOSEN') }));
  view.selectGalleryPhoto(0);
  assert.deepEqual(plain(view.currentSlideBadges()), ['Website', 'Catalogus', 'Bestelpagina'], 'The order of the three words is fixed');
  for (const word of ['Hoofdfoto', '\'Offerte\'', 'is-main']) assert.ok(!source.includes(word), `${word} left the product page`);
});

test('an older server still gets the words Website, Catalogus and Bestelpagina from its old fields', () => {
  const { view } = harness();
  view.product.set(kersenroze());
  view.photoOverview.set(legacyOverview());
  assert.deepEqual(plain(view.currentSlideBadges()), ['Website', 'Bestelpagina'], 'The stored website choice and the order page photo');
  view.selectGalleryPhoto(2);
  assert.deepEqual(plain(view.currentSlideBadges()), ['Catalogus'], 'The stored catalogue choice');
  view.selectGalleryPhoto(3);
  assert.deepEqual(plain(view.currentSlideBadges()), [], 'Being on the website is not "the website photo of this colour"');
  assert.equal(view.placeLine(), null, 'The line of three places needs a server that resolves them');
});

test('the line "Dit zien klanten bij …" draws the three places and links Website and Catalogus to their picker', () => {
  const { view } = harness();
  assert.equal(view.placeLine(), null);
  view.product.set(kersenroze());
  assert.equal(view.placeLine(), null, 'Nothing is drawn before the server answered');
  view.photoOverview.set(overview());
  assert.deepEqual(plain(view.placeLine()), {
    productId: 100,
    heading: 'Dit zien klanten bij Kersenroze',
    items: [
      { key: 'website', name: 'Website', photoUrl: '/small/F242', alt: 'Websitefoto van Kersenroze', empty: 'Zelf gekozen', kies: 'website', linkLabel: 'Wijzig de websitefoto van Kersenroze' },
      { key: 'catalogue', name: 'Catalogus', photoUrl: '/small/F243', alt: 'Catalogusfoto van Kersenroze', empty: 'Zelf gekozen', kies: 'catalogus', linkLabel: 'Wijzig de catalogusfoto van Kersenroze' },
      { key: 'documents', name: 'Offertes en facturen', photoUrl: '/small/F242', alt: 'Foto van Kersenroze op offertes en facturen', empty: 'Zelfde foto als de website', kies: null, linkLabel: null },
    ],
  });
  // Two colours with one name: the size joins the colour, as in the photo section.
  view.family.set({ members: [{ productId: 100, colour: 'Kersenroze' }, { productId: 127, colour: 'kersenroze' }] });
  view.product.set(kersenroze({ variantSize: '5.5*6cm' }));
  assert.equal(view.placeLine().heading, 'Dit zien klanten bij Kersenroze · 5.5*6cm');
  assert.equal(view.placeLine().items[1].linkLabel, 'Wijzig de catalogusfoto van Kersenroze · 5.5*6cm');
  view.product.set({ ...kersenroze(), id: null });
  assert.equal(view.placeLine(), null, 'An unsaved product has no editor to link to');
});

test('the line follows the states of the cards: no photo, documents only, a colour that is off, a one-colour series', () => {
  const { view } = harness();
  view.product.set(kersenroze());
  const items = () => plain(view.placeLine().items).map((item: any) => [item.photoUrl, item.empty, item.kies, item.linkLabel]);
  view.photoOverview.set(overview({
    websiteColour: spot(null, 'NONE', 'NO_PHOTO'), catalogueColour: spot(null, 'NONE', 'NO_PHOTO'), documents: spot('F243', 'AUTOMATIC', 'FIRST_SERIES_PHOTO'),
  }));
  assert.deepEqual(items(), [
    [null, 'Geen foto', 'website', 'Kies een websitefoto voor Kersenroze'],
    [null, 'Geen foto', 'catalogus', 'Kies een catalogusfoto voor Kersenroze'],
    ['/small/F243', 'Alleen op offertes en facturen', null, null],
  ], 'Offertes en facturen never links from here, whatever its own button says');
  // An inactive colour is not on the website and has no "Wijzig" there; it still counts for the pdf.
  view.product.set(kersenroze({ active: false }));
  view.photoOverview.set(overview({ websiteColour: spot(null, 'CHOSEN_NOT_SHOWN', 'COLOUR_NOT_ACTIVE', { chosenKey: 'F242' }), catalogueColour: spot('P5601', 'AUTOMATIC', 'OWN_PHOTO_FIRST') }));
  assert.deepEqual(items().slice(0, 2), [
    [null, 'Kleur staat niet aan', null, null],
    ['/small/P5601', 'Automatisch gekozen', 'catalogus', 'Wijzig de catalogusfoto van Kersenroze'],
  ]);
  // A demo product is in no catalogue: neither card has a picker, so nothing links.
  view.product.set(kersenroze({ demo: true }));
  view.photoOverview.set(overview({
    websiteColour: spot(null, 'NONE', 'COLOUR_NOT_ACTIVE'), catalogueColour: spot(null, 'NONE', 'COLOUR_NOT_ACTIVE'),
  }, { catalogueAssumption: { layout: 'BROCHURE', photosPerSeries: 1, productIds: [101], includesThisColour: false } }));
  assert.deepEqual(items().map((item: unknown[]) => item[2]), [null, null, null]);
  // One colour: the pdf prints no colour strip, the series' large photo is this colour's picture.
  view.product.set(kersenroze());
  view.photoOverview.set(overview({
    catalogueColour: spot(null, 'CHOSEN_NOT_SHOWN', 'SINGLE_COLOUR_SERIES', { chosenKey: 'F243' }), catalogueDetail: spot('F243', 'AUTOMATIC', 'THIS_COLOUR_LEAD'),
  }, { catalogueAssumption: { layout: 'BROCHURE', photosPerSeries: 1, productIds: [100], includesThisColour: true } }));
  assert.deepEqual(items()[1], ['/small/F243', 'Zelf gekozen', 'catalogus', 'Wijzig de catalogusfoto van Kersenroze']);
  view.selectGalleryPhoto(2);
  assert.deepEqual(plain(view.currentSlideBadges()), ['Catalogus']);
});

test('the product page offers a button to the photo section and the line of places on both screens', async () => {
  const desk = await readFile(new URL('../src/app/features/products/product-desk.ts', import.meta.url), 'utf8');
  for (const [name, text] of [['product-view.ts', source], ['product-desk.ts', desk]] as const) {
    assert.match(text, /class="btn btn--sm pd-(?:photo-manage|gallery__manage)" \[routerLink\]="\['\/products', product\.id, 'edit'\]" \[queryParams\]="\{ tab: 'media' \}">Foto’s beheren<\/a>/, `${name}: the button`);
    assert.match(text, /Nog geen foto<\/(?:span|b)>\s*<a class="btn btn--sm" \[routerLink\]="\['\/products', product\.id, 'edit'\]" \[queryParams\]="\{ tab: 'media' \}">Foto’s toevoegen<\/a>/, `${name}: the empty state`);
    assert.match(text, /@if \(placeLine\(\); as line\) \{ <app-product-places-line class="[\w-]+" \[line\]="line" \/> \}/, `${name}: the places line`);
    assert.ok(!/beheren ›|Hoofdfoto/.test(text), `${name}: the grey text link and the old badge are gone`);
  }
  const line = await readFile(new URL('../src/app/features/products/product-places-line.ts', import.meta.url), 'utf8');
  assert.match(line, /\[routerLink\]="\['\/products', line\(\)\.productId, 'edit'\]" \[queryParams\]="\{ tab: 'media', kies: kies \}"/,
    'Website and Catalogus open the editor with their picker');
});

test('a horizontal swipe changes the photo and suppresses its generated zoom click', () => {
  const { view, pointer, events, advance } = harness();
  view.startGallerySwipe(pointer(160, 30), 3);
  view.finishGallerySwipe(pointer(55, 35), 3);
  assert.equal(view.galleryIndex(), 1);
  assert.ok(events.includes('prevent'));
  view.openCurrentGalleryPhoto();
  assert.equal(view.lightbox(), -1);
  advance();
  view.openCurrentGalleryPhoto();
  assert.equal(view.lightbox(), 1);
});

test('vertical scrolling, pointer cancellation and multiple touches do not select another photo', () => {
  const { view, pointer, events } = harness();
  view.startGallerySwipe(pointer(150, 30), 3);
  view.finishGallerySwipe(pointer(120, 140), 3);
  assert.equal(view.galleryIndex(), 0);
  assert.ok(!events.includes('prevent'));
  view.startGallerySwipe(pointer(160, 30), 3);
  view.cancelGallerySwipe();
  view.finishGallerySwipe(pointer(20, 30), 3);
  assert.equal(view.galleryIndex(), 0);
  view.startGallerySwipe(pointer(160, 30), 3);
  view.startGallerySwipe(pointer(170, 30, { isPrimary: false, pointerId: 2 }), 3);
  view.finishGallerySwipe(pointer(20, 30), 3);
  assert.equal(view.galleryIndex(), 0);
});

test('stock information remains reachable without shortcut rails and respects reduced motion', () => {
  const { view, scrolls, hashes } = harness();
  view.scrollToDetailSection('stock-card');
  assert.deepEqual(JSON.parse(JSON.stringify(scrolls)), [{ behavior: 'auto', block: 'start' }]);
  assert.deepEqual(hashes, ['#stock-card']);
  view.scrollToDetailSection('missing');
  assert.equal(scrolls.length, 1);
});


test('selected variants are revealed horizontally while already visible choices stay put', () => {
  const { view } = harness();
  const item = { left: 320, right: 430 };
  const rail = { scrollLeft: 0, getBoundingClientRect: () => ({ left: 10, right: 300 }), querySelector: () => ({ getBoundingClientRect: () => item }) };
  view.revealSelectedVariant(rail);
  assert.equal(rail.scrollLeft, 131);
  item.left = 40; item.right = 150;
  view.revealSelectedVariant(rail);
  assert.equal(rail.scrollLeft, 131, 'No scroll reset on a stable selection');
  item.left = -60; item.right = 50;
  view.revealSelectedVariant(rail);
  assert.equal(rail.scrollLeft, 60);
});

test('effective shared supplier instructions use source photos and never fall back to stale own notes', async () => {
  const { view } = harness();
  const agreement = { productId: 45, sourceProductId: 44, inherited: true, available: true, note: 'Approved shared instructions.', photos: [{ id: 2, position: 1, viewUrl: '/api/products/44/supplier-agreement/photos/2/view' }, { id: 1, position: 0, viewUrl: '/api/products/44/supplier-agreement/photos/1/view' }] };
  view.supplierAgreementApi = { get: async () => agreement };
  await view.loadSupplierAgreement(45, 1);
  assert.equal(view.supplierAgreement().sourceProductId, 44);
  assert.deepEqual(view.agreementPhotos().map((photo: any) => photo.id), [1, 2]);
  assert.match(view.agreementPhotos()[0].viewUrl, /products\/44/);
  assert.equal(view.supplierNoteBlocks()[0].text, 'Approved shared instructions.');
  view.supplierAgreementApi.get = async () => ({ ...agreement, available: false });
  await view.loadSupplierAgreement(45, 1);
  assert.equal(view.agreementPhotos().length, 0);
  assert.equal(view.supplierNoteBlocks().length, 0);
});

test('supplier read failure is explicit; a late previous-product response cannot replace current details', async () => {
  const { view } = harness();
  view.supplierAgreementApi = { get: async () => { throw new Error('Temporary failure'); } };
  await view.loadSupplierAgreement(45, 1);
  assert.equal(view.agreementLoadError(), 'Temporary failure');
  assert.equal(view.supplierNoteBlocks().length, 0);
  let finish!: (value: unknown) => void;
  view.supplierAgreementApi.get = () => new Promise(resolve => { finish = resolve; });
  const pending = view.loadSupplierAgreement(45, 1);
  view.loadVersion = 2;
  view.supplierAgreement.set({ productId: 46, available: true, note: 'Current variant', photos: [] });
  finish({ productId: 45, available: true, note: 'Old variant', photos: [] });
  await pending;
  assert.equal(view.supplierAgreement().productId, 46);
  assert.equal(view.supplierNoteBlocks()[0].text, 'Current variant');
});
