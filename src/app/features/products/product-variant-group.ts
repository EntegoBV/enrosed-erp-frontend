import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { AuthImage } from '../../core/api/auth-image';
import { messageOf } from '../../core/api/errors';
import { Category, Product, ProductFamily } from '../../core/api/models';
import { Sheet, Ui } from '../../shared/ui';

/**
 * Daily product-to-product variant workflow. ProductFamily remains the
 * canonical shared record behind the scenes, but users only select a product.
 */
@Component({
  selector: 'app-product-variant-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, DecimalPipe, FormsModule, RouterLink, Sheet],
  template: `
    <section class="variant-group" aria-labelledby="variant-group-title">
      <div class="variant-group__head">
        <div>
          <span class="variant-group__eyebrow">Varianten</span>
          <h2 id="variant-group-title">Gekoppelde producten</h2>
          <p>
            @if (family(); as group) {
              {{ activeMembers().length }} product{{ activeMembers().length === 1 ? '' : 'en' }}
              · ieder met eigen voorraad, prijs en verpakking
            } @else {
              Nog geen andere kleur- of maatvariant gekoppeld.
            }
          </p>
          @if (family(); as group) {
            <!-- The series name, as it heads the row in the catalogue list.
                 Set once at linking time, so it needs a quiet way to be
                 corrected: tap, type, done. -->
            @if (editingName()) {
              <input #nameField class="input input--sm series-name__input" type="text"
                     aria-label="Naam van de reeks" [ngModel]="nameDraft()"
                     (ngModelChange)="nameDraft.set($event)"
                     (keydown.enter)="commitName()" (keydown.escape)="cancelName()"
                     (blur)="commitName()" />
            } @else {
              <button class="series-name" type="button" [disabled]="disabled()"
                      title="Naam van de reeks aanpassen" (click)="startName(group)">
                <span>Reeks: <b>{{ group.name || group.familyKey }}</b></span>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 20h4l10-10-4-4L4 16v4z" /><path d="m13 7 4 4" />
                </svg>
              </button>
            }
          }
        </div>
        <button class="btn btn--sm" type="button" [disabled]="!canStart() || disabled()"
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
          <!-- A sibling chip opens a small peek, not another page: you
               can look at the red one without saving and leaving this
               product first. -->
          @for (member of activeMembers(); track member.productId) {
            <button class="variant-chip" type="button"
                    [class.variant-chip--current]="member.productId === product().id"
                    [class.variant-chip--peek]="peekId() === member.productId"
                    [attr.aria-current]="member.productId === product().id ? 'page' : null"
                    [attr.aria-expanded]="peekId() === member.productId"
                    (click)="togglePeek(member.productId)">
              @if (member.colourHex) {
                <span class="variant-chip__swatch" [style.background]="member.colourHex"
                      aria-hidden="true"></span>
              }
              <span>
                <b>{{ optionLabel(member.colour, member.size) }}</b>
                <small>{{ member.sku || member.name }}</small>
              </span>
            </button>
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

      @if (peekId(); as id) {
        <div class="variant-peek" role="region" aria-label="Variant in het kort">
          @if (peek().get(id); as sibling) {
            @if (sibling.photos[0]; as photo) {
              <img class="variant-peek__photo" [appAuthSrc]="photo.url" alt="" />
            } @else {
              <div class="variant-peek__photo variant-peek__photo--empty">◈</div>
            }
            <div class="variant-peek__body">
              <b>{{ sibling.name }}</b>
              <small>{{ sibling.sku }} · {{ optionLabel(sibling.colour, sibling.variantSize) }}
                @if (sibling.carton.piecesPerCarton) { · {{ sibling.carton.piecesPerCarton }}/doos }
              </small>
              <small>Voorraad {{ sibling.stockQuantity }}
                @if (sibling.fixedSalesPriceEur) { · € {{ sibling.fixedSalesPriceEur | number: '1.2-2' }} }
                @if (!sibling.active) { · <span class="warn-text">inactief</span> }
              </small>
            </div>
            <a class="btn btn--sm" [routerLink]="['/products', sibling.id]">Openen</a>
          } @else {
            <span class="small muted">Laden…</span>
          }
        </div>
      }
    </section>

    @if (pickerOpen()) {
      <app-sheet title="Product koppelen" [wide]="true" (closed)="closePicker()">
        <div body>
          <p class="picker-intro">
            Kies hetzelfde product in een andere kleur of maat. Voorraad, inkoop,
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
                        [disabled]="!!reason || linking() || disabled()"
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
                      <small>Al gekoppeld aan: {{ group.name }}</small>
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
                  [disabled]="!selected() || linking() || disabled()" (click)="linkSelected()">
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
    .series-name {
      display: inline-flex; align-items: center; gap: 5px; margin-top: 6px; padding: 2px 0;
      border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 12px;
      cursor: pointer; text-align: left;
    }
    .series-name b { color: var(--ink-2); font-weight: 650; }
    .series-name svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.7;
      stroke-linecap: round; stroke-linejoin: round; opacity: .6; }
    .series-name:hover b { text-decoration: underline dotted; }
    .series-name:hover svg { opacity: 1; }
    .series-name:disabled { cursor: default; }
    .series-name__input { margin-top: 6px; max-width: 320px; font-size: 13px; }
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
    .variant-chip--peek { border-color: var(--accent); }
    .variant-peek {
      display: flex; align-items: center; gap: 12px;
      margin-top: 10px; padding: 10px 12px;
      border: 1px solid var(--line); border-radius: 12px; background: var(--surface);
      animation: rise 0.2s ease;
    }
    .variant-peek__photo { width: 56px; height: 56px; border-radius: 10px; object-fit: cover; flex: none;
      background: var(--surface-2); border: 1px solid var(--line); }
    .variant-peek__photo--empty { display: flex; align-items: center; justify-content: center; color: var(--muted); }
    .variant-peek__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .variant-peek__body small { font-size: 12px; color: var(--muted); }
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
  readonly disabled = input(false);
  readonly linked = output<ProductFamily>();
  /** The series itself changed (its name); the editor saves it with the product. */
  readonly familyChange = output<ProductFamily>();

  private readonly nameField = viewChild<ElementRef<HTMLInputElement>>('nameField');
  readonly editingName = signal(false);
  readonly nameDraft = signal('');

  startName(group: ProductFamily): void {
    this.nameDraft.set(group.name ?? '');
    this.editingName.set(true);
    setTimeout(() => this.nameField()?.nativeElement.select());
  }

  commitName(): void {
    if (!this.editingName()) return;
    this.editingName.set(false);
    const group = this.family();
    const name = this.nameDraft().trim();
    if (!group || !name || name === group.name) return;
    this.familyChange.emit({ ...group, name });
  }

  cancelName(): void {
    this.editingName.set(false);
  }

  /** Sibling shown in the peek card; null is closed. */
  readonly peekId = signal<number | null>(null);
  readonly peek = signal(new Map<number, Product>());

  togglePeek(productId: number): void {
    if (productId === this.product().id) return;
    if (this.peekId() === productId) { this.peekId.set(null); return; }
    this.peekId.set(productId);
    if (!this.peek().has(productId)) {
      void this.catalog.product(productId).then((sibling) => {
        this.peek.update((map) => new Map(map).set(productId, sibling));
      });
    }
  }
  /**
   * Deferred mode for a product that has no id yet: the chosen sibling is
   * handed to the editor, which links it the moment the product exists.
   * The link itself is a server transaction needing both ids.
   */
  readonly deferred = input(false);
  readonly pending = output<Product>();

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
  readonly canStart = computed(() =>
    (this.product().id !== null || this.deferred()) && this.hasOption(this.product())
      && !this.linking() && !this.disabled(),
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
    if (!this.canStart() || this.disabled()) return;
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
        && candidate.familyId !== currentFamilyId) return 'Hoort al bij een andere variantgroep.';
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
        return 'Deze kleur en maat bestaan al bij de gekoppelde producten.';
      }
    }
    return null;
  }

  async linkSelected(): Promise<void> {
    const currentId = this.product().id;
    const candidate = this.selected();
    if (this.disabled() || candidate?.id === null || candidate?.id === undefined
        || this.candidateReason(candidate)) return;
    if (currentId === null) {
      /* No id yet: park the choice with the editor; it links after create. */
      this.pending.emit(candidate);
      this.ui.toast(`Wordt aan ${candidate.name} gekoppeld zodra het product is aangemaakt`);
      this.pickerOpen.set(false);
      this.selected.set(null);
      return;
    }
    this.linking.set(true);
    try {
      const family = await this.catalog.linkProductVariant(currentId, candidate.id);
      this.families.update((items) => [family, ...items.filter((item) => item.id !== family.id)]);
      this.linked.emit(family);
      this.ui.toast(`${candidate.name} is als variant gekoppeld`, 'ok');
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
