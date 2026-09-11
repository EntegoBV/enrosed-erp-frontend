import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';

// Execute the production scope/save/leave expressions with real Angular signals.
const source = await readFile(new URL('../src/app/features/products/product-editor.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('product-editor.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'ProductEditor');
assert.ok(original);
const names = new Set(['photoScope', 'variantPhotoCount', 'activePhotoScope', 'mediaPhotoCount', 'workspaceDirty',
  'photoUploading', 'onPhotosChanged', 'flushPendingPhotos', 'updateWithPendingPhotos', 'canDeactivate']);
const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && names.has(member.name.text));
assert.equal(members.length, names.size);
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)),
  original.name, original.typeParameters, undefined, members);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness(own = true) {
  const exports: { ProductEditor?: new () => any } = {};
  vm.runInNewContext(javascript, { exports, computed, signal });
  const editor = new exports.ProductEditor!();
  const inherited = { id: 301, origin: 'FAMILY', originalFilename: 'shared.jpg' };
  const ownPhoto = { id: 101, origin: 'PRODUCT', originalFilename: 'red.jpg' };
  const product = { id: 10, familyId: 3, photos: own ? [ownPhoto, inherited] : [inherited] };
  const pending = signal(0);
  const calls: { operation: string; id?: number; force?: boolean }[] = [];
  const notices: string[] = [];
  const manager = {
    busy: signal(false),
    roleBusy: signal<number | null>(null),
    pendingCount: pending,
    uploadPending: async (id: number, force: boolean) => {
      calls.push({ operation: 'upload', id, force });
      const uploaded = pending();
      pending.set(0);
      return { uploaded, remaining: 0 };
    },
  };
  Object.assign(editor, {
    draft: signal(product), family: signal<any>({ id: 3, images: [inherited] }),
    photoManager: () => manager, savedProductFamilyId: signal(3),
    dirty: signal(false), familyDirty: signal(false), agreementDirty: signal(false), translationDirty: signal(false),
    saving: signal(false), translationSaving: signal(false), agreementBusy: signal(false),
    sharedFieldsBusy: signal(false), stockSaving: signal(false), takingCode: signal(false), leaveQuestion: signal<any>(null),
    save: async () => { await editor.updateWithPendingPhotos(editor.draft(), manager); },
    ui: { toast: (message: string) => notices.push(message) },
    catalog: {
      updateProduct: async (id: number, value: unknown) => { calls.push({ operation: 'product', id }); return value; },
      assignProductFamily: async () => { throw new Error('Scope changes must not change photo ownership or family membership'); },
    },
  });
  return { editor, manager, pending, calls, notices, inherited, ownPhoto };
}

test('the default chooses owned variant photos, otherwise the populated family gallery', () => {
  const owned = harness();
  assert.equal(owned.editor.activePhotoScope(), 'variant');
  assert.equal(owned.editor.variantPhotoCount(), 1, 'Inherited family photos are not counted as owned');
  assert.equal(owned.editor.mediaPhotoCount(), 2, 'The inherited snapshot is not counted twice');
  const inheritedOnly = harness(false);
  assert.equal(inheritedOnly.editor.activePhotoScope(), 'family');
  assert.equal(inheritedOnly.editor.variantPhotoCount(), 0);
  assert.equal(inheritedOnly.editor.mediaPhotoCount(), 1);
  inheritedOnly.editor.family.set({ id: 3, images: [] });
  assert.equal(inheritedOnly.editor.activePhotoScope(), 'variant', 'An empty family must not strand the photo workspace');
});

test('scope changes preserve explicit choice, queue, ownership and unrelated product edits without writes', () => {
  const { editor, pending, calls, inherited } = harness(false);
  editor.draft.set({ ...editor.draft(), name: 'Unsaved product name' });
  editor.photoScope.set('variant');
  pending.set(2);
  assert.equal(editor.variantPhotoCount(), 2);
  editor.photoScope.set('family');
  assert.equal(editor.activePhotoScope(), 'family');
  assert.equal(pending(), 2);
  assert.equal(editor.workspaceDirty(), true, 'The hidden queue still makes the workspace dirty');
  assert.equal(editor.draft().name, 'Unsaved product name');
  assert.equal(editor.draft().photos[0], inherited);
  assert.equal(editor.mediaPhotoCount(), 3);
  assert.deepEqual(calls, []);
  pending.set(0);
  assert.equal(editor.activePhotoScope(), 'family', 'A settled hidden upload must not override the explicit scope');
});

test('without a family the variant workspace remains reachable even after family was selected', () => {
  const { editor, calls } = harness(false);
  editor.photoScope.set('family');
  editor.family.set(null);
  assert.equal(editor.activePhotoScope(), 'variant');
  assert.equal(editor.mediaPhotoCount(), 1);
  assert.deepEqual(calls, []);
});

test('saving with the family scope selected still uploads the hidden variant queue before product changes', async () => {
  const { editor, manager, pending, calls } = harness();
  editor.photoScope.set('family');
  pending.set(2);
  await editor.updateWithPendingPhotos(editor.draft(), manager);
  assert.deepEqual(calls, [{ operation: 'upload', id: 10, force: true }, { operation: 'product', id: 10 }]);
  assert.equal(pending(), 0);
  assert.equal(editor.activePhotoScope(), 'family');
  assert.equal(editor.workspaceDirty(), false);
});

test('a failed hidden upload prevents product save and save-before-navigation keeps the editor open', async () => {
  const { editor, manager, pending, calls, notices } = harness();
  editor.photoScope.set('family');
  pending.set(1);
  manager.uploadPending = async (id, force) => {
    calls.push({ operation: 'upload', id, force });
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

test('a hidden cover-role write locks navigation until it settles, just like an upload', () => {
  const { editor, manager } = harness();
  editor.photoScope.set('family');
  assert.equal(editor.canDeactivate(), true);
  manager.roleBusy.set(101);
  assert.equal(editor.photoUploading(), true);
  assert.equal(editor.canDeactivate(), false, 'A role request must not outlive navigation to another product');
  manager.roleBusy.set(null);
  assert.equal(editor.photoUploading(), false);
  assert.equal(editor.canDeactivate(), true);
  manager.busy.set(true);
  assert.equal(editor.photoUploading(), true);
  assert.equal(editor.canDeactivate(), false);
});

test('a delayed photo response for another product cannot replace the current photos or unsaved fields', () => {
  const { editor, inherited } = harness();
  const current = { id: 20, familyId: 3, name: 'New product with unsaved name', colour: 'Blue', photos: [inherited] };
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
