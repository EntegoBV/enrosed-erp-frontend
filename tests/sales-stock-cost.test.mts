import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import type { SalesStockCostBatch, SalesStockCostLine } from '../src/app/core/api/stock-batch-models.ts';
import { batchFormat } from '../src/app/core/api/stock-batch-units.ts';
import { salesStockCostRows } from '../src/app/features/sales/sales-stock-cost.ts';

/* Stock batches (2026-10-25), batches contract §7.4/§10 F3: the "Kost bij levering" sheet of a shipped sales line. */

const DISPLAY = batchFormat({ singular: 'display', plural: 'displays' });
const PIECE = batchFormat({ singular: 'stuk', plural: 'stuks' });
/** Intl writes a narrow no-break space in "€ 8,32" and the grouping; compare with plain spaces. */
const plain = (value: string | undefined): string | undefined => value?.replace(/[  ]/g, ' ');

function batch(over: Partial<SalesStockCostBatch> = {}): SalesStockCostBatch {
  return { batchId: 12, kind: 'RECEIPT', containerName: 'Stolpen mei', orderNumber: 'PO-2026-005', pieces: 200, unitPieces: 12,
    unitCostEur: 35.4, unitCostExclEnrosedEur: 33.9, ...over };
}

function line(over: Partial<SalesStockCostLine> = {}): SalesStockCostLine {
  return { productId: 220, unitPieces: 12, pieces: 240, exclEnrosed: false, withoutBatchPieces: 0, withoutCostPieces: 0,
    batches: [batch({ batchId: 9101, containerName: 'Soap april', orderNumber: 'PO-2026-003', pieces: 40, unitCostEur: 34.1 }),
      batch({ batchId: 9102, containerName: 'Soap juni', orderNumber: 'PO-2026-007', pieces: 200, unitCostEur: 35.4 })], ...over };
}

test('two batches, pieces without batch and the expected cost: one row each, the stamped cost as the sum', () => {
  const rows = salesStockCostRows(line({ pieces: 246, withoutBatchPieces: 6 }), DISPLAY, 35.1983, 35.4, 'factuur');
  assert.deepEqual(rows.map((row) => row.label), ['Soap april', 'Soap juni', 'Zonder batch', 'Kost bij levering', 'Verwacht op de factuur']);
  assert.deepEqual(rows.map((row) => plain(row.hint)), ['3 displays + 4 los', '16 displays + 8 los', '6 los · tegen verwachte kost', 'per display', undefined]);
  assert.deepEqual(rows.map((row) => row.eur), [34.1, 35.4, 35.4, 35.1983, 35.4]);
  assert.deepEqual(rows.map((row) => row.sum ?? false), [false, false, false, true, false], 'only the stock cost closes the batches');
});

test('the sum row is the stock cost passed in, never a figure the sheet recomputes', () => {
  const rows = salesStockCostRows(line(), DISPLAY, 35.2, 35.4, 'factuur');
  const sum = rows.find((row) => row.sum)!;
  assert.equal(sum.label, 'Kost bij levering');
  assert.equal(sum.eur, 35.2);
  assert.equal(rows.at(-1)!.label, 'Verwacht op de factuur');
  assert.equal(rows.at(-1)!.sum, undefined, 'the expected cost stands apart');
});

test('a container sale line (exclEnrosed) uses the figures without Enrosed kost; a batch without that figure keeps its own', () => {
  const rows = salesStockCostRows(line({ exclEnrosed: true, batches: [
    batch({ batchId: 1, pieces: 120, unitCostEur: 35.4, unitCostExclEnrosedEur: 33.9 }),
    batch({ batchId: 2, kind: 'OPENING', containerName: null, orderNumber: null, pieces: 120, unitCostEur: 30.5, unitCostExclEnrosedEur: null }),
  ] }), DISPLAY, 32.2, 33.9, 'factuur');
  assert.deepEqual(rows.slice(0, 2).map((row) => [row.label, row.eur]), [['Stolpen mei', 33.9], ['Beginvoorraad', 30.5]]);
  assert.equal(rows.find((row) => row.sum)!.hint, 'per display · excl. Enrosed kost');
});

