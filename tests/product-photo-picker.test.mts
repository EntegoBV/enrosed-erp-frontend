import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/app/features/products/product-photo-picker.ts', import.meta.url), 'utf8');
const template = source.slice(source.indexOf('template: `'), source.indexOf('styles: `'));

/** The text of one class method, from its signature to the next member. */
function method(name: string): string {
  const start = source.search(new RegExp(`\\n  (?:private )?${name}\\(`));
  assert.notEqual(start, -1, `${name} exists`);
  const end = source.indexOf('\n  }\n', start);
  return source.slice(start, end);
}

test('a choice is saved by activation only: keys that move or step never emit one', () => {
  for (const name of ['moveFocus', 'onKey', 'step', 'openCompare', 'closeCompare']) {
    assert.doesNotMatch(method(name), /picked\.emit|cleared\.emit|uploadRequested\.emit/, `${name} must not save`);
  }
  assert.doesNotMatch(template, /role="(?:radio|radiogroup|listbox|option)"/, 'The candidates are plain buttons');
  assert.doesNotMatch(template, /\(keydown[^)]*\)="[^"]*emit/, 'No key handler in the template saves');
  assert.equal(template.match(/picked\.emit\(/g)?.length, 2, 'Only the pick button and "Gebruik deze foto" choose');
});

test('"Bekijk groot" is a sibling of the pick button and tells the panel every time it opens', () => {
  const pick = template.indexOf('class="pk-tile__pick"');
  const pickEnd = template.indexOf('</button>', pick);
  const zoom = template.indexOf('class="pk-tile__zoom"');
  assert.ok(pick !== -1 && pickEnd > pick && zoom > pickEnd, 'The zoom button stands after the closed pick button');
  assert.match(template.slice(zoom, template.indexOf('</button>', zoom)), /\[attr\.aria-label\]="compareLabel"/);
  assert.match(method('openCompare'), /compareOpened\.emit\(\)/);
  assert.match(template, /appAuthSize="medium" appAuthKeepSize[^>]*>/, 'Both compare pictures ask for the large rendition on every device');
  assert.equal(template.match(/appAuthKeepSize/g)?.length, 2);
});

test('Escape in "Bekijk groot" is kept from the sheet, and a dropped file only becomes a photo where the upload bar is', () => {
  assert.match(method('onKey'), /stopImmediatePropagation\(\)/);
  assert.match(method('acceptsDrop'), /texts\(\)\.upload !== null && !this\.busy\(\) && !this\.compare\(\)/);
  assert.doesNotMatch(source, /TODO\(photos-round\)/);
});
