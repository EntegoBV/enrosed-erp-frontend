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

export type PaymentPlanFields = Pick<PurchaseOrder, 'paymentTerms' | 'payPctOrdered' | 'payPctShipped' | 'payPctArrived'>;
type PlanFields = PaymentPlanFields;

export function paymentPlanError(order: PaymentPlanFields): string | null {
  if (order.paymentTerms !== 'CUSTOM') return null;
  const values = [order.payPctOrdered, order.payPctShipped, order.payPctArrived];
  if (values.some(value => value != null && (!Number.isFinite(value) || value < 0 || value > 100))) {
    return 'Gebruik percentages tussen 0 en 100.';
  }
  return Math.abs(splitTotal(order.payPctOrdered, order.payPctShipped, order.payPctArrived) - 100) > 0.005
    ? 'De drie percentages moeten samen 100% zijn.' : null;
}

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

/**
 * What each instalment asks in euro, the way the server splits the goods:
 * every term but the last is rounded to the cent and never exceeds what is
 * left, the last term takes the rest, so the terms always add up exactly.
 */
export function planPreview(agreedEur: number, instalments: readonly Instalment[]): { due: Instalment['due']; label: string; share: number; amountEur: number }[] {
  const agreed = Math.max(0, Math.round((Number.isFinite(agreedEur) ? agreedEur : 0) * 100));
  let left = agreed;
  return instalments.map((step, index) => {
    const amount = index === instalments.length - 1 ? left : Math.min(Math.round(agreed * step.share), left);
    left -= amount;
    return { due: step.due, label: step.label, share: step.share, amountEur: amount / 100 };
  });
}

/** What the three shares add up to; 100 is the only right answer once anything is filled in. */
export function splitTotal(ordered: number | null | undefined, shipped: number | null | undefined,
                           arrived: number | null | undefined): number {
  return Math.round(((ordered ?? 0) + (shipped ?? 0) + (arrived ?? 0)) * 100) / 100;
}

function trimPct(pct: number): string {
  return Number.isInteger(pct) ? String(pct) : String(Math.round(pct * 100) / 100);
}