test('titles: the container, else the order number, else Beginvoorraad, Telling or Batch; costs at 4 decimals', () => {
  const rows = salesStockCostRows(line({ unitPieces: 1, pieces: 40, batches: [
    batch({ batchId: 1, containerName: '  ', orderNumber: 'PO-2026-011', pieces: 10, unitPieces: 1, unitCostEur: 3.15204 }),
    batch({ batchId: 2, kind: 'OPENING', containerName: null, orderNumber: null, pieces: 10, unitPieces: 1, unitCostEur: 3 }),
    batch({ batchId: 3, kind: 'COUNT', containerName: null, orderNumber: null, pieces: 1, unitPieces: 1, unitCostEur: 3 }),
    batch({ batchId: 4, kind: null, containerName: null, orderNumber: null, pieces: 19, unitPieces: 1, unitCostEur: 3 }),
  ] }), PIECE, 3.0378, 3.1, 'factuur');
  assert.deepEqual(rows.slice(0, 4).map((row) => [row.label, plain(row.hint)]),
    [['PO-2026-011', '10 stuks'], ['Beginvoorraad', '10 stuks'], ['Telling', '1 stuk'], ['Batch', '19 stuks']]);
  assert.equal(rows[0].eur, 3.152);
});

test('a batch without cost is no row of its own: its pieces count under "Zonder batch" at the expected cost', () => {
  const rows = salesStockCostRows(line({ productId: 226, unitPieces: 1, pieces: 30, withoutBatchPieces: 6, withoutCostPieces: 24, batches: [
    batch({ batchId: 9161, kind: 'OPENING', containerName: null, orderNumber: null, pieces: 24, unitPieces: 1, unitCostEur: null, unitCostExclEnrosedEur: null }),
  ] }), PIECE, 1.95, 1.95, 'factuur');
  assert.deepEqual(rows.map((row) => [row.label, plain(row.hint), row.eur]), [
    ['Zonder batch', '30 stuks · tegen verwachte kost', 1.95],
    ['Kost bij levering', 'per stuk', 1.95],
    ['Verwacht op de factuur', undefined, 1.95],
  ]);
});

test('without an expected cost: no "Verwacht" row, and the pieces without batch carry what the stamp left for them', () => {
  /* 2 displays at 34,10 and 1 display without batch; stamped 35,00 per display → the rest is 36,80. */
  const rows = salesStockCostRows(line({ pieces: 36, withoutBatchPieces: 12, batches: [batch({ batchId: 7, pieces: 24, unitCostEur: 34.1 })] }),
    DISPLAY, 35, null, 'factuur');
  assert.deepEqual(rows.map((row) => row.label), ['Stolpen mei', 'Zonder batch', 'Kost bij levering']);
  assert.equal(rows[1].eur, 36.8);
  assert.equal(plain(rows[1].hint), '1 display · tegen verwachte kost');
});

test('takes without a batch id or without pieces are no batch rows', () => {
  const rows = salesStockCostRows(line({ batches: [batch({ batchId: null, kind: null }), batch({ batchId: 5, pieces: 0 }), batch({ batchId: 6 })] }),
    DISPLAY, 35.4, 35.4, 'offerte');
  assert.deepEqual(rows.map((row) => row.label), ['Stolpen mei', 'Kost bij levering', 'Verwacht op de offerte']);
});

/* ------------------------------------------------------------------ screens */

const read = (path: string) => readFile(new URL(`../src/app/${path}`, import.meta.url), 'utf8');

