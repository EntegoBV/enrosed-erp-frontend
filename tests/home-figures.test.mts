import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ageText, bars, briefing, countryWithFlag, deltaPct, deltaText, firstName, fromToLong, greeting, latestOwnQuote, longDate, monthBars,
  monthWindows, nextContainerEvents, overline, weekNumber,
} from '../src/app/features/dashboard/home-figures.ts';
import type { BriefingPart } from '../src/app/features/dashboard/home-figures.ts';
import { isoWeek } from '../src/app/features/dashboard/agenda-days.ts';

const text = (parts: BriefingPart[]): string => parts.map((part) => part.text).join('');
const strong = (parts: BriefingPart[]): string[] => parts.filter((part) => part.strong).map((part) => part.text);

test('the month windows follow the day: this month, this year, the same days of last month, six bar months', () => {
  assert.deepEqual(monthWindows('2026-10-15'), {
    today: '2026-10-15', monthStart: '2026-10-01', yearStart: '2026-01-01', monthName: 'oktober',
    prevFrom: '2026-09-01', prevTo: '2026-09-15', prevLabel: '1–15 sep', sixMonthStart: '2026-05-01',
  });
  /* Clamped to the end of a shorter month; across the turn of the year. */
  const march = monthWindows('2027-03-31');
  assert.equal(march.prevTo, '2027-02-28');
  assert.equal(march.prevLabel, '1–28 feb');
  assert.equal(march.sixMonthStart, '2026-10-01');
  const january = monthWindows('2027-01-01');
  assert.equal(january.prevFrom, '2026-12-01');
  assert.equal(january.prevTo, '2026-12-01');
  assert.equal(january.prevLabel, '1 dec');
  assert.equal(january.yearStart, '2027-01-01');
  assert.equal(january.monthName, 'januari');
  assert.equal(monthWindows('2028-03-30').prevTo, '2028-02-29');
});

test('the change against last month: whole percent, nothing to compare with is —', () => {
  assert.equal(deltaPct(14380, 12726), 13);
  assert.equal(deltaPct(900, 1000), -10);
  assert.equal(deltaPct(500, 0), null);
  assert.equal(deltaPct(0, 0), null);
  assert.equal(deltaPct(-50, -100), 50);
  assert.equal(deltaText(13), '▲ 13%');
  assert.equal(deltaText(-4), '▼ 4%');
  assert.equal(deltaText(0), '= 0%');
  assert.equal(deltaText(null), '—');
});

test('bars scale to the largest value, a negative one is flat, the running month is marked', () => {
  const result = bars([{ key: 'a', label: 'a', value: 50 }, { key: 'b', label: 'b', value: 200 }, { key: 'c', label: 'c', value: -20 }], 'b');
  assert.deepEqual(result.map((bar) => [bar.pct, bar.current]), [[25, false], [100, true], [0, false]]);
  assert.deepEqual(bars([{ key: 'a', label: 'a', value: 0 }]).map((bar) => bar.pct), [0]);
  const months = monthBars([{ month: '2026-05', invoicedEur: 18000 }, { month: '2026-10', invoicedEur: 14000 }], '2026-10-15');
  assert.deepEqual(months.map((bar) => [bar.label, bar.current]), [['mei', false], ['okt', true]]);
});

