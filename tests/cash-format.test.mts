import assert from 'node:assert/strict';
import test from 'node:test';
import { dayMon, dayMonth, dayMonthYear, eur, eurK, eurWhole, monthShort, signedEur, weekdayDayMonth } from '../src/app/features/finance/cash-format.ts';

test('money reads nl-BE with a real minus and a space', () => {
  assert.equal(eur(32365.27), '€ 32.365,27');
  assert.equal(eur(-7449.81), '− € 7.449,81');
  assert.equal(eur(0), '€ 0,00');
  assert.equal(eur(-0.001), '€ 0,00');
  assert.equal(eur(1234567.5), '€ 1.234.567,50');
  assert.equal(eur(null), '—');
  assert.equal(eurWhole(32365.27), '€ 32.365');
  assert.equal(eurWhole(-7449.81), '− € 7.450');
  assert.equal(signedEur(1906), '+ € 1.906,00');
  assert.equal(signedEur(-7449.81), '− € 7.449,81');
  assert.equal(signedEur(0), '€ 0,00');
});

test('the month strip reads thousands with one decimal, whole euros under € 1.000', () => {
  assert.equal(eurK(46296), '€ 46,3k');
  assert.equal(eurK(-20435), '− € 20,4k');
  assert.equal(eurK(640), '€ 640');
  assert.equal(eurK(-86.73), '− € 87');
  assert.equal(eurK(1234567), '€ 1.234,6k');
});

test('days: 15/10, 15 okt, do 15 okt, 15 okt 2026', () => {
  assert.equal(dayMonth('2026-10-15'), '15/10');
  assert.equal(dayMon('2026-10-15'), '15 okt');
  assert.equal(dayMon('2027-03-01'), '1 mrt');
  assert.equal(weekdayDayMonth('2026-10-15'), 'do 15 okt');
  assert.equal(weekdayDayMonth('2027-04-23'), 'vr 23 apr');
  assert.equal(dayMonthYear('2026-10-15'), '15 okt 2026');
  assert.equal(monthShort('2026-05'), 'mei');
  assert.equal(dayMonth(null), '');
});
