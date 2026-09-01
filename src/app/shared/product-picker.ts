import { ChangeDetectionStrategy, Component, OnDestroy, computed, input, output, signal } from '@angular/core';
import { CartonQuantity } from './carton-quantity';
import { FormsModule } from '@angular/forms';
import { AuthImage } from '../core/api/auth-image';
import { Category, Currency, Product, ProductFamily } from '../core/api/models';
import { Sheet } from './ui';
import { CurPipe, NumPipe } from './pipes';
import { orderPickerBatch, orderPickerProducts } from './product-picker-order';
import { cartonQuantityNotice } from './carton-quantity-notice';
import { COLOUR_SWATCHES, STANDARD_COLOURS } from '../core/api/geo';
import {
  ProductPickerCategoryKey,
  filterProductPicker,
  productPickerCategories,
  productPickerCategoryName,
  productPickerColours,
} from './product-picker-filters';
import {
  ProductPickerFamilyGroup,
  productPickerGroupOpen,
  productPickerFamilySelectionState,
  productPickerFamilySections,
  productPickerGroupSummary,
  productPickerVariantLabel,
  toggleProductPickerFamilySelection,
} from './product-picker-family-groups';

/**
 * Picking a product with a search field instead of a dropdown.
 *
 * A dropdown of dozens of articles is unworkable on a phone: you scroll a
 * list you cannot search and the names get clipped. Here you type a few
 * letters, a SKU or a barcode and see the photo, the carton content and
 * the stock right away.
 *
 * The quantity is entered in pieces and rounded up to a full carton at
 * once, with the correction visible under the field — no surprise
 * afterwards.
 */
/** Everything the quick-create form measures; the parent builds the product. */
export interface ProductDraft {
  name: string;
  lengthCm: number | null; widthCm: number | null; heightCm: number | null;
  cartonLengthCm: number | null; cartonWidthCm: number | null; cartonHeightCm: number | null;
  piecesPerCarton: number;
  weightKg: number | null;
  exwPrice: number;
  exwCurrency: string;
}

type ProductPickerFamilyLanes = readonly [
  readonly ProductPickerFamilyGroup[],
  readonly ProductPickerFamilyGroup[],
];

/** Two independent, contiguous columns; mobile naturally keeps source order. */
function productPickerFamilyLanes(groups: readonly ProductPickerFamilyGroup[]): ProductPickerFamilyLanes {
  const splitAt = Math.ceil(groups.length / 2);
  return [groups.slice(0, splitAt), groups.slice(splitAt)];
}

