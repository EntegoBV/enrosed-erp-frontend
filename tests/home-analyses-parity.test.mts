import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import type { Product, StockLevel } from '../src/app/core/api/models.ts';
import type { TicaAnalyticsDay } from '../src/app/core/api/tica-api.ts';
import { inventoryAnalysis, resultAnalysis } from '../src/app/features/analyses/analysis-metrics.ts';
import { withAllLocations } from '../src/app/features/analyses/analyses-stock.ts';
import { withTicaResult } from '../src/app/features/analyses/tica-analysis.ts';

/*
 * The two home tiles that open Analyses show the figure of the screen they open (design/analyses2 D-H1, D-H2):
 * Resultaat dit jaar with TICA as Analyses › Resultaat, Bekende voorraadkost over every location as Analyses › Voorraad.
 * The widgets import Angular at run time, so their sources are read as text; the rules they call are checked on a fixture.
 */
const read = (path: string) => readFile(new URL(`../src/app/features/dashboard/${path}`, import.meta.url), 'utf8');

test('D-H1: home Resultaat adds the TICA days as Analyses does; without them result and margin read "—"', async () => {
  const widget = await read('widgets/home-resultaat.ts');
  assert.match(widget, /readonly year = computed\(\(\) => withTicaResult\(resultAnalysis\(this\.data\.salesOrders\(\), this\.data\.purchases\(\), this\.data\.costs\(\),/);
  assert.match(widget, /\.\.\.this\.money\(\) \}\), this\.data\.ticaDays\(\)\)\);/);
  assert.match(widget, /readonly monthCosts = computed\(\(\) => resultAnalysis\(\[\], \[\], this\.data\.costs\(\),/, 'the month costs stay as they are');
  assert.match(widget, /\{\{ ticaFailed\(\) \? '—' : whole\(year\(\)\.resultEur\) \}\}/);
  assert.match(widget, /<dt>Marge<\/dt><dd>\{\{ ticaFailed\(\) \? '—' : whole\(year\(\)\.marginEur\) \}\}<\/dd>/);
  assert.match(widget, /this\.data\.ticaState\(\) === 'loading' \? 'loading' : state/, 'the first load waits for TICA');
  const data = await read('home-data.ts');
  assert.match(data, /want\('verkoop'\) \? this\.tica\.analytics\(\)\.then\(/, 'fetched with the sales');
  assert.match(data, /\.\.\.\(this\.ticaState\(\) === 'failed' \? \['TICA verkopen'\] : \[\]\)/, 'a failure is named in the status');

  /* The rule itself: the TICA margin of this year counts; the commission is already one of the costs. */
  const days: TicaAnalyticsDay[] = [
    { date: '2026-03-02', transactionCount: 4, quantity: 10, revenueExcl: 3_000, goodsCostEur: 1_200, missingCostLines: 0 },
    { date: '2025-12-30', transactionCount: 1, quantity: 2, revenueExcl: 500, goodsCostEur: 100, missingCostLines: 0 },
  ];
  const base = resultAnalysis([], [], [], { from: '2026-01-01', to: '2026-10-21' });
  const year = withTicaResult(base, days);
  assert.equal(year.marginEur, base.marginEur + 1_800);
  assert.equal(year.resultEur, base.resultEur + 1_800);
});

test('D-H2: home Voorraad counts every stock location, as Analyses › Voorraad', async () => {
  const widget = await read('widgets/home-voorraad.ts');
  assert.match(widget, /for \(const product of levels \? withAllLocations\(this\.data\.products\(\), levels\) : this\.data\.products\(\)\) \{/);
  assert.match(widget, /this\.data\.stockLevels\(\) === undefined \? 'loading' : state/, 'the first load waits for the levels');
  const data = await read('home-data.ts');
  assert.match(data, /want\('voorraad'\) \? this\.catalog\.stockLevels\(\)\.then\(/, 'fetched with the products');
  assert.match(data, /\.\.\.\(this\.levelsFailed\(\) \? \['voorraadlocaties'\] : \[\]\)/);

  /* The home's sum (known, in stock, with a cost) over withAllLocations is Analyses' Kostwaarde. */
  const product = (id: number, stockQuantity: number, landedCostEur: number | null): Product =>
    ({ id, name: `P${id}`, sku: `S${id}`, active: true, inventoryKnown: true, stockQuantity, landedCostEur, salesPriceEur: 10 }) as unknown as Product;
  const products = [product(1, 10, 2), product(2, 0, 5), product(3, 4, null)];
  const levels = [{ productId: 1, quantity: 10 }, { productId: 1, quantity: 200 }, { productId: 2, quantity: 3 }] as StockLevel[];
  const homeSum = (rows: readonly Product[]) => rows.reduce((sum, row) =>
    row.inventoryKnown === true && row.stockQuantity > 0 && row.landedCostEur != null ? sum + row.stockQuantity * row.landedCostEur : sum, 0);
  const all = withAllLocations(products, levels);
  assert.equal(homeSum(all), 210 * 2 + 3 * 5, 'the fair location counts');
  assert.equal(homeSum(all), inventoryAnalysis(all, [], { today: '2026-10-21' }).stock.costValueEur);
  assert.equal(homeSum(products), 20, 'the warehouse alone, as before');
});
