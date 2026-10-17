import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { AuthImage } from '../../core/api/auth-image';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import { Category, DiscountTier, Product, ProductFamily, Supplier } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { LOAD_ERROR_FALLBACK, LoadError } from '../../shared/load-error';
import { ProductPicker } from '../../shared/product-picker';
import { salesPhotoUrl } from '../../shared/sales-photo';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui } from '../../shared/ui';
import { productSalesUnit } from '../products/product-sales-unit';
import { lineTierChanges, percentText, percentValue, sortedTiers, tierChanges, tierProblem } from './discount-tiers';
import { SettingsEditor, dirtyStatusText } from './settings-editor';

/**
 * Kortingen (Instellingen › ?sectie=discounts): the order tiers and each
 * product's own line tiers, with one save model (the page's toolbar:
 * "n wijzigingen niet opgeslagen · Wijzigingen wissen · Opslaan", ⌘S on the
 * desk). Removing a product's tiers and "Opruimen" of the old general tiers
 * still save at once after a confirm (N8). A component of its own inside the
 * lazy settings chunk, so its styles never weigh on the first load and never
 * reach another settings view.
 */
@Component({
  selector: 'app-settings-discounts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, Icon, LoadError, ProductPicker, Sheet, Skeleton],
  host: { role: 'region', 'aria-label': 'Kortingen' },
  template: `
    @if (error(); as error) {
      <app-load-error [message]="error" [busy]="loading()" (retry)="load()" />
    } @else if (loading() && !loaded()) {
      @if (desktop.active()) {
        <div class="disc__grid"><div class="wk-card disc-card"><app-skeleton kind="table" [rows]="4" /></div><div class="wk-card disc-card"><app-skeleton kind="table" [rows]="3" /></div></div>
      } @else { <app-skeleton kind="group" [rows]="4" /><app-skeleton kind="group" [rows]="3" /> }
    } @else if (desktop.active()) {
      <div class="disc">
        <div class="disc__grid">
          <!-- Orderkorting -->
          <section class="wk-card disc-card" aria-labelledby="disc-order-title" [class.disc-card--dirty]="orderTierChanges() > 0">
            <header class="disc-card__head">
              <div><h2 id="disc-order-title">Orderkorting</h2><p>Korting op de hele order zodra alle stuks samen een grens halen.</p></div>
            </header>
            @for (tier of orderTiers(); track $index; let tierIndex = $index) {
              <div class="tier">
                <span>Vanaf</span>
                <input class="disc-input" type="number" min="1" step="50" inputmode="numeric" aria-label="Vanaf aantal"
                       [value]="tier.minQuantity" (input)="orderMinInput(tierIndex, $any($event.target).value)" (blur)="sortOrderTiers()" />
                <span>stuks</span>
                <span aria-hidden="true">→</span>
                <input class="disc-input" type="text" inputmode="decimal" aria-label="Kortingspercentage"
                       [value]="pctText(tier.percent)" (input)="orderPctInput(tierIndex, $any($event.target).value)"
                       (change)="updateOrderTier(tierIndex, { percent: pctValue($any($event.target).value) })" />
                <span>%</span>
                <button class="wk-btn wk-btn--icon wk-btn--ghost" type="button" aria-label="Drempel verwijderen" (click)="removeTier('ORDER', tierIndex)"><app-icon name="close" [size]="15" /></button>
              </div>
            } @empty {
              <p class="disc-none">Nog geen staffel.</p>
            }
            <footer class="disc-card__foot"><button class="wk-btn wk-btn--sm" type="button" (click)="addTier('ORDER')">+ Drempel</button></footer>
          </section>

          <!-- Lijnkorting per product -->
          <section class="wk-card disc-card" aria-labelledby="disc-line-title">
            <header class="disc-card__head">
              <div><h2 id="disc-line-title">Lijnkorting per product <span class="wk-pill">{{ lineDiscountGroups().length }} {{ lineDiscountGroups().length === 1 ? 'product' : 'producten' }}</span></h2>
                <p>Iedere productvariant krijgt zijn eigen staffel. De drempel telt in de eenheid waarin het product verkocht wordt (display, diamant, stuk).</p></div>
              <button class="wk-btn wk-btn--sm" type="button" [disabled]="!discountPickerProducts().length" (click)="lineDiscountPicker.set(true)">+ Product</button>
            </header>
            @if (legacyLineTiers().length) {
              <div class="wk-banner wk-banner--warn wk-banner--inset disc-legacy" role="status">
                <span class="wk-banner__text"><b>Oude algemene lijnkorting staat uit</b> · Deze {{ legacyLineTiers().length }} oude regel{{ legacyLineTiers().length === 1 ? '' : 's' }} wordt niet meer op alle producten toegepast.</span>
                <span class="wk-banner__actions"><button class="wk-btn wk-btn--sm" type="button" (click)="removeLegacyLineTiers()">Opruimen</button></span>
              </div>
            }
            @if (lineDiscountGroups().length) {
              <div class="disc-products">
                @for (group of lineDiscountGroups(); track group.productId) {
                  <article class="disc-product" [id]="'line-discount-' + group.productId" [class.disc-product--dirty]="lineChanges().has(group.productId)">
                    <header class="disc-product__head">
                      @if (discountPhotoUrl(group.product); as photo) {
                        <img class="disc-product__photo" [appAuthSrc]="photo" [alt]="group.product!.name" />
                      } @else {
                        <span class="disc-product__photo disc-product__photo--empty" aria-hidden="true">◈</span>
                      }
                      <div class="disc-product__id">
                        <h3 [attr.title]="group.product?.name || null">{{ group.product?.name || 'Verwijderd product #' + group.productId }}</h3>
                        <span>{{ variantLine(group.product) }}</span>
                        @if (group.product && supplierName(group.product); as supplier) { <small>{{ supplier }}</small> }
                      </div>
                      <button class="wk-btn wk-btn--icon wk-btn--ghost" type="button"
                              [attr.aria-label]="'Lijnkorting voor ' + (group.product?.name || group.productId) + ' verwijderen'"
                              (click)="removeLineDiscountProduct(group.productId, group.product?.name)"><app-icon name="close" [size]="15" /></button>
                    </header>
                    @for (tier of group.tiers; track tier.id ?? $index) {
                      <div class="tier tier--line">
                        <span>Vanaf</span>
                        <input class="disc-input" type="number" min="1" step="1" inputmode="numeric"
                               [attr.aria-label]="'Vanaf aantal voor ' + (group.product?.name || group.productId)"
                               [value]="tier.minQuantity" (input)="lineMinInput(tier, $any($event.target).value)" />
                        <span>{{ unitWord(group.product) }}</span>
                        <span aria-hidden="true">→</span>
                        <input class="disc-input" type="text" inputmode="decimal"
                               [attr.aria-label]="'Kortingspercentage voor ' + (group.product?.name || group.productId)"
                               [value]="pctText(tier.percent)" (input)="linePctInput(tier, $any($event.target).value)"
                               (change)="updateLineTier(tier, { percent: pctValue($any($event.target).value) })" />
                        <span>%</span>
                        <button class="wk-btn wk-btn--icon wk-btn--ghost" type="button" aria-label="Drempel verwijderen" (click)="removeLineTier(tier)"><app-icon name="close" [size]="15" /></button>
                      </div>
                    }
                    <footer class="disc-product__foot"><button class="wk-btn wk-btn--sm" type="button" (click)="addLineTier(group.productId)">+ Drempel</button></footer>
                  </article>
                }
              </div>
            } @else {
              <div class="wk-empty">
                <div class="wk-empty__icon"><app-icon name="tag" [size]="22" /></div>
                <h3 class="wk-empty__title">Nog geen productspecifieke korting</h3>
                <p class="wk-empty__text">Kies een product en geef alleen dat product een staffel.</p>
                <div class="wk-empty__actions"><button class="wk-btn wk-btn--primary" type="button" [disabled]="!discountPickerProducts().length" (click)="lineDiscountPicker.set(true)">Product kiezen</button></div>
              </div>
            }
          </section>
        </div>
      </div>
    } @else {
      <!-- Phone: inset groups; a tier opens a sheet -->
      <div class="disc-phone">
        @if (dirty()) {
          <div class="ios-banner ios-banner--info mo-fade" role="status"><span>{{ statusText() }}</span>
            <button class="disc-text-btn" type="button" (click)="revert()">Wissen</button></div>
        }
        <section class="ios-section">
          <div class="ios-section__head"><h2>Orderkorting</h2></div>
          <div class="ios-group">
            @for (tier of orderTiers(); track $index; let tierIndex = $index) {
              <button class="ios-cell" type="button" (click)="openTier('ORDER', tierIndex)">
                <span class="ios-cell__body"><span class="ios-cell__title">Vanaf {{ countText(tier.minQuantity) }} stuks</span></span>
                <span class="ios-cell__trail"><span class="ios-cell__value">{{ pctText(tier.percent) }} %</span></span>
                <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
              </button>
            }
            <button class="ios-cell ios-cell--action" type="button" (click)="addTier('ORDER'); openTier('ORDER', orderTiers().length - 1)">+ Drempel toevoegen</button>
          </div>
          <p class="ios-section__foot">Korting op de hele order zodra alle stuks samen een grens halen.</p>
        </section>
        <section class="ios-section">
          <div class="ios-section__head"><h2>Lijnkorting per product</h2><span class="ios-section__trail">{{ lineDiscountGroups().length }}</span></div>
          @if (legacyLineTiers().length) {
            <div class="ios-banner" role="status"><span>Oude algemene lijnkorting staat uit ({{ legacyLineTiers().length }})</span>
              <button class="disc-text-btn" type="button" (click)="removeLegacyLineTiers()">Opruimen</button></div>
          }
          @for (group of lineDiscountGroups(); track group.productId) {
            <div class="ios-group disc-phone__group" [class.disc-product--dirty]="lineChanges().has(group.productId)">
              <div class="ios-cell ios-cell--tall">
                <span class="ios-cell__lead">
                  @if (discountPhotoUrl(group.product); as photo) { <img class="disc-product__photo" [appAuthSrc]="photo" alt="" /> }
                  @else { <span class="disc-product__photo disc-product__photo--empty" aria-hidden="true">◈</span> }
                </span>
                <span class="ios-cell__body">
                  <span class="ios-cell__title ios-cell__title--strong ios-cell__title--2">{{ group.product?.name || 'Verwijderd product #' + group.productId }}</span>
                  <span class="ios-cell__sub ios-cell__sub--2">{{ variantLine(group.product) }}</span>
                  @if (group.product && supplierName(group.product); as supplier) { <span class="ios-cell__sub ios-cell__sub--2">{{ supplier }}</span> }
                </span>
                <button class="ios-circle disc-phone__remove" type="button" [attr.aria-label]="'Lijnkorting voor ' + (group.product?.name || group.productId) + ' verwijderen'"
                        (click)="removeLineDiscountProduct(group.productId, group.product?.name)"><app-icon name="close" [size]="16" /></button>
              </div>
              @for (tier of group.tiers; track tier.id ?? $index) {
                <button class="ios-cell" type="button" (click)="openLineTier(tier)">
                  <span class="ios-cell__body"><span class="ios-cell__title">Vanaf {{ countText(tier.minQuantity) }} {{ unitWord(group.product) }}</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value">{{ pctText(tier.percent) }} %</span></span>
                  <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                </button>
              }
              <button class="ios-cell ios-cell--action" type="button" (click)="addLineTier(group.productId)">+ Drempel</button>
            </div>
          }
          <div class="ios-group">
            <button class="ios-cell ios-cell--action" type="button" [disabled]="!discountPickerProducts().length" (click)="lineDiscountPicker.set(true)">+ Product kiezen</button>
          </div>
          <p class="ios-section__foot">Iedere productvariant krijgt zijn eigen staffel. De drempel telt in de eenheid waarin het product verkocht wordt (display, diamant, stuk).</p>
        </section>
      </div>
    }

    <!-- Overlays at host level, never inside the .disc size container (trap rule) -->
    @if (tierSheet(); as sheet) {
      <app-sheet [title]="sheet.scope === 'ORDER' ? 'Orderkorting' : 'Lijnkorting'" variant="ios" (closed)="tierSheet.set(null)">
        @if (sheetTier(); as tier) {
          <div body class="ios-group">
            <label class="disc-field"><span>Vanaf ({{ sheet.scope === 'ORDER' ? 'stuks' : sheetUnit() }})</span>
              <input type="number" min="1" step="1" inputmode="numeric" [value]="tier.minQuantity" (input)="sheetMin($any($event.target).value)" /></label>
            <label class="disc-field"><span>Korting (%)</span>
              <input type="text" inputmode="decimal" [value]="pctText(tier.percent)" (input)="sheetPct($any($event.target).value)" /></label>
          </div>
        }
        <div foot class="disc-sheet-foot">
          <button class="btn btn--danger" type="button" (click)="removeSheetTier()">Verwijderen</button>
          <button class="btn btn--primary" type="button" (click)="tierSheet.set(null)">Klaar</button>
        </div>
      </app-sheet>
    }

    @if (lineDiscountPicker()) {
      <app-product-picker
        heading="Product voor lijnkorting kiezen"
        [products]="discountPickerProducts()"
        [categories]="categories()"
        [families]="families()"
        [groupByFamily]="true"
        [preserveSourceOrder]="true"
        [selectionOnly]="true"
        [showPrice]="false"
        [stockAware]="false"
        [supplierNameOf]="discountSupplierNameOf"
        (picked)="chooseDiscountProduct($event.product)"
        (cancelled)="lineDiscountPicker.set(false)"
      />
    }
  `,
  styles: `
    :host { display: block; }
    :host([hidden]) { display: none !important; }
    .disc { container: set-disc / inline-size; }
    .disc__grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
    @container set-disc (min-width: 760px) { .disc__grid { grid-template-columns: 360px minmax(0, 1fr); } }
    .disc-card { margin: 0; padding: 0 0 8px; overflow: hidden; }
    .disc-card + .disc-card { margin-top: 0; }
    .disc-card--dirty { box-shadow: inset 3px 0 0 var(--warn), 0 1px 2px rgb(26 22 20 / 4%); }
    .disc-card__head { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px 10px; }
    .disc-card__head > div { flex: 1; min-width: 0; }
    .disc-card__head h2 { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; font-size: 15px; font-weight: 700; letter-spacing: -.01em; }
    .disc-card__head p { margin: 4px 0 0; color: var(--muted); font-size: 12.5px; line-height: 1.45; }
    .disc-card__foot, .disc-product__foot { padding: 8px 16px 4px; }
    .disc-product__foot { padding: 6px 12px 8px; }
    .disc-none { margin: 0; padding: 10px 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; }
    .disc-legacy { margin: 0 16px 12px; }
    .disc-input { width: 100%; height: 32px; padding: 0 9px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--surface);
      color: var(--ink); font: inherit; font-size: 13.5px; text-align: right; font-variant-numeric: tabular-nums; }
    .disc-input:focus { border-color: var(--rose); outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--rose) 18%, transparent); }
    .tier { display: grid; grid-template-columns: auto 92px auto 12px 60px 12px 26px; align-items: center; gap: 6px; padding: 6px 16px;
      border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; white-space: nowrap; }
    .tier--line { grid-template-columns: auto minmax(56px, 1fr) auto 12px 56px 12px 26px; gap: 5px; padding: 6px 12px; }
    .disc-products { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; padding: 0 16px 8px; }
    .disc-product { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
    .disc-product--dirty { box-shadow: inset 3px 0 0 var(--warn); }
    .disc-product__head { display: grid; grid-template-columns: 44px minmax(0, 1fr) 32px; align-items: center; gap: 10px; padding: 10px 10px 10px 12px; }
    .disc-product__photo { display: block; width: 44px; height: 44px; border-radius: 10px; object-fit: cover; background: var(--surface-2); }
    .disc-product__photo--empty { display: grid; place-items: center; color: var(--muted); }
    .disc-product__id { min-width: 0; }
    .disc-product__id h3 { display: -webkit-box; margin: 0; overflow: hidden; font-size: 13.5px; line-height: 1.3; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; }
    .disc-product__id span { display: block; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .disc-product__id small { display: block; color: var(--rose-dark); font-size: 11.5px; font-weight: 650; overflow-wrap: anywhere; }

    /* phone */
    .disc-phone { --ios-inset: 0px; }
    .disc-phone .ios-banner { margin-inline: 0; }
    .disc-text-btn { flex: none; min-height: 32px; padding: 0 4px; border: 0; background: none; color: var(--rose-dark); font: inherit; font-size: 15px; font-weight: 650; cursor: pointer; }
    .disc-phone__group { margin-bottom: 12px; }
    .disc-phone__group.disc-product--dirty { box-shadow: inset 3px 0 0 var(--warn); }
    .disc-phone__remove { width: 40px; height: 40px; color: var(--muted); }
    /* The tier sheet renders at host level (trap rule). */
    .disc-field { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 6px 16px; background: var(--surface); }
    .disc-field > span { flex: 0 0 50%; color: var(--ink); font-size: 16px; }
    .disc-field > input { flex: 1; min-width: 0; height: 40px; border: 0; background: transparent; color: var(--ink); font: inherit;
      font-size: 16px; text-align: right; outline: none; font-variant-numeric: tabular-nums; }
    .disc-sheet-foot { display: flex; justify-content: space-between; gap: 8px; width: 100%; }
    .disc-sheet-foot .btn { min-height: 44px; }
  `,
})
export class SettingsDiscounts implements SettingsEditor {
  readonly desktop = inject(DesktopViewport);
  private readonly catalog = inject(CatalogApi);
  private readonly sales = inject(SalesApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);
  private readonly document = inject(DOCUMENT);
  private destroyed = false;

  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);

  readonly categories = signal<Category[]>([]);
  readonly products = signal<Product[]>([]);
  readonly families = signal<ProductFamily[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  private readonly lineTiers = signal<DiscountTier[]>([]);
  readonly orderTiers = signal<DiscountTier[]>([]);
  readonly lineDiscountPicker = signal(false);
  readonly savingLineProductId = signal<number | null>(null);
  readonly legacyLineTiers = computed(() =>
    this.lineTiers().filter((tier) => tier.productId == null));
  readonly lineDiscountGroups = computed(() => {
    const products = new Map(this.products().flatMap((product) =>
      product.id == null ? [] : [[product.id, product] as const]));
    const groups = new Map<number, DiscountTier[]>();
    for (const tier of this.lineTiers()) {
      if (tier.productId == null) continue;
      const current = groups.get(tier.productId) ?? [];
      current.push(tier);
      groups.set(tier.productId, current);
    }
    const productRank = new Map(this.products().flatMap((product, index) =>
      product.id == null ? [] : [[product.id, index] as const]));
    return [...groups.entries()]
      .map(([productId, tiers]) => ({
        productId,
        product: products.get(productId) ?? null,
        tiers: [...tiers].sort((left, right) => left.minQuantity - right.minQuantity),
      }))
      .sort((left, right) =>
        (productRank.get(left.productId) ?? Number.MAX_SAFE_INTEGER)
        - (productRank.get(right.productId) ?? Number.MAX_SAFE_INTEGER));
  });
  readonly discountPickerProducts = computed(() => {
    const configured = new Set(this.lineDiscountGroups().map((group) => group.productId));
    return this.products().filter((product) =>
      product.id != null && product.active && !product.demo && !configured.has(product.id));
  });
  readonly discountSupplierNameOf = (product: Product): string | null =>
    this.supplierName(product);
  /** The product's Hoofdfoto, the same photo quotes and invoices print. */
  discountPhotoUrl(product: Product | null): string | null {
    return product?.photos?.length ? salesPhotoUrl(product) : null;
  }

  constructor() {
    void this.load();
    inject(DestroyRef).onDestroy(() => { this.destroyed = true; });
  }

  /** The tiers, plus what the product picker and the product cards need. */
  async load(): Promise<void> {
    void this.catalog.unitNames().catch(() => undefined);
    this.loading.set(true);
    this.error.set(null);
    try {
      const [line, order, categories, products, families, suppliers] = await Promise.all([
        this.sales.tiers('LINE'), this.sales.tiers('ORDER'),
        this.catalog.categories().catch(() => []), this.catalog.products().catch(() => []),
        this.catalog.productFamilies().catch(() => []), this.sourcing.suppliers().catch(() => []),
      ]);
      if (this.destroyed) return;
      this.lineTiers.set(line);
      this.orderTiers.set(sortedTiers(order));
      this.savedLineTiers.set(line);
      this.savedOrderTiers.set(sortedTiers(order));
      this.categories.set(categories);
      this.products.set(products);
      this.families.set(families);
      this.suppliers.set(suppliers);
      this.loaded.set(true);
    } catch (failure: unknown) {
      if (!this.destroyed) this.error.set(messageOf(failure, LOAD_ERROR_FALLBACK));
    } finally {
      this.loading.set(false);
    }
  }

  pctText(value: number | null | undefined): string {
    return percentText(value);
  }

  pctValue(raw: string): number {
    return percentValue(raw);
  }

  addTier(scope: 'LINE' | 'ORDER'): void {
    const target = scope === 'LINE' ? this.lineTiers : this.orderTiers;
    target.update((tiers) => [...tiers, {
      id: null, scope, productId: null, minQuantity: 1, percent: 0,
    }]);
  }

  removeTier(scope: 'LINE' | 'ORDER', index: number): void {
    const target = scope === 'LINE' ? this.lineTiers : this.orderTiers;
    target.update((tiers) => tiers.filter((_, i) => i !== index));
  }

  /* ------------------------------------------- one save model (SettingsEditor) */

  /** The tiers as last saved: the dirty count compares against them (bug 5). */
  private readonly savedOrderTiers = signal<DiscountTier[]>([]);
  private readonly savedLineTiers = signal<DiscountTier[]>([]);
  readonly orderTierChanges = computed(() => tierChanges(this.savedOrderTiers(), this.orderTiers()));
  readonly lineChanges = computed(() => lineTierChanges(this.savedLineTiers(), this.lineTiers()));
  readonly dirtyCount = computed(() =>
    this.orderTierChanges() + [...this.lineChanges().values()].reduce((sum, count) => sum + count, 0));
  readonly dirty = computed(() => this.dirtyCount() > 0);
  readonly statusText = computed(() => dirtyStatusText(this.dirtyCount()));
  readonly saving = signal(false);

  /** Opslaan: the order tiers when they changed, then every changed product (removals were saved at once, N8). */
  async save(): Promise<boolean> {
    if (this.saving()) return false;
    const orderDirty = this.orderTierChanges() > 0;
    const products = [...this.lineChanges().keys()];
    const lists = [this.orderTiers(), ...products.map((id) => this.lineTiers().filter((tier) => tier.productId === id))];
    const problem = lists.map((tiers) => tierProblem(tiers)).find(Boolean);
    if (problem) {
      this.ui.toast(problem, 'err');
      return false;
    }
    this.saving.set(true);
    try {
      if (orderDirty) {
        const saved = sortedTiers(await this.sales.saveTiers('ORDER', sortedTiers(this.orderTiers())));
        this.orderTiers.set(saved);
        this.savedOrderTiers.set(saved);
      }
      for (const productId of products) {
        const tiers = sortedTiers(this.lineTiers().filter((tier) => tier.productId === productId));
        const saved = await this.sales.saveProductTiers(productId, tiers);
        this.lineTiers.update((current) => [...current.filter((tier) => tier.productId !== productId), ...saved]);
        this.savedLineTiers.update((current) => [...current.filter((tier) => tier.productId !== productId), ...saved]);
      }
      this.ui.toast('Kortingen opgeslagen');
      return true;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Kortingen opslaan is niet gelukt. Controleer de verbinding en probeer opnieuw.'), 'err');
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  revert(): void {
    this.orderTiers.set(this.savedOrderTiers());
    this.lineTiers.set(this.savedLineTiers());
    this.tierSheet.set(null);
  }

  /** Typing a threshold: whole numbers only; an empty field waits. */
  orderMinInput(index: number, raw: string): void {
    const value = Number(raw);
    if (raw.trim() && Number.isFinite(value)) this.updateOrderTier(index, { minQuantity: Math.round(value) });
  }

  /** Typing a percentage the Belgian way: it lands once it ends in a digit ("6," waits for "6,5"). */
  orderPctInput(index: number, raw: string): void {
    if (/\d$/.test(raw.trim())) this.updateOrderTier(index, { percent: this.pctValue(raw) });
  }

  lineMinInput(tier: DiscountTier, raw: string): void {
    const value = Number(raw);
    if (raw.trim() && Number.isFinite(value)) this.updateLineTier(tier, { minQuantity: Math.round(value) });
  }

  linePctInput(tier: DiscountTier, raw: string): void {
    if (/\d$/.test(raw.trim())) this.updateLineTier(tier, { percent: this.pctValue(raw) });
  }

  sortOrderTiers(): void {
    this.orderTiers.update((tiers) => sortedTiers(tiers));
  }

  /** The unit the threshold counts in: "displays", "diamanten", "stuks". */
  unitWord(product: Product | null): string {
    return productSalesUnit(product).plural;
  }

  countText(value: number): string {
    return Number.isFinite(value) ? value.toLocaleString('nl-BE') : '';
  }

  /** Phone: one tier in a sheet; edits go to the draft, Opslaan in the bar saves. */
  readonly tierSheet = signal<{ scope: 'ORDER' | 'LINE'; index: number } | null>(null);
  readonly sheetTier = computed(() => {
    const sheet = this.tierSheet();
    if (!sheet) return null;
    return (sheet.scope === 'ORDER' ? this.orderTiers() : this.lineTiers())[sheet.index] ?? null;
  });
  readonly sheetUnit = computed(() => {
    const tier = this.sheetTier();
    return tier?.productId != null ? this.unitWord(this.products().find((product) => product.id === tier.productId) ?? null) : 'stuks';
  });

  openTier(scope: 'ORDER' | 'LINE', index: number): void {
    if (index >= 0) this.tierSheet.set({ scope, index });
  }

  openLineTier(tier: DiscountTier): void {
    this.openTier('LINE', this.lineTiers().indexOf(tier));
  }

  sheetMin(raw: string): void {
    const sheet = this.tierSheet();
    const value = Number(raw);
    if (!sheet || !raw.trim() || !Number.isFinite(value)) return;
    this.patchSheetTier(sheet, { minQuantity: Math.round(value) });
  }

  sheetPct(raw: string): void {
    const sheet = this.tierSheet();
    if (sheet && /\d$/.test(raw.trim())) this.patchSheetTier(sheet, { percent: this.pctValue(raw) });
  }

  private patchSheetTier(sheet: { scope: 'ORDER' | 'LINE'; index: number }, changes: Partial<DiscountTier>): void {
    if (sheet.scope === 'ORDER') this.updateOrderTier(sheet.index, changes);
    else this.lineTiers.update((tiers) => tiers.map((tier, index) => index === sheet.index ? { ...tier, ...changes } : tier));
  }

  removeSheetTier(): void {
    const sheet = this.tierSheet();
    const tier = this.sheetTier();
    this.tierSheet.set(null);
    if (!sheet || !tier) return;
    if (sheet.scope === 'ORDER') this.removeTier('ORDER', sheet.index);
    else this.removeLineTier(tier);
  }

  /** "Rood · L · ROSE-BOX-1": what tells one variant's tiers from another's, desk and phone alike. */
  variantLine(product: Product | null): string {
    return [product?.colour, product?.variantSize, product?.sku || 'Onbekende SKU'].filter(Boolean).join(' · ');
  }

  supplierName(product: Product | null): string | null {
    if (!product) return null;
    if (product.supplierId == null) return null;
    return this.suppliers().find((supplier) => supplier.id === product.supplierId)?.name ?? null;
  }

  chooseDiscountProduct(product: Product): void {
    if (product.id == null) return;
    this.lineDiscountPicker.set(false);
    if (this.lineTiers().some((tier) => tier.productId === product.id)) {
      this.scrollToLineDiscount(product.id);
      return;
    }
    this.lineTiers.update((tiers) => [...tiers, {
      id: null,
      scope: 'LINE',
      productId: product.id,
      minQuantity: Math.max(1, product.carton.piecesPerCarton ?? 1),
      percent: 0,
    }]);
    this.scrollToLineDiscount(product.id);
  }

  addLineTier(productId: number): void {
    const existing = this.lineTiers().filter((tier) => tier.productId === productId);
    const highest = existing.reduce((value, tier) => Math.max(value, tier.minQuantity), 0);
    this.lineTiers.update((tiers) => [...tiers, {
      id: null,
      scope: 'LINE',
      productId,
      minQuantity: Math.max(1, highest + 100),
      percent: 0,
    }]);
  }

  updateLineTier(tier: DiscountTier, changes: Partial<Pick<DiscountTier, 'minQuantity' | 'percent'>>): void {
    this.lineTiers.update((tiers) => tiers.map((candidate) =>
      candidate === tier ? { ...candidate, ...changes } : candidate));
  }

  removeLineTier(tier: DiscountTier): void {
    if (tier.productId != null
        && this.lineTiers().filter((candidate) => candidate.productId === tier.productId).length === 1) {
      const productName = this.products().find((product) => product.id === tier.productId)?.name;
      this.removeLineDiscountProduct(tier.productId, productName);
      return;
    }
    this.lineTiers.update((tiers) => tiers.filter((candidate) => candidate !== tier));
  }

  updateOrderTier(index: number, changes: Partial<Pick<DiscountTier, 'minQuantity' | 'percent'>>): void {
    this.orderTiers.update((tiers) => tiers.map((tier, currentIndex) =>
      currentIndex === index ? { ...tier, ...changes, productId: null } : tier));
  }

  removeLineDiscountProduct(productId: number, productName?: string | null): void {
    this.ui.confirm({
      title: 'Productkorting verwijderen',
      message: 'De automatische lijnkorting voor dit product wordt verwijderd. Andere producten blijven ongewijzigd.',
      confirmLabel: 'Verwijderen',
      danger: true,
    }, async () => {
      this.savingLineProductId.set(productId);
      try {
        await this.sales.saveProductTiers(productId, []);
        this.lineTiers.update((tiers) => tiers.filter((tier) => tier.productId !== productId));
        /* N8: this removal is saved at once; only this product's baseline moves. */
        this.savedLineTiers.update((tiers) => tiers.filter((tier) => tier.productId !== productId));
        this.ui.toast(productName ? `Korting voor ${productName} verwijderd` : 'Productkorting verwijderd');
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Productkorting verwijderen mislukt'), 'err');
      } finally {
        this.savingLineProductId.set(null);
      }
    });
  }

  removeLegacyLineTiers(): void {
    this.ui.confirm({
      title: 'Oude algemene lijnkorting opruimen',
      message: 'Alleen de oude niet-productspecifieke regels worden verwijderd. Productspecifieke staffels blijven staan.',
      confirmLabel: 'Opruimen',
      danger: false,
    }, async () => {
      try {
        /* Only the saved product tiers go along: unsaved edits of other products stay a draft (N8). */
        const valid = this.savedLineTiers().filter((tier) => tier.productId != null);
        const saved = await this.sales.saveTiers('LINE', valid);
        this.savedLineTiers.set(saved);
        this.lineTiers.update((tiers) => tiers.filter((tier) => tier.productId != null));
        this.ui.toast('Oude algemene lijnkorting opgeruimd');
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Oude lijnkorting opruimen mislukt'), 'err');
      }
    });
  }

  private scrollToLineDiscount(productId: number): void {
    this.document.defaultView?.setTimeout(() => {
      this.document.getElementById(`line-discount-${productId}`)?.scrollIntoView({
        behavior: 'smooth', block: 'center',
      });
    });
  }
}
