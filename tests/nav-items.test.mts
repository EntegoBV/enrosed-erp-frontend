import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NAV_DEVICE, NAV_GROUPS, NAV_HOME, NAV_WORKSPACES, allNavUrls, groupCountKeys, meerItems, meerLabel,
  navItemActive, navItemIsNew, navItemUrl, shortLabel,
} from '../src/app/core/platform/nav-items.ts';

test('every link of the sidebar and Meer before the redesign is still there', () => {
  const urls = allNavUrls();
  for (const url of [
    '/dashboard', '/sales', '/revisions', '/customers', '/klantlogins', '/prospects', '/contactaanvragen', '/countries',
    '/settings?sectie=discounts', '/purchasing', '/suppliers', '/settings?sectie=duties', '/products', '/stock',
    '/stock/inventaris', '/stock-locations', '/barcodes', '/categories', '/settings?sectie=catalog-data',
    '/catalog-export', '/analyses/cash', '/analyses/overview', '/analyses/sales', '/analyses/inventory',
    '/analyses/purchasing', '/analyses/result', '/analyses/market', '/analyses/website', '/activity',
    '/settings?sectie=company', '/voorwaarden', '/files', '/costs', '/website', '/settings?sectie=notifications',
  ]) {
    assert.ok(urls.includes(url), url);
  }
  assert.ok(urls.includes('/settings/deleted-items'), 'Verwijderde items is in the navigation');
  assert.equal(new Set(urls).size, urls.length, 'no link twice');
});

test('one icon per screen within a group, and ids are unique', () => {
  for (const group of NAV_GROUPS) {
    const icons = group.items.map((item) => item.icon);
    assert.equal(new Set(icons).size, icons.length, group.id);
  }
  const ids = [NAV_HOME, ...NAV_GROUPS.flatMap((g) => g.items), ...NAV_WORKSPACES, ...NAV_DEVICE].map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('sidebar and Meer cover the same set, apart from the phone tab roots', () => {
  const sidebar = NAV_GROUPS.flatMap((group) => group.items).filter((item) => !item.tabRoot).map(navItemUrl);
  const meer = NAV_GROUPS.flatMap(meerItems).map(navItemUrl);
  assert.deepEqual(meer, sidebar);
  const roots = NAV_GROUPS.flatMap((group) => group.items).filter((item) => item.tabRoot).map((item) => item.label);
  assert.deepEqual(roots, ['Verkooporders', 'Inkooporders', 'Producten']);
  for (const item of NAV_GROUPS.flatMap(meerItems)) assert.ok(item.hint, `${item.id} has a help line on Meer`);
  for (const item of [...NAV_WORKSPACES, ...NAV_DEVICE]) assert.ok(item.hint, `${item.id} has a help line on Meer`);
});

test('groups keep the sidebar order and their labels', () => {
  assert.deepEqual(NAV_GROUPS.map((g) => g.label), ['Verkoop', 'Inkoop', 'Producten & voorraad', 'Analyses', 'Bedrijf']);
  assert.deepEqual(NAV_WORKSPACES.map((w) => w.label), ['Documenten & media', 'Kosten & bank', 'Website beheren']);
});

test('the folded Verkoop header adds action and login requests, Meer only the login requests', () => {
  const verkoop = NAV_GROUPS.find((g) => g.id === 'verkoop')!;
  assert.deepEqual(groupCountKeys(verkoop, 'sidebar'), ['actionCount', 'loginRequestCount']);
  assert.deepEqual(groupCountKeys(verkoop, 'meer'), ['loginRequestCount']);
  const revisions = verkoop.items.find((i) => i.id === 'revisions')!;
  assert.equal(revisions.countKey, 'revisionCount');
});

test('rail labels, Meer titles and the nieuw pill', () => {
  assert.equal(shortLabel(NAV_HOME), 'Home');
  const all = NAV_GROUPS.flatMap((g) => g.items);
  assert.equal(shortLabel(all.find((i) => i.id === 'sales')!), 'Verkoop');
  assert.equal(shortLabel(all.find((i) => i.id === 'inventory')!), 'Inventaris');
  assert.equal(meerLabel(all.find((i) => i.id === 'prospects')!), 'Prospects & groothandels');
  assert.equal(meerLabel(all.find((i) => i.id === 'analyses-website')!), 'Websitebezoekers');
  assert.equal(meerLabel(NAV_DEVICE[0]), 'Meldingen');
  assert.equal(NAV_DEVICE[0].label, 'Meldingen op dit toestel');
  const cash = all.find((i) => i.id === 'analyses-cash')!;
  assert.equal(navItemIsNew(cash, new Date(2026, 9, 17)), true);
  assert.equal(navItemIsNew(cash, new Date(2027, 0, 1)), false);
  assert.deepEqual(all.filter((i) => i.railMain).map((i) => i.id), ['sales', 'purchasing', 'products']);
});

test('active matching follows path, exactness and settings sections', () => {
  const all = NAV_GROUPS.flatMap((g) => g.items);
  const byId = (id: string) => all.find((i) => i.id === id)!;
  assert.equal(navItemActive(byId('sales'), '/sales/79/edit'), true);
  assert.equal(navItemActive(byId('stock'), '/stock?locatie=2'), true);
  assert.equal(navItemActive(byId('stock'), '/stock/inventaris'), false);
  assert.equal(navItemActive(byId('inventory'), '/stock/inventaris/telling/3'), true);
  assert.equal(navItemActive(byId('discounts'), '/settings?sectie=discounts'), true);
  assert.equal(navItemActive(byId('discounts'), '/settings?sectie=duties'), false);
  assert.equal(navItemActive(byId('discounts'), '/settings'), false);
  assert.equal(navItemActive(byId('deleted-items'), '/settings/deleted-items'), true);
  assert.equal(navItemActive(byId('company'), '/settings/deleted-items?sectie=company'), false);
});

test('no wording the owner ruled out', () => {
  const text = JSON.stringify([NAV_HOME, NAV_GROUPS, NAV_WORKSPACES, NAV_DEVICE]);
  assert.doesNotMatch(text, /begroot/i);
  assert.doesNotMatch(text, /\bset\b/i);
});

test('Login-aanvragen is in the 900-1023 rail but not the 680-899 one: Meer carries its count only below 900', () => {
  const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === 'login-requests')!;
  assert.equal(item.countKey, 'loginRequestCount');
  assert.ok(!item.wide, 'shown in the 900-1023 rail with its own chip (shell.scss hides the Meer copy there)');
  assert.ok(!item.railMain, 'not in the 680-899 rail: the rail Meer shows the count');
});
