import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { NAV_GROUPS, meerItems, navItemActive, navItemUrl } from '../src/app/core/platform/nav-items.ts';
import type { NavItem } from '../src/app/core/platform/nav-items.ts';
import {
  TAB_MENU_CLICK_GUARD_MS, TAB_MENU_HOLD_MS, TAB_MENU_PUSH, TAB_MENU_SLOP_PX, TAB_MENU_WIDTH, clickGuardAfter, hasTabMenu, isMenuKey,
  liesUnder, menuFocusIndex, pressWandered, startTabPress, tabMenuFor, tabMenuPlacement,
} from '../src/app/core/platform/tab-menu.ts';
import type { MenuTab, TabMenu, TabMenuRow } from '../src/app/core/platform/tab-menu.ts';
import { PHONE_TABS, phoneTabForUrl } from '../src/app/core/platform/phone-tabs.ts';
import { navDirection } from '../src/app/core/platform/nav-direction.ts';
import { parentOf } from '../src/app/core/platform/page-parent.ts';

/* The phone tab bar's long press (2026-10-20): Verkoop, Inkoop and Producten open their pages above the tab. */
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const shell = read('src/app/app.ts');
const template = /template:\s*`([\s\S]*?)`,\s*\}\)/.exec(shell)?.[1] ?? '';
const css = read('src/styles/shell-tabbar.scss');
const pointer = { pointerId: 7, clientX: 120, clientY: 780, isPrimary: true, button: 0 };

/* A shell member run on its own (the class without Angular), as deleted-items.test.mts does. */
function isolate(source: string, name: string, members: string[], globals: Record<string, unknown>) {
  const parsed = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
  const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name);
  assert.ok(original);
  const selected = original.members.filter((member) => member.name && ts.isIdentifier(member.name) && members.includes(member.name.text));
  assert.equal(selected.length, members.length);
  const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter((modifier) => !ts.isDecorator(modifier)), original.name, undefined, undefined, selected);
  const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {}; vm.runInNewContext(js, { exports, ...globals }); return exports[name];
}
const App = isolate(shell, 'App', ['tabMenuKey'], { menuFocusIndex });
const AppRows = isolate(shell, 'App', ['menuRowCurrent', 'menuRowInfo'], { phoneTabForUrl, navItemUrl, TAB_MENU_PUSH, liesUnder, parentOf });

/* The shell at a URL: its lit tab and its active items as the real phone-tabs.ts and nav-items.ts give them. */
function shellAt(url: string): { menuRowCurrent(menu: TabMenu, row: TabMenuRow): boolean; menuRowInfo(row: TabMenuRow): unknown } {
  return Object.assign(new AppRows(), { url: () => url, phoneTab: () => phoneTabForUrl(url), itemActive: (item: NavItem) => navItemActive(item, url) });
}
const MENUS = (['sales', 'purchasing', 'products'] as MenuTab[]).map((tab) => tabMenuFor(tab, NAV_GROUPS)!);

/* The open menu's three rows, the one at `focused` holding the focus (-1: none). */
function menuKeys(focused: number) {
  const calls: string[] = [];
  const rows = ['sales', 'tica', 'customers'].map((id) => ({ focus: () => calls.push(`focus ${id}`), click: () => calls.push(`click ${id}`) }));
  const app = Object.assign(new App(), { document: { activeElement: rows[focused] ?? null }, closeTabMenu: (back: boolean) => calls.push(`close ${back}`) });
  const press = (key: string) => {
    let prevented = false;
    app.tabMenuKey({ key, currentTarget: { querySelectorAll: () => rows }, preventDefault: () => { prevented = true; } });
    return prevented;
  };
  return { calls, press };
}

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

