import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, forwardRef, inject, signal, untracked } from '@angular/core';
import { Payee, PurchaseOrderView } from '../../core/api/models';
import { Icon } from '../../shared/icon';
import { MenuTrigger } from '../../shared/menu-trigger';
import { EurPipe } from '../../shared/pipes';
import { Skeleton } from '../../shared/skeleton';
import { containerCostRows, containerCostTotals, reconciliationStatusLabel } from '../purchasing/purchase-reconciliation-metrics';
import { paymentPayeeLabel } from './cost-ledger';
import { PAYEE_TONES, dayMonth } from './finance-format';
import { FINANCE_SECTION, FinanceSectionApi, StripItem } from './finance-section';
import type { FinanceCommand } from './finance-shortcuts';
import { FinanceState, formatEuro } from './finance-state';
import { FinanceTable } from './finance-table';
import type { MenuPoint } from '../../shared/context-menu-position';

const STATUS_LABEL: Readonly<Record<string, string>> = { CONCEPT: 'Concept', BESTELD: 'Besteld', ONDERWEG: 'Onderweg', ONTVANGEN: 'Ontvangen' };

/**
 * Uitgaven › Containers: what was agreed, paid and is still open per
 * container, read-only. Container payments are purchasing, not company
 * costs: no btw is derived and they are managed on the container.
 */
