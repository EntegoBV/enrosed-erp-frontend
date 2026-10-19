import assert from 'node:assert/strict';
import test from 'node:test';
import type { CompanyCost } from '../src/app/core/api/models.ts';
import {
  COST_MONEY, EXPENSE_PRESETS, REVERSE_CHARGE, VAT_REGIMES, acquisitionValueOf, cashTotalOf, costChargeIn, deductibleVatOf, defaultReturnPeriod,
  depreciationIn, depreciationSchedule, expenseOf, filingDeadline, inclOf, isInvestment, kindOf, nonDeductibleVatOf, openOf, paidOf, quarterOf, quarterRange,
  regimeLabel, returnLineOf, returnVatOf, revisionUntil, suggestInvestment, vatOf,
} from '../src/app/features/finance/finance-metrics.ts';
import type { VatRow } from '../src/app/features/finance/finance-metrics.ts';

function cost(input: Partial<CompanyCost> & { amountExclEur: number }): CompanyCost {
  return { id: 1, date: '2026-08-10', category: 'SOFTWARE', description: 'Kost', party: 'Partij', vatPct: 21, amountInclEur: null, reference: null, paidOn: null,
    salesChannel: null, notes: null, recurringCostId: null, vatRegime: 'BE', vatRegimeConfirmed: true, supplierCountry: 'BE', costKind: null, expenseType: 'STANDARD',
    vatDeductiblePct: 100, taxDeductiblePct: 100, depreciationYears: null, depreciationStart: null, ...input };
}

/* One row per regime: [row, cash, vat, return, deductible (59), expense]. */
const TABLE: [string, VatRow, number, number, number, number, number][] = [
  ['BE invoice entered incl.', { amountExclEur: 82.64, vatPct: 21, amountInclEur: 100, vatRegime: 'BE' }, 100, 17.36, 17.36, 17.36, 82.64],
  ['EU service, reverse charge', { amountExclEur: 100, vatPct: 21, vatRegime: 'EU_SERVICES' }, 100, 21, 21, 21, 100],
  ['EU goods, reverse charge', { amountExclEur: 100, vatPct: 21, vatRegime: 'EU_GOODS' }, 100, 21, 21, 21, 100],
  ['non-EU service, reverse charge', { amountExclEur: 100, vatPct: 21, vatRegime: 'NON_EU_SERVICES' }, 100, 21, 21, 21, 100],
  ['EU service, half deductible', { amountExclEur: 100, vatPct: 21, vatRegime: 'EU_SERVICES', vatDeductiblePct: 50 }, 100, 21, 21, 10.5, 110.5],
  ['restaurant in Belgium', { amountExclEur: 100, vatPct: 21, vatRegime: 'BE', vatDeductiblePct: 0 }, 121, 21, 21, 0, 121],
  ['foreign VAT', { amountExclEur: 100, vatPct: 9, vatRegime: 'FOREIGN_VAT' }, 109, 9, 0, 0, 109],
  ['import VAT on the customs document', { amountExclEur: 0, vatPct: null, amountInclEur: 1234.56, vatRegime: 'IMPORT_VAT_PAID' }, 1234.56, 1234.56, 1234.56, 1234.56, 0],
  ['ticket without invoice', { amountExclEur: 25, vatPct: null, vatRegime: 'NO_INVOICE' }, 25, 0, 0, 0, 25],
  ['exempt', { amountExclEur: 50, vatPct: null, vatRegime: 'EXEMPT' }, 50, 0, 0, 0, 50],
  ['out of scope', { amountExclEur: 30, vatPct: null, vatRegime: 'OUT_OF_SCOPE' }, 30, 0, 0, 0, 30],
  ['no regime reads as Belgian', { amountExclEur: 100, vatPct: 21 }, 121, 21, 21, 21, 100],
];

test('one money rule per regime: cash, VAT, return VAT, deductible share, expense', () => {
  for (const [name, row, cash, vat, ret, deductible, expense] of TABLE) {
    assert.equal(cashTotalOf(row), cash, `${name}: cash`);
    assert.equal(vatOf(row), vat, `${name}: vat`);
    assert.equal(returnVatOf(row), ret, `${name}: return`);
    assert.equal(deductibleVatOf(row), deductible, `${name}: 59`);
    assert.equal(nonDeductibleVatOf(row), Math.round((ret - deductible) * 100) / 100, `${name}: non-deductible`);
    assert.equal(expenseOf(row), expense, `${name}: expense`);
  }
  assert.equal(inclOf({ amountExclEur: 82.64, vatPct: 21 }), 99.99, 'the alias keeps the older name');
  assert.equal(COST_MONEY.cashTotalOf, cashTotalOf);
  assert.equal(vatOf({ amountExclEur: 100, vatPct: 21, amountInclEur: 121, vatRegime: 'EU_SERVICES' }), 21, 'a stored total is ignored under reverse charge');
  assert.equal(cashTotalOf({ amountExclEur: 100, vatPct: 21, amountInclEur: 121, vatRegime: 'EU_SERVICES' }), 100);
});

