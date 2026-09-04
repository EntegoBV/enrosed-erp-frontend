import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calendarBaselineIndex,
  changeOverMonths,
  crossOf,
  freightNarrative,
  fxInsight,
  invert,
  lastStep,
  monthsBefore,
  sparseHorizons,
  summarize,
  weeklyRows,
  windowOf,
} from '../src/app/features/analyses/market-math.ts';

/** Working days (Mon–Fri) ending on `last`, oldest first. */
function workingDays(last: string, count: number): string[] {
  const days: string[] = [];
  const cursor = new Date(`${last}T00:00:00Z`);
  while (days.length < count) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.unshift(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return days;
}

test('monthsBefore clamps month ends instead of overflowing', () => {
  assert.equal(new Date(monthsBefore('2026-08-31', 6)).toISOString().slice(0, 10), '2026-02-28');
  assert.equal(new Date(monthsBefore('2026-03-31', 1)).toISOString().slice(0, 10), '2026-02-28');
  assert.equal(new Date(monthsBefore('2026-09-04', 12)).toISOString().slice(0, 10), '2025-09-04');
});

test('calendar baseline takes the last ECB day on or before the target', () => {
  const dates = workingDays('2026-09-04', 260);
  const index = calendarBaselineIndex(dates, 1);
  assert.ok(index !== null);
  /* 4 August 2026 is a Tuesday: a published day, so it is the baseline itself. */
  assert.equal(dates[index!], '2026-08-04');
  const three = calendarBaselineIndex(dates, 3);
  assert.equal(dates[three!], '2026-06-04');
});

test('calendar baseline refuses a sparse series that cannot honestly cover the period', () => {
  const dates = workingDays('2026-09-04', 10);
  assert.equal(calendarBaselineIndex(dates, 1), null);
  const holey = ['2026-06-01', '2026-08-20', '2026-09-04'];
  assert.equal(calendarBaselineIndex(holey, 1), null, 'twenty days older than the target is not a month');
  assert.equal(calendarBaselineIndex(holey, 3), 0, 'three days older than the target is fine');
});

test('changeOverMonths and windowOf share the same baseline', () => {
  const dates = workingDays('2026-09-04', 260);
  const values = dates.map((_, index) => 1 + index * 0.001);
  const change = changeOverMonths({ dates, values }, 1);
  assert.ok(change);
  const window = windowOf({ dates, values }, 1);
  assert.equal(window.dates[0], dates[change!.baselineIndex]);
  assert.equal(window.dates.at(-1), '2026-09-04');
  const expected = ((values.at(-1)! - values[change!.baselineIndex]) / values[change!.baselineIndex]) * 100;
  assert.ok(Math.abs(change!.pct - expected) < 1e-9);
});

test('windowOf falls back to the first observation inside the period', () => {
  const series = { dates: ['2026-06-01', '2026-08-20', '2026-09-04'], values: [1, 2, 3] };
  const window = windowOf(series, 1);
  assert.deepEqual(window.dates, ['2026-08-20', '2026-09-04']);
  assert.deepEqual(windowOf({ dates: [], values: [] }, 3), { dates: [], values: [] });
});

test('invert and cross read the pair the other way round', () => {
  assert.deepEqual(invert([2, 4, 0]), [0.5, 0.25, Number.NaN]);
  const cross = crossOf([8, 7.5], [1.1, 1.2]);
  assert.ok(Math.abs(cross[0] - 8 / 1.1) < 1e-12);
  assert.ok(Math.abs(cross[1] - 7.5 / 1.2) < 1e-12);
});

test('summarize finds the extremes with their dates', () => {
  const summary = summarize({ dates: ['2026-01-05', '2026-01-06', '2026-01-07'], values: [1.1, 1.3, 1.2] });
  assert.equal(summary?.max, 1.3);
  assert.equal(summary?.maxOn, '2026-01-06');
  assert.equal(summary?.min, 1.1);
  assert.equal(summary?.minOn, '2026-01-05');
  assert.ok(Math.abs((summary?.mean ?? 0) - 1.2) < 1e-12);
  assert.equal(summarize({ dates: [], values: [] }), null);
});

test('weeklyRows keeps the last day of every week', () => {
  const dates = workingDays('2026-09-04', 12);
  const rows = weeklyRows({ dates, values: dates.map((_, index) => index) });
  assert.deepEqual(rows.map((row) => row.date), ['2026-08-21', '2026-08-28', '2026-09-04']);
  assert.equal(rows.at(-1)?.value, 11);
});

test('sparse horizons only accept an observation close enough to the target', () => {
  const entries = {
    dates: ['2025-09-05', '2026-03-06', '2026-06-05', '2026-08-07', '2026-08-28', '2026-09-04'],
    values: [3000, 3600, 4200, 4000, 4100, 4092],
  };
  const horizons = sparseHorizons(entries);
  assert.equal(horizons[0].label, '1 mnd');
  assert.equal(horizons[0].comparedOn, '2026-08-07', '28 days back sits inside the eight-day window');
  assert.ok(Math.abs(horizons[0].pct! - 2.3) < 0.01);
  assert.equal(horizons[1].comparedOn, '2026-06-05');
  assert.equal(horizons[2].comparedOn, '2026-03-06');
  assert.equal(horizons[3].comparedOn, '2025-09-05');
  assert.equal(horizons[3].actualDays, 364);
  const thin = sparseHorizons({ dates: ['2026-08-28', '2026-09-04'], values: [4100, 4092] });
  assert.deepEqual(thin.map((horizon) => horizon.pct), [null, null, null, null]);
});

test('lastStep reports the change and distance to the previous entry', () => {
  const step = lastStep({ dates: ['2026-08-28', '2026-09-04'], values: [4000, 4100] });
  assert.equal(step?.days, 7);
  assert.ok(Math.abs(step!.pct - 2.5) < 1e-9);
  assert.equal(lastStep({ dates: ['2026-09-04'], values: [1] }), null);
});

test('freight narrative names the direction and the longest fair comparison', () => {
  const entries = {
    dates: ['2026-03-06', '2026-06-05', '2026-08-07', '2026-08-14', '2026-08-21', '2026-09-04'],
    values: [3600, 4200, 4000, 4050, 4100, 4300],
  };
  const lines = freightNarrative(entries, 'usd');
  assert.match(lines[0], /omhoog/);
  assert.match(lines[0], /7 aug/);
  assert.match(lines[1], /duurder/);
  assert.match(lines.at(-1)!, /6 mnd/);
  assert.deepEqual(freightNarrative({ dates: [], values: [] }, 'usd').length, 1);
  assert.match(freightNarrative({ dates: ['2026-09-04'], values: [1] }, 'points')[0], /Eerste notering/);
});

test('fx insight averages dollar and yuan and reads the verdict from the selected period', () => {
  /* Fifty-five weeks: the twelve-month baseline needs a published day on or before it. */
  const dates = workingDays('2026-09-04', 275);
  /* Euro strengthened 5% against the dollar and 3% against the yuan over the year. */
  const usd = dates.map((_, index) => 1.10 * (1 + 0.05 * index / (dates.length - 1)));
  const cny = dates.map((_, index) => 7.80 * (1 + 0.03 * index / (dates.length - 1)));
  const insight = fxInsight({ dates, usd, cny }, 12);
  assert.ok(insight);
  assert.equal(insight!.verdict, 'Sterker dan toen');
  assert.equal(insight!.tone, 'ok');
  assert.match(insight!.lead, /sterker/);
  assert.ok(insight!.lines.some((line) => line.includes('Per $10.000')));
  const twelve = insight!.horizons.find((horizon) => horizon.months === 12)!;
  assert.ok(twelve.pct! > 3 && twelve.pct! < 5, `mean of the two currencies, got ${twelve.pct}`);
  const short = fxInsight({ dates: dates.slice(-5), usd: usd.slice(-5), cny: cny.slice(-5) }, 1);
  assert.equal(short?.verdict, 'Onvoldoende historiek');
});
