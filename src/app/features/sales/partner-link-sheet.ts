import { isPartnerDocument } from './sales-payment-state';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { messageOf } from '../../core/api/errors';
import { PurchaseOrderView, SalesOrder, SalesOrderView, Supplier } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { DateNlPipe, EurPipe } from '../../shared/pipes';
import { Sheet, Ui } from '../../shared/ui';

/**
 * Ties a quote or invoice to the container a partner co-finances, after
 * the fact. A container we first paid ourselves can still become a partner
 * deal once the partner takes the goods over; the analyses then count its
 * money apart from ours.
 */
@Component({
  selector: 'app-partner-link-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, EurPipe, DateNlPipe],
  template: `
    <app-sheet title="Container en soort verkoop" (closed)="closed.emit()">
      <div body class="pl">
        <div class="per-toggle" role="group" aria-label="Soort verkoop"><button type="button" [class.on]="!partner()" (click)="partner.set(false)">Reguliere verkoop</button><button type="button" [class.on]="partner()" (click)="partner.set(true)">Partnercontainer</button></div>
        <p class="pl__intro">{{ partner() ? 'Voorschot voor samen inkopen. De container en winstdeling worden gekoppeld; er geldt geen minimumorder.' : 'Gewone verkoop, met deze container als herkomst. Dit document financiert geen partnercontainer.' }}</p>
        <div class="field">
          <label for="pl-search">Container zoeken</label>
          <input class="input" id="pl-search" type="search" placeholder="Zoek op nummer, naam of leverancier" autocomplete="off"
                 [value]="query()" (input)="query.set($any($event.target).value)" />
        </div>
        @if (loading()) {
          <p class="muted">Containers laden…</p>
        } @else if (!visible().length) {
          <p class="muted">Geen container gevonden.</p>
        } @else {
          <ul class="pl__list" role="listbox" aria-label="Containers">
            @for (row of visible(); track row.order.id) {
              <li>
                <button type="button" role="option" [attr.aria-selected]="chosen() === row.order.id" [class.is-on]="chosen() === row.order.id" (click)="chosen.set(row.order.id)">
                  <b>{{ row.order.alias || row.order.number }}</b>
                  <small>{{ row.order.alias ? row.order.number + ' · ' : '' }}{{ supplierName(row.order.supplierId) }} · {{ row.order.orderDate | dateNl }}</small>
                  <span>{{ row.costing.totals.totalEur | eur: 0 }}</span>
                </button>
              </li>
            }
          </ul>
          @if (hidden() > 0) { <p class="muted">Nog {{ hidden() }} meer; zoek gerichter.</p> }
        }
        @if (partner()) { <div class="field pl__share">
          <label for="pl-share">Ons deel van de winst na de veiling</label>
          <span class="pl__pct"><input class="input num right" id="pl-share" type="number" min="0" max="100" step="0.5" inputmode="decimal"
                 [value]="sharePct()" (input)="setShare($any($event.target).value)" /><i>%</i></span>
        </div> }
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
    .pl { display: grid; gap: 12px; }
    .pl__intro { margin: 0; color: var(--ink-2); font-size: 13px; line-height: 1.5; }
    .pl__list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; max-height: 40vh; overflow: auto; }
    .pl__list button { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'name total' 'meta total'; width: 100%; padding: 9px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .pl__list button.is-on { border-color: var(--rose); background: var(--rose-soft); }
    .pl__list b { grid-area: name; font-size: 13px; }
    .pl__list small { grid-area: meta; color: var(--muted); font-size: 11px; }
    .pl__list span { grid-area: total; align-self: center; font-variant-numeric: tabular-nums; font-weight: 650; }
    .pl__share { max-width: 260px; }
    .pl__pct { display: flex; align-items: center; gap: 6px; }
    .pl__pct .input { flex: 1; min-width: 0; }
    .pl__pct i { color: var(--muted); font-style: normal; font-size: 13px; }
    .muted { margin: 0; color: var(--muted); font-size: 12.5px; }
  `,
})
export class PartnerLinkSheet {
  private readonly sales = inject(SalesApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);

  readonly order = input.required<SalesOrder>();
  readonly closed = output<void>();
  readonly linked = output<SalesOrderView>();

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly query = signal('');
  readonly chosen = signal<number | null>(null);
  readonly sharePct = signal(50);
  readonly partner = signal(true);
  private readonly containers = signal<PurchaseOrderView[]>([]);
  private readonly suppliers = signal<Supplier[]>([]);

  readonly matches = computed(() => {
    const needle = normalise(this.query());
    const rows = [...this.containers()].sort((left, right) => right.order.id - left.order.id);
    if (!needle) return rows;
    return rows.filter((row) => normalise([row.order.number, row.order.alias, this.supplierName(row.order.supplierId)].filter(Boolean).join(' ')).includes(needle));
  });
  readonly visible = computed(() => this.matches().slice(0, SHOWN));
  readonly hidden = computed(() => Math.max(0, this.matches().length - SHOWN));

  constructor() {
    queueMicrotask(() => {
      const current = this.order();
      this.chosen.set(current.partnerPurchaseOrderId ?? current.sourcePurchaseOrderId ?? null);
      this.partner.set(isPartnerDocument(current) || !current.sourcePurchaseOrderId);
      this.sharePct.set(current.partnerSharePct ?? 50);
      void this.load();
    });
  }

  private async load(): Promise<void> {
    try {
      const [containers, suppliers] = await Promise.all([this.sourcing.purchaseOrders(), this.sourcing.suppliers().catch(() => [] as Supplier[])]);
      this.containers.set(containers);
      this.suppliers.set(suppliers);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Containers laden mislukt'), 'err');
    } finally {
      this.loading.set(false);
    }
  }

  supplierName(id: number | null | undefined): string {
    return this.suppliers().find((row) => row.id === id)?.name ?? '';
  }

  setShare(value: string): void {
    const parsed = Number(value);
    this.sharePct.set(Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0);
  }

  async link(): Promise<void> {
    const container = this.containers().find((row) => row.order.id === this.chosen());
    if (!container || this.busy()) return;
    this.busy.set(true);
    try {
      const view = await this.sales.setPartnerDeal(this.order().id, {
        purchaseOrderId: container.order.id, sharePct: this.partner() ? this.sharePct() : null, reference: container.order.number,
        purpose: this.partner() ? 'PARTNER_ADVANCE' : 'STANDARD',
        paymentPlan: this.partner() ? 'THIRD_TWO_THIRDS_PRODUCTION' : 'FULL',
      });
      this.ui.toast(`${view.order.number} gekoppeld aan ${container.order.alias || container.order.number}`, 'ok');
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
