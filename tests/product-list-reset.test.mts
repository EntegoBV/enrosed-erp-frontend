import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal } from '@angular/core';

/**
 * "Filters wissen" on the product list: the production setQuery and
 * resetFilters, run with real signals and a hand-driven timer, so the
 * address bar (urlQuery) can never keep or regain a search the owner cleared.
 */
const source = await readFile(new URL('../src/app/features/products/product-list.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('product-list.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'ProductList');
assert.ok(original);
const names = new Set(['setQuery', 'resetFilters']);
const members = original.members.filter((member) => member.name && ts.isIdentifier(member.name) && names.has(member.name.text) && ts.isMethodDeclaration(member));
assert.equal(members.length, names.size, 'Every tested production member must still exist');
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter((modifier) => !ts.isDecorator(modifier)),
  original.name, original.typeParameters, undefined, members);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness() {
  const timers = new Map<number, () => void>();
  let next = 1;
  const exports: { ProductList?: new () => any } = {};
  vm.runInNewContext(javascript, {
    exports,
    setTimeout: (run: () => void) => { const id = next++; timers.set(id, run); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
  });
  const list = new exports.ProductList!();
  Object.assign(list, {
    query: signal(''), urlQuery: signal(''), queryTimer: null,
    categoryFilter: signal<number | 'none' | null>(4), statusFilter: signal('NEEDS_WORK'), sortKey: signal('NAME_DESC'),
  });
  const flush = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((run) => run()); };
  return { list, flush, pending: () => timers.size };
}

test('Filters wissen clears the search in the address bar at once', () => {
  const { list, flush } = harness();
  list.setQuery('bowl');
  flush();
  assert.equal(list.urlQuery(), 'bowl');
  list.resetFilters();
  assert.equal(list.query(), '');
  assert.equal(list.urlQuery(), '', 'the address bar no longer carries ?q=bowl');
  assert.equal(list.categoryFilter(), null);
  assert.equal(list.statusFilter(), 'ALL');
  assert.equal(list.sortKey(), 'STOCK_SMART');
});

test('a typing timer still running cannot put the cleared search back', () => {
  const { list, flush, pending } = harness();
  list.setQuery('bow');
  assert.equal(pending(), 1);
  list.resetFilters();
  assert.equal(pending(), 0, 'the pending write is cancelled');
  flush();
  assert.equal(list.query(), '');
  assert.equal(list.urlQuery(), '');
  assert.equal(list.queryTimer, null);
});
