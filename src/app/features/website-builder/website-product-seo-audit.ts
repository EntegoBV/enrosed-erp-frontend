import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import type { LanguageCode, ProductFamily } from '../../core/api/models';
import { Icon } from '../../shared/icon';
import { LoadError } from '../../shared/load-error';
import { Skeleton } from '../../shared/skeleton';
import { WEBSITE_LANGUAGE_ORDER, familyProductId, seoAttention, websiteStatusWord } from './website-attention';
import { publicFamilyName } from './website-family-label';
import { searchText } from './website-products-view';
import { WebsiteStore } from './website-store';

export type SeoFilter = 'aandacht' | 'alles' | 'inorde';

export interface ProductSeoRow {
  family: ProductFamily;
  key: string;
  publicName: string;
  productId: number | null;
  live: boolean;
  statusWord: string;
  englishTitle: string | null;
  missingLanguages: LanguageCode[];
  suspiciousEnglish: boolean;
  attention: boolean;
  search: string;
}

/** Active reeksen with their product SEO, live pages first (they are what search engines see), then concept, then name. */
export function productSeoRows(families: readonly ProductFamily[]): ProductSeoRow[] {
  return families.filter((family) => family.active).map((family) => {
    const seo = seoAttention(family, WEBSITE_LANGUAGE_ORDER);
    const publicName = publicFamilyName(family);
    return {
      family, key: String(family.id ?? family.familyKey), publicName, productId: familyProductId(family),
      live: family.websiteStatus === 'PUBLISHED', statusWord: websiteStatusWord(family),
      englishTitle: seo.englishTitle, missingLanguages: seo.missingLanguages, suspiciousEnglish: seo.suspiciousEnglish,
      attention: seo.attention, search: searchText(publicName, family.familyKey, family.publicHandle, seo.englishTitle),
    };
  }).sort((left, right) => Number(right.live) - Number(left.live) || left.publicName.localeCompare(right.publicName, 'nl'));
}

/**
 * Product SEO lives in the reeks' translations; this table only audits it
 * (from WebsiteStore, no request of its own) and links to the product's
 * translations. Desk: a kit table; phone: an inset group.
 */
