import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import type { ProductCostHistoryEntry } from '../src/app/core/api/models.ts';
import { salesCostBuild, type SalesCostInput } from '../src/app/features/sales/sales-cost-build.ts';

/* The Gelande kost sheet of a sales line (cost-fix Q6): the frozen cost, its parts only when kept for exactly that cost. */

const UNIT = { singular: 'stolp', plural: 'stolpen' };

function entry(id: number, landedUnitEur: number, parts: Partial<ProductCostHistoryEntry> = {}, extra: Partial<ProductCostHistoryEntry> = {}): ProductCostHistoryEntry {
  return { id, appliedAt: '2026-08-23T10:15:00Z', landedUnitEur, previousLandedUnitEur: null, deltaEur: null, deltaPct: null,
    source: 'PO-2026-005', purchaseOrderId: 39, quantity: 18, exwPrice: 6.6, exwCurrency: 'USD', appliedBy: 'emre', kind: 'APPLY',
    containerName: 'Domes zomer', containerGone: false, ...parts, ...extra };
}

/** The parts the history kept for 8,3180 (each at 4 decimals, summing to 8,3179). */
const APPLIED = { goodsEur: 5.4321, originEur: 0.2311, freightEur: 1.1802, dutyEur: 0.6845, destinationEur: 0.29, enrosedEur: 0.5 };
/** Today's container calculation, 10,3858: what the old sheet put under the 8,32. */
const LIVE = { goodsEur: 7.31, originEur: 0.2311, freightEur: 1.1802, dutyEur: 0.8745, destinationEur: 0.29, enrosedEur: 0.5 };

const build = (input: Partial<SalesCostInput>) => salesCostBuild({ costEur: 8.318, unit: UNIT, docType: 'OFFERTE', containerSale: false, history: [], ...input });
const cents4 = (value: number): number => Math.round(value * 10000);
/** Every row but the closing cost adds up to it, to the cent of a cent. */
function addsUp(rows: { eur: number; sum?: boolean }[]): void {
  const total = rows.at(-1)!;
  assert.equal(total.sum, true);
  assert.equal(rows.slice(0, -1).reduce((sum, row) => sum + cents4(row.eur), 0), cents4(total.eur));
}

test('the screenshot case: a stored cost without kept parts never borrows today\'s container parts', () => {
  /* Newest row: the container applied again at 10,3858 with parts; the sale froze 8,318 from the start row, which kept none. */
  const history = [entry(2, 10.3858, LIVE, { kind: 'REAPPLY' }), entry(1, 8.318, {}, { kind: 'SEED', appliedBy: 'system' })];
  const sheet = build({ history });
  assert.deepEqual(sheet.rows, [{ label: 'Gelande kost per stolp', hint: 'vastgelegd op deze offerte', eur: 8.318, sum: true }]);
  assert.equal(sheet.source, null);
  assert.equal(sheet.missing, 'Opbouw van deze kost niet bewaard.');
  assert.ok(!sheet.rows.some((row) => row.label.includes('Inkoopprijs')), 'no live part under a frozen total');
});

test('kept parts for exactly the frozen cost explain it, with Afronding to the 4th decimal', () => {
  const sheet = build({ history: [entry(2, 10.3858, LIVE), entry(1, 8.318, APPLIED)] });
  assert.deepEqual(sheet.rows.map((row) => row.label), ['Inkoopprijs (EXW)', '+ Lokale kosten bij vertrek', '+ Zeevracht', '+ Invoerrechten',
    '+ Kosten na aankomst', '+ Enrosed kost', '± Afronding', 'Gelande kost per stolp']);
  assert.equal(sheet.rows[0].hint, '18 stolpen in Domes zomer');
  assert.equal(sheet.rows[6].eur, 0.0001);
  assert.equal(sheet.rows.at(-1)!.hint, 'vastgelegd op deze offerte');
  addsUp(sheet.rows);
  assert.equal(sheet.source, 'Opbouw uit Domes zomer · toegepast 23/08/2026');
  assert.equal(sheet.missing, null);
});

test('a row with parts but another cost is unexplained; equality holds at 4 decimals', () => {
  assert.equal(build({ costEur: 8.3181, history: [entry(1, 8.318, APPLIED)] }).missing, 'Opbouw van deze kost niet bewaard.');
  assert.equal(build({ costEur: 8.31804, history: [entry(1, 8.318, APPLIED)] }).missing, null);
});

