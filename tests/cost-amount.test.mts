import assert from 'node:assert/strict';
import test from 'node:test';
import { exclFromIncl, inclFromExcl, vatFromIncl } from '../src/app/features/finance/cost-amount.ts';

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

function round(value: number): number { return Math.round(value * 100) / 100; }
