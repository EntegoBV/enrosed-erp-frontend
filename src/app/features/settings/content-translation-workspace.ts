import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import {
  ContentTranslationGroup,
  ContentTranslationScope,
  ContentTranslationText,
  LanguageCode,
} from '../../core/api/models';
import { Ui, escapeHtml } from '../../shared/ui';
import { TRANSLATION_LANGUAGES } from '../products/product-translation-adapter';
import { WebsiteSyncStatus } from './website-sync-status';

const CONTENT_KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

interface ContentPrefixOption {
  key: string;
  label: string;
  count: number;
}

interface LanguageCompletion {
  code: LanguageCode;
  complete: number;
  total: number;
}

const PREFIX_LABELS: Record<string, string> = {
  a11y: 'Toegankelijkheid',
  about: 'Over ons',
  categories: 'Categorieën',
  category: 'Categorieën',
  contact: 'Contact',
  customisation: 'Maatwerk',
  footer: 'Footer',
  header: 'Header',
  home: 'Home',
  homepage: 'Home',
  legal: 'Juridisch',
  meta: 'Meta & SEO',
  navigation: 'Navigatie',
  ordering: 'Bestellen',
  product: 'Producten',
  products: 'Producten',
};

@Component({
  selector: 'app-content-translation-workspace',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, WebsiteSyncStatus],
  template: `
    @if (visible()) {
    <section class="card content-translations" aria-labelledby="content-translations-title">
      <div class="card__head content-translations__head">
        <div>
          <h2 id="content-translations-title">Website- en catalogusteksten</h2>
          <p>Algemene klantteksten, los van producten en categorieën.</p>
        </div>
        @if (!loading() && !loadError()) {
          <span class="overview-progress" [class.overview-progress--done]="requiredMissing() === 0">
            {{ requiredMissing() ? requiredMissing() + ' taalvelden ontbreken' : 'Verplichte teksten compleet' }}
          </span>
        }
      </div>

      <div class="card__body">
        <app-website-sync-status [refreshKey]="websiteSyncRefreshKey()" />

        @if (loadError()) {
          <div class="workspace-state workspace-state--error" role="alert">
            <div><b>Teksten konden niet worden geladen</b><small>{{ loadError() }}</small></div>
            <button class="btn btn--sm" type="button" [disabled]="loading()"
                    (click)="load()">Opnieuw proberen</button>
          </div>
        } @else if (loading()) {
          <div class="workspace-state" role="status">Teksten laden…</div>
        } @else {
          <div class="workspace-controls">
            <div class="workspace-toolbar">
              <div class="scope-switch" role="group" aria-label="Soort algemene tekst">
                <button type="button" [class.active]="scope() === 'WEBSITE'"
                        [attr.aria-pressed]="scope() === 'WEBSITE'"
                        [disabled]="hasPendingChanges() || busy()" (click)="changeScope('WEBSITE')">Website</button>
                <button type="button" [class.active]="scope() === 'CATALOG'"
                        [attr.aria-pressed]="scope() === 'CATALOG'"
                        [disabled]="hasPendingChanges() || busy()" (click)="changeScope('CATALOG')">Catalogus</button>
              </div>
              <button class="btn btn--sm" type="button" [disabled]="dirty() || busy() || creating()"
                      (click)="startCreate()">Tekstgroep toevoegen</button>
            </div>

            <div class="language-overview" aria-label="Voortgang verplichte teksten per taal">
              @for (item of languageCompletion(); track item.code) {
                <span [class.complete]="item.total > 0 && item.complete === item.total">
                  <b>{{ item.code }}</b>
                  <small>{{ item.total ? item.complete + '/' + item.total : '—' }}</small>
                </span>
              }
            </div>

            <div class="filter-row">
              <label class="content-search">
                <span class="sr-only">Tekstgroep zoeken</span>
                <input class="input" type="search" [ngModel]="search()"
                       (ngModelChange)="search.set($event)"
                       placeholder="Zoek op naam, sleutel of tekst…" />
              </label>
              <span class="result-count" aria-live="polite">
                {{ visibleGroups().length }} van {{ scopeGroups().length }} tekstgroepen
              </span>
            </div>

            <div class="prefix-filters" role="group" aria-label="Pagina of onderdeel filteren">
              <button type="button" [class.active]="prefix() === 'ALL'"
                      [attr.aria-pressed]="prefix() === 'ALL'" (click)="prefix.set('ALL')">
                Alles <small>{{ scopeGroups().length }}</small>
              </button>
              @for (option of prefixOptions(); track option.key) {
                <button type="button" [class.active]="prefix() === option.key"
                        [attr.aria-pressed]="prefix() === option.key"
                        (click)="prefix.set(option.key)">
                  {{ option.label }} <small>{{ option.count }}</small>
                </button>
              }
            </div>
          </div>

          @if (creating()) {
            <div class="create-group">
              <div class="field">
                <label for="content-new-label">Naam in het dashboard</label>
                <input class="input" id="content-new-label" [ngModel]="newLabel()"
                       (ngModelChange)="newLabel.set($event)" placeholder="Bijv. Intro maatwerk" />
              </div>
              <div class="field">
                <label for="content-new-key">Vaste sleutel</label>
                <input class="input mono" id="content-new-key" [ngModel]="newKey()"
                       (ngModelChange)="newKey.set($event.toLowerCase())"
                       (blur)="normalizeNewKey()"
                       pattern="[a-z0-9]+(?:[.-][a-z0-9]+)*"
                       placeholder="customisation.intro" />
              </div>
              <p class="small muted create-group__hint">
                Een nieuwe sleutel start optioneel. Vul eerst alle acht talen in voordat je hem verplicht maakt.
              </p>
              <div class="create-group__actions">
                <button class="btn btn--sm" type="button" [disabled]="busy()"
                        (click)="cancelCreate()">Annuleren</button>
                <button class="btn btn--sm btn--primary" type="button"
                        [disabled]="busy() || !newLabel().trim() || !keyValid()"
                        (click)="createGroup()">Toevoegen</button>
              </div>
            </div>
          }

          <div class="workspace-grid">
            <nav class="group-list" aria-label="Tekstgroepen">
              @for (group of visibleGroups(); track group.key) {
                <button type="button"
                        [class.active]="draft()?.key === group.key && draft()?.scope === group.scope"
                        [disabled]="busy() || (hasPendingChanges() && draft()?.key !== group.key)"
                        (click)="select(group)">
                  <span>
                    <b>{{ group.label }}</b>
                    <small class="mono">{{ group.key }}{{ group.system ? ' · vast' : '' }}</small>
                  </span>
                  @if (group.required) {
                    <em [class.complete]="!group.missingLanguages.length">
                      {{ group.missingLanguages.length || '✓' }}
                    </em>
                  } @else {
                    <em class="optional">opt.</em>
                  }
                </button>
              } @empty {
                <div class="empty-groups">
                  {{ scopeGroups().length ? 'Geen tekstgroepen voor deze filters.' :
                    'Nog geen ' + (scope() === 'WEBSITE' ? 'website' : 'catalogus') + 'teksten.' }}
                </div>
              }
            </nav>

            @if (draft(); as group) {
              <fieldset class="group-editor" [disabled]="busy()" [attr.aria-busy]="busy()">
                <legend class="sr-only">{{ group.label }} vertalen</legend>
                <div class="group-editor__head">
                  <div>
                    <span class="eyebrow">{{ group.scope === 'WEBSITE' ? 'Website' : 'Catalogus' }}</span>
                    <input class="group-label" [ngModel]="group.label"
                           aria-label="Naam van tekstgroep"
                           [readOnly]="group.system"
                           (ngModelChange)="patchGroup({ label: $event })" />
                    <small class="mono">
                      {{ group.key }} · revisie {{ group.revision }}{{ group.system ? ' · vaste sleutel' : '' }}
                    </small>
                  </div>
                  <label class="required-toggle">
                    <input type="checkbox" [ngModel]="group.required"
                           [disabled]="group.system || (!group.required && group.missingLanguages.length > 0)"
                           [title]="!group.required && group.missingLanguages.length > 0
                             ? 'Vul eerst alle acht talen in'
                             : null"
                           (ngModelChange)="patchGroup({ required: $event })" />
                    Verplicht
                  </label>
                </div>

                @if (legalReview()) {
                  <div class="legal-review" role="note">
                    <span aria-hidden="true">§</span>
                    <div><b>Juridisch nazicht nodig</b><small>Laat inhoudelijke wijzigingen controleren vóór publicatie.</small></div>
                  </div>
                }

                <div class="language-tabs" role="group" aria-label="Taal van algemene tekst">
                  @for (language of languages; track language.code) {
                    <button type="button"
                            [attr.aria-pressed]="selectedLanguage() === language.code"
                            [class.active]="selectedLanguage() === language.code"
                            [class.complete]="hasText(group, language.code)"
                            (click)="selectedLanguage.set(language.code)">
                      <b>{{ language.code }}</b>
                      <small>{{ hasText(group, language.code) ? '✓' : (group.required ? '!' : '—') }}</small>
                    </button>
                  }
                </div>
                <label class="mobile-language-picker">
                  <span>Taal kiezen</span>
                  <select class="select" [ngModel]="selectedLanguage()"
                          (ngModelChange)="selectedLanguage.set($any($event))">
                    @for (language of languages; track language.code) {
                      <option [ngValue]="language.code">
                        {{ language.label }} — {{ hasText(group, language.code)
                          ? 'compleet' : (group.required ? 'ontbreekt' : 'nog leeg') }}
                      </option>
                    }
                  </select>
                </label>

                <label class="translation-value">
                  <span>{{ selectedLanguageLabel() }}</span>
                  <textarea class="textarea" rows="7" [ngModel]="selectedValue()"
                            (ngModelChange)="patchValue($event)"
                            [placeholder]="group.required ? 'Verplichte vertaling' : 'Optionele vertaling'"></textarea>
                </label>
                @if (nextMissingLanguage(); as nextLanguage) {
                  <button class="next-language" type="button"
                          (click)="selectedLanguage.set(nextLanguage.code)">
                    Volgende ontbrekende taal: <b>{{ nextLanguage.label }}</b>
                    <span aria-hidden="true">›</span>
                  </button>
                }

                @if (conflict()) {
                  <div class="conflict" role="alert">
                    <div><b>Nieuwere versie beschikbaar</b><small>{{ saveError() }}</small></div>
                    <button class="btn btn--sm" type="button" (click)="reloadSelected()">
                      Laatste versie laden
                    </button>
                  </div>
                } @else if (saveError()) {
                  <div class="save-error" role="alert">{{ saveError() }}</div>
                } @else if (!group.label.trim()) {
                  <div class="save-error" role="alert">Vul een herkenbare naam voor deze tekstgroep in.</div>
                }

                <div class="group-editor__actions">
                  @if (!group.system) {
                    <button class="btn btn--sm danger-link" type="button" [disabled]="dirty()"
                            (click)="deleteSelected()">Verwijderen</button>
                  }
                  <span class="spacer"></span>
                  <button class="btn btn--sm" type="button" [disabled]="!dirty()"
                          (click)="revertSelected()">Wijzigingen wissen</button>
                  <button class="btn btn--sm btn--primary" type="button"
                          [disabled]="!dirty() || !draftValid()"
                          (click)="saveSelected()">{{ saving() ? 'Opslaan…' : 'Opslaan' }}</button>
                </div>
              </fieldset>
            } @else {
              <div class="workspace-state">Kies links een tekstgroep.</div>
            }
          </div>
        }
      </div>
    </section>
    }
  `,
  styles: `
    :host { display: block; }
    .content-translations__head { align-items: flex-start; gap: 12px; }
    .content-translations__head > div { min-width: 0; }
    .content-translations__head p { margin-top: 2px; color: var(--muted); font-size: 10.5px; }
    .overview-progress {
      flex: none; padding: 5px 8px; border-radius: 999px; background: var(--warn-soft);
      color: var(--ink-2); font-size: 9px; font-weight: 750;
    }
    .overview-progress--done { background: var(--ok-soft); color: var(--ok); }
    .workspace-state {
      display: flex; min-height: 120px; align-items: center; justify-content: center;
      gap: 12px; color: var(--muted); font-size: 11px; text-align: center;
    }
    .workspace-state > div { display: grid; gap: 2px; }
    .workspace-state--error { color: var(--danger); }
    .workspace-controls {
      position: sticky; z-index: 2; top: 116px; margin: -4px -4px 0; padding: 4px;
      border-radius: 10px; background: color-mix(in srgb, var(--surface) 94%, transparent);
      backdrop-filter: blur(8px);
    }
    .workspace-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .scope-switch { display: flex; padding: 3px; border-radius: 10px; background: var(--surface-2); }
    .scope-switch button {
      min-height: 34px; padding: 6px 12px; border: 0; border-radius: 8px;
      background: transparent; color: var(--muted); font-size: 10.5px; font-weight: 700; cursor: pointer;
    }
    .scope-switch button.active { background: #fff; color: var(--rose-dark); box-shadow: var(--shadow-xs); }
    .language-overview {
      display: grid; grid-template-columns: repeat(8, minmax(48px, 1fr)); gap: 4px; margin-top: 8px;
    }
    .language-overview > span {
      display: flex; min-width: 0; min-height: 27px; align-items: center; justify-content: center;
      gap: 4px; padding: 4px; border-radius: 7px; background: var(--warn-soft); color: var(--ink-2);
    }
    .language-overview > span.complete { background: var(--ok-soft); color: var(--ok); }
    .language-overview b { font-size: 8.5px; }
    .language-overview small { color: inherit; font-size: 8px; }
    .filter-row { display: flex; align-items: center; gap: 9px; margin-top: 8px; }
    .content-search { flex: 1; min-width: 0; }
    .content-search .input { min-height: 36px; }
    .result-count { flex: none; color: var(--muted); font-size: 8.5px; font-weight: 650; }
    .prefix-filters {
      display: flex; gap: 4px; margin-top: 6px; overflow-x: auto; padding-bottom: 3px;
      scrollbar-width: thin;
    }
    .prefix-filters button {
      display: inline-flex; flex: none; min-height: 28px; align-items: center; gap: 5px;
      padding: 4px 8px; border: 1px solid var(--line); border-radius: 999px;
      background: var(--surface-2); color: var(--muted); font-size: 8.5px; font-weight: 700; cursor: pointer;
    }
    .prefix-filters button.active { border-color: var(--rose); background: var(--rose-soft); color: var(--rose-dark); }
    .prefix-filters small { font-size: 7.5px; }
    .create-group {
      display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px;
      padding: 12px; border: 1px solid var(--rose-line); border-radius: var(--r-sm); background: var(--rose-soft);
    }
    .create-group__hint { margin: 0; align-self: end; }
    .required-toggle { display: flex; align-items: center; gap: 7px; font-size: 10px; font-weight: 650; }
    .required-toggle input { width: 17px; height: 17px; accent-color: var(--rose); }
    .create-group__actions { display: flex; justify-content: flex-end; gap: 6px; }
    .workspace-grid { display: grid; grid-template-columns: minmax(210px, .42fr) minmax(0, 1fr); gap: 12px; margin-top: 12px; }
    .group-list {
      display: grid; max-height: min(640px, calc(100vh - 170px)); align-content: start;
      gap: 5px; overflow-y: auto; padding-right: 3px; scrollbar-width: thin;
    }
    .group-list > button {
      display: flex; min-width: 0; min-height: 55px; align-items: center; justify-content: space-between;
      gap: 8px; padding: 9px 10px; border: 1px solid var(--line); border-radius: 9px;
      background: var(--surface-2); color: var(--ink-2); text-align: left; cursor: pointer;
    }
    .group-list > button.active { border-color: var(--rose); background: var(--rose-soft); }
    .group-list > button > span { display: grid; min-width: 0; gap: 2px; }
    .group-list b, .group-list small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .group-list b { font-size: 10.5px; }
    .group-list small { color: var(--muted); font-size: 8.5px; }
    .group-list em {
      display: grid; min-width: 21px; height: 21px; place-items: center; border-radius: 999px;
      background: var(--warn-soft); color: var(--warn); font-size: 8px; font-style: normal; font-weight: 750;
    }
    .group-list em.complete { background: var(--ok-soft); color: var(--ok); }
    .group-list em.optional { width: auto; padding-inline: 5px; background: var(--surface); color: var(--muted); }
    .empty-groups { padding: 20px 8px; color: var(--muted); font-size: 10px; text-align: center; }
    .group-editor { min-inline-size: 0; margin: 0; padding: 12px; border: 1px solid var(--line); border-radius: var(--r-sm); }
    .group-editor__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .group-editor__head > div { display: grid; min-width: 0; gap: 2px; }
    .eyebrow { color: var(--rose-dark); font-size: 8px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .group-label { width: 100%; padding: 0; border: 0; background: transparent; color: var(--ink); font: 700 14px var(--font); }
    .group-editor__head small { color: var(--muted); font-size: 8.5px; }
    .legal-review {
      display: flex; gap: 9px; margin-top: 10px; padding: 9px 10px;
      border-radius: 9px; background: var(--warn-soft); color: var(--ink-2);
    }
    .legal-review > span { font-size: 16px; }
    .legal-review > div { display: grid; gap: 1px; }
    .legal-review b { font-size: 10px; }
    .legal-review small { color: var(--muted); font-size: 9px; }
    .language-tabs { display: grid; grid-template-columns: repeat(8, minmax(42px, 1fr)); gap: 4px; margin-top: 11px; }
    .language-tabs button {
      display: flex; min-width: 0; min-height: 38px; align-items: center; justify-content: center;
      gap: 3px; border: 1px solid var(--line); border-radius: 8px;
      background: var(--surface-2); color: var(--ink-2); cursor: pointer;
    }
    .language-tabs button.active { border-color: var(--rose); background: var(--rose-soft); }
    .language-tabs b { font-size: 9px; }
    .language-tabs small { color: var(--warn); font-size: 8px; }
    .language-tabs button.complete small { color: var(--ok); }
    .mobile-language-picker { display: none; }
    .translation-value { display: grid; gap: 5px; margin-top: 11px; }
    .translation-value > span { font-size: 10.5px; font-weight: 650; }
    .conflict, .save-error {
      margin-top: 10px; padding: 9px 10px; border-radius: 9px;
      background: var(--danger-soft); color: var(--danger); font-size: 10px;
    }
    .conflict { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .conflict > div { display: grid; gap: 1px; }
    .conflict small { font-size: 9px; }
    .group-editor__actions { display: flex; align-items: center; gap: 6px; margin-top: 11px; }
    .next-language { display: flex; width: 100%; min-height: 48px; align-items: center; justify-content: flex-start; gap: 5px; margin-top: 8px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink-2); font-size: 13px; cursor: pointer; }
    .next-language span { margin-left: auto; color: var(--rose-dark); font-size: 21px; }
    .danger-link { color: var(--danger); }

    @media (max-width: 720px) {
      .content-translations__head { align-items: stretch; flex-direction: column; }
      .content-translations__head h2 { font-size: 18px; }
      .content-translations__head p, .overview-progress, .workspace-state { font-size: 13px; line-height: 1.45; }
      .overview-progress { align-self: flex-start; }
      .workspace-controls { position: static; margin: 0; padding: 0; background: var(--surface); backdrop-filter: none; }
      .workspace-toolbar { align-items: stretch; flex-direction: column; }
      .scope-switch { display: grid; grid-template-columns: 1fr 1fr; }
      .scope-switch button, .content-translations .btn { min-height: 48px; font-size: 14px; }
      .language-overview { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
      .language-overview > span { min-height: 42px; }
      .language-overview b, .language-overview small { font-size: 12px; }
      .filter-row { align-items: stretch; flex-direction: column; }
      .content-search .input { min-height: 48px; }
      .result-count { font-size: 13px; }
      .prefix-filters { gap: 7px; padding-block: 2px 7px; }
      .prefix-filters button { min-height: 48px; padding-inline: 14px; font-size: 13px; }
      .prefix-filters small { font-size: 12px; }
      .create-group { grid-template-columns: 1fr; }
      .create-group__actions .btn { flex: 1; }
      .workspace-grid { grid-template-columns: 1fr; }
      .group-list { max-height: 300px; padding-right: 0; }
      .group-list > button { min-height: 64px; padding: 11px 12px; }
      .group-list b { font-size: 15px; }
      .group-list small { font-size: 12px; }
      .group-list em { min-width: 28px; height: 28px; font-size: 12px; }
      .group-editor { padding: 13px; }
      .group-editor__head { align-items: stretch; flex-direction: column; }
      .group-label { min-height: 48px; font-size: 17px; }
      .group-editor__head small, .eyebrow { font-size: 12px; }
      .required-toggle { min-height: 48px; font-size: 14px; }
      .required-toggle input { width: 22px; height: 22px; }
      .legal-review b { font-size: 14px; }
      .legal-review small { font-size: 13px; }
      .language-tabs { display: none; }
      .mobile-language-picker { display: grid; gap: 6px; margin-top: 12px; }
      .mobile-language-picker > span, .translation-value > span { font-size: 14px; font-weight: 700; }
      .mobile-language-picker .select { min-height: 48px; font-size: 16px; }
      .translation-value .textarea { min-height: 190px; font-size: 16px; }
      .conflict, .save-error { font-size: 13px; }
      .conflict { align-items: stretch; flex-direction: column; }
      .conflict small { font-size: 13px; }
      .group-editor__actions { display: grid; grid-template-columns: 1fr 1fr; }
      .group-editor__actions .spacer { display: none; }
      .group-editor__actions .danger-link { grid-column: 1 / -1; }
    }
  `,
})
export class ContentTranslationWorkspace {
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  private loadStarted = false;

