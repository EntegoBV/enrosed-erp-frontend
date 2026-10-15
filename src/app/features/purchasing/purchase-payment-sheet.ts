import { bankAmountsMatch } from '../../shared/bank-transaction-options';
import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { BankStatementLine } from '../../core/api/banking-api';
import { BankTransactionPicker } from '../../shared/bank-transaction-picker';
import { bankTransactionDay } from '../../shared/bank-transaction-options';
import { BankAccountsStore } from '../../core/api/bank-accounts';
import type {
  Currency, Payee, PurchaseCreditOffset, PurchaseDocument, PurchaseInvoice, PurchasePayment, PurchasePaymentWrite,
} from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { DateField } from '../../shared/date-field';
import { Icon } from '../../shared/icon';
import { PaymentProofPicker } from '../../shared/payment-proof-picker';
import { EurPipe } from '../../shared/pipes';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { Sheet } from '../../shared/ui';
import { DUE_MOMENT, FREIGHT_TERM_LABEL, PAYEE_LABEL, PAYEE_ORDER, PAYEE_SHORT, type Due, type LedgerPart } from './purchase-payment-ledger';
import { formatEur } from './purchase-payment-menus';
import { PurchasePaymentScope } from './purchase-payment-scope';
import { parsePurchasePaymentAmount } from './purchase-payment-amount';
import { dayText, invoiceCandidates, invoiceOption, resolveInvoice } from './purchase-invoices';
import { inspectionSplitBlocked, pendingLinkPlan, pendingPartEur } from './purchase-payment-links';

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
  /**
   * Frozen when the goods payment was first posted: its euro as the ledger
   * stored it and the parts in order, so a retry posts only what is still
   * pending, unchanged, and the bank line keeps the typed debit.
   */
  planned?: { goodsEur: number; parts: PurchasePaymentWrite[] };
  /** The ids of the planned parts already saved, in order, so a retry links them to the bank line without posting them again. */
  partIds?: number[];
  /** 'Ook als bankbeweging noteren' and the chosen account key; '' lets the remembered or the only account stand in. */
  toBank?: boolean;
  bankAccount?: string;
  bankTransaction?: BankStatementLine | null;
  bankLinkPending?: boolean;
  bankLinkComplete?: boolean;
  bankSavedPayment?: PurchasePayment;
  bankLinkError?: string;
  /** 'Factuur': the chosen invoice; null = automatisch. Sent on a PUT only when the select changed (invoiceIdChanged). */
  invoiceId?: number | null;
  invoiceIdChanged?: boolean;
  /** 'Factuur toevoegen…' inline: saved (upload, then the invoice) before the payment. */
  newInvoice?: { open: boolean; number: string; invoiceDate: string; amountInput: string; amount: number | null; currency: Currency; file: File | null };
  /** What the inline block created on an earlier try, so a retry never uploads or creates it twice. */
  createdInvoiceId?: number;
  createdDocumentId?: number;
  /** 'Inspectie via leverancier' on the inspection part of a new supplier transfer; unset counts as ticked. */
  inspectionViaSupplier?: boolean;
  /** 'Inspectie afsplitsen' of a saved goods payment: the part in the payment's currency. */
  inspectionSplitInput?: string;
  inspectionSplit?: number | null;
  /** The goods payment's euro before the split, frozen at the first try so a retry sends the same body. */
  inspectionExpectedEur?: number;
  /** The ids of every transfer of the payment (the root first); one id for a payment never split. */
  groupIds?: number[];
  /** Bank transactions picked to link, for the part pendingPartId (the payment's own id when never split). */
  pendingLines?: BankStatementLine[];
  pendingPartId?: number | null;
  /** Corrections of unlinked transfers of a payment paid in parts, by their id. */
  partEdits?: Record<number, { amountInput: string; amount: number | null; amountEurInput?: string; amountEur?: number | null }>;
}

let nextSheetId = 0;

/**
 * Record or correct one payment, on the desk and the phone alike. A saved
 * payment shows its bank transactions (the betaalbewijs), its proof files and
 * its invoice; files and transactions are added and removed here, there is no
 * separate 'Bewijs toevoegen'. The sheet only shows and reports; the editor
 * keeps the draft, the rules and the save.
 */
