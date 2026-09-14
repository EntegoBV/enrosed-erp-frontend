import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {
  googleMetric, googlePercentage, googleDate, googleSourceLabel, visibleGoogleData,
  googlePageLabel, googleBarHeight, googleTimeline, googleLeadCount,
} from '../src/app/features/analyses/google-analytics-display.ts';

test('real measured zeroes remain distinct from missing or invalid Google metrics', () => {
  assert.equal(googleMetric(0), '0');
  for (const missing of [null, undefined, Number.NaN, Infinity, -1, '10']) assert.equal(googleMetric(missing), '—');
  assert.equal(googlePercentage(.125), '12,5 %');
  assert.equal(googlePercentage(0), '0 %');
  assert.equal(googlePercentage(1.1), '—');
  assert.equal(googleMetric(7.45, 1), '7,5');
});

test('provider failures never expose a fake zero or an unlabelled old payload', () => {
  const source = { status: 'CONNECTED', property: '554014865', from: '2026-09-01', to: '2026-09-14',
    fetchedAt: '2026-09-14T08:00:00Z', message: null, errorCode: null, data: { users: 2 } };
  assert.deepEqual(visibleGoogleData(source as any), { users: 2 });
  assert.deepEqual(visibleGoogleData({ ...source, status: 'STALE' } as any), { users: 2 });
  assert.deepEqual(visibleGoogleData({ ...source, status: 'NO_DATA', data: { users: 0 } } as any), { users: 0 });
  for (const status of ['ERROR', 'NOT_CONFIGURED', 'UNKNOWN']) {
    assert.equal(visibleGoogleData({ ...source, status } as any), null);
  }
  assert.equal(visibleGoogleData(null), null);
  assert.equal(googleSourceLabel('STALE'), 'Eerder opgehaald');
});

test('report dates and retrieval timestamps remain separate and page queries are not displayed', () => {
  assert.match(googleDate('2026-09-14'), /14/);
  assert.match(googleDate('2026-09-14T08:15:00Z', true), /10:15/);
  assert.equal(googleDate(null), 'Niet beschikbaar');
  assert.equal(googleDate('invalid'), 'Niet beschikbaar');
  assert.equal(googlePageLabel('https://enrosed.com/nl/quote/?email=private@example.com#notes'), '/nl/quote/');
  assert.equal(googlePageLabel('/el/products/?utm_source=google'), '/el/products/');
});

test('daily bars use real values without manufacturing visible visits for zero or missing days', () => {
  assert.equal(googleBarHeight(0, [0, 2]), 0);
  assert.equal(googleBarHeight(Number.NaN, [2]), 0);
  assert.equal(googleBarHeight(2, [0, 2, 4, Number.NaN]), 50);
});

test('a new property with one returned day occupies the last calendar slot, without backfilling history', () => {
  const timeline = googleTimeline('2026-08-16', '2026-09-14', [{ date: '2026-09-14', sessions: 2 }], day => day.sessions);
  assert.equal(timeline.length, 30);
  assert.deepEqual(timeline[0], { date: '2026-08-16', value: null });
  assert.equal(timeline.slice(0, 29).every(day => day.value === null), true);
  assert.deepEqual(timeline[29], { date: '2026-09-14', value: 2 });
});

test('calendar timelines respect leap days, unordered rows, real zeroes and invalid provider dates', () => {
  const rows = [{ date: '2024-03-01', clicks: 4 }, { date: '2024-02-28', clicks: 0 }, { date: '2024-03-02', clicks: 99 }];
  assert.deepEqual(googleTimeline('2024-02-28', '2024-03-01', rows, day => day.clicks), [
    { date: '2024-02-28', value: 0 }, { date: '2024-02-29', value: null }, { date: '2024-03-01', value: 4 },
  ]);
  for (const [from, to] of [['2023-02-29', '2023-03-01'], ['2026-09-14', '2026-09-13'], ['2026-01-01', '2028-01-01'], [null, null]]) {
    assert.deepEqual(googleTimeline(from, to, rows, day => day.clicks), []);
  }
});

test('successful lead count retains reported zero and excludes unrelated key events', () => {
  assert.equal(googleLeadCount([]), 0);
  assert.equal(googleLeadCount([{ name: 'generate_lead', count: 0 }]), 0);
  assert.equal(googleLeadCount([{ name: 'generate_lead', count: 3 }, { name: 'purchase', count: 100 }]), 3);
  assert.equal(googleLeadCount([{ name: 'generate_lead', count: Number.NaN }]), null);
});

