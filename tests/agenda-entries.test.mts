import assert from 'node:assert/strict';
import test from 'node:test';
import { PIN_MIN_EUR as FORECAST_PIN_MIN_EUR } from '../src/app/features/finance/cash-forecast.ts';
import type { PlannerMilestone } from '../src/app/features/dashboard/planner-cards.ts';
import { PIN_MIN_EUR, agendaModel, type AgendaInput, type PlannerItemLite } from '../src/app/features/dashboard/agenda-entries.ts';

const TODAY = '2026-10-15';
const item = (id: number, onDate: string | null, changes: Partial<PlannerItemLite> = {}): PlannerItemLite =>
  ({ id, kind: 'EVENT', title: `Item ${id}`, onDate, atTime: null, note: null, done: false, pinned: false, parentId: null, ...changes });
const stone = (orderId: number, kind: PlannerMilestone['kind'], date: string): PlannerMilestone =>
  ({ orderId, kind, date, icon: '📦', title: `Moederdag ${kind}`, sub: 'Yunnan Pubei' });
const input = (changes: Partial<AgendaInput> = {}): AgendaInput => ({
  today: TODAY, nowTime: '08:40', items: [], milestones: [], money: [], moneySource: 'prognose', vatDeadline: null, tight: null, ...changes,
});

test('Komend starts tomorrow and holds dated open tasks, never today', () => {
  const model = agendaModel(input({ items: [
    item(1, TODAY, { atTime: '10:00' }), item(2, '2026-10-16', { kind: 'TASK', title: 'Offerte opvolgen' }),
    item(3, '2026-10-20', { atTime: '09:30' }), item(4, '2026-10-17', { kind: 'TASK', done: true }),
    item(5, null, { kind: 'TASK' }), item(6, '2026-10-23', { kind: 'TASK' }), item(7, '2026-10-13', { kind: 'TASK' }),
  ] }));
  assert.deepEqual(model.komend().map((entry) => entry.key), ['taak:2', 'afspraak:3', 'taak:6']);
  assert.deepEqual(model.komend(undefined, 2).map((entry) => entry.key), ['taak:2', 'afspraak:3']);
  assert.deepEqual(model.komend('2026-10-17', 5, '2026-10-21').map((entry) => entry.key), ['afspraak:3']);
  assert.equal(model.openTaskCount, 4);
  assert.equal(model.byDay.get('2026-10-13')?.[0].late, true);
});

test('container history is muted and never marked; a future expected arrival is', () => {
  const model = agendaModel(input({ milestones: [
    stone(43, 'SHIPPED', '2026-10-05'), stone(47, 'EXPECTED_ARRIVAL', '2026-10-22'), stone(43, 'ORDERED', '2026-10-05'),
    stone(52, 'EXPECTED_ARRIVAL', '2026-10-12'),
  ] }));
  const shipped = model.byDay.get('2026-10-05')!;
  assert.equal(shipped.length, 2);
  assert.ok(shipped.every((entry) => entry.past && entry.type === 'container'));
  assert.deepEqual(model.markers('2026-10-05').types, []);
  assert.deepEqual(model.markers('2026-10-22').types, ['container']);
  assert.deepEqual(model.byDay.get('2026-10-22')![0].link, { path: ['/purchasing', 47] });
  const overdueArrival = model.byDay.get('2026-10-12')![0];
  assert.deepEqual([overdueArrival.past, overdueArrival.late, model.markers('2026-10-12').types], [false, true, []]);
});

test('money: a marker from € 5.000 on; every amount in the day list', () => {
  const link = { path: ['/sales', 9], query: {} };
  const model = agendaModel(input({ money: [
    { date: '2026-10-19', eur: 4999, title: 'Factuur F2026-0344', party: 'Fleur & Co', orderId: null, link },
    { date: '2026-10-20', eur: -5000, title: 'Containertermijn', party: 'Mock Rose Crafts', orderId: 43, link: { path: ['/costs'], query: { container: 43 } } },
  ] }));
  assert.deepEqual(model.markers('2026-10-19'), { types: [], more: false, lateTask: false, bigMoney: false });
  assert.deepEqual(model.markers('2026-10-20'), { types: ['geld'], more: false, lateTask: false, bigMoney: true });
  assert.equal(model.byDay.get('2026-10-19')![0].eur, 4999);
  assert.equal(model.byDay.get('2026-10-20')![0].eur, -5000);
  assert.deepEqual(model.komend(undefined, 5).map((entry) => entry.title), ['Containertermijn']);
  assert.equal(PIN_MIN_EUR, FORECAST_PIN_MIN_EUR);
});

