import { ChangeDetectionStrategy, Component, computed, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { CompanyCost, CostKind, CostParty, ExpenseType, VatRegime } from '../../core/api/models';
import { DateField } from '../../shared/date-field';
import { Icon } from '../../shared/icon';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Ui } from '../../shared/ui';
import { cleanVatNumber, countryName, isEuMember, suggestRegime } from './cost-countries';
import type { CountryChoice } from './cost-countries';
import { EXPENSE_PRESETS, REVERSE_CHARGE, VAT_REGIMES, acquisitionValueOf, addDays, kindOf, regimeLabel, revisionUntil } from './finance-metrics';
import type { ExpensePreset, VatRegimeDef, VatRow } from './finance-metrics';
import { FinanceState, formatEuro } from './finance-state';
import { partyKey } from './party-suggestions';

/** The regime side of a cost or recurring draft: what the Btw-regeling disclosure edits. */
export interface RegimeFields {
  vatRegime: VatRegime | null;
  vatRegimeConfirmed: boolean;
  supplierCountry: string | null;
  costKind: CostKind | null;
  expenseType: ExpenseType | null;
  vatDeductiblePct: number | null;
  taxDeductiblePct: number | null;
  /** Investments only; a recurring definition has neither. */
  depreciationYears?: number | null;
  depreciationStart?: string | null;
}
/** A cost or recurring draft as the fields read it: the regime side plus the amounts the hints need. */
export type RegimeDraft = RegimeFields & VatRow;

/** The regimes whose supplier country the return needs (the server refuses a missing or wrong one). */
const COUNTRY_REGIMES: ReadonlySet<string> = new Set(['EU_GOODS', 'EU_SERVICES', 'NON_EU_SERVICES', 'FOREIGN_VAT']);
/** No base grid and no deduction choice: the kind and deductibility rows stay hidden. */
const BARE_REGIMES: ReadonlySet<string> = new Set(['IMPORT_VAT_PAID', 'OUT_OF_SCOPE']);
/** The VAT on the invoice is never deducted here: only the fiscal percentage matters. */
const FISCAL_ONLY: ReadonlySet<string> = new Set(['FOREIGN_VAT', 'EXEMPT', 'NO_INVOICE']);
/** The regimes that carry no VAT at all: the rate is locked on nothing. */
export const NO_VAT_REGIMES: ReadonlySet<string> = new Set(['EXEMPT', 'OUT_OF_SCOPE', 'NO_INVOICE']);

const GROUP_ORDER: readonly VatRegimeDef['group'][] = ['Belgisch', 'Verlegd', 'Geen aftrek', 'Invoer'];
export interface RegimeGroup { label: string; regimes: VatRegimeDef[] }
/** The four optgroups of a regime select, in the order of the regime table. */
export const REGIME_GROUPS: readonly RegimeGroup[] = GROUP_ORDER.map((label) => ({ label, regimes: VAT_REGIMES.filter((def) => def.group === label) }));

const CHIP_COUNTRIES = ['BE', 'NL', 'DE', 'FR', 'IE'];
const finite = (value: number | null | undefined): number => (Number.isFinite(value as number) ? (value as number) : 0);
const round2 = (value: number): number => Math.round(value * 100) / 100;
const belgian = (iso: string): string => iso.split('-').reverse().join('-');

/** Whether a country fits a regime (the server's rule): EU members other than Belgium for EU reverse charge (XI for goods), outside the EU for non-EU services, anything but Belgium for foreign VAT. */
export function countryAllowed(regime: VatRegime | null, code: string, goods: boolean): boolean {
  const key = code.trim().toUpperCase();
  switch (regime) {
    case 'EU_GOODS': return key !== 'BE' && (isEuMember(key) || (goods && key === 'XI'));
    case 'EU_SERVICES': return key !== 'BE' && isEuMember(key);
    case 'NON_EU_SERVICES': return !isEuMember(key);
    case 'FOREIGN_VAT': return key !== 'BE';
    default: return true;
  }
}

