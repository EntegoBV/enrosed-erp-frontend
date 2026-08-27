import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import { LANGUAGES, LanguageCode, ProductFamily } from '../../core/api/models';
import { publicFamilyName } from './website-family-label';

type SeoFilter = 'ATTENTION' | 'ALL' | 'COMPLETE';

interface ProductSeoRow {
  family: ProductFamily;
  publicName: string;
  productId: number | null;
  englishTitle: string | null;
  missingLanguages: LanguageCode[];
  suspiciousEnglish: boolean;
}

/**
 * Product SEO is already part of ProductFamily translations. This component
 * only audits that existing projection in one request; edits stay in the
 * product translation editor and no duplicate SEO store is introduced.
 */
@Component({
  selector: 'app-website-product-seo-audit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="seo-audit card" aria-labelledby="product-seo-audit-title">
      <header class="seo-audit__head">
        <div>
          <span>Product-SEO</span>
          <h2 id="product-seo-audit-title">Controle per productreeks</h2>
          <p>Scan alle actieve families op ontbrekende SEO en mogelijk Nederlandstalige Engelse titels. Corrigeren doet u veilig in Productvertalingen.</p>
        </div>
        @if (!loading() && !loadError()) {
          <div class="seo-score" [class.seo-score--ok]="attentionCount() === 0">
            <b>{{ rows().length - attentionCount() }} / {{ rows().length }}</b>
            <small>zonder aandachtspunt</small>
          </div>
        }
      </header>

      @if (loadError()) {
        <div class="seo-state seo-state--error" role="alert">
          <div><b>Product-SEO kon niet worden gecontroleerd</b><small>{{ loadError() }}</small></div>
          <button class="btn" type="button" [disabled]="loading()" (click)="load()">Opnieuw proberen</button>
        </div>
      } @else if (loading()) {
        <div class="seo-state" role="status">Productfamilies en SEO-status laden…</div>
      } @else {
        <div class="seo-toolbar">
          <label>
            <span class="sr-only">Product-SEO zoeken</span>
            <input class="input" type="search" [ngModel]="search()"
                   (ngModelChange)="search.set($event)" placeholder="Zoek product of handle…" />
          </label>
          <div class="seo-filters" role="group" aria-label="Product-SEO filteren">
            <button type="button" [class.active]="filter() === 'ATTENTION'"
                    [attr.aria-pressed]="filter() === 'ATTENTION'"
                    (click)="filter.set('ATTENTION')">Aandacht <small>{{ attentionCount() }}</small></button>
            <button type="button" [class.active]="filter() === 'ALL'"
                    [attr.aria-pressed]="filter() === 'ALL'"
                    (click)="filter.set('ALL')">Alles <small>{{ rows().length }}</small></button>
            <button type="button" [class.active]="filter() === 'COMPLETE'"
                    [attr.aria-pressed]="filter() === 'COMPLETE'"
                    (click)="filter.set('COMPLETE')">In orde <small>{{ rows().length - attentionCount() }}</small></button>
          </div>
        </div>

        <div class="seo-list" role="list" aria-label="SEO-status per productreeks">
          @for (row of visibleRows(); track row.family.id ?? row.family.familyKey) {
            <article class="seo-row" role="listitem">
              <div class="seo-product">
                <b>{{ row.publicName }}</b>
                <small>/products/{{ row.family.publicHandle }}</small>
              </div>
              <div class="seo-english">
                <span>Engelse SEO-titel</span>
                <b>{{ row.englishTitle || 'Ontbreekt' }}</b>
                @if (row.suspiciousEnglish) {
                  <small class="warning">Mogelijk Nederlands — handmatig controleren</small>
                }
              </div>
              <div class="seo-locales">
                <span>Talen compleet</span>
                <b>{{ languages.length - row.missingLanguages.length }} / {{ languages.length }}</b>
                <small>{{ row.missingLanguages.length
                  ? 'Ontbreekt: ' + row.missingLanguages.join(', ')
                  : 'SEO-titel en beschrijving compleet' }}</small>
              </div>
              @if (row.productId; as productId) {
                <a class="btn" [class.btn--primary]="row.suspiciousEnglish || row.missingLanguages.length"
                   [routerLink]="['/products', productId, 'translations']">
                  {{ row.suspiciousEnglish || row.missingLanguages.length ? 'Controleren' : 'Openen' }}
                </a>
              } @else {
                <span class="no-product">Geen gekoppeld product</span>
              }
            </article>
          } @empty {
            <div class="seo-empty">Geen productreeksen voor deze zoekopdracht of filter.</div>
          }
        </div>
      }
    </section>
  `,
  styles: `
    :host { display: block; margin-bottom: 16px; }
    .seo-audit { overflow: hidden; }
    .seo-audit__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 22px; padding: 18px 20px; border-bottom: 1px solid var(--line); }
    .seo-audit__head > div:first-child { display: grid; gap: 4px; }
    .seo-audit__head span { color: var(--rose-dark); font-size: 11px; font-weight: 850; letter-spacing: .1em; text-transform: uppercase; }
    .seo-audit__head h2 { font-size: 22px; }
    .seo-audit__head p { max-width: 78ch; color: var(--muted); font-size: 15px; line-height: 1.5; }
    .seo-score { display: grid; min-width: 156px; gap: 2px; padding: 11px 13px; border-radius: 11px; background: var(--warn-soft); }
    .seo-score b { font-size: 22px; }
    .seo-score small { color: var(--muted); font-size: 12px; }
    .seo-score--ok { background: var(--ok-soft); color: var(--ok); }
    .seo-state { display: flex; min-height: 120px; align-items: center; justify-content: center; padding: 20px; color: var(--muted); }
    .seo-state--error { justify-content: space-between; gap: 16px; color: var(--danger); }
    .seo-state--error > div { display: grid; gap: 3px; }
    .seo-state--error small { color: var(--muted); }
    .seo-state .btn { min-height: 48px; }
    .seo-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; background: var(--surface-2); }
    .seo-toolbar label { flex: 1; max-width: 480px; }
    .seo-toolbar .input { min-height: 48px; }
    .seo-filters { display: flex; gap: 4px; padding: 4px; border-radius: 11px; background: var(--surface); }
    .seo-filters button { min-height: 40px; padding: 7px 11px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--muted); font-size: 13px; font-weight: 750; cursor: pointer; }
    .seo-filters button.active { border-color: var(--line); background: var(--rose-soft); color: var(--rose-dark); }
    .seo-filters small { display: inline-grid; min-width: 20px; height: 20px; place-items: center; margin-left: 3px; border-radius: 999px; background: var(--surface-2); font-size: 11px; }
    .seo-list { max-height: 560px; overflow: auto; }
    .seo-row { display: grid; grid-template-columns: minmax(170px, .85fr) minmax(240px, 1.35fr) minmax(180px, .75fr) auto; align-items: center; gap: 14px; min-height: 82px; padding: 12px 14px; border-top: 1px solid var(--line); }
    .seo-row:first-child { border-top: 0; }
    .seo-product, .seo-english, .seo-locales { display: grid; min-width: 0; gap: 2px; }
    .seo-product b, .seo-english b, .seo-locales b { overflow: hidden; font-size: 14px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
    .seo-product small, .seo-english small, .seo-locales small { overflow: hidden; color: var(--muted); font-size: 12px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
    .seo-english > span, .seo-locales > span { color: var(--muted-2); font-size: 10px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
    .seo-english .warning { color: var(--warn); font-weight: 750; }
    .seo-row .btn { min-width: 104px; min-height: 44px; }
    .no-product { color: var(--danger); font-size: 12px; font-weight: 700; }
    .seo-empty { display: grid; min-height: 110px; place-items: center; color: var(--muted); }
    button:focus-visible, a:focus-visible { outline: 3px solid var(--rose); outline-offset: 2px; }

    @media (max-width: 900px) {
      .seo-row { grid-template-columns: 1fr 1fr auto; }
      .seo-english { grid-column: 1 / -1; grid-row: 2; }
    }
    @media (max-width: 620px) {
      .seo-audit__head, .seo-toolbar, .seo-state--error { align-items: stretch; flex-direction: column; }
      .seo-score, .seo-toolbar label { width: 100%; max-width: none; }
      .seo-filters { overflow-x: auto; }
      .seo-row { grid-template-columns: 1fr; align-items: stretch; }
      .seo-english { grid-column: auto; grid-row: auto; }
      .seo-product b, .seo-english b, .seo-locales b,
      .seo-product small, .seo-english small, .seo-locales small { white-space: normal; }
      .seo-row .btn { width: 100%; }
    }
  `,
})
export class WebsiteProductSeoAudit {
  private readonly catalog = inject(CatalogApi);
  readonly languages = LANGUAGES;
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly families = signal<ProductFamily[]>([]);
  readonly search = signal('');
  readonly filter = signal<SeoFilter>('ATTENTION');

  readonly rows = computed<ProductSeoRow[]>(() => this.families()
    .filter((family) => family.active)
    .map((family) => {
      const englishTitle = family.texts.find((text) => text.language === 'EN')?.seoTitle?.trim() || null;
      const missingLanguages = this.languages
        .filter((language) => {
          const text = family.texts.find((item) => item.language === language.code);
          return !text?.seoTitle?.trim() || !text?.seoDescription?.trim();
        })
        .map((language) => language.code);
      return {
        family,
        publicName: publicFamilyName(family),
        productId: family.members.find((member) => member.active)?.productId
          ?? family.members[0]?.productId
          ?? null,
        englishTitle,
        missingLanguages,
        suspiciousEnglish: this.looksDutch(englishTitle),
      };
    })
    .sort((left, right) => left.publicName.localeCompare(right.publicName, 'nl')),
  );
  readonly attentionCount = computed(() => this.rows().filter((row) =>
    row.suspiciousEnglish || row.missingLanguages.length > 0).length);
  readonly visibleRows = computed(() => {
    const query = this.normalize(this.search());
    return this.rows()
      .filter((row) => {
        const attention = row.suspiciousEnglish || row.missingLanguages.length > 0;
        return this.filter() === 'ALL'
          || (this.filter() === 'ATTENTION' ? attention : !attention);
      })
      .filter((row) => !query || this.normalize([
        row.publicName,
        row.family.familyKey,
        row.family.publicHandle,
        row.englishTitle ?? '',
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

  private looksDutch(value: string | null): boolean {
    if (!value) return false;
    const normalized = this.normalize(value);
    const strongDutch = /\b(?:glazen|roos|rozen|bloemen|steelrozen|zeep|geschenk|bewaard|gepreserveerd\w*|geconserveerd\w*|droogbloemen|stolp|spiegeldoos|hartvorm\w*|vensterdoos|diamantroos|soaproos)\b/;
    if (strongDutch.test(normalized)) return true;
    const commonDutch = [' de ', ' het ', ' een ', ' voor ', ' met ', ' van ', ' en '];
    const padded = ` ${normalized} `;
    return commonDutch.filter((token) => padded.includes(token)).length >= 2;
  }

  private normalize(value: string): string {
    return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }
}
