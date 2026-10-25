import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal } from '@angular/core';

// Run PurchaseScreen.openRequestedApply (cost-fix Q3): ?apply=1, the product page's
// 'Opnieuw toepassen ›', opens the Kostprijzen toepassen sheet once and drops the param.
const source = await readFile(new URL('../src/app/features/purchasing/purchase-screen.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('purchase-screen.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'PurchaseScreen');
assert.ok(original);
const selected = ['openRequestedApply', 'openedApplyKey'];
const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && selected.includes(member.name.text));
assert.equal(members.length, selected.length);
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)),
  original.name, original.typeParameters, undefined, members);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness(kind: 'desk' | 'editor' | 'viewer', options: { mode?: 'view' | 'edit'; apply?: string; tab?: string } = {}) {
  const calls: unknown[][] = [];
  const child = {
    view: signal<{ order: { id: number } } | null>(null),
    apply: () => { calls.push(['apply']); return Promise.resolve(); },
  };
  const exports: Record<string, new () => any> = {};
  vm.runInNewContext(javascript, { exports, untracked: (callback: () => void) => callback() });
  const screen = new exports['PurchaseScreen']();
  Object.assign(screen, {
    id: signal('39'), apply: signal<string | undefined>('apply' in options ? options.apply : '1'), tab: signal<string | undefined>(options.tab),
    mode: signal(options.mode ?? (kind === 'editor' ? 'edit' : 'view')),
    desk: signal(kind === 'desk' ? child : null), editor: signal(kind === 'editor' ? child : null), viewer: signal(kind === 'viewer' ? child : null),
    // Values made inside the VM realm are cloned, so deepEqual compares plain data.
    router: { navigate: (commands: unknown[], extras: unknown) => { calls.push(['navigate', structuredClone(commands), structuredClone(extras)]); return Promise.resolve(true); } },
  });
  return { screen, child, calls, run: () => screen.openRequestedApply() };
}

test('the desk and the phone editor open the sheet once the order is in, then drop ?apply', () => {
  for (const [kind, mode, path] of [['desk', 'view', ['/purchasing', '39']], ['desk', 'edit', ['/purchasing', '39', 'edit']],
    ['editor', 'edit', ['/purchasing', '39', 'edit']]] as const) {
    const state = harness(kind, { mode });
    state.run();
    state.child.view.set({ order: { id: 38 } }); state.run();
    assert.deepEqual(state.calls, [], `${kind} waits for its own order`);
    state.child.view.set({ order: { id: 39 } }); state.run();
    assert.deepEqual(state.calls, [['apply'], ['navigate', path, { queryParams: { apply: null }, queryParamsHandling: 'merge', replaceUrl: true }]], kind);
    state.run();
    assert.equal(state.calls.length, 2, `${kind} opens once per link`);
  }
});

test('the phone read view hands the link to the editor, keeping the tab', () => {
  const state = harness('viewer', { tab: 'producten' });
  state.run(); state.run();
  assert.deepEqual(state.calls, [['navigate', ['/purchasing', '39', 'edit'], { queryParams: { apply: '1', tab: 'producten' }, replaceUrl: true }]]);
  const plain = harness('viewer');
  plain.run();
  assert.deepEqual(plain.calls, [['navigate', ['/purchasing', '39', 'edit'], { queryParams: { apply: '1', tab: null }, replaceUrl: true }]]);
});

test('without apply=1 nothing opens', () => {
  for (const apply of [undefined, '', '0', 'ja']) {
    const state = harness('desk', { apply: apply as string });
    state.child.view.set({ order: { id: 39 } });
    state.run();
    assert.deepEqual(state.calls, [], String(apply));
  }
});
