import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { messageOf } from '../../core/api/errors';
import {
  PartnerInvoiceResult, PartnerSalesApi, PartnerSalesOpenTotals, PartnerSalesPartnerSummary, PartnerSalesStatusFilter,
  StaffPartnerReport, StaffPartnerReportResult, isMissingEndpoint,
} from '../../core/api/partner-sales-api';
import type { PartnerReportStatus } from '../../core/api/partner-portal-api';
import { WorkQueue } from '../../core/api/work-queue';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { LoadError } from '../../shared/load-error';
import { PageHeader } from '../../shared/page-header';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui } from '../../shared/ui';
import { count, dayLabel, euro, localToday, productsLine } from '../partner/partner-format';
import { PartnerSalesDetail } from './partner-sales-detail';
import { PartnerSalesEntrySheet } from './partner-sales-entry-sheet';
import {
  costsOf, groupByDay, quantityText, reportTitle, singleAverage, statusPill, timeOf, whoOf,
} from './partner-sales-format';
import { PartnerSalesInvoiceSheet } from './partner-sales-invoice-sheet';

const PAGE_SIZE = 100;
/** How many further pages a ?melding= link may load to find its melding. */
const FIND_PAGES = 5;

const FILTERS: { id: PartnerSalesStatusFilter; label: string }[] = [
  { id: 'OPEN', label: 'Open' }, { id: 'INVOICED', label: 'Gefactureerd' }, { id: 'ALL', label: 'Alles' },
];

/** The phone's one word beside the tinted netto. */
const PHONE_STATUS: Record<PartnerReportStatus, string> = {
  OPEN: 'Open', PARTLY_INVOICED: 'Deels', INVOICED: 'Gefactureerd', VOIDED: 'Ingetrokken',
};

/**
 * Veilingverkopen (/veilingverkopen): what the partner (Verhoeven) reported
 * sold on the clock or directly and bought back, kept as meldingen (VV-…)
 * until staff invoice them. Desk: the open sum in the subbar, Open /
 * Gefactureerd / Alles, the meldingen by day in one kit table; a row opens
 * in place with its products, costs and parts per source. Phone: the same
 * as an iOS list, a melding opens in a sheet. Factureren makes the concepts
 * of one partner (a sheet with the server's preview); Melding toevoegen
 * types in what Frans phoned in; Intrekken books the pieces back, with a
 * reason. ?melding=<id> (the bell, a push, the Logboek) shows that one.
 */
