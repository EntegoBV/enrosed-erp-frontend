import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveSearchConsoleInsights, searchConsolePageLink, searchInsightPriorityLabel } from '../src/app/features/analyses/search-console-insights.ts';
import type { GoogleAnalyticsSource, GoogleSearchData, SearchPerformance } from '../src/app/core/api/analytics-api.ts';

const metrics = (clicks = 162, impressions = 2170, position = 9.5604): SearchPerformance => ({ clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });
function source(overrides: Partial<GoogleSearchData> = {}): GoogleAnalyticsSource<GoogleSearchData> {
  return { status: 'CONNECTED', property: 'sc-domain:enrosed.com', from: '2026-08-14', to: '2026-09-12',
    fetchedAt: '2026-09-14T12:00:00Z', errorCode: null, message: null,
    data: { totals: metrics(), perDay: [], queries: [], pages: [], dataState: 'final', timeZone: 'America/Los_Angeles',
      availableThrough: '2026-09-12', warnings: [], periodBasis: 'GOOGLE_FINAL_BOUNDARY', rowLimit: 100,
      comparison: { status: 'CONNECTED', from: '2026-07-15', to: '2026-08-13', totals: metrics(99, 1617, 8.4391), errorCode: null, message: null },
      ...overrides },
  };
}

test('more clicks and a higher average position stay distinct; CTR change is percentage points', () => {
  const actual = deriveSearchConsoleInsights(source());
  assert.equal(actual.trend?.clicks.delta, 63);
  assert.ok(Math.abs(actual.trend!.clicks.percent! - 63.6363636) < .00001);
  assert.ok(Math.abs(actual.trend!.ctr.percentagePoints! - (162 / 2170 - 99 / 1617) * 100) < .000001);
  assert.equal(actual.trend?.position.direction, 'worse');
  assert.ok(Math.abs(actual.trend!.position.delta! - 1.1213) < .000001);
  assert.equal(actual.insights.some(insight => insight.id === 'click-decline'), false);
  assert.doesNotMatch(actual.summary, /verslechter|slechter|algoritme/);
  assert.match(actual.summary, /63,6% meer/);
});

test('only confirmed, equal, adjacent calendar periods produce a comparison', () => {
  const valid = source();
  for (const changes of [{ from: '2026-07-16' }, { to: '2026-08-12' }, { from: '2026-06-15', to: '2026-07-14' },
    { from: '2026-02-30' }, { totals: null }, { status: 'ERROR' }]) {
    assert.equal(deriveSearchConsoleInsights(source({ comparison: { ...valid.data!.comparison!, ...changes } as any })).trend, null);
  }
  for (const periodBasis of [null, undefined, 'UNCONFIRMED'] as const) assert.equal(deriveSearchConsoleInsights(source({ periodBasis })).trend, null);
  const leap = source(); leap.from = '2024-03-01'; leap.to = '2024-03-02';
  leap.data!.comparison = { ...leap.data!.comparison!, from: '2024-02-28', to: '2024-02-29' };
  assert.ok(deriveSearchConsoleInsights(leap).trend);
});

test('an empty previous period has an absolute change but no invented rate or average position change', () => {
  const old = source().data!.comparison!;
  const actual = deriveSearchConsoleInsights(source({ comparison: { ...old, status: 'NO_DATA', totals: metrics(0, 0, 0) } }));
  assert.equal(actual.trend?.clicks.delta, 162);
  assert.equal(actual.trend?.clicks.percent, null);
  assert.equal(actual.trend?.ctr.percentagePoints, null);
  assert.equal(actual.trend?.position.direction, null);
});

