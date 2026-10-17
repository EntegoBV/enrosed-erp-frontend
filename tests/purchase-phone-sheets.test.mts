import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

// Inkoop redesign I5 (2026-10-17): the phone purchase order's iOS sheets, the receive rows and the Overzicht figures.
const read = (path: string) => readFile(new URL(`../src/app/features/purchasing/${path}`, import.meta.url), 'utf8');

test('the phone sheets are iOS sheets; the receive rows put "besteld n" first; the Overzicht keeps every figure', async () => {
  const editor = await read('purchase-editor.ts');
  const view = await read('purchase-view.ts');
  assert.match(editor, /<app-sheet title="Container ontvangen" variant="ios" \(closed\)="receiving\.set\(null\)">/);
  assert.match(editor, /<app-sheet title="Document toevoegen" variant="ios" \(closed\)="closeDocument\(\)">/);
  assert.match(editor, /<app-sheet title="Schade of tekort" variant="ios" \(closed\)="issue\.set\(null\)">/);
  assert.match(view, /<app-sheet title="Schade of tekort" variant="ios" \(closed\)="issue\.set\(null\)">/);
  assert.match(editor, /<span class="mpo-rline__sub"><b>besteld \{\{ line\.ordered \| num \}\}<\/b>/);
  assert.match(editor, /De titel van deze container in de hele ERP\./);
  assert.match(view, /@if \(!data\.order\.partnerCustomerId\) \{\s*<button class="ios-cell" type="button" \[disabled\]="!quoteLinesOf\(data\)\.length"/);
  assert.match(view, /<div class="mpo-fillrow"><small>Vulling<\/small>/);
  assert.match(view, /\{\{ ladingWord\(\) \}\} · \{\{ data\.costing\.totals\.cartons \| num \}\} dozen/);
});
