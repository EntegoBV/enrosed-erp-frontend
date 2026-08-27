import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import { LANGUAGES, ProductFamily, PublicationStatus } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { WebsiteAdminNav } from './website-admin-nav';
import { publicFamilyName } from './website-family-label';

type ProductWebsiteFilter = 'ATTENTION' | 'ALL' | 'PUBLISHED' | 'DRAFT';

const GLASS_BOWL_FAMILY_KEYS = new Set(['bowl-rose-xl', 'preserved-bowl-rose']);

interface WebsiteProductRow {
  family: ProductFamily;
  publicName: string;
  productId: number | null;
  translatedLanguages: number;
  seoLanguages: number;
  attention: boolean;
}

@Component({
  selector: 'app-website-products-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeader, RouterLink, WebsiteAdminNav],
  template: `
    <app-page-header
      title="Publieke productinhoud"
      subtitle="Beheer alleen wat klanten op de website zien."
      [showBell]="false"
    >
      <a class="btn btn--sm" routerLink="/products">ERP-producten openen</a>
    </app-page-header>

    <main class="content website-products-page">
      <app-website-admin-nav active="products" />

      <section class="product-ownership" role="note">
        <div>
          <b>Websitegegevens per productreeks</b>
          <span>Zichtbaarheid, collectie, foto’s, publieke naam, beschrijving, product-SEO en vertalingen.</span>
        </div>
        <div>
          <b>Operationele data blijft veilig apart</b>
          <span>Geen voorraad, kostprijs, interne naam of verwijderactie in deze websitewerkplek.</span>
        </div>
      </section>

      @if (loadError()) {
        <section class="products-state products-state--error card" role="alert">
          <div><b>Publieke producten konden niet worden geladen</b><small>{{ loadError() }}</small></div>
          <button class="btn btn--primary" type="button" [disabled]="loading()" (click)="load()">Opnieuw proberen</button>
        </section>
      } @else if (loading()) {
        <section class="products-state card" role="status">Productreeksen en publicatiestatus laden…</section>
      } @else {
        <section class="products-toolbar card" aria-label="Publieke producten zoeken en filteren">
          <label>
            <span class="sr-only">Product zoeken</span>
            <input class="input" type="search" [ngModel]="search()"
                   (ngModelChange)="search.set($event)"
                   placeholder="Zoek product, categorie of website-handle…" />
          </label>
          <div class="products-filters" role="group" aria-label="Publicatiestatus filteren">
            <button type="button" [class.active]="filter() === 'ATTENTION'"
                    [attr.aria-pressed]="filter() === 'ATTENTION'"
                    (click)="filter.set('ATTENTION')">Aandacht <small>{{ attentionCount() }}</small></button>
            <button type="button" [class.active]="filter() === 'ALL'"
                    [attr.aria-pressed]="filter() === 'ALL'"
                    (click)="filter.set('ALL')">Alles <small>{{ rows().length }}</small></button>
            <button type="button" [class.active]="filter() === 'PUBLISHED'"
                    [attr.aria-pressed]="filter() === 'PUBLISHED'"
                    (click)="filter.set('PUBLISHED')">Website live</button>
            <button type="button" [class.active]="filter() === 'DRAFT'"
                    [attr.aria-pressed]="filter() === 'DRAFT'"
                    (click)="filter.set('DRAFT')">Concept</button>
          </div>
        </section>

        <section class="products-summary" aria-live="polite">
          <span><b>{{ visibleRows().length }}</b> van {{ rows().length }} productreeksen</span>
          <small>Familietekst telt naam + beschrijving; variantnamen en foto-alt bewerkt u via de CTA maar staan niet in die score.</small>
        </section>

        <div class="product-table card" role="table" aria-label="Publieke productinhoud">
          <div class="product-row product-row--head" role="row">
            <span role="columnheader">Productreeks</span>
            <span role="columnheader">Website</span>
            <span role="columnheader">Inhoud</span>
            <span role="columnheader">Acties</span>
          </div>
          @for (row of visibleRows(); track row.family.id ?? row.family.familyKey) {
            <article class="product-row" role="row">
              <div class="product-main" role="cell">
                <span class="product-swatch" [class.product-swatch--glass]="isGlassBowl(row.family)" aria-hidden="true"></span>
                <span>
                  <b>{{ row.publicName }}</b>
                  <small>{{ row.family.categoryName || 'Zonder categorie' }} · {{ row.family.variantCount }} varianten</small>
                  @if (isGlassBowl(row.family)) { <em>Bestseller</em> }
                </span>
              </div>
              <div class="product-status" role="cell">
                <span class="status-badge" [class.status-badge--live]="row.family.websiteStatus === 'PUBLISHED'">
                  {{ publicationLabel(row.family.websiteStatus) }}
                </span>
                <small>/products/{{ row.family.publicHandle }}</small>
              </div>
              <div class="product-completion" role="cell">
                <span [class.done]="row.translatedLanguages === languages.length">
                  Familietekst <b>{{ row.translatedLanguages }}/{{ languages.length }}</b>
                </span>
                <span [class.done]="row.seoLanguages === languages.length">
                  SEO <b>{{ row.seoLanguages }}/{{ languages.length }}</b>
                </span>
                @if (row.family.publicationIssues.length) {
                  <small class="issues">{{ row.family.publicationIssues.length }} publicatiepunten</small>
                }
              </div>
              <div class="product-actions" role="cell">
                @if (row.productId; as productId) {
                  <a class="btn" [routerLink]="['/products', productId, 'edit']">Foto's &amp; zichtbaarheid</a>
                  <a class="btn btn--primary" [routerLink]="['/products', productId, 'translations']">Teksten &amp; SEO</a>
                } @else {
                  <span>Geen product gekoppeld</span>
                }
              </div>
            </article>
          } @empty {
            <div class="products-empty">Geen productreeksen voor deze zoekopdracht of filter.</div>
          }
        </div>
      }
    </main>
  `,
  styles: `
    :host { display: block; }
    .website-products-page { max-width: 1540px; padding-bottom: calc(72px + env(safe-area-inset-bottom)); }
    .product-ownership { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; padding: 14px; border: 1px solid var(--rose-line); border-radius: var(--r); background: var(--rose-soft); }
    .product-ownership > div { display: grid; gap: 3px; }
    .product-ownership b { color: var(--rose-dark); font-size: 15px; }
    .product-ownership span { color: var(--muted); font-size: 14px; line-height: 1.45; }
    .products-state { display: flex; min-height: 150px; align-items: center; justify-content: center; color: var(--muted); }
    .products-state--error { justify-content: space-between; gap: 18px; padding: 18px; color: var(--danger); }
    .products-state--error > div { display: grid; gap: 3px; }
    .products-state--error small { color: var(--muted); }
    .products-state .btn { min-height: 48px; }
    .products-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; }
    .products-toolbar label { flex: 1; max-width: 560px; }
    .products-toolbar .input { min-height: 48px; }
    .products-filters { display: flex; gap: 4px; padding: 4px; border-radius: 11px; background: var(--surface-2); }
    .products-filters button { min-height: 40px; padding: 7px 11px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--muted); font-size: 13px; font-weight: 750; cursor: pointer; }
    .products-filters button.active { border-color: var(--line); background: var(--surface); color: var(--rose-dark); box-shadow: var(--sh-1); }
    .products-filters small { display: inline-grid; min-width: 20px; height: 20px; place-items: center; margin-left: 3px; border-radius: 999px; background: var(--warn-soft); color: var(--warn); font-size: 11px; }
    .products-summary { display: flex; justify-content: space-between; gap: 14px; padding: 11px 2px; color: var(--muted); font-size: 13px; }
    .products-summary b { color: var(--ink); }
    .product-table { overflow: hidden; }
    .product-row { display: grid; grid-template-columns: minmax(240px, 1.05fr) minmax(170px, .65fr) minmax(210px, .75fr) minmax(300px, 1fr); align-items: center; gap: 16px; min-height: 88px; padding: 12px 15px; border-top: 1px solid var(--line); }
    .product-row:first-child { border-top: 0; }
    .product-row--head { min-height: 44px; background: var(--surface-2); color: var(--muted); font-size: 11px; font-weight: 850; letter-spacing: .08em; text-transform: uppercase; }
    .product-main { display: flex; min-width: 0; align-items: center; gap: 11px; }
    .product-main > span:last-child { display: grid; min-width: 0; gap: 2px; }
    .product-main b { overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
    .product-main small, .product-status small { overflow: hidden; color: var(--muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .product-main em { justify-self: start; padding: 3px 6px; border-radius: 999px; background: var(--rose-soft); color: var(--rose-dark); font-size: 10px; font-style: normal; font-weight: 850; text-transform: uppercase; }
    .product-swatch { flex: none; width: 42px; height: 42px; border-radius: 12px; background: linear-gradient(145deg, var(--surface-2), var(--line-strong)); }
    .product-swatch--glass { background: radial-gradient(circle at 35% 30%, #fff 0 10%, transparent 11%), linear-gradient(145deg, #d5e9ec, #784f64); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 55%); }
    .product-status { display: grid; min-width: 0; justify-items: start; gap: 5px; }
    .status-badge { display: inline-flex; min-height: 28px; align-items: center; padding: 4px 8px; border-radius: 999px; background: var(--warn-soft); color: var(--warn); font-size: 12px; font-weight: 800; }
    .status-badge--live { background: var(--ok-soft); color: var(--ok); }
    .product-completion { display: flex; flex-wrap: wrap; gap: 5px; }
    .product-completion > span { padding: 5px 7px; border-radius: 7px; background: var(--warn-soft); color: var(--ink-2); font-size: 11px; }
    .product-completion > span.done { background: var(--ok-soft); color: var(--ok); }
    .product-completion .issues { flex: 1 0 100%; color: var(--danger); font-size: 11px; font-weight: 700; }
    .product-actions { display: flex; justify-content: flex-end; gap: 7px; }
    .product-actions .btn { min-height: 44px; white-space: nowrap; }
    .product-actions > span { color: var(--danger); font-size: 12px; font-weight: 700; }
    .products-empty { display: grid; min-height: 150px; place-items: center; color: var(--muted); }
    button:focus-visible, a:focus-visible { outline: 3px solid var(--rose); outline-offset: 2px; }

    @media (max-width: 1120px) {
      .product-row { grid-template-columns: minmax(220px, 1fr) minmax(150px, .7fr) minmax(200px, .8fr); }
      .product-actions { grid-column: 1 / -1; justify-content: flex-start; }
      .product-row--head span:last-child { display: none; }
    }
    @media (max-width: 720px) {
      .website-products-page { padding-inline: 12px; }
      .product-ownership, .product-row { grid-template-columns: 1fr; }
      .products-toolbar, .products-state--error { align-items: stretch; flex-direction: column; }
      .products-toolbar label { max-width: none; }
      .products-filters { overflow-x: auto; }
      .products-summary { align-items: flex-start; flex-direction: column; }
      .product-row--head { display: none; }
      .product-actions { grid-column: auto; display: grid; grid-template-columns: 1fr; }
      .product-actions .btn, .products-state .btn { width: 100%; }
    }
  `,
})
export class WebsiteProductsPage {
  private readonly catalog = inject(CatalogApi);
  readonly languages = LANGUAGES;
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly families = signal<ProductFamily[]>([]);
  readonly search = signal('');
  readonly filter = signal<ProductWebsiteFilter>('ALL');

