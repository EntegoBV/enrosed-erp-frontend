import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

// Douane fix round 2: in the phone edit sheet Omschrijving was a 170 px input beside its label ('Rozen, vers afgesne…').
const read = (path: string) => readFile(new URL(`../src/app/${path}`, import.meta.url), 'utf8');

test('the phone sheet stacks Omschrijving as a one-line text area across the cell', async () => {
  const page = await read('features/purchasing/douane-page.ts');
  assert.match(page, /<label class="ios-cell dt-field dt-field--stack" for="dt-desc-p">\s*<span class="ios-cell__body"><span class="ios-cell__title">Omschrijving<\/span><\/span>\s*<textarea class="dt-input dt-input--text" id="dt-desc-p" rows="2"[^>]*\(input\)="patch\(\{ description: oneLine\(\$any\(\$event\.target\)\.value\) \}\)" \(keydown\.enter\)="\$event\.preventDefault\(\)"><\/textarea>/);
  const partial = (await readFile(new URL('../src/styles/douane.scss', import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(partial.includes('app-douane-page .dt-sheet .dt-field--stack>.dt-input--text{flex:1 1 100%;width:100%;'), 'beats the 170 px of .dt-sheet .dt-input');
});
