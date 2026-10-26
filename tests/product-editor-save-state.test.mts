import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { priceBasisConfirmation } from '../src/app/features/products/product-sales-unit.ts';
import { stockCellEdit } from '../src/app/features/products/stock-booking.ts';
import { mirrorPatch, noteWrite, sortSupplierRows } from '../src/app/features/products/product-suppliers.ts';

/**
 * Run the production save, stock, leave and publication-state expressions with
 * real Angular signals. AST selection omits the editor's unrelated DOM/API
 * constructor; it does not replace any tested method or expression.
 */
const source = await readFile(new URL('../src/app/features/products/product-editor.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('product-editor.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'ProductEditor');
assert.ok(original);
const names = new Set(['dirty', 'familyDirty', 'workspacePublicationLive', 'workspacePublicationShortLabel',
  'workspacePublicationLabel', 'workspaceDirty', 'canDeactivate', 'warnBeforeUnload', 'confirmDiscardTranslations',
  'save', 'copy', 'saveShortcut', 'markClean', 'formWriteBusy', 'toolbarBusy', 'saveBusy', 'quickSetStock', 'loadStockHistory',
  'agreementDirty', 'rowNotesDirty', 'onSupplierRowsChanged', 'saveRowNotes']);
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
    exports, computed, HostListener: () => () => {}, priceBasisConfirmation, stockCellEdit, escapeHtml: (text: string) => text,
    mirrorPatch, noteWrite, sortSupplierRows, messageOf: (failure: { error?: { message?: string } }, fallback: string) => failure?.error?.message ?? fallback,
    window: { confirm: () => { confirmCalls++; return translationDiscard; } },
  });
  const editor = new exports.ProductEditor!();
  const save = editor.save.bind(editor);
  const copy = editor.copy.bind(editor);
  const loadStockHistory = editor.loadStockHistory.bind(editor);
  const notifications: { message: string; type?: string }[] = [];
  const confirms: { title: string; message: string; confirmLabel?: string; onConfirm: () => void; onCancel?: () => void }[] = [];
  const navigations: { target: unknown; saving: boolean }[] = [];
  const initial = { id: 10, active: true, name: 'SKU', carton: { piecesPerCarton: 1, weightKg: 1 }, publicationIssues: [] };
  Object.assign(editor, {
    draft: signal(initial), baseline: signal(JSON.stringify(initial)),
    family: signal(family()), savedFamily: signal(family()), familyLoading: signal(false), familyLoadError: signal(false),
    saving: signal(false), photoUploading: signal(false), translationSaving: signal(false), translationDirty: signal(false),
    agreementBusy: signal(false), agreementChildDirty: signal(false), sharedFieldsBusy: signal(false),
    supplierRows: signal([]), rowNoteDrafts: signal({}), agreementSupplierId: signal(null), purchaseMode: signal('rows'),
    loadSupplierRows: async () => {},
    leaveQuestion: signal(null), readinessIssues: signal([]), pendingPhotos: signal(0), photoRevision: signal(0),
    save: async () => {},
    editorReady: signal(true), autoCartonPieces: signal(null), autoCartonWeight: signal(null), settleOrderStep: () => {}, missingFields: signal([]),
    priceBasisChange: signal(null), savedDraft: signal(null), salesPrice: signal(0),
    saveError: signal(null), savedProductFamilyId: signal(null), savedSupplierId: signal(null), savedHere: signal(false),
    returnTo: signal(null), loadStockHistory: async () => {}, loadStockLevels: async () => {},
    persistFamilyDraft: async () => { editor.savedFamily.set(structuredClone(editor.family())); },
    updateWithPendingPhotos: async () => structuredClone(editor.draft()),
    createWithPendingPhotos: async () => ({ ...structuredClone(editor.draft()), id: 99 }),
    agreementEditor: () => ({ flush: async () => ({ remaining: 0 }), dirty: editor.agreementChildDirty }),
    planPublishFix: () => null,
    ui: {
      toast: (message: string, type?: string) => notifications.push({ message, type }),
      confirm: (options: { title: string; message: string; confirmLabel?: string }, onConfirm: () => void, _secondary?: () => void, onCancel?: () => void) => {
        confirms.push({ ...options, onConfirm, onCancel });
      },
    },
    router: {
      navigate: async (target: unknown) => { navigations.push({ target, saving: editor.saving() }); return true; },
      navigateByUrl: async (target: unknown) => { navigations.push({ target, saving: editor.saving() }); return true; },
    },
    canCopyVariant: signal(true), copyVariantConflict: signal(null), copying: signal(true),
    copyColour: signal('White'), copyColourHex: signal('#FFFFFF'), copySize: signal('XL'),
    catalog: { duplicateProduct: async () => ({ id: 101, sku: 'COPY-101' }), updateProductSupplierNote: async () => { throw new Error('not stubbed'); } },
    stockSaving: signal(false), takingCode: signal(false), stockDraft: signal<number | null>(null), stockLevels: signal([]), stockHistory: signal(null),
  });
  editor.isNew = () => editor.draft().id === null;
  editor.photoManager = () => ({ pendingCount: editor.pendingPhotos });
  return { editor, save, copy, loadStockHistory, notifications, navigations, confirms, denyTranslationDiscard: () => { translationDiscard = false; }, confirmCalls: () => confirmCalls };
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

