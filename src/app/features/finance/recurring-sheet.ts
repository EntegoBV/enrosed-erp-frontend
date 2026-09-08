import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RecurringCost, RecurringInterval } from '../../core/api/models';
import { DateField } from '../../shared/date-field';
import { DateNlPipe, EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import { SALES_CHANNELS } from '../sales/sales-channels';
import { categoryChoices } from './cost-categories';
import { INTERVALS, addDays, inclOf, monthlyEquivalentEur, occurrencesBetween, yearlyEur } from './finance-metrics';
import { blankRecurring } from './finance-sections';
import { FinanceState } from './finance-state';

/** The recurring cost form: what, how much, how often, from when, and whether the bank pays it by itself. */
@Component({
  selector: 'app-recurring-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet, DateField, EurPipe, DateNlPipe],
  template: `
    <app-sheet [title]="draft().id ? 'Vaste kost bewerken' : 'Vaste kost instellen'" (closed)="state.recurringDraft.set(null)">
      <div body>
        <div class="form-grid">
          <div class="field span-2"><label class="req" for="r-name">Naam</label>
            <input class="input" id="r-name" placeholder="bijv. Huur magazijn" [ngModel]="draft().name" (ngModelChange)="patch({ name: $event })" /></div>
          <div class="field"><label class="req" for="r-cat">Categorie</label>
            <select class="select" id="r-cat" [ngModel]="categoryChoice()" (ngModelChange)="pickCategory($event)">
              @for (category of categories(); track category.code) { <option [value]="category.code">{{ category.label }}</option> }
              <option value="__other__">Eigen categorie…</option>
            </select>
            @if (customCategory()) {
              <input class="input mt-8" aria-label="Eigen categorie" placeholder="bijv. OPLEIDING" [ngModel]="draft().category" (ngModelChange)="patch({ category: ($event || '').toUpperCase() })" />
            }</div>
          <div class="field"><label for="r-party">Aan wie</label>
            <input class="input" id="r-party" placeholder="bijv. Immo Ham" [ngModel]="draft().party" (ngModelChange)="patch({ party: $event })" /></div>
          <div class="field"><label class="req" for="r-amount">Bedrag excl. btw</label>
            <span class="fin-money"><i>€</i><input class="input num right" id="r-amount" type="number" min="0" step="0.01" inputmode="decimal"
                   [ngModel]="draft().amountExclEur || null" (ngModelChange)="patch({ amountExclEur: +($event || 0) })" /></span></div>
          <div class="field"><label for="r-vat">Btw</label>
            <span class="fin-money">
              <span class="fin-quick" role="group" aria-label="Btw kiezen">
                <button type="button" [class.on]="draft().vatPct === 21" (click)="patch({ vatPct: 21 })">21</button>
                <button type="button" [class.on]="draft().vatPct === 6" (click)="patch({ vatPct: 6 })">6</button>
                <button type="button" [class.on]="!draft().vatPct" (click)="patch({ vatPct: 0 })">0</button>
              </span>
              <input class="input num right" id="r-vat" type="number" min="0" max="100" step="0.5" inputmode="decimal"
                     [ngModel]="draft().vatPct ?? 0" (ngModelChange)="patch({ vatPct: +($event || 0) })" /><i>%</i></span>
            <span class="hint">Incl. btw: {{ inclOf(draft()) | eur }}</span></div>
          <div class="field span-2"><span class="label req">Hoe vaak</span>
            <div class="fin-chips" role="group" aria-label="Ritme">
              @for (option of intervals; track option.code) {
                <button type="button" class="fin-chip" [class.on]="draft().interval === option.code" (click)="patch({ interval: option.code })" [title]="option.hint">{{ option.label }}</button>
              }
            </div>
            <span class="hint">≈ {{ monthly() | eur: 0 }} per maand · {{ yearly() | eur: 0 }} per jaar, excl. btw</span></div>
          <div class="field"><label class="req" for="r-start">Eerste keer op</label>
            <app-date-field fieldId="r-start" [value]="draft().startDate" (valueChange)="patch({ startDate: $event })" />
            @if (backlog() > 0 && !draft().id) { <span class="hint fin-hint--warn">{{ backlog() }} {{ backlog() === 1 ? 'periode' : 'periodes' }} tot vandaag worden meteen geboekt.</span> }</div>
          <div class="field"><label for="r-end">Laatste keer op <span class="opt"></span></label>
            <app-date-field fieldId="r-end" [value]="draft().endDate ?? ''" (valueChange)="patch({ endDate: $event || null })" />
            <span class="hint">{{ draft().endDate ? 'Daarna stopt de reeks vanzelf.' : 'Leeg: loopt door tot je ze pauzeert.' }}</span></div>
          <div class="field span-2 fin-switches">
            <label class="fin-switch"><input type="checkbox" [ngModel]="draft().autoPaid" (ngModelChange)="patch({ autoPaid: $event })" />
              <span><b>Domiciliëring of doorlopende opdracht</b><small>De geboekte kost staat meteen op betaald.</small></span></label>
            @if (draft().id) {
              <label class="fin-switch"><input type="checkbox" [ngModel]="draft().active" (ngModelChange)="patch({ active: $event })" />
                <span><b>Actief</b><small>Uitgevinkt: gepauzeerd, er wordt niets meer geboekt.</small></span></label>
            }
          </div>
          <div class="field"><label for="r-channel">Hoort bij verkoopkanaal <span class="opt"></span></label>
            <select class="select" id="r-channel" [ngModel]="draft().salesChannel ?? ''" (ngModelChange)="patch({ salesChannel: $event || null })">
              <option value="">Algemene kost</option>
              @for (channel of channels; track channel.code) { <option [value]="channel.code">{{ channel.label }}</option> }
            </select></div>
          <div class="field"><label for="r-ref">Referentie <span class="opt"></span></label>
            <input class="input" id="r-ref" placeholder="contractnummer, klantnummer" [ngModel]="draft().reference" (ngModelChange)="patch({ reference: $event })" /></div>
          <div class="field span-2"><label for="r-notes">Notities <span class="opt"></span></label>
            <textarea class="textarea" id="r-notes" rows="2" [ngModel]="draft().notes" (ngModelChange)="patch({ notes: $event })"></textarea></div>
        </div>
        @if (preview().length) {
          <p class="fin-note">Volgende boekingen: @for (date of preview(); track date; let last = $last) {<b>{{ date | dateNl }}</b>@if (!last) {, }}</p>
        }
      </div>
      <div foot style="display:contents">
        @if (draft().id) { <button class="btn btn--danger" type="button" [disabled]="state.saving()" (click)="state.deleteRecurring(draft())">Verwijderen</button> }
        <span class="spacer"></span>
        <button class="btn" type="button" (click)="state.recurringDraft.set(null)">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="state.saving() || !canSave()" (click)="state.saveRecurring(draft())">{{ state.saving() ? 'Bezig…' : draft().id ? 'Bewaren' : 'Instellen' }}</button>
      </div>
    </app-sheet>
  `,
})
export class RecurringSheet {
  readonly state = inject(FinanceState);
  readonly channels = SALES_CHANNELS;
  readonly intervals = INTERVALS;
  readonly inclOf = inclOf;
  readonly draft = linkedSignal<RecurringCost>(() => this.state.recurringDraft() ?? blankRecurring());
  readonly customCategory = signal(false);
  readonly categories = computed(() => categoryChoices([...this.state.costs().map((cost) => cost.category), ...this.state.recurring().map((row) => row.category)]));
  readonly categoryChoice = computed(() => {
    if (this.customCategory()) return '__other__';
    const code = (this.draft().category ?? '').toUpperCase();
    return this.categories().some((category) => category.code === code) ? code : '__other__';
  });
  readonly monthly = computed(() => monthlyEquivalentEur(this.draft()));
  readonly yearly = computed(() => yearlyEur(this.draft()));
  /** How many periods a start in the past books straight away. */
  readonly backlog = computed(() => {
    const draft = this.draft();
    return draft.startDate && draft.startDate < this.state.today ? occurrencesBetween(draft, draft.startDate, this.state.today).length : 0;
  });
  /** The first three occurrences still ahead. */
  readonly preview = computed(() => {
    const draft = this.draft();
    if (!draft.startDate || !draft.interval) return [];
    const from = draft.nextDate && draft.nextDate > this.state.today ? draft.nextDate : this.state.today;
    return occurrencesBetween(draft, from, addDays(from, 800)).slice(0, 3);
  });
  readonly canSave = computed(() => {
    const draft = this.draft();
    return !!(draft.name ?? '').trim() && !!(draft.category ?? '').trim() && draft.amountExclEur >= 0 && !!draft.startDate
      && !!draft.interval && (!draft.endDate || draft.endDate >= draft.startDate);
  });

  patch(changes: Partial<RecurringCost> & { interval?: RecurringInterval }): void {
    this.draft.update((draft) => ({ ...draft, ...changes }));
  }

  pickCategory(value: string): void {
    if (value === '__other__') {
      this.customCategory.set(true);
      this.patch({ category: '' });
      return;
    }
    this.customCategory.set(false);
    this.patch({ category: value });
  }
}