@Component({
  selector: 'app-partner-sales-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, LoadError, PageHeader, PartnerSalesDetail, PartnerSalesEntrySheet, PartnerSalesInvoiceSheet, Segmented, Sheet, Skeleton],
  template: `
    <app-page-header title="Veilingverkopen">
      @if (desk.active()) {
        <button class="wk-btn wk-btn--sm" type="button" [disabled]="missing()" (click)="entryOpen.set(true)">
          <app-icon name="plus" [size]="15" />Melding toevoegen</button>
        <button class="btn btn--primary btn--sm" type="button" [disabled]="!canInvoice()" (click)="invoiceOpen.set(true)">Factureren…</button>
      } @else {
        <button class="btn btn--icon-mobile" type="button" aria-label="Melding toevoegen" [disabled]="missing()" (click)="entryOpen.set(true)">
          <app-icon name="plus" [size]="20" /></button>
      }
    </app-page-header>

    <div class="content vv" [class.vv--phone]="!desk.active()">
      @if (desk.active()) {
        <div #subbar class="wk-subbar vv-subbar">
          <div class="wk-chips" role="group" aria-label="Filter op status">
            @for (option of filters; track option.id) {
              <button class="wk-chip" type="button" [attr.aria-pressed]="filter() === option.id" (click)="setFilter(option.id)">{{ option.label }}
                @if (option.id === 'OPEN' && totals(); as t) { <span class="wk-seg__count">{{ t.openReports }}</span> }</button>
            }
          </div>
          @if (partnerChoices().length > 1) {
            <label class="wk-chip vv-select" [class.is-on]="customer() != null">
              <span class="vv-select__label">{{ customerName() || 'Alle partners' }}</span><app-icon name="chevron-down" [size]="13" />
              <select class="vv-select__native" aria-label="Partner" [value]="customer() ?? ''" (change)="setCustomer($any($event.target).value)">
                <option value="">Alle partners</option>
                @for (partner of partnerChoices(); track partner.customerId) { <option [value]="partner.customerId">{{ partner.customerName }}</option> }
              </select>
            </label>
          }
          <span class="wk-subbar__end">@if (totals(); as t) {@if (t.openReports > 0) {<b>{{ eur(t.openNetEur) }}</b> nog te factureren · {{ plural(t.openReports, 'melding', 'meldingen') }} · {{ num(t.openSaleQuantity) }} st} @else {Alles gefactureerd}}</span>
        </div>
      } @else {
        @if (totals(); as t) {
          @if (t.openReports > 0) {
            <div class="ios-card vv-sum">
              <span class="vv-sum__label">Nog te factureren</span>
              <b class="vv-sum__value">{{ eur(t.openNetEur) }}</b>
              <span class="vv-sum__sub">{{ plural(t.openReports, 'melding', 'meldingen') }} · {{ num(t.openSaleQuantity) }} st</span>
              <button class="ios-capsule ios-capsule--accent ios-capsule--block vv-sum__go" type="button" (click)="invoiceOpen.set(true)">Factureren</button>
            </div>
          }
        }
        <app-segmented class="vv-iseg" variant="ios" label="Filter op status" [options]="filterOptions()" [value]="filter()"
                       (changed)="setFilter($any($event))" />
        @if (partnerChoices().length > 1) {
          <div class="ios-chips" role="group" aria-label="Partner">
            <button class="ios-chip" type="button" [attr.aria-pressed]="customer() == null" (click)="setCustomer('')">Alle</button>
            @for (partner of partnerChoices(); track partner.customerId) {
              <button class="ios-chip" type="button" [attr.aria-pressed]="customer() === partner.customerId" (click)="setCustomer('' + partner.customerId)">{{ partner.customerName }}</button>
            }
          </div>
        }
      }

      @if (missing()) {
        <div [class.wk-card]="desk.active()">
          <div [class.wk-empty]="desk.active()" [class.ios-empty]="!desk.active()">
            <span [class.wk-empty__icon]="desk.active()" [class.ios-empty__icon]="!desk.active()" aria-hidden="true"><app-icon name="arrow-in" [size]="22" /></span>
            <p [class.wk-empty__title]="desk.active()" [class.ios-empty__title]="!desk.active()">Nog niet beschikbaar</p>
            <p [class.wk-empty__text]="desk.active()" [class.ios-empty__text]="!desk.active()">De server kent de veilingverkopen nog niet.</p>
          </div>
        </div>
      } @else if (error() && !loaded()) {
        <div [class.wk-card]="desk.active()"><app-load-error title="Veilingverkopen konden niet worden geladen" [message]="error()" [busy]="loading()" (retry)="load()" /></div>
      } @else if (!loaded()) {
        <div [class.wk-card]="desk.active()" role="status" aria-label="Meldingen laden"><app-skeleton [kind]="desk.active() ? 'table' : 'group'" [rows]="6" /></div>
      } @else if (!days().length) {
        <div [class.wk-card]="desk.active()">
          <div [class.wk-empty]="desk.active()" [class.ios-empty]="!desk.active()">
            <span [class.wk-empty__icon]="desk.active()" [class.ios-empty__icon]="!desk.active()" aria-hidden="true"><app-icon name="arrow-in" [size]="22" /></span>
            <p [class.wk-empty__title]="desk.active()" [class.ios-empty__title]="!desk.active()">{{ filter() === 'OPEN' ? 'Alles gefactureerd' : 'Geen meldingen' }}</p>
            <p [class.wk-empty__text]="desk.active()" [class.ios-empty__text]="!desk.active()">Wat de partner meldt, komt hier.</p>
          </div>
        </div>
      } @else if (desk.active()) {
        @if (error(); as message) { <p class="vv-error" role="alert">{{ message }}</p> }
        <div class="wk-card vv-card">
          <div class="wk-table vv-table" role="table" aria-label="Meldingen">
            <div class="wk-thead" role="row">
              <span class="wk-th" role="columnheader">Melding</span>
              <span class="wk-th" role="columnheader">Producten</span>
              <span class="wk-th wk-th--num" role="columnheader">Stuks</span>
              <span class="wk-th wk-th--num vv-wide" role="columnheader">Gem. prijs</span>
              <span class="wk-th wk-th--num vv-mid" role="columnheader">Bruto</span>
              <span class="wk-th wk-th--num vv-mid" role="columnheader">Kosten</span>
              <span class="wk-th wk-th--num vv-wide" role="columnheader">Terugkoop</span>
              <span class="wk-th wk-th--num" role="columnheader">Netto</span>
              <span class="wk-th" role="columnheader">Status</span>
              <span class="wk-th" role="columnheader"><span class="sr-only">Openen</span></span>
            </div>
            @for (day of days(); track day.day) {
              <div class="wk-group" role="row">
                <span class="wk-group__label" role="rowheader"><span class="vv-day">{{ dayText(day.day) }}</span>
                  <span class="wk-group__count">· {{ plural(day.reports.length, 'melding', 'meldingen') }} · {{ eur(day.netEur) }}</span></span>
              </div>
              @for (r of day.reports; track r.id) {
                @let pill = pillOf(r);
                <button class="wk-tr vv-row" type="button" role="row" [id]="'vv-' + r.id" [attr.aria-expanded]="expanded() === r.id"
                        [class.is-void]="r.status === 'VOIDED'" [class.is-flash]="flash() === r.id" (click)="toggle(r.id)">
                  <span class="wk-td vv-cell" role="cell"><b class="vv-name">{{ title(r) }}</b><span class="vv-sub">{{ who(r) }}</span></span>
                  <span class="wk-td vv-cell" role="cell"><span class="vv-products">{{ products(r) }}</span>
                    @if (showCustomer()) { <span class="vv-sub">{{ r.customerName }}</span> }</span>
                  <span class="wk-td wk-td--num vv-cell vv-num" role="cell">{{ num(r.totals.saleQuantity) }}
                    @if (r.totals.buybackQuantity > 0) { <span class="vv-sub">−{{ num(r.totals.buybackQuantity) }} terug</span> }</span>
                  <span class="wk-td wk-td--num vv-cell vv-num vv-wide" role="cell">{{ average(r) }}</span>
                  <span class="wk-td wk-td--num vv-cell vv-num vv-mid" role="cell">{{ r.totals.saleQuantity ? eur(r.totals.grossEur) : '—' }}</span>
                  <span class="wk-td wk-td--num vv-cell vv-num vv-mid" role="cell">{{ costs(r) ? eur(costs(r)) : '—' }}</span>
                  <span class="wk-td wk-td--num vv-cell vv-num vv-wide" role="cell">{{ r.totals.buybackEur ? eur(r.totals.buybackEur) : '—' }}</span>
                  <span class="wk-td wk-td--num vv-cell vv-total" role="cell">{{ eur(r.totals.netEur) }}</span>
                  <span class="wk-td vv-cell" role="cell"><span class="wk-pill" [class]="pill.tone">{{ pill.label }}</span></span>
                  <span class="wk-td vv-chev" role="cell" aria-hidden="true"><app-icon [name]="expanded() === r.id ? 'chevron-up' : 'chevron-down'" [size]="15" /></span>
                </button>
                @if (expanded() === r.id) {
                  <div class="vv-expand" role="row"><div role="cell" class="vv-expand__cell">
                    <app-partner-sales-detail [report]="r" variant="desk" [busy]="voidBusy()" (voidAsked)="askVoid($event)" />
                  </div></div>
                }
              }
            }
          </div>
        </div>
        @if (more()) {
          <div class="vv-more"><button class="wk-btn" type="button" [disabled]="loading()" (click)="loadMore()">{{ loading() ? 'Laden…' : 'Meer meldingen' }}</button></div>
        }
      } @else {
        @if (error(); as message) { <div class="ios-banner" role="alert"><span>{{ message }}</span></div> }
        @for (day of days(); track day.day) {
          <section class="ios-section">
            <div class="ios-section__head"><span class="vv-ihead" role="heading" aria-level="2">{{ dayText(day.day) }}</span>
              <span class="ios-section__trail">{{ eur(day.netEur) }}</span></div>
            <div class="ios-group">
              @for (r of day.reports; track r.id) {
                <button class="ios-cell vv-prow" type="button" [id]="'vv-' + r.id" [class.is-flash]="flash() === r.id" [class.is-void]="r.status === 'VOIDED'" (click)="openSheet(r.id)">
                  <span class="ios-cell__body">
                    <span class="vv-ptitle">{{ title(r) }}</span>
                    <span class="vv-psub">{{ products(r) }} · {{ quantity(r) }}@if (showCustomer()) { · {{ r.customerName }} }</span>
                  </span>
                  <span class="ios-cell__trail">
                    <span class="vv-pfig" [class]="phoneTone(r)">{{ eur(r.totals.netEur) }}</span>
                    <span class="vv-pstate">{{ phoneStatus(r) }}</span>
                  </span>
                </button>
              }
            </div>
          </section>
        }
        @if (more()) {
          <div class="vv-imore"><button class="ios-capsule ios-capsule--tinted ios-capsule--block" type="button" [disabled]="loading()" (click)="loadMore()">{{ loading() ? 'Laden…' : 'Meer meldingen' }}</button></div>
        }
      }
    </div>

    @if (!desk.active() && sheetReport(); as r) {
      <app-sheet variant="ios" [title]="r.number" (closed)="opened.set(null)">
        <div body><app-partner-sales-detail [report]="r" variant="ios" /></div>
        <div foot class="vv-sheet-foot">
          @if (r.status === 'OPEN') {
            <button class="ios-capsule ios-capsule--block ios-capsule--danger" type="button" [disabled]="!r.canUndo || voidBusy()" (click)="askVoid(r)">Intrekken</button>
            @if (!r.canUndo) { <p class="vv-sheet-hint">Een terugkoop hoort bij deze verkoop: trek eerst die terugkoop in.</p> }
          } @else {
            <button class="ios-capsule ios-capsule--block" type="button" (click)="opened.set(null)">Sluiten</button>
          }
        </div>
      </app-sheet>
    }

    @if (voiding(); as r) {
      <app-sheet [title]="r.number + ' intrekken'" [variant]="desk.active() ? 'default' : 'ios'" (closed)="closeVoid()">
        <div body class="vv-void" [class.vv-void--ios]="!desk.active()">
          <p>De stuks komen terug op de voorraad. De melding blijft zichtbaar als Ingetrokken.</p>
          <label class="field vv-void__field"><span>Waarom?</span>
            <input class="input" type="text" maxlength="200" autocomplete="off" data-initial-focus [value]="voidReason()"
                   (input)="voidReason.set($any($event.target).value)" (keydown.enter)="confirmVoid()" placeholder="bv. dubbel gemeld" /></label>
          @if (voidError(); as message) { <p class="vv-error" role="alert">{{ message }}</p> }
        </div>
        <div foot class="vv-void__actions">
          <button class="btn" type="button" [disabled]="voidBusy()" (click)="closeVoid()">Annuleren</button>
          <button class="btn btn--primary vv-danger" type="button" [disabled]="voidBusy() || !voidReason().trim()" (click)="confirmVoid()">
            {{ voidBusy() ? 'Bezig…' : 'Intrekken' }}</button>
        </div>
      </app-sheet>
    }

    @if (invoiceOpen()) {
      <app-partner-sales-invoice-sheet [partners]="invoicePartners()" [initialCustomerId]="customer()"
                                       (created)="invoiced($event)" (closed)="invoiceOpen.set(false)" />
    }
    @if (entryOpen()) {
      <app-partner-sales-entry-sheet [initialCustomerId]="customer()" (saved)="entered($event)" (closed)="entryOpen.set(false)" />
    }
  `,
  styles: `
    :host{display:block;min-width:0}
    .vv-subbar{flex-wrap:wrap;row-gap:6px;padding-block:4px}
    .vv-subbar .wk-subbar__end b{color:var(--ink);font-weight:700}
    .vv-select{position:relative;max-width:220px}
    .vv-select__label{min-width:0;overflow:hidden;text-overflow:ellipsis}
    .vv-select__native{position:absolute;inset:0;width:100%;height:100%;opacity:0;font:inherit;cursor:pointer}
    .vv-select:has(>.vv-select__native:focus-visible){outline:2px solid var(--rose);outline-offset:2px}
    /* No overflow on the card: a clipping card would be the head's sticky box, and the head (top = the app bar + this
       subbar) would sit that far down inside the rows. The head rounds its own top corners instead. */
    .vv-subbar~*{--wk-sticky-top:calc(var(--appbar-h,0px) + var(--vv-subbar-h,var(--wk-subbar-h,48px)))}
    .vv-card{container:vv/inline-size}
    .vv-card .wk-thead{border-radius:15px 15px 0 0}
    .vv-table{--wk-cols:minmax(120px,150px) minmax(0,1fr) 64px 100px 156px 20px}
    .vv-mid,.vv-wide{display:none!important}
    @container vv (min-width:900px){
      .vv-table{--wk-cols:150px minmax(0,1fr) 64px 92px 84px 100px 156px 20px}
      .vv-mid{display:grid!important}
      .wk-th.vv-mid{display:flex!important}
    }
    @container vv (min-width:1100px){
      .vv-table{--wk-cols:150px minmax(0,1fr) 64px 84px 92px 84px 84px 100px 168px 20px}
      .vv-wide{display:grid!important}
      .wk-th.vv-wide{display:flex!important}
    }
    .vv-day{color:var(--ink);font-weight:700}
    .vv-row{width:100%;min-height:52px;padding-block:0;border-inline:0;border-top:0;font:inherit;text-align:left;cursor:pointer}
    .vv-row:hover{background:color-mix(in srgb,var(--surface-2) 60%,var(--surface))}
    .vv-row[aria-expanded=true]{background:var(--surface-2);border-bottom-color:transparent}
    .vv-row:focus-visible{outline:2px solid var(--rose-dark);outline-offset:-2px}
    .vv-cell{display:grid;align-content:center;justify-items:start;gap:2px;min-width:0;padding-block:8px}
    .vv-num{justify-items:end;font-size:13px;font-weight:600}
    .vv-total{justify-items:end;font-size:14px;font-weight:720;white-space:nowrap}
    .vv-name{font-size:13.5px;font-weight:650;white-space:nowrap}
    .vv-products{max-width:100%;overflow:hidden;font-size:13px;text-overflow:ellipsis;white-space:nowrap}
    .vv-sub{max-width:100%;overflow:hidden;color:var(--muted);font-size:12px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
    .vv-cell .wk-pill{max-width:100%;height:auto;min-height:20px;padding-block:2px;line-height:1.3;white-space:normal}
    .vv-chev{display:grid;place-items:center;color:var(--muted-2)}
    .is-void .vv-name,.is-void .vv-total,.is-void .vv-products{color:var(--muted);text-decoration:line-through}
    .vv-expand{border-bottom:1px solid var(--line)}
    .vv-expand__cell{min-width:0}
    .vv-more{display:flex;justify-content:center;margin-top:12px}
    .vv-error{margin:0 0 10px;color:var(--danger);font-size:13px;font-weight:600}
    @keyframes vv-flash{from{background:var(--rose-soft)}to{background:var(--surface)}}
    .is-flash{animation:vv-flash 2.4s ease-out}
    @media (prefers-reduced-motion:reduce){.is-flash{animation:none;background:var(--rose-soft)}}
    .vv-sum{display:grid;gap:2px}
    .vv-sum__label{color:var(--muted);font-size:13px;font-weight:600}
    .vv-sum__value{font-size:28px;font-weight:750;letter-spacing:-.025em;font-variant-numeric:tabular-nums}
    .vv-sum__sub{color:var(--muted);font-size:14px}
    .vv-sum__go{margin-top:12px}
    .vv-iseg{display:grid;margin:0 var(--ios-inset,16px) 12px}
    .vv-ihead{color:var(--muted);font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.03em}
    .vv-prow{min-height:64px}
    .vv-ptitle{overflow:hidden;font-size:16px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
    .vv-psub{overflow:hidden;color:var(--muted);font-size:13.5px;text-overflow:ellipsis;white-space:nowrap}
    .vv-pfig{padding:3px 10px;border-radius:999px;background:color-mix(in srgb,var(--tone,var(--muted)) 14%,var(--surface));color:color-mix(in srgb,var(--tone,var(--muted)) 85%,var(--ink));font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
    .vv-pstate{color:var(--muted);font-size:12.5px;white-space:nowrap}
    .vv-prow.is-void .vv-pfig{text-decoration:line-through}
    .vv-imore{margin:0 var(--ios-inset,16px) 16px}
    .vv-sheet-foot{display:grid;gap:8px;width:100%}
    .vv-sheet-hint{margin:0;color:var(--muted);font-size:13px;text-align:center}
    .vv-void{display:grid;gap:12px}
    .vv-void--ios{padding:0 var(--ios-inset,16px)}
    .vv-void p{margin:0;color:var(--ink-2);font-size:14px;line-height:1.45}
    .vv-void__field{display:grid;gap:6px;margin:0}
    .vv-void__actions{display:flex;justify-content:flex-end;gap:10px;width:100%}
    .vv-danger{border-color:var(--danger);background:var(--danger)}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      .vv-void .input{min-height:48px;font-size:16px}
      .vv-void__actions .btn{flex:1;min-height:48px}
    }
  `,
})
export class PartnerSalesPage {
  private readonly api = inject(PartnerSalesApi);
  private readonly work = inject(WorkQueue);
  private readonly ui = inject(Ui);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  readonly desk = inject(DesktopViewport);

