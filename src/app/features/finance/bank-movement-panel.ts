import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { BankingApi, BankMatch, BankStatementLine, ReceivedOdooInvoice, ReceivedOdooInvoicePreview } from '../../core/api/banking-api';
import type { Currency, Payee, PurchaseDocument, PurchasePaymentRow, SalesOrderView, SalesPayment } from '../../core/api/models';
import { messageOf } from '../../core/api/errors';
import { SourcingApi } from '../../core/api/sourcing-api';
import { saveBlob } from '../../core/api/download';
import { bankAmountsMatch, bankAmountDifference } from '../../shared/bank-transaction-options';
import { Icon } from '../../shared/icon';
import { MenuTrigger } from '../../shared/menu-trigger';
import { SwipeActions } from '../../shared/swipe-actions';
import { EurPipe } from '../../shared/pipes';
import { Ui, escapeHtml } from '../../shared/ui';
import { FinanceState } from './finance-state';
import { bankAccountKey } from './bank-reconciliation';
import { paymentLocalDay, paymentMomentLabel } from './incoming-money';
import { cashTotalOf, openOf } from './finance-metrics';
import { containerPayables } from './payables';
import { bankAllocationTargets, filterBankAllocationTargets, type BankAllocationTarget } from './bank-allocation-targets';
import { bankSearchMatches, legDistance, lineStatus, selectionTotals, vatPeriodLabel } from './bank-suggestions';
import type { LineSuggestion } from './bank-suggestions';
import { CLASSIFICATION_LABEL } from './cash-forecast';
import { eur as signedEur } from './cash-format';
import { bankTransactionDay } from '../../shared/bank-transaction-options';
import { amountInputText, parsePurchasePaymentAmount } from '../purchasing/purchase-payment-amount';
import { inspectionRestOffered, invoiceLine, invoiceTermsLine, paymentRoundOnServer } from '../purchasing/purchase-invoices';
import { splitTransfer } from '../purchasing/purchase-transfer-split';
import {
  adjustConsequence, carveForeignText, carveText, foreignLinkWarning, linkChange, linkNotice, pendingLinkPlan, surplusQuestion, transferCompanions,
  type ForeignLink, type LinkChangeRow, type SurplusChoice,
} from '../purchasing/purchase-payment-links';

type DirectionFilter = 'ALL' | 'INCOMING' | 'OUTGOING';
/** UNLINKED_IN is the retained URL-compatible name for all transactions still to link. */
type LinkFilter = 'ALL' | 'LINKED' | 'UNLINKED' | 'UNLINKED_IN';
interface LinkedDocument { kind: 'cost' | 'container' | 'invoice'; id: number; label: string; }
interface OutgoingMatch { ownerId: number; key: string; kind: 'cost' | 'purchase'; id: number; title: string; detail: string; paidOn: string; amountEur: number;
  /** A purchase payment that is one transfer of a payment paid in parts. */
  grouped?: boolean; }
