import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Category, CategoryText, LanguageCode } from '../../core/api/models';
import { TRANSLATION_LANGUAGES } from '../products/product-translation-adapter';

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
            <input class="input" [ngModel]="text().name"
                   (ngModelChange)="patch({ name: $event })" />
          </label>
          <label class="field">
            <span>Korte navigatienaam (desktop)</span>
            <input class="input" maxlength="40" [ngModel]="text().navigationName"
                   (ngModelChange)="patch({ navigationName: $event })" />
          </label>
          <label class="field">
            <span>Korte mobiele naam</span>
            <input class="input" maxlength="40" [ngModel]="text().mobileName"
                   (ngModelChange)="patch({ mobileName: $event })" />
          </label>
          <label class="field span-2">
            <span>Naam in websitefooter</span>
            <input class="input" [ngModel]="text().footerName"
                   (ngModelChange)="patch({ footerName: $event })" />
          </label>
          <label class="field span-2">
            <span>Bovenregel website</span>
            <input class="input" [ngModel]="text().eyebrow"
                   (ngModelChange)="patch({ eyebrow: $event })" />
          </label>
          <label class="field span-2">
            <span>Beschrijving</span>
            <textarea class="textarea" rows="3" [ngModel]="text().description"
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
    .translation-head h4 { font-size: 13px; }
    .translation-head p { margin-top: 2px; color: var(--muted); font-size: 10px; }
    .translation-head > span {
      flex: none; padding: 5px 8px; border-radius: 999px; background: var(--warn-soft);
      color: var(--ink-2); font-size: 9px; font-weight: 750;
    }
    .translation-head > span.done { background: var(--ok-soft); color: var(--ok); }
    .language-tabs {
      display: grid; grid-template-columns: repeat(8, minmax(48px, 1fr)); gap: 5px;
      margin-top: 11px; overflow-x: auto; padding-bottom: 3px;
    }
    .language-tabs button {
      display: flex; min-width: 48px; min-height: 40px; align-items: center; justify-content: center;
      gap: 4px; border: 1px solid var(--line); border-radius: 8px;
      background: var(--surface-2); color: var(--ink-2); cursor: pointer;
    }
    .language-tabs button.active { border-color: var(--rose); background: var(--rose-soft); }
    .language-tabs b { font-size: 9.5px; }
    .language-tabs small {
      display: grid; min-width: 16px; height: 16px; place-items: center; border-radius: 999px;
      background: var(--warn-soft); color: var(--warn); font-size: 8px;
    }
    .language-tabs button.complete small { background: var(--ok-soft); color: var(--ok); }
    fieldset { min-inline-size: 0; margin: 10px 0 0; padding: 0; border: 0; }
    .language-state {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      padding: 9px 10px; border-radius: 9px; background: var(--warn-soft);
    }
    .language-state.complete { background: var(--ok-soft); }
    .language-state > span { display: grid; gap: 1px; }
    .language-state b { font-size: 10.5px; }
    .language-state small { color: var(--muted); font-size: 9px; }
    .language-state i { color: var(--ok); font-style: normal; font-weight: 800; }
    .translation-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 11px; }
    .translation-grid .field { min-width: 0; }
    .translation-grid .span-2 { grid-column: 1 / -1; }
    .dirty {
      display: flex; align-items: center; gap: 8px; margin-top: 10px; padding: 9px 10px;
      border-radius: 9px; background: var(--rose-soft); color: var(--rose-dark);
    }
    .dirty > div { display: grid; gap: 1px; }
    .dirty b { font-size: 10px; }
    .dirty small { color: var(--muted); font-size: 9px; }
    .dirty--error { background: var(--danger-soft); color: var(--danger); }
  `,
})
export class CategoryTranslationEditor {
  readonly languages = TRANSLATION_LANGUAGES;
  readonly category = input.required<Category>();
  readonly busy = input(false);
  readonly saveError = input<string | null>(null);
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
