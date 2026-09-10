import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PartnerFinancing, PurchaseOrder, SalesOrderView } from '../../core/api/models';
import { SourcingApi } from '../../core/api/sourcing-api';
import { SalesApi } from '../../core/api/sales-api';
import { messageOf } from '../../core/api/errors';
import { EurPipe, NumPipe } from '../../shared/pipes';
import { SalesReceipts } from '../sales/sales-receipts';
import { PartnerAdvanceSchedule } from './partner-advance-schedule';
import { STATUS_LABEL } from '../sales/quote-status';

/** One receipt ledger, shown from the partner invoice and the container alike. */
@Component({
  selector: 'app-purchase-partner-payments',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { id: 'purchase-partner-payments', tabindex: '-1' },
  imports: [RouterLink, EurPipe, NumPipe, SalesReceipts, PartnerAdvanceSchedule],
  template: `
    @if (order().partnerCustomerId != null) {
      <section class="partner-money" aria-label="Partnerfinanciering en ontvangsten">
        <header class="partner-money__head"><div><span class="eyebrow">Partnerfinanciering</span><h3>{{ summary()?.partnerName || 'Samen inkopen' }}</h3></div><button class="btn btn--sm" type="button" [disabled]="loading()" (click)="load()">Vernieuwen</button></header>
        @if (error()) { <p class="partner-money__error" role="alert">{{ error() }}</p> }
        @if (summary(); as summary) {
          <section class="money-section" aria-label="Financieringsafspraak">
            <h4><span class="step">1</span> De afspraak</h4>
            <div class="agreement-grid">
              <div><small>Partner financiert</small><strong>{{ summary.costPct | num }}%</strong><b>{{ summary.committedAdvanceEur | eur }}</b><span>van de externe containerkosten, excl. btw</span></div>
              <div><small>Veilingresultaat voor ENROSED</small><strong>{{ summary.profitSharePct | num }}%</strong><b>{{ 100 - summary.profitSharePct | num }}% voor de partner</b><span>Verdeling van winst of verlies na de veiling</span></div>
            </div>
            <p class="partner-money__hint">De partner stort aan ENROSED. Zijn financieringsaandeel en de verdeling van het veilingresultaat zijn twee afzonderlijke afspraken.</p>
          </section>

          <app-partner-advance-schedule [purchaseOrderId]="order().id" [documents]="docs()" (saved)="refresh()" (invoiceCreated)="created($event)" (openInvoice)="open($event)" (quote)="quote.emit()" />

          <section class="money-section" aria-label="Ontvangsten van de partner">
            <h4><span class="step">3</span> Ontvangsten &amp; afrekening</h4>
            <div class="partner-money__kpis">
              <div class="received"><small>Voorschotten ontvangen</small><b>{{ summary.receivedAdvanceEur | eur }}</b></div>
              <div><small>Voorschotten nog open</small><b>{{ summary.openAdvanceEur | eur }}</b></div>
              <div><small>Veiling&shy;afrekeningen open</small><b>{{ summary.openSettlementEur | eur }}</b></div>
              <div><small>Eigen geld ingelegd</small><b>{{ summary.ownExposureEur | eur }}</b></div>
            </div>
            <p class="partner-money__hint">Bedragen incl. btw. Eigen geld = betaalde containerkosten min netto partnerontvangsten.</p>
            @if (summary.creditEur > 0) { <p class="partner-money__warning"><b>{{ summary.creditEur | eur }} terug te betalen of te verrekenen.</b> Open de betreffende factuur om een uitgevoerde terugbetaling te noteren.</p> }
            @if (invoices().length) {
              <label class="invoice-picker"><span>Betaling bij een factuur noteren</span><select class="select" [disabled]="opening()" [value]="invoiceSelection() || ''" (change)="selectInvoice($any($event.target).value)"><option value="">Kies een factuur…</option>@for (doc of invoices(); track doc.id) { <option [value]="doc.id">{{ doc.number }} · {{ statusLabel[doc.status] }} · {{ doc.invoiceTotalEur | eur }}</option> }</select></label>
              <p class="partner-money__hint">Noteer het ontvangen bedrag met datum en tijdstip. De factuur moet daarvoor uitgegeven zijn.</p>
            } @else { <p class="money-empty">Er zijn nog geen facturen om betalingen bij te noteren. Maak eerst een voorschotfactuur bij een termijn hierboven.</p> }
            @if (opening()) { <p class="partner-money__hint" role="status">Factuurbetalingen laden…</p> }
            @if (selected(); as selectedDoc) { <div class="partner-money__selected" #selectedInvoice tabindex="-1"><header><div><small>Betalingen bij factuur</small><b>{{ selectedDoc.order.number }}</b></div><button class="btn btn--sm" type="button" (click)="closeInvoice()">Sluiten</button></header><app-sales-receipts [view]="selectedDoc" (changed)="received($event)" /></div> }
          </section>

          <div class="partner-money__details">
            <details><summary>Alle offertes &amp; facturen <span>{{ summary.documents.length }}</span></summary>
              <div class="partner-money__docs">@for (doc of summary.documents; track doc.id) {
                <article><div><a [routerLink]="['/sales', doc.id]">{{ doc.number }}</a><small>{{ doc.purpose === 'PARTNER_SETTLEMENT' ? 'Veilingafrekening' : doc.docType === 'FACTUUR' ? 'Voorschotfactuur' : 'Voorschotofferte' }} · {{ statusLabel[doc.status] }}</small>@if (doc.docType === 'FACTUUR') { <b>{{ doc.invoiceTotalEur | eur }} <small>incl. btw</small></b> } @else { <small>Betaalafspraken · afrekening volgt later</small> }@if (doc.docType === 'FACTUUR') { @if (doc.status === 'CONCEPT') { <small>Concept · nog niet uitgegeven</small> } @else { <small>{{ doc.receivedEur | eur }} netto ontvangen · {{ doc.remainingEur | eur }} open</small> } }@if (doc.creditEur > 0) { <small>{{ doc.creditEur | eur }} credit</small> }</div>@if (doc.docType === 'FACTUUR') { <button class="btn btn--sm" type="button" [disabled]="opening()" (click)="open(doc.id)">Betalingen bekijken</button> }</article>
              } @empty { <p class="partner-money__hint">Nog geen partnerdocumenten gekoppeld.</p> }</div>
            </details>
            @if (summary.payments.length) {
              <details><summary>Betaalhistorie <span>{{ summary.payments.length }}</span></summary><div class="partner-money__trail">@for (payment of summary.payments; track payment.id) { <a [routerLink]="['/sales', payment.salesOrderId]"><b>{{ (payment.amountEur < 0 ? -payment.amountEur : payment.amountEur) | eur }} {{ payment.amountEur < 0 ? 'terugbetaald' : 'ontvangen' }}</b><span>{{ payment.orderNumber }} · {{ stamp(payment.receivedAt, payment.timeZone) }}</span><small>{{ payment.reference || 'Geen referentie' }}@if (payment.legacy) { · historische ontvangst }</small></a> }</div></details>
            }
            <details class="partner-money__costs"><summary>Kostprijs &amp; gerealiseerd resultaat</summary><dl><div><dt>{{ summary.costFinalized ? 'Externe containerkost' : 'Verwachte externe containerkost' }}</dt><dd>{{ summary.forecastExternalEur | eur }}</dd></div><div><dt>Afgesproken financiering</dt><dd>{{ summary.committedAdvanceEur | eur }}</dd></div><div><dt>Uitgereikte voorschotfacturen</dt><dd>{{ summary.invoicedAdvanceEur | eur }}</dd></div><div><dt>Afrekeningen na voorschotten</dt><dd>{{ summary.settlementEur | eur }}</dd></div><div><dt>Gerealiseerd resultaat ENROSED</dt><dd>{{ summary.recognizedProfitEur | eur }}</dd></div></dl><p class="partner-money__hint">Deze bedragen zijn excl. btw. Voorschotten zijn financiering; resultaat wordt vastgelegd bij elke uitgegeven veilingafrekening.</p></details>
          </div>
        } @else if (loading()) { <p class="partner-money__hint">Partnerfinanciering laden…</p> }
      </section>
    }
  `,
  styles: `
    :host{display:block;min-width:0;scroll-margin-top:calc(var(--appbar-h) + 90px)}.partner-money{margin:16px 0;border:1px solid var(--line);border-radius:16px;background:var(--surface);overflow:hidden}
    .partner-money__head{padding:18px;background:var(--rose-soft);border-bottom:1px solid var(--rose-line)}header{display:flex;align-items:center;justify-content:space-between;gap:12px}header>div{min-width:0}.eyebrow{font-size:11px;color:var(--rose-dark);font-weight:700;letter-spacing:.04em}h3{margin:5px 0 0;font-size:19px;overflow-wrap:anywhere}
    .money-section{padding:18px}.money-section+.money-section{border-top:1px solid var(--line)}h4{display:flex;align-items:center;gap:9px;margin:0 0 15px;font-size:15px;font-weight:700}.step{display:inline-grid;place-items:center;flex:none;width:26px;height:26px;border-radius:50%;background:var(--rose-soft);color:var(--rose-dark);font-size:12px}
    .agreement-grid,.partner-money__kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.agreement-grid>div{display:grid;align-content:start;gap:7px;padding:13px;border-radius:12px;background:var(--surface-2)}.agreement-grid small{font-size:12px;line-height:1.4;color:var(--ink-2)}.agreement-grid strong{font-size:25px;line-height:1.15;letter-spacing:-.03em}.agreement-grid b{font-size:13px;overflow-wrap:anywhere}.agreement-grid span{font-size:12px;line-height:1.5;color:var(--muted)}
    .partner-money__hint{font-size:12px;line-height:1.6;color:var(--muted);margin:12px 0 0}.partner-money__kpis>div{display:grid;gap:7px;padding:12px;border:1px solid var(--line);border-radius:10px}.partner-money__kpis .received{border-color:var(--rose-line);background:var(--rose-soft)}.partner-money__kpis small{font-size:12px;line-height:1.4;color:var(--ink-2)}.partner-money__kpis b{font-size:17px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
    .invoice-picker{display:grid;gap:7px;margin-top:20px;font-size:13px;font-weight:650}.invoice-picker select{min-width:0;width:100%;min-height:46px;font-size:14px}.money-empty{margin:16px 0 0;padding:12px;border-left:3px solid var(--rose-line);font-size:13px;line-height:1.6;color:var(--ink-2);background:var(--surface-2)}
    .partner-money__details{padding:0 18px 6px}.partner-money__details>details{border-top:1px solid var(--line)}summary{min-height:48px;padding:14px 0;font-size:13px;font-weight:650;cursor:pointer}summary>span{margin-left:6px;padding:2px 7px;border-radius:6px;background:var(--surface-2);color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
    .partner-money__costs dl{display:grid;gap:12px;margin:8px 0}.partner-money__costs dl>div{display:flex;justify-content:space-between;gap:14px;font-size:12px;line-height:1.5}.partner-money__costs dt{color:var(--muted)}dd{margin:0;font-weight:650;white-space:nowrap}
    .partner-money__docs article{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:13px 0;border-top:1px solid var(--line)}.partner-money__docs article:first-child{border-top:0}.partner-money__docs article>div{display:grid;gap:6px;min-width:0}.partner-money__docs a{font-size:14px;font-weight:650;overflow-wrap:anywhere;color:var(--rose-dark)}.partner-money__docs small{font-size:12px;color:var(--muted);font-weight:400}.partner-money__docs b{font-size:14px}
    .partner-money__warning,.partner-money__error{padding:12px;margin:14px 0;border-radius:10px;background:var(--warn-soft);font-size:13px;line-height:1.6}.partner-money__error{color:var(--danger)}.partner-money__trail{display:grid;gap:14px;padding-bottom:14px}.partner-money__trail a{display:grid;gap:5px;color:inherit;text-decoration:none;font-size:13px}.partner-money__trail span,.partner-money__trail small{font-size:12px;color:var(--muted);overflow-wrap:anywhere}.partner-money__selected{margin-top:20px;padding-top:16px;border-top:1px solid var(--line)}.partner-money__selected header>div{display:grid;gap:5px}.partner-money__selected header small{font-size:12px;color:var(--muted)}.partner-money__selected header b{font-size:15px;overflow-wrap:anywhere}
    .btn{min-height:44px;white-space:normal}select:focus-visible,summary:focus-visible{outline:2px solid var(--rose-dark);outline-offset:3px}
    @media(max-width:359px){.partner-money__kpis{grid-template-columns:1fr}.partner-money__kpis>div{grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px}.partner-money__kpis b{white-space:nowrap}}
    @media(max-width:420px){.partner-money__head,.money-section{padding:14px}.agreement-grid{grid-template-columns:1fr}.agreement-grid>div{grid-template-columns:minmax(0,1fr) auto;column-gap:12px}.agreement-grid small,.agreement-grid b{grid-column:1}.agreement-grid strong{grid-column:2;grid-row:1/3;align-self:center}.agreement-grid span{grid-column:1/-1}.partner-money__kpis{gap:8px}.partner-money__kpis b{font-size:15px}.partner-money__kpis>div{padding:10px}.invoice-picker select{font-size:16px}.partner-money__details{padding:0 14px 6px}.partner-money__costs dl>div{flex-wrap:wrap;gap:3px}.partner-money__costs dd{margin-left:auto}}
  `,
})
export class PurchasePartnerPayments {
  readonly order = input.required<PurchaseOrder>();
  readonly docs = input<SalesOrderView[]>([]);
  readonly landedTotalEur = input(0);
  readonly changed = output<void>();
  readonly quote = output<void>();
  readonly summary = signal<PartnerFinancing | null>(null);
  readonly invoices = computed(() => this.summary()?.documents.filter(doc => doc.docType === 'FACTUUR') ?? []);
  readonly statusLabel = STATUS_LABEL;
  readonly selected = signal<SalesOrderView | null>(null);
  readonly invoiceSelection = signal<number | null>(null);
  readonly loading = signal(false);
  readonly opening = signal(false);
  readonly error = signal('');
  private readonly sourcing = inject(SourcingApi);
  private readonly sales = inject(SalesApi);
  private readonly selectedInvoice = viewChild<ElementRef<HTMLElement>>('selectedInvoice');
  private version = 0;
  constructor() { effect(() => { const order = this.order(); this.docs(); if (order.partnerCustomerId != null) void this.load(order.id); }); }
  async load(id = this.order().id): Promise<void> {
    const version = ++this.version; this.loading.set(true); this.error.set('');
    try { const summary = await this.sourcing.partnerFinancing(id); if (version === this.version) this.summary.set(summary); }
    catch (failure: unknown) { if (version === this.version) this.error.set(messageOf(failure, 'Partnerfinanciering laden mislukt')); }
    finally { if (version === this.version) this.loading.set(false); }
  }
  selectInvoice(value: string): void { if (value) void this.open(Number(value)); else this.closeInvoice(); }
  closeInvoice(): void { this.selected.set(null); this.invoiceSelection.set(null); }
  async open(id: number): Promise<void> {
    if (this.opening()) return;
    this.invoiceSelection.set(id); this.selected.set(null);
    this.opening.set(true); this.error.set('');
    try { this.selected.set(await this.sales.order(id)); this.focusSelected(); }
    catch (failure: unknown) { this.invoiceSelection.set(null); this.error.set(messageOf(failure, 'Factuurbetalingen laden mislukt')); }
    finally { this.opening.set(false); }
  }
  received(view: SalesOrderView): void { this.invoiceSelection.set(view.order.id); this.selected.set(view); void this.load(); this.changed.emit(); }
  created(view: SalesOrderView): void { this.received(view); this.focusSelected(); }
  private focusSelected(): void { requestAnimationFrame(() => { const target = this.selectedInvoice()?.nativeElement; target?.scrollIntoView({ behavior: 'smooth', block: 'start' }); target?.focus({ preventScroll: true }); }); }
  refresh(): void { void this.load(); this.changed.emit(); }
  stamp(instant: string, timeZone: string): string { try { return new Intl.DateTimeFormat('nl-BE', { timeZone, dateStyle: 'short', timeStyle: 'medium' }).format(new Date(instant)); } catch { return instant; } }
}
