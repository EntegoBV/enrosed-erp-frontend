import assert from 'node:assert/strict';
import test from 'node:test';
import type { PurchaseOrderView } from '../src/app/core/api/models.ts';
import { containerName } from '../src/app/features/purchasing/container-name.ts';
import { freightContainersView, usdContainersView } from '../src/app/features/analyses/drill-market.ts';
import type { MarketDrillContext } from '../src/app/features/analyses/drill-market.ts';
import type { DrillView } from '../src/app/features/analyses/drill-model.ts';
import {
  alignedQuoteVsMarket, freightContainerRows, marketOnOrBefore, usdContainerRows,
} from '../src/app/features/analyses/market-math.ts';

/*
 * Markt & container drill-downs (design/analyses2/design.md §B.9, D-M1): the
 * open containers in dollar at the order's and at today's ECB rate, our freight
 * per container against Drewry of its own week, and the "laatste offerte" line
 * compared with the market of the quote's week, never the newest point.
 */

const po = (id: number, order: Partial<PurchaseOrderView['order']>, totals: { goodsUsd?: number; goodsEur?: number } = {}): PurchaseOrderView => ({
  order: { id, number: `PO-2026-0${id}`, alias: null, status: 'BESTELD', orderDate: '2026-08-01', usdToEurGoods: 0.9, freightUsd: 0, freightViaSupplier: null,
    archivedAt: null, departurePort: 'Ningbo', destinationPort: 'Rotterdam', shippedOn: null, ...order },
  costing: { totals: { goodsUsd: totals.goodsUsd ?? 0, goodsEur: totals.goodsEur ?? 0 } },
} as unknown as PurchaseOrderView);

const ctx: MarketDrillContext = { containerName: (row) => containerName(row), day: (day) => day };
const cents = (value: unknown) => Math.round((typeof value === 'number' ? value : 0) * 100);
const sum = (drill: DrillView) => drill.rows.reduce((total, row) => total + cents(row.cells[drill.valueKey!]), 0);

test('marketOnOrBefore: the last point on or before the day, at most maxDays earlier', () => {
  const series = { dates: ['2026-05-28', '2026-06-04', '2026-06-11', '2026-06-18'], values: [2100, 2350, 2400, 2600] };
  assert.deepEqual(marketOnOrBefore(series, '2026-06-12', 14), { date: '2026-06-11', value: 2400 });
  assert.deepEqual(marketOnOrBefore(series, '2026-06-11', 14), { date: '2026-06-11', value: 2400 }, 'the same day counts');
  assert.equal(marketOnOrBefore(series, '2026-05-20', 14), null, 'nothing before');
  assert.equal(marketOnOrBefore(series, '2026-07-20', 14), null, 'the last point is more than 14 days older');
  assert.deepEqual(marketOnOrBefore(series, '2026-07-02', 14), { date: '2026-06-18', value: 2600 });
  assert.equal(marketOnOrBefore({ dates: [], values: [] }, '2026-06-12'), null);
});

test('the latest quote against the market of its own week; FBX11 only without Drewry; never the newest point', () => {
  const drewry = { dates: ['2026-06-04', '2026-06-11', '2026-10-15'], values: [2350, 2400, 1800] };
  const fbx = { dates: ['2026-06-10', '2026-10-14'], values: [2500, 1900] };
  const own = [{ route: 'Ningbo → Rotterdam', quotedOn: '2026-06-12', usd: 3264 }, { route: 'Nansha → Rotterdam', quotedOn: '2026-05-02', usd: 3500 }];
  const q = alignedQuoteVsMarket(own, [{ name: 'Drewry', series: drewry }, { name: 'FBX11', series: fbx }]);
  assert.deepEqual(q, { route: 'Ningbo → Rotterdam', quotedOn: '2026-06-12', ownUsd: 3264, benchmark: 'Drewry', marketOn: '2026-06-11', marketUsd: 2400, pct: 36 });
  /* The newest Drewry point (1800 in October) would have said + 81 %: that mixes four months of market movement. */
  assert.notEqual(q!.marketUsd, 1800);
  const noDrewry = alignedQuoteVsMarket(own, [{ name: 'Drewry', series: { dates: ['2026-04-01'], values: [2000] } }, { name: 'FBX11', series: fbx }]);
  assert.deepEqual([noDrewry!.benchmark, noDrewry!.marketOn, noDrewry!.marketUsd], ['FBX11', '2026-06-10', 2500]);
  assert.equal(alignedQuoteVsMarket(own, [{ name: 'Drewry', series: { dates: ['2026-10-01'], values: [2000] } }]), null, 'no market in that week');
  assert.equal(alignedQuoteVsMarket([], [{ name: 'Drewry', series: drewry }]), null);
});