/** The server's country message for a regime, or null when the country fits. */
export function countryProblem(regime: VatRegime | null, country: string | null | undefined, goods: boolean): string | null {
  if (!regime || !COUNTRY_REGIMES.has(regime)) return null;
  const code = (country ?? '').trim().toUpperCase();
  if (!code) return 'Kies het land van de leverancier';
  if (countryAllowed(regime, code, goods)) return null;
  if (regime === 'NON_EU_SERVICES') return 'Voor een dienst van buiten de EU kies je een land buiten de EU';
  if (regime === 'FOREIGN_VAT') return 'Buitenlandse btw: kies een ander land dan België';
  return 'Voor btw verlegd binnen de EU kies je een EU-land, niet België';
}

/** The country chips: the short list, the countries in use, and the current value; only what the regime accepts. */
export function countryChips(regime: VatRegime | null, inUse: readonly string[], current: string | null | undefined, goods = false): string[] {
  const chips: string[] = [];
  const own = (current ?? '').trim().toUpperCase();
  for (const raw of [...CHIP_COUNTRIES, ...inUse, own]) {
    const code = raw.trim().toUpperCase();
    if (code && !chips.includes(code) && (code === own || countryAllowed(regime, code, goods))) chips.push(code);
  }
  return chips;
}

/** What the form refuses before the server would: the message for the foot, or null. */
export function regimeProblem(draft: RegimeDraft): string | null {
  const regime = draft.vatRegime;
  if (!regime) return 'Kies eerst de btw-regeling';
  const country = countryProblem(regime, draft.supplierCountry, kindOf(draft) === 'GOODS');
  if (country) return country;
  if (REVERSE_CHARGE.has(regime) && !(finite(draft.vatPct) > 0)) return 'Bij btw verlegd geef je het btw-percentage op';
  for (const pct of [draft.vatDeductiblePct, draft.taxDeductiblePct]) {
    if (pct !== null && pct !== undefined && !(pct >= 0 && pct <= 100)) return 'Het aftrekbare percentage ligt tussen 0 en 100';
  }
  if (draft.costKind === 'INVESTMENT') {
    const years = draft.depreciationYears;
    if (!Number.isInteger(years) || (years as number) < 1 || (years as number) > 50) return 'Een investering schrijf je af over 1 tot 50 jaar';
  }
  return null;
}

/** The useful life a category suggests: software three years, the rest five. */
export function depreciationYearsFor(category: string | null | undefined): number {
  return (category ?? '').trim().toUpperCase() === 'SOFTWARE' ? 3 : 5;
}

/** What a name carries for the regime fields: the stored party's country, VAT number and regime, else the newest confirmed cost on that name. */
export interface PartyRegime { country: string | null; vatNumber: string | null; vatRegime: VatRegime | null; regimeConfirmed: boolean }

export function partyRegimeOf(name: string | null | undefined, party: CostParty | null, costs: readonly CompanyCost[]): PartyRegime | null {
  const key = partyKey(name);
  if (!key) return null;
  const newest = costs.filter((cost) => partyKey(cost.party) === key && !!cost.vatRegime && cost.vatRegimeConfirmed)
    .sort((left, right) => right.date.localeCompare(left.date))[0] ?? null;
  if (!party && !newest) return null;
  const vatRegime = party?.vatRegime ?? newest?.vatRegime ?? null;
  return { country: party?.country ?? newest?.supplierCountry ?? null, vatNumber: party?.vatNumber ?? null, vatRegime, regimeConfirmed: !!vatRegime };
}

/** The regime patch a name gives a fresh draft: the known regime confirmed, else the one its country suggests, unconfirmed with the reason. Null when nothing beats the Belgian default. */
export function regimePrefill(known: PartyRegime | null, category: string | null): { patch: Partial<RegimeFields>; derived: string | null } | null {
  if (!known) return null;
  const number = cleanVatNumber(known.vatNumber);
  const country = (known.country ?? '').trim().toUpperCase() || (/^[A-Z]{2}/.test(number) ? number.slice(0, 2) : '') || null;
  if (known.vatRegime) {
    return { patch: { vatRegime: known.vatRegime, supplierCountry: known.vatRegime === 'BE' ? 'BE' : country, vatRegimeConfirmed: known.regimeConfirmed }, derived: null };
  }
  const suggestion = suggestRegime({ country, vatNumber: known.vatNumber, category });
  if (!suggestion || suggestion.regime === 'BE') return null;
  return { patch: { vatRegime: suggestion.regime, supplierCountry: country, vatRegimeConfirmed: false }, derived: suggestion.reason };
}