@Component({
  selector: 'app-product-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AuthImage, Sheet, CurPipe, NumPipe],
  template: `
    <app-sheet [title]="heading()" [wide]="groupByFamily()" (closed)="cancelled.emit()">
      <div body>
        @if (!createMode()) {
        <div class="search-bar">
          <input
            class="input"
            type="search"
            inputmode="search"
            placeholder="Zoek op naam, kleur, maat, SKU of barcode…"
            [ngModel]="query()"
            (ngModelChange)="searchAgain($event)"
          />
        </div>
        @if (!chosen() && !quantityStep()) {
          <div class="picker-filters" aria-label="Producten filteren">
            <div class="picker-filter">
              <span class="picker-filter__label">Categorie</span>
              <div class="picker-chips" role="group" aria-label="Filter op categorie">
                <button class="picker-chip" type="button"
                        [class.picker-chip--active]="categoryFilter() === null"
                        [attr.aria-pressed]="categoryFilter() === null"
                        (click)="setCategoryFilter(null)">
                  Alle <small>{{ products().length }}</small>
                </button>
                @for (category of categoryOptions(); track category.key) {
                  <button class="picker-chip" type="button"
                          [class.picker-chip--active]="categoryFilter() === category.key"
                          [attr.aria-pressed]="categoryFilter() === category.key"
                          (click)="setCategoryFilter(category.key)">
                    {{ category.name }} <small>{{ category.count }}</small>
                  </button>
                }
              </div>
            </div>

            @if (!groupByFamily()) {
            <div class="picker-filter">
              <span class="picker-filter__label">Kleur</span>
              <div class="picker-chips" role="group" aria-label="Filter op kleur">
                <button class="picker-chip" type="button"
                        [class.picker-chip--active]="colourFilter() === null"
                        [attr.aria-pressed]="colourFilter() === null"
                        (click)="colourFilter.set(null)">
                  Alle kleuren
                </button>
                @for (colour of colourOptions(); track colour.key) {
                  <button class="picker-chip picker-chip--colour" type="button"
                          [class.picker-chip--active]="colourFilter() === colour.key"
                          [attr.aria-pressed]="colourFilter() === colour.key"
                          (click)="colourFilter.set(colour.key)">
                    <i class="picker-colour-dot" [class.picker-colour-dot--empty]="!colour.hex"
                       [style.background]="colour.hex || 'var(--surface-2)'" aria-hidden="true"></i>
                    {{ colour.name }} <small>{{ colour.count }}</small>
                  </button>
                }
              </div>
            </div>
            }
          </div>
        }
        }

        @if (createMode()) {
          <!-- Measure the article in your hand and go: everything the
               calculation needs, nothing it does not. Optional fields can
               stay empty and be completed later on the product. -->
          <div class="field">
            <label class="req" for="qc-name">Naam</label>
            <input class="input" id="qc-name" [ngModel]="draftName()"
                   (ngModelChange)="draftName.set($event)" />
          </div>
          <div class="field">
            <label for="qc-size">Afmeting product (B × D × H cm) <span class="opt"></span></label>
            <div class="dims-row" id="qc-size">
              <input class="input num right" type="number" min="0" placeholder="B"
                     [ngModel]="draftL()" (ngModelChange)="draftL.set($event)" />
              <input class="input num right" type="number" min="0" placeholder="D"
                     [ngModel]="draftW()" (ngModelChange)="draftW.set($event)" />
              <input class="input num right" type="number" min="0" placeholder="H"
                     [ngModel]="draftH()" (ngModelChange)="draftH.set($event)" />
            </div>
          </div>
          <div class="field">
            <label for="qc-carton">Omdoos (B × D × H cm) <span class="opt"></span></label>
            <div class="dims-row" id="qc-carton">
              <input class="input num right" type="number" min="0" placeholder="B"
                     [ngModel]="draftCL()" (ngModelChange)="draftCL.set($event)" />
              <input class="input num right" type="number" min="0" placeholder="D"
                     [ngModel]="draftCW()" (ngModelChange)="draftCW.set($event)" />
              <input class="input num right" type="number" min="0" placeholder="H"
                     [ngModel]="draftCH()" (ngModelChange)="draftCH.set($event)" />
            </div>
            <span class="hint">De omdoos bepaalt het volume in de container.</span>
          </div>
          <div class="field-row">
            <div class="field">
              <label class="req" for="qc-per">Stuks per doos</label>
              <input class="input num right" id="qc-per" type="number" min="1"
                     [ngModel]="draftPer()" (ngModelChange)="draftPer.set($event)" />
            </div>
            <div class="field">
              <label for="qc-weight">Gewicht/doos kg <span class="opt"></span></label>
              <input class="input num right" id="qc-weight" type="number" min="0" step="0.1"
                     [ngModel]="draftWeight()" (ngModelChange)="draftWeight.set($event)" />
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label class="req" for="qc-exw">EXW-prijs per stuk</label>
              <input class="input num right" id="qc-exw" type="number" min="0" step="0.01"
                     [ngModel]="draftExw()" (ngModelChange)="draftExw.set($event)" />
            </div>
            <div class="field">
              <label for="qc-cur">Munt</label>
              <select class="select" id="qc-cur" [ngModel]="draftCurrency()"
                      (ngModelChange)="draftCurrency.set($event)">
                <option value="USD">USD</option>
                <option value="CNY">CNY</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
          </div>
        } @else if (chosen(); as product) {
          <div class="picker-chosen">
            <div class="row">
              @if (product.photos.length) {
                <img class="thumb" [appAuthSrc]="product.photos[0].url" [alt]="product.name" />
              } @else {
                <div class="thumb thumb--placeholder">◈</div>
              }
              <div class="grow">
                <div class="strong">{{ product.describedAs }}</div>
                <div class="small muted">
                  <span class="row wrap" style="gap:5px">
                    <span>
                      {{ categoryName(product) }} · {{ product.sku }}
                      · {{ product.carton.piecesPerCarton }} per doos
                    </span>
                    @if (stockAware()) {
                      <span>·</span>
                      <span class="stock-dot" [class]="'stock-dot--' + stockLevel(product)"></span>
                      <span>{{ stockLabel(product) }}</span>
                    }
                  </span>
                </div>
              </div>
              <button class="btn btn--sm" type="button" (click)="clear()">Wijzig</button>
            </div>

            <div class="field mt-12">
              <label class="req" for="pick-qty">Aantal stuks</label>
              <input
                class="input num right"
                id="pick-qty"
                type="number"
                min="0"
                step="1"
                inputmode="numeric"
                [ngModel]="carton.value()"
                (ngModelChange)="carton.set(+$event)"
              />
              @if (carton.pending(); as note) {
                @if (enforceCartons()) {
                  <span class="hint warn-text">
                    Wordt zo <b>{{ note.to | num }}</b> — er gaan er
                    {{ product.carton.piecesPerCarton }} in een doos.
                  </span>
                } @else if (cartonNotice(carton.value(), product.carton.piecesPerCarton); as cartonNote) {
                  <span class="hint carton-quantity-note" role="status">{{ cartonNote }}</span>
                }
              } @else if (carton.applied(); as note) {
                <span class="hint warn-text">
                  Bijgesteld van {{ note.from | num }} naar <b>{{ note.to | num }}</b>.
                </span>
              } @else {
                <span class="hint">{{ cartons() | num }} volle doos(en).</span>
              }
            </div>

            <!-- Stock only matters when selling from it; a purchase is
                 what fills it, so there the warnings would be nonsense. -->
            @if (!stockAware()) {
            } @else if (!product.inventoryKnown) {
              <div class="alert alert--warn mt-8">
                <span class="alert__icon">?</span>
                <div>
                  <b>Voorraad nog niet bevestigd.</b>
                  Controleer de levertermijn voordat je deze regel aan de klant toezegt.
                </div>
              </div>
            } @else if (!hasEnoughStock()) {
              <div class="alert alert--warn mt-8">
                <span class="alert__icon">!</span>
                <div>
                  <b>Onvoldoende voorraad.</b>
                  Er ligt {{ product.stockQuantity | num }} van de {{ carton.value() | num }} stuks.
                  Deze regel kan pas mee zodra er een container binnen is — spreek de
                  levertermijn af met de klant.
                </div>
              </div>
            }
          </div>
        } @else if (quantityStep()) {
          <!-- Several products at once: every chosen product gets its
               number here, then the whole batch lands on the order. -->
          @if (groupByFamily()) {
          <div class="picker-grouped picker-grouped--batch">
            @for (section of batchFamilySections(); track section.key) {
              <section class="picker-category" [attr.aria-labelledby]="'picker-batch-' + section.key">
                <header class="picker-category__head">
                  <strong [id]="'picker-batch-' + section.key">{{ section.name }}</strong>
                  <span>{{ section.productCount }} product{{ section.productCount === 1 ? '' : 'en' }}</span>
                </header>
                @for (group of section.groups; track group.key) {
                  <section class="picker-family picker-family--batch">
                    <header class="picker-family__batch-head">
                      <strong>{{ group.name }}</strong>
                      <span>{{ selectedCount(group) }} gekozen</span>
                    </header>
                    @for (product of group.products; track product.id) {
                      @if (batchEntry(product.id); as entry) {
                      <div class="picker-batch__row picker-batch__row--nested">
                        @if (entry.product.photos.length) {
                          <img class="thumb thumb--variant" [appAuthSrc]="entry.product.photos[0].url" [alt]="entry.product.name" />
                        } @else {
                          <div class="thumb thumb--variant thumb--placeholder">◈</div>
                        }
                        <div class="picker-batch__body">
                          <div class="strong picker-variant-name">
                            @if (entry.product.colour) {
                              <i class="picker-colour-dot"
                                 [class.picker-colour-dot--empty]="!variantColourHex(entry.product)"
                                 [style.background]="variantColourHex(entry.product) || 'var(--surface-2)'"
                                 aria-hidden="true"></i>
                            }
                            {{ variantLabel(entry.product) }}
                          </div>
                          <div class="small muted">
                            {{ entry.product.sku }} · {{ entry.product.carton.piecesPerCarton }}/doos
                            @if (entry.quantity > 0 && (entry.product.carton.piecesPerCarton ?? 0) > 0) {
                              · {{ entry.quantity / (entry.product.carton.piecesPerCarton ?? 1) | num: 1 }} doos(en)
                            }
                          </div>
                          @if (cartonNotice(entry.quantity, entry.product.carton.piecesPerCarton); as cartonNote) {
                            <div class="carton-quantity-note" role="status">{{ cartonNote }}</div>
                          }
                        </div>
                        <input class="input num right picker-batch__qty" type="number" min="0" step="1" inputmode="numeric"
                               [attr.aria-label]="'Aantal stuks ' + variantLabel(entry.product) + ' van ' + group.name"
                               [ngModel]="entry.quantity" (ngModelChange)="setBatchQuantity(entry.product.id!, +$event)" />
                        <button class="picker-batch__remove" type="button"
                                [attr.aria-label]="variantLabel(entry.product) + ' van ' + group.name + ' weglaten'"
                                (click)="toggle(entry.product)">×</button>
                      </div>
                      }
                    }
                  </section>
                }
              </section>
            }
          </div>
          } @else {
          <div class="picker-batch">
            @for (entry of batch(); track entry.product.id) {
              <div class="picker-batch__row">
                @if (entry.product.photos.length) {
                  <img class="thumb" [appAuthSrc]="entry.product.photos[0].url" [alt]="entry.product.name" />
                } @else {
                  <div class="thumb thumb--placeholder">◈</div>
                }
                <div class="picker-batch__body">
                  <div class="strong">{{ entry.product.name }}</div>
                  <div class="small muted">
                    {{ categoryName(entry.product) }} · {{ entry.product.sku }}@if (entry.product.colour) { · {{ entry.product.colour }}}
                    · {{ entry.product.carton.piecesPerCarton }}/doos
                    @if (entry.quantity > 0 && (entry.product.carton.piecesPerCarton ?? 0) > 0) {
                      · {{ entry.quantity / (entry.product.carton.piecesPerCarton ?? 1) | num: 1 }} doos(en)
                    }
                  </div>
                  @if (cartonNotice(entry.quantity, entry.product.carton.piecesPerCarton); as cartonNote) {
                    <div class="carton-quantity-note" role="status">{{ cartonNote }}</div>
                  }
                </div>
                <input class="input num right picker-batch__qty" type="number" min="0" step="1" inputmode="numeric"
                       [attr.aria-label]="'Aantal stuks ' + entry.product.name"
                       [ngModel]="entry.quantity" (ngModelChange)="setBatchQuantity(entry.product.id!, +$event)" />
                <button class="picker-batch__remove" type="button" [attr.aria-label]="entry.product.name + ' weglaten'"
                        (click)="toggle(entry.product)">×</button>
              </div>
            }
          </div>
          }
          <span class="hint">Aantal stuks per product; start op één doos. Een halve doos mag bij inkoop.</span>
        } @else {
          @if (groupByFamily()) {
          <div class="picker-grouped">
            @for (section of familySections(); track section.key) {
              <section class="picker-category" [attr.aria-labelledby]="'picker-category-' + section.key">
                <header class="picker-category__head">
                  <strong [id]="'picker-category-' + section.key">{{ section.name }}</strong>
                  <span>{{ section.groups.length }} reeks{{ section.groups.length === 1 ? '' : 'en' }} · {{ section.productCount }} product{{ section.productCount === 1 ? '' : 'en' }}</span>
                </header>
                <div class="picker-family-layout">
                @for (lane of section.lanes; track $index) {
                  @if (lane.length) {
                  <div class="picker-family-lane">
                  @for (group of lane; track group.key) {
                  <section class="picker-family" [class.picker-family--open]="isGroupOpen(group)">
                    <header class="picker-family__head">
                      <button class="picker-family__toggle" type="button"
                              [attr.aria-expanded]="isGroupOpen(group)"
                              [attr.aria-controls]="'picker-family-' + group.key"
                              (click)="toggleGroupOpen(group)">
                        @if (group.photo) {
                          <img class="thumb picker-family__photo" [appAuthSrc]="group.photo" [alt]="group.name" />
                        } @else {
                          <span class="thumb picker-family__photo thumb--placeholder" aria-hidden="true">◈</span>
                        }
                        <span class="picker-family__copy">
                          <strong>{{ group.name }}</strong>
                          <span class="picker-family__summary">
                            {{ groupSummary(group) }}
                            @if (group.colours.length) {
                              <span class="picker-family__dots" aria-hidden="true">
                                @for (colour of group.colours.slice(0, 8); track colour.name) {
                                  <i [class.picker-colour-dot--empty]="!colour.hex"
                                     [style.background]="colour.hex || 'var(--surface-2)'"></i>
                                }
                                @if (group.colours.length > 8) { <small>+{{ group.colours.length - 8 }}</small> }
                              </span>
                            }
                          </span>
                        </span>
                        <svg class="picker-family__chevron" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
                          <path d="m6.5 8 3.5 3.5L13.5 8" fill="none" stroke="currentColor"
                                stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                      </button>
                      @if (mode() === 'multi') {
                        <button class="picker-family__select" type="button"
                                [class.picker-family__select--partial]="groupSelectionState(group) === 'partial'"
                                [class.picker-family__select--all]="groupSelectionState(group) === 'all'"
                                [attr.aria-pressed]="groupSelectionState(group) === 'partial'
                                  ? 'mixed' : groupSelectionState(group) === 'all'"
                                [attr.aria-label]="groupSelectionLabel(group)"
                                (click)="toggleGroupSelection(group)">
                          <span aria-hidden="true">{{ groupSelectionState(group) === 'all' ? '✓' : groupSelectionState(group) === 'partial' ? '−' : '+' }}</span>
                        </button>
                      }
                    </header>
                    @if (isGroupOpen(group)) {
                      <div class="picker-family__variants" [id]="'picker-family-' + group.key"
                           role="group" [attr.aria-label]="'Varianten van ' + group.name">
                        @for (product of group.products; track product.id) {
                          <button class="picker-item picker-item--nested" type="button"
                                  [class.picker-item--selected]="isSelected(product)"
                                  [attr.aria-pressed]="mode() === 'multi' ? isSelected(product) : null"
                                  (click)="mode() === 'multi' ? toggle(product) : choose(product)">
                            @if (mode() === 'multi') {
                              <span class="picker-item__check" aria-hidden="true">{{ isSelected(product) ? '✓' : '' }}</span>
                            }
                            @if (product.photos.length) {
                              <img class="thumb thumb--variant" [appAuthSrc]="product.photos[0].url" [alt]="product.name" />
                            } @else {
                              <span class="thumb thumb--variant thumb--placeholder" aria-hidden="true">◈</span>
                            }
                            <span class="picker-item__body">
                              <span class="picker-item__title picker-variant-name">
                                @if (product.colour) {
                                  <i class="picker-colour-dot"
                                     [class.picker-colour-dot--empty]="!variantColourHex(product)"
                                     [style.background]="variantColourHex(product) || 'var(--surface-2)'"
                                     aria-hidden="true"></i>
                                }
                                {{ variantLabel(product) }}
                              </span>
                              <span class="picker-item__meta">
                                {{ product.sku }} · {{ product.carton.piecesPerCarton }}/doos
                              </span>
                              @if (stockAware()) {
                                <span class="picker-item__meta row" style="gap:5px">
                                  <span class="stock-dot" [class]="'stock-dot--' + stockLevel(product)"></span>
                                  <span>{{ stockLabel(product) }}</span>
                                </span>
                              }
                            </span>
                            <span class="picker-item__end">{{ price(product) | cur: priceCurrency(product) }}</span>
                          </button>
                        }
                      </div>
                    }
                  </section>
                  }
                  </div>
                  }
                }
                </div>
              </section>
            } @empty {
              <div class="empty">
                <div class="empty__title">Niets gevonden</div>
                <div class="empty__text">Probeer een deel van de reeksnaam, kleur, maat, SKU of barcode.</div>
                @if (allowCreate() && query().trim().length >= 2) {
                  <button class="btn btn--primary mt-8" type="button" (click)="startCreate()">
                    + „{{ query().trim() }}” aanmaken en toevoegen
                  </button>
                }
              </div>
            }
          </div>
          } @else {
          <div class="picker-list">
            @for (product of matches(); track product.id) {
              <button class="picker-item" type="button" [class.picker-item--selected]="isSelected(product)"
                      [attr.aria-pressed]="mode() === 'multi' ? isSelected(product) : null"
                      (click)="mode() === 'multi' ? toggle(product) : choose(product)">
                @if (mode() === 'multi') {
                  <span class="picker-item__check" aria-hidden="true">{{ isSelected(product) ? '✓' : '' }}</span>
                }
                @if (product.photos.length) {
                  <img class="thumb" [appAuthSrc]="product.photos[0].url" [alt]="product.name" />
                } @else {
                  <div class="thumb thumb--placeholder">◈</div>
                }
                <div class="picker-item__body">
                  <div class="picker-item__title">{{ product.name }}</div>
                  <div class="picker-item__category">{{ categoryName(product) }}</div>
                  <div class="picker-item__meta">
                    {{ product.sku }}
                    @if (product.colour) { · {{ product.colour }} }
                    @if (product.variantSize) { · {{ product.variantSize }} }
                    · {{ product.carton.piecesPerCarton }}/doos
                  </div>
                  @if (stockAware()) {
                    <div class="picker-item__meta row" style="gap:5px">
                      <span class="stock-dot" [class]="'stock-dot--' + stockLevel(product)"></span>
                      <span>{{ stockLabel(product) }}</span>
                    </div>
                  }
                </div>
                <div class="picker-item__end">{{ price(product) | cur: priceCurrency(product) }}</div>
              </button>
            } @empty {
              <div class="empty">
                <div class="empty__title">Niets gevonden</div>
                <div class="empty__text">Probeer een deel van de naam, kleur, maat, SKU of barcode.</div>
                @if (allowCreate() && query().trim().length >= 2) {
                  <!-- Straight from the gap to a new product: at a fair the
                       article in your hand often is not in the system yet. -->
                  <button class="btn btn--primary mt-8" type="button"
                          (click)="startCreate()">
                    + „{{ query().trim() }}" aanmaken en toevoegen
                  </button>
                }
              </div>
            }
          </div>
          }
          @if (allowCreate()) {
            <!-- Always reachable, not only when the search comes up empty:
                 you should not have to type to discover it. -->
            <button class="btn btn--block btn--quiet mt-8" type="button"
                    (click)="startCreate()">
              + Nieuw product aanmaken
            </button>
          }
        }
      </div>

      <div foot style="display:contents">
        @if (createMode()) {
          <button class="btn picker-footer-button" type="button" (click)="createMode.set(false)">Terug</button>
          <button class="btn btn--primary picker-footer-button" type="button"
                  [disabled]="!draftName().trim() || draftPer() < 1"
                  (click)="submitCreate()">
            <span class="picker-footer-label--wide">Aanmaken en toevoegen</span>
            <span class="picker-footer-label--compact">Aanmaken</span>
          </button>
        } @else if (mode() === 'multi' && quantityStep()) {
          <button class="btn picker-footer-button" type="button" (click)="quantityStep.set(false)">Terug</button>
          <span class="spacer picker-footer-spacer"></span>
          <button class="btn btn--primary picker-footer-button" type="button"
                  [disabled]="!batchReady()" (click)="confirmBatch()">
            <span class="picker-footer-label--wide">
              {{ batch().length }} product{{ batch().length === 1 ? '' : 'en' }} toevoegen
            </span>
            <span class="picker-footer-label--compact">Toevoegen · {{ batch().length }}</span>
          </button>
        } @else if (mode() === 'multi') {
          <button class="btn picker-footer-button" type="button" (click)="cancelled.emit()">Annuleren</button>
          <span class="spacer picker-footer-spacer"></span>
          <button class="btn btn--primary picker-footer-button" type="button"
                  [disabled]="!selected().size" (click)="toQuantities()">
            <span class="picker-footer-label--wide">
              @if (selected().size) { {{ selected().size }} gekozen · aantallen › } @else { Kies producten }
            </span>
            <span class="picker-footer-label--compact">
              @if (selected().size) { Aantallen · {{ selected().size }} › } @else { Kies producten }
            </span>
          </button>
        } @else {
        <button class="btn" type="button" (click)="cancelled.emit()">Annuleren</button>
        <button
          class="btn btn--primary"
          type="button"
          [disabled]="!chosen() || carton.value() <= 0"
          (click)="confirm()"
        >
          Toevoegen
        </button>
        }
      </div>
    </app-sheet>
  `,
  styles: `
    .dims-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
    .picker-filters { display: grid; gap: 10px; margin: 12px 0 14px; }
    .picker-filter { min-width: 0; }
    .picker-filter__label { display: block; margin-bottom: 5px; color: var(--muted); font-size: 10px;
      font-weight: 760; letter-spacing: .08em; text-transform: uppercase; }
    .picker-chips { display: flex; gap: 6px; margin: 0 -16px; padding: 0 16px 3px; overflow-x: auto;
      scrollbar-width: none; scroll-snap-type: x proximity; }
    .picker-chips::-webkit-scrollbar { display: none; }
    .picker-chip { min-height: 34px; flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 7px 10px;
      border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--ink-2);
      font: inherit; font-size: 11.5px; font-weight: 650; white-space: nowrap; cursor: pointer; scroll-snap-align: start; }
    .picker-chip small { color: var(--muted); font-size: 9.5px; font-weight: 700; }
    .picker-chip--active { border-color: var(--rose); background: var(--rose-soft); color: var(--rose-dark); }
    .picker-chip--active small { color: currentColor; opacity: .72; }
    .picker-colour-dot { width: 11px; height: 11px; flex: none; border: 1px solid rgb(0 0 0 / 16%); border-radius: 50%; }
    .picker-colour-dot--empty { background: linear-gradient(135deg, transparent 44%, var(--muted) 46% 54%, transparent 56%)!important; }
    .picker-grouped { display: grid; gap: 14px; margin: 0 -16px; }
    .picker-family-layout { min-width: 0; display: flex; flex-direction: column; }
    .picker-family-lane { display: contents; }
    .picker-category__head { min-height: 34px; padding: 8px 16px; display: flex; align-items: baseline;
      justify-content: space-between; gap: 10px; background: var(--surface-2); border-block: 1px solid var(--line); }
    .picker-category__head strong { font-size: 10px; font-weight: 780; letter-spacing: .07em; text-transform: uppercase; }
    .picker-category__head span { min-width: 0; overflow: hidden; color: var(--muted); font-size: 10px;
      text-overflow: ellipsis; white-space: nowrap; }
    .picker-family { margin: 0 10px 8px; overflow: hidden; border: 1px solid var(--line); border-radius: 15px;
      align-self: stretch; background: var(--surface); box-shadow: 0 2px 9px rgb(0 0 0 / 3%); }
    .picker-family--open { border-color: var(--rose-line); box-shadow: 0 5px 16px rgb(83 48 59 / 8%); }
    .picker-family__head { display: grid; grid-template-columns: minmax(0,1fr) 44px; align-items: stretch; }
    .picker-family__toggle { min-height: 66px; min-width: 0; padding: 8px 6px 8px 9px; display: grid;
      grid-template-columns: 46px minmax(0,1fr) 24px; align-items: center; gap: 9px; border: 0;
      background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .picker-family__toggle:active { background: var(--surface-2); }
    .picker-family__photo { width: 46px; height: 46px; border-radius: 12px; }
    .picker-family__copy { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .picker-family__copy>strong { display: -webkit-box; overflow: hidden; font-size: 14px; font-weight: 680;
      line-height: 1.15; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .picker-family__summary { min-width: 0; display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: 11px; }
    .picker-family__dots { min-width: 0; display: inline-flex; align-items: center; gap: 3px; }
    .picker-family__dots i { width: 9px; height: 9px; flex: none; border: 1px solid rgb(0 0 0 / 14%); border-radius: 50%; }
    .picker-family__dots small { font-size: 9px; }
    .picker-family__chevron { color: var(--muted); transition: transform .16s ease; }
    .picker-family--open .picker-family__chevron { transform: rotate(180deg); }
    .picker-family__select { width: 44px; min-height: 44px; display: grid; place-items: center; border: 0;
      border-left: 1px solid var(--line); background: var(--surface-2); color: var(--rose-dark); font: inherit; cursor: pointer; }
    .picker-family__select span { width: 24px; height: 24px; display: grid; place-items: center; border: 1.5px solid var(--line-strong);
      border-radius: 8px; background: var(--surface); font-size: 15px; font-weight: 800; }
    .picker-family__select--partial span { border-color: var(--rose); background: var(--rose-soft); }
    .picker-family__select--all span { border-color: var(--rose); background: var(--rose); color: #fff; }
    .picker-family__variants { border-top: 1px solid var(--line); background: var(--surface-2); box-shadow: inset 3px 0 var(--line-strong); }
    .picker-item--nested { min-height: 58px; padding-left: 14px!important; background: var(--surface-2); }
    .picker-item--nested:last-child { border-bottom: 0; }
    .thumb--variant { width: 38px; height: 38px; border-radius: 10px; }
    .picker-variant-name { display: flex; align-items: center; gap: 6px; }
    .picker-family__batch-head { min-height: 40px; padding: 8px 11px; display: flex; align-items: center;
      justify-content: space-between; gap: 8px; border-bottom: 1px solid var(--line); }
    .picker-family__batch-head strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .picker-family__batch-head span { color: var(--muted); font-size: 10px; white-space: nowrap; }
    .picker-batch__row--nested { padding: 9px 10px; background: var(--surface-2); }
    .picker-list { display: flex; flex-direction: column; margin: 0 -16px; }
    .picker-item--selected { background: var(--rose-soft); }
    .picker-item__check { flex: 0 0 auto; width: 22px; height: 22px; display: inline-flex; align-items: center;
      justify-content: center; border: 1.5px solid var(--line-strong); border-radius: 6px; background: var(--surface);
      color: var(--rose-dark); font-size: 13px; font-weight: 800; }
    .picker-item--selected .picker-item__check { border-color: var(--rose); background: var(--rose); color: #fff; }
    .picker-batch { display: grid; }
    .picker-batch__row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--line); }
    .picker-batch__body { flex: 1; min-width: 0; }
    .picker-batch__body .strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .picker-batch__body .small { overflow-wrap: anywhere; }
    .carton-quantity-note { display: block; margin-top: 2px; color: var(--muted); font-size: 11px;
      line-height: 1.35; }
    .picker-batch__qty { width: 96px; }
    .picker-batch__remove { width: 28px; height: 28px; border: 0; border-radius: 50%; background: transparent;
      color: var(--muted); font-size: 20px; line-height: 1; cursor: pointer; }
    .picker-batch__remove:hover { background: var(--surface-2); color: var(--ink); }
    .picker-footer-label--compact { display: none; }
    .picker-item {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 10px 16px;
      border: 0;
      border-bottom: 1px solid var(--line);
      background: transparent;
      text-align: left;
      cursor: pointer;
      min-height: 60px;
    }
    .picker-item:active { background: var(--surface-2); }
    .picker-item__body { flex: 1; min-width: 0; }
    .picker-item__title { font-size: 14.5px; font-weight: 620; }
    .picker-item__category { margin: 1px 0; color: var(--rose-dark); font-size: 9.5px; font-weight: 760;
      letter-spacing: .04em; text-transform: uppercase; }
    .picker-item__meta { font-size: 12px; color: var(--muted); }
    .picker-item__end { font-weight: 650; font-variant-numeric: tabular-nums; }
    /* Stock dot: red empty, orange tight, green ample. Colour alone is not
       enough, so a text always sits next to it. */
    .stock-dot {
      width: 8px; height: 8px; border-radius: 50%;
      display: inline-block; flex: none;
    }
    .stock-dot--none { background: var(--danger); }
    .stock-dot--low { background: var(--warn); }
    .stock-dot--ok { background: var(--ok); }
    .stock-dot--unknown { background: var(--muted); }

    .picker-chosen {
      border: 1px solid var(--line-strong);
      border-radius: var(--r-sm);
      padding: 12px;
      background: var(--surface-2);
    }
    @media (max-width: 679px) {
      .picker-category, .picker-family, .picker-family--batch { min-width: 0; }
      .picker-family { margin: 0 10px 7px; border-radius: 13px; }
      .picker-family__toggle { min-height: 62px; padding: 7px 5px 7px 8px;
        grid-template-columns: 42px minmax(0,1fr) 20px; gap: 8px; }
      .picker-family__photo { width: 42px; height: 42px; border-radius: 11px; }
      .picker-family__copy { gap: 3px; }
      .picker-family__copy>strong { font-size: 13.5px; }
      .picker-family__summary { gap: 5px; font-size: 10.5px; }
      .picker-item--nested { min-height: 56px; gap: 9px; padding: 8px 10px 8px 12px!important; }
      .picker-item--nested .picker-item__meta { font-size: 10.5px; }
      .picker-item--nested .picker-item__end { font-size: 12px; }
      .picker-batch__row--nested { display: grid; grid-template-columns: 36px minmax(0,1fr) 64px 44px;
        gap: 6px; padding: 8px 9px; }
      .picker-batch__row--nested .thumb--variant { width: 36px; height: 36px; }
      .picker-batch__qty { width: 64px; min-width: 0; padding-inline: 6px; }
      .picker-batch__remove { width: 44px; height: 44px; }
      .picker-footer-button { min-width: 0; padding-inline: 13px; font-size: 13px; }
      .picker-footer-spacer { display: none; }
      .picker-footer-label--wide { display: none; }
      .picker-footer-label--compact { display: inline; }
    }
    @media (min-width: 680px) {
      .picker-grouped { margin-inline: 0; grid-template-columns: minmax(0, 1fr); align-items: start; }
      .picker-category { min-width: 0; padding: 0 8px 8px; overflow: hidden;
        border: 1px solid var(--line); border-radius: 16px; }
      .picker-category__head { margin-inline: -8px; border-top: 0; }
      .picker-family-layout { gap: 8px; }
      .picker-family { min-width: 0; margin: 0; }
      .picker-grouped--batch { grid-template-columns: 1fr; }
    }
    @media (min-width: 900px) {
      .picker-family-layout { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: start; gap: 8px; }
      .picker-family-lane { min-width: 0; display: flex; flex-direction: column; gap: 8px; }
    }
    @media (pointer: coarse) {
      .picker-chip, .picker-batch__remove { min-width: 44px; min-height: 44px; }
    }
  `,
})
export class ProductPicker implements OnDestroy {
  readonly heading = input('Product toevoegen');
  readonly products = input.required<Product[]>();
  readonly categories = input<readonly Category[]>([]);
  /** Optional family metadata supplies the shared range name and canonical member order. */
  readonly families = input<readonly ProductFamily[]>([]);
  /** Order editors opt in to the shared category -> range -> variant hierarchy. */
  readonly groupByFamily = input(false);
  /** The price to display; the caller decides which one that is. */
  readonly priceOf = input<(product: Product) => number>((product) =>
    product.computedSalesPriceEur);
  /** Sales defaults to EUR; purchasing supplies the product's agreed EXW currency. */
  readonly currencyOf = input<(product: Product) => Currency>(() => 'EUR');
  /**
   * Whether quantities snap to full cartons.
   *
   * Sales orders must (half a carton breaks volume, pallets and freight
   * further down). Purchasing only warns: a supplier can perfectly well ship
   * a three-piece sample, and silently inflating an order to a supplier costs
   * real money.
   */
  readonly enforceCartons = input(true);

