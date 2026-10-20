import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { settlementPeriod, ticaFreshness, ticaHomeSummary } from '../src/app/features/dashboard/home-tica-summary.ts';
import type { TicaAnalyticsDay, TicaSettlement, TicaStatus } from '../src/app/core/api/tica-api.ts';

const day = (date: string, revenueExcl: number, transactionCount: number, quantity: number): TicaAnalyticsDay =>
  ({ date, revenueExcl, transactionCount, quantity, goodsCostEur: 0, missingCostLines: 0 });
const settlement = (id: number, documentDate: string, status: TicaSettlement['status'], periodFrom: string, periodTo: string, netReceivable: number) =>
  ({ id, documentDate, status, periodFrom, periodTo, netReceivable } as TicaSettlement);
const status = (patch: Partial<TicaStatus>): TicaStatus => ({
  enabled: true, credentialsReady: true, syncState: 'READY', lastAttemptAt: null, lastSuccessAt: null, lastRangeFrom: null, lastRangeTo: null,
  lastError: null, importedLineCount: 0, unmatchedLineCount: 0, pushSubscriptions: 0, lastNotificationStatus: null, lastNotificationAt: null, ...patch,
});

const DAYS = [
  day('2026-09-30', 500, 9, 20),
  day('2026-10-13', 99, 2, 3),
  day('2026-10-14', 230, 3, 8),
  day('2026-10-16', 410.5, 6, 14),
  day('2026-10-20', 412.25, 6, 14),
];

test('today, the seven days (gaps as 0, today last) and their totals', () => {
  const s = ticaHomeSummary(DAYS, [], '2026-10-20');
  assert.deepEqual(s.today, { date: '2026-10-20', revenueExcl: 412.25, transactions: 6, quantity: 14 });
  assert.deepEqual(s.week.map((row) => row.date), ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20']);
  assert.deepEqual(s.week.map((row) => row.revenueExcl), [230, 0, 410.5, 0, 0, 0, 412.25]);
  assert.deepEqual(s.weekTotal, { revenueExcl: 1052.75, transactions: 15, quantity: 36 });
});

test('the month runs from the 1st to today, never the previous month or later days', () => {
  const s = ticaHomeSummary([...DAYS, day('2026-10-21', 1000, 1, 1)], [], '2026-10-20');
  assert.deepEqual(s.month, { revenueExcl: 1151.75, transactions: 17, quantity: 39 });
});

test('the seven days cross a month and a year boundary', () => {
  const s = ticaHomeSummary([day('2025-12-28', 10, 1, 1), day('2026-01-02', 20, 1, 2)], [], '2026-01-02');
  assert.equal(s.week[0].date, '2025-12-27');
  assert.equal(s.weekTotal.revenueExcl, 30);
  assert.deepEqual(s.month, { revenueExcl: 20, transactions: 1, quantity: 2 });
});

test('the price per piece is today\'s, else the seven days\', else none', () => {
  assert.deepEqual(ticaHomeSummary(DAYS, [], '2026-10-20').perPiece, { eur: 29.45, basis: 'vandaag' });
  assert.deepEqual(ticaHomeSummary(DAYS, [], '2026-10-19').perPiece, { eur: 29.58, basis: '7 dagen' });
  assert.equal(ticaHomeSummary(DAYS, [], '2026-10-29').perPiece, null);
  assert.equal(ticaHomeSummary([], [], '2026-10-20').perPiece, null);
});

test('a day without sales reads 0, and duplicate days add up', () => {
  const s = ticaHomeSummary([day('2026-10-20', 10, 1, 1), day('2026-10-20', 5.1, 1, 2)], [], '2026-10-20');
  assert.deepEqual(s.today, { date: '2026-10-20', revenueExcl: 15.1, transactions: 2, quantity: 3 });
  assert.deepEqual(ticaHomeSummary([], [], '2026-10-20').today, { date: '2026-10-20', revenueExcl: 0, transactions: 0, quantity: 0 });
});

test('the latest settlement by document date (then id), with its status in words', () => {
  const rows = [
    settlement(1, '2026-09-03', 'PAID', '2026-08-01', '2026-08-31', 980),
    settlement(3, '2026-10-02', 'OPEN', '2026-09-01', '2026-09-30', 1240.4),
    settlement(2, '2026-10-02', 'PAID', '2026-09-01', '2026-09-15', 600),
  ];
  assert.deepEqual(ticaHomeSummary(DAYS, rows, '2026-10-20').settlement, { netReceivable: 1240.4, status: 'open', period: 'september' });
  assert.equal(ticaHomeSummary(DAYS, [settlement(4, '2026-10-19', 'DRAFT', '2026-10-01', '2026-10-15', 300)], '2026-10-20').settlement?.status, 'concept');
  assert.equal(ticaHomeSummary(DAYS, [], '2026-10-20').settlement, null);
});

test('settlement periods: a whole month, part of one, across two', () => {
  assert.equal(settlementPeriod('2026-02-01', '2026-02-28'), 'februari');
  assert.equal(settlementPeriod('2026-09-01', '2026-09-15'), '1–15 sep');
  assert.equal(settlementPeriod('2026-09-28', '2026-10-04'), '28 sep – 4 okt');
});

test('freshness: today\'s import time in Brussels, another day as a date, a warning when fetching fails or is off', () => {
  const now = new Date('2026-10-20T12:30:00Z');
  assert.deepEqual(ticaFreshness(status({ lastSuccessAt: '2026-10-20T12:05:00Z' }), now), { sub: 'bijgewerkt 14:05', warning: null });
  assert.deepEqual(ticaFreshness(status({ lastSuccessAt: '2026-10-19T21:45:00Z' }), now), { sub: 'bijgewerkt 19 okt', warning: null });
  /* 23:30 UTC on the 19th is already the 20th in Brussels. */
  assert.deepEqual(ticaFreshness(status({ lastSuccessAt: '2026-10-19T22:30:00Z' }), now), { sub: 'bijgewerkt 00:30', warning: null });
  assert.deepEqual(ticaFreshness(status({ syncState: 'NEVER_SYNCED' }), now), { sub: 'nog niet opgehaald', warning: null });
  assert.deepEqual(ticaFreshness(status({ syncState: 'ERROR', lastSuccessAt: '2026-10-20T08:00:00Z' }), now), { sub: null, warning: 'Ophalen mislukt' });
  assert.deepEqual(ticaFreshness(status({ syncState: 'DISABLED' }), now), { sub: null, warning: 'Ophalen staat uit' });
  assert.deepEqual(ticaFreshness(null, now), { sub: null, warning: null });
});

test('the card sits first in the desk\'s Meer cijfers and under Verkoop on the phone, on its own row', async () => {
  const read = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
  assert.match(await read('app/features/dashboard/home-desk.ts'), /<div class="home-desk__more">\n\s*<app-home-tica variant="desk" \/>/);
  assert.match(await read('app/features/dashboard/home-phone.ts'), /<app-home-verkoop variant="phone" \/>\n\s*<app-home-tica variant="phone" \/>/);
  assert.match(await read('styles/home-desk.scss'), /\.home-desk__more \.home-w--tica \{ grid-column: 1 \/ -1; \}/);
  assert.match(await read('app/features/dashboard/widgets/home-tica.ts'), /link="\/tica" \[wide\]="true"/);
});
