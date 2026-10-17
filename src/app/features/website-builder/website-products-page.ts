import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthImage } from '../../core/api/auth-image';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import type { ProductFamily } from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { IosNav } from '../../shared/ios-nav';
import { LoadError } from '../../shared/load-error';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui } from '../../shared/ui';
import { WK_DOCK_MIN_PX, elementWidth } from '../../shared/workspace-layout';
import { describePublicationIssues } from '../products/publication-issues';
import { WebsiteSyncStatus } from '../settings/website-sync-status';
import { WebsiteSyncStore } from '../settings/website-sync-store';
import {
  WEBSITE_LANGUAGE_ORDER,
  familyCompleteness,
  familyProductId,
  plural,
  websiteAttention,
  websiteStatusWord,
} from './website-attention';
import { publicFamilyName } from './website-family-label';
import { WebsitePhoneBack } from './website-phone-back';
import {
  PRODUCT_FILTERS,
  PRODUCT_FILTER_LABELS,
  ProductFilter,
  ProductViewRow,
  defaultProductFilter,
  filterCounts,
  parseProductFilter,
  productGroups,
  productStatusLine,
  searchText,
} from './website-products-view';
import { WebsiteStatusBar } from './website-status-bar';
import { WebsiteStore } from './website-store';

/** The bestsellers lead inside Display (today's order). */
const GLASS_BOWL_FAMILY_KEYS = new Set(['bowl-rose-xl', 'preserved-bowl-rose']);
const LANGUAGE_COUNT = WEBSITE_LANGUAGE_ORDER.length;
/** Familietekst counts name + description; said where the figure is used. */
const TEXT_SCORE_HINT = 'Familietekst telt per taal de naam en de beschrijving. Variantnamen en foto-alt-teksten bewerk je bij het product; ze tellen niet mee in deze score.';

interface ProductRow extends ProductViewRow {
  family: ProductFamily;
  productId: number | null;
  text: number;
  seo: number;
  statusWord: string;
  thumbnail: string | null;
}

/**
 * Producten of Website beheren (/website/products): every public product
 * reeks with its website switch, opening on what needs attention (the same
 * rule as the dashboard). A kit table with a docked inspector or a drawer on
 * the desk; inset groups and a reeks sheet on the phone. Switching a live
 * reeks off asks first and can be undone where the backend allows it.
 */
