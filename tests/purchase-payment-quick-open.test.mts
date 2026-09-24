import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal } from '@angular/core';

// Run the production quick-pay members of PurchaseScreen: ?section=pay opens the
// payment sheet once the payments are in, and the phone editor returns to the view.
const source = await readFile(new URL('../src/app/features/purchasing/purchase-screen.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('purchase-screen.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'PurchaseScreen');
assert.ok(original);
const selected = ['openRequestedPayment', 'returnFromPayment', 'openedPaymentKey', 'returnAfterPayment', 'paymentPayees', 'paymentDues'];
const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && selected.includes(member.name.text));
assert.equal(members.length, selected.length);
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)),
  original.name, original.typeParameters, undefined, members);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness(kind: 'desk' | 'editor' | 'viewer', options: { payee?: string; due?: string; mode?: 'view' | 'edit'; blocked?: boolean } = {}) {
  const calls: unknown[][] = [];
  const child = {
    view: signal<{ order: { id: number } } | null>({ order: { id: 50 } }), payments: signal<unknown[] | null>([]),
    paymentStateLoading: signal(false), paymentStateError: signal<string | null>(null),
    paying: signal<object | null>(null), payingBusy: signal(false), mainView: signal('products'),
    plannedInstalments: () => [{ due: 'ORDERED', label: '30% bij bestelling', amount: 300 }, { due: 'SHIPPED', label: '70% bij vertrek', amount: 700 }],
    openPayment: (...args: unknown[]) => {
      calls.push(['open', ...args]);
      if (!options.blocked) child.paying.set({ payee: args[2] });
    },
    jumpToSection: (...args: unknown[]) => calls.push(['step', ...args]),
  };
  const exports: Record<string, new () => any> = {};
  vm.runInNewContext(javascript, { exports, untracked: (callback: () => void) => callback() });
  const screen = new exports['PurchaseScreen']();
  Object.assign(screen, {
    id: signal('50'), section: signal<string | undefined>('pay'), payee: signal<string | undefined>(options.payee ?? 'SUPPLIER'),
    due: signal<string | undefined>(options.due), mode: signal(options.mode ?? (kind === 'editor' ? 'edit' : 'view')),
    desk: signal(kind === 'desk' ? child : null), editor: signal(kind === 'editor' ? child : null),
    viewer: signal(kind === 'viewer' ? child : null),
    // Values made inside the VM realm are cloned, so deepEqual compares plain data.
    router: { navigate: (commands: unknown[], extras: unknown) => { calls.push(['navigate', structuredClone(commands), structuredClone(extras)]); return Promise.resolve(true); } },
  });
  return { screen, child, calls, run: () => { screen.openRequestedPayment(); screen.returnFromPayment(); } };
}

test('the sheet waits for the requested order and for loaded, current payments', () => {
  for (const kind of ['desk', 'editor'] as const) {
    const state = harness(kind, { due: 'SHIPPED' });
    state.child.view.set(null); state.run();
    state.child.view.set({ order: { id: 49 } }); state.run();
    state.child.view.set({ order: { id: 50 } }); state.child.payments.set(null); state.run();
    state.child.payments.set([]); state.child.paymentStateLoading.set(true); state.run();
    state.child.paymentStateLoading.set(false); state.child.paymentStateError.set('Niet actueel'); state.run();
    assert.equal(state.calls.length, 0, `${kind} must not open on stale or missing payments`);
    state.child.paymentStateError.set(null); state.run();
    assert.equal(state.calls.filter(call => call[0] === 'open').length, 1, kind);
    state.run();
    assert.equal(state.calls.filter(call => call[0] === 'open').length, 1, `${kind} opens once per link`);
  }
});

