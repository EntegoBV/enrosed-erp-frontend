import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import type { Product, StockLevel, StockLocation } from '../../core/api/models';
import type {
  PartnerProductTile, PartnerRecentSale, PartnerReportRequest, PartnerReportResult, PartnerStockTile,
} from '../../core/api/partner-portal-api';
import {
  PartnerPortalAdminRow, PartnerSalesApi, StaffPartnerReport, StaffPartnerReportResult,
} from '../../core/api/partner-sales-api';
import { COLOUR_SWATCHES } from '../../core/api/geo';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { LoadError } from '../../shared/load-error';
import { salesPhotoUrl } from '../../shared/sales-photo';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui } from '../../shared/ui';
import { productParts } from '../customers/customer-price-state';
import { MeldingDraft } from '../partner/partner-draft';
import { PartnerEntry } from '../partner/partner-entry';
import { addDays, localToday } from '../partner/partner-format';
import type { PhotoUrlFn } from '../partner/partner-photo';
import { productSalesUnit } from '../products/product-sales-unit';

/** The server's rule: a melding goes at most 90 days back. */
const DAYS_BACK = 90;
/** What Terugkoop offers: the partner's sales of the last 60 days (as the partner's own overview). */
const RECENT_DAYS = 60;

/** A product as the partner tiles show it, from the staff catalogue (name/variant split as the ERP's own rows). */
export function productTile(product: Product): PartnerProductTile {
  const parts = productParts(product, { productId: product.id ?? 0, name: product.name, sku: product.sku });
  const unit = productSalesUnit(product);
  const variant = parts.tail ? parts.tail.replace(/^ (?:·\s*)?/, '').trim() || null : null;
  return {
    productId: product.id ?? 0,
    sku: product.sku,
    name: parts.head,
    variant,
    colourHex: product.colourHex || (product.colour ? COLOUR_SWATCHES[product.colour] ?? null : null),
    familyId: product.familyId,
    familyName: null,
    unitOne: unit.singular,
    unitOther: unit.plural,
    piecesPerUnit: unit.piecesPerDisplay,
    hasPhoto: !!salesPhotoUrl(product),
    photoVersion: null,
  };
}

/**
 * Melding toevoegen: staff enter what Frans phoned in, with the very form the
 * partner uses (app-partner-entry), posted to /api/partner-sales/reports.
 * The stock is the partner's location (Instellingen › Partnerportaal, else
 * the main warehouse) from the staff stock levels; Terugkoop offers what this
 * partner sold in the last 60 days. The melding books stock at once.
 */
@Component({
  selector: 'app-partner-sales-entry-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LoadError, PartnerEntry, Segmented, Sheet, Skeleton],
  template: `
    <app-sheet title="Melding toevoegen" [wide]="desk.active()" [variant]="desk.active() ? 'default' : 'ios'" (closed)="close()">
      <div body class="ve">
        @if (error(); as message) {
          <app-load-error title="Melding toevoegen kan nu niet" [message]="message" [busy]="loading()" (retry)="load()" />
        } @else if (loading() && !ready()) {
          <app-skeleton [kind]="desk.active() ? 'card' : 'group'" [rows]="3" />
        } @else if (!partners().length) {
          <p class="ve-none">Geen partner met Partnercontainers. Zet dat aan bij de klant.</p>
        } @else {
          @if (partners().length > 1) {
            <div class="ve-partner">
              <span class="ve-label">Voor welke partner?</span>
              <app-segmented [variant]="desk.active() ? 'desk' : 'ios'" label="Partner" [options]="partnerOptions()"
                             [value]="customerId() ? '' + customerId() : ''" (changed)="pick(+$event)" />
            </div>
          }
          @if (locationName()) { <p class="ve-where">Voorraad in {{ locationName() }}</p> }
          @if (customerId() != null) {
            <app-partner-entry [draft]="draft" [stock]="stock()" [recent]="recent()" [today]="today" [photoUrl]="photoUrl"
                               [submit]="send" (done)="done($event)" />
          }
        }
      </div>
    </app-sheet>
  `,
  styles: `
    .ve{display:grid;gap:12px;min-width:0;--pp-gutter:16px;--pp-head-h:0px}
    :host ::ng-deep .sheet__foot:empty{display:none}
    .ve-partner{display:grid;gap:6px}
    .ve-label{color:var(--muted);font-size:12.5px;font-weight:650}
    .ve-where{margin:0;color:var(--muted);font-size:13px}
    .ve-none{margin:0;padding:24px;color:var(--muted);text-align:center}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      .ve{padding:0 var(--pp-gutter)}
      .ve-where{font-size:14px}
    }
  `,
})
export class PartnerSalesEntrySheet {
  private readonly api = inject(PartnerSalesApi);
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  readonly desk = inject(DesktopViewport);

