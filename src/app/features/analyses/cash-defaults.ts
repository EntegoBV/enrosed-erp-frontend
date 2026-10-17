import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { CostBasis, PriceMode } from '../../core/api/models';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { CashState } from './cash-state';
import { marginOfMarkup, pct, realisedHint, standardMarkupNote } from './cash-view';

const PRICE_OPTIONS: SegmentOption[] = [
  { id: 'MARKUP_PCT', label: 'Opslag' }, { id: 'EUR_PER_UNIT', label: '€ / stuk' }, { id: 'LIST', label: 'Lijstprijs' }, { id: 'HISTORIC', label: 'Historisch' },
];
const BASIS_OPTIONS: SegmentOption[] = [{ id: 'EXTERNAL', label: 'Externe kost' }, { id: 'PRICING', label: '+ Enrosed-kost' }];
const WEEK_CHOICES = [8, 12, 16, 26];
const DAY_CHOICES = [14, 30, 45, 60];

/**
 * "Prijs en tempo · standaard voor alle containers": the link-level
 * defaults every container without a stored choice sells with. The desk
 * panel shows all of it; the phone opens one part per sheet.
 */
@Component({
  selector: 'app-cash-defaults',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Segmented],
  template: `
    <div class="cf-defaults" [class.cf-defaults--ios]="ios()">
      @if (part() === 'all' || part() === 'price') {
        <div class="cf-ctl">
          <span class="cf-ctl__label">Prijs</span>
          <app-segmented [variant]="ios() ? 'ios' : 'desk'" label="Prijs" [options]="priceOptions" [value]="priceMode()" (changed)="setPrice($event)" />
        </div>
        @if (priceMode() === 'EUR_PER_UNIT') {
          <div class="cf-ctl cf-ctl--inline">
            <label class="cf-ctl__label" for="cf-def-stuk">Opslag per stuk</label>
            <span class="cf-money"><span>€</span>
              <input id="cf-def-stuk" class="cf-input" type="text" inputmode="decimal" autocomplete="off" [value]="perUnitText()"
                     (change)="setPerUnit($any($event.target).value)" /></span>
          </div>
        } @else {
          <div class="cf-ctl cf-ctl--inline">
            <span class="cf-ctl__label">Opslag op kost</span>
            <span class="cf-step" role="group" aria-label="Opslag op kost">
              <button type="button" aria-label="5 % minder" [disabled]="markup() <= 0" (click)="stepMarkup(-5)">−</button>
              <output>{{ pctText(markup()) }} %</output>
              <button type="button" aria-label="5 % meer" [disabled]="markup() >= 1000" (click)="stepMarkup(5)">+</button>
            </span>
          </div>
          <p class="cf-ctl__hint">= marge {{ marginText() }}@if (realisedText()) { · {{ realisedText() }} }@if (standardNote() && location().markupPct === null) { · {{ standardNote() }} }
            @if (priceMode() !== 'MARKUP_PCT') { · voor producten zonder {{ priceMode() === 'LIST' ? 'lijstprijs' : 'factuurprijs' }} }</p>
        }
        <div class="cf-ctl">
          <span class="cf-ctl__label">Kostbasis</span>
          <app-segmented [variant]="ios() ? 'ios' : 'desk'" label="Kostbasis" [options]="basisOptions" [value]="costBasis()" (changed)="setBasis($event)" />
        </div>
      }
      @if (part() === 'all' || part() === 'pace') {
        <div class="cf-ctl">
          <span class="cf-ctl__label">Verkocht in</span>
          <app-segmented [variant]="ios() ? 'ios' : 'desk'" label="Verkocht in" [options]="weekOptions()" [value]="weeksValue()" (changed)="setWeeks($event)" />
        </div>
        <div class="cf-ctl">
          <span class="cf-ctl__label">Verloop</span>
          <app-segmented [variant]="ios() ? 'ios' : 'desk'" label="Verloop" [options]="seasonOptions()" [value]="seasonValue()" (changed)="setSeason($event)" />
        </div>
        @if (!seasonAvailable()) { <p class="cf-ctl__hint">Seizoen: te weinig historiek</p> }
      }
      @if (part() === 'all' || part() === 'payment') {
        <div class="cf-ctl">
          <span class="cf-ctl__label">Betaaltermijn</span>
          <app-segmented [variant]="ios() ? 'ios' : 'desk'" label="Betaaltermijn" [options]="dayOptions()" [value]="daysValue()" (changed)="setDays($event)" />
        </div>
      }
      @if (part() === 'all') { <p class="cf-ctl__hint cf-ctl__hint--note">{{ hint() }}</p> }
    </div>
  `,
})
export class CashDefaults {
  private readonly state = inject(CashState);
  readonly variant = input<'desk' | 'ios'>('desk');
  readonly part = input<'all' | 'price' | 'pace' | 'payment'>('all');

