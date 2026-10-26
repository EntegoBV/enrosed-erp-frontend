import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FINANCE_GROUPS, FINANCE_NAV, FINANCE_SECTIONS, FINANCE_TABS, blankBalance, blankCost, blankCostParty, blankRecurring, financeNavOf, financeSection, localIsoDay, periodRange,
  phoneTabOf,
} from '../src/app/features/finance/finance-sections.ts';

test('today follows the local calendar, also a minute either side of midnight', () => {
  assert.equal(localIsoDay(new Date(2026, 8, 24, 23, 59)), '2026-09-24');
  assert.equal(localIsoDay(new Date(2026, 8, 25, 0, 1)), '2026-09-25');
  assert.equal(localIsoDay(new Date(2026, 11, 31, 23, 59, 59)), '2026-12-31');
  assert.equal(localIsoDay(new Date(2027, 0, 1, 0, 0)), '2027-01-01');
});

test('period presets run up to today, last year covers the whole year', () => {
  const expect = {
    '2026-01-01': { month: ['2026-01-01', '2026-01-01'], quarter: ['2026-01-01', '2026-01-01'], year: ['2026-01-01', '2026-01-01'] },
    '2026-03-31': { month: ['2026-03-01', '2026-03-31'], quarter: ['2026-01-01', '2026-03-31'], year: ['2026-01-01', '2026-03-31'] },
    '2026-04-01': { month: ['2026-04-01', '2026-04-01'], quarter: ['2026-04-01', '2026-04-01'], year: ['2026-01-01', '2026-04-01'] },
    '2026-12-31': { month: ['2026-12-01', '2026-12-31'], quarter: ['2026-10-01', '2026-12-31'], year: ['2026-01-01', '2026-12-31'] },
  } as const;
  for (const [today, periods] of Object.entries(expect)) {
    for (const [id, [from, to]] of Object.entries(periods)) {
      assert.deepEqual(periodRange(id as 'month', today), { from, to }, `${id} on ${today}`);
    }
    assert.deepEqual(periodRange('lastYear', today), { from: '2025-01-01', to: '2025-12-31' });
    assert.deepEqual(periodRange('all', today), { from: '', to: '' });
  }
});

test('blank forms use the day they are given, not a day fixed at start-up', () => {
  assert.equal(blankCost('2026-10-02').date, '2026-10-02');
  assert.equal(blankCost('2026-10-02').paidOn, null);
  assert.equal(blankRecurring('2026-10-02').startDate, '2026-10-02');
  const balance = blankBalance('2026-10-02', 'KBC Zakelijk');
  assert.deepEqual([balance.date, balance.account, balance.timeZone], ['2026-10-02', 'KBC Zakelijk', 'Europe/Brussels']);
  assert.equal(blankBalance('2026-10-02').account, '', 'a new account starts empty');
});

test('six sections in groups; Bank leads and the Overzicht is gone; Facturen opens Boekhouding', () => {
  assert.deepEqual(FINANCE_SECTIONS.map((section) => section.id), ['bank', 'open', 'incoming', 'invoices', 'costs', 'analysis']);
  assert.deepEqual(financeSection('invoices'), { id: 'invoices', label: 'Facturen', short: 'Facturen', group: 'Boekhouding', icon: 'document',
    hint: 'Elke factuur: opgeladen, Odoo en verkoop', phoneTab: false });
  assert.deepEqual(FINANCE_TABS.invoices.map((tab) => [tab.id, tab.label, tab.short]), [['in', 'Inkomend', 'In'], ['out', 'Uitgaand', 'Uit']]);
  assert.deepEqual([...new Set(FINANCE_SECTIONS.map((section) => section.group))], ['Bank', 'Geld', 'Boekhouding']);
  assert.deepEqual(FINANCE_GROUPS, ['Bank', 'Geld', 'Boekhouding']);
  assert.deepEqual(financeSection('bank'), { id: 'bank', label: 'Bank', short: 'Bank', group: 'Bank', icon: 'bank', hint: 'Saldi, kaslijn en wat vandaag bewoog', phoneTab: true });
  assert.deepEqual(FINANCE_TABS.bank.map((tab) => [tab.id, tab.label, tab.short]), [['accounts', 'Bank', 'Bank'], ['movements', 'Transacties', 'Transacties']]);
  assert.deepEqual(FINANCE_TABS.costs.map((tab) => tab.short), ['Kosten', 'Containers', 'Vast', 'Aan wie']);
  assert.deepEqual(FINANCE_TABS.costs.map((tab) => tab.label), ['Kosten', 'Containers', 'Vaste kosten', 'Aan wie & beurzen'], "the tab is 'Kosten' since Facturen is its own place");
  assert.equal(financeSection('costs').hint, 'Uitgaven, inkooporders en vaste kosten');
  assert.deepEqual(FINANCE_TABS.open.map((tab) => tab.short), ['Alles', 'Kosten', 'Containers', 'Vast']);
  assert.deepEqual(FINANCE_TABS.analysis.map((tab) => [tab.id, tab.label, tab.short]), [['costs', 'Kosten', 'Kosten'], ['vat', 'Btw-aangifte', 'Btw']]);
  assert.equal(financeSection('analysis').hint, 'Per categorie, per maand, de btw-aangifte');
  assert.equal(blankCost('2026-10-02').amountInclEur, null, 'a new cost is entered excl. btw until the form says otherwise');
});

