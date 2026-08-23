import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { StockLocation } from '../../core/api/models';
import { messageOf } from '../../core/api/errors';
import { PageHeader } from '../../shared/page-header';
import { Sheet, Ui } from '../../shared/ui';

/**
 * Where stock can lie: the warehouse and every sales point.
 *
 * Only locations that count for the website feed the figure customers see;
 * what lies at a stand is there to be sold on the spot.
 */
@Component({
  selector: 'app-stock-location-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeader, Sheet],
  template: `
    <app-page-header title="Voorraadlocaties" subtitle="Waar je voorraad ligt en verkoopt">
      <button class="btn btn--primary btn--sm hide-mobile" type="button" (click)="open(null)">
        + Locatie
      </button>
    </app-page-header>

    <div class="content">
      <div class="alert alert--info">
        <span class="alert__icon">ℹ</span>
        <div>
          Het <b>magazijn</b> is wat de website en het portaal als voorraad tonen. Een
          <b>verkooppunt</b> (bv. TICA) heeft eigen voorraad die daar ter plaatse verkocht wordt.
        </div>
      </div>

      <div class="card mt-12"><div class="list">
        @for (location of locations(); track location.id) {
          <button class="list-item" type="button" style="text-align:left;width:100%;border-width:0 0 1px"
                  [class.list-item--inactive]="!location.active" (click)="open(location)">
            <div class="list-item__body">
              <div class="list-item__title">{{ location.name }}</div>
              <div class="list-item__meta">
                {{ location.kindLabel }}
                @if (location.address) { · {{ location.address }} }
              </div>
            </div>
            <div class="list-item__end location-flags">
              @if (location.countsForWebsite) { <span class="badge badge--ok">website</span> }
              @if (!location.active) { <span class="badge">inactief</span> }
            </div>
            <span class="list-item__chev">›</span>
          </button>
        } @empty {
          <div class="empty"><div class="empty__title">{{ loading() ? 'Laden…' : 'Nog geen locaties' }}</div></div>
        }
      </div></div>
    </div>

    <button class="fab" type="button" (click)="open(null)">+ Locatie</button>

    @if (editing()) {
      <app-sheet [title]="isNew() ? 'Locatie toevoegen' : draft().name" (closed)="editing.set(false)">
        <div body><div class="form-grid">
          <div class="field span-2"><label class="req" for="l-name">Naam</label>
            <input class="input" id="l-name" [ngModel]="draft().name" placeholder="bijv. TICA Aalsmeer"
                   (ngModelChange)="patch({ name: $event })" /></div>
          <div class="field"><label for="l-kind">Soort</label>
            <select class="select" id="l-kind" [ngModel]="draft().kind" [disabled]="isMain()"
                    (ngModelChange)="patch({ kind: $event })">
              <option value="WAREHOUSE">Magazijn</option>
              <option value="SALES_POINT">Verkooppunt</option>
            </select></div>
          <div class="field"><label for="l-code">Code <span class="opt"></span></label>
            <input class="input mono" id="l-code" [ngModel]="draft().code" [disabled]="isMain()"
                   placeholder="automatisch" (ngModelChange)="patch({ code: $event })" /></div>
          <div class="field span-2"><label for="l-address">Adres <span class="opt"></span></label>
            <input class="input" id="l-address" [ngModel]="draft().address"
                   (ngModelChange)="patch({ address: $event })" /></div>
          <div class="field span-2">
            <label class="row" style="gap:8px;cursor:pointer">
              <input type="checkbox" [ngModel]="draft().countsForWebsite"
                     (ngModelChange)="patch({ countsForWebsite: $event })" />
              <span>Telt mee voor website en portaal</span>
            </label>
            <span class="hint">Aan voor het magazijn; uit voor een stand waar je ter plaatse verkoopt.</span>
          </div>
          @if (!isMain()) {
            <div class="field span-2">
              <label class="row" style="gap:8px;cursor:pointer">
                <input type="checkbox" [ngModel]="draft().active"
                       (ngModelChange)="patch({ active: $event })" />
                <span>Actief</span>
              </label>
            </div>
          }
        </div></div>
        <div foot style="display:contents">
          @if (!isNew() && !isMain()) {
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
    .location-flags { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
    .list-item--inactive { opacity: .6; }
  `,
})
export class StockLocationList {
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);

  readonly locations = signal<StockLocation[]>([]);
  readonly loading = signal(true);
  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly draft = signal<StockLocation>(blank());
  readonly isNew = computed(() => this.draft().id === null);
  readonly isMain = computed(() => this.draft().code === 'MAIN');

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.locations.set(await this.catalog.stockLocations());
    } finally {
      this.loading.set(false);
    }
  }

  open(location: StockLocation | null): void {
    this.draft.set(location ? { ...location } : blank(this.locations().length));
    this.editing.set(true);
  }

  patch(changes: Partial<StockLocation>): void {
    this.draft.update((location) => ({ ...location, ...changes }));
  }

  async save(): Promise<void> {
    if (!this.draft().name.trim()) {
      this.ui.toast('Geef de locatie een naam', 'err');
      return;
    }
    this.saving.set(true);
    try {
      await this.catalog.saveStockLocation(this.draft());
      this.editing.set(false);
      await this.load();
      this.ui.toast('Locatie opgeslagen', 'ok');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Opslaan mislukt'), 'err');
    } finally {
      this.saving.set(false);
    }
  }

  remove(): void {
    const location = this.draft();
    if (location.id === null) return;
    this.ui.confirm(
      { title: 'Locatie verwijderen', message: `<b>${location.name}</b> verwijderen? Dat kan alleen als er niets meer ligt.`,
        confirmLabel: 'Verwijderen', danger: true },
      async () => {
        try {
          await this.catalog.deleteStockLocation(location.id!);
          this.editing.set(false);
          await this.load();
          this.ui.toast('Locatie verwijderd');
        } catch (failure: unknown) {
          this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
        }
      });
  }
}

function blank(position = 0): StockLocation {
  return { id: null, code: null, name: '', kind: 'SALES_POINT', address: null, active: true,
    countsForWebsite: false, receivesByDefault: false, position };
}
