import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import type { PurchaseOrder, PurchaseOrderView } from '../src/app/core/api/models.ts';
import type { PlannerItem } from '../src/app/core/api/planner-api.ts';
import type { PlannerMilestone } from '../src/app/features/dashboard/planner-cards.ts';
import { localPlannerDate, purchasePlannerMilestones, todayAgendaEntries } from '../src/app/features/dashboard/dashboard-today-state.ts';

const today = '2026-09-14';
const item = (id: number, changes: Partial<PlannerItem> = {}): PlannerItem => ({
  id, kind: 'EVENT', title: `Afspraak ${id}`, onDate: today, atTime: null, note: null, done: false, ...changes,
});
const stone = (orderId: number, kind: PlannerMilestone['kind'] = 'EXPECTED_ARRIVAL', date = today): PlannerMilestone => ({
  orderId, kind, date, icon: '📦', title: 'Dezelfde containernaam', sub: 'Leverancier',
});
const purchase = (id: number, changes: Partial<PurchaseOrder> = {}): PurchaseOrderView => ({
  order: { id, number: `INK-${id}`, alias: null, supplierId: 9, orderDate: '2026-09-01',
    status: 'ONDERWEG', shippedOn: '2026-09-04', expectedArrival: today, receivedOn: null,
    archivedAt: null, trackingReference: 'BL-123', ...changes },
  costing: { totals: { pieces: 1200 } },
}) as PurchaseOrderView;

test('planner dates stay local across midnight, winter time and the DST boundary', () => {
  const moduleUrl = new URL('../src/app/features/dashboard/dashboard-today-state.ts', import.meta.url).href;
  const script = `import { localPlannerDate } from ${JSON.stringify(moduleUrl)};
    console.log(JSON.stringify([
      '2026-09-13T22:15:00Z', '2026-01-13T23:15:00Z',
      '2026-03-28T23:30:00Z', '2026-03-29T22:30:00Z'
    ].map(value => localPlannerDate(new Date(value)))));`;
  const output = execFileSync(process.execPath,
    ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--experimental-strip-types', '--input-type=module', '-e', script],
    { encoding: 'utf8', env: { ...process.env, TZ: 'Europe/Brussels' } });
  assert.deepEqual(JSON.parse(output), ['2026-09-14', '2026-01-14', '2026-03-29', '2026-03-30']);
  assert.equal(localPlannerDate(new Date(2026, 8, 14, 0, 1)), today);
});

test('today contains only dated appointments, open tasks and milestones for that day', () => {
  const task = item(2, { kind: 'TASK', title: 'Tellen' });
  const appointment = item(1);
  const completedAppointment = item(8, { done: true });
  const entries = todayAgendaEntries([
    appointment, task, item(3, { kind: 'TASK', done: true }), item(4, { onDate: null }),
    item(5, { onDate: '2026-09-13' }), item(6, { onDate: '2026-09-15' }), completedAppointment,
  ], [stone(20), stone(21, 'SHIPPED', '2026-09-13'), stone(22, 'EXPECTED_ARRIVAL', '2026-09-15')], today);
  assert.deepEqual(new Set(entries.map(entry => entry.id)), new Set([
    'planner-EVENT-1', 'planner-TASK-2', 'planner-EVENT-8', 'container-EXPECTED_ARRIVAL-20-2026-09-14',
  ]));
  assert.strictEqual(entries.find(entry => entry.item?.id === 2)?.item, task);
  assert.equal(entries.find(entry => entry.item?.id === 2)?.actionLabel, 'Taak bekijken');
  assert.equal(entries.find(entry => entry.item?.id === 1)?.actionLabel, 'Afspraak bekijken');
  assert.equal(entries[0].actionLabel, 'Ontvangst controleren');
});

test('expected arrivals lead, then actual clock times, then untimed entries and history without truncation', () => {
  const source = [item(1, { atTime: '14:30' }), item(2, { atTime: '09:05' }), item(3), item(4, { kind: 'TASK' })];
  const milestones = [stone(10, 'RECEIVED'), stone(11), stone(12, 'ORDERED'), stone(13, 'SHIPPED')];
  const before = JSON.stringify({ source, milestones });
  const entries = todayAgendaEntries(source, milestones, today);
  assert.equal(entries.length, 8);
  assert.deepEqual(entries.slice(0, 3).map(entry => entry.id), [
    'container-EXPECTED_ARRIVAL-11-2026-09-14', 'planner-EVENT-2', 'planner-EVENT-1',
  ]);
  assert.equal(entries.find(entry => entry.kind === 'RECEIVED')?.actionLabel, 'Container bekijken');
  assert.equal(JSON.stringify({ source, milestones }), before);
});

test('same-name containers and same-day milestone kinds keep distinct order targets', () => {
  const milestones = [stone(33), stone(35), stone(33, 'SHIPPED')];
  const entries = todayAgendaEntries([], milestones, today);
  assert.equal(new Set(entries.map(entry => entry.id)).size, 3);
  assert.deepEqual(entries.slice(0, 2).map(entry => entry.milestone?.orderId), [33, 35]);
  assert.strictEqual(entries.find(entry => entry.kind === 'SHIPPED')?.milestone, milestones[2]);
});

test('only active ordered or shipped containers without a receipt are expected', () => {
  const rows = [
    purchase(1, { status: 'CONCEPT', shippedOn: null }),
    purchase(2, { status: 'BESTELD', shippedOn: null }), purchase(3),
    purchase(4, { status: 'ONTVANGEN', receivedOn: today }),
    purchase(5, { status: 'ONTVANGEN', receivedOn: null }),
    purchase(6, { receivedOn: today }),
    purchase(7, { archivedAt: '2026-09-14T08:00:00Z' }),
    purchase(8, { expectedArrival: null }),
  ];
  const before = JSON.stringify(rows);
  const milestones = purchasePlannerMilestones(rows, new Map([[9, 'Leverancier BV']]));
  assert.deepEqual(milestones.filter(entry => entry.kind === 'EXPECTED_ARRIVAL').map(entry => entry.orderId), [2, 3]);
  assert.equal(milestones.some(entry => entry.orderId === 1 || entry.orderId === 7), false);
  assert.equal(milestones.filter(entry => entry.kind === 'RECEIVED').length, 2);
  assert.equal(JSON.stringify(rows), before);
});

test('saved history and existing labels retain their dates, supplier, tracking and alias', () => {
  const milestones = purchasePlannerMilestones([
    purchase(33, { alias: 'Voor Frans', status: 'ONTVANGEN', receivedOn: today }),
    purchase(35, { status: 'BESTELD', shippedOn: null, supplierId: 99 }),
  ], new Map([[9, 'Leverancier BV']]));
  assert.deepEqual(milestones.filter(entry => entry.orderId === 33), [
    { date: '2026-09-01', kind: 'ORDERED', icon: '🛒', title: 'Voor Frans besteld', sub: 'Leverancier BV', orderId: 33 },
    { date: '2026-09-04', kind: 'SHIPPED', icon: '🚢', title: 'Voor Frans vertrokken', sub: 'T&T BL-123', orderId: 33 },
    { date: today, kind: 'RECEIVED', icon: '✓', title: 'Voor Frans ontvangen', sub: 'Leverancier BV', orderId: 33 },
  ]);
  const arrival = milestones.find(entry => entry.kind === 'EXPECTED_ARRIVAL');
  assert.equal(arrival?.title, 'INK-35 verwachte aankomst');
  assert.equal(arrival?.sub, `${(1200).toLocaleString('nl-BE')} st · INK-35`);
});
