import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';

/**
 * Run the production leave guards and publication-state expressions with
 * real Angular signals. AST selection omits the editor's unrelated DOM/API
 * constructor; it does not replace any tested method or expression.
 */
const source = await readFile(new URL('../src/app/features/products/product-editor.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('product-editor.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'ProductEditor');
assert.ok(original);
const names = new Set(['dirty', 'familyDirty', 'workspacePublicationLive', 'workspacePublicationShortLabel',
  'workspacePublicationLabel', 'workspaceDirty', 'canDeactivate', 'warnBeforeUnload', 'confirmDiscardTranslations',
  'save', 'copy', 'saveShortcut', 'markClean']);
const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && names.has(member.name.text));
assert.equal(members.length, names.size, 'Every tested production member must still exist');
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)),
  original.name, original.typeParameters, undefined, members);
const module = ts.factory.updateSourceFile(parsed, [isolated]);
const javascript = ts.transpileModule(ts.createPrinter().printFile(module), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
}).outputText;

function family(status = 'DRAFT') { return { id: 1, active: true, name: 'Product family', websiteStatus: status, orderAppStatus: 'DRAFT', publicationIssues: [] }; }

function harness() {
  let translationDiscard = true;
  let confirmCalls = 0;
  const exports: { ProductEditor?: new () => any } = {};
  vm.runInNewContext(javascript, {
    exports, computed, HostListener: () => () => {},
    window: { confirm: () => { confirmCalls++; return translationDiscard; } },
  });
  const editor = new exports.ProductEditor!();
  const save = editor.save.bind(editor);
  const copy = editor.copy.bind(editor);
  const notifications: { message: string; type?: string }[] = [];
  const navigations: { target: unknown; saving: boolean }[] = [];
  const initial = { id: 10, active: true, name: 'SKU', carton: { piecesPerCarton: 1, weightKg: 1 }, publicationIssues: [] };
  Object.assign(editor, {
    draft: signal(initial), baseline: signal(JSON.stringify(initial)),
    family: signal(family()), savedFamily: signal(family()), familyLoading: signal(false), familyLoadError: signal(false),
    saving: signal(false), photoUploading: signal(false), translationSaving: signal(false), translationDirty: signal(false),
    agreementBusy: signal(false), agreementDirty: signal(false), sharedFieldsBusy: signal(false),
    leaveQuestion: signal(null), readinessIssues: signal([]), pendingPhotos: signal(0),
    save: async () => {},
    editorReady: signal(true), autoCartonPieces: signal(null), autoCartonWeight: signal(null), missingFields: signal([]),
    saveError: signal(null), savedProductFamilyId: signal(null), savedSupplierId: signal(null), savedHere: signal(false),
    returnTo: signal(null), loadStockHistory: async () => {}, loadStockLevels: async () => {},
    persistFamilyDraft: async () => { editor.savedFamily.set(structuredClone(editor.family())); },
    updateWithPendingPhotos: async () => structuredClone(editor.draft()),
    createWithPendingPhotos: async () => ({ ...structuredClone(editor.draft()), id: 99 }),
    agreementEditor: () => ({ flush: async () => ({ remaining: 0 }) }),
    planPublishFix: () => null,
    ui: { toast: (message: string, type?: string) => notifications.push({ message, type }) },
    router: {
      navigate: async (target: unknown) => { navigations.push({ target, saving: editor.saving() }); return true; },
      navigateByUrl: async (target: unknown) => { navigations.push({ target, saving: editor.saving() }); return true; },
    },
    canCopyVariant: signal(true), copyVariantConflict: signal(null), copying: signal(true),
    copyColour: signal('White'), copyColourHex: signal('#FFFFFF'), copySize: signal('XL'),
    catalog: { duplicateProduct: async () => ({ id: 101, sku: 'COPY-101' }) },
    saveBusy: computed(() => editor.saving() || editor.photoUploading() || editor.agreementBusy() || editor.translationSaving()),
  });
  editor.isNew = () => editor.draft().id === null;
  editor.photoManager = () => ({ pendingCount: editor.pendingPhotos });
  return { editor, save, copy, notifications, navigations, denyTranslationDiscard: () => { translationDiscard = false; }, confirmCalls: () => confirmCalls };
}