test('navigation and browser unload stay guarded throughout saves, uploads, stock writes and barcode allocation', () => {
  for (const flag of ['saving', 'photoUploading', 'translationSaving', 'agreementBusy', 'sharedFieldsBusy', 'stockSaving', 'takingCode']) {
    const { editor } = harness();
    editor[flag].set(true);
    assert.equal(editor.canDeactivate(), false, flag);
    let prevented = false;
    const event = { preventDefault: () => { prevented = true; }, returnValue: undefined };
    editor.warnBeforeUnload(event);
    assert.equal(prevented, true, flag);
    assert.equal(event.returnValue, '');
    editor[flag].set(false);
    assert.equal(editor.canDeactivate(), true, `Navigation resumes after ${flag} finishes`);
  }
});

test('stock and barcode activity disable toolbar actions without disabling unrelated product fields', () => {
  const { editor } = harness();
  assert.equal(editor.toolbarBusy(), false);
  for (const flag of ['stockSaving', 'takingCode']) {
    editor[flag].set(true);
    assert.equal(editor.toolbarBusy(), true, flag);
    assert.equal(editor.formWriteBusy(), false, flag);
    editor[flag].set(false);
    assert.equal(editor.toolbarBusy(), false);
  }
  editor.saving.set(true);
  assert.equal(editor.toolbarBusy(), true, 'Ordinary form writes still disable the toolbar');
});

test('late stock history success or failure cannot replace the newly opened product history', async () => {
  for (const fails of [false, true]) {
    const { editor, loadStockHistory } = harness();
    let finish!: (value: unknown) => void;
    let fail!: (error: Error) => void;
    editor.catalog.stockMovements = () => new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    const pending = loadStockHistory(10);
    assert.equal(editor.stockHistory(), null);
    editor.draft.set({ ...editor.draft(), id: 20 });
    const current = [{ id: 201, productId: 20, quantity: 72 }];
    editor.stockHistory.set(current);
    if (fails) fail(new Error('Old request failed'));
    else finish([{ id: 101, productId: 10, quantity: 24 }]);
    await pending;
    assert.equal(editor.stockHistory(), current, fails ? 'Stale error' : 'Stale success');
    let calls = 0;
    editor.catalog.stockMovements = async () => { calls++; return []; };
    await loadStockHistory(10);
    assert.equal(calls, 0, 'A stale caller cannot clear or request history for another product');
    assert.equal(editor.stockHistory(), current);
  }
});

