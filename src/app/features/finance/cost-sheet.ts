import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CompanyCost } from '../../core/api/models';
import { DateField } from '../../shared/date-field';
import { EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import { SALES_CHANNELS } from '../sales/sales-channels';
import { categoryChoices } from './cost-categories';
import { inclOf } from './finance-metrics';
import { blankCost } from './finance-sections';
import { FinanceState } from './finance-state';

/** The cost form: book one, correct one, settle one. */
@Component({
  selector: 'app-cost-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet, DateField, EurPipe],
  template: `
    <app-sheet [title]="draft().id ? 'Kost bewerken' : 'Kost boeken'" (closed)="state.costDraft.set(null)">
      <div body>
        @if (draft().recurringCostId) {
          <p class="fin-note">Automatisch geboekt als vaste kost. Deze boeking mag je hier corrigeren; pas de vaste kost zelf aan om de volgende periodes te veranderen.</p>
        }
        <div class="form-grid">
          <div class="field"><label class="req" for="k-date">Datum</label>
            <app-date-field fieldId="k-date" [value]="draft().date" (valueChange)="patch({ date: $event })" /></div>
          <div class="field"><label class="req" for="k-cat">Categorie</label>
            <select class="select" id="k-cat" [ngModel]="categoryChoice()" (ngModelChange)="pickCategory($event)">
              @for (category of categories(); track category.code) { <option [value]="category.code">{{ category.label }}</option> }
              <option value="__other__">Eigen categorie…</option>
            </select>
            @if (customCategory()) {
              <input class="input mt-8" aria-label="Eigen categorie" placeholder="bijv. OPLEIDING" [ngModel]="draft().category" (ngModelChange)="patch({ category: ($event || '').toUpperCase() })" />
            }</div>
          <div class="field span-2"><label class="req" for="k-desc">Omschrijving</label>
            <input class="input" id="k-desc" placeholder="bijv. Standhuur TICA oktober" [ngModel]="draft().description" (ngModelChange)="patch({ description: $event })" /></div>
          <div class="field"><label for="k-party">Aan wie</label>
            <input class="input" id="k-party" placeholder="bijv. TICA Trends & Trade" [ngModel]="draft().party" (ngModelChange)="patch({ party: $event })" /></div>
          <div class="field"><label for="k-ref">Factuurnummer <span class="opt"></span></label>
            <input class="input" id="k-ref" [ngModel]="draft().reference" (ngModelChange)="patch({ reference: $event })" /></div>
          <div class="field"><label class="req" for="k-amount">Bedrag excl. btw</label>
            <span class="fin-money"><i>€</i><input class="input num right" id="k-amount" type="number" min="0" step="0.01" inputmode="decimal"
                   [ngModel]="draft().amountExclEur || null" (ngModelChange)="patch({ amountExclEur: +($event || 0) })" /></span></div>
          <div class="field"><label for="k-vat">Btw</label>
            <span class="fin-money">
              <span class="fin-quick" role="group" aria-label="Btw kiezen">
                <button type="button" [class.on]="draft().vatPct === 21" (click)="patch({ vatPct: 21 })">21</button>
                <button type="button" [class.on]="draft().vatPct === 6" (click)="patch({ vatPct: 6 })">6</button>
                <button type="button" [class.on]="!draft().vatPct" (click)="patch({ vatPct: 0 })">0</button>
              </span>
              <input class="input num right" id="k-vat" type="number" min="0" max="100" step="0.5" inputmode="decimal"
                     [ngModel]="draft().vatPct ?? 0" (ngModelChange)="patch({ vatPct: +($event || 0) })" /><i>%</i></span>
            <span class="hint">Incl. btw: {{ inclOf(draft()) | eur }}</span></div>
          <div class="field"><label for="k-paid">Betaald op <span class="opt"></span></label>
            <app-date-field fieldId="k-paid" [value]="draft().paidOn ?? ''" (valueChange)="patch({ paidOn: $event || null })" />
            @if (!draft().paidOn) { <button class="linklike mt-8" type="button" (click)="patch({ paidOn: state.today })">Vandaag betaald</button> }</div>
          <div class="field"><label for="k-channel">Hoort bij verkoopkanaal <span class="opt"></span></label>
            <select class="select" id="k-channel" [ngModel]="draft().salesChannel ?? ''" (ngModelChange)="patch({ salesChannel: $event || null })">
              <option value="">Algemene kost</option>
              @for (channel of channels; track channel.code) { <option [value]="channel.code">{{ channel.label }}</option> }
            </select>
            <span class="hint">Een standhuur bij TICA telt dan mee in het resultaat van dat kanaal.</span></div>
          <div class="field span-2"><label for="k-notes">Notities <span class="opt"></span></label>
            <textarea class="textarea" id="k-notes" rows="3" [ngModel]="draft().notes" (ngModelChange)="patch({ notes: $event })"></textarea></div>
        </div>
      </div>
      <div foot style="display:contents">
        @if (draft().id) { <button class="btn btn--danger" type="button" [disabled]="state.saving()" (click)="state.deleteCost(draft())">Verwijderen</button> }
        <span class="spacer"></span>
        <button class="btn" type="button" (click)="state.costDraft.set(null)">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="state.saving() || !canSave()" (click)="state.saveCost(draft())">{{ state.saving() ? 'Bezig…' : draft().id ? 'Bewaren' : 'Boeken' }}</button>
      </div>
    </app-sheet>
  `,
})
export class CostSheet {
  readonly state = inject(FinanceState);
  readonly channels = SALES_CHANNELS;
  readonly inclOf = inclOf;
  readonly draft = linkedSignal<CompanyCost>(() => this.state.costDraft() ?? blankCost());
  readonly customCategory = signal(false);
  readonly categories = computed(() => categoryChoices([...this.state.costs().map((cost) => cost.category), ...this.state.recurring().map((row) => row.category)]));
  readonly categoryChoice = computed(() => {
    if (this.customCategory()) return '__other__';
    const code = (this.draft().category ?? '').toUpperCase();
    return this.categories().some((category) => category.code === code) ? code : '__other__';
  });
  readonly canSave = computed(() => {
    const draft = this.draft();
    return !!draft.date && !!(draft.category ?? '').trim() && !!(draft.description ?? '').trim() && draft.amountExclEur >= 0;
  });

  patch(changes: Partial<CompanyCost>): void {
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
