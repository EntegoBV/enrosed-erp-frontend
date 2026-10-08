import { ChangeDetectionStrategy, Component, OnInit, computed, input, output, signal } from '@angular/core';
import type { ClosingArticle, ClosingView, Decision, WriteDownRow } from '../../core/api/inventory-models';
import { EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import { decimalText, parseDecimal } from './closing-decision-sheet';
import { writeDownPreview } from './inventory-closing';
import { inventoryUnit } from './inventory-unit';

export interface WriteDownChoice {
  /** Null = every piece that has no waardevermindering yet. */
  quantity: number | null;
  marketUnitEur: number;
  reasonCode: string;
  reason: string;
}

/**
 * "Waardevermindering · {product}": a number of pieces (or all that are
 * left), the market value per piece, a reason and a mandatory note. The
 * preview follows the server's rule (the dearest lots first, never above
 * the acquisition value); when a saved decision is edited its own rows are
 * released first. It only asks: the step builds and emits the write.
 */
@Component({
  selector: 'app-closing-write-down-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, EurPipe],
  template: `
    <app-sheet [title]="'Waardevermindering · ' + article().productName" (closed)="closed.emit()">
      <div body class="inv-sheet">
        <div class="field-row">
          <div class="field">
            <label for="inv-wd-quantity">Aantal {{ unit().plural }}</label>
            <input class="input num" id="inv-wd-quantity" type="text" inputmode="numeric" autocomplete="off" placeholder="alle" [value]="quantity()" (input)="quantity.set($any($event.target).value)" />
            <span class="hint">Leeg = alle {{ unit().plural }} die nog geen waardevermindering hebben@if (unit().isDisplay && unit().piecesPerDisplay) { · 1 display = {{ unit().piecesPerDisplay }} stuks }</span>
          </div>
          <div class="field">
            <label for="inv-wd-market">Marktwaarde per {{ unit().singular }}</label>
            <div class="input-affix">
              <input class="input num" id="inv-wd-market" type="text" inputmode="decimal" autocomplete="off" [value]="market()" (input)="market.set($any($event.target).value)" />
              <span class="input-affix__suffix">EUR</span>
            </div>
          </div>
        </div>
        <div class="field">
          <label for="inv-wd-reason">Reden</label>
          <select class="select" id="inv-wd-reason" (change)="reasonCode.set($any($event.target).value || null)">
            <option value="">Kies een reden</option>
            @for (option of reasons(); track option.code) { <option [value]="option.code" [selected]="reasonCode() === option.code">{{ option.label }}</option> }
          </select>
        </div>
        <div class="field">
          <label for="inv-wd-note">Toelichting</label>
          <textarea class="textarea" id="inv-wd-note" rows="3" maxlength="1000" [value]="reason()" (input)="reason.set($any($event.target).value)"></textarea>
        </div>
        <p class="inv-sheet__preview" aria-live="polite">
          Aanschafwaarde {{ article().costValueEur | eur }} blijft zichtbaar
          @if (preview(); as figures) { · waardevermindering {{ figures.amountEur | eur }} · waarde {{ figures.valueEur | eur }} }
        </p>
        <p class="inv-sheet__help inv-sheet__last">De waarde kan nooit hoger zijn dan de aanschafwaarde. De duurste partijen eerst.</p>
      </div>
      <div foot style="display:contents">
        @if (decision()) {
          <button class="btn btn--danger" type="button" [disabled]="busy()" (click)="remove.emit()">Waardevermindering verwijderen</button>
        } @else {
          <button class="btn" type="button" (click)="closed.emit()">Annuleren</button>
        }
        <button class="btn btn--primary" type="button" [disabled]="!canSave()" (click)="submit()">{{ busy() ? 'Bezig…' : 'Bewaren' }}</button>
      </div>
    </app-sheet>
  `,
})
export class ClosingWriteDownSheet implements OnInit {
  readonly article = input.required<ClosingArticle>();
  /** The stored rows of this product, of every decision. */
  readonly writeDowns = input.required<readonly WriteDownRow[]>();
  readonly reasons = input.required<ClosingView['writeDownReasons']>();
  /** The saved decision that is being edited, or null for a new one. */
  readonly decision = input<Decision | null>(null);
  readonly busy = input(false);
  readonly save = output<WriteDownChoice>();
  readonly remove = output<void>();
  readonly closed = output<void>();

  readonly quantity = signal('');
  readonly market = signal('');
  readonly reasonCode = signal<string | null>(null);
  readonly reason = signal('');

  readonly unit = computed(() => inventoryUnit(this.article()));
  private readonly pieces = computed(() => parseDecimal(this.quantity()));
  private readonly marketUnitEur = computed(() => parseDecimal(this.market()));
  private readonly quantityValid = computed(() => {
    const pieces = this.pieces();
    return pieces === null || (Number.isInteger(pieces) && pieces >= 1);
  });
  private readonly marketValid = computed(() => {
    const market = this.marketUnitEur();
    return market !== null && Number.isFinite(market) && market >= 0;
  });

  readonly preview = computed(() => {
    const market = this.marketUnitEur();
    if (market === null || !this.marketValid() || !this.quantityValid()) return null;
    return writeDownPreview(this.article().layers, this.writeDowns(), this.pieces(), market, this.decision()?.id ?? null);
  });
  readonly canSave = computed(() =>
    !this.busy() && this.quantityValid() && this.marketValid() && !!this.reasonCode() && !!this.reason().trim());

  /* Once, on opening: a recompute behind the sheet must not wipe what is being typed. */
  ngOnInit(): void {
    const decision = this.decision();
    if (!decision) return;
    this.quantity.set(decimalText(decision.quantity));
    this.market.set(decimalText(decision.unitValueEur));
    this.reasonCode.set(decision.reasonCode);
    this.reason.set(decision.reason ?? '');
  }

  submit(): void {
    const marketUnitEur = this.marketUnitEur();
    const reasonCode = this.reasonCode();
    if (marketUnitEur === null || !reasonCode || !this.canSave()) return;
    this.save.emit({ quantity: this.pieces(), marketUnitEur, reasonCode, reason: this.reason().trim() });
  }
}
