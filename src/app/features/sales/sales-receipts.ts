import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
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

@Component({
  selector: 'app-sales-receipts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, DateField, EurPipe, Sheet],
  template: `
    @if (view().order.docType === 'FACTUUR') {
      <section class="receipts" aria-label="Ontvangen betalingen">
        <header><div><span class="eyebrow">{{ partner() ? 'Partnerontvangsten' : 'Klantbetalingen' }}</span><h3>Ontvangen &amp; open</h3></div><span class="receipts__status">{{ statusLabel() }}</span></header>
        @if (summary(); as summary) {
          <div class="receipts__metrics"><div><span>Factuur incl. btw</span><b>{{ summary.invoiceTotalEur | eur }}</b></div><div><span>Ontvangen</span><b>{{ summary.receivedEur | eur }}</b></div><div><span>Nog te ontvangen</span><b>{{ summary.remainingEur | eur }}</b></div></div>
          @if (summary.overpaidEur > 0) { <p class="receipts__warning">{{ summary.overpaidEur | eur }} meer ontvangen dan de factuur. Controleer of dit moet worden terugbetaald of verrekend.</p> }
          @if (summary.creditEur > 0) { <p class="receipts__warning">{{ summary.creditEur | eur }} credit voor de klant. Dit is geen open inkomende betaling.</p> }
          @if (summary.legacyPaidMarker) { <p class="receipts__warning">De historische betaalmarkering is als ontvangst overgenomen. Corrigeer die bestaande ontvangst als het bedrag of tijdstip niet klopt. Een nieuwe ontvangst wordt erbij opgeteld.</p> }
          @if (summary.instalments.length) {
            <div class="receipts__plan"><b>Betaalplan productie</b>@for (step of summary.instalments; track step.key) {
              <div><span>{{ step.label }}<small>{{ step.paidEur | eur }} ontvangen van {{ step.expectedEur | eur }}</small></span><b>{{ step.remainingEur | eur }} open</b>@if (step.remainingEur > 0 && canRecord()) { <button class="btn btn--sm" type="button" [disabled]="busy() || dirty()" [attr.aria-label]="'Ontvangst registreren: ' + step.label" (click)="add(step.remainingEur)">Noteren</button> }</div>
            }</div>
          }
          <div class="receipts__trail">
            @for (payment of summary.payments; track payment.id) {
              <article><div><b>{{ payment.amountEur | eur }}@if (payment.legacy) { · historisch }</b><span>{{ stamp(payment.receivedAt, payment.timeZone) }}</span><small>{{ payment.timeZone }}@if (payment.reference) { · {{ payment.reference }} }</small><small>Geregistreerd {{ stamp(payment.recordedAt, payment.timeZone) }}@if (payment.actor) { · {{ payment.actor }} }</small></div><button class="btn btn--sm" type="button" [disabled]="busy() || dirty()" (click)="edit(payment)">Corrigeren</button></article>
            } @empty { <p class="receipts__hint">Nog geen afzonderlijke ontvangsten geregistreerd.</p> }
          </div>
          @if (view().order.status === 'CONCEPT') { <button class="btn btn--primary btn--sm" type="button" [disabled]="busy() || dirty()" (click)="issue()">{{ summary.invoiceTotalEur > 0 ? 'Uitgeven zonder e-mail & ontvangst noteren' : 'Uitgeven zonder e-mail' }}</button><p class="receipts__hint">Geef de factuur definitief uit om ontvangsten te registreren. De factuur wordt dan vastgezet.</p> }
          @if (canRecord()) { <button class="btn btn--primary btn--sm" type="button" [disabled]="busy() || dirty()" (click)="add()">+ Ontvangst registreren</button> }
        } @else { <p class="receipts__hint">De betalingsgegevens konden niet worden geladen. Vernieuw de factuur.</p> }
        @if (dirty()) { <p class="receipts__hint">Sla eerst de factuurwijzigingen op voordat je een ontvangst registreert of corrigeert.</p> }
        @if (containerId(); as id) { <a class="receipts__link" [routerLink]="['/purchasing', id]">Container, voorschotten &amp; slotafrekening ›</a> }
      </section>
    }
    @if (draft(); as draft) {
      <app-sheet [title]="draft.id ? 'Ontvangst corrigeren' : 'Ontvangst registreren'" (closed)="close()">
        <div body>
          <p class="receipts__hint">{{ view().order.number }} · vul het werkelijk ontvangen bedrag en het tijdstip van het bankafschrift in.</p>
          @if (summary()?.legacyPaidMarker) { <p class="receipts__warning">Een nieuwe ontvangst telt bovenop de historische betaling. Gebruik Corrigeren bij de bestaande ontvangst om het oorspronkelijke bedrag of tijdstip recht te zetten.</p> }
          <div class="form-grid">
            <label class="field"><span>Ontvangen bedrag (EUR)</span><input class="input" type="number" min="0.01" step="0.01" inputmode="decimal" [ngModel]="draft.amount" (ngModelChange)="patch({ amount: +$event })" /></label>
            <div class="field"><label>Ontvangen op</label><app-date-field [value]="draft.day" (valueChange)="patch({ day: $event })" /></div>
            <label class="field"><span>Tijdstip</span><input class="input" type="time" step="1" [ngModel]="draft.time" (ngModelChange)="patch({ time: $event })" /></label>
            <label class="field"><span>Tijdzone van dit tijdstip</span><input class="input" list="receipt-time-zones" [ngModel]="draft.timeZone" (ngModelChange)="patch({ timeZone: $event })" /><datalist id="receipt-time-zones"><option value="Europe/Brussels"></option><option value="Europe/Amsterdam"></option><option value="UTC"></option><option value="Asia/Shanghai"></option></datalist></label>
            <label class="field span-2"><span>Referentie / mededeling</span><input class="input" maxlength="500" placeholder="Mededeling op het bankafschrift" [ngModel]="draft.reference" (ngModelChange)="patch({ reference: $event })" /></label>
          </div>
          @if (error()) { <p class="receipts__error" role="alert">{{ error() }}</p> }
        </div>
        <div foot style="display:contents">@if (draft.id) { <button class="btn btn--danger" type="button" [disabled]="busy()" (click)="remove(draft.id)">Verwijderen</button> }<span class="spacer"></span><button class="btn" type="button" [disabled]="busy()" (click)="close()">Annuleren</button><button class="btn btn--primary" type="button" [disabled]="busy()" (click)="save()">{{ busy() ? 'Bewaren…' : 'Ontvangst bewaren' }}</button></div>
      </app-sheet>
    }
  `,
  styles: `
    :host{display:block;min-width:0}.receipts{padding:14px;margin:12px 0;border:1px solid var(--line);border-radius:14px;background:var(--surface)}.receipts header{display:flex;align-items:start;justify-content:space-between;gap:8px}.eyebrow{font-size:10px;color:var(--rose-dark);text-transform:uppercase;font-weight:700}h3{font-size:16px;margin:4px 0 12px}.receipts__status{font-size:10px;color:var(--muted);padding:4px 7px;border-radius:999px;background:var(--surface-2)}.receipts__metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.receipts__metrics>div{display:grid;gap:5px}.receipts__metrics span{font-size:10px;color:var(--muted)}.receipts__metrics b{font-size:14px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.receipts__plan{padding:12px;margin:12px 0;border-radius:12px;background:var(--surface-2);font-size:12px}.receipts__plan>div{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px}.receipts__plan small{display:block;font-size:10px;color:var(--muted);margin-top:3px}.receipts__plan>div>b{font-size:11px;white-space:nowrap}.receipts__trail{margin:10px 0}.receipts__trail article{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 0;border-top:1px solid var(--line)}.receipts__trail article>div{display:grid;gap:4px;min-width:0}.receipts__trail span{font-size:11px}.receipts__trail small{font-size:10px;color:var(--muted);overflow-wrap:anywhere}.receipts__warning{padding:10px;border-radius:10px;background:var(--warn-soft);font-size:11px;line-height:1.5;margin:10px 0}.receipts__hint{font-size:11px;color:var(--muted);line-height:1.5;margin:10px 0}.receipts__error{font-size:12px;color:var(--danger);line-height:1.5;margin-top:12px}.receipts__link{display:block;margin-top:12px;color:var(--rose-dark);font-size:11px}.field>span{font-size:12px;font-weight:650}.form-grid{margin-top:12px}
  `,
})
export class SalesReceipts {
  readonly view = input.required<SalesOrderView>();
  readonly dirty = input(false);
  readonly openRequest = input(0);
  readonly changed = output<SalesOrderView>();
  readonly draft = signal<ReceiptDraft | null>(null);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly summary = computed(() => this.view().paymentSummary);
  readonly partner = computed(() => isPartnerDocument(this.view().order));
  readonly containerId = computed(() => this.view().order.partnerPurchaseOrderId ?? this.view().order.sourcePurchaseOrderId);
  readonly canRecord = computed(() => this.view().order.docType === 'FACTUUR'
    && !['CONCEPT', 'GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN'].includes(this.view().order.status) && (this.summary()?.invoiceTotalEur ?? 0) > 0);
  readonly statusLabel = computed(() => ({ UNPAID: 'Nog te ontvangen', PARTIAL: 'Deels ontvangen', PAID: 'Volledig ontvangen', OVERPAID: 'Te veel ontvangen', CREDIT: 'Credit' })[this.summary()?.status ?? 'UNPAID']);
  private readonly sales = inject(SalesApi);
  private readonly ui = inject(Ui);

