import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CostParty } from '../../core/api/models';
import { Sheet } from '../../shared/ui';
import { categoryChoices } from './cost-categories';
import { dayMonth } from './finance-format';
import { blankCostParty } from './finance-sections';
import { FinanceState, formatEuro } from './finance-state';

const IBAN = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;

/**
 * One name of the Aan wie list: the name itself, the defaults a new cost
 * to it takes (category, btw, channel or fair) and the IBAN. Renaming runs
 * through the bookings on the old name (the server cascades).
 */
@Component({
  selector: 'app-cost-party-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet],
  template: `
    <app-sheet variant="ios" [title]="draft().id ? 'Aan wie bewerken' : 'Aan wie toevoegen'" [wide]="true" (closed)="state.costPartyDraft.set(null)">
      <div body class="fin-sheet fin-form">
        @if (draft().id) {
          <p class="fin-hint fin-field--wide">{{ summary() }}@if (figures().lastDate) { · <button class="wk-link" type="button" (click)="showCosts()">Toon kosten ›</button> }</p>
        }
        <div class="fin-group" [class.ios-group]="!state.desk()">
          <label class="fin-field fin-field--wide"><span class="req">Naam</span>
            <input class="input" maxlength="200" autocomplete="off" placeholder="bijv. TICA Trends & Trade" [attr.data-initial-focus]="draft().id ? null : ''"
                   [ngModel]="draft().name" (ngModelChange)="patch({ name: $event })" />
            @if (draft().id) { <span class="fin-hint">Hernoemen past ook de boekingen op deze naam aan.</span> }</label>
        </div>
        <div class="fin-group" [class.ios-group]="!state.desk()">
          <label class="fin-field"><span>Categorie</span>
            <select class="select" [ngModel]="categoryChoice()" (ngModelChange)="pickCategory($event)">
              <option value="">Geen standaard</option>
              @for (category of categories(); track category.code) { <option [value]="category.code">{{ category.label }}</option> }
              <option value="__other__">Eigen categorie…</option>
            </select>
            @if (customCategory()) { <input class="input" aria-label="Eigen categorie" placeholder="bijv. OPLEIDING" [ngModel]="draft().category" (ngModelChange)="patch({ category: ($event || '').toUpperCase() })" /> }</label>
          <label class="fin-field"><span>Btw</span>
            <select class="select" [ngModel]="vatChoice()" (ngModelChange)="pickVat($event)">
              <option value="">Geen standaard</option>
              <option value="21">21 %</option>
              <option value="6">6 %</option>
              <option value="0">0 %</option>
              <option value="__other__">Anders…</option>
            </select>
            @if (customVat()) { <input class="input" type="number" min="0" max="100" step="0.01" inputmode="decimal" aria-label="Btw-percentage" placeholder="bijv. 12"
                                       [ngModel]="draft().vatPct" (ngModelChange)="patch({ vatPct: $event === null || $event === '' ? null : +$event })" /> }</label>
          <label class="fin-field"><span>Kanaal / beurs</span>
            <select class="select" [ngModel]="draft().salesChannel ?? ''" (ngModelChange)="patch({ salesChannel: $event || null })">
              <option value="">Geen</option>
              @for (channel of channels(); track channel.code) { <option [value]="channel.code">{{ channel.label }}</option> }
              @if (fairs().length) {
                <optgroup label="Beurzen">@for (fair of fairs(); track fair.code) { <option [value]="fair.code">{{ fair.label }}</option> }</optgroup>
              }
            </select></label>
          <label class="fin-field"><span>IBAN</span>
            <input class="input" maxlength="42" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="BE68 5390 0754 7034"
                   [ngModel]="draft().iban" (ngModelChange)="patch({ iban: $event })" />
            @if (ibanWrong()) { <span class="fin-hint fin-hint--warn">Dit is geen geldig IBAN.</span> }</label>
        </div>
        @if (draft().id && !state.desk()) {
          <div class="ios-group fin-field--wide"><button class="ios-cell ios-cell--danger" type="button" [disabled]="state.saving()" (click)="state.deleteCostParty(draft())">Uit de lijst halen</button></div>
        }
      </div>
      <div foot style="display:contents">
        @if (draft().id && state.desk()) { <button class="btn btn--danger" type="button" [disabled]="state.saving()" (click)="state.deleteCostParty(draft())">Uit de lijst halen</button> }
        <span class="spacer"></span>
        <button class="btn btn--primary" type="button" [disabled]="state.saving() || !canSave()" (click)="save()">{{ state.saving() ? 'Bezig…' : draft().id ? 'Bewaren' : 'Toevoegen' }}</button>
      </div>
    </app-sheet>
  `,
})
export class CostPartySheet {
  readonly state = inject(FinanceState);
  readonly draft = linkedSignal<CostParty>(() => this.state.costPartyDraft() ?? blankCostParty());
  readonly customCategory = signal(false);
  readonly customVat = signal(false);

