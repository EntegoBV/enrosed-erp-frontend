import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Injector,
  ViewEncapsulation,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthImage } from '../../core/api/auth-image';
import { CatalogApi } from '../../core/api/catalog-api';
import { isRevisionConflict, messageOf } from '../../core/api/errors';
import type { Category, Product, ProductFamily } from '../../core/api/models';
import { HasUnsavedChanges } from '../../core/guards/unsaved-changes.guard';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { IosNav } from '../../shared/ios-nav';
import { LoadError } from '../../shared/load-error';
import {
  familyForProduct,
  featuredProductEligibility,
  productBelongsToCategory,
} from '../../shared/product-featured-eligibility';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui, confirmLeave, escapeHtml } from '../../shared/ui';
import { WK_DOCK_MIN_PX, elementWidth } from '../../shared/workspace-layout';
import { WebsiteSyncStatus } from '../settings/website-sync-status';
import { WebsiteSyncStore } from '../settings/website-sync-store';
import { WEBSITE_LANGUAGE_ORDER, categoryMissingLanguages, plural } from './website-attention';
import {
  blankCategoryDraft,
  categoryDeepLink,
  categoryDraftValid,
  categoryEditDraft,
  categoryMenuLine,
  categoryPhoneLine,
  categoryReeksCount,
  categorySavePayload,
  findCategoryByCode,
  mergeSavedCategory,
  movedCategoryIds,
  normalizeCategory,
  normalizeCategoryCode,
} from './website-categories-view';
import { CategoryFeaturedChoice, WebsiteCategoryForm } from './website-category-form';
import { WebsiteStatusBar } from './website-status-bar';
import { WebsiteStore } from './website-store';

const LANGUAGE_COUNT = WEBSITE_LANGUAGE_ORDER.length;
const DEPENDENCY_WARNING = 'Categorieën kun je blijven bewerken. De keuzelijst voor uitgelichte producten is tijdelijk onvolledig.';

interface CategoryRow {
  category: Category;
  key: string;
  index: number;
  photo: string | null;
  menu: string;
  featured: string | null;
  reeksen: number | null;
  complete: number;
}

/**
 * Categorieën of Website beheren (/website/categories): the product
 * categories in the order the ERP, the order app and the website use, with
 * their menu names, uitgelicht product, reeksen and languages. A kit table
 * with ↑ ↓ per row and the form in a docked inspector or a drawer on the
 * desk; a list with a reorder mode and a full-height sheet on the phone.
 * The rules are the settings page's category section (settings-page.ts,
 * which keeps its own copy until the company round folds them together);
 * the data comes from WebsiteStore and every save patches it.
 */