test('the desk switches to the payments, opens the sheet for the term and clears the link', () => {
  const view = harness('desk', { due: 'SHIPPED' });
  view.run();
  assert.equal(view.child.mainView(), 'payments');
  assert.deepEqual(view.calls[0], ['open', 700, '70% bij vertrek', 'SUPPLIER', 'SHIPPED']);
  assert.deepEqual(view.calls[1], ['navigate', ['/purchasing', '50'], { replaceUrl: true }]);
  const edit = harness('desk', { mode: 'edit' });
  edit.run();
  assert.deepEqual(edit.calls[0], ['open', undefined, undefined, 'SUPPLIER', null]);
  assert.deepEqual(edit.calls[1], ['navigate', ['/purchasing', '50', 'edit'], { replaceUrl: true }]);
});

test('the phone editor opens on step 4 and returns to the view once the sheet closes', () => {
  const state = harness('editor', { payee: 'LOGISTICS' });
  state.run();
  assert.deepEqual(state.calls.slice(0, 2), [['step', 'purchase-payments-section', undefined, false], ['open', undefined, undefined, 'LOGISTICS', null]]);
  state.run();
  assert.equal(state.calls.some(call => call[0] === 'navigate'), false, 'Still recording');
  state.child.payingBusy.set(true); state.child.paying.set(null); state.run();
  assert.equal(state.calls.some(call => call[0] === 'navigate'), false, 'Still saving');
  state.child.payingBusy.set(false); state.run();
  assert.deepEqual(state.calls.at(-1), ['navigate', ['/purchasing', '50'], { queryParams: { section: 'ledger' }, replaceUrl: true }]);
  state.run();
  assert.equal(state.calls.filter(call => call[0] === 'navigate').length, 1, 'Returns once');
});

test('a sheet that never opened keeps the editor where it is', () => {
  const state = harness('editor', { blocked: true });
  state.run(); state.run();
  assert.equal(state.calls.filter(call => call[0] === 'open').length, 1);
  assert.equal(state.calls.some(call => call[0] === 'navigate'), false);
  assert.equal(state.screen.returnAfterPayment, null, 'Nothing waits to return');
  state.child.paying.set({ payee: 'SUPPLIER' }); state.run();
  state.child.paying.set(null); state.run();
  assert.equal(state.calls.some(call => call[0] === 'navigate'), false, 'A later sheet in the editor never navigates away');
});

test('an unknown payee means the ledger, and a term only counts for the supplier', () => {
  const unknown = harness('editor', { payee: 'FORWARDER' });
  unknown.run(); unknown.run();
  assert.deepEqual(unknown.calls, [['navigate', ['/purchasing', '50', 'edit'], { queryParams: { section: 'ledger' }, replaceUrl: true }]]);
  const other = harness('desk', { payee: 'SEPARATE', due: 'SHIPPED' });
  other.run();
  assert.deepEqual(other.calls[0], ['open', undefined, undefined, 'SEPARATE', null]);
  const wrongDue = harness('desk', { due: 'LATER' });
  wrongDue.run();
  assert.deepEqual(wrongDue.calls[0], ['open', undefined, undefined, 'SUPPLIER', null]);
});

test('the read view only knows the ledger and rewrites the link once', () => {
  const state = harness('viewer', { due: 'ORDERED' });
  state.run(); state.run();
  assert.deepEqual(state.calls, [['navigate', ['/purchasing', '50'], { queryParams: { section: 'ledger' }, replaceUrl: true }]]);
});

test('another order or another section resets the link, so it can open again', () => {
  const state = harness('desk');
  state.run();
  state.screen.section.set('ledger'); state.run();
  assert.equal(state.screen.openedPaymentKey, '');
  state.screen.section.set('pay'); state.run();
  assert.equal(state.calls.filter(call => call[0] === 'open').length, 2);
  const editor = harness('editor');
  editor.run();
  assert.ok(editor.screen.returnAfterPayment);
  editor.screen.id.set('51'); editor.run();
  assert.equal(editor.screen.returnAfterPayment, null, 'A different order drops the pending return');
  assert.equal(editor.calls.some(call => call[0] === 'navigate'), false);
});
