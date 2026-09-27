import {
  ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import type { Payee, PurchaseDocument, PurchasePayment } from '../../core/api/models';
import { ContextMenu, type ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { Icon } from '../../shared/icon';
import { keyContext } from '../../shared/key-context';
import { MenuTrigger } from '../../shared/menu-trigger';
import { CurPipe, DateNlPipe, EurPipe } from '../../shared/pipes';
import { Skeleton } from '../../shared/skeleton';
import {
  PAYEE_ICON, PAYEE_LABEL, PAYEE_SHORT, PAYEE_TONE, SUPPLIER_GOODS, payeeRowAction, sortLedgerRows, type Due, type LedgerRow, type LedgerTodo,
  type PayeeLedger, type LedgerTerm, type PaymentLedger, type PurchasePaymentAction, type PurchaseSettleRequest,
} from './purchase-payment-ledger';
import { formatEur, payeeMenuItems, payeeRowMenuItems, paymentMenuItems, settleWith, todoCopy } from './purchase-payment-menus';
import { PurchaseNacalcSummaryCard } from './purchase-nacalc-summary';
import type { PurchaseNacalcSummary } from './purchase-payment-result-metrics';

type LedgerFilter = 'ALL' | Payee | 'NO_PROOF';
type MenuState =
  | { kind: 'payees'; point: MenuPoint }
  | { kind: 'more'; point: MenuPoint }
  | { kind: 'term'; point: MenuPoint; term: LedgerTerm }
  | { kind: 'payee'; point: MenuPoint; payee: PayeeLedger }
  | { kind: 'payment'; point: MenuPoint; row: LedgerRow }
  | { kind: 'proofs'; point: MenuPoint; row: LedgerRow };

/**
 * Betalingen on the desk: money out of the container as a workbench. The
 * equation strip answers "what do I still pay and what is due now", the
 * payee table shows every agreement closing to the cent, the ledger lists
 * every payment with its proof, and the side cards say what to do and how
 * the payees add up to the landed total. Styles: styles/purchase-payments.scss.
 */
@Component({
  selector: 'app-purchase-payment-workbench',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ContextMenu, Icon, MenuTrigger, Skeleton, PurchaseNacalcSummaryCard, EurPipe, CurPipe, DateNlPipe],
  host: { '(keydown)': 'onKey($event)' },
  template: `
    <div class="pw">
      <div class="wk-toolbar wk-toolbar--sticky pw-bar">
        <div class="wk-toolbar__lead">
          <div class="pw-bar__copy">
            <h2 class="wk-toolbar__title" id="purchase-payments-title">{{ state() === 'loading' ? 'Betalingen laden…' : state() === 'error' ? 'Betalingen niet actueel' : 'Betalingen' }}</h2>
            <p class="pw-bar__sub">Per ontvanger: wat is afgesproken, wat is betaald en wat nog open staat.</p>
          </div>
        </div>
        <div class="wk-toolbar__tools">
          <div class="wk-split">
            <button class="wk-btn wk-btn--primary" type="button" [disabled]="!actionable()" (click)="addMain()"><app-icon name="plus" [size]="16" />Betaling</button>
            <button class="wk-btn wk-btn--primary" type="button" aria-label="Betaling aan…" [disabled]="!actionable()" (click)="openMenu('payees', $event)"><app-icon name="chevron-down" [size]="14" /></button>
          </div>
          <button class="wk-btn" type="button" [disabled]="!actionable() || !settleTarget()" [title]="settleHint()" (click)="settleMain()">Afrekenen…</button>
          @if (settleHintVisible()) { <span class="pw-bar__hint">{{ settleHint() }}</span> }
          <button class="wk-btn" type="button" [disabled]="busy()" (click)="planChange.emit()">Betaalplan…</button>
          <button class="wk-btn wk-btn--icon" type="button" aria-label="Meer acties" (click)="openMenu('more', $event)"><app-icon name="more" [size]="18" /></button>
        </div>
      </div>
      @if (dirty()) {
        <div class="wk-banner wk-banner--warn wk-banner--inset pw-note" role="status">
          <app-icon name="alert" [size]="16" />
          <span class="wk-banner__text">Niet-opgeslagen wijzigingen aan de order. Die worden eerst opgeslagen voordat je een betaling noteert of afrekent.</span>
          <span class="wk-banner__actions"><button class="wk-btn wk-btn--sm" type="button" [disabled]="saving()" (click)="save.emit()">{{ saving() ? 'Opslaan…' : 'Opslaan' }}</button></span>
        </div>
      }
      @switch (state()) {
        @case ('loading') {
          <div class="pw-content"><app-skeleton kind="stats" [rows]="4" /><app-skeleton kind="list" [rows]="4" />
            <p class="pw-muted pw-late">Blijft dit laden? <button class="wk-link" type="button" (click)="refresh.emit()">Opnieuw laden</button></p></div>
        }
        @case ('error') {
          <div class="wk-banner wk-banner--danger wk-banner--inset pw-note" role="alert">
            <app-icon name="alert" [size]="16" />
            <span class="wk-banner__text">{{ error() || 'Het betalingsoverzicht kon niet worden geladen.' }}</span>
            <span class="wk-banner__actions"><button class="wk-btn wk-btn--sm" type="button" (click)="refresh.emit()">Opnieuw laden</button></span>
          </div>
        }
        @default {
          @if (ledger(); as book) {
            @let sum = book.summary;
            <div class="wk-strip pw-strip" aria-label="Afspraak, betaald en open" [class.is-loading]="state() === 'refreshing'">
              <div class="wk-strip__item pw-cell"><span class="wk-strip__label">Afspraak</span><span class="wk-strip__value">{{ sum.agreedEur | eur }}</span><small class="pw-strip__sub">leverancier, transport en inspectie</small></div>
              <span class="wk-strip__op pw-op" aria-hidden="true">−</span>
              <div class="wk-strip__item pw-cell"><span class="wk-strip__label">Betaald</span><span class="wk-strip__value">{{ sum.paidOnAgreementEur | eur }}</span><small class="pw-strip__sub">volgens afspraak</small></div>
              @if (sum.differenceEur !== 0) {
                <span class="wk-strip__op pw-op pw-strip__wide" aria-hidden="true">±</span>
                <div class="wk-strip__item pw-strip__wide"><span class="wk-strip__label">Verschil</span>
                  <span class="wk-strip__value">{{ abs(sum.differenceEur) | eur }} {{ sum.differenceEur < 0 ? 'minder' : 'meer' }}</span>
                  <small class="pw-strip__sub">{{ reviewHigher() ? 'nog na te kijken' : 'na afrekening' }}</small></div>
              }
              <span class="wk-strip__op pw-op" aria-hidden="true">=</span>
              <div class="wk-strip__item pw-cell"><span class="wk-strip__label">Open</span><span class="wk-strip__value">{{ sum.openEur | eur }}</span><small class="pw-strip__sub">@if (sum.laterEur > 0) { waarvan later {{ sum.laterEur | eur }} } @else if (sum.openEur > 0) { volledig nu te betalen } @else { niets meer open }</small></div>
              @if (sum.additionalEur > 0) {
                <span class="wk-strip__sep pw-strip__wide" aria-hidden="true"></span>
                <div class="wk-strip__item pw-strip__wide"><span class="wk-strip__label">Bijkomende kosten</span><span class="wk-strip__value">{{ sum.additionalEur | eur }}</span><small class="pw-strip__sub">zonder afspraak</small></div>
              }
              <div class="wk-strip__item pw-cell pw-now" [class.is-due]="sum.dueNowEur > 0">
                @if (sum.headline.kind === 'concept') {
                  <span class="wk-strip__label">Status</span><span class="wk-strip__value">Nog niet besteld</span>
                  @if (planLabel()) { <small class="pw-strip__sub">{{ planLabel() }}</small> }
                } @else if (sum.dueNowEur > 0) {
                  <span class="wk-strip__label">Nu te betalen</span><span class="wk-strip__value">{{ sum.dueNowEur | eur }}</span>
                  @if (sum.next; as next) {
                    <small class="pw-strip__sub">Volgende: {{ next.label }}@if (next.due) { · {{ label(next.payee) }} }</small>
                    <button class="wk-btn wk-btn--sm wk-btn--primary" type="button" [disabled]="!actionable()"
                            (click)="add.emit({ payee: next.payee, amount: next.amountEur, label: next.label, due: next.due })">Noteer</button>
                  }
                } @else if (sum.openEur > 0) {
                  <span class="wk-strip__label">Nu te betalen</span><span class="wk-strip__value">Niets</span>
                  @if (sum.next; as next) { <small class="pw-strip__sub">Volgende: {{ next.label }} · {{ next.when }}</small> }
                } @else if (sum.paymentCount || sum.paidTotalEur > 0) {
                  <span class="wk-strip__label">Status</span><span class="wk-strip__value">Alles betaald</span><small class="pw-strip__sub">{{ sum.paidTotalEur | eur }} betaald</small>
                } @else {
                  <span class="wk-strip__label">Status</span><span class="wk-strip__value">Nog geen bedragen</span>
                }
              </div>
            </div>
            <div class="pw-content" [class.is-loading]="state() === 'refreshing'" [attr.inert]="state() === 'refreshing' ? '' : null" [attr.aria-busy]="state() === 'refreshing'">
              <div class="pw-main">
                <div class="pw-summary">
                  <p class="pw-formula">Afspraak {{ sum.agreedEur | eur }} − betaald {{ sum.paidOnAgreementEur | eur }}@if (sum.lowerEur > 0) { − {{ sum.lowerEur | eur }} minder betaald }@if (sum.higherEur > 0) { + {{ sum.higherEur | eur }} meer betaald } = open {{ sum.openEur | eur }}@if (sum.additionalEur > 0) { · bijkomende kosten {{ sum.additionalEur | eur }} }</p>
                  @if (sum.agreedEur > 0) {
                    <div class="pw-meter">
                      <div class="wk-meter" role="img" [attr.aria-label]="'Betaald ' + pct(sum.meter.paidPct) + '%, nu te betalen ' + pct(sum.meter.duePct) + '%, later ' + pct(sum.meter.laterPct) + '%'">
                        <i class="tone-ok" [style.width.%]="sum.meter.paidPct"></i><i class="tone-warn" [style.width.%]="sum.meter.duePct"></i><i class="is-rest" [style.width.%]="sum.meter.laterPct"></i>
                      </div>
                      @if (sum.meter.agreedPct !== null) { <span class="pw-meter__mark" [style.left.%]="sum.meter.agreedPct" title="Einde van de afspraak"></span> }
                    </div>
                  }
                  @if (sum.additionalEur > 0 || sum.missingProofCount || !sum.known) {
                    <p class="pw-foot">@if (sum.additionalEur > 0) { Totaal betaald {{ sum.paidTotalEur | eur }} incl. {{ sum.additionalEur | eur }} bijkomende kosten }@if (sum.missingProofCount) { @if (sum.additionalEur > 0) { · }<button class="wk-link" type="button" (click)="setFilter('NO_PROOF')">{{ sum.missingProofCount }} zonder bewijs ›</button> }@if (!sum.known) { @if (sum.additionalEur > 0 || sum.missingProofCount) { · }Voorlopige cijfers }</p>
                  }
                  @if (!sum.balanced) { <p class="pw-foot wk-amount--warn" role="status">Bedragen sluiten niet: een betaling mist de eurowaarde. Controleer de betalingen.</p> }
                </div>

                <section class="pw-section" aria-labelledby="pw-payees-title">
                  <h3 class="pw-section__title" id="pw-payees-title">Per ontvanger</h3>
                  <div class="wk-table pw-payees" [class.pw-payees--diff]="showDifference()" role="treegrid" aria-labelledby="pw-payees-title">
                    <div class="wk-thead" role="row">
                      <span class="wk-th" role="columnheader"><span class="sr-only">Openklappen</span></span>
                      <span class="wk-th" role="columnheader">Ontvanger</span>
                      <span class="wk-th wk-th--num" role="columnheader">Afspraak</span>
                      <span class="wk-th wk-th--num" role="columnheader">Betaald</span>
                      @if (showDifference()) { <span class="wk-th wk-th--num" role="columnheader" data-pw-hide="narrow">Verschil</span> }
                      <span class="wk-th wk-th--num" role="columnheader">Open</span>
                      <span class="wk-th wk-th--num" role="columnheader" data-pw-hide="mid">Nu te betalen</span>
                      <span class="wk-th" role="columnheader" data-pw-hide="tiny">Status</span>
                      <span class="wk-th" role="columnheader"><span class="sr-only">Acties</span></span>
                    </div>
                    @for (item of agreements(); track item.payee) {
                      <div class="wk-tr wk-tr--link pw-payee-row" role="row" tabindex="0" aria-level="1" [attr.aria-selected]="selectedPayee() === item.payee" [attr.data-payee]="item.payee"
                           [attr.aria-expanded]="expandable(item) ? isExpanded(item.payee) : null"
                           appMenuTrigger (menuTrigger)="menu.set({ kind: 'payee', point: $event, payee: item })"
                           (click)="rowClick($event, item.payee)" (dblclick)="toggle(item.payee)"
                           (keydown)="onPayeeKey($event, item.payee)">
                        <span class="wk-td" role="gridcell">
                          @if (expandable(item)) {
                            <button class="pw-chev" type="button" [attr.aria-expanded]="isExpanded(item.payee)" [attr.aria-label]="(isExpanded(item.payee) ? 'Dichtklappen: ' : 'Openklappen: ') + item.label"
                                    (click)="$event.stopPropagation(); toggle(item.payee)"><app-icon name="chevron-right" [size]="14" /></button>
                          }
                        </span>
                        <span class="wk-td" role="gridcell"><span class="pw-payee"><span class="pw-tile" [class]="item.tone"><app-icon [name]="item.icon" [size]="14" /></span>
                          <span class="pw-payee__copy"><b>{{ item.label }}</b><span class="wk-td__sub pw-basis" [title]="item.basis">{{ basis(item) }}</span>
                            @if (item.dueNowEur > 0) { <span class="wk-td__sub pw-when-mid">{{ item.dueNowEur | eur }} nu</span> }
                            <span class="pw-when-tiny"><span class="wk-pill" [class]="pill(item.status.tone)">{{ item.status.label }}</span></span></span></span></span>
                        <span class="wk-td wk-td--num wk-amount" role="gridcell">{{ item.agreedEur | eur }}</span>
                        <span class="wk-td wk-td--num wk-amount" role="gridcell">{{ item.paidEur | eur }}</span>
                        @if (showDifference()) {
                          <span class="wk-td wk-td--num wk-amount" role="gridcell" data-pw-hide="narrow">@if (item.differenceEur) { {{ abs(item.differenceEur) | eur }}<span class="wk-td__sub">{{ item.differenceEur < 0 ? 'minder' : 'meer' }}</span> }</span>
                        }
                        <span class="wk-td wk-td--num wk-amount wk-amount--strong" role="gridcell">{{ item.openEur | eur }}
                          @if (showDifference() && item.differenceEur) { <span class="wk-td__sub pw-open-sub pw-when-narrow">{{ abs(item.differenceEur) | eur }} {{ item.differenceEur < 0 ? 'minder' : 'meer' }} · afgerekend</span> }</span>
                        <span class="wk-td wk-td--num wk-amount" role="gridcell" data-pw-hide="mid" [class.wk-amount--warn]="item.dueNowEur > 0">@if (item.dueNowEur > 0) { {{ item.dueNowEur | eur }} }</span>
                        <span class="wk-td wk-td--wrap" role="gridcell" data-pw-hide="tiny">
                          <span class="wk-pill" [class]="pill(item.status.tone)">{{ item.status.label }}</span>
                          @if (item.smallDifference) {
                            <button class="wk-link pw-status-link" type="button" [disabled]="!actionable()" (click)="$event.stopPropagation(); settle.emit(item.settleDefault)">Verschil van {{ item.openEur | eur }} afrekenen</button>
                          } @else if (item.canUndoSettle) {
                            <button class="wk-link pw-status-link" type="button" [disabled]="!actionable()" (click)="$event.stopPropagation(); undoSettle.emit({ payee: item.payee })">Afrekening ongedaan maken</button>
                          } @else if (nextSub(item); as sub) {
                            <span class="wk-td__sub pw-status-sub">{{ sub }}</span>
                          }
                        </span>
                        <span class="wk-td wk-td--actions" role="gridcell">
                          @switch (rowAction(item)) {
                            @case ('add') { <button class="wk-btn wk-btn--sm" type="button" data-pw-hide="narrow" [disabled]="!actionable()" (click)="$event.stopPropagation(); addFor(item)">Noteer</button> }
                            @case ('settle') { <button class="wk-btn wk-btn--sm" type="button" data-pw-hide="narrow" [disabled]="!actionable()" (click)="$event.stopPropagation(); settle.emit(item.settleDefault)">Afrekenen…</button> }
                          }
                          <button class="wk-btn wk-btn--sm wk-btn--icon pw-more" type="button" [attr.aria-label]="'Acties voor ' + item.label" (click)="$event.stopPropagation(); openMenu('payee', $event, item)"><app-icon name="more" [size]="16" /></button>
                        </span>
                      </div>
                      @if (isExpanded(item.payee)) {
                        @if (item.payee === 'SUPPLIER') {
                          @for (term of item.terms; track term.due) {
                            <div class="wk-tr wk-tr--sub" role="row" aria-level="2">
                              <span class="wk-td" role="gridcell"></span>
                              <span class="wk-td" role="gridcell"><span class="pw-sub">{{ term.label }}<span class="wk-td__sub">{{ term.moment }}</span></span></span>
                              <span class="wk-td wk-td--num wk-amount" role="gridcell">{{ term.fullEur | eur }}</span>
                              <span class="wk-td wk-td--num wk-amount" role="gridcell">{{ term.paidEur | eur }}</span>
                              @if (showDifference()) {
                                <span class="wk-td wk-td--num wk-amount" role="gridcell" data-pw-hide="narrow">@if (term.higherEur - term.lowerEur) { {{ abs(term.higherEur - term.lowerEur) | eur }}<span class="wk-td__sub">{{ term.higherEur < term.lowerEur ? 'minder' : 'meer' }}</span> }</span>
                              }
                              <span class="wk-td wk-td--num wk-amount" role="gridcell">{{ term.openEur | eur }}</span>
                              <span class="wk-td wk-td--num wk-amount" role="gridcell" data-pw-hide="mid">@if (term.state === 'due' && !term.settled && term.openEur > 0) { {{ term.openEur | eur }} }</span>
                              <span class="wk-td" role="gridcell" data-pw-hide="tiny"><span class="wk-pill" [class]="pill(term.status.tone)">{{ term.status.label }}</span></span>
                              <span class="wk-td wk-td--actions" role="gridcell">
                                @if (term.openEur > 0 && !term.settled) {
                                  <button class="wk-btn wk-btn--sm" type="button" data-pw-hide="narrow" [disabled]="!actionable()" (click)="add.emit({ payee: 'SUPPLIER', amount: term.openEur, label: term.label, due: term.due })">Noteer</button>
                                } @else if (term.canSettle) {
                                  <button class="wk-btn wk-btn--sm" type="button" data-pw-hide="narrow" [disabled]="!actionable()" (click)="settle.emit({ payee: 'SUPPLIER', scope: 'TERM', due: term.due })">Afrekenen…</button>
                                }
                                @if ((term.openEur > 0 && !term.settled) || term.canSettle || term.canUndo) {
                                  <button class="wk-btn wk-btn--sm wk-btn--icon pw-more" type="button" [attr.aria-label]="'Acties voor ' + term.label" (click)="openTermMenu(term, $event)"><app-icon name="more" [size]="16" /></button>
                                }
                              </span>
                            </div>
                          } @empty {
                            <div class="wk-tr wk-tr--sub pw-note-row" role="row" aria-level="2"><span class="wk-td wk-td--wrap" role="gridcell">Geen betaalplan ingesteld
                              <button class="wk-btn wk-btn--sm" type="button" [disabled]="busy()" (click)="planChange.emit()">Betaalplan…</button></span></div>
                          }
                        } @else {
                          <div class="wk-tr wk-tr--sub pw-comp-row pw-comp-row--caption" role="row" aria-level="2">
                            <span class="wk-td" role="gridcell" [class.wk-amount--warn]="!item.compositionConsistent">{{ item.compositionConsistent ? 'Raming uit Kosten' : 'Raming uit Kosten · wijkt af van de afspraak' }}</span>
                          </div>
                          @for (line of item.composition; track line.label) {
                            <div class="wk-tr wk-tr--sub pw-comp-row" role="row" aria-level="2">
                              <span class="wk-td pw-comp__label" role="gridcell">{{ line.label }}@if (line.hint) { <span class="wk-td__sub">{{ line.hint }}</span> }</span>
                              <span class="wk-td wk-td--num wk-amount pw-comp__amount" role="gridcell">{{ line.amountEur | eur }}</span>
                            </div>
                          }
                          @if (item.paymentCount) {
                            <div class="wk-tr wk-tr--sub pw-comp-row pw-comp-row--link" role="row" aria-level="2">
                              <span class="wk-td" role="gridcell">{{ item.paymentCount }} {{ item.paymentCount === 1 ? 'betaling' : 'betalingen' }} · {{ item.paidEur | eur }} betaald
                                <button class="wk-link" type="button" (click)="$event.stopPropagation(); setFilter(item.payee); scrollToLedger()">Toon betalingen ›</button></span>
                            </div>
                          }
                        }
                      }
                    }
                    <div class="wk-tr wk-tr--total" role="row">
                      <span class="wk-td" role="gridcell"></span>
                      <span class="wk-td" role="gridcell">Totaal@if (sum.dueNowEur > 0) { <span class="wk-td__sub pw-when-mid">{{ sum.dueNowEur | eur }} nu</span> }</span>
                      <span class="wk-td wk-td--num wk-amount" role="gridcell">{{ sum.agreedEur | eur }}</span>
                      <span class="wk-td wk-td--num wk-amount" role="gridcell">{{ sum.paidOnAgreementEur | eur }}</span>
                      @if (showDifference()) {
                        <span class="wk-td wk-td--num wk-amount" role="gridcell" data-pw-hide="narrow">@if (sum.differenceEur) { {{ abs(sum.differenceEur) | eur }}<span class="wk-td__sub">{{ sum.differenceEur < 0 ? 'minder' : 'meer' }}</span> }</span>
                      }
                      <span class="wk-td wk-td--num wk-amount" role="gridcell">{{ sum.openEur | eur }}</span>
                      <span class="wk-td wk-td--num wk-amount" role="gridcell" data-pw-hide="mid">@if (sum.dueNowEur > 0) { {{ sum.dueNowEur | eur }} }</span>
                    </div>
                    @if (additional(); as other) {
                      <div class="wk-tr wk-tr--muted pw-divider pw-payee-row" role="row" aria-level="1" [attr.aria-selected]="selectedPayee() === 'OTHER'" tabindex="0" data-payee="OTHER"
                           appMenuTrigger (menuTrigger)="menu.set({ kind: 'payee', point: $event, payee: other })" (click)="rowClick($event, 'OTHER')"
                           (keydown)="onPayeeKey($event, 'OTHER')">
                        <span class="wk-td" role="gridcell"></span>
                        <span class="wk-td" role="gridcell"><span class="pw-payee"><span class="pw-tile" [class]="other.tone"><app-icon [name]="other.icon" [size]="14" /></span>
                          <span class="pw-payee__copy"><b>{{ other.label }}</b><span class="wk-td__sub pw-basis">{{ other.basis }}</span></span></span></span>
                        <span class="wk-td wk-td--num" role="gridcell"></span>
                        <span class="wk-td wk-td--num wk-amount" role="gridcell">{{ other.paidEur | eur }}</span>
                        @if (showDifference()) { <span class="wk-td wk-td--num" role="gridcell" data-pw-hide="narrow"></span> }
                        <span class="wk-td wk-td--num" role="gridcell"></span>
                        <span class="wk-td wk-td--num" role="gridcell" data-pw-hide="mid"></span>
                        <span class="wk-td" role="gridcell" data-pw-hide="tiny"><span class="wk-pill" [class]="pill(other.status.tone)">{{ other.status.label }}</span></span>
                        <span class="wk-td wk-td--actions" role="gridcell">
                          <button class="wk-btn wk-btn--sm" type="button" data-pw-hide="narrow" [disabled]="!actionable()" (click)="$event.stopPropagation(); add.emit({ payee: 'OTHER' })">Noteer</button>
                          <button class="wk-btn wk-btn--sm wk-btn--icon pw-more" type="button" [attr.aria-label]="'Acties voor ' + other.label" (click)="$event.stopPropagation(); openMenu('payee', $event, other)"><app-icon name="more" [size]="16" /></button>
                        </span>
                      </div>
                    }
                  </div>
                </section>

                <section class="pw-section" aria-labelledby="pw-ledger-title">
                  <div class="pw-section__head">
                    <h3 class="pw-section__title" id="pw-ledger-title">{{ ledgerTitle() }}</h3>
                    <div class="wk-chips" role="group" aria-label="Betalingen filteren">
                      @for (chip of filterChips(); track chip.id) {
                        <button class="wk-chip" type="button" [attr.aria-pressed]="filter() === chip.id" (click)="setFilter(chip.id)">@if (chip.id === 'NO_PROOF') { <span class="wk-dot tone-warn" aria-hidden="true"></span> }{{ chip.label }}</button>
                      }
                    </div>
                  </div>
                  @if (!book.rows.length) {
                    <div class="wk-empty">
                      <span class="wk-empty__icon"><app-icon name="receipt" [size]="22" /></span>
                      <p class="wk-empty__title">Nog geen betalingen</p>
                      @if (sum.headline.kind === 'concept') {
                        <p class="wk-empty__text">Betalingen noteer je zodra de container besteld is.</p>
                        <div class="wk-empty__actions"><button class="wk-btn" type="button" [disabled]="!actionable()" (click)="addMain()">Betaling noteren</button></div>
                      } @else {
                        <p class="wk-empty__text">Noteer de eerste betaling zodra het geld vertrokken is. Voeg het bankafschrift toe als bewijs.</p>
                        <div class="wk-empty__actions"><button class="wk-btn wk-btn--primary" type="button" [disabled]="!actionable()" (click)="addMain()"><app-icon name="plus" [size]="16" />Betaling noteren</button></div>
                      }
                    </div>
                  } @else if (!ledgerRows().length) {
                    <div class="wk-empty"><p class="wk-empty__text">Geen betalingen voor dit filter.</p>
                      <div class="wk-empty__actions"><button class="wk-btn" type="button" (click)="setFilter('ALL')">Alle tonen</button></div></div>
                  } @else {
                    <div class="wk-table pw-ledger" role="grid" aria-labelledby="pw-ledger-title">
                      <div class="wk-thead" role="row">
                        <span class="wk-th" role="columnheader" [attr.aria-sort]="ariaSort('date')"><button class="wk-th__btn" type="button" (click)="sortBy('date')">Datum@if (sort().key === 'date') { <app-icon [name]="sortIcon('date')" [size]="12" /> }</button></span>
                        <span class="wk-th" role="columnheader" data-pw-hide="narrow">Ontvanger</span>
                        <span class="wk-th" role="columnheader">Omschrijving</span>
                        <span class="wk-th wk-th--num" role="columnheader" data-pw-hide="mid">Bedrag</span>
                        <span class="wk-th wk-th--num" role="columnheader" [attr.aria-sort]="ariaSort('amount')"><button class="wk-th__btn" type="button" (click)="sortBy('amount')">In euro@if (sort().key === 'amount') { <app-icon [name]="sortIcon('amount')" [size]="12" /> }</button></span>
                        <span class="wk-th" role="columnheader" data-pw-hide="mid">Afrekening</span>
                        <span class="wk-th wk-th--num" role="columnheader">Bewijs</span>
                        <span class="wk-th" role="columnheader"><span class="sr-only">Acties</span></span>
                      </div>
                      @for (row of ledgerRows(); track row.id) {
                        <div class="wk-tr" role="row" [id]="'pw-row-' + row.id" [attr.tabindex]="tabStop() === row.id ? 0 : -1" [attr.aria-selected]="selectedRow() === row.id"
                             appMenuTrigger (menuTrigger)="menu.set({ kind: 'payment', point: $event, row })"
                             (click)="selectedRow.set(row.id)" (focus)="selectedRow.set(row.id)" (dblclick)="edit.emit(row.payment)" (keydown)="onRowKey($event, row)">
                          <span class="wk-td wk-amount" role="gridcell">{{ row.paidOn | dateNl }}</span>
                          <span class="wk-td" role="gridcell" data-pw-hide="narrow"><span class="wk-pill" [class]="tone(row.payee)">{{ row.payeeShort }}</span></span>
                          <span class="wk-td" role="gridcell">
                            <span class="pw-desc">{{ row.label || '—' }}@if (row.settlesLabel) { <span class="wk-pill pw-settles pw-when-mid">{{ row.settlesLabel }}</span> }</span>
                            <span class="wk-td__sub pw-when-narrow"><span class="wk-pill" [class]="tone(row.payee)">{{ row.payeeShort }}</span></span>
                            @if (row.termLabel || row.actor) { <span class="wk-td__sub">{{ row.termLabel }}@if (row.termLabel && row.actor) { · }{{ row.actor ? actor(row.actor) : '' }}</span> }
                          </span>
                          <span class="wk-td wk-td--num wk-amount" role="gridcell" data-pw-hide="mid">@if (row.foreign) { {{ row.amount | cur: row.currency }} }</span>
                          <span class="wk-td wk-td--num wk-amount wk-amount--strong" role="gridcell">@if (finite(row.amountEur)) { {{ row.amountEur | eur }} } @else { — }
                            @if (row.foreign) { <span class="wk-td__sub pw-when-mid">{{ row.amount | cur: row.currency }}</span> }</span>
                          <span class="wk-td wk-td--wrap" role="gridcell" data-pw-hide="mid">{{ row.settlesLabel || '' }}</span>
                          <span class="wk-td pw-proof" role="gridcell">
                            @if (row.hasProof === true) {
                              <button class="wk-btn wk-btn--sm wk-btn--ghost pw-proof__btn" type="button" [title]="proofNames(row)" [attr.aria-label]="row.proofCount === 1 ? 'Bewijs openen: ' + row.proofs![0].originalFilename : row.proofCount + ' bewijzen'" (click)="$event.stopPropagation(); openProof(row, $event)"><app-icon name="clip" [size]="14" /><span class="pw-proof__name">{{ row.proofCount === 1 ? row.proofs![0].originalFilename : row.proofCount + ' bewijzen' }}</span></button>
                            } @else if (row.hasProof === false) {
                              <button class="wk-btn wk-btn--sm wk-btn--ghost pw-proof__btn pw-proof__btn--missing" type="button" [disabled]="busy()" (click)="$event.stopPropagation(); proof.emit(row.payment)"><app-icon name="clip" [size]="14" />Bewijs toevoegen</button>
                            }
                          </span>
                          <span class="wk-td wk-td--actions" role="gridcell">
                            <button class="wk-btn wk-btn--sm" type="button" data-pw-hide="narrow" [disabled]="!actionable()" (click)="$event.stopPropagation(); edit.emit(row.payment)">Aanpassen</button>
                            <button class="wk-btn wk-btn--sm wk-btn--icon pw-more" type="button" [attr.aria-label]="'Acties voor ' + row.title" (click)="$event.stopPropagation(); openMenu('payment', $event, row)"><app-icon name="more" [size]="16" /></button>
                          </span>
                        </div>
                      }
                    </div>
                  }
                </section>
              </div>

              <aside class="pw-side" aria-label="Te doen, opbouw en nacalculatie">
                <div>
                  <section class="wk-card">
                    <header class="wk-card__head"><h3 class="wk-card__title">Te doen</h3></header>
                    <div class="wk-card__body">
                      @if (book.todos.length) {
                        <div class="desk-actions">
                          @for (todo of book.todos; track todo.key) {
                            <button class="desk-action" type="button" [disabled]="busy() && todo.kind !== 'proof' && todo.kind !== 'incomplete'" (click)="runTodo(todo)">
                              <span><b>{{ todoTitle(todo) }}</b><small>{{ todoDetail(todo) }}</small></span><em class="pw-todo__go">{{ todoAction(todo) }} ›</em>
                            </button>
                          }
                        </div>
                      } @else {
                        <p class="pw-muted">Niets te doen · alles is bij</p>
                      }
                      @if (partnerLinked()) {
                        <p class="pw-muted pw-card__foot"><button class="wk-link" type="button" (click)="openPartner.emit()">Verkoopdocumenten van deze container ›</button></p>
                      }
                    </div>
                  </section>
                </div>
                <div>
                  <section class="wk-card">
                    <header class="wk-card__head"><h3 class="wk-card__title">Zo is het totaal opgebouwd</h3><button class="wk-link wk-card__trail" type="button" (click)="openCosts.emit('plan')">Kosten ›</button></header>
                    <div class="wk-card__body">
                      <dl class="wk-equation">
                        @for (row of book.bridge.rows; track row.key) {
                          @if (row.subtotal) {
                            <div class="is-sub pw-bridge__subtotal"><dt><span class="wk-equation__op" aria-hidden="true">=</span>{{ row.label }}@if (row.note) { <span class="wk-td__sub">{{ row.note }}</span> }</dt><dd>{{ row.amountEur | eur }}</dd></div>
                          } @else {
                            <div><dt>{{ row.label }}@if (row.note) { <span class="wk-td__sub">{{ row.note }}</span> }</dt><dd>{{ row.amountEur | eur }}</dd></div>
                          }
                        }
                        @if (book.bridge.consistent) {
                          <div class="is-total"><dt><span class="wk-equation__op" aria-hidden="true">=</span>{{ book.bridge.totalLabel }}</dt><dd>{{ book.bridge.totalEur | eur }}</dd></div>
                        } @else {
                          <div class="is-total"><dt>{{ book.bridge.totalLabel }}</dt><dd>{{ book.bridge.totalEur | eur }}</dd></div>
                        }
                      </dl>
                      @if (!book.bridge.consistent) { <p class="pw-muted wk-amount--warn">De onderdelen sluiten niet exact aan op het totaal; controleer de kosten.</p> }
                    </div>
                  </section>
                </div>
                @if (nacalc()) {
                  <div><app-purchase-nacalc-summary [summary]="nacalc()" [dirty]="dirty()" (open)="openCosts.emit('actual')" /></div>
                }
              </aside>
            </div>
            <footer class="wk-statusbar pw-status">
              <span>{{ sum.paymentCount }} {{ sum.paymentCount === 1 ? 'betaling' : 'betalingen' }}@if (sum.missingProofCount) { · {{ sum.missingProofCount }} zonder bewijs } · in euro zoals geboekt</span>
              <span class="wk-statusbar__end pw-keys"><kbd class="wk-kbd">N</kbd> nieuw · <kbd class="wk-kbd">A</kbd> afrekenen · <kbd class="wk-kbd">↩</kbd> aanpassen · <kbd class="wk-kbd">⌥1</kbd> <kbd class="wk-kbd">⌥2</kbd> weergave</span>
            </footer>
          }
        }
      }
    </div>
    @if (menu(); as open) {
      <app-context-menu [title]="menuTitle(open)" [anchor]="open.point" [items]="menuItems(open)" (pick)="pick(open, $event)" (closed)="menu.set(null)" />
    }
  `,
  styles: `:host { display: block; min-width: 0; }`,
})
export class PurchasePaymentWorkbench {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly router = inject(Router);

  readonly ledger = input<PaymentLedger | null>(null);
  readonly state = input<'loading' | 'refreshing' | 'error' | 'ready'>('ready');
  readonly error = input<string | null>(null);
  readonly busy = input(false);
  readonly dirty = input(false);
  readonly saving = input(false);
  readonly pdfBusy = input(false);
  readonly orderId = input.required<number>();
  readonly planLabel = input('');
  /** A partner co-finances the container: the Te doen card links to its documents. */
  readonly partnerLinked = input(false);
  /** The Nacalculatie in one glance; null hides the card. */
  readonly nacalc = input<PurchaseNacalcSummary | null>(null);
  readonly add = output<PurchasePaymentAction>();
  readonly edit = output<PurchasePayment>();
  readonly proof = output<PurchasePayment>();
  readonly download = output<PurchaseDocument>();
  readonly settle = output<PurchaseSettleRequest>();
  readonly undoSettle = output<{ payee: Payee; due?: Due | null }>();
  readonly planChange = output<void>();
  readonly move = output<{ payment: PurchasePayment; payee: Payee }>();
  readonly remove = output<PurchasePayment>();
  readonly refresh = output<void>();
  readonly save = output<void>();
  readonly exportPdf = output<void>();
  /** 'actual' opens the Nacalculatie, 'plan' the calculation in Kosten. */
  readonly openCosts = output<'actual' | 'plan'>();
  readonly openPartner = output<void>();

  readonly selectedPayee = signal<Payee | null>(null);
  readonly filter = signal<LedgerFilter>('ALL');
  readonly expanded = signal<ReadonlySet<Payee>>(new Set());
  readonly selectedRow = signal<number | null>(null);
  readonly sort = signal<{ key: 'date' | 'amount'; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  readonly menu = signal<MenuState | null>(null);
  private seeded = false;

  readonly abs = Math.abs;
  readonly actionable = computed(() => !this.busy() && this.state() === 'ready' && !!this.ledger());
  readonly agreements = computed(() => (this.ledger()?.visible ?? []).filter(item => item.payee !== 'OTHER'));
  readonly additional = computed(() => this.ledger()?.visible.find(item => item.payee === 'OTHER') ?? null);
  readonly reviewHigher = computed(() => this.ledger()?.payees.some(item => item.higherEur > 0 && !item.finalized) ?? false);
  /** The selected payee, or the only one that can be settled. */
  readonly settleTarget = computed(() => {
    const payees = this.ledger()?.payees ?? [];
    const selected = this.selectedPayee();
    if (selected) return payees.find(item => item.payee === selected && item.canSettle) ?? null;
    const settleable = payees.filter(item => item.canSettle);
    return settleable.length === 1 ? settleable[0] : null;
  });
  /** Why 'Afrekenen…' is disabled: nothing chosen, or nothing to settle for the chosen payee. */
  readonly settleHint = computed(() => {
    if (this.settleTarget()) return '';
    const selected = this.selectedPayee();
    if (selected) return `Niets af te rekenen bij ${PAYEE_LABEL[selected]}`;
    return this.ledger()?.payees.some(item => item.canSettle) ? 'Kies eerst een ontvanger' : 'Niets af te rekenen';
  });
  /** The Verschil column only earns its room once some payee or term was settled for another amount. */
  readonly showDifference = computed(() => {
    const book = this.ledger();
    return !!book && (book.summary.differenceEur !== 0
      || book.payees.some(item => item.differenceEur !== 0 || item.terms.some(term => term.higherEur !== term.lowerEur)));
  });
  /** The hint beside the disabled 'Afrekenen…' button, only while there is something to settle. */
  readonly settleHintVisible = computed(() => !this.settleTarget() && !!this.ledger()?.payees.some(item => item.canSettle));
  readonly ledgerTitle = computed(() => {
    const filter = this.filter();
    return filter === 'ALL' ? 'Alle betalingen' : filter === 'NO_PROOF' ? 'Betalingen zonder bewijs' : 'Betalingen aan ' + PAYEE_LABEL[filter];
  });
  readonly filterChips = computed(() => {
    const book = this.ledger();
    if (!book?.rows.length) return [];
    const chips: { id: LedgerFilter; label: string }[] = [{ id: 'ALL', label: 'Alle' }];
    for (const item of book.payees) if (item.paymentCount) chips.push({ id: item.payee, label: PAYEE_SHORT[item.payee] });
    if (book.summary.missingProofCount) chips.push({ id: 'NO_PROOF', label: `Zonder bewijs (${book.summary.missingProofCount})` });
    return chips;
  });
  readonly ledgerRows = computed(() => {
    const filter = this.filter();
    const rows = (this.ledger()?.rows ?? []).filter(row => filter === 'ALL' || (filter === 'NO_PROOF' ? row.hasProof === false : row.payee === filter));
    const sort = this.sort();
    return sort.key === 'date' && sort.dir === 'desc' ? rows : sortLedgerRows(rows, sort.key, sort.dir);
  });
  /** Roving tabindex: the selected row, else the first one. */
  readonly tabStop = computed(() => {
    const rows = this.ledgerRows();
    const selected = this.selectedRow();
    return rows.some(row => row.id === selected) ? selected : rows[0]?.id ?? null;
  });

  constructor() {
    // The supplier's terms are what a buyer looks at first: open them once when there are several.
    effect(() => {
      const supplier = this.ledger()?.payees.find(item => item.payee === 'SUPPLIER');
      if (this.seeded || !supplier || supplier.terms.length < 2) return;
      this.seeded = true;
      untracked(() => this.expanded.update(open => new Set([...open, 'SUPPLIER'])));
    });
  }

  label(payee: Payee): string { return PAYEE_LABEL[payee]; }
  tone(payee: Payee): string { return PAYEE_TONE[payee]; }
  pill(tone: 'warn' | 'ok' | 'neutral'): string { return tone === 'warn' ? 'tone-warn' : tone === 'ok' ? 'tone-ok' : ''; }
  pct(value: number): number { return Math.round(value); }
  finite(value: number): boolean { return Number.isFinite(value); }
  actor(value: string): string { return value.replace(/^.*[\\/]/, '').split('@')[0]; }
  expandable(item: PayeeLedger): boolean { return item.payee === 'SUPPLIER' || item.composition.length > 0; }
  isExpanded(payee: Payee): boolean { return this.expanded().has(payee); }
  /** The supplier's plan is spelled out by its term rows once they are open; the basis then keeps only the goods. */
  basis(item: PayeeLedger): string {
    return item.payee === 'SUPPLIER' && item.terms.length && this.isExpanded('SUPPLIER') ? SUPPLIER_GOODS : item.basis;
  }
  proofNames(row: LedgerRow): string { return (row.proofs ?? []).map(proof => proof.originalFilename).join(', '); }

  /** The one text button of a payee row: the ledger's shared rule, the same as the Nacalculatie's. */
  rowAction(item: PayeeLedger): 'add' | 'settle' | null {
    return payeeRowAction(item);
  }

  /** What comes next under the status pill, unless the pill already says it. */
  nextSub(item: PayeeLedger): string | null {
    const next = item.next;
    if (!next || item.status.kind === 'LATER') return null;
    if (next.now && !next.due && next.amountEur === item.openEur) return null;
    const label = next.due ? next.label : '';
    const when = !next.now && !next.label.toLowerCase().includes(next.when) ? next.when : '';
    return [label, formatEur(next.amountEur), when].filter(Boolean).join(' · ');
  }

  /** '+ € 120,00' or '− € 50,00'; zero stays a plain amount. */
  signed(value: number): string {
    if (!value) return formatEur(0);
    return (value > 0 ? '+ ' : '− ') + formatEur(Math.abs(value));
  }

  /** From the Nacalculatie: select the payee, show its payments and put the keyboard on its row. */
  focusPayee(payee: Payee): void {
    this.selectedPayee.set(payee);
    this.filter.set(payee);
    const item = this.ledger()?.payees.find(candidate => candidate.payee === payee);
    if (item && this.expandable(item)) this.expanded.update(open => new Set([...open, payee]));
    requestAnimationFrame(() => this.host.nativeElement.querySelector<HTMLElement>('.pw-payee-row[data-payee="' + payee + '"]')?.focus());
  }

  scrollToLedger(): void {
    this.host.nativeElement.querySelector('#pw-ledger-title')?.scrollIntoView({ block: 'start' });
  }

  toggle(payee: Payee): void {
    const item = this.ledger()?.payees.find(candidate => candidate.payee === payee);
    if (!item || !this.expandable(item)) return;
    this.expanded.update(open => {
      const next = new Set(open);
      if (next.has(payee)) next.delete(payee); else next.add(payee);
      return next;
    });
  }

  /**
   * A row click selects; the click that trails a long-press menu (the menu
   * trigger marks it handled) and the second click of a double-click, which
   * expands the row, leave the selection alone.
   */
  rowClick(event: MouseEvent, payee: Payee): void {
    if (event.defaultPrevented || event.detail > 1) return;
    this.selectPayee(payee);
  }

  /** A click selects the payee and shows only its payments; a second click shows everything again. */
  selectPayee(payee: Payee): void {
    const again = this.selectedPayee() === payee;
    this.selectedPayee.set(again ? null : payee);
    this.filter.set(again ? 'ALL' : payee);
  }

  setFilter(filter: LedgerFilter): void {
    this.filter.set(filter);
    this.selectedPayee.set(filter === 'ALL' || filter === 'NO_PROOF' ? null : filter);
  }

  sortBy(key: 'date' | 'amount'): void {
    this.sort.update(sort => sort.key === key ? { key, dir: sort.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' });
  }

  ariaSort(key: 'date' | 'amount'): string | null {
    const sort = this.sort();
    return sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : null;
  }

  sortIcon(key: 'date' | 'amount'): string {
    const sort = this.sort();
    return sort.key === key && sort.dir === 'asc' ? 'chevron-up' : 'chevron-down';
  }

  /** '+ Betaling': the selected payee, else whoever is next, else the supplier. */
  addMain(): void {
    if (!this.actionable()) return;
    const book = this.ledger()!;
    const payee = this.selectedPayee() ?? book.summary.next?.payee ?? 'SUPPLIER';
    const item = book.payees.find(candidate => candidate.payee === payee);
    if (item) this.addFor(item); else this.add.emit({ payee });
  }

  addFor(item: PayeeLedger): void {
    const next = item.next;
    this.add.emit(next?.now ? { payee: item.payee, amount: next.amountEur, label: next.label, due: next.due } : { payee: item.payee });
  }

  settleMain(): void {
    const target = this.settleTarget();
    if (target && this.actionable()) this.settle.emit(target.settleDefault);
  }

  openMenu(kind: 'payees' | 'more' | 'payee' | 'payment', event: MouseEvent, subject?: PayeeLedger | LedgerRow): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const point = { x: rect.left, y: rect.bottom + 4 };
    if (kind === 'payee') this.menu.set({ kind, point, payee: subject as PayeeLedger });
    else if (kind === 'payment') this.menu.set({ kind, point, row: subject as LedgerRow });
    else if (kind === 'payees') this.menu.set({ kind, point });
    else this.menu.set({ kind, point });
  }

  openTermMenu(term: LedgerTerm, event: MouseEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.menu.set({ kind: 'term', point: { x: rect.left, y: rect.bottom + 4 }, term });
  }

  /** One proof opens at once; several get a menu listing each file. */
  openProof(row: LedgerRow, event: MouseEvent): void {
    const proofs = row.proofs ?? [];
    if (proofs.length === 1) { this.download.emit(proofs[0]); return; }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.menu.set({ kind: 'proofs', point: { x: rect.left, y: rect.bottom + 4 }, row });
  }

  menuTitle(open: MenuState): string {
    switch (open.kind) {
      case 'payees': return 'Betaling aan…';
      case 'more': return 'Betalingen';
      case 'payee': return open.payee.label;
      case 'payment': return open.row.title;
      case 'proofs': return 'Bewijzen';
      case 'term': return open.term.label;
    }
  }

  menuItems(open: MenuState): ContextMenuItem[] {
    const busy = !this.actionable();
    switch (open.kind) {
      case 'payees': return payeeMenuItems(this.ledger());
      case 'more': return [
        { id: 'pdf', label: 'Betalingen & kostprijs (PDF)', iconName: 'document', disabled: this.dirty() || this.pdfBusy(),
          hint: this.dirty() ? 'Sla de order eerst op' : undefined },
        { id: 'costs', label: 'Nacalculatie openen', iconName: 'layers' },
        { id: 'finance', label: 'Toon in Kosten & bank', iconName: 'bank' },
        { id: 'refresh', label: 'Vernieuwen', iconName: 'refresh', divider: true },
      ];
      case 'payee': return payeeRowMenuItems(open.payee, busy);
      case 'payment': return paymentMenuItems(open.row, { move: true, busy });
      case 'proofs': return (open.row.proofs ?? []).map(proof => ({ id: 'open:' + proof.id, label: proof.originalFilename, iconName: 'document' }));
      case 'term': return [
        ...(open.term.openEur > 0 && !open.term.settled ? [{ id: 'add', label: 'Betaling noteren voor deze termijn', iconName: 'plus', disabled: busy }] : []),
        ...(open.term.canSettle ? [{ id: 'settle', label: 'Termijn afrekenen', iconName: 'tick', disabled: busy }] : []),
        ...(open.term.canUndo ? [{ id: 'undo', label: 'Afrekening ongedaan maken', iconName: 'restore', disabled: busy }] : []),
      ];
    }
  }

  pick(open: MenuState, item: ContextMenuItem): void {
    this.menu.set(null);
    if (open.kind === 'payees') { this.add.emit({ payee: item.id as Payee }); return; }
    if (open.kind === 'more') {
      if (item.id === 'pdf') this.exportPdf.emit();
      else if (item.id === 'costs') this.openCosts.emit('actual');
      else if (item.id === 'finance') void this.router.navigate(['/costs'], { queryParams: { container: this.orderId() } });
      else this.refresh.emit();
      return;
    }
    if (open.kind === 'term') {
      const term = open.term;
      if (item.id === 'add') this.add.emit({ payee: 'SUPPLIER', amount: term.openEur, label: term.label, due: term.due });
      else if (item.id === 'undo') this.undoSettle.emit({ payee: 'SUPPLIER', due: term.due });
      else this.settle.emit({ payee: 'SUPPLIER', scope: 'TERM', due: term.due });
      return;
    }
    if (open.kind === 'payee') {
      const payee = open.payee;
      if (item.id === 'add') this.addFor(payee);
      else if (item.id === 'settle') this.settle.emit(payee.settleDefault);
      else if (item.id === 'undo') this.undoSettle.emit({ payee: payee.payee });
      else if (item.id === 'plan') this.planChange.emit();
      else this.setFilter(payee.payee);
      return;
    }
    const row = open.row;
    if (item.id.startsWith('open:')) {
      const document = row.proofs?.find(proof => 'open:' + proof.id === item.id);
      if (document) this.download.emit(document);
      return;
    }
    if (item.id.startsWith('move:')) { this.move.emit({ payment: row.payment, payee: item.id.slice(5) as Payee }); return; }
    switch (item.id) {
      case 'edit': this.edit.emit(row.payment); break;
      case 'proof': this.proof.emit(row.payment); break;
      case 'settle': this.settle.emit(settleWith(row)); break;
      case 'remove': this.remove.emit(row.payment); break;
    }
  }

  todoTitle(todo: LedgerTodo): string { return todoCopy(todo).title; }
  todoDetail(todo: LedgerTodo): string { return todoCopy(todo).detail; }
  todoAction(todo: LedgerTodo): string { return todoCopy(todo).action; }

  runTodo(todo: LedgerTodo): void {
    switch (todo.kind) {
      case 'pay': this.add.emit({ payee: todo.payee, amount: todo.amountEur, label: todo.label, due: todo.due }); break;
      case 'settle': case 'review': case 'budget': this.settle.emit(todo.request); break;
      case 'incomplete': this.setFilter(todo.payee); break;
      case 'proof': this.setFilter('NO_PROOF'); break;
    }
  }

  /** N adds, A settles; never while typing or behind a sheet or menu. */
  onKey(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
    const context = keyContext(event, this.host.nativeElement);
    if (context.typing || context.overlayOpen) return;
    const key = event.key.toLowerCase();
    if (key === 'n') { event.preventDefault(); this.addMain(); }
    else if (key === 'a') { event.preventDefault(); this.settleMain(); }
  }

  /**
   * The payee rows as a tree: Space selects (and filters), Enter or the
   * arrows open and close the terms or build-up, up and down move between
   * payees. A button inside the row keeps its own keys.
   */
  onPayeeKey(event: KeyboardEvent, payee: Payee): void {
    if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey) return;
    const item = this.ledger()?.payees.find(candidate => candidate.payee === payee);
    const expandable = !!item && this.expandable(item);
    switch (event.key) {
      case ' ': event.preventDefault(); this.selectPayee(payee); return;
      case 'Enter': event.preventDefault(); if (expandable) this.toggle(payee); else this.selectPayee(payee); return;
      case 'ArrowRight': case 'ArrowLeft':
        event.preventDefault();
        if (expandable && this.isExpanded(payee) !== (event.key === 'ArrowRight')) this.toggle(payee);
        return;
      case 'ArrowDown': case 'ArrowUp': {
        event.preventDefault();
        const rows = [...this.host.nativeElement.querySelectorAll<HTMLElement>('.pw-payee-row')];
        const index = rows.indexOf(event.currentTarget as HTMLElement);
        rows[index + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
        return;
      }
    }
  }

  /** The ledger grid: arrows move, Enter edits, Delete removes, Escape lets go. */
  onRowKey(event: KeyboardEvent, row: LedgerRow): void {
    if (event.metaKey || event.ctrlKey || event.altKey || event.target !== event.currentTarget) return;
    const rows = this.ledgerRows();
    const index = rows.findIndex(item => item.id === row.id);
    switch (event.key) {
      case 'ArrowDown': case 'ArrowUp': {
        event.preventDefault();
        const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
        if (!next) return;
        this.selectedRow.set(next.id);
        this.host.nativeElement.querySelector<HTMLElement>('#pw-row-' + next.id)?.focus();
        return;
      }
      case 'Enter': event.preventDefault(); if (this.actionable()) this.edit.emit(row.payment); return;
      case 'Delete': case 'Backspace': event.preventDefault(); if (this.actionable()) this.remove.emit(row.payment); return;
      case 'Escape': event.preventDefault(); this.selectedRow.set(null); return;
    }
  }
}