/** What a transfer to one container paid for, in the words of a bank line's link: 'Goederen + inspectie (PO-2026-021)'. */
const PAYEE_PART: Readonly<Record<Payee, string>> = { SUPPLIER: 'goederen', SEPARATE: 'inspectie', LOGISTICS: 'douane & transport', OTHER: 'andere kosten' };
const PAYEE_SEQUENCE: readonly Payee[] = ['SUPPLIER', 'SEPARATE', 'LOGISTICS', 'OTHER'];
const cents = (amount: number): number => Math.round(amount * 100);
const inactive = new Set(['CONCEPT', 'GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN']);
const euro = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
const WEEKDAY = new Intl.DateTimeFormat('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
/** One dot colour per active account, in the order of the account list. */
const ACCOUNT_TONES = ['tone-blue', 'tone-teal', 'tone-amber', 'tone-plum', 'tone-green', 'tone-grey'];
/** What the Koppeling cell says of a line. */
interface Koppeling { text: string; sub: string | null; reasons: string[]; open: boolean; }

/**
 * Bank › Bewegingen: the recorded statement lines, their link to an invoice,
 * and the allocation state machine (suggestions, local existing-receipt
 * matches, the duplicate guard, the stale-response guard, the busy lock).
 * The form to record a line lives in FinanceState (bank-movement-sheet.ts);
 * the allocation dialog is rendered at page level (bank-allocation-sheet.ts).
 * A node harness compiles this class with its imports stripped: new globals
 * need a harness entry.
 */
@Component({
  selector: 'app-bank-movement-panel', changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EurPipe, Icon, MenuTrigger, SwipeActions],
  styleUrl: './bank-movement-panel.scss',
  template: `
    @if (historicalCount() && !compact()) {
      <details class="bank-history"><summary>Eerdere registraties · {{ historicalCount() }}</summary>
        <p class="fin-hint">Deze handmatige registraties blijven bewaard. Ze tellen niet mee in het saldo van je Odoo-rekening.</p>
        <button class="fin-inline-btn" type="button" (click)="showHistorical.set(!showHistorical())">{{ showHistorical() ? 'Historische registraties verbergen' : 'Historische registraties tonen' }}</button>
      </details>
    }
    @if (error() && !selected()) { <p class="fin-error" role="alert">{{ error() }}</p> }
    @if (!compact()) {
      @if (unbankedCount(); as count) {
        <button class="bank-unbanked" type="button" (click)="state.unbankedOpen.set(true)"><app-icon name="alert" [size]="16" /><span>Betalingen zonder transactie ({{ count }})</span><app-icon name="chevron-right" [size]="16" /></button>
      }
      @if (state.searchedFrom(); as from) {
        <div class="bank-searched"><span class="wk-chip is-on">Gezocht vanuit: {{ from }}<button class="wk-chip__x" type="button" aria-label="Zoekopdracht wissen" (click)="clearSearched()"><app-icon name="close" [size]="11" /></button></span></div>
      }
    }
    @if (state.desk()) {
      @if (filteredLines().length) {
        <div class="wk-table fin-table fin-table--tx" [class.fin-table--tx-compact]="compact()" role="grid" aria-label="Banktransacties">
          <div class="wk-thead" role="row">
            <span class="wk-th" role="columnheader"><span class="fin-sr">Rekening</span></span>
            <span class="wk-th" role="columnheader">Tegenpartij · mededeling</span>
            <span class="wk-th" role="columnheader">Status</span>
            @if (!compact()) { <span class="wk-th" role="columnheader" data-hide="inspecting">Koppeling</span> }
            <span class="wk-th" role="columnheader" data-hide="inspecting"><span class="fin-sr">Actie</span></span>
            <span class="wk-th wk-th--num" role="columnheader">Bedrag</span>
            @if (!compact()) { <span class="wk-th wk-th--num" role="columnheader">Saldo</span> }
            <span class="wk-th" role="columnheader"><span class="fin-sr">Acties</span></span>
          </div>
          @for (group of dayGroups(); track group.day) {
            <div class="wk-group fin-tx-day" role="row"><span class="fin-tx-day__label" role="rowheader">{{ group.label }} <span class="wk-group__count">{{ group.rows.length }}</span></span>
              @if (!compact()) { <span class="fin-tx-day__saldo" role="gridcell">{{ dayEndText(group.day) }}</span> }</div>
            @for (row of group.rows; track row.id) {
              <div class="wk-tr wk-tr--link fin-tx" role="row" [attr.tabindex]="tabStopId() === row.id ? 0 : -1" [attr.data-key]="'line:' + row.id"
                   [attr.aria-selected]="focusId() === row.id || state.location().line === row.id" (focusin)="focusId.set(row.id)" (click)="$event.defaultPrevented || openLine(row)"
                   appMenuTrigger (menuTrigger)="lineMenu(row, $event)">
                <span class="wk-td" role="gridcell"><i [class]="'wk-dot ' + accountTone(row.account)" [attr.title]="accountName(row.account)"></i></span>
                <span class="wk-td" role="gridcell"><b class="fin-tx__party">{{ row.counterparty || row.reference || 'Banktransactie' }}</b>@if (!state.officialBankLine(row)) { <span class="wk-pill tone-grey">Historische registratie</span> }
                  <span class="wk-td__sub">{{ subOf(row) }}</span></span>
                <span class="wk-td fin-tx__status" role="gridcell"><span [class]="'wk-pill ' + statusTone(row)">{{ statusLabel(row) }}</span></span>
                @if (!compact()) {
                  <span class="wk-td fin-tx__link" role="gridcell" data-hide="inspecting">
                    @if (koppeling(row); as k) {
                      @if (k.open) {
                        <button class="wk-link bank-document-link" type="button" [disabled]="openingId() === row.id" (click)="$event.stopPropagation(); openLinked(row)" [attr.title]="k.text">{{ openingId() === row.id ? 'Laden…' : k.text }} ›</button>
                      } @else { <span class="fin-tx__target" [attr.title]="k.text">{{ k.text }}</span> }
                      @if (k.sub) { <span class="wk-td__sub" [attr.title]="k.sub">{{ k.sub }}</span> }
                      @if (k.reasons.length) { <span class="fin-tx__reasons">@for (reason of k.reasons; track reason) { <span class="wk-pill wk-pill--outline">{{ reason }}</span> }</span> }
                    }
                  </span>
                }
                <span class="wk-td" role="gridcell" data-hide="inspecting">
                  @if (actionOf(row); as action) {
                    <button class="wk-btn wk-btn--sm" [class.wk-btn--primary]="action.kind === 'link'" type="button" [disabled]="busy() || state.linking() !== null" (click)="$event.stopPropagation(); runAction(row)">{{ action.label }}</button>
                  }
                </span>
                <span class="wk-td wk-td--num" role="gridcell"><b [class.wk-amount--in]="row.amountEur > 0">{{ row.amountEur > 0 ? '+' : '−' }} {{ abs(row.amountEur) | eur }}</b>
                  @if (row.allocationDifferenceEur) { <span class="wk-td__sub">Verschil {{ row.allocationDifferenceEur | eur }}</span> }</span>
                @if (!compact()) { <span class="wk-td wk-td--num fin-tx__saldo" role="gridcell" [attr.title]="saldoText(row)">{{ saldoText(row) }}</span> }
                <span class="wk-td fin-td-end" role="gridcell">
                  <button class="wk-btn wk-btn--ghost wk-btn--icon wk-btn--sm" type="button" [attr.aria-label]="'Meer acties voor ' + (row.counterparty || row.reference || 'banktransactie')" (click)="$event.stopPropagation(); lineMenu(row, point($event))"><app-icon name="more" [size]="16" /></button>
                </span>
              </div>
            }
          }
        </div>
        @if (compact()) {
          <div class="fin-tx-foot"><button class="wk-link" type="button" (click)="state.go({ view: 'bank', tab: 'movements' }, 'push')">Alle transacties ›</button></div>
        } @else if (visibleLines().length < filteredLines().length) {
          <div class="fin-more"><button class="wk-btn" type="button" (click)="shown.update(more)">Meer tonen · nog {{ filteredLines().length - visibleLines().length }}</button></div>
        }
      } @else {
        <div class="wk-empty"><span class="wk-empty__icon"><app-icon name="bank" [size]="22" /></span>
          <p class="wk-empty__title">{{ emptyTitle() }}</p>
          <p class="wk-empty__text">{{ emptyText() }}</p>
          @if (widerSearch()) { <div class="wk-empty__actions"><button class="wk-btn" type="button" (click)="searchWider()">Ruimer zoeken</button></div> }</div>
      }
    } @else {
      <div class="ios-search fin-ios-search"><label class="ios-search__field"><app-icon name="search" [size]="16" />
        <input type="search" placeholder="Bedrag, naam of mededeling" aria-label="Zoeken in transacties" [value]="search()" (input)="search.set($any($event.target).value); shown.set(12)" />
        <button class="ios-search__clear" type="button" aria-label="Zoekterm wissen" (click)="search.set('')"><app-icon name="close" [size]="14" /></button></label></div>
      <div class="ios-chips" role="group" aria-label="Richting">
        <button class="ios-chip" type="button" [attr.aria-pressed]="directionFilter() === 'ALL' && linkFilter() !== 'UNLINKED_IN'" (click)="setChip('ALL')">Alles</button>
        <button class="ios-chip" type="button" [attr.aria-pressed]="directionFilter() === 'INCOMING'" (click)="setChip('INCOMING')">In</button>
        <button class="ios-chip" type="button" [attr.aria-pressed]="directionFilter() === 'OUTGOING'" (click)="setChip('OUTGOING')">Uit</button>
        <button class="ios-chip" type="button" [attr.aria-pressed]="linkFilter() === 'UNLINKED_IN'" (click)="setChip('UNLINKED_IN')">Te koppelen
          @if (unlinkedCount()) { <span class="ios-chip__badge">{{ unlinkedCount() }}</span> }</button>
      </div>
      @if (accountChips().length > 1) {
        <div class="ios-chips" role="group" aria-label="Rekening">
          <button class="ios-chip" type="button" [attr.aria-pressed]="!accountFilter()" (click)="accountFilter.set(''); shown.set(12)">Alle rekeningen</button>
          @for (chip of accountChips(); track chip.key) {
            <button class="ios-chip" type="button" [attr.aria-pressed]="accountFilter() === chip.key" (click)="accountFilter.set(chip.key); shown.set(12)">{{ chip.label }}</button>
          }
        </div>
      }
      <div class="bank-list-tools">
        <span>{{ filteredLines().length }} {{ filteredLines().length === 1 ? 'transactie' : 'transacties' }}</span>
        <button class="fin-inline-btn" type="button" [attr.aria-expanded]="phoneFiltersOpen()" (click)="phoneFiltersOpen.set(!phoneFiltersOpen())"><app-icon name="filter" [size]="14" />Periode{{ from() || to() ? ' · actief' : '' }}</button>
        @if (hasFilters()) { <button class="fin-inline-btn" type="button" (click)="clearFilters()">Wis filters</button> }
      </div>
      @if (phoneFiltersOpen()) {
        <div class="bank-period">
          <label>Vanaf<input type="date" [value]="from()" (change)="from.set($any($event.target).value); shown.set(12)" /></label>
          <label>Tot en met<input type="date" [value]="to()" (change)="to.set($any($event.target).value); shown.set(12)" /></label>
        </div>
      }
      @if (invalidPeriod()) { <p class="fin-error" role="alert">De einddatum moet op of na de begindatum liggen.</p> }
      <p class="bank-totals-line">In {{ totals().incoming | eur }} · Uit {{ totals().outgoing | eur }} · Netto {{ netText(totals().net) }}@if (totals().internal) { <span> · interne overboekingen niet meegeteld</span> }</p>
      @for (group of dayGroups(); track group.day) {
        <section class="ios-section">
          <div class="ios-section__head bank-day-head"><h2>{{ group.label }}</h2><span class="ios-section__trail">{{ dayEndText(group.day) }}</span></div>
          <div class="ios-group">
            @for (row of group.rows; track row.id) {
              <div class="ios-swipe bank-swipe" appSwipeActions #sw="swipeActions" [swipeStart]="actionOf(row) ? 1 : 0" [swipeEnd]="allocated(row) ? 0 : 1" swipeFull="start"
                   (swipeCommit)="$event === 'start' ? runAction(row) : state.bookAsLine.set(row)">
                @if (actionOf(row); as action) {
                  <div class="ios-swipe__actions ios-swipe__actions--start">
                    <button class="ios-swipe__btn tone-ok" type="button" (click)="runAction(row); sw.close()"><app-icon name="link" [size]="20" />{{ action.kind === 'link' ? 'Koppel' : action.label }}</button>
                  </div>
                }
                @if (!allocated(row)) {
                  <div class="ios-swipe__actions ios-swipe__actions--end">
                    <button class="ios-swipe__btn tone-blue" type="button" (click)="state.bookAsLine.set(row); sw.close()"><app-icon name="tag" [size]="20" />Boeken als…</button>
                  </div>
                }
                <div class="ios-swipe__row">
                  <div class="bank-phone-row">
                    <button class="bank-phone-row__open" type="button" (click)="openLine(row)" [attr.aria-label]="(row.counterparty || row.reference || 'Banktransactie') + ', ' + statusLabel(row) + ': openen'">
                      <span class="bank-phone-row__party">{{ row.counterparty || row.reference || 'Banktransactie' }}</span>
                      <strong class="bank-phone-row__amount" [class.wk-amount--in]="row.amountEur > 0">{{ row.amountEur > 0 ? '+' : '−' }} {{ abs(row.amountEur) | eur }}</strong>
                      <span class="bank-phone-row__reference">{{ subOf(row) }}</span>
                      <span class="bank-phone-row__status"><span [class]="'wk-pill ' + statusTone(row)">{{ statusLabel(row) }}</span>@if (koppeling(row); as k) { <span class="bank-phone-row__target">{{ k.text }}</span> }</span>
                      <span class="bank-phone-row__saldo">{{ saldoText(row) === '—' ? '' : 'saldo ' + saldoText(row) }}</span>
                      @if (!state.officialBankLine(row)) { <span class="bank-phone-row__reference">Historische registratie</span> }
                      @if (row.allocationDifferenceEur) { <span class="bank-phone-row__reference">Verschil {{ row.allocationDifferenceEur | eur }}</span> }
                    </button>
                    <button class="bank-phone-row__more" type="button" [attr.aria-label]="'Meer acties voor ' + (row.counterparty || row.reference || 'banktransactie')" (click)="lineMenu(row, null)"><app-icon name="more" [size]="20" /></button>
                  </div>
                </div>
              </div>
            }
          </div>
        </section>
      } @empty {
        <div class="ios-empty"><span class="ios-empty__icon"><app-icon name="bank" [size]="26" /></span>
          <p class="ios-empty__title">{{ emptyTitle() }}</p>
          <p class="ios-empty__text">{{ emptyText() }}</p>
          @if (widerSearch()) { <button class="ios-capsule ios-capsule--tinted" type="button" (click)="searchWider()">Ruimer zoeken</button> }</div>
      }
      @if (visibleLines().length < filteredLines().length) {
        <div class="ios-group fin-ios-more"><button class="ios-cell ios-cell--action" type="button" (click)="shown.update(more)">Meer tonen · nog {{ filteredLines().length - visibleLines().length }}</button></div>
      }
    }
  `,
})
export class BankMovementPanel {
  readonly state = inject(FinanceState);
  /** 'compact': the cockpit's list next to the rail (12 rows, no Koppeling or Saldo, its own filter, 'Alle transacties ›'). */
  readonly mode = input<'full' | 'compact'>('full');
  readonly compact = computed(() => this.mode() === 'compact');
  private readonly api = inject(BankingApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);
  readonly busy = signal(false);
  readonly openingId = signal<number | null>(null);
  readonly phoneFiltersOpen = signal(false);
  readonly matchingLoading = signal(false);
  readonly error = signal('');
  /** The movement form is FinanceState's; the panel only reports whether one is open. */
  readonly draft = computed(() => this.state.movementDraft());
  readonly showHistorical = signal(false);
  readonly historicalCount = computed(() => this.state.bankStatements().filter(row => !this.state.officialBankLine(row) && this.onSelectedAccount(row)).length);
  readonly accountFilter = signal('');
  readonly directionFilter = signal<DirectionFilter>('ALL');
  readonly linkFilter = signal<LinkFilter>('ALL');
  readonly search = signal('');
  readonly from = signal('');
  readonly to = signal('');
  readonly shown = signal(12);
  readonly more = (count: number): number => count + (count >= 50 ? 100 : 25);
  /** The keyboard's row on a desk, and the row whose details are open on a phone. */
  readonly focusId = signal<number | null>(null);
  readonly detailsId = signal<number | null>(null);
  readonly selected = signal<BankStatementLine | null>(null);
  readonly matches = signal<BankMatch[]>([]);
  readonly choice = signal<BankMatch | null>(null);
  readonly manualInvoice = signal(0);
  readonly newBookingConfirmed = signal(false);
  readonly allocationMode = signal<'expense' | 'sales' | 'received'>('sales');
  readonly allocationStep = signal<'documents' | 'payments' | 'new'>('documents');
  readonly localSearch = signal('');
  readonly localSuppliers = signal<Map<number, string>>(new Map());
  readonly localPurchaseFiles = signal<PurchaseDocument[]>([]);
  readonly localPurchaseFilesLoading = signal(false);
  readonly localPurchaseFilesError = signal('');
  readonly localShown = signal(60);
  readonly localKind = signal<'all' | 'cost' | 'sales' | 'purchase'>('all');
  readonly localSelectedKey = signal<string | null>(null);
  readonly localLoading = signal(false);
  readonly localError = signal('');
  readonly localNewConfirmed = signal(false);
  readonly purchaseCurrency = signal<Currency>('EUR');
  readonly purchaseAmountInput = signal('');
  /** 'Waarvan inspectie via leverancier' of a supplier target: the inspection paid in the same transfer, in the purchase currency. */
  readonly purchaseInspectionInput = signal('');
  /** The server knows invoices and payments in parts; Kosten & bank reads it from the first container it has. */
  readonly roundOnServer = computed(() => paymentRoundOnServer(this.state.purchaseViews()[0]));
  /** The container of a purchase target. */
  readonly localPurchaseView = computed(() => {
    const target = this.localDocument();
    return target?.kind === 'purchase' ? this.state.purchaseViews().find(view => view.order.id === target.id) ?? null : null;
  });
  /** Its invoices and invoice files without data, as the documents step lists them. */
  readonly localPurchaseInvoices = computed(() => {
    const view = this.localPurchaseView();
    if (!view || view.invoices === undefined) return null;
    return [
      ...[...view.invoices].sort((left, right) => left.id - right.id).map(invoice => ({ key: 'invoice:' + invoice.id, text: invoiceLine(invoice), documentId: invoice.documentId ?? null, name: invoice.documentName || invoice.number })),
      ...(view.invoiceFiles ?? []).map(file => ({ key: 'file:' + file.documentId, text: `${file.originalFilename} · zonder gegevens`, documentId: file.documentId, name: file.originalFilename })),
    ];
  });
  /** 'dekt 30% bij bestelling + 70% bij vertrek' under the supplier's invoices. */
  readonly localPurchaseTermsLine = computed(() => {
    const view = this.localPurchaseView();
    return view && this.localDocument()?.container?.payee === 'SUPPLIER' && view.invoices?.length ? invoiceTermsLine(view.reconciliation?.supplierInstalments ?? []) : '';
  });
  /** The term's (or stream's) payments with their bank status, from the container tree. */
  readonly localPurchasePayments = computed(() => {
    const view = this.localPurchaseView(), container = this.localDocument()?.container;
    if (!view || !container) return [];
    const branch = this.state.containerTree(view).find(item => item.payee === container.payee);
    return (container.due ? branch?.terms.find(term => term.due === container.due)?.payments : branch?.payments) ?? [];
  });
  /**
   * The container's payments of this payee not on the bank yet, of any term,
   * offered before a new payment is booked on the term: a € 5.000 line may be
   * a part of the unlinked € 12.000 deposit ('Bestaande betaling · €
   * 12.000,00 (30%)', 'Deel koppelen' when it is larger than the line). A
   * choice opens it under Bestaande betaling with its preview.
   */
  readonly localOpenPayments = computed(() => {
    const target = this.localDocument(), bank = this.selected();
    if (!bank || target?.kind !== 'purchase' || !this.roundOnServer()) return [];
    const payee = target.container?.payee ?? 'SUPPLIER';
    const terms = this.localPurchaseView()?.reconciliation?.supplierInstalments ?? [];
    const line = Math.abs(cents(bank.amountEur));
    return this.outgoingCandidates().filter(row => row.kind === 'purchase' && row.ownerId === target.id).flatMap(row => {
      const payment = this.state.payments().find(item => item.id === row.id);
      if (!payment || (payment.payee ?? 'SUPPLIER') !== payee) return [];
      // '30% bij bestelling' → '30%': the term in one word, else the payment's own words.
      const term = payment.instalmentDue ? terms.find(step => step.due === payment.instalmentDue)?.label ?? null : null;
      const short = term ? term.split(' bij ')[0] : payment.label || null;
      return [{ match: row, term: short, action: cents(row.amountEur) > line + 2 ? 'Deel koppelen' : 'Koppelen',
        day: row.paidOn.split('-').reverse().join('/') }];
    });
  });
  /** The inspection field shows for a supplier target when the container's inspection has an Afspraak or is paid via the supplier. */
  readonly localInspectionOffered = computed(() => {
    const view = this.localPurchaseView(), container = this.localDocument()?.container;
    if (!view || container?.payee !== 'SUPPLIER' || container.due === 'FREIGHT' || !this.roundOnServer()) return false;
    const separate = view.reconciliation?.streams.find(stream => stream.payee === 'SEPARATE');
    return !!view.order.inspectionViaSupplier || (separate?.plannedEur ?? 0) > 0;
  });
  readonly purchaseInspection = computed(() => this.localInspectionOffered() && this.purchaseInspectionInput().trim()
    ? parsePurchasePaymentAmount(this.purchaseInspectionInput()) : null);
  readonly localDocuments = computed(() => bankAllocationTargets(this.selected()?.amountEur ?? 0, this.state.costs(), this.state.salesOrders(),
    containerPayables(this.state.purchaseViews()), id => this.customerName(id), cashTotalOf, openOf, id => {
      const order = this.state.purchaseViews().find(view => view.order.id === id)?.order;
      return { party: this.localSuppliers().get(order?.supplierId ?? -1) ?? '', date: order?.orderDate ?? '' };
    }));
  readonly localMatches = computed(() => filterBankAllocationTargets(this.localDocuments().filter(row => this.localKind() === 'all' || row.kind === this.localKind()), this.localSearch(), this.selected() ?? { amountEur: 0 }));
  readonly visibleLocalDocuments = computed(() => this.localMatches().slice(0, this.localShown()));
  readonly localDocument = computed(() => this.localDocuments().find(row => row.key === this.localSelectedKey()) ?? null);
  readonly localExistingPayments = computed(() => {
    const target = this.localDocument(); if (!target || target.kind === 'sales') return [];
    return this.outgoingCandidates().filter(row => row.ownerId === target.id && row.kind === (target.kind === 'cost' ? 'cost' : 'purchase')
      && bankAmountsMatch(-row.amountEur, this.selected()?.amountEur ?? 0));
  });
  readonly localExistingSales = computed(() => this.existingMatches().filter(row => this.localDocument()?.kind === 'sales' && row.salesOrderId === this.localDocument()?.id));
  /** Keep every recorded amount and bank link available, including nonmatching and already-linked payments. */
  readonly localRecordedCostPayments = computed(() => {
    const target = this.localDocument();
    return target?.kind === 'cost' ? this.state.costs().find(cost => cost.id === target.id)?.payments ?? [] : [];
  });
  localRecordedPaymentDifference(payment: { amountEur: number }): number | null {
    const bank = this.selected();
    return bank && Number.isFinite(payment.amountEur) ? bankAmountDifference(bank.amountEur, -payment.amountEur) : null;
  }
  /** A settled cost can only reuse one unambiguous, free payment; never create another. */
  readonly localReusablePayment = computed(() => {
    const target = this.localDocument(), payments = this.localExistingPayments();
    return target?.kind === 'cost' && target.openBankEur === 0 && payments.length === 1 ? payments[0] : null;
  });
  readonly localLinkedPayment = computed(() => {
    const target = this.localDocument(), bank = this.selected();
    if (target?.kind !== 'cost' || !bank) return null;
    return this.state.costs().find(cost => cost.id === target.id)?.payments?.find(payment => payment.bankStatementLineId != null
      && bankAmountsMatch(-payment.amountEur, bank.amountEur)) ?? null;
  });
  readonly localPossibleDuplicate = computed(() => {
    const target = this.localDocument(), bank = this.selected(); if (!target || !bank) return false;
    if (target.kind === 'sales') return this.localExistingSales().length > 0;
    if (this.localExistingPayments().length) return true;
    if (target.kind !== 'cost') return false;
    const linked = new Map(this.state.bankStatements().map(line => [line.id, line]));
    return (this.state.costs().find(cost => cost.id === target.id)?.payments ?? []).some(payment => bankAmountsMatch(-payment.amountEur, bank.amountEur)
      && (payment.bankStatementLineId == null || linked.get(payment.bankStatementLineId)?.source !== 'ODOO'));
  });
  readonly localPreview = computed(() => {
    const bank = this.selected(), target = this.localDocument(); if (!bank || !target) return null;
    const open = target.openBankEur, sameDirection = Math.sign(open) === Math.sign(bank.amountEur);
    const reusable = this.localReusablePayment();
    if (target.kind === 'cost' && open === 0) {
      const recorded = this.localRecordedCostPayments();
      const payment = reusable ? recorded.find(payment => payment.id === reusable.id) : recorded.length === 1 ? recorded[0] : null;
      const paymentEur = payment && Number.isFinite(payment.amountEur) ? -payment.amountEur : null;
      const differenceEur = paymentEur === null ? null : bankAmountDifference(bank.amountEur, paymentEur);
      const paymentLinked = payment ? payment.bankStatementLineId != null : null;
      let explanation: string;
      if (!recorded.length) explanation = 'Deze kost staat als betaald, maar er is geen afzonderlijke betaling geregistreerd. Controleer de bestaande betalingsregistratie; er wordt geen extra betaling aangemaakt.';
      else if (!payment) explanation = `Deze kost heeft ${recorded.length} geregistreerde betalingen. Kies expliciet welke bestaande betaling bij deze banktransactie hoort; er wordt geen bedrag verondersteld.`;
      else if (paymentEur === null || differenceEur === null) explanation = 'Het bedrag van de geregistreerde betaling is niet beschikbaar. Vernieuw de gegevens voordat je een betaling kiest.';
      else if (!bankAmountsMatch(bank.amountEur, paymentEur)) explanation = Math.sign(bank.amountEur) !== Math.sign(paymentEur)
        ? 'De geregistreerde betaling heeft een andere betaalrichting dan de banktransactie. Deze betaling kan niet worden gekoppeld.'
        : `De geregistreerde betaling van ${euro.format(Math.abs(paymentEur))} wijkt ${euro.format(Math.abs(differenceEur))} af van de banktransactie. Maximaal € 0,02 verschil is toegestaan; de bedragen blijven behouden.`;
      else if (paymentLinked) explanation = 'De geregistreerde betaling heeft al een bankkoppeling. Open die eerdere koppeling en maak ze eerst los als je deze betaling wilt hergebruiken.';
      else explanation = 'Deze kost is al betaald. De bestaande betaling wordt hergebruikt; er wordt geen extra betaling aangemaakt.';
      return { paymentEur, openEur: 0, remainingEur: 0, differenceEur, overpaidEur: 0, eligible: false,
        paymentKind: payment ? 'existing' as const : 'choose-existing' as const, paymentLinked, explanation };
    }
    const payment = target.kind === 'purchase' ? (this.purchaseCurrency() === 'EUR' ? -(parsePurchasePaymentAmount(this.purchaseAmountInput()) ?? 0) : bank.amountEur)
      : bankAmountsMatch(bank.amountEur, open) ? open : bank.amountEur;
    const inspection = target.kind === 'purchase' ? this.purchaseInspection() : null;
    const inspectionValid = target.kind !== 'purchase' || !this.purchaseInspectionInput().trim() || !this.localInspectionOffered()
      || (inspection !== null && cents(inspection) < cents(parsePurchasePaymentAmount(this.purchaseAmountInput()) ?? 0));
    const amountValid = target.kind === 'purchase' ? !!parsePurchasePaymentAmount(this.purchaseAmountInput()) && bankAmountsMatch(bank.amountEur, payment) && inspectionValid
      : sameDirection && (Math.abs(bank.amountEur) <= Math.abs(open) || bankAmountsMatch(bank.amountEur, open) || (target.kind === 'sales' && bank.amountEur > 0));
    return { paymentEur: payment, openEur: Math.abs(open), remainingEur: Math.max(0, cents(Math.abs(open)) - cents(Math.abs(payment))) / 100,
      differenceEur: bankAmountDifference(bank.amountEur, payment), overpaidEur: Math.max(0, cents(Math.abs(payment)) - cents(Math.abs(open))) / 100,
      eligible: amountValid && (target.kind === 'purchase' || open !== 0), paymentKind: 'new' as const, paymentLinked: null, explanation: null };
  });
  readonly localBankProblem = computed(() => {
    const selected = this.selected(); if (!selected) return '';
    const current = this.state.bankStatements().find(line => line.id === selected.id); if (!current) return '';
    if (this.allocated(current)) return 'Deze banktransactie is intussen gekoppeld. Sluit dit scherm en vernieuw het overzicht.';
    return current.amountEur !== selected.amountEur || current.bookedAt !== selected.bookedAt || this.state.canonicalAccount(current.account) !== this.state.canonicalAccount(selected.account)
      ? 'Deze banktransactie is intussen gewijzigd. Sluit dit scherm en kies de transactie opnieuw.' : '';
  });
  readonly canLinkLocal = computed(() => !this.localBankProblem() && !!this.localDocument() && !!this.localPreview()?.eligible && !this.localLoading() && !this.localError() && !this.busy()
    && (!(this.localPossibleDuplicate() || (this.localDocument()?.kind === 'sales' && (this.localPreview()?.overpaidEur ?? 0) > 0)) || this.localNewConfirmed()));
  /** The footer only composes existing allocation guards, including the fresh local-source gate. */
  readonly allocationReady = computed(() => {
    const bank = this.selected();
    if (!bank || this.busy() || this.allocated(bank) || this.localBankProblem()) return false;
    const step = this.allocationStep();
    if (step === 'new') return this.canLinkReceived();
    if (this.localLoading() || this.localError()) return false;
    if (step === 'documents') return this.canLinkLocal() || !!this.localReusablePayment();
    return this.allocationMode() === 'expense' ? this.canLinkOutgoing() : this.canAllocate();
  });
  readonly allocationActionLabel = computed(() => {
    if (this.busy()) return 'Koppelen…';
    if (this.allocationStep() === 'payments' && this.allocationMode() === 'expense' && this.outgoingPart()?.carve) return 'Deel koppelen';
    if (this.allocationStep() === 'documents' && this.localReusablePayment()) return 'Bestaande betaling koppelen';
    if (this.allocationStep() === 'new' && !this.receivedPreview()?.companyCostId && !this.receivedExistingCostId()) return 'Registreren en koppelen';
    return 'Koppelen';
  });
  readonly allocationBlockedReason = computed(() => {
    if (this.allocationReady()) return '';
    const bank = this.selected();
    if (!bank) return 'Kies eerst een banktransactie.';
    if (this.busy()) return 'De koppeling wordt verwerkt. Wacht tot dit klaar is.';
    if (this.localBankProblem()) return this.localBankProblem();
    if (this.allocated(bank)) return 'Deze banktransactie is al gekoppeld. Sluit dit scherm en vernieuw het overzicht.';
    const step = this.allocationStep();
    if (step === 'new') {
      const preview = this.receivedPreview();
      if (this.receivedPreviewLoading()) return 'De factuurbedragen en bestaande registraties worden nog gecontroleerd.';
      if (!preview && this.receivedLoading()) return 'De ontvangen documenten worden nog geladen.';
      if (!preview && this.receivedError()) return this.receivedError();
      if (!preview) return bank.amountEur < 0 ? 'Kies eerst een ontvangen factuur, of registreer hierboven zelf een uitgave.' : 'Kies eerst een ontvangen creditnota.';
      if (preview.existingCandidates.length && !preview.companyCostId && !preview.existingCandidates.some(cost => cost.id === this.receivedExistingCostId()))
        return 'Kies de bestaande kost die bij deze factuur hoort. Zo voorkom je een dubbele registratie.';
      if (!preview.eligible) return preview.unavailableReason || preview.actionMessage || 'Deze factuur kan nog niet worden gekoppeld. Controleer de factuurgegevens hierboven.';
      if (!preview.snapshotHash) return 'De factuurcontrole is niet volledig. Kies het document opnieuw.';
      if (!bankAmountsMatch(bank.amountEur, -preview.paymentAmountEur) || !Number.isFinite(preview.differenceEur) || Math.abs(Math.round(preview.differenceEur * 100)) > 2)
        return 'De betaalrichting of het bedrag past niet bij de banktransactie. Maximaal € 0,02 verschil is toegestaan.';
    } else {
      if (this.localLoading()) return 'Facturen en bestaande betalingen worden nog geladen.';
      if (this.localError()) return 'De gegevens zijn niet volledig geladen. Probeer opnieuw te laden: ' + this.localError();
      if (step === 'documents') {
        const target = this.localDocument(), preview = this.localPreview();
        if (!target) return this.localSelectedKey() ? 'Het gekozen document is niet meer beschikbaar. Kies het opnieuw.' : 'Kies eerst een factuur of uitgave uit de lijst hierboven.';
        if (target.openBankEur === 0 && target.kind !== 'purchase') {
          if (target.kind === 'cost' && preview?.explanation) return preview.explanation;
          const count = this.localExistingPayments().length + this.localExistingSales().length;
          if (count > 1) return 'Er zijn meerdere passende betalingen. Kies hieronder expliciet welke bestaande betaling je wilt koppelen.';
          if (count) return 'Dit document is al betaald. Kies hieronder de bestaande betaling om die te hergebruiken.';
          if (this.localLinkedPayment()) return 'De passende betaling heeft al een bankkoppeling. Open die eerdere koppeling en maak ze eerst los als je deze betaling wilt hergebruiken.';
          return 'Dit document is al betaald, maar er is geen vrije passende betaling gevonden. Kies een bestaande betaling; er wordt geen extra betaling aangemaakt.';
        }
        if (!preview?.eligible) return target.kind === 'purchase'
          ? 'Vul een geldig betaald bedrag in. Het EUR-bedrag mag maximaal € 0,02 afwijken van de banktransactie.'
          : 'De betaalrichting of het openstaande bedrag past niet bij de banktransactie. Maximaal € 0,02 verschil is toegestaan.';
        if (this.localPossibleDuplicate() && !this.localNewConfirmed()) return this.localLinkedPayment() && !this.localExistingPayments().length
          ? 'Een passende betaling heeft al een eerdere bankkoppeling. Hergebruik die via de bestaande koppeling, of bevestig hierboven dat dit een nieuwe betaling is.'
          : 'Er bestaat mogelijk al een passende betaling. Kies die betaling, of bevestig hierboven dat dit een nieuwe betaling is.';
        if (target.kind === 'sales' && preview.overpaidEur > 0 && !this.localNewConfirmed()) return 'Bevestig hierboven dat je het hogere ontvangen bedrag op deze factuur wilt registreren.';
      } else if (this.allocationMode() === 'expense') {
        const chosen = this.chosenOutgoing();
        if (!this.outgoingSelected().length) return 'Selecteer eerst één of meer bestaande betalingen.';
        if (chosen.length !== this.outgoingSelected().length) return 'Een geselecteerde betaling is niet meer beschikbaar. Kies de bestaande betalingen opnieuw.';
        if (chosen.filter(payment => payment.kind === 'cost').length > 1) return 'Kies maximaal één kostenbetaling; meerdere containerbetalingen kunnen samen worden gekoppeld.';
        const part = this.outgoingPart();
        if (part?.foreign && this.outgoingForeignInvalid()) return 'Vul een positief deel in, of laat het leeg voor de hele betaling.';
        if (part?.refused) return part.refused;
        if (part?.higher && !this.outgoingSurplus()) return `${this.outgoingSurplusText()}: kies hierboven wat er met het verschil gebeurt.`;
        if (!bankAmountsMatch(-this.outgoingTotal(), bank.amountEur) && !part?.carve && !part?.higher && !part?.foreign) return 'Het totaal van de gekozen betalingen past niet bij de banktransactie. Maximaal € 0,02 verschil op het totaal is toegestaan.';
      } else {
        if (this.matchingLoading()) return 'De passende ontvangsten en terugbetalingen worden nog geladen.';
        const choice = this.choice();
        if (!choice) return 'Kies eerst een bestaande ontvangst of terugbetaling.';
        const difference = this.matchDifference(choice);
        if (choice.existingPaymentId && difference !== null && Math.abs(Math.round(difference * 100)) > 2) return 'De bestaande betaling wijkt meer dan € 0,02 af van de banktransactie. Kies een passende betaling.';
        if (!choice.existingPaymentId && this.chosenInvoiceHasExistingMatches() && !this.newBookingConfirmed()) return 'Er bestaat al een passende betaling. Kies die betaling of bevestig expliciet een nieuwe betaling.';
      }
    }
    return 'Controleer de gekozen betaling voordat je de banktransactie koppelt.';
  });
  async submitAllocation(): Promise<void> {
    if (!this.allocationReady()) return;
    if (this.allocationStep() === 'documents') {
      const payment = this.localReusablePayment();
      if (payment) { this.reuseLocalPayment(payment); await this.linkOutgoing(); }
      else await this.linkLocalDocument();
    } else if (this.allocationStep() === 'new') await this.linkReceivedInvoice();
    else if (this.allocationMode() === 'expense') await this.linkOutgoing();
    else await this.allocate();
  }
  setAllocationStep(step: 'documents' | 'payments' | 'new'): void {
    if (this.busy()) return;
    this.allocationStep.set(step); this.error.set('');
    if (step === 'new') this.setAllocationMode('received');
  }
  chooseLocalDocument(target: BankAllocationTarget): void {
    if (this.busy()) return;
    this.localSelectedKey.set(target.key); this.localNewConfirmed.set(false); this.error.set('');
    this.purchaseCurrency.set('EUR'); this.purchaseAmountInput.set(amountInputText(Math.abs(this.selected()?.amountEur ?? 0))); this.purchaseInspectionInput.set('');
    this.localPurchaseFiles.set([]); this.localPurchaseFilesError.set('');
    // A server with invoices lists them from the container view; an older one keeps the commercial invoice files.
    if (target.kind === 'purchase' && this.state.purchaseViews().find(view => view.order.id === target.id)?.invoices === undefined) void this.loadLocalPurchaseFiles(target.id);
  }
  changePurchaseCurrency(currency: Currency): void {
    if (this.busy()) return;
    this.purchaseCurrency.set(currency); this.purchaseAmountInput.set(currency === 'EUR' ? amountInputText(Math.abs(this.selected()?.amountEur ?? 0)) : '');
  }
  async loadLocalDocuments(): Promise<void> {
    const bank = this.selected(); if (!bank || this.localLoading() || this.busy()) return;
    const version = this.allocationVersion; this.localLoading.set(true); this.localError.set('');
    try {
      const sources = ['costs', 'orders', 'payments', 'containers', 'incoming', 'statements'] as const;
      const [, suppliers] = await Promise.all([this.state.reload(sources), this.sourcing.suppliers()]);
      if (version === this.allocationVersion) this.localSuppliers.set(new Map(suppliers.filter(supplier => supplier.id != null).map(supplier => [supplier.id!, supplier.name])));
      const failures = this.state.sourceErrors(sources);
      if (failures.length && version === this.allocationVersion) this.localError.set(failures.join(' · '));
    }
    catch (failure) { if (version === this.allocationVersion) this.localError.set(messageOf(failure, 'Facturen en uitgaven laden mislukt. Probeer opnieuw.')); }
    finally { if (version === this.allocationVersion) this.localLoading.set(false); }
  }
  async loadLocalPurchaseFiles(orderId: number): Promise<void> {
    const version = this.allocationVersion; this.localPurchaseFilesLoading.set(true); this.localPurchaseFilesError.set('');
    try {
      const documents = await this.sourcing.documents(orderId);
      if (version === this.allocationVersion && this.localDocument()?.kind === 'purchase' && this.localDocument()?.id === orderId) this.localPurchaseFiles.set(documents.filter(document => document.kind === 'COMMERCIAL_INVOICE'));
    } catch (failure) { if (version === this.allocationVersion && this.localDocument()?.id === orderId) this.localPurchaseFilesError.set(messageOf(failure, 'Inkoopfacturen laden mislukt.')); }
    finally { if (version === this.allocationVersion && this.localDocument()?.id === orderId) this.localPurchaseFilesLoading.set(false); }
  }
  async openPurchaseInvoice(document: PurchaseDocument): Promise<void> {
    await this.run(async () => saveBlob(await this.sourcing.documentFile(document.orderId, document.id), document.originalFilename));
  }
  /** 'Bestand ↗' of a container invoice or invoice file. */
  async openPurchaseFile(orderId: number, documentId: number, name: string): Promise<void> {
    await this.run(async () => saveBlob(await this.sourcing.documentFile(orderId, documentId), name));
  }
  reuseLocalPayment(payment: OutgoingMatch): void {
    if (this.busy()) return;
    this.outgoingSelected.set([payment.key]); this.allocationMode.set('expense'); this.allocationStep.set('payments');
  }
  reuseLocalSales(match: BankMatch): void { if (!this.busy()) { this.chooseMatch(match); this.allocationMode.set('sales'); this.allocationStep.set('payments'); } }
  newCostFromBank(): void {
    const bank = this.selected(); if (!bank || bank.amountEur >= 0 || this.busy()) return;
    this.closeAllocation(); this.state.openCostFromBank(bank);
  }
  async linkLocalDocument(): Promise<void> {
    const bank = this.selected(), target = this.localDocument(); if (!bank || !target || !this.canLinkLocal()) return;
    const amount = parsePurchasePaymentAmount(this.purchaseAmountInput()), currency = this.purchaseCurrency();
    const inspection = target.kind === 'purchase' && target.container?.payee === 'SUPPLIER' ? this.purchaseInspection() : null;
    const confirmNew = this.localNewConfirmed();
    await this.run(async () => {
      let saved: BankStatementLine;
      if (target.kind === 'cost') saved = await this.api.addCostPayment(bank.id, target.id, confirmNew);
      else if (target.kind === 'sales') saved = await this.api.allocate(bank.id, target.id, null);
      else if (inspection !== null) {
        // Goods and the inspection paid via the supplier in one transfer: two payments on this line, the inspection setting the container's flag.
        const parts = splitTransfer({ amount: Math.round((amount! - inspection) * 100) / 100, currency, paidOn: bankTransactionDay(bank),
          label: target.reference || 'Bankbetaling', payee: 'SUPPLIER', settles: false, instalmentDue: target.container!.due,
          amountEur: currency === 'EUR' ? null : Math.abs(bank.amountEur), separateAmount: inspection, inspectionViaSupplier: true, invoiceId: null },
          value => value).writes;
        saved = (await this.api.addPurchasePayment(bank.id, target.id, parts)).line;
      } else {
        const result = await this.api.addPurchasePayment(bank.id, target.id, [{ paidOn: bankTransactionDay(bank), amount: amount!, currency,
          amountEur: currency === 'EUR' ? null : Math.abs(bank.amountEur), label: target.reference || 'Bankbetaling',
          payee: target.container!.payee, instalmentDue: target.container!.due, settles: false }]);
        saved = result.line;
      }
      this.state.bankStatements.update(rows => [saved, ...rows.filter(row => row.id !== saved.id)]);
      ++this.allocationVersion; this.selected.set(null); this.localSelectedKey.set(null);
      this.ui.toast(inspection !== null ? 'Bankbetaling gekoppeld: goederen + inspectie' : `Bankbetaling gekoppeld aan ${target.title}`, 'ok');
      await this.state.refreshBank(); await this.state.reload(['costs', 'payments', 'containers']);
    });
  }