test('regimes, labels and presets', () => {
  assert.equal(VAT_REGIMES.length, 9);
  assert.deepEqual([...REVERSE_CHARGE].sort(), ['EU_GOODS', 'EU_SERVICES', 'NON_EU_SERVICES']);
  assert.equal(regimeLabel(null), 'Nog te bepalen');
  assert.equal(regimeLabel('EU_SERVICES'), 'EU · dienst');
  assert.deepEqual(VAT_REGIMES.map((row) => row.group), ['Belgisch', 'Verlegd', 'Verlegd', 'Verlegd', 'Geen aftrek', 'Geen aftrek', 'Geen aftrek', 'Geen aftrek', 'Invoer']);
  assert.deepEqual(EXPENSE_PRESETS.map((row) => [row.code, row.vatPct, row.taxPct]),
    [['STANDARD', 100, 100], ['RESTAURANT', 0, 69], ['RECEPTION', 0, 50], ['GIFT', 100, 50], ['CAR', 50, 100], ['MIXED', 75, 100], ['CUSTOM', null, null]]);
  assert.equal(kindOf({ amountExclEur: 1, vatPct: 21, category: 'MATERIAAL' }), 'GOODS');
  assert.equal(kindOf({ amountExclEur: 1, vatPct: 21, category: 'HUUR' }), 'SERVICES');
  assert.equal(isInvestment({ amountExclEur: 1, vatPct: 21, costKind: 'INVESTMENT' }), true);
});

test('what is open follows the server once it spoke, and the paid date only before that', () => {
  assert.equal(openOf(cost({ amountExclEur: 100, openEur: 60, paidOn: null })), 60);
  assert.equal(openOf(cost({ amountExclEur: 100, openEur: 0, paidOn: null })), 0, 'a cost paid in full without a date is not open');
  assert.equal(openOf(cost({ amountExclEur: 100, paidOn: null })), 121, 'an older response: the whole cash total');
  assert.equal(openOf(cost({ amountExclEur: 100, paidOn: '2026-08-11' })), 0);
  assert.equal(paidOf(cost({ amountExclEur: 100, paidEur: 40 })), 40);
  assert.equal(paidOf(cost({ amountExclEur: 100, paidOn: '2026-08-11' })), 121);
});

test('return lines land in the grid of their kind; investments in 83 with a revision date', () => {
  const service = returnLineOf(cost({ amountExclEur: 100 }), true);
  assert.deepEqual([service.year, service.quarter, service.baseGrid, service.baseEur, service.detailGrid, service.dueGrid, service.deductibleEur, service.confirmed],
    [2026, 3, '82', 100, null, null, 21, true]);
  assert.equal(returnLineOf(cost({ amountExclEur: 100, category: 'MATERIAAL' }), true).baseGrid, '81');
  const reverse = returnLineOf(cost({ amountExclEur: 100, vatRegime: 'EU_SERVICES', supplierCountry: 'IE', vatDeductiblePct: 50 }), true);
  assert.deepEqual([reverse.baseGrid, reverse.baseEur, reverse.detailGrid, reverse.detailEur, reverse.dueGrid, reverse.dueEur, reverse.deductibleEur],
    ['82', 110.5, '88', 100, '55', 21, 10.5]);
  const investment = returnLineOf(cost({ amountExclEur: 3000, costKind: 'INVESTMENT', depreciationYears: 3, depreciationStart: '2026-07-01' }), true);
  assert.deepEqual([investment.baseGrid, investment.baseEur, investment.investment, investment.revisionUntil], ['83', 3000, true, '2030-12-31']);
  const importVat = returnLineOf(cost({ amountExclEur: 0, vatPct: null, amountInclEur: 500, vatRegime: 'IMPORT_VAT_PAID' }), false);
  assert.deepEqual([importVat.baseGrid, importVat.deductibleEur, importVat.needsDocument], [null, 500, true]);
  assert.equal(returnLineOf(cost({ amountExclEur: 0, vatPct: null, amountInclEur: 500, vatRegime: 'IMPORT_VAT_PAID', recurringCostId: 3 }), false).needsDocument, false);
  const unknown = returnLineOf(cost({ amountExclEur: 10, vatPct: 0, vatRegime: null, vatRegimeConfirmed: false }), true);
  assert.deepEqual([unknown.regime, unknown.confirmed, unknown.baseGrid, unknown.deductibleEur], [null, false, null, 0]);
  assert.equal(returnLineOf(cost({ amountExclEur: 10, vatRegimeConfirmed: false }), true).confirmed, false);
  assert.equal(returnLineOf(cost({ amountExclEur: 10, createdAt: '2026-10-26T08:00:00Z' }), true).lateBooked, true, 'booked after the 25th of October');
  assert.equal(returnLineOf(cost({ amountExclEur: 10, createdAt: '2026-10-20T08:00:00Z' }), true).lateBooked, false);
});