/**
 * The folded 'Btw-regeling' part of the cost and recurring forms: the
 * regime, the supplier's country, the kind (goods, services, investment),
 * the deductibility preset and the depreciation of an investment. It is the
 * <details> itself (an attribute selector), so the sheet's inset-group
 * rules reach the summary and the fields. Every change goes out as a patch;
 * the sheet applies it and fits its amount block to the regime.
 *
 *   <details app-cost-regime-fields class="fin-disclosure fin-field--wide" [(open)]="regimeOpen"
 *            [value]="draft()" [category]="draft().category" [amountExclEur]="draft().amountExclEur"
 *            [countries]="state.countryChoices()" (changed)="applyRegime($event)"></details>
 */
@Component({
  selector: 'details[app-cost-regime-fields]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon, Segmented, DateField],
  host: { '[open]': 'open()', '(toggle)': 'toggled($event)' },
  template: `
    <summary><span>Btw-regeling</span><small>{{ summary() }}</small><app-icon name="chevron-right" [size]="16" /></summary>
    <div class="fin-disclosure__body">
      <div class="fin-field"><span>Regeling</span>
        <select class="select" aria-label="Btw-regeling" [ngModel]="value().vatRegime ?? ''" (ngModelChange)="pickRegime($event)">
          @if (!value().vatRegime) { <option value="">Kies de btw-regeling</option> }
          @for (group of groups(); track group.label) {
            <optgroup [label]="group.label">@for (regime of group.regimes; track regime.code) { <option [value]="regime.code">{{ regime.label }}</option> }</optgroup>
          }
        </select>
        @if (regimeHint(); as hint) { <span class="fin-hint">{{ hint }}</span> }
        @if (note()) { <span class="fin-hint fin-hint--warn">{{ note() }}</span> }
        @if (value().vatRegime && !value().vatRegimeConfirmed) {
          <div class="fin-choice" role="group" aria-label="Btw-regeling bevestigen"><button class="fin-choice__chip" type="button" (click)="confirm()">Klopt</button></div>
        }
      </div>
      @if (countryRow()) {
        <div class="fin-field"><span>Land</span>
          <div class="fin-choice" role="group" aria-label="Land">
            @for (code of chips(); track code) {
              <button class="fin-choice__chip" type="button" [attr.aria-pressed]="!otherCountry() && country() === code" (click)="pickCountry(code)">{{ name(code) }}</button>
            }
            <button class="fin-choice__chip" type="button" [attr.aria-pressed]="otherCountry()" (click)="otherCountry.set(true)">Andere…</button>
          </div>
          @if (otherCountry()) {
            <select class="select" aria-label="Ander land" [ngModel]="country()" (ngModelChange)="pickCountry($event)">
              <option value="">Kies een land</option>
              @for (choice of choices(); track choice.code) { <option [value]="choice.code">{{ choice.name }}</option> }
            </select>
          }
          @if (countryHint(); as problem) { <span class="fin-hint fin-hint--warn">{{ problem }}</span> }
        </div>
      }
      @if (kindRow()) {
        <div class="fin-field"><span>Soort</span>
          <app-segmented [variant]="state.desk() ? 'desk' : 'ios'" label="Soort" [options]="kinds()" [value]="kind()" (changed)="pickKind($event)" />
        </div>
        <div class="fin-field"><span>Aftrekbaar</span>
          <div class="fin-choice" role="group" aria-label="Aftrekbaar">
            @for (preset of presets; track preset.code) {
              <button class="fin-choice__chip" type="button" [attr.aria-pressed]="expenseType() === preset.code" (click)="pickPreset(preset)">{{ preset.code === 'CUSTOM' ? 'Eigen %' : preset.label }}</button>
            }
          </div>
          @if (deductibleHint(); as hint) { <span class="fin-hint">{{ hint }}</span> }
        </div>
        @if (expenseType() === 'CUSTOM') {
          <div class="fin-field-row">
            @if (!fiscalOnly()) {
              <label class="fin-field"><span>Btw %</span>
                <input class="input" type="number" min="0" max="100" step="1" inputmode="decimal" [ngModel]="value().vatDeductiblePct" (ngModelChange)="changed.emit({ vatDeductiblePct: pct($event) })" /></label>
            }
            <label class="fin-field"><span>Fiscaal %</span>
              <input class="input" type="number" min="0" max="100" step="1" inputmode="decimal" [ngModel]="value().taxDeductiblePct" (ngModelChange)="changed.emit({ taxDeductiblePct: pct($event) })" /></label>
          </div>
        }
      }
      @if (investment()) {
        <div class="fin-field-row">
          <label class="fin-field"><span>Jaren</span>
            <input class="input" type="number" min="1" max="50" step="1" inputmode="numeric" [ngModel]="value().depreciationYears" (ngModelChange)="changed.emit({ depreciationYears: years($event) })" /></label>
          <div class="fin-field"><span>Vanaf</span>
            <app-date-field fieldId="k-dep-start" [value]="value().depreciationStart ?? ''" (valueChange)="changed.emit({ depreciationStart: $event || null })" />
            <span class="fin-hint">{{ depreciationHint() }}</span></div>
        </div>
      }
    </div>
  `,
})
export class CostRegimeFields {
  readonly state = inject(FinanceState);
  private readonly ui = inject(Ui);

