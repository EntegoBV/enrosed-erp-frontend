import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { PartnerBuyer, PartnerBuyerRef, PartnerBuyerRequest } from '../../core/api/partner-portal-api';
import { messageOf } from '../../core/api/errors';
import { CountryPicker, PreferredCountry } from '../../shared/country-picker';
import { Icon } from '../../shared/icon';

/** Searches buyers: an empty query answers the last ones. */
export type BuyerSearchFn = (query: string) => Promise<PartnerBuyer[]>;
/** Adds a buyer with the fewest fields (or answers the one already added under that name). */
export type BuyerCreateFn = (body: PartnerBuyerRequest) => Promise<PartnerBuyer>;

const PREFERRED: readonly PreferredCountry[] = [{ code: 'NL' }, { code: 'BE' }, { code: 'DE' }, { code: 'FR' }];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Klant of a direct sale: a search over the customers (the portal: name and
 * city only; staff: their own search), the last buyers while nothing is typed,
 * and "Niet gevonden? Nieuwe klant" for a small form (Bedrijfsnaam, Land,
 * Stad, E-mail, Telefoon) prefilled with what was typed. Staff complete the
 * customer in the ERP later.
 */
@Component({
  selector: 'app-partner-buyer-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, CountryPicker, Icon],
  host: { '(focusout)': 'leave($event)' },
  template: `
    @if (value(); as buyer) {
      <div class="bf-chosen">
        <span class="bf-chosen__text"><b>{{ buyer.company }}</b>@if (buyer.city) { <small>{{ buyer.city }}</small> }</span>
        <button class="bf-link" type="button" (click)="clear()">Wijzigen</button>
      </div>
    } @else if (creating()) {
      <form class="bf-form" (submit)="$event.preventDefault(); add()">
        <label class="bf-field"><span>Bedrijfsnaam</span>
          <input name="company" maxlength="160" autocomplete="organization" required [ngModel]="company()" (ngModelChange)="company.set($event)" />
        </label>
        <div class="bf-field"><span>Land</span>
          <app-country-picker [value]="country()" [preferred]="preferred" preferredLabel="Meest gekozen" placeholder="Zelfde land als jij"
                              (changed)="country.set($event || null)" />
        </div>
        <label class="bf-field"><span>Stad</span>
          <input name="city" maxlength="100" autocomplete="address-level2" [ngModel]="city()" (ngModelChange)="city.set($event)" />
        </label>
        <label class="bf-field"><span>E-mail <small>optioneel</small></span>
          <input name="email" type="email" maxlength="160" autocomplete="off" [ngModel]="email()" (ngModelChange)="email.set($event)" />
        </label>
        <label class="bf-field"><span>Telefoon <small>optioneel</small></span>
          <input name="phone" type="tel" maxlength="40" autocomplete="off" [ngModel]="phone()" (ngModelChange)="phone.set($event)" />
        </label>
        @if (formProblem(); as problem) { <p class="bf-bad">{{ problem }}</p> }
        @if (error()) { <p class="bf-bad" role="alert">{{ error() }}</p> }
        <div class="bf-actions">
          <button class="bf-btn" type="button" (click)="creating.set(false)">Annuleren</button>
          <button class="bf-btn bf-btn--primary" type="submit" [disabled]="busy() || !!formProblem() || !company().trim()">{{ busy() ? 'Bezig…' : 'Toevoegen' }}</button>
        </div>
        <p class="bf-note">Enrosed vult de rest aan.</p>
      </form>
    } @else {
      <label class="bf-search">
        <app-icon name="search" [size]="15" />
        <input type="search" placeholder="Zoek een klant" aria-label="Zoek een klant" autocomplete="off" autocorrect="off" spellcheck="false"
               enterkeyhint="search" [value]="query()" (focus)="openList()" (input)="typed($any($event.target).value)"
               (keydown.enter)="$event.preventDefault(); pickFirst()" (keydown.escape)="open.set(false)" />
      </label>
      @if (open()) {
        <div class="bf-list" role="listbox" aria-label="Klanten" (mousedown)="$event.preventDefault()">
          @if (listLabel()) { <span class="bf-list__label">{{ listLabel() }}</span> }
          @for (buyer of results(); track buyer.customerId) {
            <button class="bf-item" type="button" role="option" aria-selected="false" (click)="pick(buyer)">
              <b>{{ buyer.company }}</b>
              <small>{{ place(buyer) }}@if (buyer.addedByYou) { · door jou toegevoegd }</small>
            </button>
          }
          @if (loading()) { <span class="bf-list__label">Zoeken…</span> }
          @else if (error()) { <span class="bf-bad">{{ error() }}</span> }
          @else if (!results().length && query().trim().length >= 2) { <span class="bf-list__label">Geen klant gevonden</span> }
          @if (create()) {
            <button class="bf-link bf-new" type="button" (click)="startCreate()"><app-icon name="plus" [size]="14" />Niet gevonden? Nieuwe klant</button>
          }
        </div>
      }
    }
  `,
  styles: `
    :host{display:block;min-width:0}
    .bf-search{position:relative;display:flex;align-items:center;color:var(--muted)}
    .bf-search>app-icon{position:absolute;left:10px;pointer-events:none}
    .bf-search input,.bf-field input{width:100%;height:36px;padding:0 10px 0 32px;border:1px solid var(--line-strong);border-radius:9px;background:var(--surface);color:var(--ink);font:inherit;font-size:14px;outline:none}
    .bf-field input{padding-left:10px}
    .bf-search input:focus,.bf-field input:focus{border-color:var(--rose);box-shadow:var(--wk-focus)}
    .bf-search input::-webkit-search-cancel-button{display:none}
    .bf-list{display:grid;margin-top:6px;padding:4px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
    .bf-list__label{padding:4px 8px;color:var(--muted);font-size:12px;font-weight:600}
    .bf-item{display:grid;gap:1px;min-height:40px;padding:5px 8px;border:0;border-radius:7px;background:none;color:var(--ink);font:inherit;text-align:left;cursor:pointer}
    .bf-item:hover,.bf-item:focus-visible{background:var(--surface-2);outline:none}
    .bf-item b{overflow:hidden;font-size:13.5px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}
    .bf-item small{color:var(--muted);font-size:12px}
    .bf-link{display:inline-flex;align-items:center;gap:4px;min-height:32px;padding:0 4px;border:0;background:none;color:var(--rose-dark);font:inherit;font-size:13px;font-weight:650;cursor:pointer}
    .bf-new{justify-self:start;margin-top:2px}
    .bf-chosen{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px;padding:4px 4px 4px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface-2)}
    .bf-chosen__text{display:grid;min-width:0}
    .bf-chosen__text b{overflow:hidden;font-size:14px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}
    .bf-chosen__text small{color:var(--muted);font-size:12px}
    .bf-form{display:grid;gap:8px}
    .bf-field{display:grid;gap:3px;color:var(--ink-2);font-size:12.5px;font-weight:600}
    .bf-field small{color:var(--muted);font-weight:500}
    .bf-actions{display:flex;justify-content:flex-end;gap:8px}
    .bf-btn{min-height:34px;padding:0 14px;border:1px solid var(--line-strong);border-radius:9px;background:var(--surface);color:var(--ink);font:inherit;font-size:13px;font-weight:650;cursor:pointer}
    .bf-btn--primary{border-color:var(--rose);background:var(--rose);color:#fff}
    .bf-btn:disabled{opacity:.45;cursor:default}
    .bf-bad{margin:0;color:var(--danger);font-size:12.5px;font-weight:600}
    .bf-note{margin:0;color:var(--muted);font-size:12px}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      .bf-search input,.bf-field input{height:44px;font-size:16px;border-radius:12px}
      .bf-item{min-height:48px}
      .bf-link,.bf-btn{min-height:44px}
      .bf-item b{font-size:15.5px}.bf-item small{font-size:13px}
    }
  `,
})
export class PartnerBuyerField {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly value = input<PartnerBuyerRef | null>(null);
  readonly search = input.required<BuyerSearchFn>();
  readonly create = input<BuyerCreateFn | null>(null);
  readonly changed = output<PartnerBuyerRef | null>();

