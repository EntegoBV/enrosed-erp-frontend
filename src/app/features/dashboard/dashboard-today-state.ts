import type { PurchaseOrderView } from '../../core/api/models';
import type { PlannerItem } from '../../core/api/planner-api';
import type { PlannerMilestone } from './planner-cards';

export interface TodayAgendaEntry {
  id: string;
  title: string;
  sub: string | null;
  atTime: string | null;
  kind: 'EVENT' | 'TASK' | 'ORDERED' | 'SHIPPED' | 'EXPECTED_ARRIVAL' | 'RECEIVED';
  actionLabel: string;
  item: PlannerItem | null;
  milestone: PlannerMilestone | null;
}

/** Planner dates are calendar days, without conversion to UTC. */
export function localPlannerDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function todayAgendaEntries(
  items: readonly PlannerItem[],
  milestones: readonly PlannerMilestone[],
  date: string,
): TodayAgendaEntry[] {
  const appointments: TodayAgendaEntry[] = items
    .filter((item) => item.onDate === date && !(item.kind === 'TASK' && item.done))
    .map((item, index) => ({
      id: `planner-${item.kind}-${item.id ?? `unsaved-${index}`}`,
      title: item.title,
      sub: item.note,
      atTime: item.atTime,
      kind: item.kind,
      actionLabel: item.kind === 'EVENT' ? 'Afspraak bekijken' : 'Taak bekijken',
      item,
      milestone: null,
    }));
  const containers: TodayAgendaEntry[] = milestones
    .filter((milestone) => milestone.date === date)
    .map((milestone) => ({
      id: `container-${milestone.kind}-${milestone.orderId}-${milestone.date}`,
      title: milestone.title,
      sub: milestone.sub,
      atTime: null,
      kind: milestone.kind,
      actionLabel: milestone.kind === 'EXPECTED_ARRIVAL' ? 'Ontvangst controleren' : 'Container bekijken',
      item: null,
      milestone,
    }));
  const rank = (entry: TodayAgendaEntry): number => entry.kind === 'EXPECTED_ARRIVAL' ? 0 : entry.atTime ? 1 : 2;
  return [...appointments, ...containers].sort((left, right) => rank(left) - rank(right)
    || (left.atTime ?? '').localeCompare(right.atTime ?? '')
    || left.title.localeCompare(right.title, 'nl')
    || left.id.localeCompare(right.id));
}

/** Actual milestones remain history; only active, unreceived orders can be expected. */
export function purchasePlannerMilestones(
  purchases: readonly PurchaseOrderView[],
  supplierNames: ReadonlyMap<number, string>,
): PlannerMilestone[] {
  const milestones: PlannerMilestone[] = [];
  for (const row of purchases) {
    if (row.order.archivedAt) continue;
    const name = row.order.alias || row.order.number;
    const supplier = supplierNames.get(row.order.supplierId) ?? row.order.number;
    if (row.order.orderDate && row.order.status !== 'CONCEPT') {
      milestones.push({ date: row.order.orderDate, kind: 'ORDERED', icon: '🛒', title: `${name} besteld`,
        sub: supplier, orderId: row.order.id });
    }
    if (row.order.shippedOn) {
      milestones.push({ date: row.order.shippedOn, kind: 'SHIPPED', icon: '🚢', title: `${name} vertrokken`,
        sub: row.order.trackingReference ? `T&T ${row.order.trackingReference}` : supplier,
        orderId: row.order.id });
    }
    if (row.order.expectedArrival && !row.order.receivedOn
      && (row.order.status === 'BESTELD' || row.order.status === 'ONDERWEG')) {
      milestones.push({ date: row.order.expectedArrival, kind: 'EXPECTED_ARRIVAL', icon: '📦', title: `${name} verwachte aankomst`,
        sub: `${row.costing.totals.pieces.toLocaleString('nl-BE')} st · ${supplier}`,
        orderId: row.order.id });
    }
    if (row.order.receivedOn) {
      milestones.push({ date: row.order.receivedOn, kind: 'RECEIVED', icon: '✓', title: `${name} ontvangen`,
        sub: supplier, orderId: row.order.id });
    }
  }
  return milestones;
}