test('the VAT deadline is a flagged money entry linking to its quarter', () => {
  const model = agendaModel(input({ vatDeadline: { date: '2026-10-25', label: 'Btw Q3', eur: -3918 } }));
  const vat = model.byDay.get('2026-10-25')![0];
  assert.deepEqual([vat.type, vat.deadline, vat.sub, vat.eur], ['geld', true, 'uiterste dag', -3918]);
  assert.deepEqual(vat.link, { path: ['/costs'], query: { view: 'analysis', tab: 'vat', year: 2026, quarter: 3 } });
  assert.equal(model.markers('2026-10-25').bigMoney, true);
  const q4 = agendaModel(input({ today: '2027-01-10', vatDeadline: { date: '2027-01-25', label: 'Btw Q4', eur: null } }));
  assert.deepEqual(q4.byDay.get('2027-01-25')![0].link?.query, { view: 'analysis', tab: 'vat', year: 2026, quarter: 4 });
});

test('pin: the nearest qualifying pin; a past appointment drops off, an overdue pinned task stays', () => {
  const future = agendaModel(input({ items: [
    item(10, '2026-10-24', { pinned: true, title: 'Beurs Side Arendonk', atTime: '08:00' }),
    item(11, '2026-10-30', { pinned: true }), item(12, '2026-10-10', { pinned: true }),
    item(13, '2026-10-12', { pinned: true, kind: 'TASK', done: true }), item(14, null, { pinned: true }),
  ] }));
  assert.equal(future.pin?.plannerId, 10);
  assert.equal(future.pin?.inDays, 9);
  assert.equal(future.pinCount, 2);
  const withTask = agendaModel(input({ items: [
    item(10, '2026-10-24', { pinned: true }), item(15, '2026-10-12', { pinned: true, kind: 'TASK' }),
  ] }));
  assert.deepEqual([withTask.pin?.plannerId, withTask.pin?.inDays, withTask.pin?.late], [15, -3, true]);
  assert.equal(agendaModel(input({ items: [item(12, '2026-10-10', { pinned: true })] })).pin, null);
});

test('the rest of today: what is still to come, appointments first (all-day, then by time)', () => {
  const model = agendaModel(input({ nowTime: '12:00', items: [
    item(1, TODAY, { atTime: '10:00', title: 'Bezoek' }), item(2, TODAY, { atTime: '14:30', title: 'Call' }),
    item(3, TODAY, { kind: 'TASK', title: 'Prijslijst' }), item(4, TODAY, { kind: 'TASK', done: true }),
    item(5, TODAY, { title: 'Beursdag' }),
  ], milestones: [stone(47, 'EXPECTED_ARRIVAL', TODAY)] }));
  assert.deepEqual(model.restOfToday.map((entry) => entry.key), ['afspraak:5', 'afspraak:2', 'taak:3', `container:EXPECTED_ARRIVAL:47:${TODAY}`]);
  const morning = agendaModel(input({ nowTime: '08:40', items: [item(1, TODAY, { atTime: '10:00' })] }));
  assert.equal(morning.restOfToday.length, 1);
  assert.equal(model.byDay.get(TODAY)!.find((entry) => entry.key === 'afspraak:1')?.past, true);
});

