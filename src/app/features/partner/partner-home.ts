import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PartnerPortalApi, type PartnerReport } from '../../core/api/partner-portal-api';
import { messageOf } from '../../core/api/errors';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { LOAD_ERROR_FALLBACK, LoadError } from '../../shared/load-error';
import { Skeleton } from '../../shared/skeleton';
import { Ui } from '../../shared/ui';
import { PartnerComing } from './partner-coming';
import { PartnerContainersData } from './partner-containers-data';
import { PartnerData } from './partner-data';
import { KIND_ICON, KIND_LABEL, KIND_TONE, PARTNER_KINDS, percent } from './partner-format';
import { PartnerProductTable, TableProduct, withCategories } from './partner-product-table';
import { bySoldOn } from './partner-report-format';
import { PartnerReportRows } from './partner-report-rows';
import { PartnerReportSheet, confirmUndo } from './partner-report-sheet';
import { PartnerReportTable } from './partner-report-table';

/**
 * Overzicht, desk first: three buttons for what happened (veiling, direct,
 * terugkoop), the two cost percentages, the next three containers coming
 * (links to Containers), the stock as one table grouped by
 * category and series like the ERP's Voorraad (Melden on a row reports that
 * product sold at the auction), and the
 * latest meldingen as a table.
 */
