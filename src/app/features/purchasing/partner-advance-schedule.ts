import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { PartnerAdvanceSchedule as Schedule, SalesOrderView } from '../../core/api/models';
import { SourcingApi } from '../../core/api/sourcing-api';
import { messageOf } from '../../core/api/errors';
import { DateField } from '../../shared/date-field';
import { DateNlPipe, EurPipe, NumPipe } from '../../shared/pipes';
import { AdvanceScheduleDraft, cents, scheduleDraft, schedulePreset, scheduleRequest, scheduleRowAmounts } from './partner-advance-schedule-state';
import { STATUS_LABEL } from '../sales/quote-status';

@Component({
  selector: 'app-partner-advance-schedule',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DateField, DateNlPipe, EurPipe, NumPipe],
  template: `
    <section class="advance-plan" aria-label="Afzonderlijke voorschotfacturen">
      <header><div><span class="eyebrow">Partnerfinanciering</span><h3>Facturen per termijn</h3></div>
        @if (schedule() && !editing()) { <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="edit()">{{ schedule()!.rows.length ? 'Termijnen aanpassen' : 'Termijnen instellen' }}</button> }
      </header>
      @if (error()) { <p class="plan-error" role="alert">{{ error() }}</p> }
      @if (schedule(); as plan) {
        <p class="plan-copy">{{ plan.financingPct | num }}% partnerfinanciering van {{ plan.externalCostEur | eur }} containerkosten = <b>{{ plan.agreedAmountEur | eur }}</b>. Verdeel dit partnerbedrag in afzonderlijke voorschotfacturen. Bedragen hieronder zijn excl. btw.</p>
        @if (plan.invoicingBlocked) { <p class="plan-copy">De veilingafrekening is al begonnen. Nieuwe voorschotfacturen zijn daarom niet meer mogelijk. Eventuele ongebruikte termijnen kun je verwijderen via Termijnen aanpassen; bestaande facturen en betalingen blijven beschikbaar.</p> }
        @if (plan.reservedOutsideScheduleEur > 0) { <p class="plan-copy"><b>{{ plan.reservedOutsideScheduleEur | eur }}</b> is al gefactureerd of gepland buiten deze termijnen. Dit bedrag telt mee in het partnerbedrag; verdeel alleen het restant.</p> }
        @if (editing()) {
          @if (!plan.invoicingBlocked) { <div class="plan-presets" role="group" aria-label="Factuurtermijnen kiezen">
            <button class="btn btn--sm" type="button" [disabled]="hasInvoices()" (click)="preset('30_70')">30% / 70%</button>
            <button class="btn btn--sm" type="button" [disabled]="hasInvoices()" (click)="preset('THIRDS')">1/3 / 2/3</button>
            <button class="btn btn--sm" type="button" [disabled]="hasInvoices()" (click)="preset('FULL')">100%</button>
            <button class="btn btn--sm" type="button" (click)="add()">+ Eigen termijn</button>
          </div> }
          @for (row of draft(); track $index; let index = $index) {
            <article class="plan-editor">
              <label class="field plan-name"><span>Naam / mijlpaal</span><input class="input" [value]="row.label" [disabled]="row.locked || busy() || !!plan.invoicingBlocked" maxlength="160" placeholder="Bij start productie" (input)="patch(index, { label: $any($event.target).value })" /></label>
              <label class="field"><span>Verdelen als</span><select class="select" [value]="row.mode" [disabled]="row.locked || busy() || !!plan.invoicingBlocked" (change)="patch(index, { mode: $any($event.target).value })"><option value="PERCENT">% van partnerbedrag</option><option value="AMOUNT">Bedrag in EUR</option></select></label>
              <label class="field"><span>{{ row.mode === 'PERCENT' ? 'Percentage' : 'Bedrag (EUR)' }}</span><input class="input" type="number" min="0.01" [max]="row.mode === 'PERCENT' ? 100 : plan.agreedAmountEur" step="0.01" [value]="row.value" [disabled]="row.locked || busy() || !!plan.invoicingBlocked" (input)="patch(index, { value: +$any($event.target).value })" /></label>
              <div class="field"><span>Vervaldatum</span>@if (row.locked || plan.invoicingBlocked) { <span>{{ row.dueDate | dateNl }}</span> } @else { <app-date-field [value]="row.dueDate" (valueChange)="patch(index, { dueDate: $event })" /> }</div>
              <div class="plan-row-result"><b>{{ amount(row) | eur }}</b>@if (row.locked) { <small>Factuur bestaat; termijn vastgezet</small> } @else { <button class="linklike" type="button" [disabled]="busy()" (click)="remove(index)">Termijn verwijderen</button> }</div>
            </article>
          }
          <p class="plan-total"><b>{{ allocated() | eur }} ingepland</b><span [class.plan-error]="unallocated() < 0">{{ unallocated() | eur }} nog te verdelen</span></p>
          <div class="plan-presets"><button class="btn btn--primary btn--sm" type="button" [disabled]="busy()" (click)="save()">{{ busy() ? 'Bewaren…' : 'Factuurtermijnen bewaren' }}</button><button class="btn btn--sm" type="button" [disabled]="busy()" (click)="editing.set(false)">Annuleren</button></div>
          @if (!hasInvoices() && !plan.invoicingBlocked) { <p class="plan-copy">Zijn de containerkosten of het financieringspercentage veranderd? <button class="linklike" type="button" [disabled]="busy()" (click)="recalculate()">Afgesproken bedrag opnieuw berekenen</button>. Bewaar eerst eventuele wijzigingen aan de container.</p> }
        } @else {
          @for (row of plan.rows; track row.id) {
            <article class="plan-row"><div><b>{{ row.label }}</b><small>{{ row.percentage == null ? 'Vast bedrag' : (row.percentage | num) + '% van partnerbedrag' }} · {{ row.dueDate ? 'vervalt ' + (row.dueDate | dateNl) : 'geen vervaldatum' }}</small>
              @if (row.invoiceId) { <a [routerLink]="['/sales', row.invoiceId]">{{ row.invoiceNumber }} · {{ row.invoiceStatus ? statusLabel[row.invoiceStatus] : 'status onbekend' }} ›</a><small>{{ row.receivedEur | eur }} netto ontvangen · {{ row.remainingEur | eur }} open (incl. btw)</small> }
              @else { <small>{{ plan.invoicingBlocked ? 'Ongebruikte termijn · afrekening al begonnen' : 'Nog niet gefactureerd' }}</small> }
            </div><div class="plan-actions"><b>{{ row.amountEur | eur }}</b>@if (!row.invoiceId && !plan.invoicingBlocked) { <button class="btn btn--primary btn--sm" type="button" [disabled]="busy()" (click)="makeInvoice(row.id)">Voorschotfactuur maken</button> } @else if (row.invoiceId) { <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="openInvoice.emit(row.invoiceId)">Betalingen / uitgeven</button> }</div></article>
          } @empty { <p class="plan-copy">Nog geen factuurtermijnen ingesteld. Kies bijvoorbeeld 30% bij productiestart en 70% na productie.</p> }
          @if (plan.unallocatedEur > 0 && plan.rows.length) { <p class="plan-copy">{{ plan.unallocatedEur | eur }} van de partnerfinanciering is nog niet aan een factuurtermijn toegewezen.</p> }
          <p class="plan-copy">Elke termijn krijgt een eigen factuurnummer. Een conceptfactuur telt pas mee als vordering nadat ze is uitgegeven. Noteer de ontvangst bij de betreffende factuur.</p>
        }
      } @else if (loading()) { <p class="plan-copy">Factuurtermijnen laden…</p> }
    </section>
  `,
  styles: `:host{display:block}.advance-plan{padding:14px;border:1px solid var(--line);border-radius:12px;margin:12px 0;background:var(--surface)}header{display:flex;justify-content:space-between;align-items:start;gap:12px}.eyebrow{font-size:10px;color:var(--rose-dark);font-weight:700;text-transform:uppercase}h3{font-size:15px;margin:4px 0}.plan-copy{font-size:11px;line-height:1.6;color:var(--muted);margin:10px 0}.plan-presets{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0}.plan-editor{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:12px 0;border-top:1px solid var(--line)}.plan-name,.plan-row-result{grid-column:1/-1}.field>span{font-size:11px;font-weight:650}.plan-row-result,.plan-total{display:flex;justify-content:space-between;gap:10px;font-size:12px}.plan-row-result small{font-size:10px;color:var(--muted)}.plan-row{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid var(--line)}.plan-row>div{display:grid;gap:5px;min-width:0}.plan-row b{font-size:12px}.plan-row small{font-size:10px;color:var(--muted)}.plan-row a{font-size:11px;color:var(--rose-dark)}.plan-actions{justify-items:end;align-content:start}.plan-actions>b{white-space:nowrap;font-size:14px}.plan-actions .btn{white-space:normal;text-align:center}.plan-error{color:var(--danger);font-size:12px;line-height:1.5}.plan-total{padding:12px;border-radius:10px;background:var(--surface-2)}@media(max-width:420px){.plan-row{display:grid}.plan-actions{justify-items:start}.plan-editor{grid-template-columns:1fr}}`,
})
export class PartnerAdvanceSchedule {
  readonly purchaseOrderId = input.required<number>();
  readonly documents = input<SalesOrderView[]>([]);
  readonly saved = output<void>();
  readonly invoiceCreated = output<SalesOrderView>();
  readonly openInvoice = output<number>();
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
    if (this.busy() || this.schedule()?.invoicingBlocked) return;
    this.busy.set(true); this.error.set('');
    try { const invoice = await this.sourcing.invoicePartnerAdvance(this.purchaseOrderId(), rowId); this.invoiceCreated.emit(invoice); await this.load(); }
    catch (failure) { this.error.set(messageOf(failure, 'Voorschotfactuur maken mislukt')); }
    finally { this.busy.set(false); }
  }
}
