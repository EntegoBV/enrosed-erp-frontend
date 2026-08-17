import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SalesApi } from '../../core/api/sales-api';
import { Country } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Sheet, Ui } from '../../shared/ui';

function blank(): Country {
  return { code: '', name: '', minOrderValue: 2500, freightPerPallet: 95,
           minFreight: 250, handling: 35, vatRatePct: 21, transitDays: 3, euMember: true };
}

@Component({
  selector: 'app-country-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeader, Sheet],
  template: `
    <app-page-header title="Landen & vracht" subtitle="Minimum order en palletvracht per land">
      <button class="btn btn--primary btn--sm hide-mobile" type="button" (click)="open(null)">
        + Land
      </button>
    </app-page-header>

    <div class="content">
      <div class="alert alert--info">
        <span class="alert__icon">ℹ</span>
        <div>
          Verkoop gaat op pallets over de weg:
          <code>max(pallets × tarief, minimum) + administratie</code>.
        </div>
      </div>

      <div class="card mt-12"><div class="list">
        @for (country of countries(); track country.code) {
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
          <div class="empty"><div class="empty__title">Laden…</div></div>
        }
      </div></div>
    </div>

    <button class="fab" type="button" (click)="open(null)">+ Land</button>

    @if (editing()) {
      <app-sheet [title]="isNew() ? 'Land toevoegen' : draft().name"
                 (closed)="editing.set(false)">
        <div body><div class="form-grid">
          @if (isNew()) {
            <div class="field"><label for="k-code">Landcode (ISO)</label>
              <input class="input" id="k-code" maxlength="2" [ngModel]="draft().code"
                     (ngModelChange)="patch({ code: $event.toUpperCase() })" /></div>
            <div class="field"><label for="k-name">Naam</label>
              <input class="input" id="k-name" [ngModel]="draft().name"
                     (ngModelChange)="patch({ name: $event })" /></div>
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
          <button class="btn btn--primary" type="button" (click)="save()">Opslaan</button>
        </div>
      </app-sheet>
    }
  `,
})
export class CountryList {
  private readonly sales = inject(SalesApi);
  private readonly ui = inject(Ui);

  readonly countries = signal<Country[]>([]);
  readonly editing = signal(false);
  readonly isNew = signal(false);
  readonly draft = signal<Country>(blank());

  constructor() { void this.load(); }

  private async load(): Promise<void> {
    this.countries.set(await this.sales.countries());
  }

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

  async save(): Promise<void> {
    const country = this.draft();
    if (this.isNew() && country.code.length !== 2) {
      this.ui.toast('Landcode moet 2 letters zijn', 'err');
      return;
    }
    await this.sales.saveCountry(country);
    this.editing.set(false);
    await this.load();
    this.ui.toast('Land opgeslagen');
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
