export interface ReceiptMetricLineInput {
  orderedPieces: number;
  receivedPieces: number;
  damagedPieces: number;
  unitValueEur: number | null | undefined;
}

export interface ReceiptLineMetric {
  orderedPieces: number;
  receivedPieces: number;
  missingPieces: number;
  overReceivedPieces: number;
  damagedPieces: number;
  usablePieces: number;
  lossPieces: number;
  unitValueEur: number | null;
  missingValueEur: number | null;
  damagedValueEur: number | null;
  totalLossValueEur: number | null;
  valuationComplete: boolean;
}

export interface ReceiptMetrics {
  orderedPieces: number;
  receivedPieces: number;
  missingPieces: number;
  overReceivedPieces: number;
  damagedPieces: number;
  usablePieces: number;
  lossPieces: number;
  missingValueEur: number;
  damagedValueEur: number;
  totalLossValueEur: number;
  unvaluedLossPieces: number;
  valuationComplete: boolean;
  affectedLines: number;
  lines: ReceiptLineMetric[];
}

export interface SupplierReceiptOrderInput {
  receivedOn: string | null | undefined;
  expectedArrival: string | null | undefined;
  lines: Array<{
    quantity: number;
    orderedQuantity?: number | null;
    damagedQuantity?: number | null;
  }>;
}

export interface SupplierReceiptPerformance {
  receivedOrders: number;
  comparableOrders: number;
  perfectOrders: number;
  unknownOrders: number;
  perfectPct: number | null;
  assessedPieces: number;
  goodPieces: number;
  qualityPct: number | null;
  datedOrders: number;
  onTimeOrders: number;
  onTimePct: number | null;
}

/** Normalize receipt arithmetic once so sheets, order views and analyses cannot disagree. */
export function receiptLineMetrics(input: ReceiptMetricLineInput): ReceiptLineMetric {
  const orderedPieces = whole(input.orderedPieces);
  const receivedPieces = whole(input.receivedPieces);
  const damagedPieces = Math.min(receivedPieces, whole(input.damagedPieces));
  const missingPieces = Math.max(0, orderedPieces - receivedPieces);
  const overReceivedPieces = Math.max(0, receivedPieces - orderedPieces);
  const usablePieces = Math.max(0, receivedPieces - damagedPieces);
  const lossPieces = missingPieces + damagedPieces;
  const unitValueEur = finiteNonNegative(input.unitValueEur);
  const valuationComplete = lossPieces === 0 || unitValueEur !== null;
  return {
    orderedPieces,
    receivedPieces,
    missingPieces,
    overReceivedPieces,
    damagedPieces,
    usablePieces,
    lossPieces,
    unitValueEur,
    missingValueEur: unitValueEur === null ? null : missingPieces * unitValueEur,
    damagedValueEur: unitValueEur === null ? null : damagedPieces * unitValueEur,
    totalLossValueEur: unitValueEur === null ? null : lossPieces * unitValueEur,
    valuationComplete,
  };
}

export function receiptMetrics(inputs: ReceiptMetricLineInput[]): ReceiptMetrics {
  const lines = inputs.map(receiptLineMetrics);
  return lines.reduce<ReceiptMetrics>((total, line) => ({
    orderedPieces: total.orderedPieces + line.orderedPieces,
    receivedPieces: total.receivedPieces + line.receivedPieces,
    missingPieces: total.missingPieces + line.missingPieces,
    overReceivedPieces: total.overReceivedPieces + line.overReceivedPieces,
    damagedPieces: total.damagedPieces + line.damagedPieces,
    usablePieces: total.usablePieces + line.usablePieces,
    lossPieces: total.lossPieces + line.lossPieces,
    missingValueEur: total.missingValueEur + (line.missingValueEur ?? 0),
    damagedValueEur: total.damagedValueEur + (line.damagedValueEur ?? 0),
    totalLossValueEur: total.totalLossValueEur + (line.totalLossValueEur ?? 0),
    unvaluedLossPieces: total.unvaluedLossPieces + (line.valuationComplete ? 0 : line.lossPieces),
    valuationComplete: total.valuationComplete && line.valuationComplete,
    affectedLines: total.affectedLines + (line.lossPieces > 0 ? 1 : 0),
    lines: total.lines,
  }), {
    orderedPieces: 0,
    receivedPieces: 0,
    missingPieces: 0,
    overReceivedPieces: 0,
    damagedPieces: 0,
    usablePieces: 0,
    lossPieces: 0,
    missingValueEur: 0,
    damagedValueEur: 0,
    totalLossValueEur: 0,
    unvaluedLossPieces: 0,
    valuationComplete: true,
    affectedLines: 0,
    lines,
  });
}