  readonly filters = FILTERS;
  readonly today = localToday();

  readonly filter = signal<PartnerSalesStatusFilter>('OPEN');
  readonly customer = signal<number | null>(null);
  readonly reports = signal<StaffPartnerReport[]>([]);
  readonly more = signal(false);
  readonly totals = signal<PartnerSalesOpenTotals | null>(null);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  readonly missing = signal(false);

  readonly expanded = signal<number | null>(null);
  readonly opened = signal<number | null>(null);
  readonly flash = signal<number | null>(null);
  readonly invoiceOpen = signal(false);
  readonly entryOpen = signal(false);

  readonly voiding = signal<StaffPartnerReport | null>(null);
  readonly voidReason = signal('');
  readonly voidBusy = signal(false);
  readonly voidError = signal<string | null>(null);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly subbar = viewChild<ElementRef<HTMLElement>>('subbar');
  private run = 0;
  /** The melding a ?melding= link asked for, until it is shown. */
  private wanted: number | null = null;
  /** The summary's last melding when the list was read: a newer one (a push, the bell's refresh) reads the list again. */
  private seenLastReportAt: string | null | undefined = undefined;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  readonly days = computed(() => groupByDay(this.reports()));
  readonly sheetReport = computed(() => this.reports().find((report) => report.id === this.opened()) ?? null);

