import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal, untracked } from '@angular/core';
import { createWatch } from '@angular/core/primitives/signals';

// Run both production methods: document responses can arrive while load() is
// still waiting for catalogue context and has not published the new view.
const source = await readFile(new URL('../src/app/features/purchasing/purchase-editor.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('purchase-editor.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'PurchaseEditor');
assert.ok(original);
const names = new Set(['load', 'loadDocuments']);
const members = original.members.filter(member => ts.isConstructorDeclaration(member)
  || (member.name && ts.isIdentifier(member.name) && names.has(member.name.text)));
assert.equal(members.length, names.size + 1);
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)),
  original.name, original.typeParameters, undefined, members);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const document = (id: number, orderId = 50) => ({ id, orderId, originalFilename: `bewijs-${id}.pdf`, paymentId: 70 });
const order = (id = 50) => ({ order: { id, supplierId: 8, number: `PO-${id}`, lines: [] } });
const settle = () => new Promise(resolve => setImmediate(resolve));

function setup() {
  const calls: string[] = [];
  const api = {
    documents: async (id: number) => [document(100 + id, id)],
    purchaseOrder: async (id: number) => order(id),
    products: async () => [] as unknown[],
  };
  const exports: Record<string, new () => any> = {};
  // Real Angular signal dependency tracking, with a controlled scheduler rather
  // than an application injector. This includes reads before load's first await.
  const watches: ReturnType<typeof createWatch>[] = [];
  let effectPending = false;
  vm.runInNewContext(javascript, { exports, untracked, effect: (callback: () => void) => {
    const watch = createWatch(callback, () => { effectPending = true; }, true);
    watches.push(watch);
    watch.notify();
    return { destroy: () => watch.destroy() };
  } });
  const editor = new exports['PurchaseEditor']();
  Object.assign(editor, {
    id: signal('50'), view: signal<ReturnType<typeof order> | null>(null),
    documents: signal<ReturnType<typeof document>[] | null>(null), documentsFailed: signal(false), documentLoadVersion: 0,
    paymentRefreshVersion: 0, previewVersion: 0,
    paymentStateError: signal(null), paymentStateLoading: signal(false), payments: signal(null),
    families: signal([]), products: signal([]), categories: signal([]), freightRates: signal([]),
    stockLocations: signal([]), supplier: signal(null), savedOrder: signal(''),
    loadPayments: async () => {}, loadPartnerDocs: async () => {},
    sourcing: {
      documents: (id: number) => { calls.push(`GET documents ${id}`); return api.documents(id); },
      purchaseOrder: (id: number) => { calls.push(`GET order ${id}`); return api.purchaseOrder(id); },
      suppliers: async () => [{ id: 8, name: 'Leverancier' }], freightRates: async () => [],
    },
    catalog: {
      productFamilies: async () => [], products: () => api.products(),
      categories: async () => [], stockLocations: async () => [],
    },
  });
  return { editor, api, calls, effectPending: () => effectPending,
    flushEffect: () => { effectPending = false; for (const watch of watches) watch.run(); },
    destroy: () => { for (const watch of watches) watch.destroy(); } };
}

test('the route effect loads once and never subscribes to the order view or draft edits', async () => {
  const state = setup();
  try {
    state.flushEffect();
    await settle();
    assert.equal(state.editor.view().order.id, 50);
    assert.equal(state.effectPending(), false, 'Publishing the loaded view must not restart the route effect');
    assert.deepEqual(state.calls, ['GET order 50', 'GET documents 50']);
    const edited = { ...state.editor.view(), order: { ...state.editor.view().order, alias: 'Nog niet opgeslagen' } };
    state.editor.view.set(edited);
    assert.equal(state.effectPending(), false, 'Typing must not reload the server and discard the draft');
    state.editor.id.set('51');
    assert.equal(state.effectPending(), true, 'A real route change must still load the next container');
    state.flushEffect();
    await settle();
    assert.equal(state.editor.view().order.id, 51);
    assert.equal(state.effectPending(), false);
    assert.deepEqual(state.calls, ['GET order 50', 'GET documents 50', 'GET order 51', 'GET documents 51']);
  } finally { state.destroy(); }
});