test('next container events: expected arrivals of open orders only, nearest first, at most n, progress from the sailing day', () => {
  const orders = [
    { orderId: 47, label: 'container/2026/047', supplier: 'Yunnan Pubei', status: 'ONDERWEG', orderDate: '2026-08-01', shippedOn: '2026-09-22' },
    { orderId: 43, label: 'PO-2026-043', supplier: 'Kunming Rose', status: 'BESTELD', orderDate: '2026-09-15', shippedOn: null },
    { orderId: 51, label: 'PO-2026-051', supplier: 'Yunnan Pubei', status: 'BESTELD', orderDate: '2026-10-01', shippedOn: null },
    { orderId: 14, label: 'PO-2026-014', supplier: 'Kunming Rose', status: 'ONDERWEG', orderDate: '2026-07-01', shippedOn: '2026-08-20' },
  ];
  const milestones = [
    { kind: 'SHIPPED', date: '2026-09-22', orderId: 47 },
    { kind: 'EXPECTED_ARRIVAL', date: '2026-10-22', orderId: 47 },
    { kind: 'EXPECTED_ARRIVAL', date: '2026-11-30', orderId: 43 },
    { kind: 'EXPECTED_ARRIVAL', date: '2026-12-10', orderId: 51 },
    { kind: 'EXPECTED_ARRIVAL', date: '2026-10-13', orderId: 14 },
    { kind: 'RECEIVED', date: '2026-10-01', orderId: 99 },
  ];
  const events = nextContainerEvents(milestones, orders, '2026-10-15', 3);
  assert.deepEqual(events.map((event) => [event.label, event.text, event.late]), [
    ['PO-2026-014', 'aankomst verwacht di 13 okt', true],
    ['container/2026/047', 'aankomst do 22 okt', false],
    ['PO-2026-043', 'aankomst ma 30 nov', false],
  ]);
  /* 23 of 30 days since sailing on 22 Sep; a late arrival reads full. */
  assert.equal(events[1].progressPct, 77);
  assert.equal(events[0].progressPct, 100);
  assert.equal(events[2].supplier, 'Kunming Rose');
  assert.equal(nextContainerEvents(milestones, orders, '2026-10-15', 10).length, 4);
  assert.deepEqual(nextContainerEvents([], orders, '2026-10-15'), []);
});

test('the briefing sentence and its variants', () => {
  const events = [{ atTime: '10:00' }, { atTime: '14:30:00' }];
  const tight = { from: '2026-11-03', to: '2026-11-11' };
  const full = briefing({ settled: true, agenda: 'ok', count: 7, complete: true, events, nowTime: '08:40', tight });
  assert.equal(text(full), '7 dingen te doen en 2 afspraken vandaag. Eerste afspraak om 10:00. De bank wordt krap van 3 tot 11 november.');
  assert.deepEqual(strong(full), ['7 dingen', '2 afspraken', '10:00', '3 tot 11 november']);
  assert.deepEqual(full.filter((part) => part.krap).map((part) => part.text), ['3 tot 11 november']);
  assert.equal(text(briefing({ settled: true, agenda: 'ok', count: 1, complete: true, events: [{ atTime: null }], nowTime: '11:00', tight: null })),
    '1 ding te doen en 1 afspraak vandaag.');
  assert.equal(text(briefing({ settled: true, agenda: 'ok', count: 3, complete: true, events, nowTime: '12:00', tight: null })),
    '3 dingen te doen en 2 afspraken vandaag. Volgende afspraak om 14:30.');
  assert.equal(text(briefing({ settled: true, agenda: 'ok', count: 3, complete: true, events, nowTime: '16:00', tight: null })), '3 dingen te doen en 2 afspraken vandaag.');
  assert.equal(text(briefing({ settled: true, agenda: 'ok', count: 2, complete: true, events: [], nowTime: '08:00', tight: null })), '2 dingen te doen. Geen afspraken vandaag.');
  assert.equal(text(briefing({ settled: true, agenda: 'ok', count: 0, complete: true, events: [], nowTime: '08:00', tight: null })), 'Niets dringends en geen afspraken vandaag.');
  assert.equal(text(briefing({ settled: true, agenda: 'ok', count: 0, complete: true, events, nowTime: '08:00', tight: null })),
    'Niets dringends vandaag, wel 2 afspraken. Eerste afspraak om 10:00.');
  assert.equal(text(briefing({ settled: false, agenda: 'ok', count: 4, complete: false, events: [], nowTime: '08:00', tight })),
    'Nog niet alles geladen. Geen afspraken vandaag. De bank wordt krap van 3 tot 11 november.');
  assert.equal(fromToLong('2026-10-28', '2026-11-03'), '28 oktober tot 3 november');
});

