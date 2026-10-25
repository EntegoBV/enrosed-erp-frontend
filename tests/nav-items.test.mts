import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  NAV_DEVICE, NAV_GROUPS, NAV_HOME, NAV_WORKSPACES, allNavUrls, groupCountKeys, meerItems, meerLabel,
  navItemActive, navItemIsNew, navItemUrl, shortLabel,
} from '../src/app/core/platform/nav-items.ts';

test('every link of the sidebar and Meer before the redesign is still there', () => {
  const urls = allNavUrls();
  for (const url of [
    '/dashboard', '/sales', '/tica', '/revisions', '/customers', '/klantlogins', '/prospects', '/contactaanvragen', '/countries',
    '/settings?sectie=discounts', '/purchasing', '/suppliers', '/douane', '/products', '/stock',
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

/* Different names, the same drawing (a box, a cab and two wheels): never side by side in one group. */
const LOOK_ALIKES: readonly (readonly string[])[] = [['suppliers', 'truck']];

test('one icon per screen within a group, and ids are unique', () => {
  const iconSource = readFileSync(new URL('../src/app/shared/icon.ts', import.meta.url), 'utf8');
  for (const group of NAV_GROUPS) {
    const icons = group.items.map((item) => item.icon);
    assert.equal(new Set(icons).size, icons.length, group.id);
    for (const pair of LOOK_ALIKES) {
      assert.ok(pair.filter((name) => icons.includes(name)).length < 2, `${group.id}: ${pair.join(' and ')} look the same`);
    }
    for (const icon of [group.icon, ...icons]) assert.ok(iconSource.includes(`@case ('${icon}')`), `icon ${icon} exists`);
  }
  assert.equal(NAV_GROUPS.find((g) => g.id === 'inkoop')!.items.find((i) => i.id === 'duties')!.icon, 'customs');
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

test('Inkoop leads to Kosten & bank\'s Facturen: after Leveranciers, its own icon, a nieuw pill until 2027', () => {
  const inkoop = NAV_GROUPS.find((g) => g.id === 'inkoop')!;
  assert.deepEqual(inkoop.items.map((i) => i.id), ['purchasing', 'suppliers', 'invoices', 'duties']);
  assert.equal(inkoop.hint, 'Leveranciers, facturen en douane');
  const invoices = inkoop.items.find((i) => i.id === 'invoices')!;
  assert.equal(invoices.label, 'Facturen');
  assert.equal(invoices.icon, 'document');
  assert.equal(inkoop.items.filter((i) => i.icon === 'document').length, 1, 'icon unique in its group');
  assert.equal(navItemUrl(invoices), '/costs?view=invoices');
  assert.equal(invoices.hint, 'Opgeladen, Odoo en verkoop op één plek');
  assert.equal(invoices.newUntil, '2027-01-01');
  assert.equal(navItemIsNew(invoices, new Date(2026, 9, 26)), true);
  assert.equal(navItemIsNew(invoices, new Date(2027, 0, 1)), false);
  assert.ok(!invoices.tabRoot && !invoices.railMain && !invoices.countKey);
  assert.ok(allNavUrls().includes('/costs?view=invoices'));
  /* lit only on the finder: the other views of Kosten & bank are not Facturen */
  assert.equal(navItemActive(invoices, '/costs?view=invoices&tab=out&q=PO-2026-005'), true);
  assert.equal(navItemActive(invoices, '/costs?view=invoices&po=62'), true);
  assert.equal(navItemActive(invoices, '/costs'), false);
  assert.equal(navItemActive(invoices, '/costs?view=costs'), false);
  assert.equal(navItemActive(invoices, '/purchasing/62'), false);
});

test('Login-aanvragen is in the 900-1023 rail but not the 680-899 one: Meer carries its count only below 900', () => {
  const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === 'login-requests')!;
  assert.equal(item.countKey, 'loginRequestCount');
  assert.ok(!item.wide, 'shown in the 900-1023 rail with its own chip (shell.scss hides the Meer copy there)');
  assert.ok(!item.railMain, 'not in the 680-899 rail: the rail Meer shows the count');
});
