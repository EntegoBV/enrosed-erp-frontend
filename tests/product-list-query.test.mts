import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LIST_STATE, SORT_OPTIONS, headerAriaSort, listQueryParams, listQueryString, nextHeaderSort, readListQuery, sortButtonLabel,
  type ListState,
} from '../src/app/features/products/product-list-query.ts';

test('the defaults leave a plain address', () => {
  assert.deepEqual(readListQuery({}), DEFAULT_LIST_STATE);
  assert.deepEqual(listQueryParams({ ...DEFAULT_LIST_STATE }), {});
  assert.equal(listQueryString({ ...DEFAULT_LIST_STATE }), '');
});

test('a state survives the round trip', () => {
  const states: ListState[] = [
    { q: 'bowl rood', category: 4, status: 'NEEDS_WORK', sort: 'NAME_DESC', open: ['f12', 'p33'] },
    { q: '', category: 'none', status: 'INACTIVE', sort: 'COST_ASC', open: [] },
    { q: 'É&?=', category: null, status: 'ORDER_APP', sort: 'STOCK_DESC', open: ['f1'] },
  ];
  for (const state of states) {
    assert.deepEqual(readListQuery(listQueryParams(state)), state);
    const string = listQueryString(state);
    const parsed = Object.fromEntries(new URLSearchParams(string.slice(1)));
    assert.deepEqual(readListQuery(parsed), state, string);
  }
  assert.equal(listQueryString(states[0]), '?q=bowl%20rood&categorie=4&status=aandacht&volgorde=naam-za&open=f12,p33');
});

test('every order has its word and comes back', () => {
  for (const option of SORT_OPTIONS) {
    const state = { ...DEFAULT_LIST_STATE, sort: option.key };
    assert.equal(readListQuery(listQueryParams(state)).sort, option.key);
  }
  assert.equal(SORT_OPTIONS.length, 10);
  assert.equal(SORT_OPTIONS[0].label, 'Standaardvolgorde (voorraad eerst)');
  assert.equal(sortButtonLabel('STOCK_SMART'), 'Standaardvolgorde');
  assert.equal(sortButtonLabel('STOCK_DESC'), 'Voorraad hoog → laag');
});

test('unknown values are ignored', () => {
  assert.deepEqual(readListQuery({ volgorde: 'random', status: 'live', categorie: '-3', open: 'x1,f2,,p 3,f2' }),
    { ...DEFAULT_LIST_STATE, open: ['f2'] });
  assert.equal(readListQuery({ categorie: '0' }).category, null);
  assert.equal(readListQuery({ categorie: 'abc' }).category, null);
  assert.equal(readListQuery({ q: ['eerste', 'tweede'] }).q, 'eerste');
  assert.equal(readListQuery({ q: null }).q, '');
});

test('a header cycles its order, then back to the standard order', () => {
  assert.equal(nextHeaderSort('stock', 'STOCK_SMART'), 'STOCK_DESC');
  assert.equal(nextHeaderSort('stock', 'STOCK_DESC'), 'STOCK_ASC');
  assert.equal(nextHeaderSort('stock', 'STOCK_ASC'), 'STOCK_SMART');
  assert.equal(nextHeaderSort('name', 'PRICE_ASC'), 'NAME_ASC');
  assert.equal(nextHeaderSort('name', 'NAME_ASC'), 'NAME_DESC');
  assert.equal(nextHeaderSort('price', 'PRICE_DESC'), 'PRICE_ASC');
  assert.equal(nextHeaderSort('cost', 'COST_ASC'), 'STOCK_SMART');
  assert.equal(headerAriaSort('name', 'NAME_ASC'), 'ascending');
  assert.equal(headerAriaSort('stock', 'STOCK_DESC'), 'descending');
  assert.equal(headerAriaSort('stock', 'STOCK_SMART'), null);
  assert.equal(headerAriaSort('price', 'COST_DESC'), null);
});
