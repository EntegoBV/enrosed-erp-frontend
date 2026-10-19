import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_CASH_LOCATION, RULE_PARAM, cashLink, cashQueryParams, parseCashLocation, toScenarioDefaults, withoutScenarioDefaults,
} from '../src/app/features/analyses/cash-url.ts';
import type { CashLocation } from '../src/app/features/analyses/cash-url.ts';

const parse = (query: string) => {
  const params = new URLSearchParams(query);
  return parseCashLocation((key) => params.get(key));
};

test('the plain address is the default location and writes no parameter', () => {
  assert.deepEqual(parse(''), DEFAULT_CASH_LOCATION);
  assert.deepEqual(DEFAULT_CASH_LOCATION, {
    horizon: 6, po: null, priceMode: null, markupPct: null, markupEurPerUnit: null, costBasis: null, sellWeeks: null,
    seasonal: null, paymentDays: null, includeStock: true, rulesOff: [], openQuotesOn: false,
  });
  assert.deepEqual(cashQueryParams(DEFAULT_CASH_LOCATION), {});
  assert.equal(cashLink('https://erp.example', DEFAULT_CASH_LOCATION), 'https://erp.example/analyses/cash');
});

test('every parameter round-trips', () => {
  const location: CashLocation = {
    horizon: 12, po: 43, priceMode: 'EUR_PER_UNIT', markupPct: 37.5, markupEurPerUnit: 2.4473, costBasis: 'PRICING', sellWeeks: 14,
    seasonal: true, paymentDays: 21, includeStock: false, rulesOff: ['invoices', 'vat'], openQuotesOn: true,
  };
  const query = cashQueryParams(location);
  assert.deepEqual(query, { h: '12', po: '43', prijs: 'stuk', opslag: '37.5', stuk: '2.4473', basis: 'enr', weken: '14', verloop: 'seizoen',
    termijn: '21', voorraad: '0', uit: 'facturen,btw', open: '1' });
  assert.deepEqual(parse(new URLSearchParams(query).toString()), location);
  for (const [prijs, mode] of [['opslag', 'MARKUP_PCT'], ['lijst', 'LIST'], ['historisch', 'HISTORIC']] as const) {
    assert.equal(parse(`prijs=${prijs}`).priceMode, mode);
    assert.deepEqual(cashQueryParams(parse(`prijs=${prijs}`)), { prijs });
  }
  assert.deepEqual(parse('h=3&basis=ext&verloop=vlak&termijn=0'), { ...DEFAULT_CASH_LOCATION, horizon: 3, costBasis: 'EXTERNAL', seasonal: false, paymentDays: 0 });
  assert.deepEqual(cashQueryParams(parse('h=3&basis=ext&verloop=vlak&termijn=0')), { h: '3', basis: 'ext', verloop: 'vlak', termijn: '0' });
  assert.equal(cashLink('https://erp.example', parse('h=12&uit=btw,facturen')), 'https://erp.example/analyses/cash?h=12&uit=facturen%2Cbtw');
});

test('invalid values fall back to the default', () => {
  assert.equal(parse('h=7').horizon, 6);
  assert.equal(parse('h=').horizon, 6);
  assert.equal(parse('opslag=abc').markupPct, null);
  assert.equal(parse('opslag=37.55').markupPct, null, 'one decimal at most');
  assert.equal(parse('opslag=1000.1').markupPct, null);
  assert.equal(parse('opslag=-5').markupPct, null);
  assert.equal(parse('opslag=37,5').markupPct, 37.5, 'a Dutch comma reads');
  assert.equal(parse('opslag=0').markupPct, 0);
  assert.equal(parse('opslag=1000').markupPct, 1000);
  assert.equal(parse('prijs=stuk&stuk=1.23456').markupEurPerUnit, null, 'four decimals at most');
  assert.equal(parse('prijs=stuk&stuk=-1').markupEurPerUnit, null);
  assert.equal(parse('stuk=2').markupEurPerUnit, null, 'stuk is read only with prijs=stuk');
  assert.equal(parse('prijs=opslag&stuk=2').markupEurPerUnit, null);
  assert.equal(parse('prijs=duur').priceMode, null);
  assert.equal(parse('basis=intern').costBasis, null);
  assert.equal(parse('weken=0').sellWeeks, null);
  assert.equal(parse('weken=105').sellWeeks, null);
  assert.equal(parse('weken=12.5').sellWeeks, null);
  assert.equal(parse('weken=104').sellWeeks, 104);
  assert.equal(parse('verloop=snel').seasonal, null);
  assert.equal(parse('termijn=366').paymentDays, null);
  assert.equal(parse('termijn=365').paymentDays, 365);
  assert.equal(parse('po=abc').po, null);
  assert.equal(parse('po=0').po, null);
  assert.equal(parse('po=-4').po, null);
  assert.equal(parse('voorraad=1').includeStock, true);
  assert.equal(parse('voorraad=0').includeStock, false);
  assert.equal(parse('open=ja').openQuotesOn, false);
});

test('uit is a comma list of the seven rule words, unknown ones dropped, written in a fixed order', () => {
  assert.deepEqual(Object.values(RULE_PARAM), ['tica', 'facturen', 'offertes', 'partner', 'containers', 'kosten', 'btw']);
  assert.deepEqual(parse('uit=btw,kosten,onzin,facturen,btw').rulesOff, ['invoices', 'costs', 'vat']);
  assert.deepEqual(parse('uit=offertes,partner,containers').rulesOff, ['quotes', 'partner', 'containers']);
  assert.deepEqual(parse('uit=').rulesOff, []);
  assert.deepEqual(parse('uit=openQuotes').rulesOff, [], 'open quotes switch through open=1, never through uit');
  assert.deepEqual(cashQueryParams({ ...DEFAULT_CASH_LOCATION, rulesOff: ['vat', 'invoices'] }), { uit: 'facturen,btw' });
});

test('toScenarioDefaults maps the link values; withoutScenarioDefaults clears only them', () => {
  assert.deepEqual(toScenarioDefaults(DEFAULT_CASH_LOCATION), { priceMode: null, markupPct: null, markupEurPerUnit: null, costBasis: null,
    sellWeeks: null, seasonal: null, paymentDays: null });
  const location = parse('h=3&po=41&prijs=stuk&stuk=1.5&opslag=60&basis=enr&weken=16&verloop=seizoen&termijn=45&voorraad=0&uit=btw&open=1');
  assert.deepEqual(toScenarioDefaults(location), { priceMode: 'EUR_PER_UNIT', markupPct: 60, markupEurPerUnit: 1.5, costBasis: 'PRICING',
    sellWeeks: 16, seasonal: true, paymentDays: 45 });
  assert.equal(toScenarioDefaults({ ...location, priceMode: 'MARKUP_PCT' }).markupEurPerUnit, null);
  assert.deepEqual(withoutScenarioDefaults(location), { ...DEFAULT_CASH_LOCATION, horizon: 3, po: 41, includeStock: false, rulesOff: ['vat'], openQuotesOn: true });
});
