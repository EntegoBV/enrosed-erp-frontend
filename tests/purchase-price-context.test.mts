import assert from 'node:assert/strict';
import test from 'node:test';
import {
  latestOwnFreightQuote,
  purchaseFxDefaults,
  purchaseFxReference,
} from '../src/app/features/purchasing/purchase-price-context.ts';

test('derives the purchase-rate directions from ECB base-EUR rates', () => {
  const reference = purchaseFxReference({
    latestUsd: 1.2,
    latestCny: 8.4,
    asOf: '2026-08-31',
  });

  assert.ok(reference);
  assert.equal(reference.usdToEur, 1 / 1.2);
  assert.equal(reference.cnyToUsd, 1.2 / 8.4);
  assert.equal(reference.asOf, '2026-08-31');
  assert.equal(purchaseFxReference({ latestUsd: 0, latestCny: 8.4, asOf: '2026-08-31' }), null);
});

test('adds the conservative purchase margin to both conversion steps', () => {
  const defaults = purchaseFxDefaults({
    usdToEur: 1 / 1.2,
    cnyToUsd: 1.2 / 8.4,
    asOf: '2026-08-31',
  });

  assert.deepEqual(defaults, {
    usdToEur: 0.85,
    cnyToUsd: 0.1458,
    asOf: '2026-08-31',
    marginPct: 2,
  });
  assert.equal(purchaseFxDefaults(null), null);
  assert.equal(purchaseFxDefaults({ usdToEur: 0, cnyToUsd: 0.14, asOf: '2026-08-31' }), null);
  assert.equal(
    purchaseFxDefaults({ usdToEur: 0.85, cnyToUsd: 0.14, asOf: '2026-08-31' }, -1),
    null,
  );
});

test('keeps the intended double allowance explicit for CNY purchases', () => {
  const reference = { usdToEur: 0.84, cnyToUsd: 0.14, asOf: '2026-08-31' };
  const defaults = purchaseFxDefaults(reference);

  assert.ok(defaults);
  const rawCnyToEur = reference.cnyToUsd * reference.usdToEur;
  const bufferedCnyToEur = defaults.cnyToUsd * defaults.usdToEur;
  assert.ok(bufferedCnyToEur + Number.EPSILON >= rawCnyToEur * 1.02 ** 2);
});

test('finds the newest comparable own 40ft quote', () => {
  const rates = [
    { id: 1, route: 'NINGBO', quotedOn: '2026-08-01', usdPerContainer: 2800 },
    { id: 2, route: 'WCI SHA-RTM', quotedOn: '2026-08-31', usdPerContainer: 4100 },
    { id: 3, route: 'NINGBO', quotedOn: '2026-08-29', usdPerContainer: 3150 },
  ];

  assert.equal(
    latestOwnFreightQuote(rates, 'Ningbo', 'Rotterdam', 'FORTY_HQ')?.usdPerContainer,
    3150,
  );
  assert.equal(latestOwnFreightQuote(rates, 'Ningbo', 'Antwerpen', 'FORTY_HQ'), null);
  assert.equal(latestOwnFreightQuote(rates, 'Ningbo', 'Rotterdam', 'TWENTY_GP'), null);
});

test('maps the terminal aliases used by the own Guangzhou and Shenzhen routes', () => {
  const rates = [
    { id: 4, route: 'GUANGZHOU', quotedOn: '2026-08-29', usdPerContainer: 3000 },
    { id: 5, route: 'SHENZHEN', quotedOn: '2026-08-30', usdPerContainer: 3050 },
  ];

  assert.equal(
    latestOwnFreightQuote(rates, 'Nansha', 'Rotterdam', 'FORTY_GP')?.route,
    'GUANGZHOU',
  );
  assert.equal(
    latestOwnFreightQuote(rates, 'Yantian', 'Rotterdam', 'FORTY_HQ')?.route,
    'SHENZHEN',
  );
});
