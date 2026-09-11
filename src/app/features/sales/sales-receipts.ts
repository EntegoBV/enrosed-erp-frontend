import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { messageOf } from '../../core/api/errors';
import type { SalesOrderView, SalesPayment } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { DateField } from '../../shared/date-field';
import { EurPipe } from '../../shared/pipes';
import { Sheet, Ui } from '../../shared/ui';
import { isPartnerDocument } from './sales-payment-state';
import { ReceiptDraft, receiptLocalParts, receiptRequest } from '../../shared/received-at';
import { companyReceiptAccount, receiptAccountChoices, receiptAccountValue, type ReceiptBankAccount } from './receipt-bank-account';

@Component({
  selector: 'app-sales-receipts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, DateField, EurPipe, Sheet],
  template: `
    @if (view().order.docType === 'FACTUUR') {
      <section class="receipts" aria-label="Ontvangen betalingen">
        <header><div><span class="eyebrow">{{ partner() ? 'Partnerontvangsten' : 'Klantbetalingen' }}</span><h3>Ontvangen &amp; open</h3></div><span class="receipts__status">{{ statusLabel() }}</span></header>
        @if (summary(); as summary) {
          <div class="receipts__metrics"><div><span>Factuur incl. btw</span><b>{{ summary.invoiceTotalEur | eur }}</b></div><div><span>Netto ontvangen</span><b>{{ summary.receivedEur | eur }}</b></div><div><span>Nog te ontvangen</span><b>{{ summary.remainingEur | eur }}</b></div></div>
          @if ((summary.refundedEur ?? 0) > 0) { <p class="receipts__hint">Bruto ontvangen {{ summary.grossReceivedEur | eur }} · terugbetaald {{ summary.refundedEur | eur }}</p> }
          @if (summary.overpaidEur > 0) { <p class="receipts__warning">{{ summary.overpaidEur | eur }} meer ontvangen dan de factuur. Controleer of dit moet worden terugbetaald of verrekend.</p> }
          @if (summary.creditEur > 0) { <p class="receipts__warning">{{ summary.creditEur | eur }} credit voor de klant. Dit is geen open inkomende betaling.</p> }
          @if (summary.legacyPaidMarker) { <p class="receipts__warning">De historische betaalmarkering is als ontvangst overgenomen. Corrigeer die bestaande ontvangst als het bedrag of tijdstip niet klopt. Een nieuwe ontvangst wordt erbij opgeteld.</p> }
          @if (summary.instalments.length) {
            <div class="receipts__plan"><b>Deelbetalingen binnen deze factuur</b>@for (step of summary.instalments; track step.key) {
              <div><span>{{ step.label }}<small>{{ step.paidEur | eur }} ontvangen van {{ step.expectedEur | eur }}</small></span><b>{{ step.remainingEur | eur }} open</b>@if (step.remainingEur > 0 && canRecord()) { <button class="btn btn--sm" type="button" [disabled]="busy() || dirty()" [attr.aria-label]="'Ontvangst registreren: ' + step.label" (click)="add(step.remainingEur)">Noteren</button> }</div>
            }</div>
          }
          <div class="receipts__trail">
            @for (payment of summary.payments; track payment.id) {
              <article><div><b>{{ payment.amountEur | eur }} {{ payment.amountEur < 0 ? 'terugbetaald' : 'ontvangen' }}@if (payment.legacy) { · historisch }</b><span>{{ stamp(payment.receivedAt, payment.timeZone) }}</span><small>{{ payment.timeZone }}@if (payment.bankAccount) { · {{ payment.bankAccount }} }@if (payment.reference) { · {{ payment.reference }} }</small><small>Geregistreerd {{ stamp(payment.recordedAt, payment.timeZone) }}@if (payment.actor) { · {{ payment.actor }} }</small></div><button class="btn btn--sm" type="button" [disabled]="busy() || dirty()" (click)="edit(payment)">Corrigeren</button></article>
            } @empty { <p class="receipts__hint">Nog geen afzonderlijke ontvangsten geregistreerd.</p> }
          </div>
          @if (view().order.status === 'CONCEPT') { <button class="btn btn--primary btn--sm" type="button" [disabled]="busy() || dirty()" (click)="issue()">{{ summary.invoiceTotalEur > 0 ? 'Uitgeven zonder e-mail & ontvangst noteren' : 'Uitgeven zonder e-mail' }}</button><p class="receipts__hint">Geef de factuur definitief uit om ontvangsten te registreren. De factuur wordt dan vastgezet.</p> }
          @if (canRefund()) { <button class="btn btn--sm" type="button" [disabled]="busy() || dirty()" (click)="refund()">Terugbetaling noteren · {{ summary.refundableEur | eur }}</button> }
          @if (canRecord()) { <button class="btn btn--primary btn--sm" type="button" [disabled]="busy() || dirty()" (click)="add()">+ Ontvangst registreren</button> }
        } @else { <p class="receipts__hint">De betalingsgegevens konden niet worden geladen. Vernieuw de factuur.</p> }
        @if (dirty()) { <p class="receipts__hint">Sla eerst de factuurwijzigingen op voordat je een ontvangst registreert of corrigeert.</p> }
        @if (containerId(); as id) { <a class="receipts__link" [routerLink]="['/purchasing', id]">Container, voorschotten &amp; slotafrekening ›</a> }
      </section>
    }
    @if (draft(); as draft) {
      <app-sheet [title]="draft.direction === 'REFUND' ? (draft.id ? 'Terugbetaling corrigeren' : 'Terugbetaling registreren') : (draft.id ? 'Ontvangst corrigeren' : 'Ontvangst registreren')" (closed)="close()">
        <div body>
          <p class="receipts__hint">{{ view().order.number }} · noteer de werkelijk uitgevoerde bankbeweging. Een registratie voert zelf geen bankbetaling uit.</p>
          @if (summary()?.legacyPaidMarker) { <p class="receipts__warning">Een nieuwe ontvangst telt bovenop de historische betaling. Gebruik Corrigeren bij de bestaande ontvangst om het oorspronkelijke bedrag of tijdstip recht te zetten.</p> }
          <div class="form-grid">
            <label class="field"><span>{{ draft.direction === 'REFUND' ? 'Terugbetaald bedrag (EUR)' : 'Ontvangen bedrag (EUR)' }}</span><input class="input" type="number" min="0.01" step="0.01" inputmode="decimal" [ngModel]="draft.amount" (ngModelChange)="patch({ amount: +$event })" /></label>
            <div class="field"><label>Bankdatum</label><app-date-field [value]="draft.day" (valueChange)="patch({ day: $event })" /></div>
            <label class="field"><span>Tijdstip</span><input class="input" type="time" step="1" [ngModel]="draft.time" (ngModelChange)="patch({ time: $event })" /></label>
            <label class="field"><span>Tijdzone van dit tijdstip</span><input class="input" list="receipt-time-zones" [ngModel]="draft.timeZone" (ngModelChange)="patch({ timeZone: $event })" /><datalist id="receipt-time-zones"><option value="Europe/Brussels"></option><option value="Europe/Amsterdam"></option><option value="UTC"></option><option value="Asia/Shanghai"></option></datalist></label>
            <div class="field span-2 receipts__account">
              <label for="receipt-bank-account">{{ draft.direction === 'REFUND' ? 'Terugbetaald vanaf rekening' : 'Ontvangen op rekening' }}</label>
              <select class="select" id="receipt-bank-account" [ngModel]="draft.bankAccount" [disabled]="busy() || !accountChoices().length" [attr.aria-busy]="accountLoading()" aria-describedby="receipt-account-info" (ngModelChange)="selectAccount($event)">
                @if (originalAccount() === null) { <option value="" disabled>{{ accountLoading() ? 'Bankrekening laden…' : 'Kies een bankrekening' }}</option> }
                @for (account of accountChoices(); track account.value) { <option [value]="account.value">{{ account.label }}</option> }
              </select>
              <div id="receipt-account-info">
                @if (selectedAccount(); as account) { <p class="receipts__account-selected">{{ account.label }}</p> }
                @if (accountLoading()) { <p class="receipts__hint" role="status">Bedrijfsrekening laden…</p> }
                @if (accountError()) { <div class="receipts__account-error" role="alert"><span>{{ accountError() }}</span><button class="btn btn--sm" type="button" [disabled]="accountLoading() || busy()" (click)="loadBankAccount()">Opnieuw laden</button><a routerLink="/settings">Bedrijfsinstellingen</a></div> }
                @if (draft.id) { <p class="receipts__hint">De oorspronkelijke rekening blijft behouden totdat je zelf een andere kiest.</p> }
              </div>
            </div>
            <label class="field span-2"><span>Referentie / mededeling</span><input class="input" maxlength="500" placeholder="Mededeling op het bankafschrift" [ngModel]="draft.reference" (ngModelChange)="patch({ reference: $event })" /></label>
          </div>
          @if (error()) { <p class="receipts__error" role="alert">{{ error() }}</p> }
        </div>
        <div foot style="display:contents">@if (draft.id) { <button class="btn btn--danger" type="button" [disabled]="busy()" (click)="remove(draft.id)">Verwijderen</button> }<span class="spacer"></span><button class="btn" type="button" [disabled]="busy()" (click)="close()">Annuleren</button><button class="btn btn--primary" type="button" [disabled]="busy() || !accountReady()" (click)="save()">{{ busy() ? 'Bewaren…' : 'Bankbeweging bewaren' }}</button></div>
      </app-sheet>
    }
  `,
  styles: `
    :host{display:block;min-width:0}.receipts{padding:14px;margin:12px 0;border:1px solid var(--line);border-radius:14px;background:var(--surface)}.receipts header{display:flex;align-items:start;justify-content:space-between;gap:8px}.eyebrow{font-size:10px;color:var(--rose-dark);text-transform:uppercase;font-weight:700}h3{font-size:16px;margin:4px 0 12px}.receipts__status{font-size:10px;color:var(--muted);padding:4px 7px;border-radius:999px;background:var(--surface-2)}.receipts__metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.receipts__metrics>div{display:grid;gap:5px}.receipts__metrics span{font-size:10px;color:var(--muted)}.receipts__metrics b{font-size:14px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.receipts__plan{padding:12px;margin:12px 0;border-radius:12px;background:var(--surface-2);font-size:12px}.receipts__plan>div{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px}.receipts__plan small{display:block;font-size:10px;color:var(--muted);margin-top:3px}.receipts__plan>div>b{font-size:11px;white-space:nowrap}.receipts__trail{margin:10px 0}.receipts__trail article{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 0;border-top:1px solid var(--line)}.receipts__trail article>div{display:grid;gap:4px;min-width:0}.receipts__trail span{font-size:11px}.receipts__trail small{font-size:10px;color:var(--muted);overflow-wrap:anywhere}.receipts__warning{padding:10px;border-radius:10px;background:var(--warn-soft);font-size:11px;line-height:1.5;margin:10px 0}.receipts__hint{font-size:11px;color:var(--muted);line-height:1.5;margin:10px 0}.receipts__error{font-size:12px;color:var(--danger);line-height:1.5;margin-top:12px}.receipts__link{display:block;margin-top:12px;color:var(--rose-dark);font-size:11px}.field>span{font-size:12px;font-weight:650}.receipts__account{min-width:0}.receipts__account select{width:100%;max-width:100%;min-width:0;font-size:12px;min-height:44px;text-overflow:ellipsis}.receipts__account-error{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--danger);line-height:1.5;margin-top:8px}.receipts__account-error>span{flex:1 1 100%}.receipts__account-error>a{color:var(--rose-dark)}.receipts__account .receipts__hint{margin:5px 0 0}.receipts__account-selected{display:none}@media(max-width:520px){.receipts__account select{font-size:16px}.receipts__account-selected{display:block;font-size:11px;line-height:1.6;color:var(--muted);overflow-wrap:anywhere;margin:6px 0}}.form-grid{margin-top:12px}
  `,
})
export class SalesReceipts implements OnDestroy {
  readonly view = input.required<SalesOrderView>();
  readonly dirty = input(false);
  readonly openRequest = input(0);
  readonly changed = output<SalesOrderView>();
  readonly draft = signal<ReceiptDraft | null>(null);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly configuredAccount = signal<ReceiptBankAccount | null>(null);
  /** null denotes a new receipt; an empty string preserves a historical missing account. */
  readonly originalAccount = signal<string | null>(null);
  readonly accountLoading = signal(false);
  readonly accountError = signal('');
  readonly accountChoices = computed(() => receiptAccountChoices(this.configuredAccount(), this.originalAccount()));
  readonly selectedAccount = computed(() => this.accountChoices().find(account => account.value === this.draft()?.bankAccount) ?? null);
  readonly accountReady = computed(() => {
    if (!this.draft()) return false;
    try { receiptAccountValue(this.draft()!.bankAccount, this.configuredAccount(), this.originalAccount()); return true; }
    catch { return false; }
  });
  private draftVersion = 0;
  private accountRequestVersion = 0;
  private draftOrderId: number | null = null;
  private accountTouched = false;
  private destroyed = false;
  readonly summary = computed(() => this.view().paymentSummary);
  readonly partner = computed(() => isPartnerDocument(this.view().order));
  readonly containerId = computed(() => this.view().order.partnerPurchaseOrderId ?? this.view().order.sourcePurchaseOrderId);
  readonly canRecord = computed(() => this.view().order.docType === 'FACTUUR'
    && !['CONCEPT', 'GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN'].includes(this.view().order.status) && (this.summary()?.invoiceTotalEur ?? 0) > 0);
  readonly canRefund = computed(() => !['CONCEPT', 'GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN'].includes(this.view().order.status) && (this.summary()?.refundableEur ?? 0) > 0);
  readonly statusLabel = computed(() => ({ UNPAID: 'Nog te ontvangen', PARTIAL: 'Deels ontvangen', PAID: this.summary()?.invoiceTotalEur && this.summary()!.invoiceTotalEur < 0 ? 'Volledig afgehandeld' : 'Volledig ontvangen', OVERPAID: 'Te veel ontvangen', CREDIT: 'Credit' })[this.summary()?.status ?? 'UNPAID']);
  private readonly sales = inject(SalesApi);
  private readonly ui = inject(Ui);

