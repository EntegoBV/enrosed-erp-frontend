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
  assert.equal(parse({ view: 'nonsense' }).view, 'bank', 'an unknown view opens Bank');
  assert.equal(parse({ view: 'bank', tab: 'nonsense' }).tab, 'accounts');
  assert.equal(parse({}).view, 'bank', 'Kosten & bank opens on Bank');
  assert.equal(parse({}).tab, 'accounts');
});

test('view=overview (the Overzicht until 2026-10-16) lands on Bank and normalises to /costs', () => {
  const overview = parse({ view: 'overview' });
  assert.deepEqual([overview.view, overview.tab], ['bank', 'accounts']);
  assert.deepEqual(financeQueryParams(overview), {}, 'the page replaces ?view=overview by the bare /costs');
  assert.deepEqual(financeQueryParams(parse({ view: 'bank' })), {});
  assert.deepEqual(financeQueryParams(parse({ view: 'bank', tab: 'movements' })), { tab: 'movements' });
});

test('a bank line (line=) is honoured on every section and written back; weeks only on Bank and only when not 8', () => {
  for (const view of Object.keys(TAB_IDS) as FinanceView[]) {
    for (const tab of TAB_IDS[view]) {
      const location = parse({ view, tab, line: '8842' });
      assert.equal(location.line, 8842, `${view}/${tab}`);
      assert.equal(financeQueryParams(location)['line'], '8842', `${view}/${tab}`);
    }
  }
  assert.equal(parse({ line: '0' }).line, null);
  assert.equal(parse({ line: 'abc' }).line, null);
  const both = parse({ view: 'costs', cost: '12', line: '7' });
  assert.deepEqual([both.cost, both.line], [12, 7], 'cost and line both stay; the line wins the inspector');
  assert.equal(parse({ weeks: '4' }).weeks, 4);
  assert.equal(parse({ weeks: '13' }).weeks, 13);
  assert.equal(parse({ weeks: '8' }).weeks, null, '8 weeks is the default');
  assert.equal(parse({ weeks: '9' }).weeks, null);
  assert.equal(parse({ view: 'bank', tab: 'movements', weeks: '4' }).weeks, null, 'the Kaslijn lives on Bank only');
  assert.deepEqual(financeQueryParams(parse({ weeks: '13' })), { weeks: '13' });
  assert.deepEqual(financeQueryParams({ ...DEFAULT_LOCATION, tab: 'accounts', weeks: 8 }), {}, 'never written when 8');
  const away = patchLocation(parse({ view: 'bank', tab: 'movements', line: '5' }), { view: 'open' });
  assert.equal(away.line, null, 'another section starts without the line');
  const kept = patchLocation(parse({ view: 'bank', tab: 'movements', line: '5' }), { dir: 'out' });
  assert.equal(kept.line, 5, 'a filter keeps the open line');
});

test('Transacties without an account is the stream over all accounts', () => {
  const all = parse({ view: 'bank', tab: 'movements', link: 'unlinked' });
  assert.deepEqual([all.view, all.tab, all.account, all.link], ['bank', 'movements', '', 'unlinked']);
  assert.deepEqual(financeQueryParams(all), { tab: 'movements', link: 'unlinked' });
  assert.deepEqual(parse(financeQueryParams(all)), all);
});

test('invalid ids are refused', () => {
  for (const raw of ['0', '-1', '1e3', 'abc', '', '1.5', '9007199254740992']) assert.equal(positiveId(raw), null, raw);
  assert.equal(positiveId('12'), 12);
  assert.equal(parse({ container: '0' }).view, 'bank');
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
  assert.deepEqual(financeQueryParams(parse({ view: 'bank', tab: 'accounts' })), {}, 'Bank is the default section');
  assert.deepEqual(financeQueryParams(parse({ view: 'incoming', tab: 'received', period: 'quarter', dir: 'in' })),
    { view: 'incoming', tab: 'received', period: 'quarter', dir: 'in' });
  assert.equal(parse({ view: 'incoming', tab: 'received', dir: 'offset' }).dir, 'offset', 'the verrekeningen filter of Ontvangen');
  assert.equal(parse({ view: 'incoming', kind: 'credit' }).kind, 'credit', 'the Tegoeden chip of Openstaand');
  assert.equal(parse({ view: 'incoming', kind: 'bogus' }).kind, '');
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
  assert.equal(parse({ view: 'open', regime: 'unconfirmed' }).regime, '');
});

