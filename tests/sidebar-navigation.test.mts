import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sidebarGroupForUrl,
  sidebarRailForUrl,
  toggleSidebarGroup,
} from '../src/app/core/platform/sidebar-navigation.ts';

test('the current ERP page opens the matching desktop menu section', () => {
  assert.equal(sidebarGroupForUrl('/sales/24/edit'), 'verkoop');
  assert.equal(sidebarGroupForUrl('/purchasing/46/edit'), 'inkoop');
  assert.equal(sidebarGroupForUrl('/products/57/edit?tab=media'), 'producten');
  assert.equal(sidebarGroupForUrl('/stock-locations'), 'producten');
  assert.equal(sidebarGroupForUrl('/barcodes'), 'producten');
  assert.equal(sidebarGroupForUrl('/catalog/texts'), 'producten');
  assert.equal(sidebarGroupForUrl('/analyses/market'), 'analyses');
  assert.equal(sidebarGroupForUrl('/activity'), 'bedrijf');
});

test('settings pages stay with the workflow they configure', () => {
  assert.equal(sidebarGroupForUrl('/settings?sectie=discounts'), 'verkoop');
  assert.equal(sidebarGroupForUrl('/settings?sectie=duties'), 'inkoop');
  assert.equal(sidebarGroupForUrl('/settings?sectie=categories'), 'producten');
  assert.equal(sidebarGroupForUrl('/settings?sectie=catalog-data'), 'producten');
  assert.equal(sidebarGroupForUrl('/settings?sectie=company'), 'bedrijf');
});

test('dashboard and standalone workspaces start with every section folded', () => {
  assert.equal(sidebarGroupForUrl('/dashboard'), null);
  assert.equal(sidebarGroupForUrl('/website'), null);
  assert.equal(sidebarGroupForUrl('/more'), null);
});

test('opening another section closes the previous section', () => {
  assert.equal(toggleSidebarGroup('verkoop', 'inkoop'), 'inkoop');
  assert.equal(toggleSidebarGroup('inkoop', 'inkoop'), null);
  assert.equal(toggleSidebarGroup(null, 'producten'), 'producten');
});

test('the document library stands outside every group and folds the desktop sidebar', () => {
  assert.equal(sidebarGroupForUrl('/files'), null);
  assert.equal(sidebarGroupForUrl('/files/photos?map=3'), null);
  assert.equal(sidebarRailForUrl('/files'), true);
  assert.equal(sidebarRailForUrl('/files/photos?map=3#top'), true);
  assert.equal(sidebarRailForUrl('/filesystem'), false);
  assert.equal(sidebarRailForUrl('/products'), false);
});
