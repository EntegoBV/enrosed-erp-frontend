import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { NO_DEFAULTS, horizonEndOf } from '../src/app/features/finance/cash-forecast.ts';
import { DEFAULT_CASH_LOCATION, parseCashLocation } from '../src/app/features/analyses/cash-url.ts';

/*
 * cash-options.ts imports cash-forecast and cash-url at runtime without an
 * extension: transpile it with those imports pointed at their .ts files.
 */
const href = (path: string) => new URL(path, import.meta.url).href;
const transpile = (source: string) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const dataUrl = (javascript: string) => `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`;
let source = await readFile(new URL('../src/app/features/analyses/cash-options.ts', import.meta.url), 'utf8');
source = source.replaceAll("'../finance/cash-forecast'", JSON.stringify(href('../src/app/features/finance/cash-forecast.ts')))
  .replaceAll("'./cash-url'", JSON.stringify(href('../src/app/features/analyses/cash-url.ts')));
const { cashOptionsOf, PAST_DAYS } = await import(dataUrl(transpile(source))) as typeof import('../src/app/features/analyses/cash-options.ts');

const TODAY = '2026-10-15';

test('the default location: 6 months, scenario on, stock included, 42 past days', () => {
  const options = cashOptionsOf(DEFAULT_CASH_LOCATION, TODAY, ['12:invoice:3']);
  assert.deepEqual(options, {
    horizonEnd: horizonEndOf(TODAY, 6), scenario: true, includeStock: true, rulesOff: [], openQuotesOn: false,
    defaults: NO_DEFAULTS, dismissed: ['12:invoice:3'], pastDays: 42,
  });
  assert.equal(PAST_DAYS, 42);
  assert.deepEqual(cashOptionsOf(parseCashLocation(() => null), TODAY, []), { ...options, dismissed: [] });
});

test('a location with h=3 changes only the horizon', () => {
  const plain = cashOptionsOf(DEFAULT_CASH_LOCATION, TODAY, []);
  const short = cashOptionsOf(parseCashLocation((key) => (key === 'h' ? '3' : null)), TODAY, []);
  assert.deepEqual(short, { ...plain, horizonEnd: horizonEndOf(TODAY, 3) });
  assert.notEqual(short.horizonEnd, plain.horizonEnd);
});

test('the link choices reach the options', () => {
  const location = parseCashLocation((key) => ({ voorraad: '0', uit: 'btw', open: '1', prijs: 'opslag', opslag: '40' } as Record<string, string>)[key] ?? null);
  const options = cashOptionsOf(location, TODAY, []);
  assert.deepEqual([options.includeStock, options.rulesOff, options.openQuotesOn, options.defaults.priceMode, options.defaults.markupPct],
    [false, ['vat'], true, 'MARKUP_PCT', 40]);
});
