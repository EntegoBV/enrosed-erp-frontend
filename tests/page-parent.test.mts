import assert from 'node:assert/strict';
import test from 'node:test';
import { parentOf, urlPath } from '../src/app/core/platform/page-parent.ts';

test('detail screens name the screen above them', () => {
  const table: Array<[string, string, string, string?]> = [
    ['/sales/79', 'Verkoop', '/sales'],
    ['/sales/79/edit', 'Verkoop', '/sales'],
    ['/sales/79/edit?stap=2', 'Verkoop', '/sales'],
    ['/prospects/24', 'Prospects', '/prospects'],
    ['/purchasing/62', 'Inkoop', '/purchasing'],
    ['/purchasing/62/edit', 'Inkoop', '/purchasing'],
    ['/products/new', 'Producten', '/products'],
    ['/products/57', 'Producten', '/products'],
    ['/products/57/edit?tab=media', 'Product', '/products/57'],
    ['/products/57/translations', 'Product', '/products/57'],
    ['/stock/inventaris/telling/3', 'Jaarinventaris', '/stock/inventaris'],
    ['/stock/inventaris/afsluiting/2026', 'Jaarinventaris', '/stock/inventaris'],
    ['/dashboard/agenda', 'Dashboard', '/dashboard', 'Vandaag'],
    ['/dashboard/open', 'Dashboard', '/dashboard', 'Vandaag'],
    ['/settings/deleted-items', 'Instellingen', '/settings'],
    ['/catalog/texts', 'Catalogus PDF', '/catalog-export'],
  ];
  for (const [url, label, parentUrl, phoneLabel] of table) {
    const parent = parentOf(url);
    assert.ok(parent, url);
    assert.equal(parent.label, label, url);
    assert.equal(parent.url, parentUrl, url);
    assert.equal(parent.phoneLabel, phoneLabel ?? label, url);
  }
});

test('root screens have no crumb', () => {
  for (const url of [
    '/dashboard', '/sales', '/sales?tab=facturen', '/purchasing', '/products', '/more', '/customers', '/suppliers',
    '/stock', '/stock/inventaris', '/stock-locations', '/barcodes', '/categories', '/catalog-export', '/settings',
    '/settings?sectie=company', '/activity', '/analyses/cash', '/revisions', '/klantlogins', '/prospects', '/costs',
    '/files', '/website/layout', '/voorwaarden', '/nope',
  ]) {
    assert.equal(parentOf(url), null, url);
  }
});

test('the path ignores query, fragment and a trailing slash', () => {
  assert.equal(urlPath('/sales/79/?a=1#x'), '/sales/79');
  assert.equal(urlPath('/'), '/');
  assert.deepEqual(parentOf('/purchasing/62/'), parentOf('/purchasing/62'));
});