@Component({
  selector: 'app-website-categories-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../../styles/website-workspace.scss', '../../../styles/website-categories.scss'],
  imports: [AuthImage, Icon, IosNav, LoadError, NgTemplateOutlet, RouterLink, Sheet, Skeleton, WebsiteCategoryForm, WebsiteStatusBar, WebsiteSyncStatus],
  template: `
    <ng-template #problems>
      @if (conflict()) {
        <div class="wk-banner wk-banner--danger wk-banner--inset" role="alert">
          <app-icon name="alert" [size]="16" />
          <span class="wk-banner__text"><b>Nieuwere categorieversie beschikbaar.</b> Je invoer is niet overschreven.</span>
          <span class="wk-banner__actions">
            <button class="wk-btn wk-btn--sm" type="button" [disabled]="saving()" (click)="clearDraft()">Formulier sluiten</button>
            <button class="wk-btn wk-btn--sm wk-btn--primary" type="button" [disabled]="saving()" (click)="reloadConflictedCategory()">Laatste versie laden</button>
          </span>
        </div>
      } @else if (saveError(); as error) {
        <div class="wk-banner wk-banner--danger wk-banner--inset" role="alert">
          <app-icon name="alert" [size]="16" />
          <span class="wk-banner__text"><b>Categorie is nog niet opgeslagen.</b> {{ error }}</span>
          <span class="wk-banner__actions">
            <button class="wk-btn wk-btn--sm" type="button" [disabled]="saving() || !draftValid()" (click)="saveCategory()">Opnieuw opslaan</button>
          </span>
        </div>
      }
    </ng-template>

    <ng-template #inspector let-draft>
      <header class="wk-inspector__head">
        <div class="ws-catinsp__title">
          <small class="ws-catinsp__eyebrow">{{ draft.id === null ? 'Nieuwe categorie' : 'Categorie bewerken' }}</small>
          <h2 class="wk-inspector__title">{{ draft.name.trim() || (draft.id === null ? 'Nieuwe categorie' : draft.code) }}</h2>
          <small>{{ positionLine() }}</small>
        </div>
        @if (draft.id !== null) {
          <button class="wk-btn wk-btn--sm wk-btn--danger" type="button" [disabled]="saving() || deletingId() === draft.id" (click)="removeDraft()">
            <app-icon name="trash" [size]="14" />{{ deletingId() === draft.id ? 'Verwijderen…' : 'Verwijderen' }}
          </button>
        }
        <button class="wk-btn wk-btn--ghost wk-btn--icon" type="button" aria-label="Formulier sluiten" [disabled]="saving()" (click)="cancelEdit()"><app-icon name="close" [size]="18" /></button>
      </header>
      @for (key of [draftKey()]; track key) {
        <div class="ws-catinsp__body mo-fade">
          <ng-container *ngTemplateOutlet="problems" />
          <app-website-category-form variant="desk" [draft]="draft" [categories]="categories()" [choices]="featuredChoices()"
                                     [missingFeaturedId]="missingFeaturedId()" [dependencyMissing]="!!dependencyWarning()"
                                     [busy]="saving()" [saveError]="saveError()" [initialLanguage]="deepLanguage()" [focusField]="deepFocus()"
                                     (patch)="patchDraft($event)" (translations)="setTranslations($event)" (codeBlur)="normalizeCode()" />
        </div>
      }
      <footer class="wk-inspector__foot ws-catinsp__foot">
        <button class="wk-btn" type="button" [disabled]="saving()" (click)="cancelEdit()">Annuleren</button>
        <button class="wk-btn wk-btn--primary" type="button" [disabled]="!draftValid() || saving() || conflict()" (click)="saveCategory()">
          {{ saving() ? 'Opslaan…' : (draft.id === null ? 'Categorie toevoegen' : 'Wijzigingen opslaan') }}<span class="wk-kbd" aria-hidden="true">⌘S</span>
        </button>
      </footer>
    </ng-template>

    @if (desk.active()) {
      <div class="wk-page ws-page">
        <header class="wk-toolbar">
          <div class="wk-toolbar__lead">
            <h1 class="wk-toolbar__title">Categorieën</h1>
            @if (categories().length || store.categories()) {
              <span class="ws-sub" title="De volgorde geldt in het ERP, de bestelapp en op de website">
                <span class="ws-long">{{ countLine() }} · de volgorde geldt in het ERP, de bestelapp en op de website</span>
                <span class="ws-short">{{ countLine() }} · één volgorde voor ERP, bestelapp en website</span>
              </span>
            }
          </div>
          <div class="wk-toolbar__tools">
            <a class="wk-btn" routerLink="/categories">Foto’s</a>
            <button class="wk-btn wk-btn--primary" type="button" [disabled]="!store.categories()" (click)="addCategory()"><app-icon name="plus" [size]="15" />Categorie</button>
          </div>
        </header>

        @if (dependencyWarning()) {
          <div class="wk-notices">
            <div class="wk-banner wk-banner--warn" role="status">
              <app-icon name="alert" [size]="16" />
              <span class="wk-banner__text"><b>Uitgelichte producten niet volledig geladen</b> · {{ dependencyWarning() }}</span>
              <span class="wk-banner__actions"><button class="wk-btn wk-btn--sm" type="button" [disabled]="productsLoading()" (click)="reloadDependencies()">Opnieuw laden</button></span>
            </div>
          </div>
        }

        <div class="wk-body" [class.wk-body--split]="docked() && !!draft()">
          <div class="wk-pane">
            <div class="ws-scroll">
              @if (loadError() && !store.categories()) {
                <app-load-error title="Categorieën konden niet worden geladen" [message]="loadError()" [busy]="store.isLoading('categories')" (retry)="reload()" />
              } @else if (!store.categories()) {
                <div class="wk-card"><app-skeleton kind="table" [rows]="5" /></div>
              } @else if (!rows().length) {
                <div class="wk-card">
                  <div class="wk-empty" role="status">
                    <div class="wk-empty__icon"><app-icon name="grid" [size]="22" /></div>
                    <h2 class="wk-empty__title">Nog geen categorieën</h2>
                    <p class="wk-empty__text">Voeg de eerste categorie toe om producten in te delen in het ERP, de bestelapp en op de website.</p>
                    <div class="wk-empty__actions"><button class="wk-btn wk-btn--primary" type="button" (click)="addCategory()">Categorie toevoegen</button></div>
                  </div>
                </div>
              } @else {
                <div class="wk-card ws-cat-card">
                  <div class="wk-table ws-cats" role="grid" aria-label="Productcategorieën in volgorde" (keydown)="tableKey($event)">
                    <div class="wk-thead" role="row">
                      <span class="wk-th" role="columnheader">Volgorde</span>
                      <span class="wk-th" role="columnheader"><span class="sr-only">Foto</span></span>
                      <span class="wk-th" role="columnheader">Naam</span>
                      <span class="wk-th" role="columnheader" data-hide="xs inspecting">Menu</span>
                      <span class="wk-th" role="columnheader">Uitgelicht</span>
                      <span class="wk-th wk-th--num" role="columnheader">Reeksen</span>
                      <span class="wk-th wk-th--num" role="columnheader">Talen</span>
                      <span class="wk-th" role="columnheader"><span class="sr-only">Openen</span></span>
                    </div>
                    @for (row of rows(); track row.key) {
                      <div class="wk-tr wk-tr--link ws-cat-row" role="row" [attr.data-key]="row.key" [attr.tabindex]="tabStop() === row.key ? 0 : -1"
                           [attr.aria-selected]="draft()?.id === row.category.id" [class.ws-moved]="flash() === row.key"
                           (click)="openRow(row)" (focus)="focused.set(row.key)">
                        <span class="wk-td ws-cat-order" role="gridcell">
                          <b>{{ row.category.position }}</b>
                          <span class="ws-cat-order__btns" (click)="$event.stopPropagation()">
                            <button class="wk-btn wk-btn--sm wk-btn--icon" type="button" tabindex="-1" [disabled]="reordering() || row.index === 0"
                                    [attr.aria-label]="row.category.name + ' hoger'" title="Hoger" (click)="moveCategory(row.category, -1)"><app-icon name="chevron-up" [size]="14" /></button>
                            <button class="wk-btn wk-btn--sm wk-btn--icon" type="button" tabindex="-1" [disabled]="reordering() || row.index === rows().length - 1"
                                    [attr.aria-label]="row.category.name + ' lager'" title="Lager" (click)="moveCategory(row.category, 1)"><app-icon name="chevron-down" [size]="14" /></button>
                          </span>
                        </span>
                        <span class="wk-td" role="gridcell">
                          @if (row.photo) { <img class="ws-cat-thumb" [appAuthSrc]="row.photo" alt="" /> } @else { <span class="ws-cat-thumb ws-cat-thumb--none" aria-hidden="true"></span> }
                        </span>
                        <span class="wk-td ws-cat-name" role="gridcell">
                          <b [attr.title]="row.category.name">{{ row.category.name }}</b>
                          <small>{{ row.category.code }}</small>
                        </span>
                        <span class="wk-td ws-cat-menu" role="gridcell" data-hide="xs inspecting" [attr.title]="row.menu || null">
                          @if (row.menu) { {{ row.menu }} } @else { <span class="ws-cat-none">—</span> }
                        </span>
                        <span class="wk-td ws-cat-feat" role="gridcell" [attr.title]="row.featured">
                          @if (row.featured) { {{ row.featured }} } @else { <span class="ws-cat-none">—</span> }
                        </span>
                        <span class="wk-td wk-td--num ws-cat-num" role="gridcell">{{ row.reeksen ?? '—' }}</span>
                        <span class="wk-td wk-td--num ws-cat-frac" role="gridcell" [class.is-done]="row.complete === languageCount" [class.is-warn]="row.complete < languageCount"
                              [attr.title]="row.complete < languageCount ? (languageCount - row.complete) + ' van ' + languageCount + ' talen ' + (languageCount - row.complete === 1 ? 'ontbreekt' : 'ontbreken') : 'Alle ' + languageCount + ' talen compleet'">{{ row.complete }}/{{ languageCount }}</span>
                        <app-icon class="ws-cat-chev" name="chevron-right" [size]="16" />
                      </div>
                    }
                  </div>
                </div>
                <p class="ws-cat-under">De volgorde wijzig je met ↑ ↓ in de rij of met ⌥↑ / ⌥↓; de foto’s van een categorie beheer je onder <a routerLink="/categories">Foto’s</a>.</p>
              }
              <p class="sr-only" aria-live="polite">{{ announcement() }}</p>
            </div>
          </div>
          @if (docked() && draft(); as current) {
            <aside class="wk-inspector ws-inspector ws-catinsp" aria-label="Categorie"><ng-container *ngTemplateOutlet="inspector; context: { $implicit: current }" /></aside>
          }
        </div>
        <app-website-status-bar [text]="barLine()" hint="↑↓ kiezen · ⌥↑↓ verplaatsen · ↵ openen" />
      </div>
      @if (!docked() && draft(); as current) {
        <aside class="wk-inspector wk-inspector--drawer ws-inspector ws-catinsp" aria-label="Categorie"><ng-container *ngTemplateOutlet="inspector; context: { $implicit: current }" /></aside>
      }
    } @else {
      <div class="ios-page ws-ios ws-cat-ios">
        <app-ios-nav title="Categorieën" [subtitle]="store.categories() ? countLine() : null" backLabel="Overzicht" backUrl="/website" backAriaLabel="Terug naar Overzicht">
          @if (rows().length > 1) {
            <button trail class="ios-capsule" type="button" (click)="reorderMode.set(!reorderMode())">{{ reorderMode() ? 'Klaar' : 'Volgorde' }}</button>
          }
          <button trail class="ios-circle" type="button" aria-label="Categorie toevoegen" [disabled]="!store.categories()" (click)="addCategory()"><app-icon name="plus" [size]="20" /></button>
        </app-ios-nav>
        <app-website-sync-status variant="banner" />
        @if (dependencyWarning()) {
          <div class="ios-banner" role="status"><span><b>Uitgelichte producten niet volledig geladen</b> · {{ dependencyWarning() }}</span>
            <button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button" [disabled]="productsLoading()" (click)="reloadDependencies()">Opnieuw</button></div>
        }
        @if (loadError() && !store.categories()) {
          <app-load-error title="Categorieën konden niet worden geladen" [message]="loadError()" [busy]="store.isLoading('categories')" (retry)="reload()" />
        } @else if (!store.categories()) {
          <app-skeleton kind="group" [rows]="5" />
        } @else if (!rows().length) {
          <div class="ios-empty">
            <div class="ios-empty__icon"><app-icon name="grid" [size]="26" /></div>
            <h2 class="ios-empty__title">Nog geen categorieën</h2>
            <p class="ios-empty__text">Voeg de eerste categorie toe.</p>
            <button class="ios-capsule ios-capsule--tinted" type="button" (click)="addCategory()">Categorie toevoegen</button>
          </div>
        } @else {
          <section class="ios-section">
            <div class="ios-section__head"><h2>{{ reorderMode() ? 'Volgorde wijzigen' : 'Volgorde op de website' }}</h2></div>
            <div class="ios-group ios-group--thumbs">
              @for (row of rows(); track row.key) {
                @if (reorderMode()) {
                  <div class="ios-cell" [class.ws-moved]="flash() === row.key">
                    @if (row.photo) { <img class="ios-thumb" [appAuthSrc]="row.photo" alt="" /> } @else { <span class="ios-thumb ws-cat-thumb--none" aria-hidden="true"></span> }
                    <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2">{{ row.category.position }}. {{ row.category.name }}</span></span>
                    <span class="ws-cat-arrows">
                      <button class="ws-cat-arrow" type="button" [attr.aria-label]="row.category.name + ' hoger'" [disabled]="reordering() || row.index === 0" (click)="moveCategory(row.category, -1)"><app-icon name="chevron-up" [size]="18" /></button>
                      <button class="ws-cat-arrow" type="button" [attr.aria-label]="row.category.name + ' lager'" [disabled]="reordering() || row.index === rows().length - 1" (click)="moveCategory(row.category, 1)"><app-icon name="chevron-down" [size]="18" /></button>
                    </span>
                  </div>
                } @else {
                  <button class="ios-cell" type="button" (click)="openRow(row)">
                    @if (row.photo) { <img class="ios-thumb" [appAuthSrc]="row.photo" alt="" /> } @else { <span class="ios-thumb ws-cat-thumb--none" aria-hidden="true"></span> }
                    <span class="ios-cell__body">
                      <span class="ios-cell__title ios-cell__title--2">{{ row.category.name }}</span>
                      <span class="ios-cell__sub ios-cell__sub--wrap" [class.ws-warn-text]="row.complete < languageCount">{{ phoneLine(row) }}</span>
                    </span>
                    <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
                  </button>
                }
              }
            </div>
            <p class="ios-section__foot">De volgorde geldt in het ERP, de bestelapp en op de website.</p>
          </section>
          <p class="sr-only" aria-live="polite">{{ announcement() }}</p>
        }
      </div>
      @if (draft(); as current) {
        <app-sheet [title]="current.id === null ? 'Nieuwe categorie' : current.name || 'Categorie'" variant="ios" (closed)="cancelEdit()">
          <div body class="ws-catsheet">
            <p class="ws-catsheet__pos">{{ positionLine() }}</p>
            @if (conflict()) {
              <div class="ios-banner ios-banner--danger" role="alert"><span><b>Nieuwere categorieversie beschikbaar.</b> Je invoer is niet overschreven.</span>
                <button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button" [disabled]="saving()" (click)="reloadConflictedCategory()">Laatste versie</button></div>
            } @else if (saveError(); as error) {
              <div class="ios-banner ios-banner--danger" role="alert"><span><b>Categorie is nog niet opgeslagen.</b> {{ error }}</span></div>
            }
            @for (key of [draftKey()]; track key) {
              <app-website-category-form variant="phone" [draft]="current" [categories]="categories()" [choices]="featuredChoices()"
                                         [missingFeaturedId]="missingFeaturedId()" [dependencyMissing]="!!dependencyWarning()"
                                         [busy]="saving()" [saveError]="saveError()" [initialLanguage]="deepLanguage()" [focusField]="deepFocus()"
                                         (patch)="patchDraft($event)" (translations)="setTranslations($event)" (codeBlur)="normalizeCode()" />
            }
            @if (current.id !== null) {
              <section class="ios-section">
                <div class="ios-group">
                  <button class="ios-cell ios-cell--danger" type="button" [disabled]="saving() || deletingId() === current.id" (click)="removeDraft()">
                    {{ deletingId() === current.id ? 'Verwijderen…' : 'Categorie verwijderen' }}
                  </button>
                </div>
              </section>
            }
          </div>
          <div foot style="display:contents">
            <button class="btn btn--primary" type="button" [disabled]="!draftValid() || saving() || conflict()" (click)="saveCategory()">
              {{ saving() ? 'Opslaan…' : 'Opslaan' }}
            </button>
          </div>
        </app-sheet>
      }
    }
  `,
})
export class WebsiteCategoriesPage implements HasUnsavedChanges {
  readonly desk = inject(DesktopViewport);
  readonly store = inject(WebsiteStore);
  private readonly sync = inject(WebsiteSyncStore);
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly languageCount = LANGUAGE_COUNT;

