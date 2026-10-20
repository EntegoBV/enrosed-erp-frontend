import assert from 'node:assert/strict';
import test from 'node:test';
import { navDirection, navInfoDirection } from '../src/app/core/platform/nav-direction.ts';
import { PHONE_TABS } from '../src/app/core/platform/phone-tabs.ts';

const dir = (prev: string | null, next: string, trigger: 'imperative' | 'popstate' | 'hashchange' = 'imperative', info?: unknown) =>
  navDirection(prev, next, trigger, info, PHONE_TABS);

test('the browser back button is always a pop', () => {
  assert.equal(dir('/sales/79', '/sales', 'popstate'), 'pop');
  assert.equal(dir('/sales', '/sales/79', 'popstate'), 'pop');
  assert.equal(dir('/sales', '/purchasing', 'popstate'), 'pop');
});

test('a navigation may name its own direction', () => {
  assert.equal(dir('/settings', '/settings?sectie=company', 'imperative', { nav: 'push' }), 'push');
  assert.equal(dir('/sales/79', '/sales', 'imperative', { nav: 'pop' }), 'pop');
  assert.equal(dir('/sales', '/sales/79', 'imperative', { nav: 'none' }), 'none');
  assert.equal(navInfoDirection({ nav: 'sideways' }), null);
  assert.equal(navInfoDirection('push'), null);
  assert.equal(navInfoDirection(null), null);
});

test('a query or fragment change stays put', () => {
  assert.equal(dir('/sales', '/sales?tab=facturen'), 'none');
  assert.equal(dir('/purchasing/62?sectie=betalingen', '/purchasing/62#nacalculatie'), 'none');
  assert.equal(dir('/sales/', '/sales'), 'none');
});

test('another tab fades instead of sliding', () => {
  assert.equal(dir('/dashboard', '/sales'), 'tab');
  assert.equal(dir('/sales/79', '/purchasing'), 'tab');
  assert.equal(dir('/products', '/more'), 'tab');
  /* a page of a tab's long-press menu is that tab's: opened from Meer it is a tab switch, and back to Meer too */
  assert.equal(dir('/more', '/customers'), 'tab');
  assert.equal(dir('/customers', '/more'), 'tab');
  assert.equal(dir('/more', '/stock/inventaris'), 'tab');
  assert.equal(dir('/customers', '/suppliers'), 'tab');
});

test('leaving a tab root goes deeper, returning to it goes up', () => {
  /* the long-press menu: Klanten from Verkoop is a push inside the tab, the tab itself takes you back up */
  assert.equal(dir('/sales', '/customers'), 'push');
  assert.equal(dir('/customers', '/sales'), 'pop');
  assert.equal(dir('/purchasing', '/suppliers'), 'push');
  assert.equal(dir('/products', '/stock/inventaris'), 'push');
  assert.equal(dir('/more', '/settings?sectie=company'), 'push');
  assert.equal(dir('/settings?sectie=discounts', '/more'), 'pop');
  assert.equal(dir('/products/57', '/products'), 'pop');
});

test('deeper pushes, shallower pops, equal depth stays', () => {
  assert.equal(dir('/sales', '/sales/79'), 'push');
  assert.equal(dir('/sales/79', '/sales/79/edit'), 'push');
  assert.equal(dir('/sales/79/edit', '/sales'), 'pop');
  assert.equal(dir('/more', '/costs/bank'), 'push');
  assert.equal(dir('/stock', '/stock/inventaris'), 'push');
  assert.equal(dir('/customers', '/tica'), 'none');
  assert.equal(dir('/stock/inventaris/telling/3', '/stock/inventaris'), 'pop');
  assert.equal(dir('/sales/79', '/sales/80'), 'none');
});

test('the first navigation has nothing to move from', () => {
  assert.equal(dir(null, '/dashboard'), 'none');
  assert.equal(dir(null, '/dashboard', 'imperative', { nav: 'push' }), 'push');
});