@Component({
  selector: 'app-website-product-seo-audit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  imports: [Icon, LoadError, NgTemplateOutlet, RouterLink, Skeleton],
  template: `
    @if (store.errors().families && !store.families()) {
      <app-load-error title="Publieke producten konden niet worden geladen" [message]="store.errors().families!" [busy]="store.isLoading('families')" (retry)="store.refresh(['families'])" />
    } @else if (!store.families()) {
      @if (layout() === 'desk') { <div class="wk-card"><app-skeleton kind="table" [rows]="10" /></div> } @else { <app-skeleton kind="group" [rows]="6" /> }
    } @else if (layout() === 'desk') {
      @if (visible().length) {
        <div class="wk-card ws-table-card">
          <div class="wk-table ws-seo" role="table" aria-label="Product-SEO per reeks">
            <div class="wk-thead" role="row">
              <span class="wk-th" role="columnheader">Productreeks</span>
              <span class="wk-th" role="columnheader">Status</span>
              <span class="wk-th" role="columnheader">EN SEO-titel</span>
              <span class="wk-th" role="columnheader">Talen</span>
              <span class="wk-th" role="columnheader"><span class="sr-only">Openen</span></span>
            </div>
            @for (row of visible(); track row.key) {
              @if (row.productId; as productId) {
                <a class="wk-tr wk-tr--link ws-seo-row" role="row" [routerLink]="['/products', productId, 'translations']">
                  <ng-container *ngTemplateOutlet="cells; context: { $implicit: row }" />
                  <app-icon class="ws-chev" name="chevron-right" [size]="16" />
                </a>
              } @else {
                <div class="wk-tr ws-seo-row" role="row">
                  <ng-container *ngTemplateOutlet="cells; context: { $implicit: row }" />
                  <span></span>
                </div>
              }
            }
          </div>
        </div>
      } @else {
        <div class="wk-card"><div class="wk-empty"><h2 class="wk-empty__title">Geen reeksen voor deze zoekopdracht of filter</h2></div></div>
      }
    } @else {
      <section class="ios-section">
        <div class="ios-group">
          @for (row of visible(); track row.key) {
            <a class="ios-cell" [routerLink]="row.productId ? ['/products', row.productId, 'translations'] : null" [class.ws-cell-static]="!row.productId">
              <span class="ios-cell__body">
                <span class="ios-cell__title ios-cell__title--2">{{ row.publicName }}</span>
                <span class="ios-cell__sub ws-ph-url" [class.ws-url--none]="!row.family.publicHandle">{{ row.family.publicHandle ? '/products/' + row.family.publicHandle : 'Nog geen webadres' }}</span>
                <span class="ios-cell__sub ios-cell__sub--wrap">{{ row.missingLanguages.length ? 'Ontbreekt: ' + row.missingLanguages.join(', ') : 'EN: ' + (row.englishTitle || 'Ontbreekt') }}</span>
                @if (row.suspiciousEnglish) { <span class="ios-cell__sub ws-warn-text">Mogelijk Nederlands — controleren</span> }
                @if (!row.productId) { <span class="ios-cell__sub">Geen gekoppelde variant</span> }
              </span>
              <span class="ios-cell__value" [class.ws-warn-text]="row.missingLanguages.length">{{ languageCount - row.missingLanguages.length }}/{{ languageCount }}</span>
              @if (row.productId) { <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" /> }
            </a>
          } @empty {
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__sub">Geen reeksen voor deze zoekopdracht of filter.</span></span></div>
          }
        </div>
      </section>
    }

    <ng-template #cells let-row>
      <span class="wk-td ws-name" role="cell">
        <b [attr.title]="row.publicName">{{ row.publicName }}</b>
        @if (row.family.publicHandle) { <small class="ws-mono-line">/products/{{ row.family.publicHandle }}</small> }
        @else { <small class="ws-url--none">Nog geen webadres</small> }
      </span>
      <span class="wk-td" role="cell"><span class="wk-pill" [class.tone-ok]="row.live">{{ row.live ? 'Live' : row.statusWord }}</span></span>
      <span class="wk-td ws-name" role="cell">
        <b class="ws-seo-title" [class.ws-warn-text]="!row.englishTitle" [attr.title]="row.englishTitle">{{ row.englishTitle || 'Ontbreekt' }}</b>
        @if (row.suspiciousEnglish) { <small class="ws-warn-text">Mogelijk Nederlands — controleren</small> }
      </span>
      <span class="wk-td ws-name" role="cell">
        <b [class.ws-warn-text]="row.missingLanguages.length" [class.ws-ok-text]="!row.missingLanguages.length">{{ languageCount - row.missingLanguages.length }}/{{ languageCount }}@if (!row.missingLanguages.length) { ✓ }</b>
        <small [attr.title]="row.missingLanguages.length ? 'Ontbreekt: ' + row.missingLanguages.join(', ') : 'SEO-titel en beschrijving compleet'">{{ row.missingLanguages.length ? 'Ontbreekt: ' + row.missingLanguages.join(', ') : 'SEO-titel en beschrijving compleet' }}</small>
        @if (!row.productId) { <small>Geen gekoppelde variant</small> }
      </span>
    </ng-template>
  `,
})
export class WebsiteProductSeoAudit {
  readonly store = inject(WebsiteStore);
  readonly layout = input<'desk' | 'phone'>('desk');
  readonly filter = input<SeoFilter>('aandacht');
  readonly query = input('');
  readonly languageCount = WEBSITE_LANGUAGE_ORDER.length;

  readonly rows = computed(() => productSeoRows(this.store.families() ?? []));
  readonly visible = computed(() => {
    const needle = searchText(this.query());
    const filter = this.filter();
    return this.rows()
      .filter((row) => filter === 'alles' || (filter === 'aandacht' ? row.attention : !row.attention))
      .filter((row) => !needle || row.search.includes(needle));
  });
}
