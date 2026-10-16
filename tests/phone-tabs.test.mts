import assert from 'node:assert/strict';
import test from 'node:test';
import { isPhoneTabRoot, phoneTabForUrl } from '../src/app/core/platform/phone-tabs.ts';

test('the four work tabs light on their own screens', () => {
  const table: Array<[string, string]> = [
    ['/dashboard', 'home'],
    ['/dashboard/agenda', 'home'],
    ['/dashboard/open?filter=sales', 'home'],
    ['/sales', 'sales'],
    ['/sales?tab=facturen&scope=PARTNER', 'sales'],
    ['/sales/79', 'sales'],
    ['/sales/79/edit', 'sales'],
    ['/purchasing', 'purchasing'],
    ['/purchasing/62/edit', 'purchasing'],
    ['/products', 'products'],
    ['/products/57/edit?tab=media', 'products'],
    ['/products/new', 'products'],
    ['/catalog-export', 'products'],
    ['/catalog/texts', 'products'],
  ];
  for (const [url, tab] of table) assert.equal(phoneTabForUrl(url), tab, url);
});

test('screens reached from Meer light Meer, so the tab agrees with "‹ Meer"', () => {
  for (const url of [
    '/more', '/revisions', '/stock', '/stock?locatie=2', '/stock/inventaris', '/stock/inventaris/telling/3',
    '/stock-locations', '/barcodes', '/categories', '/prospects', '/prospects/4', '/customers', '/klantlogins',
    '/contactaanvragen', '/suppliers', '/countries', '/costs', '/files', '/voorwaarden', '/settings',
    '/settings?sectie=company', '/settings/deleted-items', '/activity', '/analyses/cash', '/website', '/nope',
  ]) {
    assert.equal(phoneTabForUrl(url), 'more', url);
  }
});

test('a longer sibling path never borrows a tab', () => {
  assert.equal(phoneTabForUrl('/salesforce'), 'more');
  assert.equal(phoneTabForUrl('/products-old'), 'more');
  assert.equal(phoneTabForUrl('/dashboards'), 'more');
});

test('only the five tab roots themselves count as roots', () => {
  for (const url of ['/dashboard', '/sales', '/sales?tab=facturen', '/purchasing', '/products', '/more', '/sales/'])
    assert.equal(isPhoneTabRoot(url), true, url);
  for (const url of ['/sales/79', '/dashboard/agenda', '/customers', '/stock', '/'])
    assert.equal(isPhoneTabRoot(url), false, url);
});
