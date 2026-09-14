import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { websiteAnalyticsRouteState } from '../src/app/features/analyses/website-analytics-route.ts';

function params(query = '') { return new URLSearchParams(query); }

test('dashboard deep link opens Search Console for the same 30-day period', () => {
  assert.deepEqual(websiteAnalyticsRouteState(params('source=SEARCH_CONSOLE&days=30')), { source: 'SEARCH_CONSOLE', days: 30 });
});

test('normal navigation keeps the existing internal measurement and 30-day defaults', () => {
  assert.deepEqual(websiteAnalyticsRouteState(params()), { source: 'INTERNAL', days: 30 });
  assert.deepEqual(websiteAnalyticsRouteState(params('unrelated=value')), { source: 'INTERNAL', days: 30 });
});

test('only exact known source and period values are accepted, including duplicate rejection', () => {
  for (const query of ['source=https://example.com&days=999999', 'source=search_console&days=0',
    'source=SEARCH_CONSOLE&source=GA4&days=30&days=90', 'source=&days=NaN', 'days=3e1', 'days=-7']) {
    assert.deepEqual(websiteAnalyticsRouteState(params(query)), { source: 'INTERNAL', days: 30 });
  }
  for (const days of [1, 7, 30, 90, 365]) {
    assert.deepEqual(websiteAnalyticsRouteState(params(`source=GA4&days=${days}`)), { source: 'GA4', days });
  }
});

test('query changes on the reused analysis component update selection and removal restores defaults', () => {
  const source = fs.readFileSync(new URL('../src/app/features/analyses/website-analytics.ts', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('website-analytics.ts', source, ts.ScriptTarget.Latest, true);
  const component = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'WebsiteAnalytics') as ts.ClassDeclaration;
  const method = component.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(parsed) === 'applyRouteQuery')!;
  const compiled = ts.transpileModule(`class Subject { ${method.getText(parsed)} } module.exports = Subject.prototype.applyRouteQuery;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const context: any = { module: { exports: {} }, websiteAnalyticsRouteState };
  vm.runInNewContext(compiled, context);
  let selectedSource = 'INTERNAL', selectedDays = 7;
  const view = { source: { set: (value: string) => { selectedSource = value; } }, days: { set: (value: number) => { selectedDays = value; } } };
  context.module.exports.call(view, params('source=SEARCH_CONSOLE&days=30'));
  assert.equal(selectedSource, 'SEARCH_CONSOLE');
  assert.equal(selectedDays, 30);
  context.module.exports.call(view, params());
  assert.equal(selectedSource, 'INTERNAL');
  assert.equal(selectedDays, 30);
});
