import { QuoteStatus, SalesOrder } from '../../core/api/models';

/** Eén plek voor hoe een offertestatus eruitziet. */
export const STATUS_LABEL: Record<QuoteStatus, string> = {
  CONCEPT: 'Concept',
  VERZONDEN: 'Verzonden',
  BEKEKEN: 'Bekeken',
  WIJZIGING_GEVRAAGD: 'Wijziging gevraagd',
  GEACCEPTEERD: 'Geaccepteerd',
  AFGEWEZEN: 'Afgewezen',
  VERLOPEN: 'Verlopen',
};

export function statusClass(status: QuoteStatus): string {
  switch (status) {
    case 'GEACCEPTEERD': return 'ok';
    case 'AFGEWEZEN': return 'danger';
    case 'WIJZIGING_GEVRAAGD': return 'gold';
    case 'VERZONDEN': return 'rose';
    case 'BEKEKEN': return 'blue';
    default: return 'neutral';
  }
}

/**
 * Ligt deze offerte bij ons of bij de klant?
 *
 * Op een lijst met tientallen orders is de status alleen niet genoeg: dat er
 * "Verzonden" staat zegt niet of je erop moet wachten of ermee aan de slag
 * moet. Dit is de vraag die je je bij elke regel stelt, dus staat het antwoord
 * er meteen bij.
 */
export function actionNeeded(order: SalesOrder): string | null {
  if (order.status === 'WIJZIGING_GEVRAAGD') return 'Voorstel beoordelen';
  if (order.status === 'AFGEWEZEN') return 'Heropenen of laten';
  if (order.status === 'CONCEPT') return 'Nog niet verstuurd';

  /* Een verstuurde offerte met een open post wacht op ons, niet op de klant. */
  const open = order.status === 'VERZONDEN' || order.status === 'BEKEKEN';
  if (open && order.deliveryTerms === 'TE_BEPALEN') return 'Levertermijn invullen';
  if (open && order.freight === 'TE_BEPALEN') return 'Vracht invullen';

  return null;
}
