import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, access } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { parseTemplate } from '@angular/compiler';

/*
 * The Verkoop list on the phone (Inkoop recipe, 2026-10-19), read from the
 * component source: the segmented tabs and one search row whose round button
 * opens one Filters sheet, a chips row only when something applies, an inset
 * section per customer with the partner and split heads as disclosure cells,
 * the rows' trail, the same swipe, long press and menu, and the iOS
 * new-document sheet. The "Klant wacht op ons" card and the old navigation
 * are gone. The badge, the chips row and Filters wissen run isolated.
 */
const source = await readFile(new URL('../src/app/features/sales/sales-list.ts', import.meta.url), 'utf8');
const partial = (await readFile(new URL('../src/styles/sales-list.scss', import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
const template = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(source)?.[1] ?? '';
const phone = template.slice(template.indexOf('<div class="content sl--phone">'), template.indexOf('<ng-template #emptyState>'));
const phoneRow = /<ng-template #phoneRow[\s\S]*?<\/ng-template>/.exec(template)?.[0] ?? '';
const sheet = /@if \(filtersOpen\(\)\) \{[\s\S]*?<\/app-sheet>/.exec(template)?.[0] ?? '';
const member = (name: string) => new RegExp(`\\n  (?:private |readonly |private readonly |static )*${name}\\b[\\s\\S]*?\\n  \\}`).exec(source)?.[0] ?? '';

test('the phone branch is the kit list: segmented tabs, one search row with the round filter button, then sections', () => {
  assert.equal(parseTemplate(template, 'sales-list.html').errors, null);
  assert.ok(phone.length > 0 && phoneRow && sheet, 'the phone branch, its row and its sheet');
  for (const piece of ['<app-segmented variant="ios" class="sl-tabs" label="Documenten" semantics="tabs" controls="sales-document-results" [options]="tabOptions()"',
    '<div class="ios-search sl-isearch">', 'id="sales-search"', 'data-page-search', 'aria-label="Zoek klant, documentnummer of containerreferentie"',
    "[placeholder]=\"smallPhone() ? 'Zoek klant of nummer' : 'Zoek klant, factuur of container'\"",
    '<button class="sl-filter" type="button" aria-haspopup="dialog"', '(click)="filtersOpen.set(true)"',
    '<span class="sl-filter__badge" aria-hidden="true">', '<app-load-error ', '<app-skeleton kind="group" [rows]="5" />', 'ngTemplateOutlet="emptyState"',
    'id="sales-document-results" role="tabpanel"', '<section class="ios-section sl-section">', '<span class="sl-customer" role="heading" aria-level="2">{{ section.name }}</span><span class="ios-section__trail">{{ section.count }}</span>',
    '<div class="ios-group">']) {
    assert.ok(phone.includes(piece), piece);
  }
  assert.doesNotMatch(phone.slice(0, phone.indexOf('@if (loadError()')), /<select/, 'no native picker or filter row above the documents');
  assert.match(source, /\['\(max-width: 374px\)', this\.smallPhone\]/);
});

test('the old card list is gone: no "Klant wacht op ons", no navigation component, no card rows', async () => {
  assert.doesNotMatch(template, /Klant wacht op ons|app-sales-document-navigation|sales-filterbar|class="list-item|sales-load-error|filter-toggle|website-filter/);
  assert.doesNotMatch(source, /SalesDocumentNavigation|openWork|workIcon|attentionCount = computed/);
  await assert.rejects(access(new URL('../src/app/features/sales/sales-document-navigation.ts', import.meta.url)), 'the component file is deleted');
  const styles = /styles:\s*`([\s\S]*?)`,\n\}\)/.exec(source)?.[1] ?? '';
  assert.doesNotMatch(styles, /sales-container__(header|identity|totals|invoices|tools)|so-status-mini|so-source-mini|search-control|filter-grid/, 'no dead inline CSS');
  assert.match(styles, /\.swipe--dragging \.swipe__row \{ transform:translateX\(var\(--swipe-offset, 0px\)\);transition:none \}/);
  assert.match(styles, /@media\(pointer:coarse\)\{\[appSalesMenu\]\{-webkit-touch-callout:none;user-select:none\}\}/);
});

test('the Filters sheet holds Soort verkoop, Status with counts, the Facturen choices and Klant; Filters wissen and Klaar', () => {
  assert.match(sheet, /<app-sheet variant="ios" title="Filters" \(closed\)="filtersOpen\.set\(false\)">/);
  for (const head of ['<h2>Soort verkoop</h2>', '<h2>Status</h2>', '<h2>Facturen</h2>', '<h2>Klant</h2>']) assert.ok(sheet.includes(head), head);
  assert.match(sheet, /@for \(option of scopeOptions; track option\.id\)[\s\S]*?\[attr\.aria-checked\]="businessScope\(\) === option\.id"/);
  assert.match(sheet, /<p class="ios-section__foot">\{\{ scopeHint\(\) \}\}<\/p>/);
  assert.match(sheet, /@for \(chip of chips\(\); track chip\.value\)[\s\S]*?\(click\)="selectStatus\(chip\.value\)"[\s\S]*?@if \(ready\(\)\) \{ <span class="ios-cell__value">\{\{ chip\.count \}\}<\/span> \}/);
  const facturen = sheet.slice(sheet.indexOf("@if (docTab() === 'FACTUUR')"), sheet.indexOf('<h2>Klant</h2>'));
  assert.match(facturen, /Alleen nog te ontvangen[\s\S]*?\(change\)="filterOutstanding\(\$any\(\$event\.target\)\.checked\)"/);
  assert.match(facturen, /Inclusief openstaande facturen en creditnota’s met een tegoed in het archief\./);
  assert.match(facturen, /@for \(option of docsOptions\(\); track option\.id\)[\s\S]*?\(click\)="filterDocs\(option\.id\)"/);
  assert.match(sheet, /<select class="sl-select__native" aria-label="Filter op klant" \[ngModel\]="customerFilter\(\)" \(ngModelChange\)="customerFilter\.set\(\$event\)">/);
  assert.match(sheet, /@if \(sheetFilterCount\(\)\) \{ <button class="btn" type="button" \(click\)="clearSheetFilters\(\)">Filters wissen<\/button> \}/);
  assert.match(sheet, /<button class="btn btn--primary" type="button" \(click\)="filtersOpen\.set\(false\)">Klaar<\/button>/);
  assert.match(sheet, /@if \(ready\(\)\) \{ <p class="sl-fcount" aria-live="polite"><strong>\{\{ rows\(\)\.length \}\}<\/strong> van \{\{ pile\(\)\.length \}\} \{\{ pileWord\(\) \}\}<\/p> \}/);
});

test('a chips row only when something applies: Actie vereist, Website and In verwerking te nemen, Nog te ontvangen once on', () => {
  assert.match(phone, /@if \(phoneChips\(\); as quick\) \{\s*<div class="ios-chips sl-ichips" role="group" aria-label="Snelfilters">/);
  for (const chip of ['(click)="pickAttention()">Actie vereist', 'Website <span class="ios-chip__badge">{{ websiteRequests().length }}</span>',
    'In verwerking te nemen <span class="ios-chip__badge">{{ ordersToTake().length }}</span>', '(click)="filterOutstanding(false)">Nog te ontvangen']) {
    assert.ok(phone.includes(chip), chip);
  }
});

test('partner containers and split orders are disclosure cells inside their customer, every figure kept', () => {
  const heads = phone.slice(phone.indexOf("@if (entry.kind === 'PARTNER_CONTAINER')"), phone.indexOf('<ng-container *ngTemplateOutlet="phoneRow; context: { $implicit: entry.row, nested: false }" />'));
  assert.match(heads, /<button class="ios-cell sl-phead" type="button"\s+appSalesMenu [\s\S]*?\(salesMenu\)="openContainerMenu\(null, entry\)" aria-haspopup="dialog" aria-describedby="sales-menu-help"/);
  assert.equal(heads.split('(click)="toggleGroup(entry.key)"').length - 1, 2);
  assert.equal(heads.split('[attr.aria-expanded]="groupOpen(entry.key)"').length - 1, 2);
  for (const figure of ['entry.summary.count', 'entry.summary.containerPieces', 'entry.summary.statuses', 'status.concept', 'status.inactive',
    'entry.summary.attentionCount', 'entry.summary.totalEur', 'entry.summary.draftEur', 'entry.summary.receivedEur', 'entry.summary.remainingEur',
    'entry.summary.creditEur', 'entry.purchaseOrderName', 'entry.purchaseOrderNumber', 'entry.summary.parts', 'entry.summary.pieces',
    'entry.summary.unavailableCount', 'entry.summary.waitingCount', 'entry.summary.shippedCount', 'Leveringen gepland',
    'De facturen hieronder volgen je huidige filters.', 'Elk deel heeft een eigen document- en leverstatus.']) {
    assert.ok(heads.includes(figure), figure);
  }
  assert.equal(heads.split('<ng-container *ngTemplateOutlet="phoneRow; context: { $implicit: row, nested: true }" />').length - 1, 2);
  assert.ok(partial.includes('app-sales-list .sl-phead[aria-expanded=true] .sl-pchev{transform:rotate(90deg)}'));
  assert.ok(partial.includes('app-sales-list .sl-swipe--nested>.sl-prow{padding-left:32px}'));
});

test('the phone row: the number, kind · date and tags, the facts and the amber line; the trail with total, status and what is open', () => {
  assert.match(phoneRow, /<div class="swipe sl-swipe" role="none" \[class\.sl-swipe--nested\]="nested"\s+\[animate\.leave\]="leavingId\(\) === row\.order\.id \? 'mo-leave' : ''"/);
  const link = /<a class="ios-cell swipe__row sl-prow"[\s\S]*?<\/a>/.exec(phoneRow)?.[0] ?? '';
  assert.ok(link, 'the row link');
  for (const piece of ['[routerLink]="[\'/sales\', row.order.id]"', 'appSalesMenu', '(salesMenu)="openRowMenu(null, row)"', 'aria-describedby="sales-menu-help"',
    '(pointerdown)="startSwipe($event, row)"', '(wheel)="wheelSwipe($event, row)"', '(click)="blockWhenSwiped($event)"',
    '<span class="sl-ptitle">{{ row.order.number }}</span>', '{{ documentLabelOf(row) }} · {{ row.order.orderDate | dateNl }}',
    '<span class="sl-tag">Partner</span>', '<span class="sl-pattn"><b>{{ attn.length }}</b>',
    "{{ creditNoteRow(row) ? '− ' : '' }}{{ row.priced.totals.total | eur: (row.fulfillment || partner(row.order) ? 2 : 0) }}",
    '@if (row.priced.validation.freightPricingIssue && !creditNoteRow(row)) { <small class="warn-text">excl. vracht</small> }',
    '<span class="wk-pill" [class]="salesTone(status.cls)">{{ status.label }}</span>']) {
    assert.ok(link.includes(piece), piece);
  }
  assert.doesNotMatch(link.slice(2), /<a\s|<button\s/, 'nothing interactive inside the row link');
  assert.match(link, /@case \('open'\) \{ <span class="sl-pline sl-pline--open" \[class\.sl-warn\]="lines\.trail\.overdue">\{\{ pay\.openEur \| eur \}\} open<\/span> \}/);
  assert.match(link, /@case \('credit'\) \{ <span class="sl-pline sl-credit">\{\{ lines\.trail\.text \}\}<\/span> \}/);
  assert.match(link, /@let day = dayParts\(lines\.trail\.text\);\s*<span class="sl-pline sl-pline--day"[^>]*>\{\{ day\.lead \}\}<span class="sl-nw">\{\{ day\.day \}\}<\/span><\/span>/);
  assert.doesNotMatch(link, /marge|cbm|sl-more/, 'Inhoud and marge leave the phone row; no ⋯ on the phone');
  assert.match(phoneRow, /@if \(canArchive\(row\)\) \{\s*<button class="swipe__archive"/);
  assert.match(phoneRow, /@if \(canDelete\(row\)\) \{\s*<button class="swipe__delete"/);
  assert.match(member('phoneLinesOf'), /phoneLines\(this\.statusPartsOf\(row\), this\.paymentOf\(row\), isCreditNote\(row\.order\) \? this\.creditLine\(row\) : null\)/);
});

test('the trail gives way before the number; only the day line wraps; small phones get a 15 px number', () => {
  assert.ok(partial.includes('app-sales-list .sl--phone{--ios-inset:4px}'));
  assert.ok(partial.includes('app-sales-list .sl-prow>.ios-cell__body,app-sales-list .sl-phead>.ios-cell__body{flex:1 1 auto}'));
  assert.ok(partial.includes('app-sales-list .sl-ptrail{flex:0 1 auto;gap:2px;max-width:48%}'));
  const nowrap = partial.indexOf('app-sales-list .sl-pline{');
  const wraps = partial.indexOf('app-sales-list .sl-pline--day{white-space:normal}');
  assert.ok(nowrap >= 0 && wraps > nowrap, 'the day rule comes after the nowrap rule of the same specificity');
  assert.ok(partial.includes('@media (max-width:374px){app-sales-list .sl-ptitle{font-size:15px}}'));
  assert.ok(partial.includes('app-sales-list .sl-ptrail .wk-pill{max-width:100%;height:auto;'), 'a long status wraps in the trail');
});

test('on the phone the menu hint carries the Inhoud with m³ and marge (never on a credit note or partner document) and the money facts', () => {
  const items = member('rowMenuItems');
  assert.match(items, /this\.desktop\.active\(\) \? \[this\.inhoudText\(row\)\] : \[this\.inhoudText\(row, true\), \.\.\.this\.phoneMoneyFacts\(row\)\]/);
  const inhoud = member('inhoudText');
  const credit = inhoud.slice(0, inhoud.indexOf('if (this.partner(row.order))'));
  assert.doesNotMatch(credit, /marge/);
  assert.match(inhoud, /if \(this\.partner\(row\.order\)\) return full \? row\.order\.extraLines\?\.\[0\]\?\.description \|\| 'Gekoppeld aan de partnercontainer' : '';/);
  assert.match(inhoud, /if \(full && totals\.marginPct\) parts\.push\(`marge \$\{new PctPipe\(\)\.transform\(totals\.marginPct, 0\)\}`\);/);
  const money = member('phoneMoneyFacts');
  for (const fact of ['this.phoneLinesOf(row).unshown', 'ontvangen', 'gecrediteerd']) assert.ok(money.includes(fact), fact);
});

test('the fab and the iOS new-document sheet with its phone gutter', () => {
  assert.match(template, /<button class="fab" type="button" \[class\.fab--text\]="businessScope\(\)==='PARTNER'" \(click\)="startNew\(\)">\{\{ businessScope\(\) === 'PARTNER' \? 'Container kiezen' : '\+ Order' \}\}<\/button>/);
  assert.match(template, /<app-sheet \[title\]="newDocType\(\) === 'FACTUUR' \? 'Nieuwe factuur' : 'Nieuwe offerte'" variant="ios"\s+\(closed\)="picking\.set\(false\)">\s*<div body class="sl-new">/);
  assert.match(partial, /@media \(max-width:679\.98px\)\{app-sales-list \.sheet--ios \.sl-new\{padding:0 var\(--ios-inset,16px\)\}\}/);
  assert.equal(partial.split('.sl-new{').length - 1, 1, 'no rule outside the phone query');
});

/* ---- the badge, the chips row and the sheet's Filters wissen, isolated */
const parsed = ts.createSourceFile('sales-list.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'SalesList');
assert.ok(original);
const names = ['phoneChips', 'sheetFilterCount', 'clearSheetFilters'];
const members = original.members.filter((node) => node.name && ts.isIdentifier(node.name) && names.includes(node.name.text));
assert.equal(members.length, names.length);
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter((modifier) => !ts.isDecorator(modifier)), original.name, undefined, undefined, members);
const listJs = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness() {
  const exports: any = {};
  vm.runInNewContext(listJs, { exports, computed, signal });
  const screen = new exports.SalesList();
  const calls: string[] = [];
  Object.assign(screen, {
    docTab: signal('OFFERTE'), businessScope: signal('ALL'), filter: signal(''), customerFilter: signal(''), outstandingOnly: signal(false),
    docsFilter: signal('all'), attentionOnly: signal(false), websiteOnly: signal(false), toTakeOnly: signal(false),
    actionCount: signal(0), websiteRequests: signal([]), ordersToTake: signal([]),
    switchScope(scope: string) { calls.push(`scope ${scope}`); screen.businessScope.set(scope); },
    rememberNavigation() { calls.push('url'); },
  });
  return { screen, calls };
}

test('the badge counts the sheet choices off their default; Filters wissen resets them and keeps the chips row', () => {
  const { screen, calls } = harness();
  assert.equal(screen.sheetFilterCount(), 0);
  screen.businessScope.set('PARTNER'); screen.filter.set('CONCEPT'); screen.customerFilter.set(4); screen.attentionOnly.set(true);
  assert.equal(screen.sheetFilterCount(), 3, 'Actie vereist is a chip, not a sheet choice');
  screen.outstandingOnly.set(true); screen.docsFilter.set('cn');
  assert.equal(screen.sheetFilterCount(), 3, 'the Facturen choices count on Facturen only');
  screen.docTab.set('FACTUUR');
  assert.equal(screen.sheetFilterCount(), 5);
  screen.clearSheetFilters();
  assert.equal(screen.sheetFilterCount(), 0);
  assert.deepEqual(calls, ['scope ALL'], 'the scope goes back through switchScope, which writes the address');
  assert.equal(screen.attentionOnly(), true);
  screen.filter.set('BETAALD'); screen.clearSheetFilters();
  assert.deepEqual(calls, ['scope ALL', 'url'], 'with the scope already Alles the address is written directly');
});

test('the chips row shows only what applies, and nothing in daily use', () => {
  const { screen } = harness();
  /* A copy in this realm: the isolated class runs in its own vm context. */
  const chips = () => { const value = screen.phoneChips(); return value && { ...value }; };
  assert.equal(chips(), null);
  screen.actionCount.set(2);
  assert.deepEqual(chips(), { attention: true, website: false, toTake: false, outstanding: false });
  screen.actionCount.set(0); screen.websiteRequests.set([{}]); screen.ordersToTake.set([{}]);
  assert.deepEqual(chips(), { attention: false, website: true, toTake: true, outstanding: false });
  screen.docTab.set('FACTUUR');
  assert.equal(chips(), null, 'the website toggles belong to Offertes');
  screen.outstandingOnly.set(true);
  assert.deepEqual(chips(), { attention: false, website: false, toTake: false, outstanding: true });
  screen.outstandingOnly.set(false); screen.attentionOnly.set(true);
  assert.equal(chips()?.attention, true, 'a chosen Actie vereist stays, even at zero');
});
