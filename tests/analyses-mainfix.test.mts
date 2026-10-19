import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

/*
 * The Analyses + home bug fixes on main (design/mainfix/bugs.md, A-M…). The components import Angular at run
 * time, so their sources are read as text.
 */
const read = (path: string) => readFile(new URL(`../src/app/features/${path}`, import.meta.url), 'utf8');

test('A-M1: home Resultaat calls resultAnalysis with the options of Analyses › Resultaat', async () => {
  const source = await read('dashboard/widgets/home-resultaat.ts');
  assert.match(source, /costCharge: \(cost, from, to\) => costChargeIn\(cost, from, to, today\), openEur: openOf, today/);
  assert.equal(source.match(/\.\.\.this\.money\(\)/g)?.length, 2, 'the year and this month');
});

test('A-M2: home Verkoop lands on Verkoop › Deze maand', async () => {
  const source = await read('dashboard/widgets/home-verkoop.ts');
  assert.match(source, /link="\/analyses\/sales" \[query\]="monthQuery"/);
  assert.match(source, /monthQuery = \{ periode: 'maand' \}/);
  assert.match(source, /navigate\(\['\/analyses\/sales'\], \{ queryParams: this\.monthQuery \}\)/);
});

test('A-M4/A-M15: one pipeline; the Overzicht snapshots say "vandaag", Verkoop "in de periode"', async () => {
  const page = await read('analyses/analyses-page.ts');
  assert.match(page, /readonly openSales = computed\(\(\) => openPipelineQuotes\(this\.salesOrders\(\)\)\)/);
  assert.match(page, /an-kpi__sub">vandaag · \{\{ incomingPieces\(\)/);
  assert.match(page, /an-kpi__sub">vandaag · \{\{ inventoryValuedPieces\(\)/);
  assert.match(page, /an-kpi__sub">vandaag · \{\{ plural\(openSales\(\)\.length/);
  assert.match(page, /'open offerte', 'open offertes'\) \}\} in de periode/);
  assert.match(page, /title: 'Open offertes', link: '\/analyses\/sales', query: OPEN_QUOTES_QUERY/);
  assert.match(page, /OPEN_QUOTES_QUERY: Record<string, string> = \{ periode: 'alle' \}/);
});

test('A-M5: the product page and the website builder open the right part', async () => {
  assert.match(await read('products/product-desk.ts'), /\[routerLink\]="\['\/analyses', 'purchasing'\]" \[queryParams\]="\{ deel: 'afwijkingen' \}">Ontvangstanalyse ›/);
  assert.match(await read('website-builder/content-translations-page.ts'), /routerLink="\/analyses\/website" \[queryParams\]="\{ source: 'SEARCH_CONSOLE' \}">Zoekcijfers ›/);
});

test('A-M10: each series of Gefactureerd per maand names its VAT base', async () => {
  const page = await read('analyses/analyses-page.ts');
  assert.match(page, /label: 'Gefactureerd incl\. btw'/);
  assert.match(page, /label: 'Geaccepteerde offertes excl\. btw'/);
});

test('A-M11: Vrachttarief noteren is an iOS sheet on the phone', async () => {
  assert.match(await read('analyses/market-analysis.ts'), /<app-sheet title="Vrachttarief noteren" \[variant\]="desk\.active\(\) \? 'default' : 'ios'"/);
});

test('A-M12/A-M13/A-M14/A-M18: live Markt period, unfocused count, no dead toast, no needless URL write', async () => {
  const page = await read('analyses/analyses-page.ts');
  assert.match(page, /marketMonths = computed\(\(\) => \{ this\.section\(\); return storedMarketMonths\(\); \}\)/);
  assert.doesNotMatch(page, /marketMonths = storedMarketMonths\(\)/);
  assert.match(page, /const affected = this\.qualityReport\(\)\.totals\.affectedOrders/);
  assert.doesNotMatch(page, /Ontvangstwaarde gewist/);
  assert.match(page, /if \(Object\.values\(state\)\.some\(\(value\) => value !== null\)\) this\.writeParams\(state\)/);
});

test('COLUMNS: the Kasprognose register keeps a seven-digit amount with cents whole (Bedrag, Saldo)', async () => {
  const css = await readFile(new URL('../src/styles/cash-forecast.scss', import.meta.url), 'utf8');
  assert.match(css, /\.cf-table\{--wk-cols:78px minmax\(0,1\.1fr\) minmax\(0,1fr\) 116px 116px;/);
});