  readonly preferred = PREFERRED;
  readonly query = signal('');
  readonly results = signal<PartnerBuyer[]>([]);
  readonly open = signal(false);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly creating = signal(false);
  readonly busy = signal(false);
  readonly company = signal('');
  readonly country = signal<string | null>(null);
  readonly city = signal('');
  readonly email = signal('');
  readonly phone = signal('');
  /** The query the shown results answer ('' = the last buyers). */
  private readonly answered = signal<string | null>(null);
  private run = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly listLabel = computed(() => {
    const query = this.query().trim();
    if (query.length === 1) return 'Typ minstens 2 letters';
    return this.answered() === '' && this.results().length ? 'Laatste klanten' : '';
  });

  readonly formProblem = computed<string | null>(() => {
    const email = this.email().trim();
    if (email && !EMAIL.test(email)) return 'Dat e-mailadres klopt niet';
    return null;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => { if (this.timer) clearTimeout(this.timer); });
  }

  openList(): void {
    this.open.set(true);
    if (this.answered() === null) this.lookup(this.query());
  }

  typed(value: string): void {
    this.query.set(value);
    this.open.set(true);
    if (this.timer) clearTimeout(this.timer);
    const query = value.trim();
    if (query.length === 1) return;
    this.timer = setTimeout(() => this.lookup(query), 250);
  }

