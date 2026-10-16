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
