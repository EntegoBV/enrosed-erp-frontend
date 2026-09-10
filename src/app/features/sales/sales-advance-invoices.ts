import { ChangeDetectionStrategy, Component, computed, effect, inject, input, OnDestroy, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { PartnerAdvanceSchedule, SalesOrder } from '../../core/api/models';
import { messageOf } from '../../core/api/errors';
import { SourcingApi } from '../../core/api/sourcing-api';
import { EurPipe } from '../../shared/pipes';
import { STATUS_LABEL } from './quote-status';
import { isAdvanceDocument } from './sales-payment-state';

/** Only an advance invoice belongs in the term-invoice navigator, never a quote or settlement. */
export function advanceInvoicePurchaseId(order: SalesOrder): number | null {
  return order.docType === 'FACTUUR' && isAdvanceDocument(order) ? order.partnerPurchaseOrderId ?? null : null;
}

@Component({
  selector: 'app-sales-advance-invoices',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EurPipe],
  template: `
    @if (purchaseOrderId(); as purchaseId) {
      <section class="advance-invoices" aria-label="Voorschotfacturen van deze container">
        <header><div><span>Partnercontainer</span><h2>Voorschotfacturen</h2></div><a [routerLink]="['/purchasing', purchaseId]" [queryParams]="{ section: 'payments' }">Betaalafspraken beheren <span aria-hidden="true">↗</span></a></header>
        <p>Elke termijn heeft een eigen factuur. Concepten zijn nog niet uitgegeven of verstuurd. De slotfactuur volgt na de veiling.</p>
        @if (loading()) { <p role="status">Factuurtermijnen laden…</p> }
        @else if (error()) { <p role="alert">{{ error() }} <button class="linklike" type="button" (click)="load(purchaseId)">Opnieuw proberen</button></p> }
        @else if (schedule(); as plan) {
          @if (plan.rows.length) {
            <nav aria-label="Andere voorschotfacturen">
              @for (row of plan.rows; track row.id) {
                <a class="advance-invoice" [class.is-current]="row.invoiceId === order().id"
                   [attr.aria-current]="row.invoiceId === order().id ? 'page' : null"
                   [routerLink]="row.invoiceId ? ['/sales', row.invoiceId] : ['/purchasing', purchaseId]"
                   [queryParams]="row.invoiceId ? null : { section: 'payments' }">
                  <span class="advance-invoice__label">{{ row.label }}</span><strong>{{ row.amountEur | eur }} <small>excl. btw</small></strong>
                  <span>{{ row.invoiceNumber || 'Nog geen factuur' }} @if (row.invoiceId === order().id) { · deze factuur }</span>
                  <small>{{ row.invoiceId === order().id ? (order().status === 'CONCEPT' ? 'Concept · nog niet uitgegeven' : statusLabel[order().status]) : row.invoiceStatus === 'CONCEPT' ? 'Concept · nog niet uitgegeven' : row.invoiceStatus ? statusLabel[row.invoiceStatus] : 'Termijn bekijken' }}</small>
                </a>
              }
            </nav>
          } @else { <p>Dit voorschot staat op één factuur. Bekijk de partnerafspraken en ontvangsten op de container.</p> }
        }
      </section>
    }
  `,
  styles: `
    :host{display:block;min-width:0}.advance-invoices{margin:14px 0;padding:16px;border:1px solid var(--rose-line);border-radius:16px;background:var(--rose-soft)}header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}header div>span{color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}h2{font-size:17px;margin:3px 0 0}header>a{font-size:12px;color:var(--rose-dark);min-height:44px;display:flex;gap:8px;align-items:center}p{font-size:12px;line-height:1.6;color:var(--muted);margin:10px 0 0}nav{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr));gap:9px;margin-top:13px}.advance-invoice{display:grid;gap:5px;min-width:0;padding:12px;background:var(--surface);border:1px solid var(--line);border-radius:11px;color:var(--ink);text-decoration:none;font-size:12px;transition:border-color .15s,background .15s}.advance-invoice:hover,.advance-invoice:focus-visible{border-color:var(--rose);background:var(--surface-2)}.advance-invoice.is-current{border-color:var(--rose);box-shadow:inset 0 0 0 1px var(--rose)}.advance-invoice__label{font-weight:650;overflow-wrap:anywhere}.advance-invoice strong{font-size:16px;font-variant-numeric:tabular-nums}.advance-invoice small{font-size:11px;font-weight:400;color:var(--muted);line-height:1.4}.advance-invoice>span{overflow-wrap:anywhere}@media(max-width:430px){.advance-invoices{padding:13px}header>a{min-height:36px}nav{grid-template-columns:1fr}.advance-invoice{grid-template-columns:minmax(0,1fr) auto}.advance-invoice strong{text-align:right}.advance-invoice>small{grid-column:1/-1}.advance-invoice strong small{display:block}}
  `,
})
export class SalesAdvanceInvoices implements OnDestroy {
  readonly order = input.required<SalesOrder>();
  readonly purchaseOrderId = computed(() => advanceInvoicePurchaseId(this.order()));
  readonly documentId = computed(() => this.order().id);
  readonly schedule = signal<PartnerAdvanceSchedule | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly statusLabel = STATUS_LABEL;
  private readonly sourcing = inject(SourcingApi);
  private version = 0;

  constructor() {
    effect(() => { const id = this.purchaseOrderId(); this.documentId(); void this.load(id); });
  }

  async load(id: number | null): Promise<void> {
    const version = ++this.version;
    this.schedule.set(null); this.error.set(''); this.loading.set(id !== null);
    if (id === null) return;
    try {
      const plan = await this.sourcing.partnerAdvanceSchedule(id);
      if (version !== this.version || id !== this.purchaseOrderId()) return;
      if (plan.purchaseOrderId !== id) throw new Error('De factuurtermijnen horen bij een andere container.');
      this.schedule.set(plan);
    } catch (failure) {
      if (version === this.version) this.error.set(messageOf(failure, 'Factuurtermijnen laden mislukt.'));
    } finally {
      if (version === this.version) this.loading.set(false);
    }
  }

  ngOnDestroy(): void { this.version++; }
}