  readonly picked = output<{ product: Product; quantity: number }>();
  /** Multi mode: the whole batch at once, each with its quantity. */
  readonly pickedMany = output<{ product: Product; quantity: number }[]>();
  readonly cancelled = output<void>();
  /** 'single': pick one, type its number. 'multi': tick several, then numbers for all. */
  readonly mode = input<'single' | 'multi'>('single');
  /** Whether stock levels and shortfall warnings are shown - selling from stock cares, buying does not. */
  readonly stockAware = input(true);
  /** Purchasing opts in because its source is already in canonical catalogue order. */
  readonly preserveSourceOrder = input(false);

  /* ---- multi mode ---- */
  readonly selected = signal(new Map<number, { product: Product; quantity: number }>());
  readonly quantityStep = signal(false);
  private readonly groupOpenOverrides = signal(new Map<string, boolean>());

  /**
   * Typing in the search always searches, also from the quantity step:
   * the sheet walks back to the list with the picks kept, so one more
   * product is a few letters away instead of a dead field.
   */
  searchAgain(value: string): void {
    this.query.set(value);
    if (this.quantityStep()) this.quantityStep.set(false);
  }
  readonly batch = computed(() => orderPickerBatch(
    [...this.selected().values()], this.products(), this.preserveSourceOrder()));
  readonly batchFamilySections = computed(() => productPickerFamilySections(
    this.batch().map((entry) => entry.product), this.families(), this.categories(), {
      query: '', category: null,
    }));
  readonly batchReady = computed(() => this.batch().length > 0 && this.batch().every((entry) => entry.quantity > 0));

