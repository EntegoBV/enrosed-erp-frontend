import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SalesApi } from '../../core/api/sales-api';
import { Country, Customer, LANGUAGES } from '../../core/api/models';
import { STANDARD_PAYMENT_TERMS } from '../../core/api/geo';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui } from '../../shared/ui';
import { countryName } from '../../core/api/geo';

function blank(countryCode: string): Customer {
  return {
    id: null, company: '', contact: '', email: '', phone: '', vatNumber: '',
    countryCode, language: 'NL', address: '', postalCode: '', city: '',
    incoterm: 'DAP', paymentTerms: 'Vooruitbetaling', notes: '',
  };
}

@Component({
  selector: 'app-customer-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, FormsModule, PageHeader, Sheet],
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
            <button class="list-item__body customer-open" type="button" (click)="open(customer)"
                    [attr.aria-label]="customer.company + ' bewerken'">
              <div class="list-item__title">{{ customer.company }}</div>
              <div class="list-item__meta">{{ customer.contact }} · {{ customer.city }}</div>
              <div class="list-item__meta">
                <span class="flag">{{ customer.countryCode }}</span> {{ customer.incoterm }}
                @if (!customer.email) { · <span class="warn-text">geen e-mail</span> }
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
            <div class="field"><label class="req" for="c-vat">BTW-nummer</label>
              <input class="input" id="c-vat" [ngModel]="draft().vatNumber" placeholder="bijv. BE0123456789"
                     (ngModelChange)="patch({ vatNumber: $event })" />
              @if (vatCountryMismatch(); as mismatch) {
                <span class="hint hint--warn">Landcode {{ mismatch.prefix }} in het BTW-nummer verschilt van het land ({{ mismatch.country }}). Opslaan mag; wij controleren het handmatig.</span>
              } @else {
                <span class="hint">Verplicht. Klopt het niet met het land, dan controleren we het zelf na.</span>
              }</div>
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
              <select class="select" id="c-country" [ngModel]="countrySelectValue()"
                      (ngModelChange)="pickCountry($event)">
                @for (country of countries(); track country.code) {
                  <option [value]="country.code">{{ country.name }}</option>
                }
                <option value="__other__">Ander land…</option>
              </select>
              @if (countrySelectValue() === '__other__') {
                <input class="input mt-8" aria-label="Landcode (ISO, 2 letters)" maxlength="2"
                       placeholder="Landcode, bijv. AT" [ngModel]="draft().countryCode"
                       (ngModelChange)="patch({ countryCode: ($event || '').toUpperCase() })" />
                <span class="hint hint--warn">{{ countryLabel(draft().countryCode) }} · staat niet bij Landen &amp; vracht:
                  offertes naar dit land lukken pas als je het daar toevoegt.</span>
              }</div>
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
              <select class="select" id="c-terms" [ngModel]="paymentChoice()"
                      (ngModelChange)="pickPaymentTerms($event)">
                @for (term of paymentTerms; track term) {
                  <option [value]="term">{{ term }}</option>
                }
                <option value="__other__">Anders…</option>
              </select>
              @if (customPaymentTerms()) {
                <input class="input mt-8" aria-label="Eigen betaalvoorwaarden"
                       placeholder="Eigen voorwaarden…" [ngModel]="draft().paymentTerms"
                       (ngModelChange)="patch({ paymentTerms: $event })" />
              }
              <span class="hint">
                Voorwaarden uit de lijst worden op offertes automatisch vertaald.
              </span></div>
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
          <button class="btn btn--primary" type="button" [disabled]="saving()" (click)="save()">
            {{ saving() ? 'Bezig…' : 'Opslaan' }}
          </button>
        </div>
      </app-sheet>
    }
  `,
  styles: `
    .customer-open { align-self: stretch; min-width: 0; border: 0; background: transparent;
      padding: 0; text-align: left; cursor: pointer; border-radius: 8px; }
  `,
})
export class CustomerList {
  readonly paymentTerms = STANDARD_PAYMENT_TERMS;
  /** True while terms outside the standard list are being typed. */
  readonly customPaymentTerms = signal(false);

  paymentChoice(): string {
    if (this.customPaymentTerms()) return '__other__';
    const terms = this.draft().paymentTerms ?? '';
    return (this.paymentTerms as readonly string[]).includes(terms) ? terms : '__other__';
  }

  pickPaymentTerms(choice: string): void {
    if (choice === '__other__') {
      this.customPaymentTerms.set(true);
      return;
    }
    this.customPaymentTerms.set(false);
    this.patch({ paymentTerms: choice });
  }

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

  constructor() {
    /* Deep links (the sales hero) filter the list straight to one customer. */
    const q = inject(ActivatedRoute).snapshot.queryParamMap.get('q');
    if (q) this.query.set(q);
    void this.load();
  }

  private async load(): Promise<void> {
    const [customers, countries] = await Promise.all([
      this.sales.customers(), this.sales.countries()]);
    this.customers.set(customers);
    this.countries.set(countries);
    /* The sheet can open before this list arrives: without repair the new
       customer sat on "Ander land…" with an empty code. */
    if (this.editing() && this.draft().id === null && !this.draft().countryCode) {
      this.patch({ countryCode: this.defaultCountry() });
    }
    this.loading.set(false);
  }

  readonly filtered = computed(() => {
    const needle = this.query().toLowerCase().trim();
    return this.customers().filter((customer) => !needle ||
      [customer.company, customer.contact, customer.city, customer.countryCode]
        .join(' ').toLowerCase().includes(needle));
  });

  /** The configured code, or "other" when the customer's country is not in the freight list. */
  readonly countrySelectValue = computed(() => {
    const code = this.draft().countryCode;
    return this.countries().some((country) => country.code === code) ? code : '__other__';
  });

  pickCountry(value: string): void {
    if (value === '__other__') {
      this.patch({ countryCode: '' });
      return;
    }
    this.patch({ countryCode: value });
  }

  countryLabel(code: string): string {
    return code && code.length === 2 ? countryName(code) : 'Twee letters (ISO), bijv. AT voor Oostenrijk';
  }

  open(customer: Customer | null): void {
    this.draft.set(customer ? { ...customer } : blank(this.defaultCountry()));
    this.editing.set(true);
  }

  /** Home first when it ships, otherwise the first configured country -
      never a hardcoded guess, which showed "Ander land…" on every new
      customer whenever the guess was not in Landen & vracht. */
  private defaultCountry(): string {
    const codes = this.countries().map((country) => country.code);
    return codes.includes('BE') ? 'BE' : codes[0] ?? '';
  }

  patch(changes: Partial<Customer>): void {
    this.draft.update((customer) => ({ ...customer, ...changes }));
  }

  readonly saving = signal(false);

  /** The two letters of the VAT number next to the customer's country, when they differ. */
  readonly vatCountryMismatch = computed(() => {
    const vat = (this.draft().vatNumber ?? '').replace(/[\s.\-]/g, '').toUpperCase();
    const country = (this.draft().countryCode ?? '').trim().toUpperCase();
    const prefix = /^[A-Z]{2}/.exec(vat)?.[0];
    if (!prefix || !country) return null;
    const same = prefix === country || (prefix === 'EL' && country === 'GR') || (prefix === 'XI' && country === 'GB');
    return same ? null : { prefix, country };
  });

  async save(): Promise<void> {
    /* A second tap while the first is under way made a second customer. */
    if (this.saving()) return;
    const customer = this.draft();
    if (!(customer.countryCode ?? '').trim()) {
      this.ui.toast('Kies een land voor de klant', 'err');
      return;
    }
    if (!(customer.vatNumber ?? '').trim()) {
      this.ui.toast('Vul het BTW-nummer in; het mag niet leeg zijn', 'err');
      setTimeout(() => document.getElementById('c-vat')?.focus(), 100);
      return;
    }
    this.saving.set(true);
    try {
      if (customer.id === null) await this.sales.createCustomer(customer);
      else await this.sales.updateCustomer(customer.id, customer);
      this.editing.set(false);
      await this.load();
      this.ui.toast('Klant opgeslagen');
    } catch (failure: unknown) {
      this.ui.toast(message(failure, 'Opslaan mislukt'), 'err');
    } finally {
      this.saving.set(false);
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
    await this.router.navigate(['/sales', view.order.id, 'edit']);
  }
}

function message(failure: unknown, fallback: string): string {
  return (failure as { error?: { message?: string } }).error?.message ?? fallback;
}
