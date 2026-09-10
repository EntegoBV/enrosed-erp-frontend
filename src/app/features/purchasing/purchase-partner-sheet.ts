import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { messageOf } from '../../core/api/errors';
import { Customer, PurchaseOrder, SalesOrderView } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { DateNlPipe, EurPipe } from '../../shared/pipes';
import { Sheet, Ui } from '../../shared/ui';
import { isSettlementInvoice } from '../sales/partner-settlement';
import { STATUS_LABEL } from '../sales/quote-status';

/**
 * Ties an existing invoice to this container as the partner's
 * document, after the fact. Handy when the invoice to the partner was made
 * by hand first and the container only later turns out to be co-financed.
 */
@Component({
  selector: 'app-purchase-partner-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, EurPipe, DateNlPipe],
  template: `
    <app-sheet title="Bestaande factuur koppelen" (closed)="closed.emit()">
      <div body class="pp">
        <p class="pp__intro">Welke factuur hoort bij de partner voor {{ order().alias || order().number }}? Na het koppelen telt deze container als partnercontainer in de analyses.</p>
        <div class="field">
          <label for="pp-search">Document zoeken</label>
          <input class="input" id="pp-search" type="search" placeholder="Zoek op nummer of klant" autocomplete="off"
                 [value]="query()" (input)="query.set($any($event.target).value)" />
        </div>
        @if (loading()) {
          <p class="muted">Documenten laden…</p>
        } @else if (!visible().length) {
          <p class="muted">Geen beschikbare factuur gevonden.</p>
        } @else {
          <ul class="pp__list" role="listbox" aria-label="Verkoopdocumenten">
            @for (row of visible(); track row.order.id) {
              <li>
                <button type="button" role="option" [attr.aria-selected]="chosen() === row.order.id" [class.is-on]="chosen() === row.order.id" (click)="chosen.set(row.order.id)">
                  <b>{{ row.order.number }}</b>
                  <small>{{ customerName(row.order.customerId) }} · {{ row.order.docType === 'FACTUUR' ? 'Factuur' : 'Offerte' }} · {{ statusLabel[row.order.status] }} · {{ row.order.orderDate | dateNl }}@if (row.order.partnerPurchaseOrderId && row.order.partnerPurchaseOrderId !== order().id) { · al aan een andere container gekoppeld }</small>
                  <span>{{ row.priced.totals.total | eur: 0 }}</span>
                </button>
              </li>
            }
          </ul>
          @if (hidden() > 0) { <p class="muted">Nog {{ hidden() }} meer; zoek gerichter.</p> }
        }
        <div class="field pp__share">
          <label for="pp-share">Ons deel van de winst na de veiling</label>
          <span class="pp__pct"><input class="input num right" id="pp-share" type="number" min="0" max="100" step="0.5" inputmode="decimal"
                 [value]="sharePct()" (input)="setShare($any($event.target).value)" /><i>%</i></span>
        </div>
      </div>
      <div foot style="display:contents">
        <span class="spacer"></span>
        <button class="btn" type="button" [disabled]="busy()" (click)="closed.emit()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="busy() || chosen() === null" (click)="link()">{{ busy() ? 'Bezig…' : 'Koppelen' }}</button>
      </div>
    </app-sheet>
  `,
  styles: `
    :host { display: contents; }
    .pp { display: grid; gap: 12px; }
    .pp__intro { margin: 0; color: var(--ink-2); font-size: 13px; line-height: 1.5; }
    .pp__list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; max-height: 40vh; overflow: auto; }
    .pp__list button { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'name total' 'meta total'; width: 100%; padding: 9px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .pp__list button.is-on { border-color: var(--rose); background: var(--rose-soft); }
    .pp__list b { grid-area: name; font-size: 13px; }
    .pp__list small { grid-area: meta; color: var(--muted); font-size: 11px; }
    .pp__list span { grid-area: total; align-self: center; font-variant-numeric: tabular-nums; font-weight: 650; }
    .pp__share { max-width: 260px; }
    .pp__pct { display: flex; align-items: center; gap: 6px; }
    .pp__pct .input { flex: 1; min-width: 0; }
    .pp__pct i { color: var(--muted); font-style: normal; font-size: 13px; }
    .muted { margin: 0; color: var(--muted); font-size: 12.5px; }
  `,
})
export class PurchasePartnerSheet {
  private readonly sales = inject(SalesApi);
  private readonly ui = inject(Ui);

  readonly order = input.required<PurchaseOrder>();
  /** Share the container already runs on, when a document is linked. */
  readonly currentShare = input<number | null>(null);
  readonly closed = output<void>();
  readonly linked = output<SalesOrderView>();

  readonly statusLabel = STATUS_LABEL;
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly query = signal('');
  readonly chosen = signal<number | null>(null);
  readonly sharePct = signal(50);
  private readonly documents = signal<SalesOrderView[]>([]);
  private readonly customers = signal<Customer[]>([]);

  readonly matches = computed(() => {
    const needle = normalise(this.query());
    const mine = this.order().id;
    const rows = this.documents()
      .filter((row) => row.order.docType === 'FACTUUR' && !row.order.archivedAt && row.order.partnerPurchaseOrderId !== mine && !isSettlementInvoice(row.order)
        && row.order.status !== 'GEANNULEERD' && row.order.status !== 'AFGEWEZEN' && row.order.status !== 'VERLOPEN')
      .sort((left, right) => right.order.id - left.order.id);
    if (!needle) return rows;
    return rows.filter((row) => normalise(`${row.order.number} ${this.customerName(row.order.customerId)}`).includes(needle));
  });
  readonly visible = computed(() => this.matches().slice(0, SHOWN));
  readonly hidden = computed(() => Math.max(0, this.matches().length - SHOWN));

  constructor() {
    queueMicrotask(() => {
      this.sharePct.set(this.currentShare() ?? 50);
      void this.load();
    });
  }

  private async load(): Promise<void> {
    try {
      const [documents, customers] = await Promise.all([this.sales.orders(), this.sales.customers().catch(() => [] as Customer[])]);
      this.documents.set(documents);
      this.customers.set(customers);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Documenten laden mislukt'), 'err');
    } finally {
      this.loading.set(false);
    }
  }

  customerName(id: number | null | undefined): string {
    return this.customers().find((row) => row.id === id)?.company ?? '';
  }

  setShare(value: string): void {
    const parsed = Number(value);
    this.sharePct.set(Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0);
  }

  async link(): Promise<void> {
    const document = this.documents().find((row) => row.order.id === this.chosen());
    if (!document || document.order.docType !== 'FACTUUR' || document.order.archivedAt || this.busy()) return;
    this.busy.set(true);
    try {
      const view = await this.sales.setPartnerDeal(document.order.id, {
        purchaseOrderId: this.order().id, sharePct: this.sharePct(), reference: this.order().number,
      });
      this.ui.toast(`${view.order.number} gekoppeld als partnerdocument`, 'ok');
      this.linked.emit(view);
      this.closed.emit();
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Koppelen mislukt'), 'err');
    } finally {
      this.busy.set(false);
    }
  }
}

const SHOWN = 30;

function normalise(value: string | null | undefined): string {
  return (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
