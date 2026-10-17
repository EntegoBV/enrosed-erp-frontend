import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import {
  addDaysIso, firstOfMonth, isoOf, isoWeek, monthCells, shiftMonthIso, weekdayMon0,
} from '../src/app/features/dashboard/agenda-days.ts';

/* The DST cases must hold in the owner's time zone, whatever the machine runs in. */
function inBrussels(body: string): unknown {
  const moduleUrl = new URL('../src/app/features/dashboard/agenda-days.ts', import.meta.url).href;
  const script = `import * as days from ${JSON.stringify(moduleUrl)};
    console.log(JSON.stringify((() => { ${body} })()));`;
  const output = execFileSync(process.execPath,
    ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--experimental-strip-types', '--input-type=module', '-e', script],
    { encoding: 'utf8', env: { ...process.env, TZ: 'Europe/Brussels' } });
  return JSON.parse(output);
}

test('October 2026 has every day once across the fall-back weekend', () => {
  const result = inBrussels(`
    const cells = days.monthCells(2026, 10, 6);
    const fit = days.monthCells(2026, 10, 'fit');
    return {
      length: cells.length, unique: new Set(cells.map(c => c.key)).size,
      firstIndex: cells.findIndex(c => c.date === '2026-10-01'),
      twentyFifths: cells.filter(c => c.inMonth && c.label === 25).length,
      twentyFifthIndex: cells.findIndex(c => c.date === '2026-10-25'),
      sixthRow: cells[35].date, last: cells[41].date, fit: fit.length,
      inMonth: cells.filter(c => c.inMonth).length,
    };`) as Record<string, unknown>;
  assert.deepEqual(result, {
    length: 42, unique: 42, firstIndex: 3, twentyFifths: 1, twentyFifthIndex: 27,
    sixthRow: '2026-11-02', last: '2026-11-08', fit: 35, inMonth: 31,
  });
});

test('March 2027 starts on Monday and keeps the spring-forward Sunday once', () => {
  const result = inBrussels(`
    const fit = days.monthCells(2027, 3, 'fit');
    return {
      first: fit[0].date, firstInMonth: fit[0].inMonth, fit: fit.length,
      twentyEighths: fit.filter(c => c.date === '2027-03-28').length,
      unique: new Set(days.monthCells(2027, 3).map(c => c.key)).size,
      weekday: days.weekdayMon0('2027-03-28'),
    };`) as Record<string, unknown>;
  assert.deepEqual(result, { first: '2027-03-01', firstInMonth: true, fit: 35, twentyEighths: 1, unique: 42, weekday: 6 });
});

test('the grid keys are the dates and the labels are day numbers', () => {
  const cells = monthCells(2026, 10);
  assert.equal(cells[0].date, '2026-09-28');
  assert.equal(cells[0].inMonth, false);
  assert.equal(cells[3].label, 1);
  assert.equal(cells[3].key, cells[3].date);
  assert.equal(monthCells(2027, 2, 'fit').length, 28);
  assert.equal(monthCells(2026, 8, 'fit').length, 42);
});

test('ISO weeks, month shifts and day steps', () => {
  assert.equal(isoWeek('2026-10-15'), 42);
  assert.equal(isoWeek('2026-01-01'), 1);
  assert.equal(isoWeek('2027-01-01'), 53);
  assert.equal(isoWeek('2024-12-30'), 1);
  assert.equal(shiftMonthIso('2026-12', 1), '2027-01');
  assert.equal(shiftMonthIso('2026-01', -1), '2025-12');
  assert.equal(shiftMonthIso('2026-10-25', 2), '2026-12');
  assert.equal(firstOfMonth('2026-10-25'), '2026-10-01');
  assert.equal(addDaysIso('2026-10-24', 2), '2026-10-26');
  assert.equal(addDaysIso('2027-03-27', 2), '2027-03-29');
  assert.equal(addDaysIso('2026-03-01', -1), '2026-02-28');
  assert.equal(isoOf(2026, 13, 1), '2027-01-01');
  assert.equal(weekdayMon0('2026-10-15'), 3);
  const brussels = inBrussels(`return [days.addDaysIso('2026-10-24', 1), days.addDaysIso('2026-10-25', 1), days.isoWeek('2026-10-26')];`);
  assert.deepEqual(brussels, ['2026-10-25', '2026-10-26', 44]);
});

test('dayRuns: empty days merge into one row, busy days and today stand alone (desk 7 dagen below 1280)', async () => {
  const { dayRuns } = await import('../src/app/features/dashboard/agenda-days.ts');
  const week = (from: string, busy: string[]) => Array.from({ length: 7 }, (_, i) => {
    const date = new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    return { date, empty: !busy.includes(date) };
  });
  /* Fri 16 Oct (today, busy), Sat-Sun empty, Mon busy, Tue-Thu empty */
  const rows = dayRuns(week('2026-10-16', ['2026-10-16', '2026-10-19']), '2026-10-16');
  assert.deepEqual(rows.map((row) => row.kind === 'day' ? row.date : `${row.number} ${row.weekday} ${row.weekendOnly ? 'Vrij' : 'Niets gepland'}`), [
    '2026-10-16', '17–18 za–zo Vrij', '2026-10-19', '20–22 di–do Niets gepland',
  ]);
  /* Today stays its own row even when empty, and splits a run. */
  const quiet = dayRuns(week('2026-10-14', []), '2026-10-16');
  assert.deepEqual(quiet.map((row) => row.kind === 'day' ? row.date : `${row.number} ${row.weekday}`), ['14–15 wo–do', '2026-10-16', '17–20 za–di']);
  assert.equal((quiet[2] as { weekendOnly: boolean }).weekendOnly, false);
  /* Across a month. */
  const turn = dayRuns(week('2026-10-30', ['2026-10-30']), '2026-10-30');
  assert.deepEqual(turn.map((row) => row.kind === 'day' ? row.date : `${row.number} ${row.weekday}`), ['2026-10-30', '31 okt – 5 nov za–do']);
  /* A single empty day is a day row. */
  const single = dayRuns(week('2026-10-16', ['2026-10-16', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']), '2026-10-16');
  assert.deepEqual(single.map((row) => row.kind), ['day', 'day', 'day', 'day', 'day', 'day', 'day']);
});
