import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SalesApi } from '../../core/api/sales-api';
import { Country, CrmStatus, Customer, CustomerTouchpoint, LANGUAGES } from '../../core/api/models';
import { countryFlag, countryName, STANDARD_PAYMENT_TERMS } from '../../core/api/geo';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { CountryPicker } from '../../shared/country-picker';
import { escapeHtml, Sheet, Ui } from '../../shared/ui';
import { messageOf } from '../../core/api/errors';
import { LoadError, LOAD_ERROR_FALLBACK } from '../../shared/load-error';
import { CustomerLoginBlock } from './customer-login-block';
import { CustomerPriceBlock } from './customer-price-block';
import { CustomerAppliedPrices } from './customer-applied-prices';
import {
  blankCustomer as blank, CRM_STATUSES, CrmTone, crmStatusLabel, CUSTOMER_SORTS, CustomerSort, customerSince,
  defaultCustomerCountry, filterCustomers, hasTouchpoint, metaLine, shortDateNl, sortCustomers, TOUCHPOINT_KINDS, toggleTouchpoint,
  touchpointLabel, VAT_REQUIRED_MESSAGE, vatCountryMismatch, vatNumberMissing,
} from './customer-form';

/** The sort survives a reload; a status filter is a deep link (?status=) instead. */
const SORT_KEY = 'enrosed.customers.sort';
/** Pills on a list row before "+n" takes over: three fit beside the status badge at 375 px. */
const MARKS_SHOWN = 3;
const STATUS_VALUES: readonly string[] = CRM_STATUSES.map((status) => status.value);

