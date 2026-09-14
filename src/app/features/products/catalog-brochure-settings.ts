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
    <section class="brochure-finish" aria-labelledby="brochure-layout-title">
      <details>
        <summary>
          <span class="finish-mark" aria-hidden="true">04</span>
          <span class="finish-title"><b id="brochure-layout-title">De finishing touch.</b><small>Cover, fotografie en extra pagina’s</small></span>
          <span class="finish-plus" aria-hidden="true">+</span>
        </summary>
        <div class="finish-body">
          <div class="brochure-fields">
            <label class="field"><span>Titel op de cover <small>optioneel</small></span>
              <input class="input" [ngModel]="settings().coverTitle" [disabled]="disabled()"
                     (ngModelChange)="patch({ coverTitle: $event })" placeholder="Standaardtitel in de gekozen taal" />
            </label>
            <label class="field"><span>Ondertitel <small>optioneel</small></span>
              <input class="input" [ngModel]="settings().coverSubtitle" [disabled]="disabled()"
                     (ngModelChange)="patch({ coverSubtitle: $event })" placeholder="Standaardondertitel in de gekozen taal" />
            </label>
          </div>
          <p class="cover-help">Eigen coverteksten worden letterlijk gebruikt. Schrijf ze in de documenttaal.</p>
          <div class="photo-choice">
            <span><b>Hoofdfoto’s per productgroep</b><small>Kleurfoto’s van geselecteerde varianten worden daarnaast getoond.</small></span>
            <div class="photo-choice__segments" role="group" aria-label="Maximum hoofdfoto’s per productgroep">
              @for (count of photoCounts; track count) {
                <button type="button" [class.active]="settings().photosPerProduct === count"
                        [attr.aria-pressed]="settings().photosPerProduct === count"
                        [disabled]="disabled() || !includePhotos()"
                        (click)="patch({ photosPerProduct: count })">{{ count }}</button>
              }
            </div>
          </div>
          <div class="page-toggles" aria-label="Extra pagina’s">
            <label><span><b>Categorie-intro’s</b><small>Een eigen opener voor iedere collectie</small></span>
              <input type="checkbox" [ngModel]="settings().includeCategoryIntros" [disabled]="disabled()"
                     (ngModelChange)="patch({ includeCategoryIntros: $event })" />
            </label>
            <label><span><b>Private label &amp; maatwerk</b><small>Laat uw personalisatiemogelijkheden zien</small></span>
              <input type="checkbox" [ngModel]="settings().includeCustomisation" [disabled]="disabled()"
                     (ngModelChange)="patch({ includeCustomisation: $event })" />
            </label>
            <label><span><b>Achterflap</b><small>Bedrijfsgegevens als afsluiting</small></span>
              <input type="checkbox" [ngModel]="settings().includeBackCover" [disabled]="disabled()"
                     (ngModelChange)="patch({ includeBackCover: $event })" />
            </label>
          </div>
        </div>
      </details>
      <div class="page-plan" aria-label="Opbouw van uw PDF">
        <div class="page-plan__label">UW CATALOGUS, VAN VOOR TOT ACHTER</div>
        <ol>
          @for (page of pagePlan(); track page) { <li><span aria-hidden="true">{{ $index + 1 }}</span>{{ page }}</li> }
        </ol>
        <p>Het aantal pagina’s volgt uit uw selectie, foto’s en teksten.</p>
      </div>
    </section>
  `,
  styles: `
    :host { display: block; min-width: 0; container: brochure-settings / inline-size; }
    .brochure-finish { overflow: hidden; border: 1px solid var(--line); border-radius: 22px; background: var(--surface); }
    summary { display: flex; min-height: 86px; align-items: center; gap: 12px; padding: 20px 22px; list-style: none; cursor: pointer; }
    summary::-webkit-details-marker { display: none; }
    .finish-mark { display: grid; width: 32px; height: 32px; flex: none; place-items: center; border-radius: 11px; background: var(--rose-soft); color: var(--rose-dark); font-size: 11px; font-weight: 800; }
    .finish-title { display: grid; flex: 1; min-width: 0; gap: 4px; }
    .finish-title b { font-size: 18px; font-weight: 720; letter-spacing: -.04em; }
    .finish-title small { color: var(--muted); font-size: 12px; line-height: 1.45; }
    .finish-plus { color: var(--muted); font-size: 24px; font-weight: 400; transition: transform .2s; }
    details[open] .finish-plus { transform: rotate(45deg); }
    .finish-body { padding: 0 22px 18px; }
    .brochure-fields { display: grid; gap: 12px; }
    .field { margin: 0; }
    .field > span { color: var(--ink-2); font-size: 12px; font-weight: 700; }
    .field small { color: var(--muted); font-weight: 400; }
    .field .input { min-height: 48px; font-size: 16px; border-radius: 12px; }
    .cover-help { margin: 10px 0 18px; color: var(--muted); font-size: 11px; line-height: 1.5; }
    .photo-choice { display: grid; gap: 12px; padding: 16px 0; border-block: 1px solid var(--line); }
    .photo-choice > span, .page-toggles label > span { display: grid; min-width: 0; gap: 3px; }
    .photo-choice b, .page-toggles b { font-size: 14px; }
    .photo-choice small, .page-toggles small { color: var(--muted); font-size: 12px; line-height: 1.4; }
    .photo-choice__segments { display: flex; padding: 4px; gap: 4px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--line); }
    .photo-choice__segments button { flex: 1; min-height: 40px; border: 0; border-radius: 9px; background: transparent; color: var(--muted); font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }
    .photo-choice__segments button.active { background: var(--surface); box-shadow: 0 2px 5px #0001; color: var(--rose-dark); }
    .photo-choice__segments button:disabled { opacity: .5; cursor: default; }
    .page-toggles { display: grid; }
    .page-toggles label { display: flex; min-height: 72px; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--line); cursor: pointer; }
    .page-toggles label:last-child { border: 0; }
    .page-toggles input { width: 23px; height: 23px; flex: none; accent-color: var(--rose); }
    .page-plan { border-top: 1px solid var(--line); padding: 18px 22px; background: color-mix(in srgb, var(--surface-2) 70%, var(--surface)); }
    .page-plan__label { color: var(--muted); font-size: 9px; font-weight: 800; letter-spacing: .12em; }
    .page-plan ol { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; list-style: none; margin: 12px 0 0; padding: 0; }
    .page-plan li { display: flex; align-items: center; gap: 6px; color: var(--ink-2); font-size: 11px; }
    .page-plan li span { display: grid; width: 19px; height: 24px; flex: none; place-items: center; border: 1px solid var(--line-strong); border-radius: 2px; background: var(--surface); color: var(--muted); font-size: 8px; }
    .page-plan p { margin: 12px 0 0; color: var(--muted); font-size: 11px; line-height: 1.4; }
    @container brochure-settings (min-width: 600px) { .brochure-fields { grid-template-columns: 1fr 1fr; } .photo-choice { grid-template-columns: 1fr 160px; align-items: center; } }
    @media (max-width: 679px) { summary { padding: 18px; } .finish-body { padding-inline: 18px; } .page-plan { padding: 16px 18px; } }
    @media (prefers-reduced-motion: reduce) { .finish-plus { transition: none; } }
  `,
})
export class CatalogBrochureSettings {
  readonly photoCounts = [1, 2, 3, 4];
  readonly includePhotos = input(true);
  readonly selectedFamilyCount = input(0);
  readonly disabled = input(false);
  readonly settings = input.required<CatalogBrochureDraft>();
  readonly settingsChange = output<CatalogBrochureDraft>();

  readonly pagePlan = computed(() => {
    const settings = this.settings();
    const plan = ['Voorpagina'];
    plan.push('Assortiment');
    if (settings.includeCategoryIntros) plan.push('Collecties');
    const families = this.selectedFamilyCount();
    plan.push(`${families} productgroepen`);
    if (settings.includeCustomisation) plan.push('Maatwerk');
    plan.push('Bestellen & offerte');
    if (settings.includeBackCover) plan.push('Achterflap');
    return plan;
  });

  patch(changes: Partial<CatalogBrochureDraft>): void {
    if (this.disabled()) return;
    this.settingsChange.emit({ ...this.settings(), ...changes });
  }
}
