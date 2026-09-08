import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { saveBlob } from '../../core/api/download';
import { CompanyCost } from '../../core/api/models';
import { DateField } from '../../shared/date-field';
import { EurPipe, PctPipe } from '../../shared/pipes';
import { channelLabel } from '../sales/sales-channels';
import { categoryChoices, categoryLabel } from './cost-categories';
import { costSummary, costsInPeriod } from './cost-metrics';
import { CostRow } from './cost-row';
import { costsCsv } from './finance-metrics';
import { MONTH_START, TODAY, YEAR } from './finance-sections';
import { FinanceState } from './finance-state';

const QUARTER_START = `${YEAR}-${String(Math.floor((Number(TODAY.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
const LAST_YEAR = String(YEAR - 1);

type PresetId = 'month' | 'quarter' | 'year' | 'lastYear' | 'all';
interface Preset { id: PresetId; label: string; from: string; to: string }

const PRESETS: readonly Preset[] = [
  { id: 'month', label: 'Deze maand', from: MONTH_START, to: TODAY },
  { id: 'quarter', label: 'Dit kwartaal', from: QUARTER_START, to: TODAY },
  { id: 'year', label: 'Dit jaar', from: `${YEAR}-01-01`, to: TODAY },
  { id: 'lastYear', label: LAST_YEAR, from: `${LAST_YEAR}-01-01`, to: `${LAST_YEAR}-12-31` },
  { id: 'all', label: 'Alles', from: '', to: '' },
];

/** Every cost in a period, per month; or, in open mode, everything still to pay, oldest first. */
@Component({
  selector: 'app-cost-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DateField, EurPipe, PctPipe, CostRow],
  template: `
    <div class="fin-filters" role="group" aria-label="Filters">
      @if (mode() === 'all') {
        @for (preset of presets; track preset.id) {
          <button class="fin-chip" type="button" [class.on]="presetId() === preset.id" (click)="applyPreset(preset.id)">{{ preset.label }}</button>
        }
        <span class="fin-filters__range">
          <app-date-field fieldId="costs-from" [value]="from()" (valueChange)="setRange($event, to())" />
          <i>tot</i>
          <app-date-field fieldId="costs-to" [value]="to()" (valueChange)="setRange(from(), $event)" />
        </span>
      }
      <span class="fin-filters__row">
        <input class="input fin-filters__search" type="search" placeholder="Zoek op omschrijving, wie, factuur" aria-label="Zoeken" [ngModel]="query()" (ngModelChange)="query.set($event)" />
        <select class="select" aria-label="Categorie" [ngModel]="category()" (ngModelChange)="category.set($event)">
          <option value="">Alle categorieën</option>
          @for (option of categories(); track option.code) { <option [value]="option.code">{{ option.label }}</option> }
        </select>
        @if (mode() === 'all') {
          <select class="select" aria-label="Betaald of open" [ngModel]="status()" (ngModelChange)="status.set($event)">
            <option value="all">Betaald en open</option>
            <option value="open">Alleen open</option>
            <option value="paid">Alleen betaald</option>
          </select>
        }
        <button class="btn btn--sm" type="button" [disabled]="!rows().length" (click)="exportCsv()" title="Voor de boekhouder: een CSV met alles uit deze lijst">CSV</button>
      </span>
    </div>

    <section class="fin-kpis fin-kpis--4" aria-label="Totalen">
      <article class="card fin-kpi fin-kpi--dark"><small>{{ mode() === 'open' ? 'Open, excl. btw' : 'Kosten excl. btw' }}</small><strong>{{ summary().exclEur | eur: 0 }}</strong><span>{{ summary().count }} {{ summary().count === 1 ? 'kost' : 'kosten' }}</span></article>
      <article class="card fin-kpi"><small>Incl. btw</small><strong>{{ summary().inclEur | eur: 0 }}</strong><span>{{ summary().vatEur | eur: 0 }} btw</span></article>
      <article class="card fin-kpi" [class.fin-kpi--warn]="summary().unpaidCount > 0"><small>Nog te betalen</small><strong>{{ summary().unpaidEur | eur: 0 }}</strong><span>{{ summary().unpaidCount }} open, incl. btw</span></article>
      <article class="card fin-kpi"><small>Grootste post</small><strong>{{ summary().byCategory[0] ? categoryLabel(summary().byCategory[0].category) : '—' }}</strong><span>{{ summary().byCategory[0] ? (summary().byCategory[0].sharePct | pct: 0) + ' van het totaal' : 'niets in deze selectie' }}</span></article>
    </section>

    @if (state.loading()) {
      <p class="fin-empty">Laden…</p>
    } @else if (!rows().length) {
      <div class="empty card"><div class="empty__title">{{ mode() === 'open' ? 'Niets open' : 'Geen kosten in deze selectie' }}</div>
        <p>{{ mode() === 'open' ? 'Alles is betaald.' : 'Boek de beurs, de boekhouder of de huur met + Kost, of kies een ruimere periode.' }}</p></div>
    } @else {
      @for (group of byMonth(); track group.month) {
        <section class="card fin-month" [attr.aria-label]="group.label">
          <header><h2>{{ group.label }}</h2><span>{{ group.count }} {{ group.count === 1 ? 'kost' : 'kosten' }}</span><strong>{{ group.exclEur | eur: 0 }}</strong></header>
          <div class="fin-list">
            @for (cost of group.costs; track cost.id) { <app-cost-row [cost]="cost" /> }
          </div>
        </section>
      }
    }
  `,
})
export class CostList {
  readonly state = inject(FinanceState);
  readonly mode = input<'all' | 'open'>('all');
  readonly presets = PRESETS;
  readonly categoryLabel = categoryLabel;

  readonly presetId = signal<PresetId>('year');
  readonly from = signal(`${YEAR}-01-01`);
  readonly to = signal(TODAY);
  readonly query = signal('');
  readonly category = signal('');
  readonly status = signal<'all' | 'open' | 'paid'>('all');

  readonly categories = computed(() => categoryChoices(this.state.costs().map((cost) => cost.category)));
  readonly rows = computed(() => {
    const open = this.mode() === 'open';
    let rows = open ? this.state.openCosts() : costsInPeriod(this.state.costs(), this.from(), this.to());
    const needle = this.query().trim().toLowerCase();
    if (needle) {
      rows = rows.filter((cost) => [cost.description, cost.party, cost.reference, cost.notes, categoryLabel(cost.category), cost.salesChannel ? channelLabel(cost.salesChannel) : '']
        .some((part) => (part ?? '').toLowerCase().includes(needle)));
    }
    if (this.category()) rows = rows.filter((cost) => (cost.category ?? '').toUpperCase() === this.category());
    if (!open && this.status() === 'open') rows = rows.filter((cost) => !cost.paidOn);
    if (!open && this.status() === 'paid') rows = rows.filter((cost) => !!cost.paidOn);
    return rows;
  });
  readonly summary = computed(() => costSummary(this.rows()));
  readonly byMonth = computed(() => {
    const oldestFirst = this.mode() === 'open';
    const groups = new Map<string, CompanyCost[]>();
    for (const cost of this.rows()) {
      const key = cost.date.slice(0, 7);
      groups.set(key, [...(groups.get(key) ?? []), cost]);
    }
    return [...groups.entries()]
      .sort((left, right) => (oldestFirst ? left[0].localeCompare(right[0]) : right[0].localeCompare(left[0])))
      .map(([month, costs]) => ({
        month,
        label: new Date(`${month}-01T00:00:00`).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' }),
        count: costs.length,
        exclEur: Math.round(costs.reduce((sum, cost) => sum + (cost.amountExclEur || 0), 0) * 100) / 100,
        costs: [...costs].sort((left, right) => (oldestFirst ? left.date.localeCompare(right.date) : right.date.localeCompare(left.date)) || (right.id ?? 0) - (left.id ?? 0)),
      }));
  });

  applyPreset(id: PresetId): void {
    const preset = PRESETS.find((row) => row.id === id);
    if (!preset) return;
    this.presetId.set(id);
    this.from.set(preset.from);
    this.to.set(preset.to);
  }

  setRange(from: string, to: string): void {
    this.from.set(from);
    this.to.set(to);
    this.presetId.set(PRESETS.find((preset) => preset.from === from && preset.to === to)?.id ?? 'all');
  }

  /** The list as the accountant wants it: one file, semicolons, a decimal comma. */
  exportCsv(): void {
    const label = this.mode() === 'open' ? 'open' : `${this.from() || 'alles'}${this.to() ? '-tot-' + this.to() : ''}`;
    saveBlob(new Blob(['﻿' + costsCsv(this.rows(), categoryLabel)], { type: 'text/csv;charset=utf-8' }), `kosten-${label}.csv`);
  }
}
