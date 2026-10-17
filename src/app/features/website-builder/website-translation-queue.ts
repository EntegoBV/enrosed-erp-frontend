import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Category, LANGUAGES } from '../../core/api/models';
import { Icon } from '../../shared/icon';
import { Skeleton } from '../../shared/skeleton';
import { Ui } from '../../shared/ui';
import { isPerLanguageSizeIssue } from '../products/publication-issues';
import {
  TODO_SECTION_ORDER,
  WebsiteTodo,
  WebsiteTodoSection,
  categoryMissingLanguages,
  detailTranslationLanguages,
  familyCompleteness,
  familyProductId,
  todoSectionHeading,
} from './website-attention';
import { localizedFamilySource, publicFamilyName, variantBriefSource } from './website-family-label';
import { WEBSITE_PARTS, WebsitePart, WebsiteStore, websitePartLabel } from './website-store';

const KIND_LABELS = { reeks: 'Product', categorie: 'Categorie', tekst: 'Tekst' } as const;
const KIND_TONES = { reeks: 'tone-accent', categorie: 'tone-blue', tekst: 'tone-plum' } as const;
/** The brief's own language order and codes: Codex parses it, so it never changes with the screens. */
const BRIEF_CODES = LANGUAGES.map((language) => language.code);

interface TodoSectionView {
  section: WebsiteTodoSection;
  heading: string;
  count: number;
  rows: WebsiteTodo[];
}

/**
 * "Te doen" of the website: one row per reeks, category or required text
 * group, grouped by what has to happen (publiceerbaar maken, live zetten,
 * vertalen), from WebsiteStore (no requests of its own). The desk card
 * (#translation-work, the inbound fragment) or the phone section; both copy
 * the Codex translation brief in its unchanged format.
 */