/** Quality is fulfilled, usable pieces against ordered pieces; over-receipts cannot exceed 100%. */
export function supplierReceiptPerformance(
  orders: SupplierReceiptOrderInput[],
): SupplierReceiptPerformance {
  let assessedPieces = 0;
  let goodPieces = 0;
  let comparableOrders = 0;
  let perfectOrders = 0;
  let datedOrders = 0;
  let onTimeOrders = 0;
  for (const order of orders) {
    for (const line of order.lines) {
      if (line.orderedQuantity == null) continue;
      const ordered = whole(line.orderedQuantity);
      const received = whole(line.quantity);
      const damaged = Math.min(received, whole(line.damagedQuantity ?? 0));
      assessedPieces += ordered;
      goodPieces += Math.min(ordered, Math.max(0, received - damaged));
    }
    const comparable = order.lines.length > 0
      && order.lines.every((line) => line.orderedQuantity != null);
    if (comparable) {
      comparableOrders++;
      if (order.lines.every((line) => line.quantity === line.orderedQuantity
        && (line.damagedQuantity ?? 0) === 0)) perfectOrders++;
    }
    if (isoDay(order.receivedOn) && isoDay(order.expectedArrival)) {
      datedOrders++;
      if (order.receivedOn! <= order.expectedArrival!) onTimeOrders++;
    }
  }
  return {
    receivedOrders: orders.length,
    comparableOrders,
    perfectOrders,
    unknownOrders: orders.length - comparableOrders,
    perfectPct: comparableOrders > 0 ? (perfectOrders / comparableOrders) * 100 : null,
    assessedPieces,
    goodPieces,
    qualityPct: assessedPieces > 0 ? (goodPieces / assessedPieces) * 100 : null,
    datedOrders,
    onTimeOrders,
    onTimePct: datedOrders > 0 ? (onTimeOrders / datedOrders) * 100 : null,
  };
}

export function inDateRange(day: string | null | undefined, from?: string, to?: string): boolean {
  if (!isoDay(day)) return false;
  return (!from || day! >= from) && (!to || day! <= to);
}

function whole(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function finiteNonNegative(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value >= 0 ? value : null;
}

function isoDay(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export interface SupplierScorecardInput extends SupplierReceiptOrderInput {
  supplierId: number;
  supplierName: string;
  orderDate: string | null | undefined;
  totalEur: number;
}

export interface SupplierScorecard {
  supplierId: number;
  name: string;
  orders: number;
  totalEur: number;
  perfectPct: number | null;
  onTimePct: number | null;
  /** Days from order to receipt, over orders that carry both dates. */
  avgLeadDays: number | null;
  latestReceivedOn: string | null;
}

/** Every supplier on one line: how much, how well, how fast. Most business first. */
export function supplierScorecards(orders: readonly SupplierScorecardInput[]): SupplierScorecard[] {
  const grouped = new Map<number, SupplierScorecardInput[]>();
  for (const order of orders) {
    grouped.set(order.supplierId, [...(grouped.get(order.supplierId) ?? []), order]);
  }
  return [...grouped.entries()].map(([supplierId, rows]) => {
    const performance = supplierReceiptPerformance(rows);
    const leadDays = rows.flatMap((row) => {
      if (!isoDay(row.orderDate) || !isoDay(row.receivedOn)) return [];
      const days = daysBetweenIso(row.orderDate!, row.receivedOn!);
      return days >= 0 ? [days] : [];
    });
    return {
      supplierId,
      name: rows[0].supplierName,
      orders: rows.length,
      totalEur: rows.reduce((sum, row) => sum + (Number.isFinite(row.totalEur) ? row.totalEur : 0), 0),
      perfectPct: performance.perfectPct,
      onTimePct: performance.onTimePct,
      avgLeadDays: leadDays.length
        ? Math.round(leadDays.reduce((sum, days) => sum + days, 0) / leadDays.length) : null,
      latestReceivedOn: rows.map((row) => row.receivedOn).filter((day): day is string => isoDay(day)).sort().at(-1) ?? null,
    };
  }).sort((left, right) => right.totalEur - left.totalEur || right.orders - left.orders
    || left.name.localeCompare(right.name, 'nl'));
}

/** Days from order to receipt over every order that carries both dates; null without any. */
export function averageLeadDays(orders: readonly { orderDate?: string | null; receivedOn?: string | null }[]): number | null {
  const days = orders.flatMap((order) => {
    if (!isoDay(order.orderDate) || !isoDay(order.receivedOn)) return [];
    const value = daysBetweenIso(order.orderDate!, order.receivedOn!);
    return value >= 0 ? [value] : [];
  });
  return days.length ? Math.round(days.reduce((sum, value) => sum + value, 0) / days.length) : null;
}

function daysBetweenIso(fromDay: string, toDay: string): number {
  const from = Date.UTC(Number(fromDay.slice(0, 4)), Number(fromDay.slice(5, 7)) - 1, Number(fromDay.slice(8, 10)));
  const to = Date.UTC(Number(toDay.slice(0, 4)), Number(toDay.slice(5, 7)) - 1, Number(toDay.slice(8, 10)));
  return Math.round((to - from) / 86_400_000);
}
