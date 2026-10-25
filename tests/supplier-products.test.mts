import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseTemplate } from '@angular/compiler';
import type { SupplierProductRow } from '../src/app/core/api/product-supplier-models.ts';
import {
  sortSupplierProducts, supplierProductCount, supplierProductSub, supplierProductTitle,
} from '../src/app/features/suppliers/supplier-products.ts';

// Leveranciers › Producten (several suppliers, 2026-10-25, suppliers contract §7.1/§7.3/§9.3).
const list = await readFile(new URL('../src/app/features/suppliers/supplier-list.ts', import.meta.url), 'utf8');
const template = /template: `([\s\S]*?)`,\n  styles:/.exec(list)?.[1] ?? '';
const partial = await readFile(new URL('../src/styles/suppliers.scss', import.meta.url), 'utf8');
const css = partial.replace(/\/\*[\s\S]*?\*\//g, '');

function row(patch: Partial<SupplierProductRow> = {}): SupplierProductRow {
  return {
    rowId: 1, productId: 94, sku: 'ER-1530', name: 'Rose dome', colour: null, variantSize: null, photoUrl: null,
    productActive: true, preferred: false, active: true, versionLabel: null, supplierReference: null,
    exwPrice: 8.5, exwCurrency: 'USD', lastOrder: null, ...patch,
  };
}

/** The declarations of one selector in the partial (every rule hangs on app-supplier-list). */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`app-supplier-list ${escaped}\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

test('the title is the name, then the colour and the Maat when present', () => {
  assert.equal(supplierProductTitle(row()), 'Rose dome');
  assert.equal(supplierProductTitle(row({ colour: 'Rood' })), 'Rose dome · Rood');
  assert.equal(supplierProductTitle(row({ variantSize: 'M' })), 'Rose dome · M');
  assert.equal(supplierProductTitle(row({ colour: ' Rood ', variantSize: '15 cm' })), 'Rose dome · Rood · 15 cm');
  assert.equal(supplierProductTitle(row({ colour: '  ', variantSize: '' })), 'Rose dome', 'blank parts are left out');
});

test('the sub line: version, reference and the last order; without an order "nog niet besteld"', () => {
  const order = { orderId: 39, number: 'PO-2026-005', orderDate: '2026-07-28' };
  assert.equal(supplierProductSub(row({ versionLabel: 'B', supplierReference: 'PB-1530', lastOrder: order })), 'Versie B · ref PB-1530 · laatst PO-2026-005');
  assert.equal(supplierProductSub(row({ lastOrder: order })), 'laatst PO-2026-005');
  assert.equal(supplierProductSub(row()), 'nog niet besteld');
  assert.equal(supplierProductSub(row({ versionLabel: 'A · stolp 2 mm' })), 'Versie A · stolp 2 mm · nog niet besteld');
  assert.equal(supplierProductSub(row({ supplierReference: ' RG-DOME ', versionLabel: '  ' })), 'ref RG-DOME · nog niet besteld');
});

test('counts: active rows and inactive rows; a product that is itself inactive still counts by its row', () => {
  assert.deepEqual(supplierProductCount([]), { active: 0, inactive: 0 });
  assert.deepEqual(supplierProductCount([
    row({ rowId: 1 }), row({ rowId: 2, active: false }), row({ rowId: 3, productActive: false }), row({ rowId: 4, active: false, preferred: false }),
  ]), { active: 2, inactive: 2 });
});

test('active rows first, the server order kept inside each group, a new array', () => {
  const rows = [
    row({ rowId: 1, name: 'Zeta', active: false }),
    row({ rowId: 2, name: 'Beta' }),
    row({ rowId: 3, name: 'Alpha', active: false }),
    row({ rowId: 4, name: 'Delta' }),
  ];
  const sorted = sortSupplierProducts(rows);
  assert.deepEqual(sorted.map((r) => r.rowId), [2, 4, 1, 3]);
  assert.notEqual(sorted, rows);
  assert.deepEqual(rows.map((r) => r.rowId), [1, 2, 3, 4], 'the input stays as it was');
});

test('CSS pins: a long product name ends in an ellipsis, a price stays on one line', () => {
  const name = rule('.sup-prod__name');
  assert.match(name, /min-width:\s*0/);
  assert.match(name, /overflow:\s*hidden/);
  assert.match(name, /text-overflow:\s*ellipsis/);
  assert.match(name, /white-space:\s*nowrap/);
  assert.match(rule('.sup-prod__price'), /white-space:\s*nowrap/);
  assert.match(rule('.sup-prod__sub'), /text-overflow:\s*ellipsis/, 'the sub line ends in an ellipsis too: rows stay at two lines');
});

test('desk: a Producten section directly after Containers, three columns, empty and error words, inactive rows folded', () => {
  assert.equal(parseTemplate(template, 'supplier-list.html').errors, null);
  const containers = template.indexOf('aria-labelledby="sup-containers-title"');
  const products = template.indexOf('<section class="sup-sec" aria-labelledby="sup-products-title">');
  const terms = template.indexOf('aria-labelledby="sup-terms-title"');
  assert.ok(containers > 0 && products > containers && terms > products, 'Containers, Producten, then Inkoopafspraken');
  const section = template.slice(products, terms);
  assert.match(section, /<h3 class="sup-sec__title" id="sup-products-title">Producten@if \(listState === 'ready'\) \{ <span class="sup-sec__count">\{\{ productCounts\(\)\.active \}\}<\/span> \}<\/h3>/);
  assert.deepEqual([...section.matchAll(/role="columnheader">([^<]+)</g)].map((m) => m[1]), ['Product', 'EXW', 'Laatst besteld']);
  assert.match(section, /Nog geen producten bij deze leverancier\./);
  assert.match(section, /Producten konden niet laden · <button class="wk-link" type="button" \(click\)="loadProducts\(supplier\.id\)">Opnieuw<\/button>/);
  assert.match(section, /\{\{ inactiveProducts\(\)\.length \}\} inactief <span class="sup-fold__chev" aria-hidden="true">›<\/span>/);
  assert.match(section, /@if \(showInactiveProducts\(\)\) \{/);
});

test('one product row: 40 px photo behind the login, title, pills Voorkeur and Inactief, EXW, the last order date, a link to the product', () => {
  const desk = /<ng-template #deskProduct let-product>([\s\S]*?)<\/ng-template>/.exec(template)?.[1] ?? '';
  assert.match(desk, /\[routerLink\]="\['\/products', product\.productId\]"/);
  assert.match(desk, /<img class="sup-prod__photo" \[appAuthSrc\]="product\.photoUrl" appAuthLazy alt="" draggable="false" \/>/);
  assert.match(desk, /<b class="sup-prod__name">\{\{ productTitle\(product\) \}\}<\/b>/);
  assert.match(desk, /<span class="sup-prod__sub">\{\{ productSub\(product\) \}\}<\/span>/);
  assert.match(desk, />Voorkeur</);
  assert.match(desk, />Inactief</);
  assert.match(desk, /sup-prod__price[^>]*>@if \(product\.exwPrice != null\) \{ \{\{ product\.exwPrice \| cur: \(product\.exwCurrency \?\? 'USD'\) \}\} \} @else \{ — \}/);
  assert.match(desk, /\{\{ product\.lastOrder\?\.orderDate \| dateNl \}\}/);
  assert.match(rule('.sup-prod__photo'), /width:40px;height:40px/);
});

test('phone: a Producten section after Containers in the sheet, a cell per row with thumb, title, sub, EXW and chevron', () => {
  const containers = template.indexOf('<h2>Containers</h2>');
  const products = template.indexOf('<h2>Producten</h2>');
  const terms = template.indexOf('<h2>Inkoopafspraken</h2>');
  assert.ok(containers > 0 && products > containers && terms > products);
  const section = template.slice(products, terms);
  assert.match(section, /Nog geen producten bij deze leverancier\./);
  assert.match(section, /Producten konden niet laden · <button class="wk-link" type="button" \(click\)="loadProducts\(draft\(\)\.id\)">Opnieuw<\/button>/);
  assert.match(section, /<div class="ios-group ios-group--thumbs">/);
  const phone = /<ng-template #phoneProduct let-product>([\s\S]*?)<\/ng-template>/.exec(template)?.[1] ?? '';
  for (const part of ['class="ios-thumb"', 'ios-cell__title', 'ios-cell__sub', 'ios-cell__value', 'ios-cell__chev']) assert.ok(phone.includes(part), part);
  assert.match(phone, /\(click\)="close\(\)"/);
});

test('the list is keyed by supplier: a late answer for another supplier is dropped; the desk loads on choosing, the phone on opening', () => {
  assert.match(list, /const request = \+\+this\.productsRequest;/);
  assert.match(list, /if \(request !== this\.productsRequest \|\| this\.productsFor\(\) !== supplierId\) return;/);
  assert.match(list, /return id != null && this\.productsFor\(\) === id \? this\.productsState\(\) : 'loading';/);
  assert.match(list, /if \(id != null && this\.productsFor\(\) !== id\) void this\.loadProducts\(id\);/);
  assert.match(list, /if \(supplier && !this\.desktop\.active\(\)\) void this\.loadProducts\(supplier\.id\);/);
  assert.match(list, /this\.products\.set\(sortSupplierProducts\(rows\)\);/);
});

test('the pure module imports types only', async () => {
  const source = await readFile(new URL('../src/app/features/suppliers/supplier-products.ts', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import .*$/gm)].map((m) => m[0]);
  assert.ok(imports.length > 0);
  for (const line of imports) assert.match(line, /^import type /);
});
