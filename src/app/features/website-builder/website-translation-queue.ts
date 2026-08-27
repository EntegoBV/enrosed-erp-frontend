import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import {
  Category,
  ContentTranslationOverview,
  LANGUAGES,
  LanguageCode,
  ProductFamily,
} from '../../core/api/models';
import { Ui } from '../../shared/ui';
import { localizedFamilySource, publicFamilyName } from './website-family-label';

type TranslationTaskKind = 'PRODUCT' | 'CATEGORY' | 'WEBSITE';

interface TranslationTask {
  key: string;
  kind: TranslationTaskKind;
  title: string;
  detail: string;
  missingLanguages: LanguageCode[];
  link: string | (string | number)[];
  action: string;
}

@Component({
  selector: 'app-website-translation-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="translation-queue card" id="translation-work" aria-labelledby="translation-work-title">
      <header class="translation-queue__head">
        <div>
          <span class="eyebrow">Werkvoorraad</span>
          <h2 id="translation-work-title">Vertalingen die later nog mogen</h2>
          <p>
            Vul product- en categoriegegevens gerust nu al in. Ontbrekende talen blokkeren
            opslaan niet; ze blijven hier als concrete vervolgtaken staan. Publiceren kan wel
            wachten tot verplichte websitecopy compleet is.
          </p>
        </div>
        <div class="translation-queue__actions">
          <button class="btn btn--primary" type="button" [disabled]="loading() || tasks().length === 0"
                  (click)="copyCodexBrief()">
            Kopieer opdracht voor Codex
          </button>
          <button class="btn" type="button" [disabled]="loading()" (click)="load()">
            {{ loading() ? 'Controleren…' : 'Status vernieuwen' }}
          </button>
        </div>
      </header>

      @if (loading() && !loadedOnce()) {
        <div class="queue-state" role="status">Websitecopy, productreeksen en categorieën controleren…</div>
      } @else {
        <div class="queue-summary" aria-label="Vertaalstatus per onderdeel">
          <a routerLink="/website/products" [class.complete]="productTasks().length === 0">
            <span>Productinhoud</span>
            <b>{{ productTasks().length }}</b>
            <small>{{ productTasks().length === 1 ? 'open producttaak' : 'open producttaken' }}</small>
          </a>
          <a routerLink="/website/categories" [class.complete]="categoryTasks().length === 0">
            <span>Categorieën &amp; menu</span>
            <b>{{ categoryTasks().length }}</b>
            <small>{{ categoryTasks().length === 1 ? 'categorie met werk' : 'categorieën met werk' }}</small>
          </a>
          <a routerLink="/website/texts" [class.complete]="websiteTasks().length === 0">
            <span>Websiteteksten</span>
            <b>{{ websiteTasks().length }}</b>
            <small>{{ websiteTasks().length === 1 ? 'tekstgroep met werk' : 'tekstgroepen met werk' }}</small>
          </a>
        </div>

        @if (sourceErrors().length) {
          <div class="queue-warning" role="alert">
            <div><b>Een deel van de controle kon niet worden uitgevoerd</b>
              @for (error of sourceErrors(); track error) { <small>{{ error }}</small> }
            </div>
            <button class="btn btn--sm" type="button" [disabled]="loading()" (click)="load()">Opnieuw proberen</button>
          </div>
        }

        @if (tasks().length) {
          <div class="queue-list" role="list" aria-label="Eerstvolgende vertaaltaken">
            <div class="queue-list__label">
              <b>Eerstvolgende taken</b>
              <small>{{ tasks().length }} in totaal</small>
            </div>
            @for (task of visibleTasks(); track task.key) {
              <article class="queue-task" role="listitem">
                <span class="queue-task__kind" [attr.data-kind]="task.kind">{{ kindLabel(task.kind) }}</span>
                <div class="queue-task__copy">
                  <b>{{ task.title }}</b>
                  <small>{{ task.detail }}</small>
                </div>
                <div class="queue-task__languages" [attr.aria-label]="'Ontbrekende talen: ' + task.missingLanguages.join(', ')" >
                  @for (language of task.missingLanguages.slice(0, 5); track language) {
                    <span>{{ language }}</span>
                  }
                  @if (task.missingLanguages.length > 5) {
                    <span>+{{ task.missingLanguages.length - 5 }}</span>
                  }
                </div>
                <a class="btn btn--sm btn--primary" [routerLink]="task.link">{{ task.action }}</a>
              </article>
            }
            @if (tasks().length > visibleLimit) {
              <div class="queue-more">
                Nog {{ tasks().length - visibleLimit }} taken. Open het betreffende onderdeel voor de volledige lijst.
              </div>
            }
          </div>
        } @else if (!sourceErrors().length) {
          <div class="queue-state queue-state--complete" role="status">
            <span aria-hidden="true">✓</span>
            <div><b>Geen open vertaaltaken gevonden</b><small>Alle gecontroleerde website-, productreeks- en categorieteksten zijn compleet.</small></div>
          </div>
        }

        <div class="identity-note" role="note">
          <span aria-hidden="true">↗</span>
          <p><b>Namen mogen veranderen zonder de koppeling te verliezen.</b> Producten en categorieën worden achter de schermen via hun vaste record en versie opgeslagen. De zichtbare titel is dus geen technische sleutel; houd alleen de publieke URL-code stabiel als bestaande links moeten blijven werken.</p>
        </div>
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .translation-queue { margin-top: 18px; padding: 20px; scroll-margin-top: calc(var(--appbar-h) + 14px); }
    .translation-queue__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
    .translation-queue__head > div { max-width: 850px; }
    .eyebrow { color: var(--rose-dark); font-size: 11px; font-weight: 850; letter-spacing: .11em; text-transform: uppercase; }
    h2 { margin-top: 4px; font-size: 25px; line-height: 1.2; }
    .translation-queue__head p { margin-top: 7px; color: var(--muted); font-size: 15px; line-height: 1.55; }
    .translation-queue__actions { display: flex; flex: none; gap: 7px; }
    .translation-queue__head .btn { min-height: 46px; white-space: nowrap; }
    .queue-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; margin-top: 17px; }
    .queue-summary a { display: grid; grid-template-columns: 1fr auto; gap: 3px 12px; padding: 13px 14px; border: 1px solid var(--warn); border-radius: var(--r-sm); background: var(--warn-soft); color: var(--ink); text-decoration: none; }
    .queue-summary a > span { align-self: center; color: var(--ink-2); font-size: 14px; font-weight: 780; }
    .queue-summary a > b { grid-row: span 2; align-self: center; color: var(--warn); font-size: 30px; line-height: 1; }
    .queue-summary a > small { color: var(--muted); font-size: 12px; }
    .queue-summary a.complete { border-color: color-mix(in srgb, var(--ok) 42%, var(--line)); background: var(--ok-soft); }
    .queue-summary a.complete > b { color: var(--ok); }
    .queue-warning { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 10px; padding: 11px 12px; border-radius: var(--r-sm); background: var(--danger-soft); color: var(--danger); }
    .queue-warning > div { display: grid; gap: 2px; }
    .queue-warning small { color: var(--ink-2); font-size: 12px; }
    .queue-list { margin-top: 14px; overflow: hidden; border: 1px solid var(--line); border-radius: var(--r-sm); }
    .queue-list__label { display: flex; min-height: 43px; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 12px; background: var(--surface-2); }
    .queue-list__label b { font-size: 14px; }
    .queue-list__label small { color: var(--muted); font-size: 12px; }
    .queue-task { display: grid; grid-template-columns: 104px minmax(220px, 1fr) minmax(150px, auto) 150px; align-items: center; gap: 12px; min-height: 68px; padding: 10px 12px; border-top: 1px solid var(--line); }
    .queue-task__kind { justify-self: start; padding: 4px 7px; border-radius: 999px; background: var(--surface-2); color: var(--muted); font-size: 10px; font-weight: 850; letter-spacing: .06em; text-transform: uppercase; }
    .queue-task__kind[data-kind='PRODUCT'] { background: var(--rose-soft); color: var(--rose-dark); }
    .queue-task__kind[data-kind='CATEGORY'] { background: #eef5ff; color: #24528a; }
    .queue-task__copy { display: grid; min-width: 0; gap: 2px; }
    .queue-task__copy b { overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
    .queue-task__copy small { color: var(--muted); font-size: 12px; line-height: 1.35; }
    .queue-task__languages { display: flex; justify-content: flex-end; gap: 3px; }
    .queue-task__languages span { display: grid; min-width: 27px; height: 27px; place-items: center; padding-inline: 4px; border-radius: 7px; background: var(--warn-soft); color: var(--warn); font-size: 10px; font-weight: 850; }
    .queue-task .btn { min-height: 42px; justify-content: center; white-space: nowrap; }
    .queue-more { padding: 10px 12px; border-top: 1px solid var(--line); background: var(--surface-2); color: var(--muted); font-size: 12px; text-align: center; }
    .queue-state { display: flex; min-height: 120px; align-items: center; justify-content: center; margin-top: 14px; border-radius: var(--r-sm); background: var(--surface-2); color: var(--muted); }
    .queue-state--complete { gap: 10px; background: var(--ok-soft); color: var(--ok); }
    .queue-state--complete > span { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 999px; background: var(--surface); font-weight: 900; }
    .queue-state--complete > div { display: grid; gap: 1px; }
    .queue-state--complete small { color: var(--muted); }
    .identity-note { display: flex; align-items: flex-start; gap: 10px; margin-top: 13px; padding: 12px 13px; border: 1px solid var(--rose-line); border-radius: var(--r-sm); background: var(--rose-soft); }
    .identity-note > span { display: grid; flex: none; width: 28px; height: 28px; place-items: center; border-radius: 999px; background: var(--surface); color: var(--rose-dark); font-weight: 850; }
    .identity-note p { color: var(--muted); font-size: 13px; line-height: 1.5; }
    .identity-note b { color: var(--ink-2); }
    a:focus-visible, button:focus-visible { outline: 3px solid var(--rose); outline-offset: 2px; }

    @media (max-width: 980px) {
      .queue-task { grid-template-columns: 100px 1fr auto; }
      .queue-task__languages { grid-column: 2; justify-content: flex-start; }
      .queue-task .btn { grid-column: 3; grid-row: 1 / span 2; }
    }
    @media (max-width: 720px) {
      .translation-queue { padding: 15px; }
      .translation-queue__head, .queue-warning { align-items: stretch; flex-direction: column; }
      .translation-queue__actions { display: grid; grid-template-columns: 1fr; }
      .translation-queue__head .btn, .queue-warning .btn { width: 100%; }
      .queue-summary { grid-template-columns: 1fr; }
      .queue-task { grid-template-columns: 1fr; }
      .queue-task__languages, .queue-task .btn { grid-column: auto; grid-row: auto; justify-content: flex-start; }
      .queue-task .btn { width: 100%; }
    }
  `,
})
export class WebsiteTranslationQueue {
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  readonly visibleLimit = 10;
  readonly loading = signal(false);
  readonly loadedOnce = signal(false);
  readonly sourceErrors = signal<string[]>([]);
  readonly families = signal<ProductFamily[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly websiteCopy = signal<ContentTranslationOverview | null>(null);

  readonly productTasks = computed<TranslationTask[]>(() => this.families()
    .filter((family) => family.active)
    .flatMap((family) => {
      const missingCopy = LANGUAGES.filter((language) => {
        const text = family.texts.find((item) => item.language === language.code);
        return !text?.name?.trim() || !text?.description?.trim();
      }).map((language) => language.code);
      const missingSeo = LANGUAGES.filter((language) => {
        const text = family.texts.find((item) => item.language === language.code);
        return !text?.seoTitle?.trim() || !text?.seoDescription?.trim();
      }).map((language) => language.code);
      const missingDetails = this.detailTranslationLanguages(family);
      const productId = family.members.find((member) => member.active)?.productId
        ?? family.members[0]?.productId
        ?? null;
      const link: string | (string | number)[] = productId === null
        ? '/website/products'
        : ['/products', productId, 'translations'];
      const tasks: TranslationTask[] = [];
      if (missingCopy.length) {
        tasks.push({
          key: `product-copy-${family.id ?? family.familyKey}`,
          kind: 'PRODUCT',
          title: publicFamilyName(family) || 'Productreeks zonder publieke naam',
          detail: 'Publieke familienaam of beschrijving aanvullen',
          missingLanguages: missingCopy,
          link,
          action: 'Tekst openen',
        });
      }
      if (missingSeo.length) {
        tasks.push({
          key: `product-seo-${family.id ?? family.familyKey}`,
          kind: 'PRODUCT',
          title: publicFamilyName(family) || 'Productreeks zonder publieke naam',
          detail: 'Producttitel of metabeschrijving voor zoekmachines aanvullen',
          missingLanguages: missingSeo,
          link,
          action: 'SEO openen',
        });
      }
      if (missingDetails.length) {
        tasks.push({
          key: `product-details-${family.id ?? family.familyKey}`,
          kind: 'PRODUCT',
          title: publicFamilyName(family) || 'Productreeks zonder publieke naam',
          detail: 'Varianttekst of foto-alt uit de publicatiecontrole aanvullen',
          missingLanguages: missingDetails,
          link,
          action: 'Details openen',
        });
      }
      return tasks;
    }));

  readonly categoryTasks = computed<TranslationTask[]>(() => this.categories().flatMap((category) => {
    const missingLanguages = LANGUAGES.filter((language) =>
      this.categoryMissing(category, language.code).length > 0).map((language) => language.code);
    return missingLanguages.length ? [{
      key: `category-${category.id ?? category.code}`,
      kind: 'CATEGORY' as const,
      title: category.name || 'Categorie zonder naam',
      detail: 'Categorienaam of gebruikte menuvelden aanvullen',
      missingLanguages,
      link: '/website/categories',
      action: 'Categorie openen',
    }] : [];
  }));

  readonly websiteTasks = computed<TranslationTask[]>(() =>
    (this.websiteCopy()?.groups ?? [])
      .filter((group) => group.required && group.missingLanguages.length > 0)
      .map((group) => ({
        key: `website-${group.key}`,
        kind: 'WEBSITE' as const,
        title: group.label,
        detail: 'Verplichte algemene websitecopy aanvullen',
        missingLanguages: group.missingLanguages,
        link: '/website/texts',
        action: 'Teksten openen',
      })));

  readonly tasks = computed(() => [
    ...this.productTasks(),
    ...this.categoryTasks(),
    ...this.websiteTasks(),
  ].sort((left, right) => right.missingLanguages.length - left.missingLanguages.length
    || left.title.localeCompare(right.title, 'nl')));
  readonly visibleTasks = computed(() => this.tasks().slice(0, this.visibleLimit));

  constructor() { void this.load(); }

  async load(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.sourceErrors.set([]);
    const [families, categories, websiteCopy] = await Promise.allSettled([
      this.catalog.productFamilies(),
      this.catalog.categories(),
      this.catalog.contentTranslations('WEBSITE'),
    ]);
    const errors: string[] = [];
    if (families.status === 'fulfilled') this.families.set(families.value);
    else errors.push(`Productinhoud: ${messageOf(families.reason, 'niet geladen')}`);
    if (categories.status === 'fulfilled') this.categories.set(categories.value);
    else errors.push(`Categorieën: ${messageOf(categories.reason, 'niet geladen')}`);
    if (websiteCopy.status === 'fulfilled') this.websiteCopy.set(websiteCopy.value);
    else errors.push(`Websiteteksten: ${messageOf(websiteCopy.reason, 'niet geladen')}`);
    this.sourceErrors.set(errors);
    this.loadedOnce.set(true);
    this.loading.set(false);
  }

  kindLabel(kind: TranslationTaskKind): string {
    if (kind === 'PRODUCT') return 'Product';
    if (kind === 'CATEGORY') return 'Categorie';
    return 'Website';
  }

  async copyCodexBrief(): Promise<void> {
    if (!this.tasks().length) return;
    const lines = [
      'ENROSED vertaalopdracht',
      '',
      'Vertaal uitsluitend de hieronder genoemde ontbrekende talen. Behoud betekenis, productspecificaties en B2B-toon. Wijzig geen vaste identifiers. Lever de vertalingen gegroepeerd per record en veld terug; verzin geen ontbrekende broninformatie.',
      '',
    ];

    for (const family of this.families().filter((item) => item.active)) {
      const copyMissing = LANGUAGES.filter((language) => {
        const text = family.texts.find((item) => item.language === language.code);
        return !text?.name?.trim() || !text?.description?.trim();
      }).map((language) => language.code);
      const seoMissing = LANGUAGES.filter((language) => {
        const text = family.texts.find((item) => item.language === language.code);
        return !text?.seoTitle?.trim() || !text?.seoDescription?.trim();
      }).map((language) => language.code);
      const detailMissing = this.detailTranslationLanguages(family);
      if (!copyMissing.length && !seoMissing.length && !detailMissing.length) continue;
      const productId = family.members.find((member) => member.active)?.productId
        ?? family.members[0]?.productId
        ?? null;
      const source = localizedFamilySource(family);
      lines.push(
        '## PRODUCTREEKS',
        `familyKey: ${family.familyKey}`,
        `familyId: ${family.id ?? 'niet beschikbaar'}`,
        `productId: ${productId ?? 'niet beschikbaar'}`,
        `brontaal: ${source?.language ?? 'geen complete bron gevonden'}`,
        `ontbrekende producttekst-talen: ${copyMissing.join(', ') || 'geen'}`,
        `ontbrekende SEO-talen: ${seoMissing.join(', ') || 'geen'}`,
        `ontbrekende variant/foto-alt-talen volgens publicatiecontrole: ${detailMissing.join(', ') || 'geen'}`,
        `bron naam: ${source?.name?.trim() || publicFamilyName(family) || ''}`,
        `bron samenvatting: ${source?.summary?.trim() || ''}`,
        `bron beschrijving: ${source?.description?.trim() || family.description || ''}`,
        `bron formaat: ${source?.format?.trim() || ''}`,
        `bron highlights: ${(source?.highlights ?? []).join(' | ')}`,
        `bron SEO-titel: ${source?.seoTitle?.trim() || ''}`,
        `bron SEO-beschrijving: ${source?.seoDescription?.trim() || ''}`,
        `bron varianten: ${family.members.map((member) => `productId=${member.productId}; naam=${member.name}; kleur=${member.colour ?? ''}; maat=${member.size ?? ''}`).join(' || ')}`,
        '',
      );
    }

    for (const category of this.categories()) {
      const missing = LANGUAGES.filter((language) =>
        this.categoryMissing(category, language.code).length > 0).map((language) => language.code);
      if (!missing.length) continue;
      const source = this.categorySource(category);
      lines.push(
        '## CATEGORIE',
        `categoryKey: ${category.code}`,
        `categoryId: ${category.id ?? 'niet beschikbaar'}`,
        `brontaal: ${source?.language ?? 'geen complete bron gevonden'}`,
        `ontbrekende talen: ${missing.join(', ')}`,
        `bron naam: ${source?.name?.trim() || category.name || ''}`,
        `bron navigatienaam: ${source?.navigationName?.trim() || category.navigationName || ''}`,
        `bron mobiele naam: ${source?.mobileName?.trim() || category.mobileName || ''}`,
        `bron footernaam: ${source?.footerName?.trim() || category.footerName || ''}`,
        `bron bovenregel: ${source?.eyebrow?.trim() || category.eyebrow || ''}`,
        `bron beschrijving: ${source?.description?.trim() || category.description || ''}`,
        '',
      );
    }

    for (const group of (this.websiteCopy()?.groups ?? [])) {
      if (!group.required || !group.missingLanguages.length) continue;
      const source = group.texts.find((text) => text.language === 'NL' && text.value?.trim())
        ?? group.texts.find((text) => text.value?.trim());
      lines.push(
        '## WEBSITETEKST',
        `contentKey: ${group.key}`,
        `revision: ${group.revision}`,
        `brontaal: ${source?.language ?? 'geen bron gevonden'}`,
        `ontbrekende talen: ${group.missingLanguages.join(', ')}`,
        `brontekst: ${source?.value?.trim() || ''}`,
        '',
      );
    }

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      this.ui.toast('Veilige vertaalopdracht gekopieerd');
    } catch {
      this.ui.toast('Kopiëren is niet gelukt. Controleer de browsertoestemming.', 'err');
    }
  }

  private detailTranslationLanguages(family: ProductFamily): LanguageCode[] {
    const detailIssues = family.publicationIssues.filter((issue) =>
      /\.variants\.|(?:image|photo|foto).*alt|alt(?:text)?/i.test(issue));
    return LANGUAGES.filter((language) => {
      const code = language.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(^|[._:/-])${code}([._:/-]|$)`, 'i');
      return detailIssues.some((issue) => pattern.test(issue));
    }).map((language) => language.code);
  }

  private categorySource(category: Category): Category['texts'][number] | null {
    const texts = category.texts ?? [];
    return texts.find((text) => text.language === 'NL' && this.categoryTextHasSource(text))
      ?? texts.find((text) => text.language === 'EN' && this.categoryTextHasSource(text))
      ?? texts.find((text) => this.categoryTextHasSource(text))
      ?? null;
  }

  private categoryTextHasSource(text: Category['texts'][number]): boolean {
    return !!text.name?.trim() || !!text.navigationName?.trim() || !!text.mobileName?.trim()
      || !!text.footerName?.trim() || !!text.eyebrow?.trim() || !!text.description?.trim();
  }

  private categoryMissing(category: Category, language: LanguageCode): string[] {
    const text = category.texts?.find((item) => item.language === language);
    return [
      !text?.name?.trim() ? 'name' : null,
      this.categoryFieldUsed(category, 'navigationName') && !text?.navigationName?.trim() ? 'navigationName' : null,
      this.categoryFieldUsed(category, 'footerName') && !text?.footerName?.trim() ? 'footerName' : null,
      this.categoryFieldUsed(category, 'mobileName') && !text?.mobileName?.trim() ? 'mobileName' : null,
      this.categoryFieldUsed(category, 'eyebrow') && !text?.eyebrow?.trim() ? 'eyebrow' : null,
      this.categoryFieldUsed(category, 'description') && !text?.description?.trim() ? 'description' : null,
    ].filter((field): field is string => field !== null);
  }

  private categoryFieldUsed(
    category: Category,
    field: 'navigationName' | 'footerName' | 'mobileName' | 'eyebrow' | 'description',
  ): boolean {
    return !!category[field]?.trim()
      || (category.texts ?? []).some((text) => !!text[field]?.trim());
  }
}