  /** The partners the filter offers: the summary's, plus a filtered one that is not (yet) in it. */
  readonly partnerChoices = computed<PartnerSalesPartnerSummary[]>(() => this.work.partnerSales()?.partners ?? []);
  readonly customerName = computed(() => this.partnerChoices().find((partner) => partner.customerId === this.customer())?.customerName ?? '');
  /** The partner's name on each row only while several partners are listed together. */
  readonly showCustomer = computed(() => this.customer() == null && new Set(this.reports().map((report) => report.customerId)).size > 1);

  readonly filterOptions = computed<SegmentOption[]>(() => FILTERS.map((option) => ({
    id: option.id, label: option.label, count: option.id === 'OPEN' ? this.totals()?.openReports ?? null : null,
  })));

  readonly canInvoice = computed(() => !this.missing() && (this.totals()?.openReports ?? this.work.partnerSales()?.openReports ?? 0) > 0);

  /** Who Factureren offers: the partners with open meldingen (the summary), else those seen on this page. */
  readonly invoicePartners = computed<PartnerSalesPartnerSummary[]>(() => {
    const fromSummary = (this.work.partnerSales()?.partners ?? []).filter((partner) => partner.openReports > 0);
    if (fromSummary.length) return fromSummary;
    const seen = new Map<number, PartnerSalesPartnerSummary>();
    for (const report of this.reports()) {
      if (report.status !== 'OPEN' && report.status !== 'PARTLY_INVOICED') continue;
      const partner = seen.get(report.customerId) ?? { customerId: report.customerId, customerName: report.customerName,
        openReports: 0, openSaleQuantity: 0, openNetEur: 0, lastReportAt: null };
      partner.openReports++;
      seen.set(report.customerId, partner);
    }
    return [...seen.values()];
  });

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const id = Number(params.get('melding'));
      if (Number.isSafeInteger(id) && id > 0) {
        this.wanted = id;
        this.filter.set('ALL');
        this.customer.set(null);
        void this.load();
      } else if (!this.loaded() && !this.loading()) {
        void this.load();
      }
    });
    /* A newer melding than the list knows (the queue refreshed on a push or on focus): read the list again. */
    effect(() => {
      const last = this.work.partnerSales()?.lastReportAt;
      untracked(() => {
        if (this.seenLastReportAt === undefined || last === undefined || last === this.seenLastReportAt) return;
        if (this.loading() || this.voidBusy()) return;
        void this.load(true);
      });
    });
    void this.work.refresh();
    /* The table head sticks under the subbar's measured height when the subbar wraps (TICA's --tl-subbar-h). */
    effect((onCleanup) => {
      const bar = this.subbar()?.nativeElement;
      if (!bar || typeof ResizeObserver !== 'function') return;
      const host = this.host.nativeElement;
      const observer = new ResizeObserver(() => host.style.setProperty('--vv-subbar-h', `${bar.offsetHeight}px`));
      observer.observe(bar);
      onCleanup(() => { observer.disconnect(); host.style.removeProperty('--vv-subbar-h'); });
    });
    inject(DestroyRef).onDestroy(() => { this.run++; if (this.flashTimer) clearTimeout(this.flashTimer); });
  }

  setFilter(filter: PartnerSalesStatusFilter): void {
    if (filter === this.filter()) return;
    this.filter.set(filter);
    this.expanded.set(null);
    void this.load();
  }

  setCustomer(value: string): void {
    const id = value === '' ? null : Number(value);
    const next = id != null && Number.isSafeInteger(id) ? id : null;
    if (next === this.customer()) return;
    this.customer.set(next);
    this.expanded.set(null);
    void this.load();
  }

  /** The first page again; `quiet` keeps the shown rows and the open one while it reads. */
  async load(quiet = false): Promise<void> {
    const run = ++this.run;
    this.loading.set(true);
    if (!quiet) this.error.set(null);
    const lastSeen = this.work.partnerSales()?.lastReportAt ?? null;
    try {
      const page = await this.api.reports({ customerId: this.customer(), status: this.filter(), limit: PAGE_SIZE });
      if (run !== this.run) return;
      this.reports.set(page.reports);
      this.more.set(page.more);
      this.totals.set(page.totals ?? null);
      this.missing.set(false);
      this.error.set(null);
      this.loaded.set(true);
      this.seenLastReportAt = lastSeen;
      await this.findWanted(run);
    } catch (failure: unknown) {
      if (run !== this.run) return;
      if (isMissingEndpoint(failure)) { this.missing.set(true); this.loaded.set(true); return; }
      this.error.set(messageOf(failure, 'De meldingen konden niet worden geladen.'));
    } finally {
      if (run === this.run) this.loading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    const last = this.reports().at(-1);
    if (!last || this.loading()) return;
    const run = ++this.run;
    this.loading.set(true);
    try {
      const page = await this.api.reports({ customerId: this.customer(), status: this.filter(), before: last.id, limit: PAGE_SIZE });
      if (run !== this.run) return;
      this.reports.update((list) => [...list, ...page.reports.filter((report) => !list.some((known) => known.id === report.id))]);
      this.more.set(page.more);
      if (page.totals) this.totals.set(page.totals);
    } catch (failure: unknown) {
      if (run === this.run) this.error.set(messageOf(failure, 'Meer meldingen laden lukt nu niet.'));
    } finally {
      if (run === this.run) this.loading.set(false);
    }
  }

  /** A ?melding= link: page on until it shows (a few pages at most), then open it, and drop the parameter. */
  private async findWanted(run: number): Promise<void> {
    const id = this.wanted;
    if (id == null) return;
    for (let page = 0; page < FIND_PAGES && !this.reports().some((report) => report.id === id) && this.more(); page++) {
      const last = this.reports().at(-1)!;
      const next = await this.api.reports({ status: 'ALL', before: last.id, limit: PAGE_SIZE });
      if (run !== this.run) return;
      this.reports.update((list) => [...list, ...next.reports]);
      this.more.set(next.more);
    }
    this.wanted = null;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { melding: null }, queryParamsHandling: 'merge', replaceUrl: true });
    if (!this.reports().some((report) => report.id === id)) { this.ui.toast(`VV-${id} staat niet in de lijst`, 'err'); return; }
    this.show(id);
  }

  /** Opens one melding and lights its row for a moment. */
  private show(id: number): void {
    if (this.desk.active()) this.expanded.set(id); else this.opened.set(id);
    this.flash.set(id);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flash.set(null), 2600);
    setTimeout(() => this.document.getElementById(`vv-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
  }

  toggle(id: number): void {
    this.expanded.update((open) => (open === id ? null : id));
  }

  openSheet(id: number): void {
    this.opened.set(id);
  }

  askVoid(report: StaffPartnerReport): void {
    this.voidReason.set('');
    this.voidError.set(null);
    this.voiding.set(report);
  }

  closeVoid(): void {
    if (this.voidBusy()) return;
    this.voiding.set(null);
  }

  async confirmVoid(): Promise<void> {
    const report = this.voiding();
    const reason = this.voidReason().trim();
    if (!report || !reason || this.voidBusy()) return;
    this.voidBusy.set(true);
    this.voidError.set(null);
    try {
      const updated = await this.api.voidReport(report.id, reason);
      this.reports.update((list) => list.map((known) => (known.id === updated.id ? updated : known)));
      this.voiding.set(null);
      this.ui.toast(`${report.number} ingetrokken`);
      void this.work.refresh(true);
      void this.load(true);
    } catch (failure: unknown) {
      this.voidError.set(messageOf(failure, 'Intrekken lukt nu niet.'));
    } finally {
      this.voidBusy.set(false);
    }
  }

  invoiced(result: PartnerInvoiceResult): void {
    const made = result.invoices.length;
    if (made) this.ui.toast(made === 1 ? '1 concept gemaakt' : `${made} concepten gemaakt`);
    void this.work.refresh(true);
    void this.load(true);
  }

  entered(result: StaffPartnerReportResult): void {
    void this.work.refresh(true);
    /* Show the new melding: every partner, every status, opened and lit. */
    this.wanted = result.report.id;
    this.filter.set('ALL');
    this.customer.set(null);
    void this.load();
  }

  title(report: StaffPartnerReport): string { return reportTitle(report); }
  products(report: StaffPartnerReport): string { return productsLine(report); }
  pillOf(report: StaffPartnerReport): { label: string; tone: string } { return statusPill(report); }
  costs(report: StaffPartnerReport): number { return costsOf(report); }

  /** "Frans · 14:05". */
  who(report: StaffPartnerReport): string {
    return [whoOf(report), timeOf(report.createdAt)].filter(Boolean).join(' · ');
  }

  average(report: StaffPartnerReport): string {
    const value = singleAverage(report);
    return value == null ? '—' : euro(value);
  }

  quantity(report: StaffPartnerReport): string {
    const t = report.totals;
    return t.saleQuantity > 0 ? quantityText(report, t.saleQuantity) : `${quantityText(report, t.buybackQuantity)} terug`;
  }

  phoneTone(report: StaffPartnerReport): string {
    return statusPill(report).tone;
  }

  phoneStatus(report: StaffPartnerReport): string {
    return PHONE_STATUS[report.status];
  }

  dayText(day: string): string {
    return dayLabel(day, this.today);
  }

  eur(value: number): string { return euro(value); }
  num(value: number): string { return count(value); }
  plural(n: number, one: string, many: string): string { return `${count(n)} ${n === 1 ? one : many}`; }
}
