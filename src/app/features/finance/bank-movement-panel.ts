import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BankingApi, BankMatch, BankStatementLine, ReceivedOdooInvoice, ReceivedOdooInvoicePreview } from '../../core/api/banking-api';
import type { Currency, PurchaseDocument, SalesOrderView, SalesPayment } from '../../core/api/models';
import { messageOf } from '../../core/api/errors';
import { SourcingApi } from '../../core/api/sourcing-api';
import { saveBlob } from '../../core/api/download';
import { bankAmountsMatch, bankAmountDifference } from '../../shared/bank-transaction-options';
import { Icon } from '../../shared/icon';
import { MenuTrigger } from '../../shared/menu-trigger';
import { EurPipe } from '../../shared/pipes';
import { SwipeActions } from '../../shared/swipe-actions';
import { Ui, escapeHtml } from '../../shared/ui';
import { FinanceState } from './finance-state';
import { bankAccountKey } from './bank-reconciliation';
import { paymentLocalDay, paymentMomentLabel } from './incoming-money';
import { cashTotalOf, openOf } from './finance-metrics';
import { containerPayables } from './payables';
import { bankAllocationTargets, filterBankAllocationTargets, type BankAllocationTarget } from './bank-allocation-targets';
import { bankTransactionDay } from '../../shared/bank-transaction-options';
import { parsePurchasePaymentAmount } from '../purchasing/purchase-payment-amount';

