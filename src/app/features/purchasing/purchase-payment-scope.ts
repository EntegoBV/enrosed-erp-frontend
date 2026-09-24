import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Instalment, Payee } from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';

type InstalmentDue = Instalment['due'];
type SettlementScope = 'NONE' | 'INSTALMENT' | 'GROUP';

export interface PurchasePaymentScopeChange {
  instalmentDue: InstalmentDue | null;
  settles: boolean;
}

let nextScopeId = 0;

/**
 * Collects a deliberate allocation and settlement choice; saving belongs to
 * the payment form. The choice is a segmented control on a desk and an iOS
 * checkmark list on a phone (styles in styles/purchase-payments.scss).
 */
@Component({
  selector: 'app-purchase-payment-scope',
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="payment-scope">
      @if (payee() === 'SUPPLIER' && (options().length || instalmentDue())) {
        <div class="payment-scope__assignment">
          <label [for]="fieldId">Voor termijn</label>
          <select class="select" [id]="fieldId" [ngModel]="instalmentDue() ?? ''"
                  [ngModelOptions]="{ standalone: true }" [attr.aria-describedby]="fieldId + '-hint'"
                  [disabled]="busy()" (ngModelChange)="chooseDue($event)">
            <option value="">Automatisch verdelen over open termijnen</option>
            @for (option of options(); track option.due) {
              <option [value]="option.due">{{ option.label }}</option>
            }
            @if (instalmentDue() && !knownDue()) {
              <option [value]="instalmentDue()">{{ dueLabel() }} · niet in huidig betaalplan</option>
            }
          </select>
          <small [id]="fieldId + '-hint'">{{ instalmentDue() ? 'Deze betaling telt voor de gekozen termijn.' : 'Deze betaling wordt over de open termijnen verdeeld.' }}</small>
        </div>
      }
      <div class="payment-scope__settlement" role="radiogroup" [attr.aria-labelledby]="fieldId + '-legend'">
        <span class="payment-scope__legend" [id]="fieldId + '-legend'">Afrekenen?</span>
        <div class="payment-scope__choices" [class.wk-seg]="desk()" [class.ios-group]="!desk()"
             [style.--seg-n]="choices().length" [style.--seg-i]="choiceIndex()">
          @for (choice of choices(); track choice.scope) {
            <button type="button" role="radio" [class.wk-seg__opt]="desk()" [class.ios-cell]="!desk()"
                    [attr.aria-checked]="scope() === choice.scope" [title]="choice.title + ' · ' + choice.hint"
                    [disabled]="busy() || choice.disabled" (click)="chooseScope(choice.scope)">
              <span class="payment-scope__choice"><b>{{ choice.title }}</b><small>{{ choice.hint }}</small></span>
              @if (!desk() && scope() === choice.scope) { <app-icon class="ios-cell__tick" name="tick" [size]="20" /> }
            </button>
          }
        </div>
      </div>
      @if (scope() === 'INSTALMENT') {
        <p class="payment-scope__explanation" role="status"><b>{{ dueLabel() }} is hiermee afgerekend.</b> Andere termijnen veranderen niet. Een lager eindbedrag telt als voordeel in de nacalculatie.</p>
      } @else if (scope() === 'GROUP') {
        <p class="payment-scope__explanation" role="status"><b>Alles aan {{ groupLabel() }} is hiermee afgerekend.</b> Er blijft niets open; een lager eindbedrag telt als voordeel in de nacalculatie.</p>
      }
    </div>
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
  private readonly viewport = inject(DesktopViewport);
  readonly desk = computed(() => this.viewport.active());
  /** The three answers to 'Afrekenen?'; a term only exists for the supplier with a plan. */
  readonly choices = computed(() => {
    const term = this.payee() === 'SUPPLIER' && (this.options().length > 0 || this.instalmentDue() !== null);
    return [
      { scope: 'NONE' as const, title: 'Nee, er volgt nog een betaling', hint: 'Wat nog open staat, blijft open', disabled: false },
      ...(term ? [{ scope: 'INSTALMENT' as const, title: 'Ja, deze termijn is klaar',
        hint: this.knownDue() ? this.dueLabel() : 'Kies eerst een termijn', disabled: !this.knownDue() }] : []),
      { scope: 'GROUP' as const, title: `Ja, alles aan ${this.groupLabel()} is klaar`, hint: 'Er volgt geen betaling meer', disabled: false },
    ];
  });
  readonly choiceIndex = computed(() => Math.max(0, this.choices().findIndex(choice => choice.scope === this.scope())));
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
