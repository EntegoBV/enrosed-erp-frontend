import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { AuthImage } from '../../core/api/auth-image';
import { messageOf } from '../../core/api/errors';
import { Category, Product, ProductFamily } from '../../core/api/models';
import { Sheet, Ui } from '../../shared/ui';

/**
 * Daily product-to-product variant workflow. ProductFamily remains the
 * canonical shared model behind the scenes, but users only select a product.
 */
@Component({
  selector: 'app-product-variant-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, FormsModule, RouterLink, Sheet],
  template: `
    <section class="variant-group" aria-labelledby="variant-group-title">
      <div class="variant-group__head">
        <div>
          <span class="variant-group__eyebrow">Model</span>
          <h2 id="variant-group-title">{{ modelName() }}</h2>
          <p>
            @if (family(); as group) {
              {{ activeMembers().length }} product{{ activeMembers().length === 1 ? '' : 'en' }}
              · varianten op kleur of maat
            } @else {
              Dit product staat nog los.
            }
          </p>
        </div>
        <button class="btn btn--sm" type="button" [disabled]="!canStart()"
                (click)="openPicker()">
          Product koppelen
        </button>
      </div>

      @if (!hasOption(product())) {
        <p class="variant-group__notice" role="status">
          Vul eerst een kleur of maat in om dit product als variant te koppelen.
        </p>
      }

      <div class="variant-strip" aria-label="Productvarianten">
        @if (family(); as group) {
          @for (member of activeMembers(); track member.productId) {
            <a class="variant-chip" [class.variant-chip--current]="member.productId === product().id"
               [routerLink]="['/products', member.productId]"
               [attr.aria-current]="member.productId === product().id ? 'page' : null">
              @if (member.colourHex) {
                <span class="variant-chip__swatch" [style.background]="member.colourHex"
                      aria-hidden="true"></span>
              }
              <span>
                <b>{{ optionLabel(member.colour, member.size) }}</b>
                <small>{{ member.sku || member.name }}</small>
              </span>
            </a>
          }
        } @else {
          <span class="variant-chip variant-chip--current">
            @if (product().colourHex) {
              <span class="variant-chip__swatch" [style.background]="product().colourHex"
                    aria-hidden="true"></span>
            }
            <span>
              <b>{{ optionLabel(product().colour, product().variantSize) }}</b>
              <small>{{ product().sku || 'Huidig product' }}</small>
            </span>
          </span>
        }
      </div>
    </section>

    @if (pickerOpen()) {
      <app-sheet title="Product koppelen" [wide]="true" (closed)="closePicker()">
        <div body>
          <p class="picker-intro">
            Kies hetzelfde model in een andere kleur of maat. Voorraad, inkoop,
            verkoop en verpakking blijven per product apart.
          </p>
          <label class="picker-search">
            <span>Zoeken</span>
            <input class="input" type="search" autofocus
                   placeholder="Naam, SKU, kleur of maat…"
                   [ngModel]="query()" (ngModelChange)="query.set($event)" />
          </label>

          @if (loading()) {
            <div class="picker-state" role="status">Producten laden…</div>
          } @else if (loadError()) {
            <div class="picker-state picker-state--error" role="alert">
              <span>{{ loadError() }}</span>
              <button class="btn btn--sm" type="button" (click)="loadCandidates()">
                Opnieuw proberen
              </button>
            </div>
          } @else {
            <div class="candidate-list" aria-label="Producten om te koppelen">
              @for (candidate of filteredCandidates(); track candidate.id) {
                @let reason = candidateReason(candidate);
                <button class="candidate" type="button"
                        [class.candidate--selected]="selected()?.id === candidate.id"
                        [attr.aria-pressed]="selected()?.id === candidate.id"
                        [disabled]="!!reason || linking()"
                        (click)="selected.set(candidate)">
                  @if (candidate.photos[0]; as photo) {
                    <img [appAuthSrc]="photo.url" [alt]="candidate.name" />
                  } @else {
                    <span class="candidate__empty" aria-hidden="true">◇</span>
                  }
                  <span class="candidate__body">
                    <b>{{ candidate.name }}</b>
                    <small>
                      {{ candidate.sku || 'Zonder SKU' }}
                      · {{ optionLabel(candidate.colour, candidate.variantSize) }}
                    </small>
                    @if (candidate.familyId && familyMap().get(candidate.familyId); as group) {
                      <small>Model: {{ group.name }}</small>
                    }
                    @if (reason) {
                      <em>{{ reason }}</em>
                    }
                  </span>
                  <span class="candidate__check" aria-hidden="true">
                    {{ selected()?.id === candidate.id ? '✓' : '›' }}
                  </span>
                </button>
              } @empty {
                <div class="picker-state">Geen passende producten gevonden.</div>
              }
            </div>
            @if (categoryChangeNote(); as note) {
              <p class="category-note" role="note"><b>Categorie:</b> {{ note }}</p>
            }
          }
        </div>
        <div foot style="display:contents">
          <button class="btn" type="button" [disabled]="linking()" (click)="closePicker()">
            Annuleren
          </button>
          <button class="btn btn--primary" type="button"
                  [disabled]="!selected() || linking()" (click)="linkSelected()">
            {{ linking() ? 'Koppelen…' : 'Koppelen' }}
          </button>
        </div>
      </app-sheet>
    }
  `,
  styles: `
    :host { display: block; }
    .variant-group {
      padding: 15px;
      border: 1px solid var(--line);
      border-radius: var(--r);
      background: var(--surface);
    }
    .variant-group__head { display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; }
    .variant-group__eyebrow {
      display: block; margin-bottom: 3px; color: var(--brand); font-size: 10px;
      font-weight: 750; letter-spacing: .08em; text-transform: uppercase;
    }
    h2 { margin: 0; font-size: 17px; line-height: 1.2; }
    .variant-group__head p, .picker-intro { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
    .variant-group__notice {
      margin: 11px 0 0; padding: 8px 10px; border-radius: var(--r-sm);
      background: var(--warn-soft); color: var(--text); font-size: 12px;
    }
    .variant-strip {
      display: flex; gap: 7px; margin-top: 12px; padding-bottom: 2px;
      overflow-x: auto; scrollbar-width: thin;
    }
    .variant-chip {
      display: flex; align-items: center; gap: 8px; min-width: max-content;
      min-height: 44px; padding: 7px 10px; border: 1px solid var(--line);
      border-radius: 12px; color: inherit; background: var(--surface-2); text-decoration: none;
    }
    .variant-chip--current { border-color: var(--brand); box-shadow: 0 0 0 1px color-mix(in srgb, var(--brand) 35%, transparent); }
    .variant-chip__swatch { width: 18px; height: 18px; border: 1px solid rgb(0 0 0 / .14); border-radius: 50%; flex: none; }
    .variant-chip span:last-child { display: grid; gap: 1px; }
    .variant-chip b { font-size: 12px; }
    .variant-chip small { color: var(--muted); font-size: 10px; }
    .picker-intro { margin-bottom: 15px; }
    .picker-search { display: grid; gap: 5px; font-size: 12px; font-weight: 650; }
    .candidate-list { display: grid; margin: 14px -16px 0; }
    .candidate {
      display: grid; grid-template-columns: 48px minmax(0, 1fr) 20px; gap: 11px;
      align-items: center; width: 100%; min-height: 68px; padding: 9px 16px;
      border: 0; border-top: 1px solid var(--line); background: transparent;
      color: inherit; text-align: left; cursor: pointer;
    }
    .candidate:last-child { border-bottom: 1px solid var(--line); }
    .candidate:not(:disabled):hover, .candidate--selected { background: var(--surface-2); }
    .candidate--selected { box-shadow: inset 3px 0 var(--brand); }
    .candidate:disabled { cursor: not-allowed; opacity: .62; }
    .candidate img, .candidate__empty {
      display: grid; place-items: center; width: 48px; height: 48px;
      border-radius: 9px; background: var(--surface-2); object-fit: cover;
    }
    .candidate__body { display: grid; gap: 2px; min-width: 0; }
    .candidate__body b, .candidate__body small, .candidate__body em {
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .candidate__body b { font-size: 13px; }
    .candidate__body small { color: var(--muted); font-size: 11px; }
    .candidate__body em { color: var(--danger); font-size: 10px; font-style: normal; }
    .candidate__check { color: var(--brand); font-weight: 750; text-align: center; }
    .picker-state {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      min-height: 80px; margin-top: 12px; color: var(--muted); font-size: 13px;
    }
    .picker-state--error { color: var(--danger); }
    .category-note {
      margin: 12px 0 0; padding: 9px 10px; border-radius: var(--r-sm);
      background: var(--warn-soft); color: var(--text); font-size: 11px; line-height: 1.4;
    }
    @media (max-width: 520px) {
      .variant-group__head { align-items: stretch; flex-direction: column; }
      .variant-group__head .btn { align-self: flex-start; }
    }
  `,
})
export class ProductVariantGroup {
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);

  readonly product = input.required<Product>();
  readonly family = input<ProductFamily | null>(null);
  readonly linked = output<ProductFamily>();

  readonly pickerOpen = signal(false);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly linking = signal(false);
  readonly query = signal('');
  readonly selected = signal<Product | null>(null);
  readonly products = signal<Product[]>([]);
  readonly families = signal<ProductFamily[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly familyMap = computed(() => new Map(
    this.families().filter((item) => item.id !== null).map((item) => [item.id!, item]),
  ));
  readonly activeMembers = computed(() =>
    [...(this.family()?.members ?? [])]
      .filter((member) => member.active)
      .sort((a, b) => a.position - b.position || a.productId - b.productId),
  );
  readonly modelName = computed(() => this.family()?.name?.trim() || this.product().name);
  readonly canStart = computed(() =>
    this.product().id !== null && this.hasOption(this.product()) && !this.linking(),
  );
  readonly filteredCandidates = computed(() => {
    const needle = this.normalized(this.query());
    return this.products()
      .filter((candidate) => candidate.id !== null && candidate.id !== this.product().id)
      .filter((candidate) => !needle || this.normalized([
        candidate.name, candidate.sku, candidate.colour, candidate.variantSize,
        candidate.familyId ? this.familyMap().get(candidate.familyId)?.name : null,
      ].filter(Boolean).join(' ')).includes(needle))
      .sort((a, b) => {
        const aBlocked = this.candidateReason(a) ? 1 : 0;
        const bBlocked = this.candidateReason(b) ? 1 : 0;
        return aBlocked - bBlocked || a.name.localeCompare(b.name, 'nl');
      });
  });
  readonly categoryChangeNote = computed(() => {
    const current = this.product();
    const candidate = this.selected();
    if (!candidate || current.categoryId === candidate.categoryId) return null;
    if (current.categoryId !== null && candidate.categoryId === null) {
      return `${candidate.name} krijgt ${this.categoryName(current.categoryId)}.`;
    }
    if (current.categoryId === null && candidate.categoryId !== null) {
      return `${current.name} krijgt ${this.categoryName(candidate.categoryId)}.`;
    }
    return null;
  });

  openPicker(): void {
    if (!this.canStart()) return;
    this.query.set('');
    this.selected.set(null);
    this.pickerOpen.set(true);
    if (!this.products().length) void this.loadCandidates();
  }

  closePicker(): void {
    if (this.linking()) return;
    this.pickerOpen.set(false);
    this.selected.set(null);
  }

  async loadCandidates(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [products, families, categories] = await Promise.all([
        this.catalog.products(),
        this.catalog.productFamilies(),
        this.catalog.categories(),
      ]);
      this.products.set(products);
      this.families.set(families);
      this.categories.set(categories);
    } catch (failure) {
      this.loadError.set(messageOf(failure, 'Producten konden niet worden geladen'));
    } finally {
      this.loading.set(false);
    }
  }

  candidateReason(candidate: Product): string | null {
    if (!candidate.active) return 'Dit product is inactief.';
    if (!this.hasOption(candidate)) return 'Vul bij dit product eerst kleur of maat in.';
    const current = this.product();
    const currentFamilyId = current.familyId;
    if (currentFamilyId !== null && candidate.familyId === currentFamilyId) return 'Al gekoppeld.';
    if (currentFamilyId !== null && candidate.familyId !== null
        && candidate.familyId !== currentFamilyId) return 'Hoort al bij een ander model.';
    if (current.categoryId !== null && candidate.categoryId !== null
        && current.categoryId !== candidate.categoryId) return 'Andere categorie.';

    const currentOption = this.optionKey(current.colour, current.variantSize);
    const candidateOption = this.optionKey(candidate.colour, candidate.variantSize);
    if (currentOption === candidateOption) return 'Dezelfde kleur en maat.';

    const targetFamily = currentFamilyId !== null
      ? this.familyMap().get(currentFamilyId) ?? this.family()
      : candidate.familyId !== null ? this.familyMap().get(candidate.familyId) : null;
    if (targetFamily) {
      const incomingOption = currentFamilyId !== null ? candidateOption : currentOption;
      if (targetFamily.members.some((member) => member.active
          && this.optionKey(member.colour, member.size) === incomingOption)) {
        return 'Deze kleur en maat bestaan al in dat model.';
      }
    }
    return null;
  }

  async linkSelected(): Promise<void> {
    const currentId = this.product().id;
    const candidate = this.selected();
    if (currentId === null || candidate?.id === null || candidate?.id === undefined
        || this.candidateReason(candidate)) return;
    this.linking.set(true);
    try {
      const family = await this.catalog.linkProductVariant(currentId, candidate.id);
      this.families.update((items) => [family, ...items.filter((item) => item.id !== family.id)]);
      this.linked.emit(family);
      this.ui.toast(`${candidate.name} is gekoppeld aan ${family.name}`, 'ok');
      this.pickerOpen.set(false);
      this.selected.set(null);
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Product koppelen mislukt'), 'err');
    } finally {
      this.linking.set(false);
    }
  }

  hasOption(product: Pick<Product, 'colour' | 'variantSize'>): boolean {
    return !!product.colour?.trim() || !!product.variantSize?.trim();
  }

  optionLabel(colour: string | null, size: string | null): string {
    return [colour?.trim(), size?.trim()].filter(Boolean).join(' · ') || 'Geen kleur of maat';
  }

  private optionKey(colour: string | null, size: string | null): string {
    return `${this.normalized(colour)}\u0000${this.normalized(size)}`;
  }

  private normalized(value: string | null | undefined): string {
    return (value ?? '').trim().toLocaleLowerCase('nl');
  }

  private categoryName(id: number): string {
    return this.categories().find((item) => item.id === id)?.name ?? `categorie #${id}`;
  }
}