  /** `?code=` (Te doen) or `?category=` (older links), `?language=`, `?focus=`: applied once, to that category. */
  private readonly deepLink = (() => {
    const query = this.route.snapshot.queryParamMap;
    return categoryDeepLink({
      code: query.get('code'), category: query.get('category'), language: query.get('language'), focus: query.get('focus'),
    }, WEBSITE_LANGUAGE_ORDER);
  })();
  private deepLinkOpened = false;

  readonly products = signal<Product[] | null>(null);
  readonly productsLoading = signal(false);
  private readonly productsFailed = signal(false);

  readonly draft = signal<Category | null>(null);
  private readonly savedDraft = signal<Category | null>(null);
  readonly dirty = computed(() => JSON.stringify(this.draft()) !== JSON.stringify(this.savedDraft()));
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly conflict = signal(false);
  readonly deletingId = signal<number | null>(null);
  readonly reordering = signal(false);
  readonly reorderMode = signal(false);
  readonly focused = signal<string | null>(null);
  readonly flash = signal<string | null>(null);
  readonly announcement = signal('');
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private moveToast: number | null = null;
  /** A new draft gets its own key, so the form (and its translation editor) starts fresh for every category. */
  private newDraftSerial = 0;

  private readonly width = elementWidth(() => this.host.nativeElement);
  readonly docked = computed(() => this.width() >= WK_DOCK_MIN_PX);

