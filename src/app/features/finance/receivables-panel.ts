import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, forwardRef, inject, untracked, viewChild } from '@angular/core';
import { Icon } from '../../shared/icon';
import { MenuTrigger } from '../../shared/menu-trigger';
import { EurPipe } from '../../shared/pipes';
import { dayMonth } from './finance-format';
import { FINANCE_SECTION, FinanceSectionApi, StripItem } from './finance-section';
import type { FinanceCommand } from './finance-shortcuts';
import { FinanceState, ReceivableRow, formatEuro } from './finance-state';
import { FinanceTable } from './finance-table';
import { incomingPurposeLabel, paymentMomentLabel, uniqueIncomingPayments } from './incoming-money';
import type { IncomingMoneyRow } from './incoming-money';
import { IncomingPaymentList, receiptMenu } from './incoming-payment-list';
import type { MenuPoint } from '../../shared/context-menu-position';

const KIND_LABEL: Readonly<Record<string, string>> = { STANDARD: 'Klant', PARTNER_ADVANCE: 'Partnervoorschot', PARTNER_SETTLEMENT: 'Partnerafrekening' };

/**
 * Te ontvangen: who still has to pay us (Openstaand, oldest first) and what
 * came in (Ontvangen). Receivables live here, not in Bank.
 */
