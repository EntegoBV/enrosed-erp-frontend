import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StockMovement } from '../../core/api/models';
import { ticaMoment } from '../tica/tica-format';

export function stockMovementDeletable(move: Pick<StockMovement, 'ticaSaleId' | 'deletable'>): boolean {
  return !move.ticaSaleId && move.deletable !== false;
}

@Component({
  selector: 'app-stock-movement-source',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (move().ticaSaleId; as saleId) {
      @if (move().sourceSoldAt) { <span>Verkoop {{ moment(move().sourceSoldAt!) }}</span> }
      <a routerLink="/tica" [queryParams]="{ sale: saleId }">TICA-bron en geschiedenis ›</a>
    }
  `,
  styles: `:host{display:block;font-size:11px;line-height:1.5;margin-top:3px}span{display:block;color:var(--muted)}a{display:inline-block;text-decoration:none}a:hover{text-decoration:underline}`,
})
export class StockMovementSource {
  readonly move = input.required<StockMovement>();
  readonly moment = ticaMoment;
}
