import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { BankingApi, BankMatch, BankStatementLine, ReceivedOdooInvoice, ReceivedOdooInvoicePreview } from '../../core/api/banking-api';
import type { Currency, Payee, PurchaseDocument, PurchasePaymentRow, SalesOrderView, SalesPayment } from '../../core/api/models';
import { messageOf } from '../../core/api/errors';
import { SourcingApi } from '../../core/api/sourcing-api';
import { saveBlob } from '../../core/api/download';
import { bankAmountsMatch, bankAmountDifference } from '../../shared/bank-transaction-options';
import { Icon } from '../../shared/icon';
import { MenuTrigger } from '../../shared/menu-trigger';
import { EurPipe } from '../../shared/pipes';
import { Ui, escapeHtml } from '../../shared/ui';
import { FinanceState } from './finance-state';
import { bankAccountKey } from './bank-reconciliation';
import { paymentLocalDay, paymentMomentLabel } from './incoming-money';
import { cashTotalOf, openOf } from './finance-metrics';
import { containerPayables } from './payables';
import { bankAllocationTargets, filterBankAllocationTargets, type BankAllocationTarget } from './bank-allocation-targets';
import { bankTransactionDay } from '../../shared/bank-transaction-options';
import { parsePurchasePaymentAmount } from '../purchasing/purchase-payment-amount';
import { invoiceLine, invoiceTermsLine, paymentRoundOnServer } from '../purchasing/purchase-invoices';
import { splitTransfer } from '../purchasing/purchase-transfer-split';

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
  imports: [EurPipe, Icon, MenuTrigger],
  styleUrl: './bank-movement-panel.scss',
  template: `
    @if (historicalCount()) {
      <details class="bank-history"><summary>Eerdere registraties · {{ historicalCount() }}</summary>
        <p class="fin-hint">Deze handmatige registraties blijven bewaard. Ze tellen niet mee in het saldo van je Odoo-rekening.</p>
        <button class="fin-inline-btn" type="button" (click)="showHistorical.set(!showHistorical())">{{ showHistorical() ? 'Historische registraties verbergen' : 'Historische registraties tonen' }}</button>
      </details>
    }
    @if (error() && !selected()) { <p class="fin-error" role="alert">{{ error() }}</p> }
    @if (state.desk()) {
      @if (filteredLines().length) {
        <div class="wk-table fin-table fin-table--moves" role="grid" aria-label="Bankbewegingen">
          <div class="wk-thead" role="row">
            <span class="wk-th" role="columnheader">Moment</span>
            <span class="wk-th" role="columnheader">Tegenpartij · mededeling</span>
            <span class="wk-th" role="columnheader">Koppeling</span>
            <span class="wk-th wk-th--num" role="columnheader">Bedrag</span>
            <span class="wk-th" role="columnheader"><span class="fin-sr">Acties</span></span>
          </div>
          @for (row of visibleLines(); track row.id) {
            <div class="wk-tr wk-tr--link" role="row" [attr.tabindex]="tabStopId() === row.id ? 0 : -1" [attr.data-key]="'line:' + row.id"
                 [attr.aria-selected]="focusId() === row.id" (focusin)="focusId.set(row.id)" (click)="$event.defaultPrevented || openLine(row)" appMenuTrigger (menuTrigger)="lineMenu(row, $event)">
              <span class="wk-td" role="gridcell" [attr.title]="record(row)">{{ movementStamp(row) }}</span>
              <span class="wk-td" role="gridcell">{{ row.counterparty || row.reference || 'Bankbeweging' }}@if (!state.officialBankLine(row)) { <span class="wk-pill tone-grey">Historische registratie</span> }@if (row.counterparty && row.reference) { <span class="wk-td__sub">{{ row.reference }}</span> }</span>
              <span class="wk-td" role="gridcell">
                @if (allocated(row)) {
                  <button class="wk-link bank-document-link" type="button" [disabled]="openingId() === row.id"
                    (click)="$event.stopPropagation(); openLinked(row)" [attr.title]="linkedLabel(row)">
                    <app-icon name="document" [size]="14" />{{ openingId() === row.id ? 'Laden…' : linkedLabel(row) }} <span aria-hidden="true">›</span>
                  </button>
                } @else {
                  <button class="wk-btn wk-btn--sm fin-link-btn" type="button" [disabled]="busy()" (click)="$event.stopPropagation(); openAllocation(row)"><app-icon name="link" [size]="14" />Koppelen</button>
                  @if (linkedDocuments(row).length) {
                    <button class="wk-link bank-document-link" type="button" (click)="$event.stopPropagation(); openLinked(row)">Eerdere registratie ›</button>
                  }
                }
                @if (row.allocationDifferenceEur) { <span class="wk-td__sub">Verschil {{ row.allocationDifferenceEur | eur }}</span> }
              </span>
              <span class="wk-td wk-td--num" role="gridcell"><b [class.wk-amount--in]="row.amountEur > 0">{{ row.amountEur > 0 ? '+' : '−' }} {{ abs(row.amountEur) | eur }}</b></span>
              <span class="wk-td fin-td-end" role="gridcell">
                <button class="wk-btn wk-btn--ghost wk-btn--icon wk-btn--sm" type="button" [attr.aria-label]="'Meer acties voor ' + (row.counterparty || row.reference || 'banktransactie')" (click)="$event.stopPropagation(); lineMenu(row, point($event))"><app-icon name="more" [size]="16" /></button>
              </span>
            </div>
            @if (detailsId() === row.id) {
              <div class="wk-tr wk-tr--sub" role="row"><span class="wk-td wk-td--wrap fin-record" role="gridcell">{{ record(row) }}</span></div>
            }
          }
        </div>
        @if (visibleLines().length < filteredLines().length) {
          <div class="fin-more"><button class="wk-btn" type="button" (click)="shown.update(more)">Meer tonen · nog {{ filteredLines().length - visibleLines().length }}</button></div>
        }
      } @else {
        <div class="wk-empty"><span class="wk-empty__icon"><app-icon name="bank" [size]="22" /></span>
          <p class="wk-empty__title">{{ state.bankStatements().length ? 'Geen bewegingen gevonden' : 'Nog geen bankbewegingen' }}</p>
          <p class="wk-empty__text">{{ state.bankStatements().length ? 'Pas je zoekopdracht of filters aan.' : 'Noteer wat er op je rekening binnenkwam of wegging, met Bankbeweging noteren.' }}</p></div>
      }
    } @else {
      <div class="ios-search fin-ios-search"><label class="ios-search__field"><app-icon name="search" [size]="16" />
        <input type="search" placeholder="Zoeken" aria-label="Zoeken in bewegingen" [value]="search()" (input)="search.set($any($event.target).value); shown.set(12)" />
        <button class="ios-search__clear" type="button" aria-label="Zoekterm wissen" (click)="search.set('')"><app-icon name="close" [size]="14" /></button></label></div>
      <div class="ios-chips" role="group" aria-label="Richting">
        <button class="ios-chip" type="button" [attr.aria-pressed]="directionFilter() === 'ALL' && linkFilter() !== 'UNLINKED_IN'" (click)="setChip('ALL')">Alles</button>
        <button class="ios-chip" type="button" [attr.aria-pressed]="directionFilter() === 'INCOMING'" (click)="setChip('INCOMING')">In</button>
        <button class="ios-chip" type="button" [attr.aria-pressed]="directionFilter() === 'OUTGOING'" (click)="setChip('OUTGOING')">Uit</button>
        <button class="ios-chip" type="button" [attr.aria-pressed]="linkFilter() === 'UNLINKED_IN'" (click)="setChip('UNLINKED_IN')">Te koppelen
          @if (unlinkedCount()) { <span class="ios-chip__badge">{{ unlinkedCount() }}</span> }</button>
      </div>
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
      <details class="bank-totals"><summary>Totalen van deze selectie</summary>
        <dl><div><dt>Inkomend</dt><dd>{{ totals().incoming | eur }}</dd></div><div><dt>Uitgaand</dt><dd>{{ totals().outgoing | eur }}</dd></div><div><dt>Netto</dt><dd>{{ totals().net | eur }}</dd></div></dl>
      </details>
      @for (group of dayGroups(); track group.day) {
        <section class="ios-section">
          <div class="ios-section__head"><h2>{{ group.label }}</h2></div>
          <div class="ios-group ios-group--icons">
            @for (row of group.rows; track row.id) {
              <div class="bank-phone-row">
                <button class="bank-phone-row__open" type="button" (click)="openLine(row)" [disabled]="openingId() === row.id"
                  [attr.aria-label]="(row.counterparty || row.reference || 'Banktransactie') + ': ' + (allocated(row) ? linkedLabel(row) + ' openen' : 'koppelen')">
                  <span class="bank-phone-row__party">{{ row.counterparty || row.reference || 'Banktransactie' }}</span>
                  <strong class="bank-phone-row__amount" [class.wk-amount--in]="row.amountEur > 0">{{ row.amountEur > 0 ? '+' : '−' }} {{ abs(row.amountEur) | eur }}</strong>
                  @if (row.counterparty && row.reference) { <span class="bank-phone-row__reference">{{ row.reference }}</span> }
                  <span class="bank-phone-row__destination" [class.bank-phone-row__destination--open]="!allocated(row)">
                    <app-icon [name]="allocated(row) ? 'document' : 'link'" [size]="14" />
                    {{ openingId() === row.id ? 'Document laden…' : allocated(row) ? linkedLabel(row) : 'Factuur of uitgave koppelen' }} <span aria-hidden="true">›</span>
                  </span>
                  @if (!state.officialBankLine(row)) { <span class="bank-phone-row__reference">Historische registratie</span> }
                  @if (row.allocationDifferenceEur) { <span class="bank-phone-row__reference">Verschil {{ row.allocationDifferenceEur | eur }}</span> }
                </button>
                <button class="bank-phone-row__more" type="button" [attr.aria-label]="'Meer acties voor ' + (row.counterparty || row.reference || 'banktransactie')" (click)="lineMenu(row, null)"><app-icon name="more" [size]="20" /></button>
                @if (detailsId() === row.id) { <p class="bank-phone-row__details">{{ row.counterparty }}@if (row.counterparty && row.reference) { · }{{ row.reference }}<br />{{ record(row) }}</p> }
              </div>
            }
          </div>
        </section>
      } @empty {
        <div class="ios-empty"><span class="ios-empty__icon"><app-icon name="bank" [size]="26" /></span>
          <p class="ios-empty__title">{{ state.bankStatements().length ? 'Geen bewegingen gevonden' : 'Nog geen bankbewegingen' }}</p>
          <p class="ios-empty__text">{{ state.bankStatements().length ? 'Pas je zoekopdracht of filters aan.' : (state.manualAccountAllowed(accountFilter()) ? 'Voeg een transactie toe met Transactie noteren.' : 'Haal de transacties van deze rekening op via de bankverbinding.') }}</p></div>
      }
      @if (visibleLines().length < filteredLines().length) {
        <div class="ios-group fin-ios-more"><button class="ios-cell ios-cell--action" type="button" (click)="shown.update(more)">Meer tonen</button></div>
      }
    }
  `,
})
export class BankMovementPanel {
  readonly state = inject(FinanceState);
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
  /** An unlinked payment of this payee larger than the bank line: carve a part of it rather than recording another payment. */
  readonly localLargerPayment = computed(() => {
    const target = this.localDocument(), bank = this.selected();
    if (!bank || target?.kind !== 'purchase' || !this.roundOnServer()) return null;
    return this.state.payments().find(payment => payment.orderId === target.id && (payment.payee ?? 'SUPPLIER') === target.container?.payee
      && payment.bankStatementLineId == null && !payment.creditOffset && cents(payment.amountEur) > cents(Math.abs(bank.amountEur)) + 2) ?? null;
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
        if (!bankAmountsMatch(-this.outgoingTotal(), bank.amountEur) && !this.outgoingPart()?.carve) return 'Het totaal van de gekozen betalingen past niet bij de banktransactie. Maximaal € 0,02 verschil op het totaal is toegestaan.';
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
    this.purchaseCurrency.set('EUR'); this.purchaseAmountInput.set(Math.abs(this.selected()?.amountEur ?? 0).toFixed(2)); this.purchaseInspectionInput.set('');
    this.localPurchaseFiles.set([]); this.localPurchaseFilesError.set('');
    // A server with invoices lists them from the container view; an older one keeps the commercial invoice files.
    if (target.kind === 'purchase' && this.state.purchaseViews().find(view => view.order.id === target.id)?.invoices === undefined) void this.loadLocalPurchaseFiles(target.id);
  }
  changePurchaseCurrency(currency: Currency): void {
    if (this.busy()) return;
    this.purchaseCurrency.set(currency); this.purchaseAmountInput.set(currency === 'EUR' ? Math.abs(this.selected()?.amountEur ?? 0).toFixed(2) : '');
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
   * One purchase payment alone, through the split endpoint (bank-part): a
   * payment larger than the line gets the line's part carved out ('Deel
   * koppelen'; the rest stays open as a second transfer), and a transfer of a
   * payment paid in parts that matches takes the line's day. Every other
   * selection keeps /links, dates unchanged.
   */
  readonly outgoingPart = computed<{ row: OutgoingMatch; carve: boolean } | null>(() => {
    const line = this.selected(), rows = this.chosenOutgoing();
    if (!line || !this.roundOnServer() || rows.length !== 1 || this.outgoingSelected().length !== 1 || rows[0].kind !== 'purchase') return null;
    const row = rows[0];
    if (cents(row.amountEur) > cents(Math.abs(line.amountEur)) + 2) return { row, carve: true };
    return row.grouped && bankAmountsMatch(-row.amountEur, line.amountEur) ? { row, carve: false } : null;
  });
  readonly canLinkOutgoing = computed(() => {
    const line = this.selected(), rows = this.chosenOutgoing();
    return !this.busy() && !!line && line.amountEur !== 0 && !this.allocated(line) && rows.length > 0
      && rows.length === this.outgoingSelected().length && rows.filter(row => row.kind === 'cost').length <= 1
      && (bankAmountsMatch(-this.outgoingTotal(), line.amountEur) || !!this.outgoingPart()?.carve);
  });
  toggleOutgoing(row: OutgoingMatch): void {
    if (this.busy()) return;
    this.outgoingSelected.update(keys => keys.includes(row.key) ? keys.filter(key => key !== row.key)
      : [...(row.kind === 'cost' ? keys.filter(key => !key.startsWith('cost:')) : keys), row.key]);
  }
  async linkOutgoing(): Promise<void> {
    if (!this.canLinkOutgoing()) return;
    const line = this.selected()!, rows = this.chosenOutgoing();
    const part = this.outgoingPart();
    if (part) {
      await this.run(async () => {
        const result = await this.sourcing.linkPaymentPart(part.row.id, line.id);
        const saved = result.lines.find(item => item.id === line.id);
        if (saved) this.state.bankStatements.update(lines => lines.map(row => row.id === saved.id ? saved : row));
        ++this.allocationVersion; this.selected.set(null); this.outgoingSelected.set([]);
        this.ui.toast(part.carve ? 'Deel van de betaling gekoppeld' : 'Banktransactie gekoppeld');
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
    const search = this.search().trim().toLocaleLowerCase('nl-BE');
    return this.state.bankStatements().filter(row => {
      if (!this.showHistorical() && !this.state.officialBankLine(row)) return false;
      if (this.state.archivedBankLine(row) && !this.accountFilter()) return false;
      const day = paymentLocalDay({ receivedAt: row.bookedAt, timeZone: row.timeZone });
      const invoice = row.salesOrderId ? this.invoiceMap().get(row.salesOrderId) : null;
      const text = [row.reference, row.counterparty, row.account, invoice?.order.number, invoice ? this.customerName(invoice.order.customerId) : '', ...this.linkedDocuments(row).map(document => document.label)].join(' ').toLocaleLowerCase('nl-BE');
      const link = this.linkFilter();
      return (!this.accountFilter() || this.state.canonicalAccount(row.account) === this.state.canonicalAccount(this.accountFilter()))
        && (this.directionFilter() === 'ALL' || (this.directionFilter() === 'INCOMING' ? row.amountEur > 0 : row.amountEur < 0))
        && (link === 'ALL' || (link === 'LINKED' ? this.allocated(row) : link === 'UNLINKED' ? !this.allocated(row)
          : !this.allocated(row)))
        && (!this.from() || day >= this.from()) && (!this.to() || day <= this.to()) && (!search || text.includes(search));
    }).sort((left, right) => Date.parse(right.bookedAt) - Date.parse(left.bookedAt) || right.id - left.id);
  });
  readonly visibleLines = computed(() => this.filteredLines().slice(0, this.shown()));
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
  readonly totals = computed(() => {
    const incoming = this.filteredLines().filter(row => this.state.officialBankLine(row)).reduce((sum, row) => sum + (row.amountEur > 0 ? cents(row.amountEur) : 0), 0);
    const outgoing = this.filteredLines().filter(row => this.state.officialBankLine(row)).reduce((sum, row) => sum + (row.amountEur < 0 ? -cents(row.amountEur) : 0), 0);
    return { incoming: incoming / 100, outgoing: outgoing / 100, net: (incoming - outgoing) / 100 };
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
  private dayLabel(day: string): string {
    const today = paymentLocalDay({ receivedAt: new Date().toISOString(), timeZone: 'Europe/Brussels' });
    const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
    return diff === 0 ? 'Vandaag' : diff === 1 ? 'Gisteren' : WEEKDAY.format(new Date(`${day}T12:00:00Z`)).replace(/\./g, '');
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
    return documents.length > 1 ? `${documents.length} gekoppelde documenten` : documents[0]?.label || 'Gekoppeld document bekijken';
  }
  openLine(row: BankStatementLine): void {
    this.focusId.set(row.id);
    if (this.allocated(row)) void this.openLinked(row);
    else void this.openAllocation(row);
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
  /** Secondary actions stay behind the explicit more button or context menu. */
  lineMenu(row: BankStatementLine, anchor: { x: number; y: number } | null): void {
    this.focusId.set(row.id);
    const documents = this.linkedDocuments(row);
    const items = [
      ...(!this.allocated(row) ? [{ id: 'link', label: row.amountEur < 0 ? 'Aan uitgave of terugbetaling koppelen…' : 'Aan factuur koppelen…', iconName: 'link' }] : [{ id: 'unlink', label: 'Koppeling losmaken', iconName: 'unlink' }]),
      ...(this.allocated(row) || documents.length ? [{ id: 'document', label: documents.length > 1 ? 'Gekoppelde documenten openen' : 'Gekoppeld document openen', iconName: 'document' }] : []),
      { id: 'details', label: this.detailsId() === row.id ? 'Details verbergen' : 'Details', iconName: 'info' },
      ...(this.canRemove(row) ? [{ id: 'withdraw', label: 'Intrekken', iconName: 'trash', danger: true, divider: true }] : []),
    ];
    this.state.openMenu({ title: `${row.counterparty || row.reference || 'Bankbeweging'} · ${euro.format(row.amountEur)}`, anchor, cancelLabel: anchor ? '' : 'Annuleren', items,
      pick: id => {
        if (id === 'link') void this.openAllocation(row);
        else if (id === 'unlink') this.unlink(row);
        else if (id === 'document') void this.openLinked(row);
        else if (id === 'details') this.detailsId.update(current => current === row.id ? null : row.id);
        else if (id === 'withdraw') this.remove(row);
      } });
  }
  /** The desk keyboard: arrows move, L or Enter links (Enter opens the invoice of a linked line), Delete withdraws. */
  handle(command: string): boolean {
    const rows = this.visibleLines();
    const index = rows.findIndex(row => row.id === this.focusId());
    const row = index >= 0 ? rows[index] : null;
    if (command === 'up' || command === 'down') {
      if (!rows.length) return false;
      const next = rows[index < 0 ? (command === 'down' ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, index + (command === 'down' ? 1 : -1)))];
      this.focusId.set(next.id);
      const element = document.querySelector<HTMLElement>(`[data-key="line:${next.id}"]`);
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ block: 'nearest' });
      return true;
    }
    if (!row) return false;
    if ((command === 'link' || command === 'open') && !this.allocated(row)) { void this.openAllocation(row); return true; }
    if (command === 'open' && this.allocated(row)) { void this.openLinked(row); return true; }
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
    this.outgoingSearch.set(''); this.outgoingSelected.set([]);
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
    this.ui.confirm({ title: 'Bankbeweging intrekken', message: `${what}. Ze telt niet meer mee in het saldo. Het logboek houdt de wijziging bij.`, confirmLabel: 'Intrekken', danger: true },
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
