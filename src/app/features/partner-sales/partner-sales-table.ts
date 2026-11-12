import { ChangeDetectionStrategy, Component, computed, effect, input, output } from '@angular/core';
import type { PartnerSalesFilteredTotals, StaffPartnerReport } from '../../core/api/partner-sales-api';
import { Icon } from '../../shared/icon';
import { partnerShortName } from '../../shared/partner-short-name';
import { count, euro } from '../partner/partner-format';
import { buyerLine, costsEur, productsShort, reportPieces } from '../partner/partner-report-format';
import { PartnerSalesDetail } from './partner-sales-detail';
import { reportedLine, soldDay, staffStatus } from './partner-sales-filters';
import { invoicesOf, reportTitle } from './partner-sales-format';

/**
 * The Veilingverkopen desk table: one row per melding, newest sold-on day
 * first, with a tick per row for the bulk bar, and one total row for the
 * whole filter. Columns fold by the card's width (v2-H): under 900 px ☐,
 * Datum, Melding (klant as sub), Producten, Netto, Status; from 900 Stuks,
 * Bruto, Kosten; from 1100 Terugkoop. A row opens in place (the detail with
 * Bewerken / Bevestigen / Intrekken). "Stuks" are pieces.
 */
@Component({
  selector: 'app-partner-sales-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, PartnerSalesDetail],
  template: `
    <div class="wk-card vv-card">
      <div class="wk-table vv-table" role="table" aria-label="Meldingen" [class.wk-table--selecting]="selected().size > 0">
        <div class="wk-thead" role="row">
          <span class="wk-th" role="columnheader">
            <input class="wk-check" type="checkbox" aria-label="Alle meldingen kiezen" [checked]="allChecked()" [indeterminate]="someChecked()"
                   (change)="checkAll()" /></span>
          <span class="wk-th" role="columnheader">Datum</span>
          <span class="wk-th" role="columnheader">Melding</span>
          <span class="wk-th" role="columnheader">Producten</span>
          <span class="wk-th wk-th--num vv-mid" role="columnheader">Stuks</span>
          <span class="wk-th wk-th--num vv-mid" role="columnheader">Bruto</span>
          <span class="wk-th wk-th--num vv-mid" role="columnheader">Kosten</span>
          <span class="wk-th wk-th--num vv-wide" role="columnheader">Terugkoop</span>
          <span class="wk-th wk-th--num" role="columnheader">Netto</span>
          <span class="wk-th" role="columnheader">Status</span>
          <span class="wk-th" role="columnheader"><span class="sr-only">Openen</span></span>
        </div>
        @for (r of reports(); track r.id) {
          @let pill = pillOf(r);
          @let pieces = piecesOf(r);
          @let open = expanded() === r.id;
          <div class="wk-tr vv-row" role="row" [id]="'vv-' + r.id" [attr.aria-selected]="selected().has(r.id)"
               [class.is-open]="open" [class.is-void]="r.status === 'VOIDED'" [class.is-flash]="flash() === r.id" (click)="toggled.emit(r.id)">
            <span class="wk-td vv-cell" role="cell">
              <input class="wk-check" type="checkbox" [checked]="selected().has(r.id)" [attr.aria-label]="r.number + ' kiezen'"
                     (click)="$event.stopPropagation()" (change)="check(r.id)" /></span>
            <span class="wk-td vv-cell" role="cell"><b class="vv-date">{{ day(r) }}</b><span class="vv-sub">{{ reported(r) }}</span></span>
            <span class="wk-td vv-cell" role="cell">
              <button class="vv-open" type="button" [attr.aria-expanded]="open" (click)="$event.stopPropagation(); toggled.emit(r.id)">{{ title(r) }}</button>
              @if (subOf(r); as sub) { <span class="vv-sub" [title]="sub">{{ sub }}</span> }</span>
            <span class="wk-td vv-cell" role="cell"><span class="vv-products" [title]="products(r)">{{ products(r) }}</span>
              @if (pieces.buyback > 0) { <span class="vv-sub vv-under-mid">{{ num(pieces.buyback) }} terug</span> }</span>
            <span class="wk-td wk-td--num vv-cell vv-num vv-mid" role="cell">{{ pieces.sale ? num(pieces.sale) : '—' }}
              @if (pieces.buyback > 0) { <span class="vv-sub">−{{ num(pieces.buyback) }} terug</span> }</span>
            <span class="wk-td wk-td--num vv-cell vv-num vv-mid" role="cell">{{ r.totals.saleQuantity ? eur(r.totals.grossEur) : '—' }}</span>
            <span class="wk-td wk-td--num vv-cell vv-num vv-mid" role="cell">{{ costs(r) ? eur(costs(r)) : '—' }}</span>
            <span class="wk-td wk-td--num vv-cell vv-num vv-wide" role="cell">{{ r.totals.buybackEur ? eur(r.totals.buybackEur) : '—' }}</span>
            <span class="wk-td wk-td--num vv-cell vv-total" role="cell">{{ eur(r.totals.netEur) }}</span>
            <span class="wk-td vv-cell" role="cell">
              <span class="wk-pill" [class]="pill.tone" [attr.title]="pillTitle(r)">@if (r.confirmed && r.status === 'OPEN') {<app-icon name="tick" [size]="11" />}{{ pill.label }}</span>
              @if (invoiceOf(r); as number) { <span class="vv-sub">{{ number }}</span> }</span>
            <span class="wk-td vv-chev" role="cell" aria-hidden="true"><app-icon [name]="open ? 'chevron-up' : 'chevron-down'" [size]="15" /></span>
          </div>
          @if (open) {
            <div class="vv-expand" role="row"><div role="cell" class="vv-expand__cell">
              <app-partner-sales-detail [report]="r" variant="desk" [busy]="busy()" [today]="today()" [canWrite]="canWrite()"
                                        (editAsked)="editAsked.emit($event)" (voidAsked)="voidAsked.emit($event)"
                                        (confirmAsked)="confirmAsked.emit($event)" (unconfirmAsked)="unconfirmAsked.emit($event)" />
            </div></div>
          }
        }
        @if (totals(); as t) {
          <div class="wk-tr wk-tr--total vv-sum" role="row">
            <span class="wk-td vv-cell vv-sum__label" role="cell">Totaal · {{ t.reports === 1 ? '1 melding' : num(t.reports) + ' meldingen' }}
              @if (totalsNote()) { <span class="vv-sub">{{ totalsNote() }}</span> }</span>
            <span class="wk-td wk-td--num vv-cell vv-num vv-mid" role="cell">{{ num(t.salePieces) }}</span>
            <span class="wk-td wk-td--num vv-cell vv-num vv-mid" role="cell">{{ eur(t.grossEur) }}</span>
            <span class="wk-td wk-td--num vv-cell vv-num vv-mid" role="cell">{{ eur(t.costsEur) }}</span>
            <span class="wk-td wk-td--num vv-cell vv-num vv-wide" role="cell">{{ eur(t.buybackEur) }}</span>
            <span class="wk-td wk-td--num vv-cell vv-total" role="cell">{{ eur(t.netEur) }}</span>
            <span class="wk-td" role="cell"></span>
            <span class="wk-td" role="cell"></span>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    :host{display:block;min-width:0}
    /* No overflow on the card: a clipping card would be the head's sticky box (the subbar fix). */
    .vv-card{container:vv/inline-size}
    .vv-card .wk-thead{border-radius:15px 15px 0 0}
    .vv-table{--wk-gap:10px;--wk-pad-x:14px;
      --wk-cols:16px 118px minmax(112px,140px) minmax(0,1fr) 96px 120px 16px}
    .vv-mid,.vv-wide{display:none!important}
    .vv-sum__label{grid-column:span 4}
    @container vv (min-width:900px){
      .vv-table{--wk-cols:16px 118px 132px minmax(0,1fr) 56px 88px 78px 96px 118px 16px}
      .vv-mid{display:grid!important}
      .wk-th.vv-mid{display:flex!important}
      .vv-under-mid{display:none}
    }
    @container vv (min-width:1100px){
      .vv-table{--wk-cols:16px 118px 140px minmax(0,1fr) 60px 92px 80px 84px 100px 124px 16px}
      .vv-wide{display:grid!important}
      .wk-th.vv-wide{display:flex!important}
    }
    .vv-row{min-height:52px;cursor:pointer}
    .vv-row:hover{background:color-mix(in srgb,var(--surface-2) 60%,var(--surface))}
    .vv-row.is-open{background:var(--surface-2);border-bottom-color:transparent}
    .vv-cell{display:grid;align-content:center;justify-items:start;gap:2px;min-width:0;padding-block:8px}
    .vv-num{justify-items:end;font-size:13px;font-weight:600}
    .vv-total{justify-items:end;font-size:14px;font-weight:720;white-space:nowrap}
    .vv-date{font-size:13px;font-weight:650;white-space:nowrap}
    .vv-open{max-width:100%;min-height:0;padding:0;overflow:hidden;border:0;background:none;color:var(--ink);font:inherit;font-size:13.5px;font-weight:650;text-align:left;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
    .vv-open:focus-visible{outline:2px solid var(--rose-dark);outline-offset:2px;border-radius:4px}
    .vv-products{max-width:100%;overflow:hidden;font-size:13px;text-overflow:ellipsis;white-space:nowrap}
    .vv-sub{max-width:100%;overflow:hidden;color:var(--muted);font-size:11.5px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
    .vv-cell .wk-pill{max-width:100%;overflow:hidden;text-overflow:ellipsis}
    .vv-chev{display:grid;place-items:center;color:var(--muted-2)}
    .is-void .vv-open,.is-void .vv-total,.is-void .vv-products{color:var(--muted);text-decoration:line-through}
    .vv-expand{border-bottom:1px solid var(--line)}
    .vv-expand__cell{min-width:0}
    .vv-sum{min-height:46px;border-radius:0 0 15px 15px;border-bottom:0}
    .vv-sum__label{font-size:13px}
    @keyframes vv-flash{from{background:var(--rose-soft)}to{background:var(--surface)}}
    .is-flash{animation:vv-flash 2.4s ease-out}
    @media (prefers-reduced-motion:reduce){.is-flash{animation:none;background:var(--rose-soft)}}
  `,
})
export class PartnerSalesTable {
  readonly reports = input.required<readonly StaffPartnerReport[]>();
  readonly today = input.required<string>();
  readonly selected = input<ReadonlySet<number>>(new Set());
  readonly expanded = input<number | null>(null);
  readonly flash = input<number | null>(null);
  readonly totals = input<PartnerSalesFilteredTotals | null>(null);
  /** Said under the total when it is not the whole filter (a search, or more than the list holds). */
  readonly totalsNote = input<string | null>(null);
  /** The partner's name under the melding while several partners are listed. */
  readonly showCustomer = input(false);
  readonly busy = input(false);
  /** A round-2 server: Bewerken, Bevestigen and Terugzetten can be sent. */
  readonly canWrite = input(true);

