import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { salesPhoto } from '../src/app/shared/sales-photo.ts';

// Execute the production photo-workspace, refresh and save/leave expressions with real Angular signals.
const source = await readFile(new URL('../src/app/features/products/product-editor.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('product-editor.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'ProductEditor');
assert.ok(original);
const names = new Set(['photoWorkspace', 'mediaPhotoCount', 'heroPhoto', 'dirty', 'familyDirty', 'workspaceDirty', 'photoUploading',
  'onPhotosChanged', 'refreshPhotoState', 'mergeFamilyPhotoState', 'flushPendingPhotos', 'updateWithPendingPhotos', 'canDeactivate']);
const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && names.has(member.name.text));
assert.equal(members.length, names.size);
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)),
  original.name, original.typeParameters, undefined, members);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const ownPhoto = { id: 101, origin: 'PRODUCT', familyPhotoId: null, originalFilename: 'catalogue-cutout.png', leadFor: [], url: '/own' };
const seriesPhoto = { id: 301, origin: 'FAMILY', familyPhotoId: 221, originalFilename: 'red-display.jpg', leadFor: [], url: '/series' };
function family(changes: Record<string, unknown> = {}) {
  return { id: 3, name: 'Bowl rozen', images: [{ id: 221, position: 0 }], members: [{ productId: 10, position: 0 }],
    publicationIssues: [], websiteQuotePhotoId: null, effectiveWebsiteQuotePhotoId: 221, ...changes };
}

function harness({ familyId = 3 as number | null, savedFamilyId = 3 as number | null, id = 10 as number | null } = {}) {
  const exports: { ProductEditor?: new () => any } = {};
  vm.runInNewContext(javascript, { exports, computed, signal, salesPhoto, structuredClone });
  const editor = new exports.ProductEditor!();
  const product = { id, familyId, name: 'Bowl rood', photos: [ownPhoto, seriesPhoto] };
  const pending = signal(0);
  const panelBusy = signal(false);
  const calls: { operation: string; id?: number | null; force?: boolean }[] = [];
  const notices: string[] = [];
  const replaced: unknown[] = [];
  const manager = {
    busy: signal(false),
    roleBusy: signal<number | null>(null),
    pendingCount: pending,
    uploadPending: async (target: number, force: boolean) => {
      calls.push({ operation: 'upload', id: target, force });
      const uploaded = pending();
      pending.set(0);
      return { uploaded, remaining: 0 };
    },
  };
  Object.assign(editor, {
    draft: signal(product), baseline: signal(JSON.stringify(product)), family: signal<any>(family()), savedFamily: signal<any>(family()),
    photoManager: () => manager, photosPanel: () => ({ busy: panelBusy }), savedProductFamilyId: signal(savedFamilyId),
    productLoadVersion: 1,
    agreementDirty: signal(false), translationDirty: signal(false),
    saving: signal(false), translationSaving: signal(false), agreementBusy: signal(false),
    sharedFieldsBusy: signal(false), stockSaving: signal(false), takingCode: signal(false), leaveQuestion: signal<any>(null),
    save: async () => { await editor.updateWithPendingPhotos(editor.draft(), manager); },
    families: signal<any[]>([family()]),
    setFamilyDraft: (fresh: any) => { replaced.push(fresh); editor.family.set(structuredClone(fresh)); editor.savedFamily.set(structuredClone(fresh)); },
    ui: { toast: (message: string) => notices.push(message) },
    catalog: {
      product: async (target: number) => { calls.push({ operation: 'read-product', id: target }); return { ...product, name: 'Stale server name', photos: [seriesPhoto] }; },
      productFamily: async (target: number) => { calls.push({ operation: 'read-family', id: target }); return family({ images: [{ id: 221, position: 0 }, { id: 230, position: 1 }], effectiveWebsiteQuotePhotoId: 230 }); },
      updateProduct: async (target: number, value: unknown) => { calls.push({ operation: 'product', id: target }); return value; },
      assignProductFamily: async () => { throw new Error('Photo work must not change family membership'); },
    },
  });
  return { editor, manager, pending, panelBusy, calls, notices, replaced };
}

test('series photos need the product saved in its series; everything else keeps the own-photo manager', () => {
  assert.equal(harness().editor.photoWorkspace(), 'series');
  assert.equal(harness({ familyId: null, savedFamilyId: null }).editor.photoWorkspace(), 'own');
  assert.equal(harness({ id: null, savedFamilyId: null }).editor.photoWorkspace(), 'own', 'A new product has no overview yet');
  assert.equal(harness({ familyId: 4 }).editor.photoWorkspace(), 'own', 'An unsaved move must not show the old series as the new one');
});

test('the section count matches what the product view shows and the hero uses the Hoofdfoto rule', () => {
  const { editor, pending } = harness();
  assert.equal(editor.mediaPhotoCount(), 2);
  assert.equal(editor.heroPhoto().id, 301, 'Without a website lead the series photo beats an old own cut-out');
  editor.draft.set({ ...editor.draft(), photos: [ownPhoto, { ...seriesPhoto, leadFor: [] }, { ...ownPhoto, id: 102, leadFor: ['WEBSITE'] }] });
  assert.equal(editor.heroPhoto().id, 102);
  editor.draft.set({ ...editor.draft(), photos: [ownPhoto] });
  assert.equal(editor.heroPhoto().id, 101);
  pending.set(2);
  assert.equal(editor.mediaPhotoCount(), 3);
  assert.equal(editor.workspaceDirty(), true, 'A queued upload still makes the workspace dirty');
});

