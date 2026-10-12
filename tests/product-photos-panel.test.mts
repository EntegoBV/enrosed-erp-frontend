import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import * as state from '../src/app/features/products/product-photos-state.ts';
import { salesPhoto } from '../src/app/shared/sales-photo.ts';

// Run the real panel members with inert API, toast and DOM boundaries; the
// server contract is played by the fixtures below.
const text = await readFile(new URL('../src/app/features/products/product-photos-panel.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('product-photos-panel.ts', text, ts.ScriptTarget.Latest, true);
const panel = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'ProductPhotosPanel')!;
const names = ['overview', 'loading', 'loadError', 'busy', 'view', 'reordering', 'pickerKind', 'pickerBusyKey', 'uploadStage', 'uploadedKey', 'openKey', 'staged',
  'addScope', 'addWebsite', 'addCatalogue', 'addError', 'uploadProgress', 'orderOverride', 'announcement', 'lastChange', 'othersOpen', 'others',
  'loadVersion', 'othersVersion', 'lastOrderToast', 'productId', 'interactionDisabled', 'colour', 'places', 'live', 'cards', 'notes', 'rows',
  'syncPill', 'changedText', 'colourList', 'groups', 'duplicates', 'shownColour', 'shownGroups', 'orderList', 'orderRest', 'sheetList', 'picker',
  'otherMembers', 'otherRows', 'compareStrip', 'compareNeighbours',
  'openPicker', 'closePicker', 'openRequestedPicker', 'loadOthers', 'cardAction', 'pickRole', 'pickFromPicker', 'clearFromPicker',
  'uploadFromPicker', 'compareOpened', 'undo', 'repair', 'useWebsitePhotoForDocuments', 'uploadAndUse', 'setDetailSize', 'setChannels',
  'setScope', 'remove', 'confirmUpload', 'moveOrder', 'run', 'afterSave', 'refreshOthers', 'switchesOf', 'choiceHidden', 'refreshSync', 'load', 'apply',
  'reload', 'focusHandle'];
const picked = panel.members.filter((member) => member.name && ts.isIdentifier(member.name) && names.includes(member.name.text));
assert.equal(picked.length, names.length, 'The tests must run the current production members');
const helperNames = ['isOverview', 'placeOfRole', 'kindOfRole', 'fileSha256', 'HIDDEN_CHOICE'];
const helpers = parsed.statements.filter((node) => (ts.isFunctionDeclaration(node) && helperNames.includes(node.name?.text ?? ''))
  || (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && helperNames.includes(item.name.text))));
assert.equal(helpers.length, helperNames.length, 'The tests must run the current module helpers');
const klass = ts.factory.updateClassDeclaration(panel, undefined, panel.name, undefined, undefined, picked);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [...helpers, klass])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText + '\nexports.Panel = ProductPhotosPanel;';

const clone = <T>(value: T): T => structuredClone(value);
function photo(key: string, changes: Record<string, unknown> = {}) {
  const own = key.startsWith('P');
  const id = Number(key.slice(1));
  return { key, kind: own ? 'OWN' : 'SERIES', familyPhotoId: own ? null : id, productPhotoId: own ? id : 9000 + id,
    scope: 'THIS_VARIANT', variantProductId: 53, variantLabel: 'Rood', originalFilename: `${key}.png`, contentType: 'image/png',
    widthPx: 800, heightPx: 800, sizeBytes: 100, smallUrl: `/s/${key}`, mediumUrl: `/m/${key}`, largeUrl: `/l/${key}`, downloadUrl: `/d/${key}`,
    visibility: { website: !own, catalogue: false, orderApp: false }, websiteReason: own ? null : 'PUBLISHED', publishable: !own,
    roles: [] as string[], duplicateOfKey: null, familyPosition: own ? null : id, ownPosition: own ? 0 : null, ...changes };
}
function overview(changes: Record<string, unknown> = {}) {
  return {
    productId: 53, familyId: 13, familyName: 'Bowl rozen', variantLabel: 'Rood · M', familyWebsiteStatus: 'PUBLISHED',
    photos: [
      photo('P5501'),
      photo('F2', { roles: ['MAIN', 'QUOTE'] }),
      photo('F1', { scope: 'ALL_VARIANTS', variantProductId: null, variantLabel: null }),
      photo('F3', { scope: 'OTHER_VARIANT', variantProductId: 54, variantLabel: 'Roze', visibility: { website: false, catalogue: false, orderApp: false }, websiteReason: null }),
    ],
    main: { key: 'F2', explicit: false }, quote: { key: 'F2', explicit: false }, catalogueVariant: null,
    catalogueOverview: { key: 'F1', explicit: true }, catalogueDetail: { key: 'P5501', explicit: true }, catalogueDetailSize: 'STANDARD',
    ...changes,
  };
}

const ROLE_FIELD: Record<string, string> = {
  MAIN: 'main', QUOTE: 'quote', CATALOGUE_VARIANT: 'catalogueVariant', CATALOGUE_DETAIL: 'catalogueDetail', CATALOGUE_OVERVIEW: 'catalogueOverview',
};
/* A file is its name here: the name gives the bytes, so the same name is the same photo. */
const file = (name: string) => ({ name, type: 'image/jpeg', size: 1000, arrayBuffer: async () => new TextEncoder().encode(name).buffer });
const sha = (name: string) => createHash('sha256').update(name).digest('hex');

function harness({ crypto = undefined as unknown } = {}) {
  const exported: any = {};
  const frames: (() => void)[] = [], revoked: string[] = [];
  // `crypto` is absent by default: a plain-http address has no crypto.subtle (the road without a hash).
  vm.runInNewContext(javascript, { exports: exported, signal, computed, ...state, salesPhoto, structuredClone, Date, Set, Map, crypto,
    messageOf: (failure: any, fallback: string) => failure?.error?.message ?? fallback,
    escapeHtml: (value: string) => value,
    setTimeout: (fn: () => void) => fn(), requestAnimationFrame: (fn: () => void) => frames.push(fn),
    URL: { revokeObjectURL: (url: string) => revoked.push(url) } });
  const page = new exported.Panel();
  const calls: any[] = [], toasts: [string, string | undefined][] = [], changes: number[] = [], refreshes: number[] = [];
  const actions: ({ label: string; run: () => void } | undefined)[] = [], handled: number[] = [], confirms: any[] = [];
  let familyImages: any[] = [{ id: 1, position: 0 }, { id: 300, position: 1 }, { id: 2, position: 2 }, { id: 3, position: 3 }];
  Object.assign(page, {
    product: signal({ id: 53, colour: 'Rood', variantSize: 'M', active: true, photos: [] as any[] }), members: signal([]), disabled: signal(false),
    changed: { emit: () => changes.push(1) }, pick: signal(null), pickHandled: { emit: () => handled.push(1) },
    ui: {
      toast: (message: string, kind?: string, action?: { label: string; run: () => void }) => { toasts.push([message, kind]); actions.push(action); },
      confirm: (question: unknown, go: () => void) => { confirms.push(question); go(); },
    },
    // The shared website status, as a stub: the panel only reads it and asks for a refresh.
    sync: { status: signal(null), pollEnded: signal(false), loadError: signal(null), refresh: () => refreshes.push(1) },
    host: { nativeElement: { querySelector: () => null } },
    catalog: {
      productPhotoOverview: async (id: number) => { calls.push(['overview', id]); return overview(); },
      setProductPhotoRole: async (id: number, role: string, key: string | null) => {
        calls.push(['role', id, role, key]);
        return overview({ [ROLE_FIELD[role]]: key === null ? overview()[ROLE_FIELD[role] as 'main'] && { ...overview()[ROLE_FIELD[role] as 'main'], explicit: false } : { key, explicit: true } });
      },
      productFamily: async (id: number) => { calls.push(['family', id]); return { id, images: clone(familyImages) }; },
      reorderProductFamilyImages: async (id: number, ids: number[]) => { calls.push(['order', id, [...ids]]); return { id }; },
      updateCataloguePhotos: async (id: number, selection: unknown) => { calls.push(['catalogue', id, clone(selection)]); return { id }; },
      updateProductFamilyImagePublication: async (id: number, image: number, channels: string[]) => { calls.push(['publish', id, image, [...channels]]); return { id }; },
      updateProductFamilyImageVariant: async (id: number, image: number, variant: number | null) => { calls.push(['variant', id, image, variant]); return { id }; },
      uploadProductFamilyImage: async (id: number, file: { name: string }, variant: number | null) => {
        calls.push(['upload', id, file.name, variant]);
        if (file.name === 'broken.jpg') throw { error: { message: 'Bestand is beschadigd' } };
        if (file.name !== 'same.jpg') familyImages = [...familyImages, { id: 400 + familyImages.length, position: familyImages.length, variantProductId: variant }];
        return { id, images: clone(familyImages) };
      },
    },
  });
  page.overview.set(overview());
  return { page, calls, toasts, actions, handled, confirms, changes, frames, revoked, refreshes };
}