test('current product stock history still displays returned movements or an empty failure state', async () => {
  const { editor, loadStockHistory } = harness();
  const movements = [{ id: 101, productId: 10, quantity: 24 }];
  editor.catalog.stockMovements = async () => movements;
  await loadStockHistory(10);
  assert.equal(editor.stockHistory(), movements);
  editor.catalog.stockMovements = async () => { throw new Error('Unavailable'); };
  await loadStockHistory(10);
  assert.equal(editor.stockHistory().length, 0);
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
  assert.equal(editor.workspacePublicationShortLabel(), '—', 'a figure that arrives later reads as a dash, never Laden…');
  editor.familyLoading.set(false);
  editor.familyLoadError.set(true);
  assert.equal(editor.workspacePublicationLive(), false);
  assert.equal(editor.workspacePublicationShortLabel(), 'Onbekend');
});

test('return-to navigation starts only after product and agreement writes have completed', async () => {
  const { editor, save, navigations } = harness();
  editor.returnTo.set('/sales/12/edit');
  let completed = false;
  editor.agreementEditor = () => ({ dirty: editor.agreementChildDirty, flush: async () => {
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
  editor.agreementChildDirty.set(true);
  editor.agreementEditor = () => ({ dirty: editor.agreementChildDirty, flush: async () => ({ savedCaptions: 0, uploaded: 0, remaining: 0 }) });
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
  editor.agreementEditor = () => ({ dirty: editor.agreementChildDirty, flush: async () => ({ remaining: 2 }) });
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

test('unsaved translations keep their own controls editable while actual writes lock the product form', () => {
  const { editor } = harness();
  assert.equal(editor.formWriteBusy(), false);
  editor.translationDirty.set(true);
  assert.equal(editor.saveBusy(), true, 'The main product save waits for the separate translation save');
  assert.equal(editor.formWriteBusy(), false, 'Typing a translation must not disable its own fields and save button');
  for (const flag of ['saving', 'photoUploading', 'agreementBusy', 'translationSaving', 'sharedFieldsBusy']) {
    editor[flag].set(true);
    assert.equal(editor.formWriteBusy(), true, flag);
    editor[flag].set(false);
    assert.equal(editor.formWriteBusy(), false, `Only unsaved translations remain after ${flag}`);
  }
});

test('save sends missing fields through the reveal-and-focus helper before any write', async () => {
  for (const field of ['p-supplier', 'p-packaging-pieces']) {
    const { editor, save, notifications, navigations } = harness();
    const focused: { tab: string; field: string }[] = [];
    const writes: string[] = [];
    editor.missingFields.set([{ tab: 'identity', field, label: 'Ontbrekend verplicht veld' }]);
    editor.focusField = (tab: string, field: string) => focused.push({ tab, field });
    editor.persistFamilyDraft = async () => { writes.push('family'); };
    editor.updateWithPendingPhotos = async () => { writes.push('product/photos'); return editor.draft(); };
    editor.agreementEditor = () => ({ dirty: editor.agreementChildDirty, flush: async () => { writes.push('agreements'); return { remaining: 0 }; } });
    await save();
    assert.deepEqual(focused, [{ tab: 'identity', field }], 'The helper opens the native details before focusing');
    assert.deepEqual(writes, []);
    assert.deepEqual(navigations, []);
    assert.equal(editor.saving(), false);
    assert.match(notifications.at(-1)?.message ?? '', /Nog invullen/);
  }
});

test('blank or invalid stock input restores the previous value without booking a correction', async () => {
  for (const value of ['', ' \t ', 'not a number', '-1', '1.5', '1,5', '1e3', 'Infinity', '9007199254740992', '1.00', '10.00.000']) {
    const { editor, notifications } = harness();
    const level = { locationId: 3, quantity: 24 };
    const field = { value };
    const writes: number[] = [];
    editor.stockDraft.set(17);
    editor.saveStock = async (locationId: number) => { writes.push(locationId); };
    await editor.quickSetStock(level, field);
    assert.equal(field.value, '24', `Restore previous stock for ${JSON.stringify(value)}`);
    assert.equal(editor.stockDraft(), 17, 'Invalid input cannot reach the correction draft');
    assert.deepEqual(writes, []);
    assert.deepEqual(notifications.at(-1), { message: 'Niet geboekt: geen geldig aantal', type: 'err' }, `Say why for ${JSON.stringify(value)}`);
  }
});

test('a stock tile reads Dutch thousands as on /stock: "1.000" books a thousand, never 1', async () => {
  for (const [value, expected] of [['1.000', 1000], ['1 000', 1000], ['6.012', 6012], [' 1000 ', 1000], ['12', 12]] as const) {
    const { editor } = harness();
    const level = { locationId: 3, quantity: 24 };
    const field = { value };
    const writes: { locationId: number; quantity: number }[] = [];
    editor.stockLevels.set([level]);
    editor.saveStock = async (locationId: number) => {
      writes.push({ locationId, quantity: editor.stockDraft() });
      editor.stockLevels.set([{ ...level, quantity: editor.stockDraft() }]);
    };
    await editor.quickSetStock(level, field);
    assert.deepEqual(writes, [{ locationId: 3, quantity: expected }], value);
  }
});

test('typing the figure that already stands books nothing and says nothing', async () => {
  for (const value of ['24', ' 24 ']) {
    const { editor, notifications } = harness();
    const field = { value };
    const writes: number[] = [];
    editor.saveStock = async (locationId: number) => { writes.push(locationId); };
    await editor.quickSetStock({ locationId: 3, quantity: 24 }, field);
    assert.equal(field.value, '24');
    assert.deepEqual(writes, []);
    assert.equal(notifications.length, 0);
  }
});

test('an explicitly entered zero still books the intended stock correction once', async () => {
  const { editor } = harness();
  const level = { locationId: 3, quantity: 24 };
  const field = { value: '0' };
  const writes: { locationId: number; quantity: number }[] = [];
  editor.stockLevels.set([level]);
  editor.saveStock = async (locationId: number) => {
    writes.push({ locationId, quantity: editor.stockDraft() });
    editor.stockLevels.set([{ ...level, quantity: editor.stockDraft() }]);
  };
  await editor.quickSetStock(level, field);
  assert.deepEqual(writes, [{ locationId: 3, quantity: 0 }]);
  assert.equal(field.value, '0');
  assert.equal(editor.stockDraft(), 0);
});

test('leaving a stock field during another write cannot start a second correction', async () => {
  for (const flag of ['stockSaving', 'saving', 'photoUploading', 'agreementBusy', 'translationSaving']) {
    const { editor } = harness();
    const writes: number[] = [];
    const field = { value: '0' };
    editor[flag].set(true);
    editor.saveStock = async (locationId: number) => { writes.push(locationId); };
    await editor.quickSetStock({ locationId: 3, quantity: 24 }, field);
    assert.equal(field.value, '24', flag);
    assert.equal(editor.stockDraft(), null, flag);
    assert.deepEqual(writes, [], flag);
  }
});

function basisSwitch() {
  const context = harness();
  const { editor } = context;
  const writes: unknown[] = [];
  const settled: string[] = [];
  editor.updateWithPendingPhotos = async () => { writes.push(structuredClone(editor.draft())); return structuredClone(editor.draft()); };
  editor.draft.set({ ...editor.draft(), name: 'Per display now', carton: { piecesPerCarton: 0, weightKg: null }, stockQuantity: 96,
    packaging: { kind: 'DISPLAY', piecesPerUnit: 12, salesUnit: 'DISPLAY', unitKey: 'stuk', orderStep: 'PACKAGE' } });
  editor.savedDraft.set({ ...editor.draft(), packaging: { ...editor.draft().packaging, salesUnit: 'PIECE' } });
  editor.priceBasisChange.set({ to: 'DISPLAY', pieces: 12, leftDisplay: false });
  editor.salesPrice.set(35.4);
  // What save() changes in the draft on its way to the server: the automatic carton and the order step.
  editor.autoCartonPieces.set(12);
  editor.autoCartonWeight.set(4.8);
  editor.patchCarton = (changes: Record<string, unknown>) => editor.draft.update((p: any) => ({ ...p, carton: { ...p.carton, ...changes } }));
  editor.settleOrderStep = () => { settled.push('settled'); editor.draft.update((p: any) => ({ ...p, packaging: { ...p.packaging, orderStep: 'UNIT' } })); };
  return { ...context, writes, settled };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a new price basis asks before it saves, and saves only on Bewaren', async () => {
  const { editor, save, confirms, writes, settled } = basisSwitch();
  let finished = false;
  const saving = save().then(() => { finished = true; });
  await tick();
  assert.equal(writes.length, 0, 'nothing is written before the answer');
  assert.equal(finished, false, 'a caller that awaits save() waits for the answer');
  assert.equal(confirms.length, 1);
  assert.equal(confirms[0].title, 'Prijsbasis wijzigen?');
  assert.equal(confirms[0].confirmLabel, 'Bewaren');
  assert.match(confirms[0].message, /per display van 12 in plaats van per stuk/);
  assert.match(confirms[0].message, /Voorraad \(96\), doosinhoud \(12\) en kostprijs worden niet omgerekend/,
    'the automatic carton count is named without writing it into the draft first');
  confirms[0].onConfirm();
  await saving;
  assert.equal(writes.length, 1, 'Bewaren saves without asking again, before save() resolves');
  assert.equal(confirms.length, 1);
  assert.deepEqual(settled, ['settled']);
  assert.equal((writes[0] as any).carton.piecesPerCarton, 12);
  assert.equal(editor.dirty(), false, 'Copy to the colours and Opslaan on leaving read a clean editor after Bewaren');
});

test('Annuleren on the price basis question leaves the draft exactly as it was', async () => {
  const { editor, save, confirms, writes, settled } = basisSwitch();
  const before = structuredClone(editor.draft());
  const saving = save();
  await tick();
  confirms[0].onCancel!();
  await saving;
  assert.equal(writes.length, 0);
  assert.deepEqual(settled, [], 'the order step is not settled behind the question');
  assert.deepEqual(editor.draft(), before, 'no carton patch and "klant bestelt per display" stays PACKAGE');
  assert.equal(editor.draft().packaging.orderStep, 'PACKAGE');
  assert.equal(editor.dirty(), true, 'a caller that awaited save() sees the work is still unsaved');
});

test('the Voorraad tiles are text fields read by parseCount, so the browser never sanitises "1.000" to 1', () => {
  assert.match(source, /<input class="history-levels__qty num" type="text" inputmode="numeric" autocomplete="off"/);
  assert.doesNotMatch(source, /history-levels__qty num" type="number"/);
  assert.doesNotMatch(source, /Geef een heel aantal stuks/);
});

/* Several suppliers (2026-10-25): a row write, the other suppliers' notes and the save. */
function supplierRow(id: number, supplierId: number, supplierName: string, extra: Record<string, unknown> = {}) {
  return { id, productId: 10, supplierId, supplierName, preferred: false, active: true, versionLabel: null, supplierReference: null,
    exwPrice: 2, exwCurrency: 'USD', extraUnitCost: null, moq: null, leadTimeDays: null, supplierNote: null, photoCount: 0,
    lastOrder: null, lastCost: null, purchaseLineCount: 0, updatedAt: `2026-10-25T10:00:0${id % 10}.000001Z`, ...extra };
}
function supplierHarness() {
  const context = harness();
  const { editor } = context;
  const product = { id: 10, active: true, name: 'Glass dome', supplierId: 3, supplierNote: 'A note', exwPrice: 8.5, exwCurrency: 'USD',
    extraUnitCost: null, carton: { piecesPerCarton: 1, weightKg: 1 }, publicationIssues: [] };
  editor.draft.set(product);
  editor.baseline.set(JSON.stringify(product));
  editor.savedSupplierId.set(3);
  editor.supplierRows.set([supplierRow(701, 3, 'Jerry', { preferred: true, supplierNote: 'A note', exwPrice: 8.5 }),
    supplierRow(702, 7, 'Rosegift', { supplierNote: 'B note', exwPrice: 9.1 })]);
  return context;
}
const change = (rows: unknown[], product: Record<string, unknown>) => ({ rows, product });

test('a supplier row change lands in the draft and its baseline: the editor is not dirty after it', () => {
  const { editor } = supplierHarness();
  const rows = [supplierRow(701, 3, 'Jerry', { preferred: true, supplierNote: 'A note', exwPrice: 8.75, extraUnitCost: 0.1 }),
    supplierRow(702, 7, 'Rosegift', { supplierNote: 'B note' })];
  editor.onSupplierRowsChanged(change(rows, { supplierId: 3, supplierNote: 'A note', exwPrice: 8.75, exwCurrency: 'USD', extraUnitCost: 0.1 }));
  assert.equal(editor.dirty(), false);
  assert.equal(editor.draft().exwPrice, 8.75, 'the mirror of the Voorkeur lands in the draft');
  assert.equal(editor.draft().extraUnitCost, 0.1);
  assert.equal(editor.savedSupplierId(), 3);
  assert.deepEqual(editor.supplierRows().map((row: { id: number }) => row.id), [701, 702]);
});

test('a name typed before the row change stays dirty after it, and only the mirror moves', () => {
  const { editor } = supplierHarness();
  editor.draft.set({ ...editor.draft(), name: 'Glass dome XL' });
  editor.onSupplierRowsChanged(change(editor.supplierRows(),
    { supplierId: 7, supplierNote: 'B note', exwPrice: 9.1, exwCurrency: null, extraUnitCost: null }));
  assert.equal(editor.dirty(), true, 'the typed name is still unsaved');
  assert.equal(editor.draft().name, 'Glass dome XL');
  assert.equal(editor.draft().supplierId, 7);
  assert.equal(editor.draft().exwCurrency, 'USD', 'a null mirror currency reads USD');
  assert.equal(JSON.parse(editor.baseline()).name, 'Glass dome', 'the baseline keeps the saved name');
  assert.equal(JSON.parse(editor.baseline()).supplierId, 7, 'the baseline follows the new Voorkeur');
  assert.equal(editor.savedSupplierId(), 7);
  editor.draft.set({ ...editor.draft(), name: 'Glass dome' });
  assert.equal(editor.dirty(), false, 'typing the name back reads clean: nothing but the name differed');
});

test('a Voorkeur switch keeps a typed Voorkeur note with its own supplier, as that row\'s unsaved note', () => {
  const { editor } = supplierHarness();
  editor.draft.set({ ...editor.draft(), supplierNote: 'A note, typed' });
  editor.onSupplierRowsChanged(change(
    [supplierRow(701, 3, 'Jerry', { supplierNote: 'A note' }), supplierRow(702, 7, 'Rosegift', { preferred: true, supplierNote: 'B note' })],
    { supplierId: 7, supplierNote: 'B note', exwPrice: 9.1, exwCurrency: 'USD', extraUnitCost: null }));
  assert.equal(editor.draft().supplierNote, 'B note', 'the product note is the new Voorkeur\'s');
  assert.deepEqual({ ...editor.rowNoteDrafts() }, { 3: 'A note, typed' });
  assert.equal(editor.agreementSupplierId(), 3, 'the Afspraken tab keeps showing the supplier the note was typed for');
  assert.equal(editor.dirty(), false);
  assert.equal(editor.agreementDirty(), true, 'the typed note is still to save, now through its row');
});

test('a row note draft makes agreementDirty true; a draft equal to the stored note does not', () => {
  const { editor } = supplierHarness();
  assert.equal(editor.agreementDirty(), false);
  editor.rowNoteDrafts.set({ 7: 'B note, longer' });
  assert.equal(editor.agreementDirty(), true);
  editor.rowNoteDrafts.set({ 7: 'B note' });
  assert.equal(editor.agreementDirty(), false);
  editor.rowNoteDrafts.set({ 9: 'a supplier no longer on the product' });
  assert.equal(editor.agreementDirty(), false);
  editor.agreementChildDirty.set(true);
  assert.equal(editor.agreementDirty(), true, 'photos and captions of the agreement editor still count');
});

test('save writes a changed row note through the note call before the editor reads clean', async () => {
  const { editor, save, notifications } = supplierHarness();
  const calls: unknown[] = [];
  editor.rowNoteDrafts.set({ 7: 'B note, longer' });
  editor.catalog.updateProductSupplierNote = async (productId: number, rowId: number, body: unknown) => {
    calls.push([productId, rowId, body]);
    assert.equal(editor.saving(), true, 'the note is written inside the save');
    return change([supplierRow(701, 3, 'Jerry', { preferred: true, supplierNote: 'A note', exwPrice: 8.5 }),
      supplierRow(702, 7, 'Rosegift', { supplierNote: 'B note, longer' })],
    { supplierId: 3, supplierNote: 'A note', exwPrice: 8.5, exwCurrency: 'USD', extraUnitCost: null });
  };
  await save();
  assert.deepEqual(calls, [[10, 702, { supplierNote: 'B note, longer', updatedAt: '2026-10-25T10:00:02.000001Z' }]]);
  assert.deepEqual({ ...editor.rowNoteDrafts() }, {});
  assert.equal(editor.agreementDirty(), false);
  assert.equal(editor.dirty(), false);
  assert.equal(editor.saveError(), null);
  assert.equal(notifications.at(-1)?.message, 'Opgeslagen');
});

test('a failed row note keeps its draft and reports a partial save with the reason', async () => {
  const { editor, save, notifications, navigations } = supplierHarness();
  editor.returnTo.set('/sales/12/edit');
  editor.rowNoteDrafts.set({ 7: 'B note, longer' });
  editor.catalog.updateProductSupplierNote = async () => {
    throw { status: 409, error: { message: 'Deze leverancier is intussen gewijzigd; laad het product opnieuw.' } };
  };
  let reloads = 0;
  editor.loadSupplierRows = async () => { reloads++; };
  await save();
  assert.deepEqual({ ...editor.rowNoteDrafts() }, { 7: 'B note, longer' });
  assert.equal(editor.agreementDirty(), true);
  assert.equal(editor.dirty(), false, 'the product write itself succeeded');
  assert.match(editor.saveError(), /^Product opgeslagen · afspraak Rosegift niet opgeslagen: Deze leverancier is intussen gewijzigd/);
  assert.equal(notifications.at(-1)?.type, 'err');
  assert.equal(reloads, 1, 'a 409 loads the rows again, so the next try carries the new updatedAt');
  assert.equal(navigations.length, 0);
});

test('after a save from the fallback fields the rows load again; with rows they do not', async () => {
  for (const [mode, expected] of [['legacy', 1], ['loading', 1], ['rows', 0]] as const) {
    const { editor, save } = supplierHarness();
    let reloads = 0;
    editor.purchaseMode.set(mode);
    editor.loadSupplierRows = async () => { reloads++; };
    await save();
    assert.equal(reloads, expected, mode);
  }
});

test('the product PUT leaves the purchase fields to the rows, and the missing supplier points at the right field', () => {
  assert.match(source, /\.\.\.purchaseFieldsForPut\(this\.purchaseMode\(\), product\),/);
  assert.match(source, /const supplier = supplierMissing\(this\.purchaseMode\(\), this\.supplierRows\(\)\.length, draft\.supplierId\);/);
  assert.match(source, /<app-product-supplier-list \[productId\]="draft\(\)\.id \?\? 0"/);
  assert.match(source, /Leveranciers konden niet laden · <button class="linklike" type="button" \(click\)="reloadSupplierRows\(\)">Opnieuw<\/button>/);
  assert.match(source, /<p>Leveranciers, fabrieksprijs en kostprijsopbouw<\/p>/);
  assert.match(source, /<select class="select" id="pa-supplier" \[disabled\]="agreementDirty\(\)" \[attr\.title\]="agreementDirty\(\) \? 'Eerst opslaan' : null"/);
  assert.match(source, /Wijzigen in Inkoop ›<\/button>/);
});