  readonly value = input.required<RegimeDraft>();
  /** Recurring definitions are never investments and never import VAT. */
  readonly investmentAllowed = input(true);
  readonly importAllowed = input(true);
  readonly category = input<string | null>(null);
  readonly amountExclEur = input(0);
  readonly countries = input<readonly CountryChoice[]>([]);
  /** The cost date: where depreciation starts by default. */
  readonly date = input('');
  /** A line under the select, e.g. 'Afgeleid van het land · controleer' after a party prefill. */
  readonly note = input('');
  /** Open or folded; the sheet decides at first paint, the user from then on. */
  readonly open = model(false);
  readonly changed = output<Partial<RegimeFields>>();

  readonly presets = EXPENSE_PRESETS;
  readonly otherCountry = signal(false);

  readonly regime = computed(() => this.value().vatRegime);
  readonly groups = computed<RegimeGroup[]>(() => REGIME_GROUPS
    .map((group) => ({ label: group.label, regimes: group.regimes.filter((def) => this.importAllowed() || def.code !== 'IMPORT_VAT_PAID') }))
    .filter((group) => group.regimes.length > 0));
  readonly regimeHint = computed(() => VAT_REGIMES.find((def) => def.code === this.regime())?.hint ?? '');
  readonly kind = computed(() => kindOf(this.value()));
  readonly investment = computed(() => this.value().costKind === 'INVESTMENT');
  readonly expenseType = computed<ExpenseType>(() => this.value().expenseType ?? 'STANDARD');
  readonly countryRow = computed(() => COUNTRY_REGIMES.has(this.regime() ?? ''));
  readonly kindRow = computed(() => !!this.regime() && !BARE_REGIMES.has(this.regime() as string));
  readonly fiscalOnly = computed(() => FISCAL_ONLY.has(this.regime() ?? ''));
  readonly country = computed(() => (this.value().supplierCountry ?? '').trim().toUpperCase());
  readonly kinds = computed<SegmentOption[]>(() => [
    { id: 'GOODS', label: 'Goederen' }, { id: 'SERVICES', label: 'Diensten' },
    ...(this.investmentAllowed() ? [{ id: 'INVESTMENT', label: 'Investering' }] : []),
  ]);

  /** The countries already on the Aan wie list or on this year's costs: they earn a chip. */
  private readonly inUse = computed(() => {
    const year = this.state.today().slice(0, 4);
    return [...this.state.costParties().map((party) => party.country ?? ''), ...this.state.costs().filter((cost) => cost.date.startsWith(year)).map((cost) => cost.supplierCountry ?? '')];
  });
  readonly chips = computed(() => countryChips(this.regime(), this.inUse(), this.country(), this.kind() === 'GOODS'));
  /** 'Andere…': every country the regime accepts, the current one included. */
  readonly choices = computed(() => this.countries().filter((choice) => choice.code === this.country() || countryAllowed(this.regime(), choice.code, this.kind() === 'GOODS')));
  readonly countryHint = computed(() => countryProblem(this.regime(), this.country(), this.kind() === 'GOODS'));