test('the menu\'s keys: Space opens the focused row as Enter does, never scrolling the page shut', () => {
  let menu = menuKeys(1);
  assert.equal(menu.press(' '), true, 'no page scroll: that scroll would close the menu and drop the focus');
  assert.deepEqual(menu.calls, ['click tica']);
  menu = menuKeys(-1);
  assert.equal(menu.press(' '), true);
  assert.deepEqual(menu.calls, [], 'no row has the focus: nothing opens');
  menu = menuKeys(1);
  assert.equal(menu.press('ArrowDown'), true);
  assert.equal(menu.press('Enter'), false, 'Enter is the link\'s own');
  assert.equal(menu.press('Tab'), false);
  assert.deepEqual(menu.calls, ['focus customers', 'close true']);
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
  /* the page's keys stand down while it is open, and a held row gets no link sheet (Android ignores the callout rule) */
  assert.match(template, /animate\.leave="tabbar-menu--leaving" data-kit-overlay\n/);
  assert.match(template, /\(keydown\)="tabMenuKey\(\$event\)" \(contextmenu\)="\$event\.preventDefault\(\)">/);
  assert.match(template, /<a class="tabbar-menu__row" role="menuitem" \[routerLink\]="row\.item\.link" \[queryParams\]="row\.item\.query \?\? null"/);
  assert.match(template, /\[class\.tabbar-menu__row--current\]="menuRowCurrent\(menu, row\)" \[attr\.aria-current\]="menuRowCurrent\(menu, row\) \? 'page' : null"/);
  assert.match(template, /\[info\]="menuRowInfo\(row\)"/);
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

test('the styles: no callout, selection or drag on the bar; glass above the bar; the backdrop covers the \'+\' too, the bar stands above it', () => {
  assert.match(css, /\.tabbar \{ -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; \}/);
  assert.match(css, /\.tabbar__item\[aria-haspopup\] \{ touch-action: none; \}/);
  /* a tap on the '+' or beside the bar closes the menu, never opening the page's sheet under it */
  assert.match(css, /\.tabbar-menu__backdrop \{ position: fixed; inset: 0; z-index: 70; \}/);
  assert.match(css, /\.tabbar:has\(~ \.tabbar-menu__backdrop\) \{ z-index: 71; \}/);
  const menu = /\n\.tabbar-menu \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(menu, /z-index: 71;/, 'above the page header (60)');
  assert.match(menu, /background: var\(--glass-bg-strong\);/);
  assert.match(menu, /backdrop-filter: var\(--glass-filter\);/);
  assert.match(menu, /transform-origin: var\(--tab-x, 50%\)/);
  assert.match(menu, /animation: tabbar-menu-in var\(--dur-2, 200ms\) var\(--ease-out, ease-out\) backwards;/, 'the popover enter token, not the page push');
  assert.match(css, /@keyframes tabbar-menu-in \{ from \{ opacity: 0; transform: scale\(\.5\); \} to \{ opacity: 1; transform: none; \} \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.tabbar-menu \{ animation-name: mo-fade-in; \} \}/);
});

test('the menu\'s current row and the lit tab agree: a row is marked only under its own tab', () => {
  const urls = [
    ...MENUS.flatMap((menu) => menu.rows.flatMap((row) => [navItemUrl(row.item), `${row.item.link}/3`])),
    '/sales/79/edit', '/stock/inventaris/telling/3', '/catalog/texts', '/prospects/4?tab=notities',
    '/dashboard', '/more', '/costs', '/settings', '/settings?sectie=company', '/activity', '/analyses/cash', '/nope',
  ];
  for (const url of urls) {
    const shell = shellAt(url);
    const marked = MENUS.flatMap((menu) => menu.rows.filter((row) => shell.menuRowCurrent(menu, row)).map((row) => ({ tab: menu.tab, id: row.item.id })));
    assert.ok(marked.length <= 1, `${url}: one current row at most, ${JSON.stringify(marked)}`);
    /* a mark is always in the menu of the lit tab ... */
    for (const mark of marked) assert.equal(mark.tab, phoneTabForUrl(url), url);
    /* ... and the lit tab's menu marks the page whenever one of its rows stands for it */
    const lit = MENUS.find((menu) => menu.tab === phoneTabForUrl(url));
    const standing = lit?.rows.find((row) => navItemActive(row.item, url));
    assert.deepEqual(marked.map((mark) => mark.id), standing ? [standing.item.id] : [], url);
  }
  /* every page row is current at its own address, in its own menu */
  for (const menu of MENUS) {
    for (const row of menu.rows.filter((candidate) => !candidate.item.query)) {
      assert.equal(shellAt(navItemUrl(row.item)).menuRowCurrent(menu, row), true, row.item.id);
    }
  }
  /* a view of Instellingen lights Meer: Kortingen is then no current row under Verkoop */
  const sales = MENUS[0];
  const discounts = sales.rows.find((row) => row.item.id === 'discounts')!;
  assert.equal(phoneTabForUrl('/settings?sectie=discounts'), 'more');
  assert.equal(shellAt('/settings?sectie=discounts').menuRowCurrent(sales, discounts), false);
});

test('liesUnder: on a page, below its path, or below it by the parent chain', () => {
  const up = (url: string) => parentOf(url)?.url ?? null;
  assert.equal(liesUnder('/stock', '/stock', up), true);
  assert.equal(liesUnder('/stock/?locatie=2#rij', '/stock', up), true);
  assert.equal(liesUnder('/stock/inventaris', '/stock', up), true);
  assert.equal(liesUnder('/stock/inventaris/telling/3', '/stock/inventaris', up), true);
  assert.equal(liesUnder('/catalog/texts', '/catalog-export', up), true);
  assert.equal(liesUnder('/prospects/4?tab=notities', '/prospects', up), true);
  /* a longer sibling, a page above, a sibling and no parent at all */
  assert.equal(liesUnder('/stock-locations', '/stock', up), false);
  assert.equal(liesUnder('/stock', '/stock/inventaris', up), false);
  assert.equal(liesUnder('/catalog-export', '/catalog/texts', up), false);
  assert.equal(liesUnder('/customers', '/tica', up), false);
  /* a parent chain that loops ends */
  assert.equal(liesUnder('/a', '/c', (url) => (url === '/a' ? '/b' : '/a')), false);
});

test('a row picked from the menu moves once and the right way: a push in the tab, a tab switch from Meer', () => {
  const [sales, purchasing, products] = MENUS;
  const row = (menu: TabMenu, id: string) => menu.rows.find((candidate) => candidate.item.id === id)!;
  /* what nav-motion plays for a pick made at `from` */
  const pick = (from: string, menu: TabMenu, id: string) =>
    navDirection(from, navItemUrl(row(menu, id).item), 'imperative', shellAt(from).menuRowInfo(row(menu, id)), PHONE_TABS);
  assert.equal(pick('/sales', sales, 'customers'), 'push');
  assert.equal(pick('/purchasing', purchasing, 'suppliers'), 'push');
  assert.equal(pick('/products', products, 'inventory'), 'push');
  /* from deeper in the tab a shallower page still arrives as a push, never sliding back */
  assert.equal(pick('/sales/79', sales, 'customers'), 'push');
  assert.equal(pick('/customers', sales, 'tica'), 'push');
  assert.equal(pick('/stock/inventaris/telling/3', products, 'stock-locations'), 'push');
  /* the tab root, and a page you are under, go up */
  assert.equal(pick('/customers', sales, 'sales'), 'pop');
  assert.equal(pick('/stock/inventaris/telling/3', products, 'inventory'), 'pop');
  assert.equal(pick('/prospects/4', sales, 'prospects'), 'pop');
  /* ... also when the row lights only on its own path (Voorraad is exact) or the way up is a parent (the texts' Catalogus PDF) */
  assert.equal(pick('/stock/inventaris', products, 'stock'), 'pop');
  assert.equal(pick('/stock/inventaris/telling/3', products, 'stock'), 'pop');
  assert.equal(pick('/stock/inventaris/afsluiting/2026?stap=waarde', products, 'stock'), 'pop');
  assert.equal(pick('/catalog/texts', products, 'catalog-export'), 'pop');
  /* the page you are on stays, a sibling or a page above you is still a push */
  assert.equal(pick('/stock?locatie=2', products, 'stock'), 'none');
  assert.equal(pick('/stock', products, 'inventory'), 'push');
  assert.equal(pick('/catalog/texts', products, 'stock'), 'push');
  assert.equal(pick('/catalog-export', products, 'stock-locations'), 'push');
  /* a view of Instellingen is the page you are on by its query only: another view of it still pushes */
  assert.equal(pick('/settings?sectie=company', sales, 'discounts'), 'push');
  assert.equal(pick('/settings?sectie=discounts', sales, 'discounts'), 'none');
  /* from another tab it is a tab switch: Klanten picked on Meer or on Home, Kortingen (Meer's) from Verkoop */
  assert.equal(pick('/more', sales, 'customers'), 'tab');
  assert.equal(pick('/dashboard', sales, 'customers'), 'tab');
  assert.equal(pick('/analyses/cash', purchasing, 'suppliers'), 'tab');
  assert.equal(pick('/customers', sales, 'discounts'), 'tab');
  assert.equal(pick('/more', sales, 'sales'), 'tab');
  assert.deepEqual(TAB_MENU_PUSH, { nav: 'push' });
  /* the slide-and-release pick names the same direction as a tap on the row */
  assert.match(shell, /const info = this\.menuRowInfo\(row\);\n    void this\.router\.navigateByUrl\(navItemUrl\(row\.item\), info \? \{ info \} : undefined\);/);
  /* one lit tab per screen: the tab bar reads phoneTab() alone, from the url of each NavigationEnd */
  assert.equal((template.match(/\[class\.active\]="phoneTab\(\) === '[a-z]+'"/g) ?? []).length, 5);
  assert.match(shell, /filter\(\(event\): event is NavigationEnd => event instanceof NavigationEnd\),\n\s*map\(\(event\) => event\.urlAfterRedirects\),/);
});
