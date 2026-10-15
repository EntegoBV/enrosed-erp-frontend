import { bankAmountsMatch } from '../../shared/bank-transaction-options';
import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
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
import { EurPipe } from '../../shared/pipes';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { Sheet } from '../../shared/ui';
import { DUE_MOMENT, FREIGHT_TERM_LABEL, PAYEE_LABEL, PAYEE_ORDER, PAYEE_SHORT, type Due, type LedgerPart } from './purchase-payment-ledger';
import { formatEur } from './purchase-payment-menus';
import { PurchasePaymentScope } from './purchase-payment-scope';
import { parsePurchasePaymentAmount } from './purchase-payment-amount';
import { dayText, invoiceCandidates, invoiceOption, invoicesOf, resolveInvoice } from './purchase-invoices';
import {
  carveText, inspectionSplitBlocked, linkChange, pendingAlreadyLinked, pendingLinkPlan, pendingPartEur, surplusQuestion, transferCompanions,
  type LinkChangeRow, type SurplusChoice,
} from './purchase-payment-links';
import { appendPaymentProofs, PROOF_ACCEPT, proofFileKey } from '../../shared/payment-proof-selection';

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
  /**
   * 'Factuur toevoegen…' inline: saved (upload, then the invoice) before the
   * payment; the file belongs to the invoice, never to this payment. forAll
   * ('Voor alle deelbetalingen', on by default) points every payment of the
   * payee to it.
   */
  newInvoice?: { open: boolean; number: string; invoiceDate: string; amountInput: string; amount: number | null; currency: Currency; file: File | null; forAll?: boolean };
  /** A file for the chosen invoice that has none yet: uploaded to the invoice (order level) on save. */
  invoiceFile?: File | null;
  /** Retry state: 'Voor alle deelbetalingen' is done for the invoice made inline. */
  invoiceAssignedToAll?: boolean;
  /** What the inline block created on an earlier try (the invoice with its file), so a retry never creates it twice. */
  createdInvoiceId?: number;
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
  /** One picked transaction larger than the part: what the surplus is ('Bedrag aanpassen' or 'Rest als inspectie via leverancier'). */
  surplus?: SurplusChoice | null;
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
  imports: [FormsModule, NgTemplateOutlet, Sheet, Segmented, DateField, PurchasePaymentScope, Icon, EurPipe, BankTransactionPicker],
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
            <app-bank-transaction-picker direction="OUTGOING" heading="Transactie toevoegen" [amount]="transferEur()" [selected]="pay.bankTransaction ?? null" [disabled]="busy() || !!pay.bankLinkPending" (selectedChange)="chooseBank($event)" />
          }
        } @else if (!creditOffset()) {
          <!-- Betaalbewijs: the bank transaction first (it is the proof), then every file of the payment; files are added here and nowhere else. -->
          <section class="pay-sheet__bankblock pay-sheet__proof" aria-label="Betaalbewijs">
            <div class="pay-sheet__proofhead"><span class="pay-sheet__label">Betaalbewijs</span>
              <span class="pay-sheet__count" [attr.aria-label]="fileCount() + ' van ' + fileRoom() + ' bestanden'">{{ fileCount() }} / {{ fileRoom() }} bestanden</span></div>
            <ul class="pay-sheet__lines">
              @for (part of parts(); track part.id) {
                @if (lineOf(part); as line) {
                  <li class="pay-sheet__line">
                    <span class="pay-sheet__lineicon" aria-hidden="true"><app-icon name="bank" [size]="15" /></span>
                    <span class="pay-sheet__linecopy"><b>{{ lineText(line) }}</b>
                      @if (carries(line); as other) { <small class="pay-sheet__carries">Deze transactie draagt ook: {{ other }}</small> }
                      @if (line.reference) { <small>{{ line.reference }}</small> }</span>
                    <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="unlinkLine.emit(line)">Losmaken</button>
                  </li>
                } @else if (part.onBank) {
                  <li class="pay-sheet__line"><span class="pay-sheet__lineicon" aria-hidden="true"><app-icon name="bank" [size]="15" /></span>
                    <span class="pay-sheet__linecopy"><b>{{ dayShort(part.paidOn) }} · {{ part.amountEur | eur }}</b><small>Staat op de bank</small></span></li>
                } @else if (grouped()) {
                  <li class="pay-sheet__line pay-sheet__line--open">
                    <span class="pay-sheet__linecopy"><b>{{ dayShort(part.paidOn) }} · nog niet op de bank</b></span>
                    <div class="pay-sheet__partfields">
                      <div class="field">
                        <label [for]="ids + '-part-' + part.id">Bedrag</label>
                        <div class="input-affix">
                          <input class="input num right" [id]="ids + '-part-' + part.id" type="text" inputmode="decimal" autocomplete="off" [disabled]="busy() || pay.pendingPartId === part.id"
                                 [ngModel]="partAmountInput(part)" (ngModelChange)="editPart(part, 'amount', $event)" />
                          <span class="input-affix__suffix">{{ part.currency }}</span>
                        </div>
                        @if (partInvalid(part)) { <span class="hint hint--warn" role="alert">Vul een positief bedrag in.</span> }
                      </div>
                      @if (part.currency !== 'EUR') {
                        <div class="field">
                          <label [for]="ids + '-part-eur-' + part.id">Afgeschreven in euro <span class="opt"></span></label>
                          <div class="input-affix">
                            <input class="input num right" [id]="ids + '-part-eur-' + part.id" type="text" inputmode="decimal" autocomplete="off" [disabled]="busy() || pay.pendingPartId === part.id"
                                   [ngModel]="partEurInput(part)" (ngModelChange)="editPart(part, 'eur', $event)" />
                            <span class="input-affix__suffix">EUR</span>
                          </div>
                        </div>
                      }
                    </div>
                    <div class="pay-sheet__lineactions">
                      @if (roundOnServer() && pay.pendingPartId !== part.id) { <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="pickFor(part.id)">Transactie toevoegen</button> }
                      <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="removePart.emit(part)">Deel verwijderen</button>
                    </div>
                  </li>
                } @else if (pay.pendingPartId !== part.id) {
                  <li class="pay-sheet__line pay-sheet__line--open">
                    <span class="pay-sheet__linecopy"><b>{{ part.amountEur | eur }} nog niet op de bank</b></span>
                    <button class="btn btn--sm" type="button" [disabled]="busy() || !!pay.bankLinkPending" (click)="pickFor(part.id)">Transactie toevoegen</button>
                  </li>
                }
                @if (pay.pendingPartId === part.id) {
                  @for (line of shownPending(); track line.id) {
                    <li class="pay-sheet__line pay-sheet__line--pending">
                      <span class="pay-sheet__lineicon" aria-hidden="true"><app-icon name="bank" [size]="15" /></span>
                      <span class="pay-sheet__linecopy"><b>{{ lineText(line) }}</b><small>wordt gekoppeld</small></span>
                      <button class="btn btn--sm" type="button" [disabled]="busy() || !!pay.bankLinkPending" [attr.aria-label]="'Niet koppelen: ' + lineText(line)" (click)="dropPending(line)">×</button>
                    </li>
                  }
                  @if (pendingPlan(); as plan) {
                    @if (plan.kind === 'higher' || (plan.kind === 'part' && plan.surplus)) {
                      <li class="pay-sheet__line pay-sheet__line--choice">
                        <div class="pay-sheet__surplus" role="group" [attr.aria-label]="surplusText()">
                          <b>{{ surplusText() }}</b>
                          <div class="pay-sheet__surplusopts">
                            <button class="pay-sheet__option" type="button" [attr.aria-pressed]="pay.surplus === 'ADJUST'" [disabled]="busy() || !!pay.bankLinkPending" (click)="chooseSurplus('ADJUST')">
                              Bedrag aanpassen naar {{ pendingLineEur() | eur }}<small>De betaling volgt de transactie</small></button>
                            @if (inspectionOffered()) {
                              <button class="pay-sheet__option" type="button" [attr.aria-pressed]="pay.surplus === 'INSPECTION'" [disabled]="busy() || !!pay.bankLinkPending" (click)="chooseSurplus('INSPECTION')">
                                Rest als inspectie via leverancier<small>{{ surplusEur() | eur }} als eigen betaling op dezelfde transactie</small></button>
                            }
                            <button class="pay-sheet__option pay-sheet__option--quiet" type="button" [disabled]="busy() || !!pay.bankLinkPending" (click)="cancelPending()">Annuleren</button>
                          </div>
                        </div>
                      </li>
                    }
                    @if (plan.kind === 'part' && !plan.whole && pendingLine(); as line) {
                      <li class="pay-sheet__line pay-sheet__line--note"><span class="hint">{{ carve(line) }}</span></li>
                    }
                  }
                  @if (changeRows().length) {
                    <li class="pay-sheet__line pay-sheet__line--change">
                      <div class="pay-sheet__change" role="table" aria-label="Wat verandert">
                        <div class="pay-sheet__changerow pay-sheet__changerow--head" role="row"><span role="columnheader">Wat verandert</span><span role="columnheader">Betaling nu</span><span role="columnheader">Na koppelen</span></div>
                        @for (row of changeRows(); track row.label) {
                          <div class="pay-sheet__changerow" role="row" [class.is-changed]="row.changed"><span role="rowheader">{{ row.label }}</span><span role="cell">{{ row.now }}</span><span role="cell">{{ row.after }}</span></div>
                        }
                      </div>
                    </li>
                  }
                  @if (picking() === part.id && pickMore() && !pickingClosed()) {
                    <li class="pay-sheet__line pay-sheet__line--picker">
                      <app-bank-transaction-picker direction="OUTGOING" heading="Transactie toevoegen" [amount]="partEur(part)" [selected]="null" [startOpen]="true" [exclude]="excluded()"
                                                   [disabled]="busy() || !!pay.bankLinkPending" (selectedChange)="pickLine(part.id, $event)" />
                    </li>
                  }
                }
              }
              @if (allLinked() && !(pay.pendingLines ?? []).length) {
                <!-- No open transfer to add a transaction to: said quietly, never a dead button. -->
                <li class="pay-sheet__line pay-sheet__line--quiet"><small>Transactie toevoegen: alle transacties gekoppeld · verhoog eerst het bedrag (maak een transactie los) of noteer wat er meer betaald is als nieuwe betaling.</small></li>
              }
              @for (file of proofFiles(); track file.id) {
                <li class="pay-sheet__line">
                  <span class="pay-sheet__lineicon" aria-hidden="true"><app-icon name="clip" [size]="15" /></span>
                  <button class="wk-link pay-sheet__filename" type="button" (click)="openDocument.emit(file.id)">{{ file.originalFilename }}</button>
                  <button class="btn btn--sm" type="button" [disabled]="busy()" [attr.aria-label]="'Bestand ' + file.originalFilename + ' verwijderen'" (click)="removeProof.emit(file)">×</button>
                </li>
              }
              <ng-container *ngTemplateOutlet="newFiles" />
            </ul>
            <ng-container *ngTemplateOutlet="addFile" />
            @if (pendingMessage(); as message) { <span class="hint hint--warn" role="alert">{{ message }}</span> }
            <span class="hint">Een gekoppelde banktransactie is al het bewijs; een bestand is optioneel.</span>
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
              <span class="hint">laatste transactie · eerste {{ dayShort(firstDay()) }}</span>
            </div>
            <p class="hint span-2 pay-sheet__grouphint">Verdeeld over {{ parts().length }} transacties; een deel dat niet op de bank staat pas je hierboven aan.</p>
          } @else {
            <div class="field pay-sheet__amount">
              <label [for]="ids + '-amount'">Bedrag</label>
              <div class="input-affix">
                <input class="input num right" [id]="ids + '-amount'" type="text" inputmode="decimal" autocomplete="off" [disabled]="busy() || !!creditOffset() || (!!pay.bankTransaction && pay.currency === 'EUR') || linkedSingle() || linkingOne()"
                       [ngModel]="pay.amountInput" (ngModelChange)="amountInput.emit($event)" />
                <select class="input-affix__suffix" aria-label="Munt" [disabled]="busy() || !!creditOffset() || !!pay.bankTransaction || linkedSingle() || linkingOne()" [ngModel]="pay.currency" (ngModelChange)="patch.emit({ currency: $event })">
                  <option value="EUR">EUR</option><option value="USD">USD</option><option value="CNY">CNY</option>
                </select>
              </div>
              @if (pay.amountInput && pay.amount === null) { <span class="hint hint--warn" role="alert">Vul een positief bedrag in, bijvoorbeeld 1.046,95.</span> }
              @if (linkedSingle()) { <span class="hint">Staat op de bank: maak de banktransactie eerst los om bedrag of datum te wijzigen.</span> }
              @else if (linkingOne()) { <span class="hint">Bedrag en datum volgen de transactie bij het koppelen (zie Wat verandert).</span> }
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
              @if (pay.bankTransaction || linkedSingle() || linkingOne()) { <span class="input">{{ dayLong(pay.paidOn) }}</span> } @else {
                <app-date-field [fieldId]="ids + '-date'" [value]="pay.paidOn" (valueChange)="patch.emit({ paidOn: $event })" />
              }
            </div>
            @if (pay.currency !== 'EUR') {
              <div class="field span-2 pay-sheet__bank">
                <label [for]="ids + '-eur'">Afgeschreven in euro <span class="opt"></span></label>
                <div class="input-affix">
                  <input class="input num right" [id]="ids + '-eur'" type="text" inputmode="decimal" autocomplete="off" [disabled]="busy() || !!creditOffset() || frozen() || !!pay.bankTransaction || linkedSingle() || linkingOne()"
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
          <div class="field span-2 pay-sheet__label-field">
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
          <section class="field pay-sheet__invoice" aria-label="Factuur">
            <label [for]="ids + '-invoice'">Factuur</label>
            <select class="select" [id]="ids + '-invoice'" [disabled]="busy() || !!pay.bankLinkPending" [ngModel]="pay.invoiceId ?? null" (ngModelChange)="patch.emit({ invoiceId: $event, invoiceIdChanged: true, invoiceFile: null })">
              <option [ngValue]="null">{{ automaticLabel() }}</option>
              @for (invoice of candidates(); track invoice.id) {
                <option [ngValue]="invoice.id">{{ invoice.payee !== pay.payee ? 'via leverancier · ' : '' }}{{ option(invoice) }}</option>
              }
            </select>
            @if (forAllNote(); as note) { <span class="hint">{{ note }}</span> }
            <ul class="pay-sheet__lines pay-sheet__invoicefiles">
              @if (chosenInvoice(); as invoice) {
                @if (invoice.documentId != null) {
                  <li class="pay-sheet__line"><span class="pay-sheet__lineicon" aria-hidden="true"><app-icon name="document" [size]="15" /></span>
                    <button class="wk-link pay-sheet__filename" type="button" (click)="openDocument.emit(invoice.documentId)">{{ invoice.documentName || ('Factuur ' + invoice.number) }}</button>
                    <small class="pay-sheet__filenote">bij de factuur</small></li>
                } @else if (pay.invoiceFile) {
                  <li class="pay-sheet__line"><span class="pay-sheet__lineicon" aria-hidden="true"><app-icon name="document" [size]="15" /></span>
                    <span class="pay-sheet__linecopy"><b>{{ pay.invoiceFile.name }}</b><small>wordt bij het bewaren aan factuur {{ invoice.number }} gekoppeld</small></span>
                    <button class="btn btn--sm" type="button" [disabled]="busy()" [attr.aria-label]="pay.invoiceFile.name + ' uit de selectie verwijderen'" (click)="patch.emit({ invoiceFile: null })">×</button></li>
                } @else {
                  <li class="pay-sheet__line pay-sheet__line--open"><span class="pay-sheet__linecopy"><b>Factuur {{ invoice.number }} heeft nog geen bestand</b></span>
                    <label class="btn btn--sm pay-sheet__filebtn">Bestand bij de factuur<input type="file" hidden [accept]="invoiceAccept" [disabled]="busy()" (change)="chooseInvoiceFile($event)" /></label></li>
                }
              }
              @for (file of invoiceFiles(); track file.id) {
                <li class="pay-sheet__line"><span class="pay-sheet__lineicon" aria-hidden="true"><app-icon name="document" [size]="15" /></span>
                  <span class="pay-sheet__linecopy"><button class="wk-link pay-sheet__filename" type="button" (click)="openDocument.emit(file.id)">{{ file.originalFilename }}</button><small>Factuurbestand zonder gegevens · hangt aan deze betaling</small></span>
                  <button class="btn btn--sm" type="button" [disabled]="busy()" [attr.aria-label]="'Bestand ' + file.originalFilename + ' verwijderen'" (click)="removeProof.emit(file)">×</button></li>
              }
            </ul>
            <span class="pay-sheet__invoicelinks">
              @if (!pay.newInvoice?.open) { <button class="wk-link" type="button" [disabled]="busy()" (click)="openNewInvoice()">Factuur toevoegen…</button> }
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
                  <input class="input" [id]="ids + '-inv-file'" type="file" [accept]="invoiceAccept" [disabled]="busy() || pay.createdInvoiceId != null"
                         (change)="patchInvoice({ file: $any($event.target).files?.[0] ?? null })" />
                  <span class="hint">Hoort bij de factuur, niet bij deze ene betaling.</span>
                </div>
                <label class="pay-sheet__switch span-2"><span>Voor alle deelbetalingen<small>{{ forAllHint() }}</small></span>
                  <input class="pay-sheet__check" type="checkbox" [checked]="fresh.forAll ?? true" [disabled]="busy() || pay.createdInvoiceId != null"
                         (change)="patchInvoice({ forAll: $any($event.target).checked })" /></label>
                @if (pay.createdInvoiceId == null) {
                  <button class="wk-link span-2 pay-sheet__nonew" type="button" [disabled]="busy()" (click)="patch.emit({ newInvoice: undefined })">Geen nieuwe factuur</button>
                }
              </div>
            }
          </section>
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
        @if (!pay.id && !creditOffset()) {
          <!-- A new payment: its files, under the same words as a saved one. -->
          <section class="pay-sheet__bankblock pay-sheet__proof" aria-label="Betaalbewijs">
            <div class="pay-sheet__proofhead"><span class="pay-sheet__label">Betaalbewijs</span>
              <span class="pay-sheet__count" [attr.aria-label]="fileCount() + ' van ' + fileRoom() + ' bestanden'">{{ fileCount() }} / {{ fileRoom() }} bestanden</span></div>
            @if (pay.files.length) { <ul class="pay-sheet__lines"><ng-container *ngTemplateOutlet="newFiles" /></ul> }
            <ng-container *ngTemplateOutlet="addFile" />
            <span class="hint">Een gekoppelde banktransactie is al het bewijs; een bestand is optioneel.</span>
          </section>
        }
        @if (pay.id && !grouped()) {
          <button class="pay-sheet__delete" type="button" [disabled]="busy() || !!pay.bankLinkPending" (click)="remove.emit(pay.id)">Verwijderen</button>
        }
        <ng-template #newFiles>
          @for (file of pay.files; track fileKey(file); let index = $index) {
            <li class="pay-sheet__line pay-sheet__line--pending">
              <span class="pay-sheet__lineicon" aria-hidden="true"><app-icon name="clip" [size]="15" /></span>
              <span class="pay-sheet__linecopy"><b>{{ file.name }}</b><small>wordt bij het bewaren toegevoegd</small></span>
              <button class="btn btn--sm" type="button" [disabled]="busy() || !!pay.bankLinkPending" [attr.aria-label]="file.name + ' uit de selectie verwijderen'" (click)="dropFile(index)">×</button>
            </li>
          }
        </ng-template>
        <ng-template #addFile>
          <div class="pay-sheet__addfile">
            <label class="btn btn--sm pay-sheet__filebtn" [class.is-disabled]="busy() || !!pay.bankLinkPending || pay.files.length >= proofSlots()">
              <app-icon name="plus" [size]="14" />Bestand toevoegen
              <input type="file" hidden multiple [accept]="proofAccept" [disabled]="busy() || !!pay.bankLinkPending || pay.files.length >= proofSlots()" (change)="chooseFiles($event)" /></label>
            <small>PDF, JPG of PNG · bankafschrift of betaalbevestiging · maximaal 25 MB</small>
          </div>
          @if (fileErrors().length) { <div class="hint hint--warn" role="alert">@for (error of fileErrors(); track $index) { <span>{{ error }}</span> }</div> }
        </ng-template>
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
  /** Older invoice files hung on this payment (they take one of its five places): listed under Factuur with open and remove. */
  readonly invoiceFiles = input<readonly PurchaseDocument[]>([]);
  /** A supplier goods payment of a container with an inspection: a larger transaction may carry it ('Rest als inspectie via leverancier'). */
  readonly inspectionOffered = input(false);
  /** How many payments the payee has (payments in parts count once): 'Geldt voor alle betalingen van Leverancier (n)'. */
  readonly payeePaymentCount = input(0);
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
  readonly proofAccept = PROOF_ACCEPT;
  readonly invoiceAccept = '.pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx';
  readonly fileKey = proofFileKey;
  /** Why a chosen file was not added (type, size, room). */
  readonly fileErrors = signal<string[]>([]);
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
  /** A transaction is picked for a payment never split: its amount and day will follow the transaction, so the fields wait. */
  readonly linkingOne = computed(() => this.roundOnServer() && !!this.draft().id && !this.grouped() && (this.draft().pendingLines ?? []).length > 0);
  /** Every transfer on the bank: one more transaction only fits once the amount is raised (a transaction loosened). */
  readonly allLinked = computed(() => this.roundOnServer() && !!this.draft().id && this.parts().length > 0 && this.parts().every(part => part.onBank));
  readonly firstDay = computed(() => this.parts()[0]?.paidOn ?? this.draft().paidOn);
  /** The part the bank picker is open for. */
  readonly picking = signal<number | null>(null);
  readonly pendingPart = computed(() => this.parts().find(part => part.id === this.draft().pendingPartId) ?? null);
  /** The picked transactions not on this payment yet: after a lost answer the refreshed payment may already carry them. */
  readonly shownPending = computed(() => pendingAlreadyLinked(this.draft().pendingLines ?? [], this.parts()) ? [] : this.draft().pendingLines ?? []);
  /** The inspection noted with the goods of this transfer and not on the bank yet: it joins a transaction that makes both. */
  readonly companions = computed(() => {
    const part = this.pendingPart();
    return part && this.roundOnServer() ? transferCompanions(part.payment, this.orderPayments(), this.draft().groupIds ?? []) : [];
  });
  readonly pendingPlan = computed(() => {
    const part = this.pendingPart();
    return part ? pendingLinkPlan(this.partEur(part), this.shownPending(), this.roundOnServer(), this.draft().surplus ?? null, this.companions())
      : pendingLinkPlan(0, [], true);
  });
  readonly pendingMessage = computed(() => { const plan = this.pendingPlan(); return plan.kind === 'invalid' ? plan.message : null; });
  /** The one picked transaction, when one is picked. */
  readonly pendingLine = computed(() => { const lines = this.shownPending(); return lines.length === 1 ? lines[0] : null; });
  readonly pendingLineEur = computed(() => Math.abs(this.pendingLine()?.amountEur ?? 0));
  /** How much larger the picked transaction is than the part. */
  readonly surplusEur = computed(() => {
    const part = this.pendingPart();
    return part ? Math.max(0, Math.round(this.pendingLineEur() * 100) - Math.round(this.partEur(part) * 100)) / 100 : 0;
  });
  readonly surplusText = computed(() => surplusQuestion(this.surplusEur()));
  /** 'Wat verandert': the part now and after the link of the one picked transaction. */
  readonly changeRows = computed<LinkChangeRow[]>(() => {
    const part = this.pendingPart(), line = this.pendingLine();
    if (!part || !line || !this.roundOnServer()) return [];
    const linked = this.lineOf(part);
    const files = part.proofs?.length ?? 0;
    const proof = linked ? this.lineText(linked) : files ? `${files} ${files === 1 ? 'bestand' : 'bestanden'}` : 'geen';
    const companionsEur = this.companions().reduce((sum, payment) => sum + Math.round(payment.amountEur * 100), 0) / 100;
    return linkChange({ amount: part.amount, currency: part.currency, amountEur: part.amountEur, paidOn: part.paidOn, proof },
      { amountEur: line.amountEur, day: bankTransactionDay(line), text: this.lineText(line) }, this.pendingPlan(), companionsEur);
  });
  /** A larger transaction is picked: it stands alone (its question is open), no second one is offered beside it. */
  readonly pickingClosed = computed(() => { const plan = this.pendingPlan(); return plan.kind === 'higher' || (plan.kind === 'part' && !!plan.surplus); });
  /** One more transaction can be picked: ten at most, one against an older server. */
  readonly pickMore = computed(() => { const count = (this.draft().pendingLines ?? []).length; return this.roundOnServer() ? count < 10 : count < 1; });
  readonly excluded = computed(() => [
    ...this.parts().map(part => part.bankStatementLineId).filter((id): id is number => id != null),
    ...(this.draft().pendingLines ?? []).map(line => line.id),
  ]);
  private readonly partEditsInvalid = computed(() => Object.values(this.draft().partEdits ?? {}).some(edit => edit.amount === null
    || (!!edit.amountEurInput && edit.amountEur === null)));
  /** Something typed or picked cannot be saved yet (a larger transaction waits for its choice). */
  readonly saveBlocked = computed(() => this.pendingPlan().kind === 'invalid' || this.pendingPlan().kind === 'higher' || this.partEditsInvalid()
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
  /**
   * What else of this container the transaction carries, e.g. 'Inspectie
   * € 300,00 (via leverancier)': the € 10.300 line of a € 10.000 goods
   * payment explains itself.
   */
  carries(line: BankStatementLine): string | null {
    const own = new Set([...(this.draft().groupIds ?? []), ...this.parts().map(part => part.id)]);
    const others = this.orderPayments().filter(payment => payment.bankStatementLineId === line.id && !own.has(payment.id));
    if (!others.length) return null;
    return others.map(payment => {
      const payee = payment.payee ?? 'SUPPLIER';
      const via = payee === 'SEPARATE' && this.viaSupplier() ? ' (via leverancier)' : '';
      return `${PAYEE_SHORT[payee]} ${formatEur(payment.amountEur)}${via}`;
    }).join(', ');
  }
  /** One of the payment's transactions already carries an inspection part of this container: no second split is offered. */
  private readonly lineHasInspection = computed(() => this.parts().some(part => part.bankStatementLineId != null
    && this.orderPayments().some(payment => payment.bankStatementLineId === part.bankStatementLineId && (payment.payee ?? 'SUPPLIER') === 'SEPARATE')));
  carve(line: BankStatementLine): string {
    const part = this.pendingPart();
    return part ? carveText(this.partEur(part), line.amountEur) : '';
  }
  /** 'Betaald op' read-only: the day as the lists show it (a payment in parts: its newest transfer, as its ledger row). */
  dayLong(iso: string): string { return dayText(iso); }
  readonly newestDay = computed(() => { const parts = this.parts(); return parts[parts.length - 1]?.paidOn ?? this.draft().paidOn; });
  /**
   * The euro a picked transaction is checked against. With this round the
   * payment follows the transaction, so it is the transfer as booked (or its
   * typed correction); an older server writes the draft first, so a payment
   * never split counts as the draft values it.
   */
  partEur(part: LedgerPart): number {
    return pendingPartEur(part, this.draft().partEdits?.[part.id], this.grouped() || this.roundOnServer() ? null : this.draftEur());
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
  /** 'Transactie toevoegen': the picker opens for that part; picking for another part drops the other part's picks. */
  pickFor(partId: number): void {
    this.picking.set(partId);
    if (this.draft().pendingPartId !== partId) this.patch.emit({ pendingPartId: partId, pendingLines: [], surplus: null, toBank: false });
  }
  /**
   * A pick that carves the payment, splits it over several transactions or is
   * larger drops a typed inspection split: that comes after the link. With
   * this round a payment never split follows the transaction: money typed
   * before goes back to the stored payment, the comparison shows what follows.
   */
  pickLine(partId: number, line: BankStatementLine | null): void {
    if (!line) return;
    const pending = this.draft().pendingPartId === partId ? this.draft().pendingLines ?? [] : [];
    const lines = [...pending.filter(item => item.id !== line.id), line];
    const part = this.parts().find(item => item.id === partId);
    const blocked = !!part && inspectionSplitBlocked(pendingLinkPlan(this.partEur(part), lines, this.roundOnServer()));
    const stored = this.roundOnServer() && !this.grouped() && part ? this.storedMoney(part) : {};
    this.patch.emit({ pendingPartId: partId, pendingLines: lines, surplus: null, toBank: false, ...stored,
      ...(blocked ? { inspectionSplit: null, inspectionSplitInput: '' } : {}) });
  }
  /** The stored money and day of a payment never split, as the fields show them. */
  private storedMoney(part: LedgerPart): Partial<PurchasePaymentDraft> {
    const foreign = part.currency !== 'EUR' && part.amountEur > 0;
    return { amount: part.amount, amountInput: String(part.amount).replace('.', ','), currency: part.currency, paidOn: part.paidOn,
      amountEurInput: foreign ? String(part.amountEur).replace('.', ',') : '', amountEur: foreign ? part.amountEur : null };
  }
  dropPending(line: BankStatementLine): void {
    this.patch.emit({ pendingLines: (this.draft().pendingLines ?? []).filter(item => item.id !== line.id), surplus: null });
  }
  /** 'Annuleren' of the larger-transaction question: nothing is linked. */
  cancelPending(): void {
    this.picking.set(null);
    this.patch.emit({ pendingLines: [], pendingPartId: null, surplus: null });
  }
  /** What the surplus of a larger transaction is; the inspection rest replaces a typed split. */
  chooseSurplus(choice: SurplusChoice): void {
    this.patch.emit({ surplus: choice, inspectionSplit: null, inspectionSplitInput: '' });
  }

  /* ---- Inspectie afsplitsen: a saved goods payment to the supplier that also paid the inspection */
  readonly showInspectionSplit = computed(() => {
    const pay = this.draft();
    return this.roundOnServer() && !!pay.id && pay.payee === 'SUPPLIER' && this.originalPayee() === 'SUPPLIER' && !this.creditOffset()
      && !this.grouped() && pay.instalmentDue !== 'FREIGHT' && !this.lineHasInspection() && !pay.surplus;
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
  /** One invoice for the payee: every payment of the payee points to it (automatic), the sheet says so. */
  readonly forAllNote = computed(() => {
    const pay = this.draft();
    const own = invoicesOf(this.invoices(), pay.payee);
    if (own.length !== 1 || (pay.invoiceId != null && pay.invoiceId !== own[0].id)) return null;
    const count = Math.max(this.payeePaymentCount(), pay.id ? 1 : 0);
    return `Geldt voor alle betalingen van ${PAYEE_LABEL[pay.payee]}${count ? ' (' + count + ')' : ''}`;
  });
  readonly forAllHint = computed(() => {
    const pay = this.draft();
    const count = this.payeePaymentCount() + (pay.id ? 0 : 1);
    return `Alle betalingen van ${PAYEE_LABEL[pay.payee]}${count ? ' (' + count + ')' : ''} horen bij deze factuur; uit: alleen deze betaling.`;
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
    this.patch.emit({ newInvoice: { open: true, number: '', invoiceDate: this.today(), amountInput: '', amount: null, currency: pay.currency, file: null, forAll: true } });
  }
  /** 'Bestand bij de factuur': one file for the chosen invoice that has none. */
  chooseInvoiceFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (file) this.patch.emit({ invoiceFile: file });
  }

  /* ---- Betaalbewijs: files */
  /** Files listed under Betaalbewijs: the stored ones and the ones that go with the save. */
  readonly fileCount = computed(() => this.proofFiles().length + this.draft().files.length);
  /** Room for files as the sheet lists them: the stored proofs plus what still fits on the payment (its five places, minus an older invoice file). */
  readonly fileRoom = computed(() => this.proofFiles().length + this.proofSlots());
  chooseFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const selection = appendPaymentProofs(this.draft().files, Array.from(input.files ?? []), this.proofSlots());
    input.value = '';
    this.fileErrors.set(selection.errors);
    this.patch.emit({ files: selection.files });
  }
  dropFile(index: number): void {
    this.fileErrors.set([]);
    this.patch.emit({ files: this.draft().files.filter((_, i) => i !== index) });
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