  /** The partner to start with (the page's filter), else the first. */
  readonly initialCustomerId = input<number | null>(null);
  readonly closed = output<void>();
  readonly saved = output<StaffPartnerReportResult>();

  readonly today = localToday();
  readonly draft = new MeldingDraft();

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly ready = signal(false);
  private readonly rows = signal<PartnerPortalAdminRow[]>([]);
  private readonly products = signal<Product[]>([]);
  private readonly levels = signal<StockLevel[]>([]);
  private readonly locations = signal<StockLocation[]>([]);
  readonly customerId = signal<number | null>(null);
  readonly recent = signal<PartnerRecentSale[]>([]);
  private recentRun = 0;

  readonly partners = computed(() => this.rows().filter((row) => row.partner));
  readonly partnerOptions = computed<SegmentOption[]>(() => this.partners().map((row) => ({ id: String(row.customerId), label: row.customerName })));
  private readonly row = computed(() => this.partners().find((row) => row.customerId === this.customerId()) ?? null);
  private readonly productById = computed(() => new Map(this.products().map((product) => [product.id ?? 0, product])));

  /** The partner's location: its setting, else the main warehouse (code MAIN). */
  private readonly location = computed(() => {
    const wanted = this.row()?.settings.locationId ?? null;
    const all = this.locations();
    return all.find((location) => location.id === wanted && wanted != null) ?? all.find((location) => location.code === 'MAIN') ?? null;
  });
  readonly locationName = computed(() => this.row()?.settings.locationName || this.location()?.name || '');

  /** Active products with stock there, in sales units, by name: what the partner's own tiles show. */
  readonly stock = computed<PartnerStockTile[]>(() => {
    const locationId = this.location()?.id;
    if (locationId == null) return [];
    const products = this.productById();
    return this.levels()
      .filter((level) => level.locationId === locationId && level.quantity > 0)
      .map((level) => ({ level, product: products.get(level.productId) }))
      .filter((item): item is { level: StockLevel; product: Product } => !!item.product && item.product.active)
      .map(({ level, product }) => ({ ...productTile(product), quantity: level.quantity }))
      .sort((a, b) => a.name.localeCompare(b.name, 'nl') || (a.variant ?? '').localeCompare(b.variant ?? '', 'nl'));
  });

  /** Staff photos (the product's own sales photo), not the partner route. */
  readonly photoUrl: PhotoUrlFn = (product) => {
    const known = this.productById().get(product.productId);
    return known ? salesPhotoUrl(known) : null;
  };

  /** The entry's submit: the partner's body plus the customer, to the staff endpoint. */
  readonly send = async (body: PartnerReportRequest): Promise<PartnerReportResult> => {
    const customerId = this.customerId();
    if (customerId == null) throw { status: 0, error: { message: 'Kies eerst de partner' } };
    const result = await this.api.createReport({ ...body, customerId });
    this.lastResult = result;
    return result;
  };
  private lastResult: StaffPartnerReportResult | null = null;

