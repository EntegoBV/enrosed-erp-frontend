import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal } from '@angular/core';
import { locationSplit } from '../src/app/features/products/product-figures.ts';

/**
 * Voorraad on the phone: a row's first meta line keeps "4 kleuren" (or the
 * SKU / kleur line), the second line carries where the stock lies and its
 * value. The production phoneFigures runs with real signals.
 */
const source = await readFile(new URL('../src/app/features/products/stock-page.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('stock-page.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'StockPage');
assert.ok(original);
const members = original.members.filter((member) => member.name && ts.isIdentifier(member.name) && member.name.text === 'phoneFigures' && ts.isMethodDeclaration(member));
assert.equal(members.length, 1);
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter((modifier) => !ts.isDecorator(modifier)),
  original.name, original.typeParameters, undefined, members);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function page(view: number | null) {
  const exports: { StockPage?: new () => any } = {};
  vm.runInNewContext(javascript, { exports, locationSplit });
  const stock = new exports.StockPage!();
  Object.assign(stock, {
    view: signal(view),
    activeLocations: signal([{ id: 1, name: 'Zaltbommel' }, { id: 2, name: 'Tica Brussel' }, { id: 3, name: 'Beurs' }]),
  });
  return stock;
}

const euro = (value: number) => value.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

test('the second line names each location that holds stock, then the value', () => {
  const figures = page(null).phoneFigures(new Map([[1, 10360], [2, 8], [3, 0]]), 10472);
  assert.deepEqual([...figures], ['Zaltbommel 10.360', 'Tica Brussel 8', euro(10472)]);
});

test('one location holding stock, or a chosen segment: only the value', () => {
  assert.deepEqual([...page(null).phoneFigures(new Map([[1, 640]]), 1152)], [euro(1152)]);
  assert.deepEqual([...page(2).phoneFigures(new Map([[1, 10360], [2, 8]]), 10472)], [euro(10472)]);
});

test('nothing to say: no second line', () => {
  assert.equal(page(null).phoneFigures(new Map([[1, 640]]), null), null);
});

test('a series head keeps "{n} kleuren", its colour dots and the fold chevron; rows keep the move circle', () => {
  assert.match(source, /<span class="skp-meta skp-meta--fold">\s*<span>\{\{ group\.colours\.length > 1 \? group\.colours\.length \+ ' kleuren'/);
  assert.match(source, /<span class="skp-dots" aria-hidden="true">/);
  assert.match(source, /<app-icon class="skp-chev" name="chevron-down"/);
  assert.match(source, /@if \(!editing\(\) && activeLocations\(\)\.length > 1\) \{\s*<button class="skp-move" type="button" title="Verplaatsen"/);
  assert.match(source, /\(click\)="\$event\.stopPropagation\(\); openBooking\(row, 'TRANSFER', view\(\)\)"/);
  assert.doesNotMatch(source, /phoneMeta\(/, 'the split never replaces the first meta line again');
});
