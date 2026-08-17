import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SalesApi } from '../../core/api/sales-api';
import { Country, Customer, LANGUAGES } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Sheet, Ui } from '../../shared/ui';

function blank(countryCode: string): Customer {
  return {
    id: null, company: '', contact: '', email: '', phone: '', vatNumber: '',
    countryCode, language: 'NL', address: '', postalCode: '', city: '',
    incoterm: 'DAP', paymentTerms: '30 dagen', notes: '',
  };
}

@Component({
  selector: 'app-customer-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeader, Sheet],
  template: `
    <app-page-header title="Klanten" [subtitle]="filtered().length + ' klanten'">
      <button class="btn btn--primary btn--sm hide-mobile" type="button" (click)="open(null)">
        + Nieuw
      </button>
    </app-page-header>

    <div class="content">
      <div class="search-bar">
        <input class="input" type="search" placeholder="Zoek op bedrijf, contact of stad…"
               [ngModel]="query()" (ngModelChange)="query.set($event)" />
      </div>

      <div class="card"><div class="list">
        @for (customer of filtered(); track customer.id) {
          <div class="list-item">
            <div class="list-item__body" style="cursor:pointer" (click)="open(customer)">
              <div class="list-item__title">{{ customer.company }}</div>
              <div class="list-item__meta">{{ customer.contact }} · {{ customer.city }}</div>
              <div class="list-item__meta">
                <span class="flag">{{ customer.countryCode }}</span> {{ customer.incoterm }}
                @if (!customer.email) { · <span class="warn-text">geen e-mail</span> }
              </div>
            </div>
            <button class="btn btn--sm btn--primary" type="button"
                    (click)="newOrder(customer)">Order</button>
          </div>
        } @empty {
          <div class="empty"><div class="empty__title">
            {{ loading() ? 'Laden…' : 'Geen klanten gevonden' }}</div></div>
        }
      </div></div>
    </div>

    <button class="fab" type="button" (click)="open(null)">+ Klant</button>

    @if (editing()) {
      <app-sheet [title]="draft().id ? 'Klant bewerken' : 'Nieuwe klant'"
                 (closed)="editing.set(false)">
        <div body>
          <p class="legend"><b>*</b> verplicht · de rest kan later.</p>
          <div class="form-grid">
            <div class="field span-2"><label class="req" for="c-company">Bedrijfsnaam</label>
              <input class="input" id="c-company" [ngModel]="draft().company"
                     (ngModelChange)="patch({ company: $event })" /></div>
            <div class="field"><label for="c-contact">Contactpersoon</label>
              <input class="input" id="c-contact" [ngModel]="draft().contact"
                     (ngModelChange)="patch({ contact: $event })" /></div>
            <div class="field"><label for="c-email">E-mail <span class="opt"></span></label>
              <input class="input" id="c-email" type="email" [ngModel]="draft().email"
                     (ngModelChange)="patch({ email: $event })" />
              <span class="hint">Nodig om de offerte te kunnen versturen.</span></div>
            <div class="field"><label for="c-phone">Telefoon</label>
              <input class="input" id="c-phone" type="tel" [ngModel]="draft().phone"
                     (ngModelChange)="patch({ phone: $event })" /></div>
            <div class="field"><label for="c-vat">BTW-nummer <span class="opt"></span></label>
              <input class="input" id="c-vat" [ngModel]="draft().vatNumber"
                     (ngModelChange)="patch({ vatNumber: $event })" /></div>
            <div class="field span-2"><label for="c-address">Adres</label>
              <input class="input" id="c-address" [ngModel]="draft().address"
                     (ngModelChange)="patch({ address: $event })" /></div>
            <div class="field"><label for="c-zip">Postcode</label>
              <input class="input" id="c-zip" [ngModel]="draft().postalCode"
                     (ngModelChange)="patch({ postalCode: $event })" /></div>
            <div class="field"><label for="c-city">Stad</label>
              <input class="input" id="c-city" [ngModel]="draft().city"
                     (ngModelChange)="patch({ city: $event })" /></div>
            <div class="field"><label class="req" for="c-country">Land</label>
              <select class="select" id="c-country" [ngModel]="draft().countryCode"
                      (ngModelChange)="patch({ countryCode: $event })">
                @for (country of countries(); track country.code) {
                  <option [value]="country.code">{{ country.name }}</option>
                }
              </select></div>
            <div class="field"><label class="req" for="c-language">Taal van de klant</label>
              <select class="select" id="c-language" [ngModel]="draft().language"
                      (ngModelChange)="patch({ language: $event })">
                @for (language of languages; track language.code) {
                  <option [value]="language.code">{{ language.label }}</option>
                }
              </select>
              <span class="hint">Offerte, PDF en klantportaal vertrekken in deze taal.</span></div>
            <div class="field"><label for="c-incoterm">Incoterm</label>
              <select class="select" id="c-incoterm" [ngModel]="draft().incoterm"
                      (ngModelChange)="patch({ incoterm: $event })">
                @for (term of incoterms; track term) { <option [value]="term">{{ term }}</option> }
              </select></div>
            <div class="field span-2"><label for="c-terms">Betaalvoorwaarden</label>
              <input class="input" id="c-terms" [ngModel]="draft().paymentTerms"
                     (ngModelChange)="patch({ paymentTerms: $event })" /></div>
            <div class="field span-2"><label for="c-notes">Notities <span class="opt"></span></label>
              <textarea class="textarea" id="c-notes" [ngModel]="draft().notes"
                        (ngModelChange)="patch({ notes: $event })"></textarea></div>
          </div>
        </div>
        <div foot style="display:contents">
          @if (draft().id) {
            <button class="btn btn--danger" type="button" (click)="remove()">Verwijderen</button>
          }
          <span class="spacer"></span>
          <button class="btn" type="button" (click)="editing.set(false)">Annuleren</button>
          <button class="btn btn--primary" type="button" (click)="save()">Opslaan</button>
        </div>
      </app-sheet>
    }
  `,
})
export class CustomerList {
  private readonly sales = inject(SalesApi);
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);

  readonly languages = LANGUAGES;
  readonly incoterms = ['EXW', 'FOB', 'CIF', 'DAP', 'DDP'];

  readonly customers = signal<Customer[]>([]);
  readonly countries = signal<Country[]>([]);
  readonly query = signal('');
  readonly editing = signal(false);
  readonly draft = signal<Customer>(blank('BE'));
  readonly loading = signal(true);

  constructor() { void this.load(); }

  private async load(): Promise<void> {
    const [customers, countries] = await Promise.all([
      this.sales.customers(), this.sales.countries()]);
    this.customers.set(customers);
    this.countries.set(countries);
    this.loading.set(false);
  }

  readonly filtered = computed(() => {
    const needle = this.query().toLowerCase().trim();
    return this.customers().filter((customer) => !needle ||
      [customer.company, customer.contact, customer.city, customer.countryCode]
        .join(' ').toLowerCase().includes(needle));
  });

  open(customer: Customer | null): void {
    this.draft.set(customer ? { ...customer } : blank(this.countries()[0]?.code ?? 'BE'));
    this.editing.set(true);
  }

  patch(changes: Partial<Customer>): void {
    this.draft.update((customer) => ({ ...customer, ...changes }));
  }

  async save(): Promise<void> {
    const customer = this.draft();
    try {
      if (customer.id === null) await this.sales.createCustomer(customer);
      else await this.sales.updateCustomer(customer.id, customer);
      this.editing.set(false);
      await this.load();
      this.ui.toast('Klant opgeslagen');
    } catch (failure: unknown) {
      this.ui.toast(message(failure, 'Opslaan mislukt'), 'err');
    }
  }

  remove(): void {
    const customer = this.draft();
    this.ui.confirm(
      { title: 'Klant verwijderen', message: `<b>${customer.company}</b> verwijderen?`,
        confirmLabel: 'Verwijderen', danger: true },
      async () => {
        await this.sales.deleteCustomer(customer.id!);
        this.editing.set(false);
        await this.load();
        this.ui.toast('Klant verwijderd');
      });
  }

  async newOrder(customer: Customer): Promise<void> {
    const view = await this.sales.createOrder(
      customer.id!, customer.countryCode, customer.incoterm);
    await this.router.navigate(['/sales', view.order.id]);
  }
}

function message(failure: unknown, fallback: string): string {
  return (failure as { error?: { message?: string } }).error?.message ?? fallback;
}
