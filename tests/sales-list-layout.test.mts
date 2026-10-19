import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseTemplate } from '@angular/compiler';

/*
 * The Verkoop list on the Inkoop recipe (2026-10-19), read from the component
 * source (not node-importable): the desk's kit building blocks, no count or
 * sum before the documents are known, ⋯ outside the row link and no link
 * inside it, the Inhoud fold, the folds and the keys, the area stylesheet.
 */
const source = await readFile(new URL('../src/app/features/sales/sales-list.ts', import.meta.url), 'utf8');
const partial = (await readFile(new URL('../src/styles/sales-list.scss', import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
const template = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(source)?.[1] ?? '';
const desk = template.slice(0, template.indexOf('} @else {\n      <div class="content sl--phone">'));
const deskRow = /<ng-template #deskRow[\s\S]*?<\/ng-template>/.exec(template)?.[0] ?? '';
const member = (name: string) => new RegExp(`\\n  (?:private |readonly |private readonly |static )*${name}\\b[\\s\\S]*?\\n  \\}`).exec(source)?.[0] ?? '';

test('the template parses and splits into a desk and a phone branch on DesktopViewport', () => {
  assert.equal(parseTemplate(template, 'sales-list.html').errors, null);
  assert.ok(desk.includes('@if (desktop.active()) {\n      <div class="content sl">'), 'the desk branch');
  assert.ok(template.includes('<div class="content sl--phone">'), 'the phone branch');
  assert.match(source, /readonly desktop = inject\(DesktopViewport\);/);
});

test('the area stylesheet rides the lazy chunk through an empty component, every rule under app-sales-list', () => {
  assert.match(source, /selector: 'app-sales-list-styles',[\s\S]*?encapsulation: ViewEncapsulation\.None,[\s\S]*?template: '',\s*styleUrl: '\.\.\/\.\.\/\.\.\/styles\/sales-list\.scss',/);
  assert.ok(template.trimStart().startsWith('<app-sales-list-styles />'));
  const selectors = partial.replace(/@(media|container)[^{]*\{/g, '').split('}').map((rule) => rule.split('{')[0].trim()).filter(Boolean);
  for (const selector of selectors) {
    for (const part of selector.split(',')) assert.match(part.trim(), /^app-sales-list(\s|$|\{)/, part);
  }
});

test('the desk is the kit list: toolbar tabs and search, the subbar, one table with a group per customer', () => {
  for (const piece of ['<app-segmented class="sl-tabs" label="Documenten" semantics="tabs" controls="sales-document-results"',
    'data-page-search', '<kbd class="wk-kbd" aria-hidden="true">/</kbd>', '(keydown.escape)="escapeSearch($event)"', 'id="sales-search"',
    '<div #subbar class="wk-subbar sl-subbar">', '<div class="wk-table sl-table"', 'id="sales-document-results" role="table"',
    '<div class="wk-group sl-group" role="row">', '<app-skeleton kind="table" [rows]="8" />', '<app-load-error ', 'ngTemplateOutlet="emptyState"']) {
    assert.ok(desk.includes(piece), piece);
  }
  assert.doesNotMatch(template, /Klant wacht op ons|app-sales-document-navigation|sales-filterbar/, 'the old card and navigation are gone from both branches');
  assert.match(template, /<app-context-menu class="sl-menu" \[title\]="rowMenuTitle\(menu\.row\)" \[items\]="rowMenuItems\(menu\.row\)" \[anchor\]="menu\.anchor"\s+variant="ios" cancelLabel="Annuleren"/);
});

test('no count or sum before the documents are known (V-L1), and no "orders" for offertes and facturen', () => {
  assert.match(source, /readonly ready = computed\(\(\) => !this\.loadError\(\) && \(!this\.loading\(\) \|\| this\.all\(\)\.length > 0\)\);/);
  assert.match(source, /const NOT_KNOWN_YET = '\\u00a0';/);
  assert.match(template, /<app-page-header title="Verkoop" \[subtitle\]="desktop\.active\(\) \? deskSubtitle\(\) : phoneCaption\(\)">/);
  assert.doesNotMatch(source, /' orders'/);
  assert.match(source, /readonly deskSubtitle = computed\(\(\) => this\.ready\(\)\s*\? countText\([\s\S]*?\) : NOT_KNOWN_YET\);/);
  assert.match(source, /readonly phoneCaption = computed\(\(\) => \{\s*if \(!this\.ready\(\)\) return NOT_KNOWN_YET;/);
  assert.match(source, /count: ready \? counts\[id\] : null/);
  const end = /@if \(ready\(\)\) \{\s*<span class="wk-subbar__end sl-subbar__end">([\s\S]*?)<\/span>\s*\}\n/.exec(desk);
  assert.ok(end, 'the end of the subbar sits inside @if (ready())');
  for (const figure of ['rows().length', 'pile().length', 'shownMoney().offerEur', 'shownMoney().openEur', 'shownMoney().overdueEur']) assert.ok(end[1].includes(figure), figure);
  assert.equal(template.split('shownMoney()').length - 1, end[1].split('shownMoney()').length - 1, 'no sum outside the guarded end');
  assert.match(desk, /\{\{ chip\.label \}\} @if \(ready\(\)\) \{ <span class="wk-seg__count">\{\{ chip\.count \}\}<\/span> \}/);
});

test("'n van m' counts the tab pile after the docs filter, in the docs word (V-L2)", () => {
  assert.match(member('pile = computed'), /this\.inTab\(\)/);
  assert.match(member('searched = computed'), /return this\.pile\(\)\.filter/);
  assert.match(template, /\{\{ rows\(\)\.length \}\}<\/strong> van \{\{ pile\(\)\.length \}\} \{\{ pileWord\(\) \}\}/);
  assert.doesNotMatch(template, /docCount\(docTab\(\)\)/);
});

test('⋯ sits outside the row link and no link sits inside one (V-L3); the targets are row-menu items', () => {
  const link = /<a class="wk-tr wk-tr--link swipe__row sl-row"[\s\S]*?<\/a>/.exec(deskRow)?.[0] ?? '';
  assert.ok(link, 'the desk row link');
  assert.doesNotMatch(link.slice(2), /<a\s|<button\s/, 'nothing interactive inside the desk row link');
  assert.match(deskRow, /<\/a>\s*<button class="wk-btn wk-btn--ghost wk-btn--sm wk-btn--icon sl-more" type="button" aria-haspopup="menu"/);
  assert.match(deskRow, /<app-icon name="more" \[size\]="16" \/>/);
  const phoneRow = /<a class="ios-cell swipe__row sl-prow"[\s\S]*?<\/a>/.exec(template)?.[0] ?? '';
  assert.ok(phoneRow, 'the phone row link');
  assert.doesNotMatch(phoneRow.slice(2), /<a\s|<button\s|so-link/, 'nothing interactive inside the phone row link either');
  for (const id of ["'quote'", "'invoice'", "'credited'", "'split'", "'archive'", "'delete'"]) assert.ok(member('rowMenuItems').includes(`id: ${id}`), id);
});

test('the template reads the kind off the row (V-L5): documentLabel stays for the actions only', () => {
  assert.doesNotMatch(template, /documentLabel\(/);
  assert.match(source, /documentLabelOf\(row: SalesOrderView\): string \{\s*return billingKind\(row\) \?\? salesDocumentKind\(row\.order, row\.settlement\?\.finalSettlement\);/);
});

test('the swipe buttons are invisible unless open, dragged or focused, and a focused archive button shows (V-L4)', () => {
  assert.ok(partial.includes('app-sales-list .swipe>.swipe__archive,app-sales-list .swipe>.swipe__delete{opacity:0}'));
  for (const shown of ['app-sales-list .swipe--open>.swipe__delete', 'app-sales-list .swipe--open-start>.swipe__archive', 'app-sales-list .swipe>.swipe__archive:focus-visible']) {
    assert.ok(partial.includes(shown), shown);
  }
  assert.ok(partial.includes('app-sales-list .swipe:has(>.swipe__archive:focus-visible) .swipe__row{transform:translateX(76px)}'));
});

test('below an 860 px card the Inhoud column folds into the Document sub: the same template, shown only in the query', () => {
  const outlet = '<ng-container *ngTemplateOutlet="inhoud; context: { $implicit: row }" />';
  assert.equal(deskRow.split(outlet).length - 1, 2, 'the Inhoud cell and the fold render one template');
  assert.match(deskRow, new RegExp(`<span class="sl-inhoud-inline"> · ${outlet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</span>`));
  assert.match(deskRow, /role="cell" data-hide="sm"><ng-container \*ngTemplateOutlet="inhoud; context: \{ \$implicit: row \}" \/><\/span>/);
  const hidden = partial.indexOf('app-sales-list .sl-inhoud-inline{display:none}');
  const query = partial.indexOf('@container wk-pane (max-width:859.98px){');
  const shown = partial.indexOf('app-sales-list .sl-inhoud-inline{display:inline}');
  assert.ok(hidden >= 0 && query > hidden && shown > query, 'hidden before the query that shows it');
  assert.equal(partial.split('.sl-inhoud-inline{').length - 1, 2);
});

test('the Inhoud keeps the credit-note parts and the margin stays off credit notes and partner documents', () => {
  const inhoud = /<ng-template #inhoud let-row>[\s\S]*?<\/ng-template>/.exec(template)?.[0] ?? '';
  assert.match(inhoud, /@if \(creditNoteRow\(row\)\) \{[\s\S]*?@if \(row\.priced\.lines\.length\) \{ \{\{ row\.priced\.totals\.pieces \| num \}\} st · /);
  const creditPart = inhoud.slice(0, inhoud.indexOf('} @else if (partner(row.order))'));
  assert.doesNotMatch(creditPart, /marge/);
  const partnerPart = inhoud.slice(inhoud.indexOf('} @else if (partner(row.order))'), inhoud.indexOf('} @else {'));
  assert.doesNotMatch(partnerPart, /marge/);
});

test('partner-container and split heads sit inside their customer with every figure, on the columns', () => {
  const heads = desk.slice(desk.indexOf("@if (entry.kind === 'PARTNER_CONTAINER')"), desk.indexOf("<ng-container *ngTemplateOutlet=\"deskRow; context: { $implicit: entry.row, nested: false }\" />"));
  for (const figure of ['entry.summary.count', 'entry.summary.containerPieces', 'entry.summary.statuses', 'status.concept', 'status.inactive',
    'entry.summary.attentionCount', 'entry.summary.totalEur', 'entry.summary.draftEur', 'entry.summary.receivedEur', 'entry.summary.remainingEur',
    'entry.summary.creditEur', 'entry.purchaseOrderName', 'entry.purchaseOrderNumber', 'entry.summary.parts', 'entry.summary.pieces',
    'entry.summary.unavailableCount', 'entry.summary.waitingCount', 'entry.summary.shippedCount', 'Leveringen gepland',
    'De facturen hieronder volgen je huidige filters.', 'Elk deel heeft een eigen document- en leverstatus.', 'openContainerMenu($event, entry)']) {
    assert.ok(heads.includes(figure), figure);
  }
  assert.ok(partial.includes('app-sales-list .sl-head .sales-container__toggle{display:grid;grid-column:1/-1;grid-template-columns:subgrid;'));
});

test('customer folds are remembered on this device and restored in the constructor, never in load()', () => {
  assert.match(source, /private static readonly FOLD_KEY = 'enrosed\.verkoop\.folded';/);
  const constructor = /\n  constructor\(\) \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? '';
  assert.match(constructor, /this\.restoreFolds\(\);/);
  assert.doesNotMatch(member('async load'), /restoreFolds|foldedIds/);
});

test('the desk keys: / the search, N a new document, ↑/↓ between the rows; Shift+F10 stays with the directive', () => {
  const keys = member('onListKey');
  assert.match(source, /@HostListener\('document:keydown', \['\$event'\]\)\n  onListKey\(event: KeyboardEvent\): void \{/);
  assert.match(keys, /keyContext\(event, this\.host\.nativeElement\)/);
  assert.match(keys, /event\.key === '\/'[\s\S]*?this\.searchField\(\)\?\.nativeElement\.focus\(\)/);
  assert.match(keys, /event\.key === 'n' \|\| event\.key === 'N'[\s\S]*?this\.startNew\(\)/);
  assert.match(keys, /querySelectorAll<HTMLElement>\('\.sl-row'\)/);
  assert.doesNotMatch(source, /active\.hold = setTimeout/);
});
