import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import { messageOf } from '../../core/api/errors';
import {
  PartnerInvoiceResult, PartnerSalesApi, PartnerSalesFilteredTotals, PartnerSalesPartnerSummary, StaffPartnerReport, isMissingEndpoint,
} from '../../core/api/partner-sales-api';
import { WorkQueue } from '../../core/api/work-queue';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { LoadError } from '../../shared/load-error';
import { PageHeader } from '../../shared/page-header';
import { partnerShortName } from '../../shared/partner-short-name';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui } from '../../shared/ui';
import { count, localToday } from '../partner/partner-format';
import { buyerLine, productsShort, reportPieces } from '../partner/partner-report-format';
import { PartnerSalesDetail, canConfirmReport, canUnconfirmReport } from './partner-sales-detail';
import {
  CHANNEL_CHOICES, ChannelChoice, PERIOD_CHOICES, PeriodChoice, STATUS_CHOICES, StatusChoice, byDay, channelOf, matchesState,
  parseChannel, parsePeriod, parseStatus, periodLabel, periodParam, periodRange, reportMatches, soldDay, staffStatus, stateOf, totalsOf,
} from './partner-sales-filters';
import { reportTitle } from './partner-sales-format';
import { InvoicePartner, PartnerSalesInvoiceSheet, invoiceable } from './partner-sales-invoice-sheet';
import { PartnerSalesTable } from './partner-sales-table';
import { signedEur } from '../../shared/signed-eur';

/** The server's cap per list: a period holds fewer, "Alles" may say there is more. */
const LIST_LIMIT = 1000;

/**
 * Veilingverkopen (/veilingverkopen): what the partner (Verhoeven) reported
 * sold on the clock or directly and bought back. Desk: a subbar with Status
 * (Te bevestigen / Bevestigd / Gefactureerd / Ingetrokken / Alles), Soort,
 * Periode, Partner (when several) and a search; one table with ticks, the
 * sold-on date per row and one total row for the filter; the ticked rows
 * get Bevestigen, Terugzetten and Factureren…; a row opens in place with
 * Bewerken, Bevestigen and Intrekken. Phone: the same filters as chips, an
 * iOS list per day, a melding opens in a sheet. Melding toevoegen and
 * Bewerken are pages (/veilingverkopen/melding[/id]). The filters live in
 * the address (?status=…&soort=…&periode=…&partner=…); ?melding=<id> (the
 * bell, a push, the Logboek) shows that one; ?meldingen=<id>,<id> (a
 * document's Meldingen) shows exactly those until a filter changes.
 */