  constructor() {
    effect(() => { if (this.openRequest() > 0) untracked(() => this.add()); });
    effect(() => { const id = this.view().order.id; untracked(() => { if (this.draftOrderId !== null && this.draftOrderId !== id) this.clearDraft(); }); });
  }
  private beginDraft(draft: ReceiptDraft): void {
    this.draftVersion++; this.draftOrderId = this.view().order.id; this.accountTouched = false;
    this.originalAccount.set(draft.id ? draft.bankAccount ?? '' : null);
    this.configuredAccount.set(null); this.accountLoading.set(false); this.accountError.set('');
    this.draft.set(draft);
    void this.loadBankAccount();
  }
  private clearDraft(): void {
    this.draftVersion++; this.accountRequestVersion++; this.draftOrderId = null;
    this.draft.set(null); this.accountLoading.set(false);
  }
  async loadBankAccount(): Promise<void> {
    if (!this.draft() || this.accountLoading() || this.destroyed) return;
    const draftVersion = this.draftVersion, request = ++this.accountRequestVersion, orderId = this.view().order.id;
    this.accountLoading.set(true); this.accountError.set('');
    try {
      const account = companyReceiptAccount(await this.sales.company());
      if (this.destroyed || draftVersion !== this.draftVersion || request !== this.accountRequestVersion || this.view().order.id !== orderId) return;
      this.configuredAccount.set(account);
      if (!account) { this.accountError.set('Er staat geen bruikbare IBAN in de bedrijfsinstellingen.'); return; }
      const draft = this.draft();
      if (draft && !draft.id && !this.accountTouched && !draft.bankAccount) this.draft.set({ ...draft, bankAccount: account.value });
    } catch (failure) {
      if (!this.destroyed && draftVersion === this.draftVersion && request === this.accountRequestVersion && this.view().order.id === orderId) this.accountError.set(messageOf(failure, 'De bedrijfsrekening kon niet worden geladen.'));
    } finally {
      if (!this.destroyed && draftVersion === this.draftVersion && request === this.accountRequestVersion) this.accountLoading.set(false);
    }
  }
  selectAccount(value: string): void {
    if (this.busy() || !this.accountChoices().some(account => account.value === value)) return;
    this.accountTouched = true; this.patch({ bankAccount: value });
  }
  add(amount?: number): void {
    if (!this.canRecord() || this.dirty() || this.busy()) return;
    const timeZone = 'Europe/Brussels';
    this.error.set('');
    this.beginDraft({ amount: amount ?? this.summary()?.remainingEur ?? 0, ...receiptLocalParts(Date.now(), timeZone), timeZone, reference: '', bankAccount: '', direction: 'RECEIPT' });
  }
  refund(): void {
    if (!this.canRefund() || this.dirty() || this.busy()) return;
    const timeZone = 'Europe/Brussels';
    this.error.set('');
    this.beginDraft({ amount: this.summary()?.refundableEur ?? 0, ...receiptLocalParts(Date.now(), timeZone), timeZone, reference: '', bankAccount: '', direction: 'REFUND' });
  }
  edit(payment: SalesPayment): void {
    if (this.dirty() || this.busy()) return;
    this.error.set('');
    this.beginDraft({ id: payment.id, amount: Math.abs(payment.amountEur), direction: payment.amountEur < 0 ? 'REFUND' : 'RECEIPT', bankAccount: payment.bankAccount ?? '', ...receiptLocalParts(payment.receivedAt, payment.timeZone), timeZone: payment.timeZone, reference: payment.reference ?? '' });
  }
  patch(change: Partial<ReceiptDraft>): void { this.draft.update((draft) => draft ? { ...draft, ...change } : null); this.error.set(''); }
  close(): void { if (!this.busy()) this.clearDraft(); }
  stamp(instant: string, timeZone: string): string {
    try { return new Intl.DateTimeFormat('nl-BE', { timeZone, dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(instant)); }
    catch { return instant; }
  }
  async issue(): Promise<void> {
    if (this.busy() || this.dirty()) return;
    const orderId = this.view().order.id;
    this.busy.set(true);
    try {
      const fresh = await this.sales.issueInvoice(orderId);
      if (this.destroyed || this.view().order.id !== orderId) return;
      this.changed.emit(fresh);
      const timeZone = 'Europe/Brussels';
      if ((fresh.paymentSummary?.invoiceTotalEur ?? 0) > 0) this.beginDraft({ amount: fresh.paymentSummary?.remainingEur ?? 0, ...receiptLocalParts(Date.now(), timeZone), timeZone, reference: '', bankAccount: '', direction: 'RECEIPT' });
      this.ui.toast('Factuur uitgereikt zonder e-mail');
    } catch (failure: unknown) { this.ui.toast(messageOf(failure, 'Factuur uitreiken mislukt'), 'err'); }
    finally { this.busy.set(false); }
  }
  async save(): Promise<void> {
    const draft = this.draft();
    if (!draft || this.busy() || this.dirty() || this.draftOrderId !== this.view().order.id) return;
    let body;
    try { body = { ...receiptRequest(draft), bankAccount: receiptAccountValue(draft.bankAccount, this.configuredAccount(), this.originalAccount()) }; } catch (failure: unknown) { this.error.set((failure as Error).message); return; }
    this.busy.set(true);
    try {
      const updated = draft.id ? await this.sales.updatePayment(this.view().order.id, draft.id, body) : await this.sales.addPayment(this.view().order.id, body);
      this.changed.emit(updated); this.clearDraft(); this.ui.toast('Bankbeweging bewaard en gekoppeld', 'ok');
    } catch (failure: unknown) { this.error.set(messageOf(failure, 'Ontvangst bewaren mislukt')); }
    finally { this.busy.set(false); }
  }
  remove(id: number): void {
    if (this.busy()) return;
    this.ui.confirm({ title: 'Bankbeweging intrekken', message: 'De boeking wordt ingetrokken. De financiële historie blijft bewaard. Gekoppelde bankafschriften moet je eerst bij Bank losmaken.', confirmLabel: 'Verwijderen', danger: true }, async () => {
      this.busy.set(true);
      try { await this.sales.deletePayment(this.view().order.id, id); this.changed.emit(await this.sales.order(this.view().order.id)); this.draft.set(null); this.ui.toast('Ontvangst verwijderd'); }
      catch (failure: unknown) { this.error.set(messageOf(failure, 'Ontvangst verwijderen mislukt')); }
      finally { this.busy.set(false); }
    });
  }
  ngOnDestroy(): void { this.destroyed = true; this.clearDraft(); }
}
