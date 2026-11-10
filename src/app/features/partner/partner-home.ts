import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { PartnerReport } from '../../core/api/partner-portal-api';
import { LOAD_ERROR_FALLBACK, LoadError } from '../../shared/load-error';
import { messageOf } from '../../core/api/errors';
import { Icon } from '../../shared/icon';
import { Skeleton } from '../../shared/skeleton';
import { PartnerData } from './partner-data';
import { KIND_ICON, KIND_LABEL, KIND_TONE, PARTNER_KINDS, percent } from './partner-format';
import { GridProduct, PartnerGrid } from './partner-grid';
import { PartnerReportRows } from './partner-report-rows';
import { PartnerReportSheet } from './partner-report-sheet';

/**
 * The portal's home: three big tiles for what happened (veiling, direct,
 * terugkoop), the two cost percentages, the stock as tiles (a tap reports that
 * product sold at the auction), and the latest meldingen.
 */
@Component({
  selector: 'app-partner-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, LoadError, Skeleton, PartnerGrid, PartnerReportRows, PartnerReportSheet],
  template: `
    <nav class="acts" aria-label="Melden">
      @for (kind of kinds; track kind) {
        <a class="act {{ tone[kind] }}" routerLink="/partner/melden" [queryParams]="{ soort: kind }">
          <span class="act__icon" aria-hidden="true"><app-icon [name]="icon[kind]" [size]="26" /></span>
          <span class="act__label">{{ label[kind] }}</span>
        </a>
      }
    </nav>

    @if (overview(); as o) {
      <p class="costs">Veilingcommissie {{ pct(o.costs.auctionCommissionPct) }} · Transport {{ pct(o.costs.auctionTransportPct) }}</p>

      <section class="sec" aria-labelledby="pp-stock">
        <div class="sec__head">
          <h2 id="pp-stock">Voorraad</h2>
          <span class="sec__trail">{{ o.stock.length }} {{ o.stock.length === 1 ? 'product' : 'producten' }}</span>
        </div>
        <app-partner-grid [items]="o.stock" (picked)="sell($event)" />
      </section>

      <section class="sec" aria-labelledby="pp-latest">
        <div class="sec__head">
          <h2 id="pp-latest">Laatste meldingen</h2>
          @if (o.reports.length) { <a class="sec__link" routerLink="/partner/meldingen">Alle meldingen</a> }
        </div>
        @if (latest().length) {
          <app-partner-report-rows [reports]="latest()" [today]="o.serverDate" (opened)="open.set($event)" />
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
      <app-skeleton kind="card" [rows]="4" />
    }

    @if (open(); as report) {
      <app-partner-report-sheet [report]="report" (closed)="open.set(null)" (changed)="changed($event)" />
    }
  `,
  styles: `
    :host{display:block;padding-bottom:calc(20px + var(--safe-b,0px))}
    .acts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:6px 0 10px}
    .act:last-child{grid-column:1/-1}
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover){.acts{grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.act:last-child{grid-column:auto}}
    .act{display:flex;flex-direction:column;justify-content:space-between;gap:12px;min-height:104px;padding:14px 16px;border-radius:22px;background:color-mix(in srgb,var(--tone) 12%,var(--surface));color:color-mix(in srgb,var(--tone) 70%,var(--ink));text-decoration:none;box-shadow:0 1px 2px rgb(26 22 20/5%);-webkit-tap-highlight-color:transparent}
    .act:last-child{flex-direction:row;align-items:center;justify-content:flex-start;min-height:88px}
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover){.act,.act:last-child{flex-direction:column;align-items:stretch;justify-content:space-between;min-height:120px}}
    .act:hover{background:color-mix(in srgb,var(--tone) 17%,var(--surface))}
    .act:active{transform:scale(.98)}
    .act:focus-visible{outline:3px solid color-mix(in srgb,var(--tone) 60%,transparent);outline-offset:2px}
    .act__icon{display:grid;place-items:center;width:46px;height:46px;border-radius:14px;background:var(--tone);color:#fff}
    .act__label{font-size:17px;font-weight:750;line-height:1.2;letter-spacing:-.01em}
    .costs{margin:0 0 22px;color:var(--muted);font-size:14px;font-weight:600;text-align:center}
    .sec{margin:0 0 26px}
    .sec__head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 2px 10px}
    .sec__head h2{margin:0;font-size:21px;font-weight:800;letter-spacing:-.02em}
    .sec__trail{color:var(--muted);font-size:14px;font-weight:600}
    .sec__link{display:inline-flex;align-items:center;min-height:44px;margin:-12px 0;color:var(--rose-dark);font-size:15px;font-weight:650;text-decoration:none}
    .none{margin:0;padding:22px;border-radius:20px;background:var(--surface);color:var(--muted);text-align:center}
    .contact{margin:0 0 8px;color:var(--muted);font-size:14px;text-align:center}
    .contact a{display:inline-flex;align-items:center;min-height:44px;color:var(--rose-dark);font-weight:650;text-decoration:none}
  `,
})
export class PartnerHome {
  readonly data = inject(PartnerData);
  private readonly router = inject(Router);

  readonly kinds = PARTNER_KINDS;
  readonly label = KIND_LABEL;
  readonly icon = KIND_ICON;
  readonly tone = KIND_TONE;

  readonly overview = this.data.overview;
  readonly latest = computed<PartnerReport[]>(() => (this.overview()?.reports ?? []).slice(0, 5));
  readonly open = signal<PartnerReport | null>(null);
  readonly failureText = computed(() => messageOf(this.data.failure(), LOAD_ERROR_FALLBACK));

  constructor() {
    /* Every visit reads the stock afresh (after a melding it changed); the last overview shows meanwhile. */
    void this.data.load();
  }

  reload(): void {
    void this.data.load();
  }

  /** A stock tile: straight to the form with that product, sold at the auction (the kind can still change there). */
  sell(product: GridProduct): void {
    void this.router.navigate(['/partner/melden'], { queryParams: { soort: 'veiling', stap: 2, product: product.productId } });
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
