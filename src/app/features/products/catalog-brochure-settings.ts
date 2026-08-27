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
    <section class="card" aria-labelledby="brochure-layout-title">
        <div class="card__head">
          <div>
            <h2 id="brochure-layout-title">Opbouw handelscatalogus</h2>
            <p>Een vaste, duidelijke B2B-flow met maximaal twee overzichtspagina’s.</p>
          </div>
        </div>
        <div class="card__body">
          <div class="brochure-fields">
            <label class="field">
              <span>Titel op de cover <small>optioneel</small></span>
              <input class="input" [ngModel]="settings().coverTitle"
                     [disabled]="disabled()"
                     (ngModelChange)="patch({ coverTitle: $event })"
                     placeholder="Bijvoorbeeld: Wholesale Collection" />
            </label>
            <label class="field">
              <span>Ondertitel op de cover <small>optioneel</small></span>
              <input class="input" [ngModel]="settings().coverSubtitle"
                     [disabled]="disabled()"
                     (ngModelChange)="patch({ coverSubtitle: $event })"
                     placeholder="Bijvoorbeeld: Ready for retail" />
            </label>
            <label class="field">
              <span>Foto’s per productgroep</span>
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

          <div class="required-pages" aria-label="Vaste cataloguspagina’s">
            <div>
              <i aria-hidden="true">✓</i>
              <span><b>Volledig productoverzicht</b><small>Alle gekozen producten op maximaal twee pagina’s, met doorklik naar het juiste detail.</small></span>
            </div>
            <div>
              <i aria-hidden="true">✓</i>
              <span><b>Bestellen en offerte</b><small>Duidelijke afsluiting met de volgende stap voor de klant.</small></span>
            </div>
          </div>

          <details class="extra-pages">
            <summary>Extra pagina’s toevoegen <span>optioneel</span></summary>
            <div class="page-toggles" aria-label="Optionele pagina's in de brochure">
              <label>
                <input type="checkbox" [ngModel]="settings().includeCategoryIntros"
                       [disabled]="disabled()"
                       (ngModelChange)="patch({ includeCategoryIntros: $event })" />
                <span><b>Categorie-intro’s</b><small>Een extra opener voor elke productcategorie</small></span>
              </label>
              <label>
                <input type="checkbox" [ngModel]="settings().includeCustomisation"
                       [disabled]="disabled()"
                       (ngModelChange)="patch({ includeCustomisation: $event })" />
                <span><b>Maatwerk</b><small>Private label, afwerking en presentatiemogelijkheden</small></span>
              </label>
              <label>
                <input type="checkbox" [ngModel]="settings().includeBackCover"
                       [disabled]="disabled()"
                       (ngModelChange)="patch({ includeBackCover: $event })" />
                <span><b>Achterflap</b><small>Contact- en bedrijfsgegevens op een aparte slotpagina</small></span>
              </label>
            </div>
          </details>
        </div>
    </section>

    <section class="card page-plan" aria-labelledby="page-plan-title">
        <div class="card__head">
          <div>
            <h2 id="page-plan-title">Zo wordt de PDF opgebouwd</h2>
            <p>De lezer ziet eerst het volledige aanbod en gaat daarna pas naar de details.</p>
          </div>
        </div>
        <ol>
          @for (page of pagePlan(); track page) {
            <li><span>{{ $index + 1 }}</span>{{ page }}</li>
          }
        </ol>
    </section>
  `,
  styles: `
    :host { display: grid; min-width: 0; gap: 12px; }
    .card__head > div { min-width: 0; }
    .card__head p { margin-top: 4px; color: var(--muted); font-size: 14px; line-height: 1.45; }
    .field > span { color: var(--ink-2); font-size: 14px; font-weight: 700; }
    .field > span > small { color: var(--muted); font-size: 14px; font-weight: 500; }
    .brochure-fields { display: grid; gap: 2px 12px; }
    .brochure-fields .input, .brochure-fields .select { min-height: 48px; font-size: 16px; }
    .required-pages { display: grid; gap: 8px; margin-top: 14px; }
    .required-pages > div {
      display: flex; min-height: 68px; align-items: flex-start; gap: 11px; padding: 13px;
      border: 1px solid color-mix(in srgb, var(--ok) 35%, var(--line));
      border-radius: 12px; background: color-mix(in srgb, var(--ok) 7%, var(--surface));
    }
    .required-pages i {
      display: grid; width: 24px; height: 24px; flex: none; place-items: center;
      border-radius: 50%; background: var(--ok); color: #fff; font-size: 14px;
      font-style: normal; font-weight: 800;
    }
    .required-pages span { display: grid; min-width: 0; gap: 3px; }
    .required-pages b { color: var(--ink-2); font-size: 15px; }
    .required-pages small { color: var(--muted); font-size: 14px; line-height: 1.4; }
    .extra-pages {
      margin-top: 12px; border: 1px solid var(--line); border-radius: 12px;
      background: var(--surface-2);
    }
    .extra-pages summary {
      min-height: 48px; padding: 14px; color: var(--ink-2); cursor: pointer;
      font-size: 14px; font-weight: 700;
    }
    .extra-pages summary span { color: var(--muted); font-size: 14px; font-weight: 500; }
    .page-toggles { display: grid; gap: 8px; padding: 0 12px 12px; }
    .page-toggles > span {
      margin: 4px 0 2px; color: var(--muted); font-size: 13px; font-weight: 750;
      letter-spacing: .07em; text-transform: uppercase;
    }
    .page-toggles label {
      display: flex; min-height: 64px; align-items: flex-start; gap: 11px; padding: 12px;
      border: 1px solid var(--line); border-radius: 10px; cursor: pointer;
    }
    .page-toggles input {
      width: 22px; height: 22px; flex: none; accent-color: var(--rose);
    }
    .page-toggles label span { display: grid; gap: 3px; }
    .page-toggles b { font-size: 15px; }
    .page-toggles small { color: var(--muted); font-size: 14px; line-height: 1.4; }
    .page-plan ol { display: grid; gap: 0; margin: 0; padding: 8px 16px 14px; list-style: none; }
    .page-plan li {
      display: flex; align-items: center; gap: 11px; min-height: 50px;
      border-bottom: 1px solid var(--line); color: var(--ink-2); font-size: 14px;
    }
    .page-plan li:last-child { border-bottom: 0; }
    .page-plan li span {
      display: grid; width: 28px; height: 28px; flex: none; place-items: center;
      border-radius: 50%; background: var(--surface-2); color: var(--muted); font-size: 12px;
    }
    @media (min-width: 620px) {
      .brochure-fields { grid-template-columns: 1fr 1fr; }
      .brochure-fields .field:last-child { grid-column: 1 / -1; }
    }
  `,
})
export class CatalogBrochureSettings {
  readonly includePhotos = input(true);
  readonly selectedFamilyCount = input(0);
  readonly disabled = input(false);
  readonly settings = input.required<CatalogBrochureDraft>();
  readonly settingsChange = output<CatalogBrochureDraft>();

  readonly pagePlan = computed(() => {
    const settings = this.settings();
    const plan = ['Voorpagina'];
    plan.push('Volledig productoverzicht · maximaal 2 pagina’s');
    if (settings.includeCategoryIntros) plan.push('Optionele categorie-intro’s');
    const families = this.selectedFamilyCount();
    plan.push(`Productdetails · ${families} groep${families === 1 ? '' : 'en'}`);
    if (settings.includeCustomisation) plan.push('Optionele maatwerkpagina');
    plan.push('Bestellen & offerte');
    if (settings.includeBackCover) plan.push('Optionele achterflap');
    return plan;
  });

  patch(changes: Partial<CatalogBrochureDraft>): void {
    if (this.disabled()) return;
    this.settingsChange.emit({ ...this.settings(), ...changes });
  }
}