test('FINANCE_NAV: seven places on the keys 1-7 (Facturen first of Boekhouding on 7), five phone tabs Bank · Transacties · Betalen · Ontvangen · Kosten', () => {
  assert.deepEqual(FINANCE_NAV.map((item) => [item.id, item.label, item.key]), [
    ['bank', 'Bank', '1'], ['transactions', 'Transacties', '2'], ['open', 'Te betalen', '3'], ['incoming', 'Te ontvangen', '4'],
    ['invoices', 'Facturen', '7'], ['costs', 'Inkoop & kosten', '5'], ['analysis', 'Rapportage', '6'],
  ]);
  assert.deepEqual([...FINANCE_NAV.map((item) => item.key)].sort(), ['1', '2', '3', '4', '5', '6', '7'], 'every key once');
  assert.deepEqual(FINANCE_NAV.filter((item) => item.phoneTab).map((item) => item.short), ['Bank', 'Transacties', 'Betalen', 'Ontvangen', 'Kosten']);
  assert.deepEqual(FINANCE_NAV.map((item) => item.group), ['Bank', 'Bank', 'Geld', 'Geld', 'Boekhouding', 'Boekhouding', 'Boekhouding']);
  assert.deepEqual(FINANCE_NAV.filter((item) => item.group === 'Boekhouding').map((item) => item.label), ['Facturen', 'Inkoop & kosten', 'Rapportage']);
  assert.deepEqual(FINANCE_NAV.map((item) => `${item.target.view}/${item.target.tab}`),
    ['bank/accounts', 'bank/movements', 'open/all', 'incoming/open', 'invoices/in', 'costs/company', 'analysis/costs']);
  assert.equal(financeNavOf({ view: 'invoices', tab: 'out' }).id, 'invoices');
  assert.equal(phoneTabOf({ view: 'invoices', tab: 'in' }), 'costs', 'the phone lights Kosten on Facturen');
  assert.equal(phoneTabOf({ view: 'invoices', tab: 'out' }), 'costs');
  assert.equal(phoneTabOf({ view: 'bank', tab: 'movements' }), 'transactions');
  assert.equal(phoneTabOf({ view: 'costs', tab: 'recurring' }), 'costs');
  assert.equal(phoneTabOf({ view: 'analysis', tab: 'costs' }), 'analysis');
  assert.equal(FINANCE_NAV[0].hint, financeSection('bank').hint, 'one Bank hint');
  assert.equal(FINANCE_NAV.find((item) => item.id === 'costs')?.hint, financeSection('costs').hint, 'one Inkoop & kosten hint');
  assert.equal(FINANCE_NAV[1].hint, 'Alle banktransacties: koppelen, splitsen en boeken');
  assert.equal(financeNavOf({ view: 'bank', tab: 'accounts' }).id, 'bank');
  assert.equal(financeNavOf({ view: 'bank', tab: 'movements' }).id, 'transactions');
  assert.equal(financeNavOf({ view: 'costs', tab: 'containers' }).id, 'costs');
});

test('a new cost starts as a confirmed Belgian invoice, fully deductible; a recurring cost and a party alike', () => {
  const cost = blankCost('2026-10-02');
  assert.deepEqual([cost.vatRegime, cost.vatRegimeConfirmed, cost.supplierCountry, cost.costKind, cost.expenseType, cost.vatDeductiblePct, cost.taxDeductiblePct, cost.depreciationYears, cost.depreciationStart],
    ['BE', true, 'BE', null, 'STANDARD', 100, 100, null, null]);
  const recurring = blankRecurring('2026-10-02');
  assert.deepEqual([recurring.vatRegime, recurring.vatRegimeConfirmed, recurring.supplierCountry, recurring.costKind, recurring.expenseType, recurring.vatDeductiblePct, recurring.taxDeductiblePct],
    ['BE', true, 'BE', null, 'STANDARD', 100, 100]);
  const party = blankCostParty('Google');
  assert.deepEqual([party.name, party.country, party.vatNumber, party.vatRegime], ['Google', null, null, null]);
});
