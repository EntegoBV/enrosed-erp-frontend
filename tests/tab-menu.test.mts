import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { NAV_GROUPS, meerItems } from '../src/app/core/platform/nav-items.ts';
import {
  TAB_MENU_CLICK_GUARD_MS, TAB_MENU_HOLD_MS, TAB_MENU_SLOP_PX, TAB_MENU_WIDTH, clickGuardAfter, hasTabMenu, isMenuKey,
  menuFocusIndex, pressWandered, startTabPress, tabMenuFor, tabMenuPlacement,
} from '../src/app/core/platform/tab-menu.ts';

/* The phone tab bar's long press (2026-10-20): Verkoop, Inkoop and Producten open their pages above the tab. */
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const shell = read('src/app/app.ts');
const template = /template:\s*`([\s\S]*?)`,\s*\}\)/.exec(shell)?.[1] ?? '';
const css = read('src/styles/shell-tabbar.scss');
const pointer = { pointerId: 7, clientX: 120, clientY: 780, isPrimary: true, button: 0 };

test('Verkoop, Inkoop and Producten get a menu; Home and Meer none', () => {
  assert.deepEqual(['home', 'sales', 'purchasing', 'products', 'more'].filter(hasTabMenu), ['sales', 'purchasing', 'products']);
  assert.equal(tabMenuFor('home', NAV_GROUPS), null);
  assert.equal(tabMenuFor('more', NAV_GROUPS), null);
  assert.equal(tabMenuFor('toString', NAV_GROUPS), null);
});

test('the rows: the tab root in full first, then what Meer lists for the group, in sidebar order', () => {
  const sales = tabMenuFor('sales', NAV_GROUPS)!;
  assert.equal(sales.label, 'Verkoop');
  assert.deepEqual(sales.rows.map((row) => row.label), [
    'Verkooporders', 'TICA', 'Wijzigingen', 'Klanten', 'Login-aanvragen', 'Prospects', 'Contactaanvragen', 'Landen & vracht', 'Kortingen',
  ]);
  assert.deepEqual(tabMenuFor('purchasing', NAV_GROUPS)!.rows.map((row) => row.label), ['Inkooporders', 'Leveranciers', 'Douane']);
  const products = tabMenuFor('products', NAV_GROUPS)!;
  assert.equal(products.label, 'Producten');
  assert.deepEqual(products.rows.map((row) => row.label), [
    'Producten', 'Voorraad', 'Inventaris', 'Locaties', 'EAN-codes', 'Categorieën', 'Catalogusdata', 'Catalogus PDF',
  ]);
  /* Meer's rule decides what the phone gets: every page but the tab roots, the desk's wide ones included */
  for (const [tab, id] of [['sales', 'verkoop'], ['purchasing', 'inkoop'], ['products', 'producten']] as const) {
    const group = NAV_GROUPS.find((candidate) => candidate.id === id)!;
    const rows = tabMenuFor(tab, NAV_GROUPS)!.rows.map((row) => row.item);
    assert.equal(rows[0], group.items.find((item) => item.tabRoot), tab);
    assert.deepEqual(rows.slice(1), meerItems(group), tab);
  }
  /* the rows carry the table's own items: icon, link, query and count come from NAV_GROUPS unchanged */
  const discounts = sales.rows.find((row) => row.item.id === 'discounts')!;
  assert.deepEqual(discounts.item.query, { sectie: 'discounts' });
  assert.deepEqual(sales.rows.filter((row) => row.item.countKey).map((row) => row.item.countKey), ['actionCount', 'revisionCount', 'loginRequestCount']);
});

test('a press: the primary pointer\'s main button on a tab with a menu; past the slop before it opens, it is over', () => {
  assert.equal(TAB_MENU_HOLD_MS, 450);
  assert.equal(TAB_MENU_SLOP_PX, 10);
  assert.deepEqual(startTabPress('sales', pointer), { tab: 'sales', pointerId: 7, x: 120, y: 780, opened: false });
  assert.equal(startTabPress('home', pointer), null);
  assert.equal(startTabPress('more', pointer), null);
  assert.equal(startTabPress('sales', { ...pointer, isPrimary: false }), null);
  assert.equal(startTabPress('sales', { ...pointer, button: 2 }), null);
  const press = startTabPress('products', pointer)!;
  assert.equal(pressWandered(press, 126, 772), false, '10 px exactly is still a hold');
  assert.equal(pressWandered(press, 120, 769), true);
  /* once open, the finger may slide onto a row */
  assert.equal(pressWandered({ ...press, opened: true }, 120, 500), false);
});

test('only a press that opened the menu swallows the click that trails it', () => {
  const press = startTabPress('sales', pointer)!;
  assert.equal(clickGuardAfter(press, 1000), 0);
  assert.equal(clickGuardAfter({ ...press, opened: true }, 1000), 1000 + TAB_MENU_CLICK_GUARD_MS);
});

test('the keyboard: Shift+F10 or the context-menu key opens it; arrows, Home and End walk the rows', () => {
  assert.equal(isMenuKey({ key: 'ContextMenu', shiftKey: false }), true);
  assert.equal(isMenuKey({ key: 'F10', shiftKey: true }), true);
  assert.equal(isMenuKey({ key: 'F10', shiftKey: false }), false);
  assert.equal(isMenuKey({ key: 'Enter', shiftKey: false }), false);
  assert.equal(menuFocusIndex('ArrowDown', 0, 3), 1);
  assert.equal(menuFocusIndex('ArrowDown', 2, 3), 0);
  assert.equal(menuFocusIndex('ArrowUp', 0, 3), 2);
  assert.equal(menuFocusIndex('ArrowDown', -1, 3), 0);
  assert.equal(menuFocusIndex('ArrowUp', -1, 3), 2);
  assert.equal(menuFocusIndex('Home', 2, 3), 0);
  assert.equal(menuFocusIndex('End', 0, 3), 2);
  assert.equal(menuFocusIndex('a', 0, 3), null);
  assert.equal(menuFocusIndex('ArrowDown', -1, 0), null);
});

