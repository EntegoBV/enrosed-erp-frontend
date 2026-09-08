import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BankingApi, BankMovementRequest, BankMatch, BankStatementLine } from '../../core/api/banking-api';
import { messageOf } from '../../core/api/errors';
import { EurPipe } from '../../shared/pipes';
import { DateField } from '../../shared/date-field';
import { ReceiptDraft, receiptLocalParts, receiptRequest } from '../../shared/received-at';
import { Sheet, Ui } from '../../shared/ui';
import { FinanceState } from './finance-state';
import { paymentMomentLabel } from './incoming-money';

interface BankDraft extends ReceiptDraft {
  account: string;
  counterparty: string;
  bankDirection: 'INCOMING' | 'OUTGOING';
  requestId: string;
}

@Component({
  selector: 'app-bank-movement-panel', changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, EurPipe, Sheet, DateField],
  template: `
    <section class="card fin-panel">
      <header class="fin-panel__head"><div><span class="section-kicker">Bankbewegingen</span><h2>Handmatig noteren &amp; koppelen</h2></div><button class="btn btn--primary btn--sm" (click)="add()">+ Bankbeweging</button></header>
      <p class="fin-panel__hint">Noteer een werkelijk ontvangen of uitgegeven bedrag op de juiste rekening. Koppel het daarna aan een factuur of bestaande boeking. Deze registratie voert zelf geen bankbetaling uit.</p>
      @if (error()) { <p class="bank-error" role="alert">{{ error() }}</p> }
      <div class="bank-filter"><label>Rekening <select class="input" [ngModel]="accountFilter()" (ngModelChange)="accountFilter.set($event)"><option value="">Alle rekeningen</option>@for (account of ledgerAccounts(); track account) { <option [value]="account">{{ account }}</option> }</select></label><label><input type="checkbox" [ngModel]="onlyOpen()" (ngModelChange)="onlyOpen.set($event)" /> Alleen nog te koppelen</label></div>
      <div class="bank-lines">@for (row of visibleLines(); track row.id) {
        <article><div><b>{{ row.amountEur | eur }} · {{ row.counterparty || row.reference || 'Bankbeweging' }}</b><small>{{ row.account }} · {{ stamp(row.bookedAt, row.timeZone) }}</small><small>{{ row.reference }}</small><small>Geregistreerd {{ stamp(row.recordedAt, row.timeZone) }} · {{ row.actor }}</small>@if (row.salesOrderId) { <a [routerLink]="['/sales', row.salesOrderId, 'edit']">Gekoppelde factuur ›</a> }</div><div class="bank-actions">@if (row.salesPaymentId) { <button class="btn btn--sm" [disabled]="busy()" (click)="unlink(row)">Koppeling ongedaan</button> } @else {<button class="btn btn--sm" [disabled]="busy()" (click)="openAllocation(row)">Koppelen</button><button class="btn btn--sm" [disabled]="busy()" (click)="remove(row)">Beweging intrekken</button>}</div></article>
      } @empty { <p class="fin-empty">Geen bankbewegingen in deze selectie. Voeg een bankbeweging toe om te beginnen.</p> }</div>
    </section>
    @if (draft(); as draft) {
      <app-sheet title="Bankbeweging noteren" (closed)="closeDraft()"><div body>
        <p>Vul het werkelijk geboekte bedrag en tijdstip in. De factuur blijft ongewijzigd totdat je deze beweging afzonderlijk koppelt.</p>
        <div class="entry-grid">
          <label class="field"><span>Bankrekening</span><input class="input" maxlength="120" list="manual-bank-accounts" [ngModel]="draft.account" (ngModelChange)="patch({ account: $event })" placeholder="Dezelfde rekeningnaam of IBAN als bij het saldo" /><datalist id="manual-bank-accounts">@for (account of state.accounts(); track account) { <option [value]="account"></option> }</datalist></label>
          <label class="field"><span>Richting</span><select class="input" [ngModel]="draft.bankDirection" (ngModelChange)="patch({ bankDirection: $event })"><option value="INCOMING">Inkomend — geld ontvangen</option><option value="OUTGOING">Uitgaand — geld betaald</option></select></label>
          <label class="field"><span>Bedrag (EUR)</span><input class="input" type="number" min="0.01" step="0.01" inputmode="decimal" [ngModel]="draft.amount" (ngModelChange)="patch({ amount: +$event })" /></label>
          <div class="field"><label>Bankdatum</label><app-date-field [value]="draft.day" (valueChange)="patch({ day: $event })" /></div>
          <label class="field"><span>Werkelijk tijdstip</span><input class="input" type="time" step="1" [ngModel]="draft.time" (ngModelChange)="patch({ time: $event })" /></label>
          <label class="field"><span>Tijdzone</span><input class="input" [ngModel]="draft.timeZone" (ngModelChange)="patch({ timeZone: $event })" /></label>
          <label class="field"><span>Mededeling / referentie</span><input class="input" maxlength="500" [ngModel]="draft.reference" (ngModelChange)="patch({ reference: $event })" /></label>
          <label class="field"><span>Tegenpartij (optioneel)</span><input class="input" maxlength="300" [ngModel]="draft.counterparty" (ngModelChange)="patch({ counterparty: $event })" /></label>
        </div>
        @if (error()) { <p class="bank-error" role="alert">{{ error() }}</p> }
      </div><div foot style="display:contents"><button class="btn" [disabled]="busy()" (click)="closeDraft()">Annuleren</button><span class="spacer"></span><button class="btn btn--primary" [disabled]="busy()" (click)="save()">{{ busy() ? 'Bewaren…' : 'Bankbeweging bewaren' }}</button></div></app-sheet>
    }
    @if (selected(); as row) {
      <app-sheet title="Bankbeweging koppelen" (closed)="selected.set(null)"><div body>
        <p><b>{{ row.amountEur | eur }} · {{ row.account }}</b><br />{{ stamp(row.bookedAt, row.timeZone) }}<br />{{ row.reference }}</p>
        <p>Controleer het document en de bankbeweging. Een bestaande betaling koppelen voorkomt een dubbele boeking.</p>
        @for (match of matches(); track $index) { <button class="match" [class.match--selected]="choice()?.salesOrderId === match.salesOrderId && choice()?.existingPaymentId === match.existingPaymentId" (click)="choice.set(match)"><b>{{ match.number }} · {{ match.openEur | eur }} open</b><span>{{ match.reason }}</span>@if (match.receivedAt) { <small>{{ stamp(match.receivedAt, row.timeZone) }} · {{ match.reference }}</small> }</button> }
        <label class="field"><span>Of kies zelf een factuur voor een nieuwe boeking</span><select class="input" [ngModel]="manualInvoice()" (ngModelChange)="chooseInvoice(+$event)"><option [value]="0">Selecteer factuur…</option>@for (view of selectableInvoices(); track view.order.id) { <option [value]="view.order.id">{{ view.order.number }} · {{ view.paymentSummary?.remainingEur | eur }} open / {{ view.paymentSummary?.refundableEur | eur }} terug te betalen</option> }</select></label>
        @if (choice(); as choice) { <p class="fin-panel__hint">{{ choice.existingPaymentId ? 'Deze bestaande betaling wordt gekoppeld; er ontstaat geen tweede betaling.' : (row.amountEur < 0 ? 'Deze bevestiging registreert een terugbetaling op de gekozen factuur.' : 'Deze bevestiging registreert een nieuwe ontvangst op de gekozen factuur.') }}</p> }
        @if (error()) { <p class="bank-error" role="alert">{{ error() }}</p> }
      </div><div foot style="display:contents"><button class="btn" (click)="selected.set(null)">Annuleren</button><span class="spacer"></span><button class="btn btn--primary" [disabled]="busy() || !choice()" (click)="allocate()">Koppeling en boeking bevestigen</button></div></app-sheet>
    }
  `,
  styles: `:host{display:block}.entry-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:16px 0}.field{min-width:0}.bank-lines article{display:flex;justify-content:space-between;gap:12px;padding:14px 0;border-bottom:1px solid var(--line)}.bank-lines article>div:first-child{display:grid;gap:5px;min-width:0;overflow-wrap:anywhere}.bank-lines small{color:var(--muted);font-size:11px}.bank-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.bank-error{color:var(--danger);font-size:13px}.bank-filter{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin:16px 0}.match{display:grid;gap:5px;text-align:left;width:100%;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);margin:8px 0}.match--selected{border-color:var(--rose-dark);background:var(--surface-2)}@media(max-width:600px){.entry-grid{grid-template-columns:1fr}.bank-lines article{flex-direction:column}}`,
})
export class BankMovementPanel {
  readonly state = inject(FinanceState); private readonly api = inject(BankingApi); private readonly ui = inject(Ui);
  readonly busy = signal(false); readonly error = signal(''); readonly draft = signal<BankDraft | null>(null);
  readonly accountFilter = signal(''); readonly onlyOpen = signal(false); readonly selected = signal<BankStatementLine | null>(null); readonly matches = signal<BankMatch[]>([]); readonly choice = signal<BankMatch | null>(null); readonly manualInvoice = signal(0);
  readonly ledgerAccounts = computed(() => [...new Set(this.state.bankStatements().map(row => row.account))].sort());
  readonly visibleLines = computed(() => this.state.bankStatements().filter(row => (!this.accountFilter() || row.account === this.accountFilter()) && (!this.onlyOpen() || !row.salesPaymentId)));
  readonly selectableInvoices = computed(() => this.state.salesOrders().filter(view => view.order.docType === 'FACTUUR' && !['CONCEPT', 'GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN'].includes(view.order.status)));
  stamp(at: string, timeZone: string): string { return paymentMomentLabel({ receivedAt: at, timeZone }); }
  add(): void {
    const timeZone = 'Europe/Brussels';
    this.error.set('');
    this.draft.set({ account: this.state.accounts()[0] ?? '', bankDirection: 'INCOMING', amount: 0,
      ...receiptLocalParts(Date.now(), timeZone), timeZone, reference: '', counterparty: '', requestId: crypto.randomUUID() });
  }
  patch(change: Partial<BankDraft>): void { this.draft.update(current => current ? { ...current, ...change } : null); this.error.set(''); }
  closeDraft(): void { if (!this.busy()) this.draft.set(null); }
  async save(): Promise<void> {
    const draft = this.draft(); if (!draft || this.busy()) return;
    let body: BankMovementRequest;
    try {
      if (!draft.account.trim()) throw new Error('Vul de bankrekening in.');
      const timing = receiptRequest(draft);
      body = { account: draft.account.trim(), amountEur: timing.amountEur, direction: draft.bankDirection,
        bookedAt: timing.receivedAt, timeZone: timing.timeZone, reference: timing.reference,
        counterparty: draft.counterparty.trim() || null, requestId: draft.requestId };
    } catch (failure) { this.error.set((failure as Error).message); return; }
    await this.run(async () => { await this.api.create(body); await this.state.load(); this.draft.set(null); this.ui.toast('Bankbeweging bewaard; kies Koppelen om een factuurbetaling te registreren'); });
  }
  async openAllocation(row: BankStatementLine): Promise<void> { this.selected.set(row); this.choice.set(null); this.manualInvoice.set(0); this.matches.set([]); await this.run(async () => this.matches.set(await this.api.suggestions(row.id))); }
  chooseInvoice(id: number): void { this.manualInvoice.set(id); const view = this.selectableInvoices().find(view => view.order.id === id); this.choice.set(view ? { salesOrderId: id, number: view.order.number, existingPaymentId: null, openEur: this.selected()!.amountEur < 0 ? view.paymentSummary?.refundableEur ?? 0 : view.paymentSummary?.remainingEur ?? 0, score: 0, reason: 'Handmatig gekozen', receivedAt: null, reference: null } : null); }
  async allocate(): Promise<void> { const row = this.selected(), match = this.choice(); if (!row || !match) return; await this.run(async () => { await this.api.allocate(row.id, match.salesOrderId, match.existingPaymentId); this.selected.set(null); await this.state.load(); this.ui.toast('Bankbeweging gekoppeld'); }); }
  unlink(row: BankStatementLine): void { this.ui.confirm({ title: 'Koppeling ongedaan maken', message: row.allocationCreatedPayment ? 'De vanuit deze bankbeweging aangemaakte betaling wordt ingetrokken. De oorspronkelijke bankbeweging blijft bewaard.' : 'De bestaande betaling blijft bewaard; alleen de koppeling met deze bankbeweging wordt verwijderd.', confirmLabel: 'Koppeling ongedaan', danger: true }, () => this.run(async () => { await this.api.unallocate(row.id); await this.state.load(); })); }
  remove(row: BankStatementLine): void { this.ui.confirm({ title: 'Bankbeweging intrekken', message: `${row.account} · ${row.amountEur} EUR · ${row.reference}. Deze ongekoppelde bankbeweging verdwijnt uit de saldoberekening. De verwijdering blijft in het activiteitenlogboek staan.`, confirmLabel: 'Beweging intrekken', danger: true }, () => this.run(async () => { await this.api.delete(row.id); await this.state.load(); })); }
  private async run(work: () => Promise<unknown>): Promise<void> { if (this.busy()) return; this.busy.set(true); this.error.set(''); try { await work(); } catch (failure) { this.error.set(messageOf(failure, 'Bankbewerking mislukt')); } finally { this.busy.set(false); } }
}