  readonly categories = computed<Category[]>(() => this.store.categories() ?? []);
  readonly loadError = computed(() => this.store.errors().categories ?? null);
  readonly dependencyWarning = computed(() =>
    this.productsFailed() || (this.store.errors().families && !this.store.families()) ? DEPENDENCY_WARNING : null);

  readonly rows = computed<CategoryRow[]>(() => {
    const families = this.store.families();
    return this.categories().map((category, index) => ({
      category,
      key: String(category.id ?? category.code),
      index,
      photo: category.id !== null && category.photos?.length ? this.catalog.categoryPhotoUrl(category.id, category.photos[0].id) : null,
      menu: categoryMenuLine(category),
      featured: category.featuredProductId === null ? null : this.featuredLabel(category.featuredProductId),
      reeksen: families ? categoryReeksCount(category, families) : null,
      complete: LANGUAGE_COUNT - categoryMissingLanguages(category, WEBSITE_LANGUAGE_ORDER).length,
    }));
  });
  readonly tabStop = computed(() => this.focused() ?? (this.draft()?.id != null ? String(this.draft()!.id) : null) ?? this.rows()[0]?.key ?? null);
  readonly draftKey = computed(() => {
    const draft = this.draft();
    return draft === null ? '' : draft.id === null ? `new-${this.newDraftSerial}` : `id-${draft.id}`;
  });
  readonly draftValid = computed(() => categoryDraftValid(this.categories(), this.draft()));

