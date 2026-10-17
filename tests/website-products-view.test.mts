import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductViewRow } from '../src/app/features/website-builder/website-products-view.ts';
import {
  defaultProductFilter,
  filterCounts,
  parseProductFilter,
  productGroups,
  productStatusLine,
  searchText,
} from '../src/app/features/website-builder/website-products-view.ts';

function row(key: string, patch: Partial<ProductViewRow> = {}): ProductViewRow {
  const name = patch.name ?? key;
  return { id: Number(key.replace(/\D/g, '')) || null, key, name, status: 'PUBLISHED', active: true, reason: null, points: 0,
    bestseller: false, categoryId: 1, categoryName: 'Display', categoryPosition: 1, productPosition: 1,
    search: searchText(name, patch.categoryName ?? 'Display'), ...patch };
}

const rows = [
  row('r1', { name: 'TEST PRODUCT', status: 'DRAFT', reason: 'issues', points: 8, categoryId: null, categoryName: null, categoryPosition: 99 }),
  row('r2', { name: 'Heart Flowerbox', status: 'DRAFT', reason: 'issues', points: 3, categoryId: 3, categoryName: 'Boxes', categoryPosition: 3 }),
  row('r3', { name: 'Foam Bear', status: 'DRAFT', reason: 'ready', categoryId: 4, categoryName: 'Foam', categoryPosition: 4 }),
  row('r4', { name: 'Glass Bowl Rose XL', bestseller: true, productPosition: 9 }),
  row('r5', { name: 'Diamond Display', productPosition: 1 }),
  row('r6', { name: 'Domes Gold', categoryId: 2, categoryName: 'Domes', categoryPosition: 2 }),
  row('r7', { name: 'Verborgen reeks', status: 'READY', categoryId: 2, categoryName: 'Domes', categoryPosition: 2 }),
];

test('the address filter is read strictly; the default is Aandacht when anything needs it', () => {
  assert.equal(parseProductFilter('Live'), 'live');
  assert.equal(parseProductFilter('nope'), null);
  assert.equal(parseProductFilter(null), null);
  assert.equal(defaultProductFilter(8), 'aandacht');
  assert.equal(defaultProductFilter(0), 'alles');
});

test('chip counts follow the status, Aandacht the reasons', () => {
  assert.deepEqual(filterCounts(rows, new Map()), { aandacht: 3, alles: 7, live: 3, concept: 3, verborgen: 1 });
});

test('Aandacht groups per reason, most points first', () => {
  const groups = productGroups(rows, 'aandacht', '');
  assert.deepEqual(groups.map((group) => [group.label, group.rows.map((item) => item.name)]), [
    ['Nog niet publicatieklaar', ['TEST PRODUCT', 'Heart Flowerbox']],
    ['Klaar om live te zetten', ['Foam Bear']],
  ]);
});

test('a reeks fixed after the load keeps its place until the next load', () => {
  const fixed = rows.map((item) => item.key === 'r3' ? { ...item, reason: null, status: 'PUBLISHED' as const } : item);
  const kept = new Map([['r1', 'issues' as const], ['r2', 'issues' as const], ['r3', 'ready' as const]]);
  assert.deepEqual(productGroups(fixed, 'aandacht', '', kept).map((group) => group.rows.length), [2, 1]);
  assert.equal(filterCounts(fixed, kept).aandacht, 3);
  assert.equal(productGroups(fixed, 'aandacht', '').length, 1, 'without the kept reasons it would jump away');
});

test('other filters group per category in category order, bestsellers first, Zonder categorie last', () => {
  const groups = productGroups(rows, 'alles', '');
  assert.deepEqual(groups.map((group) => group.label), ['Display', 'Domes', 'Boxes', 'Foam', 'Zonder categorie']);
  assert.deepEqual(groups[0].rows.map((item) => item.name), ['Glass Bowl Rose XL', 'Diamond Display']);
  assert.deepEqual(productGroups(rows, 'verborgen', '').map((group) => group.rows.map((item) => item.key)), [['r7']]);
});

test('search matches name and category without accents or case', () => {
  assert.deepEqual(productGroups(rows, 'alles', 'DÔMES').flatMap((group) => group.rows.map((item) => item.key)), ['r6', 'r7']);
});

test('the status line says why', () => {
  assert.equal(productStatusLine({ status: 'DRAFT', active: true, reason: 'issues', points: 8 }, 'Concept'), 'Concept · 8 publicatiepunten');
  assert.equal(productStatusLine({ status: 'DRAFT', active: true, reason: 'issues', points: 1 }, 'Concept'), 'Concept · 1 publicatiepunt');
  assert.equal(productStatusLine({ status: 'DRAFT', active: true, reason: 'ready', points: 0 }, 'Concept'), 'Concept · klaar om live te zetten');
  assert.equal(productStatusLine({ status: 'PUBLISHED', active: true, reason: null, points: 0 }, 'Live'), 'Live · compleet');
  assert.equal(productStatusLine({ status: 'PUBLISHED', active: false, reason: 'inactive-live', points: 0 }, 'Niet actief in ERP'), 'Live · niet actief in ERP');
});
