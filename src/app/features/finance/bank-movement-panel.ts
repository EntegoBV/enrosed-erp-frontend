import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BankingApi, BankMovementRequest, BankMatch, BankStatementLine } from '../../core/api/banking-api';
import type { SalesOrderView, SalesPayment } from '../../core/api/models';
import { messageOf } from '../../core/api/errors';
import { EurPipe } from '../../shared/pipes';
import { DateField } from '../../shared/date-field';
import { ReceiptDraft, receiptLocalParts, receiptRequest } from '../../shared/received-at';
import { Sheet, Ui } from '../../shared/ui';
import { FinanceState } from './finance-state';
import { bankAccountKey } from './bank-reconciliation';
import { paymentLocalDay, paymentMomentLabel } from './incoming-money';

interface BankDraft extends ReceiptDraft {
  account: string;
  counterparty: string;
  bankDirection: 'INCOMING' | 'OUTGOING';
  requestId: string;
}
type DirectionFilter = 'ALL' | 'INCOMING' | 'OUTGOING';
type LinkFilter = 'ALL' | 'LINKED' | 'UNLINKED';
const cents = (amount: number): number => Math.round(amount * 100);
const inactive = new Set(['CONCEPT', 'GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN']);

@Component({
  selector: 'app-bank-movement-panel', changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, EurPipe, Sheet, DateField],
  template: `
    <section class="card fin-panel bank-panel" aria-label="Handmatige bankbewegingen">
      <header class="bank-head"><div><span class="bank-kicker">Bankbewegingen</span><h2>Wat kwam binnen en ging buiten?</h2></div><button class="btn btn--primary" type="button" [disabled]="busy()" (click)="add()">+ Bankbeweging noteren</button></header>
      <p class="bank-copy">Noteer het bedrag dat werkelijk op je rekening is geboekt. Je koppelt klant- en partnerbetalingen daarna aan hun verkoopfactuur. Een leverancierbetaling kun je hier noteren; koppelen aan een inkooporder of bedrijfskost is nog niet beschikbaar.</p>
      @if (error() && !draft() && !selected()) { <p class="bank-error" role="alert">{{ error() }}</p> }
      <div class="bank-filters">
        <label class="bank-search field"><span>Zoeken</span><input class="input" type="search" placeholder="Tegenpartij, mededeling of factuur…" [ngModel]="search()" (ngModelChange)="search.set($event); shown.set(12)" /></label>
        <label class="field"><span>Rekening</span><select class="input" [ngModel]="accountFilter()" (ngModelChange)="accountFilter.set($event); shown.set(12)"><option value="">Alle rekeningen</option>@for (account of ledgerAccounts(); track account) { <option [value]="account">{{ account }}</option> }</select></label>
        <label class="field"><span>Richting</span><select class="input" [ngModel]="directionFilter()" (ngModelChange)="directionFilter.set($event); shown.set(12)"><option value="ALL">Inkomend &amp; uitgaand</option><option value="INCOMING">Inkomend</option><option value="OUTGOING">Uitgaand</option></select></label>
        <label class="field"><span>Factuurkoppeling</span><select class="input" [ngModel]="linkFilter()" (ngModelChange)="linkFilter.set($event); shown.set(12)"><option value="ALL">Alle bewegingen</option><option value="UNLINKED">Zonder factuurkoppeling</option><option value="LINKED">Gekoppeld aan factuur</option></select></label>
      </div>
      <details class="bank-period"><summary>Periode{{ from() || to() ? ' · actief' : '' }}</summary><div class="bank-period__fields"><div class="field"><label for="bank-movements-from">Vanaf bankdatum</label><app-date-field fieldId="bank-movements-from" [value]="from()" (valueChange)="from.set($event); shown.set(12)" /></div><div class="field"><label for="bank-movements-to">Tot en met bankdatum</label><app-date-field fieldId="bank-movements-to" [value]="to()" (valueChange)="to.set($event); shown.set(12)" /></div></div></details>
      @if (invalidPeriod()) { <p class="bank-error" role="alert">De einddatum moet op of na de begindatum liggen.</p> }
      <div class="bank-selection"><span>{{ filteredLines().length }} van {{ state.bankStatements().length }} bewegingen</span>@if (hasFilters()) { <button class="linklike" type="button" (click)="clearFilters()">Filters wissen</button> }</div>
      <div class="bank-totals" aria-label="Bedragen in deze selectie"><div><small>Inkomend</small><b class="money-in">{{ totals().incoming | eur }}</b></div><div><small>Uitgaand</small><b>{{ totals().outgoing | eur }}</b></div><div><small>Netto beweging</small><b>{{ totals().net | eur }}</b></div></div>
      <div class="bank-lines">@for (row of visibleLines(); track row.id) {
        <article>
          <div class="bank-line__body"><div class="bank-line__status"><span class="bank-badge" [class.bank-badge--in]="row.amountEur > 0">{{ row.amountEur > 0 ? 'Inkomend' : 'Uitgaand' }}</span><span class="bank-link-state">{{ row.salesPaymentId ? 'Gekoppeld aan factuur' : 'Geen factuurkoppeling' }}</span></div><b>{{ row.counterparty || row.reference || 'Bankbeweging' }}</b><small>{{ row.account }} · {{ stamp(row.bookedAt, row.timeZone) }}</small>@if (row.reference && row.counterparty) { <small>{{ row.reference }}</small> }@if (row.salesOrderId) { <a [routerLink]="['/sales', row.salesOrderId]">{{ invoiceNumber(row.salesOrderId) }} bekijken ›</a> }<details class="bank-record"><summary>Registratiegegevens</summary><small>Geregistreerd {{ stamp(row.recordedAt, row.timeZone) }}{{ row.actor ? ' · ' + row.actor : '' }}</small>@if (row.allocatedAt) { <small>Gekoppeld {{ stamp(row.allocatedAt, row.timeZone) }} · {{ row.allocationCreatedPayment ? 'factuurbetaling bij koppelen aangemaakt' : 'bestaande factuurbetaling gekoppeld' }}</small> }</details></div>
          <div class="bank-line__aside"><strong [class.money-in]="row.amountEur > 0">{{ row.amountEur > 0 ? '+' : '' }}{{ row.amountEur | eur }}</strong><div class="bank-actions">@if (row.salesPaymentId) { <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="unlink(row)">Koppeling losmaken</button> } @else { <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="openAllocation(row)">Aan factuur koppelen</button><button class="linklike" type="button" [disabled]="busy()" (click)="remove(row)">Intrekken</button> }</div></div>
        </article>
      } @empty { <div class="bank-empty"><b>{{ state.bankStatements().length ? 'Geen bewegingen gevonden' : 'Nog geen bankbewegingen genoteerd' }}</b><p>{{ state.bankStatements().length ? 'Pas je zoekopdracht of filters aan.' : 'Begin met een ontvangen of betaald bedrag van je bankrekening.' }}</p></div> }</div>
      @if (visibleLines().length < filteredLines().length) { <button class="btn bank-more" type="button" (click)="shown.update(more)">Meer tonen · {{ filteredLines().length - visibleLines().length }} resterend</button> }
    </section>

    @if (draft(); as draft) {
      <app-sheet title="Bankbeweging noteren" (closed)="closeDraft()"><div body>
        <p class="bank-copy">Neem bedrag, rekening en tijdstip over van je bankafschrift. Bewaren registreert de beweging; het voert geen bankbetaling uit.</p>
        <fieldset [disabled]="busy()" class="entry-grid">
          <label class="field"><span>Bankrekening</span><input class="input" maxlength="120" list="manual-bank-accounts" [ngModel]="draft.account" (ngModelChange)="patch({ account: $event })" placeholder="Rekeningnaam of IBAN" /><datalist id="manual-bank-accounts">@for (account of ledgerAccounts(); track account) { <option [value]="account"></option> }</datalist></label>
          <label class="field"><span>Richting</span><select class="input" [ngModel]="draft.bankDirection" (ngModelChange)="patch({ bankDirection: $event })"><option value="INCOMING">Inkomend · geld ontvangen</option><option value="OUTGOING">Uitgaand · geld betaald</option></select></label>
          <label class="field"><span>Bedrag in EUR</span><input class="input" type="number" min="0.01" step="0.01" inputmode="decimal" [ngModel]="draft.amount" (ngModelChange)="patch({ amount: +$event })" /><small>Voer een positief bedrag in; de richting bepaalt het teken.</small></label>
          <div class="field"><label for="manual-bank-day">Bankdatum</label><app-date-field fieldId="manual-bank-day" [value]="draft.day" (valueChange)="patch({ day: $event })" /></div>
          <label class="field"><span>Werkelijk tijdstip</span><input class="input" type="time" step="1" [ngModel]="draft.time" (ngModelChange)="patch({ time: $event })" /></label>
          <label class="field"><span>Tijdzone</span><input class="input" maxlength="64" [ngModel]="draft.timeZone" (ngModelChange)="patch({ timeZone: $event })" /></label>
          <label class="field"><span>Mededeling / referentie</span><input class="input" maxlength="500" [ngModel]="draft.reference" (ngModelChange)="patch({ reference: $event })" placeholder="Bijvoorbeeld het factuurnummer" /></label>
          <label class="field"><span>Tegenpartij (optioneel)</span><input class="input" maxlength="300" [ngModel]="draft.counterparty" (ngModelChange)="patch({ counterparty: $event })" /></label>
        </fieldset>
        <p class="bank-note">{{ draft.bankDirection === 'OUTGOING' ? 'Een leverancierbetaling telt mee op de bankrekening. Een factuurkoppeling is alleen beschikbaar voor een terugbetaling aan een klant of partner.' : 'Heb je deze ontvangst al op de factuur genoteerd? Koppel na het bewaren die bestaande betaling, zodat ze eenmaal wordt geteld.' }}</p>
        @if (error()) { <p class="bank-error" role="alert">{{ error() }}</p> }
      </div><div foot style="display:contents"><button class="btn" type="button" [disabled]="busy()" (click)="closeDraft()">Annuleren</button><span class="spacer"></span><button class="btn btn--primary" type="button" [disabled]="busy()" (click)="save()">{{ busy() ? 'Bewaren…' : 'Bankbeweging bewaren' }}</button></div></app-sheet>
    }

    @if (selected(); as row) {
      <app-sheet title="Aan verkoopfactuur koppelen" (closed)="closeAllocation()"><div body>
        <div class="allocation-movement"><span>{{ row.amountEur > 0 ? 'Ontvangen op' : 'Betaald vanaf' }} {{ row.account }}</span><strong>{{ row.amountEur | eur }}</strong><small>{{ stamp(row.bookedAt, row.timeZone) }}{{ row.counterparty ? ' · ' + row.counterparty : '' }}</small>@if (row.reference) { <small>{{ row.reference }}</small> }</div>
        <p class="bank-copy">Koppel de volledige bankbeweging aan één factuur. Als de betaling al bij de factuur staat, kies je die bestaande boeking.</p>
        @if (row.amountEur < 0) { <p class="bank-note">Hier koppel je een terugbetaling aan een klant of partner. Betalingen aan leveranciers en bedrijfskosten hebben nog geen factuurkoppeling in dit overzicht.</p> }
        @if (matchingLoading()) { <p class="bank-copy" role="status">Passende facturen en bestaande betalingen zoeken…</p> }
        @if (matches().length) {
          <h3 class="allocation-label">Voorgestelde koppelingen</h3><div role="group" aria-label="Voorgestelde factuurkoppelingen">@for (match of matches(); track matchKey(match)) {
            <button class="match" type="button" [disabled]="busy()" [attr.aria-pressed]="isChosen(match)" [class.match--selected]="isChosen(match)" (click)="chooseMatch(match)"><span class="match__kind">{{ match.existingPaymentId ? 'Bestaande boeking · geen nieuwe betaling' : row.amountEur < 0 ? 'Nieuwe terugbetaling' : 'Nieuwe ontvangst' }}</span><b>{{ match.number }}</b><span>{{ match.openEur | eur }} {{ row.amountEur < 0 ? 'terug te betalen' : 'nog te ontvangen' }}</span>@if (match.receivedAt) { <small>Geboekt {{ matchStamp(match) }}{{ match.reference ? ' · ' + match.reference : '' }}</small> }</button>
          }</div>
        }
        <label class="field allocation-picker"><span>{{ matches().length ? 'Of kies een andere factuur' : 'Kies een factuur' }}</span><select class="input" [disabled]="busy()" [ngModel]="manualInvoice()" (ngModelChange)="chooseInvoice(+$event)"><option [value]="0">Selecteer verkoopfactuur…</option>@for (view of selectableInvoices(); track view.order.id) { <option [value]="view.order.id">{{ view.order.number }} · {{ customerName(view.order.customerId) }} · {{ available(view) | eur }} {{ row.amountEur < 0 ? 'terug te betalen' : 'open' }}</option> }</select></label>
        @if (!selectableInvoices().length && !matchingLoading()) { <p class="bank-copy">{{ row.amountEur < 0 ? 'Geen uitgegeven factuur met voldoende tegoed of een passende bestaande terugbetaling gevonden.' : 'Geen uitgegeven verkoopfactuur gevonden. Geef de factuur eerst uit bij Verkooporders.' }}</p> }
        @if (manualInvoice()) {
          @if (manualMatches().length) { <p class="bank-note">Er {{ manualMatches().length === 1 ? 'is al een boeking' : 'zijn al boekingen' }} met dit bedrag en deze rekening. Kies de bestaande betaling als dit dezelfde bankbeweging is.</p> }
          @for (match of manualMatches(); track matchKey(match)) { <button class="match" type="button" [disabled]="busy()" [attr.aria-pressed]="isChosen(match)" [class.match--selected]="isChosen(match)" (click)="chooseMatch(match, true)"><b>Bestaande {{ row.amountEur < 0 ? 'terugbetaling' : 'ontvangst' }} koppelen</b><span>{{ matchStamp(match) }}{{ match.reference ? ' · ' + match.reference : '' }}</span><small>Deze betaling wordt niet opnieuw geboekt.</small></button> }
          @if (manualNewMatch(); as match) { <button class="match" type="button" [disabled]="busy()" [attr.aria-pressed]="isChosen(match)" [class.match--selected]="isChosen(match)" (click)="chooseMatch(match, true)"><b>Nieuwe {{ row.amountEur < 0 ? 'terugbetaling' : 'ontvangst' }} registreren</b><span>{{ match.number }} · {{ match.openEur | eur }} {{ row.amountEur < 0 ? 'terug te betalen' : 'nog te ontvangen' }}</span></button> }
        }
        @if (choice(); as chosen) { <section class="allocation-choice" aria-label="Gekozen koppeling"><span>Je bevestigt</span><h3>{{ chosen.number }}</h3><p>{{ chosen.existingPaymentId ? 'Bestaande betaling koppelen; er komt geen tweede factuurbetaling bij.' : row.amountEur < 0 ? 'Een nieuwe terugbetaling op deze factuur registreren.' : 'Een nieuwe ontvangst op deze factuur registreren.' }}</p><b>{{ row.amountEur | eur }}</b>@if (!chosen.existingPaymentId && row.amountEur > chosen.openEur && row.amountEur > 0) { <p class="bank-note">{{ row.amountEur - chosen.openEur | eur }} meer dan het openstaande bedrag wordt als teveel ontvangen geregistreerd.</p> }@if (!chosen.existingPaymentId && chosenInvoiceHasExistingMatches()) { <label class="duplicate-confirm"><input type="checkbox" [disabled]="busy()" [ngModel]="newBookingConfirmed()" (ngModelChange)="newBookingConfirmed.set($event)" /><span>Ik heb de bestaande boekingen gecontroleerd; dit is een andere betaling.</span></label> }</section> }
        @if (error()) { <p class="bank-error" role="alert">{{ error() }}</p> }
      </div><div foot style="display:contents"><button class="btn" type="button" [disabled]="busy()" (click)="closeAllocation()">Annuleren</button><span class="spacer"></span><button class="btn btn--primary" type="button" [disabled]="!canAllocate()" (click)="allocate()">{{ busy() ? 'Koppelen…' : choice()?.existingPaymentId ? 'Bestaande betaling koppelen' : 'Koppelen & betaling registreren' }}</button></div></app-sheet>
    }
  `,
  styles: `
    :host{display:block;min-width:0}.bank-head{display:flex;align-items:start;justify-content:space-between;gap:16px;flex-wrap:wrap}.bank-head>div{min-width:0}.bank-kicker{font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.03em}.bank-head h2{font-size:21px;line-height:1.3;margin:5px 0 0}.bank-copy{font-size:13px;line-height:1.7;color:var(--muted);margin:13px 0 18px}.bank-filters{display:grid;grid-template-columns:1.4fr repeat(3,minmax(0,1fr));gap:12px}.field{min-width:0}.field>span,.field>label{font-size:12px;font-weight:650}.input{min-width:0;width:100%;min-height:44px}.field small{font-size:12px;color:var(--muted);line-height:1.5}.bank-period{margin-top:8px}.bank-period summary,.bank-record summary{cursor:pointer;color:var(--muted);font-size:12px;min-height:40px;padding:12px 0}.bank-period__fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;max-width:480px;padding-bottom:12px}.bank-selection{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:40px;font-size:12px;color:var(--muted)}.bank-selection .linklike{min-height:40px}.bank-totals{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:6px 0 15px;padding:14px;border-radius:12px;background:var(--surface-2)}.bank-totals>div{display:grid;gap:6px;min-width:0}.bank-totals small{font-size:12px;color:var(--muted)}.bank-totals b{font-size:17px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.money-in{color:var(--ok)}.bank-lines article{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;padding:19px 0;border-bottom:1px solid var(--line)}.bank-line__body{display:grid;align-content:start;gap:6px;min-width:0;overflow-wrap:anywhere}.bank-line__body>b{font-size:14px}.bank-line__body small{font-size:12px;line-height:1.5;color:var(--muted)}.bank-line__body a{font-size:13px;color:var(--rose-dark);font-weight:650}.bank-line__status{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:3px}.bank-badge{padding:4px 8px;border-radius:6px;font-size:11px;font-weight:650;background:var(--surface-2);color:var(--ink-2)}.bank-badge--in{background:var(--rose-soft);color:var(--rose-dark)}.bank-link-state{font-size:11px;color:var(--muted)}.bank-line__aside{display:grid;justify-items:end;align-content:start;gap:12px}.bank-line__aside strong{font-size:19px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.bank-actions{display:flex;align-items:center;justify-content:end;gap:10px;flex-wrap:wrap}.btn,.bank-actions .linklike{min-height:44px;white-space:normal}.bank-record summary{min-height:32px;padding:6px 0}.bank-record[open]{display:grid;gap:5px}.bank-record small{display:block}.bank-empty{text-align:center;padding:28px 12px;font-size:14px}.bank-empty p{font-size:13px;color:var(--muted);line-height:1.6}.bank-more{margin-top:16px}.bank-error{color:var(--danger);font-size:13px;line-height:1.6}.entry-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:16px 0;padding:0;border:0;min-width:0}.bank-note{padding:12px;border-radius:10px;background:var(--surface-2);font-size:13px;line-height:1.6;color:var(--ink-2)}.allocation-movement{display:grid;gap:7px;padding:16px;border-radius:12px;background:var(--surface-2);overflow-wrap:anywhere}.allocation-movement strong{font-size:26px;font-variant-numeric:tabular-nums}.allocation-movement span,.allocation-movement small{font-size:13px;color:var(--muted)}.allocation-label{font-size:14px;margin:20px 0 10px}.allocation-picker{margin-top:22px}.match{display:grid;gap:6px;text-align:left;width:100%;padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--surface);margin:9px 0;cursor:pointer;color:inherit;overflow-wrap:anywhere}.match--selected{border-color:var(--rose-dark);box-shadow:inset 0 0 0 1px var(--rose-dark);background:var(--rose-soft)}.match b{font-size:14px}.match span,.match small{font-size:12px;color:var(--muted);line-height:1.5}.match .match__kind{color:var(--ink-2);font-weight:650}.allocation-choice{padding:16px;margin-top:20px;border-radius:12px;border:1px solid var(--rose-line);background:var(--rose-soft)}.allocation-choice>span{font-size:12px;color:var(--muted)}.allocation-choice h3{font-size:18px;margin:6px 0}.allocation-choice>p{font-size:13px;line-height:1.6}.allocation-choice>b{font-size:20px;font-variant-numeric:tabular-nums}.duplicate-confirm{display:flex;align-items:start;gap:10px;font-size:13px;line-height:1.6;padding-top:16px}.duplicate-confirm input{width:18px;height:18px;flex:none;margin-top:2px}.match:focus-visible,summary:focus-visible{outline:2px solid var(--rose-dark);outline-offset:3px}
    @media(max-width:1100px){.bank-filters{grid-template-columns:repeat(3,minmax(0,1fr))}.bank-search{grid-column:1/-1}}
    @media(max-width:600px){.bank-head h2{font-size:19px}.bank-head>.btn{width:100%}.bank-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.bank-search{grid-column:1/-1}.bank-filters>.field:last-child{grid-column:1/-1}.bank-totals{gap:8px;padding:12px}.bank-totals b{font-size:15px}.bank-lines article{grid-template-columns:minmax(0,1fr);gap:12px}.bank-line__aside{justify-items:start;gap:10px}.bank-actions{justify-content:start;width:100%}.bank-actions>.btn{flex:1}.entry-grid{grid-template-columns:1fr}.input{font-size:16px}.bank-period__fields{grid-template-columns:1fr}.allocation-choice,.allocation-movement{padding:13px}}
  `,
})
export class BankMovementPanel {
  readonly state = inject(FinanceState);
  private readonly api = inject(BankingApi);
  private readonly ui = inject(Ui);
  readonly busy = signal(false);
  readonly matchingLoading = signal(false);
  readonly error = signal('');
  readonly draft = signal<BankDraft | null>(null);
  readonly accountFilter = signal('');
  readonly directionFilter = signal<DirectionFilter>('ALL');
  readonly linkFilter = signal<LinkFilter>('ALL');
  readonly search = signal('');
  readonly from = signal('');
  readonly to = signal('');
  readonly shown = signal(12);
  readonly more = (count: number): number => count + 25;
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
      return (!this.accountFilter() || bankAccountKey(row.account) === this.accountFilter())
        && (this.directionFilter() === 'ALL' || (this.directionFilter() === 'INCOMING' ? row.amountEur > 0 : row.amountEur < 0))
        && (this.linkFilter() === 'ALL' || (this.linkFilter() === 'LINKED' ? row.salesPaymentId != null : row.salesPaymentId == null))
        && (!this.from() || day >= this.from()) && (!this.to() || day <= this.to()) && (!search || text.includes(search));
    }).sort((left, right) => Date.parse(right.bookedAt) - Date.parse(left.bookedAt) || right.id - left.id);
  });
  readonly visibleLines = computed(() => this.filteredLines().slice(0, this.shown()));
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
  private active(view: SalesOrderView): boolean { return view.order.docType === 'FACTUUR' && !inactive.has(view.order.status); }
  private canCreateOn(view: SalesOrderView): boolean {
    const row = this.selected(); if (!row || !this.active(view)) return false;
    return row.amountEur < 0 ? cents(view.paymentSummary?.refundableEur ?? 0) >= -cents(row.amountEur)
      : (view.paymentSummary?.invoiceTotalEur ?? view.priced?.totals?.totalInclVat ?? 0) > 0;
  }
  matchKey(match: BankMatch): string { return `${match.salesOrderId}:${match.existingPaymentId ?? 'new'}`; }
  isChosen(match: BankMatch): boolean { const choice = this.choice(); return !!choice && this.matchKey(choice) === this.matchKey(match); }
  matchStamp(match: BankMatch): string { return this.stamp(match.receivedAt ?? '', (match.existingPaymentId ? this.paymentMap().get(match.existingPaymentId)?.timeZone : null) || this.selected()?.timeZone || 'Europe/Brussels'); }
  clearFilters(): void { this.search.set(''); this.accountFilter.set(''); this.directionFilter.set('ALL'); this.linkFilter.set('ALL'); this.from.set(''); this.to.set(''); this.shown.set(12); }

  add(): void {
    if (this.busy()) return;
    this.closeAllocation();
    const timeZone = 'Europe/Brussels';
    this.error.set('');
    this.draft.set({ account: this.accountFilter() || this.ledgerAccounts()[0] || '', bankDirection: 'INCOMING', amount: 0,
      ...receiptLocalParts(Date.now(), timeZone), timeZone, reference: '', counterparty: '', requestId: crypto.randomUUID() });
  }
  patch(change: Partial<BankDraft>): void { if (this.busy()) return; this.draft.update(current => current ? { ...current, ...change } : null); this.error.set(''); }
  closeDraft(): void { if (!this.busy()) { this.draft.set(null); this.error.set(''); } }
  async save(): Promise<void> {
    const draft = this.draft(); if (!draft || this.busy()) return;
    let body: BankMovementRequest;
    try {
      if (!draft.account.trim()) throw new Error('Vul de bankrekening in.');
      if (!Number.isFinite(draft.amount) || draft.amount <= 0) throw new Error('Vul een bedrag groter dan nul in.');
      if (Math.abs(draft.amount * 100 - cents(draft.amount)) > 0.00001) throw new Error('Gebruik maximaal twee decimalen voor het bankbedrag.');
      const timing = receiptRequest(draft);
      body = { account: draft.account.trim(), amountEur: timing.amountEur, direction: draft.bankDirection,
        bookedAt: timing.receivedAt, timeZone: timing.timeZone, reference: timing.reference,
        counterparty: draft.counterparty.trim() || null, requestId: draft.requestId };
    } catch (failure) { this.error.set((failure as Error).message.replace('Een ontvangen betaling', 'Een bankbeweging')); return; }
    await this.run(async () => {
      const saved = await this.api.create(body);
      this.state.bankStatements.update(rows => [saved, ...rows.filter(row => row.id !== saved.id)]);
      this.draft.set(null); this.clearFilters();
      this.ui.toast('Bankbeweging bewaard op de rekening');
      await this.state.load();
    });
  }
  async openAllocation(row: BankStatementLine): Promise<void> {
    if (this.busy()) return;
    const version = ++this.allocationVersion;
    this.draft.set(null); this.selected.set(row); this.choice.set(null); this.manualInvoice.set(0); this.matches.set([]); this.newBookingConfirmed.set(false); this.error.set(''); this.matchingLoading.set(true);
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
      await this.state.load();
    });
  }
  unlink(row: BankStatementLine): void { if (this.busy()) return; this.ui.confirm({ title: 'Factuurkoppeling losmaken', message: row.allocationCreatedPayment ? 'De vanuit deze bankbeweging aangemaakte factuurbetaling wordt ingetrokken. De oorspronkelijke bankbeweging blijft bewaard.' : 'De bestaande factuurbetaling blijft bewaard; alleen de koppeling met deze bankbeweging wordt verwijderd.', confirmLabel: 'Koppeling losmaken', danger: true }, () => this.run(async () => { await this.api.unallocate(row.id); await this.state.load(); })); }
  remove(row: BankStatementLine): void { if (this.busy()) return; this.ui.confirm({ title: 'Bankbeweging intrekken', message: `${row.account} · ${row.amountEur} EUR · ${row.reference || 'Geen referentie'}. Deze ongekoppelde bankbeweging verdwijnt uit de saldoberekening. De verwijdering blijft in het activiteitenlogboek staan.`, confirmLabel: 'Beweging intrekken', danger: true }, () => this.run(async () => { await this.api.delete(row.id); this.state.bankStatements.update(rows => rows.filter(line => line.id !== row.id)); await this.state.load(); })); }
  private async run(work: () => Promise<unknown>): Promise<void> { if (this.busy()) return; this.busy.set(true); this.error.set(''); try { await work(); } catch (failure) { this.error.set(messageOf(failure, 'Bankbewerking mislukt')); } finally { this.busy.set(false); } }
}
