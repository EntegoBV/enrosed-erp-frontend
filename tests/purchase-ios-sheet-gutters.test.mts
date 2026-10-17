import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseTemplate } from '@angular/compiler';

/*
 * Inkoop fix round 2: the iOS sheet body has no side padding of its own (its
 * ios-groups bring their own margin), so the plain form content of the
 * new-calculation sheet and the supplier edit form keeps a 16 px gutter on a
 * phone. The desk sheets keep their own padding: the rules sit in a phone
 * media query. Three capsules did not fit a 360 px foot, so on a phone the
 * supplier's Verwijderen is a cell under the form, as on Douane.
 */
const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');
const strip = (scss: string) => scss.replace(/\/\*[\s\S]*?\*\//g, '');
const templateOf = (source: string) => /template: `([\s\S]*?)`,\n  styles:/.exec(source)?.[1] ?? '';

test('the new-calculation sheet pads its body on a phone only', async () => {
  const template = templateOf(await read('../src/app/features/purchasing/purchase-list.ts'));
  assert.equal(parseTemplate(template, 'purchase-list.html').errors, null);
  assert.match(template, /<app-sheet title="Nieuwe inkoopcalculatie" variant="ios" \(closed\)="picking\.set\(false\)">\s*<div body class="pl-new">/);
  const partial = strip(await read('../src/styles/purchase-list.scss'));
  assert.match(partial, /@media \(max-width:679\.98px\)\{app-purchase-list \.sheet--ios \.pl-new\{padding:0 var\(--ios-inset,16px\)\}\}/);
  assert.equal(partial.split('.pl-new{').length - 1, 1, 'no rule outside the phone query');
});

test('the supplier edit form pads its body on a phone only; Verwijderen is a foot button on the desk, a cell on the phone', async () => {
  const template = templateOf(await read('../src/app/features/suppliers/supplier-list.ts'));
  assert.equal(parseTemplate(template, 'supplier-list.html').errors, null);
  const form = /<div class="sup-form">([\s\S]*?)<\/div>\s*@if \(draft\(\)\.id && !desktop\.active\(\)\) \{([\s\S]*?)\n {12}\}/.exec(template);
  assert.ok(form, 'the form wrapper, then the phone-only delete cell');
  assert.match(form[1], /<p class="legend">/);
  assert.equal(form[1].split('<section class="form-section"').length - 1, 3, 'all three numbered sections inside the wrapper');
  assert.match(form[2], /<div class="ios-group sup-delete"><button class="ios-cell ios-cell--danger" type="button" \[disabled\]="saving\(\)" \(click\)="remove\(\)">Verwijderen<\/button><\/div>/);
  const foot = /<div foot style="display:contents">([\s\S]*?)<\/app-sheet>/.exec(template)?.[1] ?? '';
  assert.match(foot, /@if \(draft\(\)\.id && desktop\.active\(\)\) \{\s*<button class="btn btn--danger"[^>]*\s*\(click\)="remove\(\)">Verwijderen<\/button>/);
  assert.equal(template.split('(click)="remove()"').length - 1, 2, 'one Verwijderen per shape');
  const partial = strip(await read('../src/styles/suppliers.scss'));
  assert.match(partial, /@media \(max-width:679\.98px\)\{app-supplier-list \.sheet--ios \.sup-form\{padding:0 var\(--ios-inset,16px\)\}\}/);
  assert.equal(partial.split('.sup-form{').length - 1, 1, 'no rule outside the phone query');
});
