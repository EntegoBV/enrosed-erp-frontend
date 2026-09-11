import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal } from '@angular/core';

// Run the production route-selection method with controlled render boundaries.
// The full Angular browser fixture covers the actual tabs, inputs and focus target.
const source = await readFile(new URL('../src/app/features/purchasing/purchase-screen.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('purchase-screen.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'PurchaseScreen');
assert.ok(original);
const selected = ['openRequestedSection', 'focusRequestedSection', 'openedPaymentsFor', 'openedPaymentsId', 'openedPaymentsSection', 'pendingPaymentsFocus'];
const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && selected.includes(member.name.text));
assert.equal(members.length, selected.length);
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)),
  original.name, original.typeParameters, undefined, members);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness(kind: 'desk' | 'editor' | 'viewer', loaded = true) {
  const calls: unknown[] = [];
  const child = {
    view: signal(loaded ? { order: { id: 50 } } : null), railTab: signal('order'), workspaceSection: signal('purchase-overview'),
    jumpToSection: (...args: unknown[]) => calls.push(['step', ...args]),
  };
  const dom = { activeElement: null as any, termsReady: true };
  const elements = new Map<string, object>();
  const exports: Record<string, new () => any> = {};
  vm.runInNewContext(javascript, {
    exports, untracked: (callback: () => void) => callback(),
    document: { get activeElement() { return dom.activeElement; }, getElementById: (id: string) => {
      calls.push(['target', id]);
      if (id === 'purchase-advance-invoices' && !dom.termsReady) return null;
      if (!elements.has(id)) elements.set(id, { scrollIntoView: () => calls.push(['scroll']), focus: () => {
        calls.push(['focus']); dom.activeElement = elements.get(id);
      } });
      return elements.get(id);
    } },
  });
  const screen = new exports['PurchaseScreen']();
  Object.assign(screen, {
    id: signal('50'), section: signal<string | undefined>('payments'), injector: {},
    desk: signal(kind === 'desk' ? child : null), editor: signal(kind === 'editor' ? child : null),
    viewer: signal(kind === 'viewer' ? child : null),
  });
  return { screen, child, calls, dom, flush: () => screen.focusRequestedSection() };
}

for (const kind of ['desk', 'editor', 'viewer'] as const) {
  test(`${kind} waits for the requested purchase order and focuses financing after the selected content renders`, () => {
    const state = harness(kind, false);
    state.screen.openRequestedSection();
    assert.equal(state.screen.pendingPaymentsFocus, null, 'A loading order must not consume the deep link');
    state.child.view.set({ order: { id: 49 } });
    state.screen.openRequestedSection();
    assert.equal(state.screen.pendingPaymentsFocus, null, 'A stale previous order must not consume it either');
    state.child.view.set({ order: { id: 50 } });
    state.screen.openRequestedSection();
    if (kind === 'desk') assert.equal(state.child.railTab(), 'pay');
    if (kind === 'viewer') assert.equal(state.child.workspaceSection(), 'purchase-payments-section');
    if (kind === 'editor') assert.deepEqual(state.calls, [['step', 'purchase-payments-section', undefined, false]], 'Selecting the phone step must not schedule a competing scroll to the top');
    assert.ok(state.screen.pendingPaymentsFocus);
    assert.equal(state.calls.some(call => (call as string[])[0] === 'focus'), false, 'The target does not exist until rendering finishes');
    state.flush();
    assert.deepEqual(state.calls.slice(-3), [['target', 'purchase-advance-invoices'], ['scroll'], ['focus']]);
    state.screen.openRequestedSection();
    assert.equal(state.screen.pendingPaymentsFocus, null, 'Refreshing the order must not steal focus again');
  });
}

test('leaving or replacing the screen cancels its pending focus callback', () => {
  for (const leave of ['id', 'section', 'child']) {
    const state = harness('desk');
    state.screen.openRequestedSection();
    if (leave === 'id') state.screen.id.set('51');
    if (leave === 'section') state.screen.section.set(undefined);
    if (leave === 'child') state.screen.desk.set(null);
    state.flush();
    assert.equal(state.calls.length, 0, `No old target is focused after changing ${leave}`);
  }
});

test('removing and reopening the payments query allows an intentional second visit', () => {
  const state = harness('viewer');
  state.screen.openRequestedSection();
  state.flush();
  state.screen.section.set(undefined);
  state.screen.openRequestedSection();
  state.screen.section.set('payments');
  state.screen.openRequestedSection();
  assert.ok(state.screen.pendingPaymentsFocus);
});

test('a slow financing response first shows the payment area, then the actual invoice terms', () => {
  const state = harness('desk');
  state.dom.termsReady = false;
  state.screen.openRequestedSection();
  state.flush();
  assert.deepEqual(state.calls.slice(-3), [['target', 'purchase-partner-payments'], ['scroll'], ['focus']]);
  assert.ok(state.screen.pendingPaymentsFocus, 'Wait for the financing response rather than consuming the target early');
  state.dom.termsReady = true;
  state.flush();
  assert.deepEqual(state.calls.slice(-3), [['target', 'purchase-advance-invoices'], ['scroll'], ['focus']]);
  assert.equal(state.screen.pendingPaymentsFocus, null);
});

test('a late response cannot steal focus after the user leaves the waiting payment area', () => {
  const state = harness('desk');
  state.dom.termsReady = false;
  state.screen.openRequestedSection();
  state.flush();
  state.calls.length = 0;
  state.dom.activeElement = {};
  state.dom.termsReady = true;
  state.flush();
  assert.equal(state.calls.length, 0);
  assert.equal(state.screen.pendingPaymentsFocus, null);
});

for (const kind of ['desk', 'editor', 'viewer'] as const) {
  test(`${kind} opens the payment-result link at its own card, preserving the financing link`, () => {
    const state = harness(kind);
    state.screen.section.set('payment-result');
    state.screen.openRequestedSection();
    state.flush();
    assert.deepEqual(state.calls.slice(-3), [['target', 'purchase-payment-result'], ['scroll'], ['focus']]);
    assert.equal(state.screen.pendingPaymentsFocus, null);
    state.screen.section.set('payments');
    state.screen.openRequestedSection();
    state.flush();
    assert.deepEqual(state.calls.slice(-3), [['target', 'purchase-advance-invoices'], ['scroll'], ['focus']]);
  });
}