// Execute the actual component reload method, rather than a separate imitation of its request guard.
const source = fs.readFileSync(new URL('../src/app/features/analyses/google-website-analytics.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('google-website-analytics.ts', source, ts.ScriptTarget.Latest, true);
const component = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'GoogleWebsiteAnalytics') as ts.ClassDeclaration;
const reloadNode = component.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(parsed) === 'reload')!;
const compiled = ts.transpileModule(`class Subject { ${reloadNode.getText(parsed)} } module.exports = Subject.prototype.reload;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const context: any = { module: { exports: {} }, messageOf: (failure: any, fallback: string) => failure?.message || fallback };
vm.runInNewContext(compiled, context);
const reload = context.module.exports;

function signal<T>(initial: T) { let value = initial; return Object.assign(() => value, { set: (next: T) => { value = next; } }); }
function deferred() { let resolve!: (value: any) => void; let reject!: (error: any) => void; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function report(days: number) { return { days, from: '2026-09-01', to: '2026-09-14', googleAnalytics: {}, searchConsole: {}, realtime: {} }; }
function harness() {
  const requests: { days: number; task: ReturnType<typeof deferred> }[] = [];
  const busy: boolean[] = [];
  const state = { days: signal(30), loadVersion: 0, requestedDays: null, loading: signal(false), error: signal(null), report: signal<any>(null),
    loadingChanged: { emit: (value: boolean) => busy.push(value) },
    analytics: { googleWebsiteReport: (days: number) => { const task = deferred(); requests.push({ days, task }); return task.promise; } } };
  return { state, requests, busy, reload: () => reload.call(state) as Promise<void> };
}

test('refresh coalesces an in-flight request for the same selected period', async () => {
  const h = harness();
  const first = h.reload();
  await h.reload();
  assert.equal(h.requests.length, 1);
  assert.equal(h.state.loading(), true);
  h.requests[0].task.resolve(report(30)); await first;
  assert.equal(h.state.report().days, 30);
  assert.deepEqual(h.busy, [true, false]);
});

test('late replies and errors cannot overwrite a newly selected period or release its loading guard', async () => {
  const h = harness();
  h.state.report.set(report(365));
  const old = h.reload();
  assert.equal(h.state.report(), null);
  h.state.days.set(7); const current = h.reload();
  h.requests[0].task.reject(new Error('old request failed')); await old;
  assert.equal(h.state.error(), null);
  assert.equal(h.state.loading(), true);
  h.requests[1].task.resolve(report(7)); await current;
  assert.equal(h.state.report().days, 7);
  assert.equal(h.state.loading(), false);
});

test('API failure is visible and retry recovers; malformed success never renders as a connected blank screen', async () => {
  const h = harness();
  const first = h.reload(); h.requests[0].task.reject(new Error('Google unavailable')); await first;
  assert.equal(h.state.report(), null);
  assert.equal(h.state.error(), 'Google unavailable');
  const retry = h.reload(); h.requests[1].task.resolve(report(30)); await retry;
  assert.equal(h.state.error(), null);
  assert.equal(h.state.report().days, 30);
  const invalid = h.reload(); h.requests[2].task.resolve([]); await invalid;
  assert.equal(h.state.report(), null);
  assert.match(h.state.error()!, /onvolledig rapport/);
});

test('destroyed component ignores a late successful request', async () => {
  const h = harness(); const pending = h.reload();
  h.state.loadVersion++;
  h.requests[0].task.resolve(report(30)); await pending;
  assert.equal(h.state.report(), null);
});

test('template keeps provider-specific periods, processing state, realtime and successful leads distinct', () => {
  assert.match(source, /date\(provider\.from\)/);
  assert.match(source, /date\(provider\.to\)/);
  assert.doesNotMatch(source, /date\(r\.from\)/);
  assert.match(source, /standaardrapporten nog worden verwerkt/);
  assert.match(source, /data\.totals\.keyEvents/);
  assert.match(source, /Belangrijke gebeurtenissen/);
  assert.match(source, /Succesvolle offerte- en contactaanvragen/);
  assert.match(source, /realtimeData\(\)/);
  assert.match(source, /r\.realtime\.status === 'ERROR'/);
  assert.match(source, /Realtime tijdelijk niet beschikbaar/);
  assert.match(source, /Laatste dag met geretourneerde gegevens/);
  assert.match(source, /Dit betekent niet dat die dag volledig verwerkt is/);
  assert.doesNotMatch(source, /@if \(data.events.length\)/);
  assert.equal((source.match(/<details class="google-card google-breakdown"><summary>/g) ?? []).length, 4);
  assert.doesNotMatch(source, /<details[^>]+\bopen[ =]/);
});
