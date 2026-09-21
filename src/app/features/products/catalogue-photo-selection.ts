import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthImage } from '../../core/api/auth-image';
import { CataloguePhotoOption, CataloguePhotoSelection, ProductFamily } from '../../core/api/models';

export interface CataloguePhotoSelectionChange { familyId: number; selection: CataloguePhotoSelection; }

/** Print choices are independent of website publication and variant colour photos. */
@Component({
  selector: 'app-catalogue-photo-selection',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AuthImage],
  template: `
    <section class="catalogue-photos" aria-label="Foto’s voor de catalogus">
      <div class="catalogue-photos__heading"><b>Foto’s voor de catalogus</b><small>Kies apart voor het assortimentsoverzicht en de grote foto op de productpagina.</small></div>
      <div class="catalogue-photos__choices">
        @for (role of roles; track role.key) {
          <label class="catalogue-photo">
            <span>{{ role.label }}</span>
            <select class="select" [ngModel]="choice(role.key)" (ngModelChange)="setChoice(role.key, $event)" [disabled]="disabled()">
              <option [ngValue]="null">Automatisch kiezen</option>
              @if (choice(role.key) !== null && !option(choice(role.key))) { <option [ngValue]="choice(role.key)" disabled>Eerdere keuze niet meer beschikbaar</option> }
              @for (photo of options(); track photo.id) { <option [ngValue]="photo.id">{{ optionLabel(photo) }}</option> }
            </select>
            @if (option(choice(role.key)); as photo) { <img [appAuthSrc]="photo.smallUrl" [alt]="role.label + ': ' + photo.originalFilename" /> }
            @else { <span class="catalogue-photo__automatic">{{ choice(role.key) === null ? 'De catalogus bepaalt de foto uit de beschikbare selectie.' : 'Kies een beschikbare foto of Automatisch.' }}</span> }
          </label>
        }
      </div>
      <label class="catalogue-photo catalogue-photo--size"><span>Formaat van de grote productfoto</span><select class="select" [ngModel]="detailSize()" (ngModelChange)="detailSize.set($event)" [disabled]="disabled()"><option value="STANDARD">Standaard</option><option value="LARGE">Groot en breed</option></select><small>Groot en breed geeft één hoofdfoto meer breedte. Het volledige product en de kleurfoto’s blijven zichtbaar.</small></label>
      <div class="catalogue-photos__foot"><small>Kleurfoto’s blijven per variant gekozen. Deze keuzes veranderen de websitefoto’s niet.</small><button class="btn btn--sm" type="button" [disabled]="disabled() || !dirty() || unavailableChoice()" (click)="saveRequested.emit(selection())">Fotokeuzes opslaan</button></div>
    </section>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .catalogue-photos { padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2); }
    .catalogue-photos__heading { display: grid; gap: 5px; margin-bottom: 14px; }
    .catalogue-photos__heading b { font-size: 13px; }
    small, .catalogue-photo__automatic { color: var(--muted); font-size: 11px; line-height: 1.5; }
    .catalogue-photos__choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .catalogue-photo { display: grid; gap: 8px; align-content: start; min-width: 0; }
    .catalogue-photo--size { margin-top: 14px; }
    .catalogue-photo > span:first-child { font-size: 12px; font-weight: 650; }
    .catalogue-photo .select { width: 100%; min-width: 0; min-height: 44px; font-size: 12px; }
    .catalogue-photo img { width: 100%; height: 120px; object-fit: contain; background: #fff; border-radius: 8px; }
    .catalogue-photo__automatic { display: grid; place-content: center; min-height: 120px; padding: 12px; border: 1px dashed var(--line); border-radius: 8px; }
    .catalogue-photos__foot { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-top: 14px; }
    .catalogue-photos__foot small { flex: 1 1 180px; }
    .btn { min-height: 44px; }
    @media(max-width: 560px) { .catalogue-photos__choices { grid-template-columns: 1fr; } .catalogue-photo .select { font-size: 16px; } }
  `,
})
export class CataloguePhotoSelectionEditor {
  readonly family = input.required<ProductFamily>();
  readonly disabled = input(false);
  readonly saveRequested = output<CataloguePhotoSelection>();
  readonly overview = signal<number | null>(null);
  readonly detail = signal<number | null>(null);
  readonly detailSize = signal<'STANDARD' | 'LARGE'>('STANDARD');
  readonly roles = [{ key: 'overview', label: 'Assortimentsoverzicht' }, { key: 'detail', label: 'Grote foto op productpagina' }] as const;
  readonly options = computed(() => this.family().cataloguePhotoOptions ?? []);
  readonly selection = computed<CataloguePhotoSelection>(() => ({ catalogueOverviewPhotoId: this.overview(), catalogueDetailPhotoId: this.detail(), catalogueDetailSize: this.detailSize() }));
  readonly dirty = computed(() => this.overview() !== (this.family().catalogueOverviewPhotoId ?? null)
    || this.detail() !== (this.family().catalogueDetailPhotoId ?? null)
    || this.detailSize() !== (this.family().catalogueDetailSize ?? 'STANDARD'));
  readonly unavailableChoice = computed(() => [this.overview(), this.detail()].some(id => id !== null && !this.option(id)));

  constructor() {
    effect(() => { const family = this.family(); this.overview.set(family.catalogueOverviewPhotoId ?? null); this.detail.set(family.catalogueDetailPhotoId ?? null); this.detailSize.set(family.catalogueDetailSize ?? 'STANDARD'); });
  }

  choice(role: 'overview' | 'detail'): number | null { return role === 'overview' ? this.overview() : this.detail(); }
  setChoice(role: 'overview' | 'detail', id: number | null): void { (role === 'overview' ? this.overview : this.detail).set(id); }
  option(id: number | null): CataloguePhotoOption | undefined { return this.options().find(photo => photo.id === id); }
  optionLabel(photo: CataloguePhotoOption): string {
    const member = this.family().members?.find(row => row.productId === photo.productId);
    const scope = member?.colour || member?.sku || (photo.source === 'FAMILY' ? 'Reeks' : 'Variant');
    return `${scope} · ${photo.originalFilename}`;
  }
}