test('the rest of today: money never pushes an appointment out of the card\'s first four rows; small money stays in Agenda › Dag', () => {
  const money = (eur: number, title: string) => ({ date: TODAY, eur, title, party: null, orderId: null, link: null });
  const model = agendaModel(input({ nowTime: '08:40',
    items: [item(1, TODAY, { atTime: '14:00', title: 'Klant Peeters' }), item(2, TODAY, { atTime: '10:00', title: 'Bezoek Bloemenhuis Lier' })],
    money: [money(-665.5, 'Boekhouder Q3'), money(2000, 'Factuur F2026-0300'), money(-640, 'Tegoeden klanten'), money(7475, 'Factuur F2026-0138'),
      money(-6000, 'Huur'), money(5000, 'Factuur F2026-0401')],
    vatDeadline: { date: TODAY, label: 'Btw-aangifte Q3', eur: -3918.4 } }));
  assert.deepEqual(model.restOfToday.slice(0, 4).map((entry) => entry.title),
    ['Bezoek Bloemenhuis Lier', 'Klant Peeters', 'Btw-aangifte Q3', 'Factuur F2026-0138']);
  /* Only money that earns a marker (a deadline or ≥ PIN_MIN_EUR) is in the card; the day itself keeps every amount. */
  assert.deepEqual(model.restOfToday.filter((entry) => entry.type === 'geld').map((entry) => entry.title).sort(),
    ['Btw-aangifte Q3', 'Factuur F2026-0138', 'Factuur F2026-0401', 'Huur']);
  assert.equal(model.byDay.get(TODAY)!.filter((entry) => entry.type === 'geld').length, 7);
});

test('after the window: at most 5 pins, deadlines, arrivals, big money or the krap start', () => {
  const money = (date: string, eur: number) => ({ date, eur, title: `Geld ${date}`, party: null, orderId: null, link: null });
  const model = agendaModel(input({
    items: [item(10, '2026-10-24', { pinned: true }), item(16, '2026-10-26', { title: 'Gewoon' })],
    milestones: [stone(47, 'EXPECTED_ARRIVAL', '2026-11-05'), stone(48, 'SHIPPED', '2026-10-28')],
    money: [money('2026-10-27', 200), money('2026-11-02', -18250), money('2026-11-20', 9000)],
    vatDeadline: { date: '2026-10-25', label: 'Btw Q3', eur: -3918 },
    tight: { from: '2026-11-03', to: '2026-11-11' },
  }));
  const after = model.after('2026-10-21');
  assert.equal(after.length, 5);
  assert.deepEqual(after.map((entry) => entry.date), ['2026-10-24', '2026-10-25', '2026-11-02', '2026-11-03', '2026-11-05']);
  assert.equal(after[3].title, 'Krap begint');
  assert.equal(model.after('2026-10-21', 9).length, 6);
  assert.equal(model.krapDays.size, 9);
  assert.ok(model.krapDays.has('2026-11-03') && model.krapDays.has('2026-11-11') && !model.krapDays.has('2026-11-12'));
});

test('markers: up to three types in a fixed order, a late task flagged, more than three as a plus', () => {
  const model = agendaModel(input({
    items: [item(1, '2026-10-20'), item(2, '2026-10-20', { kind: 'TASK' }), item(3, '2026-10-13', { kind: 'TASK' }),
      item(4, '2026-10-21'), item(5, '2026-10-21'), item(6, '2026-10-21'), item(7, '2026-10-21')],
    milestones: [stone(47, 'EXPECTED_ARRIVAL', '2026-10-20')],
    money: [{ date: '2026-10-20', eur: 12000, title: 'Factuur', party: null, orderId: null, link: null }],
  }));
  assert.deepEqual(model.markers('2026-10-20'), { types: ['afspraak', 'taak', 'container'], more: true, lateTask: false, bigMoney: true });
  assert.equal(model.markers('2026-10-13').lateTask, true);
  assert.deepEqual(model.markers('2026-10-21'), { types: ['afspraak'], more: true, lateTask: false, bigMoney: false });
  assert.deepEqual(model.markers('2026-10-22'), { types: [], more: false, lateTask: false, bigMoney: false });
});

test('notes show without the home marker lines', () => {
  const model = agendaModel(input({ items: [item(1, TODAY, { note: '[home:vat:2026-Q3#0123abcd]\nBoekhouder bellen' })] }));
  assert.equal(model.byDay.get(TODAY)![0].sub, 'Boekhouder bellen');
});
