import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SalesApi } from '../../core/api/sales-api';
import { Country, Customer, LANGUAGES, QuoteStatus, SalesOrderView } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Privacy } from '../../core/api/privacy';
import { WorkQueue } from '../../core/api/work-queue';
import { Sheet, Ui } from '../../shared/ui';
import { DateNlPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import { STATUS_LABEL, actionNeeded, statusClass } from './quote-status';

@Component({
  selector: 'app-sales-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, PageHeader, Sheet, EurPipe, NumPipe, PctPipe, DateNlPipe],
  template: `
    <app-page-header title="Verkoop" [subtitle]="rows().length + ' orders'">
      <button class="btn btn--primary btn--sm hide-mobile" type="button" (click)="startNew()">
        + Nieuw
      </button>
    </app-page-header>

    <div class="content">
      <!-- Wat op ons wacht staat bovenaan, niet weggestopt onder Meer: dit is de
           lijst die je bijhoudt, niet iets wat je gaat opzoeken. -->
      @if (openWork().length) {
        <div class="card" style="border-color:var(--rose-line)">
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

      <div class="search-bar">
        <input class="input" type="search" inputmode="search"
               placeholder="Zoek op klant of nummer…"
               [ngModel]="query()" (ngModelChange)="query.set($event)" />
      </div>

      <div class="chips">
        @for (option of filters; track option.value) {
          <button class="chip" type="button" [class.active]="filter() === option.value"
                  (click)="filter.set(option.value)">{{ option.label }}</button>
        }
      </div>

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
                  {{ row.priced.totals.palletsStrict }} pallet(s)
                  @if (privacy.showPurchase() && row.priced.totals.marginPct) {
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
            <div class="empty">
              <div class="empty__icon">▤</div>
              <div class="empty__title">{{ loading() ? 'Laden…' : 'Geen orders' }}</div>
              @if (!loading()) {
                <button class="btn btn--primary" type="button" (click)="startNew()">
                  Nieuwe order
                </button>
              }
            </div>
          }
        </div>
      </div>
    </div>

    <button class="fab" type="button" (click)="startNew()">+ Order</button>

    @if (picking()) {
      <app-sheet title="Nieuwe verkooporder" (closed)="picking.set(false)">
        <div body>
          @if (!addingCustomer()) {
            <div class="field">
              <label class="req" for="so-customer">Klant</label>
              <select class="select" id="so-customer" [ngModel]="chosen()"
                      (ngModelChange)="chosen.set(+$event)">
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
            <button class="btn" type="button" (click)="picking.set(false)">Annuleren</button>
            <button class="btn btn--primary" type="button" [disabled]="chosen() === null"
                    (click)="create()">Openen</button>
          }
        </div>
      </app-sheet>
    }
  `,
})
export class SalesList {
  private readonly sales = inject(SalesApi);
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);
  readonly privacy = inject(Privacy);
  private readonly work = inject(WorkQueue);

  readonly filters: { value: QuoteStatus | ''; label: string }[] = [
    { value: '', label: 'Alle' },
    { value: 'CONCEPT', label: 'Concept' },
    { value: 'VERZONDEN', label: 'Verzonden' },
    { value: 'WIJZIGING_GEVRAAGD', label: 'Wijziging gevraagd' },
    { value: 'GEACCEPTEERD', label: 'Geaccepteerd' },
  ];

  readonly filter = signal<QuoteStatus | ''>('');
  readonly picking = signal(false);
  readonly chosen = signal<number | null>(null);
  readonly loading = signal(true);

  readonly all = signal<SalesOrderView[]>([]);
  readonly customers = signal<Customer[]>([]);
  readonly languages = LANGUAGES;
  readonly countries = signal<Country[]>([]);

  /* Klant snel toevoegen zonder het scherm te verlaten. */
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
  }

  startAddCustomer(): void {
    this.newCustomer.set(blankCustomer(this.countries()[0]?.code ?? 'BE'));
    this.addingCustomer.set(true);
  }

  patchNew(changes: Partial<Customer>): void {
    this.newCustomer.update((customer) => ({ ...customer, ...changes }));
  }

  /** Slaat de nieuwe klant op en selecteert hem meteen voor deze order. */
  async saveNewCustomer(): Promise<void> {
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

  readonly query = signal('');

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

  customerName(row: SalesOrderView): string {
    return this.customers().find((c) => c.id === row.order.customerId)?.company ?? 'Geen klant';
  }

  label = (status: QuoteStatus) => STATUS_LABEL[status];
  cls = statusClass;

  /** Wat er op ons ligt te wachten; dezelfde bron als het belletje en het bolletje. */
  readonly openWork = this.work.actions;

  workIcon(kind: string): string {
    switch (kind) {
      case 'LEVERTERMIJN': return '◷';
      case 'VRACHT': return '▤';
      case 'VOORSTEL': return '⇄';
      default: return '◉';
    }
  }
  /** Wat wij nog met deze offerte moeten doen, of niets. */
  todo = actionNeeded;

  startNew(): void {
    /* Geen klanten? Dan meteen het toevoegformulier, in plaats van wegsturen. */
    this.addingCustomer.set(!this.customers().length);
    if (this.addingCustomer()) this.startAddCustomer();
    this.picking.set(true);
  }

  async create(): Promise<void> {
    const customerId = this.chosen();
    if (customerId === null) return;
    const customer = this.customers().find((c) => c.id === customerId);
    const view = await this.sales.createOrder(
      customerId, customer?.countryCode ?? null, customer?.incoterm ?? 'DAP');
    this.picking.set(false);
    await this.router.navigate(['/sales', view.order.id]);
  }
}

function blankCustomer(countryCode: string): Customer {
  return {
    id: null, company: '', contact: '', email: '', phone: '', vatNumber: '',
    countryCode, language: 'NL', address: '', postalCode: '', city: '',
    incoterm: 'DAP', paymentTerms: '30 dagen', notes: '',
  };
}
