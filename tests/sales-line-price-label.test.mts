import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

/*
 * The sales line rule of 2026-10-15 (DIAM-D-RD read "2.95 per set · € 2,95 per
 * diamant vóór korting"): the word under a price names what that price is for,
 * the display side of it goes on the line below, and "vóór korting" only shows
 * on a line that has a discount.
 */
const read = (file: string) => readFile(new URL(`../src/app/features/${file}`, import.meta.url), 'utf8');
const [desk, editor, view] = await Promise.all([read('sales/sales-desk.ts'), read('sales/sales-editor.ts'), read('sales/sales-view.ts')]);

test('no sales screen leads with a converted "set" price any more', () => {
  for (const [name, source] of [['desk', desk], ['editor', editor], ['view', view]]) {
    assert.doesNotMatch(source, /linePrimaryPrice|lineSecondaryPrice|primarySalesPrice|secondarySalesPrice/, name);
    assert.doesNotMatch(source, /per set\b/, name);
  }
});

test('desk price cell: the stored price, its own unit, then the display side', () => {
  const cell = desk.slice(desk.indexOf('<td class="c-price num">'), desk.indexOf('<td class="c-disc num">'));
  assert.ok(cell.length > 0);
  // Read-only (sent) rows show the stored price, so Aantal × Eenheidsprijs = Netto.
  assert.match(cell, /<b>\{\{ line\.unitPrice \| eur: 2 \}\}<\/b>/);
  const word = cell.indexOf('<small>per {{ lineUnit(line.productId).singular }}</small>');
  const other = cell.indexOf('{{ other.sign }} {{ other.price | eur: 2 }} {{ other.per }}');
  assert.ok(word > 0 && other > word, 'the unit word sits under the price, the display side below it');
  assert.match(cell, /@if \(lineDiscounted\(line\)\) \{, vóór korting\}/, '"vóór korting" only with a discount');
  // One unit word for both branches: the label sits outside the editable/read-only split.
  assert.equal(cell.match(/<small>per \{\{ lineUnit\(line\.productId\)\.singular \}\}<\/small>/g)?.length, 1);
});

test('phone: the check list multiplies the quantity by the stored price in its own unit', () => {
  // "4 displays × € 49,95 per display", "12 diamanten × € 2,95 per diamant".
  assert.match(editor, /\{\{ line\.quantity \| num \}\} \{\{ line\.quantity === 1 \? lineUnit\(line\.productId\)\.singular : lineUnit\(line\.productId\)\.plural \}\} × \{\{ line\.unitPrice \| eur: 2 \}\} per \{\{ lineUnit\(line\.productId\)\.singular \}\}/);
  // The line under the price field adds only the display side; the field label already says "Prijs per diamant".
  assert.match(editor, /<p class="line-unit-context">\{\{ detail \}\}@if \(lineOtherPrice\(line\); as other\) \{ · \{\{ other\.sign \}\} \{\{ other\.price \| eur: 2 \}\} per \{\{ other\.unit \}\}@if \(lineDiscounted\(line\)\) \{, vóór korting\} \}\.<\/p>/);
  // The read-only phone view has no price field, so it names the stored price first.
  assert.match(view, /<p class="line-unit-context">\{\{ detail \}\} · \{\{ line\.unitPrice \| eur: 2 \}\} per \{\{ lineUnit\(line\.productId\)\.singular \}\}@if \(lineOtherPrice\(line\); as other\)/);
});

test('a line counts as discounted with a staffel, an extra korting or both', () => {
  for (const source of [editor, view]) {
    const body = source.slice(source.indexOf('lineDiscounted(line: PricedLine): boolean {'));
    const expression = body.slice(body.indexOf('return ') + 7, body.indexOf(';'));
    const discounted = new Function('line', `return ${expression};`) as (line: Record<string, number>) => boolean;
    assert.equal(discounted({ discountPct: 0, tierPercent: 0, manualPercent: 0 }), false);
    assert.equal(discounted({ discountPct: 5, tierPercent: 5, manualPercent: 0 }), true);
    assert.equal(discounted({ discountPct: 0, tierPercent: 0, manualPercent: 2 }), true, 'an extra korting typed before the preview answered');
  }
});