/**
 * A server that answers the final contract: `places` computed from stored
 * choices and switches, the role call that switches a photo on, the upload
 * that reuses identical bytes. Rood (53) with Roze (54) in one series.
 */
function withServer(options: { crypto?: boolean; single?: boolean } = {}) {
  const base = harness({ crypto: options.crypto === false ? undefined : webcrypto });
  const { page, calls } = base;
  const stages: (string | null)[] = [];
  const s = {
    main: null as string | null, catalogue: null as string | null, detail: null as string | null, documents: null as string | null,
    single: options.single === true, hideChoice: false, refuseRole: null as string | null, refusePublish: false, size: 'STANDARD',
    channels: { F1: ['WEBSITE'], F2: ['WEBSITE'], F3: [], F5: [], F6: [] } as Record<string, string[]>,
    owner: { F1: null, F2: 53, F3: 54, F5: 53, F6: 53 } as Record<string, number | null>,
    images: [
      { id: 1, position: 0, variantProductId: null, variantColor: null, sourceKey: 'import-1', largeSha256: sha('all.jpg').toUpperCase() },
      { id: 2, position: 1, variantProductId: 53, variantColor: 'Rood', sourceKey: `admin-${sha('mine.jpg')}`, largeSha256: 'other' },
      { id: 3, position: 2, variantProductId: 54, variantColor: 'Roze', sourceKey: 'import-3', largeSha256: sha('roze.jpg') },
      // The same bytes twice: an imported photo first, a later admin upload after it. The server reuses the admin one.
      { id: 5, position: 3, variantProductId: 53, variantColor: 'Rood', sourceKey: 'import-5', largeSha256: sha('dup.jpg') },
      { id: 6, position: 4, variantProductId: 53, variantColor: 'Rood', sourceKey: `admin-${sha('dup.jpg')}`, largeSha256: sha('dup.jpg') },
    ] as any[],
  };
  const on = (key: string | null, channel: string) => key !== null && (key.startsWith('P') || (s.channels[key] ?? []).includes(channel));
  const at = (shownKey: string | null, chosenKey: string | null, placeState: string, reason: string | null, role: string | null, scope = 'COLOUR') =>
    ({ shownKey, chosenKey, state: placeState, reason, role, scope, relatedProductId: null, relatedLabel: null, thisColour: true });
  const view = () => {
    const keys = Object.keys(s.channels);
    const mine = [...keys.filter((key) => s.owner[key] === 53), ...keys.filter((key) => s.owner[key] === null)];
    const automatic = mine.find((key) => on(key, 'WEBSITE')) ?? null;
    const website = s.main === null ? at(automatic, null, automatic ? 'AUTOMATIC' : 'NONE', automatic ? 'OWN_COLOUR_SERIES_PHOTO' : 'NO_PHOTO', 'MAIN')
      : on(s.main, 'WEBSITE') ? at(s.main, s.main, 'CHOSEN', null, 'MAIN')
        : at(automatic, s.main, 'CHOSEN_NOT_SHOWN', 'NOT_PUBLISHED_FOR_WEBSITE', 'MAIN');
    const documentsKey = s.documents ?? s.main ?? mine[0] ?? null;
    const shown = s.catalogue !== null && on(s.catalogue, 'CATALOGUE') && !s.hideChoice && (s.single || s.owner[s.catalogue] !== null);
    const colour = s.single ? at(null, s.catalogue, s.catalogue ? 'CHOSEN_NOT_SHOWN' : 'NONE', 'SINGLE_COLOUR_SERIES', 'CATALOGUE_VARIANT')
      : s.catalogue === null ? at('P5501', null, 'AUTOMATIC', 'OWN_PHOTO_FALLBACK', 'CATALOGUE_VARIANT')
        : shown ? at(s.catalogue, s.catalogue, 'CHOSEN', null, 'CATALOGUE_VARIANT')
          : at('P5501', s.catalogue, 'CHOSEN_NOT_SHOWN', 'NOT_PUBLISHED_FOR_CATALOGUE', 'CATALOGUE_VARIANT');
    const lead = shown ? s.catalogue : null;
    const series = (role: string) => s.detail !== null && role === 'CATALOGUE_DETAIL'
      ? (on(s.detail, 'CATALOGUE') ? at(s.detail, s.detail, 'CHOSEN', null, role, 'SERIES') : at('F1', s.detail, 'CHOSEN_NOT_SHOWN', 'CHOICE_NOT_AVAILABLE', role, 'SERIES'))
      : lead ? at(lead, null, 'AUTOMATIC', 'THIS_COLOUR_LEAD', role, 'SERIES') : at('F1', null, 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER', role, 'SERIES');
    const photos = [photo('P5501'), ...keys.map((key) => photo(key, {
      scope: s.owner[key] === 53 ? 'THIS_VARIANT' : s.owner[key] === null ? 'ALL_VARIANTS' : 'OTHER_VARIANT',
      variantProductId: s.owner[key], variantLabel: s.owner[key] === 53 ? 'Rood' : s.owner[key] === null ? null : 'Roze',
      publishedChannels: [...s.channels[key]], publishable: true,
      visibility: { website: on(key, 'WEBSITE'), catalogue: on(key, 'CATALOGUE'), orderApp: false },
      chosenFor: [...(s.main === key ? [{ productId: 53, variantLabel: 'Rood', role: 'MAIN' }] : []),
        ...(s.catalogue === key ? [{ productId: 53, variantLabel: 'Rood', role: 'CATALOGUE_VARIANT' }] : [])],
    }))];
    return overview({
      photos, main: documentsKey ? { key: documentsKey, explicit: s.main !== null } : null, quote: { key: 'F2', explicit: false },
      catalogueVariant: s.catalogue ? { key: s.catalogue, explicit: true } : null, catalogueOverview: null, catalogueDetail: null,
      catalogueDetailSize: s.size, otherPhotos: [], seriesLiveOnWebsite: true, colourOnWebsite: true, websitePageUrl: 'https://enrosed.com/nl/products/bowl/',
      catalogueAssumption: { productIds: s.single ? [53] : [53, 54], includesThisColour: true },
      places: {
        websiteColour: website, websiteOpening: at('F1', null, 'AUTOMATIC', 'FIRST_IN_SERIES_ORDER', null, 'SERIES'),
        documents: at(documentsKey, s.main, s.main ? 'CHOSEN' : 'AUTOMATIC', s.main ? null : 'FIRST_SERIES_PHOTO', null),
        websiteQuote: at('F2', null, 'AUTOMATIC', 'FIRST_COLOUR_WEBSITE_PHOTO', 'QUOTE', 'SERIES'),
        catalogueColour: colour, catalogueDetail: series('CATALOGUE_DETAIL'), catalogueOverview: series('CATALOGUE_OVERVIEW'),
        catalogueCompactRow: at(colour.shownKey, colour.chosenKey, colour.state, colour.reason, null),
      },
    });
  };
  Object.assign(page.catalog, {
    productPhotoOverview: async (id: number) => {
      calls.push(['overview', id]);
      return id === 53 ? view() : { ...view(), productId: id, photos: [photo('F3', { variantProductId: id })], places: { ...view().places,
        websiteColour: at('F3', null, 'AUTOMATIC', 'OWN_COLOUR_SERIES_PHOTO', 'MAIN'), catalogueColour: at('F3', 'F3', 'CHOSEN', null, 'CATALOGUE_VARIANT') } };
    },
    setProductPhotoRole: async (id: number, role: string, key: string | null) => {
      calls.push(['role', id, role, key]);
      stages.push(page.uploadStage());
      if (s.refuseRole) throw { error: { message: s.refuseRole } };
      const channel = role === 'MAIN' ? 'WEBSITE' : 'CATALOGUE';
      if (key && s.channels[key] && !s.channels[key].includes(channel)) s.channels[key] = [...s.channels[key], channel];
      if (role === 'MAIN') s.main = key; else if (role === 'CATALOGUE_VARIANT') s.catalogue = key; else if (role === 'CATALOGUE_DETAIL') s.detail = key;
      return view();
    },
    updateProductFamilyImagePublication: async (id: number, image: number, channels: string[]) => {
      calls.push(['publish', id, image, [...channels]]);
      if (s.refusePublish) throw { error: { message: 'Niet toegestaan' } };
      s.channels[`F${image}`] = [...channels];
      return { id };
    },
    productFamily: async (id: number) => { calls.push(['family', id]); return { id, images: clone(s.images) }; },
    uploadProductFamilyImage: async (id: number, upload: { name: string }, variant: number | null) => {
      calls.push(['upload', id, upload.name, variant]);
      stages.push(page.uploadStage());
      const hash = sha(upload.name);
      // Identical bytes: nothing is stored and the asked colour is ignored.
      if (!s.images.some((image) => image.largeSha256.toLowerCase() === hash || image.sourceKey === `admin-${hash}`)) {
        const next = 400 + s.images.length;
        s.images.push({ id: next, position: s.images.length, variantProductId: variant, variantColor: 'Rood', sourceKey: `admin-${hash}`, largeSha256: hash });
        s.channels[`F${next}`] = [];
        s.owner[`F${next}`] = variant;
      }
      return { id, images: clone(s.images) };
    },
    deleteProductFamilyImage: async (id: number, image: number) => { calls.push(['delete', id, image]); throw { error: { message: 'Deze foto is de grote catalogusfoto.' } }; },
  });
  page.members.set([
    { productId: 53, name: 'Bowl rood', colour: 'Rood', colourHex: '#c00', active: true },
    ...(options.single ? [] : [{ productId: 54, name: 'Bowl roze', colour: 'Roze', colourHex: '#f9c', active: true }]),
  ]);
  const show = () => page.overview.set(view());
  show();
  return { ...base, s, show, stages };
}

test('an older server still gives three cards and the series rows, without guessing a catalogue photo', () => {
  const { page } = harness();
  assert.equal(page.places().legacy, true);
  assert.deepEqual(page.cards().map((card: any) => [card.name, card.photo?.key ?? null, card.chip, card.actions.map((action: any) => action.label)]), [
    ['Website', 'F2', 'Automatisch gekozen', ['Wijzig']],
    ['Catalogus', null, 'Automatisch gekozen', ['Wijzig']],
    ['Offertes en facturen', 'F2', 'Automatisch gekozen', []],
  ]);
  assert.equal(page.cards()[1].emptyLabel, 'De catalogus kiest de foto bij het maken van de pdf.',
    'The colour’s catalogue photo is picked while the pdf is made; it is not missing');
  assert.deepEqual(page.rows().map((row: any) => [row.name, row.photo?.key ?? null, row.chip]), [
    ['Bestelpagina', 'F2', 'Automatisch gekozen'],
    ['Grote catalogusfoto', 'P5501', 'Zelf gekozen'],
    ['Kleine catalogusfoto', 'F1', 'Zelf gekozen'],
  ]);
  assert.equal(page.notes().length, 0, 'An older server cannot tell what the product page opens with');
  page.overview.set(overview({ familyId: null }));
  assert.equal(page.rows().length, 0, 'Series places need a series');
});

test('the status pill reads the shared website status and never claims more than the server says', () => {
  const { page } = harness();
  assert.equal(page.syncPill(), null, 'No status yet, no pill');
  page.sync.status.set({ status: 'TRIGGERED', liveAt: null, lastError: null });
  assert.deepEqual(page.syncPill(), { text: 'Website wordt bijgewerkt', tone: 'warn', action: null });
  page.sync.pollEnded.set(true);
  assert.deepEqual(page.syncPill(), { text: 'Website nog niet bijgewerkt · Kijk opnieuw', tone: 'warn', action: 'refresh' });
  page.sync.loadError.set('Controleer de verbinding en probeer opnieuw.');
  assert.equal(page.syncPill(), null);
  page.sync.loadError.set(null);
  page.overview.set(overview({ familyWebsiteStatus: 'DRAFT' }));
  assert.equal(page.syncPill().text, 'Reeks staat nog niet op de website');
});

test('the picker lists the photo of now first and offers the upload bar for a colour place only', () => {
  const { page } = harness();
  page.openPicker('quote');
  const picker = page.picker();
  assert.equal(picker.texts.title, 'Foto op de bestelpagina');
  assert.deepEqual(picker.tiles.map((tile: any) => [tile.photo.key, tile.current]), [['F2', true], ['F1', false], ['F3', false]]);
  assert.equal(picker.upload, false);
  page.pickerKind.set('website');
  assert.deepEqual(page.picker().tiles.map((tile: any) => tile.photo.key), ['F2', 'P5501', 'F1']);
  assert.equal(page.picker().texts.upload.title, 'Nieuwe foto uploaden');
  page.busy.set(true);
  page.pickerKind.set(null);
  page.openPicker('website');
  assert.equal(page.pickerKind(), null, 'No picker opens during a save');
});

test('a pick saves at once, applies the answer, tells the editor, closes the picker and can be undone', async () => {
  const { page, calls, toasts, changes, refreshes } = harness();
  page.openPicker('quote');
  page.pickFromPicker('F3');
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(calls, [['role', 53, 'QUOTE', 'F3']]);
  assert.deepEqual(page.overview().quote, { key: 'F3', explicit: true });
  assert.deepEqual(toasts, [['Bestelpagina gewijzigd. Geldt voor alle kleuren.', 'ok']]);
  assert.equal(changes.length, 1);
  assert.equal(refreshes.length, 1, 'The order page shows another photo: the website status is asked again');
  assert.equal(page.pickerKind(), null);
  assert.equal(page.busy(), false);
  assert.deepEqual(clone(page.lastChange()), { kind: 'quote', role: 'QUOTE', previousKey: null, newKey: 'F3', card: null,
    restore: [{ key: 'F3', imageId: 3, channels: [] }] });
  await page.undo();
  assert.deepEqual(calls.at(-1), ['role', 53, 'QUOTE', null]);
  assert.deepEqual(toasts.at(-1), ['Ongedaan gemaakt: de bestelpagina toont weer de vorige foto.', undefined]);
  assert.equal(page.lastChange(), null, 'Undo is offered for one step only');
});

test('a website choice marks its card for the undo line; any other change drops the line', async () => {
  const { page } = harness();
  await page.pickRole('MAIN', 'F1');
  assert.equal(page.lastChange().card, 'website');
  assert.deepEqual(clone(page.changedText()), { short: 'Gewijzigd.', long: ' Bovenaan zie je of de website al is bijgewerkt.', undo: 'Ongedaan maken' });
  await page.setDetailSize('LARGE');
  assert.equal(page.lastChange(), null);
  assert.equal(page.changedText(), null);
});

test('picking what is already chosen writes nothing; a refused pick reloads and keeps the picker open', async () => {
  const { page, calls, toasts } = harness();
  page.pickerKind.set('website');
  await page.pickRole('MAIN', null);
  assert.deepEqual(calls, [], 'The website photo is already automatic');
  assert.equal(page.pickerKind(), null);
  page.pickerKind.set('quote');
  page.catalog.setProductPhotoRole = async () => { throw { error: { message: 'Deze foto staat niet op de website.' } }; };
  await page.pickRole('QUOTE', 'P5501');
  assert.deepEqual(toasts.at(-1), ['Deze foto staat niet op de website.', 'err']);
  assert.deepEqual(calls, [['overview', 53]], 'The server may have done part of the work');
  assert.equal(page.pickerKind(), 'quote');
  assert.equal(page.pickerBusyKey(), null);
  assert.equal(page.lastChange(), null);
});

test('‘Zet mijn keuze weer aan’ sends the stored choice again; ‘Kies opnieuw’ opens the picker', async () => {
  const { page, calls, toasts, s, show } = withServer();
  s.main = 'F2';
  s.channels.F2 = [];
  show();
  const card = page.cards()[0];
  assert.equal(card.chip, 'Je keuze wordt niet getoond');
  assert.deepEqual(card.actions.map((action: any) => [action.id, action.label]), [['repair', 'Zet mijn keuze weer aan'], ['pick', 'Kies opnieuw']]);
  await page.pickRole('MAIN', 'F2');
  assert.deepEqual(calls, [], 'A tap on the stored choice only closes the picker');
  page.cardAction(card, card.actions[1]);
  assert.equal(page.pickerKind(), 'website');
  page.closePicker();
  page.cardAction(card, card.actions[0]);
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(calls, [['role', 53, 'MAIN', 'F2']]);
  assert.deepEqual(toasts, [['Website: je gekozen foto wordt weer getoond.', undefined]]);
  assert.equal(page.cards()[0].chip, 'Zelf gekozen');
  assert.equal(page.lastChange(), null, 'A repair is not a change to take back');
});

test('a repair the answer does not confirm claims nothing; an older server never offers one', async () => {
  const { page, calls, toasts, s, show } = withServer();
  s.catalogue = 'F5';
  s.hideChoice = true;
  show();
  await page.repair('catalogue');
  assert.deepEqual(calls, [['role', 53, 'CATALOGUE_VARIANT', 'F5']]);
  assert.deepEqual(toasts, [], 'The card keeps its warning; no toast says otherwise');
  assert.equal(page.announcement(), 'Je keuze wordt niet getoond');
  const legacy = harness();
  legacy.page.overview.set(overview({ main: { key: 'F2', explicit: true } }));
  await legacy.page.repair('website');
  await legacy.page.useWebsitePhotoForDocuments();
  assert.deepEqual(legacy.calls, []);
});

test('upload and use uploads for this colour first, then chooses the new photo', async () => {
  const { page, calls, toasts, changes } = harness();
  page.openPicker('website');
  await page.uploadAndUse('website', file('new.jpg'));
  assert.deepEqual(calls, [['family', 13], ['upload', 13, 'new.jpg', 53], ['role', 53, 'MAIN', 'F404']]);
  assert.deepEqual(toasts, [['Websitefoto van Rood gewijzigd. Offertes en facturen krijgen dezelfde foto; de offertepagina van de klant kan een dag achterlopen.', 'ok']]);
  assert.equal(page.pickerKind(), null);
  assert.equal(page.lastChange().newKey, 'F404');
  assert.equal(page.busy(), false);
  assert.equal(page.uploadStage(), null);
  assert.equal(changes.length, 1);
  // The same bytes again: the series is unchanged and, without a hash, the file cannot be named.
  page.openPicker('website');
  await page.uploadAndUse('website', file('same.jpg'));
  assert.deepEqual(toasts.at(-1), ['Deze foto staat al in de reeks. Kies hem in de lijst.', 'err']);
  assert.equal(page.pickerKind(), 'website', 'The picker stays open after a failure');
  assert.equal(calls.filter((call: any[]) => call[0] === 'role').length, 1, 'Nothing is chosen that could not be identified');
});

test('changing the big catalogue photo size keeps both stored photo choices', async () => {
  const { page, calls, toasts } = harness();
  await page.setDetailSize('LARGE');
  assert.deepEqual(calls[0], ['catalogue', 13, { catalogueOverviewPhotoId: 1, catalogueDetailPhotoId: -5501, catalogueDetailSize: 'LARGE' }]);
  assert.deepEqual(calls[1], ['overview', 53], 'A family answer is not an overview, so it is fetched again');
  assert.deepEqual(toasts, [['Grote catalogusfoto: groot en breed', undefined]]);
});

test('the extra switches and the colours of a photo use the existing family endpoints', async () => {
  const { page, calls, toasts } = harness();
  await page.setChannels({ photo: page.overview().photos[3], channels: ['WEBSITE', 'CATALOGUE'] });
  await page.setScope({ photo: page.overview().photos[1], variantProductId: null });
  assert.deepEqual(calls.filter((call: any[]) => call[0] !== 'overview'), [['publish', 13, 3, ['WEBSITE', 'CATALOGUE']], ['variant', 13, 2, null]]);
  assert.deepEqual(toasts.map(([message]) => message), ['Foto staat nu als extra foto op de website', 'Foto hoort nu bij alle kleuren']);
});

test('reordering moves the website photos only and keeps every other family image in its slot', async () => {
  const { page, calls, toasts, changes } = harness();
  page.view.set('series');
  page.reordering.set(true);
  assert.deepEqual(page.orderList().map((item: any) => item.key), ['F1', 'F2']);
  assert.deepEqual(page.orderRest().map((item: any) => item.key), ['F3'], 'A photo the website does not receive has no place in the order');
  await page.moveOrder(1, 0, false);
  assert.deepEqual(calls.slice(0, 2), [['family', 13], ['order', 13, [2, 300, 1, 3]]]);
  assert.deepEqual(toasts, [['Volgorde bewaard. Geldt voor alle kleuren.', undefined]]);
  assert.equal(page.announcement(), 'Foto staat nu op positie 1 van 2');
  assert.equal(changes.length, 1);
  await page.moveOrder(0, 1, false);
  assert.equal(toasts.length, 1, 'A burst of moves gives one toast');
  assert.equal(page.orderOverride(), null);
});

test('a duplicate leaves the grid for the row under it', () => {
  const { page } = harness();
  const photos = [photo('P5501', { duplicateOfKey: 'F2' }), ...overview().photos.slice(1)];
  page.overview.set(overview({ photos, catalogueDetail: null }));
  assert.deepEqual(page.duplicates().map((item: any) => item.key), ['P5501']);
  assert.deepEqual(page.shownColour().map((item: any) => item.key), ['F2', 'F1']);
  // While a place still shows the duplicate (here the large catalogue photo) it stays in the grid.
  page.overview.set(overview({ photos }));
  assert.equal(page.duplicates().length, 0);
  assert.deepEqual(page.shownColour().map((item: any) => item.key), ['P5501', 'F2', 'F1']);
});

test('adding photos uploads each file as a series photo and publishes only the new ones', async () => {
  const { page, calls, toasts, changes, revoked } = harness();
  page.staged.set([{ file: { name: 'new.jpg' }, previewUrl: 'blob:1' }, { file: { name: 'same.jpg' }, previewUrl: 'blob:2' }]);
  page.addScope.set('ALL_VARIANTS');
  page.addWebsite.set(true);
  await page.confirmUpload();
  assert.deepEqual(calls.filter((call: any[]) => call[0] !== 'overview'), [
    ['family', 13], ['upload', 13, 'new.jpg', null], ['publish', 13, 404, ['WEBSITE']], ['upload', 13, 'same.jpg', null],
  ]);
  assert.deepEqual(toasts, [['1 foto toegevoegd · staat als extra foto op de website · 1 foto stond al in de reeks', 'ok']]);
  assert.equal(page.staged(), null);
  assert.deepEqual(revoked, ['blob:1', 'blob:2'], 'Previews are released once uploaded');
  assert.equal(changes.length, 1);
});

test('a failed file stays in the add sheet with the server’s reason', async () => {
  const { page, toasts, revoked } = harness();
  const broken = { file: { name: 'broken.jpg' }, previewUrl: 'blob:3' };
  page.staged.set([{ file: { name: 'ok.jpg' }, previewUrl: 'blob:4' }, broken]);
  await page.confirmUpload();
  assert.deepEqual(Array.from(page.staged(), (item: any) => item.previewUrl), [broken.previewUrl]);
  assert.deepEqual(revoked, ['blob:4'], 'The failed preview stays for another try');
  assert.equal(page.addError(), 'Bestand is beschadigd');
  assert.deepEqual(toasts, [['1 foto toegevoegd · nog niet in gebruik · 1 foto niet geüpload', 'err']]);
});

test('a late overview for the previous colour never replaces the current one', async () => {
  const { page } = harness();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  page.catalog.productPhotoOverview = async () => { await gate; return overview(); };
  const loading = page.load(53);
  page.product.set({ id: 54, colour: 'Roze', variantSize: 'M' });
  page.overview.set(overview({ productId: 54 }));
  release();
  await loading;
  assert.equal(page.overview().productId, 54);
});

/* ------------------------------------------------- final contract: choices */

test('a catalogue choice names the series places that moved along and remembers the switches for undo', async () => {
  const { page, calls, toasts, actions } = withServer();
  page.openPicker('catalogue');
  page.pickFromPicker('F5');
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(calls, [['role', 53, 'CATALOGUE_VARIANT', 'F5']]);
  assert.deepEqual(toasts, [['Catalogusfoto van Rood gewijzigd. Ook de grote en de kleine catalogusfoto van de reeks tonen nu deze foto.', 'ok']]);
  assert.equal(actions[0]?.label, 'Ongedaan maken');
  assert.deepEqual(clone(page.lastChange()), { kind: 'catalogue', role: 'CATALOGUE_VARIANT', card: 'catalogue', previousKey: null, newKey: 'F5',
    restore: [{ key: 'F5', imageId: 5, channels: [] }] });
  assert.deepEqual(clone(page.changedText()), { short: 'Gewijzigd.', long: ' Geldt vanaf de volgende pdf.', undo: 'Ongedaan maken' });
});

test('undo sends the previous key and puts back only the switches the role calls moved', async () => {
  const { page, calls, toasts, actions, changes, s, show } = withServer();
  // The previous choice was stored but switched off for the catalogue ("niet getoond"); the new photo was internal.
  s.catalogue = 'F2';
  show();
  await page.pickRole('CATALOGUE_VARIANT', 'F5');
  assert.deepEqual(clone(page.lastChange().restore), [{ key: 'F5', imageId: 5, channels: [] }, { key: 'F2', imageId: 2, channels: ['WEBSITE'] }]);
  calls.length = 0;
  actions[0]!.run();
  await new Promise((done) => setTimeout(done, 5));
  assert.deepEqual(calls, [
    ['role', 53, 'CATALOGUE_VARIANT', 'F2'],
    // The first tap allowed F5 in the catalogue, the undo call itself allowed F2: both go back.
    ['publish', 13, 5, []], ['publish', 13, 2, ['WEBSITE']],
    ['overview', 53],
  ], 'A publication call answers with the series, so the overview is fetched once at the end');
  assert.deepEqual(toasts.at(-1), ['Ongedaan gemaakt: de catalogus toont weer de vorige foto.', undefined]);
  assert.equal(page.places().catalogueColour.state, 'CHOSEN_NOT_SHOWN', 'Exactly the state of before the first tap');
  assert.equal(page.lastChange(), null);
  assert.equal(page.busy(), false);
  assert.equal(changes.length, 2);
});

test('undo leaves switches alone that the answer already has as before', async () => {
  const { page, calls, s, show } = withServer();
  s.main = 'F2';
  show();
  await page.pickRole('MAIN', 'F1');
  calls.length = 0;
  await page.undo();
  assert.deepEqual(calls, [['role', 53, 'MAIN', 'F2']], 'Both photos were on the website before and still are');
});

test('undo whose switch call fails says what is left; a refused undo removes the line and says so', async () => {
  const first = withServer();
  await first.page.pickRole('MAIN', 'F5');
  first.s.refusePublish = true;
  await first.page.undo();
  assert.deepEqual(first.toasts.at(-1), ['De keuze is teruggezet, maar de foto staat nog als extra foto op de website. Zet dat uit bij de foto, onder ‘Meer instellingen’.', 'err']);
  assert.equal(first.page.places().websiteColour.chosenKey, null, 'The choice itself did go back');
  assert.deepEqual(first.calls.at(-1), ['overview', 53]);

  const catalogue = withServer();
  await catalogue.page.pickRole('CATALOGUE_VARIANT', 'F5');
  catalogue.s.refusePublish = true;
  await catalogue.page.undo();
  assert.match(catalogue.toasts.at(-1)![0], /maar de foto mag nog in de catalogus/);

  const second = withServer();
  await second.page.pickRole('MAIN', 'F5');
  second.s.refuseRole = 'Deze kleur is niet actief.';
  second.calls.length = 0;
  await second.page.undo();
  assert.deepEqual(second.toasts.at(-1), ['Deze kleur is niet actief. De wijziging is niet teruggezet.', 'err']);
  assert.deepEqual(second.calls, [['role', 53, 'MAIN', null], ['overview', 53]], 'No switch is touched after a refusal; the overview is fetched again');
  assert.equal(second.page.lastChange(), null, 'The undo line is gone');
  assert.equal(second.page.changedText(), null);
  assert.equal(second.page.busy(), false);
});

test('‘Gebruik de websitefoto’ moves quotes and invoices to the photo the website shows, without an undo line', async () => {
  const { page, calls, toasts, s, show } = withServer();
  s.documents = 'F5';
  show();
  const card = page.cards()[2];
  assert.equal(card.chip, 'Andere foto dan de website');
  const action = card.actions.find((item: any) => item.label === 'Gebruik de websitefoto');
  assert.equal(action.ariaLabel, 'Gebruik de websitefoto ook op offertes en facturen');
  s.documents = null;
  page.cardAction(card, action);
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(calls, [['role', 53, 'MAIN', 'F2']]);
  assert.deepEqual(toasts, [['Offertes en facturen tonen nu de websitefoto.', undefined]]);
  assert.equal(page.lastChange(), null);
});

test('‘Formaat’ sends a stored choice back unchanged, also one that is not shown now', async () => {
  const { page, calls, s, show } = withServer();
  s.detail = 'F5';
  show();
  assert.equal(page.places().catalogueDetail.state, 'CHOSEN_NOT_SHOWN');
  page.catalog.updateCataloguePhotos = async (id: number, selection: unknown) => { calls.push(['catalogue', id, clone(selection)]); return { id }; };
  await page.setDetailSize('LARGE');
  assert.deepEqual(calls[0], ['catalogue', 13, { catalogueOverviewPhotoId: null, catalogueDetailPhotoId: 5, catalogueDetailSize: 'LARGE' }]);
});

test('a stored choice keeps its switch on; the server’s refusal to delete a series choice gets the way out', async () => {
  const { page, calls, toasts, s, show } = withServer();
  s.main = 'F2';
  s.detail = 'F2';
  s.channels.F2 = ['WEBSITE', 'CATALOGUE'];
  show();
  const chosen = page.overview().photos.find((item: any) => item.key === 'F2');
  await page.setChannels({ photo: chosen, channels: ['CATALOGUE'] });
  assert.deepEqual(calls, [], 'Nothing is sent for a locked switch');
  assert.deepEqual(toasts, [['Blijft aan: dit is de gekozen websitefoto van Rood. Kies daar eerst een andere foto.', 'err']]);
  page.remove(chosen);
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(calls[0], ['delete', 13, 2]);
  assert.deepEqual(toasts.at(-1), ['Deze foto is de grote catalogusfoto. Kies eerst een andere foto voor de catalogus.', 'err']);
});

/* ------------------------------------------- final contract: upload and use */

test('upload and use names the photo by its SHA-256: upload, then the role call, nothing else', async () => {
  const { page, calls, toasts, actions, stages, changes } = withServer();
  page.openPicker('catalogue');
  const running = page.uploadAndUse('catalogue', file('new.jpg'));
  assert.equal(page.busy(), true, 'It keeps busy itself for both calls');
  await running;
  assert.deepEqual(calls, [['upload', 13, 'new.jpg', 53], ['role', 53, 'CATALOGUE_VARIANT', 'F405']],
    'With a hash no id list is fetched first; the upload is always for this colour');
  assert.deepEqual(stages, ['upload', 'save']);
  assert.deepEqual(toasts, [['Catalogusfoto van Rood gewijzigd. Ook de grote en de kleine catalogusfoto van de reeks tonen nu deze foto.', 'ok']]);
  assert.equal(actions[0]?.label, 'Ongedaan maken');
  assert.equal(page.pickerKind(), null);
  assert.equal(page.busy(), false);
  assert.equal(page.uploadStage(), null);
  assert.equal(changes.length, 1);
  assert.deepEqual(clone(page.lastChange()), { kind: 'catalogue', role: 'CATALOGUE_VARIANT', card: 'catalogue', previousKey: null, newKey: 'F405',
    restore: [{ key: 'F405', imageId: 405, channels: [] }] });
  // Undo takes the choice back and leaves the new photo as it arrived: in the series, in no place, no switch on.
  calls.length = 0;
  await page.undo();
  assert.deepEqual(calls, [['role', 53, 'CATALOGUE_VARIANT', null], ['publish', 13, 405, []], ['overview', 53]]);
});

test('a file that is already in the series for this colour is chosen and said so', async () => {
  const { page, calls, toasts } = withServer();
  page.openPicker('website');
  await page.uploadAndUse('website', file('mine.jpg'));
  assert.deepEqual(calls, [['upload', 13, 'mine.jpg', 53], ['role', 53, 'MAIN', 'F2']]);
  assert.deepEqual(toasts, [['Deze foto stond al bij Rood en is nu gekozen.', 'ok']]);
  assert.equal(page.lastChange().newKey, 'F2');
  // The same file once more: it is the choice already; the role call is idempotent and there is nothing to take back.
  page.openPicker('website');
  await page.uploadAndUse('website', file('mine.jpg'));
  assert.deepEqual(toasts.at(-1), ['Deze foto stond al bij Rood en is nu gekozen.', undefined]);
  assert.equal(page.lastChange(), null);
});

test('identification follows the server: the admin upload of these bytes before the first photo with the same large rendition', async () => {
  const { page, calls } = withServer();
  page.openPicker('website');
  await page.uploadAndUse('website', file('dup.jpg'));
  assert.deepEqual(calls.at(-1), ['role', 53, 'MAIN', 'F6'], 'F5 stands earlier and has the same bytes, but the server reuses the admin upload');
});

test('a file that is in the series for another colour changes nothing and names that colour', async () => {
  const { page, calls, toasts, actions } = withServer();
  page.openPicker('catalogue');
  await page.uploadAndUse('catalogue', file('roze.jpg'));
  assert.deepEqual(calls, [['upload', 13, 'roze.jpg', 53], ['overview', 53]], 'No role call, and never a relink');
  assert.deepEqual(toasts, [['Deze foto staat al in de reeks bij Roze. Er is niets gewijzigd.', 'err']]);
  assert.equal(actions[0], undefined);
  assert.equal(page.pickerKind(), 'catalogue', 'The picker stays open');
  assert.equal(page.lastChange(), null);
});

test('a file of all colours: the website takes it, the colour strip does not, a one-colour series does', async () => {
  const many = withServer();
  many.page.openPicker('catalogue');
  await many.page.uploadAndUse('catalogue', file('all.jpg'));
  assert.deepEqual(many.toasts, [['Deze foto staat al in de reeks voor alle kleuren. In de Handelscatalogus komt bij een kleur alleen een foto van die kleur zelf. Er is niets gewijzigd.', 'err']]);
  assert.equal(many.calls.some((call: any[]) => call[0] === 'role' || call[0] === 'variant'), false);
  many.page.closePicker();
  many.page.openPicker('website');
  await many.page.uploadAndUse('website', file('all.jpg'));
  assert.deepEqual(many.calls.at(-1), ['role', 53, 'MAIN', 'F1'], 'The hash is compared without regard to case');
  assert.deepEqual(many.toasts.at(-1), ['Deze foto stond al bij Rood en is nu gekozen.', 'ok']);

  const one = withServer({ single: true });
  assert.equal(one.page.places().catalogueColour.reason, 'SINGLE_COLOUR_SERIES');
  one.page.openPicker('catalogue');
  await one.page.uploadAndUse('catalogue', file('all.jpg'));
  assert.deepEqual(one.calls, [['upload', 13, 'all.jpg', 53], ['role', 53, 'CATALOGUE_VARIANT', 'F1']]);
  assert.deepEqual(one.toasts, [['Deze foto stond al bij Rood en is nu gekozen.', 'ok']],
    'The large photo shows it as this colour’s own choice (AUTOMATIC / THIS_COLOUR_LEAD), which counts as chosen');
  assert.equal(one.page.cards()[1].chip, 'Zelf gekozen');
});

test('a refused role call keeps the picker open with the new photo first and offers the same file again', async () => {
  const { page, calls, toasts, actions, changes, s } = withServer();
  page.openPicker('website');
  s.refuseRole = 'Foto kan nog niet gepubliceerd worden.';
  await page.uploadAndUse('website', file('new.jpg'));
  assert.deepEqual(calls, [['upload', 13, 'new.jpg', 53], ['role', 53, 'MAIN', 'F405'], ['overview', 53]]);
  assert.deepEqual(toasts, [['De foto is toegevoegd, maar nog niet gekozen: Foto kan nog niet gepubliceerd worden.', 'err']]);
  assert.equal(actions[0]?.label, 'Opnieuw proberen');
  assert.equal(page.pickerKind(), 'website');
  assert.equal(page.picker().tiles[0].photo.key, 'F405', 'The photo is in the series now; it leads the list');
  assert.equal(page.lastChange(), null);
  assert.equal(page.busy(), false);
  assert.equal(changes.length, 1, 'The series did change: the editor is told');
  // "Opnieuw proberen": the same bytes return the same photo, the role call is idempotent.
  s.refuseRole = null;
  calls.length = 0;
  actions[0]!.run();
  await new Promise((done) => setTimeout(done, 5));
  assert.deepEqual(calls, [['upload', 13, 'new.jpg', 53], ['role', 53, 'MAIN', 'F405']]);
  assert.equal(page.pickerKind(), null);
  assert.equal(page.places().websiteColour.shownKey, 'F405');
  assert.match(toasts.at(-1)![0], /^Websitefoto van Rood gewijzigd\./, 'A photo of a moment ago that was never chosen is not "already there" for the owner');
});

test('saved but not shown: no success is claimed, the picker closes and the card says why', async () => {
  const { page, toasts, s } = withServer();
  page.openPicker('catalogue');
  s.hideChoice = true;
  await page.uploadAndUse('catalogue', file('new.jpg'));
  assert.deepEqual(toasts, []);
  assert.equal(page.pickerKind(), null);
  assert.equal(page.lastChange(), null);
  assert.equal(page.cards()[1].chip, 'Je keuze wordt niet getoond');
  assert.equal(page.announcement(), 'Je keuze wordt niet getoond');
});

test('without crypto.subtle the one new id names the photo; a failed upload shows the server’s sentence', async () => {
  const { page, calls, toasts } = withServer({ crypto: false });
  page.openPicker('catalogue');
  await page.uploadAndUse('catalogue', file('new.jpg'));
  assert.deepEqual(calls, [['family', 13], ['upload', 13, 'new.jpg', 53], ['role', 53, 'CATALOGUE_VARIANT', 'F405']]);
  page.openPicker('catalogue');
  await page.uploadAndUse('catalogue', file('roze.jpg'));
  assert.deepEqual(toasts.at(-1), ['Deze foto staat al in de reeks. Kies hem in de lijst.', 'err'], 'No new id: the file cannot be named, nothing is chosen');
  page.catalog.uploadProductFamilyImage = async () => { throw { error: { message: 'Bestand is beschadigd' } }; };
  await page.uploadAndUse('catalogue', file('broken.jpg'));
  assert.deepEqual(toasts.at(-1), ['Bestand is beschadigd', 'err']);
  assert.equal(page.busy(), false);
});

test('an answer for a colour that was left meanwhile is dropped without a word', async () => {
  const { page, calls, toasts, changes } = withServer();
  page.openPicker('website');
  const upload = page.catalog.uploadProductFamilyImage;
  page.catalog.uploadProductFamilyImage = async (...args: any[]) => {
    const family = await upload(...args);
    page.product.set({ id: 54, colour: 'Roze', variantSize: 'M' });
    return family;
  };
  await page.uploadAndUse('website', file('new.jpg'));
  assert.deepEqual(calls, [['upload', 13, 'new.jpg', 53]], 'No choice is stored for the colour that is on screen now');
  assert.deepEqual(toasts, []);
  assert.equal(changes.length, 0);
  assert.equal(page.busy(), false);
});

/* ------------------------------------------------ other colours, deep link */

test('the other colours are fetched only when looked at, again after a save, and never written', async () => {
  const { page, calls } = withServer();
  assert.deepEqual(page.otherRows().map((row: any) => [row.name, row.linkLabel]), [['Roze', 'Open Roze']]);
  assert.equal(page.others(), null);
  assert.deepEqual(calls, []);
  page.othersOpen.set(true);
  await page.loadOthers();
  assert.deepEqual(calls, [['overview', 54]]);
  assert.deepEqual(page.otherRows().map((row: any) => [row.website?.key, row.catalogue?.key]), [['F3', 'F3']]);
  await page.pickRole('MAIN', 'F1');
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(calls.slice(1), [['role', 53, 'MAIN', 'F1'], ['overview', 54]], 'A save while the list is open asks again');
  assert.equal(calls.some((call: any[]) => call[0] !== 'overview' && call[1] !== 53 && call[1] !== 13), false, 'No call that writes for another product');
  // Folded: a save makes the last answer old; it is dropped, not shown later as "nu".
  page.othersOpen.set(false);
  await page.pickRole('MAIN', 'F2');
  assert.equal(page.others(), null);
  // The editor's own save (colour, activity, membership) makes the answer old the same way.
  assert.match(text, /if \(productId !== shownProduct\) this\.resetFor\(productId\);\s+\/\*[^*]*\*\/\s+else this\.refreshOthers\(\);/,
    'A new revision of the same product reaches the other colours');
  page.othersOpen.set(true);
  calls.length = 0;
  page.refreshOthers();
  assert.equal(page.others().state, 'loading', 'The old rows go at once');
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(calls, [['overview', 54]]);
  page.othersOpen.set(false);
  page.refreshOthers();
  assert.equal(page.others(), null);
  // One colour that cannot be read: nothing is shown as known, and the list can ask again.
  page.catalog.productPhotoOverview = async () => { throw { error: { message: 'offline' } }; };
  page.othersOpen.set(true);
  await page.loadOthers();
  assert.deepEqual([page.others().state, page.others().overviews.length], ['failed', 0]);
  assert.deepEqual(page.otherRows().map((row: any) => [row.website, row.catalogue]), [[null, null]]);
});

test('whatever the panel saves, the id of another colour only ever asks for its overview', async () => {
  const { page, s, show, toasts } = withServer();
  const sent: [string, unknown[]][] = [];
  for (const name of Object.keys(page.catalog)) {
    const real = page.catalog[name];
    page.catalog[name] = (...args: unknown[]) => { sent.push([name, args]); return real(...args); };
  }
  const settled = () => new Promise((done) => setImmediate(done));
  const holds = (value: unknown, id: number): boolean => value === id
    || (!!value && typeof value === 'object' && Object.values(value).some((item) => holds(item, id)));
  const byKey = (key: string) => page.overview().photos.find((item: any) => item.key === key);
  // The list stays open the whole time: every save below also asks the other colour again.
  page.othersOpen.set(true);
  await page.loadOthers();
  await page.pickRole('MAIN', 'F1');
  await page.undo();
  await page.pickRole('CATALOGUE_VARIANT', 'F2');
  await page.undo();
  page.openPicker('catalogue');
  page.compareOpened();
  await settled();
  await page.uploadAndUse('catalogue', file('new.jpg'));
  // A file that is Roze's photo: named, never taken over or moved to this colour.
  await page.uploadAndUse('website', file('roze.jpg'));
  assert.deepEqual(toasts.at(-1), ['Deze foto staat al in de reeks bij Roze. Er is niets gewijzigd.', 'err']);
  await page.setChannels({ photo: byKey('F5'), channels: ['WEBSITE'] });
  await page.setScope({ photo: byKey('F5'), variantProductId: null });
  // Narrowing asks first; the confirmed call runs on its own.
  await page.setScope({ photo: byKey('F1'), variantProductId: 53 });
  await settled();
  await page.moveOrder(0, 1, false);
  await page.setDetailSize('LARGE');
  s.documents = 'F5';
  show();
  await page.useWebsitePhotoForDocuments();
  s.main = 'F6';
  show();
  await page.repair('website');
  page.remove(byKey('F5'));
  await settled();
  page.staged.set([{ file: { name: 'extra.jpg' }, previewUrl: 'blob:9' }]);
  await page.confirmUpload();
  await settled();

  const used = (id: number) => [...new Set(sent.filter(([, args]) => holds(args, id)).map(([name]) => name))];
  assert.deepEqual(used(54), ['productPhotoOverview'], 'The other colour is read, never written');
  for (const [name, args] of sent) {
    if (name !== 'productPhotoOverview') assert.ok(args[0] === 53 || args[0] === 13, `${name} goes to this product or to its series`);
  }
  assert.deepEqual([...new Set(sent.map(([name]) => name))].sort(), [
    'deleteProductFamilyImage', 'productFamily', 'productPhotoOverview', 'reorderProductFamilyImages', 'setProductPhotoRole',
    'updateCataloguePhotos', 'updateProductFamilyImagePublication', 'updateProductFamilyImageVariant', 'uploadProductFamilyImage',
  ], 'The tour went down every road that saves');
  assert.equal(page.others().state, 'ready');
  // In the source too: the id of a member is handed to the overview call and to nothing else.
  assert.deepEqual(text.match(/this\.catalog\.\w+\([^)]*member\.productId/g), ['this.catalog.productPhotoOverview(member.productId']);
  const list = await readFile(new URL('../src/app/features/products/product-photo-colours.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(list, /CatalogApi|MediaApi|HttpClient|inject\(/, 'The list itself has no road to the server');
  assert.match(list, /\[routerLink\]="\['\/products', row\.productId, 'edit'\]" \[queryParams\]="\{ tab: 'media' \}"/, 'A row only leads to that colour’s own photo section');
});

test('‘Bekijk groot’ in the Catalogus picker gets the other colours’ catalogue photos, freshly fetched', async () => {
  const { page, calls } = withServer();
  page.openPicker('catalogue');
  assert.equal(page.compareNeighbours(), null);
  page.compareOpened();
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(calls, [['overview', 54]]);
  assert.deepEqual(page.compareNeighbours().map((item: any) => [item.label, item.photo.key]), [['Roze', 'F3']]);
  page.pickerKind.set('website');
  assert.equal(page.compareNeighbours(), null, 'Only the colour strip of the catalogue has neighbours');
  calls.length = 0;
  page.compareOpened();
  assert.deepEqual(calls, []);
  const one = withServer({ single: true });
  one.page.openPicker('catalogue');
  one.page.compareOpened();
  assert.deepEqual(one.calls, [], 'A one-colour series prints no colour strip');
  // A colour that is not sold stands in no strip: nothing is asked, and an open list does not feed one either.
  const off = withServer();
  off.page.product.set({ ...off.page.product(), active: false });
  off.page.openPicker('catalogue');
  off.page.compareOpened();
  assert.deepEqual(off.calls, []);
  off.page.othersOpen.set(true);
  await off.page.loadOthers();
  assert.equal(off.page.others().state, 'ready');
  assert.equal(off.page.compareNeighbours(), null);
  // The strip is left out while the answer is under way and when it fails.
  const slow = withServer();
  slow.page.openPicker('catalogue');
  let answer: (value: unknown) => void = () => undefined;
  const real = slow.page.catalog.productPhotoOverview;
  slow.page.catalog.productPhotoOverview = (id: number) => new Promise((done) => { answer = () => done(real(id)); });
  slow.page.compareOpened();
  assert.equal(slow.page.others().state, 'loading');
  assert.equal(slow.page.compareNeighbours(), null);
  answer(null);
  await new Promise((done) => setImmediate(done));
  assert.equal(slow.page.compareNeighbours().length, 1);
  slow.page.catalog.productPhotoOverview = async () => { throw { error: { message: 'offline' } }; };
  slow.page.compareOpened();
  await new Promise((done) => setImmediate(done));
  assert.equal(slow.page.others().state, 'failed');
  assert.equal(slow.page.compareNeighbours(), null);
});

test('a link with ?kies= opens that card’s picker once and is always handed back', () => {
  const { page, handled, s, show } = withServer();
  page.openRequestedPicker('catalogus');
  assert.equal(page.pickerKind(), 'catalogue');
  assert.equal(handled.length, 1);
  page.closePicker();
  page.openRequestedPicker('website');
  assert.equal(page.pickerKind(), 'website');
  page.closePicker();
  // A demo product has no "Wijzig" on Catalogus: nothing opens, the parameter still goes.
  page.product.set({ ...page.product(), demo: true });
  s.catalogue = null;
  show();
  page.overview.set({ ...page.overview(), catalogueAssumption: { productIds: [54], includesThisColour: false },
    places: { ...page.overview().places, catalogueColour: { ...page.overview().places.catalogueColour, shownKey: null, state: 'NONE', reason: 'COLOUR_NOT_ACTIVE' } } });
  assert.deepEqual(page.cards()[1].actions.length, 0);
  page.openRequestedPicker('catalogus');
  assert.equal(page.pickerKind(), null);
  assert.equal(handled.length, 3);
  page.disabled.set(true);
  page.openRequestedPicker('website');
  assert.equal(handled.length, 3, 'While translations are unsaved the request waits');
});