@Component({
  selector: 'app-website-products-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../../styles/website-workspace.scss', '../../../styles/website-products.scss'],
  imports: [AuthImage, Icon, IosNav, LoadError, NgTemplateOutlet, RouterLink, Sheet, Skeleton, WebsiteStatusBar, WebsiteSyncStatus],
  template: `
    <ng-template #switchCell let-row>
      <span class="ws-status" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
        <input class="ws-switch" type="checkbox" role="switch" [checked]="row.status === 'PUBLISHED'"
               [disabled]="!canToggle(row) || saving() !== null" [class.is-busy]="saving() === row.id"
               [attr.aria-label]="'Op de website: ' + row.name" (change)="switched(row, $event)" />
        <span class="wk-pill" [class]="pillClass(row)">{{ row.statusWord }}</span>
      </span>
    </ng-template>

    <ng-template #inspector let-row>
      <header class="wk-inspector__head">
        <div class="ws-insp-title">
          <h2 class="wk-inspector__title">{{ row.name }}</h2>
          <small>{{ categoryLine(row) }}</small>
        </div>
        <button class="wk-btn wk-btn--ghost wk-btn--icon" type="button" aria-label="Sluiten" (click)="close()"><app-icon name="close" [size]="18" /></button>
      </header>
      @for (current of [row]; track current.key) {
        <div class="ws-insp mo-fade">
          <div class="ws-insp-photo">
            @if (current.thumbnail) { <img [appAuthSrc]="current.thumbnail" alt="" /> } @else { <span class="ws-thumb ws-thumb--none ws-thumb--lg" aria-hidden="true"></span> }
          </div>
          <div class="ws-row-switch">
            <div><b>Op de website</b><small>{{ statusLine(current) }}</small></div>
            <input class="ws-switch ws-switch--lg" type="checkbox" role="switch" [checked]="current.status === 'PUBLISHED'"
                   [disabled]="!canToggle(current) || saving() !== null" [attr.aria-label]="'Op de website: ' + current.name"
                   (change)="switched(current, $event)" />
          </div>
          <ng-container *ngTemplateOutlet="hint; context: { $implicit: current }" />
          <div class="ws-figs3">
            <div [attr.title]="textHint"><small>Familietekst</small><strong>{{ current.text }}/{{ languageCount }}</strong></div>
            <div><small>SEO</small><strong>{{ current.seo }}/{{ languageCount }}</strong></div>
            <div><small>Punten</small><strong [class.ws-danger-text]="current.points > 0">{{ current.points }}</strong></div>
          </div>
          <dl class="wk-kv ws-insp-kv">
            <div><dt>Webadres</dt><dd>
              @if (current.family.publicHandle) {
                <span class="ws-mono">/products/{{ current.family.publicHandle }}</span>
                @if (current.status === 'PUBLISHED') {
                  <small><a [href]="siteBase + '/products/' + current.family.publicHandle" target="_blank" rel="noopener">Bekijken <app-icon name="external" [size]="12" /></a></small>
                } @else { <small>Actief zodra de reeks live staat</small> }
              } @else { <span class="ws-url--none">Nog geen webadres</span> }
            </dd></div>
            <div><dt>Categorie</dt><dd>{{ current.categoryName || 'Zonder categorie' }}</dd></div>
            <div><dt>Varianten</dt><dd [class.ws-warn-text]="current.family.variantCount === 0">{{ current.family.variantCount }}</dd></div>
          </dl>
          <p class="ws-hint">Het webadres blijft gelijk als je de naam wijzigt.</p>
        </div>
      }
      <footer class="wk-inspector__foot ws-insp-foot">
        @if (row.productId; as productId) {
          <a class="wk-btn wk-btn--primary" [routerLink]="['/products', productId, 'translations']">Teksten &amp; SEO</a>
          <a class="wk-btn" [routerLink]="['/products', productId, 'edit']" [queryParams]="{ tab: 'media' }">Foto’s</a>
          <a class="wk-btn" [routerLink]="['/products', productId, 'edit']" [queryParams]="{ tab: 'publication' }">Website &amp; orderapp</a>
        } @else {
          <a class="wk-btn" routerLink="/products">ERP-producten</a>
        }
      </footer>
    </ng-template>

    <ng-template #hint let-row>
      @switch (hintKind(row)) {
        @case ('ready') { <p class="ws-hint ws-hint--ok">Alle publicatiepunten zijn afgewerkt. Zet de reeks aan om ze live te zetten; de website is binnen enkele minuten bijgewerkt.</p> }
        @case ('novariants') {
          <div class="ws-hint-block">
            <p class="ws-hint">Deze reeks heeft nog geen varianten. Koppel een product in het ERP of laat ze in concept.</p>
            @if (desk.active()) { <a class="wk-btn wk-btn--sm" routerLink="/products">ERP-producten</a> }
          </div>
        }
        @case ('inactive') { <p class="ws-hint">Activeer deze reeks eerst in het ERP.</p> }
        @case ('inactive-live') { <p class="ws-hint">Niet actief in het ERP; je kunt ze nog van de website halen.</p> }
        @default {}
      }
      @if (row.points > 0) {
        <div class="ws-issues">
          <p class="ws-hint">Werk eerst de publicatiepunten af:</p>
          <ul>@for (line of issueLines(row); track $index) { <li>{{ line }}</li> }</ul>
        </div>
      }
    </ng-template>

    @if (desk.active()) {
      <div class="wk-page ws-page">
        <header class="wk-toolbar">
          <div class="wk-toolbar__lead">
            <h1 class="wk-toolbar__title">Producten</h1>
            <span class="ws-sub">{{ subtitle() }}</span>
          </div>
          <div class="wk-toolbar__tools">
            <label class="wk-search ws-search">
              <app-icon name="search" [size]="15" />
              <input #search type="search" data-page-search placeholder="Zoek reeks of webadres" aria-label="Zoek reeks of webadres"
                     [value]="query()" (input)="query.set($any($event.target).value)" (keydown.escape)="clearSearch($event)" />
              <span class="wk-kbd" aria-hidden="true">/</span>
            </label>
            <a class="wk-btn" routerLink="/products">ERP-producten</a>
          </div>
        </header>

        <div class="wk-notices">
          <div class="ws-filterbar">
            <div class="wk-chips" role="group" aria-label="Filter">
              @for (filter of filters; track filter) {
                <button class="wk-chip" type="button" [attr.aria-pressed]="activeFilter() === filter" (click)="setFilter(filter)">
                  {{ filterLabels[filter] }} <span class="ws-chip-count">{{ counts()[filter] }}</span>
                </button>
              }
            </div>
            <span class="ws-filter-count">{{ visibleCount() }} van {{ plural(rows().length, 'reeks', 'reeksen') }}</span>
          </div>
        </div>

        <div class="wk-body" [class.wk-body--split]="docked() && !!selected()">
          <div class="wk-pane">
            <div class="ws-scroll">
              @if (actionError(); as error) {
                <div class="wk-banner wk-banner--danger wk-banner--inset" role="alert">
                  <app-icon name="alert" [size]="16" />
                  <span class="wk-banner__text"><b>Websitezichtbaarheid is niet gewijzigd</b> · {{ error }}</span>
                  <span class="wk-banner__actions"><button class="wk-btn wk-btn--sm" type="button" (click)="actionError.set(null)">Sluiten</button></span>
                </div>
              }
              @if (actionNotice(); as notice) {
                <div class="wk-banner wk-banner--warn wk-banner--inset" role="status">
                  <app-icon name="info" [size]="16" />
                  <span class="wk-banner__text"><b>Zichtbaarheid opgeslagen</b> · {{ notice }}</span>
                  <span class="wk-banner__actions">
                    <a class="wk-btn wk-btn--sm" routerLink="/website/publication">Publicatie ›</a>
                    <button class="wk-btn wk-btn--sm" type="button" (click)="actionNotice.set(null)">Sluiten</button>
                  </span>
                </div>
              }
              @if (loadError() && !store.families()) {
                <app-load-error title="Publieke producten konden niet worden geladen" [message]="loadError()" [busy]="store.isLoading('families')" (retry)="reload()" />
              } @else if (!store.families()) {
                <div class="wk-card"><app-skeleton kind="table" [rows]="10" /></div>
              } @else if (!groups().length) {
                <div class="wk-card">
                  @if (activeFilter() === 'aandacht' && !query()) {
                    <div class="wk-empty" role="status">
                      <div class="wk-empty__icon"><app-icon name="check" [size]="22" /></div>
                      <h2 class="wk-empty__title">Alle reeksen zijn in orde</h2>
                      <div class="wk-empty__actions"><button class="wk-btn" type="button" (click)="setFilter('alles')">Alles tonen</button></div>
                    </div>
                  } @else {
                    <div class="wk-empty" role="status">
                      <div class="wk-empty__icon"><app-icon name="search" [size]="22" /></div>
                      <h2 class="wk-empty__title">Geen reeksen voor deze zoekopdracht of filter</h2>
                      <div class="wk-empty__actions"><button class="wk-btn" type="button" (click)="clearFilter()">Filter wissen</button></div>
                    </div>
                  }
                </div>
              } @else {
                <div class="wk-card ws-table-card">
                  <div class="wk-table ws-products" role="grid" aria-label="Productreeksen op de website" (keydown)="tableKey($event)">
                    <div class="wk-thead" role="row">
                      <span class="wk-th" role="columnheader"><span class="sr-only">Foto</span></span>
                      <span class="wk-th" role="columnheader">Productreeks</span>
                      <span class="wk-th" role="columnheader" data-hide="md inspecting">Webadres</span>
                      <span class="wk-th" role="columnheader">Website</span>
                      <span class="wk-th wk-th--num" role="columnheader" [attr.title]="textHint">Tekst</span>
                      <span class="wk-th wk-th--num" role="columnheader">SEO</span>
                      <span class="wk-th wk-th--num" role="columnheader">Punten</span>
                      <span class="wk-th" role="columnheader"><span class="sr-only">Openen</span></span>
                    </div>
                    @for (group of groups(); track group.key) {
                      <div class="wk-group" role="row"><span class="wk-group__label" role="rowheader">{{ group.label }} <span class="wk-group__count">{{ group.rows.length }}</span></span></div>
                      @for (row of group.rows; track row.key) {
                        <div class="wk-tr wk-tr--link ws-prow" role="row" [attr.data-key]="row.key" [attr.tabindex]="tabStop() === row.key ? 0 : -1"
                             [attr.aria-selected]="selected()?.key === row.key" (click)="select(row)" (focus)="focused.set(row.key)">
                          <span class="wk-td" role="gridcell">
                            @if (row.thumbnail) { <img class="ws-thumb" [appAuthSrc]="row.thumbnail" alt="" /> } @else { <span class="ws-thumb ws-thumb--none" aria-hidden="true"></span> }
                          </span>
                          <span class="wk-td ws-name" role="gridcell">
                            <b [attr.title]="row.name">{{ row.name }}@if (row.bestseller) {<span class="ws-tag">Bestseller</span>}</b>
                            <small>{{ row.categoryName || 'Zonder categorie' }} · @if (row.family.variantCount === 0) {<span class="ws-warn-text">geen varianten</span>} @else {{{ plural(row.family.variantCount, 'variant', 'varianten') }}}</small>
                          </span>
                          <span class="wk-td" role="gridcell" data-hide="md inspecting">
                            @if (row.family.publicHandle) { <span class="ws-url" [attr.title]="'/products/' + row.family.publicHandle">/products/{{ row.family.publicHandle }}</span> }
                            @else { <span class="ws-url ws-url--none">Nog geen webadres</span> }
                          </span>
                          <span class="wk-td" role="gridcell"><ng-container *ngTemplateOutlet="switchCell; context: { $implicit: row }" /></span>
                          <span class="wk-td wk-td--num ws-frac" role="gridcell" [class.is-done]="row.text === languageCount" [class.is-warn]="row.text < languageCount">{{ row.text }}/{{ languageCount }}</span>
                          <span class="wk-td wk-td--num ws-frac" role="gridcell" [class.is-done]="row.seo === languageCount" [class.is-warn]="row.seo < languageCount">{{ row.seo }}/{{ languageCount }}</span>
                          <span class="wk-td wk-td--num ws-points" role="gridcell" [class.is-none]="!row.points">{{ row.points ? plural(row.points, 'punt', 'punten') : '—' }}</span>
                          <app-icon class="ws-chev" name="chevron-right" [size]="16" />
                        </div>
                      }
                    }
                  </div>
                </div>
                @if (activeFilter() === 'aandacht' && !query() && rows().length > counts().aandacht) {
                  <p class="ws-under">De andere {{ rows().length - counts().aandacht }} reeksen staan live en zijn compleet. <button class="wk-link" type="button" (click)="setFilter('alles')">Alles tonen</button></p>
                }
              }
            </div>
          </div>
          @if (docked() && selected(); as row) {
            <aside class="wk-inspector ws-inspector" aria-label="Productreeks"><ng-container *ngTemplateOutlet="inspector; context: { $implicit: row }" /></aside>
          }
        </div>
        <app-website-status-bar [text]="barLine()" hint="↑↓ kiezen · ↵ openen · / zoeken" />
      </div>
      @if (!docked() && selected(); as row) {
        <aside class="wk-inspector wk-inspector--drawer ws-inspector" aria-label="Productreeks"><ng-container *ngTemplateOutlet="inspector; context: { $implicit: row }" /></aside>
      }
    } @else {
      <div class="ios-page ws-ios">
        <app-ios-nav title="Producten" [subtitle]="subtitle()" [backLabel]="back.label()" [backUrl]="back.url()" [backAriaLabel]="back.aria()">
          <div below class="ios-subbar ws-ph-subbar">
            <div class="ios-search">
              <span class="ios-search__field">
                <app-icon name="search" [size]="16" />
                <input type="search" placeholder="Zoek reeks of webadres" aria-label="Zoek reeks of webadres" [value]="query()" (input)="query.set($any($event.target).value)" />
              </span>
            </div>
            <div class="ios-chips ws-ph-chips" role="group" aria-label="Filter">
              @for (filter of filters; track filter) {
                <button class="ios-chip" type="button" [attr.aria-pressed]="activeFilter() === filter" (click)="setFilter(filter)">
                  {{ filterLabels[filter] }}
                  @if (filter === 'aandacht') { @if (counts().aandacht) { <span class="ios-chip__badge">{{ counts().aandacht }}</span> } }
                  @else { <span class="ws-chip-count">{{ counts()[filter] }}</span> }
                </button>
              }
            </div>
          </div>
        </app-ios-nav>
        <app-website-sync-status variant="banner" />
        @if (actionError(); as error) {
          <div class="ios-banner ios-banner--danger" role="alert"><span><b>Websitezichtbaarheid is niet gewijzigd</b> · {{ error }}</span>
            <button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button" (click)="actionError.set(null)">Sluiten</button></div>
        }
        @if (actionNotice(); as notice) {
          <div class="ios-banner" role="status"><span><b>Zichtbaarheid opgeslagen</b> · {{ notice }}</span>
            <a class="ios-capsule ios-capsule--sm ios-capsule--tinted" routerLink="/website/publication">Publicatie</a></div>
        }
        @if (loadError() && !store.families()) {
          <app-load-error title="Publieke producten konden niet worden geladen" [message]="loadError()" [busy]="store.isLoading('families')" (retry)="reload()" />
        } @else if (!store.families()) {
          <app-skeleton kind="group" [rows]="6" />
        } @else {
          @for (group of groups(); track group.key) {
            <section class="ios-section">
              <div class="ios-section__head"><h2>{{ group.label }} · {{ group.rows.length }}</h2></div>
              <div class="ios-group ios-group--thumbs">
                @for (row of group.rows; track row.key) {
                  <button class="ios-cell" type="button" (click)="select(row)">
                    @if (row.thumbnail) { <img class="ios-thumb" [appAuthSrc]="row.thumbnail" alt="" /> } @else { <span class="ios-thumb ws-thumb--none" aria-hidden="true"></span> }
                    <span class="ios-cell__body">
                      <span class="ios-cell__title ios-cell__title--2">{{ row.name }}</span>
                      <span class="ios-cell__sub ios-cell__sub--wrap">{{ phoneLine(row) }}</span>
                    </span>
                    <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
                  </button>
                }
              </div>
            </section>
          } @empty {
            <div class="ios-empty">
              <div class="ios-empty__icon"><app-icon [name]="activeFilter() === 'aandacht' && !query() ? 'check' : 'search'" [size]="26" /></div>
              <h2 class="ios-empty__title">{{ activeFilter() === 'aandacht' && !query() ? 'Alle reeksen zijn in orde' : 'Geen reeksen gevonden' }}</h2>
              <button class="ios-capsule ios-capsule--tinted" type="button" (click)="clearFilter()">Alles tonen</button>
            </div>
          }
          @if (activeFilter() === 'aandacht' && !query() && groups().length && rows().length > counts().aandacht) {
            <p class="ios-section__foot ws-ph-under">De andere {{ rows().length - counts().aandacht }} reeksen staan live en zijn compleet.
              <button class="ios-section__link" type="button" (click)="setFilter('alles')">Alles tonen</button></p>
          }
        }
      </div>
      @if (selected(); as row) {
        <app-sheet [title]="row.name" variant="ios" (closed)="close()">
          <div body class="ws-sheet">
            <div class="ws-sheet-photo">
              @if (row.thumbnail) { <img [appAuthSrc]="row.thumbnail" alt="" /> } @else { <span class="ws-thumb ws-thumb--none ws-thumb--lg" aria-hidden="true"></span> }
            </div>
            <section class="ios-section">
              <div class="ios-group">
                <label class="ios-cell">
                  <span class="ios-cell__body"><span class="ios-cell__title">Op de website</span><span class="ios-cell__sub">{{ statusLine(row) }}</span></span>
                  <input class="ios-switch" type="checkbox" role="switch" [checked]="row.status === 'PUBLISHED'"
                         [disabled]="!canToggle(row) || saving() !== null" (change)="switched(row, $event)" />
                </label>
              </div>
              <div class="ios-section__foot"><ng-container *ngTemplateOutlet="hint; context: { $implicit: row }" /></div>
            </section>
            <div class="ios-figures ios-figures--3">
              <div [attr.title]="textHint"><small>Familietekst</small><strong>{{ row.text }}/{{ languageCount }}</strong></div>
              <div><small>SEO</small><strong>{{ row.seo }}/{{ languageCount }}</strong></div>
              <div><small>Punten</small><strong>{{ row.points }}</strong></div>
            </div>
            <section class="ios-section">
              <div class="ios-group">
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Webadres</span>
                  <span class="ios-cell__sub ws-ph-url" [class.ws-url--none]="!row.family.publicHandle">{{ row.family.publicHandle ? '/products/' + row.family.publicHandle : 'Nog geen webadres' }}</span></span></div>
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Categorie · varianten</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value">{{ row.categoryName || 'Zonder categorie' }} · {{ row.family.variantCount }}</span></span></div>
              </div>
            </section>
            @if (row.productId; as productId) {
              <section class="ios-section">
                <div class="ios-group">
                  <a class="ios-cell ios-cell--action" [routerLink]="['/products', productId, 'translations']"><span class="ios-cell__body">Teksten &amp; SEO</span><app-icon class="ios-cell__chev" name="chevron-right" [size]="18" /></a>
                  <a class="ios-cell" [routerLink]="['/products', productId, 'edit']" [queryParams]="{ tab: 'media' }"><span class="ios-cell__body">Foto’s</span><app-icon class="ios-cell__chev" name="chevron-right" [size]="18" /></a>
                </div>
              </section>
            }
          </div>
        </app-sheet>
      }
    }
  `,
})
export class WebsiteProductsPage {
  readonly desk = inject(DesktopViewport);
  readonly store = inject(WebsiteStore);
  readonly back = inject(WebsitePhoneBack);
  private readonly sync = inject(WebsiteSyncStore);
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('search');

