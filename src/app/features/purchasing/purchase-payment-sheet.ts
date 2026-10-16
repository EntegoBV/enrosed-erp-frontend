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
import { amountInputText, parsePurchasePaymentAmount } from './purchase-payment-amount';
import { dayText, invoiceCandidates, invoiceNumberKey, invoiceOption, invoicesOf, resolveInvoice } from './purchase-invoices';
import {
  adjustConsequence, carveForeignText, carveText, foreignLinkWarning, growLinkPlan, growPreview, inspectionSplitBlocked, linkChange, pendingAlreadyLinked,
  pendingLinkPlan, pendingPartEur, shareEffect, surplusQuestion, transferCompanions, type ForeignLink, type LinkChangeRow, type SurplusChoice, type TermStanding,
} from './purchase-payment-links';
import { appendPaymentProofs, PROOF_ACCEPT, proofFileKey } from '../../shared/payment-proof-selection';
import {
  alsoPartAs, alsoPartChoices, alsoPartFor, alsoPartKey, alsoTotalEur, rebalancedGoods, type AlsoContainerOption, type AlsoContainerPart,
} from './purchase-also-containers';
import { applyShare, shareStatus, type ShareMode } from './purchase-payment-share';
import { containerName, containerNumberHint } from './container-name';

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
  /** The invoice that file was chosen for, as the sheet showed it (an inspection paid via the supplier: the supplier's invoice). */
  invoiceFileFor?: number | null;
  /**
   * The number of the inline invoice the save sent ('Factuur toevoegen…'),
   * as invoiceNumberKey writes it: after a lost answer the refreshed
   * container has it, and only then is that invoice this sheet's own.
   */
  invoiceAttempt?: string;
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
  /**
   * 'Transactie toevoegen' on a payment whose every transfer is on the bank:
   * the one picked transaction (pendingLines) is added as a new transfer and
   * the payment grows by it (bank-part with 'ADJUST').
   */
  addTransfer?: boolean;
  /** 'Alleen een deel?' of a USD/CNY payment: the part the picked transaction paid, in the payment's currency; empty = the whole payment. */
  pendingPartAmountInput?: string;
  pendingPartAmount?: number | null;
  /** This sheet wrote the payment (a POST or PUT) before a link that is still pending: a retry must not write it again. */
  paymentWritten?: boolean;
  /** Corrections of unlinked transfers of a payment paid in parts, by their id. */
  partEdits?: Record<number, { amountInput: string; amount: number | null; amountEurInput?: string; amountEur?: number | null }>;
  /**
   * "Deze transactie dekt ook andere containers" (a new EUR supplier payment on a picked transaction): open, and the other containers' parts.
   * 'Verdelen over containers' of a saved payment keeps its other rows here too.
   */
  alsoOpen?: boolean;
  alsoParts?: AlsoContainerPart[];
  /** 'Verdelen over containers' (surplus 'SHARE'): this payment's part as typed and parsed, how the amounts were set, and whether the first rows were proposed. */
  shareOwnInput?: string;
  shareOwn?: number | null;
  shareMode?: ShareMode;
  shareProposed?: boolean;
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
                      (click)="patch.emit({ amount: chip.amount, amountInput: amountText(chip.amount), currency: 'EUR', label: chip.label, instalmentDue: chip.due ?? null, settles: false })">
                {{ chip.label }}<small>{{ chip.amount | eur }}</small>
              </button>
            }
          </div>
        }
        @if (!pay.id) {
          @if (!bankLinked() && !creditOffset()) {
            <app-bank-transaction-picker direction="OUTGOING" heading="Transactie toevoegen" [amount]="pickerEur()" [selected]="pay.bankTransaction ?? null" [disabled]="busy() || !!pay.bankLinkPending" (selectedChange)="chooseBank($event)" />
          }
          @if (alsoOffered()) {
            <!-- One transfer for several containers: each part becomes a payment on its own container, all on this transaction (one atomic save). -->
            <div class="pay-sheet__tobank pay-sheet__also">
              <label class="pay-sheet__switch"><span>Deze transactie dekt ook andere containers<small>Bijvoorbeeld 30% van drie containers in één overschrijving</small></span>
                <input [class]="desk() ? 'pay-sheet__check' : 'ios-switch'" type="checkbox" role="switch" [checked]="!!pay.alsoOpen" [disabled]="busy() || !!pay.bankLinkPending"
                       (change)="toggleAlso($any($event.target).checked)" /></label>
              @if (pay.alsoOpen) {
                @if (!alsoState().supported) {
                  <span class="hint">Kan zodra de server bijgewerkt is.</span>
                } @else {
                  @if ((pay.alsoParts ?? []).length) {
                    <ul class="pay-sheet__lines pay-sheet__alsorows">
                      <ng-container *ngTemplateOutlet="alsoRows; context: { $implicit: !!pay.bankLinkPending }" />
                    </ul>
                  }
                  @if (alsoState().loading) { <span class="hint">Containers laden…</span> }
                  @else if (alsoState().failed) { <ng-container *ngTemplateOutlet="alsoFailed" /> }
                  @else if (alsoChoices().length) {
                    <ng-container *ngTemplateOutlet="alsoAdd; context: { $implicit: !!pay.bankLinkPending }" />
                  } @else { <span class="hint">{{ alsoEmptyText() }}</span> }
                  <span class="hint" [class.hint--warn]="!alsoMatches()" role="status">Samen {{ alsoTotal() | eur }} van {{ lineEur() | eur }}{{ alsoMatches() ? ' ✓' : '' }}</span>
                }
              }
            </div>
          }
        } @else if (!creditOffset()) {
          <!-- Betaalbewijs: the bank transaction first (it is the proof), then every file of the payment; files are added here and nowhere else. -->
          <section class="pay-sheet__bankblock pay-sheet__proof" aria-label="Betaalbewijs">
            <ng-container *ngTemplateOutlet="proofHead" />
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
                @if (pay.pendingPartId === part.id && !pay.addTransfer) {
                  @for (line of shownPending(); track line.id) {
                    <li class="pay-sheet__line pay-sheet__line--pending">
                      <span class="pay-sheet__lineicon" aria-hidden="true"><app-icon name="bank" [size]="15" /></span>
                      <span class="pay-sheet__linecopy"><b>{{ lineText(line) }}</b><small>wordt gekoppeld</small></span>
                      <button class="btn btn--sm" type="button" [disabled]="busy()" [attr.aria-label]="'Niet koppelen: ' + lineText(line)" (click)="dropPending(line)">×</button>
                    </li>
                  }
                  @if (pendingPlan(); as plan) {
                    @if (plan.kind === 'higher' || plan.kind === 'share' || (plan.kind === 'part' && plan.surplus)) {
                      <li class="pay-sheet__line pay-sheet__line--choice">
                        <div class="pay-sheet__surplus" role="group" [attr.aria-label]="surplusText()">
                          <b>{{ surplusText() }}</b>
                          <div class="pay-sheet__surplusopts">
                            <!-- Never locked by a pending link: changing the choice writes nothing, the retry links with the new one.
                               No cancel button of its own: the × on the picked transaction drops it, the footer closes the sheet. -->
                            @if (shareOffered()) {
                              <button class="pay-sheet__option" type="button" [attr.aria-pressed]="pay.surplus === 'SHARE'" [disabled]="busy()" (click)="chooseSurplus('SHARE')">
                                Verdelen over containers<small>Deze transactie betaalde ook andere containers</small></button>
                            }
                            @if (foreignPayment()) {
                              <button class="pay-sheet__option" type="button" [attr.aria-pressed]="false" [disabled]="busy()" (click)="chooseSurplus(null)">
                                Niet verdelen<small>De hele betaling gaat op deze transactie</small></button>
                            } @else {
                              <button class="pay-sheet__option" type="button" [attr.aria-pressed]="pay.surplus === 'ADJUST'" [disabled]="busy()" (click)="chooseSurplus('ADJUST')">
                                Bedrag aanpassen naar {{ pendingLineEur() | eur }}<small>{{ adjustText() }}</small></button>
                              @if (inspectionOffered()) {
                                <button class="pay-sheet__option" type="button" [attr.aria-pressed]="pay.surplus === 'INSPECTION'" [disabled]="busy()" (click)="chooseSurplus('INSPECTION')">
                                  Rest als inspectie via leverancier<small>{{ surplusEur() | eur }} als eigen betaling op dezelfde transactie</small></button>
                              }
                            }
                          </div>
                        </div>
                      </li>
                    }
                    @if (plan.kind === 'share') {
                      <!-- 'Verdelen over containers': this payment's part and every other container's, together the transaction (one call on save). -->
                      <li class="pay-sheet__line pay-sheet__line--share">
                        <section class="pay-sheet__share" aria-label="Verdelen over containers">
                          <div class="pay-sheet__sharehead"><b>Verdelen over containers</b><small>Per container zijn deel van {{ pendingLineEur() | eur }}</small></div>
                          <ul class="pay-sheet__lines pay-sheet__alsorows">
                            <li class="pay-sheet__line pay-sheet__alsorow">
                              <span class="pay-sheet__linecopy"><b>{{ orderName() || 'Deze container' }}@if (ownNumberHint(); as number) { <small class="pay-sheet__alsonumber">{{ number }}</small> }<span class="pay-sheet__alsothis"> (deze container)</span></b><small>{{ ownShareText() }}</small></span>
                              <span class="pay-sheet__alsofields">
                                <div class="input-affix pay-sheet__alsoamount">
                                  <input class="input num right" type="text" inputmode="decimal" autocomplete="off" [attr.aria-label]="'Bedrag voor ' + (orderName() || 'deze container')" [disabled]="busy()"
                                         [ngModel]="pay.shareOwnInput ?? ''" (ngModelChange)="setShareOwn($event)" />
                                  <span class="input-affix__suffix">EUR</span>
                                </div>
                                <!-- As wide as the other rows' 'Weghalen': every part's amount stands in one column. -->
                                <span class="btn btn--sm pay-sheet__alsospacer" aria-hidden="true">Weghalen</span>
                              </span>
                              @if ((pay.shareOwnInput ?? '').trim() && pay.shareOwn === null) { <span class="hint hint--warn" role="alert">Vul een positief bedrag in.</span> }
                            </li>
                            <ng-container *ngTemplateOutlet="alsoRows; context: { $implicit: false }" />
                          </ul>
                          <div class="pay-sheet__shareactions">
                            @if (alsoState().loading) { <span class="hint">Containers laden…</span> }
                            @else if (alsoState().failed) { <ng-container *ngTemplateOutlet="alsoFailed" /> }
                            @else if (alsoChoices().length) { <ng-container *ngTemplateOutlet="alsoAdd; context: { $implicit: false }" /> }
                            @else { <span class="hint">{{ alsoEmptyText() }}</span> }
                            <span class="pay-sheet__sharemodes" role="group" aria-label="Verdelen">
                              <button class="btn btn--sm" type="button" [attr.aria-pressed]="pay.shareMode === 'AFSPRAAK'" [disabled]="busy() || !(pay.alsoParts ?? []).length" (click)="setShareMode('AFSPRAAK')">Volgens afspraak</button>
                              <button class="btn btn--sm" type="button" [attr.aria-pressed]="pay.shareMode === 'EQUAL'" [disabled]="busy() || !(pay.alsoParts ?? []).length" (click)="setShareMode('EQUAL')">Gelijk verdelen</button>
                            </span>
                          </div>
                          @if (!(pay.alsoParts ?? []).length) { <span class="hint">Voeg minstens één andere container toe.</span> }
                          <span class="hint" [class.hint--warn]="!shareState().matches" role="status">{{ shareState().text }}</span>
                        </section>
                      </li>
                    }
                    @if (foreignPick(); as foreign) {
                      <!-- USD/CNY: the transaction is the whole payment (its euro and day follow) unless the part it paid is named in the payment's currency. -->
                      <li class="pay-sheet__line pay-sheet__line--foreign">
                        <div class="field pay-sheet__foreignpart">
                          <label [for]="ids + '-foreign-part'">Alleen een deel? Deel in {{ foreign.currency }} <span class="opt"></span></label>
                          <div class="input-affix">
                            <input class="input num right" [id]="ids + '-foreign-part'" type="text" inputmode="decimal" autocomplete="off" [disabled]="busy()"
                                   [ngModel]="pay.pendingPartAmountInput ?? ''" (ngModelChange)="foreignPartInput($event)" />
                            <span class="input-affix__suffix">{{ foreign.currency }}</span>
                          </div>
                          @if (foreignPartInvalid()) { <span class="hint hint--warn" role="alert">Vul een positief bedrag in, of laat het leeg.</span> }
                          @else if (foreignWarning(); as warning) {
                            <span class="hint hint--warn" role="status">{{ warning }}</span>
                            @if (shareOffered() && surplusEur() > 0) {
                              <button class="wk-link pay-sheet__foreignshare" type="button" [disabled]="busy()" (click)="chooseSurplus('SHARE')">Verdelen over containers</button>
                            }
                          }
                          @else if (!(pay.pendingPartAmountInput ?? '').trim()) { <span class="hint">Leeg: de hele betaling neemt het eurobedrag van de transactie over; de koers volgt.</span> }
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
              @if (pay.addTransfer) {
                <!-- 'Transactie toevoegen' on a payment fully on the bank: one more transfer, the payment grows by it (said before it is saved). -->
                @for (line of shownPending(); track line.id) {
                  <li class="pay-sheet__line pay-sheet__line--pending">
                    <span class="pay-sheet__lineicon" aria-hidden="true"><app-icon name="bank" [size]="15" /></span>
                    <span class="pay-sheet__linecopy"><b>{{ lineText(line) }}</b><small>wordt toegevoegd</small></span>
                    <button class="btn btn--sm" type="button" [disabled]="busy()" [attr.aria-label]="'Niet toevoegen: ' + lineText(line)" (click)="dropPending(line)">×</button>
                  </li>
                }
                @if (growText(); as text) { <li class="pay-sheet__line pay-sheet__line--note"><span class="hint">{{ text }}</span></li> }
                @if (!(pay.pendingLines ?? []).length) {
                  <li class="pay-sheet__line pay-sheet__line--picker">
                    <app-bank-transaction-picker direction="OUTGOING" heading="Transactie toevoegen" [amount]="null" [selected]="null" [startOpen]="true" [exclude]="excluded()"
                                                 [disabled]="busy() || !!pay.bankLinkPending" (selectedChange)="pickAdded($event)" />
                    <button class="wk-link pay-sheet__noadd" type="button" [disabled]="busy()" (click)="cancelPending()">Geen transactie toevoegen</button>
                  </li>
                }
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
              @else if (linkingOne()) { <span class="hint">{{ linkingHint() }}</span> }
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
                @else if (bankRate(); as rate) { <span class="hint">{{ rate }}</span> }
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
            <select class="select" [id]="ids + '-invoice'" [disabled]="busy() || !!pay.bankLinkPending" [ngModel]="pay.invoiceId ?? null" (ngModelChange)="patch.emit({ invoiceId: $event, invoiceIdChanged: true, invoiceFile: null, invoiceFileFor: null })">
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
                    <button class="btn btn--sm" type="button" [disabled]="busy()" [attr.aria-label]="pay.invoiceFile.name + ' uit de selectie verwijderen'" (click)="patch.emit({ invoiceFile: null, invoiceFileFor: null })">×</button></li>
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
                  @if (duplicateInvoice(); as existing) {
                    <span class="hint hint--warn" role="alert">Factuur {{ existing.number }} bestaat al{{ existing.documentId == null ? ' en heeft nog geen bestand' : '' }}.
                      <button class="wk-link" type="button" [disabled]="busy()" (click)="useExistingInvoice(existing)">Kies {{ existing.number }}{{ existing.documentId == null && fresh.file ? ' met dit bestand' : '' }}</button></span>
                  }
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
                @if (newInvoiceBeside()) {
                  <label class="pay-sheet__switch span-2"><span>Voor alle deelbetalingen<small>{{ forAllHint() }}</small></span>
                    <input class="pay-sheet__check" type="checkbox" [checked]="fresh.forAll ?? true" [disabled]="busy() || pay.createdInvoiceId != null"
                           (change)="patchInvoice({ forAll: $any($event.target).checked })" /></label>
                } @else {
                  <!-- The payee's only invoice holds for every payment of the payee by itself: no switch that could not keep its word. -->
                  <p class="hint span-2 pay-sheet__forall">{{ newInvoiceNote() }}</p>
                }
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
        }
        @if (!pay.id && !creditOffset()) {
          <!-- A new payment: its files, under the same words as a saved one. -->
          <section class="pay-sheet__bankblock pay-sheet__proof" aria-label="Betaalbewijs">
            <ng-container *ngTemplateOutlet="proofHead" />
            @if (pay.files.length) { <ul class="pay-sheet__lines"><ng-container *ngTemplateOutlet="newFiles" /></ul> }
            <ng-container *ngTemplateOutlet="addFile" />
            <span class="hint">Een gekoppelde banktransactie is al het bewijs; een bestand is optioneel.</span>
          </section>
        }
        @if (pay.id && !grouped()) {
          <button class="pay-sheet__delete" type="button" [disabled]="busy() || !!pay.bankLinkPending" (click)="remove.emit(pay.id)">Verwijderen</button>
        }
        <ng-template #alsoRows let-locked>
          <!-- The other containers of one transaction: an open payment of theirs is linked ('Bestaand'), else a new payment ('Nieuw'), switchable per row. -->
          @for (part of pay.alsoParts ?? []; track part.orderId) {
            @let name = partName(part);
            <li class="pay-sheet__line pay-sheet__alsorow">
              <span class="pay-sheet__linecopy"><b>{{ name }}@if (numberHint(part); as number) { <small class="pay-sheet__alsonumber">{{ number }}</small> }</b>
                <small>{{ alsoRowText(part) }}@if (otherSupplier(part)) { <span class="pay-sheet__alsowarn"> · andere leverancier</span> }</small></span>
              <span class="pay-sheet__alsofields">
                @if (choicesOf(part); as choices) {
                  @if (choices.length > 1) {
                    <select class="select pay-sheet__alsochoice" [attr.aria-label]="'Betaling voor ' + name" [disabled]="busy() || locked" [ngModel]="partKey(part)" (ngModelChange)="switchAlso(part.orderId, $event)">
                      @for (choice of choices; track choice.key) { <option [value]="choice.key">{{ choice.text }}</option> }
                    </select>
                  }
                }
                <div class="input-affix pay-sheet__alsoamount">
                  <input class="input num right" type="text" inputmode="decimal" autocomplete="off" [attr.aria-label]="'Bedrag voor ' + name" [disabled]="busy() || locked"
                         [ngModel]="part.amountInput" (ngModelChange)="setAlsoAmount(part.orderId, $event)" />
                  <span class="input-affix__suffix">EUR</span>
                </div>
                <button class="btn btn--sm" type="button" [disabled]="busy() || locked" [attr.aria-label]="name + ' weghalen'" (click)="removeAlso(part.orderId)">Weghalen</button>
              </span>
              @if (part.amount === null) { <span class="hint hint--warn" role="alert">Vul een positief bedrag in.</span> }
            </li>
          }
        </ng-template>
        <ng-template #alsoFailed>
          <!-- Not 'Geen andere container': the list did not load, and an open payment of another container may be in it. -->
          <span class="hint hint--warn" role="alert">De containers zijn niet geladen. <button class="wk-link" type="button" [disabled]="busy()" (click)="alsoLoad.emit()">Opnieuw laden</button></span>
        </ng-template>
        <ng-template #alsoAdd let-locked>
          <select class="select pay-sheet__alsoadd" aria-label="Container toevoegen" [disabled]="busy() || locked" (change)="addAlso($any($event.target).value); $any($event.target).value = ''">
            <option value="">Container toevoegen…</option>
            @for (option of alsoChoices(); track option.orderId) {
              <option [value]="option.orderId">{{ optionText(option) }}</option>
            }
          </select>
        </ng-template>
        <ng-template #newFiles>
          @for (file of pay.files; track fileKey(file); let index = $index) {
            <li class="pay-sheet__line pay-sheet__line--pending">
              <span class="pay-sheet__lineicon" aria-hidden="true"><app-icon name="clip" [size]="15" /></span>
              <span class="pay-sheet__linecopy"><b>{{ file.name }}</b><small>wordt bij het bewaren toegevoegd</small></span>
              <button class="btn btn--sm" type="button" [disabled]="busy() || !!pay.bankLinkPending" [attr.aria-label]="file.name + ' uit de selectie verwijderen'" (click)="dropFile(index)">×</button>
            </li>
          }
        </ng-template>
        <ng-template #proofHead>
          <!-- On the bank the transaction is the proof: said first, the files after it are optional. -->
          <div class="pay-sheet__proofhead"><span class="pay-sheet__label">Betaalbewijs</span>
            @if (provenByBank()) {
              <span class="pay-sheet__proofok">Bewijs: transactie ✓</span>
              <span class="pay-sheet__count" [attr.aria-label]="'Bestanden, optioneel: ' + fileCount() + ' van ' + fileRoom()">bestanden (optioneel) {{ fileCount() }}/{{ fileRoom() }}</span>
            } @else {
              <span class="pay-sheet__count" [attr.aria-label]="fileCount() + ' van ' + fileRoom() + ' bestanden'">{{ fileCount() }} / {{ fileRoom() }} bestanden</span>
            }
          </div>
        </ng-template>
        <ng-template #addFile>
          <div class="pay-sheet__addfile">
            @if (addOffered()) {
              <button class="btn btn--sm" type="button" [disabled]="busy() || !!pay.bankLinkPending" (click)="startAdd()"><app-icon name="plus" [size]="14" />Transactie toevoegen</button>
            }
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
        <button class="btn btn--primary" type="button" [disabled]="busy() || !((pay.amount ?? 0) > 0) || pay.files.length > proofSlots() || !pay.paidOn || partsInvalid() || saveBlocked()"
                (click)="confirm.emit()">{{ busy() ? 'Bezig…' : retrying() ? 'Koppeling opnieuw proberen' : pay.addTransfer && shownPending().length ? 'Transactie toevoegen'
                  : pendingPlan().kind === 'share' ? 'Verdelen en koppelen' : (pay.id ? 'Wijziging bewaren' : 'Betaling bewaren') }}</button>
      </div>
    </app-sheet>
  `,
})
export class PurchasePaymentSheet {
  private readonly viewport = inject(DesktopViewport);
  private readonly bankAccounts = inject(BankAccountsStore);
  readonly draft = input.required<PurchasePaymentDraft>();
  /** Today, as the bank counts it: a new invoice ('Factuur toevoegen…') starts on it. */
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
  /** Where the payment's term (or payee) stands against the Afspraak, this payment counted: what more paid does to it. */
  readonly termStanding = input<TermStanding | null>(null);
  /** "Deze transactie dekt ook andere containers": the containers that may share the transfer, as the host loaded them. */
  readonly alsoState = input<{ loading: boolean; supported: boolean; options: readonly AlsoContainerOption[]; failed?: boolean }>({ loading: false, supported: true, options: [] });
  /** The container's supplier: others are allowed, with a warning. */
  readonly supplierId = input<number | null>(null);
  /** This container's name (containerName: its alias, else its number), for the share's own row. */
  readonly orderName = input('');
  /** Its PO number: small print beside an alias, as the other rows show theirs. */
  readonly orderNumber = input('');
  /** Other containers' payments on the bank lines of this payment ('Deze transactie draagt ook: …'), as the host loaded them. */
  readonly lineShares = input<readonly { lineId: number; name: string; amountEur: number }[]>([]);
  /** The section opened (or 'Verdelen over containers' chosen): the host loads the containers for the payee (once). */
  readonly alsoLoad = output<void>();
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
  readonly amountText = amountInputText;
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
  /** On the bank the euro is the bank's: its effective rate, 'Koers 0,8704 (bank)', instead of the order-rate hint. */
  readonly bankRate = computed(() => {
    const pay = this.draft();
    if (pay.currency === 'EUR' || !(this.linkedSingle() || !!pay.bankTransaction) || !((pay.amount ?? 0) > 0) || !((pay.amountEur ?? 0) > 0)) return null;
    return `Koers ${(pay.amountEur! / pay.amount!).toLocaleString('nl-BE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} (bank)`;
  });
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

  /* ---- The bank accounts, for the account name in a transaction's text (a picked transaction is the movement: no second one is noted here) */
  readonly accounts = this.bankAccounts.options;

  /* ---- Banktransacties of a saved payment */
  /** A payment paid in parts: its money is the sum of its transfers, corrected per unlinked transfer. */
  readonly grouped = computed(() => this.parts().length > 1);
  readonly groupTotal = computed(() => this.parts().reduce((sum, part) => sum + Math.round(part.amountEur * 100), 0) / 100);
  /** A never-split payment on the bank: its money stays as the bank booked it until it is unlinked. */
  readonly linkedSingle = computed(() => !!this.draft().id && this.parts().length === 1 && this.parts()[0].bankStatementLineId != null);
  /** A transaction is picked for a payment never split: its amount and day will follow the transaction, so the fields wait. */
  readonly linkingOne = computed(() => this.roundOnServer() && !!this.draft().id && !this.grouped() && (this.draft().pendingLines ?? []).length > 0);
  /** Every transfer on the bank: one more transaction makes the payment grow ('Transactie toevoegen'). */
  readonly allLinked = computed(() => this.roundOnServer() && !!this.draft().id && this.parts().length > 0 && this.parts().every(part => part.onBank));
  /** 'Transactie toevoegen' on a payment whose every transfer is linked to its bank line (the server grows only such a payment). */
  readonly addOffered = computed(() => this.allLinked() && !this.creditOffset() && !this.draft().addTransfer && !(this.draft().pendingLines ?? []).length
    && this.parts().every(part => part.bankStatementLineId != null));
  /** The bank transaction proves the payment: every transfer on the bank, or a new payment with a picked transaction. */
  readonly provenByBank = computed(() => this.draft().id ? this.parts().length > 0 && this.parts().every(part => part.onBank) : !!this.draft().bankTransaction);
  /** 'De betaling wordt € 12.500,00 (was € 12.000,00); de termijn komt € 500,00 boven de afspraak.' */
  readonly growText = computed(() => {
    const plan = this.pendingPlan();
    return plan.kind === 'grow' ? growPreview(this.groupTotal(), plan.addEur, this.termStanding()) : null;
  });
  /** What 'Bedrag aanpassen' does to the term, said on the choice: 'De termijn komt dan € 300,00 boven de afspraak (te veel betaald).' */
  readonly adjustText = computed(() => adjustConsequence(this.termStanding(), this.surplusEur()));
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
    if (this.draft().addTransfer) return growLinkPlan(this.shownPending());
    const part = this.pendingPart();
    return part ? pendingLinkPlan(this.partEur(part), this.shownPending(), this.roundOnServer(), this.draft().surplus ?? null, this.companions(), this.foreignOf(part))
      : pendingLinkPlan(0, [], true);
  });
  /**
   * A USD/CNY transfer: its own amount (a typed correction first) and the
   * part the owner named for the picked transaction. The server compares it
   * in that currency (one transaction is the whole payment unless a part is
   * named), so the sheet does. Null for a euro payment.
   */
  foreignOf(part: LedgerPart): ForeignLink | null {
    if (part.currency === 'EUR') return null;
    return { amount: this.draft().partEdits?.[part.id]?.amount ?? part.amount, currency: part.currency, part: this.draft().pendingPartAmount ?? null };
  }
  /** One transaction picked for a USD/CNY transfer. */
  readonly foreignPayment = computed(() => {
    const part = this.pendingPart();
    return part && this.roundOnServer() && this.pendingLine() ? this.foreignOf(part) : null;
  });
  /** 'Alleen een deel? Deel in USD', unless the transaction is shared over containers (the payment then goes whole, its euro is its share). */
  readonly foreignPick = computed(() => (this.draft().surplus === 'SHARE' ? null : this.foreignPayment()));
  readonly foreignPartInvalid = computed(() => !!(this.draft().pendingPartAmountInput ?? '').trim() && this.draft().pendingPartAmount == null);
  /** The whole USD/CNY payment would take a euro far from its booked one: maybe the transaction paid only a part. */
  readonly foreignWarning = computed(() => {
    const part = this.pendingPart(), line = this.pendingLine(), plan = this.pendingPlan();
    if (!part || !line || plan.kind !== 'part' || !plan.whole || plan.withPaymentIds?.length) return null;
    return foreignLinkWarning(part, line.amountEur);
  });
  /** A new pick starts without a named USD/CNY part. */
  private readonly noForeignPart: Partial<PurchasePaymentDraft> = { pendingPartAmountInput: '', pendingPartAmount: null };
  foreignPartInput(raw: string): void {
    this.patch.emit({ pendingPartAmountInput: raw, pendingPartAmount: raw.trim() ? parsePurchasePaymentAmount(raw) : null });
  }
  /** The save button retries a link only while one is left: a transaction, a pick or an inspection split. */
  readonly retrying = computed(() => {
    const pay = this.draft();
    return !!pay.bankLinkPending && (!!pay.bankTransaction || this.shownPending().length > 0 || (pay.inspectionSplit ?? 0) > 0);
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
  /** A larger transaction is picked: it stands alone (its question is open, or it is shared over containers), no second one is offered beside it. */
  readonly pickingClosed = computed(() => { const plan = this.pendingPlan(); return plan.kind === 'higher' || plan.kind === 'share' || (plan.kind === 'part' && !!plan.surplus); });
  /** One more transaction can be picked: ten at most, one against an older server. */
  readonly pickMore = computed(() => { const count = (this.draft().pendingLines ?? []).length; return this.roundOnServer() ? count < 10 : count < 1; });
  readonly excluded = computed(() => [
    ...this.parts().map(part => part.bankStatementLineId).filter((id): id is number => id != null),
    ...(this.draft().pendingLines ?? []).map(line => line.id),
  ]);
  private readonly partEditsInvalid = computed(() => Object.values(this.draft().partEdits ?? {}).some(edit => edit.amount === null
    || (!!edit.amountEurInput && edit.amountEur === null)));
  /** Something typed or picked cannot be saved yet (a larger transaction waits for its choice, a share for parts that make the transaction). */
  readonly saveBlocked = computed(() => this.pendingPlan().kind === 'invalid' || this.pendingPlan().kind === 'higher' || this.shareBlocked() || this.partEditsInvalid() || this.foreignPartInvalid()
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
    const others = this.orderPayments().filter(payment => payment.bankStatementLineId === line.id && !own.has(payment.id)).map(payment => {
      const payee = payment.payee ?? 'SUPPLIER';
      const via = payee === 'SEPARATE' && this.viaSupplier() ? ' (via leverancier)' : '';
      return `${PAYEE_SHORT[payee]} ${formatEur(payment.amountEur)}${via}`;
    });
    // One transaction shared over containers (Emre, 2026-10-16): the other containers' parts after this container's own.
    const shared = this.lineShares().filter(item => item.lineId === line.id).map(item => `${item.name} ${formatEur(item.amountEur)}`);
    return others.length || shared.length ? [...others, ...shared].join(', ') : null;
  }
  /** One of the payment's transactions already carries an inspection part of this container: no second split is offered. */
  private readonly lineHasInspection = computed(() => this.parts().some(part => part.bankStatementLineId != null
    && this.orderPayments().some(payment => payment.bankStatementLineId === part.bankStatementLineId && (payment.payee ?? 'SUPPLIER') === 'SEPARATE')));
  carve(line: BankStatementLine): string {
    const part = this.pendingPart(), plan = this.pendingPlan();
    if (!part) return '';
    // A USD/CNY part is named in the payment's currency: the server's own words for it.
    if (plan.kind === 'part' && plan.amount != null) return carveForeignText(plan.amount, line.amountEur, this.foreignOf(part)?.amount ?? part.amount, part.currency);
    return carveText(this.partEur(part), line.amountEur);
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
  partAmountInput(part: LedgerPart): string { return this.draft().partEdits?.[part.id]?.amountInput ?? amountInputText(part.amount); }
  partEurInput(part: LedgerPart): string { return this.draft().partEdits?.[part.id]?.amountEurInput ?? ''; }
  partInvalid(part: LedgerPart): boolean { const edit = this.draft().partEdits?.[part.id]; return !!edit && edit.amount === null; }
  editPart(part: LedgerPart, field: 'amount' | 'eur', raw: string): void {
    const edits = { ...(this.draft().partEdits ?? {}) };
    const current = edits[part.id] ?? { amountInput: amountInputText(part.amount), amount: part.amount };
    edits[part.id] = field === 'amount'
      ? { ...current, amountInput: raw, amount: parsePurchasePaymentAmount(raw), amountEurInput: '', amountEur: null }
      : { ...current, amountEurInput: raw, amountEur: parsePurchasePaymentAmount(raw) };
    this.patch.emit({ partEdits: edits });
  }
  /** 'Transactie toevoegen': the picker opens for that part; picking for another part drops the other part's picks. */
  pickFor(partId: number): void {
    this.picking.set(partId);
    if (this.draft().pendingPartId !== partId) this.patch.emit({ pendingPartId: partId, pendingLines: [], surplus: null, ...this.noForeignPart });
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
    const foreign = part ? this.foreignOf(part) : null;
    const blocked = !!part && inspectionSplitBlocked(pendingLinkPlan(this.partEur(part), lines, this.roundOnServer(), null, [], foreign ? { ...foreign, part: null } : null));
    const stored = this.roundOnServer() && !this.grouped() && part ? this.storedMoney(part) : {};
    this.patch.emit({ pendingPartId: partId, pendingLines: lines, surplus: null, ...stored, ...this.noForeignPart, bankLinkError: '',
      ...(blocked ? { inspectionSplit: null, inspectionSplitInput: '' } : {}) });
  }
  /** The stored money and day of a payment never split, as the fields show them. */
  private storedMoney(part: LedgerPart): Partial<PurchasePaymentDraft> {
    const foreign = part.currency !== 'EUR' && part.amountEur > 0;
    return { amount: part.amount, amountInput: amountInputText(part.amount), currency: part.currency, paidOn: part.paidOn,
      amountEurInput: foreign ? amountInputText(part.amountEur) : '', amountEur: foreign ? part.amountEur : null };
  }
  dropPending(line: BankStatementLine): void {
    this.patch.emit({ pendingLines: (this.draft().pendingLines ?? []).filter(item => item.id !== line.id), surplus: null, ...this.noForeignPart, bankLinkError: '' });
  }
  /** Drops every pick (and 'Transactie toevoegen'): nothing is linked. */
  cancelPending(): void {
    this.picking.set(null);
    this.patch.emit({ pendingLines: [], pendingPartId: null, surplus: null, addTransfer: false, ...this.noForeignPart, bankLinkError: '' });
  }
  /** 'Transactie toevoegen' on a payment fully on the bank: the picker opens for one more transfer of the newest one's payment. */
  startAdd(): void {
    const newest = this.parts()[this.parts().length - 1];
    if (!newest) return;
    this.picking.set(null);
    this.patch.emit({ addTransfer: true, pendingPartId: newest.id, pendingLines: [], surplus: null, ...this.noForeignPart, bankLinkError: '' });
  }
  pickAdded(line: BankStatementLine | null): void {
    if (line) this.patch.emit({ pendingLines: [line], surplus: null, bankLinkError: '' });
  }
  /**
   * What the surplus of a larger transaction is; the inspection rest replaces a typed split. A refused choice can be changed: nothing was linked.
   * 'Verdelen over containers' starts on this payment's own euro and asks the host for the containers (it proposes the first rows).
   */
  chooseSurplus(choice: SurplusChoice | null): void {
    const part = this.pendingPart();
    const share: Partial<PurchasePaymentDraft> = choice === 'SHARE' && part
      ? { alsoParts: [], shareOwn: this.partEur(part), shareOwnInput: amountInputText(this.partEur(part)), shareMode: 'AFSPRAAK', shareProposed: false, ...this.noForeignPart }
      : { alsoParts: [], shareOwn: null, shareOwnInput: '', shareMode: undefined, shareProposed: false };
    this.patch.emit({ surplus: choice, inspectionSplit: null, inspectionSplitInput: '', bankLinkError: '', ...share });
    if (choice === 'SHARE') this.alsoLoad.emit();
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
  /**
   * The typed number is an invoice the payee already has (the server refuses
   * the same number twice): pick that one instead. Not after a lost answer,
   * when the invoice is the one this sheet sent (invoiceAttempt).
   */
  readonly duplicateInvoice = computed(() => {
    const pay = this.draft(), fresh = pay.newInvoice;
    const key = invoiceNumberKey(fresh?.number);
    if (!fresh?.open || pay.createdInvoiceId != null || !key || pay.invoiceAttempt === key) return null;
    return invoicesOf(this.invoices(), pay.payee).find(invoice => invoiceNumberKey(invoice.number) === key) ?? null;
  });
  readonly newInvoiceInvalid = computed(() => {
    const pay = this.draft();
    const fresh = pay.newInvoice;
    return !!fresh?.open && pay.createdInvoiceId == null && (!fresh.number.trim() || !fresh.invoiceDate || fresh.amount === null || !!this.duplicateInvoice());
  });
  /** The payee has another invoice beside the new one: only then can 'Voor alle deelbetalingen' be switched off. */
  readonly newInvoiceBeside = computed(() => {
    const pay = this.draft(), key = invoiceNumberKey(pay.newInvoice?.number);
    return invoicesOf(this.invoices(), pay.payee).some(invoice => invoiceNumberKey(invoice.number) !== key);
  });
  /** The new invoice is the payee's only one: it holds for every payment of the payee (the automatic rule). */
  readonly newInvoiceNote = computed(() => {
    const pay = this.draft();
    const count = this.payeePaymentCount() + (pay.id ? 0 : 1);
    return `Geldt voor alle betalingen van ${PAYEE_LABEL[pay.payee]}${count ? ' (' + count + ')' : ''}`;
  });
  /** 'Kies CI-…': the existing invoice instead of a second one with the same number; a typed file goes to it when it has none. */
  useExistingInvoice(existing: PurchaseInvoice): void {
    const file = existing.documentId == null ? this.draft().newInvoice?.file ?? null : null;
    this.patch.emit({ invoiceId: existing.id, invoiceIdChanged: true, newInvoice: undefined,
      ...(file ? { invoiceFile: file, invoiceFileFor: existing.id } : {}) });
  }
  option(invoice: PurchaseInvoice): string { return invoiceOption(invoice); }
  parse(raw: string): number | null { return parsePurchasePaymentAmount(raw); }
  openNewInvoice(): void {
    const pay = this.draft();
    this.patch.emit({ newInvoice: { open: true, number: '', invoiceDate: this.today(), amountInput: '', amount: null, currency: pay.currency, file: null, forAll: true } });
  }
  /** 'Bestand bij de factuur': one file for the chosen invoice that has none, kept with that invoice's id (the save uploads it there). */
  chooseInvoiceFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    const invoice = this.chosenInvoice();
    if (file && invoice) this.patch.emit({ invoiceFile: file, invoiceFileFor: invoice.id });
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

  /* ------------------------------------------- one transfer, several containers */

  /** A new EUR supplier payment on a picked transaction may share it with other containers. */
  readonly alsoOffered = computed(() => {
    const pay = this.draft();
    return !pay.id && !!pay.bankTransaction && pay.payee === 'SUPPLIER' && pay.currency === 'EUR' && !this.creditOffset() && this.roundOnServer();
  });
  readonly alsoChoices = computed(() => {
    const chosen = new Set((this.draft().alsoParts ?? []).map(part => part.orderId));
    return this.alsoState().options.filter(option => !chosen.has(option.orderId));
  });
  readonly lineEur = computed(() => Math.abs(this.draft().bankTransaction?.amountEur ?? 0));
  /** This payment's transfer and the other containers' parts together, against the transaction. */
  readonly alsoTotal = computed(() => Math.round((this.transferEur() + alsoTotalEur(this.draft().alsoParts)) * 100) / 100);
  readonly alsoMatches = computed(() => bankAmountsMatch(this.alsoTotal(), this.lineEur()));
  /** What the picked transaction is held against: this transfer, with the other containers' parts when they share it. */
  readonly pickerEur = computed(() => (this.alsoOffered() && this.draft().alsoOpen ? this.alsoTotal() : this.transferEur()));
  otherSupplier(part: AlsoContainerPart): boolean { return this.supplierId() !== null && part.supplierId !== this.supplierId(); }
  toggleAlso(open: boolean): void {
    const pay = this.draft();
    if (open) { this.patch.emit({ alsoOpen: true }); this.alsoLoad.emit(); return; }
    this.patch.emit({ alsoOpen: false, alsoParts: [], ...this.rebalance(pay.alsoParts ?? [], []) });
  }
  /** A container added: its open payment when it has one, this payment's term first (never a second payment; under 'Automatisch' too), else a new one on its open term. */
  addAlso(value: string): void {
    const option = this.alsoState().options.find(item => item.orderId === Number(value));
    if (!option) return;
    const pay = this.draft(), part = this.pendingPart();
    const due = pay.id ? part?.payment.instalmentDue ?? pay.instalmentDue ?? null : pay.instalmentDue ?? null;
    const before = pay.alsoParts ?? [];
    this.patch.emit(this.withParts(before, [...before, alsoPartFor(option, due, pay.label || part?.payment.label || null)]));
  }
  removeAlso(orderId: number): void {
    const before = this.draft().alsoParts ?? [];
    this.patch.emit(this.withParts(before, before.filter(part => part.orderId !== orderId)));
  }
  /** A typed amount; in a share every amount typed by hand makes the mode MANUAL. */
  setAlsoAmount(orderId: number, raw: string): void {
    const amount = parsePurchasePaymentAmount(raw);
    this.patch.emit({ alsoParts: (this.draft().alsoParts ?? []).map(part => part.orderId === orderId ? { ...part, amountInput: raw, amount: amount !== null && amount > 0 ? amount : null } : part),
      ...(this.draft().id ? { shareMode: 'MANUAL' as const } : {}) });
  }
  /** While the transaction was balanced, this payment's goods give or take what a container added or removed takes. */
  private rebalance(before: readonly AlsoContainerPart[], after: readonly AlsoContainerPart[]): Partial<PurchasePaymentDraft> {
    const goods = rebalancedGoods(this.draft().amount, this.transferEur(), alsoTotalEur(before), alsoTotalEur(after), this.lineEur());
    return goods === null ? {} : { amount: goods, amountInput: amountInputText(goods) };
  }

  /** "Container toevoegen…": the name first (containerName), the PO number beside an alias, another supplier and an open payment said. */
  optionText(option: AlsoContainerOption): string {
    const name = containerName({ id: option.orderId, number: option.number, alias: option.alias });
    const number = containerNumberHint(name, option.number);
    return `${name}${number ? ' · ' + number : ''}${option.openPayments?.length ? ' · open betaling' : ''}${option.supplierId !== this.supplierId() ? ' · ' + (option.supplier || 'andere leverancier') : ''}`;
  }
  /** 'Geen andere container met een open bedrag of open betaling voor de leverancier.' */
  readonly alsoEmptyText = computed(() => {
    const payee = this.draft().payee;
    return `Geen andere container met een open bedrag of open betaling voor ${payee === 'SUPPLIER' ? 'de leverancier' : PAYEE_LABEL[payee]}.`;
  });
  partName(part: AlsoContainerPart): string { return containerName({ id: part.orderId, number: part.number, alias: part.alias }); }
  numberHint(part: AlsoContainerPart): string | null { return containerNumberHint(this.partName(part), part.number); }
  partKey(part: AlsoContainerPart): string { return alsoPartKey(part); }
  /** The row's select: its open payments and the terms a new payment can go on. */
  choicesOf(part: AlsoContainerPart): { key: string; text: string }[] {
    const option = this.alsoState().options.find(item => item.orderId === part.orderId);
    return option ? alsoPartChoices(option) : [];
  }
  /** The transaction's day, the one every part takes. */
  private readonly shareDay = computed(() => {
    const line = this.draft().id ? this.pendingLine() : this.draft().bankTransaction ?? null;
    return line ? bankTransactionDay(line) : this.draft().paidOn;
  });
  /** 'bestaande betaling · 30% bij bestelling · € 3.070,20 · nog niet op de bank · betaling wordt € 3.801,13 (was …); …', or what a new payment does. */
  alsoRowText(part: AlsoContainerPart): string {
    const effect = shareEffect({ paymentEur: part.paymentId != null ? part.paymentEur ?? null : null, currency: part.paymentCurrency, amount: part.paymentAmount,
      partEur: part.amount, standing: part.standing ?? null, day: this.shareDay(), label: part.label, openEur: part.paymentId != null ? null : part.openEur ?? null });
    return part.paymentId != null
      ? `bestaande betaling · ${part.label} · ${this.bookedText(part.paymentAmount ?? null, part.paymentCurrency ?? 'EUR', part.paymentEur ?? 0)} · nog niet op de bank · ${effect}` : effect;
  }
  /** '€ 3.070,20', or a USD/CNY payment with its euro: 'US$ 4.000,00 (€ 3.680,00)'. */
  private bookedText(amount: number | null, currency: Currency, amountEur: number): string {
    return currency === 'EUR' || amount === null ? formatEur(amountEur)
      : `${amount.toLocaleString('nl-BE', { style: 'currency', currency })} (${formatEur(amountEur)})`;
  }

  /* ---- 'Verdelen over containers': a saved payment's larger transaction shared with other containers (Emre, 2026-10-16) */
  /** Offered on a saved payment's one larger transaction (a USD/CNY one too), never for Andere kosten, a credit offset or 'Transactie toevoegen'. */
  readonly shareOffered = computed(() => {
    const pay = this.draft();
    return this.roundOnServer() && !!pay.id && pay.payee !== 'OTHER' && !this.creditOffset() && !pay.addTransfer && !!this.pendingLine() && !!this.pendingPart();
  });
  /** This payment's weight 'Volgens afspraak': its booked euro (or its typed correction). */
  private readonly shareOwnWeight = computed(() => { const part = this.pendingPart(); return part ? this.partEur(part) : null; });
  readonly shareState = computed(() => shareStatus(this.draft().shareOwn ?? null, this.draft().alsoParts ?? [], this.pendingLineEur()));
  /** No other container yet, an empty or invalid amount, parts that do not make the transaction, or the containers still loading. */
  readonly shareBlocked = computed(() => {
    if (this.pendingPlan().kind !== 'share') return false;
    const pay = this.draft(), parts = pay.alsoParts ?? [];
    return this.alsoState().loading || !parts.length || parts.some(part => !((part.amount ?? 0) > 0)) || !((pay.shareOwn ?? 0) > 0) || !this.shareState().matches;
  });
  /** 'deze betaling · 30% bij bestelling · € 3.070,20 · betaling wordt € 3.801,13 (was € 3.070,20); de termijn komt € 789,48 boven de afspraak'. */
  readonly ownShareText = computed(() => {
    const part = this.pendingPart(), pay = this.draft();
    if (!part) return '';
    const effect = shareEffect({ paymentEur: this.partEur(part), currency: part.currency, amount: part.amount, partEur: pay.shareOwn ?? null,
      standing: this.termStanding(), day: this.shareDay() });
    return `deze betaling · ${pay.label || part.payment.label || PAYEE_LABEL[pay.payee]} · ${this.bookedText(part.amount, part.currency, this.partEur(part))} · ${effect}`;
  });
  /** 'PO-2026-038' beside 'Moederdag Rood (deze container)'; nothing when the name is the number. */
  readonly ownNumberHint = computed(() => containerNumberHint(this.orderName(), this.orderNumber()));
  /**
   * Under Bedrag while a picked transaction waits: the payment follows the
   * transaction, or in a share this container's part of it (never the whole
   * transaction: 'Bedrag aanpassen naar € 11.403,38' was just what was wrong).
   */
  readonly linkingHint = computed(() => {
    const pay = this.draft();
    if (this.pendingPlan().kind !== 'share') {
      return `${pay.currency === 'EUR' ? 'Bedrag en datum volgen de transactie bij het koppelen' : `De euro en de datum volgen de transactie bij het koppelen; het bedrag in ${pay.currency} blijft`} (zie Wat verandert).`;
    }
    const own = (pay.shareOwn ?? 0) > 0 ? `: ${formatEur(pay.shareOwn!)} op ${dayText(this.shareDay())}` : '';
    return pay.currency === 'EUR' ? `Bedrag en datum volgen het deel van deze container${own} (zie Verdelen over containers).`
      : `De euro en de datum volgen het deel van deze container${own}; het bedrag in ${pay.currency} blijft (zie Verdelen over containers).`;
  });
  setShareOwn(raw: string): void {
    const amount = parsePurchasePaymentAmount(raw);
    this.patch.emit({ shareOwnInput: raw, shareOwn: amount !== null && amount > 0 ? amount : null, shareMode: 'MANUAL' });
  }
  /** 'Volgens afspraak' (by each part's Afspraak) or 'Gelijk verdelen' (1/n), to the cent; a part without an Afspraak leaves the amounts as typed. */
  setShareMode(mode: 'AFSPRAAK' | 'EQUAL'): void {
    this.patch.emit(this.shared(mode, this.draft().alsoParts ?? []) ?? { shareMode: 'MANUAL' });
  }
  /** The rows with the amounts of a mode; MANUAL (or a missing weight) keeps them as typed. */
  private shared(mode: ShareMode | undefined, parts: readonly AlsoContainerPart[]): Partial<PurchasePaymentDraft> | null {
    if (mode !== 'AFSPRAAK' && mode !== 'EQUAL') return null;
    const applied = parts.length ? applyShare(mode, this.pendingLineEur(), this.shareOwnWeight(), parts) : null;
    return applied ? { alsoParts: applied.parts, shareOwn: applied.own, shareOwnInput: amountInputText(applied.own), shareMode: mode } : null;
  }
  /** The other rows changed (added, removed, switched): a share follows its mode, a new transfer keeps this payment's goods balanced. */
  private withParts(before: readonly AlsoContainerPart[], after: AlsoContainerPart[]): Partial<PurchasePaymentDraft> {
    if (this.draft().id) return this.shared(this.draft().shareMode, after) ?? { alsoParts: after };
    return { alsoParts: after, ...this.rebalance(before, after) };
  }
  /**
   * 'Bestaand: € x' or 'Nieuw: <term>' for one row. A share keeps the typed
   * amount and follows its mode; a new transfer's row takes the choice's own
   * amount (as a container added does) and this payment's goods give or take
   * the difference while the transaction was made.
   */
  switchAlso(orderId: number, key: string): void {
    const option = this.alsoState().options.find(item => item.orderId === orderId);
    const before = this.draft().alsoParts ?? [];
    const current = before.find(part => part.orderId === orderId);
    const share = !!this.draft().id;
    const next = option && current ? alsoPartAs(option, key, current, !share) : null;
    if (!next) return;
    const after = before.map(part => part.orderId === orderId ? next : part);
    this.patch.emit(share ? this.shared(this.draft().shareMode, after) ?? { alsoParts: after } : this.withParts(before, after));
  }

  chooseBank(row: BankStatementLine | null): void {
    const pay = this.draft();
    if (this.busy() || pay.bankLinkPending) return;
    if (!row) { this.patch.emit({ bankTransaction: null, bankLinkError: '', alsoOpen: false, alsoParts: [] }); return; }
    const total = Math.abs(row.amountEur);
    const parts = (pay.freightAmount ?? 0) + (pay.separateAmount ?? 0) + alsoTotalEur(pay.alsoParts);
    const goods = Math.round((total - parts) * 100) / 100;
    this.patch.emit({ bankTransaction: row, paidOn: bankTransactionDay(row), bankLinkError: '',
      ...(pay.id || bankAmountsMatch(this.transferEur(), total) ? {} : pay.currency === 'EUR' ? { amount: goods, amountInput: amountInputText(goods) }
        : { amountEur: total, amountEurInput: amountInputText(total) }) });
  }
  constructor() {
    void this.bankAccounts.load();
  }
}