  cartonNotice(quantity: number, piecesPerCarton: number | null | undefined): string | null {
    return cartonQuantityNotice(quantity, piecesPerCarton);
  }

  isSelected(product: Product): boolean {
    return this.selected().has(product.id!);
  }

  toggle(product: Product): void {
    this.selected.update((map) => {
      const next = new Map(map);
      if (next.has(product.id!)) next.delete(product.id!);
      else next.set(product.id!, { product, quantity: product.carton.piecesPerCarton ?? 1 });
      return next;
    });
    if (this.quantityStep() && !this.selected().size) this.quantityStep.set(false);
  }

  groupSelectionState(group: ProductPickerFamilyGroup): 'none' | 'partial' | 'all' {
    return productPickerFamilySelectionState(group, this.selected());
  }

  selectedCount(group: ProductPickerFamilyGroup): number {
    const selected = this.selected();
    return group.products.filter((product) =>
      product.id !== null && selected.has(product.id)).length;
  }

  groupSelectionLabel(group: ProductPickerFamilyGroup): string {
    const state = this.groupSelectionState(group);
    if (state === 'all') return `Alle varianten van ${group.name} deselecteren`;
    if (state === 'partial') return `Overige varianten van ${group.name} selecteren`;
    const available = group.products.filter((product) => product.id !== null).length;
    return `Alle ${available} varianten van ${group.name} selecteren`;
  }

