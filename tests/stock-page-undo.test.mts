import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal } from '@angular/core';
import { undoAllowed } from '../src/app/features/products/stock-booking.ts';
import { knownValueSum } from '../src/app/features/products/product-figures.ts';

/**
 * Voorraad › Aantallen bewerken › Ongedaan maken: the production
 * undoQuantity and storeLevel, run against a stub API. Undo is an absolute
 * write, so it may only run while the server still holds the booked figure.
 */
const source = await readFile(new URL('../src/app/features/products/stock-page.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('stock-page.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'StockPage');
assert.ok(original);
const names = new Set(['undoQuantity', 'storeLevel']);
const members = original.members.filter((member) => member.name && ts.isIdentifier(member.name) && names.has(member.name.text) && ts.isMethodDeclaration(member));
assert.equal(members.length, names.size, 'Every tested production member must still exist');
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter((modifier) => !ts.isDecorator(modifier)),
  original.name, original.typeParameters, undefined, members);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness(server: { quantity: number; loosePieces?: number } | 'down') {
  const exports: { StockPage?: new () => any } = {};
  vm.runInNewContext(javascript, { exports, undoAllowed, messageOf: (_failure: unknown, fallback: string) => fallback });
  const page = new exports.StockPage!();
  const writes: { productId: number; quantity: number; locationId: number; reference: string }[] = [];
  const toasts: { message: string; type?: string }[] = [];
  Object.assign(page, {
    /* The page's own cache still says 6.012: it never saw the other device. */
    levels: signal([{ productId: 7, locationId: 1, quantity: 6012 }]),
    bookProductId: signal(null),
    loadMoves: async () => {},
    ui: { toast: (message: string, type?: string) => toasts.push({ message, type }) },
    catalog: {
      productStock: async () => {
        if (server === 'down') throw new Error('offline');
        return [{ locationId: 1, quantity: server.quantity, loosePieces: server.loosePieces, name: 'Zaltbommel' }, { locationId: 2, quantity: 8, name: 'Tica Brussel' }];
      },
      setStock: async (productId: number, quantity: number, locationId: number, reference: string) => {
        writes.push({ productId, quantity, locationId, reference });
      },
    },
  });
  return { page, writes, toasts };
}

test('undo books the old figure back with a clear reference while the booked one still stands', async () => {
  const { page, writes, toasts } = harness({ quantity: 6012 });
  await page.undoQuantity(7, 1, 6000, 6012);
  assert.deepEqual(writes, [{ productId: 7, quantity: 6000, locationId: 1, reference: 'Ongedaan gemaakt' }]);
  assert.equal(page.levels().find((level: { locationId: number }) => level.locationId === 1).quantity, 6000);
  assert.equal(toasts.at(-1)?.type, 'ok');
});

test('a change made elsewhere since the booking is never erased by the undo', async () => {
  const { page, writes, toasts } = harness({ quantity: 5990 });
  await page.undoQuantity(7, 1, 6000, 6012);
  assert.deepEqual(writes, [], 'no absolute write over the sale booked on another device');
  assert.deepEqual(toasts.at(-1), { message: 'Niet teruggezet: het aantal is intussen gewijzigd', type: 'err' });
  assert.equal(page.levels().find((level: { locationId: number }) => level.locationId === 1).quantity, 5990, 'the table shows the live figure');
});

test('without an answer from the server nothing is written', async () => {
  const { page, writes, toasts } = harness('down');
  await page.undoQuantity(7, 1, 6000, 6012);
  assert.deepEqual(writes, []);
  assert.deepEqual(toasts.at(-1), { message: 'Terugzetten mislukt', type: 'err' });
});

test('a group without any cost has no value (shown "—"), never "€ 0"', () => {
  assert.equal(knownValueSum([null, null]), null);
  assert.equal(knownValueSum([]), null);
  assert.equal(knownValueSum([null, 12.5, undefined, 0.1, 0.2]), 12.8);
  assert.equal(knownValueSum([0]), 0, 'a known zero stays a figure');
});


test('a loose stem sold after an inline count blocks undo even when complete displays are unchanged', async () => {
  const { page, writes, toasts } = harness({ quantity: 7, loosePieces: 10 });
  page.levels.set([{ productId: 7, locationId: 1, quantity: 7, loosePieces: 11, piecesPerUnit: 12 }]);
  await page.undoQuantity(7, 1, 8, 7, 11);
  assert.equal(writes.length, 0);
  assert.equal(toasts.at(-1)?.type, 'err');
  assert.equal(page.levels()[0].loosePieces, 10);
  assert.equal(page.levels()[0].piecesPerUnit, 12);
});

test('patching a complete-unit count preserves its physical loose contents and unit factor', () => {
  const { page } = harness({ quantity: 7, loosePieces: 11 });
  page.levels.set([{ productId: 7, locationId: 1, quantity: 7, loosePieces: 11, piecesPerUnit: 12 }]);
  page.storeLevel(7, 1, 8);
  assert.equal(page.levels()[0].quantity, 8);
  assert.equal(page.levels()[0].loosePieces, 11);
  assert.equal(page.levels()[0].piecesPerUnit, 12);
});
