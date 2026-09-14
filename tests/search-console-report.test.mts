import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { googleMetric, googlePageLabel } from '../src/app/features/analyses/google-analytics-display.ts';

const source = fs.readFileSync(new URL('../src/app/features/analyses/search-console-report.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('report.ts', source, ts.ScriptTarget.Latest, true);
const component = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'SearchConsoleReport') as ts.ClassDeclaration;
const selectedProperties = ['chartPath', 'observedPoints', 'selectedDayIndex'];
const members = component.members.filter(member => ts.isMethodDeclaration(member) || (ts.isPropertyDeclaration(member) && selectedProperties.includes(member.name.getText(parsed))));
const compiled = ts.transpileModule(`class Subject { ${members.map(member => member.getText(parsed)).join('\n')} } module.exports = Subject;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const context: any = { module: { exports: {} }, computed: (fn: unknown) => fn, googleMetric, googlePageLabel };
vm.runInNewContext(compiled, context);
const Subject = context.module.exports;
const signal = <T>(initial: T) => { let value = initial; return Object.assign(() => value, { set: (next: T) => value = next }); };
const row = (name: string, clicks: number, impressions: number, position: number) => ({ query: name, clicks, impressions, position, ctr: impressions ? clicks / impressions : 0 });

test('search rows filter and sort actual metrics while preserving all source rows and original ledger order', () => {
  const subject = new Subject();
  const rows = [row('Enrosed', 10, 100, 4), row('Groothandel rozen', 3, 15, 2), row('Geen vertoningen', 0, 0, 0)];
  assert.deepEqual(subject.sortedRows(rows, 'query', '  ROZEN ', 'clicks').map((r: any) => r.query), ['Groothandel rozen']);
  assert.deepEqual(subject.sortedRows(rows, 'query', '', 'position').map((r: any) => r.query), ['Groothandel rozen', 'Enrosed', 'Geen vertoningen']);
  assert.deepEqual(subject.sortedRows(rows, 'query', '', 'ctr').map((r: any) => r.query), ['Groothandel rozen', 'Enrosed', 'Geen vertoningen']);
  assert.deepEqual(rows.map(r => r.query), ['Enrosed', 'Groothandel rozen', 'Geen vertoningen']);
});

test('page search distinguishes hosts but excludes query and fragment data from matching', () => {
  const subject = new Subject();
  const rows = ['https://enrosed.com/?secret=alpha', 'https://www.enrosed.com/#private'].map((page, index) => ({ ...row('', 2 + index, 10, 2), page }));
  assert.equal(subject.sortedRows(rows, 'page', 'www.', 'clicks')[0].page, rows[1].page);
  assert.equal(subject.sortedRows(rows, 'page', 'secret', 'clicks').length, 0);
  assert.equal(subject.sortedRows(rows, 'page', 'private', 'clicks').length, 0);
});

test('trend gaps are not drawn as zero or connected across missing days; isolated observations remain visible', () => {
  const subject = new Subject();
  subject.timeline = () => [{ value: 0 }, { value: null }, { value: 10 }];
  subject.chartMaximum = () => 10;
  assert.equal(subject.chartPath(), 'M 5 140  M 595 10');
  assert.equal(subject.observedPoints().length, 2);
  assert.equal(subject.observedPoints()[0].y, 140);
  assert.equal(subject.observedPoints()[1].x, 595);
});

test('accessible day selection rejects invalid indices and clamps a previous selection after a shorter period', () => {
  const subject = new Subject(); subject.dayIndex = signal<number | null>(null);
  subject.timeline = () => [{ value: 1 }, { value: 2 }, { value: 3 }];
  assert.equal(subject.selectedDayIndex(), 2);
  subject.selectDay('1'); assert.equal(subject.dayIndex(), 1);
  for (const value of ['-1', '3', 'NaN', '1.5']) { subject.selectDay(value); assert.equal(subject.dayIndex(), 1); }
  subject.dayIndex.set(20); assert.equal(subject.selectedDayIndex(), 2);
});

test('comparison displays signed relative changes and does not invent percent growth from a zero baseline', () => {
  const subject = new Subject();
  assert.equal(subject.countChange({ delta: 63, percent: 63.636 }), '+63,6 %');
  assert.equal(subject.countChange({ delta: 5, percent: null }), '+5 · vorige periode nul');
  assert.equal(subject.signed(-1.343, 2), '−1,34');
  assert.equal(subject.signed(null), '—');
});

test('unknown list sorts do not replace the selected ordering', () => {
  const subject = new Subject(); subject.querySort = signal('clicks'); subject.pageSort = signal('clicks');
  subject.setSort('query', 'position'); subject.setSort('page', 'not-a-sort');
  assert.equal(subject.querySort(), 'position'); assert.equal(subject.pageSort(), 'clicks');
});
