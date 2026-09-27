import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { PurchasePayment } from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { EurPipe } from '../../shared/pipes';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { Sheet } from '../../shared/ui';
import { DUE_MOMENT, type Due, type PayeeLedger, type SettleCarrier } from './purchase-payment-ledger';
import { formatEur } from './purchase-payment-menus';

/** The editor's settle draft. */
export interface PurchaseSettleDraft {
  payee: PayeeLedger['payee'];
  scope: 'GROUP' | 'TERM';
  due: Due | null;
  paymentId: number | null;
}

/**
 * Afrekenen: close a payee or one supplier term at what was actually paid.
 * No money moves; one existing payment gets the 'rekent af' mark, and the
 * sheet shows beforehand what that does to the cost.
 */
@Component({
  selector: 'app-purchase-settle-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet, Segmented, EurPipe],
  template: `
    @let settle = draft();
    @let item = payee();
    <app-sheet [title]="'Afrekenen · ' + item.label" variant="ios" (closed)="cancel.emit()">
      <div body class="settle-sheet" [attr.inert]="busy() ? '' : null">
        @if (termChoice()) {
          <div class="settle-sheet__field">
            <span class="settle-sheet__label">Wat reken je af?</span>
            <app-segmented label="Wat reken je af?" [variant]="desk() ? 'desk' : 'ios'" [options]="scopeOptions()"
                           [value]="settle.scope" (changed)="pickScope($event)" />
          </div>
          @if (settle.scope === 'TERM') {
            <label class="settle-sheet__field"><span class="settle-sheet__label">Termijn</span>
              <select class="select" [ngModel]="settle.due" (ngModelChange)="scope.emit({ scope: 'TERM', due: $event })">
                @for (term of choosableTerms(); track term.due) { <option [value]="term.due">{{ term.label }}</option> }
              </select>
            </label>
          }
        }
        @let figures = amounts();
        <dl class="wk-equation settle-sheet__receipt">
          <div><dt>Afspraak</dt><dd>{{ figures.agreed | eur }}</dd></div>
          <div><dt><span class="wk-equation__op" aria-hidden="true">−</span>Betaald</dt><dd>{{ figures.paid | eur }}</dd></div>
          <div class="is-sub"><dt>Verschil</dt><dd>@if (figures.difference < 0) { {{ -figures.difference | eur }} minder } @else if (figures.difference > 0) { {{ figures.difference | eur }} meer } @else { — }</dd></div>
          <div class="is-total"><dt>Na afrekenen open</dt><dd>{{ 0 | eur }}</dd></div>
        </dl>
        <p class="settle-sheet__consequence" [class.is-gain]="figures.difference < 0" [class.is-loss]="figures.difference > 0">
          @if (figures.difference < 0) { {{ -figures.difference | eur }} minder betaald: telt als voordeel in de nacalculatie. }
          @else if (figures.difference > 0) { {{ figures.difference | eur }} meer betaald: telt als extra kost in de nacalculatie. }
          @else { Precies betaald: er verandert niets aan de kost. }
        </p>
        @if (carriers().length) {
          <label class="settle-sheet__field"><span class="settle-sheet__label">Markering op betaling</span>
            <select class="select" [ngModel]="settle.paymentId" (ngModelChange)="carrier.emit(+$event)">
              @for (option of carriers(); track option.id) { <option [value]="option.id">{{ carrierLabel(option) }}</option> }
            </select>
          </label>
          @if (selected(); as chosen) {
            @if (chosen.reallocates) {
              <p class="settle-sheet__note settle-sheet__note--warn">Deze betaling hoort nu bij {{ termLabel(chosen.instalmentDue) }}. Na afrekenen telt ze voor de hele leverancier en verdeelt het systeem ze opnieuw over de termijnen.</p>
            }
          }
          <p class="settle-sheet__note">Er wordt geen nieuwe betaling geboekt. De gekozen betaling krijgt de markering ‘rekent af’.</p>
        } @else if (settle.scope === 'TERM') {
          <p class="settle-sheet__note settle-sheet__note--warn">Er is nog geen betaling aan {{ termLabel(settle.due) }} gekoppeld. Kies ‘Alles aan de leverancier’ of koppel eerst een betaling aan deze termijn.</p>
          @if (item.rows[0]; as row) {
            <button class="btn btn--sm" type="button" (click)="editCarrier.emit(row.payment)">Betaling aanpassen…</button>
          }
        } @else {
          <p class="settle-sheet__note settle-sheet__note--warn">Afrekenen kan pas na minstens één betaling. Moet er niets meer betaald worden? Pas dan het bedrag aan bij Kosten.</p>
        }
        @if (item.canUndoSettle) {
          <button class="settle-sheet__undo" type="button" (click)="undo.emit()">Afrekening ongedaan maken</button>
        }
      </div>
      <div foot style="display:contents">
        <button class="btn" type="button" (click)="cancel.emit()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="busy() || settle.paymentId === null" (click)="confirm.emit()">
          {{ busy() ? 'Bezig…' : 'Afrekenen' }}
        </button>
      </div>
    </app-sheet>
  `,
})
export class PurchaseSettleSheet {
  private readonly viewport = inject(DesktopViewport);
  readonly draft = input.required<PurchaseSettleDraft>();
  readonly payee = input.required<PayeeLedger>();
  readonly carriers = input<readonly SettleCarrier[]>([]);
  /** The server sent per-term figures; only then can one term be settled. */
  readonly canonical = input(false);
  readonly busy = input(false);
  readonly scope = output<{ scope: 'GROUP' | 'TERM'; due: Due | null }>();
  readonly carrier = output<number>();
  readonly confirm = output<void>();
  readonly undo = output<void>();
  readonly cancel = output<void>();
  readonly editCarrier = output<PurchasePayment>();