@Component({
  selector: 'app-website-translation-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  imports: [Icon, RouterLink, Skeleton],
  template: `
    @if (layout() === 'card') {
      <section class="ws-card ws-todo-card ws-c-todo" id="translation-work" aria-labelledby="ws-todo-title">
        <header class="ws-card-head">
          <h2 id="ws-todo-title">Te doen</h2>
          @if (ready()) { <span class="ws-count">{{ todos().length }}</span> }
          <span class="ws-tools">
            <button class="wk-btn wk-btn--sm" type="button" [disabled]="!briefAvailable()" (click)="copyCodexBrief()">
              <app-icon name="copy" [size]="14" />Kopieer opdracht voor Codex
            </button>
          </span>
        </header>
        @for (part of failedParts(); track part.part) {
          <div class="wk-banner wk-banner--warn wk-banner--inset" role="alert">
            <app-icon name="alert" [size]="16" />
            <span class="wk-banner__text">{{ part.label }} konden niet gecontroleerd worden · {{ part.message }}</span>
            <span class="wk-banner__actions"><button class="wk-btn wk-btn--sm" type="button" (click)="retry(part.part)">Opnieuw proberen</button></span>
          </div>
        }
        @if (!ready()) {
          <app-skeleton kind="table" [rows]="6" />
        } @else if (!todos().length && !failedParts().length) {
          <div class="wk-empty" role="status">
            <div class="wk-empty__icon"><app-icon name="check" [size]="22" /></div>
            <h3 class="wk-empty__title">Niets te doen</h3>
            <p class="wk-empty__text">Alle reeksen, categorieën en websiteteksten zijn compleet.</p>
          </div>
        } @else {
          @for (section of sections(); track section.section) {
            <div class="ws-sect">{{ section.heading }} <span>{{ section.count }}</span></div>
            @for (row of section.rows; track row.key) {
              <a class="ws-todo" [class.ws-todo--kind]="section.section === 'translate'" [class.mo-enter]="revealed().has(row.key)"
                 [routerLink]="row.link" [queryParams]="row.query ?? null">
                @if (section.section === 'translate') {
                  <span class="wk-pill" [class]="'wk-pill ' + kindTone[row.kind]">{{ kindLabel[row.kind] }}</span>
                }
                <span class="ws-todo__body">
                  <span class="ws-todo__title" [attr.title]="row.title">{{ row.title }}</span>
                  <span class="ws-todo__detail">{{ row.detail }}</span>
                </span>
                <span class="ws-langs" [attr.aria-label]="row.missingLanguages.length ? 'Ontbrekende talen: ' + row.missingLanguages.join(', ') : null">
                  @for (code of row.missingLanguages.slice(0, 5); track code; let index = $index) {
                    <span class="ws-lang" [class.ws-lang--wide]="index >= 3" aria-hidden="true">{{ code }}</span>
                  }
                  @if (row.missingLanguages.length > 3) {
                    <span class="ws-lang ws-lang--more" aria-hidden="true">
                      @if (row.missingLanguages.length > 5) { <span class="ws-long">+{{ row.missingLanguages.length - 5 }}</span> }
                      <span class="ws-short">+{{ row.missingLanguages.length - 3 }}</span>
                    </span>
                  }
                </span>
                <app-icon name="chevron-right" [size]="16" />
              </a>
            }
          }
          @if (hidden() > 0) {
            <button class="ws-todo-more" type="button" (click)="showAll()">Nog {{ hidden() }} tonen</button>
          }
        }
      </section>
    } @else {
      <section class="ios-section" id="translation-work">
        <div class="ios-section__head">
          <h2>Te doen @if (ready()) { · {{ todos().length }} }</h2>
          @if (briefAvailable()) {
            <button class="ios-section__link" type="button" (click)="copyCodexBrief()">Codex-opdracht</button>
          }
        </div>
        @for (part of failedParts(); track part.part) {
          <div class="ios-banner" role="alert">
            <span>{{ part.label }} konden niet gecontroleerd worden · {{ part.message }}</span>
            <button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button" (click)="retry(part.part)">Opnieuw</button>
          </div>
        }
        @if (!ready()) {
          <app-skeleton kind="group" [rows]="3" />
        } @else if (!todos().length && !failedParts().length) {
          <div class="ios-group"><div class="ios-cell"><span class="ios-cell__body">
            <span class="ios-cell__title">Niets te doen</span>
            <span class="ios-cell__sub ios-cell__sub--wrap">Alle reeksen, categorieën en websiteteksten zijn compleet.</span>
          </span></div></div>
        } @else {
          <div class="ios-group">
            @for (row of visiblePhone(); track row.key) {
              <a class="ios-cell ws-todo-cell" [class.mo-enter]="revealed().has(row.key)" [routerLink]="row.link" [queryParams]="row.query ?? null">
                <span class="ios-cell__body">
                  <span class="ios-cell__title ios-cell__title--strong ios-cell__title--2">{{ row.title }}</span>
                  <span class="ios-cell__sub ios-cell__sub--wrap">{{ row.detail }}</span>
                  @if (row.missingLanguages.length) {
                    <span class="ws-ph-langs" [attr.aria-label]="'Ontbrekende talen: ' + row.missingLanguages.join(', ')">
                      @for (code of row.missingLanguages.slice(0, 4); track code) { <span class="ws-lang" aria-hidden="true">{{ code }}</span> }
                      @if (row.missingLanguages.length > 4) { <span class="ws-lang ws-lang--more" aria-hidden="true">+{{ row.missingLanguages.length - 4 }}</span> }
                    </span>
                  }
                </span>
                <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
              </a>
            }
            @if (hiddenPhone() > 0) {
              <button class="ios-cell ws-more-cell" type="button" (click)="showAll()">Nog {{ hiddenPhone() }} tonen</button>
            }
          </div>
        }
      </section>
    }
  `,
})
export class WebsiteTranslationQueue {
  private readonly store = inject(WebsiteStore);
  private readonly ui = inject(Ui);
  readonly layout = input<'card' | 'group'>('card');
  readonly kindLabel = KIND_LABELS;
  readonly kindTone = KIND_TONES;
  private readonly deskLimit = 12;
  private readonly phoneLimit = 3;
  readonly expanded = signal(false);
  /** Rows revealed by "Nog n tonen": they enter with mo-enter (opt-in motion). */
  readonly revealed = signal<ReadonlySet<string>>(new Set());

