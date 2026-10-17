import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/app/features/website-builder/content-translations-page.ts', import.meta.url), 'utf8');
const css = (await readFile(new URL('../src/styles/website-texts-page.scss', import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');

const editorCase = page.slice(page.indexOf("@case ('editor')"), page.indexOf("@case ('area')"));

function rule(selector: string): string {
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].split(',').map((part) => part.trim()).includes(selector)) return match[2];
  }
  throw new Error(`no rule for ${selector}`);
}

test('the phone text editor shows its label and language count as a two-line title under the bar', () => {
  assert.match(editorCase, /<app-ios-nav class="ws-ph-ednav" \[title\]="editorTitle\(\)" \[customLarge\]="true"/);
  assert.match(editorCase, /<div hero class="ws-ph-edhead"><h1>\{\{ editorTitle\(\) \}\}<\/h1><small>\{\{ editorSub\(\) \}\}<\/small><\/div>/);
  assert.doesNotMatch(editorCase, /\[largeTitle\]="false"/, 'a small-only bar title cut long labels with no way to read them');
});

test('the two-line title is centred and wraps instead of cutting', () => {
  assert.match(rule('.ws-ph-edhead'), /justify-items:center/);
  assert.match(rule('.ws-ph-edhead'), /text-align:center/);
  assert.match(rule('.ws-ph-edhead h1'), /overflow-wrap:anywhere/);
  assert.doesNotMatch(rule('.ws-ph-edhead h1'), /nowrap|ellipsis/);
});

test('the bar title of the editor never runs under the back capsule or "…"', () => {
  assert.equal(rule('.ws-ph-ednav .ios-nav'), 'grid-template-columns:minmax(max-content,1fr) minmax(0,auto) minmax(max-content,1fr)');
  assert.match(rule('.ws-ph-ednav .ios-nav__title'), /max-width:100%/);
});
