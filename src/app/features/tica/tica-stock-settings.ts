import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { Product, StockLocation } from '../../core/api/models';
import { productSalesUnit } from '../products/product-sales-unit';
import { TicaApi, TicaStockSettings as Settings, TicaStockSettingsWrite } from '../../core/api/tica-api';
import { messageOf } from '../../core/api/errors';
import { Icon } from '../../shared/icon';
import { Sheet, Ui, confirmLeave } from '../../shared/ui';
import { ticaDate } from './tica-format';
import { ticaStockSettingsError } from './tica-stock-rules';

const writeOf = (settings: Settings): TicaStockSettingsWrite => ({
  enabled: settings.enabled, fromDate: settings.fromDate,
  locations: settings.locations.map(row => ({ sourceLocation: row.sourceLocation, stockLocationId: row.stockLocationId })),
  productUnits: settings.productUnits.map(row => ({ productId: row.productId, sourceUnit: row.sourceUnit ?? (row.productSalesUnit === 'PIECE' ? 'PIECE' : null) })),
});

@Component({
  selector: 'app-tica-stock-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon, Sheet],
  templateUrl: './tica-stock-settings.html',
  styleUrl: './tica-stock-settings.scss',
})
export class TicaStockSettings {
  private readonly api = inject(TicaApi);
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  private readonly destroy = inject(DestroyRef);
  readonly changed = output<void>();
  readonly settings = signal<Settings | null>(null);
  readonly locations = signal<StockLocation[]>([]);
  readonly products = signal<Product[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly formError = signal<string | null>(null);
  readonly editing = signal(false);
  readonly draft = signal<TicaStockSettingsWrite>({ enabled: false, fromDate: null, locations: [], productUnits: [] });
  readonly dirty = computed(() => this.editing() && !!this.settings() && JSON.stringify(this.draft()) !== JSON.stringify(writeOf(this.settings()!)));
  readonly day = ticaDate;
  readonly availableLocations = computed(() => this.locations().filter(row => row.active));

  constructor() {
    void this.catalog.unitNames().catch(() => undefined);
    void this.reload();
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty() || this.saving()) { event.preventDefault(); event.returnValue = ''; }
  }
  canDeactivate(): boolean | Promise<boolean> {
    if (this.saving()) return false;
    return this.dirty() ? confirmLeave(this.ui, () => this.save()) : true;
  }
  async reload(): Promise<void> {
    if (this.loading() || this.editing() || this.saving()) return;
    this.loading.set(true); this.error.set(null);
    try {
      const settings = await this.api.stockSettings();
      if (!this.destroy.destroyed) this.settings.set(settings);
    } catch (failure) {
      if (!this.destroy.destroyed) this.error.set(messageOf(failure, 'De voorraadkoppeling kon niet worden geladen.'));
    } finally { if (!this.destroy.destroyed) this.loading.set(false); }
  }
  async open(): Promise<void> {
    if (!this.settings() || this.loading() || this.saving()) return;
    this.draft.set(writeOf(this.settings()!));
    this.formError.set(null);
    this.loading.set(true);
    try {
      const [locations, products] = await Promise.all([this.catalog.stockLocations(), this.catalog.products()]);
      if (!this.destroy.destroyed) { this.locations.set(locations); this.products.set(products); this.editing.set(true); }
    } catch (failure) {
      if (!this.destroy.destroyed) this.error.set(messageOf(failure, 'De voorraadlocaties konden niet worden geladen.'));
    } finally { if (!this.destroy.destroyed) this.loading.set(false); }
  }
  async close(): Promise<void> {
    if (await this.canDeactivate()) this.editing.set(false);
  }
  setEnabled(enabled: boolean): void { this.draft.update(draft => ({ ...draft, enabled })); }
  setFromDate(fromDate: string): void {
    if (!this.settings()?.configurationLocked) this.draft.update(draft => ({ ...draft, fromDate: fromDate || null }));
  }
  setLocation(sourceLocation: string, value: string): void {
    if (this.settings()?.locations.find(row => row.sourceLocation === sourceLocation)?.locked) return;
    const id = value ? Number(value) : null;
    if (id !== null && !this.availableLocations().some(row => row.id === id)) return;
    this.draft.update(draft => ({ ...draft, locations: draft.locations.map(row => row.sourceLocation === sourceLocation ? { ...row, stockLocationId: id } : row) }));
  }
  product(id: number): Product | undefined { return this.products().find(product => product.id === id); }
  productLabel(id: number): string {
    const product = this.product(id);
    return product ? [product.name, product.colour, product.sku].filter(Boolean).join(' · ') : `Product ${id}`;
  }
  pieceLabel(id: number): string { return productSalesUnit(this.product(id)).piece.one; }
  setProductUnit(productId: number, value: string): void {
    if (this.settings()?.productUnits.find(row => row.productId === productId)?.locked) return;
    const sourceUnit = value === 'PIECE' || value === 'DISPLAY' ? value
      : this.settings()?.productUnits.find(row => row.productId === productId)?.productSalesUnit === 'PIECE' ? 'PIECE' : null;
    this.draft.update(draft => ({ ...draft, productUnits: draft.productUnits.map(row => row.productId === productId ? { ...row, sourceUnit } : row) }));
  }
  async save(): Promise<boolean> {
    if (this.saving() || !this.settings()) return false;
    const error = ticaStockSettingsError(this.draft());
    if (error) { this.formError.set(error); return false; }
    this.saving.set(true); this.formError.set(null);
    try {
      const settings = await this.api.saveStockSettings(this.draft());
      if (this.destroy.destroyed) return true;
      this.settings.set(settings); this.draft.set(writeOf(settings)); this.editing.set(false);
      this.ui.toast('TICA-voorraadkoppeling opgeslagen'); this.changed.emit();
      return true;
    } catch (failure) {
      if (!this.destroy.destroyed) this.formError.set(messageOf(failure, 'De voorraadkoppeling kon niet worden opgeslagen.'));
      return false;
    } finally { if (!this.destroy.destroyed) this.saving.set(false); }
  }
}
