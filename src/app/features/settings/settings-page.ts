import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { PushSetup, playSoundFor } from '../../core/platform/push';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { SalesApi } from '../../core/api/sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import {
  CatalogImportResult, Category, DiscountTier, HsCode, LANGUAGES, LanguageCode,
  Product, ProductFamily, Supplier,
} from '../../core/api/models';
import { AuthImage } from '../../core/api/auth-image';
import { salesPhotoUrl } from '../../shared/sales-photo';
import { PageHeader } from '../../shared/page-header';
import { ProductPicker } from '../../shared/product-picker';
import { Sheet, Ui, confirmLeave } from '../../shared/ui';
import { saveBlob } from '../../core/api/download';
import { isRevisionConflict, messageOf } from '../../core/api/errors';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { THEMES, Theme } from '../../core/platform/theme';
import {
  FeaturedProductEligibility,
  familyForProduct,
  featuredProductEligibility,
  productBelongsToCategory,
} from '../../shared/product-featured-eligibility';
import { CategoryTranslationEditor } from './category-translation-editor';
import { PhotoExportSheet } from '../products/photo-export-sheet';
import { WebsiteSyncStatus } from './website-sync-status';
import { WebsiteQuoteSettings } from './website-quote-settings';
import { DateNlPipe, DateTimeNlPipe } from '../../shared/pipes';
import { Skeleton } from '../../shared/skeleton';
import { LOAD_ERROR_FALLBACK, LoadError } from '../../shared/load-error';
import { CompanyStore } from './company-store';
import { SettingsOverview } from './settings-overview';
import { SettingsCompany } from './settings-company';
import { LEGAL_LANGUAGES, SettingsLegal } from './settings-legal';
import { Segmented } from '../../shared/segmented';
import { SettingsEditor, dirtyStatusText } from './settings-editor';
import { lineTierChanges, sortedTiers, tierChanges, tierProblem } from './discount-tiers';
import { productSalesUnit } from '../products/product-sales-unit';
import { Icon } from '../../shared/icon';
import { keyContext } from '../../shared/key-context';
import {
  SettingsView, deviceFocus, settingsCategoryRedirect, settingsTabs, settingsView, settingsViewInfo, settingsViewQuery,
} from './settings-sections';

/**
 * The overview as the way up from a view. Its own path (a redirect to
 * /settings): the navigation history keys "the last URL seen" by path, and
 * /settings itself would resolve to the open view.
 */
const OVERVIEW_URL = '/settings/overzicht';

/** The settings views of this build (the legal view arrives with its own package). */
const AVAILABLE_VIEWS: readonly SettingsView[] = [
  'overview', 'company', 'legal', 'website', 'duties', 'discounts', 'catalog-data', 'device',
];

interface CategoryFeaturedOption {
  product: Product;
  family: ProductFamily | null;
  eligibility: FeaturedProductEligibility;
  inCategory: boolean;
}

const CATEGORY_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CATEGORY_TRANSLATION_FOCUS = new Set([
  'category-name',
  'category-navigation-name',
  'category-mobile-name',
  'category-footer-name',
  'category-eyebrow',
  'category-description',
]);

/** Category codes are also public URL keys, so one canonical form is used everywhere. */
const normalizeCategoryCode = (value: string): string => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

/**
 * Instellingen: an overview of every setting with its current value, and one
 * view per ?sectie= (Bedrijfsgegevens, Website, Douane, Kortingen,
 * Catalogusdata, Dit toestel). The desk switches views with a tab strip
 * under the toolbar, the phone pushes them. /website/categories renders the
 * category editor of this same component (websiteCategoryMode), unchanged.
 */
