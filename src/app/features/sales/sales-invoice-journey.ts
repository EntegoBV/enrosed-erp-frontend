import type { SalesOrder, SalesPaymentSummary } from '../../core/api/models';

export interface InvoiceJourneyStep {
  label: string;
  mark: string;
  state: 'done' | 'now' | 'todo' | 'stop' | 'wait';
  kind: 'danger' | 'gold' | 'muted' | undefined;
}

/** Highlight the recorded lifecycle state, never the next action that has not happened yet. */
export function advanceInvoiceJourney(order: Pick<SalesOrder, 'status' | 'sentAt'>, paymentStatus?: SalesPaymentSummary['status'] | null): InvoiceJourneyStep[] {
  const endings: Partial<Record<SalesOrder['status'], string>> = {
    GEANNULEERD: 'Geannuleerd', AFGEWEZEN: 'Afgewezen', VERLOPEN: 'Verlopen',
    WIJZIGING_GEVRAAGD: 'Wijziging gevraagd', GEACCEPTEERD: 'Geaccepteerd',
  };
  const ending = endings[order.status];
  if (ending) {
    const waiting = order.status === 'WIJZIGING_GEVRAAGD';
    const accepted = order.status === 'GEACCEPTEERD';
    const steps: InvoiceJourneyStep[] = [{ label: 'Concept', mark: '✓', state: 'done', kind: undefined }];
    // A cancelled draft has no proof of issuance. Historical delivery remains visible when recorded.
    if (order.sentAt) steps.push({ label: 'Uitgereikt', mark: '✓', state: 'done', kind: undefined });
    steps.push({ label: ending, mark: waiting ? '⇄' : accepted ? '•' : '×',
      state: waiting ? 'wait' : accepted ? 'now' : 'stop', kind: waiting ? 'gold' : accepted ? undefined : 'muted' });
    return steps;
  }
  const issuedStatus = ['UITGEREIKT', 'VERZONDEN', 'BEKEKEN', 'BETAALD'].includes(order.status);
  const partial = issuedStatus && paymentStatus === 'PARTIAL';
  const paid = issuedStatus && (paymentStatus === 'PAID' || paymentStatus === 'OVERPAID');
  const current = paid || partial || order.status === 'BETAALD' ? 2 : issuedStatus ? 1 : 0;
  const issued = order.status === 'VERZONDEN' ? 'Uitgereikt · verstuurd'
    : order.status === 'BEKEKEN' ? 'Uitgereikt · bekeken' : 'Uitgereikt';
  return ['Concept', issued, partial ? 'Voorschot deels ontvangen' : 'Voorschot ontvangen'].map<InvoiceJourneyStep>((label, index) => ({
    label, mark: index < current ? '✓' : `${index + 1}`,
    state: index < current ? 'done' : index === current ? 'now' : 'todo', kind: undefined,
  }));
}
