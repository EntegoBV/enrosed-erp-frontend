import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RecurringCost, RecurringInterval } from '../../core/api/models';
import { DateField } from '../../shared/date-field';
import { DateNlPipe, EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import { categoryChoices } from './cost-categories';
import { INTERVALS, addDays, cashTotalOf, monthlyEquivalentEur, occurrencesBetween, previewBacklog, yearlyEur } from './finance-metrics';
import { blankRecurring } from './finance-sections';
import { FinanceState } from './finance-state';
import { PartyField } from './party-field';
import { VatChoice } from './vat-choice';

/** The recurring cost form: what, how much, how often, from when, and whether the bank pays it by itself. */
@Component({
  selector: 'app-recurring-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet, DateField, EurPipe, DateNlPipe, VatChoice, PartyField],
  template: `
    <app-sheet variant="ios" [title]="draft().id ? 'Vaste kost bewerken' : 'Vaste kost instellen'" [wide]="true" (closed)="state.recurringDraft.set(null)">
      <div body class="fin-sheet fin-form">
        <div class="fin-group" [class.ios-group]="!state.desk()">
          <label class="fin-field fin-field--wide"><span class="req">Naam</span>
            <input class="input" placeholder="bijv. Huur magazijn" [ngModel]="draft().name" (ngModelChange)="patch({ name: $event })" /></label>
        </div>
        <label class="fin-amount fin-amount--left fin-field--wide">
          <span class="fin-field__label req">Bedrag excl. btw</span><i aria-hidden="true">€</i>
          <input type="number" min="0" step="0.01" inputmode="decimal" [ngModel]="draft().amountExclEur || null" (ngModelChange)="patch({ amountExclEur: +($event || 0) })" />
        </label>
        <div class="fin-group" [class.ios-group]="!state.desk()">
          <div class="fin-field fin-field--wide fin-field--stack"><span>Btw</span>
            <app-vat-choice [value]="draft().vatPct" (changed)="patch({ vatPct: $event })" />
            <span class="fin-hint">Incl. btw: {{ cashTotalOf(draft()) | eur }}</span></div>
          <div class="fin-field fin-field--wide fin-field--stack"><span class="req">Hoe vaak</span>
            <div class="fin-choice" role="group" aria-label="Ritme">
              @for (option of intervals; track option.code) {
                <button type="button" class="fin-choice__chip" [attr.aria-pressed]="draft().interval === option.code" (click)="patch({ interval: option.code })" [title]="option.hint">{{ option.label }}</button>
              }
            </div>
            <span class="fin-hint">≈ {{ monthly() | eur: 0 }} per maand · {{ yearly() | eur: 0 }} per jaar, excl. btw</span></div>
        </div>
        <div class="fin-group" [class.ios-group]="!state.desk()">
          <label class="fin-field"><span class="req">Categorie</span>
            <select class="select" [ngModel]="categoryChoice()" (ngModelChange)="pickCategory($event)">
              @for (category of categories(); track category.code) { <option [value]="category.code">{{ category.label }}</option> }
              <option value="__other__">Eigen categorie…</option>
            </select>
            @if (customCategory()) { <input class="input" aria-label="Eigen categorie" placeholder="bijv. OPLEIDING" [ngModel]="draft().category" (ngModelChange)="patch({ category: ($event || '').toUpperCase() })" /> }</label>
          <div class="fin-field fin-field--combo"><span><label for="r-party">Aan wie</label></span>
            <app-party-field fieldId="r-party" placeholder="bijv. Immo Ham" [value]="draft().party ?? ''" [candidates]="state.partySuggestions()" [maxlength]="200"
                             (valueChange)="patch({ party: $event })" (picked)="applyParty()" (committed)="applyParty()" /></div>
          <div class="fin-field"><span class="req">Eerste keer op</span>
            <app-date-field fieldId="r-start" [value]="draft().startDate" (valueChange)="patch({ startDate: $event })" />
            @if (backlog() > 0 && !draft().id) { <span class="fin-hint fin-hint--warn">{{ backlog() }} {{ backlog() === 1 ? 'periode' : 'periodes' }} tot vandaag worden meteen geboekt.</span> }</div>
          <div class="fin-field"><span>Laatste keer op</span>
            <app-date-field fieldId="r-end" [value]="draft().endDate ?? ''" (valueChange)="patch({ endDate: $event || null })" />
            <span class="fin-hint">{{ draft().endDate ? 'Daarna stopt de reeks vanzelf.' : 'Leeg: loopt door tot je ze pauzeert.' }}</span></div>
        </div>
        <div class="fin-group" [class.ios-group]="!state.desk()">
          <label class="fin-field fin-field--switch fin-field--wide"><span>Domiciliëring of doorlopende opdracht<small>De geboekte kost staat meteen op betaald.</small></span>
            <input [class]="state.desk() ? 'fin-checkbox' : 'ios-switch'" type="checkbox" role="switch" [ngModel]="draft().autoPaid" (ngModelChange)="patch({ autoPaid: $event })" /></label>
          @if (draft().id) {
            <label class="fin-field fin-field--switch fin-field--wide"><span>Actief<small>{{ activeHint() }}</small></span>
              <input [class]="state.desk() ? 'fin-checkbox' : 'ios-switch'" type="checkbox" role="switch" [ngModel]="draft().active" (ngModelChange)="patch({ active: $event })" /></label>
          }
        </div>
        <div class="fin-group" [class.ios-group]="!state.desk()">
          <label class="fin-field"><span>Hoort bij verkoopkanaal</span>
            <select class="select" [ngModel]="draft().salesChannel ?? ''" (ngModelChange)="patch({ salesChannel: $event || null })">
              <option value="">Algemene kost</option>
              @for (channel of channels(); track channel.code) { <option [value]="channel.code">{{ channel.label }}</option> }
              @if (fairs().length) {
                <optgroup label="Beurzen">@for (fair of fairs(); track fair.code) { <option [value]="fair.code">{{ fair.label }}</option> }</optgroup>
              }
            </select></label>
          <label class="fin-field"><span>Referentie</span>
            <input class="input" placeholder="contractnummer, klantnummer" [ngModel]="draft().reference" (ngModelChange)="patch({ reference: $event })" /></label>
        </div>
        <div class="fin-group" [class.ios-group]="!state.desk()">
          <label class="fin-field fin-field--wide fin-field--stack"><span>Notities</span>
            <textarea class="textarea" rows="2" [ngModel]="draft().notes" (ngModelChange)="patch({ notes: $event })"></textarea></label>
        </div>
        @if (preview().length) {
          <p class="fin-hint fin-field--wide">Volgende boekingen: @for (date of preview(); track date; let last = $last) {<b>{{ date | dateNl }}</b>@if (!last) {, }}</p>
        }
      </div>
      <div foot style="display:contents">
        @if (draft().id) { <button class="btn btn--danger" type="button" [disabled]="state.saving()" (click)="state.deleteRecurring(draft())">Verwijderen</button> }
        <span class="spacer"></span>
        <button class="btn btn--primary" type="button" [disabled]="state.saving() || !canSave()" (click)="state.saveRecurring(draft())">{{ state.saving() ? 'Bezig…' : draft().id ? 'Bewaren' : 'Instellen' }}</button>
      </div>
    </app-sheet>
  `,
})
export class RecurringSheet {
  readonly state = inject(FinanceState);
  readonly channels = computed(() => this.state.channelChoices().filter((channel) => channel.hint !== 'Beurs'));
  readonly fairs = computed(() => this.state.channelChoices().filter((channel) => channel.hint === 'Beurs'));
  readonly intervals = INTERVALS;
  readonly cashTotalOf = cashTotalOf;
  readonly draft = linkedSignal<RecurringCost>(() => this.state.recurringDraft() ?? blankRecurring(this.state.today()));
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
    return draft.startDate && draft.startDate < this.state.today() ? previewBacklog({ ...draft, id: null }, this.state.today()) : 0;
  });
  /** A paused definition switched back on books its missed periods on save (confirmed first, as on the row). */
  readonly resuming = computed(() => this.state.resumeBacklog(this.draft()));
  readonly activeHint = computed(() => {
    const draft = this.draft();
    const missed = this.resuming();
    if (missed > 0) return `Bewaren hervat de reeks en boekt meteen ${missed} gemiste ${missed === 1 ? 'periode' : 'periodes'}.`;
    return draft.active ? 'Wordt op haar dagen geboekt.' : 'Gepauzeerd: er wordt niets geboekt. Hervatten boekt gemiste periodes meteen.';
  });
  /** The first three occurrences still ahead. */
  readonly preview = computed(() => {
    const draft = this.draft();
    if (!draft.startDate || !draft.interval) return [];
    const from = draft.nextDate && draft.nextDate > this.state.today() ? draft.nextDate : this.state.today();
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

  /** A known name fills in category, VAT and channel, the same rule as the cost form: only while those are still untouched. */
  applyParty(): void {
    const draft = this.draft();
    if (draft.id || this.customCategory()) return;
    const known = this.state.partyDefaultsFor(draft.party);
    const fresh = blankRecurring(this.state.today());
    if (!known || draft.category !== fresh.category || draft.vatPct !== fresh.vatPct || draft.salesChannel) return;
    const category = known.category ?? draft.category;
    const vatPct = known.vatPct ?? draft.vatPct;
    if (category === draft.category && vatPct === draft.vatPct && !known.salesChannel) return;
    this.patch({ category, vatPct, salesChannel: known.salesChannel });
  }
}
