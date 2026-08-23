import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { AuthImage } from '../../core/api/auth-image';
import { Product, StockLevel, StockLocation } from '../../core/api/models';
import { messageOf } from '../../core/api/errors';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { NumPipe } from '../../shared/pipes';
import { Sheet, Ui } from '../../shared/ui';

interface StockRow {
  product: Product;
  byLocation: Map<number, number>;
  total: number;
}

/**
 * Stock across locations: what lies where, moving it, and counting it.
 *
 * Built for the two moments that matter: loading the van for a stand
 * (Verplaatsen) and standing at that stand with a phone, counting
 * (Telling). Everything lands in the stock book with one reference.
 */
@Component({
  selector: 'app-stock-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, AuthImage, PageHeader, Skeleton, NumPipe, Sheet],
  template: `
    <app-page-header title="Voorraad" [subtitle]="subtitle()">
      @if (!counting()) {
        <button class="btn btn--sm" type="button" [disabled]="loading()" (click)="startCount()">Telling</button>
      }
    </app-page-header>

    <div class="content">
      <!-- Which location you are looking at; "Alle" shows the columns side by side. -->
      <div class="location-tabs" role="tablist" aria-label="Locatie">
        <button type="button" role="tab" [class.active]="view() === null" [attr.aria-selected]="view() === null"
                [disabled]="counting()" (click)="view.set(null)">Alle</button>
        @for (location of activeLocations(); track location.id) {
          <button type="button" role="tab" [class.active]="view() === location.id"
                  [attr.aria-selected]="view() === location.id" [disabled]="counting()"
                  (click)="view.set(location.id)">{{ location.name }}</button>
        }
        <a class="location-tabs__manage" routerLink="/stock-locations">Locaties beheren ›</a>
      </div>

      @if (counting(); as count) {
        <div class="count-bar" role="status">
          <div>
            <b>Telling · {{ locationName(count.locationId) }}</b>
            <small>Vul het getelde aantal in; leeg = ongewijzigd. {{ changedCounts().length }} verschil(len).</small>
          </div>
          <button class="btn btn--sm" type="button" (click)="counting.set(null)">Annuleren</button>
          <button class="btn btn--primary btn--sm" type="button" [disabled]="saving() || !changedCounts().length"
                  (click)="confirmCount()">{{ saving() ? 'Bezig…' : 'Telling bevestigen' }}</button>
        </div>
      }

      <div class="catalog-search mt-12">
        <input class="input" type="search" placeholder="Zoek naam, SKU of kleur…"
               [ngModel]="query()" (ngModelChange)="query.set($event)" />
      </div>

      <div class="card mt-12">
        <div class="stock-table" [class.stock-table--single]="view() !== null">
          <div class="stock-table__head">
            <span>Product</span>
            @if (view() === null) {
              @for (location of activeLocations(); track location.id) {
                <span class="num">{{ location.name }}</span>
              }
              <span class="num">Totaal</span>
            } @else {
              <span class="num">{{ locationName(view()!) }}</span>
              @if (counting()) { <span class="num">Geteld</span> }
            }
          </div>
          @for (row of filtered(); track row.product.id) {
            <div class="stock-table__row" [class.stock-table__row--changed]="isChanged(row.product.id!)">
              <a class="stock-table__product" [routerLink]="['/products', row.product.id]">
                @if (row.product.photos.length) {
                  <img class="thumb thumb--sm" [appAuthSrc]="row.product.photos[0].url" alt="" />
                } @else {
                  <span class="thumb thumb--sm thumb--placeholder">◈</span>
                }
                <span class="stock-table__name">
                  <b>{{ row.product.name }}</b>
                  <small>{{ row.product.sku }}@if (row.product.colour) { · {{ row.product.colour }}}@if (row.product.variantSize) { · {{ row.product.variantSize }}}</small>
                </span>
              </a>
              @if (view() === null) {
                @for (location of activeLocations(); track location.id) {
                  <span class="num stock-table__qty" [class.muted]="!row.byLocation.get(location.id!)">
                    {{ (row.byLocation.get(location.id!) ?? 0) | num }}
                  </span>
                }
                <span class="num stock-table__qty stock-table__qty--total">{{ row.total | num }}</span>
              } @else {
                <span class="num stock-table__qty" [class.muted]="!row.byLocation.get(view()!)">
                  {{ (row.byLocation.get(view()!) ?? 0) | num }}
                </span>
                @if (counting()) {
                  <span class="stock-table__count">
                    <input class="input num right" type="number" min="0" step="1" inputmode="numeric"
                           [attr.aria-label]="'Geteld: ' + row.product.name"
                           [ngModel]="countDraft().get(row.product.id!) ?? null"
                           (ngModelChange)="setCount(row.product.id!, $event)" />
                  </span>
                }
              }
              @if (!counting()) {
                <button class="stock-table__move" type="button" title="Verplaatsen" aria-label="Verplaatsen"
                        (click)="openTransfer(row)">⇄</button>
              }
            </div>
          } @empty {
            @if (loading()) { <app-skeleton kind="list" [rows]="6" /> }
            @else { <div class="empty"><div class="empty__title">Geen producten gevonden</div></div> }
          }
        </div>
      </div>
    </div>

    @if (transfer(); as move) {
      <app-sheet [title]="'Verplaatsen · ' + move.row.product.name" (closed)="transfer.set(null)">
        <div body><div class="form-grid">
          <div class="field"><label for="t-from">Van</label>
            <select class="select" id="t-from" [ngModel]="move.fromId" (ngModelChange)="patchTransfer({ fromId: +$event })">
              @for (location of activeLocations(); track location.id) {
                <option [value]="location.id">{{ location.name }} ({{ (move.row.byLocation.get(location.id!) ?? 0) | num }})</option>
              }
            </select></div>
          <div class="field"><label for="t-to">Naar</label>
            <select class="select" id="t-to" [ngModel]="move.toId" (ngModelChange)="patchTransfer({ toId: +$event })">
              @for (location of activeLocations(); track location.id) {
                <option [value]="location.id">{{ location.name }}</option>
              }
            </select></div>
          <div class="field"><label class="req" for="t-qty">Aantal</label>
            <input class="input num right" id="t-qty" type="number" min="1" step="1" inputmode="numeric"
                   [ngModel]="move.quantity" (ngModelChange)="patchTransfer({ quantity: +$event })" /></div>
          <div class="field"><label for="t-note">Notitie <span class="opt"></span></label>
            <input class="input" id="t-note" placeholder="bijv. bus van maandag" [ngModel]="move.note"
                   (ngModelChange)="patchTransfer({ note: $event })" /></div>
        </div>
        <span class="hint">Op {{ locationName(move.fromId) }} liggen {{ (move.row.byLocation.get(move.fromId) ?? 0) | num }} stuks.</span>
        </div>
        <div foot style="display:contents">
          <span class="spacer"></span>
          <button class="btn" type="button" (click)="transfer.set(null)">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="saving()" (click)="confirmTransfer()">
            {{ saving() ? 'Bezig…' : 'Verplaatsen' }}
          </button>
        </div>
      </app-sheet>
    }
  `,
  styles: `
    .location-tabs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .location-tabs button { min-height: 34px; padding: 0 12px; border: 1px solid var(--line); border-radius: 999px;
      background: var(--surface); color: var(--ink-2); font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; }
    .location-tabs button.active { border-color: var(--rose-line); background: var(--rose-soft); color: var(--rose-dark); }
    .location-tabs button:disabled { opacity: .5; cursor: default; }
    .location-tabs__manage { margin-left: auto; color: var(--muted); font-size: 12px; text-decoration: none; }
    .count-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 12px; padding: 10px 12px;
      border: 1px solid var(--rose-line); border-radius: var(--r-sm); background: var(--rose-soft); }
    .count-bar > div { flex: 1 1 200px; min-width: 0; }
    .count-bar small { display: block; color: var(--muted); font-size: 11.5px; }
    .stock-table { display: grid; }
    .stock-table__head, .stock-table__row { display: grid; grid-template-columns: minmax(0, 1fr) repeat(var(--cols, 2), minmax(72px, auto)) 34px;
      align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--line); }
    .stock-table__head { color: var(--muted); font-size: 10px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
    .stock-table__row:last-child { border-bottom: 0; }
    .stock-table__row--changed { background: var(--warn-soft); }
    .stock-table__product { display: flex; align-items: center; gap: 10px; min-width: 0; color: inherit; text-decoration: none; }
    .stock-table__name { display: grid; min-width: 0; }
    .stock-table__name b { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
    .stock-table__name small { overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    .thumb--sm { width: 34px; height: 34px; }
    .stock-table__qty { text-align: right; font-weight: 650; font-size: 13px; }
    .stock-table__qty--total { font-weight: 800; }
    .stock-table__count .input { width: 84px; min-height: 36px; padding: 4px 8px; }
    .stock-table__move { width: 30px; height: 30px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface);
      color: var(--muted); font-size: 15px; cursor: pointer; }
    .stock-table__move:hover { color: var(--ink); background: var(--surface-2); }
    @media (max-width: 600px) {
      .stock-table:not(.stock-table--single) .stock-table__head, .stock-table:not(.stock-table--single) .stock-table__row {
        grid-template-columns: minmax(0, 1fr) repeat(var(--cols, 2), minmax(56px, auto)) 30px; gap: 6px; padding: 8px 10px; }
      .stock-table__qty { font-size: 12px; }
    }
  `,
})
export class StockPage {
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly products = signal<Product[]>([]);
  readonly locations = signal<StockLocation[]>([]);
  readonly levels = signal<StockLevel[]>([]);
  readonly query = signal('');
  /** null = every location side by side. */
  readonly view = signal<number | null>(null);

