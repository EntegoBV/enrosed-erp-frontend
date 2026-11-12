import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StockMovement } from '../../core/api/models';
import { ticaDate, ticaMoment } from '../tica/tica-format';

/** A partner portal melding's movement (Veilingverkopen): booked by the melding, undone only by withdrawing it. */
export function isPartnerMovement(move: Pick<StockMovement, 'kind'>): boolean {
  return move.kind === 'PARTNER_SALE' || move.kind === 'PARTNER_BUYBACK';
}

export function stockMovementDeletable(move: Pick<StockMovement, 'kind' | 'ticaSaleId' | 'deletable'>): boolean {
  return !move.ticaSaleId && !isPartnerMovement(move) && move.deletable !== false;
}

/** The melding id in a partner movement's reference ("Veilingverkoop VV-12", "Ingetrokken: VV-12"), else null. */
export function partnerMovementReport(move: Pick<StockMovement, 'kind' | 'reference'>): number | null {
  if (!isPartnerMovement(move)) return null;
  const match = /\bVV-(\d+)\b/.exec(move.reference ?? '');
  return match ? Number(match[1]) : null;
}

/** A withdrawal's reversal ("Ingetrokken: VV-12"): the pieces of a withdrawn melding going back, nothing sold or bought back. */
export function isPartnerWithdrawal(move: Pick<StockMovement, 'kind' | 'reference'>): boolean {
  return isPartnerMovement(move) && /^\s*Ingetrokken\b/i.test(move.reference ?? '');
}

@Component({
  selector: 'app-stock-movement-source',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (move().ticaSaleId; as saleId) {
      @if (move().sourceSoldAt) { <span>Verkoop {{ moment(move().sourceSoldAt!) }}</span> }
      <a routerLink="/tica" [queryParams]="{ sale: saleId }">TICA-bron en geschiedenis ›</a>
    } @else if (partner()) {
      @if (move().sourceSoldAt) {
        <!-- A reversal carries the melding's day (sourceSoldAt = its sold_on), not the day it was withdrawn. -->
        @if (withdrawal()) { <span>Ingetrokken · melding van {{ day(move().sourceSoldAt!) }}</span> }
        @else { <span>{{ move().kind === 'PARTNER_BUYBACK' ? 'Teruggekocht' : 'Verkocht' }} op {{ day(move().sourceSoldAt!) }}</span> }
      }
      <a routerLink="/veilingverkopen" [queryParams]="report() ? { melding: report() } : null">Veilingverkopen ›</a>
    }
  `,
  styles: `:host{display:block;font-size:11px;line-height:1.5;margin-top:3px}span{display:block;color:var(--muted)}a{display:inline-block;text-decoration:none}a:hover{text-decoration:underline}`,
})
export class StockMovementSource {
  readonly move = input.required<StockMovement>();
  readonly moment = ticaMoment;
  readonly partner = computed(() => isPartnerMovement(this.move()));
  readonly report = computed(() => partnerMovementReport(this.move()));
  readonly withdrawal = computed(() => isPartnerWithdrawal(this.move()));

  /** The melding's sold day ("10-11-2026"): a partner movement's sourceSoldAt is the day Frans sold, not a moment. */
  day(value: string): string {
    return ticaDate(value.slice(0, 10));
  }
}