  readonly ios = computed(() => this.variant() === 'ios');
  readonly priceOptions = PRICE_OPTIONS;
  readonly basisOptions = BASIS_OPTIONS;
  readonly pctText = pct;

  readonly location = this.state.location;
  private readonly history = computed(() => this.state.input()?.history ?? null);
  readonly realised = computed(() => this.history()?.realisedMarkupPct ?? null);
  /* The raw 12-month markup stays visible with its basis, even when too thin to be the default (critique B4). */
  readonly realisedText = computed(() => realisedHint(this.realised(), this.history()?.realisedSample));
  readonly standardNote = computed(() => standardMarkupNote(this.realised(), this.history()?.realisedSample));
  readonly seasonAvailable = computed(() => !!this.history()?.seasonal);

  readonly priceMode = computed<PriceMode>(() => this.location().priceMode ?? 'MARKUP_PCT');
  readonly markup = computed(() => this.location().markupPct ?? this.realised() ?? 50);
  readonly perUnitText = computed(() => String(this.location().markupEurPerUnit ?? 0).replace('.', ','));
  readonly costBasis = computed<CostBasis>(() => this.location().costBasis ?? 'EXTERNAL');
  readonly marginText = computed(() => marginOfMarkup(this.markup()));

  readonly weekOptions = computed<SegmentOption[]>(() => {
    const weeks = this.location().sellWeeks;
    const values = weeks !== null && !WEEK_CHOICES.includes(weeks) ? [...WEEK_CHOICES, weeks].sort((a, b) => a - b) : WEEK_CHOICES;
    return [{ id: '', label: 'Tempo' }, ...values.map((value) => ({ id: String(value), label: `${value} w` }))];
  });
  readonly weeksValue = computed(() => (this.location().sellWeeks === null ? '' : String(this.location().sellWeeks)));
  readonly seasonOptions = computed<SegmentOption[]>(() => [{ id: 'vlak', label: 'Gelijkmatig' }, { id: 'seizoen', label: 'Seizoen', disabled: !this.seasonAvailable() }]);
  readonly seasonValue = computed(() => ((this.location().seasonal ?? this.seasonAvailable()) && this.seasonAvailable() ? 'seizoen' : 'vlak'));
  readonly dayOptions = computed<SegmentOption[]>(() => {
    const days = this.location().paymentDays;
    const values = days !== null && !DAY_CHOICES.includes(days) ? [...DAY_CHOICES, days].sort((a, b) => a - b) : DAY_CHOICES;
    return [{ id: '', label: 'Gemiddeld' }, ...values.map((value) => ({ id: String(value), label: `${value} d` }))];
  });
  readonly daysValue = computed(() => (this.location().paymentDays === null ? '' : String(this.location().paymentDays)));

  /** "Voorstel uit het tempo: ≈ {W} w. …": W weighs each source's pace by its cost. */
  readonly hint = computed(() => {
    const forecast = this.state.forecast();
    const history = this.history();
    let weighted = 0;
    let basis = 0;
    for (const source of forecast?.scenario.sources ?? []) {
      if (!source.choice || source.locked || !(source.costEur > 0)) continue;
      weighted += source.costEur * source.choice.defaultSellWeeks;
      basis += source.costEur;
    }
    const weeks = basis > 0 ? Math.round(weighted / basis) : null;
    const pace = weeks === null ? '' : `Voorstel uit het tempo: ≈ ${weeks} w. `;
    return `${pace}Klanten betalen gem. na ${history?.paymentDays ?? 30} d. Btw op verkoop gem. ${pct(history?.vatPct ?? 21)} %.`;
  });

  setPrice(value: string): void { this.state.setDefault('priceMode', value as PriceMode); }
  setBasis(value: string): void { this.state.setDefault('costBasis', value as CostBasis); }
  setWeeks(value: string): void { this.state.setDefault('sellWeeks', value === '' ? null : Number(value)); }
  setDays(value: string): void { this.state.setDefault('paymentDays', value === '' ? null : Number(value)); }
  setSeason(value: string): void { this.state.setDefault('seasonal', value === 'seizoen'); }

  stepMarkup(step: number): void {
    const next = Math.min(1000, Math.max(0, Math.round((this.markup() + step) / 5) * 5));
    this.state.setDefault('markupPct', next);
  }

  setPerUnit(raw: string): void {
    const value = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(value) || value < 0) return;
    this.state.setDefault('markupEurPerUnit', Math.round(value * 10000) / 10000);
  }
}
