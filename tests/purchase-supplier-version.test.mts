import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import type { Product, PurchaseOrderLine } from '../src/app/core/api/models.ts';
import type { ProductSupplierOffer } from '../src/app/core/api/product-supplier-models.ts';
import { lineVersionText, offerChip, offerPriceNote, pickable } from '../src/app/features/purchasing/purchase-supplier-version.ts';

/* One product, several suppliers (2026-10-25): the version a purchase line carries, in words. */

const offer = (extra: Partial<ProductSupplierOffer> = {}): ProductSupplierOffer => ({
  id: 12, supplierId: 7, preferred: false, active: true, versionLabel: 'B', supplierReference: 'PB-1530',
  exwPrice: 2.35, exwCurrency: 'USD', extraUnitCost: null, moq: null, leadTimeDays: null, ...extra,
});
const product = (o: ProductSupplierOffer | null | undefined) => ({ offer: o }) as Pick<Product, 'offer'>;
const line = (label: string | null | undefined, reference: string | null | undefined) =>
  ({ supplierVersionLabel: label, supplierReference: reference }) as Pick<PurchaseOrderLine, 'supplierVersionLabel' | 'supplierReference'>;

test('the line\'s snapshot beats the product\'s offer: a placed container keeps the version it was ordered as', () => {
  assert.equal(lineVersionText(line('A · stolp 2 mm', 'PB-1530-BL'), product(offer())), 'Versie A · stolp 2 mm · ref PB-1530-BL');
  /* A snapshot with only a label still wins as a whole: the offer's reference does not slip in. */
  assert.equal(lineVersionText(line('A', null), product(offer())), 'Versie A');
  assert.equal(lineVersionText(line(null, 'OLD-1'), product(offer())), 'ref OLD-1');
  /* No snapshot yet (a line added in this draft): the offer of this order's supplier. */
  assert.equal(lineVersionText(line(null, null), product(offer())), 'Versie B · ref PB-1530');
  assert.equal(lineVersionText(undefined, product(offer())), 'Versie B · ref PB-1530');
  assert.equal(lineVersionText(line('  ', ' '), product(offer({ versionLabel: 'C' , supplierReference: null }))), 'Versie C', 'blank is no snapshot');
});

test('label only, reference only, or nothing at all', () => {
  assert.equal(lineVersionText(line('B · dikker glas', null)), 'Versie B · dikker glas');
  assert.equal(lineVersionText(line(null, 'PB-1530')), 'ref PB-1530');
  assert.equal(lineVersionText(line(null, null)), null);
  assert.equal(lineVersionText(null, null), null);
  assert.equal(lineVersionText(line(null, null), product(offer({ versionLabel: null, supplierReference: null }))), null);
  assert.equal(lineVersionText(line(null, null), product(null)), null, 'a product without a row of this supplier');
  assert.equal(lineVersionText(line(null, null), product(offer({ versionLabel: ' B ', supplierReference: ' PB-1 ' }))), 'Versie B · ref PB-1', 'trimmed');
});

test('the picker pill names the version only; inactive offers are never offered; the price note', () => {
  assert.equal(offerChip(product(offer())), 'Versie B');
  assert.equal(offerChip(product(offer({ versionLabel: null }))), null);
  assert.equal(offerChip(product(offer({ versionLabel: '   ' }))), null);
  assert.equal(offerChip(product(undefined)), null);
  assert.equal(pickable(product(offer())), true);
  assert.equal(pickable(product(offer({ active: false }))), false);
  assert.equal(pickable(product(null)), true, 'a product offered by its own supplier, without a row yet');
  assert.equal(pickable(product(undefined)), true);
  assert.equal(offerPriceNote({ exwPrice: 2.35 }), 'EXW');
  assert.equal(offerPriceNote({ exwPrice: 0 }), 'EXW');
  assert.equal(offerPriceNote({ exwPrice: null }), 'geen prijs');
});

test('the purchase screens use the line\'s version text and the picker shows the pill, price note and empty text', async () => {
  const read = (file: string) => readFile(new URL(`../src/app/features/purchasing/${file}`, import.meta.url), 'utf8');
  const [editor, desk, picker, view] = await Promise.all([read('purchase-editor.ts'), read('purchase-desk.ts'), read('purchase-desk-picker.ts'), read('purchase-view.ts')]);
  /* The editor offers only what is not on the order and is pickable; the phone line cell adds the version. */
  assert.match(editor, /return this\.products\(\)\.filter\(\(product\) => !used\.has\(product\.id!\) && pickable\(product\)\);/);
  assert.match(editor, /lineVersion\(line\.productId\)/);
  assert.match(editor, /lineVersion\(productId: number\): string \| null \{\s*return lineVersionText\(this\.orderLine\(productId\), this\.productById\(\)\.get\(productId\)\);/);
  /* The desk line meta. */
  assert.match(desk, /@if \(lineVersion\(line\.productId\); as version\) \{ <span class="desk-product__version">\{\{ version \}\}<\/span> \}/);
  /* The picker: a pill after the name, behind both name branches (never the variant <em>), the price note, the empty text. */
  assert.match(picker, /<\/em> \}\s*\}\s*<\/span>\s*<!--[\s\S]*?-->\s*@if \(offerChip\(product\); as chip\) \{ <span class="wk-pill pick__version">\{\{ chip \}\}<\/span> \}\s*<\/strong>/);
  assert.match(picker, /<small>\{\{ offerPriceNote\(product\) \}\}<\/small>/);
  assert.doesNotMatch(picker, /'productkaart'/);
  assert.match(picker, /Niets gevonden bij deze leverancier · voeg de leverancier toe op het product\./);
  assert.match(picker, /\.pick__version\{[^}]*text-overflow:ellipsis/);
  /* The phone read view: the snapshot only (it loads every product without offers). */
  assert.match(view, /@if \(lineVersionText\(orderLineOf\(entry\.line\.productId\)\); as version\) \{\{\{ version \}\} · \}\{\{ entry\.line\.quantity \| num \}\} st/);
});
