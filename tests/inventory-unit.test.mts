import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import type { UnitName } from '../src/app/core/api/models.ts';
import type { ClosingArticle, CountLine } from '../src/app/core/api/inventory-models.ts';
import * as units from '../src/app/features/products/product-sales-unit.ts';

// inventory-unit.ts imports product-sales-unit without an extension, which node
// cannot resolve; run it through the TypeScript transpiler with the real unit
// helper, like product-family-shared-fields in product-sales-unit.test.mts.
const source = await readFile(new URL('../src/app/features/inventory/inventory-unit.ts', import.meta.url), 'utf8');
const loaded = { exports: {} as Record<string, any> };
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, {
  module: loaded, exports: loaded.exports,
  require: (id: string) => ({ '../products/product-sales-unit': units } as Record<string, unknown>)[id],
});
const inventoryUnit: typeof import('../src/app/features/inventory/inventory-unit.ts').inventoryUnit = loaded.exports['inventoryUnit'];

// The Dutch answer of GET /api/products/unit-names (backend unit-names.csv).
const NAMES: UnitName[] = [
  { key: 'stuk', one: 'stuk', other: 'stuks', per: 'per stuk', short: 'st.' },
  { key: 'bowl', one: 'bowl', other: 'bowls', per: 'per bowl', short: 'bowls' },
];

test('a display row counts in displays and knows what one display holds', () => {
  units.rememberUnitNames(NAMES);
  const unit = inventoryUnit({ unitKey: 'bowl', salesUnit: 'DISPLAY', piecesPerUnit: 6 });
  assert.equal(unit.isDisplay, true);
  assert.equal(unit.singular, 'display');
  assert.equal(unit.plural, 'displays');
  assert.equal(unit.piecesPerDisplay, 6);
  assert.equal(unit.piece.other, 'bowls');
});

test('a piece row reads in its own unit and is no display', () => {
  units.rememberUnitNames(NAMES);
  const stuk = inventoryUnit({ unitKey: 'stuk', salesUnit: 'PIECE', piecesPerUnit: null });
  assert.equal(stuk.singular, 'stuk');
  assert.equal(stuk.plural, 'stuks');
  assert.equal(stuk.isDisplay, false);
  assert.equal(stuk.piecesPerDisplay, null);
  const bowl = inventoryUnit({ unitKey: 'bowl', salesUnit: 'PIECE', piecesPerUnit: null });
  assert.equal(bowl.singular, 'bowl');
  assert.equal(bowl.isDisplay, false);
});

test('a piece row without a unit key reads as "stuk"', () => {
  units.rememberUnitNames(NAMES);
  const unit = inventoryUnit({ unitKey: null, salesUnit: 'PIECE', piecesPerUnit: null });
  assert.equal(unit.singular, 'stuk');
  assert.equal(unit.plural, 'stuks');
  assert.equal(unit.isDisplay, false);
});

test('a count line and a closing product both fit the adapter', () => {
  units.rememberUnitNames(NAMES);
  const line = { unitKey: 'bowl', salesUnit: 'DISPLAY', piecesPerUnit: 8, productName: 'Bowl rood' } as CountLine;
  const article = { unitKey: null, salesUnit: 'PIECE', piecesPerUnit: null, productName: 'Roos in stolp rood' } as ClosingArticle;
  assert.equal(inventoryUnit(line).piecesPerDisplay, 8);
  assert.equal(inventoryUnit(article).plural, 'stuks');
});
