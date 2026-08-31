import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Category, CategoryText, LanguageCode } from '../../core/api/models';
import { TRANSLATION_LANGUAGES } from '../products/product-translation-adapter';
import { Ui } from '../../shared/ui';

interface CategoryLanguageState {
  code: LanguageCode;
  label: string;
  missing: string[];
}

@Component({
  selector: 'app-category-translation-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <section class="category-translations" aria-labelledby="category-translations-title">
      <div class="translation-head">
        <div>
          <h4 id="category-translations-title">Vertalingen website &amp; catalogus</h4>
          <p>De interne categorienaam hierboven blijft ongewijzigd.</p>
        </div>
        <span [class.done]="completeCount() === languages.length">
          {{ completeCount() }}/{{ languages.length }} compleet
        </span>
      </div>

      @if (completeCount() < languages.length) {
        <div class="partial-save-note" role="note">
          <span aria-hidden="true">✓</span>
          <p><b>Later vertalen is prima.</b> Gebruik de categorieknop onderaan om de huidige invoer op te slaan. Ontbrekende talen blokkeren deze opslag niet en blijven in de vertaalwerkvoorraad staan.</p>
        </div>
      }

      <div class="codex-brief-action" role="note">
        <div>
          <b>Opnieuw laten vertalen na een bronwijziging</b>
          <small>De opdracht bevat uitsluitend de vaste categorie-identiteit en publieke tekstvelden in acht talen.</small>
        </div>
        <button class="btn btn--sm btn--primary" type="button"
                [disabled]="busy() || category().id === null"
                [title]="category().id === null ? 'Sla de categorie eerst op voor een vaste categoryId' : null"
                (click)="copyCodexBrief()">
          Kopieer deze vertaalopdracht voor Codex
        </button>
      </div>

      <div class="language-tabs" role="group" aria-label="Categorietaal bewerken">
        @for (state of states(); track state.code) {
          <button type="button"
                  [attr.aria-pressed]="language() === state.code"
                  [class.active]="language() === state.code"
                  [class.complete]="!state.missing.length"
                  [disabled]="busy()"
                  (click)="language.set(state.code)">
            <b>{{ state.code }}</b>
            <small>{{ state.missing.length || '✓' }}</small>
          </button>
        }
      </div>
      <label class="mobile-language-picker">
        <span>Taal kiezen</span>
        <select class="select" [ngModel]="language()" [disabled]="busy()"
                (ngModelChange)="language.set($any($event))">
          @for (state of states(); track state.code) {
            <option [ngValue]="state.code">
              {{ state.label }} — {{ state.missing.length ? state.missing.length + ' ontbreekt' : 'compleet' }}
            </option>
          }
        </select>
      </label>

      <fieldset [disabled]="busy()" [attr.aria-busy]="busy()">
        <legend class="sr-only">{{ selectedState().label }} categorietekst</legend>
        <div class="language-state" [class.complete]="!selectedState().missing.length">
          <span>
            <b>{{ selectedState().label }}</b>
            <small>
              {{ selectedState().missing.length
                ? selectedState().missing.join(' · ') + ' ontbreekt'
                : 'Alle gebruikte velden zijn vertaald' }}
            </small>
          </span>
          @if (!selectedState().missing.length) { <i aria-hidden="true">✓</i> }
        </div>

        <div class="translation-grid">
          <label class="field span-2">
            <span>Naam</span>
            <input class="input" id="category-translation-category-name" [ngModel]="text().name"
                   (ngModelChange)="patch({ name: $event })" />
          </label>
          <label class="field">
            <span>Korte navigatienaam (desktop)</span>
            <input class="input" id="category-translation-category-navigation-name"
                   maxlength="40" [ngModel]="text().navigationName"
                   (ngModelChange)="patch({ navigationName: $event })" />
          </label>
          <label class="field">
            <span>Korte mobiele naam</span>
            <input class="input" id="category-translation-category-mobile-name"
                   maxlength="40" [ngModel]="text().mobileName"
                   (ngModelChange)="patch({ mobileName: $event })" />
          </label>
          <label class="field span-2">
            <span>Naam in websitefooter</span>
            <input class="input" id="category-translation-category-footer-name"
                   [ngModel]="text().footerName"
                   (ngModelChange)="patch({ footerName: $event })" />
          </label>
          <label class="field span-2">
            <span>Bovenregel website</span>
            <input class="input" id="category-translation-category-eyebrow"
                   [ngModel]="text().eyebrow"
                   (ngModelChange)="patch({ eyebrow: $event })" />
          </label>
          <label class="field span-2">
            <span>Beschrijving</span>
            <textarea class="textarea" id="category-translation-category-description"
                      rows="3" [ngModel]="text().description"
                      (ngModelChange)="patch({ description: $event })"></textarea>
          </label>
        </div>

        @if (touched()) {
          <div class="dirty" [class.dirty--error]="saveError()" aria-live="polite">
            <span aria-hidden="true">{{ saveError() ? '!' : '•' }}</span>
            <div>
              <b>{{ saveError() ? 'Vertalingen nog niet opgeslagen' :
                    (busy() ? 'Vertalingen worden opgeslagen' : 'Vertalingen klaar om op te slaan') }}</b>
              <small>{{ saveError() || 'Gebruik de categorieknop hieronder.' }}</small>
            </div>
          </div>
        }
      </fieldset>
    </section>
  `,
  styles: `
    :host { display: block; grid-column: 1 / -1; }
    .category-translations {
      padding: 14px; border: 1px solid var(--line); border-radius: var(--r-sm); background: #fff;
    }
    .translation-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .translation-head h4 { font-size: 18px; }
    .translation-head p { margin-top: 3px; color: var(--muted); font-size: 15px; line-height: 1.45; }
    .translation-head > span {
      flex: none; padding: 5px 8px; border-radius: 999px; background: var(--warn-soft);
      color: var(--ink-2); font-size: 13px; font-weight: 750;
    }
    .translation-head > span.done { background: var(--ok-soft); color: var(--ok); }
    .partial-save-note { display: flex; align-items: flex-start; gap: 8px; margin-top: 10px; padding: 9px 10px; border: 1px solid var(--rose-line); border-radius: 9px; background: var(--rose-soft); }
    .partial-save-note > span { display: grid; width: 24px; height: 24px; flex: none; place-items: center; border-radius: 999px; background: var(--surface); color: var(--rose-dark); font-weight: 850; }
    .partial-save-note p { color: var(--muted); font-size: 13px; line-height: 1.45; }
    .partial-save-note b { color: var(--ink-2); }
    .codex-brief-action { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 10px; padding: 9px 10px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface-2); }
    .codex-brief-action > div { display: grid; gap: 2px; }
    .codex-brief-action b { color: var(--ink-2); font-size: 13px; }
    .codex-brief-action small { color: var(--muted); font-size: 12px; line-height: 1.4; }
    .codex-brief-action .btn { flex: none; min-height: 44px; white-space: nowrap; }
    .language-tabs {
      display: grid; grid-template-columns: repeat(8, minmax(48px, 1fr)); gap: 5px;
      margin-top: 11px; overflow-x: auto; padding-bottom: 3px;
    }
    .language-tabs button {
      display: flex; min-width: 54px; min-height: 48px; align-items: center; justify-content: center;
      gap: 4px; border: 1px solid var(--line); border-radius: 8px;
      background: var(--surface-2); color: var(--ink-2); cursor: pointer;
    }
    .language-tabs button.active { border-color: var(--rose); background: var(--rose-soft); }
    .language-tabs b { font-size: 13px; }
    .language-tabs small {
      display: grid; min-width: 16px; height: 16px; place-items: center; border-radius: 999px;
      background: var(--warn-soft); color: var(--warn); font-size: 11px;
    }
    .language-tabs button.complete small { background: var(--ok-soft); color: var(--ok); }
    .mobile-language-picker { display: none; }
    fieldset { min-inline-size: 0; margin: 12px 0 0; padding: 0; border: 0; }
    .language-state {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      padding: 9px 10px; border-radius: 9px; background: var(--warn-soft);
    }
    .language-state.complete { background: var(--ok-soft); }
    .language-state > span { display: grid; gap: 1px; }
    .language-state b { font-size: 15px; }
    .language-state small { color: var(--muted); font-size: 14px; line-height: 1.4; }
    .language-state i { color: var(--ok); font-style: normal; font-weight: 800; }
    .translation-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 11px; }
    .translation-grid .field { min-width: 0; }
    .translation-grid .span-2 { grid-column: 1 / -1; }
    .translation-grid .input, .translation-grid .select { min-height: 48px; font-size: 16px; }
    .translation-grid .textarea { font-size: 16px; line-height: 1.5; }
    .dirty {
      display: flex; align-items: center; gap: 8px; margin-top: 10px; padding: 9px 10px;
      border-radius: 9px; background: var(--rose-soft); color: var(--rose-dark);
    }
    .dirty > div { display: grid; gap: 1px; }
    .dirty b { font-size: 14px; }
    .dirty small { color: var(--muted); font-size: 13px; line-height: 1.4; }
    .dirty--error { background: var(--danger-soft); color: var(--danger); }

    @media (max-width: 620px) {
      .category-translations { padding: 14px; }
      .translation-head { align-items: stretch; flex-direction: column; }
      .translation-head > span { align-self: flex-start; }
      .language-tabs { display: none; }
      .mobile-language-picker { display: grid; gap: 7px; margin-top: 14px; }
      .mobile-language-picker > span { font-size: 15px; font-weight: 700; }
      .mobile-language-picker .select { min-height: 48px; font-size: 16px; }
      .translation-grid { grid-template-columns: 1fr; }
      .translation-grid .span-2 { grid-column: auto; }
      .codex-brief-action { align-items: stretch; flex-direction: column; }
      .codex-brief-action .btn { width: 100%; white-space: normal; }
    }
  `,
})
export class CategoryTranslationEditor {
  private readonly ui = inject(Ui);
  private readonly document = inject(DOCUMENT);
  private initialLanguageApplied = false;
  private focusedTarget: string | null = null;
  readonly languages = TRANSLATION_LANGUAGES;
  readonly category = input.required<Category>();
  readonly busy = input(false);
  readonly saveError = input<string | null>(null);
  readonly initialLanguage = input<LanguageCode>('NL');
  readonly focusField = input<string | null>(null);
  readonly categoryChange = output<Category>();
  readonly language = signal<LanguageCode>('NL');
  readonly touched = signal(false);

  readonly text = computed(() => this.category().texts?.find(
    (item) => item.language === this.language(),
  ) ?? this.blank(this.language()));
  readonly states = computed<CategoryLanguageState[]>(() => this.languages.map((language) => ({
    ...language,
    missing: this.missing(language.code),
  })));
  readonly selectedState = computed(() =>
    this.states().find((state) => state.code === this.language())!,
  );
  readonly completeCount = computed(() =>
    this.states().filter((state) => !state.missing.length).length,
  );

  constructor() {
    effect(() => {
      const language = this.initialLanguage();
      if (this.initialLanguageApplied) return;
      this.initialLanguageApplied = true;
      this.language.set(language);
    });
    effect(() => {
      const focus = this.focusField();
      const category = this.category();
      if (!focus || this.busy()) return;
      const target = `${category.code}:${focus}`;
      if (this.focusedTarget === target) return;
      this.focusedTarget = target;
      this.document.defaultView?.setTimeout(() => this.focusDeepLinkedField(focus), 220);
    });
  }

  patch(changes: Partial<CategoryText>): void {
    if (this.busy()) return;
    const category = this.category();
    const language = this.language();
    const current = category.texts?.find((item) => item.language === language) ?? this.blank(language);
    const text = { ...current, ...changes, language };
    const existing = category.texts ?? [];
    const texts = existing.some((item) => item.language === language)
      ? existing.map((item) => item.language === language ? text : item)
      : [...existing, text];
    this.touched.set(true);
    this.categoryChange.emit({ ...category, texts });
  }

  async copyCodexBrief(): Promise<void> {
    const category = this.category();
    if (category.id === null) {
      this.ui.toast('Sla de categorie eerst op zodat de opdracht een vaste categoryId krijgt.', 'err');
      return;
    }
    const lines = [
      'ENROSED categorievertaling voor Codex',
      '',
      'Vertaal of hercontroleer uitsluitend de publieke categorieteksten hieronder naar alle doeltalen. Wijzig categoryId en categoryKey nooit. Behoud betekenis, merktoon en menu-lengte; verzin geen nieuwe claims.',
      '',
      `categoryId: ${category.id}`,
      `categoryKey: ${category.code}`,
      `revision: ${category.revision ?? 'niet beschikbaar'}`,
      `doeltalen: ${this.languages.map((language) => language.code).join(', ')}`,
      `basisnaam/fallback: ${this.promptValue(category.name)}`,
      `basis navigatienaam/fallback: ${this.promptValue(category.navigationName)}`,
      `basis mobiele naam/fallback: ${this.promptValue(category.mobileName)}`,
      `basis footernaam/fallback: ${this.promptValue(category.footerName)}`,
      `basis bovenregel/fallback: ${this.promptValue(category.eyebrow)}`,
      `basis beschrijving/fallback: ${this.promptValue(category.description)}`,
      '',
    ];
    for (const language of this.languages) {
      const text = category.texts?.find((item) => item.language === language.code);
      lines.push(
        `## ${language.code} — ${language.label}`,
        `naam: ${this.promptValue(text?.name)}`,
        `navigatienaam desktop: ${this.promptValue(text?.navigationName)}`,
        `mobiele naam: ${this.promptValue(text?.mobileName)}`,
        `footernaam: ${this.promptValue(text?.footerName)}`,
        `bovenregel: ${this.promptValue(text?.eyebrow)}`,
        `beschrijving: ${this.promptValue(text?.description)}`,
        '',
      );
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      this.ui.toast('Veilige categorievertaalopdracht gekopieerd');
    } catch {
      this.ui.toast('Kopiëren is niet gelukt. Controleer de browsertoestemming.', 'err');
    }
  }

  private promptValue(value: string | null | undefined): string {
    return JSON.stringify(value?.trim() ?? '');
  }

  private focusDeepLinkedField(focus: string, attempt = 0): void {
    const view = this.document.defaultView;
    const target = this.document.getElementById(`category-translation-${focus}`);
    if (!view) return;
    if (!target && attempt < 3) {
      view.requestAnimationFrame(() => this.focusDeepLinkedField(focus, attempt + 1));
      return;
    }
    if (!(target instanceof HTMLElement)) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.focus({ preventScroll: true });
  }

  private missing(language: LanguageCode): string[] {
    const category = this.category();
    const text = category.texts?.find((item) => item.language === language) ?? this.blank(language);
    return [
      !text.name?.trim() ? 'Naam' : null,
      this.fieldUsed(category, 'navigationName') && !text.navigationName?.trim()
        ? 'Navigatienaam desktop' : null,
      this.fieldUsed(category, 'footerName') && !text.footerName?.trim()
        ? 'Naam websitefooter' : null,
      this.fieldUsed(category, 'mobileName') && !text.mobileName?.trim() ? 'Mobiele naam' : null,
      this.fieldUsed(category, 'eyebrow') && !text.eyebrow?.trim() ? 'Bovenregel' : null,
      this.fieldUsed(category, 'description') && !text.description?.trim() ? 'Beschrijving' : null,
    ].filter((value): value is string => value !== null);
  }

  private fieldUsed(
    category: Category,
    field: 'navigationName' | 'footerName' | 'mobileName' | 'eyebrow' | 'description',
  ): boolean {
    return !!category[field]?.trim()
      || (category.texts ?? []).some((text) => !!text[field]?.trim());
  }

  private blank(language: LanguageCode): CategoryText {
    return {
      language,
      name: null,
      navigationName: null,
      footerName: null,
      description: null,
      eyebrow: null,
      mobileName: null,
    };
  }
}