@Component({
  selector: 'app-purchase-payment-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet, Segmented, DateField, PaymentProofPicker, PurchasePaymentScope, Icon, EurPipe, BankTransactionPicker],
  template: `
    @let pay = draft();
    <app-sheet [title]="pay.id ? 'Betaling aanpassen' : 'Betaling noteren'" variant="ios" [wide]="true" (closed)="cancel.emit()">
      <div body class="pay-sheet" [attr.inert]="busy() ? '' : null">
        <div class="pay-sheet__who" [attr.inert]="pay.bankLinkPending ? '' : null">
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
              <button class="pay-sheet__chip" type="button" [disabled]="busy() || loading() || !!pay.bankLinkPending || !!pay.bankTransaction"
                      (click)="patch.emit({ amount: chip.amount, amountInput: ('' + chip.amount).replace('.', ','), currency: 'EUR', label: chip.label, instalmentDue: chip.due ?? null, settles: false })">
                {{ chip.label }}<small>{{ chip.amount | eur }}</small>
              </button>
            }
          </div>
        }
        @if (!pay.id) {
          @if (!bankLinked() && !creditOffset()) {
            <app-bank-transaction-picker direction="OUTGOING" [amount]="transferEur()" [selected]="pay.bankTransaction ?? null" [disabled]="busy() || !!pay.bankLinkPending" (selectedChange)="chooseBank($event)" />
          }
        } @else if (!creditOffset()) {
          <!-- Banktransacties: the transaction is the proof; a payment paid in parts lists one line per transfer. -->
          <section class="pay-sheet__bankblock" aria-label="Banktransacties">
            <span class="pay-sheet__label">Banktransacties</span>
            <ul class="pay-sheet__lines">
              @for (part of parts(); track part.id) {
                @if (lineOf(part); as line) {
                  <li class="pay-sheet__line">
                    <span class="pay-sheet__linecopy"><b>{{ lineText(line) }}</b>@if (line.reference) { <small>{{ line.reference }}</small> }</span>
                    <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="unlinkLine.emit(line)">Losmaken</button>
                  </li>
                } @else if (part.onBank) {
                  <li class="pay-sheet__line"><span class="pay-sheet__linecopy"><b>{{ dayShort(part.paidOn) }} · {{ part.amountEur | eur }}</b><small>Staat op de bank</small></span></li>
                } @else if (grouped()) {
                  <li class="pay-sheet__line pay-sheet__line--open">
                    <span class="pay-sheet__linecopy"><b>{{ dayShort(part.paidOn) }} · nog niet op de bank</b></span>
                    <div class="pay-sheet__partfields">
                      <div class="field">
                        <label [for]="ids + '-part-' + part.id">Bedrag</label>
                        <div class="input-affix">
                          <input class="input num right" [id]="ids + '-part-' + part.id" type="text" inputmode="decimal" autocomplete="off" [disabled]="busy()"
                                 [ngModel]="partAmountInput(part)" (ngModelChange)="editPart(part, 'amount', $event)" />
                          <span class="input-affix__suffix">{{ part.currency }}</span>
                        </div>
                        @if (partInvalid(part)) { <span class="hint hint--warn" role="alert">Vul een positief bedrag in.</span> }
                      </div>
                      @if (part.currency !== 'EUR') {
                        <div class="field">
                          <label [for]="ids + '-part-eur-' + part.id">Afgeschreven in euro <span class="opt"></span></label>
                          <div class="input-affix">
                            <input class="input num right" [id]="ids + '-part-eur-' + part.id" type="text" inputmode="decimal" autocomplete="off" [disabled]="busy()"
                                   [ngModel]="partEurInput(part)" (ngModelChange)="editPart(part, 'eur', $event)" />
                            <span class="input-affix__suffix">EUR</span>
                          </div>
                        </div>
                      }
                    </div>
                    <div class="pay-sheet__lineactions">
                      @if (roundOnServer()) { <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="pickFor(part.id)">Koppelen</button> }
                      <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="removePart.emit(part)">Deel verwijderen</button>
                    </div>
                  </li>
                } @else {
                  <li class="pay-sheet__line pay-sheet__line--open">
                    <span class="pay-sheet__linecopy"><b>{{ part.amountEur | eur }} nog niet op de bank</b></span>
                    <button class="btn btn--sm" type="button" [disabled]="busy() || !!pay.bankLinkPending" (click)="pickFor(part.id)">Banktransactie koppelen</button>
                  </li>
                }
                @if (pay.pendingPartId === part.id) {
                  @for (line of pay.pendingLines ?? []; track line.id) {
                    <li class="pay-sheet__line pay-sheet__line--pending">
                      <span class="pay-sheet__linecopy"><b>{{ lineText(line) }}</b><small>wordt gekoppeld</small></span>
                      <button class="btn btn--sm" type="button" [disabled]="busy() || !!pay.bankLinkPending" [attr.aria-label]="'Niet koppelen: ' + lineText(line)" (click)="dropPending(line)">×</button>
                    </li>
                  }
                  @if (picking() === part.id && pickMore()) {
                    <li class="pay-sheet__line pay-sheet__line--picker">
                      <app-bank-transaction-picker direction="OUTGOING" [amount]="partEur(part)" [selected]="null" [startOpen]="true" [exclude]="excluded()"
                                                   [disabled]="busy() || !!pay.bankLinkPending" (selectedChange)="pickLine(part.id, $event)" />
                    </li>
                  }
                }
              }
            </ul>
            @if (pendingMessage(); as message) { <span class="hint hint--warn" role="alert">{{ message }}</span> }
            <span class="hint">De banktransactie is het betaalbewijs; een bankafschrift toevoegen kan, maar hoeft niet.</span>
          </section>
        }
        @if (pay.bankLinkError) { <p class="pay-sheet__note pay-sheet__note--warn" role="alert">{{ pay.bankLinkError }}</p> }
        <div class="form-grid pay-sheet__grid" [attr.inert]="pay.bankLinkPending ? '' : null">
          @if (grouped()) {
            <div class="field pay-sheet__amount">
              <span class="label">Bedrag</span>
              <span class="input num right">{{ groupTotal() | eur }}</span>
            </div>
            <div class="field">
              <span class="label">Betaald op</span>
              <span class="input">{{ dayLong(newestDay()) }}</span>
            </div>
            <p class="hint span-2">Verdeeld over {{ parts().length }} transacties; een deel dat niet op de bank staat pas je hier aan.</p>
          } @else {
            <div class="field pay-sheet__amount">
              <label [for]="ids + '-amount'">Bedrag</label>
              <div class="input-affix">
                <input class="input num right" [id]="ids + '-amount'" type="text" inputmode="decimal" autocomplete="off" [disabled]="busy() || !!creditOffset() || (!!pay.bankTransaction && pay.currency === 'EUR') || linkedSingle()"
                       [ngModel]="pay.amountInput" (ngModelChange)="amountInput.emit($event)" />
                <select class="input-affix__suffix" aria-label="Munt" [disabled]="busy() || !!creditOffset() || !!pay.bankTransaction || linkedSingle()" [ngModel]="pay.currency" (ngModelChange)="patch.emit({ currency: $event })">
                  <option value="EUR">EUR</option><option value="USD">USD</option><option value="CNY">CNY</option>
                </select>
              </div>
              @if (pay.amountInput && pay.amount === null) { <span class="hint hint--warn" role="alert">Vul een positief bedrag in, bijvoorbeeld 1.046,95.</span> }
              @if (linkedSingle()) { <span class="hint">Staat op de bank: maak de banktransactie eerst los om bedrag of datum te wijzigen.</span> }
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
              @if (pay.bankTransaction || linkedSingle()) { <span class="input">{{ dayLong(pay.paidOn) }}</span> } @else {
                <app-date-field [fieldId]="ids + '-date'" [value]="pay.paidOn" (valueChange)="patch.emit({ paidOn: $event })" />
              }
            </div>
            @if (pay.currency !== 'EUR') {
              <div class="field span-2 pay-sheet__bank">
                <label [for]="ids + '-eur'">Afgeschreven in euro <span class="opt"></span></label>
                <div class="input-affix">
                  <input class="input num right" [id]="ids + '-eur'" type="text" inputmode="decimal" autocomplete="off" [disabled]="busy() || !!creditOffset() || frozen() || !!pay.bankTransaction || linkedSingle()"
                         [placeholder]="rateEur() > 0 ? rateText() : ''" [ngModel]="pay.amountEurInput ?? ''" (ngModelChange)="amountEurInput.emit($event)" />
                  <span class="input-affix__suffix">EUR</span>
                </div>
                @if (pay.amountEurInput && pay.amountEur === null) { <span class="hint hint--warn" role="alert">Vul een positief bedrag in, bijvoorbeeld 18.300,00.</span> }
                @else if (bankOff()) { <span class="hint hint--warn" role="status">Wijkt sterk af van de orderkoers — controleer bedrag en munt.</span> }
                @else { <span class="hint">{{ rateHint() }}</span> }
              </div>
            }
          }
          @if (showParts()) {
            <details class="pay-sheet__scope span-2" [open]="partsOpen()" (toggle)="partsOpen.set($any($event.target).open)">
              <summary><span>Dekt meer dan de goederen</span><small>{{ partsSummary() }}</small><app-icon name="chevron-right" [size]="16" /></summary>
              <div class="pay-sheet__parts">
                @if (freightPart()) {
                  <div class="field">
                    <label [for]="ids + '-freight'">Zeevracht (CIF) <span class="opt"></span></label>
                    <div class="input-affix">
                      <input class="input num right" [id]="ids + '-freight'" type="text" inputmode="decimal" autocomplete="off" [disabled]="busy() || frozen()"
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
                    <input class="input num right" [id]="ids + '-separate'" type="text" inputmode="decimal" autocomplete="off" [disabled]="busy() || frozen()"
                           [ngModel]="pay.separateAmountInput ?? ''" (ngModelChange)="partInput.emit({ part: 'separate', raw: $event })" />
                    <span class="input-affix__suffix">{{ pay.currency }}</span>
                  </div>
                  @if (pay.separateAmountInput && pay.separateAmount === null) { <span class="hint hint--warn" role="alert">Vul een positief bedrag in, of laat het leeg.</span> }
                  @else { <span class="hint">Wat de leverancier voor ons voorschoot en doorrekende; komt als eigen betaling bij Inspectie & andere kosten.</span> }
                  @if (roundOnServer() && (pay.separateAmount ?? 0) > 0) {
                    <label class="pay-sheet__switch pay-sheet__via"><span>Inspectie via leverancier<small>Zelfde transactie als de goederen; de banktransactie is het betaalbewijs van beide.</small></span>
                      <input class="pay-sheet__check" type="checkbox" [checked]="pay.inspectionViaSupplier ?? true" [disabled]="busy() || frozen()"
                             (change)="patch.emit({ inspectionViaSupplier: $any($event.target).checked })" /></label>
                  }
                </div>
                <p class="pay-sheet__total">Totaal overschrijving: <b>{{ transferEur() | eur }}</b></p>
              </div>
            </details>
          }
          @if (showInspectionSplit()) {
            <details class="pay-sheet__scope span-2" [open]="!!pay.inspectionSplitInput">
              <summary><span>Inspectie afsplitsen</span><small>{{ pay.inspectionSplit ? splitSummary() : 'Alleen goederen' }}</small><app-icon name="chevron-right" [size]="16" /></summary>
              <div class="pay-sheet__parts">
                <div class="field">
                  <label [for]="ids + '-inspection'">Waarvan inspectie via leverancier <span class="opt"></span></label>
                  <div class="input-affix">
                    <input class="input num right" [id]="ids + '-inspection'" type="text" inputmode="decimal" autocomplete="off" [disabled]="busy() || (splitBlocked() && !pay.inspectionSplitInput)"
                           [ngModel]="pay.inspectionSplitInput ?? ''" (ngModelChange)="inspectionInput($event)" />
                    <span class="input-affix__suffix">{{ pay.currency }}</span>
                  </div>
                  @if (splitBlocked()) { <span class="hint" [class.hint--warn]="!!pay.inspectionSplitInput" [attr.role]="pay.inspectionSplitInput ? 'alert' : null">Eerst de banktransacties koppelen, daarna de inspectie afsplitsen.</span> }
                  @else if (pay.inspectionSplitInput && !splitValid()) { <span class="hint hint--warn" role="alert">Vul een bedrag in dat kleiner is dan de betaling.</span> }
                  @else { <span class="hint">Wordt een eigen betaling bij Inspectie & andere kosten op dezelfde banktransactie; het totaal blijft gelijk.</span> }
                </div>
              </div>
            </details>
          }
          <div class="field span-2">
            <label [for]="ids + '-label'">Omschrijving <span class="opt"></span></label>
            <input class="input" [id]="ids + '-label'" placeholder="Bijv. aanbetaling 30%, saldo, slotbetaling"
                   [disabled]="busy() || !!pay.bankLinkPending" [ngModel]="pay.label" (ngModelChange)="patch.emit({ label: $event })" />
          </div>
        </div>
        @if (pay.payee !== 'OTHER') {
          <details class="pay-sheet__scope" [open]="scopeOpen()" (toggle)="scopeOpen.set($any($event.target).open)">
            <summary><span>Termijn en afrekenen</span><small>{{ scopeSummary() }}</small><app-icon name="chevron-right" [size]="16" /></summary>
            <app-purchase-payment-scope [payee]="pay.payee" [instalmentDue]="pay.instalmentDue ?? null" [settles]="pay.settles"
                                        [options]="instalmentOptions()" [groupLabel]="groupLabel()" [busy]="busy() || loading() || !!pay.bankLinkPending"
                                        (changed)="patch.emit($event)" />
          </details>
        }
        @if (roundOnServer()) {
          <div class="field pay-sheet__invoice">
            <label [for]="ids + '-invoice'">Factuur</label>
            <select class="select" [id]="ids + '-invoice'" [disabled]="busy() || !!pay.bankLinkPending" [ngModel]="pay.invoiceId ?? null" (ngModelChange)="patch.emit({ invoiceId: $event, invoiceIdChanged: true })">
              <option [ngValue]="null">{{ automaticLabel() }}</option>
              @for (invoice of candidates(); track invoice.id) {
                <option [ngValue]="invoice.id">{{ invoice.payee !== pay.payee ? 'via leverancier · ' : '' }}{{ option(invoice) }}</option>
              }
            </select>
            <span class="pay-sheet__invoicelinks">
              @if (!pay.newInvoice?.open) { <button class="wk-link" type="button" [disabled]="busy()" (click)="openNewInvoice()">Factuur toevoegen…</button> }
              @if (chosenInvoice()?.documentId; as documentId) { <button class="wk-link" type="button" (click)="openDocument.emit(documentId)">Factuur openen</button> }
            </span>
            @if (pay.newInvoice?.open) {
              @let fresh = pay.newInvoice!;
              <div class="pay-sheet__newinvoice form-grid">
                <div class="field">
                  <label [for]="ids + '-inv-number'">Factuurnummer</label>
                  <input class="input" [id]="ids + '-inv-number'" maxlength="64" placeholder="Bijv. CI-2026-118" [disabled]="busy() || pay.createdInvoiceId != null"
                         [ngModel]="fresh.number" (ngModelChange)="patchInvoice({ number: $event })" />
                </div>
                <div class="field">
                  <label [for]="ids + '-inv-date'">Factuurdatum</label>
                  <app-date-field [fieldId]="ids + '-inv-date'" [value]="fresh.invoiceDate" (valueChange)="patchInvoice({ invoiceDate: $event })" />
                </div>
                <div class="field">
                  <label [for]="ids + '-inv-amount'">Bedrag</label>
                  <div class="input-affix">
                    <input class="input num right" [id]="ids + '-inv-amount'" type="text" inputmode="decimal" autocomplete="off" [disabled]="busy() || pay.createdInvoiceId != null"
                           [ngModel]="fresh.amountInput" (ngModelChange)="patchInvoice({ amountInput: $event, amount: parse($event) })" />
                    <select class="input-affix__suffix" aria-label="Munt van de factuur" [disabled]="busy() || pay.createdInvoiceId != null" [ngModel]="fresh.currency" (ngModelChange)="patchInvoice({ currency: $event })">
                      <option value="EUR">EUR</option><option value="USD">USD</option><option value="CNY">CNY</option>
                    </select>
                  </div>
                  @if (fresh.amountInput && fresh.amount === null) { <span class="hint hint--warn" role="alert">Vul een positief bedrag in.</span> }
                </div>
                <div class="field">
                  <label [for]="ids + '-inv-file'">Bestand <span class="opt"></span></label>
                  <input class="input" [id]="ids + '-inv-file'" type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx" [disabled]="busy() || pay.createdDocumentId != null"
                         (change)="patchInvoice({ file: $any($event.target).files?.[0] ?? null })" />
                </div>
                @if (pay.createdInvoiceId == null) {
                  <button class="wk-link span-2 pay-sheet__nonew" type="button" [disabled]="busy()" (click)="patch.emit({ newInvoice: undefined })">Geen nieuwe factuur</button>
                }
              </div>
            }
          </div>
        }
        @if (pay.bankTransaction) {
          <p class="pay-sheet__note">De bestaande banktransactie wordt gekoppeld. Er komt geen extra bankbeweging bij.</p>
        } @else if (bankLinked() && !pay.id) {
          <p class="pay-sheet__note pay-sheet__linked" role="note"><app-icon name="bank" [size]="14" /> Staat op de bank</p>
        } @else if (toBankOffered()) {
          <div class="pay-sheet__tobank">
            <label class="pay-sheet__switch"><span>Ook als bankbeweging noteren<small>Eén uitgaande beweging voor deze overschrijving, met een verwijzing naar de betaling</small></span>
              <input [class]="desk() ? 'pay-sheet__check' : 'ios-switch'" type="checkbox" role="switch" [checked]="!!pay.toBank" [disabled]="busy() || !!pay.bankLinkPending"
                     (change)="patch.emit({ toBank: $any($event.target).checked })" /></label>
            @if (pay.toBank) {
              @if (accounts().length) {
                <div class="pay-sheet__accounts" role="group" aria-label="Rekening">
                  @for (option of accounts(); track option.key) {
                    <button class="pay-sheet__chip pay-sheet__account" type="button" [attr.aria-pressed]="bankAccount() === option.key" [disabled]="busy() || !!pay.bankLinkPending"
                            (click)="patch.emit({ bankAccount: option.key })">{{ option.label }}</button>
                  }
                </div>
                @if (future()) { <span class="hint hint--warn" role="status">Een bankbeweging kan niet in de toekomst liggen.</span> }
                @else if (!bankAccount()) { <span class="hint">Kies de rekening waarvan de betaling vertrok.</span> }
                @else { <span class="hint">{{ transferEur() | eur }} gaat als uitgaande beweging op {{ accountLabel() }}.</span> }
              } @else if (accountsLoading()) {
                <span class="hint">Rekeningen laden…</span>
              } @else {
                <span class="hint">Nog geen rekening: vul eerst een saldo in bij Kosten & bank.</span>
              }
            }
          </div>
        }
        @if (!creditOffset()) {
          @if (proofFiles().length) {
            <section class="pay-sheet__bankblock" aria-label="Betaalbewijs (bestanden)">
              <span class="pay-sheet__label">Betaalbewijs (bestanden)</span>
              <ul class="pay-sheet__lines">
                @for (file of proofFiles(); track file.id) {
                  <li class="pay-sheet__line">
                    <button class="wk-link pay-sheet__filename" type="button" (click)="openDocument.emit(file.id)">{{ file.originalFilename }}</button>
                    <button class="btn btn--sm" type="button" [disabled]="busy()" [attr.aria-label]="'Bestand ' + file.originalFilename + ' verwijderen'" (click)="removeProof.emit(file)">×</button>
                  </li>
                }
              </ul>
            </section>
          }
          <app-payment-proof-picker title="Bankafschrift toevoegen (optioneel)" [files]="pay.files" [maxFiles]="proofSlots()"
                                    [disabled]="busy() || !!pay.bankLinkPending" (filesChange)="patch.emit({ files: $event })" />
        }
        @if (pay.id && !grouped()) {
          <button class="pay-sheet__delete" type="button" [disabled]="busy() || !!pay.bankLinkPending" (click)="remove.emit(pay.id)">Verwijderen</button>
        }
      </div>
      <div foot style="display:contents">
        <button class="btn" type="button" (click)="cancel.emit()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="busy() || !((pay.amount ?? 0) > 0) || pay.files.length > proofSlots() || !pay.paidOn || partsInvalid() || bankBlocked() || saveBlocked()"
                (click)="confirm.emit()">{{ busy() ? 'Bezig…' : pay.bankLinkPending ? 'Koppeling opnieuw proberen' : (pay.id ? 'Wijziging bewaren' : 'Betaling bewaren') }}</button>
      </div>
    </app-sheet>
  `,
})
export class PurchasePaymentSheet {
  private readonly viewport = inject(DesktopViewport);
  private readonly bankAccounts = inject(BankAccountsStore);
  readonly draft = input.required<PurchasePaymentDraft>();
  /** The bank's day, as the host books the line: a later 'Betaald op' cannot be on a statement yet. */
  readonly today = input.required<string>();
  readonly chips = input<readonly { label: string; amount: number; due?: Due | null }[]>([]);
  readonly instalmentOptions = input<readonly { due: Due; label: string; netted?: boolean }[]>([]);
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
  /** The server knows invoices and payments in parts (paymentRoundOnServer); false hides every new control. */
  readonly roundOnServer = input(false);
  /** Every invoice of the container, for the 'Factuur' select. */
  readonly invoices = input<readonly PurchaseInvoice[]>([]);
  /** The container's 'Inspectie via leverancier' flag. */
  readonly viaSupplier = input(false);
  /** Every payment of the container, for the 'Automatisch · …' label. */
  readonly orderPayments = input<readonly PurchasePayment[]>([]);
  /** The saved payment's transfers (one when never split), by day. */
  readonly parts = input<readonly LedgerPart[]>([]);
  /** The proof files of every transfer of the saved payment. */
  readonly proofFiles = input<readonly PurchaseDocument[]>([]);
  /** The bank lines the host has loaded, to show the linked ones. */
  readonly bankLines = input<readonly BankStatementLine[]>([]);
  readonly patch = output<Partial<PurchasePaymentDraft>>();
  readonly amountInput = output<string>();
  readonly amountEurInput = output<string>();
  readonly partInput = output<{ part: 'freight' | 'separate'; raw: string }>();
  readonly payeeChange = output<Payee>();
  readonly confirm = output<void>();
  readonly cancel = output<void>();
  readonly remove = output<number>();
  /** Immediate actions: unlink a bank transaction, remove a proof file, remove one unlinked transfer. */
  readonly unlinkLine = output<BankStatementLine>();
  readonly removeProof = output<PurchaseDocument>();
  readonly removePart = output<LedgerPart>();
  readonly openDocument = output<number>();

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
  /** The goods payment is posted and the split stands: a retry only notes what is still missing. */
  readonly frozen = computed(() => !!this.draft().planned);

