import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SalesApi } from '../../core/api/sales-api';
import { Country, CrmStatus, Customer } from '../../core/api/models';
import { countryFlag, countryName } from '../../core/api/geo';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Ui } from '../../shared/ui';
import { messageOf } from '../../core/api/errors';
import { LoadError, LOAD_ERROR_FALLBACK } from '../../shared/load-error';
import { partnerShortName } from '../../shared/partner-short-name';
import { CustomerSheet } from './customer-sheet';
import {
  CRM_STATUSES, CrmTone, crmStatusLabel, CUSTOMER_SORTS, CustomerSort, customerSince,
  filterCustomers, metaLine, sortCustomers, TOUCHPOINT_KINDS, touchpointLabel, touchpointStamp,
} from './customer-form';

/** The sort survives a reload; a status filter is a deep link (?status=) instead. */
const SORT_KEY = 'enrosed.customers.sort';
/** Pills on a list row before "+n" takes over: three fit beside the status badge at 375 px. */
const MARKS_SHOWN = 3;
const STATUS_VALUES: readonly string[] = CRM_STATUSES.map((status) => status.value);

@Component({
  selector: 'app-customer-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, FormsModule, PageHeader, Segmented, CustomerSheet, LoadError],
  template: `
    <app-page-header title="Klanten" [subtitle]="filtered().length === 1 ? '1 klant' : filtered().length + ' klanten'">
      <button class="btn btn--primary btn--sm hide-mobile" type="button" (click)="open(null)">
        + Nieuw
      </button>
    </app-page-header>

    <div class="content">
      <div class="search-bar">
        <input class="input" type="search" placeholder="Zoek op bedrijf, contact of stad…"
               [ngModel]="query()" (ngModelChange)="query.set($event)" />
      </div>

      @if (desktop.active()) {
        <div class="cl-tools">
          <app-segmented variant="desk" semantics="radio" label="Status" [options]="statusOptions()"
                         [value]="status()" (changed)="setStatus($event)" />
          <label class="cl-sort"><span>Sorteren</span>
            <select class="select input--sm" [ngModel]="sort()" (ngModelChange)="setSort($event)">
              @for (option of sorts; track option.value) { <option [value]="option.value">{{ option.label }}</option> }
            </select></label>
        </div>
      } @else {
        <div class="chips" role="radiogroup" aria-label="Status">
          @for (option of statusOptions(); track option.id) {
            <button class="chip" type="button" role="radio" [class.active]="option.id === status()"
                    [attr.aria-checked]="option.id === status()" (click)="setStatus(option.id)">
              {{ option.label }}@if (option.count) { <span class="cl-chip-count">{{ option.count }}</span> }
            </button>
          }
        </div>
        <label class="cl-sort cl-sort--phone"><span>Sorteren</span>
          <select class="select input--sm" [ngModel]="sort()" (ngModelChange)="setSort($event)">
            @for (option of sorts; track option.value) { <option [value]="option.value">{{ option.label }}</option> }
          </select></label>
      }

      @if (loadError(); as error) {
        <app-load-error [message]="error" [busy]="loading()" (retry)="retryLoad()" />
      } @else {
      <div class="card"><div class="list">
        @for (customer of filtered(); track customer.id) {
          <div class="list-item">
            <button class="customer-open" type="button" (click)="open(customer)"
                    [attr.aria-label]="customer.company + ' bewerken'">
              <div class="list-item__body">
                <div class="list-item__title">{{ customer.company }}</div>
                @if (metaLine([customer.contact, customer.city]); as who) { <div class="list-item__meta">{{ who }}</div> }
                <!-- The warning first: the line is clipped at 375 px, and a quote cannot go out without an e-mail. -->
                @if (!customer.email || placeLine(customer)) {
                  <div class="list-item__meta">
                    @if (!customer.email) { <span class="warn-text">geen e-mail</span>@if (placeLine(customer)) { · } }
                    {{ placeLine(customer) }}
                  </div>
                }
                <!-- Phone: the stamp reads under the place; in the narrow end column it broke over two lines and squeezed the name. -->
                @if (customerSince(customer.createdAt); as since) { <div class="list-item__meta cl-since cl-since--body">{{ since }}</div> }
              </div>
              <div class="list-item__end list-item__end--stacked">
                @if (statusTone(customer.crmStatus); as tone) {
                  <span [class]="'badge badge--' + tone">{{ crmStatusLabel(customer.crmStatus) }}</span>
                }
                @if (customerSince(customer.createdAt); as since) { <span class="cl-since">{{ since }}</span> }
                @if (customer.partnerOrigin; as origin) {
                  <span class="cl-marks"><span class="wk-pill" [class.tone-amber]="!origin.reviewedAt" [class.tone-grey]="!!origin.reviewedAt"
                        [title]="'Aangemaakt door ' + (origin.createdByName || 'de partner') + ' via Partnerportaal' + (origin.reviewedAt ? '' : ' · nog na te kijken')">via {{ viaName(origin.partnerName) }}</span></span>
                }
                @if (marks(customer); as pills) {
                  <span class="cl-marks" [title]="pills.title">
                    @for (pill of pills.shown; track pill) { <span class="wk-pill tone-grey">{{ pill }}</span> }
                    @if (pills.more) { <span class="wk-pill tone-grey">+{{ pills.more }}</span> }
                  </span>
                }
              </div>
            </button>
          </div>
        } @empty {
          @if (loading()) {
            <app-skeleton kind="list" [rows]="4" />
          } @else {
            <div class="empty"><div class="empty__title">
              Geen klanten gevonden</div></div>
          }
        }
      </div></div>
      }
    </div>

    <button class="fab" type="button" (click)="open(null)">+ Klant</button>

    @if (sheet(); as open) {
      <app-customer-sheet [customer]="open.customer" [countries]="countries()"
                          (closed)="sheet.set(null)" (saved)="sheetDone()" (removed)="sheetDone()" />
    }
  `,
  styles: `
    /* Status filter and sort on one line on the desk, the sort under it (right-aligned) when the row is too narrow for
       both; the phone gets chips and a sort line of its own. */
    .cl-tools { container: cl-tools / inline-size; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px; margin-bottom: 12px; min-width: 0; }
    .cl-tools app-segmented { min-width: 0; max-width: 100%; }
    /* The kit swaps to the short labels only inside a .wk-toolbar (container wk-bar); this row is not one, so the
       same swap is said here: one word per status on a desk window of ~800 px, where the full ones pushed the sort out of view. */
    @container cl-tools (max-width: 719.98px) {
      :host ::ng-deep .cl-tools .wk-seg__opt:has(.wk-seg__short) .wk-seg__full { display: none; }
      :host ::ng-deep .cl-tools .wk-seg__short { display: inline; }
    }
    .cl-sort { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; flex: none; color: var(--muted); font-size: 12.5px; }
    .cl-sort .select { width: auto; min-height: 32px; padding-block: 0; font-size: 13px; }
    .cl-sort--phone { display: flex; justify-content: flex-end; margin: -4px 0 12px; }
    .cl-chip-count { color: inherit; opacity: .75; font-size: 12px; font-variant-numeric: tabular-nums; }

    /* The whole row opens the customer; the end column rides along inside the button. */
    .customer-open { display: flex; align-items: center; gap: 12px; flex: 1; align-self: stretch; min-width: 0; border: 0; background: transparent;
      padding: 0; text-align: left; cursor: pointer; border-radius: 8px; color: inherit; font: inherit; }
    .cl-since { color: var(--muted-2); }
    .cl-since--body { display: none; }
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px) {
      .cl-since--body { display: block; }
      .list-item__end .cl-since { display: none; }
    }
    .cl-marks { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 3px; }
    .cl-marks .wk-pill { height: 18px; padding: 0 6px; font-size: 10px; }
  `,
})
export class CustomerList {
  private readonly sales = inject(SalesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly ui = inject(Ui);
  readonly desktop = inject(DesktopViewport);

  readonly sorts = CUSTOMER_SORTS;
  readonly metaLine = metaLine;
  readonly customerSince = customerSince;
  readonly crmStatusLabel = crmStatusLabel;

  readonly customers = signal<Customer[]>([]);
  readonly countries = signal<Country[]>([]);
  readonly query = signal('');
  readonly status = signal<CrmStatus | 'ALLE'>('ALLE');
  readonly sort = signal<CustomerSort>(readStoredSort());
  /** The open sheet: the customer it edits, or null inside for "Nieuwe klant"; null when no sheet is open. */
  readonly sheet = signal<{ customer: Customer | null } | null>(null);
  readonly loading = signal(true);

  constructor() {
    /* Deep links (the sales hero, the future CRM menu) filter the list straight to one customer or one status. */
    const query = this.route.snapshot.queryParamMap;
    const q = query.get('q');
    if (q) this.query.set(q);
    const status = (query.get('status') ?? '').toUpperCase();
    if (STATUS_VALUES.includes(status)) this.status.set(status as CrmStatus);
    void this.load();
    /* ?klant=<id> (the bell's "Nieuwe klant via Partnerportaal", a link elsewhere): open that customer's sheet once the
       list is there, also when the link is followed while this screen is already open. */
    this.route.queryParamMap.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((params) => {
      const id = Number(params.get('klant'));
      if (Number.isSafeInteger(id) && id > 0) { this.wantedId = id; this.openWanted(); }
    });
    /* The phone home's '+' lands here with ?nieuw=1: open the sheet once and drop the flag so a reload does not reopen it. */
    if (query.get('nieuw') === '1') {
      void this.router.navigate([], { queryParams: { nieuw: null }, queryParamsHandling: 'merge', replaceUrl: true, relativeTo: this.route });
      this.open(null);
    }
  }

  /** Set when the list could not be fetched: the screen shows why and Opnieuw proberen instead of a skeleton forever. */
  readonly loadError = signal<string | null>(null);

  private async load(): Promise<void> {
    try {
      const [customers, countries] = await Promise.all([
        this.sales.customers(), this.sales.countries()]);
      this.customers.set(customers);
      /* A new customer's sheet that opened before this list takes the default country from it (customer-sheet.ts). */
      this.countries.set(countries);
      this.loadError.set(null);
      this.openWanted();
    } catch (failure: unknown) {
      this.loadError.set(messageOf(failure, LOAD_ERROR_FALLBACK));
    } finally {
      this.loading.set(false);
    }
  }

  /** The customer ?klant= asks for, until the list holds it. */
  private wantedId: number | null = null;

  private openWanted(): void {
    const id = this.wantedId;
    if (id == null || this.loading() && !this.customers().length) return;
    const customer = this.customers().find((candidate) => candidate.id === id);
    if (!customer && !this.customers().length) return;
    this.wantedId = null;
    void this.router.navigate([], { queryParams: { klant: null }, queryParamsHandling: 'merge', replaceUrl: true, relativeTo: this.route });
    if (customer) this.open(customer);
    else this.ui.toast('Deze klant bestaat niet meer', 'err');
  }

  /** "via Verhoeven": the partner in one word on a list row. */
  viaName(partnerName: string | null | undefined): string {
    return partnerShortName(partnerName, 'partner');
  }

  retryLoad(): void {
    if (this.loading()) return;
    this.loading.set(true);
    void this.load();
  }

  /** The search alone: the counts behind the status filter come from here, so they say what each choice would show. */
  private readonly searched = computed(() => filterCustomers(this.customers(), this.query(), 'ALLE'));

  /* Sorted on the Dutch country name the row shows, not on the ISO code. */
  readonly filtered = computed(() => sortCustomers(filterCustomers(this.searched(), '', this.status()), this.sort(), countryName));

  readonly statusOptions = computed<SegmentOption[]>(() => {
    const searched = this.searched();
    return [
      { id: 'ALLE', label: 'Alle', count: searched.length },
      ...CRM_STATUSES.map((status) => ({
        id: status.value,
        /* The chip row of the phone is narrow: one word there; the desk says the full one and falls back to the
           short one when its toolbar is too narrow for all five (the container query in the styles). */
        label: this.desktop.active() ? status.label : status.short,
        shortLabel: this.desktop.active() ? status.short : undefined,
        count: searched.filter((customer) => customer.crmStatus === status.value).length,
      })),
    ];
  });

  /** "🇧🇪 België · DAP" under a row; the flag or the incoterm can be missing, the separator goes with them. */
  placeLine(customer: Customer): string {
    return metaLine([`${countryFlag(customer.countryCode)} ${countryName(customer.countryCode)}`, customer.incoterm]);
  }

  setStatus(value: string): void {
    const status = STATUS_VALUES.includes(value) ? value as CrmStatus : 'ALLE';
    this.status.set(status);
    void this.router.navigate([], { queryParams: { status: status === 'ALLE' ? null : status }, queryParamsHandling: 'merge', replaceUrl: true, relativeTo: this.route });
  }

  setSort(value: string): void {
    const sort = CUSTOMER_SORTS.some((option) => option.value === value) ? value as CustomerSort : 'NAAM';
    this.sort.set(sort);
    try { localStorage.setItem(SORT_KEY, sort); } catch { /* a convenience: without storage the sort lasts this visit */ }
  }

  statusTone(status: CrmStatus | null | undefined): CrmTone | null {
    return CRM_STATUSES.find((entry) => entry.value === status)?.tone ?? null;
  }

  /** The ticked touchpoints of a row: up to three short pills, the rest as "+n", all of them with their dates in the title. */
  marks(customer: Customer): { shown: string[]; more: number; title: string } | null {
    const ticked = customer.touchpoints ?? [];
    if (!ticked.length) return null;
    const shorts = TOUCHPOINT_KINDS.filter((kind) => ticked.some((touchpoint) => touchpoint.kind === kind.kind)).map((kind) => kind.short);
    const unknown = ticked.filter((touchpoint) => !TOUCHPOINT_KINDS.some((kind) => kind.kind === touchpoint.kind)).map((touchpoint) => touchpoint.kind);
    const all = [...shorts, ...unknown];
    const year = new Date().getFullYear();
    return {
      shown: all.slice(0, MARKS_SHOWN),
      more: Math.max(0, all.length - MARKS_SHOWN),
      title: ticked.map((touchpoint) => `${touchpointLabel(touchpoint.kind)} · ${touchpointStamp(touchpoint, year)}`).join('\n'),
    };
  }

  open(customer: Customer | null): void {
    this.sheet.set({ customer });
  }

  /** The sheet saved or deleted (and said so): it closes and the list is read again. */
  sheetDone(): void {
    this.sheet.set(null);
    void this.load();
  }

  async newOrder(customer: Customer): Promise<void> {
    const view = await this.sales.createOrder(
      customer.id!, customer.countryCode, customer.incoterm);
    await this.router.navigate(['/sales', view.order.id, 'edit']);
  }
}

/** The last chosen sort, NAAM when none was kept or storage is off. */
function readStoredSort(): CustomerSort {
  try {
    const stored = localStorage.getItem(SORT_KEY);
    if (stored && CUSTOMER_SORTS.some((option) => option.value === stored)) return stored as CustomerSort;
  } catch { /* private mode */ }
  return 'NAAM';
}
