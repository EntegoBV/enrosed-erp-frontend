import assert from 'node:assert/strict';
import test from 'node:test';
import type { Category, Product } from '../src/app/core/api/models.ts';
import {
  NO_PICKER_COLOUR,
  UNCATEGORISED_PICKER_CATEGORY,
  filterProductPicker,
  productPickerCategories,
  productPickerColours,
} from '../src/app/shared/product-picker-filters.ts';

const categories = [
  category(20, 'Foam', 20),
  category(10, 'Geconserveerde rozen', 10),
  category(30, 'Leeg', 5),
];
const standardColours = ['Rood', 'Roze', 'Wit'];
const colourSwatches = { Rood: '#A91F32', Roze: '#E59BB4', Wit: '#F4F1EC' };
const products = [
  product(1, 20, 'Foam Bear Red', 'Rood', '#a91f32'),
  product(2, 10, 'Single Rose White', 'Wit', null),
  product(3, 20, 'Foam Bear Ocean', 'Oceaan', '#123456'),
  product(4, null, 'Display zonder variant', null, null),
  product(5, 10, 'Single Rose Pink', 'Roze', null),
];

test('category chips show only used categories in configured Category.position order', () => {
  assert.deepEqual(productPickerCategories(products, categories), [
    { key: 10, name: 'Geconserveerde rozen', count: 2 },
    { key: 20, name: 'Foam', count: 2 },
    { key: UNCATEGORISED_PICKER_CATEGORY, name: 'Zonder categorie', count: 1 },
  ]);
});

test('colour chips follow the shared standard colour key and keep custom and empty colours reachable', () => {
  assert.deepEqual(productPickerColours(
    products, categories, null, standardColours, colourSwatches,
  ).map(({ key, name, count, hex }) =>
    ({ key, name, count, hex })), [
    { key: 'rood', name: 'Rood', count: 1, hex: '#a91f32' },
    { key: 'roze', name: 'Roze', count: 1, hex: '#E59BB4' },
    { key: 'wit', name: 'Wit', count: 1, hex: '#F4F1EC' },
    { key: 'oceaan', name: 'Oceaan', count: 1, hex: '#123456' },
    { key: NO_PICKER_COLOUR, name: 'Zonder kleur', count: 1, hex: null },
  ]);
});

test('category, colour and search combine without changing canonical purchase order', () => {
  const source = [products[4], products[1], products[0], products[2], products[3]];
  assert.deepEqual(filterProductPicker(source, categories, {
    query: 'geconserveerde',
    category: 10,
    colour: 'wit',
  }).map((item) => item.id), [2]);

  assert.deepEqual(filterProductPicker(source, categories, {
    query: '',
    category: 10,
    colour: null,
  }).map((item) => item.id), [5, 2]);
});

test('unknown category ids join the visible uncategorised choice', () => {
  const unknown = product(9, 999, 'Ongekoppeld', 'Rood', null);
  assert.deepEqual(productPickerCategories([...products, unknown], categories).at(-1), {
    key: UNCATEGORISED_PICKER_CATEGORY,
    name: 'Zonder categorie',
    count: 2,
  });
  assert.deepEqual(filterProductPicker([...products, unknown], categories, {
    query: '',
    category: UNCATEGORISED_PICKER_CATEGORY,
    colour: null,
  }).map((item) => item.id), [4, 9]);
  assert.deepEqual(filterProductPicker([...products, unknown], categories, {
    query: 'zonder categorie',
    category: null,
    colour: null,
  }).map((item) => item.id), [4, 9]);
});

test('optional supplier metadata participates in the shared picker search', () => {
  assert.deepEqual(filterProductPicker(products, categories, {
    query: 'Yunnan',
    category: null,
    colour: null,
    searchTextOf: (item) => item.id === 3 ? 'Yunnan Flowers' : 'Different supplier',
  }).map((item) => item.id), [3]);
});

function category(id: number, name: string, position: number): Category {
  return { id, name, position } as Category;
}

function product(
  id: number,
  categoryId: number | null,
  name: string,
  colour: string | null,
  colourHex: string | null,
): Product {
  return {
    id,
    categoryId,
    name,
    sku: `SKU-${id}`,
    colour,
    colourHex,
    variantSize: null,
    describedAs: name,
    barcodeInner: null,
    barcodeOuter: null,
  } as Product;
}