  constructor() {
    this.draft.latest.set(this.today);
    this.draft.earliest.set(addDays(this.today, -DAYS_BACK));
    this.draft.soldOn.set(this.today);
    this.draft.saleLimitOtherwise.set(0);
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [rows, products, levels, locations] = await Promise.all([
        this.api.adminRows(), this.catalog.products(), this.catalog.stockLevels(), this.catalog.stockLocations(),
        this.catalog.unitNames().catch(() => []),
      ]);
      this.rows.set(rows);
      this.products.set(products);
      this.levels.set(levels);
      this.locations.set(locations);
      this.ready.set(true);
      const partners = this.partners();
      const first = partners.find((row) => row.customerId === this.initialCustomerId()) ?? partners[0];
      if (first && this.customerId() == null) this.pick(first.customerId);
      else this.applyPartner();
    } catch (failure: unknown) {
      this.error.set(messageOf(failure, 'De voorraad kon niet worden geladen.'));
    } finally {
      this.loading.set(false);
    }
  }

  pick(customerId: number): void {
    if (!Number.isSafeInteger(customerId) || customerId === this.customerId()) return;
    if (this.customerId() != null && this.draft.entries().length) this.draft.reset(this.today);
    this.customerId.set(customerId);
    this.applyPartner();
    void this.loadRecent(customerId);
  }

  /** The partner's applied percents and the stock at its location. */
  private applyPartner(): void {
    const row = this.row();
    if (!row) return;
    const s = row.settings;
    this.draft.costs.set({
      auctionCommissionPct: s.auctionCommissionPct ?? s.defaultAuctionCommissionPct,
      auctionTransportPct: s.auctionTransportPct ?? s.defaultAuctionTransportPct,
    });
    this.draft.saleLimits.set(new Map(this.stock().map((tile) => [tile.productId, tile.quantity])));
  }

  /** Terugkoop: the products this partner sold in the last 60 days, newest first, with the last average. */
  private async loadRecent(customerId: number): Promise<void> {
    const run = ++this.recentRun;
    try {
      const page = await this.api.reports({ customerId, status: 'ALL', limit: 100 });
      if (run !== this.recentRun) return;
      this.recent.set(recentSales(page.reports, addDays(this.today, -RECENT_DAYS), this.productById()));
    } catch {
      if (run === this.recentRun) this.recent.set([]);
    }
  }

  done(result: PartnerReportResult): void {
    const staff = this.lastResult?.report.id === result.report.id ? this.lastResult : { report: result.report as StaffPartnerReport, existing: result.existing };
    this.ui.toast(staff.existing ? `${result.report.number} was al gemeld; niets dubbel geboekt` : `${result.report.number} gemeld`);
    this.saved.emit(staff);
    this.closed.emit();
  }

  /** Closing with typed values asks first (× and Esc). */
  close(): void {
    if (!this.draft.dirty()) { this.closed.emit(); return; }
    this.ui.confirm({ title: 'Melding nog niet verstuurd', message: 'Wat je typte gaat verloren.', confirmLabel: 'Sluiten', danger: true },
      () => this.closed.emit());
  }
}

/** The recent sales of a partner from its meldingen: one tile per product, newest first. */
function recentSales(reports: readonly StaffPartnerReport[], since: string, products: ReadonlyMap<number, Product>): PartnerRecentSale[] {
  const byProduct = new Map<number, PartnerRecentSale>();
  for (const report of reports) {
    if (report.status === 'VOIDED' || report.soldOn < since) continue;
    for (const entry of report.entries) {
      if (!entry.sale) continue;
      const known = byProduct.get(entry.productId);
      if (known) {
        known.soldQuantity += entry.sale.quantity;
        /* The list is newest melding first; a melding typed later can be dated earlier. The last day sold wins. */
        if (report.soldOn > known.lastSoldOn) { known.lastSoldOn = report.soldOn; known.lastAverageEur = entry.sale.unitPriceEur; }
        continue;
      }
      const product = products.get(entry.productId);
      const tile: PartnerProductTile = product ? productTile(product) : {
        productId: entry.productId, sku: null, name: entry.name, variant: entry.variant, colourHex: entry.colourHex,
        familyId: null, familyName: null, unitOne: entry.unitOne, unitOther: entry.unitOther, piecesPerUnit: null,
        hasPhoto: false, photoVersion: null,
      };
      byProduct.set(entry.productId, { ...tile, soldQuantity: entry.sale.quantity, lastSoldOn: report.soldOn, lastAverageEur: entry.sale.unitPriceEur });
    }
  }
  return [...byProduct.values()].sort((a, b) => b.lastSoldOn.localeCompare(a.lastSoldOn));
}
