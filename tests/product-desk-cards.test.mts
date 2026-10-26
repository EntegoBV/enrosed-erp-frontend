import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseTemplate } from '@angular/compiler';

/*
 * The product page with several suppliers and batches (2026-10-25): the card
 * order of build plan D9 on the desk (both column layouts) and the phone, the
 * CSS pins that keep long names and figures inside their rows, and the
 * sections a purchase order can link to.
 */
const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const desk = await read('src/app/features/products/product-desk.ts');
const view = await read('src/app/features/products/product-view.ts');
const sheet = await read('src/app/features/products/product-batch-sheet.ts');
const deskCss = await read('src/styles/products/_product-desk.scss');
const phoneCss = await read('src/styles/products/_product-phone.scss');

const templateOf = (source: string): string => {
  const template = /template:\s*`([\s\S]*?)`,\s*(?:\/\*[\s\S]*?\*\/\s*)?(?:styles|styleUrls?):/.exec(source)?.[1];
  assert.ok(template, 'a template followed by its styles');
  return template;
};

/** The declarations of every rule whose selector list names exactly this selector (comments stripped). */
function declarations(css: string, selector: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: string[] = [];
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map((part) => part.trim().replace(/\s+/g, ' '));
    if (selectors.includes(selector)) found.push(match[2]);
  }
  assert.ok(found.length, `a rule for ${selector}`);
  return found.join(';');
}

const outlets = (text: string) => [...text.matchAll(/\*ngTemplateOutlet="(\w+)"/g)].map((match) => match[1]);

test('the product page templates parse', () => {
  for (const [name, text] of [['desk', desk], ['view', view], ['sheet', sheet]] as const) {
    assert.equal(parseTemplate(templateOf(text), `${name}.html`).errors, null, name);
  }
});

test('desk, two columns: price, suppliers, product, agreements, media, issues | stock, batches, carton, web', () => {
  const block = /@if \(twoColumns\(\)\) \{([\s\S]*?)\} @else \{/.exec(desk)?.[1] ?? '';
  const columns = block.split('<div class="pdk-col">').slice(1);
  assert.equal(columns.length, 2);
  assert.deepEqual(outlets(columns[0]), ['priceCard', 'suppliersCard', 'productCard', 'agreementsCard', 'mediaCard', 'issuesCard']);
  assert.deepEqual(outlets(columns[1]), ['stockCard', 'batchesCard', 'cartonCard', 'webCard']);
});

test('desk, one column: price, suppliers, duo (stock, web), batches, product, carton, agreements, media, issues', () => {
  const block = /\} @else \{\s*<div class="pdk-col">([\s\S]*?)<\/div>\s*\}\s*<\/div>/.exec(desk)?.[1] ?? '';
  assert.deepEqual(outlets(block), ['priceCard', 'suppliersCard', 'stockCard', 'webCard', 'batchesCard', 'productCard', 'cartonCard', 'agreementsCard', 'mediaCard', 'issuesCard']);
  const duo = /<div class="pdk-duo">([\s\S]*?)<\/div>/.exec(block)?.[1] ?? '';
  assert.deepEqual(outlets(duo), ['stockCard', 'webCard']);
});

test('phone sections: Foto’s, Voorraad, Batches, Laatste bewegingen, Prijs & marge, Leveranciers, Website, Product, Omdoos, Documenten, Afspraken, issues', () => {
  const template = templateOf(view);
  const markers = ['id="pph-places-title"', 'id="stock-card"', 'id="product-batches"', 'id="pph-moves-title"', 'id="product-core"',
    'id="product-suppliers"', 'id="product-publication"', 'id="pph-product-title"', 'id="product-packaging"', 'id="product-media"',
    'id="pph-agreements-title"', 'id="product-issues"'];
  const at = markers.map((marker) => {
    assert.equal(template.split(marker).length - 1, 1, marker);
    return template.indexOf(marker);
  });
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'in this order');
});

