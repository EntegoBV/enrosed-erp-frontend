import assert from 'node:assert/strict';
import test from 'node:test';
import type { LandedCostLine, ProductCostHistoryEntry } from '../src/app/core/api/models.ts';
import { appliedParts, costBuild, costDate, costDrift, costRows, impliedDutyPct, labelRows, liveParts, roundHalfUp } from '../src/app/features/products/product-price-build.ts';

const row = (over: Partial<ProductCostHistoryEntry> = {}): ProductCostHistoryEntry => ({
  id: 1, appliedAt: '2026-08-23', landedUnitEur: 8.318, previousLandedUnitEur: null, deltaEur: null, deltaPct: null,
  source: 'PO-2026-005', purchaseOrderId: 39, quantity: 100, exwPrice: null, exwCurrency: null, appliedBy: 'system', kind: 'SEED',
  ...over,
});

/* PO-2026-005 today, for 100 stolpen of DOM-15X30-BL: 10,3858 per stolp. */
const line = (over: Partial<LandedCostLine> = {}): LandedCostLine => ({
  productId: 94, productName: 'Rose in dome 15x30 single', quantity: 100, cartons: 10, cbm: 1, goodsUsd: 800,
  goodsEur: 731.04, originEur: 23.11, freightEur: 118.02, customsValueEur: 872.17, dutyRatePct: 10, dutySource: '7013',
  dutyEur: 87.22, destinationEur: 28.55, extraRevenueEur: 50.64, totalEur: 1038.58, landedUnitEur: 10.3858, cbmShare: 0.1,
  ...over,
});

const ORDER = { id: 39, number: 'PO-2026-005' };
const sum = (values: number[]) => Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;

test('half-up rounding without the binary slip', () => {
  assert.equal(roundHalfUp(1.005, 2), 1.01);
  assert.equal(roundHalfUp(8.318, 2), 8.32);
  assert.equal(roundHalfUp(-0.005, 2), -0.01);
  assert.equal(roundHalfUp(0.004, 2), 0);
  assert.equal(roundHalfUp(10.3858, 3), 10.386);
});

test('the screenshot case: a stored 8,318 without parts and a container that now calculates 10,3858', () => {
  const applied = appliedParts({ landedCostEur: 8.318 }, [row()]);
  assert.equal(applied.matches, true);
  assert.equal(applied.parts, null, 'a seed row kept no parts');
  const live = liveParts(line());
  assert.ok(live);
  assert.equal(live.unitEur, 10.3858);
  const build = costBuild({ storedEur: 8.318, applied, live, order: ORDER, appliedPer: 'per stolp', livePer: 'per stolp' });

  /* The stored cost stands alone, never under today's parts. */
  assert.deepEqual(build.applied, [{ label: 'Kostprijs per stolp', hint: 'Opbouw niet bewaard bij het toepassen (23/08/2026).', eur: 8.32, sum: true }]);

  /* Today's calculation is a block of its own that adds up to its own total. */
  assert.ok(build.live);
  assert.equal(build.live.title, 'PO-2026-005 rekent nu');
  const rows = build.live.rows;
  assert.deepEqual(rows.map((item) => item.eur), [7.31, 0.23, 1.18, 0.87, 0.29, 0.51, 10.39]);
  assert.equal(rows.at(-1)?.label, 'Geland per stolp');
  assert.equal(rows.at(-1)?.sum, true);
  assert.equal(sum(rows.slice(0, -1).map((item) => item.eur)), 10.39);

  /* The drift: + € 2,07, the difference of the two figures on screen (10,39 − 8,32). */
  assert.deepEqual(build.drift, { orderId: 39, orderNumber: 'PO-2026-005', unitEur: 10.3858, differenceEur: 2.07, absEur: 2.07, up: true,
    per: 'per stolp', basisNote: null });
});

test('stored parts explain the stored cost, with an Afronding row when the rounded parts miss the total', () => {
  const stored = row({ kind: 'APPLY', appliedAt: '2026-10-20', landedUnitEur: 3.012, goodsEur: 1.004, originEur: 1.004, freightEur: 1.004,
    dutyEur: 0, destinationEur: 0, enrosedEur: 0, separateEur: null });
  const applied = appliedParts({ landedCostEur: 3.012 }, [stored, row()]);
  assert.ok(applied.parts);
  const build = costBuild({ storedEur: 3.012, applied, live: null, order: ORDER, appliedPer: 'per stolp', livePer: 'per stolp' });
  assert.deepEqual(build.applied.map((item) => [item.label, item.eur]), [
    ['Inkoopprijs (EXW)', 1], ['+ Lokale kosten bij vertrek', 1], ['+ Zeevracht', 1], ['± Afronding', 0.01], ['Kostprijs per stolp', 3.01],
  ]);
  assert.equal(build.applied.at(-1)?.hint, 'toegepast 20/10/2026');
  assert.equal(build.live, null, 'no container calculation without a live line');
  assert.equal(build.drift, null);
});