  private async lookup(raw: string): Promise<void> {
    const query = raw.trim().length >= 2 ? raw.trim() : '';
    const run = ++this.run;
    this.loading.set(true);
    this.error.set(null);
    try {
      const found = await this.search()(query);
      if (run !== this.run) return;
      this.results.set(found.slice(0, 20));
      this.answered.set(query);
    } catch (failure: unknown) {
      if (run !== this.run) return;
      const status = (failure as { status?: number } | null)?.status;
      this.results.set([]);
      this.error.set(status === 429 ? 'Even te veel opzoekingen; probeer het zo opnieuw.' : messageOf(failure, 'Klanten zoeken lukt nu niet.'));
    } finally {
      if (run === this.run) this.loading.set(false);
    }
  }

  pickFirst(): void {
    const first = this.results()[0];
    if (first) this.pick(first);
  }

  pick(buyer: PartnerBuyer): void {
    this.open.set(false);
    this.changed.emit({ customerId: buyer.customerId, company: buyer.company, city: buyer.city });
  }

  clear(): void {
    this.query.set('');
    this.answered.set(null);
    this.changed.emit(null);
  }

  startCreate(): void {
    this.company.set(this.query().trim());
    this.country.set(null);
    this.city.set('');
    this.email.set('');
    this.phone.set('');
    this.error.set(null);
    this.creating.set(true);
    this.open.set(false);
  }

  async add(): Promise<void> {
    const create = this.create();
    const company = this.company().trim();
    if (!create || !company || this.busy() || this.formProblem()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const buyer = await create({
        company,
        countryCode: this.country() || null,
        city: this.city().trim() || null,
        email: this.email().trim() || null,
        phone: this.phone().trim() || null,
      });
      this.creating.set(false);
      this.changed.emit({ customerId: buyer.customerId, company: buyer.company, city: buyer.city });
    } catch (failure: unknown) {
      const status = (failure as { status?: number } | null)?.status;
      this.error.set(status === 429 ? 'Vandaag zijn er al veel klanten toegevoegd. Vraag Enrosed om hulp.' : messageOf(failure, 'Toevoegen lukt nu niet. Probeer het opnieuw.'));
    } finally {
      this.busy.set(false);
    }
  }

  /** The list closes once the focus leaves the field and its list. */
  leave(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (!next || !this.host.nativeElement.contains(next)) this.open.set(false);
  }

  place(buyer: PartnerBuyer): string {
    return [buyer.city, buyer.countryCode].filter(Boolean).join(' · ');
  }
}
