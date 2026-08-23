import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { AuthImage } from '../../core/api/auth-image';
import { Category, ExpectedStock, Product, StockLevel, StockLocation, StockMovement } from '../../core/api/models';
import { messageOf } from '../../core/api/errors';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { DateNlPipe, DateTimeNlPipe, NumPipe } from '../../shared/pipes';
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
  imports: [FormsModule, RouterLink, AuthImage, PageHeader, Skeleton, NumPipe, DateNlPipe, DateTimeNlPipe, Sheet],
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

      <div class="stock-tools mt-12">
        <div class="catalog-search">
          <input class="input" type="search" placeholder="Zoek naam, SKU of kleur…"
                 [ngModel]="query()" (ngModelChange)="query.set($event)" />
        </div>
        <select class="select stock-tools__sort" aria-label="Sorteren"
                [ngModel]="sortKey()" (ngModelChange)="sortKey.set($event)">
          <option value="NAME_ASC">Naam A–Z</option>
          <option value="NAME_DESC">Naam Z–A</option>
          <option value="STOCK_DESC">Voorraad hoog → laag</option>
          <option value="STOCK_ASC">Voorraad laag → hoog</option>
          <option value="EXPECTED">Te verwachten eerst</option>
        </select>
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
          @for (section of sections(); track section.key) {
            @if (section.name !== null) {
              <!-- The category heading folds its rows away; the eye finds
                   "Glas" faster than it reads twenty names. -->
              <button class="stock-table__section" type="button" [attr.aria-expanded]="!collapsed().has(section.key)"
                      (click)="toggleSection(section.key)">
                <i class="stock-table__chev" [class.stock-table__chev--closed]="collapsed().has(section.key)" aria-hidden="true"></i>
                <span>{{ section.name }}</span>
                <small>{{ section.rows.length }}</small>
                <span class="num stock-table__section-total">{{ section.total | num }}</span>
              </button>
            }
            @if (!collapsed().has(section.key)) {
            @for (row of section.rows; track row.product.id) {
            <div class="stock-table__row" [class.stock-table__row--changed]="isChanged(row.product.id!)">
              <!-- The name opens the stock book; the page itself is one more tap away from there. -->
              <button class="stock-table__product" type="button" (click)="openHistory(row)">
                @if (row.product.photos.length) {
                  <img class="thumb thumb--sm" [appAuthSrc]="row.product.photos[0].url" alt="" />
                } @else {
                  <span class="thumb thumb--sm thumb--placeholder">◈</span>
                }
                <span class="stock-table__name">
                  <b>{{ row.product.name }}</b>
                  <small>{{ row.product.sku }}@if (row.product.colour) { · {{ row.product.colour }}}@if (row.product.variantSize) { · {{ row.product.variantSize }}}@if (expectedFor(row.product.id!); as exp) { · <em class="expected">+{{ exp.quantity | num }} te verwachten{{ exp.expectedArrival ? ' · ' + (exp.expectedArrival | dateNl) : '' }}</em>}</small>
                </span>
              </button>
              <!-- Every figure is a field: type the real count and leave it,
                   and it is booked at that location as a manual correction. -->
              @if (view() === null) {
                @for (location of activeLocations(); track location.id) {
                  <input class="stock-table__qty stock-table__qty--edit num" type="number" min="0" step="1"
                         inputmode="numeric" [class.muted]="!row.byLocation.get(location.id!)"
                         [attr.aria-label]="row.product.name + ' op ' + location.name"
                         [value]="row.byLocation.get(location.id!) ?? 0"
                         (keydown.enter)="$any($event.target).blur()"
                         (keydown.escape)="$any($event.target).value = row.byLocation.get(location.id!) ?? 0; $any($event.target).blur()"
                         (change)="setQuantity(row, location.id!, $any($event.target))" />
                }
                <span class="num stock-table__qty stock-table__qty--total">{{ row.total | num }}</span>
              } @else {
                <input class="stock-table__qty stock-table__qty--edit num" type="number" min="0" step="1"
                       inputmode="numeric" [class.muted]="!row.byLocation.get(view()!)"
                       [attr.aria-label]="row.product.name + ' op ' + locationName(view()!)"
                       [value]="row.byLocation.get(view()!) ?? 0"
                       (keydown.enter)="$any($event.target).blur()"
                       (keydown.escape)="$any($event.target).value = row.byLocation.get(view()!) ?? 0; $any($event.target).blur()"
                       (change)="setQuantity(row, view()!, $any($event.target))" />
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
            }
            }
          } @empty {
            @if (loading()) { <app-skeleton kind="list" [rows]="6" /> }
            @else { <div class="empty"><div class="empty__title">Geen producten gevonden</div></div> }
          }
        </div>
      </div>
    </div>

    @if (history(); as book) {
      <app-sheet [title]="book.row.product.name" (closed)="history.set(null)">
        <div body>
          <p class="hint">{{ book.row.product.sku }} · {{ book.row.total | num }} stuks op {{ activeLocations().length }} locatie{{ activeLocations().length === 1 ? '' : 's' }}</p>
          <div class="history-levels">
            @for (location of activeLocations(); track location.id) {
              <span><small>{{ location.name }}</small><b class="num">{{ (book.row.byLocation.get(location.id!) ?? 0) | num }}</b></span>
            }
            @if (expectedFor(book.row.product.id!); as exp) {
              <span><small>Te verwachten</small><b class="num expected">+{{ exp.quantity | num }}</b></span>
            }
          </div>
          <h3 class="history-title">Geschiedenis</h3>
          @if (book.moves; as moves) {
            @if (moves.length) {
              <ol class="history-list">
                @for (move of moves; track move.id) {
                  <li>
                    <span class="history-delta num" [class.history-delta--minus]="move.delta < 0">{{ move.delta > 0 ? '+' : '' }}{{ move.delta | num }}</span>
                    <span class="history-what">
                      <b>{{ move.kindLabel }}@if (move.reference) { · {{ move.reference }}}</b>
                      <small>{{ move.at | dateTimeNl }} · {{ move.actor }}@if (move.locationName) { · {{ move.locationName }}}</small>
                    </span>
                    <span class="history-after num">= {{ move.quantityAfter | num }}</span>
                  </li>
                }
              </ol>
            } @else { <p class="hint">Nog geen bewegingen geboekt.</p> }
          } @else { <p class="hint">Geschiedenis laden…</p> }
        </div>
        <div foot style="display:contents">
          <a class="btn" [routerLink]="['/products', book.row.product.id]" (click)="history.set(null)">Product openen</a>
          <button class="btn btn--primary" type="button" (click)="history.set(null); openTransfer(book.row)">Verplaatsen</button>
        </div>
      </app-sheet>
    }

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
    /* Fixed figure columns: head and rows are separate grids, and auto-sized
       columns drifted apart - the heading sat above nothing in particular. */
    .stock-table__head, .stock-table__row { display: grid; grid-template-columns: minmax(0, 1fr) repeat(var(--cols, 2), 96px) 34px;
      align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--line); }
    .stock-table__head { color: var(--muted); font-size: 10px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
    /* The heading sits exactly above the figure: same right padding as the field. */
    .stock-table__head .num { text-align: right; padding-right: 6px; }
    .stock-tools { display: flex; gap: 9px; align-items: center; }
    .stock-tools .catalog-search { flex: 1; min-width: 0; }
    .stock-tools__sort { width: auto; min-height: 42px; font-size: 13px; font-weight: 650; }
    .stock-table__section { display: flex; align-items: baseline; gap: 8px; width: 100%; padding: 9px 12px;
      border: 0; border-bottom: 1px solid var(--line); background: var(--surface-2); color: var(--ink-2);
      font: inherit; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; text-align: left; cursor: pointer; }
    .stock-table__section small { color: var(--muted); font-size: 10.5px; font-weight: 650; letter-spacing: 0; }
    .stock-table__section-total { margin-left: auto; letter-spacing: 0; font-size: 12px; }
    .stock-table__chev { width: 7px; height: 7px; align-self: center; border-right: 1.6px solid currentColor; border-bottom: 1.6px solid currentColor;
      transform: rotate(45deg); transition: transform .15s ease; opacity: .7; }
    .stock-table__chev--closed { transform: rotate(-45deg); }
    .expected { color: var(--warn); font-style: normal; font-weight: 650; }
    .history-levels { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 4px; }
    .history-levels span { display: grid; padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-2); }
    .history-levels small { color: var(--muted); font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
    .history-levels b { font-size: 16px; }
    .history-title { margin: 14px 0 4px; color: var(--muted); font-size: 11px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
    .history-list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
    .history-list li { display: grid; grid-template-columns: 56px 1fr auto; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); }
    .history-delta { font-weight: 750; color: var(--ok, #2e7d4f); }
    .history-delta--minus { color: var(--danger); }
    .history-what { display: grid; min-width: 0; }
    .history-what b { font-weight: 650; font-size: 12.5px; }
    .history-what small { color: var(--muted); font-size: 11px; }
    .history-after { color: var(--muted); font-size: 12px; white-space: nowrap; }
    .stock-table__row:last-child { border-bottom: 0; }
    .stock-table__row--changed { background: var(--warn-soft); }
    .stock-table__product { display: flex; align-items: center; gap: 10px; min-width: 0; color: inherit; text-decoration: none; }
    .stock-table__name { display: grid; min-width: 0; }
    .stock-table__name b { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
    .stock-table__name small { overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    .thumb--sm { width: 34px; height: 34px; }
    .stock-table__qty { text-align: right; font-weight: 650; font-size: 13px; }
    /* Reads as a plain figure; shows it is a field only under the pointer or when focused. */
    .stock-table__qty--edit { width: 100%; min-width: 0; padding: 4px 6px; border: 1px solid transparent;
      border-radius: 8px; background: transparent; color: inherit; font: inherit; font-weight: 650;
      text-align: right; -moz-appearance: textfield; }
    .stock-table__qty--edit::-webkit-outer-spin-button, .stock-table__qty--edit::-webkit-inner-spin-button { display: none; }
    .stock-table__qty--edit:hover { border-color: var(--line); background: var(--surface-2); }
    .stock-table__qty--edit:focus { outline: none; border-color: var(--rose); background: var(--surface); }
    .stock-table__qty--total { font-weight: 800; }
    .stock-table__count .input { width: 84px; min-height: 36px; padding: 4px 8px; }
    .stock-table__move { width: 30px; height: 30px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface);
      color: var(--muted); font-size: 15px; cursor: pointer; }
    .stock-table__move:hover { color: var(--ink); background: var(--surface-2); }
    @media (max-width: 600px) {
      .stock-table:not(.stock-table--single) .stock-table__head, .stock-table:not(.stock-table--single) .stock-table__row {
        grid-template-columns: minmax(0, 1fr) repeat(var(--cols, 2), 64px) 30px; gap: 6px; padding: 8px 10px; }
      .stock-table__qty { font-size: 12px; }
    }
  `,
})
export class StockPage {
  private readonly catalog = inject(CatalogApi);
  private readonly sourcing = inject(SourcingApi);
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

  readonly sortKey = signal<'NAME_ASC' | 'NAME_DESC' | 'STOCK_DESC' | 'STOCK_ASC' | 'EXPECTED'>('NAME_ASC');
  readonly categories = signal<Category[]>([]);
  readonly expected = signal<Map<number, ExpectedStock>>(new Map());
  readonly collapsed = signal<Set<string>>(new Set());

  expectedFor(productId: number): ExpectedStock | null {
    return this.expected().get(productId) ?? null;
  }

  readonly filtered = computed(() => {
    const needle = this.query().trim().toLowerCase();
    const rows = !needle ? this.rows() : this.rows().filter(({ product }) =>
      [product.name, product.sku, product.colour, product.variantSize].join(' ').toLowerCase().includes(needle));
    const byName = (a: StockRow, b: StockRow) =>
      a.product.name.localeCompare(b.product.name, 'nl', { numeric: true, sensitivity: 'base' });
    switch (this.sortKey()) {
      case 'NAME_DESC': return [...rows].sort((a, b) => byName(b, a));
      case 'STOCK_DESC': return [...rows].sort((a, b) => b.total - a.total || byName(a, b));
      case 'STOCK_ASC': return [...rows].sort((a, b) => a.total - b.total || byName(a, b));
      case 'EXPECTED': return [...rows].sort((a, b) =>
        (this.expectedFor(b.product.id!)?.quantity ?? 0) - (this.expectedFor(a.product.id!)?.quantity ?? 0) || byName(a, b));
      default: return [...rows].sort(byName);
    }
  });

  /** The rows cut into category sections, in the categories' own order; a search shows one flat list. */
  readonly sections = computed<{ key: string; name: string | null; rows: StockRow[]; total: number }[]>(() => {
    const rows = this.filtered();
    if (!rows.length) return [];
    if (this.query().trim()) return [{ key: 'all', name: null, rows, total: rows.reduce((sum, row) => sum + row.total, 0) }];
    const order = new Map(this.categories().map((category, index) => [category.id, index]));
    const groups = new Map<number | null, StockRow[]>();
    for (const row of rows) {
      const id = row.product.categoryId ?? null;
      groups.set(id, [...(groups.get(id) ?? []), row]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => (a === null ? Infinity : order.get(a) ?? Infinity) - (b === null ? Infinity : order.get(b) ?? Infinity))
      .map(([id, group]) => ({
        key: id === null ? 'none' : `c${id}`,
        name: this.categories().find((category) => category.id === id)?.name ?? 'Zonder categorie',
        rows: group,
        total: group.reduce((sum, row) => sum + row.total, 0),
      }));
  });

  toggleSection(key: string): void {
    this.collapsed.update((set) => { const next = new Set(set); next.has(key) ? next.delete(key) : next.add(key); return next; });
  }

  /* ---- the stock book of one product ---- */
  readonly history = signal<{ row: StockRow; moves: StockMovement[] | null } | null>(null);

  async openHistory(row: StockRow): Promise<void> {
    this.history.set({ row, moves: null });
    try {
      const moves = await this.catalog.stockMovements(row.product.id!);
      this.history.update((book) => book && book.row === row ? { ...book, moves } : book);
    } catch {
      this.history.update((book) => book && book.row === row ? { ...book, moves: [] } : book);
    }
  }

  readonly subtitle = computed(() => {
    const total = this.rows().reduce((sum, row) => sum + row.total, 0);
    return `${total.toLocaleString('nl-BE')} stuks op ${this.activeLocations().length} locatie${this.activeLocations().length === 1 ? '' : 's'}`;
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const [products, locations, levels, categories, expected] = await Promise.all([
        this.catalog.products(), this.catalog.stockLocations(), this.catalog.stockLevels(),
        this.catalog.categories().catch(() => [] as Category[]),
        this.sourcing.expectedStock().catch(() => [] as ExpectedStock[]),
      ]);
      this.products.set(products);
      this.locations.set(locations);
      this.levels.set(levels);
      this.categories.set(categories);
      this.expected.set(new Map(expected.map((item) => [item.productId, item])));
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

  /* ---- typing a count straight into the table ---- */

  /** A figure typed in a cell is booked at once as a manual correction. */
  async setQuantity(row: StockRow, locationId: number, field: HTMLInputElement): Promise<void> {
    const before = row.byLocation.get(locationId) ?? 0;
    const quantity = Math.max(0, Math.round(Number(field.value) || 0));
    if (quantity === before) { field.value = String(before); return; }
    try {
      await this.catalog.setStock(row.product.id!, quantity, locationId, 'Voorraadoverzicht');
      this.levels.update((levels) => {
        const rest = levels.filter((level) => !(level.productId === row.product.id && level.locationId === locationId));
        return [...rest, { productId: row.product.id!, locationId, quantity }];
      });
      this.ui.toast(`${row.product.name}: ${quantity.toLocaleString('nl-BE')} op ${this.locationName(locationId)}`, 'ok');
    } catch (failure: unknown) {
      field.value = String(before);
      this.ui.toast(messageOf(failure, 'Voorraad zetten mislukt'), 'err');
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