@Component({
  selector: 'app-partner-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, LoadError, Skeleton, PartnerComing, PartnerProductTable, PartnerReportRows, PartnerReportSheet, PartnerReportTable],
  template: `
    <nav class="acts" aria-label="Melden">
      @for (kind of kinds; track kind) {
        <a class="act {{ tone[kind] }}" routerLink="/partner/melden" [queryParams]="{ soort: kind }">
          <span class="act__icon" aria-hidden="true"><app-icon [name]="icon[kind]" [size]="22" /></span>
          <span class="act__label">{{ label[kind] }}</span>
        </a>
      }
    </nav>

    @if (overview(); as o) {
      <p class="costs">Veilingcommissie {{ pct(o.costs.auctionCommissionPct) }} · Transport {{ pct(o.costs.auctionTransportPct) }}</p>

      <app-partner-coming />

      <section class="sec" aria-labelledby="pp-stock">
        <div class="sec__head">
          <h2 id="pp-stock">Voorraad</h2>
          <span class="sec__trail">{{ o.stock.length }} {{ o.stock.length === 1 ? 'product' : 'producten' }}</span>
        </div>
        <div class="sec__card sec__card--pad">
          <app-partner-product-table mode="stock" caption="Voorraad" [items]="stockItems()" [stockFilter]="true"
                                     emptyText="Er ligt nu geen voorraad." (report)="sell($event)" />
        </div>
      </section>

      <section class="sec" aria-labelledby="pp-latest">
        <div class="sec__head">
          <h2 id="pp-latest">Laatste meldingen</h2>
          @if (o.reports.length) { <a class="sec__link" routerLink="/partner/meldingen">Alle meldingen</a> }
        </div>
        @if (latest().length) {
          @if (desk.active()) {
            <div class="sec__card">
              <app-partner-report-table caption="Laatste meldingen" [reports]="latest()" [today]="o.serverDate" [twins]="data.twins()"
                                        (opened)="open.set($event)" (edit)="edit($event)" (undo)="undo($event)" />
            </div>
          } @else {
            <app-partner-report-rows [reports]="latest()" [today]="o.serverDate" [twins]="data.twins()" (opened)="open.set($event)" />
          }
        } @else {
          <p class="none">Nog niets gemeld.</p>
        }
      </section>

      @if (o.contact?.phone) {
        <p class="contact">Vragen? {{ o.contact?.name || 'Enrosed' }} · <a [href]="'tel:' + tel(o.contact?.phone)">{{ o.contact?.phone }}</a></p>
      }
    } @else if (data.failure()) {
      <app-load-error [message]="failureText()" [busy]="data.loading()" (retry)="reload()" />
    } @else {
      <app-skeleton [kind]="desk.active() ? 'table' : 'card'" [rows]="5" />
    }

    @if (open(); as report) {
      <app-partner-report-sheet [report]="report" [twins]="data.twins()" [related]="overview()?.reports ?? []" (closed)="open.set(null)" (changed)="changed($event)" (edit)="edit($event)" />
    }
  `,
  styles: `
    :host{display:block;padding-bottom:calc(20px + var(--safe-b,0px))}
    .acts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:4px 0 10px}
    .act{display:flex;align-items:center;gap:12px;min-height:72px;padding:12px 14px;border-radius:18px;background:color-mix(in srgb,var(--tone) 12%,var(--surface));color:color-mix(in srgb,var(--tone) 70%,var(--ink));text-decoration:none;box-shadow:0 1px 2px rgb(26 22 20/5%);-webkit-tap-highlight-color:transparent}
    .act:last-child{grid-column:1/-1}
    .act:hover{background:color-mix(in srgb,var(--tone) 17%,var(--surface))}
    .act:active{transform:scale(.98)}
    .act:focus-visible{outline:3px solid color-mix(in srgb,var(--tone) 60%,transparent);outline-offset:2px}
    .act__icon{display:grid;flex:none;place-items:center;width:40px;height:40px;border-radius:12px;background:var(--tone);color:#fff}
    .act__label{font-size:16px;font-weight:750;line-height:1.2;letter-spacing:-.01em}
    .costs{margin:0 0 18px;color:var(--muted);font-size:13.5px;font-weight:600}
    .sec{margin:0 0 24px}
    .sec__head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 2px 8px}
    .sec__head h2{margin:0;font-size:19px;font-weight:800;letter-spacing:-.02em}
    .sec__trail{color:var(--muted);font-size:13.5px;font-weight:600}
    .sec__link{display:inline-flex;align-items:center;min-height:44px;margin:-12px 0;color:var(--rose-dark);font-size:14px;font-weight:650;text-decoration:none}
    .sec__card{border:1px solid var(--line);border-radius:14px;background:var(--surface);--wk-sticky-top:var(--pp-sticky-top,60px)}
    .sec__card--pad{padding:12px 12px 4px}
    .none{margin:0;padding:22px;border-radius:16px;background:var(--surface);color:var(--muted);text-align:center}
    .contact{margin:0 0 8px;color:var(--muted);font-size:14px;text-align:center}
    .contact a{display:inline-flex;align-items:center;min-height:44px;color:var(--rose-dark);font-weight:650;text-decoration:none}
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover){
      .acts{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
      .act:last-child{grid-column:auto}
      .act{min-height:64px;border-radius:14px}
    }
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      .sec__card{border:0;border-radius:20px}
      .sec__card--pad{padding:12px 0 4px}
      .costs{text-align:center}
    }
  `,
})
export class PartnerHome {
  readonly data = inject(PartnerData);
  private readonly containers = inject(PartnerContainersData);
  private readonly api = inject(PartnerPortalApi);
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);
  readonly desk = inject(DesktopViewport);

  readonly kinds = PARTNER_KINDS;
  readonly label = KIND_LABEL;
  readonly icon = KIND_ICON;
  readonly tone = KIND_TONE;

  readonly overview = this.data.overview;
  readonly latest = computed<PartnerReport[]>(() => [...(this.overview()?.reports ?? [])].sort(bySoldOn).slice(0, 5));
  readonly open = signal<PartnerReport | null>(null);
  readonly failureText = computed(() => messageOf(this.data.failure(), LOAD_ERROR_FALLBACK));

  /** The stock, and behind "Alleen met voorraad" what sold lately and is gone (0). */
  readonly stockItems = computed<TableProduct[]>(() => {
    const overview = this.overview();
    if (!overview) return [];
    const ids = new Set(overview.stock.map((tile) => tile.productId));
    const gone = overview.recentSales.filter((tile) => !ids.has(tile.productId)).map((tile) => ({ ...tile, quantity: 0 }));
    return withCategories<TableProduct>([...overview.stock, ...gone], this.containers.specs());
  });

  constructor() {
    /* Every visit reads the stock afresh (after a melding it changed); the last overview shows meanwhile. */
    void this.data.load();
  }

  reload(): void {
    void this.data.load();
  }

  /** Melden on a stock row: the form with that product, sold at the auction (the kind can still change there). */
  sell(product: TableProduct): void {
    if (!product.quantity) return;
    void this.router.navigate(['/partner/melden'], { queryParams: { soort: 'veiling', product: product.productId } });
  }

  edit(report: PartnerReport): void {
    this.open.set(null);
    void this.router.navigate(['/partner/melden'], { queryParams: { bewerk: report.id } });
  }

  async undo(report: PartnerReport): Promise<void> {
    const voided = await confirmUndo(this.ui, this.api, report);
    if (voided) this.changed(voided);
  }

  changed(report: PartnerReport): void {
    this.open.set(null);
    this.data.upsertReport(report);
    void this.data.load();
  }

  pct(value: number): string {
    return percent(value);
  }

  tel(phone: string | null | undefined): string {
    return (phone ?? '').replace(/[^\d+]/g, '');
  }
}
