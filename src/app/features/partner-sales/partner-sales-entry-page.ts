import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Auth } from '../../core/api/auth';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import type { Customer, Product, ProductFamily, StockLevel, StockLocation } from '../../core/api/models';
import type {
  PartnerBuyer, PartnerRecentSale, PartnerReportRequest, PartnerReportResult, PartnerStockTile,
} from '../../core/api/partner-portal-api';
import { PARTNER_API_VERSION } from '../../core/api/partner-portal-api';
import {
  PartnerCountUnitCode, PartnerPortalAdminRow, PartnerSalesApi, StaffPartnerReport, isMissingEndpoint,
} from '../../core/api/partner-sales-api';
import { SalesApi } from '../../core/api/sales-api';
import { WorkQueue } from '../../core/api/work-queue';
import type { HasUnsavedChanges } from '../../core/guards/unsaved-changes.guard';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { LoadError } from '../../shared/load-error';
import { PageHeader } from '../../shared/page-header';
import { salesPhotoUrl } from '../../shared/sales-photo';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import { Ui } from '../../shared/ui';
import { blankCustomer } from '../customers/customer-form';
import type { BuyerCreateBody } from '../partner/partner-buyer-field';
import { MeldingDraft } from '../partner/partner-draft';
import { PartnerEntry } from '../partner/partner-entry';
import { addDays, localToday, longDate } from '../partner/partner-format';
import type { PhotoUrlFn } from '../partner/partner-photo';
import { storedUnits } from '../settings/partner-unit-choices';
import { buyerCandidates, buyerOf, lastBuyers, productTile, recentSales, searchBuyers } from './partner-sales-entry-data';
import { shortDay } from './partner-sales-filters';

/** The server's rule: a new date goes at most 90 days back (an edit keeps its own). */
const DAYS_BACK = 90;
/** What Terugkoop offers: the partner's sales of the last 60 days (as the partner's own overview). */
const RECENT_DAYS = 60;
/** Said when the server is still round 1 (the portal's own words): nothing round-2 is sent to it. */
const SERVER_UPDATING = 'De server wordt bijgewerkt; probeer het zo opnieuw.';

/**
 * Melding toevoegen (/veilingverkopen/melding, ?partner=<id>) and Bewerken
 * (/veilingverkopen/melding/<id>): staff type in what Frans phoned in, or
 * correct a melding (also once confirmed: it stays confirmed), with the very
 * form the partner uses (app-partner-entry) at full page width. Products and
 * stock come from the ERP (the partner's location; counted per piece,
 * display or omdoos with his default from Instellingen › Partnerportaal);
 * the buyer of a direct sale from Klanten (a new one with the normal
 * customer creation, VAT number included). It posts to the staff POST, or
 * PUT with the token it loaded; a round-1 server gets nothing round-2.
 */
