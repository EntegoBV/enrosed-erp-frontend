import type { Instalment, PaymentTerms, PurchaseOrder } from '../../core/api/models';

/** A preset plan as the models list them: its code, its name and its instalments. */
export interface PaymentPlanPreset { value: PaymentTerms; label: string; instalments: Instalment[] }

/**
 * Small differences between what was agreed and what was paid are the cost
 * of paying: bank charges, rounding, a rate that moved. Up to this amount a
 * stream counts as paid exactly.
 */
export const PAYMENT_TOLERANCE_EUR = 10;

/** True when paid and agreed are the same but for the small change of paying. */
export function withinTolerance(differenceEur: number): boolean {
  return Math.abs(differenceEur) <= PAYMENT_TOLERANCE_EUR + 0.005;
}

type PlanFields = Pick<PurchaseOrder, 'paymentTerms' | 'payPctOrdered' | 'payPctShipped' | 'payPctArrived'>;

/** The order's own split as percentages; zero and missing shares are left out. */
export function splitInstalments(ordered: number | null | undefined, shipped: number | null | undefined,
                                 arrived: number | null | undefined): Instalment[] {
  const steps: Instalment[] = [];
  const add = (pct: number | null | undefined, when: string, due: Instalment['due']) => {
    if (!pct || pct <= 0) return;
    steps.push({ label: `${trimPct(pct)}% ${when}`, share: pct / 100, due });
  };
  add(ordered, 'bij bestelling', 'ORDERED');
  add(shipped, 'bij vertrek', 'SHIPPED');
  add(arrived, 'bij aankomst', 'ARRIVED');
  return steps;
}

/** How a purchase order is paid: its own split under CUSTOM, else the preset plan. */
export function instalmentsOf(order: PlanFields, presets: readonly PaymentPlanPreset[]): Instalment[] {
  const terms = order.paymentTerms ?? 'THIRDS';
  if (terms === 'CUSTOM') return splitInstalments(order.payPctOrdered, order.payPctShipped, order.payPctArrived);
  return presets.find((item) => item.value === terms)?.instalments ?? [];
}

/** The plan in words: the preset's name, or the split spelled out. */
export function paymentPlanLabel(order: PlanFields, presets: readonly PaymentPlanPreset[]): string {
  const terms = order.paymentTerms ?? 'THIRDS';
  if (terms === 'CUSTOM') {
    const steps = splitInstalments(order.payPctOrdered, order.payPctShipped, order.payPctArrived);
    return steps.length ? steps.map((step) => step.label).join(', ') : 'Anders: eigen verdeling';
  }
  return presets.find((item) => item.value === terms)?.label ?? '—';
}

/** What the three shares add up to; 100 is the only right answer once anything is filled in. */
export function splitTotal(ordered: number | null | undefined, shipped: number | null | undefined,
                           arrived: number | null | undefined): number {
  return Math.round(((ordered ?? 0) + (shipped ?? 0) + (arrived ?? 0)) * 100) / 100;
}

function trimPct(pct: number): string {
  return Number.isInteger(pct) ? String(pct) : String(Math.round(pct * 100) / 100);
}