test('errors hide even an attached old payload, while measured empty and stale reports stay explicit', () => {
  for (const status of ['ERROR', 'NOT_CONFIGURED'] as const) {
    const result = deriveSearchConsoleInsights({ ...source(), status });
    assert.equal(result.insights.length, 0); assert.equal(result.trend, null); assert.equal(result.queryMix, null);
    assert.ok(result.languages.every(language => language.clicks === null));
  }
  const empty = deriveSearchConsoleInsights({ ...source({ totals: metrics(0, 0, 0), comparison: null }), status: 'NO_DATA' });
  assert.match(empty.summary, /geen vertoningen/); assert.equal(empty.lowVolume, true);
  const stale = deriveSearchConsoleInsights({ ...source(), status: 'STALE' });
  assert.equal(stale.stale, true); assert.match(stale.limitations[0], /eerder opgehaald/);
  assert.equal(deriveSearchConsoleInsights(source({ totals: { ...metrics(), ctr: Number.NaN } })).trend, null);
});

test('small samples and search-operator noise never become strong content recommendations', () => {
  const actual = deriveSearchConsoleInsights(source({
    queries: [
      { query: 'großhandel rosen', ...metrics(1, 16, 6.2) },
      { query: 'flowers tessenderlo', ...metrics(0, 77, 13) },
      { query: 'site:enrosed.com "wholesale" "roses"', ...metrics(120, 1000, 1) },
    ],
    pages: [{ page: 'https://enrosed.com/de/products/', ...metrics(1, 16, 6.2) }],
  }));
  assert.equal(actual.insights.length, 0);
  assert.equal(actual.queryMix?.wholesale.queries, 1);
  assert.equal(actual.queryMix?.branded.clicks, 0);
  assert.equal(actual.queryMix?.other.queries, 2);
});

