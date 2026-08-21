import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface CatalogBrochureDraft {
  photosPerProduct: number;
  coverTitle: string;
  coverSubtitle: string;
  includeOverview: boolean;
  includeCategoryIntros: boolean;
  includeCustomisation: boolean;
  includeOrdering: boolean;
  includeBackCover: boolean;
}

@Component({
  selector: 'app-catalog-brochure-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (!desktop()) {
      <div class="mobile-layout-note" role="note">
        <span aria-hidden="true">↗</span>
        <div>
          <b>Brochure maken werkt ook op mobiel</b>
          <small>Producten en basisinstellingen kies je hier. Pagina-opmaak wijzig je op desktop.</small>
        </div>
      </div>
    } @else {
      <section class="card" aria-labelledby="brochure-layout-title">
        <div class="card__head">
          <div>
            <h2 id="brochure-layout-title">Pagina-opmaak</h2>
            <p>Deze extra brochure-instellingen zijn alleen op desktop aanpasbaar.</p>
          </div>
        </div>
        <div class="card__body">
          <div class="brochure-fields">
            <label class="field">
              <span>Titel voorpagina <small>optioneel</small></span>
              <input class="input" [ngModel]="settings().coverTitle"
                     [disabled]="disabled()"
                     (ngModelChange)="patch({ coverTitle: $event })"
                     placeholder="Product Collection" />
            </label>
            <label class="field">
              <span>Ondertitel <small>optioneel</small></span>
              <input class="input" [ngModel]="settings().coverSubtitle"
                     [disabled]="disabled()"
                     (ngModelChange)="patch({ coverSubtitle: $event })"
                     placeholder="Preserved roses &amp; gifts" />
            </label>
            <label class="field">
              <span>Foto’s per product</span>
              <select class="select" [ngModel]="settings().photosPerProduct"
                      [disabled]="disabled() || !includePhotos()"
                      (ngModelChange)="patch({ photosPerProduct: +$event })">
                <option [ngValue]="1">1 foto</option>
                <option [ngValue]="2">2 foto’s</option>
                <option [ngValue]="3">3 foto’s</option>
                <option [ngValue]="4">4 foto’s</option>
              </select>
            </label>
          </div>

          <div class="page-toggles" aria-label="Pagina's in de brochure">
            <span>Brochurepagina’s</span>
            <label>
              <input type="checkbox" [ngModel]="settings().includeOverview"
                     [disabled]="disabled()"
                     (ngModelChange)="patch({ includeOverview: $event })" />
              <span><b>Collectie-overzicht</b><small>Snelle inhoudsopgave</small></span>
            </label>
            <label>
              <input type="checkbox" [ngModel]="settings().includeCategoryIntros"
                     [disabled]="disabled()"
                     (ngModelChange)="patch({ includeCategoryIntros: $event })" />
              <span><b>Categorie-intro’s</b><small>Hoofdstuk per productgroep</small></span>
            </label>
            <label>
              <input type="checkbox" [ngModel]="settings().includeCustomisation"
                     [disabled]="disabled()"
                     (ngModelChange)="patch({ includeCustomisation: $event })" />
              <span><b>Maatwerk</b><small>Mogelijkheden en afwerking</small></span>
            </label>
            <label>
              <input type="checkbox" [ngModel]="settings().includeOrdering"
                     [disabled]="disabled()"
                     (ngModelChange)="patch({ includeOrdering: $event })" />
              <span><b>Bestellen</b><small>Praktische bestelinfo</small></span>
            </label>
            <label>
              <input type="checkbox" [ngModel]="settings().includeBackCover"
                     [disabled]="disabled()"
                     (ngModelChange)="patch({ includeBackCover: $event })" />
              <span><b>Achterflap</b><small>Contact- en bedrijfsgegevens</small></span>
            </label>
          </div>
        </div>
      </section>

      <section class="card page-plan" aria-labelledby="page-plan-title">
        <div class="card__head">
          <div>
            <h2 id="page-plan-title">Pagina-opbouw</h2>
            <p>Indicatief; de PDF-renderer bepaalt de definitieve paginabreaks.</p>
          </div>
        </div>
        <ol>
          @for (page of pagePlan(); track page) {
            <li><span>{{ $index + 1 }}</span>{{ page }}</li>
          }
        </ol>
      </section>
    }
  `,
  styles: `
    :host { display: grid; min-width: 0; gap: 12px; }
    .card__head > div { min-width: 0; }
    .card__head p { margin-top: 2px; color: var(--muted); font-size: 10.5px; line-height: 1.35; }
    .field > span { color: var(--ink-2); font-size: 11.5px; font-weight: 650; }
    .field > span > small { color: var(--muted); font-size: 9px; font-weight: 500; }
    .mobile-layout-note {
      display: flex; gap: 10px; padding: 11px 12px; border: 1px solid var(--rose-line);
      border-radius: var(--r-sm); background: var(--rose-soft); color: var(--ink-2);
    }
    .mobile-layout-note > span { color: var(--rose); font-size: 18px; }
    .mobile-layout-note div { display: grid; gap: 2px; }
    .mobile-layout-note b { font-size: 11.5px; }
    .mobile-layout-note small { color: var(--muted); font-size: 10px; line-height: 1.4; }
    .brochure-fields { display: grid; gap: 0 10px; }
    .page-toggles { display: grid; gap: 6px; margin-top: 4px; }
    .page-toggles > span {
      margin: 4px 0 2px; color: var(--muted); font-size: 9.5px; font-weight: 750;
      letter-spacing: .08em; text-transform: uppercase;
    }
    .page-toggles label {
      display: flex; align-items: flex-start; gap: 9px; padding: 8px 9px;
      border: 1px solid var(--line); border-radius: 10px; cursor: pointer;
    }
    .page-toggles input {
      width: 18px; height: 18px; flex: none; accent-color: var(--rose);
    }
    .page-toggles label span { display: grid; gap: 1px; }
    .page-toggles b { font-size: 11px; }
    .page-toggles small { color: var(--muted); font-size: 9.5px; }
    .page-plan ol { display: grid; gap: 0; margin: 0; padding: 7px 14px 12px; list-style: none; }
    .page-plan li {
      display: flex; align-items: center; gap: 9px; min-height: 36px;
      border-bottom: 1px solid var(--line); font-size: 11px;
    }
    .page-plan li:last-child { border-bottom: 0; }
    .page-plan li span {
      display: grid; width: 22px; height: 22px; flex: none; place-items: center;
      border-radius: 50%; background: var(--surface-2); color: var(--muted); font-size: 9px;
    }
    @media (min-width: 620px) {
      .brochure-fields { grid-template-columns: 1fr 1fr; }
      .brochure-fields .field:last-child { grid-column: 1 / -1; }
    }
  `,
})
export class CatalogBrochureSettings {
  readonly desktop = input(false);
  readonly includePhotos = input(true);
  readonly selectedFamilyCount = input(0);
  readonly disabled = input(false);
  readonly settings = input.required<CatalogBrochureDraft>();
  readonly settingsChange = output<CatalogBrochureDraft>();

  readonly pagePlan = computed(() => {
    const settings = this.settings();
    const plan = ['Voorpagina'];
    if (settings.includeOverview) plan.push('Collectie-overzicht');
    if (settings.includeCategoryIntros) plan.push('Categorie-intro’s');
    const families = this.selectedFamilyCount();
    plan.push(`Productgroepen · ${families} groep${families === 1 ? '' : 'en'}`);
    if (settings.includeCustomisation) plan.push('Maatwerk');
    if (settings.includeOrdering) plan.push('Bestellen');
    if (settings.includeBackCover) plan.push('Achterflap');
    return plan;
  });

  patch(changes: Partial<CatalogBrochureDraft>): void {
    if (this.disabled()) return;
    this.settingsChange.emit({ ...this.settings(), ...changes });
  }
}
