import type { TicaSale, TicaStockSettingsWrite } from '../../core/api/tica-api';
import { validTicaDay } from './tica-format';

export function ticaStockLabel(sale: Pick<TicaSale, 'stockStatus' | 'stockQuantity'>): string {
  switch (sale.stockStatus) {
    case 'POSTED': return (sale.stockQuantity ?? 0) < 0 ? 'Retour bijgeschreven' : 'Voorraad afgeboekt';
    case 'REVERSED': return 'Afboeking teruggedraaid';
    case 'BEFORE_START': return 'Vóór start voorraadkoppeling';
    case 'DISABLED': return 'Voorraadkoppeling uit';
    case 'PRODUCT_UNMATCHED': return 'Product koppelen';
    case 'LOCATION_UNMAPPED': return 'Voorraadlocatie kiezen';
    case 'UNIT_MISMATCH': return 'Verkoopeenheid controleren';
    case 'INVALID_QUANTITY': return 'Aantal controleren';
    default: return 'Voorraadstatus niet beschikbaar';
  }
}

export function ticaStockNeedsAttention(sale: Pick<TicaSale, 'stockStatus'>): boolean {
  return ['PRODUCT_UNMATCHED', 'LOCATION_UNMAPPED', 'UNIT_MISMATCH', 'INVALID_QUANTITY'].includes(sale.stockStatus ?? '');
}

export function ticaStockSettingsError(draft: TicaStockSettingsWrite): string | null {
  if (draft.fromDate && !validTicaDay(draft.fromDate)) return 'Kies een geldige startdatum.';
  if (!draft.enabled) return null;
  if (!draft.fromDate) return 'Kies vanaf welke verkoopdatum TICA de voorraad mag bijwerken.';
  if (!draft.locations.some(row => row.stockLocationId !== null)) return 'Koppel eerst minstens één TICA-vestiging aan een voorraadlocatie.';
  return null;
}