  /** One explicit family action, while preserving every variant's carton default. */
  toggleGroupSelection(group: ProductPickerFamilyGroup): void {
    this.selected.update((current) => toggleProductPickerFamilySelection(group, current));
    if (this.quantityStep() && !this.selected().size) this.quantityStep.set(false);
  }

  isGroupOpen(group: ProductPickerFamilyGroup): boolean {
    return productPickerGroupOpen(this.query(), this.groupOpenOverrides().get(group.key));
  }

  toggleGroupOpen(group: ProductPickerFamilyGroup): void {
    const open = this.isGroupOpen(group);
    this.groupOpenOverrides.update((current) => new Map(current).set(group.key, !open));
  }

  batchEntry(productId: number | null): { product: Product; quantity: number } | null {
    return productId === null ? null : this.selected().get(productId) ?? null;
  }

  toQuantities(): void {
    if (this.selected().size) this.quantityStep.set(true);
  }

  setBatchQuantity(productId: number, quantity: number): void {
    this.selected.update((map) => {
      const entry = map.get(productId);
      if (!entry) return map;
      return new Map(map).set(productId, { ...entry, quantity: Math.max(0, Math.round(quantity || 0)) });
    });
  }

  confirmBatch(): void {
    if (!this.batchReady()) return;
    this.pickedMany.emit(this.batch());
  }
  /** When on, an empty search offers creating the product right there. */
  readonly allowCreate = input(false);
  /** Default currency for a quick-created product (the supplier's). */
  readonly createCurrency = input('USD');
  readonly create = output<ProductDraft>();