  readonly filters = PRODUCT_FILTERS;
  readonly filterLabels = PRODUCT_FILTER_LABELS;
  readonly languageCount = LANGUAGE_COUNT;
  readonly textHint = TEXT_SCORE_HINT;
  readonly siteBase = environment.websitePreviewUrl.replace(/\/+$/, '');
  readonly plural = plural;

  readonly query = signal('');
  /** The filter of the address, or null: then Aandacht when it holds anything, else Alles (never written to the address). */
  private readonly urlFilter = signal<ProductFilter | null>(parseProductFilter(this.route.snapshot.queryParamMap.get('filter')));
  private readonly selectedId = signal<string | null>(this.route.snapshot.queryParamMap.get('reeks'));
  readonly focused = signal<string | null>(null);
  readonly saving = signal<number | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly actionNotice = signal<string | null>(null);

  private readonly width = elementWidth(() => this.host.nativeElement);
  readonly docked = computed(() => this.width() >= WK_DOCK_MIN_PX);
  readonly loadError = computed(() => this.store.errors().families ?? null);

  readonly rows = computed<ProductRow[]>(() => (this.store.families() ?? []).map((family) => {
    const completeness = familyCompleteness(family, WEBSITE_LANGUAGE_ORDER);
    const name = publicFamilyName(family);
    return {
      id: family.id, key: String(family.id ?? family.familyKey), name, family,
      status: family.websiteStatus, active: family.active,
      reason: websiteAttention(family, completeness, LANGUAGE_COUNT),
      points: family.publicationIssues?.length ?? 0,
      bestseller: GLASS_BOWL_FAMILY_KEYS.has(family.familyKey),
      categoryId: family.categoryId, categoryName: family.categoryName,
      categoryPosition: family.categoryPosition, productPosition: family.productPosition,
      search: searchText(name, family.familyKey, family.publicHandle, family.categoryName),
      productId: familyProductId(family), text: completeness.text, seo: completeness.seo,
      statusWord: websiteStatusWord(family), thumbnail: this.thumbnail(family),
    };
  }));