test('no live block when the container still calculates the explained stored cost', () => {
  const stored = row({ kind: 'APPLY', landedUnitEur: 10.3858, goodsEur: 7.3104, originEur: 0.2311, freightEur: 1.1802, dutyEur: 0.8722,
    destinationEur: 0.2855, enrosedEur: 0.5064, separateEur: 0 });
  const applied = appliedParts({ landedCostEur: 10.3858 }, [stored]);
  const build = costBuild({ storedEur: 10.3858, applied, live: liveParts(line()), order: ORDER, appliedPer: 'per stolp', livePer: 'per stolp',
    appliedWords: { dutyPct: impliedDutyPct(applied.parts!) } });
  assert.equal(build.drift, null);
  assert.equal(build.live, null);
  assert.equal(build.applied.find((item) => item.label.includes('Invoerrechten'))?.label, '+ Invoerrechten 10 %');
  assert.equal(sum(build.applied.slice(0, -1).map((item) => item.eur)), build.applied.at(-1)?.eur);
});

test('a live block without drift still shows when the stored cost kept no parts', () => {
  const applied = appliedParts({ landedCostEur: 10.3858 }, [row({ landedUnitEur: 10.3858 })]);
  const build = costBuild({ storedEur: 10.3858, applied, live: liveParts(line()), order: ORDER, appliedPer: 'per stolp', livePer: 'per stolp' });
  assert.equal(build.drift, null);
  assert.ok(build.live);
  assert.equal(build.live.rows.at(-1)?.eur, 10.39);
});

test('a gone container gives no live block and no drift', () => {
  const applied = appliedParts({ landedCostEur: 8.318 }, [row()]);
  const build = costBuild({ storedEur: 8.318, applied, live: liveParts(line()), order: null, appliedPer: 'per stolp', livePer: 'per stolp' });
  assert.equal(build.live, null);
  assert.equal(build.drift, null);
});

test('the inspection and other costs are a row of their own and the parts reach the total', () => {
  const live = liveParts(line({ separateEur: 50, totalEur: 1088.58, landedUnitEur: 10.8858 }));
  assert.ok(live);
  assert.equal(live.parts.separateEur, 0.5);
  const rows = labelRows(costRows(live.parts, live.unitEur), {}, 'Geland per stolp');
  assert.deepEqual(rows.find((item) => item.label === '+ Inspectie en andere kosten')?.eur, 0.5);
  assert.equal(sum(rows.slice(0, -1).map((item) => item.eur)), rows.at(-1)?.eur);
  assert.equal(rows.at(-1)?.eur, 10.89);
});

test('the newest row holding another cost leaves the stored cost unexplained', () => {
  const other = row({ kind: 'APPLY', landedUnitEur: 8, goodsEur: 6, originEur: 0.5, freightEur: 1, dutyEur: 0.5 });
  const applied = appliedParts({ landedCostEur: 8.318 }, [other]);
  assert.equal(applied.matches, false);
  assert.equal(applied.parts, null);
  const build = costBuild({ storedEur: 8.318, applied, live: null, order: null, appliedPer: 'per stolp', livePer: 'per stolp' });
  assert.deepEqual(build.applied, [{ label: 'Kostprijs per stolp', hint: 'Opbouw niet bewaard bij het toepassen.', eur: 8.32, sum: true }],
    'without the row’s date: it is not the date of this cost');
  assert.equal(appliedParts({ landedCostEur: 8.318 }, []).row, null);
  assert.deepEqual(costBuild({ storedEur: null, applied: appliedParts({ landedCostEur: null }, []), live: null, order: null,
    appliedPer: 'per stolp', livePer: 'per stolp' }).applied, [], 'no cost, no cost row');
});

test('display basis wording on both blocks and on the drift', () => {
  const applied = appliedParts({ landedCostEur: 30 }, [row({ landedUnitEur: 30, salesUnit: 'DISPLAY', piecesPerUnit: 12 })]);
  const live = liveParts(line({ quantity: 10, landedUnitEur: 32.5 }));
  const build = costBuild({ storedEur: 30, applied, live, order: ORDER, appliedPer: 'per display van 12', livePer: 'per display van 12' });
  assert.equal(build.applied[0].label, 'Kostprijs per display van 12');
  assert.equal(build.live?.rows.at(-1)?.label, 'Geland per display van 12');
  assert.equal(build.drift?.per, 'per display van 12');
  assert.equal(build.drift?.differenceEur, 2.5);
});

