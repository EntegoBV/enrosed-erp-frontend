/*
 * The Verkoop bug fixes on main (2026-10-19), read from the component sources: these screens are Angular
 * components and not node-importable, so the test pins the fixed template and wiring instead.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(`../src/app/features/${path}`, import.meta.url), 'utf8');
const [desk, editor, view, list, revisions, customers] = await Promise.all([
  read('sales/sales-desk.ts'), read('sales/sales-editor.ts'), read('sales/sales-view.ts'), read('sales/sales-list.ts'),
  read('sales/revision-list.ts'), read('customers/customer-list.ts'),
]);

test('V-B4: a freight no-fit reads "Vracht nakijken" on the desk, dots Levering and marks the list total', () => {
  assert.match(desk, /@else if \(data\.priced\.validation\.freightPricingIssue\) \{[\s\S]{0,140}<strong>Vracht nakijken<\/strong>/);
  assert.match(desk, /\[class\.is-warn\]="data\.order\.freight === 'TE_BEPALEN' \|\| !!data\.priced\.validation\.freightPricingIssue"/);
  assert.match(desk, /Levering @if \(data\.order\.freight === 'TE_BEPALEN' \|\| data\.priced\.validation\.freightPricingIssue/);
  assert.match(list, /@if \(row\.priced\.validation\.freightPricingIssue && !creditNoteRow\(row\)\) \{ <small class="warn-text">excl\. vracht<\/small> \}/);
});

test('V-B5: the fixed-version note names the document by its kind', () => {
  const word = /readonly documentWord = computed\(\(\) => \{([\s\S]*?)\}\);/.exec(editor)?.[1] ?? '';
  assert.match(word, /'FACTUUR'\) return 'factuur'/);
  assert.match(word, /'CREDITNOTA'\) return 'creditnota'/);
  assert.match(word, /isWebOrder\(\) \? 'bestelling' : 'offerte'/);
});

test('V-B6/V-B7: the phone view names the tab and loading/error states do not say Offerte', () => {
  assert.match(view, /afterRenderEffect\(\(\) => \{[\s\S]{0,200}tabTitle\.setTitle\(documentTitle\(number\)\)/);
  for (const source of [view, editor]) {
    assert.doesNotMatch(source, /Offerte laden|Offerte niet beschikbaar|offerte kon niet worden/);
  }
  assert.match(view, /title="Document laden"/);
  assert.match(editor, /\[title\]="loadError\(\) \? 'Document niet beschikbaar' : 'Document laden'"/);
});

test('V-B8/V-B9: Klanten shows a load error with retry, and delete escapes the name and reports a refusal', () => {
  assert.match(customers, /<app-load-error \[message\]="error" \[busy\]="loading\(\)" \(retry\)="retryLoad\(\)" \/>/);
  assert.match(customers, /catch \(failure: unknown\) \{\s*this\.loadError\.set\(messageOf\(failure, LOAD_ERROR_FALLBACK\)\);/);
  assert.match(customers, /<b>\$\{escapeHtml\(customer\.company\)\}<\/b> verwijderen\?/);
  assert.match(customers, /this\.ui\.toast\(messageOf\(failure, 'Verwijderen mislukt'\), 'err'\);/);
  assert.doesNotMatch(customers, /function message\(/, 'one message reader: messageOf');
});

test('V-B16: Wijzigingen shows only the skeleton while loading, with real plurals', () => {
  assert.match(revisions, /@if \(loading\(\)\) \{[\s\S]{0,160}<app-skeleton kind="list" \[rows\]="3" \/>\s*\} @else if \(!error\(\)\) \{/);
  assert.doesNotMatch(revisions, /voorstel\(len\)|regel\(s\)/);
});

test('V-B17: KPI tiles, banners and the checklist bring the rail into view', () => {
  const hero = desk.slice(desk.indexOf('<div class="desk-kpis"'), desk.indexOf('<div class="desk-body">'));
  assert.ok(hero.length > 0);
  assert.doesNotMatch(hero, /railTab\.set\(/, 'hero tiles and banners call showRail');
  assert.match(hero, /showRail\('delivery'\)/);
  assert.match(desk, /override scrollToSection[\s\S]{0,300}if \(tab\) this\.showRail\(tab\);/);
  assert.match(desk, /showRail\(tab: RailTab\): void \{[\s\S]{0,400}rail\.scrollIntoView\(\{ block: 'start' \}\)/);
});

test('V-B19: phone Totalen carries the editor\'s discount rows', () => {
  const totals = view.slice(view.indexOf('<dl class="totals-list">'), view.indexOf('</dl>', view.indexOf('<dl class="totals-list">')));
  for (const row of ['<dt>Bruto</dt>', '<dt>Kortingen op regels</dt>', '<dt>Orderkorting', "data.order.extraDiscountLabel || 'Extra korting'"]) {
    assert.ok(totals.includes(row), row);
  }
});

test('V-B24: a credit-note row shows only the parts it holds', () => {
  assert.match(list, /@if \(row\.priced\.lines\.length\) \{ \{\{ row\.priced\.totals\.pieces \| num \}\} st · /);
  assert.match(list, /@if \(row\.priced\.lines\.length && \(row\.order\.extraLines \?\? \[\]\)\.length\) \{ · \}/);
});