@Component({
  selector: 'app-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CompanyStore],
  imports: [
    Icon,
    LoadError,
    NgTemplateOutlet,
    Sheet,
    SettingsCompany,
    SettingsLegal,
    SettingsOverview,
    Segmented,
    Skeleton,
    AuthImage,
    CategoryTranslationEditor,
    FormsModule,
    PageHeader,
    PhotoExportSheet,
    ProductPicker,
    RouterLink,
    WebsiteSyncStatus,
    WebsiteQuoteSettings,
    DateNlPipe,
    DateTimeNlPipe,
  ],
  template: `
    @if (websiteCategoryMode) {
    <app-page-header
      [showBack]="!websiteCategoryMode"
      [backTo]="websiteCategoryMode ? null : settingsBackTo"
      [title]="websiteCategoryMode ? 'Categorieën & websitemenu' : 'Instellingen'"
      [subtitle]="websiteCategoryMode
        ? 'Beheer collectievolgorde, uitgelicht product en menunamen per taal.'
        : 'Categorieën, tarieven en staffels'"
      [showBell]="!websiteCategoryMode"
    />
    } @else {
    <app-page-header [title]="viewInfo().title" [subtitle]="viewInfo().subtitle"
                     [parent]="headerParent()" [backTo]="headerBackTo()">
      @if (view() === 'legal' && desktop.active() && legalEditor(); as legal) {
        <app-segmented label="Taal" [options]="legalLanguages" [value]="legal.language()" (changed)="legal.setLanguage($event)" />
      }
      @if (activeEditor(); as editor) {
        @if (editor.dirty()) {
          @if (desktop.active()) {
            <span class="set-dirty mo-fade" role="status" [attr.aria-label]="dirtyText(editor)">
              <i class="set-dot" aria-hidden="true"></i><span class="set-dirty__n" aria-hidden="true">{{ editor.dirtyCount() }}</span><span class="set-dirty__text" aria-hidden="true">{{ dirtyWords(editor) }}</span>
            </span>
            <button class="btn set-ghost mo-fade" type="button" [disabled]="editor.saving()" (click)="editor.revert()">Wijzigingen wissen</button>
          }
          <button class="btn btn--primary mo-fade" type="button" [disabled]="editor.saving()" (click)="saveEditor(editor)">{{ editor.saving() ? 'Opslaan…' : 'Opslaan' }}</button>
        }
      }
    </app-page-header>
    }

    @if (websiteCategoryMode) {
      <div class="content website-category-nav">
        <section class="category-ownership" role="note">
          <div><b>Collectiekaart en menu</b><span>De volgorde en korte namen sturen het websitemenu, mobiel menu en de footer.</span></div>
          <div><b>Uitgelicht product</b><span>De featured SKU kiest het collectiebeeld. Vaste homepage-highlights worden door hun eigen websitecomponent bepaald.</span></div>
        </section>
        @if (categoryDependencyWarning()) {
          <section class="category-dependency-warning" role="alert">
            <div><b>Uitgelichte producten niet volledig geladen</b><span>{{ categoryDependencyWarning() }}</span></div>
            <button class="btn" type="button" [disabled]="loadingSettings()" (click)="load()">Opnieuw laden</button>
          </section>
        }
      </div>
    }

    @if (!websiteCategoryMode) {
    <div class="content set-page">
      @if (desktop.active()) {
        <nav class="wk-subbar set-subbar" aria-label="Onderdelen van Instellingen">
          <div class="set-tabs" #tabStrip>
            @for (tab of tabs(); track tab.id) {
              <a class="wk-chip" routerLink="/settings" [queryParams]="viewQuery(tab.id)" [replaceUrl]="true"
                 [class.is-on]="view() === tab.id" [attr.aria-current]="view() === tab.id ? 'page' : null"
                 [attr.data-view]="tab.id">{{ tab.tab }}@if (viewDirty(tab.id)) {<i class="set-dot" aria-label="niet opgeslagen"></i>}</a>
            }
          </div>
        </nav>
      }

      @if (visited().has('overview')) {
        <app-settings-overview class="mo-fade" [hidden]="view() !== 'overview'" [active]="view() === 'overview'"
                               [douaneRoute]="douaneRoute" [legalView]="views.includes('legal')" />
      }

      @if (visited().has('company')) {
        <app-settings-company class="mo-fade" [hidden]="view() !== 'company'" />
      }

      @if (visited().has('legal')) {
        <app-settings-legal class="mo-fade" [hidden]="view() !== 'legal'" />
      }

      @if (visited().has('website')) {
      <section class="set-view mo-fade" [hidden]="view() !== 'website'" aria-label="Prijzen op de website">
        @if (desktop.active()) {
        <div class="set-pair">
          <!-- The sync status shows once: inside the price card (B5). -->
          <div class="wk-card set-pane" id="website">
            <h2 class="set-pane__title">Prijzen op de website</h2>
            <app-website-quote-settings [refreshKey]="websiteSyncRefresh()" (saved)="refreshWebsiteSync()" />
          </div>
          <nav class="wk-card set-pane set-links" aria-label="Website en catalogus">
            <h2 class="set-pane__title">Website en catalogus</h2>
            <a routerLink="/website"><span><b>Website beheren</b><small>Indeling, teksten, SEO, producten en publicatie</small></span><app-icon name="chevron-right" [size]="16" /></a>
            <a routerLink="/website/categories"><span><b>Categorieën en menunamen</b><small>Volgorde, uitgelicht product en namen per taal</small></span><app-icon name="chevron-right" [size]="16" /></a>
            <a routerLink="/categories"><span><b>Categorieën · foto’s</b><small>De foto’s van elke collectie</small></span><app-icon name="chevron-right" [size]="16" /></a>
            <a routerLink="/catalog/texts"><span><b>Catalogusteksten per taal</b><small>Teksten van de catalogus-pdf</small></span><app-icon name="chevron-right" [size]="16" /></a>
          </nav>
        </div>
        } @else {
        <!-- Phone: the same two groups as inset groups -->
        <div class="set-ios">
          <app-website-quote-settings variant="ios" [refreshKey]="websiteSyncRefresh()" (saved)="refreshWebsiteSync()" />
          <section class="ios-section">
            <div class="ios-section__head"><h2>Website en catalogus</h2></div>
            <nav class="ios-group" aria-label="Website en catalogus">
              <a class="ios-cell" routerLink="/website"><span class="ios-cell__body"><span class="ios-cell__title">Website beheren</span><span class="ios-cell__sub set-ios__text">Indeling, teksten, SEO, producten en publicatie</span></span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></a>
              <a class="ios-cell" routerLink="/website/categories"><span class="ios-cell__body"><span class="ios-cell__title">Categorieën en menunamen</span><span class="ios-cell__sub set-ios__text">Volgorde, uitgelicht product en namen per taal</span></span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></a>
              <a class="ios-cell" routerLink="/categories"><span class="ios-cell__body"><span class="ios-cell__title">Categorieën · foto’s</span><span class="ios-cell__sub set-ios__text">De foto’s van elke collectie</span></span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></a>
              <a class="ios-cell" routerLink="/catalog/texts"><span class="ios-cell__body"><span class="ios-cell__title">Catalogusteksten per taal</span><span class="ios-cell__sub set-ios__text">Teksten van de catalogus-pdf</span></span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></a>
            </nav>
          </section>
        </div>
        }
      </section>
      }

      @if (visited().has('duties')) {
      <section class="set-view mo-fade" [hidden]="view() !== 'duties'" aria-label="Douane">
      @if (dutiesError(); as error) {
        <app-load-error [message]="error" [busy]="dutiesLoading()" (retry)="loadDuties()" />
      } @else if (dutiesLoading() && !hsCodes().length) {
        <div class="card"><div class="card__body"><app-skeleton kind="lines" [rows]="4" /></div></div>
      } @else {
      <!-- ======================================= douanetarieven -->
      <div [class.settings-section--folded]="folded('duties')" class="card settings-section" id="duties">
        <div (click)="toggleSection('duties', $event)" class="card__head settings-head"><h2>Douanetarieven</h2><span class="spacer"></span>
          <button class="btn btn--sm" type="button" (click)="addHsCode()">+</button></div>
        <div class="card__body">
          <div class="alert alert--warn" style="margin-bottom:14px">
            <span class="alert__icon">!</span>
            <div>
              Kijk deze percentages na in de <b>TARIC-databank</b> van de EU. Wat hier staat is
              configuratie, geen douaneadvies.
            </div>
          </div>
          @for (code of hsCodes(); track code.code) {
            <div style="border:1px solid var(--line);border-radius:var(--r-sm);
                        padding:10px 12px;margin-bottom:10px">
              <div class="row" style="margin-bottom:8px">
                <input class="input input--sm mono" style="max-width:140px" aria-label="HS-code"
                       [ngModel]="code.code" (ngModelChange)="code.code = $event" />
                <input class="input input--sm num right" style="max-width:80px" type="text"
                       inputmode="decimal" aria-label="Invoerrecht"
                       [value]="pctText(code.dutyRatePct)"
                       (change)="code.dutyRatePct = pctValue($any($event.target).value)" />
                <span class="small muted">%</span>
                <button class="btn btn--sm" type="button" (click)="saveHsCode(code)">✓</button>
                <button class="btn btn--sm btn--danger" type="button"
                        (click)="removeHsCode(code)">✕</button>
              </div>
              <input class="input input--sm" aria-label="Omschrijving" placeholder="Omschrijving"
                     [ngModel]="code.description" (ngModelChange)="code.description = $event" />
            </div>
          }
          <p class="small muted">
            Het invoerrecht geldt over de <b>douanewaarde</b>: goederen + lokale kosten China +
            zeevracht. De kosten vanaf de aankomsthaven vallen erbuiten.
          </p>
        </div>
      </div>
      }
      </section>
      }

      @if (visited().has('discounts')) {
      <section class="set-view set-disc mo-fade" [hidden]="view() !== 'discounts'" aria-label="Kortingen">
      @if (discountsError(); as error) {
        <app-load-error [message]="error" [busy]="discountsLoading()" (retry)="loadDiscounts()" />
      } @else if (discountsLoading() && !discountsLoaded()) {
        @if (desktop.active()) {
          <div class="disc__grid"><div class="wk-card disc-card"><app-skeleton kind="table" [rows]="4" /></div><div class="wk-card disc-card"><app-skeleton kind="table" [rows]="3" /></div></div>
        } @else { <app-skeleton kind="group" [rows]="4" /><app-skeleton kind="group" [rows]="3" /> }
      } @else if (desktop.active()) {
        <div class="disc">
          <div class="disc__grid">
            <!-- Orderkorting -->
            <section class="wk-card disc-card" aria-labelledby="disc-order-title" [class.disc-card--dirty]="orderTierChanges() > 0">
              <header class="disc-card__head">
                <div><h2 id="disc-order-title">Orderkorting</h2><p>Korting op de hele order zodra alle stuks samen een grens halen.</p></div>
              </header>
              @for (tier of orderTiers(); track $index; let tierIndex = $index) {
                <div class="tier">
                  <span>Vanaf</span>
                  <input class="set-input" type="number" min="1" step="50" inputmode="numeric" aria-label="Vanaf aantal"
                         [value]="tier.minQuantity" (input)="orderMinInput(tierIndex, $any($event.target).value)" (blur)="sortOrderTiers()" />
                  <span>stuks</span>
                  <span aria-hidden="true">→</span>
                  <input class="set-input" type="text" inputmode="decimal" aria-label="Kortingspercentage"
                         [value]="pctText(tier.percent)" (input)="orderPctInput(tierIndex, $any($event.target).value)"
                         (change)="updateOrderTier(tierIndex, { percent: pctValue($any($event.target).value) })" />
                  <span>%</span>
                  <button class="wk-btn wk-btn--icon wk-btn--ghost" type="button" aria-label="Drempel verwijderen" (click)="removeTier('ORDER', tierIndex)"><app-icon name="close" [size]="15" /></button>
                </div>
              } @empty {
                <p class="disc-none">Nog geen staffel.</p>
              }
              <footer class="disc-card__foot"><button class="wk-btn wk-btn--sm" type="button" (click)="addTier('ORDER')">+ Drempel</button></footer>
            </section>

            <!-- Lijnkorting per product -->
            <section class="wk-card disc-card" aria-labelledby="disc-line-title">
              <header class="disc-card__head">
                <div><h2 id="disc-line-title">Lijnkorting per product <span class="wk-pill">{{ lineDiscountGroups().length }} {{ lineDiscountGroups().length === 1 ? 'product' : 'producten' }}</span></h2>
                  <p>Iedere productvariant krijgt zijn eigen staffel. De drempel telt in de eenheid waarin het product verkocht wordt (display, diamant, stuk).</p></div>
                <button class="wk-btn wk-btn--sm" type="button" [disabled]="!discountPickerProducts().length" (click)="lineDiscountPicker.set(true)">+ Product</button>
              </header>
              @if (legacyLineTiers().length) {
                <div class="wk-banner wk-banner--warn wk-banner--inset disc-legacy" role="status">
                  <span class="wk-banner__text"><b>Oude algemene lijnkorting staat uit</b> · Deze {{ legacyLineTiers().length }} oude regel{{ legacyLineTiers().length === 1 ? '' : 's' }} wordt niet meer op alle producten toegepast.</span>
                  <span class="wk-banner__actions"><button class="wk-btn wk-btn--sm" type="button" (click)="removeLegacyLineTiers()">Opruimen</button></span>
                </div>
              }
              @if (lineDiscountGroups().length) {
                <div class="disc-products">
                  @for (group of lineDiscountGroups(); track group.productId) {
                    <article class="disc-product" [id]="'line-discount-' + group.productId" [class.disc-product--dirty]="lineChanges().has(group.productId)">
                      <header class="disc-product__head">
                        @if (discountPhotoUrl(group.product); as photo) {
                          <img class="disc-product__photo" [appAuthSrc]="photo" [alt]="group.product!.name" />
                        } @else {
                          <span class="disc-product__photo disc-product__photo--empty" aria-hidden="true">◈</span>
                        }
                        <div class="disc-product__id">
                          <h3 [attr.title]="group.product?.name || null">{{ group.product?.name || 'Verwijderd product #' + group.productId }}</h3>
                          <span>@if (group.product?.colour) { {{ group.product!.colour }} · }@if (group.product?.variantSize) { {{ group.product!.variantSize }} · }{{ group.product?.sku || 'Onbekende SKU' }}</span>
                          @if (group.product && supplierName(group.product); as supplier) { <small>{{ supplier }}</small> }
                        </div>
                        <button class="wk-btn wk-btn--icon wk-btn--ghost" type="button"
                                [attr.aria-label]="'Lijnkorting voor ' + (group.product?.name || group.productId) + ' verwijderen'"
                                (click)="removeLineDiscountProduct(group.productId, group.product?.name)"><app-icon name="close" [size]="15" /></button>
                      </header>
                      @for (tier of group.tiers; track tier.id ?? $index) {
                        <div class="tier tier--line">
                          <span>Vanaf</span>
                          <input class="set-input" type="number" min="1" step="1" inputmode="numeric"
                                 [attr.aria-label]="'Vanaf aantal voor ' + (group.product?.name || group.productId)"
                                 [value]="tier.minQuantity" (input)="lineMinInput(tier, $any($event.target).value)" />
                          <span>{{ unitWord(group.product) }}</span>
                          <span aria-hidden="true">→</span>
                          <input class="set-input" type="text" inputmode="decimal"
                                 [attr.aria-label]="'Kortingspercentage voor ' + (group.product?.name || group.productId)"
                                 [value]="pctText(tier.percent)" (input)="linePctInput(tier, $any($event.target).value)"
                                 (change)="updateLineTier(tier, { percent: pctValue($any($event.target).value) })" />
                          <span>%</span>
                          <button class="wk-btn wk-btn--icon wk-btn--ghost" type="button" aria-label="Drempel verwijderen" (click)="removeLineTier(tier)"><app-icon name="close" [size]="15" /></button>
                        </div>
                      }
                      <footer class="disc-product__foot"><button class="wk-btn wk-btn--sm" type="button" (click)="addLineTier(group.productId)">+ Drempel</button></footer>
                    </article>
                  }
                </div>
              } @else {
                <div class="wk-empty">
                  <div class="wk-empty__icon"><app-icon name="tag" [size]="22" /></div>
                  <h3 class="wk-empty__title">Nog geen productspecifieke korting</h3>
                  <p class="wk-empty__text">Kies een product en geef alleen dat product een staffel.</p>
                  <div class="wk-empty__actions"><button class="wk-btn wk-btn--primary" type="button" [disabled]="!discountPickerProducts().length" (click)="lineDiscountPicker.set(true)">Product kiezen</button></div>
                </div>
              }
            </section>
          </div>
        </div>
      } @else {
        <!-- Phone: inset groups; a tier opens a sheet -->
        <div class="disc-phone">
          @if (discountsDirty()) {
            <div class="ios-banner ios-banner--info mo-fade" role="status"><span>{{ discountsStatus() }}</span>
              <button class="disc-text-btn" type="button" (click)="revertDiscounts()">Wissen</button></div>
          }
          <section class="ios-section">
            <div class="ios-section__head"><h2>Orderkorting</h2></div>
            <div class="ios-group">
              @for (tier of orderTiers(); track $index; let tierIndex = $index) {
                <button class="ios-cell" type="button" (click)="openTier('ORDER', tierIndex)">
                  <span class="ios-cell__body"><span class="ios-cell__title">Vanaf {{ countText(tier.minQuantity) }} stuks</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value">{{ pctText(tier.percent) }} %</span></span>
                  <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                </button>
              }
              <button class="ios-cell ios-cell--action" type="button" (click)="addTier('ORDER'); openTier('ORDER', orderTiers().length - 1)">+ Drempel toevoegen</button>
            </div>
            <p class="ios-section__foot">Korting op de hele order zodra alle stuks samen een grens halen.</p>
          </section>
          <section class="ios-section">
            <div class="ios-section__head"><h2>Lijnkorting per product</h2><span class="ios-section__trail">{{ lineDiscountGroups().length }}</span></div>
            @if (legacyLineTiers().length) {
              <div class="ios-banner" role="status"><span>Oude algemene lijnkorting staat uit ({{ legacyLineTiers().length }})</span>
                <button class="disc-text-btn" type="button" (click)="removeLegacyLineTiers()">Opruimen</button></div>
            }
            @for (group of lineDiscountGroups(); track group.productId) {
              <div class="ios-group disc-phone__group" [class.disc-product--dirty]="lineChanges().has(group.productId)">
                <div class="ios-cell ios-cell--tall">
                  <span class="ios-cell__lead">
                    @if (discountPhotoUrl(group.product); as photo) { <img class="disc-product__photo" [appAuthSrc]="photo" alt="" /> }
                    @else { <span class="disc-product__photo disc-product__photo--empty" aria-hidden="true">◈</span> }
                  </span>
                  <span class="ios-cell__body">
                    <span class="ios-cell__title ios-cell__title--strong ios-cell__title--2">{{ group.product?.name || 'Verwijderd product #' + group.productId }}</span>
                    <span class="ios-cell__sub ios-cell__sub--2">{{ group.product?.sku || 'Onbekende SKU' }}@if (group.product && supplierName(group.product); as supplier) { · {{ supplier }} }</span>
                  </span>
                  <button class="ios-circle disc-phone__remove" type="button" [attr.aria-label]="'Lijnkorting voor ' + (group.product?.name || group.productId) + ' verwijderen'"
                          (click)="removeLineDiscountProduct(group.productId, group.product?.name)"><app-icon name="close" [size]="16" /></button>
                </div>
                @for (tier of group.tiers; track tier.id ?? $index) {
                  <button class="ios-cell" type="button" (click)="openLineTier(tier)">
                    <span class="ios-cell__body"><span class="ios-cell__title">Vanaf {{ countText(tier.minQuantity) }} {{ unitWord(group.product) }}</span></span>
                    <span class="ios-cell__trail"><span class="ios-cell__value">{{ pctText(tier.percent) }} %</span></span>
                    <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                  </button>
                }
                <button class="ios-cell ios-cell--action" type="button" (click)="addLineTier(group.productId)">+ Drempel</button>
              </div>
            }
            <div class="ios-group">
              <button class="ios-cell ios-cell--action" type="button" [disabled]="!discountPickerProducts().length" (click)="lineDiscountPicker.set(true)">+ Product kiezen</button>
            </div>
            <p class="ios-section__foot">De drempel telt in de eenheid waarin het product verkocht wordt (display, diamant, stuk).</p>
          </section>
        </div>
      }
      </section>
      }

      @if (visited().has('catalog-data')) {
      <section class="set-view mo-fade" [hidden]="view() !== 'catalog-data'" aria-label="Catalogusdata">
      <!-- The import result: one block for the desk card and the phone groups -->
      <ng-template #workbookResultView>
          @if (workbookResult(); as result) {
            <div class="alert workbook-result" aria-live="polite"
                 [class.alert--ok]="!result.problems.length"
                 [class.alert--warn]="result.problems.length > 0">
              <span class="alert__icon">{{ result.problems.length ? '!' : '✓' }}</span>
              <div>
                <b>{{ result.problems.length ? 'Import afgerond met aandachtspunten' : 'Excel succesvol geïmporteerd' }}</b>
                <div class="small workbook-result__summary">
                  {{ result.updatedProducts }} productregels verwerkt ·
                  {{ result.updatedRows }} vertaalregels bijgewerkt
                </div>
                @if (result.problems.length) {
                  <details class="workbook-problems">
                    <summary>{{ result.problems.length }} {{ result.problems.length === 1 ? 'melding' : 'meldingen' }} bekijken</summary>
                    <ul>
                      @for (problem of result.problems; track $index) { <li>{{ problem }}</li> }
                    </ul>
                  </details>
                }
              </div>
            </div>
          }
      </ng-template>
      @if (desktop.active()) {
      <div class="set-pair set-pair--side">
      <!-- ======================================= catalogus in Excel -->
      <div [class.settings-section--folded]="folded('catalog-data')" class="card settings-section workbook-card" id="catalog-data">
        <div (click)="toggleSection('catalog-data', $event)" class="card__head settings-head workbook-card__head">
          <div><span class="workbook-badge" aria-hidden="true">XLSX</span><h2>Producten in Excel (importeren / exporteren)</h2></div>
        </div>
        <div class="card__body">
          <p class="workbook-intro">
            Bewerk productteksten, maten, barcodes, prijzen en publicatie in één duidelijk
            Excel-bestand. Kolomfilters, vaste kopregels en dropdowns staan al voor je klaar.
            Ook vertalingen staan in dezelfde export.
          </p>

          <ol class="workbook-steps" aria-label="Werkwijze Excel-import">
            <li><span>1</span><div><b>Download</b><small>Begin altijd met de nieuwste export.</small></div></li>
            <li><span>2</span><div><b>Bewerk</b><small>
              Producten staan op duidelijke tabbladen. Vertalingen staan apart.
            </small></div></li>
            <li><span>3</span><div><b>Importeer</b><small>Problemen worden per rij gemeld; onbekende SKU's worden niet aangemaakt.</small></div></li>
          </ol>

          <div class="workbook-safety">
            <b>SKU niet wijzigen.</b>
            <span>
              De SKU koppelt elke rij aan het juiste product. Categorie, leverancier,
              voorraad, extra eenheidskosten en landed cost beheer je in het ERP, niet in Excel.
            </span>
          </div>

          <div class="workbook-actions">
            <button class="btn btn--primary" type="button" [disabled]="exportingWorkbook()"
                    (click)="exportWorkbook()">
              {{ exportingWorkbook() ? 'Excel maken…' : 'Excel downloaden' }}
            </button>
            <button class="btn" type="button" [disabled]="importingWorkbook()"
                    (click)="workbookFile.click()">Excel importeren…</button>
            <input #workbookFile type="file"
                   accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                   hidden (change)="selectWorkbook($any($event.target))" />
          </div>

          @if (selectedWorkbook(); as file) {
            <div class="workbook-selection">
              <div class="workbook-selection__file">
                <span class="workbook-file-icon" aria-hidden="true">X</span>
                <div><b>{{ file.name }}</b><small>{{ fileSize(file.size) }}</small></div>
              </div>
              <div class="workbook-selection__actions">
                <button class="btn btn--sm" type="button" [disabled]="importingWorkbook()"
                        (click)="clearWorkbookSelection()">Annuleren</button>
                <button class="btn btn--sm btn--primary" type="button"
                        [disabled]="importingWorkbook()" (click)="importWorkbook()">
                  {{ importingWorkbook() ? 'Controleren en importeren…' : 'Controleren en importeren' }}
                </button>
              </div>
            </div>
          }

          <ng-container [ngTemplateOutlet]="workbookResultView" />


        </div>
      </div>
      <div class="set-side">
        <!-- Photos are not master data, but they are exported from the
               same place: one ZIP with a folder per product. -->
          <button class="photo-export-row" type="button" aria-haspopup="dialog"
                  (click)="photoExportOpen.set(true)">
            <span class="photo-export-row__badge" aria-hidden="true">ZIP</span>
            <span class="photo-export-row__copy">
              <b>Productfoto’s exporteren (ZIP)</b>
              <small>Originele foto’s per product in een eigen map, met een LEESMIJ-bestand. Zonder prijzen.</small>
            </span>
            <i aria-hidden="true">›</i>
          </button>
        <a class="photo-export-row" routerLink="/catalog/texts">
          <span class="photo-export-row__badge" aria-hidden="true">TXT</span>
          <span class="photo-export-row__copy"><b>Catalogusteksten per taal</b><small>De teksten van de catalogus-pdf in elke taal.</small></span>
          <i aria-hidden="true">›</i>
        </a>
      </div>
      </div>
      } @else {
      <!-- Phone: the same steps, note, actions and exports as inset groups -->
      <div class="set-ios">
        <section class="ios-section">
          <div class="ios-section__head"><h2>Producten in Excel</h2></div>
          <div class="ios-group">
            <div class="ios-cell ios-cell--tall">
              <span class="ios-cell__lead"><span class="workbook-badge" aria-hidden="true">XLSX</span></span>
              <span class="ios-cell__body">
                <span class="ios-cell__title ios-cell__title--strong">Importeren en exporteren</span>
                <span class="ios-cell__sub set-ios__text">Bewerk productteksten, maten, barcodes, prijzen en publicatie in één duidelijk Excel-bestand. Kolomfilters, vaste kopregels en dropdowns staan al voor je klaar. Ook vertalingen staan in dezelfde export.</span>
              </span>
            </div>
            <div class="ios-cell"><span class="ios-cell__lead"><span class="set-ios__step" aria-hidden="true">1</span></span>
              <span class="ios-cell__body"><span class="ios-cell__title">Download</span><span class="ios-cell__sub set-ios__text">Begin altijd met de nieuwste export.</span></span></div>
            <div class="ios-cell"><span class="ios-cell__lead"><span class="set-ios__step" aria-hidden="true">2</span></span>
              <span class="ios-cell__body"><span class="ios-cell__title">Bewerk</span><span class="ios-cell__sub set-ios__text">Producten staan op duidelijke tabbladen. Vertalingen staan apart.</span></span></div>
            <div class="ios-cell"><span class="ios-cell__lead"><span class="set-ios__step" aria-hidden="true">3</span></span>
              <span class="ios-cell__body"><span class="ios-cell__title">Importeer</span><span class="ios-cell__sub set-ios__text">Problemen worden per rij gemeld; onbekende SKU's worden niet aangemaakt.</span></span></div>
          </div>
        </section>
        <div class="workbook-safety">
          <b>SKU niet wijzigen.</b>
          <span>De SKU koppelt elke rij aan het juiste product. Categorie, leverancier, voorraad, extra eenheidskosten en landed cost beheer je in het ERP, niet in Excel.</span>
        </div>
        <section class="ios-section">
          <div class="ios-group">
            <button class="ios-cell ios-cell--action" type="button" [disabled]="exportingWorkbook()" (click)="exportWorkbook()">
              {{ exportingWorkbook() ? 'Excel maken…' : 'Excel downloaden' }}</button>
            <button class="ios-cell ios-cell--action" type="button" [disabled]="importingWorkbook()" (click)="workbookFile.click()">Excel importeren…</button>
          </div>
          <input #workbookFile type="file"
                 accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                 hidden (change)="selectWorkbook($any($event.target))" />
        </section>
        @if (selectedWorkbook(); as file) {
          <section class="ios-section">
            <div class="ios-group">
              <div class="ios-cell">
                <span class="ios-cell__lead"><span class="workbook-file-icon" aria-hidden="true">X</span></span>
                <span class="ios-cell__body"><span class="ios-cell__title set-ios__text">{{ file.name }}</span><span class="ios-cell__sub">{{ fileSize(file.size) }}</span></span>
              </div>
              <button class="ios-cell ios-cell--action" type="button" [disabled]="importingWorkbook()" (click)="importWorkbook()">
                {{ importingWorkbook() ? 'Controleren en importeren…' : 'Controleren en importeren' }}</button>
              <button class="ios-cell" type="button" [disabled]="importingWorkbook()" (click)="clearWorkbookSelection()">Annuleren</button>
            </div>
          </section>
        }
        <div class="set-ios__result"><ng-container [ngTemplateOutlet]="workbookResultView" /></div>
        <section class="ios-section">
          <div class="ios-group">
            <!-- Photos are not master data, but they are exported from the same place. -->
            <button class="ios-cell" type="button" aria-haspopup="dialog" (click)="photoExportOpen.set(true)">
              <span class="ios-cell__lead"><span class="photo-export-row__badge" aria-hidden="true">ZIP</span></span>
              <span class="ios-cell__body"><span class="ios-cell__title">Productfoto’s exporteren (ZIP)</span>
                <span class="ios-cell__sub set-ios__text">Originele foto’s per product in een eigen map, met een LEESMIJ-bestand. Zonder prijzen.</span></span>
              <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
            </button>
            <a class="ios-cell" routerLink="/catalog/texts">
              <span class="ios-cell__lead"><span class="photo-export-row__badge" aria-hidden="true">TXT</span></span>
              <span class="ios-cell__body"><span class="ios-cell__title">Catalogusteksten per taal</span>
                <span class="ios-cell__sub set-ios__text">De teksten van de catalogus-pdf in elke taal.</span></span>
              <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
            </a>
          </div>
        </section>
      </div>
      }
      </section>
      }

      @if (visited().has('device')) {
      <section class="set-view mo-fade" [hidden]="view() !== 'device'" aria-label="Dit toestel">
      @if (desktop.active()) {
      <div class="set-pair">
      <!-- ============== app on this device: looks and notifications -->
      <div [class.settings-section--folded]="folded('appearance')" class="card settings-section" id="appearance" [class.set-focus]="focusRing() === 'appearance'">
        <div (click)="toggleSection('appearance', $event)" class="card__head settings-head"><h2>Weergave</h2></div>
        <div class="card__body">
          <p class="small muted" style="margin-bottom:12px">De accentkleur van de app: knoppen, actieve menu-items en markeringen. Geldt op dit toestel.</p>
          <div class="theme-picker" role="radiogroup" aria-label="Kleurschema">
            @for (option of themes; track option.key) {
              <button class="theme-picker__option" type="button" role="radio"
                      [class.theme-picker__option--active]="theme.current() === option.key"
                      [attr.aria-checked]="theme.current() === option.key"
                      (click)="theme.set(option.key)">
                <i class="theme-picker__swatch" [style.background]="option.swatch" aria-hidden="true"></i>
                <span>{{ option.label }}</span>
              </button>
            }
          </div>
        </div>
      </div>

      <!-- ======================================= meldingen op dit toestel -->
      <div [class.settings-section--folded]="folded('notifications')" class="card settings-section" id="notifications" [class.set-focus]="focusRing() === 'notifications'">
        <div (click)="toggleSection('notifications', $event)" class="card__head settings-head"><h2>Meldingen op dit toestel</h2></div>
        <div class="card__body">
          <p class="small muted" style="margin-bottom:12px">
            Een melding bij elke nieuwe offerte of factuur (mét kassageluid), inkooporder,
            contactaanvraag, login-aanvraag, product en agendapunt — en elke ochtend om 9u wat er die dag gepland staat.
            Op iPhone werkt dit zodra de app op het beginscherm staat.
          </p>
          @if (!push.supported()) {
            <p class="small warn-text">Deze browser ondersteunt geen meldingen.</p>
          } @else if (push.enabled()) {
            <div class="push-actions">
              <span class="badge badge--ok">Meldingen staan aan op dit toestel</span>
              <button class="btn btn--sm" type="button" [disabled]="push.busy()"
                      (click)="disablePush()">Uitzetten</button>
            </div>
          } @else {
            <button class="btn btn--primary" type="button" [disabled]="push.busy()"
                    (click)="enablePush()">
              {{ push.busy() ? 'Bezig…' : 'Meldingen aanzetten op dit toestel' }}
            </button>
          }
          @if (push.enabled() || pushDevices().length) {
            <div class="push-actions mt-12">
              <button class="btn btn--sm" type="button" [disabled]="push.busy()"
                      (click)="testPush()">Stuur testmelding</button>
              <span class="small muted">Naar alle aangemelde toestellen.</span>
            </div>
          }
          @if (pushDevices().length) {
            <div class="push-devices" aria-label="Aangemelde toestellen">
              @for (device of pushDevices(); track device.id) {
                <div class="push-device">
                  <b>{{ device.device }}@if (device.since) { · aangemeld sinds {{ device.since | dateNl }} }</b>
                  <span>
                    @if (device.lastStatus === null) { nog geen melding gestuurd }
                    @else if (device.lastStatus >= 200 && device.lastStatus < 300) {
                      laatste melding door pushdienst geaccepteerd
                    } @else { laatste melding geweigerd ({{ device.lastStatus }}) }
                    @if (device.lastAt) { · {{ device.lastAt | dateTimeNl }} }
                  </span>
                </div>
              }
            </div>
          }
          @if (pushDevicesError(); as error) {
            <div class="push-error" role="alert">
              <div><b>Aangemelde toestellen konden niet worden geladen</b><small>{{ error }}</small></div>
              <button class="btn btn--sm" type="button" [disabled]="pushDevicesLoading()"
                      (click)="loadPushDevices()">Opnieuw proberen</button>
            </div>
          } @else if (pushDevicesLoading()) {
            <p class="small muted mt-12" role="status">Aangemelde toestellen laden…</p>
          } @else if (pushDevicesLoaded() && !pushDevices().length) {
            <p class="small muted mt-12" role="status">Nog geen toestellen aangemeld. Zet meldingen aan op elke gsm waarop je ze wilt ontvangen.</p>
          }
          @if (pushActionError()) {
            <div class="push-error" role="alert">
              <div><b>Meldingsactie mislukt</b><small>{{ pushActionError() }}</small></div>
              <button class="btn btn--sm" type="button" [disabled]="push.busy()"
                      (click)="retryPushAction()">Opnieuw proberen</button>
            </div>
          }
          <div class="push-sounds">
            <button class="btn btn--sm" type="button" (click)="previewSound('sale-quote')">
              Geluid nieuwe offerte
            </button>
            <button class="btn btn--sm" type="button" (click)="previewSound('sale-invoice')">
              Geluid nieuwe factuur
            </button>
          </div>
        </div>
      </div>
      </div>
      } @else {
      <!-- Phone: Weergave and Meldingen as inset groups; the same flows -->
      <div class="set-ios">
        <section class="ios-section" id="appearance">
          <div class="ios-section__head"><h2>Weergave</h2></div>
          <div class="ios-group set-ios__themes" role="radiogroup" aria-label="Kleurschema" [class.set-focus]="focusRing() === 'appearance'">
            @for (option of themes; track option.key) {
              <button class="ios-cell" type="button" role="radio" [attr.aria-checked]="theme.current() === option.key" (click)="theme.set(option.key)">
                <span class="ios-cell__lead"><i class="set-ios__swatch" [style.background]="option.swatch" aria-hidden="true"></i></span>
                <span class="ios-cell__body"><span class="ios-cell__title">{{ option.label }}</span></span>
                @if (theme.current() === option.key) { <app-icon class="ios-cell__tick" name="tick" [size]="18" /> }
              </button>
            }
          </div>
          <p class="ios-section__foot">De accentkleur van de app: knoppen, actieve menu-items en markeringen. Geldt op dit toestel.</p>
        </section>

        <section class="ios-section" id="notifications">
          <div class="ios-section__head"><h2>Meldingen op dit toestel</h2></div>
          <div class="ios-group" [class.set-focus]="focusRing() === 'notifications'">
            @if (!push.supported()) {
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Meldingen</span>
                <span class="ios-cell__sub set-ios__text warn-text">Deze browser ondersteunt geen meldingen.</span></span></div>
            } @else {
              <label class="ios-cell">
                <span class="ios-cell__body"><span class="ios-cell__title" id="push-switch-label">Meldingen</span>
                  <span class="ios-cell__sub">{{ push.busy() ? 'Bezig…' : push.enabled() ? 'Staan aan op dit toestel' : 'Staan uit op dit toestel' }}</span></span>
                <input class="ios-switch" type="checkbox" role="switch" aria-labelledby="push-switch-label"
                       [checked]="push.enabled()" [disabled]="push.busy()"
                       (click)="$event.preventDefault(); push.enabled() ? disablePush() : enablePush()" />
              </label>
            }
            @if (push.enabled() || pushDevices().length) {
              <button class="ios-cell ios-cell--action" type="button" [disabled]="push.busy()" (click)="testPush()">
                <span class="ios-cell__body"><span class="ios-cell__title">Stuur testmelding</span><span class="ios-cell__sub">Naar alle aangemelde toestellen.</span></span>
              </button>
            }
            <button class="ios-cell ios-cell--action" type="button" (click)="previewSound('sale-quote')">Geluid nieuwe offerte</button>
            <button class="ios-cell ios-cell--action" type="button" (click)="previewSound('sale-invoice')">Geluid nieuwe factuur</button>
          </div>
          <p class="ios-section__foot">Een melding bij elke nieuwe offerte of factuur (mét kassageluid), inkooporder,
            contactaanvraag, login-aanvraag, product en agendapunt — en elke ochtend om 9u wat er die dag gepland staat.
            Op iPhone werkt dit zodra de app op het beginscherm staat.</p>
        </section>

        @if (pushActionError()) {
          <div class="ios-banner ios-banner--danger" role="alert">
            <span><b>Meldingsactie mislukt</b><br />{{ pushActionError() }}</span>
            <button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button" [disabled]="push.busy()" (click)="retryPushAction()">Opnieuw proberen</button>
          </div>
        }

        @if (pushDevices().length || pushDevicesError() || pushDevicesLoading() || pushDevicesLoaded()) {
          <section class="ios-section">
            <div class="ios-section__head"><h2>Aangemelde toestellen</h2>
              @if (pushDevices().length) { <span class="ios-section__trail">{{ pushDevices().length }}</span> }</div>
            <div class="ios-group" aria-label="Aangemelde toestellen">
              @for (device of pushDevices(); track device.id) {
                <div class="ios-cell">
                  <span class="ios-cell__body">
                    <span class="ios-cell__title set-ios__text">{{ device.device }}</span>
                    @if (device.since) { <span class="ios-cell__sub">aangemeld sinds {{ device.since | dateNl }}</span> }
                    <span class="ios-cell__sub set-ios__text">
                      @if (device.lastStatus === null) { nog geen melding gestuurd }
                      @else if (device.lastStatus >= 200 && device.lastStatus < 300) {
                        laatste melding door pushdienst geaccepteerd
                      } @else { laatste melding geweigerd ({{ device.lastStatus }}) }
                      @if (device.lastAt) { · {{ device.lastAt | dateTimeNl }} }
                    </span>
                  </span>
                </div>
              }
              @if (pushDevicesError(); as error) {
                <div class="ios-cell" role="alert"><span class="ios-cell__body">
                  <span class="ios-cell__title set-ios__text">Aangemelde toestellen konden niet worden geladen</span>
                  <span class="ios-cell__sub set-ios__text">{{ error }}</span></span></div>
                <button class="ios-cell ios-cell--action" type="button" [disabled]="pushDevicesLoading()" (click)="loadPushDevices()">Opnieuw proberen</button>
              } @else if (pushDevicesLoading() && !pushDevices().length) {
                <div class="ios-cell" role="status"><span class="ios-cell__sub">Aangemelde toestellen laden…</span></div>
              } @else if (pushDevicesLoaded() && !pushDevices().length) {
                <div class="ios-cell" role="status"><span class="ios-cell__sub set-ios__text">Nog geen toestellen aangemeld. Zet meldingen aan op elke gsm waarop je ze wilt ontvangen.</span></div>
              }
            </div>
          </section>
        }
      </div>
      }
      </section>
      }
    </div>
    } @else {
    <div class="content settings-content settings-content--website">
      @if (settingsLoadError()) {
        <section class="settings-load-error" role="alert">
          <span aria-hidden="true">!</span>
          <div>
            <b>{{ websiteCategoryMode
              ? 'Categorieën konden niet worden geladen'
              : 'Instellingen konden niet volledig worden geladen' }}</b>
            <small>{{ settingsLoadError() }}</small>
          </div>
          <button class="btn" type="button" [disabled]="loadingSettings()" (click)="load()">
            {{ loadingSettings() ? 'Laden…' : 'Opnieuw laden' }}
          </button>
        </section>
      }
      <div [class.settings-section--folded]="folded('categories')" class="card settings-section category-section" id="categories">
        <div (click)="toggleSection('categories', $event)" class="card__head settings-head category-section__head">
          <div>
            <h2 id="categories-title">Productcategorieën</h2>
            <span class="category-count">
              {{ categories().length }} {{ categories().length === 1 ? 'categorie' : 'categorieën' }}
            </span>
          </div>
          <span class="spacer"></span>
          <button class="btn btn--sm btn--primary" type="button"
                  [disabled]="categoryDraft() !== null" (click)="addCategory()">
            Categorie toevoegen
          </button>
        </div>
        <div class="card__body">
          <p class="small muted category-intro">
            Deze lijst wordt overal gebruikt: in het ERP, de bestelapp en de website.
            Wijzigingen worden pas verwerkt wanneer je ze opslaat.
          </p>

          <app-website-sync-status [refreshKey]="websiteSyncRefresh()" />

          @if (categoryDraft(); as draft) {
            <section class="category-form" aria-labelledby="category-form-title">
              <div class="category-form__heading">
                <div>
                  <div class="eyebrow">{{ draft.id === null ? 'Nieuwe categorie' : 'Categorie bewerken' }}</div>
                  <h3 id="category-form-title">
                    {{ draft.id === null ? 'Voeg een categorie toe' : draft.name }}
                  </h3>
                </div>
                @if (draft.id !== null) {
                  <button class="btn btn--sm btn--danger" type="button"
                          [disabled]="savingCategory() || deletingCategoryId() === draft.id"
                          (click)="removeCategoryDraft()">
                    {{ deletingCategoryId() === draft.id ? 'Verwijderen…' : 'Verwijderen' }}
                  </button>
                }
                <button class="category-form__close" type="button" aria-label="Bewerken annuleren"
                        [disabled]="savingCategory()" (click)="cancelCategoryEdit()">
                  Sluiten
                </button>
              </div>

              <div class="category-form__grid">
                <div class="field category-form__name">
                  <label class="req" for="category-name">Naam</label>
                  <input class="input" id="category-name" autocomplete="off"
                         [ngModel]="draft.name"
                         (ngModelChange)="updateCategoryDraft({ name: $event })"
                         placeholder="Bijv. Geurkaarsen" />
                </div>
                <div class="field">
                  <label for="category-navigation-name">Korte navigatienaam (desktop) <span class="opt"></span></label>
                  <input class="input" id="category-navigation-name" maxlength="40"
                         [ngModel]="draft.navigationName"
                         (ngModelChange)="updateCategoryDraft({ navigationName: $event })"
                         placeholder="Bijv. Kaarsen" />
                  <span class="hint">Alleen gebruikt in de hoofdnavigatie van de website op desktop.</span>
                </div>
                <div class="field">
                  <label for="category-mobile-name">Korte mobiele naam <span class="opt"></span></label>
                  <input class="input" id="category-mobile-name" maxlength="40"
                         [ngModel]="draft.mobileName"
                         (ngModelChange)="updateCategoryDraft({ mobileName: $event })"
                         placeholder="Bijv. Kaarsen" />
                  <span class="hint">Alleen gebruikt waar de volledige naam niet netjes past.</span>
                </div>
                <div class="field">
                  <label for="category-footer-name">Naam in websitefooter <span class="opt"></span></label>
                  <input class="input" id="category-footer-name"
                         [ngModel]="draft.footerName"
                         (ngModelChange)="updateCategoryDraft({ footerName: $event })"
                         placeholder="Bijv. Geurkaarsen" />
                  <span class="hint">Leeg gebruikt de gewone categorienaam in de websitefooter.</span>
                </div>
                <div class="field">
                  <label for="category-eyebrow">Bovenregel website <span class="opt"></span></label>
                  <input class="input" id="category-eyebrow"
                         [ngModel]="draft.eyebrow"
                         (ngModelChange)="updateCategoryDraft({ eyebrow: $event })"
                         placeholder="Bijv. Onze signatuur" />
                  <span class="hint">
                    Korte tekst boven de categorietitel op de website; leeg betekent geen bovenregel.
                  </span>
                </div>
                <div class="field">
                  <label class="req" for="category-code">Vaste URL-code</label>
                  <input class="input mono" id="category-code" autocomplete="off"
                         [ngModel]="draft.code"
                         [readOnly]="draft.id !== null"
                         (ngModelChange)="updateCategoryDraft({ code: $event })"
                         (blur)="normalizeCategoryDraftCode()"
                         autocapitalize="none" spellcheck="false"
                         placeholder="display-roses" />
                  <span class="hint">
                    @if (draft.id === null) {
                      Kies deze permanente sleutel één keer bij het aanmaken. De categorietitel en vertalingen kunnen later wel veranderen.
                    } @else {
                      Permanent na aanmaak: deze sleutel houdt collectie- en menulinks stabiel. Voor een URL-migratie is een aparte redirect nodig.
                    }
                  </span>
                </div>
                <div class="field">
                  <label for="category-position">Volgorde</label>
                  <input class="input num" id="category-position" type="number" min="0" step="1"
                         [ngModel]="draft.position"
                         (ngModelChange)="updateCategoryDraft({ position: +$event })" />
                  <span class="hint">Lager nummer verschijnt eerst.</span>
                </div>
                <div class="field">
                  <label for="category-featured-product">Uitgelicht product <span class="opt"></span></label>
                  <select class="select" id="category-featured-product"
                          [ngModel]="draft.featuredProductId ?? null"
                          [disabled]="draft.id === null || !!categoryDependencyWarning()"
                          (ngModelChange)="updateCategoryDraft({ featuredProductId: numberOrNull($event) })">
                    <option [ngValue]="null">Automatisch</option>
                    @for (option of categoryFeaturedOptions(draft); track option.product.id) {
                      <option [ngValue]="option.product.id" [disabled]="!categoryOptionEligible(option)">
                        {{ productOptionLabel(option.product) }}{{ categoryEligibilityLabel(option) }}
                      </option>
                    }
                    @if (categoryDependencyWarning() && draft.featuredProductId !== null) {
                      <option [ngValue]="draft.featuredProductId" disabled>
                        Huidige keuze #{{ draft.featuredProductId }} · productgegevens niet geladen
                      </option>
                    } @else if (missingFeaturedProductId(draft) !== null) {
                      <option [ngValue]="missingFeaturedProductId(draft)" disabled>
                        SKU #{{ missingFeaturedProductId(draft) }} · geen publieke foto
                      </option>
                    }
                  </select>
                  <span class="hint">
                    @if (draft.id === null) {
                      Sla de categorie eerst op en koppel daarna producten.
                    } @else if (categoryDependencyWarning()) {
                      Laad de productgegevens opnieuw voordat u de featured SKU wijzigt.
                    } @else {
                      Actieve SKU die deze collectie visueel vertegenwoordigt.
                    }
                  </span>
                </div>
                <div class="field category-form__description">
                  <label for="category-description">Beschrijving <span class="opt"></span></label>
                  <textarea class="textarea" id="category-description" rows="3"
                            [ngModel]="draft.description"
                            (ngModelChange)="updateCategoryDraft({ description: $event })"
                            placeholder="Korte omschrijving voor catalogus, bestelapp en website…"></textarea>
                </div>

                <app-category-translation-editor
                  [category]="draft"
                  [busy]="savingCategory()"
                  [saveError]="categorySaveError()"
                  [initialLanguage]="categoryDeepLinkLanguage"
                  [focusField]="categoryDeepLinkFocus"
                  (categoryChange)="updateCategoryTranslations($event)"
                />
              </div>

              @if (categoryCodeExists(draft)) {
                <p class="category-form__error" role="alert">
                  Deze code bestaat al. Kies een unieke code.
                </p>
              } @else if (draft.code.trim() && !categoryCodeValid(draft)) {
                <p class="category-form__error" role="alert">
                  Vul minstens één letter of cijfer in voor de publieke URL-code.
                </p>
              }

              @if (categoryConflict()) {
                <div class="category-conflict" role="alert">
                  <span><b>Nieuwere categorieversie beschikbaar.</b> Je lokale invoer is niet overschreven.</span>
                  <div class="category-conflict__actions">
                    <button class="btn btn--sm" type="button" [disabled]="savingCategory()"
                            (click)="cancelCategoryEdit()">Formulier sluiten</button>
                    <button class="btn btn--sm btn--primary" type="button" [disabled]="savingCategory()"
                            (click)="reloadConflictedCategory()">Laatste versie laden</button>
                  </div>
                </div>
              } @else if (categorySaveError()) {
                <div class="category-conflict" role="alert">
                  <span><b>Categorie is nog niet opgeslagen.</b> {{ categorySaveError() }}</span>
                  <button class="btn btn--sm btn--primary" type="button"
                          [disabled]="savingCategory() || !categoryDraftValid()"
                          (click)="saveCategory()">Opnieuw opslaan</button>
                </div>
              }

              <div class="category-form__actions">
                <button class="btn" type="button" [disabled]="savingCategory()"
                        (click)="cancelCategoryEdit()">Annuleren</button>
                <button class="btn btn--primary" type="button"
                        [disabled]="!categoryDraftValid() || savingCategory() || categoryConflict()"
                        (click)="saveCategory()">
                  {{ savingCategory() ? 'Opslaan…' : (draft.id === null ? 'Categorie toevoegen' : 'Wijzigingen opslaan') }}
                </button>
              </div>
            </section>
          }

          @if (categories().length) {
            <div class="category-list" role="list" aria-labelledby="categories-title">
              @for (category of categories(); track category.id) {
                <article class="category-item" role="listitem"
                         [class.category-item--editing]="categoryDraft()?.id === category.id">
                  <div class="category-item__body">
                    <div class="category-item__title-row">
                      <h3>{{ category.name }}</h3>
                      <span class="badge badge--neutral mono">{{ category.code }}</span>
                    </div>
                    @if (category.description) {
                      <p>{{ category.description }}</p>
                    } @else {
                      <p class="category-item__empty">Nog geen beschrijving</p>
                    }
                    <span class="category-item__position">
                      Volgorde {{ category.position }}
                      @if (category.navigationName) { · desktop „{{ category.navigationName }}” }
                      @if (category.footerName) { · footer „{{ category.footerName }}” }
                      @if (category.mobileName) { · mobiel „{{ category.mobileName }}” }
                      @if (category.eyebrow) { · bovenregel „{{ category.eyebrow }}” }
                      @if (category.featuredProductId) {
                        · uitgelicht {{ featuredProductLabel(category.featuredProductId) }}
                      }
                    </span>
                  </div>
                  <div class="category-item__actions">
                    <!-- The order here is the order everywhere: catalogue,
                         stock, order app and website. -->
                    <span class="category-order" role="group" [attr.aria-label]="'Volgorde van ' + category.name">
                      <button class="category-order__btn" type="button" title="Omhoog"
                              [disabled]="reordering() || $index === 0"
                              [attr.aria-label]="category.name + ' omhoog'"
                              (click)="moveCategory(category.id!, -1)">↑</button>
                      <button class="category-order__btn" type="button" title="Omlaag"
                              [disabled]="reordering() || $index === categories().length - 1"
                              [attr.aria-label]="category.name + ' omlaag'"
                              (click)="moveCategory(category.id!, 1)">↓</button>
                    </span>
                    <button class="btn btn--sm" type="button"
                            [disabled]="categoryDraft() !== null || deletingCategoryId() === category.id"
                            (click)="editCategory(category)">Bewerken</button>
                  </div>
                </article>
              }
            </div>
          } @else {
            <div class="empty category-empty">
              <div class="empty__title">Nog geen productcategorieën</div>
              <p class="empty__text">Voeg de eerste categorie toe om producten eenduidig in te delen.</p>
              <button class="btn btn--primary" type="button" (click)="addCategory()">
                Eerste categorie toevoegen
              </button>
            </div>
          }
        </div>
      </div>
    </div>
    }

    @if (tierSheet(); as sheet) {
      <app-sheet [title]="sheet.scope === 'ORDER' ? 'Orderkorting' : 'Lijnkorting'" variant="ios" (closed)="tierSheet.set(null)">
        @if (sheetTier(); as tier) {
          <div body class="ios-group">
            <label class="disc-field"><span>Vanaf ({{ sheet.scope === 'ORDER' ? 'stuks' : sheetUnit() }})</span>
              <input type="number" min="1" step="1" inputmode="numeric" [value]="tier.minQuantity" (input)="sheetMin($any($event.target).value)" /></label>
            <label class="disc-field"><span>Korting (%)</span>
              <input type="text" inputmode="decimal" [value]="pctText(tier.percent)" (input)="sheetPct($any($event.target).value)" /></label>
          </div>
        }
        <div foot class="disc-sheet-foot">
          <button class="btn btn--danger" type="button" (click)="removeSheetTier()">Verwijderen</button>
          <button class="btn btn--primary" type="button" (click)="tierSheet.set(null)">Klaar</button>
        </div>
      </app-sheet>
    }

    @if (lineDiscountPicker()) {
      <app-product-picker
        heading="Product voor lijnkorting kiezen"
        [products]="discountPickerProducts()"
        [categories]="categories()"
        [families]="families()"
        [groupByFamily]="true"
        [preserveSourceOrder]="true"
        [selectionOnly]="true"
        [showPrice]="false"
        [stockAware]="false"
        [supplierNameOf]="discountSupplierNameOf"
        (picked)="chooseDiscountProduct($event.product)"
        (cancelled)="lineDiscountPicker.set(false)"
      />
    }

    @if (photoExportOpen()) {
      <app-photo-export-sheet (closed)="photoExportOpen.set(false)" />
    }
  `,
  styles: `
    .website-category-nav { max-width: 1540px; padding-bottom: 0; }
    .category-ownership {
      display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;
      margin-bottom: 14px; padding: 14px; border: 1px solid var(--rose-line);
      border-radius: var(--r); background: var(--rose-soft);
    }
    .category-ownership > div { display: grid; gap: 3px; }
    .category-ownership b { color: var(--rose-dark); font-size: 15px; }
    .category-ownership span { color: var(--muted); font-size: 14px; line-height: 1.45; }
    .category-dependency-warning { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 14px; padding: 12px 14px; border: 1px solid var(--warn); border-radius: var(--r-sm); background: var(--warn-soft); }
    .category-dependency-warning > div { display: grid; gap: 3px; }
    .category-dependency-warning b { color: var(--ink-2); font-size: 14px; }
    .category-dependency-warning span { color: var(--muted); font-size: 13px; line-height: 1.4; }
    .category-dependency-warning .btn { min-height: 48px; }
    .settings-content--website { max-width: 1540px; padding-top: 0; }
    .settings-load-error {
      display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px;
      margin-bottom: 14px; padding: 14px; border: 1px solid var(--danger); border-radius: var(--r-sm);
      background: var(--danger-soft); color: var(--danger);
    }
    .settings-load-error > span { display: grid; width: 38px; height: 38px; place-items: center;
      border-radius: 50%; background: var(--surface); font-size: 18px; font-weight: 800; }
    .settings-load-error > div { display: grid; gap: 3px; min-width: 0; }
    .settings-load-error b { font-size: 15px; }
    .settings-load-error small { color: var(--muted); font-size: 14px; line-height: 1.45; }
    .settings-load-error .btn { min-height: 48px; }
    .settings-content { padding-top: 12px; }
    .workbook-card { overflow: hidden; }
    /* Phone: the category card of /website/categories folds on its head. */
    @media (max-width: 679px) {
      .settings-content--website .settings-head { cursor: pointer; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
      .settings-content--website .settings-head::after { content: ''; width: 8px; height: 8px; margin-left: auto; flex: none;
        border-right: 1.8px solid var(--muted); border-bottom: 1.8px solid var(--muted);
        transform: rotate(45deg); transition: transform .15s ease; }
      .settings-content--website .settings-head .spacer { display: none; }
      .settings-section--folded .settings-head::after { transform: rotate(-45deg); }
      .settings-section--folded .card__body { display: none; }
      .settings-section--folded .settings-head .btn { display: none; }
      .settings-content--website > .category-section { margin-top: 10px; }
    }
    /* Settings views: one shows, the visited ones stay mounted and hidden (keep-alive). */
    .set-view { display: block; }
    .set-view[hidden], app-settings-overview[hidden] { display: none !important; }
    .set-view > .card + .card { margin-top: 16px; }
    .set-tabs { display: flex; gap: 6px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
    .set-tabs::-webkit-scrollbar { display: none; }
    .set-tabs .wk-chip { height: 30px; padding: 0 12px; font-size: 12.5px; text-decoration: none; }
    .set-dot { display: inline-block; width: 6px; height: 6px; margin-left: 2px; border-radius: 50%; background: var(--warn); }
    /* The toolbar save group: "● 2 wijzigingen niet opgeslagen · Wijzigingen wissen · Opslaan". */
    .set-dirty { display: inline-flex; align-items: center; gap: 6px; margin-right: 2px; color: var(--muted); font-size: 13px; white-space: nowrap; }
    .set-dirty .set-dot { margin: 0; }
    .set-dirty__n { font-variant-numeric: tabular-nums; }
    .set-dirty__text { margin-left: -3px; }
    @media (max-width: 1279.98px) { .set-dirty__text { display: none; } }
    .btn.set-ghost { border-color: transparent; background: transparent; }
    /* Website, Catalogusdata and Dit toestel: two cards side by side on the desk. */
    .set-pair { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
    .set-pair > .card, .set-pair > .wk-card { margin: 0; }
    @media (min-width: 1024px) { .set-pair { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .set-pair--side { grid-template-columns: minmax(0, 1fr) 340px; } }
    .set-pane { padding: 4px 16px 16px; }
    .set-pane__title { margin: 0; padding: 12px 0 10px; font-size: 15px; font-weight: 700; letter-spacing: -.01em; }
    .set-links { padding-bottom: 6px; }
    .set-links > a { display: flex; align-items: center; gap: 12px; min-height: 52px; margin: 0 -16px; padding: 8px 16px; border-top: 1px solid var(--line);
      color: var(--ink); text-decoration: none; }
    .set-links > a:hover { background: var(--surface-2); }
    .set-links > a > span { display: grid; flex: 1; gap: 1px; min-width: 0; }
    .set-links b { font-size: 13.5px; font-weight: 650; }
    .set-links small { color: var(--muted); font-size: 12px; }
    .set-links app-icon { color: var(--muted-2); }
    .set-side { display: grid; gap: 12px; }
    .set-side > .photo-export-row { margin: 0; text-decoration: none; }
    .set-focus { box-shadow: 0 0 0 2px var(--rose); transition: box-shadow var(--dur-2, 200ms) var(--ease-out, ease); }
    /* Phone: Website, Catalogusdata and Dit toestel as inset groups (.content already holds the side padding). */
    .set-ios { --ios-inset: 0px; }
    .set-ios .ios-banner { margin-inline: 0; }
    .set-ios__text { white-space: normal; overflow-wrap: anywhere; }
    .set-ios .ios-cell--action .ios-cell__title { color: inherit; }
    .set-ios__step { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: #dff5ec; color: #126645; font-size: 14px; font-weight: 750; }
    .set-ios__swatch { display: block; width: 26px; height: 26px; border: 1px solid rgb(0 0 0 / 12%); border-radius: 50%; }
    .set-ios__themes { --ios-sep-inset: 54px; }
    .set-ios > .workbook-safety { margin: -8px 0 22px; }
    .set-ios__result .workbook-result { margin: 0 0 22px; }
    .btn.set-ghost:hover:not(:disabled) { background: var(--surface-2); }
    .theme-picker { display: flex; flex-wrap: wrap; gap: 8px; }
    .theme-picker__option { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 14px 0 10px;
      border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--ink-2);
      font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; }
    .theme-picker__option:hover { background: var(--surface-2); }
    .theme-picker__option--active { border-color: var(--rose); background: var(--rose-soft); color: var(--rose-dark); box-shadow: inset 0 0 0 1px var(--rose); }
    .theme-picker__swatch { width: 18px; height: 18px; border-radius: 50%; border: 1px solid rgb(0 0 0 / 12%); }
    .workbook-card__head { background: linear-gradient(135deg, #effbf7, #fff); }
    .workbook-card__head > div { display: flex; align-items: center; gap: 9px; }
    .workbook-badge { padding: 4px 7px; border-radius: 5px; background: #16845b; color: #fff;
      font-size: 9px; font-weight: 800; letter-spacing: .08em; }
    .workbook-intro { margin-bottom: 14px; color: var(--ink-2); font-size: 13px; line-height: 1.55; }
    .workbook-steps { display: grid; gap: 8px; margin: 0 0 12px; padding: 0; list-style: none; }
    .workbook-steps li { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 10px;
      border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface-2); }
    .workbook-steps li > span { display: grid; flex: 0 0 28px; width: 28px; height: 28px;
      place-items: center; border-radius: 50%; background: #dff5ec; color: #126645; font-weight: 750; }
    .workbook-steps li div { min-width: 0; }
    .workbook-steps b, .workbook-steps small { display: block; }
    .workbook-steps b { font-size: 12.5px; }
    .workbook-steps small { margin-top: 2px; color: var(--muted); font-size: 11.5px; line-height: 1.35; }
    .workbook-safety { display: grid; gap: 2px; margin-bottom: 14px; padding: 11px 12px;
      border-left: 3px solid #16845b; border-radius: 0 var(--r-sm) var(--r-sm) 0; background: #effbf7;
      color: var(--ink-2); font-size: 11.5px; line-height: 1.45; }
    .workbook-safety b { color: #126645; font-size: 12px; }
    .workbook-actions { display: grid; gap: 8px; }
    .workbook-actions .btn { width: 100%; }
    .workbook-selection { display: grid; gap: 12px; margin-top: 12px; padding: 12px;
      border: 1px solid #9edbc5; border-radius: var(--r-sm); background: #f6fcfa; }
    .workbook-selection__file { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .workbook-selection__file div { min-width: 0; }
    .workbook-selection__file b { display: block; overflow: hidden; font-size: 12.5px;
      text-overflow: ellipsis; white-space: nowrap; }
    .workbook-selection__file small { display: block; margin-top: 2px; color: var(--muted); }
    .workbook-file-icon { display: grid; flex: 0 0 34px; width: 34px; height: 34px; place-items: center;
      border-radius: 8px; background: #16845b; color: #fff; font-weight: 800; }
    .workbook-selection__actions { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 7px; }
    .workbook-result { margin-top: 12px; }
    .photo-export-row { display: flex; align-items: center; gap: 11px; width: 100%; margin-top: 16px;
      padding: 12px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface-2);
      color: var(--ink); font: inherit; text-align: left; cursor: pointer; }
    .photo-export-row:hover { background: var(--surface); border-color: var(--line-strong); }
    .photo-export-row:focus-visible { outline: 2px solid var(--rose); outline-offset: 2px; }
    .photo-export-row__badge { flex: none; padding: 4px 7px; border-radius: 5px; background: var(--ink-2);
      color: #fff; font-size: 9px; font-weight: 800; letter-spacing: .08em; }
    .photo-export-row__copy { display: grid; flex: 1; gap: 2px; min-width: 0; }
    .photo-export-row__copy b { font-size: 13px; }
    .photo-export-row__copy small { color: var(--muted); font-size: 11.5px; line-height: 1.4; }
    .photo-export-row > i { flex: none; color: var(--muted); font-size: 18px; font-style: normal; }
    .workbook-result__summary { margin-top: 3px; }
    .workbook-problems { margin-top: 8px; }
    .workbook-problems summary { cursor: pointer; font-size: 12px; font-weight: 650; }
    .workbook-problems ul { display: grid; gap: 4px; margin: 7px 0 0; padding-left: 18px;
      font-size: 11.5px; line-height: 1.4; }
    .category-section__head > div:first-child { min-width: 0; }
    .category-count { display: block; margin-top: 2px; color: var(--muted); font-size: 11.5px; }
    .category-intro { margin-bottom: 14px; line-height: 1.5; }
    .category-form { margin-bottom: 14px; padding: 14px; border: 1px solid var(--rose-line);
      border-radius: var(--r); background: linear-gradient(145deg, var(--rose-soft), #fff 70%); }
    .category-form__heading { display: flex; align-items: flex-start; justify-content: space-between;
      gap: 12px; margin-bottom: 14px; }
    .category-form__heading h3 { margin-top: 2px; font-size: 16px; }
    .eyebrow { color: var(--rose-dark); font-size: 10.5px; font-weight: 750;
      letter-spacing: .09em; text-transform: uppercase; }
    .category-form__close { min-height: 36px; padding: 0 4px; border: 0; background: transparent;
      color: var(--muted); font-size: 12px; font-weight: 650; cursor: pointer; }
    .category-form__grid { display: grid; gap: 12px; }
    #category-code[readonly] { background: var(--surface-2); color: var(--muted); cursor: not-allowed; }
    .category-form__description { grid-column: 1 / -1; }
    .category-form__error { margin-top: 10px; color: var(--danger); font-size: 12.5px; font-weight: 600; }
    .category-conflict {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px;
      margin-top: 10px; padding: 10px 12px; border: 1px solid var(--danger); border-radius: 10px;
      color: var(--danger); background: var(--danger-soft); font-size: 14px; font-weight: 600;
    }
    .category-conflict > span { min-width: 0; line-height: 1.45; }
    .category-conflict__actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .category-form__actions { display: grid; grid-template-columns: 1fr; gap: 8px; margin-top: 14px; }
    .category-form__actions .btn { width: 100%; }
    .category-order { display: inline-flex; gap: 4px; margin-right: 4px; }
    .category-order__btn { display: inline-grid; place-items: center; width: 30px; height: 30px;
      border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink-2);
      font: inherit; font-size: 14px; cursor: pointer; }
    .category-order__btn:hover:not(:disabled) { background: var(--surface-2); }
    .category-order__btn:disabled { opacity: .35; cursor: default; }
    .category-list { overflow: hidden; border: 1px solid var(--line); border-radius: var(--r-sm); }
    .category-item { display: grid; gap: 12px; padding: 14px; border-bottom: 1px solid var(--line);
      background: var(--surface); }
    .category-item:last-child { border-bottom: 0; }
    .category-item--editing { background: var(--rose-soft); }
    .category-item__body { min-width: 0; }
    .category-item__title-row { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
    .category-item__title-row h3 { min-width: 0; font-size: 14.5px; }
    .category-item__body p { margin-top: 5px; color: var(--ink-2); font-size: 12.5px; line-height: 1.45; }
    .category-item__body .category-item__empty { color: var(--muted-2); font-style: italic; }
    .category-item__position { display: block; margin-top: 7px; color: var(--muted); font-size: 11px; }
    .category-item__actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
    .category-item__actions .btn { width: 100%; }
    .category-empty { padding-block: 30px; }
    @media (max-width: 520px) {
      .website-category-nav { padding-inline: 12px; }
      .category-ownership { grid-template-columns: 1fr; }
      .category-dependency-warning { align-items: stretch; flex-direction: column; }
      .category-dependency-warning .btn { width: 100%; }
      .settings-load-error { grid-template-columns: auto minmax(0, 1fr); }
      .settings-load-error .btn { grid-column: 1 / -1; width: 100%; }
      .category-section__head { align-items: flex-start; flex-wrap: wrap; }
      .category-section__head .spacer { display: none; }
      .category-section__head .btn { width: 100%; }
      .category-conflict, .category-conflict__actions { align-items: stretch; flex-direction: column; }
      .category-conflict .btn { width: 100%; min-height: 48px; }
    }
    @media (min-width: 680px) {
      .workbook-steps { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .workbook-steps li { align-items: flex-start; }
      .workbook-actions { grid-template-columns: auto auto; justify-content: flex-start; }
      .workbook-actions .btn { width: auto; }
      .workbook-selection { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
      .workbook-selection__actions { display: flex; }
      .category-form { padding: 18px; }
      .category-form__grid { grid-template-columns: minmax(0, 1fr) minmax(110px, .42fr); }
      .category-form__name { grid-column: 1 / -1; }
      .category-form__actions { grid-template-columns: auto auto; justify-content: flex-end; }
      .category-form__actions .btn { width: auto; }
      .category-item { grid-template-columns: minmax(0, 1fr) auto; align-items: center; padding: 15px 16px; }
      .category-item__actions { display: flex; }
      .category-item__actions .btn { width: auto; }
    }
    @media (min-width: 680px) {
      .settings-content { padding-top: 16px; }
      .settings-content--website { padding-top: 0; }
    }
    .push-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .push-devices { display: grid; gap: 5px; margin-top: 10px; }
    .push-device { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 12px; padding: 7px 10px;
      border: 1px solid var(--line); border-radius: 10px; background: var(--surface-2);
      font-size: 11px; }
    .push-device span { color: var(--muted); }
    .push-sounds { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .push-error { display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;
      padding:12px;border:1px solid var(--danger);border-radius:12px;background:var(--danger-soft);color:var(--danger) }
    .push-error>div { display:grid;gap:2px;min-width:0 }
    .push-error small { color:var(--muted);font-size:13px;line-height:1.45 }
    .push-error .btn { flex:none;min-height:48px }
  `,
})
export class SettingsPage implements AfterViewInit, OnDestroy {
  readonly push = inject(PushSetup);
  readonly pushActionError = signal<string | null>(null);
  private lastPushAction: 'enable' | 'disable' | 'test' = 'enable';