  readonly categories = computed(() => categoryChoices([...this.state.costs().map((cost) => cost.category), ...this.state.recurring().map((row) => row.category)]));
  readonly categoryChoice = computed(() => {
    if (this.customCategory()) return '__other__';
    const code = (this.draft().category ?? '').toUpperCase();
    if (!code) return '';
    return this.categories().some((category) => category.code === code) ? code : '__other__';
  });
  readonly vatChoice = computed(() => {
    if (this.customVat()) return '__other__';
    const pct = this.draft().vatPct;
    if (pct === null || pct === undefined) return '';
    return [21, 6, 0].includes(pct) ? String(pct) : '__other__';
  });
  readonly channels = computed(() => this.state.channelChoices().filter((channel) => channel.hint !== 'Beurs'));
  readonly fairs = computed(() => this.state.channelChoices().filter((channel) => channel.hint === 'Beurs'));
  readonly ibanWrong = computed(() => {
    const iban = (this.draft().iban ?? '').replace(/\s+/g, '').toUpperCase();
    return !!iban && !IBAN.test(iban);
  });
  readonly canSave = computed(() => {
    const draft = this.draft();
    const pct = draft.vatPct;
    return !!draft.name.trim() && !this.ibanWrong() && (pct === null || pct === undefined || (Number.isFinite(pct) && pct >= 0 && pct <= 100));
  });

  /** The figures of the stored name (not of a rename being typed). */
  readonly figures = computed(() => {
    const draft = this.draft();
    const stored = draft.id ? this.state.costParties().find((row) => row.id === draft.id) : null;
    return this.state.partyFiguresFor(stored?.name ?? draft.name);
  });
  readonly summary = computed(() => {
    const figures = this.figures();
    const last = figures.lastDate ? ` · laatst ${dayMonth(figures.lastDate)}` : '';
    return figures.count ? `${figures.count} ${figures.count === 1 ? 'kost' : 'kosten'} · ${formatEuro(figures.exclEur)} excl. dit jaar${last}` : `Nog geen kosten dit jaar${last}`;
  });

  patch(changes: Partial<CostParty>): void {
    this.draft.update((draft) => ({ ...draft, ...changes }));
  }

  pickCategory(value: string): void {
    this.customCategory.set(value === '__other__');
    this.patch({ category: value === '__other__' ? '' : value || null });
  }

  pickVat(value: string): void {
    this.customVat.set(value === '__other__');
    this.patch({ vatPct: value === '__other__' || value === '' ? null : Number(value) });
  }

  /** Uitgaven › Bedrijfskosten on this name, all dates; the sheet closes. */
  showCosts(): void {
    const draft = this.draft();
    const name = (draft.id ? this.state.costParties().find((row) => row.id === draft.id)?.name : null) ?? draft.name;
    this.state.costPartyDraft.set(null);
    this.state.go({ view: 'costs', tab: 'company', period: 'all', q: name });
  }

  save(): void {
    if (!this.canSave()) return;
    void this.state.saveCostParty(this.draft());
  }
}