test('the desk cards and the phone sections carry the ids a purchase order links to', () => {
  assert.match(desk, /<section class="pdk-card" id="pd-suppliers"/);
  assert.match(desk, /<section class="pdk-card" id="pd-batches"/);
  const list = /const requestedSection = \[([\s\S]*?)\]/.exec(view)?.[1] ?? '';
  for (const id of ['pd-suppliers', 'product-suppliers', 'pd-batches', 'product-batches', 'pd-agreements', 'product-agreements']) {
    assert.match(list, new RegExp(`'${id}'`), id);
  }
  /* The batches hide until the start; the suppliers hide when the product has none. */
  assert.match(templateOf(view), /@if \(shownBatches\(\); as data\) \{\s*<section class="ios-section" id="product-batches"/);
  assert.match(desk, /@if \(shownBatches\(\); as data\) \{\s*<section class="pdk-card" id="pd-batches"/);
  assert.match(desk, /@if \(productSuppliers\(\) === null \|\| supplierRows\(\)\.length\) \{/);
});

test('CSS pins: supplier names and batch titles end in an ellipsis; prices and batch figures never wrap', () => {
  for (const selector of ['app-product-desk .pdk-supplier__name', 'app-product-desk .pdk-batch__main b', 'app-product-desk .pdk-batch__main small',
    'app-product-desk .pdk-supplier__sub']) {
    const rule = declarations(deskCss, selector);
    assert.match(rule, /text-overflow:\s*ellipsis/, selector);
    assert.match(rule, /white-space:\s*nowrap/, selector);
    assert.match(rule, /overflow:\s*hidden/, selector);
    assert.match(rule, /min-width:\s*0/, selector);
  }
  for (const selector of ['app-product-desk .pdk-supplier__price', 'app-product-desk .pdk-batch__num']) {
    const rule = declarations(deskCss, selector);
    assert.match(rule, /white-space:\s*nowrap/, selector);
    assert.match(rule, /flex:\s*none/, selector);
  }
  /* The two-line rows shrink instead of pushing the card wider. */
  assert.match(declarations(deskCss, 'app-product-desk .pdk-batch__main'), /min-width:\s*0/);
  assert.match(declarations(deskCss, 'app-product-desk .pdk-supplier__main'), /min-width:\s*0/);
  /* Phone: the titles of supplier and batch cells cut, their pills stay whole, warn colours scoped to the page. */
  const phoneName = declarations(phoneCss, 'app-product-view .pph-batch__name');
  assert.match(phoneName, /text-overflow:\s*ellipsis/);
  assert.match(phoneName, /min-width:\s*0/);
  assert.match(declarations(phoneCss, 'app-product-view .pph-sup__name'), /text-overflow:\s*ellipsis/);
  assert.match(declarations(phoneCss, 'app-product-view .pph-batch-tag'), /white-space:\s*nowrap/);
  assert.match(declarations(phoneCss, 'app-product-view .ios-cell__value.is-warn'), /color:\s*var\(--warn\)/);
  assert.match(declarations(phoneCss, 'app-product-view .ios-section__foot.is-warn'), /color:\s*var\(--warn\)/);
  /* Every new rule stays under its page's host. */
  for (const [css, host] of [[deskCss, 'app-product-desk'], [phoneCss, 'app-product-view']] as const) {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of clean.matchAll(/([^{}@]+)\{/g)) {
      for (const part of match[1].split(',')) {
        const selector = part.trim();
        if (/pdk-supplier|pdk-batch|pph-sup|pph-batch|pdk-agree|pph-agree|pph-supplier/.test(selector)) assert.ok(selector.startsWith(host), selector);
      }
    }
  }
});

test('desk rows: the supplier recipe and the batch row as the contracts give them', () => {
  const template = templateOf(desk);
  assert.match(template, /<div class="pdk-supplier" \[class\.is-off\]="!row\.active">/);
  assert.match(template, /<b class="pdk-supplier__name" \[title\]="row\.supplierName">\{\{ row\.supplierName \}\}<\/b>@if \(row\.preferred\) \{<i class="wk-pill tone-accent">Voorkeur<\/i>\} @else if \(!row\.active\) \{<i class="wk-pill">Inactief<\/i>\}/);
  assert.match(template, /<span class="pdk-supplier__price">\{\{ supplierPrice\(row\) \}\}@if \(row\.supplierIncoterm\)/);
  assert.match(template, /<p>Wie dit product maakt · prijs per \{\{ salesUnit\(product\)\.singular \}\}<\/p>/);
  assert.match(template, /off \+ ' inactief' \+ \(inactiveSuppliersOpen\(\) \? ' · inklappen' : ' ›'\)/);
  assert.match(template, /<button class="pdk-batch" type="button" \[title\]="batchRowText\(b\)" \(click\)="batchSheet\.set\(b\)">/);
  assert.match(template, /<span class="pdk-batch__num"><strong \[class\.is-warn\]="b\.stale">\{\{ batchCostOf\(b\) \}\}<\/strong>/);
  assert.match(template, /'Uitverkochte batches \(' \+ sold \+ '\)' \+ \(emptyBatchesOpen\(\) \? ' · inklappen' : ' ›'\)/);
  /* The head shows own plus partner batches (batchesTotal), never the own-only value. */
  assert.match(template, /<b class="pdk-total">\{\{ batchesTotalValue\(\) \| eur: 0 \}\}<\/b>/);
  /* Hero "+n", the Inkoop subtitle, the Afspraken choice and the issues' supplier. */
  assert.match(template, /\(click\)="scrollToDetailSection\('pd-suppliers'\)"[^>]*>\+\{\{ more \}\}<\/button>/);
  assert.match(template, /<small>leveranciers, EXW-prijs en HS-code<\/small>/);
  assert.match(template, /<select class="input input--sm select" id="pd-agreement-supplier" \(change\)="selectAgreementSupplier\(/);
  assert.match(template, /inspectie-export · \{\{ agreementSupplierName\(\) \|\| 'de leverancier' \}\}/);
  assert.match(template, /<p>Waarschuwing op de volgende order bij dezelfde leverancier<\/p>/);
  assert.match(template, /@if \(issueSupplier\(issue\); as supplier\)/);
  assert.equal(template.match(/<app-product-batch-sheet /g)?.length, 1);
  assert.equal(templateOf(view).match(/<app-product-batch-sheet /g)?.length, 1);
});

test('one loader for both topics; a booking reloads the batches; the agreement asks for the chosen supplier', () => {
  const load = /private async loadProduct\(id: number\): Promise<void> \{([\s\S]*?)\n  \}\n/.exec(view)?.[1] ?? '';
  assert.match(load, /this\.catalog\.productSuppliers\(id\)/);
  assert.match(load, /this\.loadBatches\(id, version\)/);
  assert.match(load, /this\.productSuppliers\.set\(null\)/);
  assert.match(load, /this\.agreementSupplierId\.set\(null\)/);
  assert.match(load, /\.catch\(\(\) => \{ if \(version === this\.loadVersion\) this\.productSuppliers\.set\(\[\]\); \}\)/);
  const refresh = /protected refreshStock\(productId: number\): void \{([\s\S]*?)\n  \}\n/.exec(view)?.[1] ?? '';
  assert.match(refresh, /this\.loadBatches\(productId, this\.loadVersion\)/);
  assert.match(view, /this\.stockBatchApi\.forProduct\(productId\)/);
  assert.match(view, /await this\.supplierAgreementApi\.get\(productId, supplierId\)/);
  /* Phone: the EXW cell names the Voorkeur only when another supplier is active; the figure itself is unchanged. */
  assert.match(templateOf(view), /\{\{ otherSuppliers\(\) && supplierName\(\) \? 'voorkeur · ' \+ supplierName\(\) : 'fabrieksprijs' \}\}/);
  assert.match(templateOf(view), /@if \(product\.exwPrice; as price\) \{ \{\{ price \| cur: product\.exwCurrency \}\} \}/);
});

test('the batch sheet: title, figures, cost rows from the product page, moves and the way to the container', () => {
  const template = templateOf(sheet);
  assert.match(template, /<app-sheet \[title\]="'Batch · ' \+ title\(\)" variant="ios" \[wide\]="desktop\.active\(\)" \(closed\)="closed\.emit\(\)">/);
  assert.match(template, /<div body class="pbs-sheet">/);
  assert.match(template, /class="ios-figures pbs-figures"/);
  assert.match(template, /<div class="stat-row">/);
  assert.match(template, /Kostprijs per \{\{ unit\(\)\.singular \}\}/);
  assert.match(template, /Opbouw niet bewaard\./);
  assert.match(template, /<span>Zonder Enrosed kost<\/span>/);
  assert.match(template, /Opnieuw toepassen ›/);
  assert.match(template, /Meer \(\{\{ list\.total - list\.moves\.length \}\}\) ›/);
  assert.match(template, /\(click\)="loadMoves\(500\)"/);
  assert.match(template, /Naar \{\{ title\(\) \}\} ›<\/span>/);
  assert.match(template, /<span class="spacer"><\/span>\s*<button class="btn" type="button" \(click\)="closed\.emit\(\)">Sluiten<\/button>/);
  assert.match(sheet, /labelRows\(costRows\(unitParts, batch\.unitCostEur, 4\), \{\}, label\)/);
  assert.match(sheet, /this\.stockBatches\.moves\(id, limit\)/);
  assert.match(sheet, /@media \(max-width: 679\.98px\) \{ \.pbs-sheet \{ padding: 0 16px; \} \}/);
});