test('depreciation: linear, pro rata by days, the last year takes the rest', () => {
  const asset = { acquisitionEur: 3000, years: 3, start: '2026-07-01' };
  assert.deepEqual(depreciationSchedule(asset), [{ year: 2026, eur: 504.11 }, { year: 2027, eur: 1000 }, { year: 2028, eur: 1000 }, { year: 2029, eur: 495.89 }]);
  assert.equal(depreciationIn(asset, '2026-07-01', '2026-12-31'), 504.11);
  assert.equal(depreciationIn(asset, '2027-03-01', '2027-03-31'), 84.93, 'a month: 1 000 × 31 / 365');
  assert.equal(depreciationIn(asset, null, null), 3000, 'the whole life sums to the acquisition value');
  assert.equal(depreciationIn(asset, '2026-01-01', '2026-06-30'), 0, 'nothing before the start');
  assert.equal(depreciationIn(asset, '2029-07-01', '2029-12-31'), 0, 'nothing after the life');
  assert.equal(revisionUntil('2026-07-01'), '2030-12-31');
  assert.equal(acquisitionValueOf({ amountExclEur: 1000, vatPct: 21, vatRegime: 'BE', vatDeductiblePct: 50 }), 1105, 'non-deductible VAT is capitalised');
  const investment = cost({ amountExclEur: 3000, costKind: 'INVESTMENT', depreciationYears: 3, depreciationStart: '2026-07-01' });
  assert.deepEqual(costChargeIn(investment, '2026-07-01', '2026-12-31'), { expenseEur: 0, depreciationEur: 504.11 });
  assert.deepEqual(costChargeIn(investment, null, null, '2026-10-12'), { expenseEur: 0, depreciationEur: 284.93 }, 'an open window stops at today: 504,11 × 104 / 184');
  assert.equal(costChargeIn(investment, '2026-07-01', '2026-12-31', '2026-10-12').depreciationEur, 284.93, 'a window past today is capped too');
  assert.equal(costChargeIn(investment, '2026-07-01', '2026-09-30', '2026-10-12').depreciationEur, 252.06, 'a window before today is untouched: 504,11 × 92 / 184');
  assert.deepEqual(costChargeIn(cost({ amountExclEur: 100 }), '2026-08-01', '2026-08-31'), { expenseEur: 100, depreciationEur: 0 });
  assert.deepEqual(costChargeIn(cost({ amountExclEur: 100 }), '2026-09-01', '2026-09-30'), { expenseEur: 0, depreciationEur: 0 });
});

test('quarters, filing deadlines and the default period', () => {
  assert.deepEqual(quarterOf('2026-10-12'), { year: 2026, quarter: 4 });
  assert.deepEqual(quarterRange(2026, 3), { from: '2026-07-01', to: '2026-09-30' });
  assert.deepEqual(quarterRange(2028, 1), { from: '2028-01-01', to: '2028-03-31' });
  assert.deepEqual([1, 2, 3, 4].map((quarter) => filingDeadline(2026, quarter)), ['2026-04-25', '2026-07-25', '2026-10-25', '2027-01-25']);
  assert.deepEqual(defaultReturnPeriod('2026-10-12'), { year: 2026, quarter: 3 });
  assert.deepEqual(defaultReturnPeriod('2026-04-01'), { year: 2026, quarter: 1 });
  assert.deepEqual(defaultReturnPeriod('2026-01-20'), { year: 2025, quarter: 4 });
});

test('one VAT quarter (F-B2): the closed quarter until its filing day included, then the running one', () => {
  assert.deepEqual(defaultReturnPeriod('2026-10-25'), { year: 2026, quarter: 3 }, 'the filing day itself still shows the closed quarter');
  assert.deepEqual(defaultReturnPeriod('2026-10-26'), { year: 2026, quarter: 4 }, 'the day after, the running quarter');
  assert.deepEqual(defaultReturnPeriod('2026-12-31'), { year: 2026, quarter: 4 });
  assert.deepEqual(defaultReturnPeriod('2027-01-25'), { year: 2026, quarter: 4 }, 'Q4 is due on 25 January of the next year');
  assert.deepEqual(defaultReturnPeriod('2026-02-10'), { year: 2026, quarter: 1 }, 'after 25 January the year\'s first quarter runs');
});

test('the investment suggestion: from € 250 excl., not yet an investment, in a regime with a base grid', () => {
  assert.equal(suggestInvestment({ amountExclEur: 250, vatPct: 21, vatRegime: 'BE' }), true);
  assert.equal(suggestInvestment({ amountExclEur: 249.99, vatPct: 21, vatRegime: 'BE' }), false);
  assert.equal(suggestInvestment({ amountExclEur: 1000, vatPct: 21, vatRegime: 'BE', costKind: 'INVESTMENT' }), false);
  assert.equal(suggestInvestment({ amountExclEur: 1000, vatPct: null, vatRegime: 'OUT_OF_SCOPE' }), false);
  assert.equal(suggestInvestment({ amountExclEur: 0, vatPct: null, amountInclEur: 1000, vatRegime: 'IMPORT_VAT_PAID' }), false);
  assert.equal(suggestInvestment({ amountExclEur: 300, vatPct: 21 }), true, 'no regime reads as Belgian');
  assert.equal(suggestInvestment({ amountExclEur: 300, vatPct: 21, vatRegime: 'BE' }, 500), false);
});