  /* ---- 'Ook als bankbeweging noteren' */
  readonly accounts = this.bankAccounts.options;
  readonly accountsLoading = this.bankAccounts.loading;
  readonly accountLabel = computed(() => this.accounts().find(option => option.key === this.bankAccount())?.label ?? '');
  readonly future = computed(() => this.draft().paidOn > this.today());
  /** Never for a credit offset (no money left the bank), a payment paid in parts, a payment on the bank, or while transactions are picked. */
  readonly toBankOffered = computed(() => !this.creditOffset() && !this.grouped() && !(this.draft().pendingLines ?? []).length
    && !this.linkedSingle() && !this.bankLinked());
  /** The switch is on but the line could not be written: a day the bank has not reached, or no account once the readings are in. */
  readonly bankBlocked = computed(() => this.toBankOffered() && !this.draft().bankTransaction && !!this.draft().toBank
    && (this.future() || (!this.bankAccount() && !this.accountsLoading())));

  /* ---- Banktransacties of a saved payment */
  /** A payment paid in parts: its money is the sum of its transfers, corrected per unlinked transfer. */
  readonly grouped = computed(() => this.parts().length > 1);
  readonly groupTotal = computed(() => this.parts().reduce((sum, part) => sum + Math.round(part.amountEur * 100), 0) / 100);
  /** A never-split payment on the bank: its money stays as the bank booked it until it is unlinked. */
  readonly linkedSingle = computed(() => !!this.draft().id && this.parts().length === 1 && this.parts()[0].bankStatementLineId != null);
  /** The part the bank picker is open for. */
  readonly picking = signal<number | null>(null);
  readonly pendingPart = computed(() => this.parts().find(part => part.id === this.draft().pendingPartId) ?? null);
  readonly pendingPlan = computed(() => {
    const part = this.pendingPart();
    return part ? pendingLinkPlan(this.partEur(part), this.draft().pendingLines ?? [], this.roundOnServer()) : pendingLinkPlan(0, [], true);
  });
  readonly pendingMessage = computed(() => { const plan = this.pendingPlan(); return plan.kind === 'invalid' ? plan.message : null; });
  /** One more transaction can be picked: ten at most, one against an older server. */
  readonly pickMore = computed(() => { const count = (this.draft().pendingLines ?? []).length; return this.roundOnServer() ? count < 10 : count < 1; });
  readonly excluded = computed(() => [
    ...this.parts().map(part => part.bankStatementLineId).filter((id): id is number => id != null),
    ...(this.draft().pendingLines ?? []).map(line => line.id),
  ]);
  private readonly partEditsInvalid = computed(() => Object.values(this.draft().partEdits ?? {}).some(edit => edit.amount === null
    || (!!edit.amountEurInput && edit.amountEur === null)));
  /** Something typed or picked cannot be saved yet. */
  readonly saveBlocked = computed(() => this.pendingPlan().kind === 'invalid' || this.partEditsInvalid()
    || (!!this.draft().inspectionSplitInput && !this.splitValid()) || this.newInvoiceInvalid()
    // The inspection is split off only after a carve or a split over several transactions is done (a later save).
    || (this.splitBlocked() && (this.draft().inspectionSplit ?? 0) > 0));

