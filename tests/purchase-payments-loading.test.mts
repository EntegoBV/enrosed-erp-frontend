import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal, untracked } from '@angular/core';

/*
 * F23 starts the payments beside the order (Inkoop redesign I6). Their failure
 * may speak only for the order on screen, and only once that order stands: a
 * failed order already shows the load-error card with 'Opnieuw proberen'.
 * load() and loadPayments() run as written in purchase-editor.ts.
 */
const source = await readFile(new URL('../src/app/features/purchasing/purchase-editor.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('purchase-editor.ts', source, ts.ScriptTarget.Latest, true);
const editorClass = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'PurchaseEditor');
assert.ok(editorClass);
const names = new Set(['load', 'loadPayments']);
const members = editorClass.members.filter((member) => member.name && ts.isIdentifier(member.name) && names.has(member.name.text));
assert.equal(members.length, names.size);
const javascript = ts.transpileModule(ts.createPrinter().printNode(ts.EmitHint.Unspecified,
  ts.factory.updateClassDeclaration(editorClass, editorClass.modifiers?.filter((modifier) => !ts.isDecorator(modifier)), editorClass.name, undefined, undefined, members), parsed), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText + '\nexports.PurchaseEditor = PurchaseEditor;';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve)); };
const order = (id: number) => ({ order: { id, supplierId: 8, number: `PO-${id}`, lines: [] } });

function setup() {
  const toasts: [string, string | undefined][] = [];
  const payments = new Map<number, ReturnType<typeof deferred<unknown[]>>>();
  const orders = new Map<number, ReturnType<typeof deferred<ReturnType<typeof order>>>>();
  const exports: Record<string, new () => any> = {};
  vm.runInNewContext(javascript, { exports, untracked, LOAD_ERROR_FALLBACK: 'Controleer de verbinding en probeer opnieuw.',
    messageOf: (failure: unknown, fallback: string) => (failure as { message?: string })?.message || fallback });
  const editor = new exports['PurchaseEditor']();
  const pending = <T,>(map: Map<number, ReturnType<typeof deferred<T>>>, id: number) => {
    if (!map.has(id)) map.set(id, deferred<T>());
    return map.get(id)!;
  };
  Object.assign(editor, {
    id: signal('50'), view: signal<ReturnType<typeof order> | null>(null), documents: signal(null), documentLoadVersion: 0,
    paymentRefreshVersion: 0, previewVersion: 0, paymentStateError: signal(null), paymentStateLoading: signal(false), payments: signal(null),
    loadError: signal<string | null>(null), families: signal([]), products: signal([]), categories: signal([]), freightRates: signal([]),
    stockLocations: signal([]), supplier: signal(null), savedOrder: signal(''), applyFor: signal(null),
    loadDocuments: async () => {}, loadPartnerDocs: async () => {}, loadBankLines: async () => {},
    /* The other suppliers' products of the lines (stale costs), fetched once the order shows: quiet here. */
    refreshOtherProducts: async () => {},
    /* The container's stock batches (2026-10-25), fetched once a booked order shows: quiet here. */
    stockBatches: signal(null), loadStockBatches: async () => {},
    ui: { toast: (text: string, tone?: string) => { toasts.push([text, tone]); } },
    sourcing: {
      payments: (id: number) => pending(payments, id).promise,
      purchaseOrder: (id: number) => pending(orders, id).promise,
      suppliers: async () => [{ id: 8, name: 'Leverancier' }], freightRates: async () => [],
    },
    catalog: { productFamilies: async () => [], products: async () => [], categories: async () => [], stockLocations: async () => [] },
  });
  return { editor, toasts, payments: (id: number) => pending(payments, id), orders: (id: number) => pending(orders, id) };
}

test('offline: the order and its payments both fail; only the load-error card speaks, no payments toast', async () => {
  const state = setup();
  const opening = state.editor.load(50);
  state.payments(50).reject(new Error('Failed to fetch'));
  await settle();
  state.orders(50).reject(new Error('Failed to fetch'));
  await opening;
  await settle();
  assert.equal(state.editor.loadError(), 'Failed to fetch');
  assert.deepEqual(state.toasts, [], 'no second message with other advice than Opnieuw proberen');
});

test('the order stands but its payments failed: the toast comes once the order shows', async () => {
  const state = setup();
  const opening = state.editor.load(50);
  state.payments(50).reject(new Error('Serverfout'));
  await settle();
  assert.deepEqual(state.toasts, [], 'not while the order is still on its way');
  state.orders(50).resolve(order(50));
  await opening;
  await settle();
  assert.equal(state.editor.view().order.id, 50);
  assert.deepEqual(state.toasts, [['Serverfout', 'err']]);
});

test('a payments failure of a container already left says nothing on the next one', async () => {
  const state = setup();
  const first = state.editor.load(50);
  state.editor.id.set('51');
  const second = state.editor.load(51);
  state.payments(50).reject(new Error('PO 50 betalingen'));
  state.orders(50).resolve(order(50));
  state.payments(51).resolve([]);
  state.orders(51).resolve(order(51));
  await Promise.all([first, second]);
  await settle();
  assert.equal(state.editor.view().order.id, 51);
  assert.deepEqual(state.editor.payments(), []);
  assert.deepEqual(state.toasts, []);
});
