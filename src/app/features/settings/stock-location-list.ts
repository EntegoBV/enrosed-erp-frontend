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
    <app-page-header [showBack]="true" backTo="/more" title="Voorraadlocaties" subtitle="Waar je voorraad ligt en verkoopt">
      <button class="btn btn--primary btn--sm hide-mobile" type="button" (click)="open(null)">
        + Locatie
      </button>
    </app-page-header>

    <div class="content">
      <details class="explainer">
        <summary>Welke voorraad telt waar?</summary>
        <div class="explainer__body">
          <p>Website, portaal en offertes tellen alleen de voorraad van locaties die <b>ter beschikking staan voor alle verkoopkanalen</b> - normaal het magazijn.</p>
          <p>Een <b>verkooppunt</b> zoals TICA heeft eigen voorraad die daar ter plaatse verkocht wordt; die telt niet mee voor de website. Verplaatsen tussen locaties doe je onder Voorraad.</p>
          <p>Een locatie kan daarnaast een <b>publiek afhaalpunt</b> zijn. Afhalen is gratis; klanten zien alleen de publieke naam, het publieke adres en de instructies die u hieronder invult.</p>
        </div>
      </details>

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
              @if (location.countsForWebsite) { <span class="badge badge--ok">alle kanalen</span> }
              @else { <span class="badge">enkel ter plaatse</span> }
              @if (location.publicPickupPoint) { <span class="badge badge--rose">publiek afhaalpunt</span> }
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
              <span>Voorraad ter beschikking voor alle verkoopkanalen</span>
            </label>
            @if (draft().countsForWebsite) {
              <span class="hint">Wat hier ligt, kan via elk kanaal verkocht worden: website, portaal en offertes tellen deze voorraad mee.</span>
            } @else {
              <span class="hint">Wat hier ligt, wordt alleen ter plaatse verkocht (bv. een TICA-stand); website, portaal en offertes tellen deze voorraad niet mee.</span>
            }
          </div>
          <section class="public-pickup span-2" aria-labelledby="public-pickup-title">
            <div class="public-pickup__head">
              <div>
                <b id="public-pickup-title">Publiek afhaalpunt</b>
                <span>Gratis afhalen als leveringskeuze in het online offertesysteem.</span>
              </div>
              <label class="switch-row">
                <input type="checkbox" [ngModel]="draft().publicPickupPoint"
                       (ngModelChange)="patch({ publicPickupPoint: $event })" />
                <span>Tonen aan klanten</span>
              </label>
            </div>
            @if (draft().publicPickupPoint) {
              <div class="public-pickup__fields">
                <div class="field">
                  <label class="req" for="l-pickup-label">Naam voor klanten</label>
                  <input class="input" id="l-pickup-label" [ngModel]="draft().publicPickupLabel"
                         placeholder="Afhalen bij Enrosed, Aartselaar"
                         (ngModelChange)="patch({ publicPickupLabel: $event })" />
                </div>
                <div class="field">
                  <label for="l-pickup-position">Volgorde</label>
                  <input class="input num" id="l-pickup-position" type="number" min="0" step="1"
                         [ngModel]="draft().publicPickupPosition"
                         (ngModelChange)="patch({ publicPickupPosition: numberOrNull($event) })" />
                </div>
                <div class="field span-2">
                  <label class="req" for="l-pickup-address">Adres voor klanten</label>
                  <input class="input" id="l-pickup-address" [ngModel]="draft().publicPickupAddress"
                         placeholder="Straat 1, 2630 Aartselaar, België"
                         (ngModelChange)="patch({ publicPickupAddress: $event })" />
                  <span class="hint">Dit adres staat letterlijk bij de gratis afhaaloptie op de website.</span>
                </div>
                <div class="field span-2">
                  <label for="l-pickup-instructions">Afhaalinstructies <span class="opt"></span></label>
                  <textarea class="textarea" id="l-pickup-instructions" rows="3"
                            [ngModel]="draft().publicPickupInstructions"
                            placeholder="Bijvoorbeeld: aanmelden aan de receptie, ma-vr tussen 9:00 en 16:00."
                            (ngModelChange)="patch({ publicPickupInstructions: $event })"></textarea>
                </div>
                @if (!draft().active) {
                  <div class="public-pickup__warning span-2" role="note">
                    Deze locatie is inactief en verschijnt pas als afhaalpunt wanneer u ze opnieuw activeert.
                  </div>
                }
              </div>
            } @else {
              <p>Interne locatiegegevens blijven onzichtbaar op de website.</p>
            }
          </section>
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
    .public-pickup { display: grid; gap: 14px; padding: 16px; border: 1px solid var(--rose-line); border-radius: var(--r-sm); background: var(--rose-soft); }
    .public-pickup__head { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
    .public-pickup__head > div { display: grid; gap: 3px; }
    .public-pickup__head b { font-size: 16px; }
    .public-pickup__head span, .public-pickup > p { color: var(--muted); font-size: 13px; line-height: 1.45; }
    .switch-row { display: flex; min-height: 44px; flex: none; align-items: center; gap: 8px; padding: 8px 11px; border: 1px solid var(--rose-line); border-radius: 10px; background: var(--surface); cursor: pointer; }
    .switch-row span { color: var(--rose-dark); font-weight: 750; }
    .public-pickup__fields { display: grid; grid-template-columns: minmax(0, 1fr) 120px; gap: 12px; }
    .public-pickup__warning { padding: 10px 12px; border-radius: 9px; background: var(--warn-soft); color: var(--warn); font-size: 13px; }
    @media (max-width: 620px) {
      .public-pickup__head { align-items: stretch; flex-direction: column; }
      .public-pickup__fields { grid-template-columns: 1fr; }
      .public-pickup__fields .span-2 { grid-column: auto; }
    }
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
      this.locations.set((await this.catalog.stockLocations()).map(normalizePickupFields));
    } finally {
      this.loading.set(false);
    }
  }

  open(location: StockLocation | null): void {
    this.draft.set(location ? normalizePickupFields({ ...location }) : blank(this.locations().length));
    this.editing.set(true);
  }

  patch(changes: Partial<StockLocation>): void {
    this.draft.update((location) => ({ ...location, ...changes }));
  }

  numberOrNull(value: number | string | null): number | null {
    if (value === null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : null;
  }

  async save(): Promise<void> {
    if (!this.draft().name.trim()) {
      this.ui.toast('Geef de locatie een naam', 'err');
      return;
    }
    if (this.draft().publicPickupPoint
        && (!this.draft().publicPickupLabel?.trim() || !this.draft().publicPickupAddress?.trim())) {
      this.ui.toast('Vul voor het publieke afhaalpunt een klantnaam en adres in', 'err');
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
    countsForWebsite: true, receivesByDefault: false, position,
    publicPickupPoint: false, publicPickupLabel: null, publicPickupAddress: null,
    publicPickupInstructions: null, publicPickupPosition: position };
}

/** Allows the editor to open while an older server response is being replaced. */
function normalizePickupFields(location: StockLocation): StockLocation {
  return {
    ...location,
    publicPickupPoint: location.publicPickupPoint ?? false,
    publicPickupLabel: location.publicPickupLabel ?? null,
    publicPickupAddress: location.publicPickupAddress ?? null,
    publicPickupInstructions: location.publicPickupInstructions ?? null,
    publicPickupPosition: location.publicPickupPosition ?? location.position,
  };
}
