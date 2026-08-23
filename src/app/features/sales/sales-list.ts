import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SalesApi } from '../../core/api/sales-api';
import { Country, Customer, LANGUAGES, QuoteStatus, SalesOrderView } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { WorkQueue } from '../../core/api/work-queue';
import { Sheet, Ui } from '../../shared/ui';
import { Skeleton } from '../../shared/skeleton';
import { CbmPipe, DateNlPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import { STATUS_LABEL, actionNeeded, statusClass } from './quote-status';
import { messageOf } from '../../core/api/errors';

@Component({
  selector: 'app-sales-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, PageHeader, Sheet, Skeleton,
            EurPipe, NumPipe, PctPipe, CbmPipe, DateNlPipe],
  template: `
    <app-page-header title="Verkoop" [subtitle]="rows().length + ' orders'">
      <button class="btn btn--primary btn--sm hide-mobile" type="button" (click)="startNew()">
        + Nieuw
      </button>
    </app-page-header>

    <div class="content">
      <!-- What waits on us sits at the top, not tucked under Meer: this is
           the list you keep up with, not something you go look up. -->
      @if (openWork().length) {
        <!-- The card appears and disappears; without its own bottom margin it
             lands right on top of the search bar. -->
        <div class="card" style="border-color:var(--rose-line);margin-bottom:14px">
          <div class="card__head">
            <h2>Wacht op ons</h2>
            <span class="spacer"></span>
            <span class="badge badge--todo">{{ openWork().length }}</span>
          </div>
          <div class="card__body card__body--flush">
            <div class="list">
              @for (item of openWork(); track $index) {
                <a class="list-item" [routerLink]="['/sales', item.orderId]">
                  <span class="thumb thumb--placeholder">{{ workIcon(item.kind) }}</span>
                  <div class="list-item__body">
                    <div class="list-item__title">{{ item.title }}</div>
                    <div class="list-item__meta">
                      {{ item.orderNumber }}@if (item.customer) { · {{ item.customer }} }
                    </div>
                  </div>
                  <span class="list-item__chev">›</span>
                </a>
              }
            </div>
          </div>
        </div>
      }

      <section class="order-finder" aria-labelledby="order-finder-title">
        <div class="order-finder__head">
          <div>
            <h2 id="order-finder-title">Orders vinden</h2>
            <p>Zoek op klant of ordernummer, of filter op status.</p>
          </div>
          @if (activeFilterCount()) {
            <button class="filter-reset" type="button" (click)="clearFilters()">
              Wis filters
              <span aria-hidden="true">{{ activeFilterCount() }}</span>
            </button>
          }
        </div>

        <div class="filter-controls">
          <div class="filter-field">
            <label for="sales-search">Klant of ordernummer</label>
            <div class="search-control">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="6.5"></circle>
                <path d="m16 16 4 4"></path>
              </svg>
              <input class="input" id="sales-search" type="search" inputmode="search"
                     autocomplete="off" placeholder="Bijv. De Vries of SO-1024"
                     [ngModel]="query()" (ngModelChange)="query.set($event)" />
              @if (query()) {
                <button class="search-clear" type="button" aria-label="Zoekopdracht wissen"
                        (click)="query.set('')">×</button>
              }
            </div>
          </div>

          <!-- A native select is easier to scan and never overflows on a phone. -->
          <div class="filter-field mobile-status">
            <label for="sales-status">Offertestatus</label>
            <select class="select" id="sales-status" [ngModel]="filter()"
                    (ngModelChange)="selectStatus($event)">
              @for (option of filters; track option.value) {
                <option [ngValue]="option.value">
                  {{ option.label }} ({{ statusCount(option.value) }})
                </option>
              }
            </select>
          </div>
        </div>

        <!-- Wider screens use a stable grid rather than a rail with a stray
             last chip on a second line. The pressed state remains explicit. -->
        <div class="desktop-status" role="group" aria-label="Offertestatus">
          <div class="desktop-status__label">Offertestatus</div>
          <div class="status-grid">
            @for (option of filters; track option.value) {
              <button class="status-option" type="button"
                      [class.status-option--active]="filter() === option.value"
                      [attr.aria-pressed]="filter() === option.value"
                      (click)="selectStatus(option.value)">
                <span>{{ option.label }}</span>
                <span class="status-option__count">{{ statusCount(option.value) }}</span>
              </button>
            }
          </div>
        </div>

        <div class="filter-result" role="status" aria-live="polite">
          <div class="filter-result__copy">
            <strong>{{ rows().length }}</strong>
            {{ rows().length === 1 ? 'order gevonden' : 'orders gevonden' }}
            @if (rows().length !== all().length) {
              <span>van {{ all().length }}</span>
            }
          </div>
          <div class="active-filters" aria-label="Actieve filters">
            @if (filter()) {
              <span>Status: {{ activeStatusLabel() }}</span>
            }
            @if (query().trim(); as term) {
              <span class="active-filters__query">Zoekterm: “{{ term }}”</span>
            }
          </div>
        </div>
      </section>

      <div class="card">
        <div class="list">
          @for (row of rows(); track row.order.id) {
            <a class="list-item" [routerLink]="['/sales', row.order.id]">
              <div class="list-item__body">
                <div class="list-item__title">{{ customerName(row) }}</div>
                <!-- No country chip: it repeats what the customer name already
                     implies and pushed the date into "18/0...". -->
                <div class="list-item__meta list-item__meta--wrap">
                  {{ row.order.number }} · {{ row.order.orderDate | dateNl }}
                </div>
                <div class="list-item__meta list-item__meta--wrap">
                  {{ row.priced.totals.pieces | num }} st ·
                  @if (row.order.loadMode === 'LOOSE_CARTONS') {
                    {{ row.priced.totals.cartons | num }}
                    {{ row.priced.totals.cartons === 1 ? 'doos' : 'dozen' }} ·
                    {{ row.priced.totals.cbm | cbm }}
                  } @else {
                    {{ row.priced.totals.palletsManual || row.priced.totals.palletsStrict }}
                    {{ (row.priced.totals.palletsManual || row.priced.totals.palletsStrict) === 1
                        ? 'pallet' : 'pallets' }}
                  }
                  @if (row.priced.totals.marginPct) {
                    · marge {{ row.priced.totals.marginPct | pct: 0 }}
                  }
                </div>
              </div>
              <div class="list-item__end list-item__end--stacked">
                <div class="strong num">{{ row.priced.totals.total | eur: 0 }}</div>
                <span class="badge" [class]="'badge--' + cls(row.order.status)">
                  {{ label(row.order.status) }}
                </span>
                @if (todo(row.order); as task) {
                  <span class="badge badge--todo">{{ task }}</span>
                }
              </div>
              <span class="list-item__chev">›</span>
            </a>
          } @empty {
            @if (loading()) {
              <app-skeleton kind="list" [rows]="5" />
            } @else if (activeFilterCount()) {
              <div class="empty">
                <div class="empty__icon">⌕</div>
                <div class="empty__title">Geen orders gevonden</div>
                <p class="muted">Pas de zoekterm of offertestatus aan.</p>
                <button class="btn" type="button" (click)="clearFilters()">
                  Filters wissen
                </button>
              </div>
            } @else {
              <div class="empty">
                <div class="empty__icon">▤</div>
                <div class="empty__title">Geen orders</div>
                <button class="btn btn--primary" type="button" (click)="startNew()">
                  Nieuwe order
                </button>
              </div>
            }
          }
        </div>
      </div>
    </div>

    <button class="fab" type="button" (click)="startNew()">+ Order</button>

    @if (picking()) {
      <app-sheet title="Nieuwe verkooporder" (closed)="picking.set(false)">
        <div body>
          @if (loading()) {
            <app-skeleton kind="lines" [rows]="3" />
          } @else if (!addingCustomer()) {
            <div class="field">
              <label class="req" for="so-customer">Klant</label>
              <select class="select" id="so-customer" [ngModel]="chosen()"
                      (ngModelChange)="selectCustomer($event)">
                @for (customer of customers(); track customer.id) {
                  <option [ngValue]="customer.id">
                    {{ customer.company }} — {{ customer.city }} ({{ customer.countryCode }})
                  </option>
                }
              </select>
            </div>
            <button class="btn btn--block" type="button" (click)="startAddCustomer()">
              + Klant staat er nog niet bij
            </button>
            <p class="tiny muted mt-8">
              Op de beurs staat de klant vaak nog niet in het systeem. Voeg hem hier meteen toe
              zonder de order te verlaten.
            </p>
          } @else {
            <p class="legend"><b>*</b> verplicht — de rest kan je later aanvullen.</p>
            <div class="form-grid">
              <div class="field span-2">
                <label class="req" for="nc-company">Bedrijfsnaam</label>
                <input class="input" id="nc-company" [ngModel]="newCustomer().company"
                       (ngModelChange)="patchNew({ company: $event })" />
              </div>
              <div class="field">
                <label for="nc-contact">Contactpersoon <span class="opt"></span></label>
                <input class="input" id="nc-contact" [ngModel]="newCustomer().contact"
                       (ngModelChange)="patchNew({ contact: $event })" />
              </div>
              <div class="field">
                <label for="nc-email">E-mail <span class="opt"></span></label>
                <input class="input" id="nc-email" type="email" [ngModel]="newCustomer().email"
                       (ngModelChange)="patchNew({ email: $event })" />
                <span class="hint">Nodig zodra je de offerte wil versturen.</span>
              </div>
              <div class="field">
                <label class="req" for="nc-country">Land</label>
                <select class="select" id="nc-country" [ngModel]="newCustomer().countryCode"
                        (ngModelChange)="patchNew({ countryCode: $event })">
                  @for (country of countries(); track country.code) {
                    <option [value]="country.code">{{ country.name }}</option>
                  }
                </select>
              </div>
              <div class="field">
                <label class="req" for="nc-language">Taal</label>
                <select class="select" id="nc-language" [ngModel]="newCustomer().language"
                        (ngModelChange)="patchNew({ language: $event })">
                  @for (language of languages; track language.code) {
                    <option [value]="language.code">{{ language.label }}</option>
                  }
                </select>
                <span class="hint">De offerte vertrekt in deze taal.</span>
              </div>
              <div class="field">
                <label for="nc-city">Stad <span class="opt"></span></label>
                <input class="input" id="nc-city" [ngModel]="newCustomer().city"
                       (ngModelChange)="patchNew({ city: $event })" />
              </div>
            </div>
          }
        </div>
        <div foot style="display:contents">
          @if (addingCustomer()) {
            <button class="btn" type="button" (click)="addingCustomer.set(false)">Terug</button>
            <button class="btn btn--primary" type="button" [disabled]="busy()"
                    (click)="saveNewCustomer()">Klant opslaan</button>
          } @else {
            <button class="btn" type="button" [disabled]="creating()"
                    (click)="picking.set(false)">Annuleren</button>
            <button class="btn btn--primary" type="button"
                    [disabled]="loading() || creating() || chosen() === null"
                    [attr.aria-busy]="creating()"
                    (click)="create()">
              {{ creating() ? 'Aanmaken…' : 'Openen' }}
            </button>
          }
        </div>
      </app-sheet>
    }
  `,
  styles: `
    .order-finder {
      min-width: 0;
      margin-bottom: 14px;
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: var(--r);
      background: var(--surface);
      box-shadow: var(--shadow-sm);
    }
    .order-finder__head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 15px;
    }
    .order-finder__head h2 { margin: 0; font-size: 16px; letter-spacing: -.01em; }
    .order-finder__head p {
      margin: 3px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }
    .filter-reset {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: 6px;
      min-height: 36px;
      padding: 5px 8px 5px 10px;
      border: 1px solid var(--rose-line);
      border-radius: 999px;
      background: var(--rose-soft);
      color: var(--rose-dark);
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .filter-reset span {
      display: grid;
      min-width: 20px;
      height: 20px;
      padding: 0 5px;
      place-items: center;
      border-radius: 999px;
      background: var(--rose);
      color: white;
      font-size: 10px;
      font-variant-numeric: tabular-nums;
    }
    .filter-controls { display: grid; gap: 12px; min-width: 0; }
    .filter-field { display: flex; min-width: 0; flex-direction: column; gap: 5px; }
    .filter-field > label,
    .desktop-status__label {
      color: var(--ink-2);
      font-size: 12px;
      font-weight: 700;
    }
    .search-control { position: relative; min-width: 0; }
    .search-control > svg {
      position: absolute;
      top: 50%;
      left: 14px;
      width: 18px;
      height: 18px;
      transform: translateY(-50%);
      fill: none;
      stroke: var(--muted);
      stroke-linecap: round;
      stroke-width: 1.8;
      pointer-events: none;
    }
    .search-control .input { padding-right: 46px; padding-left: 42px; }
    .search-control .input::-webkit-search-cancel-button { appearance: none; }
    .search-clear {
      position: absolute;
      top: 50%;
      right: 5px;
      display: grid;
      width: 36px;
      height: 36px;
      padding: 0;
      transform: translateY(-50%);
      place-items: center;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--muted);
      font-size: 22px;
      cursor: pointer;
    }
    .search-clear:hover { background: var(--surface-2); color: var(--ink); }
    .desktop-status { display: none; }
    .filter-result {
      display: flex;
      min-width: 0;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 7px 12px;
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid var(--line);
      color: var(--ink-2);
      font-size: 12px;
    }
    .filter-result__copy strong { color: var(--ink); font-size: 14px; }
    .filter-result__copy span { color: var(--muted); }
    .active-filters { display: flex; min-width: 0; flex-wrap: wrap; gap: 5px; }
    .active-filters > span {
      display: block;
      max-width: 100%;
      padding: 3px 8px;
      overflow: hidden;
      border-radius: 999px;
      background: var(--rose-soft);
      color: var(--rose-dark);
      font-size: 11px;
      font-weight: 650;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .empty p { margin: 5px 0 13px; font-size: 13px; }

    @media (min-width: 620px) {
      .filter-controls { grid-template-columns: minmax(0, 1.5fr) minmax(190px, .75fr); }
    }

    @media (min-width: 680px) {
      .order-finder { padding: 18px; }
      .filter-controls { grid-template-columns: minmax(320px, 560px); }
      .mobile-status { display: none; }
      .desktop-status { display: block; margin-top: 14px; }
      .desktop-status__label { margin-bottom: 6px; }
      .status-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 7px;
      }
      .status-option {
        display: flex;
        min-width: 0;
        min-height: 40px;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 10px;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: var(--surface-2);
        color: var(--ink-2);
        font-size: 12px;
        font-weight: 650;
        text-align: left;
        cursor: pointer;
      }
      .status-option:hover { border-color: var(--rose-line); background: var(--rose-soft); }
      .status-option--active {
        border-color: var(--rose);
        background: var(--rose);
        color: white;
      }
      .status-option--active:hover { border-color: var(--rose-dark); background: var(--rose-dark); }
      .status-option > span:first-child {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .status-option__count {
        display: grid;
        flex: 0 0 auto;
        min-width: 22px;
        height: 22px;
        padding: 0 5px;
        place-items: center;
        border-radius: 999px;
        background: rgb(0 0 0 / 6%);
        font-size: 10px;
        font-variant-numeric: tabular-nums;
      }
      .status-option--active .status-option__count { background: rgb(255 255 255 / 22%); }
    }
  `,
})
export class SalesList {
  private readonly sales = inject(SalesApi);
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);
  private readonly work = inject(WorkQueue);

  readonly filters: { value: QuoteStatus | ''; label: string }[] = [
    { value: '', label: 'Alle orders' },
    { value: 'CONCEPT', label: 'Concept' },
    { value: 'VERZONDEN', label: 'Verzonden' },
    { value: 'BEKEKEN', label: 'Bekeken' },
    { value: 'WIJZIGING_GEVRAAGD', label: 'Wijziging gevraagd' },
    { value: 'GEACCEPTEERD', label: 'Geaccepteerd' },
    { value: 'AFGEWEZEN', label: 'Afgewezen' },
    { value: 'VERLOPEN', label: 'Verlopen' },
  ];

  readonly filter = signal<QuoteStatus | ''>('');
  readonly query = signal('');
  readonly picking = signal(false);
  readonly chosen = signal<number | null>(null);
  readonly creating = signal(false);
  readonly loading = signal(true);

  readonly all = signal<SalesOrderView[]>([]);
  readonly customers = signal<Customer[]>([]);
  readonly languages = LANGUAGES;
  readonly countries = signal<Country[]>([]);

  /* Add a customer quickly without leaving the screen. */
  readonly addingCustomer = signal(false);
  readonly busy = signal(false);
  readonly newCustomer = signal<Customer>(blankCustomer('BE'));

  constructor() {
    void this.work.refresh();
    void this.load();
  }

  private async load(): Promise<void> {
    const [orders, customers, countries] = await Promise.all([
      this.sales.orders(), this.sales.customers(), this.sales.countries(),
    ]);
    this.all.set(orders);
    this.customers.set(customers);
    this.countries.set(countries);
    this.chosen.set(customers[0]?.id ?? null);
    this.loading.set(false);
    /* The user may already be in the new-order sheet; now the real
       decision can be made. */
    if (this.picking() && !customers.length) {
      this.addingCustomer.set(true);
      this.startAddCustomer();
    }
  }

  startAddCustomer(): void {
    this.newCustomer.set(blankCustomer(this.countries()[0]?.code ?? 'BE'));
    this.addingCustomer.set(true);
  }

  patchNew(changes: Partial<Customer>): void {
    this.newCustomer.update((customer) => ({ ...customer, ...changes }));
  }

  /** Saves the new customer and selects them for this order right away. */
  async saveNewCustomer(): Promise<void> {
    if (this.busy()) return;
    if (!this.newCustomer().company.trim()) {
      this.ui.toast('Bedrijfsnaam is verplicht', 'err');
      return;
    }
    this.busy.set(true);
    try {
      const saved = await this.sales.createCustomer(this.newCustomer());
      this.customers.update((list) => [...list, saved]);
      this.chosen.set(saved.id);
      this.addingCustomer.set(false);
      this.ui.toast(`${saved.company} toegevoegd`);
    } catch (failure: unknown) {
      const message = (failure as { error?: { message?: string } }).error?.message;
      this.ui.toast(message ?? 'Klant opslaan mislukt', 'err');
    } finally {
      this.busy.set(false);
    }
  }

  readonly rows = computed(() => {
    const status = this.filter();
    const needle = this.query().toLowerCase().trim();
    return this.all().filter((row) => {
      if (status && row.order.status !== status) return false;
      if (!needle) return true;
      /* Customer and number are how anyone refers to an order out loud. */
      return (this.customerName(row) + ' ' + row.order.number)
        .toLowerCase()
        .includes(needle);
    });
  });

  readonly activeFilterCount = computed(() =>
    (this.filter() ? 1 : 0) + (this.query().trim() ? 1 : 0));

  readonly activeStatusLabel = computed(() =>
    this.filters.find((option) => option.value === this.filter())?.label ?? 'Alle orders');

  selectStatus(status: QuoteStatus | ''): void {
    this.filter.set(status);
  }

  clearFilters(): void {
    this.query.set('');
    this.filter.set('');
  }

  statusCount(status: QuoteStatus | ''): number {
    return status ? this.all().filter((row) => row.order.status === status).length : this.all().length;
  }

  customerName(row: SalesOrderView): string {
    return this.customers().find((c) => c.id === row.order.customerId)?.company ?? 'Geen klant';
  }

  label = (status: QuoteStatus) => STATUS_LABEL[status];
  cls = statusClass;

  /** What is waiting on us; the same source as the bell and the dot. */
  readonly openWork = this.work.actions;

  workIcon(kind: string): string {
    switch (kind) {
      case 'LEVERTERMIJN': return '◷';
      case 'VRACHT': return '▤';
      case 'VOORSTEL': return '⇄';
      default: return '◉';
    }
  }
  /** What we still must do with this quote, or nothing. */
  todo = actionNeeded;

  startNew(): void {
    this.picking.set(true);
    /* While the data is still loading the sheet shows a skeleton; load()
       makes the no-customers-yet call once it actually knows. Deciding on
       an empty in-flight list opened the add-customer form by accident. */
    if (this.loading()) return;
    this.addingCustomer.set(!this.customers().length);
    if (this.addingCustomer()) this.startAddCustomer();
  }

  selectCustomer(value: number | null): void {
    const customerId = Number(value);
    this.chosen.set(Number.isInteger(customerId) && customerId > 0 ? customerId : null);
  }

  async create(): Promise<void> {
    if (this.creating()) return;
    const customerId = this.chosen();
    if (customerId === null) {
      this.ui.toast('Kies eerst een klant', 'err');
      return;
    }
    const customer = this.customers().find((c) => c.id === customerId);
    if (!customer) {
      this.chosen.set(null);
      this.ui.toast('De gekozen klant bestaat niet meer', 'err');
      return;
    }

    this.creating.set(true);
    let view: SalesOrderView;
    try {
      view = await this.sales.createOrder(
        customerId, customer.countryCode, customer.incoterm || 'DAP');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Order aanmaken mislukt'), 'err');
      this.creating.set(false);
      return;
    }

    this.picking.set(false);
    try {
      const opened = await this.router.navigate(['/sales', view.order.id, 'edit']);
      if (opened) {
        this.creating.set(false);
        return;
      }
    } catch {
      /* Keep the freshly created order reachable below. */
    }

    this.all.update((orders) => orders.some((row) => row.order.id === view.order.id)
      ? orders : [view, ...orders]);
    this.creating.set(false);
    this.ui.toast(
      `Order ${view.order.number} is aangemaakt. Open hem vanuit het overzicht.`, 'err');
  }
}

function blankCustomer(countryCode: string): Customer {
  return {
    id: null, company: '', contact: '', email: '', phone: '', vatNumber: '',
    countryCode, language: 'NL', address: '', postalCode: '', city: '',
    incoterm: 'DAP', paymentTerms: '30 dagen', notes: '',
  };
}