type DirectionFilter = 'ALL' | 'INCOMING' | 'OUTGOING';
/** UNLINKED_IN is 'Te koppelen': money in without an invoice. */
type LinkFilter = 'ALL' | 'LINKED' | 'UNLINKED' | 'UNLINKED_IN';
interface OutgoingMatch { ownerId: number; key: string; kind: 'cost' | 'purchase'; id: number; title: string; detail: string; paidOn: string; amountEur: number; }
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
  imports: [RouterLink, EurPipe, Icon, SwipeActions, MenuTrigger],
  template: `
    @if (historicalCount()) {
      <p class="fin-hint">{{ historicalCount() }} eerdere handmatige registraties op een rekening via Odoo blijven bewaard en tellen niet mee in dit bankoverzicht.
        <button class="fin-inline-btn" type="button" (click)="showHistorical.set(!showHistorical())">{{ showHistorical() ? 'Historische registraties verbergen' : 'Historische registraties tonen' }}</button>
      </p>
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
            <div class="wk-tr" role="row" [attr.tabindex]="tabStopId() === row.id ? 0 : -1" [attr.data-key]="'line:' + row.id"
                 [attr.aria-selected]="focusId() === row.id" (focus)="focusId.set(row.id)" (click)="focusId.set(row.id)" appMenuTrigger (menuTrigger)="lineMenu(row, $event)">
              <span class="wk-td" role="gridcell" [attr.title]="record(row)">{{ movementStamp(row) }}</span>
              <span class="wk-td" role="gridcell">{{ row.counterparty || row.reference || 'Bankbeweging' }}@if (!state.officialBankLine(row)) { <span class="wk-pill tone-grey">Historische registratie</span> }@if (imported(row)) { <span class="wk-pill tone-blue" title="Banktransactie opgehaald uit Odoo">Odoo</span> }@if (row.counterparty && row.reference) { <span class="wk-td__sub">{{ row.reference }}</span> }</span>
              <span class="wk-td" role="gridcell">
                @if (row.salesOrderId) {
                  <a class="wk-link" tabindex="-1" [routerLink]="['/sales', row.salesOrderId]" (click)="$event.stopPropagation()">{{ row.amountEur < 0 ? 'Terugbetaling' : 'Factuur' }} {{ invoiceNumber(row.salesOrderId) }} ›</a>
                } @else if (allocated(row)) {
                  <span class="wk-pill tone-teal">{{ row.allocationLabel || 'Gekoppeld' }}</span>
                } @else if (!allocated(row)) {
                  <button class="wk-btn wk-btn--sm fin-link-btn" type="button" tabindex="-1" [disabled]="busy()" (click)="$event.stopPropagation(); openAllocation(row)"><app-icon name="link" [size]="14" />Koppelen</button>
                } @else if (markerOf(row); as marker) {
                  <button class="wk-pill fin-marker" [class.tone-teal]="isCost(marker)" [class.tone-blue]="!isCost(marker)" type="button" tabindex="-1"
                          (click)="$event.stopPropagation(); inspectMarker(marker)">{{ isCost(marker) ? 'Kost' : 'Container' }}</button>
                } @else { <span class="wk-amount--muted">—</span> }
                @if (row.allocationDifferenceEur) { <span class="wk-td__sub">Verschil {{ row.allocationDifferenceEur | eur }}</span> }
              </span>
              <span class="wk-td wk-td--num" role="gridcell"><b [class.wk-amount--in]="row.amountEur > 0">{{ row.amountEur > 0 ? '+' : '−' }} {{ abs(row.amountEur) | eur }}</b></span>
              <span class="wk-td fin-td-end" role="gridcell">
                <button class="wk-btn wk-btn--ghost wk-btn--icon wk-btn--sm" type="button" tabindex="-1" aria-label="Acties" (click)="$event.stopPropagation(); lineMenu(row, point($event))"><app-icon name="more" [size]="16" /></button>
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
      <div class="ios-figures ios-figures--3">
        <div><small>In</small><strong class="wk-amount--in" [attr.title]="totals().incoming | eur">{{ totals().incoming | eur: 0 }}</strong></div>
        <div><small>Uit</small><strong [attr.title]="totals().outgoing | eur">{{ totals().outgoing | eur: 0 }}</strong></div>
        <div><small>Netto</small><strong [attr.title]="totals().net | eur">{{ totals().net | eur: 0 }}</strong></div>
      </div>
      @for (group of dayGroups(); track group.day) {
        <section class="ios-section">
          <div class="ios-section__head"><h2>{{ group.label }}</h2></div>
          <div class="ios-group ios-group--icons">
            @for (row of group.rows; track row.id) {
              <div class="ios-swipe" appSwipeActions #sw="swipeActions" [swipeEnd]="canRemove(row) ? 1 : 0" swipeFull="none">
                <div class="ios-swipe__actions ios-swipe__actions--end">
                  <button class="ios-swipe__btn tone-danger" type="button" [disabled]="busy() || !canRemove(row)" (click)="remove(row); sw.close()"><app-icon name="trash" [size]="20" />Intrekken</button>
                </div>
                <div class="ios-swipe__row">
                  <button class="ios-cell ios-cell--tall" type="button" (click)="lineMenu(row, null)">
                    <span class="ios-cell__lead"><span class="ios-tile ios-tile--lg ios-tile--soft fin-round" [class.tone-ok]="row.amountEur > 0" [class.tone-ink]="row.amountEur < 0"><app-icon [name]="row.amountEur > 0 ? 'arrow-in' : 'arrow-out'" [size]="18" /></span></span>
                    <span class="ios-cell__body"><span class="ios-cell__title">{{ row.counterparty || row.reference || 'Bankbeweging' }}</span>
                      <span class="ios-cell__sub">{{ row.reference || (imported(row) ? 'Banktransactie' : clock(row)) }}@if (imported(row)) { · <span class="wk-pill tone-blue">Odoo</span> }</span>
                      @if (detailsId() === row.id) { <span class="ios-cell__sub fin-wrap">{{ record(row) }}{{ row.reference && row.counterparty ? ' · ' + row.reference : '' }}</span> }</span>
                    <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong" [class.wk-amount--in]="row.amountEur > 0">{{ row.amountEur > 0 ? '+' : '−' }} {{ abs(row.amountEur) | eur }}</span>
                      <span class="ios-cell__meta">@if (row.salesOrderId) { {{ invoiceNumber(row.salesOrderId) }} } @else if (allocated(row)) { {{ row.allocationLabel || 'Gekoppeld' }} } @else if (!allocated(row)) { <span class="fin-warn-text">Te koppelen</span> } @else if (markerOf(row); as marker) { {{ isCost(marker) ? 'Kost' : 'Container' }} }</span>@if (row.allocationDifferenceEur) { <span class="ios-cell__meta">Verschil {{ row.allocationDifferenceEur | eur }}</span> }</span>
                  </button>
                </div>
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
    const payment = target.kind === 'purchase' ? (this.purchaseCurrency() === 'EUR' ? -(parsePurchasePaymentAmount(this.purchaseAmountInput()) ?? 0) : bank.amountEur)
      : bankAmountsMatch(bank.amountEur, open) ? open : bank.amountEur;
    const amountValid = target.kind === 'purchase' ? !!parsePurchasePaymentAmount(this.purchaseAmountInput()) && bankAmountsMatch(bank.amountEur, payment)
      : sameDirection && (Math.abs(bank.amountEur) <= Math.abs(open) || bankAmountsMatch(bank.amountEur, open) || (target.kind === 'sales' && bank.amountEur > 0));
    return { paymentEur: payment, openEur: Math.abs(open), remainingEur: Math.max(0, cents(Math.abs(open)) - cents(Math.abs(payment))) / 100,
      differenceEur: bankAmountDifference(bank.amountEur, payment), overpaidEur: Math.max(0, cents(Math.abs(payment)) - cents(Math.abs(open))) / 100,
      eligible: amountValid && (target.kind === 'purchase' || open !== 0) };
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
  setAllocationStep(step: 'documents' | 'payments' | 'new'): void {
    if (this.busy()) return;
    this.allocationStep.set(step); this.error.set('');
    if (step === 'new') this.setAllocationMode('received');
  }
  chooseLocalDocument(target: BankAllocationTarget): void {
    if (this.busy()) return;
    this.localSelectedKey.set(target.key); this.localNewConfirmed.set(false); this.error.set('');
    this.purchaseCurrency.set('EUR'); this.purchaseAmountInput.set(Math.abs(this.selected()?.amountEur ?? 0).toFixed(2));
    this.localPurchaseFiles.set([]); this.localPurchaseFilesError.set('');
    if (target.kind === 'purchase') void this.loadLocalPurchaseFiles(target.id);
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
    const confirmNew = this.localNewConfirmed();
    await this.run(async () => {
      let saved: BankStatementLine;
      if (target.kind === 'cost') saved = await this.api.addCostPayment(bank.id, target.id, confirmNew);
      else if (target.kind === 'sales') saved = await this.api.allocate(bank.id, target.id, null);
      else {
        const result = await this.api.addPurchasePayment(bank.id, target.id, [{ paidOn: bankTransactionDay(bank), amount: amount!, currency,
          amountEur: currency === 'EUR' ? null : Math.abs(bank.amountEur), label: target.reference || 'Bankbetaling',
          payee: target.container!.payee, instalmentDue: target.container!.due, settles: false }]);
        saved = result.line;
      }
      this.state.bankStatements.update(rows => [saved, ...rows.filter(row => row.id !== saved.id)]);
      ++this.allocationVersion; this.selected.set(null); this.localSelectedKey.set(null);
      this.ui.toast(`Bankbetaling gekoppeld aan ${target.title}`, 'ok');
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
    for (const payment of this.state.payments()) {
      if (payment.bankStatementLineId != null || !(payment.amountEur > 0) || (this.selected()?.amountEur ?? -1) > 0) continue;
      result.push({ ownerId: payment.orderId, key: 'purchase:' + payment.id, kind: 'purchase', id: payment.id, title: payment.orderAlias || payment.orderNumber || 'Container',
        detail: [payment.orderNumber, payment.label].filter(Boolean).join(' · '), paidOn: payment.paidOn, amountEur: payment.amountEur });
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
  readonly canLinkOutgoing = computed(() => {
    const line = this.selected(), rows = this.chosenOutgoing();
    return !this.busy() && !!line && line.amountEur !== 0 && !this.allocated(line) && rows.length > 0
      && rows.length === this.outgoingSelected().length && rows.filter(row => row.kind === 'cost').length <= 1
      && bankAmountsMatch(-this.outgoingTotal(), line.amountEur);
  });
  toggleOutgoing(row: OutgoingMatch): void {
    if (this.busy()) return;
    this.outgoingSelected.update(keys => keys.includes(row.key) ? keys.filter(key => key !== row.key)
      : [...(row.kind === 'cost' ? keys.filter(key => !key.startsWith('cost:')) : keys), row.key]);
  }
  async linkOutgoing(): Promise<void> {
    if (!this.canLinkOutgoing()) return;
    const line = this.selected()!, rows = this.chosenOutgoing();
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
      const text = [row.reference, row.counterparty, row.account, invoice?.order.number, invoice ? this.customerName(invoice.order.customerId) : ''].join(' ').toLocaleLowerCase('nl-BE');
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

  /** The payments on costs the server linked to a bank line, by line id: a line noted from the cost itself carries no marker in its reference. */
  private readonly paymentLines = computed(() => new Map(this.state.costs().flatMap(cost => (cost.payments ?? [])
    .filter(payment => payment.bankStatementLineId != null && !!payment.id).map(payment => [payment.bankStatementLineId!, payment.id!]))));
  /** The kost/kostbetaling/containerbetaling marker a line carries, else the payment hard-linked to it. */
  markerOf(row: BankStatementLine): { kind: string; id: number } | null {
    const marker = this.imported(row) ? null : this.state.lineMarkers().get(row.id)?.[0];
    if (marker) return marker;
    const paymentId = this.paymentLines().get(row.id);
    return paymentId ? { kind: 'kostbetaling', id: paymentId } : null;
  }
  isCost(marker: { kind: string }): boolean { return marker.kind === 'kost' || marker.kind === 'kostbetaling'; }
  inspectMarker(marker: { kind: string; id: number }): void {
    if (marker.kind === 'kost') { this.state.inspectItem({ kind: 'cost', id: marker.id }); return; }
    if (marker.kind === 'kostbetaling') {
      const cost = this.state.costOfPayment(marker.id);
      if (cost?.id) this.state.inspectItem({ kind: 'cost', id: cost.id });
      else this.ui.toast('Deze betaling staat niet meer op een kost');
      return;
    }
    const orderId = this.state.payments().find(payment => payment.id === marker.id)?.orderId;
    if (orderId) this.state.inspectItem({ kind: 'container', id: orderId });
  }

  /** The phone chips: one direction, or the incoming lines still to link. */
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
  /** Right-click, ⋯ or a tap on the phone: what can be done with this line. */
  lineMenu(row: BankStatementLine, anchor: { x: number; y: number } | null): void {
    this.focusId.set(row.id);
    const marker = this.markerOf(row);
    const items = [
      ...(!this.allocated(row) ? [{ id: 'link', label: row.amountEur < 0 ? 'Aan uitgave of terugbetaling koppelen…' : 'Aan factuur koppelen…', iconName: 'link' }] : [{ id: 'unlink', label: 'Koppeling losmaken', iconName: 'unlink' }]),
      ...(row.salesOrderId ? [{ id: 'invoice', label: 'Factuur openen', iconName: 'document' }] : []),
      ...(marker ? [{ id: 'marker', label: this.isCost(marker) ? 'Kost bekijken' : 'Container bekijken', iconName: 'eye' }] : []),
      { id: 'details', label: this.detailsId() === row.id ? 'Details verbergen' : 'Details', iconName: 'info' },
      ...(this.canRemove(row) ? [{ id: 'withdraw', label: 'Intrekken', iconName: 'trash', danger: true, divider: true }] : []),
    ];
    this.state.openMenu({ title: `${row.counterparty || row.reference || 'Bankbeweging'} · ${euro.format(row.amountEur)}`, anchor, cancelLabel: anchor ? '' : 'Annuleren', items,
      pick: id => {
        if (id === 'link') void this.openAllocation(row);
        else if (id === 'unlink') this.unlink(row);
        else if (id === 'invoice') this.state.openInvoice(row.salesOrderId!);
        else if (id === 'marker' && marker) this.inspectMarker(marker);
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
    if (command === 'open' && row.salesOrderId) { this.state.openInvoice(row.salesOrderId); return true; }
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
