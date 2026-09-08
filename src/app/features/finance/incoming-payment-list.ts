import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { Customer } from '../../core/api/models';
import { DateField } from '../../shared/date-field';
import { EurPipe } from '../../shared/pipes';
import { bankAccountKey } from './bank-reconciliation';
import { MONTH_START, TODAY } from './finance-sections';
import { IncomingMoneyRow, incomingPurposeLabel, paymentLocalDay, paymentMomentLabel, uniqueIncomingPayments } from './incoming-money';

interface ReceiptRow extends IncomingMoneyRow { bankAccount?: string | null; }
type ReceiptDirection = 'ALL' | 'INCOMING' | 'REFUND';
type ReceiptPurpose = 'ALL' | IncomingMoneyRow['purpose'];

@Component({
  selector: 'app-incoming-payment-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, EurPipe, DateField],
  template: `
    <p class="receipt-copy">Werkelijk ontvangen bedragen en terugbetalingen bij verkoopfacturen. Partnervoorschotten en veilingafrekeningen staan apart herkenbaar in deze lijst.</p>
    <div class="receipt-filters">
      <label class="field receipt-search"><span>Zoeken in factuurboekingen</span><input class="input" type="search" placeholder="Factuur, klant of mededeling…" [ngModel]="search()" (ngModelChange)="search.set($event); expanded.set(false)" /></label>
      <label class="field"><span>Soort boeking</span><select class="input" [ngModel]="direction()" (ngModelChange)="direction.set($event); expanded.set(false)"><option value="ALL">Ontvangsten &amp; terugbetalingen</option><option value="INCOMING">Ontvangsten</option><option value="REFUND">Terugbetalingen</option></select></label>
      <label class="field"><span>Waarvoor</span><select class="input" [ngModel]="purpose()" (ngModelChange)="purpose.set($event); expanded.set(false)"><option value="ALL">Alle facturen</option><option value="STANDARD">Reguliere verkoop</option><option value="PARTNER_ADVANCE">Partnervoorschotten</option><option value="PARTNER_SETTLEMENT">Partnerafrekeningen</option></select></label>
    </div>
    <div class="receipt-period" role="group" aria-label="Periode voor factuurboekingen"><span>Periode</span><button type="button" [attr.aria-pressed]="monthSelected()" (click)="setPeriod('MONTH')">Deze maand</button><button type="button" [attr.aria-pressed]="allDatesSelected()" (click)="setPeriod('ALL')">Alle datums</button></div>
    <details class="receipt-extra"><summary>Rekening &amp; periode{{ account() || from() || to() ? ' · actief' : '' }}</summary><div class="receipt-extra__fields">
      <label class="field"><span>Rekening op de factuurbetaling</span><select class="input" [ngModel]="account()" (ngModelChange)="account.set($event); expanded.set(false)"><option value="">Alle rekeningen</option><option value="__MISSING__">Geen rekening genoteerd</option>@for (item of accounts(); track item) { <option [value]="item">{{ item }}</option> }</select></label>
      <div class="field"><label [attr.for]="fieldId + '-from'">Vanaf betaaldatum</label><app-date-field [fieldId]="fieldId + '-from'" [value]="from()" (valueChange)="from.set($event); expanded.set(false)" /></div>
      <div class="field"><label [attr.for]="fieldId + '-to'">Tot en met betaaldatum</label><app-date-field [fieldId]="fieldId + '-to'" [value]="to()" (valueChange)="to.set($event); expanded.set(false)" /></div>
    </div><p class="receipt-copy">Dit is de rekening die op de factuurbetaling is genoteerd. Een afzonderlijke bankkoppeling kan de rekening bepalen wanneer deze hier ontbreekt.</p></details>
    @if (invalidPeriod()) { <p class="receipt-error" role="alert">De einddatum moet op of na de begindatum liggen.</p> }
    <div class="receipt-selection"><span>{{ filtered().length }} van {{ rows().length }} factuurboekingen</span>@if (hasFilters()) { <button class="linklike" type="button" (click)="clearFilters()">Filters wissen</button> }</div>
    <div class="receipt-totals" aria-label="Factuurboekingen in deze selectie"><div><small>Ontvangen</small><b>{{ totals().received | eur }}</b></div><div><small>Terugbetaald</small><b>{{ totals().refunded | eur }}</b></div><div><small>Netto ontvangen</small><b>{{ totals().net | eur }}</b></div></div>
    @for (row of visible(); track row.id) {
      <article class="receipt">
        <div class="receipt__body">
          <span class="receipt__purpose">{{ purposeLabel(row.purpose) }}</span>
          <a [routerLink]="['/sales', row.salesOrderId]">{{ row.orderNumber }}{{ customerName(row.customerId) ? ' · ' + customerName(row.customerId) : '' }} ›</a>
          <small>{{ momentLabel(row) }}</small>
          @if (row.bankAccount) { <small>Rekening: {{ row.bankAccount }}</small> } @else { <small>Geen rekening op de factuurbetaling genoteerd</small> }
          @if (row.reference) { <small>{{ row.reference }}</small> }
          @if (row.purchaseOrderId) { <a class="receipt__container" [routerLink]="['/purchasing', row.purchaseOrderId]" [queryParams]="{ section: 'payments' }">Betalingen bij de container ›</a> }
          @if (row.legacy) { <small>Overgenomen uit eerdere betaaldregistratie</small> }
        </div>
        <div class="receipt__money" [class.receipt__money--refund]="row.amountEur < 0"><b>{{ row.amountEur > 0 ? '+' : '' }}{{ row.amountEur | eur }}</b><span>{{ row.amountEur < 0 ? 'Terugbetaald' : 'Ontvangen' }}</span></div>
      </article>
    } @empty { <div class="receipt-empty"><b>{{ rows().length ? 'Geen factuurboekingen gevonden' : 'Nog geen ontvangsten of terugbetalingen' }}</b><p>{{ rows().length ? 'Pas je zoekopdracht of filters aan.' : 'Registreer een betaling bij de factuur, of koppel een genoteerde bankbeweging aan de factuur.' }}</p></div> }
    @if (!expanded() && filtered().length > limit()) { <button class="btn receipt-more" type="button" (click)="expanded.set(true)">Alle {{ filtered().length }} factuurboekingen tonen</button> }
    @if (expanded() && filtered().length > limit()) { <button class="linklike receipt-more" type="button" (click)="expanded.set(false)">Minder tonen</button> }
  `,
  styles: `
    .receipt-period{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin-top:14px}.receipt-period>span{font-size:12px;color:var(--muted);margin-right:3px}.receipt-period button{min-height:40px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink-2);font:inherit;font-size:12px;cursor:pointer}.receipt-period button[aria-pressed="true"]{background:var(--rose-soft);border-color:var(--rose-line);color:var(--rose-dark);font-weight:650}.receipt-period button:focus-visible{outline:2px solid var(--rose-dark);outline-offset:3px}
    :host{display:block;min-width:0}.receipt-copy{font-size:13px;line-height:1.7;color:var(--muted);margin:10px 0 16px}.receipt-filters{display:grid;grid-template-columns:1.4fr repeat(2,minmax(0,1fr));gap:12px}.field{min-width:0}.field>span,.field>label{font-size:12px;font-weight:650}.input{min-width:0;width:100%;min-height:44px}.receipt-extra{margin-top:8px}.receipt-extra summary{cursor:pointer;color:var(--muted);font-size:12px;min-height:40px;padding:12px 0}.receipt-extra__fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding-bottom:5px}.receipt-extra summary:focus-visible{outline:2px solid var(--rose-dark);outline-offset:3px}.receipt-selection{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:40px;font-size:12px;color:var(--muted)}.receipt-selection .linklike{min-height:40px}.receipt-totals{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:14px;border-radius:12px;background:var(--surface-2);margin:6px 0 12px}.receipt-totals>div{display:grid;gap:6px;min-width:0}.receipt-totals small{font-size:12px;color:var(--muted)}.receipt-totals b{font-size:17px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.receipt{display:grid;grid-template-columns:minmax(0,1fr) minmax(110px,auto);gap:18px;padding:17px 0;border-bottom:1px solid var(--line)}.receipt:last-child{border-bottom:0}.receipt__body{display:grid;gap:6px;min-width:0}.receipt small{color:var(--muted);font-size:12px;line-height:1.5;overflow-wrap:anywhere}.receipt__purpose{font-size:11px;font-weight:650;color:var(--muted)}.receipt a{color:var(--rose-dark);font-size:14px;font-weight:650;text-decoration:none;overflow-wrap:anywhere;line-height:1.5}.receipt .receipt__container{font-size:12px;font-weight:500}.receipt__money{display:grid;gap:5px;justify-items:end;align-content:start;color:var(--ok);min-width:0}.receipt__money b{font-size:18px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.receipt__money span{font-size:11px}.receipt__money--refund{color:var(--ink-2)}.receipt-empty{text-align:center;padding:28px 12px;font-size:14px}.receipt-empty p{font-size:13px;color:var(--muted);line-height:1.6}.receipt-more{margin-top:16px;min-height:44px}.receipt-error{color:var(--danger);font-size:13px;line-height:1.6}
    @media(max-width:850px){.receipt-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.receipt-search{grid-column:1/-1}.receipt-extra__fields{grid-template-columns:repeat(2,minmax(0,1fr))}.receipt-extra__fields>.field:first-child{grid-column:1/-1}}
    @media(max-width:600px){.input{font-size:16px}.receipt-filters,.receipt-extra__fields{grid-template-columns:1fr}.receipt-totals{gap:8px;padding:12px}.receipt-totals b{font-size:15px}.receipt{grid-template-columns:minmax(0,1fr);gap:10px}.receipt__money{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}.receipt__money b{font-size:19px}}
  `,
})
export class IncomingPaymentList {
  private static nextId = 0;
  readonly fieldId = `factuurboekingen-${++IncomingPaymentList.nextId}`;
  readonly payments = input<readonly ReceiptRow[]>([]);
  readonly customers = input<readonly Customer[]>([]);
  readonly limit = input(12);
  readonly expanded = signal(false);
  readonly search = signal('');
  readonly direction = signal<ReceiptDirection>('ALL');
  readonly purpose = signal<ReceiptPurpose>('ALL');
  readonly account = signal('');
  readonly from = signal('');
  readonly to = signal('');
  readonly monthSelected = computed(() => this.from() === MONTH_START && this.to() === TODAY);
  readonly allDatesSelected = computed(() => !this.from() && !this.to());
  readonly rows = computed(() => uniqueIncomingPayments(this.payments()) as ReceiptRow[]);
  private readonly customerNames = computed(() => new Map(this.customers().map(customer => [customer.id, customer.company])));
  readonly accounts = computed(() => [...new Set(this.rows().map(row => bankAccountKey(row.bankAccount)).filter(Boolean))].sort());
  readonly invalidPeriod = computed(() => !!this.from() && !!this.to() && this.from() > this.to());
  readonly hasFilters = computed(() => !!this.search().trim() || this.direction() !== 'ALL' || this.purpose() !== 'ALL' || !!this.account() || !!this.from() || !!this.to());
  readonly filtered = computed(() => {
    if (this.invalidPeriod()) return [];
    const search = this.search().trim().toLocaleLowerCase('nl-BE');
    return this.rows().filter(row => {
      const day = paymentLocalDay(row), account = bankAccountKey(row.bankAccount);
      const text = [row.orderNumber, row.reference, this.customerName(row.customerId), row.bankAccount].join(' ').toLocaleLowerCase('nl-BE');
      return (this.direction() === 'ALL' || (this.direction() === 'INCOMING' ? row.amountEur > 0 : row.amountEur < 0))
        && (this.purpose() === 'ALL' || row.purpose === this.purpose())
        && (!this.account() || (this.account() === '__MISSING__' ? !account : account === this.account()))
        && (!this.from() || day >= this.from()) && (!this.to() || day <= this.to()) && (!search || text.includes(search));
    });
  });
  readonly visible = computed(() => this.expanded() ? this.filtered() : this.filtered().slice(0, this.limit()));
  readonly totals = computed(() => {
    const received = this.filtered().reduce((sum, row) => sum + (row.amountEur > 0 ? Math.round(row.amountEur * 100) : 0), 0);
    const refunded = this.filtered().reduce((sum, row) => sum + (row.amountEur < 0 ? -Math.round(row.amountEur * 100) : 0), 0);
    return { received: received / 100, refunded: refunded / 100, net: (received - refunded) / 100 };
  });
  readonly purposeLabel = incomingPurposeLabel;
  readonly momentLabel = paymentMomentLabel;
  customerName(id: number | null): string { return id == null ? '' : this.customerNames().get(id) ?? ''; }
  setPeriod(period: 'MONTH' | 'ALL'): void { this.from.set(period === 'MONTH' ? MONTH_START : ''); this.to.set(period === 'MONTH' ? TODAY : ''); this.expanded.set(false); }
  clearFilters(): void { this.search.set(''); this.direction.set('ALL'); this.purpose.set('ALL'); this.account.set(''); this.from.set(''); this.to.set(''); this.expanded.set(false); }
}
