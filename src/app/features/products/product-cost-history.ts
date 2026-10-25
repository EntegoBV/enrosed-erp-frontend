import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Skeleton } from '../../shared/skeleton';
import { RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import { Product, ProductCostHistoryEntry } from '../../core/api/models';
import { CurPipe, DateNlPipe, EurPipe, NumPipe } from '../../shared/pipes';
import { TrendChart, TrendSeries } from '../../shared/trend-chart';
import { productCostBasis } from './product-cost-basis';
import { costHistoryView, emptyCostHistory, excludedNote, replacedNote, type CostDelta, type CostSourceLink } from './product-cost-history-model';
import type { CostDriftNotice } from './product-price-build';

/**
 * The line of landed costs a product carried: every container that set
 * its cost, dearer or cheaper than the one before. Read-only and never
 * pruned; the desk and the phone page show it under the cost, the
 * Kostprijshistoriek sheet on its own. Every row reads in the basis it was
 * applied on (per display or per piece), with what one unit was made of.
 */
@Component({
  selector: 'app-product-cost-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EurPipe, NumPipe, DateNlPipe, CurPipe, TrendChart, Skeleton],
  template: `
    @if (drift(); as d) {
      <p class="pch__drift" role="note"><b>{{ d.orderNumber }} rekent nu {{ d.unitEur | eur: 2 }} {{ d.per }}</b>@if (d.basisNote; as note) { ({{ note }})} @else { ({{ d.up ? '+' : '−' }}&nbsp;{{ d.absEur | eur: 2 }})} · <a [routerLink]="['/purchasing', d.orderId]" [queryParams]="{ apply: 1 }">Opnieuw toepassen ›</a></p>
    }
    @if (loading()) {
      <div class="pch__state" role="status" aria-label="Historiek laden"><app-skeleton kind="lines" [rows]="3" /></div>
    } @else if (error()) {
      <p class="pch__state pch__state--err">{{ error() }}</p>
    } @else if (!view().rows.length) {
      @let empty = emptyState();
      <div class="pch__empty">
        <b>{{ empty.heading }}</b>
        <p>Zodra je bij een inkooporder de kostprijzen toepast, staat die hier met datum, container en het verschil met de vorige.</p>
        @if (empty.source; as source) {
          @if (source.id !== null) {
            <a [routerLink]="['/purchasing', source.id]">Bron kostprijs: {{ source.text }} ›</a>
          } @else {
            <span>Bron kostprijs: {{ source.text }}</span>
          }
        }
      </div>
    } @else {
      @let v = view();
      @let now = v.rows[0];
      <header class="pch__head">
        <div class="pch__now">
          <small>Huidige kostprijs</small>
          <strong>{{ now.entry.landedUnitEur | eur: 4 }}</strong>
          <span>{{ now.per }}@if (now.other; as other) { · {{ other.sign }} {{ other.price | eur: 4 }} {{ other.per }}}</span>
          <span>@if (now.linkId) {<a [routerLink]="['/purchasing', now.linkId]">{{ now.name }} ›</a>} @else {{{ now.name }}}@if (now.gone) { (verwijderd)} · {{ now.entry.appliedAt | dateNl }}</span>
        </div>
        <div class="pch__delta" [class.is-up]="now.delta.tone === 'up'" [class.is-down]="now.delta.tone === 'down'">
          @switch (now.delta.tone) {
            @case ('up') {
              <b>▲ {{ change(now.delta) }}</b>
              <span>duurder dan {{ now.against }} ({{ now.entry.previousLandedUnitEur | eur: 4 }})</span>
            }
            @case ('down') {
              <b>▼ {{ change(now.delta) }}</b>
              <span>goedkoper dan {{ now.against }} ({{ now.entry.previousLandedUnitEur | eur: 4 }})</span>
            }
            @case ('same') {
              <b>=</b>
              <span>gelijk aan {{ now.against }} ({{ now.entry.previousLandedUnitEur | eur: 4 }})</span>
            }
            @case ('basis') {
              <b>Andere basis</b>
              <span>de vorige kostprijs ({{ now.entry.previousLandedUnitEur | eur: 4 }}) gold {{ v.rows[1].per }}, dus niet te vergelijken</span>
            }
            @default {
              @if (now.kind === 'COPY') {
                <b>Kopie</b><span>overgenomen bij het kopiëren van het product</span>
              } @else if (now.kind === 'SEED') {
                <b>Start</b><span>de kostprijs die het product had toen de historiek begon</span>
              } @else {
                <b>Eerste</b><span>nog geen vorige container om mee te vergelijken</span>
              }
            }
          }
        </div>
      </header>
      @if (v.basisNote) { <p class="pch__note">{{ v.basisNote }}</p> }
      @if (v.chart.dates.length > 1) {
        <div class="pch__chart">
          <app-trend-chart [series]="series()" prefix="€ " [decimals]="4" [height]="150" ariaLabel="Kostprijs per container" emptyText="" />
        </div>
      }
      <dl class="pch__sums">
        <div><dt>Laagste</dt><dd>{{ v.stats.min | eur: 4 }}</dd></div>
        <div><dt>Hoogste</dt><dd>{{ v.stats.max | eur: 4 }}</dd></div>
        <div><dt>Gemiddeld</dt><dd>{{ v.stats.avg | eur: 4 }}</dd></div>
        <div><dt>Containers</dt><dd>{{ v.containers | num }}</dd></div>
      </dl>
      @if (excluded(); as note) { <p class="pch__muted">{{ note }}</p> }
      @if (replaced(); as note) { <p class="pch__muted">{{ note }}</p> }
      <ol class="pch__list">
        @for (row of v.rows; track row.entry.id; let first = $first) {
          <li [class.pch__row--now]="first">
            <span class="pch__when"><b>{{ row.entry.appliedAt | dateNl }}</b>@if (first) { <em>nu</em> }</span>
            <span class="pch__what">
              <span class="pch__name">
                @if (row.linkId) {
                  <a [routerLink]="['/purchasing', row.linkId]"><b>{{ row.name }}</b> ›</a>
                } @else {
                  <b [class.is-gone]="row.gone">{{ row.name }}</b>
                }
                @if (row.numberHint) { <small>{{ row.numberHint }}</small> }
                @if (row.gone) { <small class="pch__gone">verwijderd</small> }
                <i class="pch__kind" [attr.data-kind]="row.kind">{{ row.kindLabel }}</i>
              </span>
              <small>{{ row.quantity ?? '' }}@if (row.entry.exwPrice && row.entry.exwCurrency) {{{ row.quantity ? ' · ' : '' }}EXW {{ row.entry.exwPrice | cur: $any(row.entry.exwCurrency) }}}@if (row.by) {{{ row.quantity || row.entry.exwPrice ? ' · ' : '' }}{{ row.by }}}</small>
            </span>
            <span class="pch__cost">
              <b>{{ row.entry.landedUnitEur | eur: 4 }}</b>
              <small>{{ row.per }}</small>
              @if (row.other; as other) { <small>{{ other.sign }} {{ other.price | eur: 4 }} {{ other.per }}</small> }
              <i class="pch__chip" [class.is-up]="row.delta.tone === 'up'" [class.is-down]="row.delta.tone === 'down'">{{ chip(row.delta) }}</i>
            </span>
            @if (row.parts; as parts) {
              <details class="pch__parts">
                <summary>Opbouw</summary>
                @for (part of parts; track $index) {
                  <div class="pch__part" [class.is-total]="part.mark === '='">
                    <i aria-hidden="true">{{ part.mark }}</i>
                    <span>{{ part.label }}@if (part.hint) { <small>{{ part.hint }}</small> }</span>
                    <b>{{ part.eur | eur: 4 }}</b>
                  </div>
                }
              </details>
            }
          </li>
        }
      </ol>
    }
  `,
  styles: `
    :host { display: block; }
    .pch__state { margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.5; }
    .pch__state--err { color: var(--danger); }
    .pch__empty { display: grid; gap: 4px; padding: 14px; border: 1px dashed var(--line-strong); border-radius: 12px; }
    .pch__empty b { display: block; font-size: 13px; }
    .pch__empty p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
    .pch__empty a { justify-self: start; color: var(--accent); font-size: 12.5px; font-weight: 650; }
    .pch__empty span { color: var(--ink-2); font-size: 12.5px; font-weight: 650; overflow-wrap: anywhere; }
    .pch__head { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; margin-bottom: 12px; }
    .pch__now, .pch__delta { display: grid; align-content: start; gap: 2px; padding: 12px 14px; border-radius: 14px; }
    .pch__now { background: #272220; color: #fff; }
    .pch__now small { color: rgb(255 255 255 / 62%); font-size: 9.5px; font-weight: 780; letter-spacing: .08em; text-transform: uppercase; }
    .pch__now strong { font-size: 22px; letter-spacing: -.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .pch__now span { color: rgb(255 255 255 / 70%); font-size: 11px; line-height: 1.4; }
    .pch__now a { color: #fff; }
    .pch__delta { border: 1px solid var(--line); background: var(--surface-2); }
    .pch__delta b { font-size: 20px; letter-spacing: -.02em; line-height: 1.1; }
    .pch__delta span { color: var(--muted); font-size: 11px; line-height: 1.35; }
    .pch__delta.is-up b { color: var(--danger); }
    .pch__delta.is-down b { color: var(--ok); }
    .pch__drift { margin: 0 0 12px; padding: 9px 12px; border-radius: 12px; background: var(--warn-soft); color: #7c450b; font-size: 12.5px; line-height: 1.45; }
    .pch__drift a { color: inherit; font-weight: 650; }
    .pch__note { margin: 0 0 12px; padding: 9px 12px; border-radius: 12px; background: var(--warn-soft); color: #7c450b; font-size: 12px; line-height: 1.45; }
    .pch__muted { margin: -6px 0 12px; color: var(--muted); font-size: 11.5px; line-height: 1.4; }
    .pch__chart { margin: 0 0 12px; padding: 8px 6px 2px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
    .pch__sums { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin: 0 0 12px; }
    .pch__sums > div { display: grid; gap: 2px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
    .pch__sums dt { margin: 0; color: var(--muted); font-size: 9px; font-weight: 780; letter-spacing: .07em; text-transform: uppercase; }
    .pch__sums dd { margin: 0; font-size: 13px; font-variant-numeric: tabular-nums; font-weight: 700; }
    .pch__list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
    .pch__list li { display: grid; grid-template-columns: 96px minmax(0, 1fr) auto; align-items: center; gap: 4px 12px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
    .pch__row--now { border-color: var(--rose-line); background: var(--rose-soft); }
    .pch__when { display: grid; }
    .pch__when b { font-size: 12.5px; font-variant-numeric: tabular-nums; font-weight: 650; }
    .pch__when em { color: var(--rose-dark); font-size: 10px; font-style: normal; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
    .pch__what { display: grid; gap: 1px; min-width: 0; }
    .pch__name { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 6px; min-width: 0; }
    .pch__what a { color: inherit; text-decoration: none; }
    .pch__what a:hover b { text-decoration: underline; }
    .pch__what b { font-size: 13px; overflow-wrap: anywhere; }
    .pch__what b.is-gone { color: var(--muted); }
    .pch__what small { color: var(--muted); font-size: 11px; line-height: 1.4; }
    .pch__gone { font-style: italic; }
    .pch__kind { padding: 0 6px; border: 1px solid var(--line); border-radius: 999px; color: var(--ink-2); font-size: 10px; font-style: normal; font-weight: 700; line-height: 16px; white-space: nowrap; }
    .pch__kind[data-kind='REAPPLY'] { border-color: var(--rose-line); color: var(--rose-dark); }
    .pch__cost { display: grid; justify-items: end; gap: 2px; text-align: right; }
    .pch__cost b { font-size: 14px; font-variant-numeric: tabular-nums; }
    .pch__cost small { color: var(--muted); font-size: 10.5px; line-height: 1.3; }
    .pch__chip { display: inline-block; margin-top: 1px; padding: 1px 7px; border-radius: 999px; background: var(--surface-2); color: var(--muted); font-size: 10.5px; font-style: normal; font-weight: 750; white-space: nowrap; }
    .pch__chip.is-up { background: color-mix(in srgb, var(--danger) 12%, var(--surface)); color: var(--danger); }
    .pch__chip.is-down { background: var(--ok-soft); color: var(--ok); }
    .pch__parts { grid-column: 1 / -1; padding-top: 4px; border-top: 1px dashed var(--line); }
    .pch__parts summary { color: var(--accent); font-size: 12px; font-weight: 650; cursor: pointer; }
    .pch__part { display: grid; grid-template-columns: 14px minmax(0, 1fr) auto; align-items: baseline; gap: 8px; padding: 5px 0 0; font-size: 12px; }
    .pch__part i { color: var(--muted); font-style: normal; font-weight: 700; text-align: center; }
    .pch__part span { display: grid; min-width: 0; }
    .pch__part small { color: var(--muted); font-size: 10.5px; line-height: 1.35; }
    .pch__part b { font-variant-numeric: tabular-nums; font-weight: 600; }
    .pch__part.is-total b, .pch__part.is-total span { font-weight: 750; }
    @media (max-width: 480px) {
      .pch__head { grid-template-columns: 1fr; }
      .pch__sums { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .pch__list li { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'when cost' 'what cost' 'parts parts'; }
      .pch__when { grid-area: when; }
      .pch__what { grid-area: what; }
      .pch__cost { grid-area: cost; align-self: start; }
      .pch__parts { grid-area: parts; }
    }
  `,
})
export class ProductCostHistory {
  private readonly catalog = inject(CatalogApi);

  readonly productId = input.required<number>();
  /**
   * The product as it is today: its basis labels rows that kept none and is
   * compared with the newest row; its cost and source word an empty history.
   */
  readonly product = input<(Pick<Product, 'packaging'> & Partial<Pick<Product, 'landedCostEur' | 'landedCostSource'>>) | null>(null);
  /** The container the history was opened from; its rows need no link back to it. */
  readonly currentOrderId = input<number | null>(null);
  /** The order of the cost's source: the link of an empty history, and of rows that name it without keeping its id. */
  readonly sourceLink = input<CostSourceLink | null>(null);
  /** The rows the product page already fetched for its build-up; without them the history asks itself. */
  readonly preloaded = input<readonly ProductCostHistoryEntry[] | null>(null);
  /** The product page knows its source container now calculates another cost: the header says so, with the way to apply again. */
  readonly drift = input<CostDriftNotice | null>(null);

  readonly entries = signal<ProductCostHistoryEntry[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly view = computed(() => costHistoryView(this.entries(), productCostBasis(this.product()), this.currentOrderId(), this.sourceLink()));
  readonly emptyState = computed(() => emptyCostHistory(this.product(), this.sourceLink(), this.currentOrderId()));
  readonly excluded = computed(() => excludedNote(this.view().excluded));
  readonly replaced = computed(() => replacedNote(this.view().replaced));
  /** Oldest container first, one point a day, on the newest row's basis, so the line reads left to right like time. */
  readonly series = computed<TrendSeries[]>(() => {
    const view = this.view();
    const label = view.rows[0] ? `Kostprijs ${view.rows[0].per}` : 'Kostprijs';
    return [{ label, dates: view.chart.dates, values: view.chart.values, tone: 'accent' }];
  });

  constructor() {
    /* The purchase screens never load the unit names; "bowls" must not read "stuks" here. */
    void this.catalog.unitNames().catch(() => undefined);
  }

  private readonly loader = effect(() => {
    const id = this.productId();
    const given = this.preloaded();
    if (given) {
      this.entries.set([...given]);
      this.error.set(null);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.catalog.productCostHistory(id)
      .then((rows) => { if (this.productId() === id) this.entries.set(rows); })
      .catch((failure: unknown) => { if (this.productId() === id) this.error.set(messageOf(failure, 'Historiek laden mislukt')); })
      .finally(() => { if (this.productId() === id) this.loading.set(false); });
  });

  /** "3,2 %", or the amount when there was no cost to take a percentage of. */
  change(delta: CostDelta): string {
    if (delta.pct !== null) return `${Math.abs(delta.pct).toLocaleString('nl-BE', { maximumFractionDigits: 1 })} %`;
    if (delta.eur === null) return '';
    return new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(Math.abs(delta.eur));
  }

  chip(delta: CostDelta): string {
    switch (delta.tone) {
      case 'up': return `▲ ${this.change(delta)}`;
      case 'down': return `▼ ${this.change(delta)}`;
      case 'same': return '=';
      case 'basis': return 'andere basis';
      default: return 'eerste';
    }
  }
}
