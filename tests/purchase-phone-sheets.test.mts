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

test('the document sheet\'s selects are pop-ups with a chevron, like Inklaring, not text fields', async () => {
  const editor = await read('purchase-editor.ts');
  for (const id of ['doc-kind', 'doc-payment']) {
    assert.match(editor, new RegExp(`<span class="mpo-pick mpo-pick--wide"><select class="mpo-select" id="${id}"[\\s\\S]*?</select><app-icon name="chevron-down" \\[size\\]="14" /></span>`), id);
  }
  assert.doesNotMatch(editor, /<select class="mpo-input/, 'mpo-input draws no chevron (appearance none, no background)');
});

test('the quote, partner, Enrosed kost and PDF sheets open as iOS sheets where the phone opens them, with a phone gutter (I-B25)', async () => {
  const editor = await read('purchase-editor.ts');
  const view = await read('purchase-view.ts');
  for (const [source, tags] of [[view, ['quote-sheet', 'partner-sheet', 'pdf-sheet']], [editor, ['quote-sheet', 'extra-split', 'partner-sheet', 'pdf-sheet']]] as const) {
    for (const tag of tags) {
      const opened = source.split(`<app-purchase-${tag} `).slice(1);
      assert.ok(opened.length >= 1, tag);
      for (const rest of opened) assert.ok(rest.startsWith('variant="ios" '), `${tag} without variant="ios"`);
    }
  }
  const sheets = { 'purchase-quote-sheet.ts': '.pq', 'purchase-partner-sheet.ts': '.pp', 'purchase-extra-split.ts': '.xs', 'purchase-pdf-sheet.ts': '.pdf-body' };
  for (const [file, body] of Object.entries(sheets)) {
    const source = await read(file);
    assert.match(source, /<app-sheet [^>]*\[variant\]="variant\(\)"/, file);
    assert.match(source, /readonly variant = input<'default' \| 'ios'>\('default'\);/, file);
    assert.ok(source.includes(`<div body class="${body.slice(1)}`), `${file} body ${body}`);
  }
  // The desk keeps its dialogs: it never passes the variant.
  const desk = await read('purchase-desk.ts');
  assert.doesNotMatch(desk, /<app-purchase-(quote-sheet|partner-sheet|extra-split|pdf-sheet) variant=/);
  const partial = (await readFile(new URL('../src/styles/purchase-phone.scss', import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = ':is(app-purchase-view,app-purchase-editor) .sheet--ios :is(.pq,.pp,.xs,.pdf-body){padding:0 var(--ios-inset,16px)}';
  assert.ok(partial.includes(rule));
  assert.ok(partial.indexOf(rule) > partial.indexOf('@media (max-width:679.98px){'), 'inside the phone query');
});

test('the phone Ordernummer is fixed from Besteld on: a disabled field with a short note, and setNumber writes nothing (I-B5)', async () => {
  const editor = await read('purchase-editor.ts');
  assert.match(editor, /<span class="ios-cell__body"><span class="ios-cell__title">Ordernummer<\/span>\s*@if \(numberLocked\(\)\) \{ <span class="ios-cell__sub mpo-wrap">Ligt vast sinds de bestelling<\/span> \}<\/span>/);
  assert.match(editor, /id="po-number"[^>]*\[disabled\]="numberLocked\(\)" \(change\)="setNumber\(numberInput\)"/);
  assert.match(editor, /readonly numberLocked = computed\(\(\) => orderNumberLocked\(this\.view\(\)\?\.order\.status\)\);/);
  assert.match(editor, /setNumber\(field: HTMLInputElement\): void \{\s*const value = field\.value\.trim\(\);\s*if \(this\.numberLocked\(\)\) field\.value = this\.view\(\)\?\.order\.number \?\? '';\s*else if/);
});

test('the Overzicht card follows the dock\'s step (readNextStep), not the status alone (I-B6)', async () => {
  const view = await read('purchase-view.ts');
  // The card also counts the products that carry an older cost of this container (cost-fix Q2).
  assert.match(view, /@let card = nextStepCard\(readStep\(\), data\.costing\.lines\.length, costsStaleNow\(\)\.count, stockBatches\(\)\?\.started === true\);\s*<h3 id="mpo-actions-title">\{\{ card\.title \}\}<\/h3>\s*<p>\{\{ card\.text \}\}<\/p>/);
  assert.doesNotMatch(view, /actionTitle\(|actionDescription\(/);
});
