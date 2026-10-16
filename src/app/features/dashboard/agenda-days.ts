/*
 * Calendar day math for the agenda: month grids, week numbers and day
 * steps, all on 'YYYY-MM-DD' strings. Every date is built with Date.UTC and
 * read back with the UTC getters, so a day is always one day: the October
 * fall-back hour can no longer shift a grid cell (24-hour steps from a local
 * midnight did, which showed 25 October twice).
 *
 * Pure and node-tested: no imports at all.
 */

export type IsoDay = string;   // 'YYYY-MM-DD'
export type IsoMonth = string; // 'YYYY-MM'

export interface MonthCell {
  key: IsoDay;
  date: IsoDay;
  /** The day of the month, as shown in the cell. */
  label: number;
  inMonth: boolean;
}

const DAY_MS = 86_400_000;

function utcOf(iso: string): Date {
  return new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) || 1));
}

function isoOfUtc(date: Date): IsoDay {
  return isoOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** A day from its parts; out-of-range parts roll over (isoOf(2026, 13, 1) is 2027-01-01). */
export function isoOf(year: number, month1: number, day: number): IsoDay {
  const date = new Date(Date.UTC(year, month1 - 1, day));
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysIso(iso: IsoDay, days: number): IsoDay {
  return isoOfUtc(new Date(utcOf(iso).getTime() + days * DAY_MS));
}

/** Monday 0 … Sunday 6. */
export function weekdayMon0(iso: IsoDay): number {
  return (utcOf(iso).getUTCDay() + 6) % 7;
}

/** ISO 8601 week number: the week with the year's first Thursday is week 1. */
export function isoWeek(iso: IsoDay): number {
  const thursday = addDaysIso(iso, 3 - weekdayMon0(iso));
  const newYear = isoOf(Number(thursday.slice(0, 4)), 1, 1);
  return 1 + Math.floor((utcOf(thursday).getTime() - utcOf(newYear).getTime()) / (7 * DAY_MS));
}

export function firstOfMonth(iso: IsoDay | IsoMonth): IsoDay {
  return `${iso.slice(0, 7)}-01`;
}

/** 'YYYY-MM' (a full day works too) moved by whole months: shiftMonthIso('2026-12', 1) is '2027-01'. */
export function shiftMonthIso(month: IsoMonth | IsoDay, step: number): IsoMonth {
  return isoOf(Number(month.slice(0, 4)), Number(month.slice(5, 7)) + step, 1).slice(0, 7);
}

/** The number of days in a month (month1 is 1-12). */
export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/**
 * The cells of a Monday-first month grid: the days of the month plus the
 * leading and trailing days of the weeks around it. Six rows always gives 42
 * cells (a stable height); 'fit' stops after the week holding the last day.
 */
export function monthCells(year: number, month1: number, rows: 6 | 'fit' = 6): MonthCell[] {
  const first = isoOf(year, month1, 1);
  const start = addDaysIso(first, -weekdayMon0(first));
  const lead = weekdayMon0(first);
  const count = rows === 6 ? 42 : Math.ceil((lead + daysInMonth(year, month1)) / 7) * 7;
  const prefix = first.slice(0, 7);
  return Array.from({ length: count }, (_, index) => {
    const date = addDaysIso(start, index);
    return { key: date, date, label: Number(date.slice(8, 10)), inMonth: date.startsWith(prefix) };
  });
}