  async enablePush(): Promise<void> {
    this.lastPushAction = 'enable';
    this.pushActionError.set(null);
    try {
      const error = await this.push.enable();
      if (error) {
        this.pushActionError.set(error);
        this.ui.toast(error, 'err');
        return;
      }
      this.ui.toast('Meldingen aangezet — je krijgt zo een testmelding');
      this.lastPushAction = 'test';
      await this.push.sendTest();
      setTimeout(() => void this.loadPushDevices(), 4000);
    } catch (failure: unknown) {
      const message = messageOf(failure, 'Controleer de verbinding en de browsertoestemming.');
      this.pushActionError.set(message);
      this.ui.toast(message, 'err');
    }
  }

  async disablePush(): Promise<void> {
    this.lastPushAction = 'disable';
    this.pushActionError.set(null);
    try {
      await this.push.disable();
      await this.loadPushDevices();
      this.ui.toast('Meldingen uitgezet op dit toestel');
    } catch (failure: unknown) {
      const message = messageOf(failure, 'Meldingen uitzetten mislukt.');
      this.pushActionError.set(message);
      this.ui.toast(message, 'err');
    }
  }

  async testPush(): Promise<void> {
    this.lastPushAction = 'test';
    this.pushActionError.set(null);
    try {
      await this.push.sendTest();
      this.ui.toast('Testmelding onderweg');
      setTimeout(() => void this.loadPushDevices(), 4000);
    } catch (failure: unknown) {
      const message = messageOf(failure, 'Testmelding versturen mislukt.');
      this.pushActionError.set(message);
      this.ui.toast(message, 'err');
    }
  }