test('page review signals include actual evidence, declared thresholds and safe actions', () => {
  const actual = deriveSearchConsoleInsights(source({ pages: [
    { page: 'https://enrosed.com/nl/products/bowl/?email=private@example.com#ref', ...metrics(0, 500, 5) },
    { page: 'https://enrosed.com/el/products/dome/', ...metrics(8, 200, 12) },
    { page: 'https://example.com/trap', ...metrics(0, 9999, 3) },
  ] }));
  const low = actual.insights.find(row => row.id === 'low-ctr')!;
  assert.equal(low.priority, 'focus'); assert.equal(low.action.routerLink, '/website/seo');
  assert.match(low.evidence.join(' '), /500 vertoningen/);
  assert.match(low.evidence.join(' '), /Signaalgrens/);
  assert.match(low.explanation, /historische URL/);
  assert.doesNotMatch(JSON.stringify(actual), /private@example|#ref|example.com\/trap/);
  const near = actual.insights.find(row => row.id === 'near-first-page')!;
  assert.equal(near.action.href, 'https://enrosed.com/el/products/dome/');
  assert.match(near.explanation, /geen vaste ranking/);
  assert.equal(searchInsightPriorityLabel('focus'), 'Eerst bekijken');
});

test('language figures describe returned page rows, use impression weighting and leave absent locales unknown', () => {
  const actual = deriveSearchConsoleInsights(source({ pages: [
    { page: '/nl/products/a/', ...metrics(5, 100, 5) },
    { page: '/nl/products/b/', ...metrics(3, 300, 15) },
    { page: 'https://www.enrosed.com/', ...metrics(10, 100, 1) },
    { page: '/pages/historical-dutch-route', ...metrics(100, 1000, 4) },
  ] }));
  assert.equal(actual.languages.length, 9);
  const nl = actual.languages.find(row => row.locale === 'nl')!;
  assert.equal(nl.clicks, 8); assert.equal(nl.impressions, 400); assert.equal(nl.ctr, .02);
  assert.equal(nl.position, 12.5); assert.equal(nl.coverage, 'reported-pages');
  assert.equal(actual.languages.find(row => row.locale === 'en')?.clicks, 10);
  const el = actual.languages.find(row => row.locale === 'el')!;
  assert.equal(el.clicks, null); assert.equal(el.position, null); assert.equal(el.coverage, 'unavailable');
  assert.match(actual.limitations.join(' '), /som is niet het sitetotaal/);
});

test('partial page/query failures suppress their insights and classifications without hiding sound totals', () => {
  const actual = deriveSearchConsoleInsights(source({
    pages: [{ page: '/nl/products/', ...metrics(0, 500, 3) }],
    queries: [{ query: 'enrosed', ...metrics(110, 1200, 1) }],
    issues: [{ section: 'PAGES', errorCode: 'UPSTREAM_ERROR', message: 'Niet beschikbaar' },
      { section: 'QUERIES', errorCode: 'UPSTREAM_ERROR', message: 'Niet beschikbaar' }],
  }));
  assert.match(actual.summary, /162 klikken/); assert.equal(actual.insights.length, 0);
  assert.equal(actual.queryMix, null); assert.ok(actual.languages.every(row => row.clicks === null));
  assert.doesNotThrow(() => deriveSearchConsoleInsights(source({ pages: null, queries: null } as any)));
});

test('brand evidence is a lower bound from returned queries, not the complement of all generic search', () => {
  const input = source({ queries: [
    { query: 'enrosed', ...metrics(73, 500, 1) }, { query: 'enrosed london', ...metrics(26, 140, 1) },
    { query: 'enrosed rose', ...metrics(11, 80, 2) }, { query: 'groothandel rozen', ...metrics(1, 16, 6.2) },
  ] });
  const actual = deriveSearchConsoleInsights(input);
  const insight = actual.insights.find(row => row.id === 'brand-discovery')!;
  assert.match(insight.evidence[0], /Minstens 110 van 162/); assert.match(insight.evidence[0], /67,9/);
  assert.match(actual.summary, /63,6% meer/); assert.match(actual.summary, /Minstens 67,9 %/);
  assert.equal(actual.queryMix?.reportedQueries, 4); assert.equal(actual.queryMix?.scope, 'returned-queries');
  assert.doesNotMatch(insight.explanation, /geen groothandelsvraag|slechte doelgroep/);
});

test('a substantial click decline is evidence to inspect, never a fabricated technical diagnosis', () => {
  const actual = deriveSearchConsoleInsights(source({ totals: metrics(40, 1000, 7) }));
  const insight = actual.insights.find(row => row.id === 'click-decline')!;
  assert.match(insight.evidence[0], /99 → 40 klikken/);
  assert.match(insight.explanation, /geen technische fout of algoritmewijziging/);
});

test('a confirmed drop to zero keeps the comparative warning ahead of low-volume guidance', () => {
  const actual = deriveSearchConsoleInsights({ ...source({ totals: metrics(0, 0, 0) }), status: 'NO_DATA' });
  assert.equal(actual.trend?.clicks.percent, -100); assert.match(actual.summary, /100% minder/);
  assert.equal(actual.insights[0].id, 'click-decline'); assert.equal(actual.lowVolume, true);
  assert.equal(actual.insights[1].id, 'low-volume');
});

test('URL actions reject arbitrary hosts and protocols and never expose query or fragment data', () => {
  for (const value of ['javascript:alert(1)', '//evil.example/x', 'https://enrosed.com.evil.example/nl/', 'https://user:pass@enrosed.com/', 'data:text/html,x']) assert.equal(searchConsolePageLink(value), null);
  assert.equal(searchConsolePageLink('http://www.enrosed.com/nl/?token=secret#fragment'), 'https://www.enrosed.com/nl/');
});

test('derivation does not mutate the input report or its row order', () => {
  const input = source({ pages: [{ page: '/nl/products/a/', ...metrics(3, 200, 13) }, { page: '/nl/products/b/', ...metrics(0, 500, 4) }] });
  const before = JSON.stringify(input);
  const freeze = (value: any): any => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  deriveSearchConsoleInsights(freeze(input)); assert.equal(JSON.stringify(input), before);
});