@Component({
  selector: 'app-container-payments-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: FINANCE_SECTION, useExisting: forwardRef(() => ContainerPaymentsPanel) }],
  imports: [Icon, EurPipe, Skeleton, MenuTrigger],
  template: `
    @if (state.purchaseFiguresVisible()) {
      @if (state.desk()) {
        <p class="fin-note-line"><app-icon name="info" [size]="14" />Containerbetalingen zijn inkoop, geen bedrijfskosten; btw wordt niet afgeleid.</p>
        @if (state.containersLoading() && !state.purchaseViews().length) {
          <app-skeleton kind="list" [rows]="6" />
        } @else if (rows().length) {
          <div class="wk-table fin-table fin-table--containers" role="grid" aria-label="Containers">
            <div class="wk-thead" role="row">
              <span class="wk-th" role="columnheader">Container</span>
              <span class="wk-th" role="columnheader" data-hide="xs">Status</span>
              <span class="wk-th wk-th--num" role="columnheader" data-hide="sm">Afspraak</span>
              <span class="wk-th wk-th--num" role="columnheader">Betaald</span>
              <span class="wk-th wk-th--num" role="columnheader">Open</span>
              <span class="wk-th" role="columnheader"><span class="fin-sr">Uitklappen</span></span>
            </div>
            @for (row of rows(); track row.view.order.id) {
              @let view = row.view;
              <div class="wk-tr wk-tr--link" role="row" [attr.tabindex]="table.stop() === key(view) ? 0 : -1" [attr.data-key]="key(view)" [attr.aria-selected]="table.isSelected(key(view))"
                   [attr.aria-expanded]="expanded().has(view.order.id)" (focus)="table.focused(key(view))" (click)="table.click(key(view), $event)" (dblclick)="toggle(view.order.id)"
                   appMenuTrigger (menuTrigger)="menu(view, $event)">
                <span class="wk-td" role="gridcell"><b>{{ view.order.number }}</b>{{ view.order.alias ? ' · ' + view.order.alias : '' }}
                  @if (view.order.archivedAt) { <span class="wk-pill wk-pill--outline">gearchiveerd</span> }</span>
                <span class="wk-td" role="gridcell" data-hide="xs"><span class="wk-pill" [class.tone-ok]="row.reconciliation.totals.finalized">{{ statusOf(view) }}</span></span>
                <span class="wk-td wk-td--num" role="gridcell" data-hide="sm">{{ row.reconciliation.totals.plannedExternalEur | eur }}</span>
                <span class="wk-td wk-td--num" role="gridcell">{{ row.reconciliation.totals.paidEur | eur }}</span>
                <span class="wk-td wk-td--num" role="gridcell"><b [class.wk-amount--warn]="row.reconciliation.totals.remainingEur > 0.005">{{ row.reconciliation.totals.remainingEur | eur }}</b></span>
                <span class="wk-td" role="gridcell"><button class="wk-group__toggle" type="button" tabindex="-1" [attr.aria-expanded]="expanded().has(view.order.id)" aria-label="Details tonen" (click)="$event.stopPropagation(); toggle(view.order.id)"><app-icon name="chevron-down" [size]="14" /></button></span>
              </div>
              @if (expanded().has(view.order.id)) {
                <div class="fin-expand" role="row">
                  <div class="fin-expand__streams">
                    @for (stream of row.reconciliation.streams; track stream.payee) {
                      <div class="fin-stream">
                        <div class="fin-stream__head"><span [class]="'wk-dot tone-' + payeeTone(stream.payee)"></span><b>{{ payee(stream.payee) }}</b><span class="wk-amount--muted">{{ streamStatus(stream) }}</span></div>
                        <dl class="fin-stream__figures"><div><dt>Afspraak</dt><dd>{{ stream.plannedEur | eur }}</dd></div><div><dt>Betaald</dt><dd>{{ stream.paidEur | eur }}</dd></div><div><dt>Open</dt><dd>{{ stream.remainingEur | eur }}</dd></div></dl>
                        @if (stream.payee === 'SUPPLIER') {
                          @for (term of row.reconciliation.supplierInstalments ?? []; track term.due) {
                            <div class="fin-stream__term"><span>{{ term.label }}</span><span>{{ term.paidEur | eur }} van {{ term.plannedEur | eur }}</span></div>
                          }
                        }
                      </div>
                    }
                  </div>
                  <div class="fin-expand__payments">
                    <b>Betalingen</b>
                    @for (payment of state.paymentsFor(view.order.id); track payment.id) {
                      <div class="fin-pay-line"><span>{{ day(payment.paidOn) }}</span><span>{{ payment.label || payee(payment.payee ?? 'SUPPLIER') }}</span><b>{{ payment.amountEur | eur }}</b></div>
                    } @empty { <p class="fin-hint">Nog geen betalingen.</p> }
                    <button class="wk-link" type="button" (click)="state.openContainer(view.order.id)">Beheren bij de container ›</button>
                  </div>
                </div>
              }
            }
          </div>
        } @else {
          <div class="wk-empty"><span class="wk-empty__icon"><app-icon name="truck" [size]="22" /></span><p class="wk-empty__title">Geen containers met open bedragen</p>
            <p class="wk-empty__text">Kies Alles om ook afgeronde containers te zien.</p></div>
        }
      } @else {
        <div class="ios-chips" role="group" aria-label="Welke containers">
          <button class="ios-chip" type="button" [attr.aria-pressed]="!state.location().scope" (click)="state.go({ scope: '' })">Lopend</button>
          <button class="ios-chip" type="button" [attr.aria-pressed]="state.location().scope === 'all'" (click)="state.go({ scope: 'all' })">Alles</button>
          @if (state.location().container) { <button class="ios-chip" type="button" aria-pressed="true" (click)="state.go({ container: null })" aria-label="Filter op container wissen">{{ rows()[0]?.view?.order?.number ?? 'Container' }} <app-icon name="close" [size]="12" /></button> }
        </div>
        <p class="ios-section__foot fin-ios-note">Containerbetalingen zijn inkoop, geen bedrijfskosten; btw wordt niet afgeleid.</p>
        @if (state.containersLoading() && !state.purchaseViews().length) {
          <div class="ios-card"><app-skeleton kind="list" [rows]="4" /></div>
        } @else if (rows().length) {
          <div class="ios-group ios-group--icons">
            @for (row of rows(); track row.view.order.id) {
              <button class="ios-cell ios-cell--tall" type="button" (click)="state.inspectItem({ kind: 'container', id: row.view.order.id })">
                <span class="ios-cell__lead"><span class="ios-tile ios-tile--lg ios-tile--soft tone-blue"><app-icon name="truck" [size]="18" /></span></span>
                <span class="ios-cell__body"><span class="ios-cell__title">{{ row.view.order.number }}{{ row.view.order.alias ? ' · ' + row.view.order.alias : '' }}</span>
                  <span class="ios-cell__sub">Betaald {{ row.reconciliation.totals.paidEur | eur }} · Open {{ row.reconciliation.totals.remainingEur | eur }}</span></span>
                <span class="ios-cell__trail"><span class="wk-pill" [class.tone-ok]="row.reconciliation.totals.finalized">{{ statusOf(row.view) }}</span></span>
                <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
              </button>
            }
          </div>
        } @else {
          <div class="ios-empty"><span class="ios-empty__icon"><app-icon name="truck" [size]="26" /></span><p class="ios-empty__title">Geen containers met open bedragen</p></div>
        }
      }
    }
  `,
})
export class ContainerPaymentsPanel implements FinanceSectionApi {
  readonly state = inject(FinanceState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly expanded = signal<ReadonlySet<number>>(new Set());

  readonly rows = computed(() => {
    const location = this.state.location();
    if (!this.state.purchaseFiguresVisible()) return [];
    if (location.container) return containerCostRows(this.state.purchaseViews(), 'all').filter((row) => row.view.order.id === location.container);
    return containerCostRows(this.state.purchaseViews(), location.scope === 'all' ? 'all' : 'open', location.q);
  });
  readonly totals = computed(() => containerCostTotals(this.rows()));

  readonly table = new FinanceTable({
    order: () => this.rows().map((row) => this.key(row.view)),
    host: () => this.host.nativeElement,
    inspect: (key) => this.state.inspectItem({ kind: 'container', id: Number(key.split(':')[1]) }),
  });

  readonly strip = computed<StripItem[] | null>(() => {
    if (!this.state.purchaseFiguresVisible()) return null;
    const totals = this.totals();
    return [
      { label: 'Afspraak', value: formatEuro(totals.plannedEur) },
      { label: 'Betaald', value: formatEuro(totals.paidEur) },
      { label: 'Open', value: formatEuro(totals.remainingEur), tone: totals.remainingEur > 0 ? 'warn' : 'muted' },
    ];
  });
  readonly status = computed(() => `${this.rows().length} ${this.rows().length === 1 ? 'container' : 'containers'}`);

  constructor() {
    /* ?container=<id> (from the purchase order) opens that container once: expanded on a desk, as a sheet on a phone. */
    let opened: number | null = null;
    effect(() => {
      const id = this.state.location().container;
      const present = this.rows().some((row) => row.view.order.id === id);
      if (!id || !present || id === opened) return;
      opened = id;
      untracked(() => {
        if (!this.state.desk()) { this.state.inspectItem({ kind: 'container', id }); return; }
        this.expanded.update((set) => new Set([...set, id]));
        setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>(`[data-key="container:${id}"]`)?.scrollIntoView({ block: 'nearest' }));
      });
    });
  }

