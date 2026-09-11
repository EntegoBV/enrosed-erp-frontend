import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Instalment, Payee } from '../../core/api/models';

type InstalmentDue = Instalment['due'];
type SettlementScope = 'NONE' | 'INSTALMENT' | 'GROUP';

export interface PurchasePaymentScopeChange {
  instalmentDue: InstalmentDue | null;
  settles: boolean;
}

let nextScopeId = 0;

/** Collects a deliberate allocation and settlement choice; saving belongs to the payment form. */
@Component({
  selector: 'app-purchase-payment-scope',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="payment-scope">
      @if (payee() === 'SUPPLIER' && (options().length || instalmentDue())) {
        <div class="payment-scope__assignment">
          <label [for]="fieldId">Toewijzen aan</label>
          <select class="select" [id]="fieldId" [ngModel]="instalmentDue() ?? ''"
                  [ngModelOptions]="{ standalone: true }" [attr.aria-describedby]="fieldId + '-hint'"
                  [disabled]="busy()" (ngModelChange)="chooseDue($event)">
            <option value="">Automatisch verdelen</option>
            @for (option of options(); track option.due) {
              <option [value]="option.due">{{ option.label }}</option>
            }
            @if (instalmentDue() && !knownDue()) {
              <option [value]="instalmentDue()">{{ dueLabel() }} · niet in huidig betaalplan</option>
            }
          </select>
          <small [id]="fieldId + '-hint'">{{ instalmentDue() ? 'Deze betaling telt mee voor de gekozen termijn.' : 'Deze betaling wordt over de open termijnen verdeeld.' }}</small>
        </div>
      }
      <fieldset class="payment-scope__settlement" [disabled]="busy()">
        <legend>Wat sluit deze betaling af?</legend>
        <div class="payment-scope__choices">
          <label class="payment-scope__choice" [class.is-selected]="scope() === 'NONE'">
            <input type="radio" [name]="fieldId + '-settlement'" value="NONE" [checked]="scope() === 'NONE'"
                   (change)="chooseScope('NONE')" />
            <span><b>Geen slot</b><small>Een restant blijft open</small></span>
          </label>
          @if (payee() === 'SUPPLIER' && (options().length || instalmentDue())) {
            <label class="payment-scope__choice" [class.is-selected]="scope() === 'INSTALMENT'" [class.is-disabled]="!knownDue()">
              <input type="radio" [name]="fieldId + '-settlement'" value="INSTALMENT" [checked]="scope() === 'INSTALMENT'"
                     [disabled]="!knownDue() || busy()" (change)="chooseScope('INSTALMENT')" />
              <span><b>Deze termijn</b><small>{{ knownDue() ? dueLabel() : 'Kies eerst een termijn' }}</small></span>
            </label>
          }
          <label class="payment-scope__choice" [class.is-selected]="scope() === 'GROUP'">
            <input type="radio" [name]="fieldId + '-settlement'" value="GROUP" [checked]="scope() === 'GROUP'"
                   (change)="chooseScope('GROUP')" />
            <span><b>{{ payee() === 'SUPPLIER' ? 'Hele leverancier' : 'Hele betaalgroep' }}</b><small>{{ groupLabel() }}</small></span>
          </label>
        </div>
      </fieldset>
      @if (scope() === 'INSTALMENT') {
        <p class="payment-scope__explanation" role="status"><b>{{ dueLabel() }} is hiermee afgerekend.</b> Andere termijnen veranderen niet. Een lager eindbedrag telt na opslaan mee als extra opbrengst.</p>
      } @else if (scope() === 'GROUP') {
        <p class="payment-scope__explanation payment-scope__explanation--group" role="status"><b>{{ payee() === 'SUPPLIER' ? 'De volledige leverancier wordt afgerekend.' : 'De volledige betaalgroep wordt afgerekend.' }}</b> {{ payee() === 'SUPPLIER' ? 'Er volgt geen leveranciersbetaling meer; alle resterende termijnen sluiten.' : 'Er volgt geen betaling meer voor ' + groupLabel() + '.' }}</p>
      }
    </div>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .payment-scope { min-width: 0; }
    .payment-scope__assignment { display: grid; gap: 7px; margin-bottom: 18px; }
    .payment-scope__assignment > label,
    .payment-scope__settlement legend { color: var(--ink); font-size: 12px; font-weight: 650; }
    .payment-scope__assignment .select { width: 100%; min-width: 0; max-width: 100%; min-height: 44px; }
    .payment-scope__assignment > small { color: var(--muted); font-size: 11px; line-height: 1.5; }
    .payment-scope__settlement { min-width: 0; margin: 0; padding: 0; border: 0; }
    .payment-scope__settlement legend { margin-bottom: 9px; }
    .payment-scope__choices { display: flex; flex-wrap: wrap; gap: 8px; }
    .payment-scope__choice {
      display: flex;
      align-items: flex-start;
      flex: 1 1 135px;
      min-width: 0;
      min-height: 66px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 11px;
      background: var(--surface);
      cursor: pointer;
      transition: border-color .16s, background-color .16s;
    }
    .payment-scope__choice input { flex-shrink: 0; width: 16px; height: 16px; margin: 2px 9px 0 0; accent-color: var(--rose); }
    .payment-scope__choice > span { display: grid; min-width: 0; gap: 5px; }
    .payment-scope__choice b { font-size: 12px; line-height: 1.4; font-weight: 650; }
    .payment-scope__choice small { color: var(--muted); font-size: 10px; line-height: 1.5; overflow-wrap: anywhere; }
    .payment-scope__choice.is-selected { border-color: var(--rose); background: var(--rose-soft); }
    .payment-scope__choice.is-selected b { color: var(--rose-dark); }
    .payment-scope__choice:focus-within { outline: 2px solid var(--rose); outline-offset: 2px; }
    .payment-scope__choice.is-disabled,
    .payment-scope__settlement:disabled .payment-scope__choice { opacity: .5; cursor: default; }
    .payment-scope__explanation { margin: 12px 0 0; padding: 11px 12px; border-radius: 10px; background: var(--rose-soft); color: var(--ink-2); font-size: 11px; line-height: 1.6; }
    .payment-scope__explanation b { display: block; font-weight: 650; }
    .payment-scope__explanation--group { background: var(--warn-soft); }
    @media (max-width: 540px) {
      .payment-scope__assignment .select { font-size: 16px; }
      .payment-scope__choices { display: grid; grid-template-columns: minmax(0, 1fr); gap: 7px; }
      .payment-scope__choice { min-height: 58px; padding: 10px 12px; }
      .payment-scope__choice > span { gap: 2px; }
      .payment-scope__choice b { font-size: 13px; }
      .payment-scope__choice small { font-size: 11px; }
    }
    @media (prefers-reduced-motion: reduce) { .payment-scope__choice { transition: none; } }
  `,
})
export class PurchasePaymentScope {
  readonly payee = input.required<Payee>();
  readonly instalmentDue = input<InstalmentDue | null>(null);
  readonly settles = input(false);
  readonly options = input<readonly { due: InstalmentDue; label: string }[]>([]);
  readonly groupLabel = input('Betaalgroep');
  readonly busy = input(false);
  readonly changed = output<PurchasePaymentScopeChange>();
  readonly fieldId = `payment-instalment-${++nextScopeId}`;
  readonly scope = computed<SettlementScope>(() => !this.settles() ? 'NONE'
    : this.payee() === 'SUPPLIER' && this.instalmentDue() !== null ? 'INSTALMENT' : 'GROUP');
  readonly knownDue = computed(() => this.instalmentDue() !== null
    && this.options().some(option => option.due === this.instalmentDue()));

  dueLabel(): string {
    const due = this.instalmentDue();
    return this.options().find(option => option.due === due)?.label
      ?? (due ? { ORDERED: 'Bij bestelling', SHIPPED: 'Bij vertrek', ARRIVED: 'Bij aankomst' }[due] : 'Termijn');
  }

  chooseDue(raw: string): void {
    if (this.busy() || this.payee() !== 'SUPPLIER') return;
    const due = raw === '' ? null : this.options().find(option => option.due === raw)?.due;
    if (due === undefined || due === this.instalmentDue()) return;
    // Changing the allocation never silently changes which obligation is closed.
    // The user confirms the new settlement scope separately.
    this.changed.emit({ instalmentDue: due, settles: false });
  }

  chooseScope(scope: SettlementScope): void {
    if (this.busy() || this.payee() === 'OTHER') return;
    if (scope === 'INSTALMENT' && (this.payee() !== 'SUPPLIER' || !this.knownDue())) return;
    this.changed.emit({
      instalmentDue: scope === 'GROUP' || this.payee() !== 'SUPPLIER' ? null : this.instalmentDue(),
      settles: scope !== 'NONE',
    });
  }
}