test('Analyse has two segments; the return carries its year and quarter, the cost list its regime filter', () => {
  assert.equal(parse({ view: 'analysis', year: '2025' }).tab, 'costs', 'older links land on Kosten');
  const vat = parse({ view: 'analysis', tab: 'vat', year: '2026', quarter: '3' });
  assert.deepEqual([vat.tab, vat.year, vat.quarter], ['vat', '2026', '3']);
  assert.deepEqual(financeQueryParams(vat), { view: 'analysis', tab: 'vat', year: '2026', quarter: '3' });
  assert.equal(parse({ view: 'analysis', tab: 'vat', quarter: '5' }).quarter, '');
  assert.equal(parse({ view: 'analysis', tab: 'costs', quarter: '3' }).quarter, '', 'Kosten has no quarter');
  assert.equal(parse({ view: 'costs', regime: 'eu_services' }).regime, 'EU_SERVICES');
  assert.equal(parse({ view: 'costs', regime: 'unconfirmed' }).regime, 'unconfirmed');
  assert.equal(parse({ view: 'costs', regime: 'bogus' }).regime, '');
  assert.deepEqual(financeQueryParams(parse({ view: 'costs', regime: 'unconfirmed' })), { view: 'costs', regime: 'unconfirmed' });
  assert.equal(parse({ view: 'costs', tab: 'lists', regime: 'BE' }).regime, '');
});

