import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SalesApi } from '../../core/api/sales-api';
import { PartnerSalesApi } from '../../core/api/partner-sales-api';
import { WorkQueue } from '../../core/api/work-queue';
import { Country, Customer, LANGUAGES } from '../../core/api/models';
import { countryName, STANDARD_PAYMENT_TERMS } from '../../core/api/geo';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { CountryPicker } from '../../shared/country-picker';
import { escapeHtml, Sheet, Ui } from '../../shared/ui';
import { messageOf } from '../../core/api/errors';
import { CustomerLoginBlock } from './customer-login-block';
import { CustomerPartnerPortalRow } from './customer-partner-portal-row';
import { CustomerPartnerOriginRow } from './customer-partner-origin';
import { CustomerPriceBlock } from './customer-price-block';
import { CustomerAppliedPrices } from './customer-applied-prices';
import {
  blankCustomer, CRM_STATUSES, customerSince, defaultCustomerCountry, hasTouchpoint, TOUCHPOINT_KINDS, toggleTouchpoint,
  touchpointStamp, VAT_REQUIRED_MESSAGE, vatCountryMismatch, vatNumberMissing,
} from './customer-form';

/**
 * The one customer sheet ("Klant bewerken" / "Nieuwe klant"): the Klanten list opens it from a row, a sales document
 * from the customer's name in its hero. It saves and deletes on its own and then tells the screen that opened it,
 * which closes it and reads its lists again.
 *
 * `customer` is read once, when the sheet opens: a list read again behind it never resets what is being typed.
 */
