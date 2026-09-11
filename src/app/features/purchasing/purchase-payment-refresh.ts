import type { PurchaseOrder } from '../../core/api/models';

/** Apply server changes after a payment while retaining fields the user is editing. */
export function preservePurchaseDraft(draft: PurchaseOrder, saved: PurchaseOrder, fresh: PurchaseOrder): PurchaseOrder {
  const next = { ...fresh };
  for (const key of Object.keys(draft) as (keyof PurchaseOrder)[]) {
    if (JSON.stringify(draft[key]) !== JSON.stringify(saved[key])) {
      Object.assign(next, { [key]: draft[key] });
    }
  }
  return next;
}
