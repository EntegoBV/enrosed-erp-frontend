import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Product } from '../../core/api/models';
import { ProductChannelPriceApi, ProductChannelPrice as ChannelPrice, ProductChannelPriceHistory, ProductChannelPriceUnit } from '../../core/api/product-channel-price-api';
import { messageOf } from '../../core/api/errors';
import { DecimalInput } from '../../shared/decimal-input';
import { EurPipe } from '../../shared/pipes';
import { Ui, confirmLeave } from '../../shared/ui';
import { productSalesUnit } from './product-sales-unit';
import { ticaMoment } from '../tica/tica-format';

@Component({
  selector: 'app-product-channel-price',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, DecimalInput, EurPipe],
  templateUrl: './product-channel-price.html',
  styleUrl: './product-channel-price.scss',
})
export class ProductChannelPrice {
  private readonly api = inject(ProductChannelPriceApi);
  private readonly ui = inject(Ui);
  private readonly destroy = inject(DestroyRef);
  private request = 0;
  private productId: number | null | undefined;
  readonly product = input.required<Product>();
  readonly editable = input(false);
  readonly disabled = input(false);
  readonly price = signal<ChannelPrice | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly editing = signal(false);
  readonly amount = signal<number | null>(null);
  readonly unit = signal<ProductChannelPriceUnit>('TICA_ARTICLE');
  readonly formError = signal<string | null>(null);
  readonly historyOpen = signal(false);
  readonly historyLoading = signal(false);
  readonly historyError = signal<string | null>(null);
  readonly history = signal<ProductChannelPriceHistory[]>([]);
  readonly dirty = computed(() => this.editing() && (
    this.price()?.manualPriceExclVat == null || this.amount() !== this.price()?.manualPriceExclVat || this.unit() !== this.price()?.manualUnit
  ));
  readonly salesUnit = computed(() => productSalesUnit(this.product()));
  readonly moment = ticaMoment;

  constructor() {
    effect(() => {
      const id = this.product().id;
      untracked(() => {
        if (id === this.productId) return;
        this.productId = id;
        this.editing.set(false); this.historyOpen.set(false); this.history.set([]); this.historyLoading.set(false); this.historyError.set(null);
        void this.load(id);
      });
    });
  }
  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty() || this.saving()) { event.preventDefault(); event.returnValue = ''; }
  }
  async canDeactivate(): Promise<boolean> {
    if (this.saving()) return false;
    if (!this.dirty()) return true;
    const allowed = await confirmLeave(this.ui, () => this.save(), {
      message: 'De TICA-prijs is nog niet in het ERP opgeslagen. Wil je deze kanaalprijs bewaren voordat je verdergaat?',
    });
    if (allowed) this.editing.set(false);
    return allowed;
  }
  async load(id = this.product().id): Promise<void> {
    const version = ++this.request;
    this.price.set(null); this.error.set(null); this.formError.set(null);
    if (id === null) { this.loading.set(false); return; }
    this.loading.set(true);
    try {
      const prices = await this.api.prices(id);
      if (!this.destroy.destroyed && version === this.request) this.price.set(prices.find(row => row.channel === 'TICA') ?? null);
    } catch (failure) {
      if (!this.destroy.destroyed && version === this.request) this.error.set(messageOf(failure, 'De TICA-prijs kon niet worden geladen.'));
    } finally { if (!this.destroy.destroyed && version === this.request) this.loading.set(false); }
  }
  edit(): void {
    if (!this.editable() || this.disabled() || this.loading() || this.error() || this.saving() || this.product().id === null) return;
    const price = this.price();
    this.amount.set(price?.manualPriceExclVat ?? price?.priceExclVat ?? null);
    this.unit.set(price?.manualUnit ?? price?.unit ?? (this.salesUnit().isDisplay ? 'DISPLAY' : 'PIECE'));
    this.formError.set(null); this.editing.set(true);
  }
  setAmount(value: number | string | null): void {
    this.amount.set(value === null || value === '' ? null : Number(value));
  }
  async cancel(): Promise<void> { if (await this.canDeactivate()) this.editing.set(false); }
  async save(): Promise<boolean> {
    const amount = this.amount();
    if (amount === null || !Number.isFinite(amount) || amount <= 0) { this.formError.set('Vul een TICA-prijs hoger dan € 0 in.'); return false; }
    return this.persist(amount, this.unit());
  }
  async useObserved(): Promise<void> {
    if (this.dirty() && !(await this.canDeactivate())) return;
    await this.persist(null, this.price()?.observedUnit ?? 'TICA_ARTICLE');
  }
  private async persist(amount: number | null, unit: ProductChannelPriceUnit): Promise<boolean> {
    const id = this.product().id;
    if (id === null || !this.editable() || this.disabled() || this.saving() || this.loading() || this.error()) return false;
    this.saving.set(true); this.formError.set(null);
    try {
      const saved = await this.api.saveTica(id, amount, unit);
      if (this.destroy.destroyed || this.product().id !== id) return true;
      this.price.set(saved); this.editing.set(false);
      this.ui.toast(amount === null ? 'ERP gebruikt weer de prijs uit TICA' : 'TICA-prijs opgeslagen in ERP');
      if (this.historyOpen()) void this.loadHistory();
      return true;
    } catch (failure) {
      if (!this.destroy.destroyed && this.product().id === id) this.formError.set(messageOf(failure, 'De TICA-prijs kon niet worden opgeslagen.'));
      return false;
    } finally { if (!this.destroy.destroyed) this.saving.set(false); }
  }
  async toggleHistory(): Promise<void> {
    this.historyOpen.set(!this.historyOpen());
    if (this.historyOpen()) await this.loadHistory();
  }
  async loadHistory(): Promise<void> {
    const id = this.product().id, version = this.request;
    if (id === null) return;
    this.historyLoading.set(true); this.historyError.set(null);
    try {
      const history = await this.api.history(id);
      if (!this.destroy.destroyed && version === this.request) this.history.set(history);
    } catch (failure) {
      if (!this.destroy.destroyed && version === this.request) this.historyError.set(messageOf(failure, 'De prijsgeschiedenis kon niet worden geladen.'));
    } finally { if (!this.destroy.destroyed && version === this.request) this.historyLoading.set(false); }
  }
  unitLabel(unit: ProductChannelPriceUnit | null | undefined): string {
    return unit === 'DISPLAY' ? 'display' : unit === 'PIECE' ? this.salesUnit().piece.one : 'TICA-artikel';
  }
}
