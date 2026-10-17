import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(new URL('../src/app/features/website-builder/website-products-page.ts', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/styles/website-products.scss', import.meta.url), 'utf8');

test('the table keeps one tab stop when a filter or search hides the focused row', () => {
  assert.match(page, /return want && keys\.includes\(want\) \? want : keys\[0\] \?\? null;/);
});

test('Esc and / work from the inspector switch: a checkbox is not a text field', () => {
  const body = page.slice(page.indexOf('  onKey(event: KeyboardEvent)'), page.indexOf('\n  }\n', page.indexOf('  onKey(event: KeyboardEvent)')));
  assert.match(body, /const context = keyContext\(event, null\);/);
  assert.doesNotMatch(body, /closest\('input, textarea/);
});

test('the unpublish toast names what keeps the undo away', () => {
  assert.match(page, /werk eerst de publicatiepunten af om ze terug te zetten/);
  assert.match(page, /activeer de reeks in het ERP om ze terug te zetten/);
});

test('status pills fade in only on the row whose status changed', () => {
  assert.match(css, /\.ws-status\.is-changed \.wk-pill\{animation:mo-fade-in/);
  assert.doesNotMatch(css, /\.ws-status \.wk-pill\{animation/);
  assert.match(page, /\[class\.is-changed\]="changed\(\) === row\.id"/);
});

test('the phone reeks sheet explains Familietekst in words (no title on a phone)', () => {
  assert.match(page, /<p class="ios-section__foot ws-figs-foot">\{\{ textHint \}\}<\/p>/);
});

test('the search collapses with the kit below a 900 px toolbar, so the / cap stays with the field', () => {
  assert.match(css, /@container wk-bar \(max-width:899\.98px\)\{\.ws-search\.wk-search--collapsible\{width:auto\}\}/);
});

test('Enter on a row goes to the inspector switch, not to its close button', () => {
  assert.match(page, /inspector\?\.querySelector<HTMLElement>\('\.ws-switch:not\(:disabled\)'\)/);
});