test('a busy photo panel locks navigation just like an upload or a lead request', () => {
  const { editor, manager, panelBusy } = harness();
  assert.equal(editor.canDeactivate(), true);
  panelBusy.set(true);
  assert.equal(editor.photoUploading(), true);
  assert.equal(editor.canDeactivate(), false);
  panelBusy.set(false);
  manager.roleBusy.set(101);
  assert.equal(editor.canDeactivate(), false);
  manager.roleBusy.set(null);
  assert.equal(editor.canDeactivate(), true);
});

test('a saved photo change never reads as an unsaved product edit', async () => {
  const { editor } = harness();
  await editor.refreshPhotoState();
  assert.deepEqual(editor.draft().photos.map((photo: any) => photo.id), [301]);
  assert.equal(editor.dirty(), false, 'The dock must not ask to save what the panel already saved');
  assert.equal(editor.workspaceDirty(), false);
});

test('a panel change refreshes photos and the clean series without touching unsaved product fields', async () => {
  const { editor, calls, replaced } = harness();
  editor.draft.set({ ...editor.draft(), name: 'Unsaved name' });
  await editor.refreshPhotoState();
  assert.deepEqual(calls.map((call) => call.operation), ['read-product', 'read-family']);
  assert.deepEqual(editor.draft().photos.map((photo: any) => photo.id), [301]);
  assert.equal(editor.draft().name, 'Unsaved name');
  assert.equal(editor.dirty(), true, 'The real edit stays pending');
  assert.equal(replaced.length, 1);
  assert.equal(editor.family().effectiveWebsiteQuotePhotoId, 230);
  assert.equal(editor.families()[0].effectiveWebsiteQuotePhotoId, 230, 'Navigation lists see the fresh series too');
});

test('with unsaved series edits only the photo state moves in, and the edits stay pending', async () => {
  const { editor, replaced } = harness();
  editor.family.set({ ...editor.family(), name: 'Unsaved public name' });
  assert.equal(editor.familyDirty(), true);
  await editor.refreshPhotoState();
  assert.equal(replaced.length, 0);
  assert.equal(editor.family().name, 'Unsaved public name');
  assert.deepEqual(editor.family().images.map((image: any) => image.id), [221, 230]);
  assert.deepEqual(editor.savedFamily().images.map((image: any) => image.id), [221, 230]);
  assert.equal(editor.savedFamily().name, 'Bowl rozen');
  assert.equal(editor.familyDirty(), true, 'Only the pending text edit remains dirty');
  editor.family.set({ ...editor.family(), name: 'Bowl rozen' });
  assert.equal(editor.familyDirty(), false, 'The photo fields did not become a phantom change');
});

test('a refresh that returns after switching colour is ignored', async () => {
  const { editor, replaced } = harness();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const read = editor.catalog.product;
  editor.catalog.product = async (target: number) => { await gate; return read(target); };
  const refreshing = editor.refreshPhotoState();
  const next = { id: 20, familyId: 3, name: 'Roze', photos: [] };
  editor.draft.set(next);
  editor.productLoadVersion = 2;
  release();
  await refreshing;
  assert.equal(editor.draft(), next);
  assert.equal(replaced.length, 0);
});

test('saving still uploads a queue picked before the first save before the product changes', async () => {
  const { editor, manager, pending, calls } = harness();
  pending.set(2);
  await editor.updateWithPendingPhotos(editor.draft(), manager);
  assert.deepEqual(calls, [{ operation: 'upload', id: 10, force: true }, { operation: 'product', id: 10 }]);
  assert.equal(pending(), 0);
  assert.equal(editor.workspaceDirty(), false);
});

test('a failed queued upload prevents product save and save-before-navigation keeps the editor open', async () => {
  const { editor, manager, pending, calls, notices } = harness();
  pending.set(1);
  manager.uploadPending = async (target, force) => {
    calls.push({ operation: 'upload', id: target, force });
    return { uploaded: 0, remaining: 1 };
  };
  const leaving = editor.canDeactivate();
  assert.ok(editor.leaveQuestion());
  await editor.leaveQuestion()(true);
  assert.equal(await leaving, false);
  assert.equal(editor.workspaceDirty(), true);
  assert.equal(pending(), 1);
  assert.deepEqual(calls, [{ operation: 'upload', id: 10, force: true }]);
  assert.match(notices[0], /foto.*wachten nog/);
});

test('a delayed photo response for another product cannot replace the current photos or unsaved fields', () => {
  const { editor } = harness();
  const current = { id: 20, familyId: 3, name: 'New product with unsaved name', colour: 'Blue', photos: [seriesPhoto] };
  editor.draft.set(current);
  editor.onPhotosChanged({ id: 10, name: 'Old product', photos: [{ id: 999, origin: 'PRODUCT' }], cartonCbm: 42 });
  assert.equal(editor.draft(), current);
});

test('a matching photo response updates its own media while preserving unsaved product edits', () => {
  const { editor } = harness();
  editor.draft.set({ ...editor.draft(), name: 'Unsaved name', colour: 'Custom pink', fixedSalesPriceEur: 29.95 });
  const photos = [{ id: 102, origin: 'PRODUCT', originalFilename: 'new-cover.jpg' }];
  editor.onPhotosChanged({ id: 10, name: 'Stale server name', colour: 'Red', fixedSalesPriceEur: 10, photos,
    publicationIssues: ['missing translation'], cartonCbm: 0.12, pieceCbm: 0.01 });
  assert.equal(editor.draft().photos, photos);
  assert.equal(editor.draft().name, 'Unsaved name');
  assert.equal(editor.draft().colour, 'Custom pink');
  assert.equal(editor.draft().fixedSalesPriceEur, 29.95);
  assert.equal(editor.draft().cartonCbm, 0.12);
});