  /** Reasons at the last full load: a reeks fixed meanwhile stays in its Aandacht group until the next load. */
  private readonly kept = computed(() => {
    this.store.familiesVersion();
    return untracked(() => new Map(this.rows().filter((row) => row.reason).map((row) => [row.key, row.reason!] as const)));
  });
  readonly counts = computed(() => filterCounts(this.rows(), this.kept()));
  readonly activeFilter = computed<ProductFilter>(() => this.urlFilter() ?? defaultProductFilter(this.counts().aandacht));
  readonly groups = computed(() => productGroups(this.rows(), this.activeFilter(), this.query(), this.kept()));
  readonly visibleCount = computed(() => this.groups().reduce((total, group) => total + group.rows.length, 0));
  readonly orderedKeys = computed(() => this.groups().flatMap((group) => group.rows.map((row) => row.key)));
  readonly selected = computed(() => {
    const id = this.selectedId();
    return id ? this.rows().find((row) => row.key === id) ?? null : null;
  });
  readonly tabStop = computed(() => this.focused() ?? this.selected()?.key ?? this.orderedKeys()[0] ?? null);

  readonly subtitle = computed(() => {
    if (!this.store.families()) return '';
    const counts = this.store.counts();
    return [plural(counts.families, 'reeks', 'reeksen'), `${counts.live} live`, `${counts.concept} concept`,
      ...(counts.hidden ? [`${counts.hidden} verborgen`] : [])].join(' · ');
  });
  readonly barLine = computed(() => {
    if (!this.store.families()) return '';
    return `${this.visibleCount()} van ${plural(this.rows().length, 'reeks', 'reeksen')} · ${this.store.counts().notReady} niet publicatieklaar`;
  });