  /* Quick-create: measure the article in your hand, fill it in here, and
     it lands on the order without leaving the sheet. */
  readonly createMode = signal(false);
  readonly draftName = signal('');
  readonly draftL = signal<number | null>(null);
  readonly draftW = signal<number | null>(null);
  readonly draftH = signal<number | null>(null);
  readonly draftCL = signal<number | null>(null);
  readonly draftCW = signal<number | null>(null);
  readonly draftCH = signal<number | null>(null);
  readonly draftPer = signal(1);
  readonly draftWeight = signal<number | null>(null);
  readonly draftExw = signal(0);
  readonly draftCurrency = signal('USD');

  startCreate(): void {
    this.draftName.set(this.query().trim());
    this.draftCurrency.set(this.createCurrency());
    this.createMode.set(true);
  }

  submitCreate(): void {
    this.create.emit({
      name: this.draftName().trim(),
      lengthCm: this.draftL(), widthCm: this.draftW(), heightCm: this.draftH(),
      cartonLengthCm: this.draftCL(), cartonWidthCm: this.draftCW(),
      cartonHeightCm: this.draftCH(),
      piecesPerCarton: Math.max(1, Math.round(this.draftPer() || 1)),
      weightKg: this.draftWeight(),
      exwPrice: this.draftExw() || 0,
      exwCurrency: this.draftCurrency(),
    });
    this.createMode.set(false);
  }

