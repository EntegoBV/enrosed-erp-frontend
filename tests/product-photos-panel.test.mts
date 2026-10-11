import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import * as state from '../src/app/features/products/product-photos-state.ts';
import { salesPhoto } from '../src/app/shared/sales-photo.ts';

// Run the real panel members with inert API, toast and DOM boundaries; the
// server contract is played by the fixtures below.
const text = await readFile(new URL('../src/app/features/products/product-photos-panel.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('product-photos-panel.ts', text, ts.ScriptTarget.Latest, true);
const panel = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'ProductPhotosPanel')!;
const names = ['overview', 'loading', 'loadError', 'busy', 'view', 'reordering', 'pickerKind', 'pickerBusyKey', 'uploadStage', 'openKey', 'staged',
  'addScope', 'addWebsite', 'addCatalogue', 'addError', 'uploadProgress', 'orderOverride', 'announcement', 'lastChange', 'loadVersion',
  'lastOrderToast', 'productId', 'interactionDisabled', 'colour', 'places', 'live', 'cards', 'notes', 'rows', 'syncPill', 'changedText',
  'colourList', 'groups', 'duplicates', 'shownColour', 'shownGroups', 'orderList', 'orderRest', 'sheetList', 'picker',
  'openPicker', 'closePicker', 'cardAction', 'pickRole', 'pickFromPicker', 'clearFromPicker', 'uploadFromPicker', 'undo', 'repair',
  'useWebsitePhotoForDocuments', 'uploadAndUse', 'setDetailSize', 'setChannels', 'setScope', 'confirmUpload', 'moveOrder', 'run',
  'refreshSync', 'load', 'apply', 'reload', 'focusHandle'];
const picked = panel.members.filter((member) => member.name && ts.isIdentifier(member.name) && names.includes(member.name.text));
assert.equal(picked.length, names.length, 'The tests must run the current production members');
const helperNames = ['isOverview', 'placeOfRole', 'kindOfRole'];
const helpers = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && helperNames.includes(node.name?.text ?? ''));
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
const file = (name: string) => ({ name, type: 'image/jpeg', size: 1000 });

function harness() {
  const exported: any = {};
  const frames: (() => void)[] = [], revoked: string[] = [];
  vm.runInNewContext(javascript, { exports: exported, signal, computed, ...state, salesPhoto, structuredClone, Date, Set, Map,
    messageOf: (failure: any, fallback: string) => failure?.error?.message ?? fallback,
    escapeHtml: (value: string) => value,
    setTimeout: (fn: () => void) => fn(), requestAnimationFrame: (fn: () => void) => frames.push(fn),
    URL: { revokeObjectURL: (url: string) => revoked.push(url) } });
  const page = new exported.Panel();
  const calls: any[] = [], toasts: [string, string | undefined][] = [], changes: number[] = [], refreshes: number[] = [];
  let familyImages: any[] = [{ id: 1, position: 0 }, { id: 300, position: 1 }, { id: 2, position: 2 }, { id: 3, position: 3 }];
  Object.assign(page, {
    product: signal({ id: 53, colour: 'Rood', variantSize: 'M', active: true, photos: [] as any[] }), members: signal([]), disabled: signal(false),
    changed: { emit: () => changes.push(1) },
    ui: { toast: (message: string, kind?: string) => toasts.push([message, kind]), confirm: (_: unknown, go: () => void) => go() },
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
  return { page, calls, toasts, changes, frames, revoked, refreshes };
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
  assert.deepEqual(clone(page.lastChange()), { kind: 'quote', role: 'QUOTE', previousKey: null, newKey: 'F3', card: null });
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

test('‘Zet mijn keuze weer aan’ sends the stored choice again', async () => {
  const { page, calls, toasts } = harness();
  page.overview.set(overview({ main: { key: 'F2', explicit: true } }));
  await page.pickRole('MAIN', 'F2');
  assert.deepEqual(calls, [], 'A tap on the stored choice only closes the picker');
  await page.repair('website');
  assert.deepEqual(calls, [['role', 53, 'MAIN', 'F2']]);
  assert.deepEqual(toasts, [['Website: je gekozen foto wordt weer getoond.', undefined]]);
  assert.equal(page.lastChange(), null, 'A repair is not a change to take back');
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
