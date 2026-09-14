import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { dashboardSearchSource } from '../src/app/features/dashboard/dashboard-search-console-state.ts';
import { visibleGoogleData } from '../src/app/features/analyses/google-analytics-display.ts';

const source = (status = 'CONNECTED', totals = { clicks: 148, impressions: 1958, ctr: 148 / 1958, position: 12.75 }) => ({
  status, property: 'sc-domain:enrosed.com', from: '2026-08-16', to: '2026-09-14',
  fetchedAt: '2026-09-14T09:00:00Z', errorCode: null, message: null,
  data: { totals, perDay: [], pages: [], queries: [], availableThrough: '2026-09-12',
    timeZone: 'America/Los_Angeles', dataState: 'final', warnings: [] },
});
const report = (search = source()) => ({ days: 30, searchConsole: search,
  googleAnalytics: { status: 'ERROR', data: null }, realtime: { status: 'ERROR', data: null } }) as any;

test('dashboard uses Search Console totals even when unrelated Google providers fail', () => {
  const actual = dashboardSearchSource(report());
  assert.equal(actual.data?.totals.clicks, 148);
  assert.equal(actual.data?.totals.impressions, 1958);
  assert.equal(actual.from, '2026-08-16');
  assert.equal(actual.to, '2026-09-14');
});

test('reported zero and stale data retain their explicit provider status', () => {
  const empty = source('NO_DATA', { clicks: 0, impressions: 0, ctr: 0, position: 0 });
  assert.equal(dashboardSearchSource(report(empty)).status, 'NO_DATA');
  assert.equal(visibleGoogleData(dashboardSearchSource(report(empty)))?.totals.clicks, 0);
  assert.equal(dashboardSearchSource(report(source('STALE'))).status, 'STALE');
});

test('provider errors and missing configuration never expose payload metrics as measured zeroes', () => {
  for (const status of ['ERROR', 'NOT_CONFIGURED']) {
    const actual = dashboardSearchSource(report(source(status)));
    assert.equal(actual.status, status);
    assert.equal(visibleGoogleData(actual), null);
  }
});

test('wrong period, unknown status and malformed totals are visible failures', () => {
  for (const invalid of [null, {}, { ...report(), days: 7 }, report(source('UNKNOWN')),
    report({ ...source(), data: null } as any),
    report(source('CONNECTED', { clicks: Number.NaN, impressions: 100, ctr: .2, position: 3 })),
    report(source('CONNECTED', { clicks: 10, impressions: 100, ctr: 20, position: 3 })),
    report(source('CONNECTED', { clicks: 10, impressions: -1, ctr: .2, position: 3 }))]) {
    assert.throws(() => dashboardSearchSource(invalid as any), /onvolledig/);
  }
});

const text = fs.readFileSync(new URL('../src/app/features/dashboard/dashboard-search-console.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('dashboard-search-console.ts', text, ts.ScriptTarget.Latest, true);
const component = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'DashboardSearchConsole') as ts.ClassDeclaration;
const method = component.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(parsed) === 'reload')!;
const compiled = ts.transpileModule(`class Subject { ${method.getText(parsed)} } module.exports = Subject.prototype.reload;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const context: any = { module: { exports: {} }, dashboardSearchSource, messageOf: (error: any, fallback: string) => error?.message || fallback };
vm.runInNewContext(compiled, context);
const reload = context.module.exports;
function signal<T>(initial: T) { let value = initial; return Object.assign(() => value, { set: (next: T) => { value = next; } }); }
function deferred() { let resolve!: (value: any) => void; let reject!: (reason: any) => void; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function harness() {
  const requests: { days: number; task: ReturnType<typeof deferred> }[] = [];
  const state = { loadVersion: 0, source: signal<any>(null), error: signal<string | null>(null), loading: signal(false),
    analytics: { googleWebsiteReport: (days: number) => { const task = deferred(); requests.push({ days, task }); return task.promise; } } };
  return { state, requests, reload: () => reload.call(state) as Promise<void> };
}

test('dashboard request is fixed to 30 days and repeated clicks reuse the pending request', async () => {
  const h = harness();
  const pending = h.reload();
  await h.reload();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].days, 30);
  assert.equal(h.state.loading(), true);
  h.requests[0].task.resolve(report());
  await pending;
  assert.equal(h.state.source().data.totals.clicks, 148);
  assert.equal(h.state.loading(), false);
});

test('failed request shows no numbers and a fresh read-only retry recovers', async () => {
  const h = harness();
  const first = h.reload();
  h.requests[0].task.reject(new Error('Tijdelijk niet beschikbaar'));
  await first;
  assert.equal(h.state.source(), null);
  assert.equal(h.state.error(), 'Tijdelijk niet beschikbaar');
  const retry = h.reload();
  h.requests[1].task.resolve(report());
  await retry;
  assert.equal(h.state.error(), null);
  assert.equal(h.state.source().status, 'CONNECTED');
});

test('invalid successful response becomes an error rather than a connected blank card', async () => {
  const h = harness();
  const pending = h.reload();
  h.requests[0].task.resolve({ days: 30 });
  await pending;
  assert.equal(h.state.source(), null);
  assert.match(h.state.error()!, /onvolledig/);
});

test('a request completed after the dashboard is destroyed cannot update its state', async () => {
  for (const rejected of [false, true]) {
    const h = harness();
    const pending = h.reload();
    h.state.loadVersion++;
    if (rejected) h.requests[0].task.reject(new Error('late failure'));
    else h.requests[0].task.resolve(report());
    await pending;
    assert.equal(h.state.source(), null);
    assert.equal(h.state.error(), null);
  }
});