@Component({
  selector: 'app-partner-sales-entry-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LoadError, PageHeader, PartnerEntry, Segmented, Skeleton],
  template: `
    <app-page-header [title]="title()" [subtitle]="subtitle()" />
    <div class="content ve" [class.ve--phone]="!desk.active()">
      @if (failure(); as message) {
        <app-load-error [title]="editId() ? 'De melding laden lukt nu niet' : 'Melding toevoegen kan nu niet'" [message]="message" [busy]="loading()" (retry)="reload()" />
      } @else if (!ready()) {
        <app-skeleton [kind]="desk.active() ? 'card' : 'group'" [rows]="4" />
      } @else if (!partners().length && !editId()) {
        <p class="ve-none">Geen partner met Partnercontainers. Zet dat aan bij de klant.</p>
      } @else if (locked(); as why) {
        <div class="ve-locked"><p>{{ why }}</p><button class="wk-btn" type="button" (click)="back()">Naar Veilingverkopen</button></div>
      } @else {
        <div class="ve-top">
          @if (!editId() && partners().length > 1) {
            <app-segmented [variant]="desk.active() ? 'desk' : 'ios'" label="Partner" [options]="partnerOptions()"
                           [value]="customerId() ? '' + customerId() : ''" (changed)="pick(+$event)" />
          }
          <span class="ve-where">{{ whereLine() }}</span>
        </div>
        @if (customerId() != null) {
          <app-partner-entry [draft]="draft" [stock]="stock()" [recent]="recent()" [today]="today" [photoUrl]="photoUrl"
                             [startPicking]="!editId()" [submit]="send" [buyerSearch]="findBuyers" [buyerCreate]="addBuyer" [buyerVat]="true"
                             [submitLabel]="editId() ? 'Opslaan' : 'Melding opslaan'" (done)="done($event)" (refused)="refused()" />
        }
      }
    </div>
  `,
  styles: `
    :host{display:block;min-width:0}
    .ve{--pp-gutter:12px;--pp-sticky-top:var(--appbar-h,0px)}
    .ve-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;margin-bottom:12px}
    .ve-where{color:var(--muted);font-size:13px}
    .ve-none{margin:0;padding:24px;color:var(--muted);text-align:center}
    .ve-locked{display:grid;justify-items:start;gap:12px;max-width:560px;padding:18px 20px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
    .ve-locked p{margin:0;color:var(--ink-2);font-size:14.5px;line-height:1.45}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      /* The form's Netto + Opslaan bar floats above the ERP's tab bar. */
      .ve{--pp-bar-bottom:calc(var(--tabbar-h,58px) + var(--safe-b,0px) + 14px);--pp-bar-safe:0px;--pp-bar-radius:20px;--pp-gutter:0px}
      .ve-top{padding:0 4px}
      .ve-where{font-size:14px}
    }
  `,
})
export class PartnerSalesEntryPage implements HasUnsavedChanges {
  private readonly api = inject(PartnerSalesApi);
  private readonly catalog = inject(CatalogApi);
  private readonly sales = inject(SalesApi);
  private readonly work = inject(WorkQueue);
  private readonly auth = inject(Auth);
  private readonly ui = inject(Ui);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly desk = inject(DesktopViewport);

  /** The path's melding id (Bewerken); absent for Melding toevoegen. */
  readonly id = input<string | undefined>();
  /** ?partner=<customerId>: the partner to start with. */
  readonly partner = input<string | undefined>();

  readonly today = localToday();
  readonly draft = new MeldingDraft();

  readonly loading = signal(false);
  readonly ready = signal(false);
  readonly failure = signal<string | null>(null);
  private readonly rows = signal<PartnerPortalAdminRow[]>([]);
  private readonly products = signal<Product[]>([]);
  private readonly families = signal<ProductFamily[]>([]);
  private readonly levels = signal<StockLevel[]>([]);
  private readonly locations = signal<StockLocation[]>([]);
  private readonly units = signal<ReadonlyMap<number, PartnerCountUnitCode>>(new Map());
  private readonly reports = signal<StaffPartnerReport[]>([]);
  private readonly apiVersion = signal<number | null>(null);
  readonly customerId = signal<number | null>(null);
  /** The melding being edited, as the server answered it. */
  readonly editReport = signal<StaffPartnerReport | null>(null);
  private customers: Promise<Customer[]> | null = null;
  private partnerRun = 0;
  private loadedFor: string | null = null;

  readonly editId = computed(() => {
    const id = Number(this.id());
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  });

  readonly title = computed(() => {
    const report = this.editReport();
    return this.editId() ? (report ? `${report.number} wijzigen` : 'Melding wijzigen') : 'Melding toevoegen';
  });

  readonly partners = computed(() => this.rows().filter((row) => row.partner));
  readonly partnerOptions = computed<SegmentOption[]>(() => this.partners().map((row) => ({ id: String(row.customerId), label: row.customerName })));
  private readonly row = computed(() => this.rows().find((row) => row.customerId === this.customerId()) ?? null);
  private readonly productById = computed(() => new Map(this.products().map((product) => [product.id ?? 0, product])));
  private readonly familyNames = computed(() => new Map(this.families().filter((f) => f.id != null).map((f) => [f.id!, f.name ?? null])));