  readonly missingCount = computed(() => this.rows().filter((row) => row.complete < LANGUAGE_COUNT).length);
  readonly countLine = computed(() => plural(this.categories().length, 'categorie', 'categorieën'));
  readonly barLine = computed(() => {
    if (!this.store.categories()) return '';
    const missing = this.missingCount();
    return `${this.countLine()} · ${missing ? `${missing} met ontbrekende talen` : `alle ${LANGUAGE_COUNT} talen compleet`}`;
  });
  readonly positionLine = computed(() => {
    const draft = this.draft();
    if (!draft) return '';
    const total = this.categories().length;
    if (draft.id === null) return `Komt als laatste: positie ${total + 1} van ${total + 1}`;
    const index = this.categories().findIndex((category) => category.id === draft.id);
    return index < 0 ? '' : `Positie ${index + 1} van ${total}`;
  });
  /** The deep link's language and field, for the category it names only. */
  readonly deepLanguage = computed(() => this.isDeepLinked() ? this.deepLink.language : 'NL');
  readonly deepFocus = computed(() => this.isDeepLinked() ? this.deepLink.focus : null);

  readonly featuredChoices = computed<CategoryFeaturedChoice[]>(() => {
    const draft = this.draft();
    const products = this.products();
    if (!draft || draft.id === null || !products) return [];
    const categoryId = draft.id;
    const families = [...(this.store.families() ?? [])] as ProductFamily[];
    const current = draft.featuredProductId;
    return products
      .filter((product): product is Product & { id: number } => product.id !== null)
      .map((product) => {
        const family = familyForProduct(families, product.familyId);
        const eligibility = featuredProductEligibility(family, product.id, product.active);
        const inCategory = productBelongsToCategory(family, product.categoryId, categoryId, normalizeCategoryCode(draft.code));
        const eligible = inCategory && eligibility.eligible && family?.active === true && family.websiteStatus === 'PUBLISHED';
        const reasons = eligible ? [] : [
          inCategory ? null : 'andere categorie',
          eligibility.active ? null : 'niet actief',
          family?.active === false ? 'reeks niet actief in ERP' : null,
          family && family.websiteStatus !== 'PUBLISHED' ? 'reeks niet live' : null,
          eligibility.hasPublicImage ? null : 'geen publieke foto',
        ].filter((reason): reason is string => reason !== null);
        return { product, show: (inCategory && eligibility.eligible) || product.id === current,
          choice: { id: product.id, label: this.productLabel(product) + reasons.map((reason) => ` · ${reason}`).join(''), disabled: !eligible } };
      })
      .filter((option) => option.show)
      .map((option) => option.choice);
  });
  readonly missingFeaturedId = computed(() => {
    const selected = this.draft()?.featuredProductId ?? null;
    const products = this.products();
    return selected !== null && products && !products.some((product) => product.id === selected) ? selected : null;
  });