@Component({
  selector: 'app-customer-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, FormsModule, RouterLink, PageHeader, Sheet, Segmented, CountryPicker, CustomerLoginBlock, CustomerPriceBlock, CustomerAppliedPrices, LoadError],
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
              </div>
              <div class="list-item__end list-item__end--stacked">
                @if (statusTone(customer.crmStatus); as tone) {
                  <span [class]="'badge badge--' + tone">{{ crmStatusLabel(customer.crmStatus) }}</span>
                }
                @if (customerSince(customer.createdAt); as since) { <span class="cl-since">{{ since }}</span> }
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

    @if (editing()) {
      <app-sheet [title]="draft().id ? 'Klant bewerken' : 'Nieuwe klant'"
                 (closed)="editing.set(false)">
        <div body>
          <p class="legend"><b>*</b> verplicht · de rest kan later.</p>
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
    .cl-marks { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 3px; }
    .cl-marks .wk-pill { height: 18px; padding: 0 6px; font-size: 10px; }

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
  private readonly route = inject(ActivatedRoute);
  private readonly ui = inject(Ui);
  readonly desktop = inject(DesktopViewport);

  readonly languages = LANGUAGES;
  readonly incoterms = ['EXW', 'FOB', 'CIF', 'DAP', 'DDP'];
  readonly sorts = CUSTOMER_SORTS;
  readonly touchpointKinds = TOUCHPOINT_KINDS;
  /**
   * The status choice in the sheet: the five statuses, no "Alle". On the phone the one-word labels, since five cells
   * share 319 px and "In gesprek" and "Actieve klant" were cut to an ellipsis there; the desk sheet says the full ones.
   */
  readonly statusChoices = computed<SegmentOption[]>(() => CRM_STATUSES.map((status) => ({
    id: status.value,
    label: this.desktop.active() ? status.label : status.short,
  })));
  readonly metaLine = metaLine;
  readonly customerSince = customerSince;
  readonly crmStatusLabel = crmStatusLabel;

  readonly customers = signal<Customer[]>([]);
  readonly countries = signal<Country[]>([]);
  readonly query = signal('');
  readonly status = signal<CrmStatus | 'ALLE'>('ALLE');
  readonly sort = signal<CustomerSort>(readStoredSort());
  readonly editing = signal(false);
  readonly draft = signal<Customer>(blank('BE'));
  readonly loading = signal(true);

  constructor() {
    /* Deep links (the sales hero, the future CRM menu) filter the list straight to one customer or one status. */
    const query = this.route.snapshot.queryParamMap;
    const q = query.get('q');
    if (q) this.query.set(q);
    const status = (query.get('status') ?? '').toUpperCase();
    if (STATUS_VALUES.includes(status)) this.status.set(status as CrmStatus);
    void this.load();
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
      this.countries.set(countries);
      this.loadError.set(null);
      /* The sheet can open before this list arrives: without repair the new
         customer sat on an empty country code. */
      if (this.editing() && this.draft().id === null && !this.draft().countryCode) {
        this.patch({ countryCode: this.defaultCountry() });
      }
    } catch (failure: unknown) {
      this.loadError.set(messageOf(failure, LOAD_ERROR_FALLBACK));
    } finally {
      this.loading.set(false);
    }
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
    return {
      shown: all.slice(0, MARKS_SHOWN),
      more: Math.max(0, all.length - MARKS_SHOWN),
      title: ticked.map((touchpoint) => `${touchpointLabel(touchpoint.kind)} · ${this.stampOf(touchpoint)}`).join('\n'),
    };
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

  open(customer: Customer | null): void {
    /* An older server answers without the follow-up fields: the sheet treats them as "no status, nothing ticked". */
    this.draft.set(customer
      ? { ...customer, crmStatus: customer.crmStatus ?? null, touchpoints: customer.touchpoints ?? [] }
      : blank(this.defaultCountry()));
    this.editing.set(true);
  }

  /** Home first when it ships, otherwise the first configured country -
      never a hardcoded guess, which left every new customer without a
      country whenever the guess was not in Landen & vracht. */
  private defaultCountry(): string {
    return defaultCustomerCountry(this.countries().map((country) => country.code));
  }

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
    return touchpoint ? this.stampOf(touchpoint) : null;
  }

  private stampOf(touchpoint: CustomerTouchpoint): string {
    const date = shortDateNl(touchpoint.at);
    /* This year's stamps drop the year: the row is narrow and the year is noise until it changes. */
    const thisYear = ` ${new Date().getFullYear()}`;
    const day = date.endsWith(thisYear) ? date.slice(0, -thisYear.length) : date;
    return touchpoint.by ? `${day} · ${touchpoint.by}` : day;
  }

  readonly saving = signal(false);
  private readonly prices = viewChild(CustomerPriceBlock);
  readonly appliedPrices = viewChild(CustomerAppliedPrices);

  /** The two letters of the VAT number next to the customer's country, when they differ. */
  readonly vatCountryMismatch = computed(() => vatCountryMismatch(this.draft().vatNumber, this.draft().countryCode));

  async save(): Promise<void> {
    /* A second tap while the first is under way made a second customer. */
    if (this.saving()) return;
    const customer = this.draft();
    if (!(customer.countryCode ?? '').trim()) {
      this.ui.toast('Kies een land voor de klant', 'err');
      return;
    }
    if (vatNumberMissing(customer.vatNumber)) {
      this.ui.toast(VAT_REQUIRED_MESSAGE, 'err');
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
      if (customer.id === null) await this.sales.createCustomer(customer);
      else await this.sales.updateCustomer(customer.id, customer);
      this.editing.set(false);
      await this.load();
      this.ui.toast('Klant opgeslagen');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Opslaan mislukt'), 'err');
    } finally {
      this.saving.set(false);
    }
  }

  remove(): void {
    const customer = this.draft();
    this.ui.confirm(
      { title: 'Klant verwijderen', message: `<b>${escapeHtml(customer.company)}</b> verwijderen?`,
        confirmLabel: 'Verwijderen', danger: true },
      async () => {
        try {
          await this.sales.deleteCustomer(customer.id!);
        } catch (failure: unknown) {
          /* A 409 explains why (the customer has quotes or invoices): show it, keep the sheet. */
          this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
          return;
        }
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

/** The last chosen sort, NAAM when none was kept or storage is off. */
function readStoredSort(): CustomerSort {
  try {
    const stored = localStorage.getItem(SORT_KEY);
    if (stored && CUSTOMER_SORTS.some((option) => option.value === stored)) return stored as CustomerSort;
  } catch { /* private mode */ }
  return 'NAAM';
}