  constructor() {
    void this.store.ensure(['families']);
    /* A reeks asked for in the address (Te doen, Recent) that is not in Aandacht opens under Alles. */
    effect(() => {
      const id = untracked(() => this.selectedId());
      if (!id || this.urlFilter() || !this.store.families()) return;
      const row = untracked(() => this.rows().find((item) => item.key === id));
      if (row && !untracked(() => this.groups()).some((group) => group.rows.some((item) => item.key === id))) {
        untracked(() => this.urlFilter.set('alles'));
      }
    });
  }

  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    if (!this.desk.active() || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    const typing = !!target?.closest('input, textarea, select, [contenteditable="true"]');
    if (event.key === '/' && !typing && !document.querySelector('.overlay')) {
      event.preventDefault();
      this.searchInput()?.nativeElement.focus();
    } else if (event.key === 'Escape' && !typing && this.selected() && !document.querySelector('.overlay')) {
      event.preventDefault();
      this.close();
    }
  }

  /** ↑/↓ move the selection over the rows (the inspector follows), Enter opens it. */
  tableKey(event: KeyboardEvent): void {
    const keys = this.orderedKeys();
    if (!keys.length || !['ArrowDown', 'ArrowUp', 'Enter', 'Home', 'End'].includes(event.key)) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>('.ws-prow');
    if (!row) return;
    event.preventDefault();
    const current = keys.indexOf(row.dataset['key'] ?? '');
    if (event.key === 'Enter') {
      const item = this.rows().find((candidate) => candidate.key === row.dataset['key']);
      if (item) this.select(item);
      queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>('.ws-inspector .ws-switch, .ws-inspector .wk-btn')?.focus());
      return;
    }
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1
      : Math.max(0, Math.min(keys.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
    const key = keys[next];
    const item = this.rows().find((candidate) => candidate.key === key);
    if (!item) return;
    this.focused.set(key);
    if (this.selected()) this.select(item);
    queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>(`.ws-prow[data-key="${CSS.escape(key)}"]`)?.focus());
  }