  constructor() {
    void this.store.ensure(['categories', 'families']);
    void this.loadProducts();
    /* The category a link asks for opens once the list is there. */
    effect(() => {
      const categories = this.store.categories();
      if (!categories || this.deepLinkOpened || !this.deepLink.code) return;
      this.deepLinkOpened = true;
      const category = findCategoryByCode(categories, this.deepLink.code);
      if (category) untracked(() => this.open(category, false));
    });
  }

  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    if (!this.desk.active() || event.defaultPrevented) return;
    const overlay = !!document.querySelector('.overlay');
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      if (!this.draft() || overlay) return;
      event.preventDefault();
      if (this.draftValid() && !this.saving() && !this.conflict()) void this.saveCategory();
      return;
    }
    if (event.key === 'Escape' && this.draft() && !overlay) {
      event.preventDefault();
      this.cancelEdit();
    }
  }

  @HostListener('window:beforeunload', ['$event'])
  warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.dirty() && !this.saving()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  canDeactivate(): boolean | Promise<boolean> {
    if (this.saving()) return false;
    if (!this.dirty()) return true;
    return this.draftValid() && !this.conflict()
      ? confirmLeave(this.ui, () => this.saveCategory())
      : confirmLeave(this.ui, undefined, { message: 'De categorie is nog niet volledig ingevuld. Als je dit scherm verlaat, gaan je wijzigingen verloren.' });
  }

  /**
   * The rows' keys (one tab stop): ↑/↓ another row (an open, unchanged form
   * follows), ⌥↑/⌥↓ move that category, Enter opens it in the inspector.
   */
  tableKey(event: KeyboardEvent): void {
    const element = (event.target as HTMLElement).closest<HTMLElement>('.ws-cat-row');
    if (!element || event.metaKey || event.ctrlKey) return;
    const rows = this.rows();
    const index = rows.findIndex((row) => row.key === element.dataset['key']);
    if (index < 0) return;
    const row = rows[index];
    const arrow = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (arrow && event.altKey) {
      event.preventDefault();
      void this.moveCategory(row.category, arrow as -1 | 1);
    } else if ((arrow || event.key === 'Home' || event.key === 'End') && !event.altKey) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + arrow));
      const target = rows[next];
      this.focused.set(target.key);
      if (this.draft() && !this.dirty() && this.draft()?.id !== target.category.id) this.open(target.category);
      this.focusRow(target.key);
    } else if (event.key === 'Enter' && !event.altKey) {
      event.preventDefault();
      this.openRow(row);
      afterNextRender({ read: () => this.host.nativeElement.querySelector<HTMLElement>('.ws-catinsp input:not([readonly])')?.focus() }, { injector: this.injector });
    }
  }

  openRow(row: CategoryRow): void {
    const draft = this.draft();
    this.focused.set(row.key);
    if (draft?.id === row.category.id && draft.id !== null) return;
    if (draft && this.dirty()) {
      this.ui.toast('Sla de categorie eerst op of sluit het formulier.', 'err');
      return;
    }
    this.open(row.category);
  }

  addCategory(): void {
    const draft = this.draft();
    if (draft?.id === null) return;
    if (draft && this.dirty()) {
      this.ui.toast('Sla de categorie eerst op of sluit het formulier.', 'err');
      return;
    }
    this.newDraftSerial++;
    this.resetErrors();
    const fresh = blankCategoryDraft(this.categories());
    this.savedDraft.set(structuredClone(fresh));
    this.draft.set(fresh);
    this.writeAddress(null);
    afterNextRender({ read: () => document.querySelector<HTMLElement>('#ws-category-desk-name, #ws-category-phone-name')?.focus() }, { injector: this.injector });
  }

  /** Esc, Annuleren, the cross or closing the sheet: asks first when something changed. */
  cancelEdit(): void {
    if (this.saving()) return;
    if (this.dirty()) {
      this.ui.confirm({
        title: 'Categorieformulier sluiten',
        message: 'De niet-opgeslagen categorie- en vertaalwijzigingen gaan verloren.',
        confirmLabel: 'Niet opslaan',
        danger: true,
      }, () => this.clearDraft());
      return;
    }
    this.clearDraft();
  }

  clearDraft(): void {
    const id = this.draft()?.id;
    this.draft.set(null);
    this.savedDraft.set(null);
    this.resetErrors();
    this.writeAddress(null);
    if (id != null && this.desk.active()) this.focusRow(String(id));
  }

  patchDraft(changes: Partial<Category>): void {
    this.saveError.set(null);
    this.draft.update((draft) => draft ? { ...draft, ...changes } : draft);
  }

  setTranslations(category: Category): void {
    this.saveError.set(null);
    this.conflict.set(false);
    this.draft.set(category);
  }

  normalizeCode(): void {
    this.draft.update((draft) => draft ? { ...draft, code: normalizeCategoryCode(draft.code) } : draft);
  }

  /** One step of one category; the whole order is written in one call. */
  async moveCategory(category: Category, direction: -1 | 1): Promise<boolean> {
    if (category.id === null || this.reordering()) return false;
    if (this.draft() && this.dirty()) {
      this.ui.toast('Sla de categorie eerst op of sluit het formulier.', 'err');
      return false;
    }
    const ids = movedCategoryIds(this.categories(), category.id, direction);
    if (!ids) return false;
    const key = String(category.id);
    this.reordering.set(true);
    try {
      const fresh = (await this.catalog.reorderCategories(ids)).map(normalizeCategory);
      this.store.setCategories(fresh);
      /* An open, unchanged form takes the new position and revision. */
      const open = this.draft();
      if (open && open.id !== null) {
        const latest = fresh.find((item) => item.id === open.id);
        if (latest) { const draft = categoryEditDraft(latest); this.savedDraft.set(structuredClone(draft)); this.draft.set(draft); }
      }
      const position = fresh.findIndex((item) => item.id === category.id) + 1;
      this.announcement.set(`${category.name} staat nu op positie ${position} van ${fresh.length}.`);
      this.markMoved(key);
      if (this.desk.active()) { this.focused.set(key); this.focusRow(key); }
      void this.sync.load();
      /* One toast for a run of moves, not one per key press. */
      if (this.moveToast !== null) this.ui.dismissToast(this.moveToast);
      this.moveToast = this.ui.toast('Volgorde aangepast');
      return true;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Volgorde aanpassen mislukt'), 'err');
      return false;
    } finally {
      this.reordering.set(false);
    }
  }

  async saveCategory(): Promise<boolean> {
    const draft = this.draft();
    if (!draft || !this.draftValid() || this.saving()) return false;
    const payload = categorySavePayload(draft);
    const created = payload.id === null;
    this.resetErrors();
    this.saving.set(true);
    try {
      const saved = normalizeCategory(created
        ? await this.catalog.createCategory(payload)
        : await this.catalog.updateCategory(payload.id!, payload));
      this.store.setCategories(mergeSavedCategory(this.categories(), saved, created));
      this.draft.set(null);
      this.savedDraft.set(null);
      this.writeAddress(null);
      void this.sync.load();
      const missing = categoryMissingLanguages(saved, WEBSITE_LANGUAGE_ORDER).length;
      const done = created ? 'Categorie toegevoegd' : 'Categorie opgeslagen';
      this.ui.toast(missing ? `${done} · ${plural(missing, 'taal', 'talen')} later aanvullen` : done);
      if (this.desk.active() && saved.id !== null) { this.focused.set(String(saved.id)); this.focusRow(String(saved.id)); }
      return true;
    } catch (failure: unknown) {
      const conflict = isRevisionConflict(failure);
      const message = conflict
        ? 'Deze categorie is intussen gewijzigd. Laad de laatste versie en controleer je aanpassing opnieuw.'
        : messageOf(failure, 'Opslaan mislukt');
      this.conflict.set(conflict);
      this.saveError.set(message);
      this.ui.toast(message, 'err');
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  async reloadConflictedCategory(): Promise<void> {
    const draft = this.draft();
    if (!draft || draft.id === null || this.saving()) return;
    this.saving.set(true);
    try {
      const list = (await this.catalog.categories()).map(normalizeCategory);
      const latest = list.find((category) => category.id === draft.id);
      this.store.setCategories(list);
      if (!latest) {
        this.saveError.set('Deze categorie bestaat niet meer. Sluit het formulier.');
        this.conflict.set(false);
        return;
      }
      const fresh = categoryEditDraft(latest);
      this.savedDraft.set(structuredClone(fresh));
      this.draft.set(structuredClone(fresh));
      this.resetErrors();
      this.ui.toast('Laatste categorieversie geladen');
    } catch (failure: unknown) {
      this.saveError.set(messageOf(failure, 'Laatste categorieversie laden mislukt'));
    } finally {
      this.saving.set(false);
    }
  }

  /** Delete lives inside the form: you look at the category before you lose it. */
  removeDraft(): void {
    const draft = this.draft();
    const category = this.categories().find((candidate) => candidate.id === draft?.id);
    if (!category || category.id === null) return;
    const id = category.id;
    this.ui.confirm({
      title: 'Categorie verwijderen',
      message: `<b>${escapeHtml(category.name)}</b> verwijderen?`,
      confirmLabel: 'Verwijderen',
      danger: true,
    }, async () => {
      this.deletingId.set(id);
      try {
        await this.catalog.deleteCategory(id);
        this.store.setCategories(this.categories().filter((current) => current.id !== id));
        if (this.draft()?.id === id) {
          this.draft.set(null);
          this.savedDraft.set(null);
          this.resetErrors();
          this.writeAddress(null);
        }
        void this.sync.load();
        this.ui.toast('Categorie verwijderd');
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Categorie verwijderen mislukt'), 'err');
      } finally {
        this.deletingId.set(null);
      }
    });
  }

  reload(): void {
    void this.store.refresh(['categories']);
  }

  reloadDependencies(): void {
    void this.loadProducts();
    if (this.store.errors().families) void this.store.refresh(['families']);
  }

  phoneLine(row: CategoryRow): string {
    return categoryPhoneLine(row.reeksen ?? 0, row.complete, LANGUAGE_COUNT, row.category.mobileName);
  }

  private open(category: Category, writeAddress = true): void {
    this.resetErrors();
    const draft = categoryEditDraft(category);
    this.savedDraft.set(structuredClone(draft));
    this.draft.set(draft);
    if (category.id !== null) this.focused.set(String(category.id));
    if (writeAddress) this.writeAddress(category.code);
  }

  private isDeepLinked(): boolean {
    const draft = this.draft();
    return !!draft && draft.id !== null && !!this.deepLink.code
      && normalizeCategoryCode(draft.code) === normalizeCategoryCode(this.deepLink.code);
  }

  /** The open category in the address (`?code=`), replacing the entry: a form is not a page. */
  private writeAddress(code: string | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { code, category: null, ...(code === null ? { language: null, focus: null } : {}) },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private async loadProducts(): Promise<void> {
    if (this.productsLoading()) return;
    this.productsLoading.set(true);
    try {
      this.products.set(await this.catalog.products());
      this.productsFailed.set(false);
    } catch {
      this.productsFailed.set(true);
    } finally {
      this.productsLoading.set(false);
    }
  }

  private productLabel(product: Product): string {
    const option = [product.colour || 'Geen kleur', product.variantSize].filter(Boolean).join(' · ');
    return product.sku ? `${product.name} · ${option} — ${product.sku}` : `${product.name} · ${option}`;
  }

  private featuredLabel(productId: number): string {
    const product = this.products()?.find((candidate) => candidate.id === productId);
    return product ? this.productLabel(product) : `Product #${productId}`;
  }

  private resetErrors(): void {
    this.saveError.set(null);
    this.conflict.set(false);
  }

  private focusRow(key: string): void {
    afterNextRender({ read: () => this.host.nativeElement.querySelector<HTMLElement>(`.ws-cat-row[data-key="${CSS.escape(key)}"]`)?.focus() }, { injector: this.injector });
  }

  private markMoved(key: string): void {
    this.flash.set(null);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    queueMicrotask(() => this.flash.set(key));
    this.flashTimer = setTimeout(() => this.flash.set(null), 600);
  }
}