@Component({
  selector: 'app-customer-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Sheet, Segmented, CountryPicker, CustomerLoginBlock, CustomerPartnerPortalRow, CustomerPartnerOriginRow, CustomerPriceBlock, CustomerAppliedPrices],
  template: `
    <app-sheet [title]="draft().id ? 'Klant bewerken' : 'Nieuwe klant'"
               (closed)="closed.emit()">
      <div body>
        <p class="legend"><b>*</b> verplicht · de rest kan later.</p>
        @if (draft().id && draft().partnerOrigin; as origin) {
          <app-customer-partner-origin [origin]="origin" [marked]="reviewOnSave()" [vatMissing]="vatMissing(draft().vatNumber)" (markChange)="reviewOnSave.set($event)" />
        }
        <div class="partner-field cl-followup">
          <div class="cl-followup__head">
            <b>Opvolging</b>
            @if (draftSince(); as since) { <span class="cl-since">{{ since }}</span> }
          </div>
          <!-- A customer from before the statuses has none: the thumb hides instead of resting under Nieuw as if that were stored. -->
          <app-segmented [variant]="desktop.active() ? 'desk' : 'ios'" semantics="radio" label="Status" [class.cl-seg--none]="!draft().crmStatus"
                         [options]="statusChoices()" [value]="draft().crmStatus ?? ''" (changed)="patch({ crmStatus: $any($event) })" />
          @if (!draft().crmStatus) { <span class="hint cl-followup__none">Nog geen status: kies er een.</span> }
          <div class="cl-touch" role="group" aria-label="Contactmomenten">
            @for (step of touchpointKinds; track step.kind) {
              <button class="cl-touch__row" type="button" role="checkbox" [attr.aria-checked]="ticked(step.kind)"
                      (click)="toggle(step.kind)">
                <i class="cl-touch__box" aria-hidden="true">
                  <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4"
                       stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 10.5 3.5 3.5L15.5 6" /></svg>
                </i>
                <span class="cl-touch__label">{{ step.label }}
                  @if (step.hint) { <small>{{ step.hint }}</small> }</span>
                @if (stamp(step.kind); as when) { <span class="cl-touch__stamp">{{ when }}</span> }
              </button>
            }
          </div>
          <span class="hint">Bewaard bij Opslaan.</span>
        </div>
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
            <app-country-picker inputId="c-country" [value]="draft().countryCode || null" [preferred]="countries()"
                                (changed)="patch({ countryCode: $event })" />
            @if (countryOutsideFreight(); as land) {
              <span class="hint hint--warn">{{ land }} staat niet bij Landen &amp; vracht:
                offertes naar dit land lukken pas als je het daar toevoegt.
                <!-- In a new tab: routing away would destroy this sheet and the half-typed customer with it. -->
                <a routerLink="/countries" target="_blank" rel="noopener">Landen &amp; vracht openen ›</a></span>
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
          <div class="field span-2 partner-field">
            <label class="partner-toggle">
              <input type="checkbox" [checked]="draft().partner ?? false" (change)="patch({ partner: $any($event.target).checked })" />
              <span><b>Partnercontainers</b><small>Bestelt containers met ons mee aan onze gelande kost en verkoopt de goederen op de veiling. Vanuit de inkooporder maak je direct conceptvoorschotfacturen per betaaltermijn. De slotfactuur volgt na de veiling.</small></span>
            </label>
            @if (draft().partner) {
              <div class="partner-grid">
                <div class="field"><label for="c-partner-share">Ons deel van de winst</label>
                  <span class="partner-pct"><input class="input num right" id="c-partner-share" type="number" min="0" max="100" step="0.5" inputmode="decimal"
                         [ngModel]="draft().partnerSharePct ?? 50" (ngModelChange)="patch({ partnerSharePct: $event === '' || $event === null ? null : +$event })" /><i>%</i></span>
                  <span class="hint">Na de veiling, op de winst boven onze gelande kost.</span></div>
                <div class="field"><label for="c-partner-cost">Kost die de partner vooraf betaalt</label>
                  <span class="partner-pct"><input class="input num right" id="c-partner-cost" type="number" min="0" max="100" step="5" inputmode="decimal"
                         [ngModel]="draft().partnerCostPct ?? 100" (ngModelChange)="patch({ partnerCostPct: $event === '' || $event === null ? null : +$event })" /><i>%</i></span>
                  <span class="hint">100 % = de partner betaalt de container vooraf; 0 % = wij financieren alles en rekenen af na de veiling.</span></div>
              </div>
              @if (draft().id; as partnerId) { <app-customer-partner-portal-row [customerId]="partnerId" /> }
            }
          </div>
          <div class="field span-2 partner-field">
            <label class="partner-toggle">
              <input type="checkbox" [checked]="draft().fiscalRepresentative ?? false" (change)="patch({ fiscalRepresentative: $any($event.target).checked })" />
              <span><b>Inklaring in Nederland via onze fiscaal vertegenwoordiger</b><small>De btw verschuift naar deze klant (art. 12.3 Wet OB). Offerte en voorschotfactuur vermelden onze beperkt fiscaal vertegenwoordiger, de verlegging en het btw-nummer van de klant; de slotfactuur enkel de verlegging. Vraagt een btw-nummer.</small></span>
            </label>
          </div>
          @if (draft().id; as customerId) {
            <div class="field span-2 partner-field">
              <app-customer-login-block [customerId]="customerId" [customerEmail]="draft().email || null" />
            </div>
            <!-- A klantprijs saved above changes the pills below (klantprijs / ≠ klantprijs): the rows come again. -->
            <div class="field span-2 partner-field">
              <app-customer-price-block [customerId]="customerId" [customerName]="draft().company" (changed)="appliedPrices()?.reload()" />
            </div>
            <div class="field span-2 partner-field">
              <app-customer-applied-prices [customerId]="customerId" [customerName]="draft().company" />
            </div>
          }
          <div class="field span-2"><label for="c-invoice-note">Extra vermelding op documenten <span class="opt"></span></label>
            <textarea class="textarea" id="c-invoice-note" [ngModel]="draft().invoiceNote ?? ''"
                      (ngModelChange)="patch({ invoiceNote: $event })" placeholder="Komt op elke offerte en factuur voor deze klant."></textarea></div>
          <div class="field span-2"><label for="c-notes">Notities <span class="opt"></span></label>
            <textarea class="textarea" id="c-notes" [ngModel]="draft().notes"
                      (ngModelChange)="patch({ notes: $event })"></textarea></div>
        </div>
      </div>
      <div foot style="display:contents">
        @if (draft().id && removable()) {
          <button class="btn btn--danger" type="button" (click)="remove()">Verwijderen</button>
        }
        <span class="spacer"></span>
        <button class="btn" type="button" (click)="closed.emit()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="saving()" (click)="save()">
          {{ saving() ? 'Bezig…' : 'Opslaan' }}
        </button>
      </div>
    </app-sheet>
  `,
  styles: `
    .cl-since { color: var(--muted-2); }
    .partner-field { display: grid; gap: 10px; padding: 10px 12px; border: 1px solid var(--rose-line); border-radius: 12px; background: var(--rose-soft); }
    .cl-followup { margin-bottom: 14px; }
    .cl-followup__head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 13px; }
    .cl-followup__head .cl-since { font-size: 12px; }
    .cl-followup app-segmented { max-width: 100%; }
    /* Five statuses must share 319 px on a 375 px phone and ~560 px in the desk sheet: tighter segments than the kit's default. */
    :host ::ng-deep .cl-followup .wk-seg__opt { padding: 0 6px; }
    :host ::ng-deep .cl-followup .ios-seg__opt { padding: 0 3px; font-size: 11.5px; letter-spacing: -.01em; }
    /* The phone cells say one word each (Gesprek, Actief); should one still not fit its 57 px cell, it clips with an
       ellipsis instead of running over its neighbours. */
    :host ::ng-deep .cl-followup .ios-seg__opt > span { min-width: 0; }
    /* No stored status: no thumb; the hint under the control says so. */
    .cl-followup .cl-seg--none::before { opacity: 0; }
    .cl-followup__none { margin-top: -4px; }
    .cl-touch { display: grid; border: 1px solid var(--rose-line); border-radius: 10px; background: var(--surface); overflow: hidden; }
    .cl-touch__row { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 6px 12px; border: 0;
      border-top: 1px solid var(--line); background: transparent; color: var(--ink); font: inherit; font-size: 13.5px; text-align: left; cursor: pointer;
      -webkit-tap-highlight-color: transparent; }
    .cl-touch__row:first-child { border-top: 0; }
    .cl-touch__row:active { background: var(--surface-2); }
    .cl-touch__box { display: grid; flex: none; place-items: center; width: 20px; height: 20px; border: 1.5px solid var(--muted-2); border-radius: 5px; color: transparent; }
    .cl-touch__row[aria-checked="true"] .cl-touch__box { border-color: var(--rose); background: var(--rose); color: #fff; }
    .cl-touch__label { display: grid; flex: 1; min-width: 0; gap: 1px; }
    .cl-touch__label small { color: var(--muted); font-size: 11.5px; }
    .cl-touch__stamp { flex: none; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }

    .partner-toggle { display: grid; grid-template-columns: 22px minmax(0, 1fr); align-items: start; gap: 10px; cursor: pointer; }
    .partner-toggle input { width: 18px; height: 18px; margin-top: 2px; accent-color: var(--rose); }
    .partner-toggle span { display: grid; gap: 2px; font-size: 13px; }
    .partner-toggle small { color: var(--ink-2); font-size: 12px; line-height: 1.4; }
    .partner-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
    .partner-pct { display: inline-flex; align-items: center; gap: 6px; }
    .partner-pct .input { width: 96px; }
    .partner-pct i { color: var(--muted); font-style: normal; }
  `,
})
export class CustomerSheet implements OnInit {
  /** The customer to edit, or null for a new one. */
  readonly customer = input<Customer | null>(null);
  /** Landen & vracht: listed first in the country picker, and a country outside it gets a warning. */
  readonly countries = input<Country[]>([]);
  /** Klanten offers Verwijderen; a sales document's customer always has that document, so the server would refuse it there. */
  readonly removable = input(true);
  readonly closed = output<void>();
  /** The server stored the customer (and marked it Nagekeken when asked); the sheet has said so in a toast. */
  readonly saved = output<Customer>();
  /** The customer is gone; the sheet has said so in a toast. */
  readonly removed = output<void>();

