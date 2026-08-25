import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SalesApi } from '../../core/api/sales-api';
import { Country } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { CarrierManager } from './carrier-manager';
import { ISO_COUNTRIES, countryName } from '../../core/api/geo';
import { Sheet, Ui } from '../../shared/ui';

function blank(): Country {
  return { code: '', name: '', minOrderValue: 2500, freightPerPallet: 95,
           minFreight: 250, handling: 35, vatRatePct: 21, transitDays: 3, euMember: true };
}

@Component({
  selector: 'app-country-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeader, Sheet, CarrierManager],
  template: `
    <app-page-header [showBack]="true" backTo="/more" title="Landen & vracht" subtitle="Minimum order, palletvracht en staffels">
      @if (tab() === 'LANDEN') {
        <button class="btn btn--primary btn--sm hide-mobile" type="button" (click)="open(null)">
          + Land
        </button>
      }
    </app-page-header>

    <div class="content">
      <!-- Two halves of the same subject: the country's own tariff, and the
           shipping organisations whose staffels can replace it. -->
      <div class="doc-tabs" role="tablist" aria-label="Landen of verzendorganisaties">
        <button type="button" role="tab" [attr.aria-selected]="tab() === 'LANDEN'"
                [class.doc-tabs__active]="tab() === 'LANDEN'" (click)="tab.set('LANDEN')">
          Landen
        </button>
        <button type="button" role="tab" [attr.aria-selected]="tab() === 'CARRIERS'"
                [class.doc-tabs__active]="tab() === 'CARRIERS'" (click)="tab.set('CARRIERS')">
          Verzendorganisaties
        </button>
      </div>

      @if (tab() === 'CARRIERS') {
        <app-carrier-manager />
      } @else {
      <details class="explainer">
        <summary>Hoe wordt vracht berekend?</summary>
        <div class="explainer__body">
          <p>Verkoop gaat op pallets over de weg. Per land staat een tarief per pallet, een minimum per zending en een vaste administratiekost.</p>
          <p>Vracht = <b>pallets × tarief</b>, maar nooit minder dan het <b>minimum</b>, plus de <b>administratie</b>. Onder het minimum orderbedrag kan een klant uit dat land niet bestellen.</p>
        </div>
      </details>

      <div class="search-bar mt-12">
        <input class="input" type="search" placeholder="Zoek op land of landcode…"
               [ngModel]="query()" (ngModelChange)="query.set($event)" />
      </div>

      <div class="card"><div class="list">
        @for (country of filtered(); track country.code) {
          <button class="list-item" type="button" style="text-align:left;width:100%;border-width:0 0 1px"
                  (click)="open(country)">
            <span class="flag">{{ country.code }}</span>
            <div class="list-item__body">
              <div class="list-item__title">{{ country.name }}</div>
              <div class="list-item__meta">
                min. {{ country.minOrderValue }} EUR · {{ country.transitDays }} dagen ·
                BTW {{ country.vatRatePct }}%
                @if (!country.euMember) { · <span class="warn-text">buiten EU</span> }
              </div>
            </div>
            <div class="list-item__end">
              <div class="strong num">{{ country.freightPerPallet }} €</div>
              <div class="tiny muted">per pallet</div>
            </div>
            <span class="list-item__chev">›</span>
          </button>
        } @empty {
          <div class="empty"><div class="empty__title">Geen landen gevonden</div></div>
        }
      </div></div>
      }
    </div>

    @if (tab() === 'LANDEN') {
      <button class="fab" type="button" (click)="open(null)">+ Land</button>
    }

    @if (editing()) {
      <app-sheet [title]="isNew() ? 'Land toevoegen' : draft().name"
                 (closed)="editing.set(false)">
        <div body><div class="form-grid">
          @if (isNew()) {
            <!-- One pick fills both code and name; nobody should have to know
                 that Ireland is IE. -->
            <div class="field span-2"><label class="req" for="k-code">Land</label>
              <select class="select" id="k-code" [ngModel]="draft().code"
                      (ngModelChange)="pickCountry($event)">
                <option value="" disabled>Kies een land…</option>
                @for (option of isoCountries; track option.code) {
                  <option [value]="option.code">{{ option.name }} ({{ option.code }})</option>
                }
              </select></div>
          }
          <div class="field"><label for="k-min">Minimum orderwaarde</label>
            <div class="input-affix">
              <input class="input num right" id="k-min" type="number" step="100"
                     [ngModel]="draft().minOrderValue"
                     (ngModelChange)="patch({ minOrderValue: +$event })" />
              <span class="input-affix__suffix">EUR</span></div></div>
          <div class="field"><label for="k-pallet">Vracht per pallet</label>
            <div class="input-affix">
              <input class="input num right" id="k-pallet" type="number" step="5"
                     [ngModel]="draft().freightPerPallet"
                     (ngModelChange)="patch({ freightPerPallet: +$event })" />
              <span class="input-affix__suffix">EUR</span></div></div>
          <div class="field"><label for="k-minfreight">Minimum vrachtkost</label>
            <div class="input-affix">
              <input class="input num right" id="k-minfreight" type="number" step="10"
                     [ngModel]="draft().minFreight"
                     (ngModelChange)="patch({ minFreight: +$event })" />
              <span class="input-affix__suffix">EUR</span></div></div>
          <div class="field"><label for="k-handling">Administratie</label>
            <div class="input-affix">
              <input class="input num right" id="k-handling" type="number" step="5"
                     [ngModel]="draft().handling"
                     (ngModelChange)="patch({ handling: +$event })" />
              <span class="input-affix__suffix">EUR</span></div></div>
          <div class="field"><label for="k-vat">BTW</label>
            <div class="input-affix">
              <input class="input num right" id="k-vat" type="number" step="0.1"
                     [ngModel]="draft().vatRatePct"
                     (ngModelChange)="patch({ vatRatePct: +$event })" />
              <span class="input-affix__suffix">%</span></div></div>
          <div class="field span-2">
            <label class="row" style="gap:8px;cursor:pointer">
              <input type="checkbox" [ngModel]="draft().euMember"
                     (ngModelChange)="patch({ euMember: $event })" />
              <span>Lidstaat van de EU</span>
            </label>
            <span class="hint">
              Bepaalt het BTW-regime: binnen de EU met een geldig BTW-nummer is de levering
              intracommunautair en vrijgesteld, daarbuiten is het uitvoer.
            </span>
          </div>
          <div class="field"><label for="k-transit">Transittijd</label>
            <div class="input-affix">
              <input class="input num right" id="k-transit" type="number" step="1"
                     [ngModel]="draft().transitDays"
                     (ngModelChange)="patch({ transitDays: +$event })" />
              <span class="input-affix__suffix">dagen</span></div></div>
        </div>
        <div class="alert alert--info mt-8">
          <span class="alert__icon">≈</span>
          <div>4 pallets = <b>{{ example() }} EUR</b> vracht.</div>
        </div></div>
        <div foot style="display:contents">
          @if (!isNew()) {
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
  styles: [`
    .doc-tabs { display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:12px;padding:4px;
      border:1px solid var(--line);border-radius:14px;background:var(--surface) }
    .doc-tabs button { min-height:40px;border:0;border-radius:10px;background:transparent;color:var(--muted);
      font:inherit;font-size:12.5px;font-weight:680;cursor:pointer }
    .doc-tabs__active { background:var(--rose-soft)!important;color:var(--rose-dark)!important }
  `],
})
export class CountryList {
  readonly tab = signal<'LANDEN' | 'CARRIERS'>('LANDEN');

  readonly isoCountries = ISO_COUNTRIES;

  /** Filling code and name together keeps them consistent by construction. */
  pickCountry(code: string): void {
    this.patch({ code, name: countryName(code) });
  }

  private readonly sales = inject(SalesApi);
  private readonly ui = inject(Ui);

  readonly countries = signal<Country[]>([]);
  readonly query = signal('');
  readonly editing = signal(false);
  readonly isNew = signal(false);
  readonly draft = signal<Country>(blank());

  constructor() { void this.load(); }

  private async load(): Promise<void> {
    this.countries.set(await this.sales.countries());
  }

  readonly filtered = computed(() => {
    const needle = this.query().trim().toLowerCase();
    return this.countries().filter((country) => !needle ||
      `${country.code} ${country.name}`.toLowerCase().includes(needle));
  });

  readonly example = computed(() => {
    const country = this.draft();
    return Math.max(4 * country.freightPerPallet, country.minFreight) + country.handling;
  });

  open(country: Country | null): void {
    this.isNew.set(!country);
    this.draft.set(country ? { ...country } : blank());
    this.editing.set(true);
  }

  patch(changes: Partial<Country>): void {
    this.draft.update((country) => ({ ...country, ...changes }));
  }

  readonly saving = signal(false);

  async save(): Promise<void> {
    if (this.saving()) return;
    const country = this.draft();
    if (this.isNew() && country.code.length !== 2) {
      this.ui.toast('Landcode moet 2 letters zijn', 'err');
      return;
    }
    this.saving.set(true);
    try {
      await this.sales.saveCountry(country);
      this.editing.set(false);
      await this.load();
      this.ui.toast('Land opgeslagen');
    } finally {
      this.saving.set(false);
    }
  }

  remove(): void {
    const country = this.draft();
    this.ui.confirm(
      { title: 'Land verwijderen', message: `<b>${country.name}</b> verwijderen?`,
        confirmLabel: 'Verwijderen', danger: true },
      async () => {
        await this.sales.deleteCountry(country.code);
        this.editing.set(false);
        await this.load();
        this.ui.toast('Land verwijderd');
      });
  }
}