  retryPushAction(): void {
    if (this.lastPushAction === 'disable') void this.disablePush();
    else if (this.lastPushAction === 'test') void this.testPush();
    else void this.enablePush();
  }

  readonly pushDevices = signal<{ id: number; device: string; since?: string | null;
    lastStatus: number | null; lastAt: string | null }[]>([]);
  readonly pushDevicesLoaded = signal(false);
  readonly pushDevicesLoading = signal(false);
  readonly pushDevicesError = signal<string | null>(null);

  async loadPushDevices(): Promise<void> {
    this.pushDevicesLoading.set(true);
    this.pushDevicesError.set(null);
    try {
      this.pushDevices.set(await this.push.devices());
      this.pushDevicesLoaded.set(true);
    } catch (failure: unknown) {
      this.pushDevicesError.set(messageOf(failure, 'Controleer de verbinding en probeer opnieuw.'));
    } finally {
      this.pushDevicesLoading.set(false);
    }
  }

  previewSound(kind: string): void {
    void playSoundFor(kind);
  }

  readonly desktop = inject(DesktopViewport);
  readonly theme = inject(Theme);
  readonly themes = THEMES;
  readonly workbookResult = signal<CatalogImportResult | null>(null);
  readonly selectedWorkbook = signal<File | null>(null);
  readonly exportingWorkbook = signal(false);
  readonly importingWorkbook = signal(false);
  /** The product photo ZIP sheet; the same sheet opens from the product list. */
  readonly photoExportOpen = signal(false);
  readonly websiteSyncRefresh = signal(0);
  readonly loadingSettings = signal(true);
  readonly settingsLoadError = signal<string | null>(null);
  readonly categoryDependencyWarning = signal<string | null>(null);

