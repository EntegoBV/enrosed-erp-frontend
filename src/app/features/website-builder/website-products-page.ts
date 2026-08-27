import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { AuthImage } from '../../core/api/auth-image';
import { messageOf } from '../../core/api/errors';
import { LANGUAGES, ProductFamily, PublicationStatus } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { WebsiteSyncStatus } from '../settings/website-sync-status';
import { publicFamilyName } from './website-family-label';

type ProductWebsiteFilter = 'ATTENTION' | 'ALL' | 'PUBLISHED' | 'HIDDEN';

const GLASS_BOWL_FAMILY_KEYS = new Set(['bowl-rose-xl', 'preserved-bowl-rose']);

interface WebsiteProductRow {
  family: ProductFamily;
  publicName: string;
  productId: number | null;
  translatedLanguages: number;
  seoLanguages: number;
  attention: boolean;
  thumbnail: string | null;
}

@Component({
  selector: 'app-website-products-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, FormsModule, PageHeader, RouterLink, WebsiteSyncStatus],
  template: `
    <app-page-header
      title="Publieke productinhoud"
      subtitle="Beheer alleen wat klanten op de website zien."
      [showBell]="false"
    >
      <a class="btn btn--sm" routerLink="/products">ERP-producten openen</a>
    </app-page-header>

    <main class="content website-products-page">
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

      <app-website-sync-status [refreshKey]="syncRefreshKey()" />

      @if (loadError()) {
        <section class="products-state products-state--error card" role="alert">
          <div><b>Publieke producten konden niet worden geladen</b><small>{{ loadError() }}</small></div>
          <button class="btn btn--primary" type="button" [disabled]="loading()" (click)="load()">Opnieuw proberen</button>
        </section>
      } @else if (loading()) {
        <section class="products-state card" role="status">Productreeksen en publicatiestatus laden…</section>
      } @else {
        @if (actionError()) {
          <section class="products-action-error card" role="alert">
            <span><b>Websitezichtbaarheid is niet gewijzigd</b><small>{{ actionError() }}</small></span>
            <button class="btn btn--sm" type="button" (click)="actionError.set(null)">Sluiten</button>
          </section>
        }
        @if (actionNotice()) {
          <section class="products-action-notice card" role="status">
            <span><b>Wijziging opgeslagen</b><small>{{ actionNotice() }}</small></span>
            <a class="btn btn--sm" routerLink="/website/publication">Publicatie bekijken</a>
          </section>
        }
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
            <button type="button" [class.active]="filter() === 'HIDDEN'"
                    [attr.aria-pressed]="filter() === 'HIDDEN'"
                    (click)="filter.set('HIDDEN')">Verborgen</button>
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
                <span class="product-photo" [class.product-photo--empty]="!row.thumbnail" aria-hidden="true">
                  @if (row.thumbnail) { <img [appAuthSrc]="row.thumbnail" alt="" /> }
                </span>
                <span>
                  <b>{{ row.publicName }}</b>
                  <small>{{ row.family.categoryName || 'Zonder categorie' }} · {{ row.family.variantCount }} varianten</small>
                  @if (isGlassBowl(row.family)) { <em>Bestseller</em> }
                </span>
              </div>
              <div class="product-status" role="cell">
                <span class="status-badge" [class.status-badge--live]="row.family.websiteStatus === 'PUBLISHED'">
                  {{ row.family.active ? publicationLabel(row.family.websiteStatus) : 'ERP inactief' }}
                </span>
                @if (row.family.publicHandle) {
                  <small>/products/{{ row.family.publicHandle }}</small>
                } @else {
                  <small>Nog geen publieke URL</small>
                }
                <label class="website-switch" [class.website-switch--busy]="savingFamilyId() === row.family.id">
                  <input
                    type="checkbox"
                    role="switch"
                    [attr.aria-label]="'Op website: ' + row.publicName"
                    [checked]="row.family.websiteStatus === 'PUBLISHED'"
                    [disabled]="!canToggle(row) || savingFamilyId() === row.family.id"
                    (change)="toggleWebsite(row, $any($event.target).checked)"
                  />
                  <span aria-hidden="true"><i></i></span>
                  <b>{{ savingFamilyId() === row.family.id ? 'Opslaan…' : 'Op website' }}</b>
                </label>
                @if (!row.family.active && row.family.websiteStatus !== 'PUBLISHED') {
                  <small class="switch-hint">Activeer deze reeks eerst in ERP.</small>
                } @else if (!row.family.active) {
                  <small class="switch-hint">ERP inactief; u kunt deze reeks nog van de website halen.</small>
                } @else if (row.family.websiteStatus !== 'PUBLISHED' && row.family.publicationIssues.length) {
                  <small class="switch-hint">Werk eerst de publicatiepunten af.</small>
                }
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
    .products-action-error { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 12px; padding: 14px 16px; border-color: #efcdc9; background: var(--danger-soft); color: var(--danger); }
    .products-action-error > span { display: grid; gap: 2px; }
    .products-action-error small { color: var(--ink-2); font-size: 13px; }
    .products-action-notice { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 12px; padding: 14px 16px; border-color: var(--warn); background: var(--warn-soft); color: var(--ink); }
    .products-action-notice > span { display: grid; gap: 2px; }
    .products-action-notice small { color: var(--ink-2); font-size: 13px; }
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
    .product-photo { display: grid; flex: none; width: 58px; height: 58px; overflow: hidden; place-items: center; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2); }
    .product-photo img { width: 100%; height: 100%; object-fit: contain; }
    .product-photo--empty::after { color: var(--muted-2); font-size: 22px; content: "◇"; }
    .product-status { display: grid; min-width: 0; justify-items: start; gap: 5px; }
    .status-badge { display: inline-flex; min-height: 28px; align-items: center; padding: 4px 8px; border-radius: 999px; background: var(--warn-soft); color: var(--warn); font-size: 12px; font-weight: 800; }
    .status-badge--live { background: var(--ok-soft); color: var(--ok); }
    .website-switch { display: inline-flex; min-height: 44px; align-items: center; gap: 9px; cursor: pointer; }
    .website-switch input { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; }
    .website-switch > span { position: relative; width: 42px; height: 24px; flex: none; border: 1px solid var(--line-strong); border-radius: 999px; background: var(--surface-2); transition: background .16s ease, border-color .16s ease; }
    .website-switch i { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: var(--muted-2); transition: transform .16s ease, background .16s ease; }
    .website-switch input:checked + span { border-color: var(--ok); background: var(--ok-soft); }
    .website-switch input:checked + span i { background: var(--ok); transform: translateX(18px); }
    .website-switch input:focus-visible + span { outline: 3px solid var(--rose); outline-offset: 2px; }
    .website-switch input:disabled + span { opacity: .48; }
    .website-switch:has(input:disabled) { color: var(--muted); cursor: not-allowed; }
    .website-switch b { font-size: 12px; }
    .website-switch--busy { opacity: .68; }
    .switch-hint { max-width: 24ch; color: var(--warn) !important; white-space: normal !important; }
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
      .products-toolbar, .products-state--error, .products-action-error, .products-action-notice { align-items: stretch; flex-direction: column; }
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
  readonly savingFamilyId = signal<number | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly actionNotice = signal<string | null>(null);
  readonly syncRefreshKey = signal(0);

  readonly rows = computed<WebsiteProductRow[]>(() => this.families()
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
          || !family.active
          || family.publicationIssues.length > 0
          || translatedLanguages < this.languages.length
          || seoLanguages < this.languages.length,
        thumbnail: this.familyThumbnail(family),
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
        if (this.filter() === 'PUBLISHED') return row.family.websiteStatus === 'PUBLISHED';
        return row.family.websiteStatus !== 'PUBLISHED';
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
      this.loadError.set(messageOf(failure, 'Controleer de verbinding met Enrosed.'));
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

  canToggle(row: WebsiteProductRow): boolean {
    if (row.family.id === null) return false;
    if (row.family.websiteStatus === 'PUBLISHED') return true;
    return row.family.active && row.family.publicationIssues.length === 0;
  }

  async toggleWebsite(row: WebsiteProductRow, visible: boolean): Promise<void> {
    const id = row.family.id;
    if (id === null || this.savingFamilyId() !== null) return;
    if (visible && !this.canToggle(row)) return;
    this.actionError.set(null);
    this.actionNotice.set(null);
    this.savingFamilyId.set(id);
    try {
      const result = await this.catalog.setProductFamilyWebsiteVisibility(id, visible);
      this.families.update((families) => families.map((family) => family.id === id ? result.family : family));
      if (!result.rebuildQueued && result.notice) this.actionNotice.set(result.notice);
      this.syncRefreshKey.update((value) => value + 1);
    } catch (failure: unknown) {
      this.actionError.set(messageOf(
        failure,
        visible
          ? 'Controleer foto’s, teksten en vertalingen en probeer opnieuw.'
          : 'Herlaad de productlijst en probeer opnieuw.',
      ));
      await this.load();
    } finally {
      this.savingFamilyId.set(null);
    }
  }

  private familyThumbnail(family: ProductFamily): string | null {
    const websiteImage = family.images
      .filter((image) => image.publishedChannels.includes('WEBSITE'))
      .sort((left, right) => left.position - right.position)[0];
    return websiteImage?.smallUrl
      ?? [...family.images].sort((left, right) => left.position - right.position)[0]?.smallUrl
      ?? null;
  }

  private normalize(value: string): string {
    return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }
}
