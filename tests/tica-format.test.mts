import assert from 'node:assert/strict';
import test from 'node:test';
import { ticaToday, ticaPreset, ticaMoment, ticaRangeError } from '../src/app/features/tica/tica-format.ts';

test('today follows Brussels across midnight and seasonal offsets', () => {
  assert.equal(ticaToday(new Date('2026-07-01T22:30:00Z')), '2026-07-02');
  assert.equal(ticaToday(new Date('2026-12-01T22:30:00Z')), '2026-12-01');
  assert.equal(ticaToday(new Date('2026-12-01T23:30:00Z')), '2026-12-02');
});

test('the seven-day preset includes today and stays seven calendar days at DST changes', () => {
  assert.deepEqual(ticaPreset('week', '2026-03-30'), { from: '2026-03-24', to: '2026-03-30' });
  assert.deepEqual(ticaPreset('week', '2026-10-26'), { from: '2026-10-20', to: '2026-10-26' });
  assert.deepEqual(ticaPreset('month', '2026-10-19'), { from: '2026-10-01', to: '2026-10-19' });
});

test('invalid calendar days, reversed periods and oversized reports cannot be requested', () => {
  assert.ok(ticaRangeError('2026-02-30', '2026-03-01'));
  assert.ok(ticaRangeError('2026-10-19', '2026-10-18'));
  assert.ok(ticaRangeError('', '2026-10-19'));
  assert.equal(ticaRangeError('2024-01-01', '2024-12-31'), null);
  assert.ok(ticaRangeError('2024-01-01', '2025-01-01'));
});

test('portal wall-clock sales keep their Brussels time, while instants are converted', () => {
  assert.equal(ticaMoment('2026-10-19T14:23:45.123'), '19-10-2026 · 14:23');
  assert.match(ticaMoment('2026-10-19T12:23:45Z'), /14:23/);
  assert.match(ticaMoment('2026-12-19T12:23:45Z'), /13:23/);
  assert.equal(ticaMoment('broken'), 'Onbekend tijdstip');
});
