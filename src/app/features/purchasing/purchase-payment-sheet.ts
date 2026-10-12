import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BankAccountsStore } from '../../core/api/bank-accounts';
import type { Currency, Payee, PurchaseCreditOffset } from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { DateField } from '../../shared/date-field';
import { Icon } from '../../shared/icon';
import { PaymentProofPicker } from '../../shared/payment-proof-picker';
import { EurPipe } from '../../shared/pipes';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { Sheet } from '../../shared/ui';
import { DUE_MOMENT, FREIGHT_TERM_LABEL, PAYEE_LABEL, PAYEE_ORDER, PAYEE_SHORT, type Due } from './purchase-payment-ledger';
import { formatEur } from './purchase-payment-menus';
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
  /** 'Afgeschreven in euro': the bank's debit of a USD/CNY payment, as typed and as parsed; empty means the order rate. */
  amountEurInput?: string;
  amountEur?: number | null;
  /** 'Dekt meer dan de goederen': the CIF sea freight and the inspection the supplier billed, in the payment's currency (a new supplier payment only). */
  freightAmount?: number | null;
  freightAmountInput?: string;
  separateAmount?: number | null;
  separateAmountInput?: string;
  /** Parts an earlier attempt already saved, so a retry links them to the bank line without posting them again. */
  partIds?: number[];
  /** 'Ook als bankbeweging noteren' and the chosen account key; '' lets the remembered or the only account stand in. */
  toBank?: boolean;
  bankAccount?: string;
  /** 'Factuur': the supplier's or forwarder's invoice, filed with the goods payment. */
  invoiceFiles?: File[];
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
          <app-segmented label="Aan wie?" [variant]="desk() ? 'desk' : 'ios'" [options]="payeeOptions()"
                         [value]="pay.payee" (changed)="payeeChange.emit($any($event))" />
        </div>
        @if (creditOffset(); as offset) {
          <p class="pay-sheet__note" role="note">Verrekend tegoed{{ offset.sourceOrderNumber ? ' van ' + offset.sourceOrderNumber : '' }}: bedrag, munt en ontvanger horen bij dat tegoed. Verwijder deze betaling om de verrekening ongedaan te maken.</p>
        }
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
              <input class="input num right" [id]="ids + '-amount'" type="text" inputmode="decimal" autocomplete="off" [disabled]="busy() || !!creditOffset()"
                     [ngModel]="pay.amountInput" (ngModelChange)="amountInput.emit($event)" />
              <select class="input-affix__suffix" aria-label="Munt" [disabled]="busy() || !!creditOffset()" [ngModel]="pay.currency" (ngModelChange)="patch.emit({ currency: $event })">
                <option value="EUR">EUR</option><option value="USD">USD</option><option value="CNY">CNY</option>
              </select>
            </div>
            @if (pay.amountInput && pay.amount === null) { <span class="hint hint--warn" role="alert">Vul een positief bedrag in, bijvoorbeeld 1.046,95.</span> }
            @if (pay.currency !== 'EUR' && (pay.amount ?? 0) > 0 && !((pay.amountEur ?? 0) > 0)) {
              <span class="hint">Zonder bankbedrag geldt de orderkoers: ≈ {{ draftEur() | eur }}.</span>
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
          @if (pay.currency !== 'EUR') {
            <div class="field span-2 pay-sheet__bank">
              <label [for]="ids + '-eur'">Afgeschreven in euro <span class="opt"></span></label>
              <div class="input-affix">
                <input class="input num right" [id]="ids + '-eur'" type="text" inputmode="decimal" autocomplete="off" [disabled]="busy() || !!creditOffset()"
                       [placeholder]="rateEur() > 0 ? rateText() : ''" [ngModel]="pay.amountEurInput ?? ''" (ngModelChange)="amountEurInput.emit($event)" />
                <span class="input-affix__suffix">EUR</span>
              </div>
              @if (pay.amountEurInput && pay.amountEur === null) { <span class="hint hint--warn" role="alert">Vul een positief bedrag in, bijvoorbeeld 18.300,00.</span> }
              @else if (bankOff()) { <span class="hint hint--warn" role="status">Wijkt sterk af van de orderkoers — controleer bedrag en munt.</span> }
              @else { <span class="hint">{{ rateHint() }}</span> }
            </div>
          }
          @if (showParts()) {
            <details class="pay-sheet__scope span-2" [open]="partsOpen()" (toggle)="partsOpen.set($any($event.target).open)">
              <summary><span>Dekt meer dan de goederen</span><small>{{ partsSummary() }}</small><app-icon name="chevron-right" [size]="16" /></summary>
              <div class="pay-sheet__parts">
                @if (freightPart()) {
                  <div class="field">
                    <label [for]="ids + '-freight'">Zeevracht (CIF) <span class="opt"></span></label>
                    <div class="input-affix">
                      <input class="input num right" [id]="ids + '-freight'" type="text" inputmode="decimal" autocomplete="off" [disabled]="busy()"
                             [ngModel]="pay.freightAmountInput ?? ''" (ngModelChange)="partInput.emit({ part: 'freight', raw: $event })" />
                      <span class="input-affix__suffix">{{ pay.currency }}</span>
                    </div>
                    @if (pay.freightAmountInput && pay.freightAmount === null) { <span class="hint hint--warn" role="alert">Vul een positief bedrag in, of laat het leeg.</span> }
                    @else { <span class="hint">Telt voor de termijn {{ freightTerm }} van de leverancier.</span> }
                  </div>
                }
                <div class="field">
                  <label [for]="ids + '-separate'">Inspectie & andere kosten <span class="opt"></span></label>
                  <div class="input-affix">
                    <input class="input num right" [id]="ids + '-separate'" type="text" inputmode="decimal" autocomplete="off" [disabled]="busy()"
                           [ngModel]="pay.separateAmountInput ?? ''" (ngModelChange)="partInput.emit({ part: 'separate', raw: $event })" />
                    <span class="input-affix__suffix">{{ pay.currency }}</span>
                  </div>
                  @if (pay.separateAmountInput && pay.separateAmount === null) { <span class="hint hint--warn" role="alert">Vul een positief bedrag in, of laat het leeg.</span> }
                  @else { <span class="hint">Wat de leverancier voor ons voorschoot en doorrekende; komt als eigen betaling bij Inspectie & andere kosten.</span> }
                </div>
                <p class="pay-sheet__total">Totaal overschrijving: <b>{{ transferEur() | eur }}</b></p>
              </div>
            </details>
          }
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
        @if (bankLinked()) {
          <p class="pay-sheet__note pay-sheet__linked" role="note"><app-icon name="bank" [size]="14" /> Staat op de bank</p>
        } @else {
          <div class="pay-sheet__bank">
            <label class="pay-sheet__switch"><span>Ook als bankbeweging noteren<small>Eén uitgaande beweging voor deze overschrijving, met een verwijzing naar de betaling</small></span>
              <input [class]="desk() ? 'pay-sheet__check' : 'ios-switch'" type="checkbox" role="switch" [checked]="!!pay.toBank" [disabled]="busy()"
                     (change)="patch.emit({ toBank: $any($event.target).checked })" /></label>
            @if (pay.toBank) {
              @if (accounts().length) {
                <div class="pay-sheet__accounts" role="group" aria-label="Rekening">
                  @for (option of accounts(); track option.key) {
                    <button class="pay-sheet__chip pay-sheet__account" type="button" [attr.aria-pressed]="bankAccount() === option.key" [disabled]="busy()"
                            (click)="patch.emit({ bankAccount: option.key })">{{ option.label }}</button>
                  }
                </div>
                @if (future()) { <span class="hint hint--warn" role="status">Een bankbeweging kan niet in de toekomst liggen.</span> }
                @else if (!bankAccount()) { <span class="hint">Kies de rekening waarvan de betaling vertrok.</span> }
                @else { <span class="hint">{{ transferEur() | eur }} gaat als uitgaande beweging op {{ accountLabel() }}.</span> }
              } @else {
                <span class="hint">Nog geen rekening: vul eerst een saldo in bij Kosten & bank.</span>
              }
            }
          </div>
        }
        <app-payment-proof-picker title="Bewijs (bankafschrift)" [files]="pay.files" [maxFiles]="proofSlots() - invoiceFiles().length" [disabled]="busy()"
                                  (filesChange)="patch.emit({ files: $event })" />
        <app-payment-proof-picker title="Factuur" [files]="invoiceFiles()" [maxFiles]="proofSlots() - pay.files.length" [disabled]="busy()"
                                  (filesChange)="patch.emit({ invoiceFiles: $event })" />
        @if (pay.id; as id) {
          <button class="pay-sheet__delete" type="button" [disabled]="busy()" (click)="remove.emit(id)">Verwijderen</button>
        }
      </div>
      <div foot style="display:contents">
        <button class="btn" type="button" (click)="cancel.emit()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="busy() || !((pay.amount ?? 0) > 0) || pay.files.length + invoiceFiles().length > proofSlots() || !pay.paidOn || partsInvalid() || bankBlocked()"
                (click)="confirm.emit()">{{ busy() ? 'Bezig…' : (pay.id ? 'Wijziging bewaren' : 'Betaling bewaren') }}</button>
      </div>
    </app-sheet>
  `,
})
export class PurchasePaymentSheet {
  private readonly viewport = inject(DesktopViewport);
  private readonly bankAccounts = inject(BankAccountsStore);
  private readonly today = new Date().toISOString().slice(0, 10);
  readonly draft = input.required<PurchasePaymentDraft>();
  readonly chips = input<readonly { label: string; amount: number; due?: Due | null }[]>([]);
  readonly instalmentOptions = input<readonly { due: Due; label: string }[]>([]);
  /** What is still open for the chosen term or payee. */
  readonly openHint = input<{ label: string; amountEur: number } | null>(null);
  readonly overageEur = input(0);
  readonly draftEur = input(0);
  /** The foreign amount at the order rate: the placeholder and yardstick of 'Afgeschreven in euro'. */
  readonly rateEur = input(0);
  /** The payee of the stored payment when editing, to warn about a move. */
  readonly originalPayee = input<Payee | null>(null);
  readonly originalSettles = input(false);
  readonly busy = input(false);
  readonly loading = input(false);
  readonly proofSlots = input(5);
  readonly groupLabel = input('Leverancier');
  /** Editing a payment that offsets a credit of another container: amount, currency and payee stay as the credit set them. */
  readonly creditOffset = input<PurchaseCreditOffset | null>(null);
  /** The supplier invoices the sea freight (CIF), so a transfer may cover it. */
  readonly cif = input(false);
  /** What the whole transfer costs in euro: the goods and the parts, as the host works it out. */
  readonly transferEur = input(0);
  /** The payment already sits on the bank: no second line is offered. */
  readonly bankLinked = input(false);
  /** The account the chips stand on (the host applies the remembered or the only one). */
  readonly bankAccount = input('');
  readonly patch = output<Partial<PurchasePaymentDraft>>();
  readonly amountInput = output<string>();
  readonly amountEurInput = output<string>();
  readonly partInput = output<{ part: 'freight' | 'separate'; raw: string }>();
  readonly payeeChange = output<Payee>();
  readonly confirm = output<void>();
  readonly cancel = output<void>();
  readonly remove = output<number>();

  readonly ids = `payment-sheet-${++nextSheetId}`;
  readonly desk = computed(() => this.viewport.active());
  readonly payees: SegmentOption[] = PAYEE_ORDER.map(payee => ({ id: payee, label: PAYEE_SHORT[payee], ariaLabel: PAYEE_LABEL[payee] }));
  readonly payeeOptions = computed<SegmentOption[]>(() => this.creditOffset()
    ? this.payees.map(option => ({ ...option, disabled: option.id !== this.draft().payee })) : this.payees);
  /** Open by default when the payment already counts for a term or settles something. */
  readonly scopeOpen = linkedSignal<number | null, boolean>({
    source: () => this.draft().id ?? null,
    computation: () => untracked(() => { const pay = this.draft(); return pay.settles || pay.instalmentDue != null; }),
  });
  readonly scopeSummary = computed(() => {
    const pay = this.draft();
    const due = pay.payee === 'SUPPLIER' ? pay.instalmentDue : null;
    const term = due ? this.instalmentOptions().find(option => option.due === due)?.label ?? (due === 'FREIGHT' ? FREIGHT_TERM_LABEL : 'termijn ' + DUE_MOMENT[due]) : null;
    return `${term ? 'Telt voor ' + term : 'Automatisch'} · ${!pay.settles ? 'niet afgerekend' : due ? 'rekent termijn af' : 'rekent alles af'}`;
  });
  /** The order-rate estimate as a typable placeholder, e.g. 18.450,00. */
  readonly rateText = computed(() => this.rateEur().toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  readonly rateHint = computed(() => `Leeg laten = orderkoers${this.rateEur() > 0 ? ' (' + formatEur(this.rateEur()) + ')' : ''}. Vul het afgeschreven bedrag in voor het echte koersverschil.`);
  /** More than 15 % away from the order rate: probably the foreign amount typed as euro. Warns, never blocks. */
  readonly bankOff = computed(() => {
    const bank = this.draft().amountEur ?? null;
    const rate = this.rateEur();
    return bank !== null && bank > 0 && rate > 0 && Math.abs(bank - rate) / rate > 0.15;
  });
  readonly moved = computed(() => {
    const from = this.originalPayee();
    const to = this.draft().payee;
    if (!this.draft().id || from === null || from === to) return null;
    return this.originalSettles()
      ? `De afrekening bij ${PAYEE_LABEL[from]} vervalt; deze betaling telt voortaan bij ${PAYEE_LABEL[to]}.`
      : `Deze betaling telt voortaan bij ${PAYEE_LABEL[to]}.`;
  });

  /* ---- 'Dekt meer dan de goederen': a new supplier transfer may pay the freight and the inspection too */
  readonly freightTerm = FREIGHT_TERM_LABEL;
  private readonly partsFilled = computed(() => { const pay = this.draft(); return (pay.freightAmount ?? 0) > 0 || (pay.separateAmount ?? 0) > 0; });
  /** Offered for a new supplier payment; a saved goods payment keeps showing parts a failed attempt left behind. */
  readonly showParts = computed(() => { const pay = this.draft(); return pay.payee === 'SUPPLIER' && !this.creditOffset() && (!pay.id || this.partsFilled()); });
  readonly freightPart = computed(() => this.cif() || this.instalmentOptions().some(option => option.due === 'FREIGHT'));
  readonly partsOpen = linkedSignal<number | null, boolean>({
    source: () => this.draft().id ?? null,
    computation: () => untracked(() => this.partsFilled()),
  });
  readonly partsSummary = computed(() => {
    const pay = this.draft();
    const money = (value: number) => value.toLocaleString('nl-BE', { style: 'currency', currency: pay.currency });
    const parts = [...(pay.freightAmount ? ['Zeevracht ' + money(pay.freightAmount)] : []), ...(pay.separateAmount ? ['Inspectie ' + money(pay.separateAmount)] : [])];
    return parts.length ? parts.join(' · ') : 'Alleen goederen';
  });
  readonly partsInvalid = computed(() => {
    const pay = this.draft();
    return (!!pay.freightAmountInput && pay.freightAmount === null) || (!!pay.separateAmountInput && pay.separateAmount === null);
  });

  /* ---- 'Ook als bankbeweging noteren' */
  readonly accounts = this.bankAccounts.options;
  readonly accountLabel = computed(() => this.accounts().find(option => option.key === this.bankAccount())?.label ?? '');
  readonly future = computed(() => this.draft().paidOn > this.today);
  /** The switch is on but the line could not be written: no account, or a day the bank has not reached. */
  readonly bankBlocked = computed(() => !!this.draft().toBank && !this.bankLinked() && (!this.bankAccount() || this.future()));
  readonly invoiceFiles = computed(() => this.draft().invoiceFiles ?? []);

  constructor() {
    void this.bankAccounts.load();
  }
}
