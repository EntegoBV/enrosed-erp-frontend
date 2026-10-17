import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

/*
 * The desk list below an 860 px card (1100 and 1024 windows): the Lading
 * column hides (data-hide=sm) and its whole content folds into the Container
 * sub. Every figure stays visible: type, dozen, m³ and fill.
 */
const partial = (await readFile(new URL('../src/styles/purchase-list.scss', import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
const list = await readFile(new URL('../src/app/features/purchasing/purchase-list.ts', import.meta.url), 'utf8');

test('the fold is hidden by default before the container query that shows it, so the query wins below 860 px', () => {
  const hidden = partial.indexOf('app-purchase-list .pl-lading-inline{display:none}');
  const query = partial.indexOf('@container wk-pane (max-width:859.98px){');
  const shown = partial.indexOf('app-purchase-list .pl-lading-inline{display:inline}');
  assert.ok(hidden >= 0 && query >= 0 && shown > query, 'the three rules exist');
  assert.ok(hidden < query, 'a later rule of the same specificity outside the query would hide the fold at every width');
  assert.equal(partial.split('.pl-lading-inline{').length - 1, 2, 'no third rule that could override either');
});

test('the folded part carries the whole Lading cell: type, dozen, m³ and fill', () => {
  const inline = /<span class="pl-lading-inline">([\s\S]*?)<\/span><\/span>\s*<\/span>/.exec(list)?.[1] ?? '';
  const cell = /<span class="wk-td wk-td--wrap pl-cell" role="cell" data-hide="sm">([\s\S]*?)<\/span>\s*<span class="wk-td wk-td--wrap pl-cell" role="cell">/.exec(list)?.[1] ?? '';
  assert.ok(inline && cell, 'both found');
  const figures = (text: string) => [...text.matchAll(/\{\{ ([^}]+?) \}\}/g)].map((match) => match[1]).sort();
  assert.deepEqual(figures(inline), figures(cell));
  for (const part of ['shortContainer(row.order.containerType)', 'row.costing.totals.cartons | num', 'row.costing.totals.cbm | cbm', 'fill.pct | num: 0']) {
    assert.ok(inline.includes(part), part);
  }
});

test('the container type never splits: "40 ft HQ" is one nowrap span in the column and in the fold, like the amounts', () => {
  const type = '<span class="pl-nw">{{ shortContainer(row.order.containerType) }}</span>';
  assert.equal(list.split(type).length - 1, 2, 'Lading column and folded part');
  assert.equal(list.split('{{ shortContainer(row.order.containerType) }}').length - 1, 2, 'no unwrapped type left');
});

