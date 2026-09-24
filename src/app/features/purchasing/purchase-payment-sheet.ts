import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Currency, Payee } from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { DateField } from '../../shared/date-field';
import { Icon } from '../../shared/icon';
import { PaymentProofPicker } from '../../shared/payment-proof-picker';
import { EurPipe } from '../../shared/pipes';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { Sheet } from '../../shared/ui';
import { DUE_MOMENT, PAYEE_LABEL, PAYEE_ORDER, PAYEE_SHORT, type Due } from './purchase-payment-ledger';
import { PurchasePaymentScope } from './purchase-payment-scope';

/** The editor's payment draft, as the sheet edits it. */
export interface PurchasePaymentDraft {
  id?: number | null;
  amount: number | null;
  amountInput: string;
  currency: Currency;
  paidOn: string;
  label: string;
  payee: Payee;
  files: File[];
  settles: boolean;
  instalmentDue?: Due | null;
}

let nextSheetId = 0;

/**
 * Record or correct one payment, on the desk and the phone alike. The sheet
 * only shows and reports; the editor keeps the draft, the rules and the save.
 */
@Component({
  selector: 'app-purchase-payment-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet, Segmented, DateField, PaymentProofPicker, PurchasePaymentScope, Icon, EurPipe],
  template: `
    @let pay = draft();
    <app-sheet [title]="pay.id ? 'Betaling aanpassen' : 'Betaling noteren'" variant="ios" [wide]="true" (closed)="cancel.emit()">
      <div body class="pay-sheet" [attr.inert]="busy() ? '' : null">
        <div class="pay-sheet__who">
          <span class="pay-sheet__label">Aan wie?</span>
          <app-segmented label="Aan wie?" [variant]="desk() ? 'desk' : 'ios'" [options]="payees"
                         [value]="pay.payee" (changed)="payeeChange.emit($any($event))" />
        </div>
        @if (moved(); as text) { <p class="pay-sheet__note pay-sheet__note--warn" role="status">{{ text }}</p> }
        @if (!pay.id && pay.payee === 'SUPPLIER' && chips().length) {
          <div class="pay-sheet__chips" role="group" aria-label="Snel invullen">
            @for (chip of chips(); track chip.label) {
              <button class="pay-sheet__chip" type="button" [disabled]="busy() || loading()"
                      (click)="patch.emit({ amount: chip.amount, amountInput: ('' + chip.amount).replace('.', ','), currency: 'EUR', label: chip.label, instalmentDue: chip.due ?? null, settles: false })">
                {{ chip.label }}<small>{{ chip.amount | eur }}</small>
              </button>
            }
          </div>
        }
        <div class="form-grid pay-sheet__grid">
          <div class="field pay-sheet__amount">
            <label [for]="ids + '-amount'">Bedrag</label>
            <div class="input-affix">
              <input class="input num right" [id]="ids + '-amount'" type="text" inputmode="decimal" autocomplete="off" [disabled]="busy()"
                     [ngModel]="pay.amountInput" (ngModelChange)="amountInput.emit($event)" />
              <select class="input-affix__suffix" aria-label="Munt" [disabled]="busy()" [ngModel]="pay.currency" (ngModelChange)="patch.emit({ currency: $event })">
                <option value="EUR">EUR</option><option value="USD">USD</option><option value="CNY">CNY</option>
              </select>
            </div>
            @if (pay.amountInput && pay.amount === null) { <span class="hint hint--warn" role="alert">Vul een positief bedrag in, bijvoorbeeld 1.046,95.</span> }
            @if (pay.currency !== 'EUR' && (pay.amount ?? 0) > 0) {
              <span class="hint">≈ {{ draftEur() | eur }} · EUR-bedrag van deze boeking; bij een bedragwijziging geldt de huidige orderkoers.</span>
            }
            @if (overageEur() > 0) {
              <span class="hint hint--warn">Hiermee is {{ overageEur() | eur }} meer betaald dan afgesproken. Klopt het bedrag? Bankkosten noteer je apart bij Bijkomende kosten.</span>
            } @else if (pay.payee !== 'OTHER' && openHint(); as hint) {
              @if (hint.amountEur > 0) { <span class="hint">Nog open {{ pay.instalmentDue ? 'voor' : 'bij' }} {{ hint.label }}: {{ hint.amountEur | eur }}</span> }
            }
          </div>
          <div class="field">
            <label [for]="ids + '-date'">Betaald op</label>
            <app-date-field [fieldId]="ids + '-date'" [value]="pay.paidOn" (valueChange)="patch.emit({ paidOn: $event })" />
          </div>
          <div class="field span-2">
            <label [for]="ids + '-label'">Omschrijving <span class="opt"></span></label>
            <input class="input" [id]="ids + '-label'" placeholder="Bijv. aanbetaling 30%, saldo, slotbetaling"
                   [disabled]="busy()" [ngModel]="pay.label" (ngModelChange)="patch.emit({ label: $event })" />
          </div>
        </div>
        @if (pay.payee !== 'OTHER') {
          <details class="pay-sheet__scope" [open]="scopeOpen()" (toggle)="scopeOpen.set($any($event.target).open)">
            <summary><span>Termijn en afrekenen</span><small>{{ scopeSummary() }}</small><app-icon name="chevron-right" [size]="16" /></summary>
            <app-purchase-payment-scope [payee]="pay.payee" [instalmentDue]="pay.instalmentDue ?? null" [settles]="pay.settles"
                                        [options]="instalmentOptions()" [groupLabel]="groupLabel()" [busy]="busy() || loading()"
                                        (changed)="patch.emit($event)" />
          </details>
        }
        <app-payment-proof-picker title="Bewijs (bankafschrift)" [files]="pay.files" [maxFiles]="proofSlots()" [disabled]="busy()"
                                  (filesChange)="patch.emit({ files: $event })" />
        @if (pay.id; as id) {
          <button class="pay-sheet__delete" type="button" [disabled]="busy()" (click)="remove.emit(id)">Verwijderen</button>
        }
      </div>
      <div foot style="display:contents">
        <button class="btn" type="button" (click)="cancel.emit()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="busy() || !((pay.amount ?? 0) > 0) || pay.files.length > proofSlots() || !pay.paidOn"
                (click)="confirm.emit()">{{ busy() ? 'Bezig…' : (pay.id ? 'Wijziging bewaren' : 'Betaling bewaren') }}</button>
      </div>
    </app-sheet>
  `,
})
export class PurchasePaymentSheet {
  private readonly viewport = inject(DesktopViewport);
  readonly draft = input.required<PurchasePaymentDraft>();
  readonly chips = input<readonly { label: string; amount: number; due?: Due | null }[]>([]);
  readonly instalmentOptions = input<readonly { due: Due; label: string }[]>([]);
  /** What is still open for the chosen term or payee. */
  readonly openHint = input<{ label: string; amountEur: number } | null>(null);
  readonly overageEur = input(0);
  readonly draftEur = input(0);
  /** The payee of the stored payment when editing, to warn about a move. */
  readonly originalPayee = input<Payee | null>(null);
  readonly originalSettles = input(false);
  readonly busy = input(false);
  readonly loading = input(false);
  readonly proofSlots = input(5);
  readonly groupLabel = input('Leverancier');
  readonly patch = output<Partial<PurchasePaymentDraft>>();
  readonly amountInput = output<string>();
  readonly payeeChange = output<Payee>();
  readonly confirm = output<void>();
  readonly cancel = output<void>();
  readonly remove = output<number>();