  async exportWorkbook(): Promise<void> {
    if (this.exportingWorkbook()) return;
    this.exportingWorkbook.set(true);
    try {
      const date = new Intl.DateTimeFormat('sv-SE').format(new Date());
      saveBlob(await this.catalog.catalogWorkbook(), `enrosed-catalogus-${date}.xlsx`);
      this.ui.toast('Excel-bestand is gedownload', 'ok');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Excel exporteren mislukt'), 'err');
    } finally {
      this.exportingWorkbook.set(false);
    }
  }

  selectWorkbook(input: HTMLInputElement): void {
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      this.ui.toast('Kies een Excel-bestand met de extensie .xlsx', 'err');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      this.ui.toast('Dit Excel-bestand is groter dan 15 MB', 'err');
      return;
    }
    this.workbookResult.set(null);
    this.selectedWorkbook.set(file);
  }

  clearWorkbookSelection(): void {
    if (!this.importingWorkbook()) this.selectedWorkbook.set(null);
  }

  async importWorkbook(): Promise<void> {
    const file = this.selectedWorkbook();
    if (!file || this.importingWorkbook()) return;
    this.importingWorkbook.set(true);
    try {
      const result = await this.catalog.importCatalogWorkbook(file);
      this.workbookResult.set(result);
      this.selectedWorkbook.set(null);
      this.ui.toast(result.problems.length
        ? 'Excel geïmporteerd met aandachtspunten'
        : 'Catalogus bijgewerkt', result.problems.length ? 'err' : 'ok');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Excel importeren mislukt'), 'err');
    } finally {
      this.importingWorkbook.set(false);
    }
  }

  fileSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
    return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  }

  private readonly catalog = inject(CatalogApi);
  private readonly sales = inject(SalesApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly route = inject(ActivatedRoute);
  readonly websiteCategoryMode = this.route.snapshot.data['websiteCategoryMode'] === true;
  readonly categoryDeepLinkCode = this.route.snapshot.queryParamMap.get('category')?.trim() || null;
  readonly categoryDeepLinkLanguage = this.queryLanguage();
  readonly categoryDeepLinkFocus = this.queryCategoryFocus();
  readonly settingsBackTo = this.safeInternalRoute(
    this.route.snapshot.queryParamMap.get('returnTo'),
    '/more',
  );
  private categoryDeepLinkOpened = false;
  private readonly router = inject(Router);
  readonly companyStore = inject(CompanyStore);

  /** The views this build has (C3 adds the legal view). */
  readonly views: readonly SettingsView[] = AVAILABLE_VIEWS;
  /** Douane moves to the purchasing screen /douane once that route exists (B1). */
  readonly douaneRoute = this.router.config.some((route) => route.path === 'douane');
  private readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  /** The open view follows the query live: a query-only navigation reuses this component. */
  readonly view = computed<SettingsView>(() => settingsView(this.query().get('sectie'), this.views));
  readonly viewInfo = computed(() => settingsViewInfo(this.view()));
  readonly tabs = computed(() => settingsTabs({ douaneRoute: this.douaneRoute, available: this.views }));
  /** Views stay mounted after their first visit (hidden while another shows), so a draft survives a tab switch. */
  readonly visited = signal<ReadonlySet<SettingsView>>(new Set([this.view()]));
  /** Desk: the crumb "Instellingen ›" on every view. Phone: no parent, the back control follows the history (B9). */
  readonly headerParent = computed(() => this.view() === 'overview'
    ? null
    : this.desktop.active() ? { label: 'Instellingen', url: OVERVIEW_URL } : undefined);
  readonly headerBackTo = computed(() => this.view() === 'overview' ? this.settingsBackTo : OVERVIEW_URL);
  private readonly tabStrip = viewChild<ElementRef<HTMLElement>>('tabStrip');
  private readonly loadedViews = new Set<SettingsView>();

  viewQuery(view: SettingsView): Record<string, string> | null {
    return settingsViewQuery(view);
  }

  /* ---------------------------------------------- one save model per view */

  private readonly companyEditor = viewChild(SettingsCompany);
  readonly legalEditor = viewChild(SettingsLegal);
  readonly legalLanguages = LEGAL_LANGUAGES;

  /** The editor of a view: its draft, dirty count and save (see SettingsEditor). */
  editorFor(view: SettingsView): SettingsEditor | null {
    switch (view) {
      case 'discounts': return this.discountsLoaded() ? this.discountsEditor : null;
      case 'company': return this.companyEditor() ?? null;
      case 'legal': return this.legalEditor() ?? null;
      default: return null;
    }
  }

  readonly activeEditor = computed(() => this.editorFor(this.view()));
  /** Every mounted editor (keep-alive): the leave guard checks them all. */
  private readonly editors = computed(() =>
    this.views.map((view) => this.editorFor(view)).filter((editor): editor is SettingsEditor => !!editor));

  /** The warn dot on a tab whose view holds unsaved changes. */
  viewDirty(view: SettingsView): boolean {
    return !!this.editorFor(view)?.dirty();
  }

  dirtyText(editor: SettingsEditor): string {
    return dirtyStatusText(editor.dirtyCount());
  }

  /** The words after the count; below 1280 px only the dot and the count show. */
  dirtyWords(editor: SettingsEditor): string {
    return dirtyStatusText(editor.dirtyCount()).replace(/^\d+/, '');
  }

  saveEditor(editor: SettingsEditor): void {
    void editor.save();
  }

  /** ⌘S / Ctrl+S on the desk saves the open view, also while typing; not behind another component's overlay. */
  @HostListener('document:keydown', ['$event'])
  saveShortcut(event: KeyboardEvent): void {
    if (this.websiteCategoryMode || event.key.toLowerCase() !== 's' || event.altKey || event.shiftKey) return;
    if (!(event.metaKey || event.ctrlKey) || !this.desktop.active()) return;
    const editor = this.activeEditor();
    if (!editor) return;
    if (keyContext(event, this.host.nativeElement).overlayOpen) return;
    event.preventDefault();
    if (editor.dirty() && !editor.saving()) void editor.save();
  }

  /** Leaving /settings with unsaved views: Opslaan saves them all, Niet opslaan drops them. */
  private leaveEditors(): boolean | Promise<boolean> {
    const dirty = this.editors().filter((editor) => editor.dirty());
    if (dirty.some((editor) => editor.saving())) return false;
    if (!dirty.length) return true;
    return confirmLeave(this.ui, async () => {
      for (const editor of dirty) {
        if (!(await editor.save())) return false;
      }
      return true;
    });
  }

  /** A saved price switch queues a website rebuild; refresh every status on the page. */
  refreshWebsiteSync(): void {
    this.websiteSyncRefresh.update((value) => value + 1);
  }

  /** Phone: the category card on /website/categories folds on its head; settings views never fold. */
  readonly openSection = signal<string>('categories');
  folded(section: string): boolean {
    return this.websiteCategoryMode && !this.desktop.active() && this.openSection() !== section;
  }
  toggleSection(section: string, event: Event): void {
    if (!this.websiteCategoryMode || this.desktop.active()) return;
    /* A button or field in the head does its own job; the head only folds on the bare row. */
    if ((event.target as HTMLElement).closest('button, a, input, select, label')) return;
    this.openSection.set(this.openSection() === section ? '' : section);
  }

  readonly categories = signal<Category[]>([]);
  readonly products = signal<Product[]>([]);
  readonly families = signal<ProductFamily[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  readonly categoryDraft = signal<Category | null>(null);
  private readonly savedCategoryDraft = signal<Category | null>(null);
  readonly categoryDirty = computed(() =>
    JSON.stringify(this.categoryDraft()) !== JSON.stringify(this.savedCategoryDraft()));
  readonly savingCategory = signal(false);
  readonly categorySaveError = signal<string | null>(null);
  readonly categoryConflict = signal(false);
  readonly deletingCategoryId = signal<number | null>(null);
  readonly hsCodes = signal<HsCode[]>([]);
  private readonly lineTiers = signal<DiscountTier[]>([]);
  readonly orderTiers = signal<DiscountTier[]>([]);
  readonly lineDiscountPicker = signal(false);
  readonly savingLineProductId = signal<number | null>(null);
  readonly legacyLineTiers = computed(() =>
    this.lineTiers().filter((tier) => tier.productId == null));
  readonly lineDiscountGroups = computed(() => {
    const products = new Map(this.products().flatMap((product) =>
      product.id == null ? [] : [[product.id, product] as const]));
    const groups = new Map<number, DiscountTier[]>();
    for (const tier of this.lineTiers()) {
      if (tier.productId == null) continue;
      const current = groups.get(tier.productId) ?? [];
      current.push(tier);
      groups.set(tier.productId, current);
    }
    const productRank = new Map(this.products().flatMap((product, index) =>
      product.id == null ? [] : [[product.id, index] as const]));
    return [...groups.entries()]
      .map(([productId, tiers]) => ({
        productId,
        product: products.get(productId) ?? null,
        tiers: [...tiers].sort((left, right) => left.minQuantity - right.minQuantity),
      }))
      .sort((left, right) =>
        (productRank.get(left.productId) ?? Number.MAX_SAFE_INTEGER)
        - (productRank.get(right.productId) ?? Number.MAX_SAFE_INTEGER));
  });
  readonly discountPickerProducts = computed(() => {
    const configured = new Set(this.lineDiscountGroups().map((group) => group.productId));
    return this.products().filter((product) =>
      product.id != null && product.active && !product.demo && !configured.has(product.id));
  });
  readonly discountSupplierNameOf = (product: Product): string | null =>
    this.supplierName(product);
  /** The product's Hoofdfoto, the same photo quotes and invoices print. */
  discountPhotoUrl(product: Product | null): string | null {
    return product?.photos?.length ? salesPhotoUrl(product) : null;
  }

  constructor() {
    if (this.websiteCategoryMode) {
      void this.load();
      return;
    }
    /* The view follows the query: mark it visited, load what it needs, and move old deep links on. */
    effect(() => {
      const view = this.view();
      const params = this.query();
      untracked(() => {
        const redirect = settingsCategoryRedirect({
          sectie: params.get('sectie'),
          category: params.get('category'),
          language: params.get('language'),
          focus: params.get('focus'),
        });
        if (redirect) {
          void this.router.navigate([redirect.path], { queryParams: redirect.queryParams, replaceUrl: true });
          return;
        }
        if (params.get('sectie') === 'duties' && this.douaneRoute) {
          void this.router.navigate(['/douane'], { replaceUrl: true });
          return;
        }
        if (!this.visited().has(view)) this.visited.update((visited) => new Set([...visited, view]));
        this.ensureViewData(view);
        this.revealTab(view);
        if (view === 'device') this.focusDeviceCard(deviceFocus(params.get('sectie')));
      });
    });
  }

  ngAfterViewInit(): void {
    if (this.websiteCategoryMode) this.scrollToDeepLink();
  }

  /**
   * /website/categories?category=… opens that category; the page then
   * scrolls to the card. Runs again after the data lands, because the
   * blocks above it grow while loading and drag the anchor along.
   */
  private scrollToDeepLink(): void {
    const view = this.document.defaultView;
    this.openDeepLinkedCategory();
    if (!view || !this.websiteCategoryMode) return;
    view.setTimeout(() => this.scrollToSection('categories'), 150);
  }

  private openDeepLinkedCategory(): void {
    if (this.categoryDeepLinkOpened || !this.categoryDeepLinkCode || this.categoryDraft()) return;
    const category = this.categories().find((candidate) =>
      candidate.code === this.categoryDeepLinkCode);
    if (!category) return;
    this.categoryDeepLinkOpened = true;
    this.editCategory(category);
  }

  private queryLanguage(): LanguageCode {
    const requested = this.route.snapshot.queryParamMap.get('language')?.toUpperCase();
    return LANGUAGES.some((language) => language.code === requested)
      ? requested as LanguageCode
      : 'NL';
  }

  private queryCategoryFocus(): string | null {
    const focus = this.route.snapshot.queryParamMap.get('focus');
    return focus && CATEGORY_TRANSLATION_FOCUS.has(focus) ? focus : null;
  }

  private safeInternalRoute(value: string | null, fallback: string): string {
    return value?.startsWith('/') && !value.startsWith('//') ? value : fallback;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.focusTimer) clearTimeout(this.focusTimer);
  }
  private destroyed = false;

  /** Each view loads what it needs the first time it opens; the overview loads its own values. */
  private ensureViewData(view: SettingsView): void {
    if (this.loadedViews.has(view)) return;
    this.loadedViews.add(view);
    void this.loadViewData(view);
  }

  private loadViewData(view: SettingsView): Promise<unknown> {
    switch (view) {
      case 'company': return this.companyStore.load();
      case 'duties': return this.loadDuties();
      case 'discounts': return this.loadDiscounts();
      case 'device': return this.loadPushDevices();
      default: return Promise.resolve();
    }
  }

  /** Dit toestel opened for Meldingen (or Weergave): that card scrolls into view with a short accent ring. */
  readonly focusRing = signal<'notifications' | 'appearance' | null>(null);
  private focusTimer: ReturnType<typeof setTimeout> | null = null;

  private focusDeviceCard(card: 'notifications' | 'appearance' | null): void {
    if (!card) return;
    const win = this.document.defaultView;
    win?.requestAnimationFrame(() => {
      this.document.getElementById(card)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      this.focusRing.set(card);
      if (this.focusTimer) clearTimeout(this.focusTimer);
      this.focusTimer = setTimeout(() => this.focusRing.set(null), 1200);
    });
  }

  /** The current tab chip scrolls into view (the strip scrolls sideways at 1100 px). */
  private revealTab(view: SettingsView): void {
    const win = this.document.defaultView;
    win?.requestAnimationFrame(() => {
      const chip = this.tabStrip()?.nativeElement.querySelector<HTMLElement>(`[data-view="${view}"]`);
      chip?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  readonly dutiesLoading = signal(false);
  readonly dutiesError = signal<string | null>(null);

  async loadDuties(): Promise<void> {
    this.dutiesLoading.set(true);
    this.dutiesError.set(null);
    try {
      const hsCodes = await this.catalog.hsCodes();
      if (this.destroyed) return;
      this.hsCodes.set(hsCodes);
      this.savedHsCodes = new Set(hsCodes.map((code) => code.code));
    } catch (failure: unknown) {
      if (!this.destroyed) this.dutiesError.set(messageOf(failure, LOAD_ERROR_FALLBACK));
    } finally {
      this.dutiesLoading.set(false);
    }
  }

  readonly discountsLoading = signal(false);
  readonly discountsLoaded = signal(false);
  readonly discountsError = signal<string | null>(null);

  /** The tiers, plus what the product picker and the product cards need. */
  async loadDiscounts(): Promise<void> {
    void this.catalog.unitNames().catch(() => undefined);
    this.discountsLoading.set(true);
    this.discountsError.set(null);
    try {
      const [line, order, categories, products, families, suppliers] = await Promise.all([
        this.sales.tiers('LINE'), this.sales.tiers('ORDER'),
        this.catalog.categories().catch(() => []), this.catalog.products().catch(() => []),
        this.catalog.productFamilies().catch(() => []), this.sourcing.suppliers().catch(() => []),
      ]);
      if (this.destroyed) return;
      this.lineTiers.set(line);
      this.orderTiers.set(sortedTiers(order));
      this.savedLineTiers.set(line);
      this.savedOrderTiers.set(sortedTiers(order));
      this.categories.set(categories);
      this.products.set(products);
      this.families.set(families);
      this.suppliers.set(suppliers);
      this.discountsLoaded.set(true);
    } catch (failure: unknown) {
      if (!this.destroyed) this.discountsError.set(messageOf(failure, LOAD_ERROR_FALLBACK));
    } finally {
      this.discountsLoading.set(false);
    }
  }

  async load(): Promise<void> {
    if (!this.websiteCategoryMode) {
      /* Settings views: read again what the opened views show. */
      await Promise.all([...this.loadedViews].map((view) =>
        view === 'company' ? this.companyStore.load(true) : this.loadViewData(view)));
      return;
    }
    this.loadingSettings.set(true);
    this.settingsLoadError.set(null);
    this.categoryDependencyWarning.set(null);
    try {
      if (this.websiteCategoryMode) {
        let dependencyFailure = false;
        const [categories, products, families] = await Promise.all([
          this.catalog.categories(),
          this.catalog.products().catch(() => {
            dependencyFailure = true;
            return [];
          }),
          this.catalog.productFamilies().catch(() => {
            dependencyFailure = true;
            return [];
          }),
        ]);
        this.categories.set(categories.map((category) => ({
          ...category,
          revision: category.revision ?? null,
          texts: category.texts ?? [],
        })));
        this.products.set(products);
        this.families.set(families);
        if (dependencyFailure) {
          this.categoryDependencyWarning.set(
            'Categorieën kunt u blijven bewerken. De keuzelijst voor featured SKU’s is tijdelijk onvolledig.',
          );
        }
        this.scrollToDeepLink();
        return;
      }
    } catch (failure: unknown) {
      this.settingsLoadError.set(messageOf(
        failure,
        'Controleer de verbinding met Enrosed en probeer opnieuw.',
      ));
    } finally {
      this.loadingSettings.set(false);
    }
  }

  tiers(scope: 'LINE' | 'ORDER'): DiscountTier[] {
    return scope === 'LINE' ? this.lineTiers() : this.orderTiers();
  }

  scrollToSection(section: string): void {
    const view = this.document.defaultView;
    const target = this.document.getElementById(section);
    if (!view || !target) return;
    this.openSection.set(section);
    const targetTop = target.getBoundingClientRect().top + view.scrollY;
    view.scrollTo({ top: Math.max(0, targetTop - 8), behavior: 'smooth' });
  }

  /* ---------------------------------------------------- categorieen */

  readonly reordering = signal(false);

  /** One tap on an arrow: the whole order is written in one call. */
  async moveCategory(id: number, direction: -1 | 1): Promise<void> {
    const ids = this.categories().map((category) => category.id!) as number[];
    const index = ids.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    this.reordering.set(true);
    try {
      const fresh = await this.catalog.reorderCategories(ids);
      this.categories.set(fresh.map((category) => ({
        ...category,
        revision: category.revision ?? null,
        texts: category.texts ?? [],
      })));
      this.ui.toast('Volgorde aangepast', 'ok');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Volgorde aanpassen mislukt'), 'err');
    } finally {
      this.reordering.set(false);
    }
  }

  addCategory(): void {
    if (this.categoryDraft()) return;
    this.categorySaveError.set(null);
    this.categoryConflict.set(false);
    const lastPosition = Math.max(0, ...this.categories().map((category) => category.position));
    const draft: Category = {
      id: null,
      revision: null,
      code: '',
      name: '',
      navigationName: null,
      footerName: null,
      mobileName: null,
      eyebrow: null,
      description: '',
      texts: [],
      position: lastPosition + 1,
      featuredProductId: null,
    };
    this.savedCategoryDraft.set(structuredClone(draft));
    this.categoryDraft.set(draft);
  }

  editCategory(category: Category): void {
    if (this.categoryDraft()) return;
    this.categorySaveError.set(null);
    this.categoryConflict.set(false);
    const draft: Category = {
      ...category,
      revision: category.revision ?? null,
      navigationName: category.navigationName ?? null,
      footerName: category.footerName ?? null,
      texts: (category.texts ?? []).map((text) => ({
        ...text,
        navigationName: text.navigationName ?? null,
        footerName: text.footerName ?? null,
      })),
    };
    this.savedCategoryDraft.set(structuredClone(draft));
    this.categoryDraft.set(draft);
  }

  cancelCategoryEdit(): void {
    if (this.savingCategory()) return;
    if (this.categoryDirty()) {
      this.ui.confirm({
        title: 'Categorieformulier sluiten',
        message: 'De niet-opgeslagen categorie- en vertaalwijzigingen gaan verloren.',
        confirmLabel: 'Wijzigingen wissen',
        danger: true,
      }, () => this.clearCategoryDraft());
      return;
    }
    this.clearCategoryDraft();
  }

  updateCategoryDraft(changes: Partial<Category>): void {
    this.categorySaveError.set(null);
    this.categoryDraft.update((draft) => draft ? { ...draft, ...changes } : draft);
  }

  updateCategoryTranslations(category: Category): void {
    this.categorySaveError.set(null);
    this.categoryConflict.set(false);
    this.categoryDraft.set(category);
  }

  normalizeCategoryDraftCode(): void {
    this.categoryDraft.update((draft) => draft
      ? { ...draft, code: normalizeCategoryCode(draft.code) }
      : draft);
  }

  numberOrNull(value: number | string | null): number | null {
    return value === null || value === '' ? null : Number(value);
  }

  categoryFeaturedOptions(category: Category): CategoryFeaturedOption[] {
    const categoryId = category.id;
    if (categoryId === null) return [];
    const current = category.featuredProductId;
    return this.products()
      .filter((product): product is Product & { id: number } => product.id !== null)
      .map((product) => {
        const family = familyForProduct(this.families(), product.familyId);
        return {
          product,
          family,
          eligibility: featuredProductEligibility(family, product.id, product.active),
          inCategory: productBelongsToCategory(
            family,
            product.categoryId,
            categoryId,
            normalizeCategoryCode(category.code),
          ),
        };
      })
      .filter((option) =>
        (option.inCategory && option.eligibility.eligible) || option.product.id === current);
  }

  categoryOptionEligible(option: CategoryFeaturedOption): boolean {
    return option.inCategory
      && option.eligibility.eligible
      && option.family?.active === true
      && option.family.websiteStatus === 'PUBLISHED';
  }

  categoryEligibilityLabel(option: CategoryFeaturedOption): string {
    if (this.categoryOptionEligible(option)) return '';
    return [
      option.inCategory ? null : 'andere categorie',
      option.eligibility.active ? null : 'inactief',
      option.family?.active === false ? 'familie inactief' : null,
      option.family && option.family.websiteStatus !== 'PUBLISHED'
        ? 'website niet gepubliceerd'
        : null,
      option.eligibility.hasPublicImage ? null : 'geen publieke foto',
    ]
      .filter(Boolean)
      .map((reason) => ` · ${reason}`)
      .join('');
  }

  missingFeaturedProductId(category: Category): number | null {
    const selected = category.featuredProductId;
    return selected !== null && !this.products().some((product) => product.id === selected)
      ? selected
      : null;
  }

  productOptionLabel(product: Product): string {
    const option = [product.colour || 'Geen kleur', product.variantSize].filter(Boolean).join(' · ');
    return product.sku ? `${product.name} · ${option} — ${product.sku}` : `${product.name} · ${option}`;
  }

  featuredProductLabel(productId: number): string {
    const product = this.products().find((candidate) => candidate.id === productId);
    return product ? this.productOptionLabel(product) : `#${productId}`;
  }

  categoryCodeExists(draft = this.categoryDraft()): boolean {
    if (!draft) return false;
    const code = normalizeCategoryCode(draft.code);
    if (!code) return false;
    return this.categories().some((category) =>
      category.id !== draft.id && normalizeCategoryCode(category.code) === code);
  }

  categoryCodeValid(draft = this.categoryDraft()): boolean {
    if (!draft) return false;
    return CATEGORY_CODE_PATTERN.test(normalizeCategoryCode(draft.code));
  }

  categoryDraftValid(): boolean {
    const draft = this.categoryDraft();
    return !!draft?.name.trim() && this.categoryCodeValid(draft)
      && Number.isFinite(draft.position) && draft.position >= 0
      && !this.categoryCodeExists(draft);
  }

  async saveCategory(): Promise<void> {
    const draft = this.categoryDraft();
    if (!draft || !this.categoryDraftValid()) return;
    const payload: Category = {
      ...draft,
      code: normalizeCategoryCode(draft.code),
      name: draft.name.trim(),
      navigationName: draft.navigationName?.trim() || null,
      footerName: draft.footerName?.trim() || null,
      mobileName: draft.mobileName?.trim() || null,
      eyebrow: draft.eyebrow?.trim() || null,
      description: draft.description?.trim() || '',
      texts: (draft.texts ?? []).map((text) => ({
        ...text,
        name: text.name?.trim() || null,
        navigationName: text.navigationName?.trim() || null,
        footerName: text.footerName?.trim() || null,
        description: text.description?.trim() || null,
        eyebrow: text.eyebrow?.trim() || null,
        mobileName: text.mobileName?.trim() || null,
      })),
      position: Math.round(draft.position),
      featuredProductId: draft.featuredProductId ?? null,
    };
    this.categorySaveError.set(null);
    this.categoryConflict.set(false);
    this.savingCategory.set(true);
    try {
      const saved = payload.id === null
        ? await this.catalog.createCategory(payload)
        : await this.catalog.updateCategory(payload.id, payload);
      this.categories.update((categories) => {
        const next = payload.id === null
          ? [...categories, saved]
          : categories.map((category) => category.id === saved.id ? saved : category);
        return next.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'nl'));
      });
      this.categoryDraft.set(null);
      this.savedCategoryDraft.set(null);
      this.websiteSyncRefresh.update((value) => value + 1);
      const missingLanguageCount = this.categoryMissingLanguages(saved).length;
      this.ui.toast(missingLanguageCount
        ? `${payload.id === null ? 'Categorie toegevoegd' : 'Categorie opgeslagen'} · ${missingLanguageCount} taal/talen later aanvullen`
        : (payload.id === null ? 'Categorie toegevoegd' : 'Categorie opgeslagen'));
    } catch (failure: unknown) {
      const conflict = isRevisionConflict(failure);
      const message = conflict
        ? 'Deze categorie is intussen gewijzigd. Laad de laatste versie en controleer je aanpassing opnieuw.'
        : messageOf(failure, 'Opslaan mislukt');
      this.categoryConflict.set(conflict);
      this.categorySaveError.set(message);
      this.ui.toast(message, 'err');
    } finally {
      this.savingCategory.set(false);
    }
  }

  async reloadConflictedCategory(): Promise<void> {
    const draft = this.categoryDraft();
    if (!draft || draft.id === null || this.savingCategory()) return;
    this.savingCategory.set(true);
    try {
      const latest = (await this.catalog.categories()).find((category) => category.id === draft.id);
      if (!latest) {
        this.categorySaveError.set('Deze categorie bestaat niet meer. Sluit het formulier en laad Instellingen opnieuw.');
        return;
      }
      const normalized: Category = {
        ...latest,
        revision: latest.revision ?? null,
        navigationName: latest.navigationName ?? null,
        footerName: latest.footerName ?? null,
        texts: (latest.texts ?? []).map((text) => ({
          ...text,
          navigationName: text.navigationName ?? null,
          footerName: text.footerName ?? null,
        })),
      };
      this.categories.update((categories) => categories.map((category) =>
        category.id === normalized.id ? normalized : category));
      this.savedCategoryDraft.set(structuredClone(normalized));
      this.categoryDraft.set(structuredClone(normalized));
      this.categoryConflict.set(false);
      this.categorySaveError.set(null);
      this.ui.toast('Laatste categorieversie geladen');
    } catch (failure: unknown) {
      this.categorySaveError.set(messageOf(failure, 'Laatste categorieversie laden mislukt'));
    } finally {
      this.savingCategory.set(false);
    }
  }

  private categoryMissingLanguages(category: Category): LanguageCode[] {
    return LANGUAGES.filter((language) => {
      const text = category.texts?.find((item) => item.language === language.code);
      return !text?.name?.trim()
        || (this.categoryTranslationFieldUsed(category, 'navigationName') && !text?.navigationName?.trim())
        || (this.categoryTranslationFieldUsed(category, 'footerName') && !text?.footerName?.trim())
        || (this.categoryTranslationFieldUsed(category, 'mobileName') && !text?.mobileName?.trim())
        || (this.categoryTranslationFieldUsed(category, 'eyebrow') && !text?.eyebrow?.trim())
        || (this.categoryTranslationFieldUsed(category, 'description') && !text?.description?.trim());
    }).map((language) => language.code);
  }

  private categoryTranslationFieldUsed(
    category: Category,
    field: 'navigationName' | 'footerName' | 'mobileName' | 'eyebrow' | 'description',
  ): boolean {
    return !!category[field]?.trim()
      || (category.texts ?? []).some((text) => !!text[field]?.trim());
  }

  /** Delete lives inside the edit form: you look at it before you lose it. */
  removeCategoryDraft(): void {
    const draft = this.categoryDraft();
    const category = this.categories().find((candidate) => candidate.id === draft?.id);
    if (category) this.removeCategory(category);
  }

  removeCategory(category: Category): void {
    this.ui.confirm(
      { title: 'Categorie verwijderen', message: `<b>${category.name}</b> verwijderen?`,
        confirmLabel: 'Verwijderen', danger: true },
      async () => {
        this.deletingCategoryId.set(category.id);
        try {
          await this.catalog.deleteCategory(category.id!);
          this.categories.update((categories) =>
            categories.filter((current) => current.id !== category.id));
          if (this.categoryDraft()?.id === category.id) this.clearCategoryDraft();
          this.websiteSyncRefresh.update((value) => value + 1);
          this.ui.toast('Categorie verwijderd');
        } catch (failure: unknown) {
          const message = messageOf(failure, 'Categorie verwijderen mislukt');
          this.ui.toast(message, 'err');
        } finally {
          this.deletingCategoryId.set(null);
        }
      });
  }

  /* -------------------------------------------------- douanetarieven */

  addHsCode(): void {
    this.hsCodes.update((codes) =>
      [...codes, { id: null, code: '', description: '', dutyRatePct: 0 }]);
  }

  async saveHsCode(code: HsCode): Promise<void> {
    if (!code.code.trim()) { this.ui.toast('Vul een code in', 'err'); return; }
    await this.catalog.saveHsCode(code);
    this.ui.toast('Tarief opgeslagen');
    await this.load();
  }

  /** Codes as loaded from the server; anything else is an unsaved draft. */
  private savedHsCodes = new Set<string>();

  /* Percentages are typed the Belgian way, with a comma. A number input
     refuses "6,5" on most keyboards; a decimal text field accepts both. */
  pctText(value: number | null | undefined): string {
    return value == null ? '' : String(value).replace('.', ',');
  }

  pctValue(raw: string): number {
    const parsed = parseFloat(String(raw).trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  removeHsCode(code: HsCode): void {
    /* A freshly added row has nothing on the server yet: drop it locally,
       no dialog - that was the "X does nothing" on a new tariff. */
    if (!this.savedHsCodes.has(code.code)) {
      this.hsCodes.update((codes) => codes.filter((candidate) => candidate !== code));
      return;
    }
    this.ui.confirm(
      { title: 'Tariefcode verwijderen',
        message: `<b>${code.code}</b> verwijderen? Producten vallen terug op het `
          + 'standaardpercentage van de inkooporder.',
        confirmLabel: 'Verwijderen', danger: true },
      async () => { await this.catalog.deleteHsCode(code.code); await this.load(); });
  }

  /* ------------------------------------------------------- staffels */

  addTier(scope: 'LINE' | 'ORDER'): void {
    const target = scope === 'LINE' ? this.lineTiers : this.orderTiers;
    target.update((tiers) => [...tiers, {
      id: null, scope, productId: null, minQuantity: 1, percent: 0,
    }]);
  }

  removeTier(scope: 'LINE' | 'ORDER', index: number): void {
    const target = scope === 'LINE' ? this.lineTiers : this.orderTiers;
    target.update((tiers) => tiers.filter((_, i) => i !== index));
  }

  /* ------------------------------------------- Kortingen: one save model */

  /** The tiers as last saved: the dirty count compares against them (bug 5). */
  private readonly savedOrderTiers = signal<DiscountTier[]>([]);
  private readonly savedLineTiers = signal<DiscountTier[]>([]);
  readonly orderTierChanges = computed(() => tierChanges(this.savedOrderTiers(), this.orderTiers()));
  readonly lineChanges = computed(() => lineTierChanges(this.savedLineTiers(), this.lineTiers()));
  readonly discountsDirtyCount = computed(() =>
    this.orderTierChanges() + [...this.lineChanges().values()].reduce((sum, count) => sum + count, 0));
  readonly discountsDirty = computed(() => this.discountsDirtyCount() > 0);
  readonly discountsStatus = computed(() => dirtyStatusText(this.discountsDirtyCount()));
  readonly discountsSaving = signal(false);
  readonly discountsEditor: SettingsEditor = {
    dirty: this.discountsDirty,
    dirtyCount: this.discountsDirtyCount,
    saving: this.discountsSaving,
    save: () => this.saveDiscounts(),
    revert: () => this.revertDiscounts(),
  };

  /** Opslaan: the order tiers when they changed, then every changed product (removals were saved at once, N8). */
  async saveDiscounts(): Promise<boolean> {
    if (this.discountsSaving()) return false;
    const orderDirty = this.orderTierChanges() > 0;
    const products = [...this.lineChanges().keys()];
    const lists = [this.orderTiers(), ...products.map((id) => this.lineTiers().filter((tier) => tier.productId === id))];
    const problem = lists.map((tiers) => tierProblem(tiers)).find(Boolean);
    if (problem) {
      this.ui.toast(problem, 'err');
      return false;
    }
    this.discountsSaving.set(true);
    try {
      if (orderDirty) {
        const saved = sortedTiers(await this.sales.saveTiers('ORDER', sortedTiers(this.orderTiers())));
        this.orderTiers.set(saved);
        this.savedOrderTiers.set(saved);
      }
      for (const productId of products) {
        const tiers = sortedTiers(this.lineTiers().filter((tier) => tier.productId === productId));
        const saved = await this.sales.saveProductTiers(productId, tiers);
        this.lineTiers.update((current) => [...current.filter((tier) => tier.productId !== productId), ...saved]);
        this.savedLineTiers.update((current) => [...current.filter((tier) => tier.productId !== productId), ...saved]);
      }
      this.ui.toast('Kortingen opgeslagen');
      return true;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Kortingen opslaan is niet gelukt. Controleer de verbinding en probeer opnieuw.'), 'err');
      return false;
    } finally {
      this.discountsSaving.set(false);
    }
  }

  revertDiscounts(): void {
    this.orderTiers.set(this.savedOrderTiers());
    this.lineTiers.set(this.savedLineTiers());
    this.tierSheet.set(null);
  }

  /** Typing a threshold: whole numbers only; an empty field waits. */
  orderMinInput(index: number, raw: string): void {
    const value = Number(raw);
    if (raw.trim() && Number.isFinite(value)) this.updateOrderTier(index, { minQuantity: Math.round(value) });
  }

  /** Typing a percentage the Belgian way: it lands once it ends in a digit ("6," waits for "6,5"). */
  orderPctInput(index: number, raw: string): void {
    if (/\d$/.test(raw.trim())) this.updateOrderTier(index, { percent: this.pctValue(raw) });
  }

  lineMinInput(tier: DiscountTier, raw: string): void {
    const value = Number(raw);
    if (raw.trim() && Number.isFinite(value)) this.updateLineTier(tier, { minQuantity: Math.round(value) });
  }

  linePctInput(tier: DiscountTier, raw: string): void {
    if (/\d$/.test(raw.trim())) this.updateLineTier(tier, { percent: this.pctValue(raw) });
  }

  sortOrderTiers(): void {
    this.orderTiers.update((tiers) => sortedTiers(tiers));
  }

  /** The unit the threshold counts in: "displays", "diamanten", "stuks". */
  unitWord(product: Product | null): string {
    return productSalesUnit(product).plural;
  }

  countText(value: number): string {
    return Number.isFinite(value) ? value.toLocaleString('nl-BE') : '';
  }

  /** Phone: one tier in a sheet; edits go to the draft, Opslaan in the bar saves. */
  readonly tierSheet = signal<{ scope: 'ORDER' | 'LINE'; index: number } | null>(null);
  readonly sheetTier = computed(() => {
    const sheet = this.tierSheet();
    if (!sheet) return null;
    return (sheet.scope === 'ORDER' ? this.orderTiers() : this.lineTiers())[sheet.index] ?? null;
  });
  readonly sheetUnit = computed(() => {
    const tier = this.sheetTier();
    return tier?.productId != null ? this.unitWord(this.products().find((product) => product.id === tier.productId) ?? null) : 'stuks';
  });

  openTier(scope: 'ORDER' | 'LINE', index: number): void {
    if (index >= 0) this.tierSheet.set({ scope, index });
  }

  openLineTier(tier: DiscountTier): void {
    this.openTier('LINE', this.lineTiers().indexOf(tier));
  }

  sheetMin(raw: string): void {
    const sheet = this.tierSheet();
    const value = Number(raw);
    if (!sheet || !raw.trim() || !Number.isFinite(value)) return;
    this.patchSheetTier(sheet, { minQuantity: Math.round(value) });
  }

  sheetPct(raw: string): void {
    const sheet = this.tierSheet();
    if (sheet && /\d$/.test(raw.trim())) this.patchSheetTier(sheet, { percent: this.pctValue(raw) });
  }

  private patchSheetTier(sheet: { scope: 'ORDER' | 'LINE'; index: number }, changes: Partial<DiscountTier>): void {
    if (sheet.scope === 'ORDER') this.updateOrderTier(sheet.index, changes);
    else this.lineTiers.update((tiers) => tiers.map((tier, index) => index === sheet.index ? { ...tier, ...changes } : tier));
  }

  removeSheetTier(): void {
    const sheet = this.tierSheet();
    const tier = this.sheetTier();
    this.tierSheet.set(null);
    if (!sheet || !tier) return;
    if (sheet.scope === 'ORDER') this.removeTier('ORDER', sheet.index);
    else this.removeLineTier(tier);
  }

  supplierName(product: Product | null): string | null {
    if (!product) return null;
    if (product.supplierId == null) return null;
    return this.suppliers().find((supplier) => supplier.id === product.supplierId)?.name ?? null;
  }

  chooseDiscountProduct(product: Product): void {
    if (product.id == null) return;
    this.lineDiscountPicker.set(false);
    if (this.lineTiers().some((tier) => tier.productId === product.id)) {
      this.scrollToLineDiscount(product.id);
      return;
    }
    this.lineTiers.update((tiers) => [...tiers, {
      id: null,
      scope: 'LINE',
      productId: product.id,
      minQuantity: Math.max(1, product.carton.piecesPerCarton ?? 1),
      percent: 0,
    }]);
    this.scrollToLineDiscount(product.id);
  }

  addLineTier(productId: number): void {
    const existing = this.lineTiers().filter((tier) => tier.productId === productId);
    const highest = existing.reduce((value, tier) => Math.max(value, tier.minQuantity), 0);
    this.lineTiers.update((tiers) => [...tiers, {
      id: null,
      scope: 'LINE',
      productId,
      minQuantity: Math.max(1, highest + 100),
      percent: 0,
    }]);
  }

  updateLineTier(tier: DiscountTier, changes: Partial<Pick<DiscountTier, 'minQuantity' | 'percent'>>): void {
    this.lineTiers.update((tiers) => tiers.map((candidate) =>
      candidate === tier ? { ...candidate, ...changes } : candidate));
  }

  removeLineTier(tier: DiscountTier): void {
    if (tier.productId != null
        && this.lineTiers().filter((candidate) => candidate.productId === tier.productId).length === 1) {
      const productName = this.products().find((product) => product.id === tier.productId)?.name;
      this.removeLineDiscountProduct(tier.productId, productName);
      return;
    }
    this.lineTiers.update((tiers) => tiers.filter((candidate) => candidate !== tier));
  }

  updateOrderTier(index: number, changes: Partial<Pick<DiscountTier, 'minQuantity' | 'percent'>>): void {
    this.orderTiers.update((tiers) => tiers.map((tier, currentIndex) =>
      currentIndex === index ? { ...tier, ...changes, productId: null } : tier));
  }

  removeLineDiscountProduct(productId: number, productName?: string | null): void {
    this.ui.confirm({
      title: 'Productkorting verwijderen',
      message: 'De automatische lijnkorting voor dit product wordt verwijderd. Andere producten blijven ongewijzigd.',
      confirmLabel: 'Verwijderen',
      danger: true,
    }, async () => {
      this.savingLineProductId.set(productId);
      try {
        await this.sales.saveProductTiers(productId, []);
        this.lineTiers.update((tiers) => tiers.filter((tier) => tier.productId !== productId));
        /* N8: this removal is saved at once; only this product's baseline moves. */
        this.savedLineTiers.update((tiers) => tiers.filter((tier) => tier.productId !== productId));
        this.ui.toast(productName ? `Korting voor ${productName} verwijderd` : 'Productkorting verwijderd');
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Productkorting verwijderen mislukt'), 'err');
      } finally {
        this.savingLineProductId.set(null);
      }
    });
  }

  removeLegacyLineTiers(): void {
    this.ui.confirm({
      title: 'Oude algemene lijnkorting opruimen',
      message: 'Alleen de oude niet-productspecifieke regels worden verwijderd. Productspecifieke staffels blijven staan.',
      confirmLabel: 'Opruimen',
      danger: false,
    }, async () => {
      try {
        /* Only the saved product tiers go along: unsaved edits of other products stay a draft (N8). */
        const valid = this.savedLineTiers().filter((tier) => tier.productId != null);
        const saved = await this.sales.saveTiers('LINE', valid);
        this.savedLineTiers.set(saved);
        this.lineTiers.update((tiers) => tiers.filter((tier) => tier.productId != null));
        this.ui.toast('Oude algemene lijnkorting opgeruimd');
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Oude lijnkorting opruimen mislukt'), 'err');
      }
    });
  }

  private scrollToLineDiscount(productId: number): void {
    this.document.defaultView?.setTimeout(() => {
      this.document.getElementById(`line-discount-${productId}`)?.scrollIntoView({
        behavior: 'smooth', block: 'center',
      });
    });
  }

  canDeactivate(): boolean | Promise<boolean> {
    if (this.savingCategory()) return false;
    if (!this.websiteCategoryMode) return this.leaveEditors();
    if (!this.categoryDirty()) return true;
    return window.confirm(
      'Je hebt categorie- of vertaalwijzigingen die nog niet zijn opgeslagen. Dit scherm toch verlaten?',
    );
  }

  @HostListener('window:beforeunload', ['$event'])
  warnBeforeUnload(event: BeforeUnloadEvent): void {
    const editing = this.editors().some((editor) => editor.dirty() || editor.saving());
    if (!this.categoryDirty() && !this.savingCategory() && !editing) return;
    event.preventDefault();
    event.returnValue = '';
  }

  private clearCategoryDraft(): void {
    this.categoryDraft.set(null);
    this.savedCategoryDraft.set(null);
    this.categorySaveError.set(null);
    this.categoryConflict.set(false);
  }
}