  private readonly sales = inject(SalesApi);
  private readonly partnerSales = inject(PartnerSalesApi);
  private readonly work = inject(WorkQueue);
  private readonly ui = inject(Ui);
  readonly desktop = inject(DesktopViewport);

  readonly paymentTerms = STANDARD_PAYMENT_TERMS;
  readonly languages = LANGUAGES;
  readonly incoterms = ['EXW', 'FOB', 'CIF', 'DAP', 'DDP'];
  readonly touchpointKinds = TOUCHPOINT_KINDS;
  readonly vatMissing = vatNumberMissing;

  /**
   * The status choice in the sheet: the five statuses, no "Alle". On the phone the one-word labels, since five cells
   * share 319 px and "In gesprek" and "Actieve klant" were cut to an ellipsis there; the desk sheet says the full ones.
   */
  readonly statusChoices = computed<SegmentOption[]>(() => CRM_STATUSES.map((status) => ({
    id: status.value,
    label: this.desktop.active() ? status.label : status.short,
  })));

  readonly draft = signal<Customer>(blankCustomer(''));
  /** True while terms outside the standard list are being typed. */
  readonly customPaymentTerms = signal(false);
  /** A partner-made customer's Nagekeken, ticked on the sheet: sent after its Opslaan stored the customer. */
  readonly reviewOnSave = signal(false);
  readonly saving = signal(false);
  private readonly prices = viewChild(CustomerPriceBlock);
  readonly appliedPrices = viewChild(CustomerAppliedPrices);