  readonly ids = `payment-sheet-${++nextSheetId}`;
  readonly desk = computed(() => this.viewport.active());
  readonly payees: SegmentOption[] = PAYEE_ORDER.map(payee => ({ id: payee, label: PAYEE_SHORT[payee], ariaLabel: PAYEE_LABEL[payee] }));
  /** Open by default when the payment already counts for a term or settles something. */
  readonly scopeOpen = linkedSignal<number | null, boolean>({
    source: () => this.draft().id ?? null,
    computation: () => untracked(() => { const pay = this.draft(); return pay.settles || pay.instalmentDue != null; }),
  });
  readonly scopeSummary = computed(() => {
    const pay = this.draft();
    const due = pay.payee === 'SUPPLIER' ? pay.instalmentDue : null;
    const term = due ? this.instalmentOptions().find(option => option.due === due)?.label ?? 'termijn ' + DUE_MOMENT[due] : null;
    return `${term ? 'Telt voor ' + term : 'Automatisch'} · ${!pay.settles ? 'niet afgerekend' : due ? 'rekent termijn af' : 'rekent alles af'}`;
  });
  readonly moved = computed(() => {
    const from = this.originalPayee();
    const to = this.draft().payee;
    if (!this.draft().id || from === null || from === to) return null;
    return this.originalSettles()
      ? `De afrekening bij ${PAYEE_LABEL[from]} vervalt; deze betaling telt voortaan bij ${PAYEE_LABEL[to]}.`
      : `Deze betaling telt voortaan bij ${PAYEE_LABEL[to]}.`;
  });
}