  readonly query = signal('');
  readonly categoryFilter = signal<ProductPickerCategoryKey | null>(null);
  readonly colourFilter = signal<string | null>(null);
  readonly chosen = signal<Product | null>(null);
  readonly carton = new CartonQuantity(
    () => this.chosen()?.carton.piecesPerCarton ?? 1,
    () => this.enforceCartons());

  readonly categoryOptions = computed(() =>
    productPickerCategories(this.products(), this.categories()));
  readonly colourOptions = computed(() =>
    productPickerColours(
      this.products(), this.categories(), this.categoryFilter(), STANDARD_COLOURS, COLOUR_SWATCHES));
  readonly familySections = computed(() => productPickerFamilySections(
    orderPickerProducts(this.products(), this.preserveSourceOrder()),
    this.families(),
    this.categories(),
    { query: this.query(), category: this.categoryFilter() },
  ).map((section) => ({ ...section, lanes: productPickerFamilyLanes(section.groups) })));
  readonly matches = computed(() => filterProductPicker(
    orderPickerProducts(this.products(), this.preserveSourceOrder()), this.categories(), {
    query: this.query(),
    category: this.categoryFilter(),
    colour: this.colourFilter(),
  }));

  setCategoryFilter(category: ProductPickerCategoryKey | null): void {
    this.categoryFilter.set(category);
    const colour = this.colourFilter();
    if (colour !== null && !this.colourOptions().some((option) => option.key === colour)) {
      this.colourFilter.set(null);
    }
  }

