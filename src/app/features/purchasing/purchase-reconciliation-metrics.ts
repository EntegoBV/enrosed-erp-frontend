import type { PurchaseOrderView, PurchaseReconciliation } from '../../core/api/models';

export type ReconciliationStream = PurchaseReconciliation['streams'][number];
export type ContainerCostFilter = 'active' | 'all' | 'open' | 'finalized' | 'higher' | 'lower';

/** Display vocabulary only: settlement decisions and all cost allocations belong to the server. */
export function reconciliationStatusLabel(stream: ReconciliationStream): string {
  switch (stream.status) {
    case 'PLANNED': return 'Gepland';
    case 'UNPAID': return 'Nog te betalen';
    case 'PARTIAL': return 'Deels betaald';
    case 'PAID': return 'Volledig betaald';
    case 'OVERPAID': return stream.finalized ? 'Meer betaald · vereffend' : 'Meer betaald · te beoordelen';
    case 'SETTLED_LOWER': return 'Minder betaald · vereffend';
    case 'NOT_APPLICABLE': return 'Niet van toepassing';
    case 'ADDITIONAL': return 'Extra uitgave';
  }
}

/** A historical or cached response can still carry just the saved container calculation. */
export function purchaseExternalCost(view: PurchaseOrderView): number {
  return view.reconciliation?.totals.forecastExternalEur
    ?? Math.max(0, (view.costing.totals.totalWithSeparateCostsEur ?? view.costing.totals.totalEur)
      - (view.costing.totals.extraRevenueEur ?? 0));
}

export interface ContainerCostRow {
  view: PurchaseOrderView;
  reconciliation: PurchaseReconciliation;
}

export function containerCostRows(
  purchases: readonly PurchaseOrderView[], filter: ContainerCostFilter = 'active', search = '',
): ContainerCostRow[] {
  const query = search.trim().toLocaleLowerCase('nl-BE');
  return purchases.flatMap((view): ContainerCostRow[] => {
    const reconciliation = view.reconciliation;
    if (!reconciliation) return [];
    if (filter !== 'all' && view.order.status === 'CONCEPT') return [];
    if (query && !`${view.order.number} ${view.order.alias ?? ''}`.toLocaleLowerCase('nl-BE').includes(query)) return [];
    if (filter === 'open' && reconciliation.totals.finalized) return [];
    if (filter === 'finalized' && !reconciliation.totals.finalized) return [];
    // Compare forecasts, never paid-minus-budget: a deposit is not a saving.
    if (filter === 'higher' && reconciliation.totals.varianceEur <= 0) return [];
    if (filter === 'lower' && reconciliation.totals.varianceEur >= 0) return [];
    return [{ view, reconciliation }];
  }).sort((left, right) =>
    right.view.order.orderDate.localeCompare(left.view.order.orderDate)
    || right.view.order.id - left.view.order.id);
}

/** Sum server amounts without netting away supplier overruns against customs savings. */
export function containerCostTotals(rows: readonly ContainerCostRow[]) {
  const total = {
    plannedEur: 0, paidEur: 0, remainingEur: 0, forecastEur: 0, varianceEur: 0,
    overpaidEur: 0, settledSavingEur: 0, additionalEur: 0,
    finalizedCount: 0, provisionalCount: 0,
  };
  for (const { reconciliation } of rows) {
    const amounts = reconciliation.totals;
    total.plannedEur += amounts.plannedExternalEur;
    total.paidEur += amounts.paidEur;
    total.remainingEur += amounts.remainingEur;
    total.forecastEur += amounts.forecastExternalEur;
    total.varianceEur += amounts.varianceEur;
    if (amounts.finalized) total.finalizedCount++;
    else total.provisionalCount++;
    for (const stream of reconciliation.streams) {
      total.overpaidEur += stream.overpaidEur;
      total.settledSavingEur += stream.settledSavingEur;
      if (stream.payee === 'OTHER') total.additionalEur += stream.paidEur;
    }
  }
  // Round only presentation aggregates; the server owns original cents and unit precision.
  return { ...total,
    plannedEur: cents(total.plannedEur), paidEur: cents(total.paidEur),
    remainingEur: cents(total.remainingEur), forecastEur: cents(total.forecastEur),
    varianceEur: cents(total.varianceEur), overpaidEur: cents(total.overpaidEur),
    settledSavingEur: cents(total.settledSavingEur), additionalEur: cents(total.additionalEur),
  };
}

function cents(value: number): number { return Math.round(value * 100) / 100; }