  handle(command: FinanceCommand): boolean {
    if (this.table.handle(command)) return true;
    const focus = this.table.selection().focus;
    if (!focus) return false;
    const id = Number(focus.split(':')[1]);
    if (command === 'open') { this.toggle(id); return true; }
    if (command === 'edit') { this.state.openContainer(id); return true; }
    return false;
  }

  /**
   * 'Exporteer CSV': every payment of the containers on screen (Lopend or
   * Alles, the search, or the one ?container), whatever their date.
   */
  exportCsv(): void {
    const location = this.state.location();
    const ids = new Set(location.container ? [location.container] : this.rows().map((row) => row.view.order.id));
    const name = location.container ? this.rows()[0]?.view.order.number ?? `container-${location.container}` : location.scope === 'all' ? 'alle' : 'lopend';
    this.state.exportCsv(this.state.ledger().filter((row) => !!row.payment && ids.has(row.payment.orderId)),
      `containerbetalingen-${name}-${this.state.today()}.csv`);
  }

  toggle(id: number): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  menu(view: PurchaseOrderView, anchor: MenuPoint): void {
    this.state.openMenu({ title: view.order.number, anchor, items: [{ id: 'open', label: 'Bij de container openen', iconName: 'external' }],
      pick: () => this.state.openContainer(view.order.id) });
  }

  key(view: PurchaseOrderView): string { return `container:${view.order.id}`; }
  statusOf(view: PurchaseOrderView): string { return view.reconciliation?.totals?.finalized ? 'Afgerond' : STATUS_LABEL[view.order.status] ?? view.order.status; }
  payee(code: Payee): string { return paymentPayeeLabel(code); }
  payeeTone(code: string): string { return PAYEE_TONES[code] ?? 'grey'; }
  streamStatus(stream: Parameters<typeof reconciliationStatusLabel>[0]): string { return reconciliationStatusLabel(stream); }
  day(date: string): string { return dayMonth(date); }
}
