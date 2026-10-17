import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const header = read('app/shared/page-header.ts');
const shell = read('styles/shell.scss');
const app = read('app/app.ts');

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
  assert.match(header, /else label = 'Meer';/);
  assert.match(header, /capsuleLabel\(label\)/);
  assert.match(header, /observeLargeTitle\(/);
  assert.match(header, /this\.history\.up\(parent\.url\)/);
  assert.doesNotMatch(header, /BrandMark|brand-mark/, 'no logo in the phone header');
  assert.doesNotMatch(header, /:host\s*\{/, 'the host stays inline (critique N7)');
  assert.match(header, /class="appbar__large"/);
  assert.match(header, /'Terug naar ' \+ parent\.label/);
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