  readonly subtitle = computed(() => {
    const report = this.editReport();
    if (!report) return this.row()?.customerName ?? '';
    const state = report.confirmed ? 'bevestigd, blijft bevestigd' : 'nog niet bevestigd';
    return `${report.customerName} · verkocht ${longDate(report.soldOn)} · ${state}`;
  });

  /** The partner's location: its setting, else the main warehouse (code MAIN). */
  private readonly location = computed(() => {
    const wanted = this.row()?.settings.locationId ?? null;
    const all = this.locations();
    return all.find((location) => location.id === wanted && wanted != null) ?? all.find((location) => location.code === 'MAIN') ?? null;
  });

  readonly whereLine = computed(() => {
    const where = this.row()?.settings.locationName || this.location()?.name || '';
    const report = this.editReport();
    const parts = [where ? `Voorraad in ${where}` : ''];
    if (report?.updatedAt) parts.push(`laatst gewijzigd ${report.updatedByName ? 'door ' + report.updatedByName + ' ' : ''}${this.when(report.updatedAt)}`);
    return parts.filter(Boolean).join(' · ');
  });

  private tileOf(product: Product) {
    const familyName = product.familyId != null ? this.familyNames().get(product.familyId) ?? null : null;
    return productTile(product, familyName, this.units().get(product.id ?? 0));
  }

  /** Active products with stock at the partner's location, in sales units: what the partner's own list shows. */
  readonly stock = computed<PartnerStockTile[]>(() => {
    const locationId = this.location()?.id;
    if (locationId == null) return [];
    const products = this.productById();
    return this.levels()
      .filter((level) => level.locationId === locationId && level.quantity > 0)
      .map((level) => ({ level, product: products.get(level.productId) }))
      .filter((item): item is { level: StockLevel; product: Product } => !!item.product && item.product.active)
      .map(({ level, product }) => ({ ...this.tileOf(product), quantity: level.quantity }))
      .sort((a, b) => a.name.localeCompare(b.name, 'nl') || (a.variant ?? '').localeCompare(b.variant ?? '', 'nl'));
  });

  /** Terugkoop: what this partner sold in the last 60 days, with the last average. */
  readonly recent = computed<PartnerRecentSale[]>(() => {
    const products = this.productById();
    return recentSales(this.reports(), addDays(this.today, -RECENT_DAYS), (id) => {
      const product = products.get(id);
      return product ? this.tileOf(product) : null;
    });
  });

  /** Why a loaded melding cannot be changed (the server decides with canEdit). */
  readonly locked = computed<string | null>(() => {
    const report = this.editReport();
    if (!this.editId() || !report) return null;
    if (report.revisionOf) return 'Dit is een oude versie van een gewijzigde melding.';
    if (report.status === 'VOIDED') return 'Deze melding is ingetrokken.';
    if (report.status !== 'OPEN') return 'Deze melding is al (deels) gefactureerd en kan niet meer gewijzigd worden.';
    if (report.canEdit === undefined) return SERVER_UPDATING;
    if (!report.canEdit) return 'Een latere terugkoop hoort bij deze melding. Trek die eerst in.';
    return null;
  });

  /** Staff photos (the product's own sales photo), not the partner route. */
  readonly photoUrl: PhotoUrlFn = (product) => {
    const known = this.productById().get(product.productId);
    return known ? salesPhotoUrl(known) : null;
  };

  /** New: POST; edit: PUT with the token it loaded. Never a round-2 body to a server that does not answer apiVersion 2. */
  readonly send = async (body: PartnerReportRequest): Promise<PartnerReportResult> => {
    const customerId = this.customerId();
    if (customerId == null) throw { status: 0, error: { message: 'Kies eerst de partner' } };
    if ((this.apiVersion() ?? this.work.partnerSales()?.apiVersion ?? 1) < PARTNER_API_VERSION) {
      throw { status: 503, error: { message: SERVER_UPDATING } };
    }
    const editing = this.draft.editing();
    if (editing) return { report: await this.api.updateReport(editing.id, { ...body, customerId }), existing: false };
    return this.api.createReport({ ...body, customerId });
  };

