import assert from 'node:assert/strict';
import test from 'node:test';
import type { Category, LandedCostLine, Product } from '../src/app/core/api/models.ts';
import { COLOUR_SWATCHES, STANDARD_COLOURS } from '../src/app/core/api/geo.ts';
import {
  PURCHASE_NO_COLOUR,
  purchaseColourOptions,
  purchaseLineSections,
} from '../src/app/features/purchasing/purchase-line-display.ts';

const categories = [
  category(2, 'Foam', 1),
  category(1, 'Stolpen', 0),
];
const products = [
  product(1, 'Foam roos blauw', 2, 'Foam roos', 'Blauw', 0),
  product(2, 'Stolp wit', 1, 'Stolp', 'Wit', 0),
  product(3, 'Foam roos rood', 2, 'Foam roos', 'Rood', 1),
  product(4, 'Stolp zonder kleur', 1, 'Stolp', null, 1),
];
const lines = [line(1), line(2), line(4), line(3)];

test('purchase view groups by configured category and orders variants by canonical position', () => {
  const sections = purchaseLineSections(lines, products, categories, null, STANDARD_COLOURS);

  assert.deepEqual(sections.map((section) => section.name), ['Stolpen', 'Foam']);
  assert.deepEqual(sections[0].entries.map((entry) => entry.line.productId), [2, 4]);
  assert.deepEqual(sections[1].entries.map((entry) => entry.line.productId), [1, 3]);
  assert.deepEqual(sections.flatMap((section) => section.entries.map((entry) => entry.displayIndex)), [1, 2, 3, 4]);
});

test('purchase view filters one colour without losing its category heading', () => {
  const sections = purchaseLineSections(lines, products, categories, 'blauw', STANDARD_COLOURS);

  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, 'Foam');
  assert.deepEqual(sections[0].entries.map((entry) => entry.line.productId), [1]);
});

test('colour choices follow the product colour key and keep products without colour last', () => {
  const options = purchaseColourOptions(lines, products, STANDARD_COLOURS, COLOUR_SWATCHES);

  assert.deepEqual(options.map((option) => option.label), ['Rood', 'Wit', 'Blauw', 'Zonder kleur']);
  assert.equal(options.at(-1)?.key, PURCHASE_NO_COLOUR);
  assert.equal(options.find((option) => option.label === 'Rood')?.hex, '#A91F32');
});

function category(id: number, name: string, position: number): Category {
  return { id, name, position } as Category;
}

function product(
  id: number,
  name: string,
  categoryId: number,
  familyKey: string,
  colour: string | null,
  variantPosition: number,
): Product {
  return {
    id,
    name,
    categoryId,
    familyKey,
    familyId: categoryId,
    colour,
    colourHex: null,
    variantPosition,
    variantSize: null,
    sku: `${id}`,
  } as Product;
}

function line(productId: number): LandedCostLine {
  return { productId, productName: products.find((item) => item.id === productId)?.name ?? '' } as LandedCostLine;
}