  readonly desk = computed(() => this.viewport.active());
  readonly termChoice = computed(() => this.payee().payee === 'SUPPLIER' && this.canonical() && this.payee().terms.length > 0);
  readonly scopeOptions = computed<SegmentOption[]>(() => [
    { id: 'GROUP', label: 'Alles aan ' + this.payee().label }, { id: 'TERM', label: 'Eén termijn' },
  ]);
  readonly choosableTerms = computed(() => this.payee().terms.filter(term => !term.settled || term.due === this.draft().due));
  readonly selected = computed(() => this.carriers().find(option => option.id === this.draft().paymentId) ?? null);
  /** Agreed and paid of what is being settled, and the difference that becomes final. */
  readonly amounts = computed(() => {
    const draft = this.draft();
    const payee = this.payee();
    const term = draft.scope === 'TERM' ? payee.terms.find(item => item.due === draft.due) : undefined;
    const agreed = Math.round((term ? term.fullEur : payee.agreedEur ?? 0) * 100);
    const paid = Math.round((term ? term.paidEur : payee.paidEur) * 100);
    return { agreed: agreed / 100, paid: paid / 100, difference: (paid - agreed) / 100 };
  });

  pickScope(id: string): void {
    if (id !== 'TERM') { this.scope.emit({ scope: 'GROUP', due: null }); return; }
    const terms = this.payee().terms;
    const due = this.draft().due ?? terms.find(term => term.canSettle)?.due ?? terms.find(term => !term.settled)?.due ?? terms[0]?.due ?? null;
    this.scope.emit({ scope: 'TERM', due });
  }

  termLabel(due: Due | null): string {
    if (!due) return 'deze termijn';
    return this.payee().terms.find(term => term.due === due)?.label ?? 'de termijn ' + DUE_MOMENT[due];
  }

  /** Date and amount, then the term for the supplier (only it has terms) or the description for the others. */
  carrierLabel(option: SettleCarrier): string {
    const date = option.paidOn.split('-').reverse().join('-');
    const detail = option.payee === 'SUPPLIER'
      ? (option.instalmentDue ? this.termLabel(option.instalmentDue) : 'automatisch verdeeld') : option.label;
    return [date, formatEur(option.amountEur), detail].filter(Boolean).join(' · ');
  }
}