  readonly todos = this.store.todos;
  /** Te doen is meaningful once reeksen, categories and texts have answered (or failed). */
  readonly ready = computed(() => (['families', 'categories', 'content'] as const)
    .every((part) => this.store.has(part) || !!this.store.errors()[part]));
  readonly failedParts = computed(() => {
    const errors = this.store.errors();
    return WEBSITE_PARTS.filter((part) => part !== 'homepage' && errors[part])
      .map((part) => ({ part, label: websitePartLabel(part), message: errors[part]! }));
  });

  private readonly limited = computed(() => this.expanded() ? this.todos() : this.todos().slice(0, this.deskLimit));
  readonly hidden = computed(() => this.todos().length - this.limited().length);
  readonly sections = computed<TodoSectionView[]>(() => {
    const all = this.todos();
    const shown = this.limited();
    return TODO_SECTION_ORDER
      .map((section) => ({ section, heading: todoSectionHeading(section),
        count: all.filter((row) => row.section === section).length,
        rows: shown.filter((row) => row.section === section) }))
      .filter((view) => view.rows.length > 0);
  });
  readonly visiblePhone = computed(() => this.expanded() ? this.todos() : this.todos().slice(0, this.phoneLimit));
  readonly hiddenPhone = computed(() => this.todos().length - this.visiblePhone().length);

  /** Translation work the Codex brief can describe (not the "live zetten" rows). */
  readonly briefAvailable = computed(() => this.ready() && this.briefLines().length > 0);

  showAll(): void {
    const before = new Set((this.layout() === 'card' ? this.limited() : this.visiblePhone()).map((row) => row.key));
    this.revealed.set(new Set(this.todos().map((row) => row.key).filter((key) => !before.has(key))));
    this.expanded.set(true);
  }

  retry(part: WebsitePart): void {
    void this.store.refresh([part]);
  }

  async copyCodexBrief(): Promise<void> {
    const body = this.briefLines();
    if (!body.length) return;
    const lines = [
      'ENROSED vertaalopdracht',
      '',
      'Vertaal uitsluitend de hieronder genoemde ontbrekende talen. Behoud betekenis, productspecificaties en B2B-toon. Wijzig geen vaste identifiers. Lever de vertalingen gegroepeerd per record en veld terug; verzin geen ontbrekende broninformatie.',
      '',
      ...body,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      this.ui.toast('Vertaalopdracht gekopieerd');
    } catch {
      this.ui.toast('Kopiëren is niet gelukt. Controleer de browsertoestemming.', 'err');
    }
  }

  /** The records of the brief, in the format Codex reads (unchanged since the first queue). */
  private readonly briefLines = computed<string[]>(() => {
    const lines: string[] = [];
    for (const family of (this.store.families() ?? []).filter((item) => item.active)) {
      const completeness = familyCompleteness(family, BRIEF_CODES);
      const copyMissing = completeness.missingText;
      const seoMissing = completeness.missingSeo;
      const detailMissing = detailTranslationLanguages(family, BRIEF_CODES, isPerLanguageSizeIssue);
      if (!copyMissing.length && !seoMissing.length && !detailMissing.length) continue;
      const productId = familyProductId(family);
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
        `bron varianten: ${variantBriefSource(family.members)}`,
        '',
      );
    }

    for (const category of this.store.categories() ?? []) {
      const missing = categoryMissingLanguages(category, BRIEF_CODES);
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

    for (const group of this.store.groups()) {
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
    return lines;
  });

  private categorySource(category: Category): Category['texts'][number] | null {
    const texts = category.texts ?? [];
    const hasSource = (text: Category['texts'][number]) => !!text.name?.trim() || !!text.navigationName?.trim()
      || !!text.mobileName?.trim() || !!text.footerName?.trim() || !!text.eyebrow?.trim() || !!text.description?.trim();
    return texts.find((text) => text.language === 'NL' && hasSource(text))
      ?? texts.find((text) => text.language === 'EN' && hasSource(text))
      ?? texts.find(hasSource)
      ?? null;
  }
}