@Component({
  selector: 'app-receivables-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: FINANCE_SECTION, useExisting: forwardRef(() => ReceivablesPanel) }],
  imports: [Icon, EurPipe, MenuTrigger, IncomingPaymentList],
  template: `
    @if (state.location().tab === 'received') {
      <app-incoming-payment-list />
    } @else if (state.desk()) {
      @if (rows().length) {
        <div class="wk-table fin-table fin-table--receivables" role="grid" aria-label="Openstaande facturen">
          <div class="wk-thead" role="row">
            <span class="wk-th" role="columnheader">Factuur</span>
            <span class="wk-th" role="columnheader">Klant</span>
            <span class="wk-th" role="columnheader" data-hide="sm">Soort</span>
            <span class="wk-th" role="columnheader">Factuurdatum · vervalt</span>
            <span class="wk-th wk-th--num" role="columnheader" data-hide="md">Totaal</span>
            <span class="wk-th wk-th--num" role="columnheader" data-hide="md">Ontvangen</span>
            <span class="wk-th wk-th--num" role="columnheader">Nog open</span>
            <span class="wk-th" role="columnheader"><span class="fin-sr">Openen</span></span>
          </div>
          @for (row of rows(); track row.key) {
            <div class="wk-tr wk-tr--link" [class.fin-credit-row]="row.kind === 'credit'" role="row" [attr.tabindex]="table.stop() === row.key ? 0 : -1" [attr.data-key]="row.key" [attr.aria-selected]="table.isSelected(row.key)"
                 (focus)="table.focused(row.key)" (click)="table.click(row.key, $event)" (dblclick)="state.openInvoice(row.id)" appMenuTrigger (menuTrigger)="menu(row, $event)">
              <span class="wk-td" role="gridcell"><b>{{ row.number }}</b></span>
              <span class="wk-td" role="gridcell">{{ row.customer || '—' }}</span>
              <span class="wk-td" role="gridcell" data-hide="sm"><span class="wk-pill" [class.tone-plum]="row.kind === 'partner' || row.kind === 'credit'">{{ kindLabel(row) }}</span>@if (row.kind === 'credit' && row.creditedInvoiceNumber) { <span class="wk-td__sub">op {{ row.creditedInvoiceNumber }}</span> }</span>
              <span class="wk-td" role="gridcell" [attr.title]="dueTitle(row)">{{ day(row.orderDate) }} @if (row.ageDays > 0) { <span class="wk-pill fin-age" [class.tone-warn]="row.ageDays > 30">{{ row.ageDays }} d</span> }
                @if (row.kind !== 'credit') { <span class="wk-td__sub">vervalt {{ dueText(row) }}@if (row.dueDays > 0) { · <b class="fin-warn-text">{{ row.dueDays }} d te laat</b> }</span> }</span>
              <span class="wk-td wk-td--num" role="gridcell" data-hide="md">{{ row.totalEur | eur }}</span>
              <span class="wk-td wk-td--num" role="gridcell" data-hide="md">{{ row.receivedEur | eur }}</span>
              <span class="wk-td wk-td--num" role="gridcell"><b>{{ row.kind === 'credit' ? '− ' + (row.creditEur | eur) : (row.remainingEur | eur) }}</b></span>
              <span class="wk-td" role="gridcell"><app-icon class="fin-chev" name="chevron-right" [size]="14" /></span>
            </div>
          }
        </div>
      } @else {
        <div class="wk-empty"><span class="wk-empty__icon"><app-icon name="tick" [size]="22" /></span>
          <p class="wk-empty__title">{{ state.location().q || state.location().kind ? 'Niets gevonden' : 'Alle facturen zijn betaald' }}</p>
          <p class="wk-empty__text">Openstaande verkoop- en partnerfacturen verschijnen hier, de oudste eerst.</p></div>
      }
      <!-- What came in lately, under the open invoices (it used to take a click to Ontvangen). -->
      <section class="wk-card fin-recv" aria-labelledby="fin-recv-title">
        <header class="wk-card__head"><h2 class="wk-card__title" id="fin-recv-title">Laatst ontvangen</h2>
          <button class="wk-link wk-card__trail" type="button" (click)="state.go({ tab: 'received' }, 'push')">Alles bij Ontvangen ›</button></header>
        @for (payment of lastReceived(); track payment.id) {
          <button class="fin-recv__row" type="button" (click)="openReceived(payment)" appMenuTrigger (menuTrigger)="receivedMenu(payment, $event)">
            <span class="fin-recv__when">{{ moment(payment) }}</span>
            <span class="fin-recv__what">{{ payment.orderNumber }}{{ customerOf(payment) ? ' · ' + customerOf(payment) : '' }}</span>
            <span class="fin-recv__kind">{{ purpose(payment) }}</span>
            <b class="fin-recv__amount" [class.wk-amount--in]="payment.amountEur > 0">{{ payment.amountEur > 0 ? '+' : '−' }} {{ abs(payment.amountEur) | eur }}</b>
          </button>
        } @empty { <p class="wk-empty__text fin-recv__empty">Nog niets ontvangen</p> }
      </section>
    } @else {
      <div class="ios-headline">
        <div class="ios-headline__label">Nog open</div>
        <div class="ios-headline__value">{{ totals().openEur | eur }}</div>
        <div class="ios-headline__sub">{{ totals().count }} {{ totals().count === 1 ? 'factuur' : 'facturen' }}@if (totals().creditEur > 0) { · Tegoeden − {{ totals().creditEur | eur }} }</div>
      </div>
      <div class="ios-chips" role="group" aria-label="Soort">
        <button class="ios-chip" type="button" [attr.aria-pressed]="!state.location().kind" (click)="state.go({ kind: '' })">Alle</button>
        <button class="ios-chip" type="button" [attr.aria-pressed]="state.location().kind === 'customer'" (click)="state.go({ kind: 'customer' })">Klanten</button>
        <button class="ios-chip" type="button" [attr.aria-pressed]="state.location().kind === 'partner'" (click)="state.go({ kind: 'partner' })">Partners</button>
        <button class="ios-chip" type="button" [attr.aria-pressed]="state.location().kind === 'credit'" (click)="state.go({ kind: 'credit' })">Tegoeden</button>
      </div>
      @if (rows().length) {
        <div class="ios-group">
          @for (row of rows(); track row.key) {
            <button class="ios-cell ios-cell--tall" [class.fin-credit-row]="row.kind === 'credit'" type="button" (click)="state.inspectItem({ kind: 'invoice', id: row.id })">
              <span class="ios-cell__body"><span class="ios-cell__title fin-wrapall">@if (row.kind === 'credit') { <i class="fin-dot-plum" aria-hidden="true"></i> }{{ row.number }}{{ row.customer ? ' · ' + row.customer : '' }}</span>
                <span class="ios-cell__sub fin-wrapall">{{ kindLabel(row) }}@if (row.kind === 'credit' && row.creditedInvoiceNumber) { · op {{ row.creditedInvoiceNumber }} } · <span [class.fin-warn-text]="row.kind !== 'credit' && row.ageDays > 30">sinds {{ row.ageDays }} d</span>@if (row.kind !== 'credit') { · {{ row.dueDays > 0 ? 'vervallen' : 'vervalt' }} {{ day(row.dueDate) }}@if (row.dueDays > 0) { · <b class="fin-warn-text">{{ row.dueDays }} d te laat</b> } }{{ row.receivedEur > 0 ? ' · deels betaald' : '' }}</span></span>
              <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ row.kind === 'credit' ? '− ' + (row.creditEur | eur) : (row.remainingEur | eur) }}</span></span>
              <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
            </button>
          }
        </div>
      } @else if (state.location().kind) {
        <div class="ios-empty"><span class="ios-empty__icon"><app-icon name="search" [size]="26" /></span><p class="ios-empty__title">Geen facturen voor deze keuze</p>
          <button class="ios-capsule ios-capsule--tinted" type="button" (click)="state.go({ kind: '' })">Alle facturen tonen</button></div>
      } @else {
        <div class="ios-empty"><span class="ios-empty__icon"><app-icon name="tick" [size]="26" /></span><p class="ios-empty__title">Alle facturen zijn betaald</p></div>
      }
      <section class="ios-section">
        <div class="ios-section__head"><h2>Laatst ontvangen</h2></div>
        <div class="ios-group">
          @for (payment of lastReceived().slice(0, 3); track payment.id) {
            <button class="ios-cell ios-cell--tall" type="button" (click)="openReceived(payment)">
              <span class="ios-cell__body"><span class="ios-cell__title fin-wrapall">{{ payment.orderNumber }}{{ customerOf(payment) ? ' · ' + customerOf(payment) : '' }}</span>
                <span class="ios-cell__sub fin-wrapall">{{ moment(payment) }} · {{ purpose(payment) }}</span></span>
              <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong" [class.wk-amount--in]="payment.amountEur > 0">{{ payment.amountEur > 0 ? '+' : '−' }} {{ abs(payment.amountEur) | eur }}</span></span>
            </button>
          } @empty { <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__sub">Nog niets ontvangen</span></span></div> }
          <button class="ios-cell ios-cell--action" type="button" (click)="state.go({ tab: 'received' }, 'push')">Alles bij Ontvangen</button>
        </div>
      </section>
    }
  `,
})
export class ReceivablesPanel implements FinanceSectionApi {
  readonly state = inject(FinanceState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly received = viewChild(IncomingPaymentList);

  readonly rows = computed(() => {
    const { kind, q } = this.state.location();
    const needle = q.trim().toLocaleLowerCase('nl-BE');
    return this.state.receivables().filter((row) => (!kind || row.kind === kind)
      && (!needle || `${row.number} ${row.customer}`.toLocaleLowerCase('nl-BE').includes(needle)));
  });
  readonly totals = computed(() => {
    const cents = (rows: readonly ReceivableRow[], pick: (row: ReceivableRow) => number = (row) => row.remainingEur): number => rows.reduce((sum, row) => sum + Math.round(pick(row) * 100), 0) / 100;
    const rows = this.rows();
    const invoices = rows.filter((row) => row.kind !== 'credit');
    return { openEur: cents(invoices), customerEur: cents(rows.filter((row) => row.kind === 'customer')), count: invoices.length,
      partnerEur: cents(rows.filter((row) => row.kind === 'partner')), partial: invoices.filter((row) => row.receivedEur > 0).length,
      creditEur: cents(rows.filter((row) => row.kind === 'credit'), (row) => row.creditEur), creditCount: rows.filter((row) => row.kind === 'credit').length };
  });

  readonly table = new FinanceTable({
    order: () => this.rows().map((row) => row.key),
    host: () => this.host.nativeElement,
    inspect: (key) => {
      const row = this.rows().find((item) => item.key === key);
      if (row) this.state.inspectItem({ kind: 'invoice', id: row.id });
    },
  });

  readonly strip = computed<StripItem[]>(() => {
    if (this.state.location().tab === 'received') {
      const totals = this.received()?.totals();
      if (!totals) return [];
      return [
        { label: 'Ontvangen', value: formatEuro(totals.grossReceivedEur), tone: totals.grossReceivedEur ? 'in' : 'muted' },
        { label: 'Terugbetaald', value: formatEuro(totals.refundedEur), tone: totals.refundedEur ? undefined : 'muted' },
        { label: 'Netto', value: formatEuro(totals.receivedEur), tone: totals.receivedEur ? 'strong' : 'muted' },
        { label: 'Verrekend', value: formatEuro(totals.offsetEur), tone: 'muted', title: 'Creditnota\u2019s verrekend met facturen: geen geld op de bank.' },
        { label: 'Klantbetalingen', value: formatEuro(totals.standardEur), tone: 'muted' },
        { label: 'Partnervoorschotten', value: formatEuro(totals.partnerAdvanceEur), tone: 'muted', title: 'Een partnervoorschot is financiering, geen omzet.' },
        { label: 'Partnerafrekeningen', value: formatEuro(totals.partnerSettlementEur), tone: 'muted' },
      ];
    }
    const totals = this.totals();
    return [
      { label: 'Nog open', value: formatEuro(totals.openEur), tone: 'strong' },
      { label: 'Klanten', value: formatEuro(totals.customerEur) },
      { label: 'Partners', value: formatEuro(totals.partnerEur) },
      ...(totals.creditEur > 0 ? [{ label: 'Tegoeden', value: `− ${formatEuro(totals.creditEur)}`, title: 'Creditnota\u2019s die nog verrekend of terugbetaald moeten worden.' } as StripItem] : []),
      { label: 'Deels betaald', value: String(totals.partial), tone: 'muted' },
    ];
  });
  readonly status = computed(() => {
    if (this.state.location().tab === 'received') {
      const count = this.received()?.filtered().length ?? 0;
      return `${count} ${count === 1 ? 'boeking' : 'boekingen'}`;
    }
    const totals = this.totals();
    return `${totals.count} ${totals.count === 1 ? 'factuur' : 'facturen'}${totals.creditCount ? ` · ${totals.creditCount} ${totals.creditCount === 1 ? 'creditnota' : 'creditnota\u2019s'}` : ''}`;
  });

  constructor() {
    effect(() => { this.rows(); untracked(() => this.table.prune()); });
  }

  handle(command: FinanceCommand): boolean {
    if (this.state.location().tab === 'received') return this.received()?.handle(command) ?? false;
    if (this.table.handle(command)) return true;
    const focus = this.rows().find((row) => row.key === this.table.selection().focus);
    if ((command === 'open' || command === 'edit') && focus) {
      this.state.openInvoice(focus.id);
      return true;
    }
    return false;
  }

  menu(row: ReceivableRow, anchor: MenuPoint): void {
    this.state.openMenu({ title: row.number, anchor, items: [{ id: 'open', label: row.kind === 'credit' ? 'Creditnota openen' : 'Factuur openen', iconName: 'document' }],
      pick: () => this.state.openInvoice(row.id) });
  }

  /** The five newest receipts (verrekeningen are no money in): the "Laatst ontvangen" card. */
  readonly lastReceived = computed(() => uniqueIncomingPayments(this.state.incomingPayments()).filter((payment) => payment.offsetPaymentId == null).slice(0, 5));
  /** "8 okt · 23:21" ("8 okt 2025 · …" in another year, "· GMT+8" in another zone), in the receipt's own zone; a date-only receipt reads "14 okt". */
  moment(payment: { receivedAt: string; timeZone: string }): string {
    return paymentMomentLabel(payment, this.state.today(), true);
  }
  /**
   * A receipt of "Laatst ontvangen": its invoice in the inspector while that invoice is still open. A paid one has no
   * inspector (it left Openstaand), so the desk opens the invoice and the phone the receipt's menu, as Ontvangen does.
   */
  openReceived(payment: IncomingMoneyRow): void {
    if (this.state.receivables().some((row) => row.id === payment.salesOrderId)) { this.state.inspectItem({ kind: 'invoice', id: payment.salesOrderId }); return; }
    if (this.state.desk()) this.state.openInvoice(payment.salesOrderId);
    else receiptMenu(this.state, payment, null);
  }
  /** Right-click on a desk row: the invoice, and the container of a partner receipt (Ontvangen's menu). */
  receivedMenu(payment: IncomingMoneyRow, anchor: MenuPoint): void { receiptMenu(this.state, payment, anchor); }
  purpose(payment: { purpose: 'STANDARD' | 'PARTNER_ADVANCE' | 'PARTNER_SETTLEMENT' }): string { return incomingPurposeLabel(payment.purpose); }
  customerOf(payment: { customerId: number | null }): string { return this.state.customerNames().get(payment.customerId ?? -1) ?? ''; }
  abs(value: number): number { return Math.abs(value); }
  /** "11 okt" or "over 12 d" for a due day still to come. */
  dueText(row: ReceivableRow): string { return row.dueDays < 0 ? `over ${-row.dueDays} d` : dayMonth(row.dueDate); }
  /** Without a due date on the invoice the day is 30 days after it, and the cell says so. */
  dueTitle(row: ReceivableRow): string | null {
    return row.kind !== 'credit' && !row.view.order.invoiceDueDate ? 'Geen vervaldag op de factuur: 30 dagen na factuurdatum' : null;
  }
  kindLabel(row: ReceivableRow): string { return row.kind === 'credit' ? 'Tegoed' : KIND_LABEL[row.purpose] ?? 'Klant'; }
  day(date: string): string { return dayMonth(date); }
}
