import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sidebarGroupForUrl,
  toggleSidebarGroup,
} from '../src/app/core/platform/sidebar-navigation.ts';

test('the current ERP page opens the matching desktop menu section', () => {
  assert.equal(sidebarGroupForUrl('/sales/24/edit'), 'verkoop');
  assert.equal(sidebarGroupForUrl('/prospects/24?status=NEW'), 'verkoop');
  assert.equal(sidebarGroupForUrl('/klantlogins?open=12'), 'verkoop');
  assert.equal(sidebarGroupForUrl('/contactaanvragen?open=12'), 'verkoop');
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
  assert.equal(sidebarGroupForUrl('/douane'), 'inkoop', 'Douane has its own screen under Inkoop (2026-10-17)');
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

test('the document library stands outside every group (and no longer folds the sidebar)', () => {
  assert.equal(sidebarGroupForUrl('/files'), null);
  assert.equal(sidebarGroupForUrl('/files/photos?map=3'), null);
  assert.equal(sidebarGroupForUrl('/costs'), null);
});

test('the company group holds Logboek, the settings overview, the terms and Verwijderde items', () => {
  assert.equal(sidebarGroupForUrl('/settings/deleted-items'), 'bedrijf');
  assert.equal(sidebarGroupForUrl('/settings'), 'bedrijf');
  assert.equal(sidebarGroupForUrl('/voorwaarden'), 'bedrijf');
  assert.equal(sidebarGroupForUrl('/activity?wie=emre'), 'bedrijf');
});

test('Categorieën opens Producten & voorraad, and the device settings open no group', () => {
  assert.equal(sidebarGroupForUrl('/categories'), 'producten');
  assert.equal(sidebarGroupForUrl('/settings?sectie=notifications'), null);
  assert.equal(sidebarGroupForUrl('/settings?sectie=appearance'), null);
});
