import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, forwardRef, inject, untracked, viewChild } from '@angular/core';
import { Icon } from '../../shared/icon';
import { MenuTrigger } from '../../shared/menu-trigger';
import { EurPipe } from '../../shared/pipes';
import { dayMonth } from './finance-format';
import { FINANCE_SECTION, FinanceSectionApi, StripItem } from './finance-section';
import type { FinanceCommand } from './finance-shortcuts';
import { FinanceState, ReceivableRow, formatEuro } from './finance-state';
import { FinanceTable } from './finance-table';
import { IncomingPaymentList } from './incoming-payment-list';
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
            <span class="wk-th" role="columnheader">Factuurdatum</span>
            <span class="wk-th wk-th--num" role="columnheader" data-hide="md">Totaal</span>
            <span class="wk-th wk-th--num" role="columnheader" data-hide="md">Ontvangen</span>
            <span class="wk-th wk-th--num" role="columnheader">Nog open</span>
            <span class="wk-th" role="columnheader"><span class="fin-sr">Openen</span></span>
          </div>
          @for (row of rows(); track row.key) {
            <div class="wk-tr wk-tr--link" role="row" [attr.tabindex]="table.stop() === row.key ? 0 : -1" [attr.data-key]="row.key" [attr.aria-selected]="table.isSelected(row.key)"
                 (focus)="table.focused(row.key)" (click)="table.click(row.key, $event)" (dblclick)="state.openInvoice(row.id)" appMenuTrigger (menuTrigger)="menu(row, $event)">
              <span class="wk-td" role="gridcell"><b>{{ row.number }}</b></span>
              <span class="wk-td" role="gridcell">{{ row.customer || '—' }}</span>
              <span class="wk-td" role="gridcell" data-hide="sm"><span class="wk-pill" [class.tone-plum]="row.kind === 'partner'">{{ kindLabel(row) }}</span></span>
              <span class="wk-td" role="gridcell">{{ day(row.orderDate) }} @if (row.ageDays > 0) { <span class="wk-pill fin-age" [class.tone-warn]="row.ageDays > 30">{{ row.ageDays }} d</span> }</span>
              <span class="wk-td wk-td--num" role="gridcell" data-hide="md">{{ row.totalEur | eur }}</span>
              <span class="wk-td wk-td--num" role="gridcell" data-hide="md">{{ row.receivedEur | eur }}</span>
              <span class="wk-td wk-td--num" role="gridcell"><b>{{ row.remainingEur | eur }}</b></span>
              <span class="wk-td" role="gridcell"><app-icon class="fin-chev" name="chevron-right" [size]="14" /></span>
            </div>
          }
        </div>
      } @else {
        <div class="wk-empty"><span class="wk-empty__icon"><app-icon name="tick" [size]="22" /></span>
          <p class="wk-empty__title">{{ state.location().q || state.location().kind ? 'Niets gevonden' : 'Alle facturen zijn betaald' }}</p>
          <p class="wk-empty__text">Openstaande verkoop- en partnerfacturen verschijnen hier, de oudste eerst.</p></div>
      }
    } @else {
      <div class="ios-headline">
        <div class="ios-headline__label">Nog open</div>
        <div class="ios-headline__value">{{ totals().openEur | eur }}</div>
        <div class="ios-headline__sub">{{ rows().length }} {{ rows().length === 1 ? 'factuur' : 'facturen' }}</div>
      </div>
      <div class="ios-chips" role="group" aria-label="Soort">
        <button class="ios-chip" type="button" [attr.aria-pressed]="!state.location().kind" (click)="state.go({ kind: '' })">Alle</button>
        <button class="ios-chip" type="button" [attr.aria-pressed]="state.location().kind === 'customer'" (click)="state.go({ kind: 'customer' })">Klanten</button>
        <button class="ios-chip" type="button" [attr.aria-pressed]="state.location().kind === 'partner'" (click)="state.go({ kind: 'partner' })">Partners</button>
      </div>
      @if (rows().length) {
        <div class="ios-group">
          @for (row of rows(); track row.key) {
            <button class="ios-cell ios-cell--tall" type="button" (click)="state.inspectItem({ kind: 'invoice', id: row.id })">
              <span class="ios-cell__body"><span class="ios-cell__title">{{ row.number }}{{ row.customer ? ' · ' + row.customer : '' }}</span>
                <span class="ios-cell__sub">{{ kindLabel(row) }} · <span [class.fin-warn-text]="row.ageDays > 30">sinds {{ row.ageDays }} d</span>{{ row.receivedEur > 0 ? ' · deels betaald' : '' }}</span></span>
              <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ row.remainingEur | eur }}</span></span>
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
    const cents = (rows: readonly ReceivableRow[]): number => rows.reduce((sum, row) => sum + Math.round(row.remainingEur * 100), 0) / 100;
    const rows = this.rows();
    return { openEur: cents(rows), customerEur: cents(rows.filter((row) => row.kind === 'customer')),
      partnerEur: cents(rows.filter((row) => row.kind === 'partner')), partial: rows.filter((row) => row.receivedEur > 0).length };
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
        { label: 'Ontvangen', value: formatEuro(totals.grossReceivedEur), tone: 'in' },
        { label: 'Terugbetaald', value: formatEuro(totals.refundedEur) },
        { label: 'Netto', value: formatEuro(totals.receivedEur), tone: 'strong' },
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
      { label: 'Deels betaald', value: String(totals.partial), tone: 'muted' },
    ];
  });
  readonly status = computed(() => {
    if (this.state.location().tab === 'received') {
      const count = this.received()?.filtered().length ?? 0;
      return `${count} ${count === 1 ? 'boeking' : 'boekingen'}`;
    }
    return `${this.rows().length} ${this.rows().length === 1 ? 'factuur' : 'facturen'}`;
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
    this.state.openMenu({ title: row.number, anchor, items: [{ id: 'open', label: 'Factuur openen', iconName: 'document' }],
      pick: () => this.state.openInvoice(row.id) });
  }

  kindLabel(row: ReceivableRow): string { return KIND_LABEL[row.purpose] ?? 'Klant'; }
  day(date: string): string { return dayMonth(date); }
}
