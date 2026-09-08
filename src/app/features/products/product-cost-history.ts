import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import { ProductCostHistoryEntry } from '../../core/api/models';
import { CurPipe, DateNlPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';

/**
 * The line of landed costs a product carried: every container that set
 * its cost, dearer or cheaper than the one before. Read-only and never
 * pruned; the desk and the phone page both show it under the cost.
 */
@Component({
  selector: 'app-product-cost-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EurPipe, NumPipe, PctPipe, DateNlPipe, CurPipe],
  template: `
    @if (loading()) {
      <p class="pch__state">Historiek laden…</p>
    } @else if (error()) {
      <p class="pch__state pch__state--err">{{ error() }}</p>
    } @else if (!entries().length) {
      <p class="pch__state">Nog geen kostprijs uit een container gezet. Zodra je bij een inkooporder de kostprijzen toepast, verschijnt die hier met datum en container.</p>
    } @else {
      <dl class="pch__sums">
        <div><dt>Nu</dt><dd>{{ entries()[0].landedUnitEur | eur: 4 }}</dd></div>
        <div><dt>Vorige</dt><dd>{{ entries()[1] ? (entries()[1].landedUnitEur | eur: 4) : '—' }}</dd></div>
        <div><dt>Laagste</dt><dd>{{ stats().min | eur: 4 }}</dd></div>
        <div><dt>Hoogste</dt><dd>{{ stats().max | eur: 4 }}</dd></div>
        <div><dt>Gemiddeld</dt><dd>{{ stats().avg | eur: 4 }}<small>{{ entries().length }} {{ entries().length === 1 ? 'container' : 'containers' }}</small></dd></div>
      </dl>
      <ol class="pch__list">
        @for (entry of entries(); track entry.id; let first = $first) {
          <li [class.pch__row--now]="first">
            <span class="pch__bar" aria-hidden="true"><i [style.width.%]="share(entry)"></i></span>
            <span class="pch__when">{{ entry.appliedAt | dateNl }}</span>
            <span class="pch__what">
              @if (entry.purchaseOrderId) {
                <a [routerLink]="['/purchasing', entry.purchaseOrderId]"><b>{{ entry.source || 'Container' }}</b></a>
              } @else {
                <b>{{ entry.source || 'Handmatig' }}</b>
              }
              <small>@if (entry.quantity) { {{ entry.quantity | num }} st }@if (entry.exwPrice && entry.exwCurrency) { · EXW {{ entry.exwPrice | cur: $any(entry.exwCurrency) }} }@if (entry.appliedBy && entry.appliedBy !== 'system') { · {{ entry.appliedBy }} }</small>
            </span>
            <span class="pch__cost"><b>{{ entry.landedUnitEur | eur: 4 }}</b>
              @if (entry.deltaEur !== null) {
                <em [class.is-up]="entry.deltaEur > 0" [class.is-down]="entry.deltaEur < 0">{{ entry.deltaEur > 0 ? '+' : '' }}{{ entry.deltaEur | eur: 2 }}@if (entry.deltaPct !== null) { · {{ entry.deltaPct > 0 ? '+' : '' }}{{ entry.deltaPct | num: 1 }} % }</em>
              } @else { <em>eerste kost</em> }
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
    .pch__sums { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 6px; margin: 0 0 12px; }
    .pch__sums > div { display: grid; gap: 2px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-2); }
    .pch__sums dt { margin: 0; color: var(--muted); font-size: 9.5px; font-weight: 780; letter-spacing: .07em; text-transform: uppercase; }
    .pch__sums dd { margin: 0; font-size: 13.5px; font-variant-numeric: tabular-nums; font-weight: 700; }
    .pch__sums dd small { display: block; color: var(--muted); font-size: 10px; font-weight: 500; }
    .pch__list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
    .pch__list li { position: relative; display: grid; grid-template-columns: 84px minmax(0, 1fr) auto; align-items: center; gap: 4px 10px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); overflow: hidden; }
    .pch__row--now { border-color: var(--rose-line); background: var(--rose-soft); }
    .pch__bar { position: absolute; left: 0; bottom: 0; width: 100%; height: 3px; background: transparent; }
    .pch__bar i { display: block; height: 100%; background: var(--rose); opacity: .45; }
    .pch__when { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
    .pch__what { display: grid; min-width: 0; }
    .pch__what a { color: inherit; text-decoration: none; }
    .pch__what a:hover b { text-decoration: underline; }
    .pch__what b { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
    .pch__what small { color: var(--muted); font-size: 11px; }
    .pch__cost { display: grid; justify-items: end; }
    .pch__cost b { font-size: 14px; font-variant-numeric: tabular-nums; }
    .pch__cost em { color: var(--muted); font-size: 11px; font-style: normal; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .pch__cost em.is-up { color: var(--danger); }
    .pch__cost em.is-down { color: var(--ok); }
    @media (max-width: 480px) {
      .pch__list li { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'when when' 'what cost'; }
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

  readonly stats = computed(() => {
    const values = this.entries().map((entry) => entry.landedUnitEur);
    if (!values.length) return { min: 0, max: 0, avg: 0 };
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      avg: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10000) / 10000,
    };
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

  /** The bar under a row: this cost against the dearest one, so the eye sees the line. */
  share(entry: ProductCostHistoryEntry): number {
    const max = this.stats().max;
    return max > 0 ? Math.round(entry.landedUnitEur / max * 100) : 0;
  }
}
