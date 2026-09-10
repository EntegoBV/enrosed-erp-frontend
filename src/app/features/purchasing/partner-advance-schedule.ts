import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { PartnerAdvanceSchedule as Schedule, SalesOrderView } from '../../core/api/models';
import { SourcingApi } from '../../core/api/sourcing-api';
import { messageOf } from '../../core/api/errors';
import { DateField } from '../../shared/date-field';
import { DateNlPipe, EurPipe, NumPipe } from '../../shared/pipes';
import { AdvanceScheduleDraft, cents, scheduleDraft, schedulePreset, scheduleRequest, scheduleRowAmounts } from './partner-advance-schedule-state';
import { STATUS_LABEL } from '../sales/quote-status';

/** Match the same immutable facts the server checks before creating a term invoice. */
export function matchesAdvanceAgreement(document: SalesOrderView, plan: Schedule, sharePct: number): boolean {
  const quote = document.advanceAgreement;
  return !!quote && document.order.docType !== 'FACTUUR'
    && !['GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN'].includes(document.order.status)
    && document.order.customerId === plan.partnerCustomerId
    && quote.purchaseOrderId === plan.purchaseOrderId && quote.sharePct === sharePct
    && quote.financingPct === plan.financingPct && quote.agreedAmountEur === plan.agreedAmountEur
    && quote.rows.length === plan.rows.length
    && plan.rows.every(row => quote.rows.some(saved => saved.scheduleRowId === row.id
      && saved.label === row.label && saved.percentage === row.percentage
      && saved.amountEur === row.amountEur && (saved.dueDate ?? null) === (row.dueDate ?? null)));
}