test('inspection and other costs spread into the price get their row; zero parts stay out', () => {
  const sheet = build({ costEur: 6.25, history: [entry(1, 6.25, { goodsEur: 4.5, originEur: 0, freightEur: 1, dutyEur: 0.45, destinationEur: 0.1, enrosedEur: 0, separateEur: 0.2 })] });
  assert.deepEqual(sheet.rows.map((row) => row.label), ['Inkoopprijs (EXW)', '+ Zeevracht', '+ Invoerrechten', '+ Kosten na aankomst',
    '+ Inspectie en andere kosten', 'Gelande kost per stolp']);
  addsUp(sheet.rows);
});

test('the document says where the cost was frozen', () => {
  const hint = (docType: SalesCostInput['docType']) => build({ docType }).rows.at(-1)!.hint;
  assert.deepEqual([hint('OFFERTE'), hint('FACTUUR'), hint('CREDITNOTA'), hint(null), hint(undefined)],
    ['vastgelegd op deze offerte', 'vastgelegd op deze factuur', 'vastgelegd op deze creditnota', 'vastgelegd op deze offerte', 'vastgelegd op deze offerte']);
});

test('a container sale froze its cost without the Enrosed kost: the sheet says so and never lists it', () => {
  /* The server's snapshot (10,3858 · 18 − 0,51 · 18) / 18 rounded from the line total: 9,8757 against 10,3858 − 0,5100 = 9,8758. */
  const row = entry(1, 10.3858, { ...LIVE, goodsEur: 7.3, enrosedEur: 0.51 });
  const sheet = build({ costEur: 9.8757, containerSale: true, history: [row] });
  assert.ok(!sheet.rows.some((part) => part.label === '+ Enrosed kost'));
  assert.equal(sheet.rows.at(-1)!.hint, 'vastgelegd op deze offerte · excl. Enrosed kost');
  addsUp(sheet.rows);
  /* The same figure on a regular sale is not explained by that row. */
  assert.equal(build({ costEur: 9.8757, history: [row] }).missing, 'Opbouw van deze kost niet bewaard.');
  /* A line added to the container sale later took the product's cost with the Enrosed kost in it. */
  const added = build({ costEur: 10.3858, containerSale: true, history: [row] });
  assert.ok(added.rows.some((part) => part.label === '+ Enrosed kost'));
  assert.equal(added.rows.at(-1)!.hint, 'vastgelegd op deze offerte');
  /* Unexplained on a container sale: its own lines leave the Enrosed kost out. */
  const unknown = build({ costEur: 7.1, containerSale: true, history: [row] });
  assert.equal(unknown.rows.at(-1)!.hint, 'vastgelegd op deze offerte · excl. Enrosed kost');
  assert.equal(unknown.missing, 'Opbouw van deze kost niet bewaard.');
});

test('a copy or a vanished container still names where the parts came from', () => {
  const sheet = build({ history: [entry(1, 8.318, APPLIED, { containerName: null, source: 'PO-2026-005', quantity: null, appliedAt: 'onbekend' })] });
  assert.equal(sheet.rows[0].hint, undefined, 'no quantity, no count');
  assert.equal(sheet.source, 'Opbouw uit PO-2026-005');
});

test('the phone editor and the desk show these rows and open the history on top; no purchase order is loaded for it', async () => {
  const read = (name: string) => readFile(new URL(`../src/app/features/sales/${name}`, import.meta.url), 'utf8');
  const editor = await read('sales-editor.ts');
  const desk = await read('sales-desk.ts');
  const open = /async openCostSheet\(line: PricedLine\): Promise<void> \{[\s\S]*?\n  \}\n/.exec(editor)?.[0] ?? '';
  assert.match(open, /salesCostBuild\(\{/);
  assert.match(open, /this\.catalog\.productCostHistory\(line\.productId\)/);
  assert.doesNotMatch(open, /purchaseOrders\(|costing\.lines/, 'never today\'s container calculation');
  for (const [name, text] of [['editor', editor], ['desk', desk]] as const) {
    assert.doesNotMatch(text, /Kostprijs uit calculatie/, name);
    assert.match(text, /@if \(sheet\.missing\) \{\s*<p class="hint">\{\{ sheet\.missing \}\}@if \(sheet\.product\) \{ <button class="linklike" type="button" \(click\)="costHistoryOpen\.set\(true\)">Historiek ›<\/button>\}<\/p>/, name);
    assert.match(text, /<app-product-cost-history-sheet \[product\]="product" \(closed\)="costHistoryOpen\.set\(false\)" \/>/, name);
  }
});