test('a family-only edit asks before leaving even when the SKU is unchanged', async () => {
  const { editor } = harness();
  editor.family.set({ ...editor.family(), websiteStatus: 'PUBLISHED' });
  assert.equal(editor.dirty(), false);
  assert.equal(editor.familyDirty(), true);
  const leaving = editor.canDeactivate();
  assert.ok(editor.leaveQuestion());
  await editor.leaveQuestion()(null);
  assert.equal(await leaving, false);
});

test('saving before leaving waits until family edits really become clean', async () => {
  const { editor } = harness();
  editor.family.set({ ...editor.family(), name: 'Changed family' });
  let calls = 0;
  editor.save = async () => { calls++; };
  const failedSave = editor.canDeactivate();
  await editor.leaveQuestion()(true);
  assert.equal(await failedSave, false, 'A failed family write cannot allow navigation');
  editor.save = async () => { calls++; editor.savedFamily.set(structuredClone(editor.family())); };
  const successfulSave = editor.canDeactivate();
  await editor.leaveQuestion()(true);
  assert.equal(await successfulSave, true);
  assert.equal(calls, 2);
});

test('discarding translations still checks pending SKU and family changes', async () => {
  const { editor, confirmCalls } = harness();
  editor.translationDirty.set(true);
  editor.draft.set({ ...editor.draft(), name: 'Unsaved SKU' });
  editor.family.set({ ...editor.family(), name: 'Unsaved family' });
  const leaving = editor.canDeactivate();
  assert.equal(confirmCalls(), 1);
  assert.ok(editor.leaveQuestion(), 'The product/family save-discard-stay choice must still appear');
  await editor.leaveQuestion()(null);
  assert.equal(await leaving, false);
  assert.equal(editor.translationDirty(), true, 'Cancelling navigation must not falsely mark translations clean');
});

test('declining translation discard stays immediately without a second leave prompt', () => {
  const { editor, denyTranslationDiscard } = harness();
  editor.translationDirty.set(true);
  editor.family.set({ ...editor.family(), name: 'Unsaved family' });
  denyTranslationDiscard();
  assert.equal(editor.canDeactivate(), false);
  assert.equal(editor.leaveQuestion(), null);
});

test('pending photo files are protected even when every upload failed before changing the SKU', async () => {
  const { editor } = harness();
  editor.pendingPhotos.set(2);
  assert.equal(editor.dirty(), false);
  const leaving = editor.canDeactivate();
  assert.ok(editor.leaveQuestion());
  await editor.leaveQuestion()(true);
  assert.equal(await leaving, false, 'Unuploaded files still prevent save-and-leave');
});

test('navigation and browser unload stay guarded throughout saves and uploads', () => {
  for (const flag of ['saving', 'photoUploading', 'translationSaving', 'agreementBusy', 'sharedFieldsBusy']) {
    const { editor } = harness();
    editor[flag].set(true);
    assert.equal(editor.canDeactivate(), false, flag);
    let prevented = false;
    const event = { preventDefault: () => { prevented = true; }, returnValue: undefined };
    editor.warnBeforeUnload(event);
    assert.equal(prevented, true, flag);
    assert.equal(event.returnValue, '');
  }
});