  readonly outgoingSearch = signal('');
  readonly outgoingSelected = signal<string[]>([]);
  readonly outgoingCandidates = computed<OutgoingMatch[]>(() => {
    const result: OutgoingMatch[] = [];
    for (const cost of this.state.costs()) for (const payment of cost.payments ?? []) {
      if (!payment.id || payment.bankStatementLineId != null || !payment.amountEur || Math.sign(payment.amountEur) !== -Math.sign(this.selected()?.amountEur ?? -1)) continue;
      result.push({ ownerId: cost.id!, key: 'cost:' + payment.id, kind: 'cost', id: payment.id, title: cost.party || cost.description,
        detail: [cost.description, cost.reference, payment.note].filter(Boolean).join(' · '), paidOn: payment.paidOn, amountEur: payment.amountEur });
    }
    const groups = new Map<number, number>();
    for (const payment of this.state.payments()) if (payment.groupId != null) groups.set(payment.groupId, (groups.get(payment.groupId) ?? 0) + 1);
    for (const payment of this.state.payments()) {
      // A credit offset left no bank: it is never offered for a bank line.
      if (payment.bankStatementLineId != null || payment.creditOffset || !(payment.amountEur > 0) || (this.selected()?.amountEur ?? -1) > 0) continue;
      const parts = payment.groupId != null ? groups.get(payment.groupId) ?? 0 : 0;
      result.push({ ownerId: payment.orderId, key: 'purchase:' + payment.id, kind: 'purchase', id: payment.id, title: payment.orderAlias || payment.orderNumber || 'Container',
        detail: [payment.orderNumber, payment.label, parts > 1 ? `deel van een betaling in ${parts} transacties` : null].filter(Boolean).join(' · '),
        paidOn: payment.paidOn, amountEur: payment.amountEur, grouped: payment.groupId != null });
    }
    return result.sort((a, b) => b.paidOn.localeCompare(a.paidOn) || a.id - b.id);
  });
  readonly visibleOutgoing = computed(() => {
    const search = this.outgoingSearch().trim().toLocaleLowerCase('nl-BE');
    const words = search.split(/\s+/).filter(Boolean);
    return this.outgoingCandidates().filter(row => words.every(word => [row.title, row.detail, row.paidOn, row.paidOn.split('-').reverse().join('/'), row.amountEur.toFixed(2), row.amountEur.toFixed(2).replace('.', ',')].join(' ').toLocaleLowerCase('nl-BE').includes(word)));
  });
  readonly chosenOutgoing = computed(() => this.outgoingCandidates().filter(row => this.outgoingSelected().includes(row.key)));
  readonly outgoingTotal = computed(() => this.chosenOutgoing().reduce((sum, row) => sum + cents(row.amountEur), 0) / 100);
  readonly outgoingDifference = computed(() => this.selected() ? bankAmountDifference(this.selected()!.amountEur, -this.outgoingTotal()) : 0);
  /**
   * One purchase payment alone, through the split endpoint (bank-part), so it
   * follows the transaction (its day, its euro): a payment larger than the
   * line gets the line's part carved out ('Deel koppelen'; the rest stays
   * open as a second transfer), a matching one is linked whole, a larger one
   * asks what the surplus is (`higher`, then outgoingSurplus). The goods and
   * the inspection noted with them (one supplier payment and its container's
   * Inspectie payments) that together make the line go the same way, the
   * inspection keeping its amount (`withIds`). Other selections keep /links,
   * dates unchanged. A USD/CNY payment is compared in its own currency, as
   * the server does: the line is the whole payment (its euro and day follow,
   * its dollars stay) unless a part is named in that currency (`amount`, then
   * carved); never 'hoger'.
   */
  readonly outgoingPart = computed<{ row: OutgoingMatch; carve: boolean; higher: boolean; withIds: number[];
    foreign: ForeignLink | null; amount: number | null; refused: string | null } | null>(() => {
    const line = this.selected(), rows = this.chosenOutgoing();
    if (!line || !this.roundOnServer() || !rows.length || rows.length !== this.outgoingSelected().length || rows.some(row => row.kind !== 'purchase')) return null;
    if (rows.length > 1) {
      const payments = rows.map(row => this.state.payments().find(item => item.id === row.id));
      const goods = payments.filter(payment => (payment?.payee ?? 'SUPPLIER') === 'SUPPLIER' && payment?.instalmentDue !== 'FREIGHT');
      const rest = payments.filter(payment => payment?.payee === 'SEPARATE');
      if (goods.length !== 1 || rest.length !== rows.length - 1 || new Set(payments.map(payment => payment?.orderId)).size !== 1
        || !bankAmountsMatch(-this.outgoingTotal(), line.amountEur)) return null;
      const row = rows.find(item => item.id === goods[0]!.id)!;
      return { row, carve: false, higher: false, withIds: rest.map(payment => payment!.id), foreign: null, amount: null, refused: null };
    }
    const row = rows[0];
    const payment = this.state.payments().find(item => item.id === row.id);
    if (payment?.currency && payment.currency !== 'EUR' && (payment.amount ?? 0) > 0) {
      const foreign: ForeignLink = { amount: payment.amount!, currency: payment.currency, part: this.outgoingForeignPart() };
      const plan = pendingLinkPlan(row.amountEur, [{ id: line.id, amountEur: line.amountEur }], true, null, [], foreign);
      if (plan.kind !== 'part') return { row, carve: false, higher: false, withIds: [], foreign, amount: null, refused: plan.kind === 'invalid' ? plan.message : null };
      return { row, carve: !plan.whole, higher: false, withIds: [], foreign, amount: plan.amount ?? null, refused: null };
    }
    if (cents(row.amountEur) > cents(Math.abs(line.amountEur)) + 2) return { row, carve: true, higher: false, withIds: [], foreign: null, amount: null, refused: null };
    return { row, carve: false, higher: cents(Math.abs(line.amountEur)) > cents(row.amountEur) + 2, withIds: [], foreign: null, amount: null, refused: null };
  });
  /** 'Alleen een deel? Deel in USD' of one USD/CNY payment: empty is the whole payment. */
  readonly outgoingForeignInput = signal('');
  readonly outgoingForeignInvalid = computed(() => !!this.outgoingForeignInput().trim() && parsePurchasePaymentAmount(this.outgoingForeignInput()) === null);
  private readonly outgoingForeignPart = computed(() => this.outgoingForeignInput().trim() ? parsePurchasePaymentAmount(this.outgoingForeignInput()) : null);
  /** 'Deel van deze betaling: …', in the payment's own currency for a USD/CNY part (the server's words). */
  readonly outgoingCarveText = computed(() => {
    const part = this.outgoingPart(), line = this.selected();
    if (!part?.carve || !line) return '';
    return part.foreign && part.amount != null ? carveForeignText(part.amount, line.amountEur, part.foreign.amount, part.foreign.currency)
      : carveText(part.row.amountEur, line.amountEur);
  });
  /** The whole USD/CNY payment would take a euro far from its booked one: maybe the transaction paid only a part. */
  readonly outgoingForeignWarning = computed(() => {
    const part = this.outgoingPart(), line = this.selected();
    return part?.foreign && !part.carve && !part.refused && line ? foreignLinkWarning({ amountEur: part.row.amountEur, currency: part.foreign.currency }, line.amountEur) : null;
  });
  /** A transaction larger than the one chosen payment: 'Bedrag aanpassen' or 'Rest als inspectie via leverancier'. */
  readonly outgoingSurplus = signal<SurplusChoice | null>(null);
  readonly outgoingSurplusText = computed(() => {
    const part = this.outgoingPart(), line = this.selected();
    return part?.higher && line ? surplusQuestion((cents(Math.abs(line.amountEur)) - cents(part.row.amountEur)) / 100) : '';
  });
  /**
   * What 'Bedrag aanpassen' does to the payment's term, said on the choice:
   * 'De termijn komt dan € 300,00 boven de afspraak (te veel betaald).' The
   * term (or the payee, without one) as the container's reconciliation has
   * it, this payment counted.
   */
  readonly outgoingAdjustText = computed(() => {
    const part = this.outgoingPart(), line = this.selected();
    if (!part?.higher || !line) return '';
    const payment = this.state.payments().find(item => item.id === part.row.id);
    const report = payment ? this.state.purchaseViews().find(item => item.order.id === payment.orderId)?.reconciliation : undefined;
    const payee = payment?.payee ?? 'SUPPLIER';
    const term = payee === 'SUPPLIER' && payment?.instalmentDue ? report?.supplierInstalments?.find(step => step.due === payment.instalmentDue) : undefined;
    const stream = report?.streams.find(item => item.payee === payee);
    const standing = term ? { label: term.label, term: true, plannedEur: term.plannedEur, paidEur: term.paidEur }
      : stream && payee !== 'OTHER' ? { label: stream.label, term: false, plannedEur: stream.plannedEur, paidEur: stream.paidEur } : null;
    return adjustConsequence(standing, (cents(Math.abs(line.amountEur)) - cents(part.row.amountEur)) / 100);
  });
  /**
   * The rest of a larger transaction may be the inspection paid via the
   * supplier, by the server's rule (inspectionRestOffered): a euro supplier
   * goods payment of a container with an inspection cost, no inspection noted
   * with it on that day, and the inspection via the supplier not booked yet.
   */
  readonly outgoingInspectionOffered = computed(() => {
    const part = this.outgoingPart();
    if (!part?.higher) return false;
    const payment = this.state.payments().find(item => item.id === part.row.id);
    const order = payment ? this.state.purchaseViews().find(item => item.order.id === payment.orderId)?.order : undefined;
    if (!payment || !order) return false;
    const payments = this.state.payments().filter(item => item.orderId === payment.orderId);
    return inspectionRestOffered(payment, order, payments, transferCompanions(payment, payments).length);
  });
  /** 'Wat verandert' for one payment and this transaction: its amount, day, rate and proof now and after the link. */
  readonly outgoingChange = computed<LinkChangeRow[]>(() => {
    const part = this.outgoingPart(), line = this.selected();
    if (!part || !line || (part.higher && !this.outgoingSurplus())) return [];
    const payment = this.state.payments().find(item => item.id === part.row.id);
    const day = bankTransactionDay(line);
    const companionsEur = this.chosenOutgoing().filter(row => part.withIds.includes(row.id)).reduce((sum, row) => sum + cents(row.amountEur), 0) / 100;
    if (part.refused) return [];
    return linkChange({ amount: payment?.amount ?? part.row.amountEur, currency: payment?.currency ?? 'EUR', amountEur: part.row.amountEur, paidOn: part.row.paidOn, proof: 'geen' },
      { amountEur: line.amountEur, day, text: `${day.split('-').reverse().join('/')} · ${line.account} · ${euro.format(Math.abs(line.amountEur))}` },
      { kind: 'part', lineId: line.id, whole: !part.carve, ...(part.amount != null ? { amount: part.amount } : {}),
        ...(part.higher ? { surplus: this.outgoingSurplus()! } : {}), ...(part.withIds.length ? { withPaymentIds: part.withIds } : {}) },
      companionsEur);
  });
  readonly canLinkOutgoing = computed(() => {
    const line = this.selected(), rows = this.chosenOutgoing();
    const part = this.outgoingPart();
    return !this.busy() && !!line && line.amountEur !== 0 && !this.allocated(line) && rows.length > 0
      && rows.length === this.outgoingSelected().length && rows.filter(row => row.kind === 'cost').length <= 1
      && (part?.foreign ? !part.refused && !this.outgoingForeignInvalid()
        : part?.higher ? !!this.outgoingSurplus() : bankAmountsMatch(-this.outgoingTotal(), line.amountEur) || !!part?.carve);
  });
  toggleOutgoing(row: OutgoingMatch): void {
    if (this.busy()) return;
    this.outgoingSurplus.set(null); this.outgoingForeignInput.set('');
    this.outgoingSelected.update(keys => keys.includes(row.key) ? keys.filter(key => key !== row.key)
      : [...(row.kind === 'cost' ? keys.filter(key => !key.startsWith('cost:')) : keys), row.key]);
  }
  chooseOutgoingSurplus(choice: SurplusChoice | null): void { if (!this.busy()) this.outgoingSurplus.set(choice); }
  async linkOutgoing(): Promise<void> {
    if (!this.canLinkOutgoing()) return;
    const line = this.selected()!, rows = this.chosenOutgoing();
    const part = this.outgoingPart();
    if (part) {
      const surplus = part.higher ? this.outgoingSurplus() : null;
      await this.run(async () => {
        // A USD/CNY part goes in the payment's own currency (`amount`); otherwise the server takes the line as it is.
        const result = await this.sourcing.linkPaymentPart(part.row.id, line.id, part.amount, { higher: surplus, withPaymentIds: part.withIds });
        const saved = result.lines.find(item => item.id === line.id);
        if (saved) this.state.bankStatements.update(lines => lines.map(row => row.id === saved.id ? saved : row));
        ++this.allocationVersion; this.selected.set(null); this.outgoingSelected.set([]); this.outgoingSurplus.set(null); this.outgoingForeignInput.set('');
        // The short notice of what followed the transaction (the order screens show the same words): the server's own sentence first.
        const after = result.payments.find(payment => payment.id === part.row.id);
        const inspection = surplus === 'INSPECTION' ? result.payments.find(payment => payment.id !== part.row.id && (payment.payee ?? 'SUPPLIER') === 'SEPARATE'
          && payment.bankStatementLineId === line.id) : undefined;
        const notice = result.notice ?? (!part.carve && after ? linkNotice(part.row, after, inspection?.amountEur ?? null) : null);
        this.ui.toast(notice ?? (part.carve ? 'Deel van de betaling gekoppeld' : 'Banktransactie gekoppeld'));
        await this.state.refreshBank(); await this.state.reload(['costs', 'payments', 'containers']);
      });
      return;
    }
    await this.run(async () => {
      const cost = rows.find(row => row.kind === 'cost');
      const saved = await this.api.linkPayments(line.id, { purchasePaymentIds: rows.filter(row => row.kind === 'purchase').map(row => row.id), ...(cost ? { costPaymentId: cost.id } : {}) });
      this.state.bankStatements.update(lines => lines.map(row => row.id === saved.id ? saved : row));
      ++this.allocationVersion; this.selected.set(null); this.outgoingSelected.set([]);
      this.ui.toast('Bestaande betalingen gekoppeld');
      await this.state.refreshBank(); await this.state.reload(['costs', 'payments']);
    });
  }
  readonly receivedInvoices = signal<ReceivedOdooInvoice[]>([]);
  readonly receivedLoading = signal(false);
  readonly receivedLoaded = signal(false);
  readonly receivedHasMore = signal(false);
  readonly receivedSearch = signal('');
  readonly receivedError = signal('');
  readonly receivedPreviewLoading = signal(false);
  readonly receivedSelectedId = signal<number | null>(null);
  readonly receivedPreview = signal<ReceivedOdooInvoicePreview | null>(null);
  readonly receivedExistingCostId = signal<number | null>(null);
  private receivedCursor = 0;
  private receivedPreviewVersion = 0;
  readonly visibleReceivedInvoices = computed(() => {
    const words = this.receivedSearch().trim().toLocaleLowerCase('nl-BE').split(/\s+/).filter(Boolean);
    return this.receivedInvoices().filter(document => {
      if (document.moveType !== ((this.selected()?.amountEur ?? -1) < 0 ? 'in_invoice' : 'in_refund')) return false;
      const text = [document.name, document.reference, document.partner, document.date, document.total.toFixed(2), document.total.toFixed(2).replace('.', ','), this.receivedSource(document)].join(' ').toLocaleLowerCase('nl-BE');
      return words.every(word => text.includes(word));
    });
  });
  readonly canLinkReceived = computed(() => {
    const preview = this.receivedPreview();
    return !this.busy() && !this.receivedPreviewLoading() && !!this.selected() && !!preview?.eligible && !!preview.snapshotHash
      && bankAmountsMatch(this.selected()!.amountEur, -preview.paymentAmountEur)
      && Number.isFinite(preview.differenceEur) && Math.abs(Math.round(preview.differenceEur * 100)) <= 2
      && (!preview.existingCandidates.length || !!preview.companyCostId || preview.existingCandidates.some(cost => cost.id === this.receivedExistingCostId()));
  });
  receivedSource(document: ReceivedOdooInvoice): string { return document.peppolMessageId || document.peppolState === 'done' ? 'Ontvangen via Peppol' : 'Odoo'; }
  setAllocationMode(mode: 'expense' | 'sales' | 'received'): void {
    if (this.busy()) return;
    this.allocationMode.set(mode); this.error.set('');
    if (mode === 'received' && !this.receivedLoaded()) void this.loadReceivedInvoices();
  }
  async loadReceivedInvoices(more = false): Promise<void> {
    const bank = this.selected();
    if (!bank || this.receivedLoading() || this.busy() || (more && !this.receivedHasMore())) return;
    const version = this.allocationVersion, cursor = more ? this.receivedCursor : 0;
    this.receivedLoading.set(true); this.receivedError.set('');
    try {
      const result = await this.api.receivedOdooInvoices(bank.id, cursor);
      if (version !== this.allocationVersion || this.selected()?.id !== bank.id) return;
      this.receivedInvoices.set([...new Map([...(more ? this.receivedInvoices() : []), ...result.documents].map(document => [document.id, document])).values()]);
      this.receivedCursor = result.nextAfterId ?? 0;
      this.receivedHasMore.set(result.hasMore && result.nextAfterId != null && result.nextAfterId !== cursor);
      this.receivedLoaded.set(true);
    } catch (failure) { if (version === this.allocationVersion) this.receivedError.set(messageOf(failure, 'Ontvangen facturen laden mislukt. Probeer opnieuw.')); }
    finally { if (version === this.allocationVersion) this.receivedLoading.set(false); }
  }
  async selectReceivedInvoice(document: ReceivedOdooInvoice, existingCompanyCostId?: number): Promise<void> {
    const bank = this.selected();
    if (!bank || this.busy()) return;
    const version = this.allocationVersion, previewVersion = ++this.receivedPreviewVersion;
    this.receivedSelectedId.set(document.id); this.receivedPreview.set(null); this.receivedExistingCostId.set(null);
    this.receivedPreviewLoading.set(true); this.receivedError.set(''); this.error.set('');
    try {
      const preview = await this.api.previewReceivedOdooInvoice(bank.id, document.id, existingCompanyCostId);
      if (version !== this.allocationVersion || previewVersion !== this.receivedPreviewVersion || this.selected()?.id !== bank.id) return;
      this.receivedPreview.set(preview); this.receivedExistingCostId.set(existingCompanyCostId ?? preview.companyCostId);
    } catch (failure) { if (version === this.allocationVersion && previewVersion === this.receivedPreviewVersion) this.receivedError.set(messageOf(failure, 'Factuur controleren mislukt. Kies de factuur opnieuw.')); }
    finally { if (version === this.allocationVersion && previewVersion === this.receivedPreviewVersion) this.receivedPreviewLoading.set(false); }
  }
  selectReceivedCost(id: number): void {
    const preview = this.receivedPreview();
    if (preview?.existingCandidates.some(cost => cost.id === id)) void this.selectReceivedInvoice(preview.document, id);
  }
  receivedAmount(document: ReceivedOdooInvoice): string {
    try { return new Intl.NumberFormat('nl-BE', { style: 'currency', currency: document.currency || 'EUR' }).format(document.total); }
    catch { return `${document.total.toFixed(2)} ${document.currency || ''}`; }
  }
  newBookingDifference(match: BankMatch): number | null {
    const bank = this.selected();
    return bank && !match.existingPaymentId && bankAmountsMatch(bank.amountEur, Math.sign(bank.amountEur) * match.openEur)
      ? bankAmountDifference(bank.amountEur, Math.sign(bank.amountEur) * match.openEur) : null;
  }
  async linkReceivedInvoice(): Promise<void> {
    const bank = this.selected(), preview = this.receivedPreview();
    if (!bank || !preview || !this.canLinkReceived()) return;
    const costId = this.receivedExistingCostId();
    await this.run(async () => {
      const result = await this.api.linkReceivedOdooInvoice(bank.id, { odooInvoiceId: preview.document.id, snapshotHash: preview.snapshotHash, ...(costId ? { existingCompanyCostId: costId } : {}) });
      this.state.bankStatements.update(lines => [result.line, ...lines.filter(row => row.id !== result.line.id)]);
      ++this.allocationVersion; this.selected.set(null); this.receivedPreview.set(null);
      this.ui.toast(result.alreadyRegistered ? 'Ontvangen factuur gekoppeld' : 'Ontvangen factuur geregistreerd en gekoppeld', 'ok', { label: 'Bekijken', run: () => this.state.inspectItem({ kind: 'cost', id: result.companyCostId }) });
      await this.state.refreshBank(); await this.state.reload(['costs', 'payments', 'attachments']);
    });
  }
  private allocationVersion = 0;
  private readonly invoiceMap = computed(() => new Map(this.state.salesOrders().map(view => [view.order.id, view])));
  private readonly customerNames = computed(() => new Map(this.state.customers().map(customer => [customer.id, customer.company])));
  private readonly paymentMap = computed(() => {
    const payments = this.state.salesOrders().flatMap(view => view.paymentSummary?.payments ?? []);
    return new Map<number, SalesPayment>([...payments, ...this.state.incomingPayments()].map(payment => [payment.id, payment]));
  });
  readonly ledgerAccounts = computed(() => this.state.accountOptions().map(account => account.key));
  readonly invalidPeriod = computed(() => !!this.from() && !!this.to() && this.from() > this.to());
  readonly hasFilters = computed(() => !!this.search().trim() || this.directionFilter() !== 'ALL' || this.linkFilter() !== 'ALL' || !!this.from() || !!this.to());
  readonly filteredLines = computed(() => {
    if (this.invalidPeriod()) return [];
    const search = this.search().trim();
    return this.state.bankStatements().filter(row => {
      if (!this.showHistorical() && !this.state.officialBankLine(row)) return false;
      if (this.state.archivedBankLine(row) && !this.accountFilter()) return false;
      const day = paymentLocalDay({ receivedAt: row.bookedAt, timeZone: row.timeZone });
      const invoice = row.salesOrderId ? this.invoiceMap().get(row.salesOrderId) : null;
      /* Every term: the counterparty, the reference, the account (key and label), a linked target, or the amount (§3.4). */
      const matches = !search || bankSearchMatches(row, search, [row.account, this.accountName(row.account), invoice?.order.number,
        invoice ? this.customerName(invoice.order.customerId) : '', ...this.linkedDocuments(row).map(document => document.label)]);
      const link = this.linkFilter();
      return (!this.accountFilter() || this.state.canonicalAccount(row.account) === this.state.canonicalAccount(this.accountFilter()))
        && (this.directionFilter() === 'ALL' || (this.directionFilter() === 'INCOMING' ? row.amountEur > 0 : row.amountEur < 0))
        && (link === 'ALL' || (link === 'LINKED' ? this.allocated(row) : link === 'UNLINKED' ? !this.allocated(row)
          : !this.allocated(row)))
        && (!this.from() || day >= this.from()) && (!this.to() || day <= this.to()) && matches;
    }).sort((left, right) => Date.parse(right.bookedAt) - Date.parse(left.bookedAt) || right.id - left.id);
  });
  readonly visibleLines = computed(() => this.filteredLines().slice(0, this.compact() ? 12 : this.shown()));
  /** The desk row Tab lands on (roving tabindex): the keyboard's row, else the first. */
  readonly tabStopId = computed(() => {
    const rows = this.visibleLines();
    return rows.find(row => row.id === this.focusId())?.id ?? rows[0]?.id ?? null;
  });
  /** The phone list, one section per local bank day. */
  readonly dayGroups = computed(() => {
    const groups: { day: string; label: string; rows: BankStatementLine[] }[] = [];
    for (const row of this.visibleLines()) {
      const day = paymentLocalDay({ receivedAt: row.bookedAt, timeZone: row.timeZone });
      const last = groups[groups.length - 1];
      if (last?.day === day) last.rows.push(row);
      else groups.push({ day, label: this.dayLabel(day), rows: [row] });
    }
    return groups;
  });
  readonly unlinkedCount = computed(() => this.state.bankStatements().filter(row => this.state.officialBankLine(row) && !this.state.archivedBankLine(row) && this.onSelectedAccount(row) && !this.allocated(row)).length);
  /** "In € x · Uit € y" over the filtered rows; internal transfers left out (and said so). */
  readonly totals = computed(() => {
    const totals = selectionTotals(this.filteredLines().filter(row => this.state.officialBankLine(row)));
    return { incoming: totals.inEur, outgoing: totals.outEur, net: totals.netEur, internal: totals.internal };
  });
  readonly existingMatches = computed<BankMatch[]>(() => {
    const row = this.selected(); if (!row) return [];
    const linked = new Set(this.state.bankStatements().map(line => line.salesPaymentId));
    return [...this.paymentMap().values()].filter(payment => {
      const invoice = this.invoiceMap().get(payment.salesOrderId);
      /* A verrekening is no bank movement: it never matches a line. */
      if (payment.offsetPaymentId != null) return false;
      // The selected bank movement supplies the account; old receipts may only carry a label such as KBC.
      return !!invoice && this.active(invoice) && !linked.has(payment.id)
        && bankAmountsMatch(payment.amountEur, row.amountEur);
    }).sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt) || right.id - left.id)
      .map(payment => ({ salesOrderId: payment.salesOrderId, number: this.invoiceNumber(payment.salesOrderId),
        existingPaymentId: payment.id, openEur: this.available(this.invoiceMap().get(payment.salesOrderId)!), score: 0,
        reason: 'Bestaande betaling koppelen', receivedAt: payment.receivedAt, reference: payment.reference }));
  });
  readonly selectableInvoices = computed(() => this.state.salesOrders().filter(view => this.active(view)
    && (this.canCreateOn(view) || this.existingMatches().some(match => match.salesOrderId === view.order.id))));
  readonly visibleExistingSales = computed(() => {
    const words = this.outgoingSearch().trim().toLocaleLowerCase('nl-BE').split(/\s+/).filter(Boolean);
    return this.existingMatches().filter(match => words.every(word => [match.number, match.reference, this.matchStamp(match), this.existingSalesAmount(match).toFixed(2), this.existingSalesAmount(match).toFixed(2).replace('.', ',')].join(' ').toLocaleLowerCase('nl-BE').includes(word)));
  });
  existingSalesAmount(match: BankMatch): number { return match.existingPaymentId ? this.paymentMap().get(match.existingPaymentId)?.amountEur ?? 0 : 0; }
  toggleExistingPayment(payment: OutgoingMatch): void {
    if (this.busy()) return;
    this.choice.set(null); this.allocationMode.set('expense'); this.toggleOutgoing(payment);
  }
  readonly manualMatches = computed(() => this.existingMatches().filter(match => match.salesOrderId === this.manualInvoice()));
  readonly manualNewMatch = computed<BankMatch | null>(() => {
    const view = this.invoiceMap().get(this.manualInvoice());
    return view && this.canCreateOn(view) ? { salesOrderId: view.order.id, number: view.order.number,
      existingPaymentId: null, openEur: this.available(view), score: 0, reason: 'Nieuwe boeking', receivedAt: null, reference: null } : null;
  });
  readonly chosenInvoiceHasExistingMatches = computed(() => this.existingMatches().some(match => match.salesOrderId === this.choice()?.salesOrderId)
    || this.matches().some(match => !!match.existingPaymentId && match.salesOrderId === this.choice()?.salesOrderId));
  matchDifference(match: BankMatch): number | null {
    const bank = this.selected();
    const payment = match.existingPaymentId ? this.paymentMap().get(match.existingPaymentId) : null;
    return bank && payment ? bankAmountDifference(bank.amountEur, payment.amountEur) : null;
  }
  readonly canAllocate = computed(() => !!this.selected() && !!this.choice() && !this.busy() && !this.matchingLoading()
    && (!this.choice()?.existingPaymentId || this.matchDifference(this.choice()!) === null || Math.abs(Math.round(this.matchDifference(this.choice()!)! * 100)) <= 2)
    && (!!this.choice()?.existingPaymentId || !this.chosenInvoiceHasExistingMatches() || this.newBookingConfirmed()));

  stamp(at: string, timeZone: string): string { return paymentMomentLabel({ receivedAt: at, timeZone }); }
  invoiceNumber(id: number): string { return this.invoiceMap().get(id)?.order.number || `Factuur #${id}`; }
  customerName(id: number | null): string { return id == null ? '' : this.customerNames().get(id) ?? ''; }
  available(view: SalesOrderView): number { return this.selected()?.amountEur && this.selected()!.amountEur < 0 ? view.paymentSummary?.refundableEur ?? 0 : view.paymentSummary?.remainingEur ?? 0; }
  /** Invoices always; a credit note only for money going out (its refund). */
  private active(view: SalesOrderView): boolean {
    if (inactive.has(view.order.status)) return false;
    if (view.order.docType === 'CREDITNOTA') return (this.selected()?.amountEur ?? 0) < 0;
    return view.order.docType === 'FACTUUR';
  }
  isCreditNote(id: number): boolean { return this.invoiceMap().get(id)?.order.docType === 'CREDITNOTA'; }
  private canCreateOn(view: SalesOrderView): boolean {
    const row = this.selected(); if (!row || !this.active(view)) return false;
    return row.amountEur < 0 ? cents(view.paymentSummary?.refundableEur ?? 0) + 2 >= -cents(row.amountEur)
      : (view.paymentSummary?.invoiceTotalEur ?? view.priced?.totals?.totalInclVat ?? 0) > 0;
  }
  matchKey(match: BankMatch): string { return `${match.salesOrderId}:${match.existingPaymentId ?? 'new'}`; }
  isChosen(match: BankMatch): boolean { const choice = this.choice(); return !!choice && this.matchKey(choice) === this.matchKey(match); }
  matchStamp(match: BankMatch): string { return this.stamp(match.receivedAt ?? '', (match.existingPaymentId ? this.paymentMap().get(match.existingPaymentId)?.timeZone : null) || this.selected()?.timeZone || 'Europe/Brussels'); }
  onSelectedAccount(row: BankStatementLine): boolean { return !this.accountFilter() || this.state.canonicalAccount(row.account) === this.state.canonicalAccount(this.accountFilter()); }
  clearFilters(): void { this.search.set(''); this.directionFilter.set('ALL'); this.linkFilter.set('ALL'); this.from.set(''); this.to.set(''); this.shown.set(12); }
  accountName(account: string): string { return this.state.accountLabel(bankAccountKey(account)) || account; }
  abs(amount: number): number { return Math.abs(amount); }
  imported(row: BankStatementLine): boolean { return row.source === 'ODOO'; }
  allocated(row: BankStatementLine): boolean { return row.allocated === true || row.salesPaymentId != null; }
  canRemove(row: BankStatementLine): boolean { return !this.imported(row) && !this.allocated(row); }
  movementStamp(row: BankStatementLine): string {
    if (!this.imported(row)) return this.stamp(row.bookedAt, row.timeZone);
    const day = paymentLocalDay({ receivedAt: row.bookedAt, timeZone: row.timeZone });
    return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
  }
  clock(row: BankStatementLine): string {
    if (this.imported(row)) return 'Tijdstip niet beschikbaar';
    try { return new Intl.DateTimeFormat('nl-BE', { hour: '2-digit', minute: '2-digit', timeZone: row.timeZone || 'Europe/Brussels' }).format(new Date(row.bookedAt)); }
    catch { return ''; }
  }
  point(event: MouseEvent): { x: number; y: number } { const rect = (event.currentTarget as HTMLElement).getBoundingClientRect(); return { x: rect.left, y: rect.bottom + 6 }; }
  /** 'Details': when and by whom the line was recorded, and when and how it was linked to an invoice. */
  record(row: BankStatementLine): string {
    const recorded = `${!this.state.officialBankLine(row) ? 'Historische registratie · telt niet mee in het banksaldo · ' : ''}${this.imported(row) ? 'Opgehaald uit Odoo' : 'Geregistreerd'} ${this.stamp(row.recordedAt, row.timeZone)}${row.actor ? ` · ${row.actor}` : ''}`
      + (this.imported(row) ? ' · Odoo levert de boekingsdatum, zonder tijdstip' : '');
    if (this.allocated(row) && !row.salesPaymentId) return `${recorded} · ${row.allocationLabel || 'Gekoppeld aan een uitgave'}`;
    if (!row.allocatedAt) return recorded;
    return `${recorded} · Gekoppeld ${this.stamp(row.allocatedAt, row.timeZone)} · ${row.allocationCreatedPayment ? 'factuurbetaling bij koppelen aangemaakt' : 'bestaande factuurbetaling gekoppeld'}`;
  }
  /** 'Vandaag · wo 15 okt', 'Gisteren · di 14 okt', 'ma 13 okt'. */
  private dayLabel(day: string): string {
    const today = paymentLocalDay({ receivedAt: new Date().toISOString(), timeZone: 'Europe/Brussels' });
    const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
    const date = WEEKDAY.format(new Date(`${day}T12:00:00Z`)).replace(/\./g, '');
    return diff === 0 ? `Vandaag · ${date}` : diff === 1 ? `Gisteren · ${date}` : date;
  }

  /** Resolve saved relationships, never similarity of amounts or supplier names. */
  private readonly documentLinks = computed(() => {
    const links = new Map<number, LinkedDocument[]>();
    const add = (lineId: number | null | undefined, target: LinkedDocument): void => {
      if (lineId == null) return;
      const targets = links.get(lineId) ?? [];
      if (!targets.some(item => item.kind === target.kind && item.id === target.id)) targets.push(target);
      links.set(lineId, targets);
    };
    for (const cost of this.state.costs()) {
      if (!cost.id) continue;
      const target: LinkedDocument = { kind: 'cost', id: cost.id, label: `Kost · ${cost.reference || cost.description || '#' + cost.id}` };
      add(cost.bankStatementLineId, target);
      for (const payment of cost.payments ?? []) add(payment.bankStatementLineId, target);
    }
    // A line that carries several payees of one container names what it paid: 'Goederen + inspectie (PO-2026-021)'.
    const parts = new Map<string, PurchasePaymentRow[]>();
    for (const payment of this.state.payments()) {
      if (payment.bankStatementLineId == null) continue;
      const key = `${payment.bankStatementLineId}:${payment.orderId}`;
      parts.set(key, [...(parts.get(key) ?? []), payment]);
    }
    for (const payment of this.state.payments()) add(payment.bankStatementLineId,
      { kind: 'container', id: payment.orderId, label: containerLinkLabel(parts.get(`${payment.bankStatementLineId}:${payment.orderId}`) ?? [payment]) });
    return links;
  });
  linkedDocuments(row: BankStatementLine): LinkedDocument[] {
    if (row.salesOrderId) return [{ kind: 'invoice', id: row.salesOrderId, label: `${row.amountEur < 0 ? 'Terugbetaling' : 'Factuur'} · ${this.invoiceNumber(row.salesOrderId)}` }];
    const saved = row.allocated === false ? [] : this.documentLinks().get(row.id) ?? [];
    if (saved.length || this.imported(row)) return saved;
    // Older manual registrations predate hard links; every referenced document stays reachable.
    const targets: LinkedDocument[] = [];
    for (const marker of this.state.lineMarkers().get(row.id) ?? []) {
      const cost = marker.kind === 'kost' ? this.state.costs().find(cost => cost.id === marker.id)
        : marker.kind === 'kostbetaling' ? this.state.costs().find(cost => cost.payments?.some(payment => payment.id === marker.id)) : null;
      const payment = marker.kind === 'containerbetaling' ? this.state.payments().find(payment => payment.id === marker.id) : null;
      const target: LinkedDocument | null = cost?.id ? { kind: 'cost', id: cost.id, label: `Kost · ${cost.reference || cost.description}` }
        : payment ? { kind: 'container', id: payment.orderId, label: `Inkoop · ${payment.orderNumber || '#' + payment.orderId}` } : null;
      if (target && !targets.some(item => item.kind === target.kind && item.id === target.id)) targets.push(target);
    }
    return targets;
  }
  linkedLabel(row: BankStatementLine): string {
    const documents = this.linkedDocuments(row);
    // One transfer for several containers (owner addition 2026-10-15): 'Inkoop · 3 containers (PO-…, PO-…, PO-…)'.
    if (documents.length > 1 && documents.every(document => document.kind === 'container')) {
      const numbers = documents.map(document => { const payment = this.state.payments().find(item => item.orderId === document.id);
        return payment?.orderNumber || payment?.orderAlias || '#' + document.id; }).sort((a, b) => a.localeCompare(b, 'nl', { numeric: true }));
      return `Inkoop · ${documents.length} containers (${numbers.join(', ')})`;
    }
    return documents.length > 1 ? `${documents.length} gekoppelde documenten` : documents[0]?.label || 'Gekoppeld document bekijken';
  }
  /** A row opens its transaction (detail on the desk, sheet on the phone); it never jumps away. */
  openLine(row: BankStatementLine): void {
    this.focusId.set(row.id);
    this.state.openLine(row.id);
  }
  private openDocument(document: LinkedDocument): void {
    if (document.kind === 'invoice') this.state.openInvoice(document.id);
    else this.state.inspectItem({ kind: document.kind, id: document.id });
  }
  private destroyed = false;
  ngOnDestroy(): void { this.destroyed = true; }
  async openLinked(row: BankStatementLine): Promise<void> {
    if (this.busy() || this.openingId() !== null) return;
    this.focusId.set(row.id);
    const account = this.accountFilter();
    let documents = this.linkedDocuments(row);
    if (!documents.length || this.state.sourceErrors(['costs', 'payments', 'orders', 'statements']).length) {
      this.openingId.set(row.id);
      try {
        await this.state.reload(['costs', 'payments', 'orders', 'statements']);
        if (this.destroyed || account !== this.accountFilter() || this.focusId() !== row.id) return;
        if (this.state.sourceErrors(['costs', 'payments', 'orders', 'statements']).length) {
          this.ui.toast('Het gekoppelde document kon niet geladen worden. Probeer opnieuw.', 'err'); return;
        }
        const current = this.state.bankStatements().find(line => line.id === row.id);
        if (!current || (this.allocated(row) && !this.allocated(current))) {
          this.ui.toast('Deze transactie is niet meer gekoppeld. Het overzicht is bijgewerkt.'); return;
        }
        documents = this.linkedDocuments(current);
      } finally { this.openingId.set(null); }
    }
    if (documents.length === 1) { this.openDocument(documents[0]); return; }
    if (documents.length > 1) {
      this.state.openMenu({ title: 'Gekoppelde documenten', anchor: null, cancelLabel: 'Annuleren',
        items: documents.map(document => ({ id: `${document.kind}:${document.id}`, label: document.label, iconName: 'document' })),
        pick: id => { const target = documents.find(document => `${document.kind}:${document.id}` === id); if (target) this.openDocument(target); } });
      return;
    }
    this.ui.toast('De koppeling bestaat, maar het document is niet beschikbaar. Vernieuw het overzicht en probeer opnieuw.', 'err');
  }

  /** Quick phone filters: all, one direction, or transactions still to link. */
  setChip(value: DirectionFilter | 'UNLINKED_IN'): void {
    this.shown.set(12);
    if (value === 'UNLINKED_IN') { this.directionFilter.set('ALL'); this.linkFilter.set('UNLINKED_IN'); return; }
    this.directionFilter.set(value); this.linkFilter.set('ALL');
  }
  accountMenu(): void {
    this.state.openMenu({ title: 'Rekening', anchor: null, cancelLabel: 'Annuleren',
      items: [{ id: '', label: 'Alle rekeningen', checked: !this.accountFilter() }, ...this.state.accountOptions().map(option => ({ id: option.key, label: option.label, checked: option.key === this.accountFilter() }))],
      pick: id => { this.accountFilter.set(id); this.shown.set(12); } });
  }
  /** Secondary actions stay behind the explicit more button or context menu (§3.4). */
  lineMenu(row: BankStatementLine, anchor: { x: number; y: number } | null): void {
    this.focusId.set(row.id);
    const documents = this.linkedDocuments(row);
    const linked = this.allocated(row);
    const items = [
      { id: 'open', label: 'Openen', iconName: 'eye' },
      ...(!linked ? [{ id: 'link', label: 'Koppelen…', iconName: 'link' }, { id: 'split', label: 'Splitsen…', iconName: 'list' },
        { id: 'book', label: 'Boeken als…', iconName: 'tag' }] : []),
      ...(linked && !row.classification ? [{ id: 'unlink', label: 'Koppeling losmaken', iconName: 'unlink' }] : []),
      ...(row.classification ? [{ id: 'unbook', label: 'Boeken als ongedaan maken', iconName: 'restore' }] : []),
      ...(!row.classification && (linked || documents.length) ? [{ id: 'document', label: documents.length > 1 ? 'Gekoppelde documenten openen' : 'Gekoppeld document openen', iconName: 'document' }] : []),
      ...(this.canRemove(row) ? [{ id: 'withdraw', label: 'Intrekken', iconName: 'trash', danger: true, divider: true }] : []),
    ];
    this.state.openMenu({ title: `${row.counterparty || row.reference || 'Banktransactie'} · ${euro.format(row.amountEur)}`, anchor, cancelLabel: anchor ? '' : 'Annuleren', items,
      pick: id => {
        if (id === 'open' || id === 'link' || id === 'split') this.openLine(row);
        else if (id === 'book') this.state.bookAsLine.set(row);
        else if (id === 'unlink') this.state.unlinkLine(row);
        else if (id === 'unbook') void this.state.unclassifyLine(row);
        else if (id === 'document') void this.openLinked(row);
        else if (id === 'withdraw') this.remove(row);
      } });
  }

  /* ---- a row of Transacties: status, Koppeling, action and Saldo (§3.4) */

  suggestionOf(row: BankStatementLine): LineSuggestion | undefined {
    return this.allocated(row) || row.classification ? undefined : this.state.suggestions().get(row.id);
  }
  /** "Netto − € 69.595,06": the sign before the euro, as the amounts of the rows. */
  netText(value: number): string { return signedEur(value); }
  statusLabel(row: BankStatementLine): string {
    if (row.classification) return CLASSIFICATION_LABEL[row.classification];
    const status = lineStatus(row, this.suggestionOf(row));
    return status === 'LINKED' ? 'Gekoppeld' : status === 'SUGGESTED' ? 'Suggestie' : 'Te koppelen';
  }
  statusTone(row: BankStatementLine): string {
    const status = lineStatus(row, this.suggestionOf(row));
    return status === 'LINKED' || status === 'BOOKED' ? 'tone-ok' : status === 'SUGGESTED' ? 'tone-accent' : 'tone-warn';
  }
  /**
   * The row's one button: Koppelen when the best match changes nothing but
   * the date (and no second candidate comes close), Bekijken when it changes
   * an amount or another candidate is close, Boeken for a cost pattern.
   */
  actionOf(row: BankStatementLine): { label: 'Koppelen' | 'Bekijken' | 'Boeken'; kind: 'link' | 'open' | 'book' } | null {
    const suggestion = this.suggestionOf(row);
    if (!suggestion) return null;
    if (suggestion.target.kind === 'cost-pattern') return { label: 'Boeken', kind: 'book' };
    const rival = suggestion.others.some(other => other.score >= 50);
    return suggestion.changesAmount || rival ? { label: 'Bekijken', kind: 'open' } : { label: 'Koppelen', kind: 'link' };
  }
  runAction(row: BankStatementLine): void {
    const suggestion = this.suggestionOf(row), action = this.actionOf(row);
    if (!suggestion || !action) { this.openLine(row); return; }
    if (suggestion.target.kind === 'cost-pattern') { this.bookPattern(row, suggestion.target.costId); return; }
    if (action.kind === 'open') { this.openLine(row); return; }
    void this.state.linkLine(row, suggestion.target);
  }
  /** "Boeken" on a cost pattern: the cost registration starts from the latest cost of that pattern. */
  bookPattern(row: BankStatementLine, costId: number): void {
    const cost = this.state.costs().find(item => item.id === costId);
    if (!cost) { this.state.openCostFromBank(row); return; }
    const gross = Math.abs(row.amountEur), vat = cost.vatPct ?? 0;
    this.state.openCostFromBank(row, { category: cost.category, description: cost.description, party: cost.party || row.counterparty || null,
      vatPct: cost.vatPct, vatRegime: cost.vatRegime, vatRegimeConfirmed: !!cost.vatRegime, supplierCountry: cost.supplierCountry, costKind: cost.costKind,
      expenseType: cost.expenseType, vatDeductiblePct: cost.vatDeductiblePct, taxDeductiblePct: cost.taxDeductiblePct, salesChannel: cost.salesChannel,
      amountInclEur: gross, amountExclEur: Math.round(gross / (1 + vat / 100) * 100) / 100 });
  }
  /** What the Koppeling cell says: the booking, the linked target, the suggestion with its reasons, or that nothing was found. */
  koppeling(row: BankStatementLine): Koppeling | null {
    if (row.classification) {
      const label = CLASSIFICATION_LABEL[row.classification];
      if (row.classification === 'INTERNAL_TRANSFER') {
        const other = row.transferLineId != null ? this.state.bankStatements().find(line => line.id === row.transferLineId) : undefined;
        return { text: label, reasons: [], open: false, sub: other ? `⇄ ${this.accountName(other.account)} · ${legDistance(this.state.lineDay(row), this.state.lineDay(other))}` : 'Andere kant staat niet in Enrosed' };
      }
      return { text: label, reasons: [], open: false, sub: row.classification === 'VAT' ? vatPeriodLabel(row.vatPeriod) || row.classificationNote || null : row.classificationNote || null };
    }
    if (this.allocated(row)) {
      const documents = this.linkedDocuments(row);
      const files = documents.filter(document => document.kind === 'cost').reduce((sum, document) => sum + this.state.attachmentsFor(document.id).length, 0);
      return { text: this.linkedLabel(row) + (files ? ` · 📎 ${files}` : ''), sub: null, reasons: [], open: true };
    }
    const suggestion = this.suggestionOf(row);
    if (suggestion) {
      const target = suggestion.target;
      if (target.kind === 'cost-pattern') return { text: target.label, sub: null, reasons: [], open: false };
      return { text: target.title, sub: null, reasons: suggestion.reasons, open: false };
    }
    const documents = this.linkedDocuments(row);
    if (documents.length) return { text: 'Eerdere registratie', sub: null, reasons: [], open: true };
    return { text: 'Geen factuur gevonden', sub: null, reasons: [], open: false };
  }
  /** "{account} · {reference}"; a manual line starts with its time. */
  subOf(row: BankStatementLine): string {
    return [this.imported(row) ? '' : this.clock(row), this.accountName(row.account), row.counterparty ? row.reference : ''].filter(Boolean).join(' · ');
  }
  /** The saldo after the line: over the active accounts, or the chosen account's own. */
  saldoText(row: BankStatementLine): string {
    const balance = this.state.running().get(`bank:${row.id}`);
    const value = this.accountFilter() ? balance?.accountAfterEur : balance?.totalAfterEur;
    if (value !== null && value !== undefined) return euro.format(value);
    return balance?.unknownBefore ? `Saldo onbekend vóór ${balance.unknownBefore.slice(8, 10)}/${balance.unknownBefore.slice(5, 7)}` : '—';
  }
  /** "Saldo einde dag € x" of a day group (the chosen account, or every active account). */
  dayEndText(day: string): string {
    const value = this.state.dayEndEur(day, this.accountFilter() || null);
    return value === null ? 'Saldo onbekend' : `Saldo einde dag ${euro.format(value)}`;
  }
  accountTone(account: string): string {
    const index = this.state.accountOptions().findIndex(option => option.key === this.state.canonicalAccount(account));
    return ACCOUNT_TONES[index < 0 ? ACCOUNT_TONES.length - 1 : index % ACCOUNT_TONES.length];
  }
  /** The account chips: every active account (shown with two or more). */
  readonly accountChips = computed(() => this.state.accountOptions());
  /** Payments marked paid without a transaction, and receipts on an Odoo account no line carries. */
  readonly unbankedCount = computed(() => this.state.unbanked().length + this.state.pendingReceipts().length);
  emptyTitle(): string {
    if (!this.state.bankStatements().length) return 'Nog geen banktransacties';
    const amount = this.search().trim().split(/\s+/).length === 1 ? this.search().trim() : '';
    return this.from() && this.to() && amount && /^-?[\d.,]+$/.test(amount)
      ? `Geen transactie van € ${amount.replace(/^-/, '')} tussen ${this.dayMon(this.from())} en ${this.dayMon(this.to())}.` : 'Geen transacties gevonden';
  }
  emptyText(): string {
    return this.state.bankStatements().length ? 'Pas je zoekopdracht of filters aan.' : 'Haal je transacties op uit Odoo, of noteer ze met Transactie noteren.';
  }
  /** "Ruimer zoeken" after "Transactie zoeken": the same search without the dates. */
  readonly widerSearch = computed(() => !!this.search().trim() && (!!this.from() || !!this.to()));
  searchWider(): void { this.from.set(''); this.to.set(''); }
  clearSearched(): void {
    this.state.searchedFrom.set(null);
    this.search.set(''); this.from.set(''); this.to.set(''); this.directionFilter.set('ALL');
  }
  private dayMon(day: string): string {
    const months = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
    return `${Number(day.slice(8, 10))} ${months[Number(day.slice(5, 7)) - 1]}`;
  }

  /**
   * The desk keyboard: arrows move; Enter opens the transaction; L links the
   * best match (the row button's rule); S splits and C books (in the detail);
   * U unlinks; O opens the linked document; Delete withdraws a manual line.
   */
  handle(command: string): boolean {
    const rows = this.visibleLines();
    /* With a transaction in the detail, J / K step the detail and S / C / U / O / L act on the transaction it shows, not on the list's focus. */
    const shownId = this.state.location().line;
    const shown = shownId != null ? this.state.bankStatements().find(line => line.id === shownId) ?? null : null;
    const shownIndex = shown ? rows.findIndex(row => row.id === shown.id) : -1;
    const focusIndex = rows.findIndex(row => row.id === this.focusId());
    const focused = focusIndex >= 0 ? rows[focusIndex] : null;
    if (command === 'up' || command === 'down') {
      if (!rows.length) return false;
      const index = shownIndex >= 0 ? shownIndex : focusIndex;
      const next = rows[index < 0 ? (command === 'down' ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, index + (command === 'down' ? 1 : -1)))];
      this.focusId.set(next.id);
      if (shownIndex >= 0 && next.id !== shownId) this.state.go({ line: next.id });
      const element = document.querySelector<HTMLElement>(`[data-key="line:${next.id}"]`);
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ block: 'nearest' });
      return true;
    }
    const row = shown && ['split', 'book-as', 'unlink', 'open-linked', 'link'].includes(command) ? shown : focused;
    if (!row) return false;
    if (command === 'open' || command === 'split') { this.openLine(row); return true; }
    if (command === 'link') { if (this.allocated(row)) this.openLine(row); else this.runAction(row); return true; }
    if (command === 'book-as' && !this.allocated(row)) { this.state.bookAsLine.set(row); return true; }
    if (command === 'unlink' && this.allocated(row)) { if (row.classification) void this.state.unclassifyLine(row); else this.state.unlinkLine(row); return true; }
    if (command === 'open-linked' && (this.allocated(row) || this.linkedDocuments(row).length)) { void this.openLinked(row); return true; }
    if (command === 'delete' && this.canRemove(row)) { this.remove(row); return true; }
    if (command === 'escape') { this.focusId.set(null); return true; }
    return false;
  }

  add(): void {
    if (this.busy()) return;
    this.closeAllocation();
    this.state.openMovement({ accountKey: this.accountFilter() || undefined });
  }
  async openAllocation(row: BankStatementLine): Promise<void> {
    if (this.busy() || this.allocated(row)) return;
    this.receivedInvoices.set([]); this.receivedLoaded.set(false); this.receivedLoading.set(false); this.receivedHasMore.set(false); this.receivedSearch.set(''); this.receivedError.set(''); this.receivedPreview.set(null); this.receivedSelectedId.set(null); this.receivedPreviewLoading.set(false); this.receivedExistingCostId.set(null); ++this.receivedPreviewVersion;
    this.allocationMode.set(row.amountEur < 0 ? 'expense' : 'sales');
    this.allocationStep.set('documents'); this.localSearch.set(''); this.localKind.set('all'); this.localShown.set(60); this.localSelectedKey.set(null); this.localNewConfirmed.set(false); this.localLoading.set(false); this.localError.set('');
    this.outgoingSearch.set(''); this.outgoingSelected.set([]); this.outgoingSurplus.set(null); this.outgoingForeignInput.set('');
    const version = ++this.allocationVersion;
    this.selected.set(row); this.choice.set(null); this.manualInvoice.set(0); this.matches.set([]); this.newBookingConfirmed.set(false); this.error.set(''); this.matchingLoading.set(true);
    void this.loadLocalDocuments();
    try {
      const matches = await this.api.suggestions(row.id);
      if (version !== this.allocationVersion || this.selected()?.id !== row.id) return;
      this.matches.set(matches.filter(match => !!match.existingPaymentId || (row.amountEur < 0
        ? cents(match.openEur) + 2 >= -cents(row.amountEur)
        : this.invoiceMap().has(match.salesOrderId) ? this.canCreateOn(this.invoiceMap().get(match.salesOrderId)!) : match.openEur > 0)));
    } catch (failure) { if (version === this.allocationVersion && this.selected()?.id === row.id && row.amountEur > 0) this.error.set(messageOf(failure, 'Suggesties laden mislukt. Je kunt hieronder zelf een factuur kiezen.')); }
    finally { if (version === this.allocationVersion) this.matchingLoading.set(false); }
  }
  closeAllocation(): void {
    if (this.busy()) return;
    ++this.allocationVersion; this.matchingLoading.set(false); this.selected.set(null); this.choice.set(null); this.matches.set([]); this.manualInvoice.set(0); this.error.set('');
  }
  chooseInvoice(id: number): void { if (this.busy()) return; this.manualInvoice.set(id); this.choice.set(null); this.newBookingConfirmed.set(false); }
  chooseMatch(match: BankMatch, fromInvoice = false): void { if (this.busy()) return; if (!fromInvoice) this.manualInvoice.set(0); this.choice.set(match); this.newBookingConfirmed.set(false); }
  async allocate(): Promise<void> {
    const row = this.selected(), match = this.choice(); if (!row || !match || !this.canAllocate()) return;
    await this.run(async () => {
      const saved = await this.api.allocate(row.id, match.salesOrderId, match.existingPaymentId);
      this.state.bankStatements.update(rows => rows.map(line => line.id === saved.id ? saved : line));
      ++this.allocationVersion; this.selected.set(null); this.choice.set(null);
      this.ui.toast(`Bankbeweging gekoppeld aan ${match.number}`);
      await this.state.refreshBank();
    });
  }
  unlink(row: BankStatementLine): void {
    if (this.busy() || !this.allocated(row)) return;
    if (!row.salesPaymentId) {
      this.ui.confirm({ title: 'Koppeling losmaken',
        message: `${escapeHtml(row.counterparty || row.reference || 'Bankbeweging')} · ${euro.format(row.amountEur)}. De betaling op je uitgave blijft bewaard. Alleen de koppeling met deze banktransactie verdwijnt.`,
        confirmLabel: 'Koppeling losmaken', danger: true },
        () => this.run(async () => { await this.api.unlinkPayments(row.id); await this.state.refreshBank(); await this.state.reload(['costs', 'payments']); }));
      return;
    }
    this.ui.confirm({ title: 'Koppeling losmaken', message: `${escapeHtml(row.counterparty || row.reference || 'Bankbeweging')} · ${euro.format(row.amountEur)}. `
      + (row.allocationCreatedPayment ? 'De vanuit deze bankbeweging aangemaakte factuurbetaling wordt ingetrokken. De bankbeweging zelf blijft bewaard.' : 'De bestaande factuurbetaling blijft bewaard; alleen de koppeling met deze bankbeweging verdwijnt.'),
      confirmLabel: 'Koppeling losmaken', danger: true }, () => this.run(async () => { await this.api.unallocate(row.id); await this.state.refreshBank(); }));
  }
  remove(row: BankStatementLine): void {
    if (this.busy() || !this.canRemove(row)) return;
    const what = [row.account, euro.format(row.amountEur), row.counterparty, row.reference || 'Geen referentie'].filter(Boolean).map(part => escapeHtml(part)).join(' · ');
    this.ui.confirm({ title: 'Transactie intrekken', message: `${what}. Ze telt niet meer mee in het saldo. Het logboek houdt de wijziging bij.`, confirmLabel: 'Intrekken', danger: true },
      () => this.run(async () => { await this.api.delete(row.id); this.state.bankStatements.update(rows => rows.filter(line => line.id !== row.id)); await this.state.refreshBank(); }));
  }
  private async run(work: () => Promise<unknown>): Promise<void> { if (this.busy()) return; this.busy.set(true); this.error.set(''); try { await work(); } catch (failure) { this.error.set(messageOf(failure, 'Bankbewerking mislukt')); } finally { this.busy.set(false); } }
}

/** 'Inkoop · PO-2026-021', or for a line that paid several payees of the container 'Goederen + zeevracht + inspectie (PO-2026-021)'. */
export function containerLinkLabel(payments: readonly PurchasePaymentRow[]): string {
  const first = payments[0];
  const number = first?.orderNumber || first?.orderAlias || '#' + first?.orderId;
  const payees = PAYEE_SEQUENCE.filter(payee => payments.some(payment => (payment.payee ?? 'SUPPLIER') === payee));
  if (payees.length < 2) return `Inkoop · ${number}`;
  const words = payees.map(payee => payee === 'SUPPLIER' && payments.some(payment => (payment.payee ?? 'SUPPLIER') === 'SUPPLIER' && payment.instalmentDue === 'FREIGHT')
    ? PAYEE_PART.SUPPLIER + ' + zeevracht' : PAYEE_PART[payee]).join(' + ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} (${number})`;
}
