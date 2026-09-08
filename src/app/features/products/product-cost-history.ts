import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import { ProductCostHistoryEntry } from '../../core/api/models';
import { CurPipe, DateNlPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import { TrendChart, TrendSeries } from '../../shared/trend-chart';

/**
 * The line of landed costs a product carried: every container that set
 * its cost, dearer or cheaper than the one before. Read-only and never
 * pruned; the desk and the phone page both show it under the cost.
 */
@Component({
  selector: 'app-product-cost-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EurPipe, NumPipe, PctPipe, DateNlPipe, CurPipe, TrendChart],
  template: `
    @if (loading()) {
      <p class="pch__state">Historiek laden…</p>
    } @else if (error()) {
      <p class="pch__state pch__state--err">{{ error() }}</p>
    } @else if (!entries().length) {
      <div class="pch__empty">
        <b>Nog geen kostprijs uit een container</b>
        <p>Zodra je bij een inkooporder de kostprijzen toepast, staat die hier met datum, container en het verschil met de vorige.</p>
      </div>
    } @else {
      <header class="pch__head">
        <div class="pch__now">
          <small>Huidige kostprijs</small>
          <strong>{{ latest().landedUnitEur | eur: 4 }}</strong>
          <span>{{ latest().source || 'handmatig' }} · {{ latest().appliedAt | dateNl }}</span>
        </div>
        @if (latest().deltaEur !== null) {
          <div class="pch__delta" [class.is-up]="latest().deltaEur! > 0" [class.is-down]="latest().deltaEur! < 0">
            <b>{{ latest().deltaEur! > 0 ? '▲' : '▼' }} {{ absPct(latest().deltaPct) }}</b>
            <span>{{ latest().deltaEur! > 0 ? 'duurder' : 'goedkoper' }} dan de vorige container ({{ latest().previousLandedUnitEur | eur: 4 }})</span>
          </div>
        } @else {
          <div class="pch__delta"><b>Eerste</b><span>nog geen vorige container om mee te vergelijken</span></div>
        }
      </header>
      @if (entries().length > 1) {
        <div class="pch__chart">
          <app-trend-chart [series]="series()" prefix="€ " [decimals]="4" [height]="150" ariaLabel="Kostprijs per container" emptyText="" />
        </div>
      }
      <dl class="pch__sums">
        <div><dt>Laagste</dt><dd>{{ stats().min | eur: 4 }}</dd></div>
        <div><dt>Hoogste</dt><dd>{{ stats().max | eur: 4 }}</dd></div>
        <div><dt>Gemiddeld</dt><dd>{{ stats().avg | eur: 4 }}</dd></div>
        <div><dt>Containers</dt><dd>{{ entries().length | num }}</dd></div>
      </dl>
      <ol class="pch__list">
        @for (entry of entries(); track entry.id; let first = $first) {
          <li [class.pch__row--now]="first">
            <span class="pch__when"><b>{{ entry.appliedAt | dateNl }}</b>@if (first) { <em>nu</em> }</span>
            <span class="pch__what">
              @if (entry.purchaseOrderId) {
                <a [routerLink]="['/purchasing', entry.purchaseOrderId]"><b>{{ entry.source || 'Container' }}</b> ›</a>
              } @else {
                <b>{{ entry.source || 'Handmatig' }}</b>
              }
              <small>@if (entry.quantity) { {{ entry.quantity | num }} st }@if (entry.exwPrice && entry.exwCurrency) { · EXW {{ entry.exwPrice | cur: $any(entry.exwCurrency) }} }@if (entry.appliedBy && entry.appliedBy !== 'system') { · {{ entry.appliedBy }} }</small>
            </span>
            <span class="pch__cost">
              <b>{{ entry.landedUnitEur | eur: 4 }}</b>
              @if (entry.deltaEur !== null) {
                <i class="pch__chip" [class.is-up]="entry.deltaEur > 0" [class.is-down]="entry.deltaEur < 0">{{ entry.deltaEur > 0 ? '▲' : '▼' }} {{ absPct(entry.deltaPct) }}</i>
              } @else { <i class="pch__chip">eerste</i> }
            </span>
          </li>
        }
      </ol>
    }
  `,
  styles: `
    :host { display: block; }
    .pch__state { margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.5; }
    .pch__state--err { color: var(--danger); }
    .pch__empty { padding: 14px; border: 1px dashed var(--line-strong); border-radius: 12px; }
    .pch__empty b { display: block; font-size: 13px; }
    .pch__empty p { margin: 4px 0 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
    .pch__head { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; margin-bottom: 12px; }
    .pch__now, .pch__delta { display: grid; gap: 2px; padding: 12px 14px; border-radius: 14px; }
    .pch__now { background: #272220; color: #fff; }
    .pch__now small { color: rgb(255 255 255 / 62%); font-size: 9.5px; font-weight: 780; letter-spacing: .08em; text-transform: uppercase; }
    .pch__now strong { font-size: 22px; letter-spacing: -.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .pch__now span { color: rgb(255 255 255 / 62%); font-size: 11px; }
    .pch__delta { border: 1px solid var(--line); background: var(--surface-2); }
    .pch__delta b { font-size: 20px; letter-spacing: -.02em; line-height: 1.1; }
    .pch__delta span { color: var(--muted); font-size: 11px; line-height: 1.35; }
    .pch__delta.is-up b { color: var(--danger); }
    .pch__delta.is-down b { color: var(--ok); }
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
    .pch__what { display: grid; min-width: 0; }
    .pch__what a { color: inherit; text-decoration: none; }
    .pch__what a:hover b { text-decoration: underline; }
    .pch__what b { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
    .pch__what small { color: var(--muted); font-size: 11px; }
    .pch__cost { display: grid; justify-items: end; gap: 3px; }
    .pch__cost b { font-size: 14px; font-variant-numeric: tabular-nums; }
    .pch__chip { display: inline-block; padding: 1px 7px; border-radius: 999px; background: var(--surface-2); color: var(--muted); font-size: 10.5px; font-style: normal; font-weight: 750; white-space: nowrap; }
    .pch__chip.is-up { background: color-mix(in srgb, var(--danger) 12%, var(--surface)); color: var(--danger); }
    .pch__chip.is-down { background: var(--ok-soft); color: var(--ok); }
    @media (max-width: 480px) {
      .pch__head { grid-template-columns: 1fr; }
      .pch__sums { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .pch__list li { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'when cost' 'what cost'; }
      .pch__when { grid-area: when; }
      .pch__what { grid-area: what; }
      .pch__cost { grid-area: cost; }
    }
  `,
})
export class ProductCostHistory {
  private readonly catalog = inject(CatalogApi);

  readonly productId = input.required<number>();

  readonly entries = signal<ProductCostHistoryEntry[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly latest = computed(() => this.entries()[0]);
  readonly stats = computed(() => {
    const values = this.entries().map((entry) => entry.landedUnitEur);
    if (!values.length) return { min: 0, max: 0, avg: 0 };
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      avg: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10000) / 10000,
    };
  });
  /** Oldest container first, one point each, so the line reads left to right like time. */
  readonly series = computed<TrendSeries[]>(() => {
    const ordered = [...this.entries()].reverse();
    return [{ label: 'Kostprijs per stuk', dates: ordered.map((entry) => entry.appliedAt.slice(0, 10)), values: ordered.map((entry) => entry.landedUnitEur), tone: 'accent' }];
  });

  private readonly loader = effect(() => {
    const id = this.productId();
    this.loading.set(true);
    this.error.set(null);
    this.catalog.productCostHistory(id)
      .then((rows) => this.entries.set(rows))
      .catch((failure: unknown) => this.error.set(messageOf(failure, 'Historiek laden mislukt')))
      .finally(() => this.loading.set(false));
  });

  absPct(pct: number | null): string {
    if (pct === null) return '';
    return `${Math.abs(pct).toLocaleString('nl-BE', { maximumFractionDigits: 1 })} %`;
  }
}