test('browser unload also protects family-only edits and failed photo queues', () => {
  for (const prepare of [
    (editor: any) => editor.family.set({ ...editor.family(), name: 'Changed family' }),
    (editor: any) => editor.pendingPhotos.set(1),
  ]) {
    const { editor } = harness();
    prepare(editor);
    let prevented = false;
    editor.warnBeforeUnload({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
  }
  const { editor } = harness();
  let prevented = false;
  editor.warnBeforeUnload({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false, 'A fully clean editor needs no warning');
});

test('staging publication never claims the product is already live', () => {
  const { editor } = harness();
  editor.family.set(family('PUBLISHED'));
  assert.equal(editor.workspacePublicationLive(), false);
  assert.equal(editor.workspacePublicationShortLabel(), 'Publicatiewijziging nog opslaan');
  assert.equal(editor.workspacePublicationLabel(), 'Publicatiewijziging nog opslaan');
  editor.savedFamily.set(family('PUBLISHED'));
  assert.equal(editor.workspacePublicationLive(), true);
  assert.equal(editor.workspacePublicationShortLabel(), 'Website live');
});

test('unsaved family fields and SKU activation changes make the publication state pending', () => {
  const { editor } = harness();
  editor.family.set(family('PUBLISHED'));
  editor.savedFamily.set(family('PUBLISHED'));
  editor.family.set({ ...editor.family(), name: 'Changed family' });
  assert.equal(editor.workspacePublicationLive(), false);
  assert.equal(editor.workspacePublicationShortLabel(), 'Publicatiewijziging nog opslaan');
  editor.family.set(family('PUBLISHED'));
  editor.draft.set({ ...editor.draft(), active: false });
  assert.equal(editor.workspacePublicationLive(), false);
  assert.equal(editor.workspacePublicationShortLabel(), 'Publicatiewijziging nog opslaan');
  editor.baseline.set(JSON.stringify(editor.draft()));
  assert.equal(editor.workspacePublicationShortLabel(), 'Inactief');
});

test('an unchanged published family is not described as live while its data is unavailable', () => {
  const { editor } = harness();
  editor.family.set(family('PUBLISHED'));
  editor.savedFamily.set(family('PUBLISHED'));
  editor.familyLoading.set(true);
  assert.equal(editor.workspacePublicationLive(), false);
  assert.equal(editor.workspacePublicationShortLabel(), 'Laden…');
  editor.familyLoading.set(false);
  editor.familyLoadError.set(true);
  assert.equal(editor.workspacePublicationLive(), false);
  assert.equal(editor.workspacePublicationShortLabel(), 'Onbekend');
});

test('return-to navigation starts only after product and agreement writes have completed', async () => {
  const { editor, save, navigations } = harness();
  editor.returnTo.set('/sales/12/edit');
  let completed = false;
  editor.agreementEditor = () => ({ flush: async () => {
    assert.equal(editor.saving(), true, 'Navigation stays locked through the final write');
    completed = true;
    return { remaining: 0 };
  } });
  editor.router.navigateByUrl = async (target: unknown) => {
    assert.equal(completed, true);
    assert.equal(editor.canDeactivate(), true, 'Internal completed-save navigation passes the normal guard');
    navigations.push({ target, saving: editor.saving() });
    return true;
  };
  await save();
  assert.deepEqual(navigations, [{ target: '/sales/12/edit', saving: false }]);
});

test('new-product and copy navigation also happen after the write lock is released', async () => {
  const created = harness();
  created.editor.draft.set({ ...created.editor.draft(), id: null });
  await created.save();
  assert.equal(created.navigations.length, 1);
  assert.equal(created.navigations[0].saving, false);
  assert.deepEqual(Array.from(created.navigations[0].target as unknown[]), ['/products', 99, 'edit']);
  const copied = harness();
  await copied.copy();
  assert.equal(copied.navigations.length, 1);
  assert.equal(copied.navigations[0].saving, false);
  assert.equal(copied.editor.saving(), false);
});

test('a failed agreement caption reports partial save and stays on the editor', async () => {
  const { editor, save, notifications, navigations } = harness();
  editor.returnTo.set('/sales/12/edit');
  editor.agreementDirty.set(true);
  editor.agreementEditor = () => ({ flush: async () => ({ savedCaptions: 0, uploaded: 0, remaining: 0 }) });
  await save();
  assert.equal(editor.dirty(), false, 'The product write really succeeded');
  assert.equal(editor.agreementDirty(), true, 'The failed caption remains pending');
  assert.match(editor.saveError(), /bijschriften.*nog niet opgeslagen/);
  assert.equal(notifications.at(-1)?.type, 'err');
  assert.equal(navigations.length, 0);
  assert.equal(editor.saving(), false);
});

test('remaining agreement uploads report partial save even before child dirty state updates', async () => {
  const { editor, save, notifications, navigations } = harness();
  editor.returnTo.set('/sales/12/edit');
  editor.agreementEditor = () => ({ flush: async () => ({ remaining: 2 }) });
  await save();
  assert.match(editor.saveError(), /2 afspraakfoto.*nog niet geüpload/);
  assert.equal(notifications.at(-1)?.type, 'err');
  assert.equal(navigations.length, 0);
});

test('a failed photo queue enables the save action and the keyboard shortcut', () => {
  const { editor } = harness();
  editor.pendingPhotos.set(1);
  assert.equal(editor.workspaceDirty(), true);
  let saved = 0, prevented = false;
  editor.save = async () => { saved++; };
  editor.saveShortcut({ key: 's', ctrlKey: true, metaKey: false, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(saved, 1);
  editor.photoUploading.set(true);
  editor.saveShortcut({ key: 's', ctrlKey: true, metaKey: false, preventDefault: () => {} });
  assert.equal(saved, 1, 'The shortcut cannot start a second save during an upload');
});
