import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

/** The Producten subbar and toolbar: the counts agree, and the desk search never shows a cut placeholder. */
const source = await readFile(new URL('../src/app/features/products/product-list.ts', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles/products/_list.scss', import.meta.url), 'utf8');

test('"Alle" counts on the same basis as "21 producten" and "21 van 21"', () => {
  assert.match(source, /readonly chipTotal = computed\(\(\) => this\.products\(\)\.length\);/);
  assert.match(source, /Alle <span class="pl-chip-count">\{\{ chipTotal\(\) \}\}<\/span>/);
  assert.match(source, /label: `Alle categorieën · \$\{this\.chipTotal\(\)\}`/);
  assert.match(source, /const count = this\.products\(\)\.length;/, 'the subtitle counts every product');
});

test('below 1180 the desk search shows a placeholder that fits its resting width', () => {
  assert.match(source, /readonly roomy = this\.media\('\(min-width: 1180px\)'\);/);
  assert.match(source, /\[placeholder\]="roomy\(\) \? 'Zoek naam, SKU, kleur of barcode' : 'Zoek naam, SKU of barcode'"/);
  /* "Zoek naam, SKU of barcode" needs 170 px; 236 px leaves 174 px inside the field. */
  assert.match(styles, /\(max-width: 1179\.98px\) \{\s*app-product-list \.pl-search \{ width: 236px;/);
});