  lineOf(part: LedgerPart): BankStatementLine | null {
    return part.bankStatementLineId == null ? null : this.bankLines().find(line => line.id === part.bankStatementLineId) ?? null;
  }
  /** '10/09/2026 · KBC · € 10.000,00'. */
  lineText(line: BankStatementLine): string {
    const account = this.accounts().find(option => option.key === line.account)?.label ?? line.account;
    return `${bankTransactionDay(line).split('-').reverse().join('/')} · ${account} · ${formatEur(Math.abs(line.amountEur))}`;
  }
  dayShort(iso: string): string { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }
  /** 'Betaald op' read-only: the day as the lists show it (a payment in parts: its newest transfer, as its ledger row). */
  dayLong(iso: string): string { return dayText(iso); }
  readonly newestDay = computed(() => { const parts = this.parts(); return parts[parts.length - 1]?.paidOn ?? this.draft().paidOn; });
  /** The euro of a transfer as it will be saved: a payment never split as the draft values it, a transfer its correction when typed, else as booked. */
  partEur(part: LedgerPart): number {
    return pendingPartEur(part, this.draft().partEdits?.[part.id], this.grouped() ? null : this.draftEur());
  }
  partAmountInput(part: LedgerPart): string { return this.draft().partEdits?.[part.id]?.amountInput ?? String(part.amount).replace('.', ','); }
  partEurInput(part: LedgerPart): string { return this.draft().partEdits?.[part.id]?.amountEurInput ?? ''; }
  partInvalid(part: LedgerPart): boolean { const edit = this.draft().partEdits?.[part.id]; return !!edit && edit.amount === null; }
  editPart(part: LedgerPart, field: 'amount' | 'eur', raw: string): void {
    const edits = { ...(this.draft().partEdits ?? {}) };
    const current = edits[part.id] ?? { amountInput: String(part.amount).replace('.', ','), amount: part.amount };
    edits[part.id] = field === 'amount'
      ? { ...current, amountInput: raw, amount: parsePurchasePaymentAmount(raw), amountEurInput: '', amountEur: null }
      : { ...current, amountEurInput: raw, amountEur: parsePurchasePaymentAmount(raw) };
    this.patch.emit({ partEdits: edits });
  }
  /** 'Banktransactie koppelen' / 'Koppelen': the picker opens for that part; picking for another part drops the other part's picks. */
  pickFor(partId: number): void {
    this.picking.set(partId);
    if (this.draft().pendingPartId !== partId) this.patch.emit({ pendingPartId: partId, pendingLines: [], toBank: false });
  }
  /** A pick that carves the payment or splits it over several transactions drops a typed inspection split: that comes after the link. */
  pickLine(partId: number, line: BankStatementLine | null): void {
    if (!line) return;
    const pending = this.draft().pendingPartId === partId ? this.draft().pendingLines ?? [] : [];
    const lines = [...pending.filter(item => item.id !== line.id), line];
    const part = this.parts().find(item => item.id === partId);
    const blocked = !!part && inspectionSplitBlocked(pendingLinkPlan(this.partEur(part), lines, this.roundOnServer()));
    this.patch.emit({ pendingPartId: partId, pendingLines: lines, toBank: false, ...(blocked ? { inspectionSplit: null, inspectionSplitInput: '' } : {}) });
  }
  dropPending(line: BankStatementLine): void {
    this.patch.emit({ pendingLines: (this.draft().pendingLines ?? []).filter(item => item.id !== line.id) });
  }