  constructor() { effect(() => { if (this.openRequest() > 0) untracked(() => this.add()); }); }
  add(amount?: number): void {
    if (!this.canRecord() || this.dirty() || this.busy()) return;
    const timeZone = 'Europe/Brussels';
    this.error.set('');
    this.draft.set({ amount: amount ?? this.summary()?.remainingEur ?? 0, ...receiptLocalParts(Date.now(), timeZone), timeZone, reference: '' });
  }
  edit(payment: SalesPayment): void {
    if (this.dirty() || this.busy()) return;
    this.error.set('');
    this.draft.set({ id: payment.id, amount: payment.amountEur, ...receiptLocalParts(payment.receivedAt, payment.timeZone), timeZone: payment.timeZone, reference: payment.reference ?? '' });
  }
  patch(change: Partial<ReceiptDraft>): void { this.draft.update((draft) => draft ? { ...draft, ...change } : null); this.error.set(''); }
  close(): void { if (!this.busy()) this.draft.set(null); }
  stamp(instant: string, timeZone: string): string {
    try { return new Intl.DateTimeFormat('nl-BE', { timeZone, dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(instant)); }
    catch { return instant; }
  }
  async issue(): Promise<void> {
    if (this.busy() || this.dirty()) return;
    this.busy.set(true);
    try {
      const fresh = await this.sales.issueInvoice(this.view().order.id);
      this.changed.emit(fresh);
      const timeZone = 'Europe/Brussels';
      if ((fresh.paymentSummary?.invoiceTotalEur ?? 0) > 0) this.draft.set({ amount: fresh.paymentSummary?.remainingEur ?? 0, ...receiptLocalParts(Date.now(), timeZone), timeZone, reference: '' });
      this.ui.toast('Factuur uitgereikt zonder e-mail');
    } catch (failure: unknown) { this.ui.toast(messageOf(failure, 'Factuur uitreiken mislukt'), 'err'); }
    finally { this.busy.set(false); }
  }
  async save(): Promise<void> {
    const draft = this.draft();
    if (!draft || this.busy() || this.dirty()) return;
    let body;
    try { body = receiptRequest(draft); } catch (failure: unknown) { this.error.set((failure as Error).message); return; }
    this.busy.set(true);
    try {
      const updated = draft.id ? await this.sales.updatePayment(this.view().order.id, draft.id, body) : await this.sales.addPayment(this.view().order.id, body);
      this.changed.emit(updated); this.draft.set(null); this.ui.toast('Ontvangst bewaard en gekoppeld', 'ok');
    } catch (failure: unknown) { this.error.set(messageOf(failure, 'Ontvangst bewaren mislukt')); }
    finally { this.busy.set(false); }
  }
  remove(id: number): void {
    if (this.busy()) return;
    this.ui.confirm({ title: 'Ontvangst verwijderen', message: 'De ontvangst wordt uit deze factuur, de gekoppelde container en de bankberekening verwijderd. De factuur kan opnieuw open komen te staan.', confirmLabel: 'Verwijderen', danger: true }, async () => {
      this.busy.set(true);
      try { await this.sales.deletePayment(this.view().order.id, id); this.changed.emit(await this.sales.order(this.view().order.id)); this.draft.set(null); this.ui.toast('Ontvangst verwijderd'); }
      catch (failure: unknown) { this.error.set(messageOf(failure, 'Ontvangst verwijderen mislukt')); }
      finally { this.busy.set(false); }
    });
  }
}
