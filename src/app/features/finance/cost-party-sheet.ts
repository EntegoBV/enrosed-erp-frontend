import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CostParty } from '../../core/api/models';
import { Sheet } from '../../shared/ui';
import { categoryChoices } from './cost-categories';
import { cleanVatNumber, countryName, isValidVatNumber } from './cost-countries';
import { REGIME_GROUPS, countryChips } from './cost-regime-fields';
import { dayMonth } from './finance-format';
import { blankCostParty } from './finance-sections';
import { FinanceState, formatEuro } from './finance-state';

const IBAN = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;

/**
 * One name of the Aan wie list: the name itself, the defaults a new cost
 * to it takes (category, btw, channel or fair, country, VAT number and
 * regime) and the IBAN. Renaming runs through the bookings on the old name
 * (the server cascades).
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
        <div class="fin-group" [class.ios-group]="!state.desk()">
          <div class="fin-field fin-field--wide fin-field--stack"><span>Land</span>
            <div class="fin-choice" role="group" aria-label="Land">
              @for (code of chips(); track code) {
                <button class="fin-choice__chip" type="button" [attr.aria-pressed]="!otherCountry() && country() === code" (click)="pickCountry(code)">{{ countryName(code) }}</button>
              }
              <button class="fin-choice__chip" type="button" [attr.aria-pressed]="otherCountry()" (click)="otherCountry.set(true)">Andere…</button>
            </div>
            @if (otherCountry()) {
              <select class="select" aria-label="Ander land" [ngModel]="country()" (ngModelChange)="pickCountry($event)">
                <option value="">Kies een land</option>
                @for (choice of state.countryChoices(); track choice.code) { <option [value]="choice.code">{{ choice.name }}</option> }
              </select>
            }
          </div>
          <label class="fin-field"><span>Btw-nummer</span>
            <input class="input" maxlength="24" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="BE 0123.456.749"
                   [ngModel]="draft().vatNumber" (ngModelChange)="patch({ vatNumber: $event })" />
            @if (vatNumberWrong()) { <span class="fin-hint fin-hint--warn">Dit is geen geldig btw-nummer</span> }</label>
          <label class="fin-field"><span>Btw-regeling</span>
            <select class="select" [ngModel]="draft().vatRegime ?? ''" (ngModelChange)="patch({ vatRegime: $event || null })">
              <option value="">Geen standaard</option>
              @for (group of regimeGroups; track group.label) {
                <optgroup [label]="group.label">@for (regime of group.regimes; track regime.code) { <option [value]="regime.code">{{ regime.label }}</option> }</optgroup>
              }
            </select></label>
        </div>
        @if (draft().id) {
          <div class="fin-group fin-field--wide" [class.ios-group]="!state.desk()">
            @if (draft().aliases?.length) {
              <div class="fin-field fin-field--wide"><span>Andere namen voor deze partij</span>
                @for (alias of state.costPartyAliases(); track alias.party.id) {
                  <div class="fin-hint">{{ alias.party.name }} · <button class="wk-link" type="button" [disabled]="state.saving()" (click)="state.restoreCostParty(alias)">Weer apart tonen</button></div>
                }
              </div>
            } @else {
              <label class="fin-field fin-field--wide"><span>Samenvoegen met</span>
                <select class="select" [ngModel]="mergeTargetId()" (ngModelChange)="mergeTargetId.set($event)">
                  <option [ngValue]="null">Kies de naam die je wilt behouden</option>
                  @for (party of mergeTargets(); track party.id) { <option [ngValue]="party.id">{{ party.name }}</option> }
                </select>
                <span class="fin-hint">Gebruik dit voor twee namen van dezelfde partij. De oorspronkelijke naam blijft bewaard en kan weer apart worden getoond.</span>
              </label>
              <button class="btn" type="button" [disabled]="state.saving() || !mergeTargetId()" (click)="merge()">Samenvoegen</button>
            }
          </div>
        }
        @if (draft().id && !draft().aliases?.length && !state.desk()) {
          <div class="ios-group fin-field--wide"><button class="ios-cell ios-cell--danger" type="button" [disabled]="state.saving()" (click)="state.deleteCostParty(draft())">Uit de lijst halen</button></div>
        }
      </div>
      <div foot style="display:contents">
        @if (draft().id && !draft().aliases?.length && state.desk()) { <button class="btn btn--danger" type="button" [disabled]="state.saving()" (click)="state.deleteCostParty(draft())">Uit de lijst halen</button> }
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
  readonly mergeTargetId = linkedSignal<number | null>(() => { this.state.costPartyDraft(); return null; });
  readonly mergeTargets = computed(() => this.state.costParties().filter((party) => party.id !== this.draft().id));

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
  /** The same rule as the server: BE + 0/1 + nine digits, or two letters and 2–16 characters. */
  readonly vatNumberWrong = computed(() => {
    const clean = cleanVatNumber(this.draft().vatNumber);
    return !!clean && !isValidVatNumber(clean);
  });
  readonly regimeGroups = REGIME_GROUPS;
  readonly country = computed(() => (this.draft().country ?? '').trim().toUpperCase());
  readonly otherCountry = signal(false);
  /** The short list, the countries the list and this year's costs already use, and the party's own. */
  readonly chips = computed(() => {
    const year = this.state.today().slice(0, 4);
    const inUse = [...this.state.costParties().map((party) => party.country ?? ''), ...this.state.costs().filter((cost) => cost.date.startsWith(year)).map((cost) => cost.supplierCountry ?? '')];
    return countryChips(null, inUse, this.country());
  });
  readonly canSave = computed(() => {
    const draft = this.draft();
    const pct = draft.vatPct;
    return !!draft.name.trim() && !this.ibanWrong() && !this.vatNumberWrong() && (pct === null || pct === undefined || (Number.isFinite(pct) && pct >= 0 && pct <= 100));
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

  countryName(code: string): string {
    return countryName(code, this.state.countryChoices());
  }

  pickCountry(code: string): void {
    this.otherCountry.set(false);
    this.patch({ country: (code ?? '').trim().toUpperCase() || null });
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

  merge(): void {
    const targetId = this.mergeTargetId();
    const source = this.state.costParties().find((party) => party.id === this.draft().id);
    if (targetId && source) this.state.mergeCostParty(source, targetId);
  }
}
