import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { saveBlob } from '../../core/api/download';
import { DateField } from '../../shared/date-field';
import { EurPipe } from '../../shared/pipes';
import { channelLabel } from '../sales/sales-channels';
import { categoryChoices, categoryLabel } from './cost-categories';
import { costSummary } from './cost-metrics';
import { CostRow } from './cost-row';
import { CONTAINER_PAYMENT_CATEGORIES, CostLedgerRow, costLedgerCsv, costLedgerTotals, filterCostLedger } from './cost-ledger';
import { PurchasePaymentCostRow } from './purchase-payment-cost-row';
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
  imports: [FormsModule, DateField, EurPipe, CostRow, PurchasePaymentCostRow],
  styles: `
    :host { display: grid; gap: 14px; }
    .fin-month header strong { display: grid; justify-items: end; }
    .fin-month header strong small { font-size: 10px; color: var(--muted); font-weight: 500; }
    @media (max-width: 600px) { .fin-month header { flex-wrap: wrap; gap: 5px 10px; } .fin-month header h2 { min-width: 45%; } }
  `,
  template: `
    <div class="fin-filters" role="group" aria-label="Filters">
      @if (mode() === 'all' && !containerId()) {
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
        @if (!containerId() && mode() === 'all') {
          <select class="select" aria-label="Bron" [ngModel]="source()" (ngModelChange)="source.set($event)">
            <option value="all">Alle kosten en betalingen</option><option value="company">Bedrijfskosten</option><option value="container">Containerbetalingen</option>
          </select>
        }
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
      <article class="card fin-kpi fin-kpi--dark"><small>{{ mode() === 'open' ? 'Open bedrijfskosten, excl. btw' : 'Bedrijfskosten excl. btw' }}</small><strong>{{ summary().exclEur | eur: 0 }}</strong><span>{{ summary().count }} {{ summary().count === 1 ? 'kost' : 'kosten' }} · {{ summary().vatEur | eur: 0 }} btw</span></article>
      <article class="card fin-kpi"><small>Containerbetalingen</small><strong>{{ totals().containerPaidEur | eur }}</strong><span>{{ totals().containerCount }} gekoppelde {{ totals().containerCount === 1 ? 'betaling' : 'betalingen' }}</span></article>
      <article class="card fin-kpi" [class.fin-kpi--warn]="summary().unpaidCount > 0"><small>Nog te betalen</small><strong>{{ summary().unpaidEur | eur: 0 }}</strong><span>{{ summary().unpaidCount }} open, incl. btw</span></article>
      <article class="card fin-kpi"><small>Totaal betaald</small><strong>{{ totals().paidEur | eur }}</strong><span>bedrijfskosten incl. btw + containers</span></article>
    </section>
    @if (totals().containerCount) {
      <p class="fin-panel__hint">Containerbetalingen verschijnen hier automatisch en tellen één keer mee op de bank. Bewerk ze via de container. Btw wordt niet uit de betaling afgeleid; de containerkostprijs bepaalt de goederenwaarde en verkoopmarge.</p>
    }

    @if (state.loading()) {
      <p class="fin-empty">Laden…</p>
    } @else if (!rows().length) {
      <div class="empty card"><div class="empty__title">{{ mode() === 'open' ? 'Niets open' : 'Geen kosten in deze selectie' }}</div>
        <p>{{ mode() === 'open' ? 'Alle bedrijfskosten zijn betaald. Open containerbedragen vind je bij de container.' : containerId() ? 'Er zijn geen containerbetalingen die overeenkomen met deze filters.' : 'Kies een ruimere periode of voeg een kost of containerbetaling toe.' }}</p></div>
    } @else {
      @for (group of byMonth(); track group.month) {
        <section class="card fin-month" [attr.aria-label]="group.label">
          <header><h2>{{ group.label }}</h2><span>{{ group.count }} {{ group.count === 1 ? 'post' : 'posten' }}</span><strong>{{ group.amountEur | eur }} <small>incl. btw / betaald</small></strong></header>
          <div class="fin-list">
            @for (row of group.rows; track row.key) {
              @if (row.cost; as cost) { <app-cost-row [cost]="cost" /> }
              @else { <app-purchase-payment-cost-row [row]="row" /> }
            }
          </div>
        </section>
      }
    }
  `,
})
export class CostList {
  readonly state = inject(FinanceState);
  readonly mode = input<'all' | 'open'>('all');
  readonly containerId = input<number | null>(null);
  readonly presets = PRESETS;
  readonly categoryLabel = (code: string): string => CONTAINER_PAYMENT_CATEGORIES.find((category) => category.code === code)?.label ?? categoryLabel(code);

  readonly presetId = signal<PresetId>('year');
  readonly from = signal(`${YEAR}-01-01`);
  readonly to = signal(TODAY);
  readonly query = signal('');
  readonly category = signal('');
  readonly status = signal<'all' | 'open' | 'paid'>('all');
  readonly source = signal<'all' | 'company' | 'container'>('all');

  readonly categories = computed(() => [...categoryChoices(this.state.costs().map((cost) => cost.category)), ...CONTAINER_PAYMENT_CATEGORIES]);
  readonly rows = computed(() => {
    const open = this.mode() === 'open';
    return filterCostLedger(this.state.ledger(), {
      from: open || this.containerId() ? null : this.from(), to: open || this.containerId() ? null : this.to(),
      containerId: this.containerId(), query: this.query(), category: this.category(),
      status: open ? 'open' : this.status(), source: this.containerId() ? 'container' : this.source(),
    }, this.categoryLabel, channelLabel);
  });
  readonly summary = computed(() => costSummary(this.rows().flatMap((row) => row.cost ? [row.cost] : [])));
  readonly totals = computed(() => costLedgerTotals(this.rows()));
  readonly byMonth = computed(() => {
    const oldestFirst = this.mode() === 'open';
    const groups = new Map<string, CostLedgerRow[]>();
    for (const row of this.rows()) {
      const key = row.date.slice(0, 7);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups.entries()]
      .sort((left, right) => (oldestFirst ? left[0].localeCompare(right[0]) : right[0].localeCompare(left[0])))
      .map(([month, rows]) => ({
        month,
        label: new Date(`${month}-01T00:00:00`).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' }),
        count: rows.length,
        amountEur: Math.round(rows.reduce((sum, row) => sum + row.amountEur, 0) * 100) / 100,
        rows: [...rows].sort((left, right) => (oldestFirst ? left.date.localeCompare(right.date) : right.date.localeCompare(left.date)) || left.key.localeCompare(right.key)),
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
    const label = this.containerId() ? `container-${this.containerId()}` : this.mode() === 'open' ? 'open' : `${this.from() || 'alles'}${this.to() ? '-tot-' + this.to() : ''}`;
    saveBlob(new Blob(['﻿' + costLedgerCsv(this.rows(), this.categoryLabel)], { type: 'text/csv;charset=utf-8' }), `kosten-${label}.csv`);
  }
}