test('the briefing never claims no appointments when the agenda did not load, and keeps the count once all answered', () => {
  const events = [{ atTime: '10:00' }];
  const tight = { from: '2026-11-03', to: '2026-11-11' };
  /* The planner failed (its items are []): no "Geen afspraken vandaag", no first appointment. */
  assert.equal(text(briefing({ count: 4, complete: false, settled: false, agenda: 'failed', events: [], nowTime: '08:00', tight: null })),
    'Nog niet alles geladen. Agenda niet bijgewerkt.');
  assert.equal(text(briefing({ count: 4, complete: false, settled: false, agenda: 'loading', events: [], nowTime: '08:00', tight: null })),
    'Nog niet alles geladen.');
  assert.equal(text(briefing({ count: 4, complete: false, settled: false, agenda: 'ok', events, nowTime: '08:00', tight: null })),
    'Nog niet alles geladen. 1 afspraak vandaag. Eerste afspraak om 10:00.');
  /* Settled with a failure: the count stays, with what could not load. */
  const failed = briefing({ count: 5, complete: false, settled: true, agenda: 'failed', events: [], nowTime: '08:00', tight });
  assert.equal(text(failed), '5 dingen te doen; niet alles kon laden. Agenda niet bijgewerkt. De bank wordt krap van 3 tot 11 november.');
  assert.deepEqual(strong(failed), ['5 dingen', '3 tot 11 november']);
  assert.equal(text(briefing({ count: 5, complete: false, settled: true, agenda: 'ok', events, nowTime: '08:00', tight: null })),
    '5 dingen te doen; niet alles kon laden. 1 afspraak vandaag. Eerste afspraak om 10:00.');
  assert.equal(text(briefing({ count: 0, complete: false, settled: true, agenda: 'ok', events: [], nowTime: '08:00', tight: null })),
    'Niet alles kon laden. Geen afspraken vandaag.');
});

test('greeting by the hour, the long date, the week number and the overline', () => {
  assert.deepEqual([5, 6, 11, 12, 17, 18, 23].map(greeting),
    ['Dagoverzicht', 'Goedemorgen', 'Goedemorgen', 'Goedemiddag', 'Goedemiddag', 'Goedenavond', 'Goedenavond']);
  assert.equal(longDate('2026-10-15'), 'donderdag 15 oktober');
  assert.equal(weekNumber('2026-10-15'), 42);
  for (const day of ['2026-01-01', '2026-12-31', '2027-01-03', '2027-01-04', '2020-12-31', '2021-01-03', '2026-10-25']) {
    assert.equal(weekNumber(day), isoWeek(day), day);
  }
  assert.equal(overline('2026-10-15'), 'donderdag 15 oktober · week 42');
  assert.equal(firstName('Mock Medewerker'), 'Mock');
  assert.equal(firstName('  '), null);
  assert.equal(firstName(null), null);
  assert.deepEqual([0, 1, 3, null].map(ageText), ['vandaag', 'gisteren', '3 d geleden', null]);
});

test('Markt reads our own forwarder quotes only, never an index in points', () => {
  const rates = [
    { route: 'NCFI NGB-EUR', quotedOn: '2026-10-14', usdPerContainer: 1450 },
    { route: 'WCI SHA-RTM', quotedOn: '2026-10-09', usdPerContainer: 2600 },
    { route: 'NINGBO', quotedOn: '2026-09-20', usdPerContainer: 2300 },
    { route: 'GUANGZHOU', quotedOn: '2026-10-02', usdPerContainer: 2150 },
  ];
  assert.deepEqual(latestOwnQuote(rates), { route: 'GUANGZHOU', short: 'Nansha → Rotterdam', origin: 'Nansha', usd: 2150, quotedOn: '2026-10-02' });
  assert.equal(latestOwnQuote(rates.slice(0, 2)), null);
  assert.equal(latestOwnQuote([]), null);
});

test('the top country carries its flag and its Dutch name', () => {
  assert.equal(countryWithFlag('BE'), '🇧🇪 België');
  assert.equal(countryWithFlag(null), null);
});