test('every section and segment survives a round trip through the address', () => {
  const samples: Partial<FinanceLocation>[] = [
    {}, { q: 'huur' }, { period: 'quarter' }, { period: 'custom', from: '2026-02-01', to: '2026-02-28' },
    { cat: 'HUUR', status: 'open', channel: 'WHOLESALE', docs: 'missing', cost: 5 },
    { container: 46, scope: 'all' }, { dir: 'out', link: 'unlinked', account: 'KBC' }, { kind: 'partner' },
    { purpose: 'PARTNER_ADVANCE', account: '__none__', dir: 'in' }, { year: 'all' }, { year: '2024' },
    { regime: 'unconfirmed' }, { regime: 'EU_SERVICES', status: 'open' }, { year: '2026', quarter: '3' }, { quarter: '1' },
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

test('Aan wie & beurzen honours only the search', () => {
  const lists = parse({ view: 'costs', tab: 'lists', q: 'tica', cat: 'HUUR', status: 'open', channel: 'TICA', period: 'month' });
  assert.deepEqual([lists.view, lists.tab, lists.q], ['costs', 'lists', 'tica']);
  assert.deepEqual([lists.cat, lists.status, lists.channel], ['', '', '']);
  assert.deepEqual(financeQueryParams({ ...lists, cat: 'HUUR' }), { view: 'costs', tab: 'lists', q: 'tica' });
});

test('the segment ids match the labelled segments', () => {
  for (const view of Object.keys(TAB_IDS) as FinanceView[]) {
    assert.deepEqual(FINANCE_TABS[view].map((tab) => tab.id), [...TAB_IDS[view]], view);
  }
});

test('Facturen: Inkomend and Uitgaand, every date by default, the chip per direction, a container and a row key', () => {
  const plain = parse({ view: 'invoices' });
  assert.deepEqual([plain.view, plain.tab, plain.period, plain.only, plain.po, plain.doc], ['invoices', 'in', 'all', '', null, '']);
  assert.deepEqual(financeQueryParams(plain), { view: 'invoices' }, 'the defaults stay out of the address');
  const out = parse({ view: 'invoices', tab: 'out', only: 'credit-notes', q: 'De Smet', po: '41', doc: 'so:9', period: 'year' });
  assert.deepEqual([out.tab, out.only, out.q, out.po, out.doc, out.period], ['out', 'credit-notes', 'De Smet', 41, 'so:9', 'year']);
  assert.deepEqual(financeQueryParams(out), { view: 'invoices', tab: 'out', only: 'credit-notes', q: 'De Smet', po: '41', doc: 'so:9', period: 'year' });
  for (const only of ['containers', 'costs', 'odoo-new', 'no-file']) assert.equal(parse({ view: 'invoices', only }).only, only, only);
  for (const only of ['invoices', 'credit-notes', 'odoo']) assert.equal(parse({ view: 'invoices', tab: 'out', only }).only, only, only);
  assert.equal(parse({ view: 'invoices', only: 'credit-notes' }).only, '', 'a chip of the other direction');
  assert.equal(parse({ view: 'invoices', tab: 'out', only: 'odoo-new' }).only, '');
  assert.equal(parse({ view: 'invoices', only: 'bogus' }).only, '');
  assert.equal(parse({ view: 'invoices', po: '0' }).po, null);
  assert.equal(parse({ view: 'invoices', po: 'abc' }).po, null);
  assert.equal(parse({ view: 'invoices', doc: `pi:${'9'.repeat(18)}` }).doc, `pi:${'9'.repeat(18)}`, '18 digits');
  assert.equal(parse({ view: 'invoices', doc: `pi:${'9'.repeat(19)}` }).doc, '', '19 digits never reach the server');
  for (const doc of ['pi:0', 'x:1', 'odoo:', 'cost:01', 'PI:1']) assert.equal(parse({ view: 'invoices', doc }).doc, '', doc);
  const custom = parse({ view: 'invoices', from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual([custom.period, custom.from, custom.to], ['custom', '2026-10-01', '2026-10-31']);
  assert.deepEqual(parse({ view: 'costs', only: 'costs', po: '41', doc: 'pi:1' }).only, '', 'other sections never take the finder filters');
  assert.equal(parse({ view: 'costs', po: '41' }).po, null);
  assert.equal(parse({ view: 'costs', doc: 'pi:1' }).doc, '');
});

test('Facturen: a direction switch keeps q, the period and the container, and resets the chip and the preview', () => {
  const inbound = parse({ view: 'invoices', q: 'Verhoeven', period: 'quarter', po: '41', only: 'odoo-new', doc: 'odoo:900001', line: '7' });
  const out = patchLocation(inbound, { tab: 'out' });
  assert.deepEqual([out.tab, out.q, out.period, out.po, out.only, out.doc, out.line], ['out', 'Verhoeven', 'quarter', 41, '', '', null]);
  const ranged = patchLocation(parse({ view: 'invoices', from: '2026-01-01', to: '2026-03-31' }), { tab: 'out' });
  assert.deepEqual([ranged.period, ranged.from, ranged.to], ['custom', '2026-01-01', '2026-03-31']);
  const back = patchLocation(out, { tab: 'in' });
  assert.deepEqual([back.tab, back.q, back.period, back.po], ['in', 'Verhoeven', 'quarter', 41]);
  const chip = patchLocation(inbound, { only: 'costs' });
  assert.deepEqual([chip.q, chip.po, chip.doc], ['Verhoeven', 41, 'odoo:900001'], 'a chip keeps the rest');
  const entered = patchLocation(parse({ view: 'costs', q: 'huur', period: 'month' }), { view: 'invoices', po: 41 });
  assert.deepEqual([entered.tab, entered.q, entered.period, entered.po], ['in', '', 'all', 41], 'entering Facturen starts from its defaults');
  const left = patchLocation(inbound, { view: 'costs' });
  assert.deepEqual([left.q, left.po, left.only, left.doc, left.period], ['', null, '', '', 'year'], 'leaving it drops the finder filters');
});