test('open containers in dollar: open statuses only, not archived, goods in dollar; € today = goods $ / the ECB rate', () => {
  const views = [
    po(41, { status: 'ONDERWEG', usdToEurGoods: 0.92, alias: 'container/2026/002' }, { goodsUsd: 50000, goodsEur: 46000 }),
    po(43, { status: 'BESTELD', usdToEurGoods: 0.88 }, { goodsUsd: 20000, goodsEur: 17600 }),
    po(45, { status: 'CONCEPT', usdToEurGoods: 0.9 }, { goodsUsd: 10000, goodsEur: 9000 }),
    po(39, { status: 'ONTVANGEN' }, { goodsUsd: 30000, goodsEur: 27000 }),
    po(44, { status: 'BESTELD', archivedAt: '2026-10-01T10:00:00Z' }, { goodsUsd: 8000, goodsEur: 7200 }),
    po(46, { status: 'BESTELD' }, { goodsUsd: 0, goodsEur: 0 }),
  ];
  const rows = usdContainerRows(views, 1.12);
  assert.deepEqual(rows.map((row) => row.id), [41, 43, 45]);
  const first = rows[0];
  assert.equal(first.eurToday, Math.round(50000 / 1.12 * 100) / 100);
  assert.equal(first.eurOrder, 46000);
  assert.equal(first.diffEur, Math.round((first.eurToday - first.eurOrder) * 100) / 100);
  assert.equal(Math.round(first.orderRate! * 10000) / 10000, 1.087);
  assert.deepEqual(usdContainerRows(views, 0), [], 'no ECB rate, no rows');

  const drill = usdContainersView(rows, { usdPerEur: 1.12, asOf: '2026-10-20' }, ctx);
  assert.equal(drill.id, 'market.usdContainers');
  assert.equal(sum(drill), rows.reduce((total, row) => total + cents(row.diffEur), 0));
  assert.equal(cents(drill.total!.value), sum(drill));
  assert.deepEqual([drill.total!.format, drill.total!.label], ['eurSigned', 'Verschil vandaag']);
  assert.deepEqual(drill.sort, { key: 'absDiff', dir: 'desc' });
  const diffs = drill.rows.map((row) => Math.abs(row.cells['diff'] as number));
  assert.deepEqual(diffs, [...diffs].sort((left, right) => right - left), 'largest difference first, either way');
  assert.equal(drill.rows.find((row) => row.key === 'po:41')!.cells['name'], 'container/2026/002', 'the Herkenbare naam');
  assert.deepEqual(drill.rows.find((row) => row.key === 'po:43')!.link, { path: ['/purchasing', 43] });
  assert.equal(drill.rows.find((row) => row.key === 'po:41')!.tone, 'ok', 'cheaper today than in the order');
  assert.equal(drill.rows.find((row) => row.key === 'po:43')!.tone, 'warn', 'dearer today than in the order');
  assert.equal(drill.note, 'Al betaalde termijnen gingen aan hun eigen koers.');
  assert.equal(usdContainersView([], { usdPerEur: 1.12, asOf: '2026-10-20' }, ctx).empty, 'Geen open containers met goederen in dollar.');
});

test('freight per container: own freight only, the day it sailed (else ordered), Drewry of that week', () => {
  const drewry = { dates: ['2026-06-04', '2026-06-11', '2026-08-27', '2026-09-03'], values: [2350, 2400, 3000, 3100] };
  const views = [
    po(41, { status: 'ONDERWEG', freightUsd: 3264, shippedOn: '2026-06-12', orderDate: '2026-05-01' }),
    po(43, { status: 'BESTELD', freightUsd: 3600, orderDate: '2026-09-05' }),
    po(45, { status: 'CONCEPT', freightUsd: 3000, orderDate: '2026-12-01' }),
    po(39, { status: 'ONTVANGEN', freightUsd: 2800, freightViaSupplier: true, shippedOn: '2026-06-10' }),
    po(44, { status: 'BESTELD', freightUsd: 2900, archivedAt: '2026-10-01T10:00:00Z' }),
    po(46, { status: 'BESTELD', freightUsd: 0 }),
  ];
  const rows = freightContainerRows(views, drewry);
  assert.deepEqual(rows.map((row) => row.id), [45, 43, 41], 'newest first');
  const shipped = rows.find((row) => row.id === 41)!;
  assert.deepEqual([shipped.day, shipped.shipped, shipped.marketUsd, shipped.marketOn, shipped.diffPct], ['2026-06-12', true, 2400, '2026-06-11', 36]);
  const ordered = rows.find((row) => row.id === 43)!;
  assert.deepEqual([ordered.day, ordered.shipped, ordered.marketUsd], ['2026-09-05', false, 3100]);
  assert.equal(rows.find((row) => row.id === 45)!.diffPct, null, 'no Drewry within 14 days');
  assert.equal(shipped.route, 'Ningbo → Rotterdam');

  const drill = freightContainersView(rows, ctx);
  assert.equal(drill.id, 'market.freightContainers');
  assert.equal(drill.valueKey, null);
  assert.equal(drill.total, null);
  assert.deepEqual(drill.sort, { key: 'day', dir: 'desc' });
  assert.equal(ordered.diffPct, 16.1);
  const pcts = rows.map((row) => row.diffPct).filter((value): value is number => value !== null);
  const mean = Math.round(pcts.reduce((total, value) => total + value, 0) / pcts.length * 10) / 10;
  assert.equal(drill.summary, `gemiddeld + ${String(mean).replace('.', ',')} % t.o.v. Drewry`);
  assert.equal(drill.rows.find((row) => row.key === 'po:45')!.pill, 'Concept');
  assert.deepEqual(drill.rows.find((row) => row.key === 'po:41')!.link, { path: ['/purchasing', 41] });
  assert.equal(drill.columns.find((col) => col.key === 'diff')!.phone, 'value');
  assert.equal(freightContainersView([], ctx).summary, 'Geen Drewry-notering in die weken');
});
