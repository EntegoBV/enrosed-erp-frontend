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
const names = ['overview', 'loading', 'loadError', 'busy', 'view', 'reordering', 'pickerRole', 'openKey', 'staged', 'addScope',
  'addWebsite', 'addCatalogue', 'addError', 'uploadProgress', 'orderOverride', 'announcement', 'loadVersion', 'lastOrderToast',
  'productId', 'interactionDisabled', 'colour', 'colourList', 'groups', 'orderList', 'sheetList', 'documentsDiffer', 'roleRows', 'picker',
  'pickRole', 'setDetailSize', 'setChannels', 'setScope', 'confirmUpload', 'moveOrder', 'run', 'load', 'apply', 'reload', 'focusHandle'];
const picked = panel.members.filter((member) => member.name && ts.isIdentifier(member.name) && names.includes(member.name.text));
assert.equal(picked.length, names.length, 'The tests must run the current production members');
const helpers = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'isOverview');
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

function harness() {
  const exported: any = {};
  const frames: (() => void)[] = [], revoked: string[] = [];
  vm.runInNewContext(javascript, { exports: exported, signal, computed, ...state, salesPhoto, structuredClone, Date, Set, Map,
    messageOf: (failure: any, fallback: string) => failure?.error?.message ?? fallback,
    setTimeout: (fn: () => void) => fn(), requestAnimationFrame: (fn: () => void) => frames.push(fn),
    URL: { revokeObjectURL: (url: string) => revoked.push(url) } });
  const page = new exported.Panel();
  const calls: any[] = [], toasts: [string, string | undefined][] = [], changes: number[] = [];
  let familyImages = [{ id: 1, position: 0 }, { id: 300, position: 1 }, { id: 2, position: 2 }, { id: 3, position: 3 }];
  Object.assign(page, {
    product: signal({ id: 53, colour: 'Rood', variantSize: 'M', photos: [] as any[] }), members: signal([]), disabled: signal(false),
    changed: { emit: () => changes.push(1) },
    ui: { toast: (message: string, kind?: string) => toasts.push([message, kind]), confirm: (_: unknown, go: () => void) => go() },
    host: { nativeElement: { querySelector: () => null } },
    catalog: {
      productPhotoOverview: async (id: number) => { calls.push(['overview', id]); return overview(); },
      setProductPhotoRole: async (id: number, role: string, key: string | null) => {
        calls.push(['role', id, role, key]);
        return overview({ quote: { key: key ?? 'F2', explicit: key !== null } });
      },
      productFamily: async (id: number) => { calls.push(['family', id]); return { id, images: clone(familyImages) }; },
      reorderProductFamilyImages: async (id: number, ids: number[]) => { calls.push(['order', id, [...ids]]); return { id }; },
      updateCataloguePhotos: async (id: number, selection: unknown) => { calls.push(['catalogue', id, clone(selection)]); return { id }; },
      updateProductFamilyImagePublication: async (id: number, image: number, channels: string[]) => { calls.push(['publish', id, image, [...channels]]); return { id }; },
      updateProductFamilyImageVariant: async (id: number, image: number, variant: number | null) => { calls.push(['variant', id, image, variant]); return { id }; },
      uploadProductFamilyImage: async (id: number, file: { name: string }, variant: number | null) => {
        calls.push(['upload', id, file.name, variant]);
        if (file.name === 'broken.jpg') throw { error: { message: 'Bestand is beschadigd' } };
        if (file.name !== 'same.jpg') familyImages = [...familyImages, { id: 400 + familyImages.length, position: familyImages.length }];
        return { id, images: clone(familyImages) };
      },
    },
  });
  page.overview.set(overview());
  return { page, calls, toasts, changes, frames, revoked };
}

test('the role card shows the effective photo, who chose it and the family status', () => {
  const { page } = harness();
  const rows = page.roleRows();
  assert.deepEqual(rows.map((row: any) => [row.title, row.photo?.key ?? null, row.explicit]), [
    ['Hoofdfoto · Rood', 'F2', false],
    ['Vraag een offerte', 'F2', false],
    ['Catalogus · Rood', null, false],
    ['Catalogus · overzicht', 'F1', true],
    ['Catalogus · grote foto', 'P5501', true],
  ]);
  assert.deepEqual(rows.map((row: any) => row.status), ['automatic', 'automatic', 'automatic', 'explicit', 'explicit'],
    'The colour’s catalogue photo is picked while the catalogue is made, it is not missing');
  page.overview.set(overview({ quote: null }));
  assert.equal(page.roleRows()[1].status, 'none');
  page.overview.set(overview({ familyWebsiteStatus: 'DRAFT' }));
  assert.equal(page.roleRows()[1].note, 'Reeks staat nog niet op de website.');
});

