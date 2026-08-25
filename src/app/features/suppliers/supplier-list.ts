import { ActivatedRoute } from '@angular/router';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Skeleton } from '../../shared/skeleton';
import { FormsModule } from '@angular/forms';
import { SourcingApi } from '../../core/api/sourcing-api';
import { Supplier } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { ISO_COUNTRIES, countryName } from '../../core/api/geo';
import { Sheet, Ui } from '../../shared/ui';
import { SupplierAddress } from '../../shared/supplier-address';

function blank(): Supplier {
  return {
    id: null, name: '', country: 'CN', addressLine1: null, addressLine2: null,
    postalCode: null, city: '', region: null, contact: '', email: '', phone: '',
    currency: 'USD', incoterm: 'FOB', portOfLoading: '', leadTimeDays: 35, notes: '',
  };
}

@Component({
  selector: 'app-supplier-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, FormsModule, PageHeader, Sheet, SupplierAddress],
  template: `
    <app-page-header [showBack]="true" backTo="/more" title="Leveranciers" [subtitle]="suppliers().length + ' leveranciers'">
      <button class="btn btn--primary btn--sm hide-mobile" type="button" (click)="open(null)">
        + Nieuw
      </button>
    </app-page-header>

    <div class="content">
      <div class="search-bar">
        <input class="input" type="search"
               placeholder="Zoek op naam, adres, stad, regio of haven…"
               aria-label="Leveranciers zoeken"
               [ngModel]="query()" (ngModelChange)="query.set($event)" />
      </div>
      <div class="card"><div class="list">
        @for (supplier of filtered(); track supplier.id) {
          <!-- Same gesture as the purchase list: swipe left reveals delete,
               a committed swipe asks the question straight away. -->
          <div class="swipe" [class.swipe--open]="swiped() === supplier.id">
          <button class="list-item swipe__row" type="button"
                  style="text-align:left;width:100%;border-width:0 0 1px"
                  (touchstart)="swipeStart($event, supplier.id!)"
                  (touchmove)="swipeMove($event, supplier.id!)"
                  (click)="openUnlessSwiped($event, supplier)">
            <div class="list-item__body">
              <div class="list-item__title">{{ supplier.name }}</div>
              <div class="list-item__meta">
                {{ supplierLocation(supplier) || 'Adres nog niet ingevuld' }}
                @if (supplier.contact) { · {{ supplier.contact }} }
              </div>
              <div class="list-item__meta">
                Levertijd {{ supplier.leadTimeDays }} dagen
                @if (supplier.portOfLoading) { · {{ supplier.portOfLoading }} }
              </div>
            </div>
            <div class="list-item__end">
              <span class="badge badge--blue">{{ supplier.currency }}</span>
              <div class="tiny muted mt-8">{{ supplier.incoterm }}</div>
            </div>
            <span class="list-item__chev">›</span>
          </button>
          <button class="swipe__delete" type="button" (click)="removeFromList(supplier)"
                  aria-label="Leverancier verwijderen">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 7h16" /><path d="M9 7V5h6v2" />
              <path d="M6.5 7l1 13h9l1-13" /><path d="M10 11v6" /><path d="M14 11v6" />
            </svg>
          </button>
          </div>
        } @empty {
          <div class="empty"><div class="empty__title">
            @if (loading()) { <app-skeleton kind="lines" [rows]="3" /> } @else { Geen leveranciers gevonden }</div></div>
        }
      </div></div>
    </div>

    <button class="fab" type="button" (click)="open(null)">+ Leverancier</button>

    @if (editing()) {
      <app-sheet [title]="editMode()
                   ? (draft().id ? 'Leverancier bewerken' : 'Nieuwe leverancier')
                   : draft().name"
                 (closed)="close()">
        <div body>
          @if (!editMode()) {
            <article class="supplier-detail">
              <header class="supplier-hero">
                <span class="supplier-hero__mark" aria-hidden="true">
                  {{ draft().name.charAt(0) || '?' }}
                </span>
                <span class="supplier-hero__copy">
                  <span>Leverancier</span>
                  <strong>{{ draft().name }}</strong>
                  <small>{{ supplierLocation(draft()) || 'Locatie nog niet ingevuld' }}</small>
                </span>
                <span class="badge badge--blue">{{ draft().currency }}</span>
              </header>

              <section class="detail-section" aria-labelledby="supplier-address-title">
                <span class="detail-section__icon" aria-hidden="true">⌖</span>
                <div>
                  <h3 id="supplier-address-title">Vestigings- en ophaaladres</h3>
                  <app-supplier-address [supplier]="draft()" />
                </div>
              </section>

              <section class="detail-section" aria-labelledby="supplier-contact-title">
                <span class="detail-section__icon" aria-hidden="true">@</span>
                <div>
                  <h3 id="supplier-contact-title">Contact</h3>
                  @if (draft().contact) { <strong>{{ draft().contact }}</strong> }
                  @if (draft().email) {
                    <a [href]="'mailto:' + draft().email">{{ draft().email }}</a>
                  }
                  @if (draft().phone) {
                    <a [href]="'tel:' + draft().phone">{{ draft().phone }}</a>
                  }
                  @if (!draft().contact && !draft().email && !draft().phone) {
                    <span class="muted">Contactgegevens nog niet ingevuld</span>
                  }
                </div>
              </section>

              <dl class="supplier-facts">
                <div><dt>Incoterm</dt><dd>{{ draft().incoterm || '—' }}</dd></div>
                <div><dt>Factureert in</dt><dd>{{ draft().currency }}</dd></div>
                <div><dt>Laadhaven</dt><dd>{{ draft().portOfLoading || '—' }}</dd></div>
                <div><dt>Levertijd</dt><dd>{{ draft().leadTimeDays }} dagen</dd></div>
              </dl>
              @if (draft().notes) {
                <section class="supplier-notes" aria-labelledby="supplier-notes-title">
                  <h3 id="supplier-notes-title">Interne notitie</h3>
                  <p>{{ draft().notes }}</p>
                </section>
              }
            </article>
          } @else {
            <p class="legend"><b>*</b> verplicht · adresvelden mogen leeg blijven.</p>

            <section class="form-section" aria-labelledby="supplier-company-form-title">
              <div class="form-section__head">
                <span>1</span>
                <div><h3 id="supplier-company-form-title">Bedrijf &amp; contact</h3>
                  <p>Wie levert en wie kunnen we bereiken?</p></div>
              </div>
              <div class="form-grid">
                <div class="field span-2">
                  <label class="req" for="s-name">Bedrijfsnaam</label>
                  <input class="input" id="s-name" required autocomplete="organization"
                         [attr.aria-invalid]="saveAttempted() && !draft().name.trim()"
                         [ngModel]="draft().name" (ngModelChange)="patch({ name: $event })" />
                  @if (saveAttempted() && !draft().name.trim()) {
                    <span class="field-error" role="alert">Vul een bedrijfsnaam in.</span>
                  }
                </div>
                <div class="field"><label for="s-contact">Contactpersoon</label>
                  <input class="input" id="s-contact" autocomplete="name"
                         [ngModel]="draft().contact"
                         (ngModelChange)="patch({ contact: $event })" /></div>
                <div class="field"><label for="s-email">E-mail</label>
                  <input class="input" id="s-email" type="email" autocomplete="email"
                         [ngModel]="draft().email"
                         (ngModelChange)="patch({ email: $event })" /></div>
                <div class="field"><label for="s-phone">Telefoon</label>
                  <input class="input" id="s-phone" type="tel" autocomplete="tel"
                         [ngModel]="draft().phone"
                         (ngModelChange)="patch({ phone: $event })" /></div>
              </div>
            </section>

            <section class="form-section" aria-labelledby="supplier-address-form-title">
              <div class="form-section__head">
                <span>2</span>
                <div><h3 id="supplier-address-form-title">Adres</h3>
                  <p>Ook geschikt voor Chinese districten, zones en provincies.</p></div>
              </div>
              <div class="form-grid">
                <div class="field span-2"><label for="s-address-1">Adresregel 1</label>
                  <input class="input" id="s-address-1" autocomplete="address-line1"
                         [ngModel]="draft().addressLine1"
                         (ngModelChange)="patch({ addressLine1: $event })"
                         placeholder="Gebouw, straat of industriepark" />
                  <span class="hint">Gebouw, straat of industriepark</span></div>
                <div class="field span-2"><label for="s-address-2">Adresregel 2</label>
                  <input class="input" id="s-address-2" autocomplete="address-line2"
                         [ngModel]="draft().addressLine2"
                         (ngModelChange)="patch({ addressLine2: $event })"
                         placeholder="District, zone, verdieping of extra aanwijzing" />
                  <span class="hint">District, zone of andere extra adresinformatie</span></div>
                <div class="field"><label for="s-city">Stad</label>
                  <input class="input" id="s-city" autocomplete="address-level2"
                         [ngModel]="draft().city" (ngModelChange)="patch({ city: $event })"
                         placeholder="Bijv. Shenzhen" /></div>
                <div class="field"><label for="s-region">Provincie/regio</label>
                  <input class="input" id="s-region" autocomplete="address-level1"
                         [ngModel]="draft().region" (ngModelChange)="patch({ region: $event })"
                         placeholder="Bijv. Guangdong" /></div>
                <div class="field"><label for="s-postal">Postcode</label>
                  <input class="input" id="s-postal" autocomplete="postal-code"
                         [ngModel]="draft().postalCode"
                         (ngModelChange)="patch({ postalCode: $event })" /></div>
                <div class="field"><label for="s-country">Land</label>
                  <select class="select" id="s-country" autocomplete="country"
                          [ngModel]="draft().country"
                          (ngModelChange)="patch({ country: $event })">
                    <option value="">Land nog niet gekozen</option>
                    @if (draft().country && !countryKnown(draft().country)) {
                      <option [value]="draft().country">{{ draft().country }}</option>
                    }
                    @for (option of isoCountries; track option.code) {
                      <option [value]="option.code">{{ option.name }}</option>
                    }
                  </select></div>
              </div>
            </section>

            <section class="form-section" aria-labelledby="supplier-buying-form-title">
              <div class="form-section__head">
                <span>3</span>
                <div><h3 id="supplier-buying-form-title">Inkoopafspraken</h3>
                  <p>Valuta, transportafspraak en planning.</p></div>
              </div>
              <div class="form-grid">
                <div class="field"><label class="req" for="s-currency">Factureert in</label>
                  <select class="select" id="s-currency" [ngModel]="draft().currency"
                          (ngModelChange)="patch({ currency: $event })">
                    <option value="USD">USD</option><option value="CNY">CNY</option>
                    <option value="EUR">EUR</option>
                  </select></div>
                <div class="field"><label for="s-incoterm">Incoterm</label>
                  <select class="select" id="s-incoterm" [ngModel]="draft().incoterm"
                          (ngModelChange)="patch({ incoterm: $event })">
                    <option value="EXW">EXW</option><option value="FOB">FOB</option>
                    <option value="CIF">CIF</option>
                  </select></div>
                <div class="field"><label for="s-port">Laadhaven <span class="opt"></span></label>
                  <input class="input" id="s-port" [ngModel]="draft().portOfLoading"
                         (ngModelChange)="patch({ portOfLoading: $event })"
                         placeholder="Bijv. Yantian / Shenzhen" /></div>
                <div class="field"><label for="s-lead">Levertijd (dagen)</label>
                  <input class="input num right" id="s-lead" type="number" min="0" step="1"
                         inputmode="numeric" [ngModel]="draft().leadTimeDays"
                         (ngModelChange)="patch({ leadTimeDays: +$event })" /></div>
                <div class="field span-2"><label for="s-notes">Interne notities <span class="opt"></span></label>
                  <textarea class="textarea" id="s-notes" rows="3" [ngModel]="draft().notes"
                            (ngModelChange)="patch({ notes: $event })"></textarea></div>
              </div>
            </section>
          }
        </div>
        <div foot style="display:contents">
          @if (!editMode()) {
            <button class="btn" type="button" (click)="close()">Sluiten</button>
            <span class="spacer"></span>
            <button class="btn btn--primary" type="button" (click)="editMode.set(true)">
              Bewerken
            </button>
          } @else {
            @if (draft().id) {
              <button class="btn btn--danger" type="button" [disabled]="saving()"
                      (click)="remove()">Verwijderen</button>
            }
            <span class="spacer"></span>
            <button class="btn" type="button" [disabled]="saving()" (click)="cancelEdit()">
              Annuleren
            </button>
            <button class="btn btn--primary" type="button"
                    [disabled]="saving()" (click)="save()">
              {{ saving() ? 'Opslaan…' : 'Opslaan' }}
            </button>
          }
        </div>
      </app-sheet>
    }
  `,
  styles: [`
    :host{display:block}.supplier-detail{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;min-width:0}.supplier-detail>*{min-width:0}.supplier-hero>*{min-width:0}
    .supplier-hero{display:flex;align-items:center;gap:10px;padding:12px;border:1px solid var(--rose-line);border-radius:16px;background:linear-gradient(145deg,var(--surface),var(--rose-soft))}
    .supplier-hero__mark{display:grid;width:42px;height:42px;flex:none;place-items:center;border-radius:13px;background:var(--rose);color:#fff;font-size:17px;font-weight:760;text-transform:uppercase}
    .supplier-hero__copy{display:flex;min-width:0;flex:1;flex-direction:column}.supplier-hero__copy>span{color:var(--rose);font-size:9px;font-weight:740;letter-spacing:.08em;text-transform:uppercase}.supplier-hero__copy strong,.supplier-hero__copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.supplier-hero__copy small{color:var(--muted);font-size:10.5px}
    .detail-section{display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;padding:12px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}.detail-section__icon{display:grid;width:34px;height:34px;place-items:center;border-radius:10px;background:var(--surface-2);color:var(--rose-dark);font-weight:760}.detail-section h3,.supplier-notes h3{margin-bottom:3px;font-size:11px}.detail-section div{display:flex;min-width:0;flex-direction:column}.detail-section strong,.detail-section a,.detail-section .muted{font-size:11.5px;overflow-wrap:anywhere}.detail-section a{color:var(--rose-dark)}
    .supplier-facts{margin:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;border:1px solid var(--line);border-radius:14px;background:var(--line);overflow:hidden}.supplier-facts div{min-width:0;padding:10px;background:var(--surface)}.supplier-facts dt{color:var(--muted);font-size:9px;text-transform:uppercase}.supplier-facts dd{margin:2px 0 0;overflow:hidden;font-size:11.5px;font-weight:680;text-overflow:ellipsis;white-space:nowrap}.supplier-notes{padding:12px;border-radius:14px;background:var(--surface-2)}.supplier-notes p{font-size:11.5px;white-space:pre-wrap}
    .form-section{margin:0 0 12px;padding:12px 12px 0;border:1px solid var(--line);border-radius:16px;background:var(--surface)}.form-section__head{display:flex;align-items:flex-start;gap:9px;margin-bottom:12px}.form-section__head>span{display:grid;width:30px;height:30px;flex:none;place-items:center;border-radius:9px;background:var(--rose-soft);color:var(--rose-dark);font-size:11px;font-weight:760}.form-section__head h3{font-size:13px}.form-section__head p{color:var(--muted);font-size:10.5px}.field-error{color:var(--danger);font-size:11px}.input[aria-invalid="true"]{border-color:var(--danger)}
    @media(min-width: 680px){.supplier-detail{gap:14px}.supplier-hero{padding:15px}.detail-section{padding:14px}.form-section{padding:15px 15px 1px}}
  `],
})
export class SupplierList {
  readonly isoCountries = ISO_COUNTRIES;
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);

  readonly suppliers = signal<Supplier[]>([]);
  readonly query = signal('');
  readonly editing = signal(false);
  readonly editMode = signal(false);
  readonly selected = signal<Supplier | null>(null);
  readonly draft = signal<Supplier>(blank());
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly saveAttempted = signal(false);

  constructor() {
    /* Deep links (the product hero) filter the list straight to one supplier. */
    const q = inject(ActivatedRoute).snapshot.queryParamMap.get('q');
    if (q) this.query.set(q);
    void this.load();
  }

  private async load(): Promise<void> {
    this.suppliers.set((await this.sourcing.suppliers())
      .map((supplier) => this.withAddressDefaults(supplier)));
    this.loading.set(false);
  }

  readonly filtered = computed(() => {
    const needle = this.query().trim().toLowerCase();
    if (!needle) return this.suppliers();
    return this.suppliers().filter((supplier) => [
      supplier.name, supplier.contact, supplier.addressLine1, supplier.addressLine2,
      supplier.postalCode, supplier.city, supplier.region, supplier.country,
      countryName(supplier.country), supplier.portOfLoading, supplier.email,
    ].join(' ').toLowerCase().includes(needle));
  });

  open(supplier: Supplier | null): void {
    const normalized = supplier ? this.withAddressDefaults(supplier) : null;
    this.selected.set(normalized);
    this.draft.set(normalized ? { ...normalized } : blank());
    this.editMode.set(!supplier);
    this.saveAttempted.set(false);
    this.editing.set(true);
  }

  close(): void {
    if (this.saving()) return;
    this.editing.set(false);
    this.editMode.set(false);
    this.selected.set(null);
  }

  cancelEdit(): void {
    const supplier = this.selected();
    if (!supplier) { this.close(); return; }
    this.draft.set({ ...supplier });
    this.editMode.set(false);
    this.saveAttempted.set(false);
  }

  supplierLocation(supplier: Supplier): string {
    return [supplier.city, supplier.region, countryName(supplier.country)]
      .map((value) => value?.trim()).filter(Boolean).join(' · ');
  }

  countryKnown(code: string): boolean {
    return ISO_COUNTRIES.some((country) => country.code === code);
  }

  patch(changes: Partial<Supplier>): void {
    this.draft.update((supplier) => ({ ...supplier, ...changes }));
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    this.saveAttempted.set(true);
    const supplier = this.draft();
    if (!supplier.name.trim()) return;
    this.saving.set(true);
    try {
      if (supplier.id === null) await this.sourcing.createSupplier(supplier);
      else await this.sourcing.updateSupplier(supplier.id, supplier);
      this.editing.set(false);
      await this.load();
      this.ui.toast('Leverancier opgeslagen');
    } catch (failure: unknown) {
      this.ui.toast(message(failure, 'Opslaan mislukt'), 'err');
    } finally {
      this.saving.set(false);
    }
  }

  /* ---- swipe to delete, the purchase-list way ---- */
  readonly swiped = signal<number | null>(null);
  private touchX = 0;
  private touchY = 0;
  private swipeHandled = false;

  swipeStart(event: TouchEvent, id: number): void {
    this.touchX = event.touches[0].clientX;
    this.touchY = event.touches[0].clientY;
    this.swipeHandled = false;
    if (this.swiped() !== null && this.swiped() !== id) this.swiped.set(null);
  }

  swipeMove(event: TouchEvent, id: number): void {
    if (this.swipeHandled) return;
    const dx = event.touches[0].clientX - this.touchX;
    const dy = event.touches[0].clientY - this.touchY;
    if (Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < -140) {
      this.swipeHandled = true;
      const supplier = this.filtered().find((candidate) => candidate.id === id);
      if (supplier) this.removeFromList(supplier);
      return;
    }
    if (dx < -24) { this.swiped.set(id); return; }
    if (dx > 24) { this.swipeHandled = true; this.swiped.set(null); }
  }

  openUnlessSwiped(event: Event, supplier: Supplier): void {
    if (this.swiped() !== null || this.swipeHandled) {
      event.preventDefault();
      if (!this.swipeHandled) this.swiped.set(null);
      return;
    }
    this.open(supplier);
  }

  removeFromList(supplier: Supplier): void {
    this.ui.confirm(
      { title: 'Leverancier verwijderen', message: `<b>${supplier.name}</b> verwijderen?`,
        confirmLabel: 'Verwijderen', danger: true },
      async () => {
        try {
          await this.sourcing.deleteSupplier(supplier.id!);
          this.swiped.set(null);
          await this.load();
          this.ui.toast('Leverancier verwijderd');
        } catch (failure: unknown) {
          this.ui.toast(message(failure, 'Verwijderen mislukt'), 'err');
        }
      });
  }

  remove(): void {
    const supplier = this.draft();
    this.ui.confirm(
      { title: 'Leverancier verwijderen', message: `<b>${supplier.name}</b> verwijderen?`,
        confirmLabel: 'Verwijderen', danger: true },
      async () => {
        try {
          await this.sourcing.deleteSupplier(supplier.id!);
          this.editing.set(false);
          await this.load();
          this.ui.toast('Leverancier verwijderd');
        } catch (failure: unknown) {
          this.ui.toast(message(failure, 'Verwijderen mislukt'), 'err');
        }
      });
  }

  private withAddressDefaults(supplier: Supplier): Supplier {
    return {
      ...supplier,
      addressLine1: supplier.addressLine1 ?? null,
      addressLine2: supplier.addressLine2 ?? null,
      postalCode: supplier.postalCode ?? null,
      region: supplier.region ?? null,
    };
  }
}

function message(failure: unknown, fallback: string): string {
  return (failure as { error?: { message?: string } }).error?.message ?? fallback;
}
