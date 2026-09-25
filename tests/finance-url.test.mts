import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LOCATION, TAB_IDS, financeQueryParams, parseFinanceLocation, patchLocation, positiveId,
} from '../src/app/features/finance/finance-url.ts';
import type { FinanceLocation } from '../src/app/features/finance/finance-url.ts';
import { FINANCE_TABS } from '../src/app/features/finance/finance-sections.ts';
import type { FinanceView } from '../src/app/features/finance/finance-sections.ts';

const parse = (query: Record<string, string>) => parseFinanceLocation((key) => query[key] ?? null);

test('legacy addresses land on a sensible section', () => {
  assert.deepEqual([parse({ view: 'recurring' }).view, parse({ view: 'recurring' }).tab], ['costs', 'recurring']);
  const container = parse({ container: '46' });
  assert.deepEqual([container.view, container.tab, container.container], ['costs', 'containers', 46]);
  assert.equal(parse({ view: 'open', container: '46' }).view, 'costs', 'container=<id> wins on any view');
  assert.deepEqual([parse({ view: 'bank' }).view, parse({ view: 'bank' }).tab], ['bank', 'accounts']);
  assert.equal(parse({ view: 'costs' }).tab, 'company');
  assert.equal(parse({ view: 'open' }).tab, 'all');
  assert.equal(parse({ view: 'nonsense' }).view, 'overview');
  assert.equal(parse({ view: 'bank', tab: 'nonsense' }).tab, 'accounts');
  assert.equal(parse({}).view, 'overview');
});

test('invalid ids are refused', () => {
  for (const raw of ['0', '-1', '1e3', 'abc', '', '1.5', '9007199254740992']) assert.equal(positiveId(raw), null, raw);
  assert.equal(positiveId('12'), 12);
  assert.equal(parse({ container: '0' }).view, 'overview');
  assert.equal(parse({ view: 'costs', cost: 'abc' }).cost, null);
});

test('cost=<id> (and the older kost=<id>) inspects that company cost', () => {
  const location = parse({ view: 'costs', cost: '12' });
  assert.deepEqual([location.view, location.tab, location.cost], ['costs', 'company', 12]);
  assert.equal(parse({ view: 'costs', kost: '7' }).cost, 7);
  assert.equal(parse({ cost: '9' }).view, 'costs');
});

test('from and to imply a custom period; otherwise the section default applies', () => {
  const custom = parse({ view: 'costs', from: '2026-01-01', to: '2026-03-31', period: 'month' });
  assert.deepEqual([custom.period, custom.from, custom.to], ['custom', '2026-01-01', '2026-03-31']);
  assert.equal(parse({ view: 'costs' }).period, 'year');
  assert.equal(parse({ view: 'incoming', tab: 'received' }).period, 'month');
  assert.equal(parse({ view: 'bank', tab: 'movements' }).period, 'all');
  assert.equal(parse({ view: 'costs', period: 'weird' }).period, 'year');
  assert.equal(parse({ view: 'costs', from: 'not-a-day' }).period, 'year');
});

test('the address leaves out every default', () => {
  assert.deepEqual(financeQueryParams(DEFAULT_LOCATION), {});
  assert.deepEqual(financeQueryParams(parse({ view: 'costs', tab: 'company', period: 'year' })), { view: 'costs' });
  assert.deepEqual(financeQueryParams(parse({ view: 'bank', tab: 'accounts' })), { view: 'bank' });
  assert.deepEqual(financeQueryParams(parse({ view: 'incoming', tab: 'received', period: 'quarter', dir: 'in' })),
    { view: 'incoming', tab: 'received', period: 'quarter', dir: 'in' });
});

test('filters a section does not honour are dropped', () => {
  const open = parse({ view: 'open', cat: 'HUUR', period: 'month', account: 'KBC', q: 'huur' });
  assert.deepEqual([open.cat, open.period, open.account, open.q], ['', '', '', 'huur']);
  const accounts = parse({ view: 'bank', dir: 'in', q: 'x' });
  assert.deepEqual([accounts.dir, accounts.q], ['', '']);
  const movements = parse({ view: 'bank', tab: 'movements', dir: 'in', link: 'unlinked', account: 'KBC', status: 'open' });
  assert.deepEqual([movements.dir, movements.link, movements.account, movements.status], ['in', 'unlinked', 'KBC', '']);
  assert.equal(parse({ view: 'analysis', year: '2025', q: 'x' }).q, '');
  assert.equal(parse({ view: 'analysis', year: '2025' }).year, '2025');
  assert.equal(parse({ view: 'analysis', year: 'twenty' }).year, '');
});

test('every section and segment survives a round trip through the address', () => {
  const samples: Partial<FinanceLocation>[] = [
    {}, { q: 'huur' }, { period: 'quarter' }, { period: 'custom', from: '2026-02-01', to: '2026-02-28' },
    { cat: 'HUUR', status: 'open', channel: 'WHOLESALE', docs: 'missing', cost: 5 },
    { container: 46, scope: 'all' }, { dir: 'out', link: 'unlinked', account: 'KBC' }, { kind: 'partner' },
    { purpose: 'PARTNER_ADVANCE', account: '__none__', dir: 'in' }, { year: 'all' }, { year: '2024' },
  ];
  for (const view of Object.keys(TAB_IDS) as FinanceView[]) {
    for (const tab of TAB_IDS[view].length ? TAB_IDS[view] : ['']) {
      for (const sample of samples) {
        const location = patchLocation({ ...DEFAULT_LOCATION, view, tab }, { view, tab, ...sample });
        const params = financeQueryParams(location);
        const back = parse(params);
        assert.deepEqual(financeQueryParams(back), params, `${view}/${tab} ${JSON.stringify(sample)}`);
        assert.equal(back.view, view);
        assert.equal(back.tab, tab || '');
        assert.deepEqual(parse(financeQueryParams(back)), back, 'parsing is stable');
      }
    }
  }
});

test('patching a section starts from its defaults; a filter patch keeps the rest', () => {
  const costs = patchLocation(DEFAULT_LOCATION, { view: 'costs', q: 'huur', cat: 'HUUR' });
  assert.deepEqual([costs.tab, costs.period, costs.q, costs.cat], ['company', 'year', 'huur', 'HUUR']);
  const moved = patchLocation(costs, { view: 'bank' });
  assert.deepEqual([moved.tab, moved.q, moved.cat, moved.period], ['accounts', '', '', '']);
  const narrowed = patchLocation(costs, { status: 'open' });
  assert.deepEqual([narrowed.q, narrowed.cat, narrowed.status], ['huur', 'HUUR', 'open']);
  const ranged = patchLocation(costs, { from: '2026-01-01', to: '2026-01-31' });
  assert.equal(ranged.period, 'custom');
  assert.deepEqual([patchLocation(ranged, { period: 'month' }).from, patchLocation(ranged, { period: 'month' }).to], ['', '']);
});

test('the segment ids match the labelled segments', () => {
  for (const view of Object.keys(TAB_IDS) as FinanceView[]) {
    assert.deepEqual(FINANCE_TABS[view].map((tab) => tab.id), [...TAB_IDS[view]], view);
  }
});
