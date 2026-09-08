import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PartnerFinancing, PurchaseOrder, SalesOrderView } from '../../core/api/models';
import { SourcingApi } from '../../core/api/sourcing-api';
import { SalesApi } from '../../core/api/sales-api';
import { messageOf } from '../../core/api/errors';
import { EurPipe, NumPipe } from '../../shared/pipes';
import { SalesReceipts } from '../sales/sales-receipts';

/** One receipt ledger, shown from the partner invoice and the container alike. */
@Component({
  selector: 'app-purchase-partner-payments',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EurPipe, NumPipe, SalesReceipts],
  template: `
    @if (order().partnerCustomerId != null) {
      <section class="partner-money" aria-label="Partnerfinanciering en ontvangsten">
        <header><div><span class="eyebrow">Samen inkopen</span><h3>{{ summary()?.partnerName || 'Partnerfinanciering' }}</h3></div><button class="btn btn--sm" type="button" [disabled]="loading()" (click)="load()">Vernieuwen</button></header>
        @if (error()) { <p class="partner-money__error" role="alert">{{ error() }}</p> }
        @if (summary(); as summary) {
          <p class="partner-money__hint">Partner financiert {{ summary.costPct | num }}% van de containerkost. ENROSED ontvangt {{ summary.profitSharePct | num }}% van het veilingresultaat. Dit percentage staat los van het betaalplan.</p>
          <p class="partner-money__plan">{{ summary.paymentPlan === 'THIRD_TWO_THIRDS_PRODUCTION' ? 'Betaalplan: 1/3 bij start productie · 2/3 na productie' : 'Betaalplan: volledige betaling' }}</p>
          <div class="partner-money__kpis"><div><small>Voorschotten ontvangen</small><b>{{ summary.receivedAdvanceEur | eur }}</b></div><div><small>Voorschotten open</small><b>{{ summary.openAdvanceEur | eur }}</b></div><div><small>Slotfactuur open</small><b>{{ summary.openSettlementEur | eur }}</b></div><div><small>Eigen kasinleg</small><b>{{ summary.ownExposureEur | eur }}</b></div></div>
          <p class="partner-money__hint">Ontvangen en open bedragen zijn incl. btw. Eigen kasinleg = werkelijk betaalde containerkosten min werkelijk ontvangen partnerbetalingen.</p>
          @if (summary.creditEur > 0) { <p class="partner-money__warning">{{ summary.creditEur | eur }} credit voor de partner; beoordeel verrekening of terugbetaling.</p> }
          <details class="partner-money__costs"><summary>Kost, financieringsafspraak &amp; resultaat</summary><dl><div><dt>{{ summary.costFinalized ? 'Externe containerkost' : 'Verwachte externe containerkost' }}</dt><dd>{{ summary.forecastExternalEur | eur }}</dd></div><div><dt>Afgesproken financiering</dt><dd>{{ summary.committedAdvanceEur | eur }}</dd></div><div><dt>Uitgereikte voorschotfacturen</dt><dd>{{ summary.invoicedAdvanceEur | eur }}</dd></div><div><dt>Slotfactuur na voorschotten</dt><dd>{{ summary.settlementEur | eur }}</dd></div><div><dt>Gerealiseerd resultaat</dt><dd>{{ summary.recognizedProfitEur | eur }}</dd></div></dl><p class="partner-money__hint">Deze kost- en resultaatbedragen zijn excl. btw. Een voorschot is financiering; het verkoopresultaat ontstaat bij de slotafrekening.</p></details>
          <div class="partner-money__docs">
            @for (doc of summary.documents; track doc.id) {
              <article><div><a [routerLink]="['/sales', doc.id]">{{ doc.number }} · {{ doc.purpose === 'PARTNER_SETTLEMENT' ? 'slotfactuur' : doc.docType === 'FACTUUR' ? 'voorschotfactuur' : 'voorschotofferte' }}</a><small>{{ doc.invoiceTotalEur | eur }} incl. btw @if (doc.docType === 'FACTUUR') { · {{ doc.receivedEur | eur }} ontvangen · {{ doc.remainingEur | eur }} open }</small>@if (doc.creditEur > 0) { <small>{{ doc.creditEur | eur }} credit</small> }</div>@if (doc.docType === 'FACTUUR') { <button class="btn btn--sm" type="button" [disabled]="opening()" (click)="open(doc.id)">Betalingen</button> }</article>
            } @empty { <p class="partner-money__hint">Maak de voorschotofferte via Partnercontainer bij de ordergegevens.</p> }
          </div>
          @if (selected(); as selectedDoc) { <div class="partner-money__selected"><header><b>{{ selectedDoc.order.number }}</b><button class="btn btn--sm" type="button" (click)="selected.set(null)">Sluiten</button></header><app-sales-receipts [view]="selectedDoc" (changed)="received($event)" /></div> }
          @if (summary.payments.length) {
            <details><summary>Alle ontvangsten op deze container · {{ summary.payments.length }}</summary><div class="partner-money__trail">@for (payment of summary.payments; track payment.id) { <a [routerLink]="['/sales', payment.salesOrderId]"><b>{{ payment.amountEur | eur }}</b><span>{{ payment.orderNumber }} · {{ stamp(payment.receivedAt, payment.timeZone) }}</span><small>{{ payment.reference || 'Geen referentie' }}@if (payment.legacy) { · historische ontvangst }</small></a> }</div></details>
          }
        } @else if (loading()) { <p class="partner-money__hint">Partnerfinanciering laden…</p> }
      </section>
    }
  `,
  styles: `
    :host{display:block;min-width:0}.partner-money{margin:12px 0;padding:14px;border:1px solid var(--rose-line);border-radius:14px;background:var(--surface)}header{display:flex;align-items:center;justify-content:space-between;gap:10px}.eyebrow{font-size:10px;color:var(--rose-dark);text-transform:uppercase;font-weight:700}h3{margin:4px 0;font-size:16px}.partner-money__hint{font-size:11px;line-height:1.5;color:var(--muted);margin:10px 0}.partner-money__plan{padding:10px;font-size:11px;line-height:1.5;border-radius:10px;background:var(--rose-soft)}.partner-money__kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.partner-money__kpis>div{display:grid;gap:4px}.partner-money__kpis small{font-size:10px;color:var(--muted)}.partner-money__kpis b{font-size:15px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.partner-money__costs dl{display:grid;gap:8px;margin:8px 0}.partner-money__costs dl>div{display:flex;justify-content:space-between;gap:10px;font-size:11px}.partner-money__costs dt{color:var(--muted)}dd{margin:0;font-weight:650;white-space:nowrap}.partner-money__docs article{display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:1px solid var(--line);padding:11px 0}.partner-money__docs article>div{display:grid;gap:4px;min-width:0}.partner-money__docs a{font-size:12px;font-weight:650;overflow-wrap:anywhere;color:var(--rose-dark)}.partner-money__docs small{font-size:10px;color:var(--muted)}.partner-money__warning,.partner-money__error{padding:10px;border-radius:10px;background:var(--warn-soft);font-size:11px;line-height:1.5}.partner-money__error{color:var(--danger)}summary{font-size:11px;cursor:pointer;padding:10px 0}.partner-money__trail{display:grid;gap:10px}.partner-money__trail a{display:grid;gap:4px;color:inherit;text-decoration:none}.partner-money__trail span,.partner-money__trail small{font-size:10px;color:var(--muted)}.partner-money__selected{border-top:1px solid var(--line);padding-top:10px}.partner-money__selected>header>b{font-size:12px}
  `,
})
export class PurchasePartnerPayments {
  readonly order = input.required<PurchaseOrder>();
  readonly docs = input<SalesOrderView[]>([]);
  readonly landedTotalEur = input(0);
  readonly changed = output<void>();
  readonly summary = signal<PartnerFinancing | null>(null);
  readonly selected = signal<SalesOrderView | null>(null);
  readonly loading = signal(false);
  readonly opening = signal(false);
  readonly error = signal('');
  private readonly sourcing = inject(SourcingApi);
  private readonly sales = inject(SalesApi);
  private version = 0;
  constructor() { effect(() => { const order = this.order(); this.docs(); if (order.partnerCustomerId != null) void this.load(order.id); }); }
  async load(id = this.order().id): Promise<void> {
    const version = ++this.version; this.loading.set(true); this.error.set('');
    try { const summary = await this.sourcing.partnerFinancing(id); if (version === this.version) this.summary.set(summary); }
    catch (failure: unknown) { if (version === this.version) this.error.set(messageOf(failure, 'Partnerfinanciering laden mislukt')); }
    finally { if (version === this.version) this.loading.set(false); }
  }
  async open(id: number): Promise<void> {
    this.opening.set(true); this.error.set('');
    try { this.selected.set(await this.sales.order(id)); }
    catch (failure: unknown) { this.error.set(messageOf(failure, 'Factuurbetalingen laden mislukt')); }
    finally { this.opening.set(false); }
  }
  received(view: SalesOrderView): void { this.selected.set(view); void this.load(); this.changed.emit(); }
  stamp(instant: string, timeZone: string): string { try { return new Intl.DateTimeFormat('nl-BE', { timeZone, dateStyle: 'short', timeStyle: 'medium' }).format(new Date(instant)); } catch { return instant; } }
}
