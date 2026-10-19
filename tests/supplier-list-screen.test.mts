import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseTemplate } from '@angular/compiler';

// Leveranciers (Inkoop redesign I7): calm after a save, one Bewerken in the phone sheet, the search whole at 1100.
const list = await readFile(new URL('../src/app/features/suppliers/supplier-list.ts', import.meta.url), 'utf8');
const template = /template: `([\s\S]*?)`,\n  styles:/.exec(list)?.[1] ?? '';
const partial = await readFile(new URL('../src/styles/suppliers.scss', import.meta.url), 'utf8');

test('the skeleton shows on the first load only; a save or delete refreshes the table and detail in place', () => {
  assert.ok(template.length > 1000);
  assert.equal(parseTemplate(template, 'supplier-list.html').errors, null);
  assert.equal(template.split('@else if (loading() && !suppliers().length) {').length - 1, 2, 'desk and phone');
  assert.doesNotMatch(template, /@else if \(loading\(\)\) \{/);
});

test('the phone sheet has one Bewerken: the primary at its foot', () => {
  const body = (/<div class="sup-capsules">([\s\S]*?)<\/div>/.exec(template)?.[1] ?? '').replace(/<!--[\s\S]*?-->/g, '');
  assert.match(body, /Nieuwe calculatie/);
  assert.doesNotMatch(body, /Bewerken/);
  assert.match(template, /<button class="btn btn--primary" type="button" \(click\)="editMode\.set\(true\)">\s*Bewerken\s*<\/button>/);
});

test('the desk search keeps 280 px below 1101 px: at 240 the key cap covered the end of the placeholder', () => {
  assert.match(partial, /app-supplier-list \.sup-search\{flex:none;width:280px\}/);
  assert.doesNotMatch(partial.replace(/\/\*[\s\S]*?\*\//g, ''), /\.sup-search\{width:2[0-7]\dpx\}/);
});

test('the subtitle says nothing while the list loads or failed, never a false "0 leveranciers" (I-B14)', () => {
  assert.match(template, /<app-page-header [^>]*\[subtitle\]="subtitle\(\)">/);
  assert.doesNotMatch(template, /suppliers\(\)\.length \+ ' leveranciers'/);
  assert.match(list, /const NOT_KNOWN_YET = '\\u00a0';/);
  assert.match(list, /readonly subtitle = computed\(\(\) => \(this\.loading\(\) && !this\.suppliers\(\)\.length\) \|\| this\.loadError\(\)\s*\? NOT_KNOWN_YET : `\$\{this\.suppliers\(\)\.length\} leveranciers`\);/);
});