  /** Klant of a direct sale: the ERP's customers (no partners) by company and city; empty = his last buyers. */
  readonly findBuyers = async (query: string): Promise<PartnerBuyer[]> => {
    const customers = buyerCandidates(await this.customerList()).filter((customer) => customer.id !== this.customerId());
    if (!query.trim()) return lastBuyers(this.reports(), new Map(customers.map((customer) => [customer.id!, customer])));
    return searchBuyers(customers, query);
  };

  /** "Niet gevonden? Nieuwe klant": the normal customer creation (VAT number included), in the partner's country by default. */
  readonly addBuyer = async (body: BuyerCreateBody): Promise<PartnerBuyer> => {
    const partner = (await this.customerList()).find((customer) => customer.id === this.customerId());
    const country = body.countryCode || partner?.countryCode || 'BE';
    const saved = await this.sales.createCustomer({
      ...blankCustomer(country), company: body.company, city: body.city ?? '', email: body.email ?? '', phone: body.phone ?? '',
      vatNumber: body.vatNumber ?? '', countryCode: country,
    });
    this.customers = this.customerList().then((list) => [...list, saved]);
    return buyerOf(saved);
  };

  constructor() {
    this.draft.saleLimitOtherwise.set(0);
    this.draft.setToday(this.today, addDays(this.today, -DAYS_BACK));
    void this.loadBase();
    /* The path decides: a melding to edit, or a new one (for ?partner, else the first partner). */
    effect(() => {
      const id = this.editId();
      const partner = Number(this.partner());
      untracked(() => {
        const key = id ? `edit:${id}` : `new:${partner || ''}`;
        if (key === this.loadedFor || !this.ready()) return;
        this.loadedFor = key;
        if (id) void this.loadEdit(id);
        else this.startNew(Number.isSafeInteger(partner) && partner > 0 ? partner : null);
      });
    });
    /* With every stock read: the limits (an edit adds its own old quantities) and the costs. */
    effect(() => {
      this.stock();
      this.row();
      untracked(() => this.apply());
    });
  }

  private async loadBase(): Promise<void> {
    this.loading.set(true);
    this.failure.set(null);
    try {
      const [rows, products, levels, locations, families] = await Promise.all([
        this.api.adminRows(), this.catalog.products(), this.catalog.stockLevels(), this.catalog.stockLocations(),
        this.catalog.productFamilies().catch(() => [] as ProductFamily[]), this.catalog.unitNames().catch(() => []),
      ]);
      this.rows.set(rows);
      this.products.set(products);
      this.levels.set(levels);
      this.locations.set(locations);
      this.families.set(families);
      this.ready.set(true);
      this.loadedFor = null;
      const id = this.editId();
      const partner = Number(this.partner());
      this.loadedFor = id ? `edit:${id}` : `new:${partner || ''}`;
      if (id) await this.loadEdit(id);
      else this.startNew(Number.isSafeInteger(partner) && partner > 0 ? partner : null);
    } catch (failure: unknown) {
      this.failure.set(isMissingEndpoint(failure) ? 'De server kent de veilingverkopen nog niet.' : messageOf(failure, 'De voorraad kon niet worden geladen.'));
    } finally {
      this.loading.set(false);
    }
  }

  reload(): void {
    if (!this.ready()) { void this.loadBase(); return; }
    const id = this.editId();
    if (id) void this.loadEdit(id);
  }

  private startNew(partner: number | null): void {
    this.editReport.set(null);
    this.draft.reset(this.today);
    const list = this.partners();
    const first = list.find((row) => row.customerId === partner) ?? list[0];
    if (first) void this.setPartner(first.customerId);
  }

  /** Bewerken: the melding as staff see it, on the form with what was typed; its partner's stock and defaults. */
  private async loadEdit(id: number): Promise<void> {
    this.loading.set(true);
    this.failure.set(null);
    try {
      const report = await this.api.report(id);
      this.editReport.set(report);
      await this.setPartner(report.customerId, false);
      this.draft.reset(this.today);
      this.draft.loadReport(report);
      this.apply();
    } catch (failure: unknown) {
      const status = (failure as { status?: number } | null)?.status;
      this.failure.set(status === 404 ? 'Deze melding bestaat niet (meer).' : messageOf(failure, 'De melding laden lukt nu niet.'));
    } finally {
      this.loading.set(false);
    }
  }