@Component({
  selector: 'app-partner-advance-schedule',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { id: 'purchase-advance-invoices', tabindex: '-1' },
  imports: [RouterLink, DateField, DateNlPipe, EurPipe, NumPipe],
  template: `
    <section class="advance-plan" aria-label="Afzonderlijke voorschotfacturen">
      <header><h4><span class="step">2</span> Voorschotfacturen</h4>
        @if (schedule()?.rows?.length && !editing()) { <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="edit()">Aanpassen</button> }
      </header>
      @if (error()) { <p class="plan-error" role="alert">{{ error() }}</p> }
      @if (schedule(); as plan) {
        @if (!hasAgreementQuotes() && !hasQuote() && !hasInvoices() && !plan.invoicingBlocked) {
          <div class="plan-empty"><b>Begin met een offerte</b><p>Leg eerst de voorschottermijnen vast op de offerte. Daarna maak je hieronder de afzonderlijke voorschotfacturen.</p><button class="btn btn--primary" type="button" [disabled]="busy()" (click)="quote.emit()">Offerte met betaalafspraken maken</button></div>
        }
        @if (needsNewAgreementQuote()) {
          <div class="plan-empty" role="status"><b>Nieuwe offerte nodig voor deze afspraken</b><p>Het huidige betaalplan of de winstdeling wijkt af van de opgeslagen offerte, of die offerte is niet meer actief. Leg de actuele afspraken eerst vast in een nieuwe offerte. Bestaande facturen blijven beschikbaar.</p><button class="btn btn--primary" type="button" [disabled]="busy() || loading()" (click)="quote.emit()">Nieuwe offerte met betaalafspraken</button></div>
        }
        @if (agreementQuote(); as agreement) { <p class="plan-copy">De betaalafspraken staan op <a [routerLink]="['/sales', agreement.order.id]">offerte {{ agreement.order.number }}</a>. Elke termijn wordt afzonderlijk gefactureerd. De slotfactuur volgt na de veiling. <button class="linklike" type="button" [disabled]="busy()" (click)="quote.emit()">Nieuwe offerte voor gewijzigde afspraken</button></p> }
        <p class="plan-copy">Verdeel de partnerbijdrage van <b>{{ plan.agreedAmountEur | eur }}</b> in termijnen. Elke termijn krijgt een eigen voorschotfactuur. Percentages gelden voor dit partnerbedrag; bedragen zijn excl. btw.</p>
        @if (plan.invoicingBlocked) { <p class="plan-copy">De veilingafrekening is al begonnen. Nieuwe voorschotfacturen zijn daarom niet meer mogelijk. Eventuele ongebruikte termijnen kun je verwijderen via Termijnen aanpassen; bestaande facturen en betalingen blijven beschikbaar.</p> }
        @if (plan.reservedOutsideScheduleEur > 0) { <p class="plan-copy"><b>{{ plan.reservedOutsideScheduleEur | eur }}</b> is al gefactureerd of gepland buiten deze termijnen. Dit bedrag telt mee in het partnerbedrag; verdeel alleen het restant.</p> }
        @if (editing()) {
          @if (!plan.invoicingBlocked) { <p class="plan-label">Kies een verdeling</p><div class="plan-presets" role="group" aria-label="Factuurtermijnen kiezen">
            <button class="btn btn--sm" type="button" [disabled]="hasInvoices()" (click)="preset('30_70')">30% / 70%</button>
            <button class="btn btn--sm" type="button" [disabled]="hasInvoices()" (click)="preset('THIRDS')">1/3 / 2/3</button>
            <button class="btn btn--sm" type="button" [disabled]="hasInvoices()" (click)="preset('FULL')">100%</button>
            <button class="btn btn--sm" type="button" (click)="add()">+ Eigen termijn</button>
          </div> }
          @for (row of draft(); track $index; let index = $index) {
            <article class="plan-editor"><div class="plan-editor__head"><b>Termijn {{ index + 1 }}</b><span>{{ row.locked ? 'Factuur aangemaakt' : 'Nog te factureren' }}</span></div>
              <label class="field plan-name"><span>Wanneer betaalt de partner?</span><input class="input" [value]="row.label" [disabled]="row.locked || busy() || !!plan.invoicingBlocked" maxlength="160" placeholder="Bij start productie" (input)="patch(index, { label: $any($event.target).value })" /></label>
              <label class="field"><span>Berekenen als</span><select class="select" [value]="row.mode" [disabled]="row.locked || busy() || !!plan.invoicingBlocked" (change)="patch(index, { mode: $any($event.target).value })"><option value="PERCENT">% van partnerbedrag</option><option value="AMOUNT">Bedrag in EUR</option></select></label>
              <label class="field"><span>{{ row.mode === 'PERCENT' ? 'Percentage' : 'Bedrag (EUR)' }}</span><input class="input" type="number" min="0.01" [max]="row.mode === 'PERCENT' ? 100 : plan.agreedAmountEur" step="0.01" [value]="row.value" [disabled]="row.locked || busy() || !!plan.invoicingBlocked" (input)="patch(index, { value: +$any($event.target).value })" /></label>
              <div class="field"><span>Vervaldatum (optioneel)</span>@if (row.locked || plan.invoicingBlocked) { <span>{{ row.dueDate | dateNl }}</span> } @else { <app-date-field [value]="row.dueDate" (valueChange)="patch(index, { dueDate: $event })" /> }</div>
              <div class="plan-row-result"><b>{{ amount(row) | eur }} <small>excl. btw</small></b>@if (row.locked) { <small>Factuur bestaat; termijn vastgezet</small> } @else { <button class="linklike" type="button" [disabled]="busy()" (click)="remove(index)">Termijn verwijderen</button> }</div>
            </article>
          }
          <p class="plan-total"><b>{{ allocated() | eur }} ingepland</b><span [class.plan-error]="unallocated() < 0">{{ unallocated() | eur }} nog te verdelen</span></p>
          <div class="plan-presets"><button class="btn btn--primary btn--sm" type="button" [disabled]="busy()" (click)="save()">{{ busy() ? 'Bewaren…' : 'Factuurtermijnen bewaren' }}</button><button class="btn btn--sm" type="button" [disabled]="busy()" (click)="editing.set(false)">Annuleren</button></div>
          @if (!hasInvoices() && !plan.invoicingBlocked) { <p class="plan-copy">Zijn de containerkosten of het financieringspercentage veranderd? <button class="linklike" type="button" [disabled]="busy()" (click)="recalculate()">Afgesproken bedrag opnieuw berekenen</button>. Bewaar eerst eventuele wijzigingen aan de container.</p> }
        } @else {
          @for (row of plan.rows; track row.id; let index = $index) {
            <article class="plan-row"><div><small class="plan-label">TERMIJN {{ index + 1 }}</small><b>{{ row.label }}</b><small>{{ row.percentage == null ? 'Vast bedrag' : (row.percentage | num) + '% van partnerbedrag' }} · {{ row.dueDate ? 'vervalt ' + (row.dueDate | dateNl) : 'geen vervaldatum' }}</small>
              @if (row.invoiceId) { <a [routerLink]="['/sales', row.invoiceId]">{{ row.invoiceNumber }} · {{ row.invoiceStatus ? statusLabel[row.invoiceStatus] : 'status onbekend' }} ›</a><small>{{ row.receivedEur | eur }} netto ontvangen · {{ row.remainingEur | eur }} open (incl. btw)</small> }
              @else { <small>{{ plan.invoicingBlocked ? 'Ongebruikte termijn · afrekening al begonnen' : 'Nog niet gefactureerd' }}</small> }
            </div><div class="plan-actions"><b>{{ row.amountEur | eur }}</b>@if (!row.invoiceId && !plan.invoicingBlocked) { <button class="btn btn--primary btn--sm" type="button" [disabled]="busy() || loading() || !canCreateInvoice()" (click)="makeInvoice(row.id)">Conceptfactuur maken</button> } @else if (row.invoiceId) { <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="openInvoice.emit(row.invoiceId)">{{ row.invoiceStatus === 'CONCEPT' ? 'Factuur bekijken & uitgeven' : 'Betalingen bekijken' }}</button> }</div></article>
          } @empty { <div class="plan-empty"><b>{{ plan.invoicingBlocked ? 'Voorschotplanning afgesloten' : 'Hoe betaalt de partner zijn bijdrage?' }}</b><p>{{ plan.invoicingBlocked ? 'De veilingafrekening is begonnen. Bekijk de bestaande documenten en ontvangsten hieronder.' : 'Bijvoorbeeld 30% bij start productie en 70% na productie. Een eigen verdeling kan ook.' }}</p>@if (!plan.invoicingBlocked) { <button class="btn btn--primary" type="button" [disabled]="busy()" (click)="edit()">Voorschottermijnen instellen</button> }</div> }
          @if (plan.unallocatedEur > 0 && plan.rows.length) { <p class="plan-copy">{{ plan.unallocatedEur | eur }} van de partnerfinanciering is nog niet aan een factuurtermijn toegewezen.</p> }
          @if (plan.rows.length) { <p class="plan-copy">Na het maken controleer en geef je de factuur uit. De werkelijke ontvangst noteer je apart bij de factuur.</p> }
        }
      } @else if (loading()) { <p class="plan-copy">Factuurtermijnen laden…</p> }
    </section>
  `,
  styles: `
    :host{display:block;min-width:0;scroll-margin-top:calc(var(--appbar-h) + 90px)}.advance-plan{container:advance-plan / inline-size;padding:18px;border-block:1px solid var(--line);background:var(--surface)}header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}h4{display:flex;align-items:center;gap:9px;font-size:15px;margin:0;font-weight:700}.step{display:inline-grid;place-items:center;flex:none;width:26px;height:26px;border-radius:50%;background:var(--rose-soft);color:var(--rose-dark);font-size:12px}
    .plan-copy{font-size:12px;line-height:1.6;color:var(--muted);margin:12px 0}.plan-copy b{color:var(--ink-2)}.plan-label{font-size:12px;font-weight:650;color:var(--ink-2);margin:16px 0 6px}.plan-presets{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 16px}.btn{min-height:44px;white-space:normal}.plan-presets>.btn{flex:1 1 auto}
    .plan-empty{padding:16px;margin-top:14px;border-radius:12px;background:var(--surface-2)}.plan-empty>b{font-size:14px}.plan-empty p{font-size:13px;line-height:1.6;color:var(--muted);margin:8px 0 14px}.plan-empty .btn{width:100%}
    .plan-editor{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding:15px;border:1px solid var(--line);border-radius:12px;margin:12px 0;background:var(--surface)}.plan-editor__head{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;padding-bottom:11px;border-bottom:1px solid var(--line);font-size:13px}.plan-editor__head span{font-size:11px;color:var(--muted)}.plan-name,.plan-row-result{grid-column:1/-1}.field{min-width:0}.field>span{font-size:12px;font-weight:650}.input,.select{min-width:0;min-height:44px;font-size:14px}.plan-row-result,.plan-total{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;font-size:13px}.plan-row-result{padding-top:8px}.plan-row-result>b{font-size:17px}.plan-row-result small{font-size:11px;color:var(--muted);font-weight:400}.plan-row-result .linklike{min-height:44px;font-size:12px}
    .plan-row{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;padding:15px;border:1px solid var(--line);border-radius:12px;margin:12px 0}.plan-row>div{display:grid;gap:7px;min-width:0}.plan-row b{font-size:14px;overflow-wrap:anywhere}.plan-row small{font-size:12px;color:var(--muted);line-height:1.5}.plan-row .plan-label{margin:0;color:var(--rose-dark);font-size:10px;letter-spacing:.04em}.plan-row a{font-size:13px;color:var(--rose-dark);overflow-wrap:anywhere}.plan-actions{display:flex!important;flex-wrap:wrap;align-items:center;justify-content:space-between;border-top:1px solid var(--line);padding-top:12px;gap:10px}.plan-actions>b{font-size:18px;font-variant-numeric:tabular-nums}.plan-actions .btn{font-size:12px}
    .plan-error{color:var(--danger);font-size:13px;line-height:1.6}.plan-total{padding:13px;border-radius:10px;background:var(--rose-soft);line-height:1.5}.plan-total>span{color:var(--muted);font-size:12px}
    @container advance-plan (max-width:360px){.plan-editor{grid-template-columns:1fr;padding:12px;gap:12px}.input,.select{font-size:16px}.plan-presets>.btn{flex-basis:40%}.plan-actions .btn{width:100%}}
    @container advance-plan (min-width:600px){.plan-empty{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:24px;align-items:center}.plan-empty>b{grid-column:1}.plan-empty p{grid-column:1;margin-bottom:0}.plan-empty .btn{grid-column:2;grid-row:1/3;width:auto}}
    @media(max-width:420px){.advance-plan{padding:14px}}
  `,
})
export class PartnerAdvanceSchedule {
  readonly purchaseOrderId = input.required<number>();
  readonly documents = input<SalesOrderView[]>([]);
  readonly sharePct = input(50);
  readonly saved = output<void>();
  readonly invoiceCreated = output<SalesOrderView>();
  readonly openInvoice = output<number>();
  readonly quote = output<void>();
  readonly hasAgreementQuotes = computed(() => this.documents().some(doc => doc.advanceAgreement != null));
  readonly agreementQuote = computed(() => {
    const plan = this.schedule();
    return plan ? this.documents().find(doc => matchesAdvanceAgreement(doc, plan, this.sharePct())) ?? null : null;
  });
  readonly hasQuote = computed(() => this.hasAgreementQuotes() ? !!this.agreementQuote()
    : this.documents().some(doc => doc.order.docType !== 'FACTUUR' && !['GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN'].includes(doc.order.status)));
  readonly needsNewAgreementQuote = computed(() => !!this.schedule() && !this.schedule()?.invoicingBlocked
    && this.hasAgreementQuotes() && !this.agreementQuote());
  readonly canCreateInvoice = computed(() => this.schedule()?.purchaseOrderId === this.purchaseOrderId()
    && !this.schedule()?.invoicingBlocked && !this.needsNewAgreementQuote() && (this.hasQuote() || this.hasInvoices()));
  readonly schedule = signal<Schedule | null>(null);
  readonly draft = signal<AdvanceScheduleDraft[]>([]);
  readonly editing = signal(false);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly statusLabel = STATUS_LABEL;
  readonly hasInvoices = computed(() => (this.schedule()?.reservedOutsideScheduleEur ?? 0) > 0 || (this.schedule()?.rows.some((row) => row.invoiceId != null) ?? false));
  readonly amounts = computed(() => scheduleRowAmounts(this.draft(), this.schedule()?.agreedAmountEur ?? 0));
  readonly allocated = computed(() => cents(this.amounts().reduce((total, amount) => total + amount, 0)));
  readonly unallocated = computed(() => cents((this.schedule()?.agreedAmountEur ?? 0) - (this.schedule()?.reservedOutsideScheduleEur ?? 0) - this.allocated()));
  private readonly sourcing = inject(SourcingApi);
  private version = 0;
  constructor() { effect(() => { const id = this.purchaseOrderId(); this.documents(); void this.load(id); }); }
  async load(id = this.purchaseOrderId()): Promise<void> {
    const version = ++this.version; this.loading.set(true); this.error.set('');
    try { const plan = await this.sourcing.partnerAdvanceSchedule(id); if (version === this.version) this.schedule.set(plan); }
    catch (failure) { if (version === this.version) this.error.set(messageOf(failure, 'Factuurtermijnen laden mislukt')); }
    finally { if (version === this.version) this.loading.set(false); }
  }
  edit(): void { this.draft.set(scheduleDraft(this.schedule()?.rows ?? [])); this.error.set(''); this.editing.set(true); }
  preset(value: '30_70' | 'THIRDS' | 'FULL'): void { if (!this.hasInvoices() && !this.schedule()?.invoicingBlocked && !this.busy()) this.draft.set(schedulePreset(value, this.schedule()?.agreedAmountEur ?? 0)); }
  add(): void { if (this.schedule()?.invoicingBlocked || this.busy()) return; this.draft.update((rows) => [...rows, { label: '', mode: 'AMOUNT', value: Math.max(0, this.unallocated()), dueDate: '', locked: false }]); }
  patch(index: number, change: Partial<AdvanceScheduleDraft>): void { if (this.schedule()?.invoicingBlocked || this.busy()) return; this.draft.update((rows) => rows.map((row, i) => i === index && !row.locked ? { ...row, ...change } : row)); this.error.set(''); }
  remove(index: number): void { this.draft.update((rows) => rows.filter((row, i) => i !== index || row.locked)); }
  amount(row: AdvanceScheduleDraft): number { return this.amounts()[this.draft().indexOf(row)] ?? 0; }
  async save(): Promise<void> {
    if (this.busy()) return;
    let body; try { body = scheduleRequest(this.draft(), this.schedule()?.agreedAmountEur ?? 0, this.schedule()?.reservedOutsideScheduleEur ?? 0, !!this.schedule()?.rows.length); } catch (failure) { this.error.set((failure as Error).message); return; }
    this.busy.set(true); this.error.set('');
    try { this.schedule.set(await this.sourcing.savePartnerAdvanceSchedule(this.purchaseOrderId(), body)); this.editing.set(false); this.saved.emit(); }
    catch (failure) { this.error.set(messageOf(failure, 'Factuurtermijnen bewaren mislukt')); }
    finally { this.busy.set(false); }
  }
  async recalculate(): Promise<void> {
    if (this.busy() || this.hasInvoices() || this.schedule()?.invoicingBlocked) return;
    this.busy.set(true); this.error.set('');
    try { const plan = await this.sourcing.savePartnerAdvanceSchedule(this.purchaseOrderId(), { rows: [], recalculateAgreement: true }); this.schedule.set(plan); this.draft.set([]); this.saved.emit(); }
    catch (failure) { this.error.set(messageOf(failure, 'Financieringsbedrag opnieuw berekenen mislukt')); }
    finally { this.busy.set(false); }
  }
  async makeInvoice(rowId: number): Promise<void> {
    if (this.busy() || this.loading() || !this.canCreateInvoice()) return;
    this.busy.set(true); this.error.set('');
    try { const invoice = await this.sourcing.invoicePartnerAdvance(this.purchaseOrderId(), rowId); this.invoiceCreated.emit(invoice); await this.load(); }
    catch (failure) { this.error.set(messageOf(failure, 'Voorschotfactuur maken mislukt')); }
    finally { this.busy.set(false); }
  }
}