  categoryName(product: Product): string {
    return productPickerCategoryName(product, this.categories());
  }

  groupSummary(group: ProductPickerFamilyGroup): string {
    return productPickerGroupSummary(group);
  }

  variantLabel(product: Product): string {
    return productPickerVariantLabel(product);
  }

  variantColourHex(product: Product): string | null {
    if (product.colourHex?.trim()) return product.colourHex.trim();
    const colour = product.colour?.trim().toLocaleLowerCase('nl-BE');
    if (!colour) return null;
    return Object.entries(COLOUR_SWATCHES).find(([name]) =>
      name.toLocaleLowerCase('nl-BE') === colour)?.[1] ?? null;
  }

  ngOnDestroy(): void {
    this.carton.destroy();
  }

  /** Enough stock for what is being asked? */
  readonly hasEnoughStock = computed(() => {
    const product = this.chosen();
    return product ? !product.inventoryKnown || product.stockQuantity >= this.carton.value() : true;
  });

  /** Grof niveau voor de stip: leeg, krap of ruim. */
  stockLevel(product: Product): 'none' | 'low' | 'ok' | 'unknown' {
    if (!product.inventoryKnown) return 'unknown';
    if (product.stockQuantity <= 0) return 'none';
    /* Under ten cartons we call tight; below that you run out fast. */
    return product.stockQuantity < (product.carton.piecesPerCarton ?? 1) * 10 ? 'low' : 'ok';
  }

  stockLabel(product: Product): string {
    if (!product.inventoryKnown) return 'voorraad nog niet bevestigd';
    if (product.stockQuantity <= 0) return 'geen voorraad — op bestelling';
    return `${product.stockQuantity.toLocaleString('nl-BE')} op voorraad`;
  }

  readonly cartons = computed(() => {
    const product = this.chosen();
    if (!product) return 0;
    const per = Math.max(1, product.carton.piecesPerCarton ?? 1);
    return Math.ceil(Math.max(0, this.carton.value()) / per);
  });

  price(product: Product): number {
    return this.priceOf()(product);
  }

  priceCurrency(product: Product): Currency {
    return this.currencyOf()(product);
  }

  choose(product: Product): void {
    this.chosen.set(product);
    /* One carton as the starting point: at the table you type the real
       number anyway, and ten boxes preloaded reads as a pushy default. */
    this.carton.reset(product.carton.piecesPerCarton ?? 1);
  }

  clear(): void {
    this.chosen.set(null);
    this.query.set('');
  }

  confirm(): void {
    const product = this.chosen();
    if (!product || this.carton.value() <= 0) return;
    this.picked.emit({ product, quantity: this.carton.finalValue() });
  }
}
