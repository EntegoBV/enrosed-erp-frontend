import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { isPhoneTabRoot, phoneTabRootFor } from '../src/app/core/platform/phone-tabs.ts';
import { parentOf } from '../src/app/core/platform/page-parent.ts';
import { capsuleLabel, screenLabel } from '../src/app/core/platform/return-label.ts';

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const header = read('app/shared/page-header.ts');
const shell = read('styles/shell.scss');
const app = read('app/app.ts');

/* A header member run on its own (the class without Angular), as tab-menu.test.mts does for the shell. */
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
const Header = isolate(header, 'PageHeader', ['backControl'],
  { computed: (read: () => unknown) => read, isPhoneTabRoot, phoneTabRootFor, screenLabel, capsuleLabel });

/** The phone back control at a URL: the route's parent, an optional backTo and the screen below in the history ('' = none). */
function backAt(url: string, { backTo = null as string | null, below = '' } = {}) {
  const head = Object.assign(new Header(), {
    desktop: { active: () => false }, url: () => url, resolvedParent: () => parentOf(url), backTo: () => backTo,
    history: { below: () => (below ? { url: '/x' } : null), belowLabel: () => below }, fold: () => 'full',
  });
  const control = head.backControl() as { text: string; aria: string; fallback: string } | null;
  /* copied into this realm: the vm's objects carry its own Object prototype */
  return control && { text: control.text, aria: control.aria, fallback: control.fallback };
}