  readonly activeLocations = computed(() => this.locations().filter((location) => location.active));

  readonly rows = computed<StockRow[]>(() => {
    const byProduct = new Map<number, Map<number, number>>();
    for (const level of this.levels()) {
      const map = byProduct.get(level.productId) ?? new Map<number, number>();
      map.set(level.locationId, level.quantity);
      byProduct.set(level.productId, map);
    }
    return this.products()
      .filter((product) => product.active)
      .map((product) => {
        const byLocation = byProduct.get(product.id!) ?? new Map<number, number>();
        let total = 0;
        for (const quantity of byLocation.values()) total += quantity;
        return { product, byLocation, total };
      })
      .sort((a, b) => a.product.name.localeCompare(b.product.name, 'nl', { numeric: true, sensitivity: 'base' }));
  });

  readonly filtered = computed(() => {
    const needle = this.query().trim().toLowerCase();
    if (!needle) return this.rows();
    return this.rows().filter(({ product }) =>
      [product.name, product.sku, product.colour, product.variantSize].join(' ').toLowerCase().includes(needle));
  });

  readonly subtitle = computed(() => {
    const total = this.rows().reduce((sum, row) => sum + row.total, 0);
    return `${total.toLocaleString('nl-BE')} stuks op ${this.activeLocations().length} locatie${this.activeLocations().length === 1 ? '' : 's'}`;
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const [products, locations, levels] = await Promise.all([
        this.catalog.products(), this.catalog.stockLocations(), this.catalog.stockLevels(),
      ]);
      this.products.set(products);
      this.locations.set(locations);
      this.levels.set(levels);
      document.documentElement.style.setProperty('--cols', String(Math.max(1, locations.filter((location) => location.active).length + 1)));
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Voorraad laden mislukt'), 'err');
    } finally {
      this.loading.set(false);
    }
  }

