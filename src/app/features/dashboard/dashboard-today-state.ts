import type { PurchaseOrderView } from '../../core/api/models';
import type { PlannerItem } from '../../core/api/planner-api';
import type { PlannerMilestone } from './planner-cards';

export interface TodayAgendaEntry {
  id: string;
  title: string;
  sub: string | null;
  atTime: string | null;
  kind: 'EVENT' | 'TASK' | 'ORDERED' | 'SHIPPED' | 'EXPECTED_ARRIVAL' | 'RECEIVED';
  /** Whole days an open task is past its planned day; 0 for everything else. */
  daysLate: number;
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

/** Whole calendar days from one 'YYYY-MM-DD' to the next (UTC parts, so no DST hour sneaks in). */
function daysBetween(fromIso: string, toIso: string): number {
  const utc = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round((utc(toIso) - utc(fromIso)) / 86_400_000);
}

/**
 * What today asks for: its appointments, its open tasks and the tasks still
 * open from earlier days (those first, oldest on top - they are already
 * late), plus the container moments dated today.
 */
export function todayAgendaEntries(
  items: readonly PlannerItem[],
  milestones: readonly PlannerMilestone[],
  date: string,
): TodayAgendaEntry[] {
  const appointments: TodayAgendaEntry[] = items
    .filter((item) => item.kind === 'TASK'
      ? !item.done && !!item.onDate && item.onDate <= date
      : item.onDate === date)
    .map((item, index) => ({
      id: `planner-${item.kind}-${item.id ?? `unsaved-${index}`}`,
      title: item.title,
      sub: item.note,
      atTime: item.atTime,
      kind: item.kind,
      daysLate: item.kind === 'TASK' && item.onDate ? Math.max(0, daysBetween(item.onDate, date)) : 0,
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
      daysLate: 0,
      actionLabel: milestone.kind === 'EXPECTED_ARRIVAL' ? 'Ontvangst controleren' : 'Container bekijken',
      item: null,
      milestone,
    }));
  const rank = (entry: TodayAgendaEntry): number => entry.daysLate > 0 ? 0
    : entry.kind === 'EXPECTED_ARRIVAL' ? 1 : entry.atTime ? 2 : 3;
  return [...appointments, ...containers].sort((left, right) => rank(left) - rank(right)
    || right.daysLate - left.daysLate
    || (left.atTime ?? '').localeCompare(right.atTime ?? '')
    || left.title.localeCompare(right.title, 'nl')
    || left.id.localeCompare(right.id));
}

/**
 * The pins still worth a line on the home: appointments from today on (or
 * without a day) and tasks until they are ticked, whatever their day. A past
 * appointment drops off here but stays pinned in the planner. Nearest first,
 * undated last.
 */
export function activePins(items: readonly PlannerItem[], today: string): PlannerItem[] {
  return items
    .filter((item) => item.pinned && (item.kind === 'TASK' ? !item.done : !item.onDate || item.onDate >= today))
    .sort((left, right) => (left.onDate ?? '9999-12-31').localeCompare(right.onDate ?? '9999-12-31')
      || (left.atTime ?? '').localeCompare(right.atTime ?? '')
      || left.title.localeCompare(right.title, 'nl'));
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