  readonly rows = computed<WebsiteProductRow[]>(() => this.families()
    .filter((family) => family.active)
    .map((family) => {
      const translatedLanguages = this.languages.filter((language) => {
        const text = family.texts.find((item) => item.language === language.code);
        return !!text?.name?.trim() && !!text?.description?.trim();
      }).length;
      const seoLanguages = this.languages.filter((language) => {
        const text = family.texts.find((item) => item.language === language.code);
        return !!text?.seoTitle?.trim() && !!text?.seoDescription?.trim();
      }).length;
      return {
        family,
        publicName: publicFamilyName(family),
        productId: family.members.find((member) => member.active)?.productId
          ?? family.members[0]?.productId
          ?? null,
        translatedLanguages,
        seoLanguages,
        attention: family.websiteStatus !== 'PUBLISHED'
          || family.publicationIssues.length > 0
          || translatedLanguages < this.languages.length
          || seoLanguages < this.languages.length,
      };
    })
    .sort((left, right) => {
      const bestseller = Number(this.isGlassBowl(right.family)) - Number(this.isGlassBowl(left.family));
      return bestseller || left.family.categoryPosition - right.family.categoryPosition
        || left.family.productPosition - right.family.productPosition
        || left.publicName.localeCompare(right.publicName, 'nl');
    }),
  );
  readonly attentionCount = computed(() => this.rows().filter((row) => row.attention).length);
  readonly visibleRows = computed(() => {
    const query = this.normalize(this.search());
    return this.rows()
      .filter((row) => {
        if (this.filter() === 'ALL') return true;
        if (this.filter() === 'ATTENTION') return row.attention;
        return row.family.websiteStatus === this.filter();
      })
      .filter((row) => !query || this.normalize([
        row.publicName,
        row.family.familyKey,
        row.family.publicHandle,
        row.family.categoryName ?? '',
      ].join(' ')).includes(query));
  });

  constructor() { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.families.set(await this.catalog.productFamilies());
    } catch (failure: unknown) {
      this.loadError.set(messageOf(failure, 'Controleer de verbinding met de testomgeving.'));
    } finally {
      this.loading.set(false);
    }
  }

  publicationLabel(status: PublicationStatus): string {
    if (status === 'PUBLISHED') return 'Website live';
    return status === 'DRAFT' ? 'Concept' : 'Niet zichtbaar';
  }

  isGlassBowl(family: ProductFamily): boolean {
    return GLASS_BOWL_FAMILY_KEYS.has(family.familyKey);
  }

  private normalize(value: string): string {
    return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }
}