test('the page header API the areas build on', () => {
  assert.match(header, /readonly parent = input<PageHeaderParent \| null \| undefined>\(undefined\);/);
  assert.match(header, /readonly large = input<boolean \| undefined>\(undefined\);/);
  for (const input of ['title = input.required<string>()', "subtitle = input('')", 'showBack = input(false)',
    'backTo = input<string | null>(null)', 'showBell = input(true)', 'titleEditable = input(false)', 'titleChange = output<string>()']) {
    assert.ok(header.includes(input), input);
  }
  assert.match(header, /export interface PageHeaderParent \{\s*label: string;\s*url: string;/);
});

test('desk crumb from parentOf, phone back from the history, large title from the route', () => {
  assert.match(header, /return parentOf\(this\.url\(\)\);/);
  assert.match(header, /this\.large\(\) \?\? parentOf\(this\.url\(\)\) === null/);
  assert.match(header, /if \(isPhoneTabRoot\(url\)\) return null;/);
  assert.match(header, /const tabRoot = phoneTabRootFor\(url\);/);
  assert.match(header, /else label = screenLabel\(tabRoot\);/);
  assert.match(header, /const fallback = backTo \?\? parent\?\.url \?\? tabRoot;/);
  assert.match(header, /capsuleLabel\(label\)/);
  assert.match(header, /observeLargeTitle\(/);
  assert.match(header, /this\.history\.up\(parent\.url\)/);
  assert.doesNotMatch(header, /BrandMark|brand-mark/, 'no logo in the phone header');
  assert.doesNotMatch(header, /:host\s*\{/, 'the host stays inline (critique N7)');
  assert.match(header, /class="appbar__large"/);
  assert.match(header, /'Terug naar ' \+ parent\.label/);
});

test('the phone back without history: a page of a tab\'s menu goes up to that tab, a Meer screen to Meer', () => {
  assert.deepEqual(backAt('/customers'), { text: 'Verkoop', aria: 'Terug naar Verkoop', fallback: '/sales' });
  assert.deepEqual(backAt('/tica'), { text: 'Verkoop', aria: 'Terug naar Verkoop', fallback: '/sales' });
  assert.deepEqual(backAt('/suppliers'), { text: 'Inkoop', aria: 'Terug naar Inkoop', fallback: '/purchasing' });
  assert.deepEqual(backAt('/douane'), { text: 'Inkoop', aria: 'Terug naar Inkoop', fallback: '/purchasing' });
  assert.deepEqual(backAt('/stock/inventaris'), { text: 'Producten', aria: 'Terug naar Producten', fallback: '/products' });
  assert.deepEqual(backAt('/barcodes'), { text: 'Producten', aria: 'Terug naar Producten', fallback: '/products' });
  /* Meer-only screens keep "‹ Meer" */
  for (const url of ['/activity', '/analyses/cash', '/voorwaarden', '/nope']) {
    assert.deepEqual(backAt(url), { text: 'Meer', aria: 'Terug naar Meer', fallback: '/more' }, url);
  }
  /* a parent or backTo still names the way up; the tab roots have no back control */
  assert.deepEqual(backAt('/prospects/4'), { text: 'Prospects', aria: 'Terug naar Prospects', fallback: '/prospects' });
  assert.deepEqual(backAt('/stock', { backTo: '/products' }), { text: 'Producten', aria: 'Terug naar Producten', fallback: '/products' });
  assert.deepEqual(backAt('/settings', { backTo: '/more' }), { text: 'Meer', aria: 'Terug naar Meer', fallback: '/more' });
  assert.equal(backAt('/sales'), null);
  assert.equal(backAt('/more'), null);
  /* with history it says where you came from, unchanged */
  assert.deepEqual(backAt('/customers', { below: 'Meer' }), { text: 'Meer', aria: 'Terug naar Meer', fallback: '/sales' });
  assert.deepEqual(backAt('/suppliers', { below: 'Inkooporder' }), { text: '', aria: 'Terug naar Inkooporder', fallback: '/purchasing' });
});

test('the pages a tab\'s menu lists name no backTo="/more" of their own: their way up is the tab root', () => {
  for (const page of ['settings/country-list', 'suppliers/supplier-list', 'purchasing/douane-page', 'inventory/inventory-page',
    'settings/stock-location-list', 'settings/barcode-pool-page']) {
    const source = read(`app/features/${page}.ts`);
    assert.match(source, /<app-page-header \[showBack\]="true" title=/, page);
    assert.doesNotMatch(source, /backTo="\/more"/, page);
  }
});

test('toolbar heights and the trap rule', () => {
  assert.match(shell, /@media \(min-width: 680px\) \{\s*:root \{ --appbar-h: calc\(52px \+ var\(--safe-t\)\); \}/);
  assert.match(shell, /@media \(max-width: 679\.98px\) \{\s*:root \{ --appbar-h: calc\(44px \+ var\(--safe-t\)\); \}/);
  const bar = shell.match(/\n\.appbar \{[^}]*\}/)?.[0] ?? '';
  assert.match(bar, /z-index: 60;/);
  for (const rule of shell.matchAll(/\n\s*\.appbar(?:--[a-z]+)*(?:\.appbar--[a-z]+)* \{([^}]*)\}/g)) {
    assert.doesNotMatch(rule[1], /transform|filter|container/, 'nothing on .appbar itself may trap the bell sheet');
  }
  assert.match(shell, /app-page-header:has\(> \.appbar__large\) \+ \.content \{ padding-top: 4px; \}/);
});

test('the phone tab bar lights the tab the screen is listed under', () => {
  assert.match(app, /readonly phoneTab = computed\(\(\) => phoneTabForUrl\(this\.url\(\)\)\);/);
  for (const tab of ['home', 'sales', 'purchasing', 'products', 'more']) {
    assert.ok(app.includes(`[class.active]="phoneTab() === '${tab}'"`), tab);
  }
  assert.doesNotMatch(app, /salesRoute|catalogRoute|moreRoute/);
});

test('B5: a cut title is measured unrounded, and the phone folds the back label, then the pencil', () => {
  /* scrollWidth/clientWidth are integers: a sub-pixel overflow never counted, yet the ellipsis was drawn
     ("OF-2026-01…" at 390). The Range over the text reports its full width even when ellipsized. */
  const cut = header.slice(header.indexOf('export function textCut('), header.indexOf('/** The screen above this one'));
  assert.match(cut, /element\.scrollWidth > element\.clientWidth\)/);
  assert.match(cut, /range\.selectNodeContents\(element\)/);
  assert.match(cut, /range\.getBoundingClientRect\(\)\.width > element\.getBoundingClientRect\(\)\.width \+ 0\.01/);
  const fit = header.slice(header.indexOf('private fit(): void {'), header.indexOf('startEditing(): void'));
  assert.match(fit, /!textCut\(text\)/);
  assert.doesNotMatch(fit, /clientWidth \+ 0\.5/);
  /* phone: the labelled capsule becomes a circle, then the pencil of an editable title gives way */
  assert.ok(fit.indexOf("this.fold.set('chevron')") < fit.indexOf("this.titleEditable()"));
  assert.match(fit, /else if \(this\.titleEditable\(\)\) \{\s*\/\*[^*]*\*\/\s*this\.fold\.set\('none'\);/);
  assert.match(header, /\[class\.appbar--tight\]="!desktop\.active\(\) && fold\(\) === 'none'"/);
  const phone = shell.slice(shell.indexOf('@media (max-width: 679.98px) {\n  :root { --appbar-h'));
  assert.match(phone.slice(0, phone.indexOf('\n}\n')), /\.appbar--tight \.appbar__pencil \{ display: none; \}/);
  /* the button keeps its name when the pencil is gone */
  assert.match(header, /\[attr\.aria-label\]="'Titel wijzigen: ' \+ title\(\)" \(click\)="startEditing\(\)"/);
});

test('the desk crumb never repeats the title (the desks\' loading and error states)', () => {
  const crumb = header.slice(header.indexOf('readonly crumb = computed('), header.indexOf('/** The crumb as a real link'));
  assert.match(crumb, /parent && !sameWords\(parent\.label, this\.title\(\)\) \? parent : null/);
  assert.match(header, /return a\.trim\(\)\.toLocaleLowerCase\('nl'\) === b\.trim\(\)\.toLocaleLowerCase\('nl'\);/);
  /* for the desks' loading and error headers (title="Verkoop" / "Inkoop" under a derived "Verkoop ›" / "Inkoop ›") */
});

test('a header that leaves without a navigation hands the tab title back to the route', () => {
  assert.match(header, /this\.ownTitle = documentTitle\(this\.title\(\)\);/);
  const leave = header.slice(header.indexOf('inject(DestroyRef).onDestroy(() => {\n      if (this.ownTitle'), header.indexOf('/* Re-fit whenever'));
  assert.match(leave, /this\.documentTitle\.getTitle\(\) !== this\.ownTitle\) return;/);
  assert.match(leave, /documentTitle\(this\.titleStrategy\.buildTitle\(this\.router\.routerState\.snapshot\)\)/);
});
