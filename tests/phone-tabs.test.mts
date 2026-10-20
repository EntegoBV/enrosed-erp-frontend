import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PHONE_TAB_PAGES, PHONE_TAB_ROOTS, isPhoneTabRoot, phoneTabForUrl, phoneTabRootFor,
} from '../src/app/core/platform/phone-tabs.ts';
import { NAV_DEVICE, NAV_GROUPS, NAV_MORE, NAV_WORKSPACES, navItemUrl } from '../src/app/core/platform/nav-items.ts';
import { tabMenuFor } from '../src/app/core/platform/tab-menu.ts';
import { screenLabel } from '../src/app/core/platform/return-label.ts';

const MENU_TABS = ['sales', 'purchasing', 'products'] as const;
/** The items of a tab's long-press menu (tab-menu.ts), the tab root first. */
const menuItems = (tab: typeof MENU_TABS[number]) => tabMenuFor(tab, NAV_GROUPS)!.rows.map((row) => row.item);

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
    ['/stock', 'products'],
    ['/stock?locatie=2', 'products'],
    ['/stock?q=bowl&categorie=1', 'products'],
  ];
  for (const [url, tab] of table) assert.equal(phoneTabForUrl(url), tab, url);
});

test('a page of a tab\'s long-press menu lights that tab, and so does what lies below it', () => {
  const table: Array<[string, string]> = [
    ['/tica', 'sales'], ['/revisions', 'sales'], ['/customers', 'sales'], ['/klantlogins', 'sales'],
    ['/prospects', 'sales'], ['/prospects/4', 'sales'], ['/contactaanvragen', 'sales'], ['/countries', 'sales'],
    ['/suppliers', 'purchasing'], ['/douane', 'purchasing'],
    ['/stock/inventaris', 'products'], ['/stock/inventaris?jaar=2026', 'products'], ['/stock/inventaris/telling/3', 'products'],
    ['/stock/inventaris/afsluiting/2026?stap=waarde#lot-4', 'products'], ['/stock-locations', 'products'],
    ['/barcodes', 'products'], ['/categories', 'products'],
  ];
  for (const [url, tab] of table) assert.equal(phoneTabForUrl(url), tab, url);
  /* every row the menu shows on the phone, read from tab-menu.ts itself */
  for (const tab of MENU_TABS) {
    for (const item of menuItems(tab).filter((candidate) => !candidate.query)) {
      assert.equal(phoneTabForUrl(navItemUrl(item)), tab, item.id);
      assert.equal(phoneTabForUrl(`${item.link}/12?sectie=x#y`), tab, `below ${item.id}`);
    }
  }
});

test('the page lists in phone-tabs.ts are the menu rows, nothing more and nothing left out', () => {
  assert.deepEqual(PHONE_TAB_PAGES.home, ['/dashboard']);
  for (const tab of MENU_TABS) {
    const links = menuItems(tab).filter((item) => !item.query).map((item) => item.link);
    /* one entry per page: Jaarinventaris (/stock/inventaris) lies under Voorraad's /stock */
    const own = links.filter((link) => !links.some((other) => other !== link && link.startsWith(other + '/')));
    /* /catalog is the Catalogus PDF's texts screen (parentOf: Catalogus PDF), reached from that page */
    assert.deepEqual(PHONE_TAB_PAGES[tab].filter((page) => page !== '/catalog'), own, tab);
    assert.equal(PHONE_TAB_PAGES[tab][0], PHONE_TAB_ROOTS[tab], 'the tab root first');
  }
  /* the only rows that do not light their tab: the views of Instellingen, which light Meer with it */
  const settingsViews = MENU_TABS.flatMap((tab) => menuItems(tab).filter((item) => item.query));
  assert.deepEqual(settingsViews.map((item) => item.id), ['discounts', 'catalog-data']);
  for (const item of settingsViews) {
    assert.equal(item.link, '/settings', item.id);
    assert.equal(phoneTabForUrl(navItemUrl(item)), 'more', item.id);
  }
});

test('screens reached only from Meer light Meer, so the tab agrees with "‹ Meer"', () => {
  for (const url of [
    '/more', '/costs', '/costs/bank?rekening=2', '/files', '/files/map/4', '/settings', '/settings?sectie=company',
    '/settings?sectie=discounts', '/settings?sectie=catalog-data', '/settings?sectie=notifications', '/settings/overzicht',
    '/settings/deleted-items', '/activity', '/analyses/cash', '/analyses/sales', '/website', '/website/layout',
    '/voorwaarden', '/nope', '/',
  ]) {
    assert.equal(phoneTabForUrl(url), 'more', url);
  }
  /* every Meer row outside the three menus: Analyses, Bedrijf, Snel naar and this device */
  const meerOnly = [
    ...NAV_GROUPS.filter((group) => group.id === 'analyses' || group.id === 'bedrijf').flatMap((group) => group.items),
    ...NAV_WORKSPACES, ...NAV_DEVICE, NAV_MORE,
  ];
  assert.ok(meerOnly.length > 10);
  for (const item of meerOnly) assert.equal(phoneTabForUrl(navItemUrl(item)), 'more', item.id);
});

test('a longer sibling path never borrows a tab', () => {
  assert.equal(phoneTabForUrl('/salesforce'), 'more');
  assert.equal(phoneTabForUrl('/products-old'), 'more');
  assert.equal(phoneTabForUrl('/dashboards'), 'more');
  assert.equal(phoneTabForUrl('/stocks'), 'more');
  assert.equal(phoneTabForUrl('/catalogus'), 'more');
  for (const page of Object.values(PHONE_TAB_PAGES).flat()) {
    assert.equal(phoneTabForUrl(`${page}x`), 'more', `${page}x`);
    assert.equal(phoneTabForUrl(`${page}-old/2`), 'more', `${page}-old/2`);
  }
});

test('without history or a parent, the phone goes up to the tab root and names it', () => {
  const up = (url: string) => ({ url: phoneTabRootFor(url), label: screenLabel(phoneTabRootFor(url)) });
  assert.deepEqual(up('/customers'), { url: '/sales', label: 'Verkoop' });
  assert.deepEqual(up('/tica'), { url: '/sales', label: 'Verkoop' });
  assert.deepEqual(up('/suppliers'), { url: '/purchasing', label: 'Inkoop' });
  assert.deepEqual(up('/douane'), { url: '/purchasing', label: 'Inkoop' });
  assert.deepEqual(up('/stock/inventaris'), { url: '/products', label: 'Producten' });
  assert.deepEqual(up('/barcodes'), { url: '/products', label: 'Producten' });
  for (const url of ['/costs', '/activity', '/analyses/cash', '/settings?sectie=discounts', '/website', '/nope']) {
    assert.deepEqual(up(url), { url: '/more', label: 'Meer' }, url);
  }
  const labels: Record<string, string> = { sales: 'Verkoop', purchasing: 'Inkoop', products: 'Producten' };
  for (const tab of MENU_TABS) {
    for (const item of menuItems(tab).filter((candidate) => !candidate.query && !candidate.tabRoot)) {
      assert.deepEqual(up(navItemUrl(item)), { url: PHONE_TAB_ROOTS[tab], label: labels[tab] }, item.id);
    }
  }
});

test('only the five tab roots themselves count as roots', () => {
  for (const url of ['/dashboard', '/sales', '/sales?tab=facturen', '/purchasing', '/products', '/more', '/sales/'])
    assert.equal(isPhoneTabRoot(url), true, url);
  for (const url of ['/sales/79', '/dashboard/agenda', '/customers', '/stock', '/'])
    assert.equal(isPhoneTabRoot(url), false, url);
});
