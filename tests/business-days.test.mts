import assert from 'node:assert/strict';
import test from 'node:test';
import { addBusinessDays, onOrNextBusinessDay, plannedBusinessDay } from '../src/app/shared/business-days.ts';

function date(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12);
}

function ymd(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

test('weekends do not count in automatic planning', () => {
  assert.equal(ymd(addBusinessDays(date(2026, 8, 28), 1)), '2026-08-31');
  assert.equal(ymd(addBusinessDays(date(2026, 8, 28), 3)), '2026-09-02');
});

test('today on a weekend becomes Monday', () => {
  assert.equal(ymd(onOrNextBusinessDay(date(2026, 8, 29))), '2026-08-31');
  assert.equal(ymd(plannedBusinessDay(date(2026, 8, 30), 0)), '2026-08-31');
});

test('five working days means the same weekday next week', () => {
  assert.equal(ymd(plannedBusinessDay(date(2026, 8, 28), 5)), '2026-09-04');
});