test('first-open documents survive a response before the catalogue and order view are ready', async () => {
  const { editor, api, calls } = setup();
  const catalogue = deferred<unknown[]>();
  api.products = () => catalogue.promise;
  const opening = editor.load(50);
  try {
    await settle();
    assert.equal(editor.view(), null, 'The catalogue still holds back the order view');
    assert.deepEqual(editor.documents(), [document(150)]);
    assert.deepEqual(calls, ['GET order 50', 'GET documents 50']);
  } finally {
    catalogue.resolve([]);
    await opening;
  }
  assert.equal(editor.view().order.id, 50);
  assert.deepEqual(editor.documents(), [document(150)]);
});

test('opening another order clears the previous dossier and accepts its own early documents', async () => {
  const { editor, api } = setup();
  editor.view.set(order(49)); editor.documents.set([document(149, 49)]);
  const catalogue = deferred<unknown[]>();
  api.products = () => catalogue.promise;
  const opening = editor.load(50);
  try {
    assert.equal(editor.documents(), null, 'Old files cannot appear under the next container');
    await settle();
    assert.equal(editor.view(), null, 'A new dossier must not appear under the previous order heading');
    assert.deepEqual(editor.documents(), [document(150)]);
  } finally {
    catalogue.resolve([]);
    await opening;
  }
});

test('refreshing the same order keeps its current view while catalogue context is pending', async () => {
  const { editor, api } = setup();
  const current = order();
  editor.view.set(current);
  const catalogue = deferred<unknown[]>();
  api.products = () => catalogue.promise;
  const opening = editor.load(50);
  try {
    await settle();
    assert.equal(editor.view(), current);
    assert.deepEqual(editor.documents(), [document(150)]);
  } finally {
    catalogue.resolve([]);
    await opening;
  }
});

for (const outcome of ['success', 'failure'] as const) {
  test(`a late document ${outcome} cannot replace another order's dossier`, async () => {
    const { editor, api } = setup();
    editor.view.set(order());
    const old = deferred<ReturnType<typeof document>[]>();
    api.documents = id => id === 50 ? old.promise : Promise.resolve([document(151, 51)]);
    const first = editor.loadDocuments(50);
    editor.id.set('51');
    await editor.load(51);
    assert.deepEqual(editor.documents(), [document(151, 51)]);
    if (outcome === 'success') old.resolve([document(150)]); else old.reject(new Error('Old request failed'));
    await first;
    assert.deepEqual(editor.documents(), [document(151, 51)]);
  });

  test(`a late ${outcome} is ignored as soon as the route changes, even while the old view remains`, async () => {
    const { editor, api } = setup();
    editor.view.set(order()); editor.documents.set([document(150)]);
    const old = deferred<ReturnType<typeof document>[]>();
    api.documents = () => old.promise;
    const request = editor.loadDocuments(50);
    editor.id.set('51');
    if (outcome === 'success') old.resolve([document(999)]); else old.reject(new Error('Old request failed'));
    await request;
    assert.deepEqual(editor.documents(), [document(150)]);
    assert.equal(editor.documentsFailed(), false, 'A stale answer says nothing about the current proofs');
  });
}

test('a failed document request leaves an empty dossier but marks the proofs unknown until a list arrives', async () => {
  const { editor, api } = setup();
  editor.view.set(order());
  api.documents = async () => { throw new Error('Documenten niet bereikbaar'); };
  await editor.loadDocuments(50);
  assert.equal(editor.documents().length, 0, 'The dossier shows no files');
  assert.equal(editor.documentsFailed(), true, 'The payments ledger must not read the failure as missing proofs');
  api.documents = async () => [document(150)];
  await editor.loadDocuments(50);
  assert.deepEqual(editor.documents(), [document(150)]);
  assert.equal(editor.documentsFailed(), false);
});

test('a newer same-order refresh wins over a delayed list from before a document upload', async () => {
  const { editor, api } = setup();
  editor.view.set(order());
  const old = deferred<ReturnType<typeof document>[]>();
  api.documents = () => old.promise;
  const first = editor.loadDocuments(50);
  api.documents = async () => [document(150), document(151)];
  await editor.loadDocuments(50);
  old.resolve([document(150)]);
  await first;
  assert.deepEqual(editor.documents(), [document(150), document(151)]);
});

test('returning to the same order does not revive a request from the previous visit', async () => {
  const { editor, api } = setup();
  editor.view.set(order());
  const old = deferred<ReturnType<typeof document>[]>();
  api.documents = () => old.promise;
  const first = editor.loadDocuments(50);
  editor.id.set('51'); api.documents = async id => [document(id + 200, id)];
  await editor.load(51);
  editor.id.set('50');
  await editor.load(50);
  old.resolve([document(150)]);
  await first;
  assert.deepEqual(editor.documents(), [document(250)]);
});
