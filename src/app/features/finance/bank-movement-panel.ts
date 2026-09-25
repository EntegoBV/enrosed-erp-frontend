import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BankingApi, BankMatch, BankStatementLine } from '../../core/api/banking-api';
import type { SalesOrderView, SalesPayment } from '../../core/api/models';
import { messageOf } from '../../core/api/errors';
import { Icon } from '../../shared/icon';
import { MenuTrigger } from '../../shared/menu-trigger';
import { EurPipe } from '../../shared/pipes';
import { SwipeActions } from '../../shared/swipe-actions';
import { Ui, escapeHtml } from '../../shared/ui';
import { FinanceState } from './finance-state';
import { bankAccountKey } from './bank-reconciliation';
import { paymentLocalDay, paymentMomentLabel } from './incoming-money';

type DirectionFilter = 'ALL' | 'INCOMING' | 'OUTGOING';
/** UNLINKED_IN is 'Te koppelen': money in without an invoice. */
type LinkFilter = 'ALL' | 'LINKED' | 'UNLINKED' | 'UNLINKED_IN';
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
    @if (error() && !selected()) { <p class="fin-error" role="alert">{{ error() }}</p> }
    @if (state.desk()) {
      @if (filteredLines().length) {
        <div class="wk-table fin-table fin-table--moves" role="grid" aria-label="Bankbewegingen">
          <div class="wk-thead" role="row">
            <span class="wk-th" role="columnheader">Moment</span>
            <span class="wk-th" role="columnheader">Tegenpartij · mededeling</span>
            <span class="wk-th" role="columnheader" data-hide="sm inspecting">Rekening</span>
            <span class="wk-th" role="columnheader">Koppeling</span>
            <span class="wk-th wk-th--num" role="columnheader">Bedrag</span>
            <span class="wk-th" role="columnheader"><span class="fin-sr">Acties</span></span>
          </div>
          @for (row of visibleLines(); track row.id) {
            <div class="wk-tr" role="row" [attr.tabindex]="tabStopId() === row.id ? 0 : -1" [attr.data-key]="'line:' + row.id"
                 [attr.aria-selected]="focusId() === row.id" (focus)="focusId.set(row.id)" (click)="focusId.set(row.id)" appMenuTrigger (menuTrigger)="lineMenu(row, $event)">
              <span class="wk-td" role="gridcell" [attr.title]="record(row)">{{ stamp(row.bookedAt, row.timeZone) }}</span>
              <span class="wk-td" role="gridcell">{{ row.counterparty || row.reference || 'Bankbeweging' }}@if (row.counterparty && row.reference) { <span class="wk-td__sub">{{ row.reference }}</span> }</span>
              <span class="wk-td" role="gridcell" data-hide="sm inspecting">{{ accountName(row.account) }}</span>
              <span class="wk-td" role="gridcell">
                @if (row.salesOrderId) {
                  <a class="wk-link" tabindex="-1" [routerLink]="['/sales', row.salesOrderId]" (click)="$event.stopPropagation()">{{ row.amountEur < 0 ? 'Terugbetaling' : 'Factuur' }} {{ invoiceNumber(row.salesOrderId) }} ›</a>
                } @else if (row.amountEur > 0) {
                  <button class="wk-btn wk-btn--sm fin-link-btn" type="button" tabindex="-1" [disabled]="busy()" (click)="$event.stopPropagation(); openAllocation(row)"><app-icon name="link" [size]="14" />Koppelen</button>
                } @else if (markerOf(row); as marker) {
                  <button class="wk-pill fin-marker" [class.tone-teal]="marker.kind === 'kost'" [class.tone-blue]="marker.kind !== 'kost'" type="button" tabindex="-1"
                          (click)="$event.stopPropagation(); inspectMarker(marker)">{{ marker.kind === 'kost' ? 'Kost' : 'Container' }}</button>
                } @else { <span class="wk-amount--muted">—</span> }
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
        <button class="ios-chip" type="button" [attr.aria-pressed]="directionFilter() === 'INCOMING'" (click)="setChip('INCOMING')">Binnen</button>
        <button class="ios-chip" type="button" [attr.aria-pressed]="directionFilter() === 'OUTGOING'" (click)="setChip('OUTGOING')">Buiten</button>
        <button class="ios-chip" type="button" [attr.aria-pressed]="linkFilter() === 'UNLINKED_IN'" (click)="setChip('UNLINKED_IN')">Te koppelen
          @if (unlinkedCount()) { <span class="ios-chip__badge">{{ unlinkedCount() }}</span> }</button>
        <button class="ios-chip" type="button" [attr.aria-pressed]="!!accountFilter()" (click)="accountMenu()">{{ accountFilter() ? accountName(accountFilter()) : 'Alle rekeningen' }} <app-icon name="chevron-down" [size]="14" /></button>
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
              <div class="ios-swipe" appSwipeActions #sw="swipeActions" [swipeEnd]="row.salesPaymentId ? 0 : 1" swipeFull="none">
                <div class="ios-swipe__actions ios-swipe__actions--end">
                  <button class="ios-swipe__btn tone-danger" type="button" [disabled]="busy()" (click)="remove(row); sw.close()"><app-icon name="trash" [size]="20" />Intrekken</button>
                </div>
                <div class="ios-swipe__row">
                  <button class="ios-cell ios-cell--tall" type="button" (click)="lineMenu(row, null)">
                    <span class="ios-cell__lead"><span class="ios-tile ios-tile--lg ios-tile--soft fin-round" [class.tone-ok]="row.amountEur > 0" [class.tone-ink]="row.amountEur < 0"><app-icon [name]="row.amountEur > 0 ? 'arrow-in' : 'arrow-out'" [size]="18" /></span></span>
                    <span class="ios-cell__body"><span class="ios-cell__title">{{ row.counterparty || row.reference || 'Bankbeweging' }}</span>
                      <span class="ios-cell__sub">{{ accountName(row.account) }} · {{ clock(row) }}</span>
                      @if (detailsId() === row.id) { <span class="ios-cell__sub fin-wrap">{{ record(row) }}{{ row.reference && row.counterparty ? ' · ' + row.reference : '' }}</span> }</span>
                    <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong" [class.wk-amount--in]="row.amountEur > 0">{{ row.amountEur > 0 ? '+' : '−' }} {{ abs(row.amountEur) | eur }}</span>
                      <span class="ios-cell__meta">@if (row.salesOrderId) { {{ invoiceNumber(row.salesOrderId) }} } @else if (row.amountEur > 0) { <span class="fin-warn-text">Te koppelen</span> } @else if (markerOf(row); as marker) { {{ marker.kind === 'kost' ? 'Kost' : 'Container' }} }</span></span>
                  </button>
                </div>
              </div>
            }
          </div>
        </section>
      } @empty {
        <div class="ios-empty"><span class="ios-empty__icon"><app-icon name="bank" [size]="26" /></span>
          <p class="ios-empty__title">{{ state.bankStatements().length ? 'Geen bewegingen gevonden' : 'Nog geen bankbewegingen' }}</p>
          <p class="ios-empty__text">{{ state.bankStatements().length ? 'Pas je zoekopdracht of filters aan.' : 'Noteer een bedrag van je rekening met +.' }}</p></div>
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
  private readonly ui = inject(Ui);
  readonly busy = signal(false);
  readonly matchingLoading = signal(false);
  readonly error = signal('');
  /** The movement form is FinanceState's; the panel only reports whether one is open. */
  readonly draft = computed(() => this.state.movementDraft());
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
  private allocationVersion = 0;
  private readonly invoiceMap = computed(() => new Map(this.state.salesOrders().map(view => [view.order.id, view])));
  private readonly customerNames = computed(() => new Map(this.state.customers().map(customer => [customer.id, customer.company])));
  private readonly paymentMap = computed(() => {
    const payments = this.state.salesOrders().flatMap(view => view.paymentSummary?.payments ?? []);
    return new Map<number, SalesPayment>([...payments, ...this.state.incomingPayments()].map(payment => [payment.id, payment]));
  });
  readonly ledgerAccounts = computed(() => [...new Set([
    ...this.state.accounts(), ...this.state.bankStatements().map(row => row.account),
    ...this.state.incomingPayments().map(row => row.bankAccount ?? ''),
  ].map(bankAccountKey).filter(Boolean))].sort());
  readonly invalidPeriod = computed(() => !!this.from() && !!this.to() && this.from() > this.to());
  readonly hasFilters = computed(() => !!this.search().trim() || !!this.accountFilter() || this.directionFilter() !== 'ALL' || this.linkFilter() !== 'ALL' || !!this.from() || !!this.to());
  readonly filteredLines = computed(() => {
    if (this.invalidPeriod()) return [];
    const search = this.search().trim().toLocaleLowerCase('nl-BE');
    return this.state.bankStatements().filter(row => {
      const day = paymentLocalDay({ receivedAt: row.bookedAt, timeZone: row.timeZone });
      const invoice = row.salesOrderId ? this.invoiceMap().get(row.salesOrderId) : null;
      const text = [row.reference, row.counterparty, row.account, invoice?.order.number, invoice ? this.customerName(invoice.order.customerId) : ''].join(' ').toLocaleLowerCase('nl-BE');
      const link = this.linkFilter();
      return (!this.accountFilter() || bankAccountKey(row.account) === this.accountFilter())
        && (this.directionFilter() === 'ALL' || (this.directionFilter() === 'INCOMING' ? row.amountEur > 0 : row.amountEur < 0))
        && (link === 'ALL' || (link === 'LINKED' ? row.salesPaymentId != null : link === 'UNLINKED' ? row.salesPaymentId == null
          : row.salesPaymentId == null && row.amountEur > 0))
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
  readonly unlinkedCount = computed(() => this.state.bankStatements().filter(row => row.amountEur > 0 && row.salesPaymentId == null).length);
  readonly totals = computed(() => {
    const incoming = this.filteredLines().reduce((sum, row) => sum + (row.amountEur > 0 ? cents(row.amountEur) : 0), 0);
    const outgoing = this.filteredLines().reduce((sum, row) => sum + (row.amountEur < 0 ? -cents(row.amountEur) : 0), 0);
    return { incoming: incoming / 100, outgoing: outgoing / 100, net: (incoming - outgoing) / 100 };
  });
  readonly existingMatches = computed<BankMatch[]>(() => {
    const row = this.selected(); if (!row) return [];
    const linked = new Set(this.state.bankStatements().map(line => line.salesPaymentId));
    return [...this.paymentMap().values()].filter(payment => {
      const invoice = this.invoiceMap().get(payment.salesOrderId);
      /* A verrekening is no bank movement: it never matches a line. */
      if (payment.offsetPaymentId != null) return false;
      return !!invoice && this.active(invoice) && !linked.has(payment.id)
        && cents(payment.amountEur) === cents(row.amountEur)
        && (!bankAccountKey(payment.bankAccount) || bankAccountKey(payment.bankAccount) === bankAccountKey(row.account));
    }).sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt) || right.id - left.id)
      .map(payment => ({ salesOrderId: payment.salesOrderId, number: this.invoiceNumber(payment.salesOrderId),
        existingPaymentId: payment.id, openEur: this.available(this.invoiceMap().get(payment.salesOrderId)!), score: 0,
        reason: 'Bestaande betaling koppelen', receivedAt: payment.receivedAt, reference: payment.reference }));
  });
  readonly selectableInvoices = computed(() => this.state.salesOrders().filter(view => this.active(view)
    && (this.canCreateOn(view) || this.existingMatches().some(match => match.salesOrderId === view.order.id))));
  readonly manualMatches = computed(() => this.existingMatches().filter(match => match.salesOrderId === this.manualInvoice()));
  readonly manualNewMatch = computed<BankMatch | null>(() => {
    const view = this.invoiceMap().get(this.manualInvoice());
    return view && this.canCreateOn(view) ? { salesOrderId: view.order.id, number: view.order.number,
      existingPaymentId: null, openEur: this.available(view), score: 0, reason: 'Nieuwe boeking', receivedAt: null, reference: null } : null;
  });
  readonly chosenInvoiceHasExistingMatches = computed(() => this.existingMatches().some(match => match.salesOrderId === this.choice()?.salesOrderId)
    || this.matches().some(match => !!match.existingPaymentId && match.salesOrderId === this.choice()?.salesOrderId));
  readonly canAllocate = computed(() => !!this.selected() && !!this.choice() && !this.busy() && !this.matchingLoading()
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
    return row.amountEur < 0 ? cents(view.paymentSummary?.refundableEur ?? 0) >= -cents(row.amountEur)
      : (view.paymentSummary?.invoiceTotalEur ?? view.priced?.totals?.totalInclVat ?? 0) > 0;
  }
  matchKey(match: BankMatch): string { return `${match.salesOrderId}:${match.existingPaymentId ?? 'new'}`; }
  isChosen(match: BankMatch): boolean { const choice = this.choice(); return !!choice && this.matchKey(choice) === this.matchKey(match); }
  matchStamp(match: BankMatch): string { return this.stamp(match.receivedAt ?? '', (match.existingPaymentId ? this.paymentMap().get(match.existingPaymentId)?.timeZone : null) || this.selected()?.timeZone || 'Europe/Brussels'); }
  clearFilters(): void { this.search.set(''); this.accountFilter.set(''); this.directionFilter.set('ALL'); this.linkFilter.set('ALL'); this.from.set(''); this.to.set(''); this.shown.set(12); }
  accountName(account: string): string { return this.state.accountLabel(bankAccountKey(account)) || account; }
  abs(amount: number): number { return Math.abs(amount); }
  clock(row: BankStatementLine): string {
    try { return new Intl.DateTimeFormat('nl-BE', { hour: '2-digit', minute: '2-digit', timeZone: row.timeZone || 'Europe/Brussels' }).format(new Date(row.bookedAt)); }
    catch { return ''; }
  }
  point(event: MouseEvent): { x: number; y: number } { const rect = (event.currentTarget as HTMLElement).getBoundingClientRect(); return { x: rect.left, y: rect.bottom + 6 }; }
  /** 'Details': when and by whom the line was recorded, and when and how it was linked to an invoice. */
  record(row: BankStatementLine): string {
    const recorded = `Geregistreerd ${this.stamp(row.recordedAt, row.timeZone)}${row.actor ? ` · ${row.actor}` : ''}`;
    if (!row.allocatedAt) return recorded;
    return `${recorded} · Gekoppeld ${this.stamp(row.allocatedAt, row.timeZone)} · ${row.allocationCreatedPayment ? 'factuurbetaling bij koppelen aangemaakt' : 'bestaande factuurbetaling gekoppeld'}`;
  }
  private dayLabel(day: string): string {
    const today = paymentLocalDay({ receivedAt: new Date().toISOString(), timeZone: 'Europe/Brussels' });
    const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
    return diff === 0 ? 'Vandaag' : diff === 1 ? 'Gisteren' : WEEKDAY.format(new Date(`${day}T12:00:00Z`)).replace(/\./g, '');
  }

  /** The kost/containerbetaling marker a line carries, if any. */
  markerOf(row: BankStatementLine): { kind: string; id: number } | null { return this.state.lineMarkers().get(row.id)?.[0] ?? null; }
  inspectMarker(marker: { kind: string; id: number }): void {
    if (marker.kind === 'kost') { this.state.inspectItem({ kind: 'cost', id: marker.id }); return; }
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
      ...(!row.salesPaymentId ? [{ id: 'link', label: 'Aan factuur koppelen…', iconName: 'link' }] : [{ id: 'unlink', label: 'Koppeling losmaken', iconName: 'unlink' }]),
      ...(row.salesOrderId ? [{ id: 'invoice', label: 'Factuur openen', iconName: 'document' }] : []),
      ...(marker ? [{ id: 'marker', label: marker.kind === 'kost' ? 'Kost bekijken' : 'Container bekijken', iconName: 'eye' }] : []),
      { id: 'details', label: this.detailsId() === row.id ? 'Details verbergen' : 'Details', iconName: 'info' },
      ...(!row.salesPaymentId ? [{ id: 'withdraw', label: 'Intrekken', iconName: 'trash', danger: true, divider: true }] : []),
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
    if ((command === 'link' || command === 'open') && !row.salesPaymentId) { void this.openAllocation(row); return true; }
    if (command === 'open' && row.salesOrderId) { this.state.openInvoice(row.salesOrderId); return true; }
    if (command === 'delete' && !row.salesPaymentId) { this.remove(row); return true; }
    if (command === 'escape') { this.focusId.set(null); return true; }
    return false;
  }

  add(): void {
    if (this.busy()) return;
    this.closeAllocation();
    this.state.openMovement({ accountKey: this.accountFilter() || undefined });
  }
  async openAllocation(row: BankStatementLine): Promise<void> {
    if (this.busy()) return;
    const version = ++this.allocationVersion;
    this.selected.set(row); this.choice.set(null); this.manualInvoice.set(0); this.matches.set([]); this.newBookingConfirmed.set(false); this.error.set(''); this.matchingLoading.set(true);
    try {
      const matches = await this.api.suggestions(row.id);
      if (version !== this.allocationVersion || this.selected()?.id !== row.id) return;
      this.matches.set(matches.filter(match => !!match.existingPaymentId || (row.amountEur < 0
        ? cents(match.openEur) >= -cents(row.amountEur)
        : this.invoiceMap().has(match.salesOrderId) ? this.canCreateOn(this.invoiceMap().get(match.salesOrderId)!) : match.openEur > 0)));
    } catch (failure) { if (version === this.allocationVersion && this.selected()?.id === row.id) this.error.set(messageOf(failure, 'Suggesties laden mislukt. Je kunt hieronder zelf een factuur kiezen.')); }
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
    if (this.busy()) return;
    this.ui.confirm({ title: 'Koppeling losmaken', message: `${escapeHtml(row.counterparty || row.reference || 'Bankbeweging')} · ${euro.format(row.amountEur)}. `
      + (row.allocationCreatedPayment ? 'De vanuit deze bankbeweging aangemaakte factuurbetaling wordt ingetrokken. De bankbeweging zelf blijft bewaard.' : 'De bestaande factuurbetaling blijft bewaard; alleen de koppeling met deze bankbeweging verdwijnt.'),
      confirmLabel: 'Koppeling losmaken', danger: true }, () => this.run(async () => { await this.api.unallocate(row.id); await this.state.refreshBank(); }));
  }
  remove(row: BankStatementLine): void {
    if (this.busy()) return;
    const what = [row.account, euro.format(row.amountEur), row.counterparty, row.reference || 'Geen referentie'].filter(Boolean).map(part => escapeHtml(part)).join(' · ');
    this.ui.confirm({ title: 'Bankbeweging intrekken', message: `${what}. Ze telt niet meer mee in het saldo. Het logboek houdt de wijziging bij.`, confirmLabel: 'Intrekken', danger: true },
      () => this.run(async () => { await this.api.delete(row.id); this.state.bankStatements.update(rows => rows.filter(line => line.id !== row.id)); await this.state.refreshBank(); }));
  }
  private async run(work: () => Promise<unknown>): Promise<void> { if (this.busy()) return; this.busy.set(true); this.error.set(''); try { await work(); } catch (failure) { this.error.set(messageOf(failure, 'Bankbewerking mislukt')); } finally { this.busy.set(false); } }
}
