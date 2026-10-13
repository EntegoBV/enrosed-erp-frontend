import assert from 'node:assert/strict';
import test from 'node:test';
import { exclFromIncl, fitAmountToRegime, inclFromExcl, vatFromIncl } from '../src/app/features/finance/cost-amount.ts';
import type { AmountBlock } from '../src/app/features/finance/cost-amount.ts';

test('an inclusive total splits into excl. and btw without drifting', () => {
  assert.equal(exclFromIncl(100, 21), 82.64);
  assert.equal(vatFromIncl(100, exclFromIncl(100, 21)), 17.36);
  assert.equal(exclFromIncl(1512.5, 21), 1250);
  assert.equal(exclFromIncl(106, 6), 100);
  assert.equal(exclFromIncl(12345.67, 21), 10203.03, 'rounded to the cent, half up');
});

test('without a rate both sides are the same figure, to the cent', () => {
  assert.equal(exclFromIncl(100, null), 100);
  assert.equal(exclFromIncl(100, 0), 100);
  assert.equal(exclFromIncl(1.005, 0), 1.01, 'half up in cents, as the server scales it; not the float 1.00499…');
  assert.equal(exclFromIncl(8.145, 0), 8.15);
  assert.equal(vatFromIncl(8.145, exclFromIncl(8.145, 0)), 0);
  assert.equal(vatFromIncl(8.145, 8.15), 0);
  assert.equal(inclFromExcl(100, null), 100);
  assert.equal(inclFromExcl(100, 0), 100);
  assert.equal(vatFromIncl(100, 100), 0);
});

test('excl. to incl. adds the rounded btw, the way the lists add it up', () => {
  assert.equal(inclFromExcl(1250, 21), 1512.5);
  assert.equal(inclFromExcl(82.64, 21), 99.99);
  assert.equal(inclFromExcl(-5, 21), -5 + round(-5 * 0.21), 'a negative draft is passed through, the server refuses it');
  assert.equal(vatFromIncl(80, 82.64), 0, 'a total under the excl. amount shows no negative btw');
  assert.equal(exclFromIncl(Number.NaN, 21), 0);
});

const typedIncl = (incl: number, vatPct: number | null = 21): AmountBlock => ({ amountExclEur: exclFromIncl(incl, vatPct), amountInclEur: incl, vatPct, mode: 'incl', typedIncl: true, totalKept: false });
const typedExcl = (excl: number, vatPct: number | null = 21): AmountBlock => ({ amountExclEur: excl, amountInclEur: null, vatPct, mode: 'excl', typedIncl: false, totalKept: false });

test('a total typed incl. btw is the excl. amount once the regime puts no VAT on the invoice', () => {
  const reverse = fitAmountToRegime(typedIncl(1210), 'reverse', 'invoice');
  assert.deepEqual(reverse, { amountExclEur: 1210, amountInclEur: null, vatPct: 21, mode: 'excl', typedIncl: false, totalKept: true }, 'not the back-calculated 1.000');
  assert.deepEqual(fitAmountToRegime(typedIncl(106, 6), 'reverse', 'invoice'), { amountExclEur: 106, amountInclEur: null, vatPct: 6, mode: 'excl', typedIncl: false, totalKept: true }, 'the rate stays for the return');
  assert.deepEqual(fitAmountToRegime(typedIncl(50, null), 'reverse', null), { amountExclEur: 50, amountInclEur: null, vatPct: 21, mode: 'excl', typedIncl: false, totalKept: true }, 'reverse charge without a rate takes 21 %');
  assert.deepEqual(fitAmountToRegime(typedIncl(12.1), 'none', 'invoice'), { amountExclEur: 12.1, amountInclEur: null, vatPct: null, mode: 'excl', typedIncl: false, totalKept: true }, 'a ticket or an exempt invoice: the amount on the document');
  assert.equal(fitAmountToRegime(typedIncl(8.145, 0), 'reverse', 'invoice').amountExclEur, 8.15, 'to the cent');
});

