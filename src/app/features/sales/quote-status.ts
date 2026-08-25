import { QuoteStatus, SalesOrder } from '../../core/api/models';

/** One place for how a quote status looks. */
export const STATUS_LABEL: Record<QuoteStatus, string> = {
  CONCEPT: 'Concept',
  VERZONDEN: 'Verzonden',
  BEKEKEN: 'Bekeken',
  WIJZIGING_GEVRAAGD: 'Wijziging gevraagd',
  GEACCEPTEERD: 'Geaccepteerd',
  AFGEWEZEN: 'Afgewezen',
  VERLOPEN: 'Verlopen',
  BETAALD: 'Betaald',
};

export function statusClass(status: QuoteStatus): string {
  switch (status) {
    case 'GEACCEPTEERD': return 'ok';
    case 'BETAALD': return 'ok';
    case 'AFGEWEZEN': return 'danger';
    case 'WIJZIGING_GEVRAAGD': return 'gold';
    case 'VERZONDEN': return 'rose';
    case 'BEKEKEN': return 'blue';
    default: return 'neutral';
  }
}

/**
 * Does this quote lie with us or with the customer?
 *
 * On a list of dozens of orders the status alone is not enough: "Verzonden"
 * does not say whether to wait or to act. This is the question you ask on
 * every row, so the answer sits right next to it.
 */
export function actionNeeded(order: SalesOrder, awaitingResend = false): string | null {
  if (order.status === 'WIJZIGING_GEVRAAGD') return 'Voorstel beoordelen';
  if (order.status === 'AFGEWEZEN') return 'Heropenen of laten';
  /* An adopted proposal outranks a plain draft: the customer is waiting.
     A plain concept gets no nag - inkoop stays quiet about those too. */
  if (order.status === 'CONCEPT' && awaitingResend) return 'Klant wacht op nieuwe versie';

  /* A sent quote with an open item waits on us, not on the customer. */
  const open = order.status === 'VERZONDEN' || order.status === 'BEKEKEN';
  if (open && order.deliveryTerms === 'TE_BEPALEN') return 'Levertermijn invullen';
  if (open && order.freight === 'TE_BEPALEN') return 'Vracht invullen';

  return null;
}
