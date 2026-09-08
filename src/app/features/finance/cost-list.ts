import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { saveBlob } from '../../core/api/download';
import { DateField } from '../../shared/date-field';
import { DateNlPipe, EurPipe } from '../../shared/pipes';
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
    .cost-filters { display: grid; gap: 12px; padding: 16px; }
    .cost-presets { display: flex; flex-wrap: wrap; gap: 6px; }
    .cost-range { display: grid; grid-template-columns: repeat(2, minmax(0, 180px)); gap: 10px; }
    .cost-fields { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; }
    .cost-fields .field { flex: 1 1 150px; min-width: 0; }
    .cost-fields .select { width: 100%; }
    .cost-search { min-width: 0; }
    .cost-more { min-width: 0; border-top: 1px solid var(--line); }
    .cost-more summary { padding: 10px 0 0; cursor: pointer; font-size: 12px; font-weight: 650; }
    .cost-more summary span { display: inline-block; margin-left: 5px; padding: 2px 6px; border-radius: 999px; color: var(--rose-dark); background: var(--rose-soft); font-size: 10px; }
    .cost-more__body { display: grid; gap: 12px; padding-top: 12px; }
    .cost-actions { display: flex; flex-wrap: wrap; gap: 6px; }
    .cost-selection { display: flex; align-items: start; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
    .cost-selection p { margin: 3px 0 0; color: var(--muted); font-size: 12px; }
    .cost-scope { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
    .cost-source { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 10px 16px; background: var(--surface-2); border-bottom: 1px solid var(--line); }
    .cost-source--container { background: var(--rose-soft); }
    .cost-source div { display: grid; gap: 2px; }
    .cost-source strong { font-size: 12px; }
    .cost-source small { color: var(--muted); font-size: 11px; }
    .cost-source b { flex-shrink: 0; font-size: 13px; font-variant-numeric: tabular-nums; }
    .fin-kpi span { white-space: normal; }
    @media (max-width: 600px) {
      .cost-filters { padding: 12px; }
      .cost-range { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .cost-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .cost-fields .input, .cost-fields .select, .cost-search .input { min-height: 42px; }
      .cost-actions .btn { flex: 1; }
      .cost-source { padding: 10px 12px; flex-wrap: wrap; gap: 4px 10px; }
      .fin-month header { flex-wrap: wrap; gap: 5px 10px; }
    }
    @media (max-width: 400px) {
      .cost-range, .cost-fields { grid-template-columns: minmax(0, 1fr); }
    }
  `,
  template: `
    <div class="card cost-filters" role="group" aria-label="Kosten en containerbetalingen filteren">
      @if (mode() === 'all' && !containerId()) {
        <div class="cost-presets" role="group" aria-label="Periode kiezen">
        @for (preset of presets; track preset.id) {
          <button class="fin-chip" type="button" [class.on]="presetId() === preset.id" [attr.aria-pressed]="presetId() === preset.id" (click)="applyPreset(preset.id)">{{ preset.label }}</button>
        }
        </div>
      }
      <div class="field cost-search"><label for="costs-query">Zoeken</label><input id="costs-query" class="input" type="search" placeholder="Omschrijving, ontvanger of factuur" [ngModel]="query()" (ngModelChange)="query.set($event)" /></div>
      <details class="cost-more">
        <summary>Meer filters @if (advancedFilterCount()) { <span>{{ advancedFilterCount() }} actief</span> }</summary>
        <div class="cost-more__body">
          @if (mode() === 'all' && !containerId()) {
            <div class="cost-range">
              <div class="field"><label for="costs-from">Van</label><app-date-field fieldId="costs-from" [value]="from()" (valueChange)="setRange($event, to())" /></div>
              <div class="field"><label for="costs-to">Tot en met</label><app-date-field fieldId="costs-to" [value]="to()" (valueChange)="setRange(from(), $event)" /></div>
            </div>
          }
          <div class="cost-fields">
            @if (!containerId() && mode() === 'all') {
              <div class="field"><label for="costs-source">Soort post</label><select id="costs-source" class="select" [ngModel]="source()" (ngModelChange)="setSource($event)">
                <option value="all">Beide soorten</option><option value="company">Bedrijfskosten</option><option value="container">Containerbetalingen</option>
              </select></div>
            }
            <div class="field"><label for="costs-category">Categorie</label><select id="costs-category" class="select" [ngModel]="category()" (ngModelChange)="category.set($event)">
              <option value="">Alle categorieën</option>
              @for (option of categories(); track option.code) { <option [value]="option.code">{{ option.label }}</option> }
            </select></div>
            @if (mode() === 'all' && effectiveSource() !== 'container') {
              <div class="field"><label for="costs-status">Betaalstatus</label><select id="costs-status" class="select" [ngModel]="status()" (ngModelChange)="status.set($event)">
                <option value="all">Betaald en open</option>
                <option value="open">Alleen open</option>
                <option value="paid">Alleen betaald</option>
              </select></div>
            }
          </div>
        </div>
      </details>
      <div class="cost-actions">
        @if (canClearFilters()) { <button class="btn btn--sm" type="button" (click)="clearFilters()">Filters wissen</button> }
        <button class="btn btn--sm" type="button" [disabled]="!rows().length" (click)="exportCsv()" title="Exporteer alleen de posten die bij deze filters horen">Exporteer CSV</button>
      </div>
      @if (invalidRange()) { <p class="cost-scope" role="alert">De einddatum ligt vóór de begindatum. Pas de periode aan om resultaten te zien.</p> }
    </div>

    <div class="cost-selection">
      <div><strong>{{ state.loading() ? 'Selectie wordt geladen…' : rows().length + (rows().length === 1 ? ' post in deze selectie' : ' posten in deze selectie') }}</strong><p>{{ selectionLabel() }}</p></div>
    </div>
    <section class="fin-kpis fin-kpis--4" aria-label="Totalen van de huidige selectie">
      @if (effectiveSource() !== 'container') {
        <article class="card fin-kpi fin-kpi--dark"><small>Bedrijfskosten excl. btw</small><strong>{{ summary().exclEur | eur }}</strong><span>{{ summary().count }} {{ summary().count === 1 ? 'kost' : 'kosten' }} · {{ summary().vatEur | eur }} btw</span></article>
        <article class="card fin-kpi" [class.fin-kpi--warn]="summary().unpaidCount > 0"><small>Open bedrijfskosten</small><strong>{{ summary().unpaidEur | eur }}</strong><span>{{ summary().unpaidCount }} nog te betalen · incl. btw</span></article>
      }
      @if (effectiveSource() !== 'company' && mode() !== 'open' && status() !== 'open') {
        <article class="card fin-kpi"><small>Betaald voor containers</small><strong>{{ totals().containerPaidEur | eur }}</strong><span>{{ totals().containerCount }} geregistreerde {{ totals().containerCount === 1 ? 'betaling' : 'betalingen' }}</span></article>
      }
      @if (effectiveSource() !== 'container' && mode() !== 'open') {
        <article class="card fin-kpi"><small>Betaald in deze selectie</small><strong>{{ totals().paidEur | eur }}</strong><span>{{ effectiveSource() === 'company' ? 'Bedrijfskosten incl. btw' : 'Bedrijfskosten incl. btw + containerbetalingen' }}</span></article>
      }
    </section>
    <p class="cost-scope">{{ scopeDescription() }} Open inkoopbedragen vind je bij de container.</p>

    @if (state.loading()) {
      <p class="fin-empty">Laden…</p>
    } @else if (!rows().length) {
      <div class="empty card"><div class="empty__title">{{ mode() === 'open' ? 'Geen open bedrijfskosten in deze selectie' : 'Geen posten gevonden' }}</div>
        <p>{{ invalidRange() ? 'Controleer de begin- en einddatum hierboven.' : containerId() ? 'Voor deze container zijn geen betalingen gevonden met de gekozen filters.' : 'Er zijn geen posten die bij deze periode en filters horen.' }}</p>
        @if (canClearFilters()) { <button class="btn" type="button" (click)="clearFilters()">{{ mode() === 'open' ? 'Toon alle open bedrijfskosten' : containerId() ? 'Toon alle betalingen van deze container' : 'Toon alle kosten en betalingen' }}</button> }
      </div>
    } @else {
      @for (group of byMonth(); track group.month) {
        <section class="card fin-month" [attr.aria-label]="group.label">
          <header><h2>{{ group.label }}</h2><span>{{ group.count }} {{ group.count === 1 ? 'post' : 'posten' }}</span></header>
          @if (group.companyRows.length) {
            <div class="cost-source"><div><strong>Bedrijfskosten · {{ group.companyRows.length }}</strong><small>{{ group.openCount ? group.openCount + ' open · ' : '' }}Factuurbedragen incl. btw</small></div><b>{{ group.companyInclEur | eur }}</b></div>
            <div class="fin-list">@for (row of group.companyRows; track row.key) { @if (row.cost; as cost) { <app-cost-row [cost]="cost" /> } }</div>
          }
          @if (group.containerRows.length) {
            <div class="cost-source cost-source--container"><div><strong>Containerbetalingen · {{ group.containerRows.length }}</strong><small>Werkelijk betaald · beheren bij de container</small></div><b>{{ group.containerPaidEur | eur }}</b></div>
            <div class="fin-list">@for (row of group.containerRows; track row.key) { <app-purchase-payment-cost-row [row]="row" /> }</div>
          }
        </section>
      }
    }
  `,
})
export class CostList {
  readonly state = inject(FinanceState);
  private readonly dateLabel = new DateNlPipe();
  readonly mode = input<'all' | 'open'>('all');
  readonly containerId = input<number | null>(null);
  readonly presets = PRESETS;
  readonly categoryLabel = (code: string): string => CONTAINER_PAYMENT_CATEGORIES.find((category) => category.code === code)?.label ?? categoryLabel(code);

  readonly presetId = signal<PresetId | null>('year');
  readonly from = signal(`${YEAR}-01-01`);
  readonly to = signal(TODAY);
  readonly query = signal('');
  readonly category = signal('');
  readonly status = signal<'all' | 'open' | 'paid'>('all');
  readonly source = signal<'all' | 'company' | 'container'>('all');

  readonly effectiveSource = computed(() => this.containerId() ? 'container' : this.mode() === 'open' ? 'company' : this.source());
  readonly categories = computed(() => [
    ...(this.effectiveSource() === 'container' ? [] : categoryChoices(this.state.costs().map((cost) => cost.category))),
    ...(this.effectiveSource() === 'company' ? [] : CONTAINER_PAYMENT_CATEGORIES),
  ]);
  readonly invalidRange = computed(() => this.mode() === 'all' && !this.containerId() && !!this.from() && !!this.to() && this.from() > this.to());
  readonly advancedFilterCount = computed(() => Number(!!this.category())
    + Number(this.mode() === 'all' && !this.containerId() && this.presetId() === null)
    + Number(this.mode() === 'all' && !this.containerId() && this.source() !== 'all')
    + Number(this.mode() === 'all' && this.effectiveSource() !== 'container' && this.status() !== 'all'));
  readonly scopeDescription = computed(() => this.containerId() ? 'Hier staan geregistreerde betalingen voor deze container, over alle datums.'
    : this.mode() === 'open' ? 'Hier staan alleen onbetaalde bedrijfskosten, over alle datums.'
    : this.effectiveSource() === 'company' ? 'De periode volgt de kostdatum, ook wanneer de kost op een andere dag werd betaald.'
    : this.effectiveSource() === 'container' ? 'De periode volgt de betaaldatum van de containerbetalingen.'
    : 'De periode volgt de kostdatum van bedrijfskosten en de betaaldatum van containerbetalingen.');
  readonly canClearFilters = computed(() => !!this.query() || !!this.category()
    || this.mode() === 'all' && (this.status() !== 'all' || !this.containerId() && (this.source() !== 'all' || !!this.from() || !!this.to())));
  readonly selectionLabel = computed(() => {
    const source = this.containerId() ? `Container #${this.containerId()}` : this.effectiveSource() === 'company' ? 'Bedrijfskosten'
      : this.effectiveSource() === 'container' ? 'Containerbetalingen' : 'Bedrijfskosten en containerbetalingen';
    const period = this.mode() === 'open' || this.containerId() || !this.from() && !this.to() ? 'alle datums'
      : `${this.from() ? 'vanaf ' + this.dateLabel.transform(this.from()) : 'alle begindatums'}${this.to() ? ' t/m ' + this.dateLabel.transform(this.to()) : ''}`;
    const status = this.mode() === 'open' || this.status() === 'open' ? 'alleen open' : this.effectiveSource() === 'container' || this.status() === 'paid' ? 'alleen betaald' : 'betaald en open';
    return [source, period, status, this.category() ? this.categoryLabel(this.category()) : null,
      this.query().trim() ? `zoekterm: “${this.query().trim()}”` : null].filter(Boolean).join(' · ');
  });
  readonly rows = computed(() => {
    const open = this.mode() === 'open';
    return filterCostLedger(this.state.ledger(), {
      from: open || this.containerId() ? null : this.from(), to: open || this.containerId() ? null : this.to(),
      containerId: this.containerId(), query: this.query(), category: this.category(),
      status: open ? 'open' : this.status(), source: this.effectiveSource(),
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
        companyInclEur: Math.round(rows.filter((row) => row.source === 'company').reduce((sum, row) => sum + row.amountEur, 0) * 100) / 100,
        containerPaidEur: costLedgerTotals(rows).containerPaidEur,
        openCount: rows.filter((row) => !row.paidOn).length,
        companyRows: [...rows].filter((row) => row.source === 'company').sort((left, right) => (oldestFirst ? left.date.localeCompare(right.date) : right.date.localeCompare(left.date)) || left.key.localeCompare(right.key)),
        containerRows: [...rows].filter((row) => row.source === 'container').sort((left, right) => right.date.localeCompare(left.date) || left.key.localeCompare(right.key)),
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
    this.presetId.set(PRESETS.find((preset) => preset.from === from && preset.to === to)?.id ?? null);
  }

  setSource(source: 'all' | 'company' | 'container'): void {
    this.source.set(source);
    this.category.set('');
    if (source === 'container') this.status.set('all');
  }

  clearFilters(): void {
    this.query.set('');
    this.category.set('');
    this.status.set('all');
    this.source.set('all');
    this.applyPreset('all');
  }

  /** The list as the accountant wants it: one file, semicolons, a decimal comma. */
  exportCsv(): void {
    const label = this.containerId() ? `container-${this.containerId()}` : this.mode() === 'open' ? 'open' : `${this.from() || 'alles'}${this.to() ? '-tot-' + this.to() : ''}`;
    saveBlob(new Blob(['﻿' + costLedgerCsv(this.rows(), this.categoryLabel)], { type: 'text/csv;charset=utf-8' }), `kosten-${label}.csv`);
  }
}