test('the editor opens the stock sheet after shipment, cached per order, and falls back to the document\'s own cost', async () => {
  const editor = await read('features/sales/sales-editor.ts');
  const open = /async openCostSheet\(line: PricedLine\): Promise<void> \{[\s\S]*?\n  \}\n/.exec(editor)?.[0] ?? '';
  assert.match(open, /const stockUnitCost = line\.stockUnitCost \?\? null;/);
  assert.match(open, /heading: stockUnitCost != null \? 'Kost bij levering' : 'Gelande kost'/);
  assert.match(open, /stockUnitCost != null && orderId != null \? this\.salesStockCost\(orderId\) : Promise\.resolve\(null\)/);
  assert.match(open, /stock\.lines\.find\(\(item\) => item\.productId === line\.productId\)/);
  assert.match(open, /salesStockCostRows\(stockLine, batchFormat\(unit\), stockUnitCost, line\.expectedUnitCost \?\? null, this\.documentWord\(\)\)/);
  assert.match(open, /salesCostBuild\(\{ costEur: line\.expectedUnitCost \?\? line\.landedUnitCost,/, 'before shipment: the expected cost');
  assert.match(open, /if \(stockUnitCost != null\) rows\.push\(\{ label: 'Kost bij levering'/, 'a failed load still shows the cost the margin uses');
  const cache = /private salesStockCost\(orderId: number\)[\s\S]*?\n  \}\n/.exec(editor)?.[0] ?? '';
  assert.match(cache, /this\.stockCostCache\.get\(orderId\)/);
  assert.match(cache, /\.catch\(\(\) => \{\s*this\.stockCostCache\.delete\(orderId\);\s*return null;/, 'a failure is asked again next time');
  assert.match(editor, /<dt>\{\{ line\.stockUnitCost != null \? 'Kost bij levering' : 'Gelande kost' \}\} <i class="stock-tile__chev"/, 'phone tile');
});

test('editor and desk title the sheet by its heading and track rows by position (two Telling batches share a title)', async () => {
  for (const path of ['features/sales/sales-editor.ts', 'features/sales/sales-desk.ts']) {
    const text = await read(path);
    assert.match(text, /<app-sheet \[title\]="sheet\.heading \+ ' · ' \+ sheet\.title" \(closed\)="closeCostSheet\(\)">/, path);
    assert.doesNotMatch(text, /@for \(row of sheet\.rows; track row\.label\)/, path);
    assert.doesNotMatch(text, /'Gelande kost · ' \+ sheet\.title/, path);
  }
  const desk = await read('features/sales/sales-desk.ts');
  assert.match(desk, /<small>kost \{\{ line\.landedUnitCost \| eur: 2 \}\} <i aria-hidden="true">›<\/i><\/small>/, 'the margin cell keeps its small cost');
});

test('a sales line\'s stock cost never travels back to the server, nor its order step', async () => {
  const js = ts.transpileModule(await read('core/api/sales-api.ts'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
  const bodies: unknown[] = [];
  const http = Object.fromEntries(['get', 'post', 'put', 'delete'].map((verb) => [verb, (_url: string, body?: unknown) => { bodies.push(body); return {}; }]));
  const exports: any = {};
  vm.runInNewContext(js, { exports, require: (path: string) => {
    if (path === '@angular/core') return { Injectable: () => (target: unknown) => target, inject: () => http };
    if (path === '@angular/common/http') return { HttpClient: class {} };
    if (path === 'rxjs') return { firstValueFrom: (value: unknown) => Promise.resolve(value) };
    if (path === './api.config') return { API_BASE: '', api: (url: string) => url };
    return new Proxy({}, { get: () => () => '' });
  } });
  const api = new exports.SalesApi();
  const order = { id: 8, lines: [{ productId: 220, quantity: 20, unitCostEur: 35.4, unitsPerOrderStep: 1, stockCostEur: 35.2 },
    { productId: 226, quantity: 30, unitCostEur: 1.95, stockCostEur: null }] };
  await api.updateOrder(8, order);
  await api.previewOrder(8, order);
  for (const body of bodies) {
    for (const sent of (body as { lines: Record<string, unknown>[] }).lines) {
      assert.ok(!('stockCostEur' in sent), JSON.stringify(sent));
      assert.ok(!('unitsPerOrderStep' in sent), JSON.stringify(sent));
      assert.ok('unitCostEur' in sent, 'the document\'s own cost still goes');
    }
  }
  assert.equal(bodies.length, 2);
  assert.ok('stockCostEur' in order.lines[0], 'the screen\'s copy keeps the stamp');
  const plainOrder = { id: 9, lines: [{ productId: 1, quantity: 2 }] };
  await api.updateOrder(9, plainOrder);
  assert.equal(bodies.at(-1), plainOrder, 'a line without stamps goes as it is');
});
