import assert from 'node:assert/strict';
import test from 'node:test';
import { cashTotalOf, meerBetaaldOf, reverseChargeOf, vatOf } from '../src/app/features/finance/finance-metrics.ts';

/* Inkoop & kosten › Containers: Afspraak − betaald ± verschil = open, in the PO page's words. */
const stream = (payee: string, plannedEur: number, paidEur: number, remainingEur: number) => ({ payee, plannedEur, paidEur, remainingEur });
function container(streams: ReturnType<typeof stream>[]) {
  const sum = (key: 'plannedEur' | 'paidEur' | 'remainingEur') => Math.round(streams.reduce((total, row) => total + row[key] * 100, 0)) / 100;
  return { totals: { plannedExternalEur: sum('plannedEur'), paidEur: sum('paidEur'), remainingEur: sum('remainingEur') }, streams };
}

test('the five production differences of 16 Oct 2026 close the screen: afspraak − betaald + verschil = open', () => {
  const cases: [string, ReturnType<typeof container>, number][] = [
    ['PO-2026-011', container([stream('SUPPLIER', 32162.4, 37121.82, 0), stream('LOGISTICS', 4200, 0, 4200)]), 4959.42],
    ['PO-2026-013', container([stream('SUPPLIER', 59620, 18415, 41734), stream('SEPARATE', 250, 0, 250)]), 529],
    ['PO-2026-006', container([stream('SUPPLIER', 10000, 10056.36, 0), stream('LOGISTICS', 2449.44, 0, 2449.44)]), 56.36],
    ['PO-2026-007', container([stream('SUPPLIER', 10000, 10056.36, 0), stream('LOGISTICS', 2263.07, 0, 2263.07)]), 56.36],
    ['PO-2026-002', container([stream('SUPPLIER', 25644.09, 25644.59, 0)]), 0.5],
  ];
  let strip = 0;
  for (const [name, source, expected] of cases) {
    const difference = meerBetaaldOf(source);
    assert.equal(difference.moreEur, expected, name);
    assert.equal(difference.otherEur, 0, name);
    assert.equal(Math.round((source.totals.plannedExternalEur - source.totals.paidEur + difference.diffEur) * 100) / 100, source.totals.remainingEur, `${name} closes`);
    strip += Math.round(difference.moreEur * 100);
  }
  assert.equal(strip / 100, 5601.64);
});

test('bijkomende kosten stand apart: a payment without an Afspraak is no "meer betaald"', () => {
  const source = container([stream('SUPPLIER', 1000, 1000, 0), stream('OTHER', 0, 180, 0), stream('LOGISTICS', 500, 0, 520)]);
  const difference = meerBetaaldOf(source);
  assert.deepEqual(difference, { diffEur: 200, moreEur: 20, otherEur: 180 });
  const less = meerBetaaldOf(container([stream('SUPPLIER', 1000, 900, 50)]));
  assert.equal(less.moreEur, -50, 'minder betaald');
});

test('reverse charge: the VAT the rate gives is "verlegd" and never leaves the bank', () => {
  const expofit = { amountExclEur: 349.6, vatPct: 21, vatRegime: 'EU_SERVICES' };
  assert.equal(reverseChargeOf(expofit), 73.42);
  assert.equal(vatOf(expofit), 73.42);
  assert.equal(cashTotalOf(expofit), 349.6);
  assert.equal(reverseChargeOf({ amountExclEur: 100, vatPct: 21, vatRegime: 'BE' }), 0);
  assert.equal(reverseChargeOf({ amountExclEur: 100, vatPct: 21, vatRegime: null }), 0);
});
