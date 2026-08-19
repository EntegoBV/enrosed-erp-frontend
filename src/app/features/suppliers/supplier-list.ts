import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Skeleton } from '../../shared/skeleton';
import { FormsModule } from '@angular/forms';
import { SourcingApi } from '../../core/api/sourcing-api';
import { Supplier } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { ISO_COUNTRIES, countryName } from '../../core/api/geo';
import { Sheet, Ui } from '../../shared/ui';

function blank(): Supplier {
  return {
    id: null, name: '', country: 'CN', city: '', contact: '', email: '', phone: '',
    currency: 'USD', incoterm: 'FOB', portOfLoading: '', leadTimeDays: 35, notes: '',
  };
}

@Component({
  selector: 'app-supplier-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, FormsModule, PageHeader, Sheet],
  template: `
    <app-page-header title="Leveranciers" [subtitle]="suppliers().length + ' leveranciers'">
      <button class="btn btn--primary btn--sm hide-mobile" type="button" (click)="open(null)">
        + Nieuw
      </button>
    </app-page-header>

    <div class="content">
      <div class="search-bar">
        <input class="input" type="search" placeholder="Zoek op leverancier, contact, stad of haven…"
               [ngModel]="query()" (ngModelChange)="query.set($event)" />
      </div>
      <div class="card"><div class="list">
        @for (supplier of filtered(); track supplier.id) {
          <button class="list-item" type="button" style="text-align:left;width:100%;border-width:0 0 1px"
                  (click)="open(supplier)">
            <div class="list-item__body">
              <div class="list-item__title">{{ supplier.name }}</div>
              <div class="list-item__meta">{{ supplier.city }}, {{ name(supplier.country) }} ·
                {{ supplier.contact }}</div>
              <div class="list-item__meta">levertijd {{ supplier.leadTimeDays }} dagen ·
                {{ supplier.portOfLoading }}</div>
            </div>
            <div class="list-item__end">
              <span class="badge badge--blue">{{ supplier.currency }}</span>
              <div class="tiny muted mt-8">{{ supplier.incoterm }}</div>
            </div>
            <span class="list-item__chev">›</span>
          </button>
        } @empty {
          <div class="empty"><div class="empty__title">
            @if (loading()) { <app-skeleton kind="lines" [rows]="3" /> } @else { Geen leveranciers gevonden }</div></div>
        }
      </div></div>
    </div>

    <button class="fab" type="button" (click)="open(null)">+ Leverancier</button>

    @if (editing()) {
      <app-sheet [title]="draft().id ? 'Leverancier bewerken' : 'Nieuwe leverancier'"
                 (closed)="editing.set(false)">
        <div body>
          <p class="legend"><b>*</b> verplicht · de rest kan later.</p>
          <div class="form-grid">
            <div class="field span-2"><label class="req" for="s-name">Naam</label>
              <input class="input" id="s-name" [ngModel]="draft().name"
                     (ngModelChange)="patch({ name: $event })" /></div>
            <div class="field"><label for="s-city">Stad</label>
              <input class="input" id="s-city" [ngModel]="draft().city"
                     (ngModelChange)="patch({ city: $event })" /></div>
            <div class="field"><label for="s-country">Land</label>
              <select class="select" id="s-country" [ngModel]="draft().country"
                      (ngModelChange)="patch({ country: $event })">
                @for (option of isoCountries; track option.code) {
                  <option [value]="option.code">{{ option.name }}</option>
                }
              </select></div>
            <div class="field"><label for="s-contact">Contactpersoon</label>
              <input class="input" id="s-contact" [ngModel]="draft().contact"
                     (ngModelChange)="patch({ contact: $event })" /></div>
            <div class="field"><label for="s-email">E-mail</label>
              <input class="input" id="s-email" type="email" [ngModel]="draft().email"
                     (ngModelChange)="patch({ email: $event })" /></div>
            <div class="field"><label for="s-phone">Telefoon</label>
              <input class="input" id="s-phone" [ngModel]="draft().phone"
                     (ngModelChange)="patch({ phone: $event })" /></div>
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
                     (ngModelChange)="patch({ portOfLoading: $event })" /></div>
            <div class="field"><label for="s-lead">Levertijd (dagen)</label>
              <input class="input num right" id="s-lead" type="number" min="0" step="1"
                     [ngModel]="draft().leadTimeDays"
                     (ngModelChange)="patch({ leadTimeDays: +$event })" /></div>
            <div class="field span-2"><label for="s-notes">Notities <span class="opt"></span></label>
              <textarea class="textarea" id="s-notes" [ngModel]="draft().notes"
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
export class SupplierList {
  readonly isoCountries = ISO_COUNTRIES;
  readonly name = countryName;
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);

  readonly suppliers = signal<Supplier[]>([]);
  readonly query = signal('');
  readonly editing = signal(false);
  readonly draft = signal<Supplier>(blank());
  readonly loading = signal(true);

  constructor() { void this.load(); }

  private async load(): Promise<void> {
    this.suppliers.set(await this.sourcing.suppliers());
    this.loading.set(false);
  }

  readonly filtered = computed(() => {
    const needle = this.query().trim().toLowerCase();
    if (!needle) return this.suppliers();
    return this.suppliers().filter((supplier) => [
      supplier.name, supplier.contact, supplier.city, supplier.country,
      supplier.portOfLoading, supplier.email,
    ].join(' ').toLowerCase().includes(needle));
  });

  open(supplier: Supplier | null): void {
    this.draft.set(supplier ? { ...supplier } : blank());
    this.editing.set(true);
  }

  patch(changes: Partial<Supplier>): void {
    this.draft.update((supplier) => ({ ...supplier, ...changes }));
  }

  async save(): Promise<void> {
    const supplier = this.draft();
    try {
      if (supplier.id === null) await this.sourcing.createSupplier(supplier);
      else await this.sourcing.updateSupplier(supplier.id, supplier);
      this.editing.set(false);
      await this.load();
      this.ui.toast('Leverancier opgeslagen');
    } catch (failure: unknown) {
      this.ui.toast(message(failure, 'Opslaan mislukt'), 'err');
    }
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
}

function message(failure: unknown, fallback: string): string {
  return (failure as { error?: { message?: string } }).error?.message ?? fallback;
}