  readonly toggled = output<number>();
  readonly selectionChange = output<ReadonlySet<number>>();
  readonly editAsked = output<StaffPartnerReport>();
  readonly voidAsked = output<StaffPartnerReport>();
  readonly confirmAsked = output<StaffPartnerReport>();
  readonly unconfirmAsked = output<StaffPartnerReport>();

  readonly allChecked = computed(() => this.reports().length > 0 && this.reports().every((r) => this.selected().has(r.id)));
  readonly someChecked = computed(() => !this.allChecked() && this.reports().some((r) => this.selected().has(r.id)));

  /** Ticks given before the host's answer came back (two quick clicks) build on each other. */
  private pending: ReadonlySet<number> | null = null;

  constructor() {
    effect(() => { this.selected(); this.pending = null; });
  }

  check(id: number): void {
    const next = new Set(this.pending ?? this.selected());
    if (next.has(id)) next.delete(id); else next.add(id);
    this.pending = next;
    this.selectionChange.emit(next);
  }

  checkAll(): void {
    this.selectionChange.emit(this.allChecked() ? new Set() : new Set(this.reports().map((r) => r.id)));
  }

  title(r: StaffPartnerReport): string { return reportTitle(r); }
  day(r: StaffPartnerReport): string { return soldDay(r.soldOn, this.today()); }
  reported(r: StaffPartnerReport): string { return reportedLine(r, this.today()); }
  products(r: StaffPartnerReport): string { return productsShort(r); }
  costs(r: StaffPartnerReport): number { return costsEur(r.totals); }
  piecesOf(r: StaffPartnerReport): { sale: number; buyback: number } { return reportPieces(r); }

  /** Under the melding: the buyer of a direct sale, else the partner while several are listed. */
  subOf(r: StaffPartnerReport): string {
    const buyer = buyerLine(r);
    if (buyer) return buyer;
    if (r.channel === 'DIRECT') return 'geen klant';
    return this.showCustomer() ? partnerShortName(r.customerName) : '';
  }

  pillOf(r: StaffPartnerReport): { label: string; tone: string } {
    return staffStatus(r, null);
  }

  /** "F-2026-0007" under Gefactureerd when the melding went on one document. */
  invoiceOf(r: StaffPartnerReport): string | null {
    if (r.status !== 'INVOICED' && r.status !== 'PARTLY_INVOICED') return null;
    const invoices = invoicesOf(r);
    return invoices.length === 1 ? invoices[0].number : invoices.length > 1 ? `${invoices.length} documenten` : null;
  }

  pillTitle(r: StaffPartnerReport): string | null {
    if (!r.confirmed || r.status !== 'OPEN') return null;
    return r.confirmedByName ? `Bevestigd door ${r.confirmedByName}` : 'Bevestigd';
  }

  eur(value: number): string { return euro(value); }
  num(value: number): string { return count(value); }
}