  pick(customerId: number): void {
    if (!Number.isSafeInteger(customerId) || customerId === this.customerId() || this.editId()) return;
    const go = () => {
      this.draft.reset(this.today);
      this.loadedFor = `new:${customerId}`;
      void this.setPartner(customerId);
      void this.router.navigate([], { relativeTo: this.route, queryParams: { partner: customerId }, replaceUrl: true });
    };
    if (!this.draft.dirty()) { go(); return; }
    this.ui.confirm({ title: 'Andere partner', message: 'Wat je al invulde gaat verloren.', confirmLabel: 'Wisselen', danger: true }, go);
  }

  /** The partner's unit defaults and recent meldingen (Terugkoop, last buyers, the server's round). */
  private async setPartner(customerId: number, wait = true): Promise<void> {
    const run = ++this.partnerRun;
    this.customerId.set(customerId);
    const units = this.api.units(customerId).then((rows) => storedUnits(rows)).catch(() => new Map<number, PartnerCountUnitCode>());
    const recent = this.api.list({ customerId, state: 'ALL', from: addDays(this.today, -RECENT_DAYS), limit: 1000 })
      .catch(() => null);
    const finish = Promise.all([units, recent]).then(([stored, page]) => {
      if (run !== this.partnerRun) return;
      this.units.set(stored);
      if (page) { this.reports.set(page.reports); this.apiVersion.set(page.apiVersion ?? null); }
      this.apply();
    });
    if (wait) await finish; else await finish.catch(() => undefined);
  }

  /** The partner's percents and the stock there as the limits (an edit keeps its own percents while its channel stays). */
  private apply(): void {
    const row = this.row();
    if (!row) return;
    const s = row.settings;
    this.draft.costs.set({
      auctionCommissionPct: s.auctionCommissionPct ?? s.defaultAuctionCommissionPct,
      auctionTransportPct: s.auctionTransportPct ?? s.defaultAuctionTransportPct,
    });
    this.draft.applyStock(new Map(this.stock().map((tile) => [tile.productId, tile.quantity])), 0);
    this.draft.setToday(this.today, addDays(this.today, -DAYS_BACK));
  }

  private customerList(): Promise<Customer[]> {
    this.customers ??= this.sales.customers().catch((failure) => { this.customers = null; throw failure; });
    return this.customers;
  }

  done(result: PartnerReportResult): void {
    const editing = this.draft.editing();
    this.draft.markSaved();
    if (editing) this.ui.toast(`${result.report.number} opgeslagen`);
    else this.ui.toast(result.existing ? `${result.report.number} was al gemeld; niets dubbel geboekt` : `${result.report.number} gemeld`);
    void this.work.refresh(true);
    void this.router.navigate(['/veilingverkopen'], { queryParams: { melding: result.report.id } });
  }

  /** A refusal keeps the draft; the stock may have changed meanwhile (the rows then say which is too many). */
  refused(): void {
    void this.catalog.stockLevels().then((levels) => this.levels.set(levels)).catch(() => undefined);
  }

  back(): void {
    void this.router.navigate(['/veilingverkopen']);
  }

  canDeactivate(): boolean | Promise<boolean> {
    if (!this.draft.dirty() || !this.auth.isLoggedIn()) return true;
    const editing = this.draft.editing();
    return new Promise<boolean>((resolve) => {
      this.ui.confirm(
        editing
          ? { title: 'Wijziging nog niet opgeslagen', message: `Wat je in ${editing.number} wijzigde gaat verloren.`, confirmLabel: 'Niet opslaan', danger: true }
          : { title: 'Melding nog niet opgeslagen', message: 'Wat je invulde gaat verloren.', confirmLabel: 'Niet opslaan', danger: true },
        () => resolve(true), undefined, () => resolve(false),
      );
    });
  }

  private when(instant: string): string {
    const date = new Date(instant);
    if (Number.isNaN(date.getTime())) return '';
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return `${shortDay(day, this.today)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
}
