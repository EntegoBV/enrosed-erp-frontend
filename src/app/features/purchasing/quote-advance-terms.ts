import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DateField } from '../../shared/date-field';
import { EurPipe } from '../../shared/pipes';
import { AdvanceScheduleDraft, cents, schedulePreset, scheduleRowAmounts } from './partner-advance-schedule-state';

@Component({
  selector: 'app-quote-advance-terms',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DateField, EurPipe],
  template: `
    <section class="quote-terms" aria-labelledby="quote-terms-title">
      <header><span class="eyebrow">Op de offerte</span><h3 id="quote-terms-title">Betaalafspraken</h3>
        <p>Elke termijn is een voorschot. De slotfactuur volgt na de veiling, met verrekening van de voorschotten, de werkelijke kosten en het afgesproken aandeel in het resultaat.</p>
      </header>
      @if (locked()) { <p class="terms-note">Deze termijnen zijn al in gebruik. De offerte neemt de bewaarde afspraken over. Bekijk bestaande facturen bij Betalingen op de inkooporder.</p> }
      @else {
        <div class="presets" role="group" aria-label="Betaalregeling kiezen">
          <button class="btn btn--sm" type="button" [disabled]="disabled()" (click)="preset('30_70')">30% / 70%</button>
          <button class="btn btn--sm" type="button" [disabled]="disabled()" (click)="preset('THIRDS')">1/3 / 2/3</button>
          <button class="btn btn--sm" type="button" [disabled]="disabled()" (click)="preset('FULL')">100% voorschot</button>
          <button class="btn btn--sm" type="button" [disabled]="disabled()" (click)="add()">+ Eigen termijn</button>
        </div>
      }
      @for (row of rows(); track $index; let index = $index) {
        <article class="term">
          <div class="term-head"><b>Voorschot {{ index + 1 }}</b><strong>{{ amounts()[index] | eur }} <small>excl. btw</small></strong></div>
          <label class="term-name"><span>Betaalmoment</span><input class="input" [value]="row.label" [disabled]="locked() || disabled()" maxlength="160" placeholder="Bij start productie" (input)="patch(index, { label: $any($event.target).value })" /></label>
          <label><span>Berekenen als</span><select class="select" [value]="row.mode" [disabled]="locked() || disabled()" (change)="patch(index, { mode: $any($event.target).value })"><option value="PERCENT">% van de afgesproken bijdrage</option><option value="AMOUNT">Bedrag in EUR</option></select></label>
          <label><span>{{ row.mode === 'PERCENT' ? 'Percentage' : 'Bedrag (EUR)' }}</span><input class="input" type="number" min="0.01" [max]="row.mode === 'PERCENT' ? 100 : agreedEur()" step="0.01" [value]="row.value" [disabled]="locked() || disabled()" (input)="patch(index, { value: +$any($event.target).value })" /></label>
          <div class="term-date"><span>Datum (optioneel)</span>@if (locked() || disabled()) { <span>{{ row.dueDate || 'Volgens betaalmoment' }}</span> } @else { <app-date-field [value]="row.dueDate" (valueChange)="patch(index, { dueDate: $event })" /> }</div>
          @if (!locked()) { <button class="linklike remove" type="button" [disabled]="disabled()" (click)="remove(index)">Termijn verwijderen</button> }
        </article>
      }
      @if (unallocated() > 0) { <p class="terms-note">{{ unallocated() | eur }} van de bijdrage heeft nog geen betaalafspraak. Voeg hiervoor een termijn toe.</p> }
      @if (unallocated() < 0) { <p class="terms-error" role="alert">De voorschotten overschrijden de afgesproken bijdrage met {{ -unallocated() | eur }}.</p> }
      <p class="terms-note">Percentages gelden voor de afgesproken bijdrage van de klant. Op de offerte staan de afzonderlijke voorschotten en de latere afrekening; er staat geen definitief ordertotaal.</p>
    </section>
  `,
  styles: `
    :host{display:block;min-width:0}.quote-terms{display:grid;gap:14px;padding:18px;border:1px solid var(--rose-line);border-radius:14px;background:var(--rose-soft)}header h3{font-size:17px;margin:5px 0 8px}header p,.terms-note{font-size:13px;line-height:1.6;color:var(--ink-2);margin:0}.eyebrow{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--rose-dark)}.presets{display:flex;flex-wrap:wrap;gap:8px}.btn{min-height:44px}.term{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:14px;background:var(--surface);border:1px solid var(--line);border-radius:12px}.term-head{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;font-size:13px}.term-head strong{font-size:16px}.term-head small{font-weight:400;font-size:11px;color:var(--muted)}label,.term-date{display:grid;gap:6px;font-size:12px;min-width:0}.term-name{grid-column:1/-1}.input,.select{min-width:0;min-height:44px;font-size:14px}.remove{align-self:end;justify-self:end;min-height:44px;font-size:12px}.terms-error{font-size:13px;color:var(--danger);margin:0}
    @media(max-width:520px){.quote-terms{padding:13px}.term{grid-template-columns:1fr}.term-name,.term-head{grid-column:auto}.input,.select{font-size:16px}.presets>.btn{flex:1 1 40%}.remove{justify-self:start}}
  `,
})
export class QuoteAdvanceTerms {
  readonly rows = input.required<AdvanceScheduleDraft[]>();
  readonly agreedEur = input.required<number>();
  readonly locked = input(false);
  readonly disabled = input(false);
  readonly rowsChange = output<AdvanceScheduleDraft[]>();
  readonly amounts = computed(() => scheduleRowAmounts(this.rows(), this.agreedEur()));
  readonly unallocated = computed(() => cents(this.agreedEur() - this.amounts().reduce((sum, amount) => sum + amount, 0)));
  preset(preset: '30_70' | 'THIRDS' | 'FULL'): void { if (!this.locked() && !this.disabled()) this.rowsChange.emit(schedulePreset(preset, this.agreedEur())); }
  patch(index: number, change: Partial<AdvanceScheduleDraft>): void { if (!this.locked() && !this.disabled()) this.rowsChange.emit(this.rows().map((row, i) => i === index ? { ...row, ...change } : row)); }
  add(): void { if (!this.locked() && !this.disabled()) this.rowsChange.emit([...this.rows(), { label: '', mode: 'AMOUNT', value: Math.max(0, this.unallocated()), dueDate: '', locked: false }]); }
  remove(index: number): void { if (!this.locked() && !this.disabled()) this.rowsChange.emit(this.rows().filter((_, i) => i !== index)); }
}