test('the Hoofdfoto row warns when quotes and invoices print another photo than the automatic choice', () => {
  const { page } = harness();
  const row = (id: number, familyPhotoId: number | null, leadFor: string[] = []) => ({ id, familyPhotoId, leadFor });
  // Documents print the first series projection: F2, the automatic Hoofdfoto too.
  page.product.set({ ...page.product(), photos: [row(9002, 2), row(9001, 1)] });
  assert.equal(page.documentsDiffer(), false);
  assert.equal(page.roleRows()[0].note, '');
  // A new photo that is not online yet became the first projection.
  page.product.set({ ...page.product(), photos: [row(9004, 4), row(9002, 2)] });
  assert.equal(page.documentsDiffer(), true);
  assert.equal(page.roleRows()[0].note, 'Offertes en facturen tonen nu een andere foto. Kies er zelf een.');
  // A chosen Hoofdfoto is the website lead, which the documents print as well.
  page.overview.set(overview({ main: { key: 'F2', explicit: true } }));
  assert.equal(page.documentsDiffer(), false);
  page.overview.set(overview());
  page.product.set({ ...page.product(), photos: [] });
  assert.equal(page.documentsDiffer(), false, 'No photo on the documents, nothing to compare');
});

test('the picker offers the automatic tile with its current pick and flags photos it would publish', () => {
  const { page } = harness();
  page.pickerRole.set('QUOTE');
  const picker = page.picker();
  assert.equal(picker.automatic.key, 'F2');
  assert.deepEqual(picker.candidates.map((item: any) => item.key), ['F2', 'F1', 'F3']);
  assert.equal(picker.publishes, 'website');
  page.pickerRole.set('MAIN');
  assert.deepEqual(page.picker().candidates.map((item: any) => item.key), ['P5501', 'F2', 'F1']);
  assert.equal(page.picker().publishes, 'website', 'An own photo chosen as Hoofdfoto appears on the website');
  page.overview.set(overview({ photos: overview().photos.slice(1) }));
  assert.equal(page.picker().publishes, null, 'Every candidate is on the website already');
});

test('a pick saves at once, applies the answer, tells the editor and closes the picker', async () => {
  const { page, calls, toasts, changes } = harness();
  page.pickerRole.set('QUOTE');
  await page.pickRole('QUOTE', 'F3');
  assert.deepEqual(calls, [['role', 53, 'QUOTE', 'F3']]);
  assert.deepEqual(page.overview().quote, { key: 'F3', explicit: true });
  assert.deepEqual(toasts, [['Vraag een offerte gekozen · staat nu ook op de website', undefined]]);
  assert.equal(changes.length, 1);
  assert.equal(page.pickerRole(), null);
  assert.equal(page.busy(), false);
});

test('picking what is already chosen writes nothing; a refused pick reloads and keeps the picker open', async () => {
  const { page, calls, toasts } = harness();
  page.pickerRole.set('MAIN');
  await page.pickRole('MAIN', null);
  assert.deepEqual(calls, [], 'MAIN is already automatic');
  page.pickerRole.set('QUOTE');
  page.catalog.setProductPhotoRole = async () => { throw { error: { message: 'Deze losse foto staat niet op de website. Zet hem eerst in de reeks.' } }; };
  await page.pickRole('QUOTE', 'P5501');
  assert.deepEqual(toasts.at(-1), ['Deze losse foto staat niet op de website. Zet hem eerst in de reeks.', 'err']);
  assert.deepEqual(calls, [['overview', 53]], 'The server may have done part of the work');
  assert.equal(page.pickerRole(), 'QUOTE');
});

test('changing the big catalogue photo size keeps both stored photo choices', async () => {
  const { page, calls } = harness();
  await page.setDetailSize('LARGE');
  assert.deepEqual(calls[0], ['catalogue', 13, { catalogueOverviewPhotoId: 1, catalogueDetailPhotoId: -5501, catalogueDetailSize: 'LARGE' }]);
  assert.deepEqual(calls[1], ['overview', 53], 'A family answer is not an overview, so it is fetched again');
});

test('visibility and colour scope use the existing family endpoints', async () => {
  const { page, calls, toasts } = harness();
  await page.setChannels({ photo: page.overview().photos[3], channels: ['WEBSITE', 'CATALOGUE'] });
  await page.setScope({ photo: page.overview().photos[1], variantProductId: null });
  assert.deepEqual(calls.filter((call: any[]) => call[0] !== 'overview'), [['publish', 13, 3, ['WEBSITE', 'CATALOGUE']], ['variant', 13, 2, null]]);
  assert.deepEqual(toasts.map(([message]) => message), ['Foto zichtbaar op website, catalogus', 'Foto geldt nu voor alle kleuren']);
});

test('reordering sends every family image, keeping photos the overview does not list in their slot', async () => {
  const { page, calls, toasts, changes } = harness();
  page.view.set('series');
  page.reordering.set(true);
  assert.deepEqual(page.orderList().map((item: any) => item.key), ['F1', 'F2', 'F3']);
  await page.moveOrder(2, 0, false);
  assert.deepEqual(calls.slice(0, 2), [['family', 13], ['order', 13, [3, 300, 1, 2]]]);
  assert.deepEqual(toasts, [['Volgorde bewaard · geldt voor alle kleuren', undefined]]);
  assert.equal(page.announcement(), 'Foto staat nu op positie 1 van 3');
  assert.equal(changes.length, 1);
  await page.moveOrder(0, 1, false);
  assert.equal(toasts.length, 1, 'A burst of moves gives one toast');
  assert.equal(page.orderOverride(), null);
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
  assert.deepEqual(toasts, [['1 foto toegevoegd · op de website · 1 foto stond al in de reeks', 'ok']]);
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
  assert.deepEqual(toasts, [['1 foto toegevoegd · nog niet online · 1 foto niet geüpload', 'err']]);
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