test('the menu stands centred on its tab and within the bar, never over the \'+\' beside it', () => {
  assert.equal(TAB_MENU_WIDTH, 248);
  /* 375 px phone, five tabs on a bar from 10 to 365 */
  assert.deepEqual(tabMenuPlacement(120, 10, 365), { left: 10, width: 248, origin: 110 });
  assert.deepEqual(tabMenuPlacement(190, 10, 365), { left: 66, width: 248, origin: 124 });
  /* a bar narrowed beside the '+' (right end at 293) */
  assert.deepEqual(tabMenuPlacement(220, 10, 293), { left: 45, width: 248, origin: 175 });
  /* a bar narrower than the menu: the bar's width */
  assert.deepEqual(tabMenuPlacement(100, 10, 210), { left: 10, width: 200, origin: 90 });
});

test('the shell: three tabs announce the menu, rows are menuitems with the table\'s link, count and current page', () => {
  for (const tab of ['sales', 'purchasing', 'products']) {
    assert.ok(template.includes(`data-tab-menu="${tab}" aria-haspopup="menu" [attr.aria-expanded]="tabMenu()?.tab === '${tab}'"`), tab);
  }
  assert.equal((template.match(/aria-haspopup="menu"/g) ?? []).length, 3, 'Home and Meer get no menu');
  assert.match(template, /<nav class="tabbar" #tabbar>/);
  assert.match(template, /<div class="tabbar-menu__backdrop" \(click\)="closeTabMenu\(\)"><\/div>/);
  assert.match(template, /<div class="tabbar-menu" role="menu" \[attr\.aria-label\]="menu\.label"/);
  assert.match(template, /<a class="tabbar-menu__row" role="menuitem" \[routerLink\]="row\.item\.link" \[queryParams\]="row\.item\.query \?\? null"/);
  assert.match(template, /\[attr\.aria-current\]="itemActive\(row\.item\) \? 'page' : null"/);
  assert.match(template, /@if \(countOf\(row\.item\.countKey\); as n\) \{ <span class="ios-count">\{\{ n \}\}<\/span> \}/);
  /* the menu is outside the bar: the bar's glass (backdrop-filter) would trap a fixed child */
  assert.ok(template.indexOf('class="tabbar-menu"') > template.indexOf('</nav>', template.indexOf('<nav class="tabbar"')));
});

test('the shell: a long press opens with a tick, its click never navigates, and the menu closes on its own', () => {
  /* the click guard runs in the capture phase, before RouterLink */
  assert.match(shell, /nav\.addEventListener\('click', click, true\);/);
  assert.match(shell, /event\.stopImmediatePropagation\(\);/);
  assert.match(shell, /this\.tabHold = setTimeout\(\(\) => this\.holdTabPress\(link\), TAB_MENU_HOLD_MS\);/);
  assert.match(shell, /navigator\.vibrate\?\.\(10\)/);
  /* no native callout or context menu on the bar */
  assert.match(shell, /private tabContextMenu\(event: MouseEvent\): void \{\n    event\.preventDefault\(\);/);
  /* a route change or the desk width closes it, and so do a page scroll and Escape (focus back to the tab) */
  assert.match(shell, /closeTabMenuOnMove = effect\(\(\) => \{\n    this\.url\(\);\n    this\.desktopViewport\.active\(\);\n    untracked\(\(\) => this\.closeTabMenu\(\)\);/);
  assert.match(shell, /this\.document\[method\]\('scroll', this\.tabMenuScroll\);/);
  assert.match(shell, /if \(event\.key !== 'Escape'\) return;[\s\S]{0,80}this\.closeTabMenu\(true\);/);
  assert.match(shell, /if \(returnFocus\) opener\?\.focus\(\);/);
  /* the focus moves into the menu */
  assert.match(shell, /querySelector<HTMLElement>\('\.tabbar-menu \[role="menuitem"\]'\)\?\.focus\(\{ preventScroll: true \}\)/);
});

test('the styles: no callout, selection or drag on the bar; glass above the bar; the backdrop leaves the bar\'s strip free', () => {
  assert.match(css, /\.tabbar \{ -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; \}/);
  assert.match(css, /\.tabbar__item\[aria-haspopup\] \{ touch-action: none; \}/);
  assert.match(css, /\.tabbar-menu__backdrop \{ position: fixed; inset: 0 0 calc\(var\(--tabbar-h\) \+ var\(--safe-b\) \+ 10px\); z-index: 70; \}/);
  const menu = /\n\.tabbar-menu \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(menu, /z-index: 71;/, 'above the page header (60)');
  assert.match(menu, /background: var\(--glass-bg-strong\);/);
  assert.match(menu, /backdrop-filter: var\(--glass-filter\);/);
  assert.match(menu, /transform-origin: var\(--tab-x, 50%\)/);
  assert.match(css, /@keyframes tabbar-menu-in \{ from \{ opacity: 0; transform: scale\(\.5\); \} to \{ opacity: 1; transform: none; \} \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.tabbar-menu \{ animation-name: mo-fade-in; \} \}/);
});
