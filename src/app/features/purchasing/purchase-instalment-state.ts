import type { Instalment, Payee, PurchaseOrderView, PurchasePayment } from '../../core/api/models';

/** Individual final terms can close a supplier without a separate whole-group marker. */
export function purchaseGroupSettled(view: PurchaseOrderView | null, payments: readonly PurchasePayment[] | null, payee: Payee): boolean {
  const stream = view?.reconciliation?.streams.find(item => item.payee === payee);
  if (stream) return stream.finalized && (stream.explicitlySettled || (payee === 'SUPPLIER'
    && !!view?.reconciliation?.supplierInstalments?.some(term => term.explicitlySettled)));
  return (payments ?? []).some(payment => (payment.payee ?? 'SUPPLIER') === payee
    && payment.settles && payment.instalmentDue == null);
}

export interface PurchaseInstalmentState {
  due: Instalment['due'];
  label: string;
  amount: number;
  full: number;
  covered: number;
  settled: boolean;
  state: 'paid' | 'due' | 'later';
}

/** The server owns allocation and settlement. A smaller settled term is not a fully paid plan. */
export function purchaseInstalmentState(
  view: PurchaseOrderView, plan: readonly Instalment[], payments: readonly PurchasePayment[] | null,
): PurchaseInstalmentState[] {
  const reached = (due: Instalment['due']) => due === 'ORDERED' ? view.order.status !== 'CONCEPT'
    : due === 'SHIPPED' ? ['ONDERWEG', 'ONTVANGEN'].includes(view.order.status) : view.order.status === 'ONTVANGEN';
  if (view.reconciliation?.supplierInstalments) {
    if (!view.reconciliation.supplierInstalments.some(term => term.plannedEur > 0)) return [];
    return view.reconciliation.supplierInstalments.map(term => ({
      due: term.due, label: term.label, full: term.plannedEur, covered: term.paidEur,
      amount: term.remainingEur, settled: term.explicitlySettled && term.finalized,
      state: term.remainingEur === 0 && (term.finalized || term.paidEur >= term.plannedEur)
        ? 'paid' : reached(term.due) ? 'due' : 'later',
    }));
  }
  // Compatibility with the former API. Never guess allocations for a scoped payment.
  if (payments === null || payments.some(payment => payment.instalmentDue != null)) return [];
  const stream = view.reconciliation?.streams.find(item => item.payee === 'SUPPLIER');
  const supplier = payments.filter(payment => (payment.payee ?? 'SUPPLIER') === 'SUPPLIER');
  if (supplier.some(payment => !Number.isFinite(payment.amountEur))) return [];
  const planned = stream?.plannedEur ?? view.payable?.supplierEur ?? view.costing.totals.goodsEur;
  if (!(planned > 0)) return [];
  const paid = stream?.paidEur ?? supplier.reduce((sum, payment) => sum + payment.amountEur, 0);
  const settled = stream?.explicitlySettled ?? supplier.some(payment => payment.settles);
  let left = Math.round(paid * 100);
  let plannedLeft = Math.round(planned * 100);
  return plan.map((step, index) => {
    const full = index === plan.length - 1 ? plannedLeft : Math.round(planned * step.share * 100);
    plannedLeft -= full;
    const covered = Math.min(full, left);
    left -= covered;
    const open = settled ? 0 : Math.max(0, full - covered);
    return { due: step.due, label: step.label, full: full / 100, covered: covered / 100,
      amount: open / 100, settled: !!settled, state: open <= 5 ? 'paid' : reached(step.due) ? 'due' : 'later' };
  });
}