  readonly summary = computed(() => {
    const value = this.value();
    const regime = value.vatRegime;
    if (!regime) return 'nog te bepalen';
    const parts = [regimeLabel(regime)];
    const country = this.country();
    if (country && country !== 'BE') parts.push(this.name(country));
    const pct = value.vatDeductiblePct ?? 100;
    if (pct !== 100) parts.push(`${pct} % aftrekbaar`);
    if (value.costKind === 'INVESTMENT') parts.push(`investering · ${value.depreciationYears ?? '?'} j`);
    if (!value.vatRegimeConfirmed) parts.push('te bevestigen');
    return parts.join(' · ');
  });

  readonly deductibleHint = computed(() => {
    const type = this.expenseType();
    if (type === 'GIFT' && finite(this.amountExclEur()) >= 50) return 'Boven € 50 excl.: btw niet aftrekbaar';
    return this.presets.find((preset) => preset.code === type)?.hint ?? '';
  });

  readonly depreciationHint = computed(() => {
    const value = this.value();
    const years = value.depreciationYears;
    const start = value.depreciationStart || this.date();
    if (!Number.isInteger(years) || (years as number) < 1 || !start) return 'Geef het aantal jaren en de startdatum op';
    const [year, month, day] = start.split('-').map(Number);
    const end = addDays(`${year + (years as number)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, -1);
    return `${formatEuro(round2(acquisitionValueOf(value) / (years as number)))} per jaar · tot ${belgian(end)} · btw-herziening tot ${belgian(revisionUntil(start))}`;
  });

  name(code: string): string {
    return countryName(code, this.countries());
  }

  toggled(event: Event): void {
    this.open.set((event.target as HTMLDetailsElement).open);
  }

  /** A pick confirms the regime; Belgium stores its country silently, a country the new regime refuses is dropped, and a bare regime loses kind and deductibility. */
  pickRegime(code: string): void {
    if (!code) return;
    const regime = code as VatRegime;
    const value = this.value();
    const patch: Partial<RegimeFields> = { vatRegime: regime, vatRegimeConfirmed: true };
    if (regime === 'BE') patch.supplierCountry = 'BE';
    else if (COUNTRY_REGIMES.has(regime) && !countryAllowed(regime, this.country(), this.kind() === 'GOODS')) patch.supplierCountry = null;
    if (BARE_REGIMES.has(regime)) {
      Object.assign(patch, { expenseType: 'STANDARD', vatDeductiblePct: 100, taxDeductiblePct: 100 });
      if (value.costKind === 'INVESTMENT') Object.assign(patch, { costKind: null, depreciationYears: null, depreciationStart: null });
    }
    this.otherCountry.set(false);
    this.changed.emit(patch);
  }

  /** 'Klopt': a derived regime (the backfill, a party prefill) stands as it is; re-picking the same option in the select fires nothing. */
  confirm(): void {
    this.changed.emit({ vatRegimeConfirmed: true });
  }

  pickCountry(code: string): void {
    this.otherCountry.set(false);
    this.changed.emit({ supplierCountry: (code ?? '').trim().toUpperCase() || null });
  }

  /** Investering fills the useful life from the category and starts on the cost date; the other kinds drop both. */
  pickKind(id: string): void {
    if (id === 'INVESTMENT') this.changed.emit({ costKind: 'INVESTMENT', depreciationYears: depreciationYearsFor(this.category()), depreciationStart: this.date() || null });
    else this.changed.emit({ costKind: id as CostKind, depreciationYears: null, depreciationStart: null });
  }

  /** A preset writes both percentages; typed figures are not thrown away without asking. */
  pickPreset(preset: ExpensePreset): void {
    if (preset.code === 'CUSTOM') {
      this.changed.emit({ expenseType: 'CUSTOM' });
      return;
    }
    const value = this.value();
    const apply = (): void => this.changed.emit({ expenseType: preset.code, vatDeductiblePct: preset.vatPct, taxDeductiblePct: preset.taxPct });
    const typed = value.expenseType === 'CUSTOM' && ((value.vatDeductiblePct ?? 100) !== preset.vatPct || (value.taxDeductiblePct ?? 100) !== preset.taxPct);
    if (typed) this.ui.confirm({ title: preset.label, message: 'Je eigen percentages vervangen door het voorstel?', confirmLabel: 'Vervangen' }, apply);
    else apply();
  }

  pct(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === '') return null;
    return Math.min(100, Math.max(0, finite(Number(raw))));
  }

  years(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === '') return null;
    return Math.round(finite(Number(raw)));
  }
}