test('zero parts are left out, the drift needs a different figure on screen, and the container words lead', () => {
  assert.deepEqual(costRows({ goodsEur: 2, originEur: 0, freightEur: 0.004, dutyEur: 0, destinationEur: 0, enrosedEur: 0, separateEur: 0.00004 }, 2.004),
    [{ key: 'goodsEur', eur: 2 }, { key: 'freightEur', eur: 0 }, { key: 'total', eur: 2 }], 'a part below half a cent stays as 0,00');
  assert.deepEqual(costDrift(8.318, 8.3229), { differenceEur: 0, drift: false });
  assert.deepEqual(costDrift(8.318, 8.313), { differenceEur: -0.01, drift: true });
  const labels = { originCountry: 'China', loadingPort: 'Ningbo', destinationPort: 'Rotterdam', originCostsLabel: 'Lokale kosten China',
    originRoute: 'fabriek → Ningbo', seaFreightLabel: 'Zeevracht', seaFreightRoute: 'Ningbo → Rotterdam', destinationCostsLabel: 'Rotterdam → magazijn' };
  const live = liveParts(line())!;
  const rows = labelRows(costRows(live.parts, live.unitEur), { labels, dutyPct: 10, hsCode: '7013', goodsHint: '100 stolpen in PO-2026-005' }, 'Geland per stolp');
  assert.deepEqual(rows.map((item) => item.label), ['Inkoopprijs (EXW)', '+ Lokale kosten China', '+ Zeevracht', '+ Invoerrechten 10 %',
    '+ Rotterdam → magazijn', '+ Enrosed kost', 'Geland per stolp']);
  assert.equal(rows[0].hint, '100 stolpen in PO-2026-005');
  assert.equal(rows[2].hint, 'Ningbo → Rotterdam');
  assert.equal(rows[3].hint, 'douane, HS-code 7013');
  assert.equal(liveParts(line({ quantity: 0 })), null);
  assert.equal(impliedDutyPct({ goodsEur: 5, originEur: 0, freightEur: 0, dutyEur: 0, destinationEur: 0, enrosedEur: 0, separateEur: 0 }), null);
  assert.equal(costDate('2026-08-23'), '23/08/2026');
  assert.equal(costDate(null), null);
});

test('the drift is the difference of the figures on screen', () => {
  /* 8,315 and 8,32 both show as 8,32: no line that names a difference nobody sees. */
  assert.deepEqual(costDrift(8.315, 8.32), { differenceEur: 0, drift: false });
  assert.deepEqual(costDrift(8.3151, 8.3201), { differenceEur: 0, drift: false });
  /* 8,3149 shows as 8,31 and 8,3151 as 8,32. */
  assert.deepEqual(costDrift(8.3149, 8.3151), { differenceEur: 0.01, drift: true });
  assert.deepEqual(costDrift(8.3149, 8.3251), { differenceEur: 0.02, drift: true });
  const applied = appliedParts({ landedCostEur: 8.314 }, [row({ landedUnitEur: 8.314 })]);
  const build = costBuild({ storedEur: 8.314, applied, live: liveParts(line()), order: ORDER, appliedPer: 'per stolp', livePer: 'per stolp' });
  assert.equal(build.applied.at(-1)?.eur, 8.31);
  assert.equal(build.live?.rows.at(-1)?.eur, 10.39);
  assert.deepEqual([build.drift?.differenceEur, build.drift?.absEur, build.drift?.up], [2.08, 2.08, true], '10,39 − 8,31');
  const same = costBuild({ storedEur: 8.315, applied: appliedParts({ landedCostEur: 8.315 }, [row({ landedUnitEur: 8.315 })]),
    live: liveParts(line({ landedUnitEur: 8.32 })), order: ORDER, appliedPer: 'per stolp', livePer: 'per stolp' });
  assert.equal(same.drift, null);
});