  /* ---- Inspectie afsplitsen: a saved goods payment to the supplier that also paid the inspection */
  readonly showInspectionSplit = computed(() => {
    const pay = this.draft();
    return this.roundOnServer() && !!pay.id && pay.payee === 'SUPPLIER' && this.originalPayee() === 'SUPPLIER' && !this.creditOffset()
      && !this.grouped() && pay.instalmentDue !== 'FREIGHT';
  });
  readonly splitBlocked = computed(() => inspectionSplitBlocked(this.pendingPlan()));
  readonly splitValid = computed(() => {
    const part = this.draft().inspectionSplit ?? null;
    const stored = this.parts()[0]?.amount ?? this.draft().amount ?? 0;
    return part !== null && part > 0 && Math.round(part * 100) < Math.round(stored * 100);
  });
  readonly splitSummary = computed(() => {
    const pay = this.draft();
    return (pay.inspectionSplit ?? 0).toLocaleString('nl-BE', { style: 'currency', currency: pay.currency }) + ' inspectie';
  });
  inspectionInput(raw: string): void {
    this.patch.emit({ inspectionSplitInput: raw, inspectionSplit: parsePurchasePaymentAmount(raw) });
  }

  /* ---- Factuur */
  /** The bank line the payment sits on (or is about to), for the automatic invoice of an inspection paid via the supplier. */
  private readonly draftLine = computed(() => this.parts()[0]?.bankStatementLineId ?? this.draft().bankTransaction?.id ?? null);
  readonly candidates = computed(() => invoiceCandidates(this.invoices(), this.draft().payee, this.draft().payee === 'SEPARATE' && this.viaSupplier()));
  /** The invoice 'Automatisch' stands for, by the server's rule. */
  private readonly automatic = computed(() => {
    const pay = this.draft();
    const id = resolveInvoice({ payee: pay.payee, invoiceId: null, bankStatementLineId: this.draftLine() }, this.invoices(), this.orderPayments(), this.viaSupplier());
    return this.invoices().find(item => item.id === id) ?? null;
  });
  readonly automaticLabel = computed(() => { const invoice = this.automatic(); return invoice ? 'Automatisch · ' + invoice.number : 'Geen factuur gekozen'; });
  readonly chosenInvoice = computed(() => {
    const id = this.draft().invoiceId ?? null;
    return id === null ? this.automatic() : this.invoices().find(item => item.id === id) ?? null;
  });
  readonly newInvoiceInvalid = computed(() => {
    const pay = this.draft();
    const fresh = pay.newInvoice;
    return !!fresh?.open && pay.createdInvoiceId == null && (!fresh.number.trim() || !fresh.invoiceDate || fresh.amount === null);
  });
  option(invoice: PurchaseInvoice): string { return invoiceOption(invoice); }
  parse(raw: string): number | null { return parsePurchasePaymentAmount(raw); }
  openNewInvoice(): void {
    const pay = this.draft();
    this.patch.emit({ newInvoice: { open: true, number: '', invoiceDate: this.today(), amountInput: '', amount: null, currency: pay.currency, file: null } });
  }
  patchInvoice(changes: Partial<NonNullable<PurchasePaymentDraft['newInvoice']>>): void {
    const fresh = this.draft().newInvoice;
    if (fresh) this.patch.emit({ newInvoice: { ...fresh, ...changes } });
  }

  chooseBank(row: BankStatementLine | null): void {
    const pay = this.draft();
    if (this.busy() || pay.bankLinkPending) return;
    if (!row) { this.patch.emit({ bankTransaction: null, bankLinkError: '' }); return; }
    const total = Math.abs(row.amountEur);
    const parts = (pay.freightAmount ?? 0) + (pay.separateAmount ?? 0);
    const goods = Math.round((total - parts) * 100) / 100;
    this.patch.emit({ bankTransaction: row, toBank: false, bankAccount: row.account, paidOn: bankTransactionDay(row), bankLinkError: '',
      ...(pay.id || bankAmountsMatch(this.transferEur(), total) ? {} : pay.currency === 'EUR' ? { amount: goods, amountInput: String(goods).replace('.', ',') }
        : { amountEur: total, amountEurInput: String(total).replace('.', ',') }) });
  }
  constructor() {
    void this.bankAccounts.load();
  }
}
