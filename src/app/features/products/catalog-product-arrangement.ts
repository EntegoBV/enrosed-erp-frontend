import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Category, Product, ProductFamily } from '../../core/api/models';
import { catalogueFamilies } from './catalog-studio';

/** Document order is independent of product master data and works without drag gestures. */
@Component({
  selector: 'app-catalog-product-arrangement',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <details class="arrangement">
      <summary>
        <span><b>Volgorde in PDF</b><small>{{ groups().length }} productgroepen · {{ products().length }} varianten</small></span>
        <i aria-hidden="true">+</i>
      </summary>
      <div class="arrangement__body">
        <div class="arrangement__intro">
          <p>Verplaats productgroepen met de pijlen of kies een positie. Deze volgorde geldt voor de handelscatalogus én het compacte overzicht. Kleuren en maten blijven bij hun productgroep.</p>
          <button type="button" class="linklike" [disabled]="disabled() || !canReset()" (click)="resetRequested.emit()">Standaardvolgorde herstellen</button>
        </div>
        <div class="arrangement__save">
          <p role="status" aria-live="polite">{{ saveStatus() }}</p>
          <button type="button" class="btn btn--primary" [disabled]="disabled() || !canSave()"
                  (click)="saveRequested.emit()">{{ saving() ? 'Opslaan…' : 'Volgorde opslaan' }}</button>
        </div>
        @if (saveError()) {
          <div class="arrangement__error" role="alert">
            <p>{{ saveError() }}</p>
            @if (canReload()) {
              <button type="button" class="linklike" [disabled]="disabled()"
                      (click)="reloadRequested.emit()">Opgeslagen volgorde laden</button>
            }
          </div>
        }
        <ol class="arrangement__list" aria-label="Productgroepen in PDF-volgorde">
          @for (family of groups(); track family.key; let index = $index) {
            <li class="arrangement__family">
              <div class="arrangement__row">
                <div class="arrangement__identity">
                  <b>{{ family.name }}</b>
                  <small>{{ categoryName(family.products[0]) }} · {{ family.products.length }} {{ family.products.length === 1 ? 'variant' : 'varianten' }}</small>
                </div>
                <div class="arrangement__controls">
                  <label class="arrangement__position">
                    <span class="sr-only">Positie van {{ family.name }}</span>
                    <select [ngModel]="index" (ngModelChange)="moveFamily(family.key, $event)" [disabled]="disabled() || groups().length < 2">
                      @for (position of positions(); track position) { <option [ngValue]="position">{{ position + 1 }}</option> }
                    </select>
                  </label>
                  <button type="button" [disabled]="disabled() || index === 0"
                          [attr.aria-label]="family.name + ' omhoog'" title="Omhoog"
                          (click)="moveFamily(family.key, index - 1)">↑</button>
                  <button type="button" [disabled]="disabled() || index === groups().length - 1"
                          [attr.aria-label]="family.name + ' omlaag'" title="Omlaag"
                          (click)="moveFamily(family.key, index + 1)">↓</button>
                </div>
              </div>
              @if (family.products.length > 1) {
                <details class="arrangement__variants">
                  <summary>Kleuren en maten ordenen</summary>
                  <ol [attr.aria-label]="'Variantvolgorde van ' + family.name">
                    @for (product of family.products; track product.id; let variantIndex = $index) {
                      <li>
                        <span class="arrangement__number">{{ variantIndex + 1 }}</span>
                        <div class="arrangement__identity"><b>{{ variantLabel(product) }}</b><small>{{ product.sku || product.name }}</small></div>
                        <div class="arrangement__controls">
                          <button type="button" [disabled]="disabled() || variantIndex === 0"
                                  [attr.aria-label]="variantLabel(product) + ' omhoog binnen ' + family.name" title="Omhoog"
                                  (click)="moveVariant(family.key, product.id, -1)">↑</button>
                          <button type="button" [disabled]="disabled() || variantIndex === family.products.length - 1"
                                  [attr.aria-label]="variantLabel(product) + ' omlaag binnen ' + family.name" title="Omlaag"
                                  (click)="moveVariant(family.key, product.id, 1)">↓</button>
                        </div>
                      </li>
                    }
                  </ol>
                </details>
              } @else if (family.products[0]; as product) {
                <p class="arrangement__single">{{ variantLabel(product) }}@if (product.sku) { · {{ product.sku }} }</p>
              }
            </li>
          } @empty {
            <li class="arrangement__empty">Neem eerst producten op om de volgorde te kiezen.</li>
          }
        </ol>
        <p class="sr-only" aria-live="polite">{{ announcement() }}</p>
      </div>
    </details>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .arrangement { border: 1px solid var(--line); border-radius: 18px; background: var(--surface); overflow: hidden; }
    .arrangement > summary { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 22px; min-height: 72px; cursor: pointer; list-style: none; }
    .arrangement > summary::-webkit-details-marker { display: none; }
    .arrangement > summary > span { display: grid; gap: 5px; }
    .arrangement > summary b { font-size: 15px; }
    .arrangement > summary small, .arrangement__identity small { color: var(--muted); font-size: 12px; line-height: 1.4; }
    .arrangement > summary i { color: var(--muted); font-size: 24px; font-style: normal; }
    .arrangement[open] > summary i { transform: rotate(45deg); }
    .arrangement__body { padding: 0 18px 18px; }
    .arrangement__intro p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.65; }
    .arrangement__intro > button { min-height: 44px; margin-bottom: 8px; font-size: 12px; }
    .arrangement__save { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 14px; margin-bottom: 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2); }
    .arrangement__save p { flex: 1 1 220px; margin: 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
    .arrangement__save .btn { min-height: 44px; }
    .arrangement__error { margin-bottom: 14px; color: var(--danger); font-size: 13px; line-height: 1.5; }
    .arrangement__error p { margin: 0; }
    .arrangement__error button { min-height: 44px; }
    .arrangement__list, .arrangement__variants ol { list-style: none; margin: 0; padding: 0; }
    .arrangement__list { display: grid; gap: 8px; }
    .arrangement__family { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
    .arrangement__row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; }
    .arrangement__identity { display: grid; flex: 1; min-width: 0; gap: 4px; overflow-wrap: anywhere; }
    .arrangement__identity b { font-size: 13px; line-height: 1.5; }
    .arrangement__controls { display: flex; flex: none; align-items: center; gap: 5px; }
    .arrangement__controls button, .arrangement__position select { width: 44px; height: 44px; padding: 0; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--surface); color: var(--ink); font: inherit; font-size: 18px; text-align: center; cursor: pointer; }
    .arrangement__position select { width: 60px; padding: 0 7px; font-size: 16px; }
    .arrangement__controls button:disabled, .arrangement__position select:disabled { opacity: .35; cursor: default; }
    .arrangement__controls button:focus-visible, .arrangement__position select:focus-visible { outline: 2px solid var(--rose); outline-offset: 2px; }
    .arrangement__variants { border-top: 1px solid var(--line); background: var(--surface-2); }
    .arrangement__variants > summary { padding: 12px; min-height: 44px; color: var(--rose-dark); font-size: 12px; cursor: pointer; }
    .arrangement__variants li { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--line); }
    .arrangement__number { min-width: 16px; color: var(--muted); font-size: 11px; }
    .arrangement__single { margin: 0; padding: 0 12px 12px; color: var(--muted); font-size: 11px; }
    .arrangement__empty { padding: 12px 0; color: var(--muted); font-size: 12px; }
    @media (max-width: 520px) {
      .arrangement > summary { padding-inline: 16px; }
      .arrangement__body { padding-inline: 12px; }
      .arrangement__row { flex-wrap: wrap; }
      .arrangement__row > .arrangement__identity { flex-basis: 100%; }
      .arrangement__row > .arrangement__controls { margin-left: auto; }
    }
  `,
})
export class CatalogProductArrangement {
  readonly products = input<readonly Product[]>([]);
  readonly families = input<readonly ProductFamily[]>([]);
  readonly categories = input<readonly Category[]>([]);
  readonly disabled = input(false);
  readonly canReset = input(false);
  readonly canSave = input(false);
  readonly saving = input(false);
  readonly saveStatus = input('');
  readonly saveError = input<string | null>(null);
  readonly canReload = input(false);
  readonly orderChange = output<number[]>();
  readonly resetRequested = output<void>();
  readonly saveRequested = output<void>();
  readonly reloadRequested = output<void>();
  readonly announcement = signal('');
  readonly groups = computed(() => catalogueFamilies(this.products(), this.families()));
  readonly positions = computed(() => this.groups().map((_, index) => index));

  categoryName(product: Product): string {
    return this.categories().find(category => category.id === product.categoryId)?.name ?? 'Zonder categorie';
  }

  variantLabel(product: Product): string {
    return [product.colour, product.variantSize].filter(Boolean).join(' · ') || product.name;
  }

  moveFamily(key: string, position: number): void {
    if (this.disabled() || !Number.isInteger(position)) return;
    const groups = [...this.groups()];
    const from = groups.findIndex(group => group.key === key);
    if (from < 0 || position < 0 || position >= groups.length || from === position) return;
    const [family] = groups.splice(from, 1);
    groups.splice(position, 0, family);
    this.orderChange.emit(groups.flatMap(group => group.products.map(product => product.id!)));
    this.announcement.set(`${family.name} staat op positie ${position + 1}.`);
  }

  moveVariant(key: string, productId: number | null, direction: -1 | 1): void {
    if (this.disabled() || productId === null) return;
    const groups = this.groups();
    const family = groups.find(group => group.key === key);
    if (!family) return;
    const products = [...family.products];
    const from = products.findIndex(product => product.id === productId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= products.length) return;
    const [product] = products.splice(from, 1);
    products.splice(to, 0, product);
    this.orderChange.emit(groups.flatMap(group =>
      (group.key === key ? products : group.products).map(row => row.id!)));
    this.announcement.set(`${this.variantLabel(product)} staat op positie ${to + 1} binnen ${family.name}.`);
  }
}