test('an amount typed excl. btw stays what it was under reverse charge', () => {
  assert.deepEqual(fitAmountToRegime(typedExcl(1000), 'reverse', 'invoice'), { amountExclEur: 1000, amountInclEur: null, vatPct: 21, mode: 'excl', typedIncl: false, totalKept: false });
  const looked: AmountBlock = { amountExclEur: 1000, amountInclEur: 1210, vatPct: 21, mode: 'incl', typedIncl: false, totalKept: false };
  assert.deepEqual(fitAmountToRegime(looked, 'reverse', 'invoice'), { amountExclEur: 1000, amountInclEur: null, vatPct: 21, mode: 'excl', typedIncl: false, totalKept: false }, 'the mode switch only showed the total; 1.000 was typed');
  assert.deepEqual(fitAmountToRegime(typedExcl(1000, 0), 'reverse', 'invoice').vatPct, 21);
  assert.deepEqual(fitAmountToRegime(typedExcl(1000), 'none', 'invoice'), { amountExclEur: 1000, amountInclEur: null, vatPct: null, mode: 'excl', typedIncl: false, totalKept: false });
});

test('the kept total is the invoice total again when a regime with VAT follows', () => {
  const reverse = fitAmountToRegime(typedIncl(1210), 'reverse', 'invoice');
  assert.deepEqual(fitAmountToRegime(reverse, 'invoice', 'reverse'), typedIncl(1210), 'Buitenlandse btw or België after all: € 1.210 incl., not € 1.464,10');
  assert.deepEqual(fitAmountToRegime(fitAmountToRegime(reverse, 'reverse', 'reverse'), 'invoice', 'reverse'), typedIncl(1210), 'another reverse-charge regime in between changes nothing');
  const exempt = fitAmountToRegime(reverse, 'none', 'reverse');
  assert.deepEqual(exempt, { amountExclEur: 1210, amountInclEur: null, vatPct: null, mode: 'excl', typedIncl: false, totalKept: true });
  assert.deepEqual(fitAmountToRegime(exempt, 'invoice', 'none'), typedIncl(1210), 'the rate comes back as 21 %');
  const retyped: AmountBlock = { ...reverse, amountExclEur: 900, totalKept: false };
  assert.deepEqual(fitAmountToRegime(retyped, 'invoice', 'reverse'), { ...retyped }, 'a figure typed under reverse charge is an excl. amount');
});

test('the other regime changes keep their rules: import VAT is one figure, a rate comes back as 21 %', () => {
  assert.deepEqual(fitAmountToRegime(typedExcl(500), 'import', 'invoice'), { amountExclEur: 0, amountInclEur: 500, vatPct: null, mode: 'incl', typedIncl: false, totalKept: false });
  assert.deepEqual(fitAmountToRegime(typedIncl(605), 'import', 'invoice'), { amountExclEur: 0, amountInclEur: 605, vatPct: null, mode: 'incl', typedIncl: false, totalKept: false });
  assert.deepEqual(fitAmountToRegime(typedExcl(0), 'import', 'invoice').amountInclEur, null);
  const imported: AmountBlock = { amountExclEur: 0, amountInclEur: 500, vatPct: null, mode: 'incl', typedIncl: false, totalKept: false };
  assert.deepEqual(fitAmountToRegime(imported, 'invoice', 'import'), typedExcl(500, 21));
  assert.deepEqual(fitAmountToRegime(imported, 'reverse', 'import'), typedExcl(500, 21));
  assert.deepEqual(fitAmountToRegime(imported, 'none', 'import'), typedExcl(500, null));
  assert.deepEqual(fitAmountToRegime(typedExcl(100, null), 'invoice', 'none'), typedExcl(100, 21));
  assert.deepEqual(fitAmountToRegime(typedExcl(100, 0), 'invoice', null), typedExcl(100, 21), 'a cost without a regime gets a rate with its first one');
  assert.deepEqual(fitAmountToRegime(typedIncl(121, 0), 'invoice', null), typedIncl(121, 21), 'and its excl. amount follows the entered total');
  assert.deepEqual(fitAmountToRegime(typedExcl(100, 0), 'invoice', 'invoice'), typedExcl(100, 0), 'België to Buitenlandse btw leaves a chosen 0 % alone');
  assert.deepEqual(fitAmountToRegime(typedIncl(121), 'invoice', 'invoice'), typedIncl(121));
});

function round(value: number): number { return Math.round(value * 100) / 100; }
