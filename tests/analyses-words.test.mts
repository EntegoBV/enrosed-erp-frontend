import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dayMonth, daysLabel, eurShort, monthLabel, monthShort, plural, rangeLabel, rangeLabelShort, weekdayDayMonth, wholeNumber,
} from '../src/app/features/analyses/analyses-words.ts';

test('plurals say one word, never "factuur/facturen" or "offerte(s)"', () => {
  assert.equal(plural(1, 'factuur', 'facturen'), '1 factuur');
  assert.equal(plural(5, 'factuur', 'facturen'), '5 facturen');
  assert.equal(plural(0, 'offerte', 'offertes'), '0 offertes');
  assert.equal(plural(84994, 'stuk', 'stuks'), '84.994 stuks');
  assert.equal(plural(2, 'SKU', 'SKU’s'), '2 SKU’s');
  assert.equal(daysLabel(1), '1 dag');
  assert.equal(daysLabel(7), '7 dagen');
  assert.equal(wholeNumber(-1200), '−1.200');
});

test('months read "mrt 2026", days "vr 16 okt"', () => {
  assert.equal(monthLabel('2026-03'), 'mrt 2026');
  assert.equal(monthLabel('2026-10'), 'okt 2026');
  assert.equal(monthLabel('rubbish'), 'rubbish');
  assert.equal(monthShort('2026-05'), 'mei');
  assert.equal(dayMonth('2026-10-16'), '16 okt');
  assert.equal(dayMonth('2025-12-01', '2026'), '1 dec 2025');
  assert.equal(weekdayDayMonth('2026-10-16'), 'vr 16 okt');
  assert.equal(weekdayDayMonth('2027-01-09'), 'za 9 jan');
});

test('the range shows one year once and says "alle jaren" without bounds', () => {
  assert.equal(rangeLabel('2026-01-01', '2026-10-16'), '1 jan – 16 okt 2026');
  assert.equal(rangeLabel('2025-12-01', '2026-01-31'), '1 dec 2025 – 31 jan 2026');
  assert.equal(rangeLabel('', ''), 'alle jaren');
  assert.equal(rangeLabel(null, undefined), 'alle jaren');
  assert.equal(rangeLabel('2026-01-01', ''), 'vanaf 1 jan 2026');
  assert.equal(rangeLabel('', '2026-03-31'), 't/m 31 mrt 2026');
  assert.equal(rangeLabel('2026-04-02', '2026-04-02'), '2 apr 2026');
  assert.equal(rangeLabelShort('2026-01-01', '2026-10-16', '2026-10-16'), '1 jan – 16 okt');
  assert.equal(rangeLabelShort('2025-01-01', '2025-12-31', '2026-10-16'), '1 jan – 31 dec 2025');
});

test('whole euros carry the minus before the sign', () => {
  assert.equal(eurShort(3620.53), '€ 3.621');
  assert.equal(eurShort(-3620.53), '− € 3.621');
  assert.equal(eurShort(0), '€ 0');
  assert.equal(eurShort(-0.4), '€ 0');
});