  locationName(id: number): string {
    return this.locations().find((location) => location.id === id)?.name ?? '';
  }

  /* ---- transfer ---- */
  readonly transfer = signal<{ row: StockRow; fromId: number; toId: number; quantity: number; note: string } | null>(null);

  openTransfer(row: StockRow): void {
    const locations = this.activeLocations();
    if (locations.length < 2) {
      this.ui.toast('Maak eerst een tweede locatie aan onder Voorraadlocaties', 'err');
      return;
    }
    const fromId = this.view() ?? locations[0].id!;
    const toId = locations.find((location) => location.id !== fromId)!.id!;
    this.transfer.set({ row, fromId, toId, quantity: 0, note: '' });
  }

  patchTransfer(changes: Partial<{ fromId: number; toId: number; quantity: number; note: string }>): void {
    this.transfer.update((move) => move ? { ...move, ...changes } : move);
  }

  async confirmTransfer(): Promise<void> {
    const move = this.transfer();
    if (!move) return;
    if (move.quantity <= 0) { this.ui.toast('Geef een aantal op', 'err'); return; }
    if (move.fromId === move.toId) { this.ui.toast('Kies twee verschillende locaties', 'err'); return; }
    this.saving.set(true);
    try {
      await this.catalog.transferStock(move.row.product.id!, move.fromId, move.toId, move.quantity, move.note || null);
      this.levels.set(await this.catalog.stockLevels());
      this.transfer.set(null);
      this.ui.toast(`${move.quantity} × ${move.row.product.name} naar ${this.locationName(move.toId)}`, 'ok');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Verplaatsen mislukt'), 'err');
    } finally {
      this.saving.set(false);
    }
  }

  /* ---- stocktake ---- */
  readonly counting = signal<{ locationId: number } | null>(null);
  readonly countDraft = signal(new Map<number, number | null>());

  startCount(): void {
    const locationId = this.view() ?? this.activeLocations()[0]?.id ?? null;
    if (locationId === null) return;
    this.view.set(locationId);
    this.countDraft.set(new Map());
    this.counting.set({ locationId });
  }

  setCount(productId: number, value: unknown): void {
    const quantity = value === '' || value === null || value === undefined ? null : Number(value);
    this.countDraft.update((draft) => new Map(draft).set(productId, quantity));
  }

  isChanged(productId: number): boolean {
    const count = this.counting();
    if (!count) return false;
    const counted = this.countDraft().get(productId);
    if (counted === null || counted === undefined) return false;
    const current = this.rows().find((row) => row.product.id === productId)?.byLocation.get(count.locationId) ?? 0;
    return counted !== current;
  }

  readonly changedCounts = computed(() => {
    const count = this.counting();
    if (!count) return [];
    const result: { productId: number; quantity: number }[] = [];
    for (const [productId, quantity] of this.countDraft()) {
      if (quantity === null || quantity === undefined || quantity < 0) continue;
      const current = this.rows().find((row) => row.product.id === productId)?.byLocation.get(count.locationId) ?? 0;
      if (quantity !== current) result.push({ productId, quantity });
    }
    return result;
  });

  async confirmCount(): Promise<void> {
    const count = this.counting();
    const counts = this.changedCounts();
    if (!count || !counts.length) return;
    this.saving.set(true);
    try {
      /* The kind already says "Telling"; the reference says where and when. */
      const today = new Date().toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      await this.catalog.stocktake(count.locationId, `${this.locationName(count.locationId)} ${today}`, counts);
      this.levels.set(await this.catalog.stockLevels());
      this.counting.set(null);
      this.ui.toast(`Telling geboekt: ${counts.length} product(en) aangepast`, 'ok');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Telling boeken mislukt'), 'err');
    } finally {
      this.saving.set(false);
    }
  }
}