  readonly languages = TRANSLATION_LANGUAGES;
  readonly visible = input(true);
  readonly syncRefreshKey = input(0);
  readonly dirtyChange = output<boolean>();
  readonly busyChange = output<boolean>();
  readonly scope = signal<ContentTranslationScope>('WEBSITE');
  readonly groups = signal<ContentTranslationGroup[]>([]);
  readonly draft = signal<ContentTranslationGroup | null>(null);
  private readonly saved = signal<ContentTranslationGroup | null>(null);
  readonly selectedLanguage = signal<LanguageCode>('NL');
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly creating = signal(false);
  readonly creatingRequest = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);
  readonly conflict = signal(false);
  readonly newKey = signal('');
  readonly newLabel = signal('');
  readonly websiteSyncRefresh = signal(0);
  readonly search = signal('');
  readonly prefix = signal('ALL');

  readonly busy = computed(() => this.saving() || this.deleting() || this.creatingRequest());
  readonly hasPendingChanges = computed(() => this.dirty()
    || (this.creating() && (
      !!this.newKey().trim() || !!this.newLabel().trim()
    )));
  readonly websiteSyncRefreshKey = computed(() =>
    this.websiteSyncRefresh() + this.syncRefreshKey());
  readonly dirty = computed(() => JSON.stringify(this.draft()) !== JSON.stringify(this.saved()));
  readonly scopeGroups = computed(() => this.groups()
    .filter((group) => group.scope === this.scope()));
  readonly prefixOptions = computed<ContentPrefixOption[]>(() => {
    const counts = new Map<string, number>();
    for (const group of this.scopeGroups()) {
      const prefix = this.groupPrefix(group.key);
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([key, count]) => ({ key, count, label: this.prefixLabel(key) }))
      .sort((left, right) => left.label.localeCompare(right.label, 'nl'));
  });
  readonly visibleGroups = computed(() => {
    const query = this.searchTerm(this.search());
    const prefix = this.prefix();
    return this.scopeGroups()
      .filter((group) => prefix === 'ALL' || this.groupPrefix(group.key) === prefix)
      .filter((group) => !query || this.searchTerm([
        group.label,
        group.key,
        ...group.texts.map((text) => text.value ?? ''),
      ].join(' ')).includes(query))
      .sort((left, right) => left.label.localeCompare(right.label, 'nl'));
  });
  readonly languageCompletion = computed<LanguageCompletion[]>(() => {
    const required = this.scopeGroups().filter((group) => group.required);
    return this.languages.map((language) => ({
      code: language.code,
      total: required.length,
      complete: required.filter(
        (group) => !group.missingLanguages.includes(language.code),
      ).length,
    }));
  });
  readonly requiredMissing = computed(() => this.groups()
    .filter((group) => group.required)
    .reduce((total, group) => total + group.missingLanguages.length, 0),
  );
  readonly selectedLanguageLabel = computed(() =>
    this.languages.find((item) => item.code === this.selectedLanguage())?.label
      ?? this.selectedLanguage(),
  );
  readonly selectedValue = computed(() => this.draft()?.texts.find(
    (text) => text.language === this.selectedLanguage(),
  )?.value ?? '');
  readonly nextMissingLanguage = computed(() => {
    const group = this.draft();
    if (!group?.required) return null;
    const currentIndex = this.languages.findIndex(
      (language) => language.code === this.selectedLanguage(),
    );
    for (let offset = 1; offset < this.languages.length; offset += 1) {
      const candidate = this.languages[(currentIndex + offset) % this.languages.length];
      if (!this.hasText(group, candidate.code)) return candidate;
    }
    return null;
  });
  readonly legalReview = computed(() => {
    const group = this.draft();
    return !!group && /(?:legal|terms|conditions|privacy|voorwaarden|jurid)/i
      .test(`${group.key} ${group.label}`);
  });
  readonly keyValid = computed(() => CONTENT_KEY_PATTERN.test(this.newKey()));
  readonly draftValid = computed(() => {
    const group = this.draft();
    return !!group?.label.trim() && (!group.required || group.missingLanguages.length === 0);
  });

  constructor() {
    effect(() => {
      if (!this.visible() || this.loadStarted) return;
      this.loadStarted = true;
      untracked(() => void this.load());
    });
    effect(() => this.dirtyChange.emit(this.hasPendingChanges()));
    effect(() => this.busyChange.emit(this.busy()));
  }

  async load(): Promise<void> {
    if (this.loading() && this.groups().length) return;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [website, catalog] = await Promise.all([
        this.catalog.contentTranslations('WEBSITE'),
        this.catalog.contentTranslations('CATALOG'),
      ]);
      const groups = [...website.groups, ...catalog.groups];
      this.groups.set(groups);
      const current = this.draft();
      const selected = current
        ? groups.find((group) => group.scope === current.scope && group.key === current.key)
        : groups.find((group) => group.scope === this.scope()) ?? groups[0];
      this.setSelected(selected ?? null);
    } catch (failure: unknown) {
      this.loadError.set(messageOf(failure, 'Controleer de verbinding en probeer opnieuw.'));
    } finally {
      this.loading.set(false);
    }
  }

  select(group: ContentTranslationGroup): void {
    if (this.busy() || (this.hasPendingChanges() && this.draft()?.key !== group.key)) return;
    this.setSelected(group);
  }

  changeScope(scope: ContentTranslationScope): void {
    if (this.busy() || this.hasPendingChanges() || scope === this.scope()) return;
    this.scope.set(scope);
    this.search.set('');
    this.prefix.set('ALL');
    this.setSelected(this.groups().find((group) => group.scope === scope) ?? null);
  }

  patchGroup(changes: Partial<ContentTranslationGroup>): void {
    if (this.busy()) return;
    const current = this.draft();
    if (current?.system && ('label' in changes || 'required' in changes)) return;
    this.saveError.set(null);
    this.conflict.set(false);
    this.draft.update((group) => group ? { ...group, ...changes } : group);
  }

  patchValue(value: string): void {
    const group = this.draft();
    if (!group || this.busy()) return;
    const language = this.selectedLanguage();
    const text: ContentTranslationText = { language, value };
    const texts = group.texts.some((item) => item.language === language)
      ? group.texts.map((item) => item.language === language ? text : item)
      : [...group.texts, text];
    this.patchGroup({ texts, missingLanguages: this.missingLanguages({ ...group, texts }) });
  }

  hasText(group: ContentTranslationGroup, language: LanguageCode): boolean {
    return !!group.texts.find((text) => text.language === language)?.value?.trim();
  }

  async saveSelected(): Promise<void> {
    const group = this.draft();
    if (!group || !this.dirty() || !this.draftValid() || this.busy()) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.conflict.set(false);
    try {
      const saved = await this.catalog.updateContentTranslation(group.scope, group.key, {
        revision: group.revision,
        label: group.label.trim(),
        required: group.required,
        texts: group.texts.map((text) => ({
          language: text.language,
          value: text.value?.trim() || null,
        })),
      });
      this.replaceGroup(saved);
      this.setSelected(saved);
      this.websiteSyncRefresh.update((value) => value + 1);
      this.ui.toast('Tekstvertalingen opgeslagen');
    } catch (failure: unknown) {
      const status = (failure as { status?: number }).status;
      this.conflict.set(status === 409);
      this.saveError.set(status === 409
        ? 'Iemand heeft deze tekst intussen gewijzigd. Laad de laatste versie en controleer je aanpassing opnieuw.'
        : messageOf(failure, 'Tekstvertalingen opslaan mislukt.'));
    } finally {
      this.saving.set(false);
    }
  }

  async reloadSelected(): Promise<void> {
    const group = this.draft();
    if (!group || this.busy()) return;
    this.loading.set(true);
    try {
      const latest = await this.catalog.contentTranslation(group.scope, group.key);
      this.replaceGroup(latest);
      this.setSelected(latest);
    } catch (failure: unknown) {
      this.saveError.set(messageOf(failure, 'Laatste versie laden mislukt.'));
    } finally {
      this.loading.set(false);
    }
  }

  revertSelected(): void {
    const saved = this.saved();
    if (!this.busy()) this.draft.set(saved ? this.copy(saved) : null);
    this.saveError.set(null);
    this.conflict.set(false);
  }

  startCreate(): void {
    this.search.set('');
    this.prefix.set('ALL');
    this.newKey.set('');
    this.newLabel.set('');
    this.creating.set(true);
  }

  cancelCreate(): void {
    if (!this.creatingRequest()) this.creating.set(false);
  }

  normalizeKey(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/[.-]+/g, (separators) => separators.includes('.') ? '.' : '-')
      .replace(/^[.-]+|[.-]+$/g, '');
  }

  normalizeNewKey(): void {
    this.newKey.set(this.normalizeKey(this.newKey()));
  }

  async createGroup(): Promise<void> {
    if (!this.keyValid() || !this.newLabel().trim() || this.busy()) return;
    this.creatingRequest.set(true);
    try {
      const created = await this.catalog.createContentTranslation({
        scope: this.scope(),
        key: this.newKey(),
        label: this.newLabel().trim(),
        required: false,
        texts: [],
      });
      this.groups.update((groups) => [...groups, created]);
      this.creating.set(false);
      this.setSelected(created);
      this.websiteSyncRefresh.update((value) => value + 1);
      this.ui.toast('Tekstgroep toegevoegd');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Tekstgroep toevoegen mislukt'), 'err');
    } finally {
      this.creatingRequest.set(false);
    }
  }

  deleteSelected(): void {
    const group = this.draft();
    if (!group || group.system || this.dirty() || this.busy()) return;
    this.ui.confirm({
      title: 'Tekstgroep verwijderen',
      message: `<b>${escapeHtml(group.label)}</b> verwijderen?`,
      confirmLabel: 'Verwijderen',
      danger: true,
    }, async () => {
      this.deleting.set(true);
      try {
        await this.catalog.deleteContentTranslation(group.scope, group.key, group.revision);
        this.groups.update((groups) => groups.filter(
          (item) => item.scope !== group.scope || item.key !== group.key,
        ));
        this.setSelected(this.visibleGroups()[0] ?? null);
        this.websiteSyncRefresh.update((value) => value + 1);
        this.ui.toast('Tekstgroep verwijderd');
      } catch (failure: unknown) {
        const status = (failure as { status?: number }).status;
        this.conflict.set(status === 409);
        this.saveError.set(status === 409
          ? 'Deze tekstgroep is intussen gewijzigd. Laad de laatste versie.'
          : messageOf(failure, 'Tekstgroep verwijderen mislukt.'));
      } finally {
        this.deleting.set(false);
      }
    });
  }

  private setSelected(group: ContentTranslationGroup | null): void {
    if (group) this.scope.set(group.scope);
    const copy = group ? this.copy(group) : null;
    this.saved.set(copy ? this.copy(copy) : null);
    this.draft.set(copy);
    this.saveError.set(null);
    this.conflict.set(false);
  }

  private replaceGroup(group: ContentTranslationGroup): void {
    this.groups.update((groups) => [
      ...groups.filter((item) => item.scope !== group.scope || item.key !== group.key),
      group,
    ]);
  }

  private missingLanguages(group: ContentTranslationGroup): LanguageCode[] {
    return this.languages
      .map((language) => language.code)
      .filter((language) => !this.hasText(group, language));
  }

  private copy(group: ContentTranslationGroup): ContentTranslationGroup {
    return { ...group, texts: group.texts.map((text) => ({ ...text })),
      missingLanguages: [...group.missingLanguages] };
  }

  private groupPrefix(key: string): string {
    const parts = key.toLowerCase().split(/[._:/-]+/).filter(Boolean);
    return parts.find((part) => PREFIX_LABELS[part]) ?? parts[0] ?? 'other';
  }

  private prefixLabel(prefix: string): string {
    return PREFIX_LABELS[prefix]
      ?? prefix.charAt(0).toUpperCase() + prefix.slice(1).replaceAll('-', ' ');
  }

  private searchTerm(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }
}