  constructor() {
    /* The sheet can open before the countries arrive: a new customer then gets the default country once they are in,
       instead of sitting on an empty country code. */
    effect(() => {
      const codes = this.countries().map((country) => country.code);
      untracked(() => {
        if (codes.length && this.draft().id === null && !this.draft().countryCode) {
          this.patch({ countryCode: defaultCustomerCountry(codes) });
        }
      });
    });
  }

  ngOnInit(): void {
    const customer = this.customer();
    /* An older server answers without the follow-up fields: the sheet treats them as "no status, nothing ticked". */
    this.draft.set(customer
      ? { ...customer, crmStatus: customer.crmStatus ?? null, touchpoints: customer.touchpoints ?? [] }
      : blankCustomer(defaultCustomerCountry(this.countries().map((country) => country.code))));
  }

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

  /** "Klant sinds 7 nov 2026" at the top of Opvolging for a stored customer; "" for a new one. */
  readonly draftSince = computed(() => {
    const since = this.draft().id ? customerSince(this.draft().createdAt) : '';
    return since ? since.charAt(0).toUpperCase() + since.slice(1) : '';
  });

  /** The chosen country is not in Landen & vracht: its name, so the hint can say so; null when it is, or while the list is not known yet. */
  readonly countryOutsideFreight = computed(() => {
    const code = (this.draft().countryCode ?? '').trim().toUpperCase();
    /* The sheet can open before the countries arrive, and stays open when they failed: no warning on an empty list. */
    if (!code || !this.countries().length || this.countries().some((country) => country.code === code)) return null;
    return countryName(code) || code;
  });

  /** The two letters of the VAT number next to the customer's country, when they differ. */
  readonly vatCountryMismatch = computed(() => vatCountryMismatch(this.draft().vatNumber, this.draft().countryCode));

