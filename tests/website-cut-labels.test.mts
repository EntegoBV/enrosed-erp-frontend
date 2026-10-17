import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { featuredChoiceText } from '../src/app/features/website-builder/website-categories-view.ts';

const read = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
const form = await read('app/features/website-builder/website-category-form.ts');
const builder = await read('app/features/website-builder/website-builder-page.ts');
const productsCss = (await read('styles/website-products.scss')).replace(/\/\*[\s\S]*?\*\//g, '');
const categoriesCss = (await read('styles/website-categories.scss')).replace(/\/\*[\s\S]*?\*\//g, '');

const choices = [
  { id: 60, label: 'Rose in Dome 20 cm rood · Geen kleur — DOME-20-0' },
  { id: 61, label: 'Rose in Dome 20 cm wit · Geen kleur — DOME-20-1' },
];

test('the uitgelicht select carries the chosen product in full', () => {
  assert.equal(featuredChoiceText(choices, 60, false, null), 'Rose in Dome 20 cm rood · Geen kleur — DOME-20-0');
  assert.equal(featuredChoiceText(choices, null, false, null), 'Geen uitgelicht product');
});

test('a choice the list cannot show gets the text of the option the select shows instead', () => {
  assert.equal(featuredChoiceText([], 60, true, null), 'Huidige keuze #60 · productgegevens niet geladen');
  assert.equal(featuredChoiceText(choices, 99, false, 99), 'Product #99 · geen publieke foto');
  assert.equal(featuredChoiceText(choices, 99, false, null), '');
  /* a listed product wins over the locked fallback, as in the select */
  assert.equal(featuredChoiceText(choices, 61, true, null), 'Rose in Dome 20 cm wit · Geen kleur — DOME-20-1');
});

test('the select ends a long label in "…" and shows it in full as its title', () => {
  assert.match(form, /<select class="select ws-cf__featured" [^>]*\[attr\.title\]="featuredText\(\) \|\| null"/);
  assert.match(categoriesCss, /\.ws-cf__featured\{overflow:hidden;text-overflow:ellipsis;white-space:nowrap\}/);
});

test('the phone reeks sheet title gets two lines, so "(Review)" stays readable', () => {
  const match = /\.sheet--ios:has\(\.ws-sheet\) \.sheet__head h2\{([^}]*)\}/.exec(productsCss);
  assert.ok(match, 'scoped to the website reeks sheet');
  assert.match(match[1], /-webkit-line-clamp:2/);
  assert.match(match[1], /white-space:normal/);
});

test('text-group labels in the phone Homepage block view wrap to two lines', () => {
  assert.match(builder, /<span class="ios-cell__title ios-cell__title--2">\{\{ labelOf\(group\) \}\}<\/span>/);
  assert.doesNotMatch(builder, /<span class="ios-cell__title">\{\{ labelOf\(group\) \}\}<\/span>/);
});