test('a cheap piece keeps its small parts as 0,00 rows; Afronding is only the rounding', () => {
  const rows = costRows({ goodsEur: 0.3, originEur: 0.004, freightEur: 0.004, dutyEur: 0.004, destinationEur: 0.004, enrosedEur: 0.004, separateEur: 0 }, 0.32);
  assert.deepEqual(rows, [{ key: 'goodsEur', eur: 0.3 }, { key: 'originEur', eur: 0 }, { key: 'freightEur', eur: 0 }, { key: 'dutyEur', eur: 0 },
    { key: 'destinationEur', eur: 0 }, { key: 'enrosedEur', eur: 0 }, { key: 'rounding', eur: 0.02 }, { key: 'total', eur: 0.32 }]);
  const small = costRows({ goodsEur: 0.0212, originEur: 0.0012, freightEur: 0.0038, dutyEur: 0.0026, destinationEur: 0.0018, enrosedEur: 0.0024, separateEur: 0 }, 0.033);
  assert.deepEqual(small.map((item) => item.key), ['goodsEur', 'originEur', 'freightEur', 'dutyEur', 'destinationEur', 'enrosedEur', 'rounding', 'total']);
  assert.deepEqual(small.slice(-2), [{ key: 'rounding', eur: 0.01 }, { key: 'total', eur: 0.03 }]);
});

test('a copy shows the parts it took over with the day it was copied; a re-apply reads as applied', () => {
  const parts = { goodsEur: 7.3104, originEur: 0.2311, freightEur: 0.1802, dutyEur: 0.0722, destinationEur: 0.0175, enrosedEur: 0.5066, separateEur: 0 };
  const copy = row({ kind: 'COPY', appliedAt: '2026-10-25', landedUnitEur: 8.318, appliedBy: 'emre', ...parts });
  const applied = appliedParts({ landedCostEur: 8.318 }, [copy]);
  assert.equal(applied.kind, 'COPY');
  assert.ok(applied.parts, 'a copy keeps parts only when its cost is the source row\'s, so they explain it');
  const build = costBuild({ storedEur: 8.318, applied, live: null, order: null, appliedPer: 'per stolp', livePer: 'per stolp' });
  assert.equal(build.applied.at(-1)?.hint, 'overgenomen bij kopiëren 25/10/2026');
  assert.equal(sum(build.applied.slice(0, -1).map((item) => item.eur)), build.applied.at(-1)?.eur);

  const bare = appliedParts({ landedCostEur: 8.318 }, [row({ kind: 'COPY', appliedAt: '2026-10-25', appliedBy: 'emre' })]);
  assert.deepEqual(costBuild({ storedEur: 8.318, applied: bare, live: null, order: null, appliedPer: 'per stolp', livePer: 'per stolp' }).applied[0].hint,
    'Opbouw niet bewaard bij het kopiëren (25/10/2026).');

  const again = appliedParts({ landedCostEur: 8.318 }, [row({ kind: 'REAPPLY', appliedAt: '2026-10-24', appliedBy: 'emre', ...parts })]);
  assert.equal(costBuild({ storedEur: 8.318, applied: again, live: null, order: null, appliedPer: 'per stolp', livePer: 'per stolp' }).applied.at(-1)?.hint,
    'toegepast 24/10/2026');
});

test('a stored cost on another basis gets no difference, only the basis it was applied on', () => {
  const applied = appliedParts({ landedCostEur: 30 }, [row({ landedUnitEur: 30, salesUnit: 'DISPLAY', piecesPerUnit: 12 })]);
  const build = costBuild({ storedEur: 30, applied, live: liveParts(line({ landedUnitEur: 2.7 })), order: ORDER,
    appliedPer: 'per display van 12', livePer: 'per stolp', sameBasis: false });
  assert.deepEqual(build.drift, { orderId: 39, orderNumber: 'PO-2026-005', unitEur: 2.7, differenceEur: null, absEur: null, up: false,
    per: 'per stolp', basisNote: 'toegepast per display van 12' });
  assert.equal(build.applied[0].label, 'Kostprijs per display van 12');
  assert.equal(build.live?.rows.at(-1)?.label, 'Geland per stolp');
});

test('a history that did not load says so, never "niet bewaard"', () => {
  const applied = appliedParts({ landedCostEur: 8.318 }, null);
  assert.deepEqual([applied.loaded, applied.row, applied.parts], [false, null, null]);
  const build = costBuild({ storedEur: 8.318, applied, live: liveParts(line()), order: ORDER, appliedPer: 'per stolp', livePer: 'per stolp' });
  assert.deepEqual(build.applied, [{ label: 'Kostprijs per stolp', hint: 'Opbouw niet geladen.', eur: 8.32, sum: true }]);
  assert.ok(build.live, 'the container block still shows');
  assert.equal(appliedParts({ landedCostEur: 8.318 }, []).loaded, true);
});