  patch(changes: Partial<Customer>): void {
    this.draft.update((customer) => ({ ...customer, ...changes }));
  }

  ticked(kind: string): boolean {
    return hasTouchpoint(this.draft(), kind);
  }

  toggle(kind: string): void {
    this.draft.update((customer) => toggleTouchpoint(customer, kind, new Date().toISOString()));
  }

  /** "7 nov · Emre" beside a ticked step; null while unticked. A tick made just now has no name yet: the server adds it. */
  stamp(kind: string): string | null {
    const touchpoint = (this.draft().touchpoints ?? []).find((entry) => entry.kind === kind);
    return touchpoint ? touchpointStamp(touchpoint, new Date().getFullYear()) : null;
  }

  async save(): Promise<void> {
    /* A second tap while the first is under way made a second customer. */
    if (this.saving()) return;
    const customer = this.draft();
    if (!(customer.countryCode ?? '').trim()) {
      this.ui.toast('Kies een land voor de klant', 'err');
      return;
    }
    /* A customer the partner made (name, country, maybe a city) is put right here first: while staff have not
       marked it Nagekeken it saves without a VAT number, as the server allows. Nagekeken (ticked on the sheet) goes
       after this save, and needs the VAT number: from then on every save does. */
    const unreviewed = !!customer.partnerOrigin && !customer.partnerOrigin.reviewedAt;
    const review = unreviewed && customer.id !== null && this.reviewOnSave();
    if (vatNumberMissing(customer.vatNumber) && !(unreviewed && !review)) {
      this.ui.toast(review ? 'Nagekeken vraagt het BTW-nummer: vul het in, of vink Nagekeken uit en sla zo op.' : VAT_REQUIRED_MESSAGE, 'err');
      setTimeout(() => document.getElementById('c-vat')?.focus(), 100);
      return;
    }
    this.saving.set(true);
    try {
      /* The price block saves on its own; a price typed there and not stored yet goes along, a refused one keeps the sheet. */
      const prices = this.prices();
      if (prices?.pending() && !(await prices.saveDraft())) {
        prices.reveal();
        return;
      }
      /* The draft goes as is: the server stamps at/by on a touchpoint that is new and keeps them on one it already has. */
      /* partnerOrigin is the server's: never sent back. */
      const { partnerOrigin: _origin, ...body } = customer;
      const stored = customer.id === null
        ? await this.sales.createCustomer(body)
        : await this.sales.updateCustomer(customer.id, body);
      /* The customer is stored: now Nagekeken (the bell item goes). A refusal keeps what was saved. */
      let reviewed: boolean | null = null;
      if (review && customer.id !== null) {
        try {
          await this.partnerSales.markCustomerReviewed(customer.id);
          reviewed = true;
        } catch (failure: unknown) {
          reviewed = false;
          this.ui.toast(`Klant opgeslagen; ${messageOf(failure, 'Nagekeken lukte niet').replace(/^./, (c) => c.toLowerCase())}`, 'err');
        }
        void this.work.refresh(true);
      }
      if (reviewed !== false) this.ui.toast(reviewed ? 'Klant opgeslagen en nagekeken' : 'Klant opgeslagen');
      this.saved.emit(stored);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Opslaan mislukt'), 'err');
    } finally {
      this.saving.set(false);
    }
  }

  remove(): void {
    const customer = this.draft();
    if (customer.id === null) return;
    const id = customer.id;
    this.ui.confirm(
      { title: 'Klant verwijderen', message: `<b>${escapeHtml(customer.company)}</b> verwijderen?`,
        confirmLabel: 'Verwijderen', danger: true },
      async () => {
        try {
          await this.sales.deleteCustomer(id);
        } catch (failure: unknown) {
          /* A 409 explains why (the customer has quotes or invoices): show it, keep the sheet. */
          this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
          return;
        }
        this.ui.toast('Klant verwijderd');
        this.removed.emit();
      });
  }
}
