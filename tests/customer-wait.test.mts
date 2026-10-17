import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  CUSTOMER_WAIT_NU_WORKDAYS, brusselsDay, customerCount, localDay, oldestFirst, waitLabel, waitingSummary, whenLabel, workdaysBetween,
} from '../src/app/shared/customer-wait.ts';
import * as home from '../src/app/features/dashboard/home-priority.ts';

/*
 * The bell's wait pills and the home's "Klanten wachten" say the same thing (redesign home §4 #6, critique N14):
 * customer-wait.ts is the bell's small module, home-priority.ts keeps its own copy (no runtime imports in a
 * node-tested module); this test keeps them equal.
 */

test('the bell and the home read the same wait for every hour of two weeks', () => {
  assert.equal(CUSTOMER_WAIT_NU_WORKDAYS, home.CUSTOMER_WAIT_NU_WORKDAYS);
  const at = '2026-10-09T13:20:00Z';   // Friday 15:20 Brussels
  for (let hour = 0; hour < 24 * 14; hour += 1) {
    const now = Date.parse(at) + hour * 3_600_000;
    const today = brusselsDay(now);
    assert.deepEqual(waitLabel(at, now, today), home.waitLabel(at, now, today), `${hour} h`);
  }
  assert.equal(workdaysBetween('2026-10-09', '2026-10-19'), home.workdaysBetween('2026-10-09', '2026-10-19'));
  assert.equal(waitLabel(null, Date.now(), '2026-10-16'), null);
});

test('wait labels: "< 1 u", "17 u", Friday to Monday 1 werkdag, 27 werkdagen in red', () => {
  assert.deepEqual(waitLabel('2026-10-15T07:00:00Z', Date.parse('2026-10-15T07:30:00Z'), '2026-10-15'), { label: '< 1 u', nu: false });
  assert.deepEqual(waitLabel('2026-10-15T07:00:00Z', Date.parse('2026-10-16T00:10:00Z'), '2026-10-16'), { label: '17 u', nu: false });
  assert.deepEqual(waitLabel('2026-10-16T14:00:00Z', Date.parse('2026-10-19T08:00:00Z'), '2026-10-19'), { label: '1 werkdag', nu: false });
  assert.deepEqual(waitLabel('2026-09-09T08:00:00Z', Date.parse('2026-10-16T21:43:00Z'), '2026-10-16'), { label: '27 werkdagen', nu: true });
});

test('when the customer\'s news came in: vandaag with the time, gisteren, else the day', () => {
  const now = Date.parse('2026-10-16T21:43:00Z');   // Friday 23:43 Brussels
  assert.equal(whenLabel('2026-10-16T12:02:00Z', now), 'vandaag 14:02');
  assert.equal(whenLabel('2026-10-15T09:00:00Z', now), 'gisteren');
  assert.equal(whenLabel('2026-10-13T09:00:00Z', now), 'di 13 okt');
  /* Brussels days: 23:30 UTC on the 15th is already the 16th there. */
  assert.equal(whenLabel('2026-10-15T23:30:00Z', now), 'vandaag 01:30');
  assert.equal(whenLabel(null, now), null);
  assert.equal(brusselsDay('2026-10-15T23:30:00Z'), '2026-10-16');
  assert.match(localDay(Date.now()), /^\d{4}-\d{2}-\d{2}$/);
});

test('oldest first, items without an instant last in their own order', () => {
  const rows = [{ at: '2026-10-15T08:00:00Z', id: 1 }, { at: null, id: 2 }, { at: '2026-10-12T08:00:00Z', id: 3 }, { at: null, id: 4 }, { at: 'x', id: 5 }];
  assert.deepEqual(oldestFirst(rows).map((row) => row.id), [3, 1, 2, 4, 5]);
});

test('the bell keeps its button and badge; the sheet has no foot, a summary with Vernieuwen and one button per row', async () => {
  const bell = await readFile(new URL('../src/app/shared/notification-bell.ts', import.meta.url), 'utf8');
  assert.match(bell, /<button class="bell" type="button" \(click\)="open\(\)"/);
  assert.doesNotMatch(bell, /<div foot|Sluiten/);
  assert.match(bell, /\[variant\]="desk\(\) \? 'default' : 'ios'"/);
  assert.match(bell, /@if \(summary\(\); as line\) \{<b>\{\{ line\.lead \}\}<\/b>\{\{ line\.rest \}\}\} @else \{Niemand wacht op ons\}/);
  assert.match(bell, /waitingSummary\(this\.actions\(\), this\.oldest\(\)\)/);
  assert.match(bell, /'Melding wegklikken: ' \+ nameOf\(item\)/);
  assert.match(bell, /Geen klanten die op ons wachten\./);
  /* The ✕ is a sibling of the row's button, never inside it. */
  assert.match(bell, /<\/button>\s*<button class="bell-row__x"/);
  assert.doesNotMatch(bell, /import .*home-priority/);
  /* The phone shows the customer's message on two lines (fix round 1); the desk keeps one with its title. */
  assert.match(bell, /\.bell--ios \.bell-row__detail \{ display: -webkit-box; white-space: normal;[^}]*-webkit-line-clamp: 2; \}/);
  assert.match(bell, /\[title\]="detail"/);
});

test('the bell\'s summary counts the items and names how many customers they come from', () => {
  const item = (customer: string | null, orderId: number | null) => ({ customer, orderId });
  /* The desk shot: 6 rows from 4 customers. */
  const six = [item('Fleur & Co', 1), item('Bloemenhuis Lier', 2), item('Bloemenhuis Lier', 3), item('Fleurs de Lille', 4), item(' fleurs de lille ', 4),
    item('Bloemen Maes', 5)];
  assert.equal(customerCount(six), 4);
  assert.deepEqual(waitingSummary(six, '3 werkdagen'), { lead: '6 meldingen', rest: ' van 4 klanten · de oudste 3 werkdagen' });
  /* One item per customer keeps the design's words. */
  assert.deepEqual(waitingSummary([item('A', 1), item('B', 2)], '17 u'), { lead: '2 klanten', rest: ' wachten op ons · de oudste 17 u' });
  assert.deepEqual(waitingSummary([item('A', 1)], '27 werkdagen'), { lead: '1 klant', rest: ' wacht op ons · 27 werkdagen' });
  assert.deepEqual(waitingSummary([item('A', 1), item('a', 2)], null), { lead: '2 meldingen', rest: ' van 1 klant' });
  assert.equal(waitingSummary([], '1 werkdag'), null);
  /* Without a name an item counts once per order, else on its own. */
  assert.equal(customerCount([item(null, 7), item('', 7), item(null, 8), item(null, null), item(null, null)]), 4);
  assert.deepEqual(waitingSummary([item(null, 7), item(null, 7), item('A', 1)], '2 werkdagen'), { lead: '3 meldingen', rest: ' van 2 klanten · de oudste 2 werkdagen' });
});