@Component({
  selector: 'app-partner-sales-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, LoadError, PageHeader, PartnerSalesDetail, PartnerSalesInvoiceSheet, PartnerSalesTable, RouterLink, Sheet, Skeleton],
  template: `
    <app-page-header title="Veilingverkopen">
      @if (desk.active()) {
        <a class="wk-btn wk-btn--sm" [class.is-disabled]="missing()" [routerLink]="['/veilingverkopen/melding']" [queryParams]="newQuery()">
          <app-icon name="plus" [size]="15" />Melding toevoegen</a>
        <button class="btn btn--primary btn--sm" type="button" [disabled]="!canInvoice()" (click)="openInvoice(false)">Factureren…</button>
      } @else {
        <a class="btn btn--icon-mobile" aria-label="Melding toevoegen" [routerLink]="['/veilingverkopen/melding']" [queryParams]="newQuery()">
          <app-icon name="plus" [size]="20" /></a>
      }
    </app-page-header>

    <div class="content vv" [class.vv--phone]="!desk.active()">
      @if (desk.active()) {
        <div #subbar class="wk-subbar vv-subbar">
          <div class="vv-filters">
            <div class="wk-chips" role="group" aria-label="Status">
              @for (option of statuses; track option.id) {
                <button class="wk-chip" type="button" [attr.aria-pressed]="status() === option.id" (click)="setStatus(option.id)">{{ option.label }}
                  @if (statusCount(option.id); as n) { <span class="wk-seg__count">{{ n }}</span> }</button>
              }
            </div>
            <span class="vv-divider" aria-hidden="true"></span>
            <div class="wk-chips" role="group" aria-label="Soort">
              @for (option of channels; track option.id) {
                <button class="wk-chip" type="button" [attr.aria-pressed]="channel() === option.id" (click)="setChannel(option.id)">{{ option.label }}</button>
              }
            </div>
            <label class="wk-chip vv-select" [class.is-on]="period().kind !== 'alles'">
              <app-icon name="calendar" [size]="13" /><span class="vv-select__label">{{ periodText() }}</span><app-icon name="chevron-down" [size]="13" />
              <select class="vv-select__native" aria-label="Periode" [value]="period().kind" (change)="setPeriodKind($any($event.target).value)">
                @for (option of periods; track option.id) { <option [value]="option.id">{{ option.label }}</option> }
                <option value="van-tot">Van – tot…</option>
              </select>
            </label>
            @if (period().kind === 'van-tot') {
              <span class="vv-range">
                <input class="vv-date" type="date" aria-label="Van" [value]="period().from ?? ''" [max]="period().to || today" (change)="setRange($any($event.target).value, null)" />
                <span aria-hidden="true">–</span>
                <input class="vv-date" type="date" aria-label="Tot" [value]="period().to ?? ''" [min]="period().from || null" (change)="setRange(null, $any($event.target).value)" />
              </span>
            }
            @if (partnerChoices().length > 1) {
              <label class="wk-chip vv-select" [class.is-on]="customer() != null">
                <span class="vv-select__label">{{ customerName() || 'Alle partners' }}</span><app-icon name="chevron-down" [size]="13" />
                <select class="vv-select__native" aria-label="Partner" [value]="customer() ?? ''" (change)="setCustomer($any($event.target).value)">
                  <option value="">Alle partners</option>
                  @for (partner of partnerChoices(); track partner.customerId) { <option [value]="partner.customerId">{{ partner.customerName }}</option> }
                </select>
              </label>
            }
            @if (onlyLine(); as line) {
              <button class="wk-chip vv-only" type="button" aria-pressed="true" title="Toon alle meldingen" (click)="clearOnly()">{{ line }}<app-icon name="close" [size]="12" /></button>
            }
            <label class="wk-search vv-search">
              <app-icon name="search" [size]="14" />
              <input type="search" placeholder="Zoek VV, product, klant" aria-label="Zoek in de meldingen" autocomplete="off" [value]="query()"
                     (input)="query.set($any($event.target).value)" (keydown.escape)="query.set('')" />
              <button class="wk-search__clear" type="button" aria-label="Zoekterm wissen" (click)="query.set('')"><app-icon name="close" [size]="13" /></button>
            </label>
          </div>
          @if (selected().size) {
            <div class="vv-bulk" role="toolbar" aria-label="Gekozen meldingen">
              <span class="vv-bulk__count">{{ selected().size === 1 ? '1 gekozen' : selected().size + ' gekozen' }}</span>
              <button class="wk-btn wk-btn--sm wk-btn--primary" type="button" [disabled]="!toConfirm().length || bulkBusy() || !round2()" (click)="confirmSelected()">
                Bevestigen ({{ toConfirm().length }})</button>
              <button class="wk-btn wk-btn--sm" type="button" [disabled]="!toUnconfirm().length || bulkBusy() || !round2()" (click)="unconfirmSelected()">
                Terugzetten ({{ toUnconfirm().length }})</button>
              <button class="wk-btn wk-btn--sm" type="button" [disabled]="!selectionInvoice().ok || bulkBusy()" (click)="openInvoice(true)">Factureren…</button>
              <button class="wk-btn wk-btn--sm wk-btn--ghost" type="button" (click)="selected.set(empty)">Wis keuze</button>
              @if (bulkBusy()) { <span class="vv-bulk__note">Bezig…</span> }
            </div>
          }
        </div>
      } @else {
        @if (onlyLine(); as line) {
          <div class="ios-chips vv-ichips"><button class="ios-chip" type="button" aria-pressed="true" (click)="clearOnly()">{{ line }} ✕</button></div>
        }
        <div class="ios-chips vv-ichips" role="group" aria-label="Status">
          @for (option of statuses; track option.id) {
            <button class="ios-chip" type="button" [attr.aria-pressed]="status() === option.id" (click)="setStatus(option.id)">{{ option.label }}@if (statusCount(option.id); as n) { · {{ n }} }</button>
          }
        </div>
        <div class="ios-chips vv-ichips" role="group" aria-label="Soort en periode">
          @for (option of channels; track option.id) {
            <button class="ios-chip" type="button" [attr.aria-pressed]="channel() === option.id" (click)="setChannel(option.id)">{{ option.label }}</button>
          }
          <label class="ios-chip vv-iselect" [attr.aria-pressed]="period().kind !== 'alles'">{{ periodText() }} ▾
            <select class="vv-select__native" aria-label="Periode" [value]="period().kind === 'van-tot' ? 'alles' : period().kind" (change)="setPeriodKind($any($event.target).value)">
              @for (option of periods; track option.id) { <option [value]="option.id">{{ option.label }}</option> }
            </select>
          </label>
          @if (partnerChoices().length > 1) {
            <label class="ios-chip vv-iselect" [attr.aria-pressed]="customer() != null">{{ customerName() ? short(customerName()) : 'Alle partners' }} ▾
              <select class="vv-select__native" aria-label="Partner" [value]="customer() ?? ''" (change)="setCustomer($any($event.target).value)">
                <option value="">Alle partners</option>
                @for (partner of partnerChoices(); track partner.customerId) { <option [value]="partner.customerId">{{ partner.customerName }}</option> }
              </select>
            </label>
          }
        </div>
        @if (loaded() && !missing() && shownTotal(); as t) {
          <div class="ios-card vv-sum">
            <span class="vv-sum__label">Totaal · {{ t.reports === 1 ? '1 melding' : num(t.reports) + ' meldingen' }}</span>
            <b class="vv-sum__value">{{ eur(t.netEur) }}</b>
            <span class="vv-sum__sub">netto · {{ num(t.salePieces) }} stuks · bruto {{ eur(t.grossEur) }}</span>
            @if (canInvoice()) {
              <button class="ios-capsule ios-capsule--accent ios-capsule--block vv-sum__go" type="button" (click)="openInvoice(false)">Factureren</button>
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
      } @else if (!visible().length) {
        <div [class.wk-card]="desk.active()">
          <div [class.wk-empty]="desk.active()" [class.ios-empty]="!desk.active()">
            <span [class.wk-empty__icon]="desk.active()" [class.ios-empty__icon]="!desk.active()" aria-hidden="true"><app-icon name="arrow-in" [size]="22" /></span>
            <p [class.wk-empty__title]="desk.active()" [class.ios-empty__title]="!desk.active()">{{ emptyTitle() }}</p>
            <p [class.wk-empty__text]="desk.active()" [class.ios-empty__text]="!desk.active()">{{ query().trim() ? 'Niets gevonden voor “' + query().trim() + '”.' : 'Wat de partner meldt, komt hier.' }}</p>
          </div>
        </div>
      } @else if (desk.active()) {
        @if (error(); as message) { <p class="vv-error" role="alert">{{ message }}</p> }
        <app-partner-sales-table [reports]="visible()" [today]="today" [selected]="selected()" [expanded]="expanded()" [flash]="flash()"
                                 [totals]="shownTotal()" [totalsNote]="totalNote()" [showCustomer]="showCustomer()" [busy]="voidBusy() || bulkBusy()"
                                 [canWrite]="round2()"
                                 (toggled)="toggle($event)" (selectionChange)="selected.set($event)" (editAsked)="edit($event)"
                                 (voidAsked)="askVoid($event)" (confirmAsked)="confirmOne($event)" (unconfirmAsked)="unconfirmOne($event)" />
        @if (more()) { <p class="vv-more">De lijst toont de nieuwste {{ num(rows().length) }}. Kies een periode voor de rest.</p> }
      } @else {
        @if (error(); as message) { <div class="ios-banner" role="alert"><span>{{ message }}</span></div> }
        @for (day of days(); track day.day) {
          <section class="ios-section">
            <div class="ios-section__head"><span class="vv-ihead" role="heading" aria-level="2">{{ dayText(day.day) }}</span>
              <span class="ios-section__trail">{{ eur(dayNet(day.reports)) }}</span></div>
            <div class="ios-group">
              @for (r of day.reports; track r.id) {
                <button class="ios-cell vv-prow" type="button" [id]="'vv-' + r.id" [class.is-flash]="flash() === r.id" [class.is-void]="r.status === 'VOIDED'" (click)="opened.set(r.id)">
                  <span class="ios-cell__body">
                    <span class="vv-ptitle">{{ title(r) }}</span>
                    <span class="vv-psub">{{ phoneSub(r) }}</span>
                  </span>
                  <span class="ios-cell__trail">
                    <span class="vv-pfig" [class]="pillOf(r).tone">{{ eur(r.totals.netEur) }}</span>
                    <span class="vv-pstate">{{ pillOf(r).label }}</span>
                  </span>
                </button>
              }
            </div>
          </section>
        }
        @if (more()) { <p class="vv-more">De nieuwste {{ num(rows().length) }}; kies een periode voor de rest.</p> }
      }
    </div>

    @if (!desk.active() && sheetReport(); as r) {
      <app-sheet variant="ios" [title]="r.number" (closed)="opened.set(null)">
        <div body><app-partner-sales-detail [report]="r" variant="ios" [today]="today" [canWrite]="round2()" /></div>
        <div foot class="vv-sheet-foot">
          @if (canConfirm(r)) {
            <button class="ios-capsule ios-capsule--block ios-capsule--accent" type="button" [disabled]="bulkBusy() || !round2()" (click)="confirmOne(r)">Bevestigen</button>
          } @else if (canUnconfirm(r)) {
            <button class="ios-capsule ios-capsule--block ios-capsule--tinted" type="button" [disabled]="bulkBusy() || !round2()" (click)="unconfirmOne(r)">Terugzetten</button>
          }
          @if (r.status === 'OPEN' && !r.revisionOf) {
            <button class="ios-capsule ios-capsule--block ios-capsule--tinted" type="button" [disabled]="!r.canEdit || !round2()" (click)="edit(r)">Bewerken</button>
            <button class="ios-capsule ios-capsule--block ios-capsule--danger" type="button" [disabled]="!r.canUndo || voidBusy()" (click)="askVoid(r)">Intrekken</button>
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

    @if (invoice(); as plan) {
      <app-partner-sales-invoice-sheet [partners]="plan.partners" [initialCustomerId]="plan.customerId" [preselect]="plan.preselect"
                                       [unconfirmed]="plan.unconfirmed" [several]="plan.several" [canConfirm]="round2()" [today]="today"
                                       (created)="invoiced($event)" (confirmedSome)="confirmedElsewhere()" (closed)="invoice.set(null)" />
    }
  `,
  styles: `
    :host{display:block;min-width:0}
    .vv-subbar{display:grid;gap:6px;padding-block:6px}
    .vv-filters{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;min-width:0}
    .vv-divider{width:1px;height:18px;background:var(--line)}
    .vv-select{position:relative;max-width:220px}
    .vv-select__label{min-width:0;overflow:hidden;text-overflow:ellipsis}
    .vv-select__native{position:absolute;inset:0;width:100%;height:100%;opacity:0;font:inherit;cursor:pointer}
    .vv-select:has(>.vv-select__native:focus-visible){outline:2px solid var(--rose);outline-offset:2px}
    .vv-range{display:inline-flex;align-items:center;gap:4px;color:var(--muted);font-size:12px}
    .vv-date{height:28px;padding:0 6px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font:inherit;font-size:12px}
    .vv-search{width:228px;margin-left:auto}
    .vv-only{gap:6px;max-width:280px}
    .vv-bulk{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 8px;border:1px solid var(--rose-line);border-radius:10px;background:var(--rose-soft)}
    .vv-bulk__count{margin-right:4px;color:var(--rose-dark);font-size:12.5px;font-weight:700;font-variant-numeric:tabular-nums}
    .vv-bulk__note{color:var(--muted);font-size:12px}
    a.wk-btn.is-disabled{pointer-events:none;opacity:.45}
    /* No overflow on the card: a clipping card would be the head's sticky box, and the head (top = the app bar + this
       subbar) would sit that far down inside the rows. The head rounds its own top corners instead. */
    .vv-subbar~*{--wk-sticky-top:calc(var(--appbar-h,0px) + var(--vv-subbar-h,var(--wk-subbar-h,48px)))}
    .vv-more{margin:12px 0 0;color:var(--muted);font-size:13px;text-align:center}
    .vv-error{margin:0 0 10px;color:var(--danger);font-size:13px;font-weight:600}
    @keyframes vv-flash{from{background:var(--rose-soft)}to{background:var(--surface)}}
    .is-flash{animation:vv-flash 2.4s ease-out}
    @media (prefers-reduced-motion:reduce){.is-flash{animation:none;background:var(--rose-soft)}}
    .vv-ichips{margin:0 0 8px;padding-inline:var(--ios-inset,16px);flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}
    .vv-ichips .ios-chip{flex:none;min-height:36px}
    .vv-iselect{position:relative}
    .vv-sum{display:grid;gap:2px;margin-top:4px}
    .vv-sum__label{color:var(--muted);font-size:13px;font-weight:600}
    .vv-sum__value{font-size:28px;font-weight:750;letter-spacing:-.025em;font-variant-numeric:tabular-nums}
    .vv-sum__sub{color:var(--muted);font-size:14px}
    .vv-sum__go{margin-top:12px}
    .vv-ihead{color:var(--muted);font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.03em}
    .vv-prow{min-height:64px}
    .vv-ptitle{overflow:hidden;font-size:16px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
    .vv-psub{overflow:hidden;color:var(--muted);font-size:13.5px;text-overflow:ellipsis;white-space:nowrap}
    .vv-pfig{padding:3px 10px;border-radius:999px;background:color-mix(in srgb,var(--tone,var(--muted)) 14%,var(--surface));color:color-mix(in srgb,var(--tone,var(--muted)) 85%,var(--ink));font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
    .vv-pstate{color:var(--muted);font-size:12.5px;white-space:nowrap}
    .vv-prow.is-void .vv-pfig{text-decoration:line-through}
    .vv-sheet-foot{display:grid;gap:8px;width:100%}
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

  readonly statuses = STATUS_CHOICES;
  readonly channels = CHANNEL_CHOICES;
  readonly periods = PERIOD_CHOICES;
  readonly today = localToday();
  readonly empty: ReadonlySet<number> = new Set();

  readonly status = signal<StatusChoice>('alles');
  readonly channel = signal<ChannelChoice>('alle');
  readonly period = signal<PeriodChoice>({ kind: 'alles' });
  readonly customer = signal<number | null>(null);
  readonly query = signal('');
  /** ?meldingen=: exactly these meldingen (a document's), until a filter changes. */
  readonly only = signal<ReadonlySet<number> | null>(null);

  /** What the server answered for the filter. */
  readonly rows = signal<StaffPartnerReport[]>([]);
  readonly more = signal(false);
  private readonly serverTotals = signal<PartnerSalesFilteredTotals | null>(null);
  private readonly apiVersion = signal<number | null>(null);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  readonly missing = signal(false);

  readonly selected = signal<ReadonlySet<number>>(new Set());
  readonly expanded = signal<number | null>(null);
  readonly opened = signal<number | null>(null);
  readonly flash = signal<number | null>(null);
  readonly bulkBusy = signal(false);
  readonly invoice = signal<{
    partners: InvoicePartner[]; customerId: number | null; preselect: number[] | null; unconfirmed: StaffPartnerReport[]; several: boolean;
  } | null>(null);

  readonly voiding = signal<StaffPartnerReport | null>(null);
  readonly voidReason = signal('');
  readonly voidBusy = signal(false);
  readonly voidError = signal<string | null>(null);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly subbar = viewChild<ElementRef<HTMLElement>>('subbar');
  private run = 0;
  private started = false;
  /** The melding a ?melding= link asked for, until it is shown. */
  private wanted: number | null = null;
  /** The meldingen a ?meldingen= link asked for, until the list holds them. */
  private wantedAll: number[] | null = null;
  /** The summary's last melding when the list was read: a newer one (a push, the bell's refresh) reads the list again. */
  private seenLastReportAt: string | null | undefined = undefined;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  /** The server filtered by state, period and channel (round 2); an older one answered everything by id. */
  private readonly serverFiltered = computed(() => this.serverTotals() != null);

  /** What the table shows: the answer (filtered here too when the server could not), then the search. */
  readonly visible = computed(() => {
    let list = this.rows();
    if (!this.serverFiltered()) {
      const state = stateOf(this.status());
      const channel = channelOf(this.channel());
      const range = periodRange(this.period(), this.today);
      const customer = this.customer();
      list = list.filter((r) => matchesState(r, state) && (!channel || r.channel === channel)
        && (!range.from || r.soldOn >= range.from) && (!range.to || r.soldOn <= range.to) && (customer == null || r.customerId === customer));
    }
    const only = this.only();
    if (only) list = list.filter((r) => only.has(r.id));
    const query = this.query().trim();
    list = query ? list.filter((r) => reportMatches(r, query)) : list;
    return [...list].sort((a, b) => b.soldOn.localeCompare(a.soldOn) || b.id - a.id);
  });
  /** "VV-2, VV-4": the chip of a ?meldingen= view. */
  readonly onlyLine = computed(() => {
    const only = this.only();
    if (!only) return null;
    const numbers = this.rows().filter((r) => only.has(r.id)).sort((a, b) => a.id - b.id).map((r) => r.number);
    return numbers.length ? numbers.join(', ') : `${only.size} meldingen`;
  });
  readonly days = computed(() => byDay(this.visible()));
  readonly sheetReport = computed(() => this.rows().find((report) => report.id === this.opened()) ?? null);

  /** The total row: the server's for the whole filter; a search, ?meldingen= (or an older server) sums what is shown. */
  readonly total = computed<PartnerSalesFilteredTotals>(() => {
    const server = this.serverTotals();
    return server && !this.query().trim() && !this.only() ? server : totalsOf(this.visible());
  });
  /** Withdrawn meldingen count for nothing: under Ingetrokken there is no total to show. */
  readonly shownTotal = computed<PartnerSalesFilteredTotals | null>(() => (this.status() === 'ingetrokken' ? null : this.total()));
  readonly totalNote = computed(() => {
    if (this.query().trim()) return 'gevonden';
    if (this.more() && !this.serverFiltered()) return `van de nieuwste ${count(this.rows().length)}`;
    return this.visible().some((r) => r.status === 'VOIDED') ? 'zonder ingetrokken' : null;
  });

  readonly partnerChoices = computed<PartnerSalesPartnerSummary[]>(() => this.work.partnerSales()?.partners ?? []);
  readonly customerName = computed(() => this.partnerChoices().find((partner) => partner.customerId === this.customer())?.customerName ?? '');
  /** The partner's name on each row only while several partners are listed together. */
  readonly showCustomer = computed(() => this.customer() == null && new Set(this.rows().map((report) => report.customerId)).size > 1);
  readonly periodText = computed(() => {
    const p = this.period();
    return p.kind === 'alles' ? 'Periode' : periodLabel(p, this.today);
  });
  /** A round-2 server: Bewerken, Bevestigen and Terugzetten (they send round-2 calls). */
  readonly round2 = computed(() => (this.apiVersion() ?? this.work.partnerSales()?.apiVersion ?? 1) >= 2);

  /** Factureren once a confirmed sale is open (round 1: any open sale). */
  readonly canInvoice = computed(() => !this.missing() && this.work.partnerSalesInvoiceable());

  /** The ticked rows (only those still shown). */
  private readonly ticked = computed(() => this.visible().filter((r) => this.selected().has(r.id)));
  readonly toConfirm = computed(() => this.ticked().filter((r) => canConfirmReport(r)));
  readonly toUnconfirm = computed(() => this.ticked().filter((r) => canUnconfirmReport(r)));
  /** Factureren… from the ticks: the invoiceable ones and the ones to confirm first, by partner. */
  readonly selectionInvoice = computed(() => {
    const ticked = this.ticked();
    const ready = ticked.filter((r) => invoiceable(r));
    const waiting = ticked.filter((r) => canConfirmReport(r));
    const partners = new Set([...ready, ...waiting].map((r) => r.customerId));
    return { ok: ready.length + waiting.length > 0, ready, waiting, partners };
  });

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => void this.fromAddress(params));
    /* A newer melding than the list knows (the queue refreshed on a push or on focus): read the list again. */
    effect(() => {
      const last = this.work.partnerSales()?.lastReportAt;
      untracked(() => {
        if (this.seenLastReportAt === undefined || last === undefined || last === this.seenLastReportAt) return;
        if (this.loading() || this.voidBusy() || this.bulkBusy()) return;
        void this.load(true);
      });
    });
    /* The ticks follow what is shown. */
    effect(() => {
      const shown = new Set(this.visible().map((r) => r.id));
      untracked(() => {
        const kept = [...this.selected()].filter((id) => shown.has(id));
        if (kept.length !== this.selected().size) this.selected.set(new Set(kept));
      });
    });
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

  /** The filters from the address; the first time without ?status the page opens on what needs doing. */
  private async fromAddress(params: ParamMap): Promise<void> {
    const some = (params.get('meldingen') ?? '').split(',').map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
    if (some.length) {
      /* A document's meldingen: every status (they are invoiced), only these, read by id when the list lacks one. */
      this.only.set(new Set(some));
      this.wantedAll = some;
      this.status.set('alles');
      this.channel.set('alle');
      this.period.set({ kind: 'alles' });
      this.customer.set(null);
      this.query.set('');
      this.started = true;
      this.expanded.set(null);
      void this.load();
      return;
    }
    this.only.set(null);
    this.wantedAll = null;
    const id = Number(params.get('melding'));
    if (Number.isSafeInteger(id) && id > 0) {
      this.wanted = id;
      this.status.set('alles');
      this.channel.set('alle');
      this.period.set({ kind: 'alles' });
      this.customer.set(null);
      this.query.set('');
      this.started = true;
      void this.load();
      return;
    }
    let status = parseStatus(params.get('status'));
    if (!status && !this.started) {
      if (!this.work.partnerSales()) await this.work.refresh();
      const summary = this.work.partnerSales();
      status = (summary?.unconfirmedReports ?? 0) > 0 ? 'te-bevestigen' : (summary?.confirmedOpenReports ?? 0) > 0 ? 'bevestigd' : 'alles';
    }
    const partner = Number(params.get('partner'));
    const next = {
      status: status ?? this.status(),
      channel: parseChannel(params.get('soort')),
      period: parsePeriod(params.get('periode')),
      customer: Number.isSafeInteger(partner) && partner > 0 ? partner : null,
    };
    const changed = !this.started || next.status !== this.status() || next.channel !== this.channel()
      || periodParam(next.period) !== periodParam(this.period()) || next.customer !== this.customer();
    this.status.set(next.status);
    this.channel.set(next.channel);
    this.period.set(next.period);
    this.customer.set(next.customer);
    this.started = true;
    if (changed) { this.expanded.set(null); void this.load(); }
  }

  /** Writes the filters into the address (the list follows from there). */
  private toAddress(patch: Partial<{ status: StatusChoice; channel: ChannelChoice; period: PeriodChoice; customer: number | null }>): void {
    const status = patch.status ?? this.status();
    const channel = patch.channel ?? this.channel();
    const period = patch.period ?? this.period();
    const customer = 'customer' in patch ? patch.customer ?? null : this.customer();
    void this.router.navigate([], {
      relativeTo: this.route, replaceUrl: true,
      queryParams: { status, soort: channel === 'alle' ? null : channel, periode: periodParam(period), partner: customer, melding: null, meldingen: null },
    });
  }

  setStatus(status: StatusChoice): void { if (status !== this.status() || this.only()) this.toAddress({ status }); }

  /** The chip's ✕: back to every melding (the address drops ?meldingen=). */
  clearOnly(): void { this.toAddress({ status: 'alles' }); }
  setChannel(channel: ChannelChoice): void { if (channel !== this.channel()) this.toAddress({ channel }); }

  setPeriodKind(kind: string): void {
    if (kind === 'van-tot') {
      const range = periodRange(this.period(), this.today);
      this.toAddress({ period: { kind: 'van-tot', from: range.from ?? this.today.slice(0, 8) + '01', to: range.to ?? this.today } });
      return;
    }
    const choice = PERIOD_CHOICES.find((option) => option.id === kind);
    if (choice) this.toAddress({ period: { kind: choice.id } });
  }

  setRange(from: string | null, to: string | null): void {
    const current = this.period();
    this.toAddress({ period: { kind: 'van-tot', from: from ?? current.from ?? '', to: to ?? current.to ?? '' } });
  }

  setCustomer(value: string): void {
    const id = value === '' ? null : Number(value);
    const next = id != null && Number.isSafeInteger(id) ? id : null;
    if (next !== this.customer()) this.toAddress({ customer: next });
  }

  /** The filter's meldingen; `quiet` keeps the shown rows and the open one while it reads. */
  async load(quiet = false): Promise<void> {
    const run = ++this.run;
    this.loading.set(true);
    if (!quiet) this.error.set(null);
    const lastSeen = this.work.partnerSales()?.lastReportAt ?? null;
    const range = periodRange(this.period(), this.today);
    try {
      const page = await this.api.list({
        customerId: this.customer(), state: stateOf(this.status()), channel: channelOf(this.channel()),
        from: range.from, to: range.to, limit: LIST_LIMIT,
      });
      if (run !== this.run) return;
      this.rows.set(page.reports);
      this.more.set(page.more);
      this.serverTotals.set(page.filteredTotals ?? null);
      this.apiVersion.set(page.apiVersion ?? null);
      this.missing.set(false);
      this.error.set(null);
      this.loaded.set(true);
      this.seenLastReportAt = lastSeen;
      await this.findWanted(run);
      await this.findAll(run);
    } catch (failure: unknown) {
      if (run !== this.run) return;
      if (isMissingEndpoint(failure)) { this.missing.set(true); this.loaded.set(true); return; }
      this.error.set(messageOf(failure, 'De meldingen konden niet worden geladen.'));
    } finally {
      if (run === this.run) this.loading.set(false);
    }
  }

  /** A ?melding= link: read that one when the list does not hold it, open it, light it, drop the parameter. */
  private async findWanted(run: number): Promise<void> {
    const id = this.wanted;
    if (id == null) return;
    this.wanted = null;
    if (!this.rows().some((report) => report.id === id)) {
      try {
        const report = await this.api.report(id);
        if (run !== this.run) return;
        if (!report.revisionOf) this.rows.update((list) => [report, ...list]);
      } catch { /* not there (any more): said below */ }
    }
    void this.router.navigate([], { relativeTo: this.route, queryParams: { melding: null, status: 'alles' }, queryParamsHandling: 'merge', replaceUrl: true });
    if (!this.rows().some((report) => report.id === id)) { this.ui.toast(`VV-${id} staat niet in de lijst`, 'err'); return; }
    this.show(id);
  }

  /** A ?meldingen= link: read the ones the list does not hold (older than its 1000 rows). */
  private async findAll(run: number): Promise<void> {
    const ids = this.wantedAll;
    if (!ids) return;
    this.wantedAll = null;
    const missing = ids.filter((id) => !this.rows().some((report) => report.id === id));
    for (const id of missing) {
      try {
        const report = await this.api.report(id);
        if (run !== this.run) return;
        if (!report.revisionOf) this.rows.update((list) => (list.some((known) => known.id === report.id) ? list : [report, ...list]));
      } catch { /* gone: the chip counts what is there */ }
    }
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

  /** Melding toevoegen for the partner the page shows (else the first). */
  newQuery(): Record<string, string> | null {
    const customer = this.customer();
    return customer != null ? { partner: String(customer) } : null;
  }

  edit(report: StaffPartnerReport): void {
    void this.router.navigate(['/veilingverkopen/melding', report.id]);
  }

  /* ---- Bevestigen / Terugzetten */

  confirmOne(report: StaffPartnerReport): void { void this.confirm([report], true); }
  unconfirmOne(report: StaffPartnerReport): void { void this.confirm([report], false); }
  confirmSelected(): void { void this.confirm(this.toConfirm(), true); }
  unconfirmSelected(): void { void this.confirm(this.toUnconfirm(), false); }

  /** Sends the tokens the rows were read with; a melding changed meanwhile refuses the lot (the list is read again). */
  private async confirm(reports: readonly StaffPartnerReport[], on: boolean): Promise<void> {
    const items = reports.filter((r) => r.editToken).map((r) => ({ id: r.id, token: r.editToken! }));
    if (!items.length || this.bulkBusy() || !this.round2()) return;
    this.bulkBusy.set(true);
    try {
      const answer = on ? await this.api.confirmReports(items) : await this.api.unconfirmReports(items);
      const byId = new Map((answer.reports ?? []).map((r) => [r.id, r]));
      this.rows.update((list) => list.map((known) => byId.get(known.id) ?? known));
      const n = items.length;
      this.ui.toast(n === 1 ? `${reports[0].number} ${on ? 'bevestigd' : 'teruggezet'}` : `${n} meldingen ${on ? 'bevestigd' : 'teruggezet'}`);
      this.selected.set(new Set());
      if (this.opened() != null && !this.desk.active()) this.opened.set(null);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, on ? 'Bevestigen lukt nu niet.' : 'Terugzetten lukt nu niet.'), 'err');
    } finally {
      this.bulkBusy.set(false);
      void this.work.refresh(true);
      void this.load(true);
    }
  }

  /* ---- Factureren */

  /** The sheet: from the ticks (their partner, ticked there too; unconfirmed ones offered first) or the whole partner. */
  openInvoice(fromSelection: boolean): void {
    const summary = this.partnerChoices() as InvoicePartner[];
    const takes = (p: InvoicePartner) => (p.confirmedOpenReports ?? p.openReports) > 0;
    if (fromSelection && this.selected().size) {
      const { ready, waiting, partners } = this.selectionInvoice();
      const ids = [...partners];
      const list = summary.filter((p) => partners.has(p.customerId));
      const known = new Set(list.map((p) => p.customerId));
      for (const r of [...ready, ...waiting]) {
        if (!known.has(r.customerId)) {
          known.add(r.customerId);
          list.push({ customerId: r.customerId, customerName: r.customerName, openReports: 0, openSaleQuantity: 0, openNetEur: 0, lastReportAt: null });
        }
      }
      this.invoice.set({
        partners: list, customerId: ready[0]?.customerId ?? waiting[0]?.customerId ?? ids[0] ?? null,
        preselect: ready.map((r) => r.id), unconfirmed: waiting, several: partners.size > 1,
      });
      return;
    }
    const partners = summary.filter(takes);
    this.invoice.set({ partners: partners.length ? partners : summary, customerId: this.customer(), preselect: null, unconfirmed: [], several: false });
  }

  invoiced(result: PartnerInvoiceResult): void {
    const made = result.invoices.length;
    if (made) this.ui.toast(made === 1 ? '1 concept gemaakt' : `${made} concepten gemaakt`);
    this.selected.set(new Set());
    void this.work.refresh(true);
    void this.load(true);
  }

  confirmedElsewhere(): void {
    void this.work.refresh(true);
    void this.load(true);
  }

  /* ---- Intrekken */

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
      this.rows.update((list) => list.map((known) => (known.id === updated.id ? updated : known)));
      this.voiding.set(null);
      this.opened.set(null);
      this.ui.toast(`${report.number} ingetrokken`);
      void this.work.refresh(true);
      void this.load(true);
    } catch (failure: unknown) {
      this.voidError.set(messageOf(failure, 'Intrekken lukt nu niet.'));
    } finally {
      this.voidBusy.set(false);
    }
  }

  /* ---- words */

  /** The count on a status chip: what waits (the summary's, for the partner shown). */
  statusCount(choice: StatusChoice): number | null {
    const summary = this.work.partnerSales();
    if (!summary) return null;
    const partner = this.customer() != null ? summary.partners.find((p) => p.customerId === this.customer()) as InvoicePartner | undefined : summary;
    if (!partner) return null;
    const n = choice === 'te-bevestigen' ? partner.unconfirmedReports : choice === 'bevestigd' ? partner.confirmedOpenReports : null;
    return n ? n : null;
  }

  emptyTitle(): string {
    if (this.query().trim()) return 'Geen meldingen gevonden';
    switch (this.status()) {
      case 'te-bevestigen': return 'Niets te bevestigen';
      case 'bevestigd': return 'Niets bevestigd dat nog open staat';
      case 'gefactureerd': return 'Nog niets gefactureerd';
      case 'ingetrokken': return 'Niets ingetrokken';
      default: return 'Geen meldingen';
    }
  }

  canConfirm(r: StaffPartnerReport): boolean { return canConfirmReport(r); }
  canUnconfirm(r: StaffPartnerReport): boolean { return canUnconfirmReport(r); }
  title(r: StaffPartnerReport): string { return reportTitle(r); }
  pillOf(r: StaffPartnerReport): { label: string; tone: string } { return staffStatus(r, null); }

  /** "Glazen stolp + 1 · 120 st · Bloemen Jansen". */
  phoneSub(r: StaffPartnerReport): string {
    const pieces = reportPieces(r);
    const amount = pieces.sale ? `${count(pieces.sale)} st` : `${count(pieces.buyback)} st terug`;
    return [productsShort(r), amount, buyerLine(r) || (this.showCustomer() ? partnerShortName(r.customerName) : '')].filter(Boolean).join(' · ');
  }

  dayNet(reports: readonly StaffPartnerReport[]): number {
    return reports.filter((r) => r.status !== 'VOIDED').reduce((sum, r) => sum + Math.round((r.totals.netEur || 0) * 100), 0) / 100;
  }

  dayText(day: string): string { return soldDay(day, this.today); }
  short(name: string): string { return partnerShortName(name); }
  eur(value: number): string { return signedEur(value); }
  num(value: number): string { return count(value); }
}