  setFilter(filter: ProductFilter): void {
    this.urlFilter.set(filter);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { filter }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  clearFilter(): void {
    this.query.set('');
    this.setFilter('alles');
  }

  clearSearch(event: Event): void {
    if (!this.query()) return;
    event.stopPropagation();
    this.query.set('');
  }

  select(row: ProductRow): void {
    this.selectedId.set(row.key);
    this.focused.set(row.key);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { reeks: row.key }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  close(): void {
    const key = this.selectedId();
    this.selectedId.set(null);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { reeks: null }, queryParamsHandling: 'merge', replaceUrl: true });
    if (key && this.desk.active()) queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>(`.ws-prow[data-key="${CSS.escape(key)}"]`)?.focus());
  }

  reload(): void {
    void this.store.refresh(['families']);
  }

  canToggle(row: ProductRow): boolean {
    if (row.id === null) return false;
    if (row.status === 'PUBLISHED') return true;
    return row.active && row.points === 0;
  }

  pillClass(row: ProductRow): string {
    if (!row.active) return 'wk-pill ws-pill--danger';
    if (row.status === 'PUBLISHED') return 'wk-pill tone-ok';
    return row.status === 'READY' ? 'wk-pill wk-pill--outline' : 'wk-pill';
  }

  categoryLine(row: ProductRow): string {
    return `${row.categoryName || 'Zonder categorie'} · ${plural(row.family.variantCount, 'variant', 'varianten')}`;
  }

  statusLine(row: ProductRow): string {
    return productStatusLine(row, row.statusWord);
  }

  phoneLine(row: ProductRow): string {
    if (!row.reason && row.status === 'PUBLISHED' && row.family.publicHandle) return `Live · /products/${row.family.publicHandle}`;
    return this.statusLine(row) + (row.family.variantCount === 0 ? ' · geen varianten' : '');
  }

  hintKind(row: ProductRow): 'ready' | 'novariants' | 'inactive' | 'inactive-live' | null {
    if (!row.active) return row.status === 'PUBLISHED' ? 'inactive-live' : 'inactive';
    if (row.family.variantCount === 0) return 'novariants';
    if (row.reason === 'ready') return 'ready';
    return null;
  }

  issueLines(row: ProductRow): string[] {
    const names = new Map<string, string>();
    for (const member of row.family.members ?? []) {
      if (member.canonicalVariantKey) names.set(member.canonicalVariantKey, member.name);
      if (member.sku) names.set(member.sku, member.name);
    }
    return describePublicationIssues(row.family.publicationIssues ?? [], names);
  }

  /** The switch never flips by itself: the row follows the answer of the server. */
  switched(row: ProductRow, event: Event): void {
    const input = event.target as HTMLInputElement;
    const wanted = input.checked;
    input.checked = row.status === 'PUBLISHED';
    if (wanted) {
      void this.setVisible(row, true);
      return;
    }
    this.ui.confirm({
      title: `${row.name} van de website halen?`,
      message: 'Bezoekers zien deze reeks niet meer. De website wordt binnen enkele minuten bijgewerkt.',
      confirmLabel: 'Van de website halen',
      danger: true,
    }, () => void this.setVisible(row, false));
  }

  private async setVisible(row: ProductRow, visible: boolean): Promise<void> {
    const id = row.id;
    if (id === null || this.saving() !== null) return;
    if (visible && !this.canToggle(row)) return;
    this.actionError.set(null);
    this.actionNotice.set(null);
    this.saving.set(id);
    try {
      const result = await this.catalog.setProductFamilyWebsiteVisibility(id, visible);
      this.store.patchFamily(result.family);
      void this.sync.load();
      const name = publicFamilyName(result.family);
      if (!result.rebuildQueued && result.notice) {
        this.actionNotice.set(result.notice);
      } else if (visible) {
        this.ui.toast(`${name} staat live · de website wordt bijgewerkt`);
      }
      if (!visible) {
        const family = result.family;
        const undoable = family.active && (family.publicationIssues?.length ?? 0) === 0;
        if (undoable) {
          this.ui.toast(`${name} is van de website gehaald`, 'ok', { label: 'Ongedaan maken', run: () => {
            const current = this.rows().find((item) => item.id === id);
            if (current) void this.setVisible(current, true);
          } });
        } else {
          this.ui.toast(`${name} is van de website gehaald · activeer de reeks in het ERP om ze terug te zetten`);
        }
      }
    } catch (failure: unknown) {
      this.actionError.set(messageOf(failure, visible
        ? 'Controleer foto’s, teksten en vertalingen en probeer opnieuw.'
        : 'Herlaad de productlijst en probeer opnieuw.'));
      void this.store.refresh(['families']);
    } finally {
      this.saving.set(null);
    }
  }

  private thumbnail(family: ProductFamily): string | null {
    const images = [...(family.images ?? [])].sort((left, right) => left.position - right.position);
    return images.find((image) => image.publishedChannels.includes('WEBSITE'))?.smallUrl ?? images[0]?.smallUrl ?? null;
  }
}
